/** Native Oh My Pi tool, command, and lifecycle surface for zvec-grep. */

import type {
    ExtensionAPI,
    ExtensionCommandContext,
    ExecResult,
    ToolRenderResultOptions,
} from "@oh-my-pi/pi-coding-agent";
import { keyHint, z as hostZod } from "@oh-my-pi/pi-coding-agent";
import type { Component, AutocompleteItem } from "@oh-my-pi/pi-tui";
import { Text as TextComponent } from "@oh-my-pi/pi-tui";
import type { Theme } from "@oh-my-pi/pi-coding-agent";
import { buildIndexArgs, type ZvecIndexParams } from "../core/indexing.ts";
import { buildQueryArgs, type ZvecSearchQueryParams } from "../core/queries.ts";
import {
    hitHeadline,
    parseIndexOutput,
    parseSearchOutput,
    parseStatusVerdict,
    type ZgHit,
    type ZgIndexSummary,
    type ZgSearchSummary,
    type ZgStatusVerdict,
} from "../core/format.ts";
import { clip, normalizeRoot } from "../core/workspace.ts";
import { loadSettings } from "./config.ts";
import { createAutoIndexer } from "./lifecycle.ts";
import { openSettings } from "./settings-ui.ts";
import { ZG_INDEX_TIMEOUT_MS, ZG_QUERY_TIMEOUT_MS, ZG_STATUS_TIMEOUT_MS } from "../core/zg.ts";

const MAX_SEARCH_LIMIT = 50;
const SEARCH_GUIDANCE =
    "For exact strings, regex, filenames, counts, file lists, or anything piped, use native grep/glob/rg instead. " +
    "Use zvec_search for semantic or location-unknown discovery; zvec_index is required before searching.";

export type SearchToolInput = ZvecSearchQueryParams & { root?: string };
export type IndexToolInput = ZvecIndexParams;
export type StatusToolInput = { root?: string };

function makeSearchParams(z: typeof hostZod) {
    return z.object({
        query: z.string().describe("One hybrid natural-language or exact query").optional(),
        queries: z.array(z.string()).describe("Explicit hybrid query groups").optional(),
        fts: z.array(z.string()).describe("Ranked lexical query groups").optional(),
        vector: z.array(z.string()).describe("Semantic-only query groups").optional(),
        fuse: z.boolean().describe("Combine every query group into one ranked list").optional(),
        limit: z
            .number()
            .min(1)
            .max(50)
            .describe("Maximum hits per group (default 7, cap 50)")
            .optional(),
        globs: z.array(z.string()).describe("Include/exclude path globs").optional(),
        fileTypes: z.array(z.string()).describe("Included file types").optional(),
        excludedFileTypes: z.array(z.string()).describe("Excluded file types").optional(),
        symbolTypes: z.array(z.string()).describe("Indexed symbol kinds").optional(),
        preferSymbol: z.boolean().describe("Prefer exact indexed symbols").optional(),
        modifiedAfter: z.string().describe("Only files modified after this timestamp").optional(),
        modifiedBefore: z.string().describe("Only files modified before this timestamp").optional(),
        root: z
            .string()
            .describe("Workspace root; defaults to the current working directory")
            .optional(),
    });
}
function makeIndexParams(z: typeof hostZod) {
    return z.object({
        root: z.string().describe("Workspace root to index"),
        mode: z.enum(["index", "rebuild", "drop"]).describe("index, rebuild, or drop").optional(),
        embedding: z.string().describe("Embedding model configured for zg").optional(),
        globs: z.array(z.string()).describe("Include/exclude path globs").optional(),
        fileTypes: z.array(z.string()).describe("Included file types").optional(),
        excludedFileTypes: z.array(z.string()).describe("Excluded file types").optional(),
        hidden: z.boolean().describe("Include hidden paths").optional(),
    });
}
function makeStatusParams(z: typeof hostZod) {
    return z.object({
        root: z
            .string()
            .describe("Workspace root; defaults to the current working directory")
            .optional(),
    });
}

type ZgExec = (
    command: string,
    args: string[],
    options?: { cwd?: string; signal?: AbortSignal; timeout?: number },
) => Promise<ExecResult>;

function errorFromExec(error: unknown, action: string, signal?: AbortSignal): Error {
    if (signal?.aborted) return new Error(`${action} cancelled`);
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT")
        return new Error(`${action} unavailable: zg CLI was not found`);
    return new Error(
        `${action} could not run: ${error instanceof Error ? error.message : String(error)}`,
    );
}

async function runZg(
    exec: ZgExec,
    args: string[],
    options: { cwd: string; signal?: AbortSignal; timeoutMs: number },
    action: string,
): Promise<ExecResult> {
    let result: ExecResult;
    try {
        result = await exec("zg", args, {
            cwd: options.cwd,
            signal: options.signal,
            timeout: options.timeoutMs,
        });
    } catch (error) {
        throw errorFromExec(error, action, options.signal);
    }
    if (result.killed) {
        if (options.signal?.aborted) throw new Error(`${action} cancelled`);
        throw new Error(`${action} timed out after ${Math.round(options.timeoutMs / 1000)}s`);
    }
    return result;
}
function validHit(value: unknown): value is ZgHit {
    if (typeof value !== "object" || value === null) return false;
    for (const key of ["file", "label", "preview"] as const) {
        if (key in value) {
            const field: unknown = Reflect.get(value, key);
            if (field !== undefined && typeof field !== "string") return false;
        }
    }
    return true;
}
function validSearchSummary(value: unknown): value is ZgSearchSummary {
    if (typeof value !== "object" || value === null) return false;
    const summary = value as Partial<ZgSearchSummary>;
    return (
        typeof summary.totalHits === "number" &&
        typeof summary.fileCount === "number" &&
        typeof summary.hasStale === "boolean" &&
        Array.isArray(summary.groups) &&
        (summary.top === undefined || validHit(summary.top))
    );
}
function validIndexSummary(value: unknown): value is ZgIndexSummary {
    if (typeof value !== "object" || value === null) return false;
    const summary = value as Partial<ZgIndexSummary>;
    return (
        typeof summary.scanned === "number" &&
        typeof summary.added === "number" &&
        typeof summary.modified === "number" &&
        typeof summary.deleted === "number"
    );
}
function searchSummaryFromDetails(details: unknown): ZgSearchSummary | undefined {
    if (typeof details !== "object" || details === null || !("summary" in details))
        return undefined;
    return validSearchSummary(details.summary) ? details.summary : undefined;
}
function indexSummaryFromDetails(details: unknown): ZgIndexSummary | undefined {
    if (typeof details !== "object" || details === null || !("indexSummary" in details))
        return undefined;
    return validIndexSummary(details.indexSummary) ? details.indexSummary : undefined;
}
function verdictFromDetails(details: unknown, raw: string): ZgStatusVerdict | undefined {
    if (
        typeof details === "object" &&
        details !== null &&
        "verdict" in details &&
        typeof details.verdict === "object" &&
        details.verdict !== null &&
        "kind" in details.verdict &&
        "line" in details.verdict &&
        typeof details.verdict.kind === "string" &&
        typeof details.verdict.line === "string"
    ) {
        return details.verdict as ZgStatusVerdict;
    }
    return parseStatusVerdict(raw);
}
function resultText(result: { content?: Array<{ type: string; text?: string }> }): string {
    return (
        result.content?.find(
            (content) => content.type === "text" && typeof content.text === "string",
        )?.text ?? ""
    );
}
function component(text: string): Component {
    return new TextComponent(text, 0, 0);
}
function short(text: string, max = 60): string {
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
function expandHint(): string {
    return ` ${keyHint("app.tools.expand", "to expand")}`;
}
function previewRow(raw: string, theme: Theme, lines = 3): Component {
    const rows = raw.split("\n");
    let text = rows
        .slice(0, lines)
        .map((line) => theme.fg("dim", line))
        .join("\n");
    if (rows.length > lines)
        text += theme.fg("muted", `\n… ${rows.length - lines} more lines${expandHint()}`);
    return component(text);
}
function errorRow(raw: string, theme: Theme, expanded: boolean): Component {
    const rows = raw.split("\n");
    let text = theme.fg("error", rows[0] || "error");
    if (expanded && rows.length > 1)
        text += `\n${rows
            .slice(1)
            .map((line) => theme.fg("toolOutput", line))
            .join("\n")}`;
    else if (rows.length > 1) text += theme.fg("muted", expandHint());
    return component(text);
}
function styledSearchOutput(raw: string, theme: Theme): string {
    return raw
        .split("\n")
        .map((line) => {
            const hit = line.match(/^#(\d+) (matchedBy=\S+ )?(\S.*)$/);
            if (hit)
                return `${theme.fg("muted", `#${hit[1]}`)} ${hit[2] ? theme.fg("dim", hit[2]) : ""}${hit[2] ? " " : ""}${theme.fg("accent", hit[3])}`;
            if (/^Q\d+ \[/.test(line)) return theme.fg("accent", line);
            if (/^(query groups|hits:|results:|status:)/.test(line)) return theme.fg("muted", line);
            if (/^(heading|heading_level|scope|symbol):/.test(line)) return theme.fg("dim", line);
            if (line.startsWith("…(truncated")) return theme.fg("warning", line);
            return theme.fg("toolOutput", line);
        })
        .join("\n");
}
function styledIndexOutput(raw: string, theme: Theme): string {
    return raw
        .split("\n")
        .map((line) =>
            line.startsWith("tip\t")
                ? theme.fg("dim", line)
                : line.startsWith("Workspace index")
                  ? theme.fg("accent", line)
                  : theme.fg("toolOutput", line),
        )
        .join("\n");
}

export function registerZvecTools(pi: ExtensionAPI): void {
    const searchParams = makeSearchParams(pi.zod);
    const indexParams = makeIndexParams(pi.zod);
    const statusParams = makeStatusParams(pi.zod);
    const exec: ZgExec = (command, args, options) => pi.exec(command, args, options);

    pi.registerTool({
        name: "zvec_search",
        label: "Zvec Search",
        approval: "exec",
        parameters: searchParams,
        description:
            "Hybrid semantic + keyword search over a locally indexed workspace. " + SEARCH_GUIDANCE,
        async execute(_id, params, signal, _onUpdate, ctx) {
            const started = Date.now();
            const settings = loadSettings(ctx.cwd);
            const limit =
                params.limit === undefined
                    ? settings.defaultLimit
                    : Math.min(Math.max(Math.round(params.limit), 1), MAX_SEARCH_LIMIT);
            const args = buildQueryArgs(params, { limit });
            const root = normalizeRoot(params.root, ctx.cwd);
            const result = await runZg(
                exec,
                args,
                { cwd: root, signal, timeoutMs: ZG_QUERY_TIMEOUT_MS },
                "zvec_search",
            );
            if (result.code !== 0)
                throw new Error(
                    result.stderr || result.stdout || `zvec_search failed (exit ${result.code})`,
                );
            const stdout = result.stdout.trimEnd();
            return {
                content: [{ type: "text" as const, text: clip(stdout) }],
                details: { summary: parseSearchOutput(stdout), durationMs: Date.now() - started },
            };
        },
        renderCall(args, _options, theme) {
            const a = args as SearchToolInput;
            const groups =
                (a.query ? 1 : 0) +
                (a.queries?.length ?? 0) +
                (a.fts?.length ?? 0) +
                (a.vector?.length ?? 0);
            const query =
                a.query ?? a.queries?.[0] ?? a.fts?.[0] ?? a.vector?.[0] ?? "(missing query)";
            let line = `${theme.fg("toolTitle", theme.bold("zvec_search"))} ${theme.fg("accent", `"${short(query)}"`)}`;
            if (groups > 1) line += ` ${theme.fg("dim", `+${groups - 1} more`)}`;
            if (a.root) line += ` ${theme.fg("toolOutput", `in ${short(a.root)}`)}`;
            const filters = [
                ...(a.fileTypes ?? []),
                ...(a.excludedFileTypes ?? []).map((value) => `!${value}`),
                ...(a.globs ?? []),
                ...(a.symbolTypes ?? []),
            ];
            if (filters.length) line += ` ${theme.fg("dim", `(${filters.join(", ")})`)}`;
            if (a.limit !== undefined) line += ` ${theme.fg("dim", `limit ${a.limit}`)}`;
            return component(line);
        },
        renderResult(result, options: ToolRenderResultOptions, theme) {
            if (options.isPartial) return component(theme.fg("warning", "searching…"));
            const raw = resultText(result) || "(zvec_search returned no output)";
            if (result.isError || raw.trimStart().startsWith("Error:"))
                return errorRow(raw, theme, options.expanded);
            const summary = searchSummaryFromDetails(result.details);
            if (options.expanded)
                return component(
                    theme.fg("toolOutput", summary ? styledSearchOutput(raw, theme) : raw),
                );
            if (!summary) return previewRow(raw, theme);
            if (summary.totalHits === 0) return component(theme.fg("muted", "no hits"));
            let line = theme.fg(
                "success",
                `✓ ${summary.totalHits} hit${summary.totalHits === 1 ? "" : "s"} · ${summary.fileCount} file${summary.fileCount === 1 ? "" : "s"}`,
            );
            if (summary.hasStale) line += theme.fg("warning", " · stale");
            line += theme.fg("muted", expandHint());
            if (summary.top) line += `\n${theme.fg("muted", `   ${hitHeadline(summary.top)}`)}`;
            const duration = (result.details as { durationMs?: number } | undefined)?.durationMs;
            if (duration !== undefined) line += theme.fg("dim", ` · ${duration}ms`);
            return component(line);
        },
    });

    pi.registerTool({
        name: "zvec_index",
        label: "Zvec Index",
        approval: "write",
        parameters: indexParams,
        description:
            "Create or update a local zvec-grep index. Rebuild and drop are destructive; only use them when explicitly requested. " +
            SEARCH_GUIDANCE,
        async execute(_id, params, signal, onUpdate, ctx) {
            const started = Date.now();
            const root = normalizeRoot(params.root, ctx.cwd);
            const args = buildIndexArgs(params as ZvecIndexParams, root);
            onUpdate?.({
                content: [{ type: "text", text: `${params.mode ?? "index"}ing ${root}…` }],
            });
            const result = await runZg(
                exec,
                args,
                { cwd: root, signal, timeoutMs: ZG_INDEX_TIMEOUT_MS },
                "zvec_index",
            );
            if (result.code !== 0)
                throw new Error(
                    result.stderr || result.stdout || `zvec_index failed (exit ${result.code})`,
                );
            const stdout = result.stdout.trimEnd();
            return {
                content: [
                    {
                        type: "text" as const,
                        text: clip(stdout || `zvec index finished for ${root}`),
                    },
                ],
                details: {
                    indexSummary: parseIndexOutput(stdout),
                    durationMs: Date.now() - started,
                },
            };
        },
        renderCall(args, _options, theme) {
            const a = args as IndexToolInput;
            const mode = a.mode ?? "index";
            let line = `${theme.fg("toolTitle", theme.bold("zvec_index"))} ${theme.fg("toolOutput", short(a.root || "(missing root)"))}`;
            if (mode !== "index")
                line += ` ${theme.fg(mode === "drop" ? "error" : "warning", mode)}`;
            return component(line);
        },
        renderResult(result, options: ToolRenderResultOptions, theme) {
            if (options.isPartial) return component(theme.fg("warning", "indexing…"));
            const raw = resultText(result) || "(zvec_index returned no output)";
            if (result.isError || raw.trimStart().startsWith("Error:"))
                return errorRow(raw, theme, options.expanded);
            const summary = indexSummaryFromDetails(result.details);
            if (options.expanded)
                return component(
                    theme.fg("toolOutput", summary ? styledIndexOutput(raw, theme) : raw),
                );
            if (!summary) return previewRow(raw, theme);
            const changed = summary.added + summary.modified + summary.deleted;
            let line = theme.fg(
                "success",
                `✓ index updated · ${summary.scanned} files · ${summary.entities ?? "–"} entities · ${summary.duration ?? "–"}`,
            );
            line += theme.fg("muted", expandHint());
            if (changed > 0)
                line += `\n${theme.fg("dim", `   ${[summary.added && `${summary.added} added`, summary.modified && `${summary.modified} modified`, summary.deleted && `${summary.deleted} deleted`].filter(Boolean).join(" · ")}`)}`;
            const duration = (result.details as { durationMs?: number } | undefined)?.durationMs;
            if (duration !== undefined) line += theme.fg("dim", ` · ${duration}ms`);
            return component(line);
        },
    });

    pi.registerTool({
        name: "zvec_status",
        label: "Zvec Status",
        approval: "read",
        parameters: statusParams,
        description:
            "Show zvec-grep index presence, coverage, and freshness. Missing or stale indices are normal status outcomes, not tool failures.",
        async execute(_id, params, signal, _onUpdate, ctx) {
            const root = normalizeRoot(params.root, ctx.cwd);
            const result = await runZg(
                exec,
                ["status"],
                { cwd: root, signal, timeoutMs: ZG_STATUS_TIMEOUT_MS },
                "zvec_status",
            );
            const stdout = result.stdout.trimEnd();
            const stderr = result.stderr.trimEnd();
            const verdict = parseStatusVerdict(stdout || stderr);
            if (
                result.code !== 0 &&
                verdict?.kind !== "missing" &&
                verdict?.kind !== "needs-update"
            ) {
                throw new Error(stderr || stdout || `zvec_status failed (exit ${result.code})`);
            }
            const text = clip(stdout || stderr || "(no output)");
            return {
                content: [{ type: "text" as const, text }],
                details: { verdict },
                isError: false,
            };
        },
        renderCall(args, _options, theme) {
            const root = (args as StatusToolInput).root;
            return component(
                `${theme.fg("toolTitle", theme.bold("zvec_status"))} ${theme.fg("toolOutput", root ? short(root) : "(cwd)")}`,
            );
        },
        renderResult(result, options: ToolRenderResultOptions, theme) {
            if (options.isPartial) return component(theme.fg("muted", "checking…"));
            const raw = resultText(result) || "(zvec_status returned no output)";
            if (result.isError || raw.trimStart().startsWith("Error:"))
                return errorRow(raw, theme, options.expanded);
            const verdict = verdictFromDetails(result.details, raw);
            if (!options.expanded) {
                if (!verdict) return previewRow(raw, theme, 2);
                const color =
                    verdict.kind === "ready"
                        ? "success"
                        : verdict.kind === "needs-update"
                          ? "warning"
                          : "muted";
                return component(
                    theme.fg(color, verdict.line) +
                        (raw.split("\n").length > 4 ? theme.fg("muted", expandHint()) : ""),
                );
            }
            return component(
                raw
                    .split("\n")
                    .map((line) => theme.fg("toolOutput", line))
                    .join("\n"),
            );
        },
    });
}

const ZG_SUBCOMMANDS: Array<{ name: string; description: string }> = [
    { name: "index", description: "build or update the workspace index" },
    { name: "rebuild", description: "recreate the index from scratch (destructive)" },
    { name: "drop", description: "permanently delete the index (destructive)" },
    { name: "status", description: "show index state" },
    { name: "settings", description: "open settings" },
    { name: "help", description: "show usage" },
];
const COMMANDS = new Set(["index", "rebuild", "drop", "status", "settings", "help"]);
const USAGE = [
    "Usage: /zg <index|rebuild|drop|status|settings|help> [path]",
    "  path is the whole remainder and may be quoted when it contains spaces.",
    "  rebuild and drop are destructive and require explicit user intent.",
].join("\n");

function parseCommand(args: string): { command: string; root?: string } {
    const input = args.trim();
    if (!input) return { command: "help" };
    const match = input.match(/^(\S+)(?:\s+([\s\S]*))?$/);
    const command = match?.[1] ?? "";
    const remainder = match?.[2]?.trim();
    if (!remainder) return { command };
    if (remainder.startsWith('"') && remainder.endsWith('"'))
        return { command, root: remainder.slice(1, -1) };
    if (remainder.startsWith("'") && remainder.endsWith("'"))
        return { command, root: remainder.slice(1, -1) };
    return { command, root: remainder };
}
function commandCompletions(prefix: string): AutocompleteItem[] | null {
    const value = (prefix ?? "").trimStart();
    if (value.includes(" ")) return null;
    return ZG_SUBCOMMANDS.filter((item) => item.name.startsWith(value)).map((item) => ({
        value: item.name,
        label: item.name,
        description: item.description,
    }));
}
async function runCommand(
    parsed: { command: string; root?: string },
    ctx: ExtensionCommandContext,
    exec: ZgExec,
): Promise<void> {
    if (parsed.command === "help" || !COMMANDS.has(parsed.command)) {
        ctx.ui.notify(
            parsed.command === "help"
                ? USAGE
                : `Unknown /zg subcommand: ${parsed.command}\n\n${USAGE}`,
            "warning",
        );
        return;
    }
    if (parsed.command === "settings") {
        if (!ctx.hasUI || ctx.mode !== "tui") {
            ctx.ui.notify("/zg settings requires the interactive TUI.", "warning");
            return;
        }
        await openSettings(ctx);
        return;
    }
    const root = normalizeRoot(parsed.root, ctx.cwd);
    if (parsed.command === "drop" || parsed.command === "rebuild")
        ctx.ui.notify(`Explicit destructive operation: ${parsed.command} for ${root}…`, "warning");
    const mode = parsed.command as "index" | "rebuild" | "drop" | "status";
    const commandArgs =
        mode === "status"
            ? ["status"]
            : [
                  "index",
                  root,
                  ...(mode === "rebuild"
                      ? ["--rebuild"]
                      : mode === "drop"
                        ? ["--drop", "--yes"]
                        : []),
              ];
    let result: ExecResult;
    try {
        result = await runZg(
            exec,
            commandArgs,
            {
                cwd: root,
                timeoutMs: mode === "status" ? ZG_STATUS_TIMEOUT_MS : ZG_INDEX_TIMEOUT_MS,
            },
            `zg ${mode}`,
        );
    } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
        return;
    }
    if (result.code !== 0) {
        const verdict = parseStatusVerdict(result.stdout || result.stderr);
        if (
            mode === "status" &&
            (verdict?.kind === "missing" || verdict?.kind === "needs-update")
        ) {
            ctx.ui.notify(result.stdout || result.stderr || verdict.line, "warning");
            return;
        }
        ctx.ui.notify(
            `zg ${mode} failed: ${result.stderr || result.stdout || `exit ${result.code}`}`,
            "error",
        );
        return;
    }
    ctx.ui.notify(
        mode === "status"
            ? result.stdout || result.stderr || "(no output)"
            : mode === "drop"
              ? "zvec index dropped."
              : "zvec index updated.",
        "info",
    );
}

export function registerZvecCommands(pi: ExtensionAPI): void {
    const exec: ZgExec = (command, args, options) => pi.exec(command, args, options);
    pi.registerCommand("zg", {
        description: "zvec-grep: /zg <index|rebuild|drop|status|settings|help> [path]",
        getArgumentCompletions: commandCompletions,
        handler: async (args, ctx) => runCommand(parseCommand(args), ctx, exec),
    });
}
export function registerAutoIndex(pi: ExtensionAPI): void {
    const exec: ZgExec = (command, args, options) => pi.exec(command, args, options);
    const autoIndexer = createAutoIndexer((args, options) =>
        runZg(
            exec,
            args,
            { cwd: options.cwd, signal: options.signal, timeoutMs: options.timeoutMs },
            args[0] === "status" ? "zvec auto-index readiness check" : "zvec auto-index",
        ),
    );
    pi.on("session_shutdown", () => autoIndexer.shutdown());
    pi.on("session_start", (_event, ctx) => {
        const root = normalizeRoot(undefined, ctx.cwd);
        const settings = loadSettings(root);
        autoIndexer.start(root, settings, (message, type) => ctx.ui.notify(message, type));
    });
}
