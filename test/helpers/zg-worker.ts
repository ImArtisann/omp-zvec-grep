/**
 * Hermetic execute/command assertions run in an ISOLATED Bun worker.
 *
 * This script is spawned by the parent test with an explicit env (fake zg on
 * PATH, `PI_CODING_AGENT_DIR` pointed at a temp agent dir, OMP_PROFILE and
 * PI_PROFILE unset). Because the worker process STARTS with that env, Bun's
 * startup env snapshot — which child processes spawned by the host inherit —
 * already contains the fake zg and the isolated agent dir. Runtime
 * process.env mutations inside the worker are never needed.
 *
 * The worker loads the package extension through the real host loader and
 * runner, drives the real registered tool/command surfaces, and exits 0 only
 * when every check passes. One scenario runs per `ZFAKE_MODE` value:
 *   - (unset): query/index/status happy paths + /zg dispatch
 *   - missing-index: query error diagnostics; status stays a normal outcome
 *   - ready: status success
 *   - stale-slow: index cancellation via AbortSignal
 *   - missing-executable: the real pi.exec ENOENT path is classified
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { discoverAuthStorage, ModelRegistry, SessionManager } from "@oh-my-pi/pi-coding-agent";
import {
    ExtensionRunner,
    loadExtensions,
} from "@oh-my-pi/pi-coding-agent/extensibility/extensions";

const ws = process.env.ZVEC_WS!;
const agentDir = process.env.ZVEC_AGENT!;
const stateDir = process.env.ZFAKE_STATE_DIR!;
const mode = process.env.ZFAKE_MODE ?? "";

if (!ws || !agentDir || !stateDir) {
    console.error("zg-worker: ZVEC_WS, ZVEC_AGENT, and ZFAKE_STATE_DIR are required");
    process.exit(2);
}

let checks = 0;
function check(condition: boolean, label: string): void {
    checks += 1;
    if (!condition) {
        console.error(`FAIL ${label}`);
        process.exit(1);
    }
    console.log(`PASS ${label}`);
}

const stateFile = (name: string): string => path.join(stateDir, `${name}.json`);
function readState(name: string): { cwd: string; args: string[] } | undefined {
    return fs.existsSync(stateFile(name))
        ? JSON.parse(fs.readFileSync(stateFile(name), "utf8"))
        : undefined;
}
function resetState(): void {
    for (const name of ["query", "index", "status"]) {
        if (fs.existsSync(stateFile(name))) fs.rmSync(stateFile(name));
    }
}
function realLocation(p: string | undefined): string | undefined {
    if (p == null) return undefined;
    try {
        return fs.realpathSync(p);
    } catch {
        return undefined;
    }
}

const sub = path.join(ws, "sub");
const proj = path.join(ws, "proj");
fs.mkdirSync(sub, { recursive: true });
fs.mkdirSync(proj, { recursive: true });
fs.mkdirSync(agentDir, { recursive: true });

const packageIndex = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "..",
    "..",
    "index.ts",
);

const loaded = await loadExtensions([packageIndex], ws);
if (loaded.errors.length > 0) {
    console.error(
        `extension load errors: ${loaded.errors.map((e) => `${e.path}: ${e.error}`).join("; ")}`,
    );
    process.exit(2);
}
const extension = loaded.extensions[0]!;

const sessionManager = SessionManager.inMemory(ws);
const authStorage = await discoverAuthStorage(agentDir);
const modelRegistry = new ModelRegistry(authStorage, path.join(agentDir, "models.yml"));
const runner = new ExtensionRunner(
    loaded.extensions,
    loaded.runtime,
    ws,
    sessionManager,
    modelRegistry,
);
const ctx = runner.createContext();
const commandCtx = runner.createCommandContext();

const tool = (name: string) => {
    const registered = extension.tools.get(name);
    if (!registered) {
        console.error(`tool not registered: ${name}`);
        process.exit(2);
    }
    return registered.definition;
};

async function main(): Promise<void> {
    if (mode === "missing-index") {
        await expectSearchDiagnostics();
        await expectStatusNormal();
    } else if (mode === "ready") {
        await expectStatusReady();
    } else if (mode === "stale-slow") {
        await expectIndexCancellation();
    } else if (mode === "missing-executable") {
        await expectMissingExecutable();
    } else {
        await expectDefaultScenario();
    }
    console.log(`WORKER_OK mode=${mode || "default"} checks=${checks}`);
    process.exit(0);
}

async function expectSearchDiagnostics(): Promise<void> {
    try {
        await tool("zvec_search").execute("w-1", { query: "x" }, undefined, undefined, ctx);
        check(false, "search without index throws");
    } catch (error) {
        check(
            String(error).includes("WORKSPACE_INDEX_NOT_FOUND"),
            "search error carries zg diagnostics",
        );
    }
}

async function expectStatusNormal(): Promise<void> {
    const result = await tool("zvec_status").execute(
        "w-2",
        { root: "proj" },
        undefined,
        undefined,
        ctx,
    );
    const text = textContent(result);
    check(text.includes("No zvec-grep index"), "status without index returns text, no throw");
    check(result.isError !== true, "status missing index is not an error result");
}

async function expectStatusReady(): Promise<void> {
    const configDir = path.join(ws, ".zvec-grep");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
        path.join(configDir, "config.json"),
        JSON.stringify({ projectScope: true, autoIndex: true }),
    );
    const result = await tool("zvec_status").execute(
        "w-3",
        { root: "proj" },
        undefined,
        undefined,
        ctx,
    );
    check(textContent(result).includes("Workspace index is ready"), "status reports ready");
    resetState();
    const handlers = extension.handlers.get("session_start") ?? [];
    await Promise.all(handlers.map((handler) => handler({ type: "session_start" }, ctx)));
    await Bun.sleep(100);
    check(readState("status") !== undefined, "auto-index ready check runs");
    check(readState("index") === undefined, "auto-index does not build ready index");
    resetState();
    await extension.commands.get("zg")!.handler("status proj", commandCtx);
    const state = readState("status");
    check(state !== undefined, "/zg status runs zg");
    check(realLocation(state?.cwd) === realLocation(proj), "/zg status pins cwd to the path");
}

async function expectMissingExecutable(): Promise<void> {
    try {
        await tool("zvec_status").execute("w-missing-executable", {}, undefined, undefined, ctx);
        check(false, "status without zg rejects");
    } catch (error) {
        check(
            String(error).includes("zvec_status unavailable: zg CLI was not found"),
            "missing zg executable is classified distinctly",
        );
    }
}

async function expectIndexCancellation(): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 150);
    try {
        await tool("zvec_index").execute(
            "w-4",
            { root: "proj" },
            controller.signal,
            undefined,
            ctx,
        );
        check(false, "index with abort signal rejects");
    } catch (error) {
        check(String(error).includes("cancelled"), "index abort surfaces as cancelled");
    } finally {
        clearTimeout(timer);
    }
    check(readState("index") === undefined, "cancelled index never records completion");
}

async function expectDefaultScenario(): Promise<void> {
    // Project-scoped empty settings: built-in defaults (defaultLimit 7),
    // deterministic regardless of any machine-level user config.
    const projectConfigDir = path.join(ws, ".zvec-grep");
    fs.mkdirSync(projectConfigDir, { recursive: true });
    fs.writeFileSync(
        path.join(projectConfigDir, "config.json"),
        JSON.stringify({ projectScope: true, autoIndex: true }),
    );
    resetState();
    const search = tool("zvec_search");
    const result = await search.execute(
        "w-5",
        {
            query: "where is auth validated",
            fts: ["AuthService"],
            fileTypes: ["ts"],
            globs: ["!src/generated/**"],
            fuse: true,
            limit: 3,
            root: "sub",
        },
        undefined,
        undefined,
        ctx,
    );
    check(textContent(result).includes("FAKE-QUERY"), "search executes zg query");
    const q = readState("query")!;
    check(q.args[0] === "where is auth validated", "positional query is first arg");
    check(q.args[q.args.indexOf("--fts") + 1] === "AuthService", "fts flag + value");
    check(q.args.includes("--fuse"), "fuse flag");
    check(q.args[q.args.indexOf("--limit") + 1] === "3", "limit flag");
    check(q.args[q.args.indexOf("-t") + 1] === "ts", "type filter");
    check(q.args[q.args.indexOf("-g") + 1] === "!src/generated/**", "glob filter");
    check(realLocation(q.cwd) === realLocation(sub), "search cwd resolved relative to ctx.cwd");

    resetState();
    await search.execute("w-6", { queries: ["auth flow"] }, undefined, undefined, ctx);
    const q2 = readState("query")!;
    check(q2.args[q2.args.indexOf("--hybrid") + 1] === "auth flow", "queries map to --hybrid");
    check(q2.args[q2.args.indexOf("--limit") + 1] === "7", "default limit 7 from project settings");
    check(realLocation(q2.cwd) === realLocation(ws), "search cwd falls back to ctx.cwd");

    resetState();
    const index = tool("zvec_index");
    await index.execute(
        "w-7",
        {
            root: "proj",
            mode: "rebuild",
            embedding: "local/potion-code-16m-v2",
            globs: ["src/**", "!node_modules/**"],
            fileTypes: ["py"],
            excludedFileTypes: ["svg"],
            hidden: true,
        },
        undefined,
        undefined,
        ctx,
    );
    const iState = readState("index")!;
    check(iState.args[0] === proj, "index root resolved to absolute path");
    check(iState.args.includes("--rebuild"), "rebuild flag");
    check(
        iState.args[iState.args.indexOf("--embedding") + 1] === "local/potion-code-16m-v2",
        "embedding flag",
    );
    check(iState.args.filter((a) => a === "-g").length === 2, "two glob filters");
    check(iState.args[iState.args.indexOf("-t") + 1] === "py", "index type filter");
    check(iState.args[iState.args.indexOf("-T") + 1] === "svg", "index excluded type");
    check(iState.args.includes("--hidden"), "hidden flag");
    check(realLocation(iState.cwd) === realLocation(proj), "index cwd is the workspace root");

    resetState();
    await index.execute("w-8", { root: "proj", mode: "drop" }, undefined, undefined, ctx);
    const dState = readState("index")!;
    check(
        dState.args.includes("--drop") && dState.args.includes("--yes"),
        "drop uses --drop --yes",
    );

    resetState();
    const statusResult = await tool("zvec_status").execute(
        "w-9",
        { root: "proj" },
        undefined,
        undefined,
        ctx,
    );
    check(
        textContent(statusResult).includes("No zvec-grep index"),
        "status missing index returns text",
    );

    // /zg dispatch: subcommand + path routed to the right zg argv with cwd pinned.
    const zg = extension.commands.get("zg")!;
    resetState();
    await zg.handler("index proj", commandCtx);
    let cmdState = readState("index");
    check(cmdState?.args[0] === proj, "/zg index targets the named workspace");
    check(
        !(cmdState?.args.includes("--rebuild") ?? false) &&
            !(cmdState?.args.includes("--drop") ?? false),
        "/zg index is a plain update",
    );
    check(realLocation(cmdState?.cwd) === realLocation(proj), "/zg index pins cwd to the path");

    resetState();
    await zg.handler("rebuild proj", commandCtx);
    check(readState("index")?.args.includes("--rebuild") ?? false, "/zg rebuild passes --rebuild");
    const spaced = path.join(ws, "space proj");
    fs.mkdirSync(spaced, { recursive: true });
    resetState();
    await zg.handler('status "space proj"', commandCtx);
    check(
        realLocation(readState("status")?.cwd) === realLocation(spaced),
        "/zg accepts quoted paths with spaces",
    );
    resetState();
    await zg.handler("status space proj", commandCtx);
    check(
        realLocation(readState("status")?.cwd) === realLocation(spaced),
        "/zg treats the whole remainder as a path",
    );
    resetState();
    await zg.handler("drop proj", commandCtx);
    cmdState = readState("index");
    check(
        (cmdState?.args.includes("--drop") ?? false) && (cmdState?.args.includes("--yes") ?? false),
        "/zg drop uses --drop --yes",
    );

    resetState();
    await zg.handler("status proj", commandCtx);
    check(readState("status") !== undefined, "/zg status runs zg");

    resetState();
    await zg.handler("", commandCtx);
    await zg.handler("help", commandCtx);
    await zg.handler("frobnicate", commandCtx);
    await zg.handler("settings", commandCtx);
    check(
        readState("query") === undefined &&
            readState("index") === undefined &&
            readState("status") === undefined,
        "bare/help/unknown/settings never run zg",
    );
    resetState();
    const lifecycleHandlers = extension.handlers.get("session_start") ?? [];
    await Promise.all(lifecycleHandlers.map((handler) => handler({ type: "session_start" }, ctx)));
    for (
        let attempt = 0;
        attempt < 20 && (!readState("status") || !readState("index"));
        attempt += 1
    )
        await Bun.sleep(25);
    check(readState("status") !== undefined, "auto-index readiness check runs");
    check(readState("index") !== undefined, "auto-index builds missing index");
}

function textContent(result: { content?: ReadonlyArray<unknown> }): string {
    const piece = result.content?.[0];
    if (piece !== null && typeof piece === "object") {
        const candidate = piece as { type?: unknown; text?: unknown };
        if (candidate.type === "text" && typeof candidate.text === "string") return candidate.text;
    }
    return "";
}

await main();
