/** Background index coordination, independent of the host extension API. */

import { parseStatusVerdict } from "../core/format.ts";
import { normalizeRoot } from "../core/workspace.ts";
import { ZG_INDEX_TIMEOUT_MS, ZG_STATUS_TIMEOUT_MS } from "../core/zg.ts";

export interface AutoIndexExecResult {
    stdout: string;
    stderr: string;
    code: number;
    killed: boolean;
}

export interface AutoIndexExecOptions {
    cwd: string;
    signal: AbortSignal;
    timeoutMs: number;
}

export type AutoIndexExec = (
    args: string[],
    options: AutoIndexExecOptions,
) => Promise<AutoIndexExecResult>;

export interface AutoIndexSettings {
    autoIndex: boolean;
}

export type AutoIndexNotify = (message: string, type?: "info" | "warning" | "error") => void;

export interface AutoIndexer {
    /**
     * Start one readiness check. Work is deliberately fire-and-forget so a
     * session-start hook never waits for an embedding model or index build.
     */
    start(root: string, settings: AutoIndexSettings, notify: AutoIndexNotify): void;
    shutdown(): void;
}

function failureMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function killedMessage(
    result: AutoIndexExecResult,
    action: string,
    signal: AbortSignal,
    timeoutMs: number,
): string | undefined {
    if (!result.killed) return undefined;
    if (signal.aborted) return `${action} cancelled`;
    return `${action} timed out after ${Math.round(timeoutMs / 1000)}s`;
}

export function createAutoIndexer(exec: AutoIndexExec): AutoIndexer {
    const inflight = new Set<string>();
    const shutdown = new AbortController();

    const notifySafely = (notify: AutoIndexNotify, message: string, type: "info" | "error") => {
        try {
            notify(message, type);
        } catch {
            // UI notification failure must not turn background work into an
            // unhandled rejection or prevent in-flight state cleanup.
        }
    };

    const start = (rawRoot: string, settings: AutoIndexSettings, notify: AutoIndexNotify): void => {
        const root = normalizeRoot(".", rawRoot);
        if (shutdown.signal.aborted || !settings.autoIndex || inflight.has(root)) return;
        inflight.add(root);

        void (async () => {
            let check: AutoIndexExecResult;
            try {
                check = await exec(["status", "--check-ready"], {
                    cwd: root,
                    signal: shutdown.signal,
                    timeoutMs: ZG_STATUS_TIMEOUT_MS,
                });
            } catch (error) {
                if (!shutdown.signal.aborted)
                    notifySafely(
                        notify,
                        `zvec: readiness check failed: ${failureMessage(error)}`,
                        "error",
                    );
                return;
            }
            if (shutdown.signal.aborted) return;
            const checkFailure = killedMessage(
                check,
                "zvec auto-index readiness check",
                shutdown.signal,
                ZG_STATUS_TIMEOUT_MS,
            );
            if (checkFailure) {
                notifySafely(notify, `zvec: readiness check failed: ${checkFailure}`, "error");
                return;
            }

            const verdict = parseStatusVerdict(`${check.stdout}\n${check.stderr}`);
            if (check.code === 0 || verdict?.kind === "ready") return;
            if (verdict?.kind !== "missing" && verdict?.kind !== "needs-update") {
                notifySafely(
                    notify,
                    `zvec: readiness check failed: ${check.stderr || check.stdout || `exit ${check.code}`}`,
                    "error",
                );
                return;
            }

            notifySafely(notify, "zvec: index missing or stale — building in background…", "info");
            if (shutdown.signal.aborted) return;
            let result: AutoIndexExecResult;
            try {
                result = await exec(["index", root], {
                    cwd: root,
                    signal: shutdown.signal,
                    timeoutMs: ZG_INDEX_TIMEOUT_MS,
                });
            } catch (error) {
                if (!shutdown.signal.aborted)
                    notifySafely(
                        notify,
                        `zvec: auto index failed: ${failureMessage(error)}`,
                        "error",
                    );
                return;
            }
            if (shutdown.signal.aborted) return;
            const indexFailure = killedMessage(
                result,
                "zvec auto-index",
                shutdown.signal,
                ZG_INDEX_TIMEOUT_MS,
            );
            if (indexFailure) {
                notifySafely(notify, `zvec: auto index failed: ${indexFailure}`, "error");
                return;
            }
            if (result.code !== 0) {
                notifySafely(
                    notify,
                    `zvec: auto index failed: ${result.stderr || result.stdout || `exit ${result.code}`}`,
                    "error",
                );
            } else {
                notifySafely(notify, `zvec: index updated for ${root}`, "info");
            }
        })()
            .catch((error: unknown) => {
                if (!shutdown.signal.aborted)
                    notifySafely(
                        notify,
                        `zvec: auto index failed: ${failureMessage(error)}`,
                        "error",
                    );
            })
            .finally(() => {
                inflight.delete(root);
            });
    };

    return {
        start,
        shutdown: () => shutdown.abort(),
    };
}
