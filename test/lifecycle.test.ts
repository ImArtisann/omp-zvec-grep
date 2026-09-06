import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { registerAutoIndex } from "../src/extension/tools.ts";

function scenario(
    statusCode: number,
    mode: "missing" | "stale" | "ready" | "error",
    indexCode = 0,
) {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "omp-zvec-life-"));
    fs.mkdirSync(path.join(cwd, ".zvec-grep"), { recursive: true });
    fs.writeFileSync(
        path.join(cwd, ".zvec-grep", "config.json"),
        JSON.stringify({ projectScope: true, autoIndex: true }),
    );
    const calls: string[][] = [];
    let startHandler: ((event: unknown, ctx: unknown) => unknown) | undefined;
    let shutdownHandler: ((event: unknown, ctx: unknown) => unknown) | undefined;
    let indexGate: Promise<void> | undefined;
    const pi = {
        on(event: string, handler: (event: unknown, ctx: unknown) => unknown) {
            if (event === "session_start") startHandler = handler;
            else if (event === "session_shutdown") shutdownHandler = handler;
        },
        exec: async (_command: string, args: string[]) => {
            calls.push(args);
            if (args[0] === "status")
                return {
                    stdout:
                        mode === "ready"
                            ? "Workspace index is ready"
                            : mode === "stale"
                              ? "Workspace index needs an update"
                              : mode === "error"
                                ? ""
                                : "No zvec-grep index found",
                    stderr: mode === "error" ? "permission denied" : "",
                    code: statusCode,
                    killed: false,
                };
            if (indexGate) await indexGate;
            return { stdout: "", stderr: "", code: indexCode, killed: false };
        },
    };
    registerAutoIndex(pi as never);
    const ctx = { cwd, ui: { notify() {} } };
    return {
        calls,
        startHandler: startHandler!,
        shutdownHandler: shutdownHandler!,
        ctx,
        setGate(promise: Promise<void>) {
            indexGate = promise;
        },
    };
}
const flush = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
};

describe("auto-index lifecycle decisions", () => {
    test("off is idle; ready checks without building; missing and stale build", async () => {
        const ready = scenario(0, "ready");
        await ready.startHandler({}, ready.ctx);
        await flush();
        expect(ready.calls.map((call) => call[0])).toEqual(["status"]);
        const missing = scenario(1, "missing");
        await missing.startHandler({}, missing.ctx);
        await flush();
        expect(missing.calls.map((call) => call[0])).toEqual(["status", "index"]);
        const stale = scenario(1, "stale");
        await stale.startHandler({}, stale.ctx);
        await flush();
        expect(stale.calls.map((call) => call[0])).toEqual(["status", "index"]);
    });
    test("operational errors do not index; starts deduplicate", async () => {
        const error = scenario(2, "error");
        await error.startHandler({}, error.ctx);
        await flush();
        expect(error.calls.map((call) => call[0])).toEqual(["status"]);
        const dedup = scenario(1, "missing");
        let release!: () => void;
        dedup.setGate(
            new Promise<void>((resolve) => {
                release = resolve;
            }),
        );
        const first = dedup.startHandler({}, dedup.ctx);
        const second = dedup.startHandler({}, dedup.ctx);
        await flush();
        expect(dedup.calls.filter((call) => call[0] === "index")).toHaveLength(1);
        release();
        await Promise.all([first, second]);
    });
    test("failure releases root for retry and shutdown aborts in-flight work", async () => {
        const retry = scenario(1, "missing", 1);
        await retry.startHandler({}, retry.ctx);
        await flush();
        await retry.startHandler({}, retry.ctx);
        await flush();
        expect(retry.calls.filter((call) => call[0] === "index")).toHaveLength(2);
        const shutdown = scenario(1, "missing");
        let release!: () => void;
        shutdown.setGate(
            new Promise<void>((resolve) => {
                release = resolve;
            }),
        );
        const running = shutdown.startHandler({}, shutdown.ctx);
        await flush();
        await shutdown.shutdownHandler({}, shutdown.ctx);
        release();
        await running;
        expect(shutdown.calls.map((call) => call[0])).toEqual(["status", "index"]);
    });
});
