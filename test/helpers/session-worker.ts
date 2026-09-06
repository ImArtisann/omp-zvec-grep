/**
 * Wrapped-gate execution + ToolExecutionComponent render smoke, run in an
 * isolated Bun worker with explicit env (fake zg on PATH, temp
 * PI_CODING_AGENT_DIR, profiles unset) so Bun's startup env snapshot is
 * correct before the host is imported.
 *
 * Real path exercised:
 *   createAgentSession -> session.getToolByName('zvec_search') (the WRAPPED,
 *   approval-gated registry tool) -> AgentTool.execute() against the fake zg;
 *   then the public ToolExecutionComponent drives the extension's real
 *   renderCall/renderResult callbacks with a real theme.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import {
    createAgentSession,
    discoverAuthStorage,
    getThemeByName,
    ModelRegistry,
    SessionManager,
    Settings,
    setThemeInstance,
    ToolExecutionComponent,
} from "@oh-my-pi/pi-coding-agent";
import type { ToolExecutionUi } from "@oh-my-pi/pi-coding-agent";

const ws = process.env.ZVEC_WS!;
const agentDir = process.env.ZVEC_AGENT!;
const stateDir = process.env.ZFAKE_STATE_DIR!;

if (!ws || !agentDir || !stateDir) {
    console.error("session-worker: ZVEC_WS, ZVEC_AGENT, and ZFAKE_STATE_DIR are required");
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
const readState = (name: string): { cwd: string; args: string[] } | undefined =>
    fs.existsSync(stateFile(name))
        ? JSON.parse(fs.readFileSync(stateFile(name), "utf8"))
        : undefined;
const realLocation = (p: string | undefined): string | undefined => {
    if (p == null) return undefined;
    try {
        return fs.realpathSync(p);
    } catch {
        return undefined;
    }
};

const proj = path.join(ws, "proj");
fs.mkdirSync(proj, { recursive: true });
fs.mkdirSync(agentDir, { recursive: true });

const packageIndex = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "..",
    "..",
    "index.ts",
);

const settings = await Settings.init({ cwd: ws, agentDir });
const authStorage = await discoverAuthStorage(agentDir);
const modelRegistry = new ModelRegistry(authStorage, path.join(agentDir, "models.yml"));
const created = await createAgentSession({
    cwd: ws,
    agentDir,
    settings,
    authStorage,
    modelRegistry,
    sessionManager: SessionManager.inMemory(ws),
    disableExtensionDiscovery: true,
    additionalExtensionPaths: [packageIndex],
    toolNames: ["zvec_search", "zvec_index", "zvec_status"],
    enableMCP: false,
    enableLsp: false,
    hasUI: false,
});
if (created.extensionsResult.errors.length > 0) {
    console.error(
        `extension load errors: ${created.extensionsResult.errors.map((e) => e.error).join("; ")}`,
    );
    process.exit(2);
}
const session = created.session;

const theme = await getThemeByName("dark");
if (!theme) {
    console.error("session-worker: no dark theme available");
    process.exit(2);
}
setThemeInstance(theme);

function textContent(result: { content?: ReadonlyArray<unknown> }): string {
    const piece = result.content?.[0];
    if (piece !== null && typeof piece === "object") {
        const candidate = piece as { type?: unknown; text?: unknown };
        if (candidate.type === "text" && typeof candidate.text === "string") return candidate.text;
    }
    return "";
}

// --- Wrapped-gate execution through the real session registry --------------
const wrappedSearch = session.getToolByName("zvec_search");
check(wrappedSearch !== undefined, "session exposes the wrapped zvec_search tool");
const searchResult = await wrappedSearch!.execute(
    "wrapped-search",
    { query: "wrapped gate query" },
    undefined,
    undefined,
    undefined,
);
check(
    textContent(searchResult).includes("FAKE-QUERY"),
    "wrapped zvec_search executes through the session tool",
);
const qState = readState("query");
check(qState?.args[0] === "wrapped gate query", "wrapped search forwarded the positional query");
check(realLocation(qState?.cwd) === realLocation(ws), "wrapped search ran with the session cwd");

const wrappedIndex = session.getToolByName("zvec_index");
check(wrappedIndex !== undefined, "session exposes the wrapped zvec_index tool");
const updates: string[] = [];
await wrappedIndex!.execute(
    "wrapped-index",
    { root: "proj", mode: "rebuild" },
    undefined,
    (update) => {
        const piece = (update as { content?: ReadonlyArray<unknown> }).content?.[0];
        if (piece !== null && typeof piece === "object" && "text" in piece)
            updates.push(String((piece as { text?: unknown }).text ?? ""));
    },
    undefined,
);
const iState = readState("index");
check(iState?.args.includes("--rebuild") === true, "wrapped zvec_index ran with rebuild");
check(
    updates.length > 0 && updates.some((text) => text.includes("rebuilding")),
    "wrapped zvec_index streams an initial update",
);

// --- ToolExecutionComponent renders the real renderCall/renderResult -------
const ui: ToolExecutionUi = {
    requestRender: () => {},
    requestComponentRender: () => {},
    resetDisplay: () => {},
};
const block = new ToolExecutionComponent(
    "zvec_search",
    { query: "wrapped gate query", root: "proj" },
    {},
    wrappedSearch,
    ui,
    ws,
    "wrapped-search",
);
const callLines = block.render(120).join("\n");
check(callLines.includes("zvec_search"), "call block shows the tool name");
check(
    callLines.includes('"wrapped gate query"'),
    "call block shows the query from the real renderCall",
);
const firstRender = block.render(120).join("\n");
check(
    firstRender === callLines,
    "repeated renders are deterministic (timer-free for completed calls)",
);

block.setArgsComplete("wrapped-search");
const finished = await wrappedSearch!.execute(
    "wrapped-search-2",
    { query: "result render" },
    undefined,
    undefined,
    undefined,
);
const resultText = textContent(finished);
(block as { updateResult(result: unknown): void }).updateResult({
    content: [{ type: "text", text: resultText }],
    details: (finished as { details?: unknown }).details,
    isError: false,
});
const resultLines = block.render(120).join("\n");
check(resultLines.length > 0, "result block renders");
check(!resultLines.includes("searching"), "result block is not stuck on the partial state");

await session.dispose();
console.log(`WORKER_OK wrapped checks=${checks}`);
process.exit(0);
