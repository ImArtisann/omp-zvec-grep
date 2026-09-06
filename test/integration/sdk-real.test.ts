/**
 * Actual-host SDK harness: the package extension is loaded through the REAL
 * public `createAgentSession` path (real actions, real runner, real settings)
 * with no model, no prompt, no credentials, no network, and no fake host
 * surfaces.
 *
 * Assertions stay on public observables: the loader contract returned by
 * createAgentSession (extensionsResult) and session tool registration /
 * activation. Disposal runs in afterAll and a failure there fails the file.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
    createAgentSession,
    discoverAuthStorage,
    ModelRegistry,
    SessionManager,
    Settings,
} from "@oh-my-pi/pi-coding-agent";
import type { AgentSession, LoadExtensionsResult } from "@oh-my-pi/pi-coding-agent";

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "omp-zvec-grep-sdk-"));
const ws = path.join(ROOT, "ws");
const agentDir = path.join(ROOT, "agent");
let session: AgentSession;
let extensionsResult: LoadExtensionsResult;

const packageIndex = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "..",
    "..",
    "index.ts",
);

beforeAll(async () => {
    fs.mkdirSync(ws, { recursive: true });
    fs.mkdirSync(agentDir, { recursive: true });
    const settings = await Settings.init({ cwd: ws, agentDir });
    const authStorage = await discoverAuthStorage(agentDir);
    const modelRegistry = new ModelRegistry(authStorage, path.join(agentDir, "models.yml"));
    const result = await createAgentSession({
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
    session = result.session;
    extensionsResult = result.extensionsResult;
});

afterAll(async () => {
    // A disposal failure must fail the file, not be swallowed into an assertion.
    await session?.dispose();
    fs.rmSync(ROOT, { recursive: true, force: true });
});

describe("real createAgentSession loads the zvec extension", () => {
    test("loader contract: the package extension carries exactly the three zvec tools and /zg", () => {
        expect(extensionsResult.errors).toEqual([]);
        // The host may add its own inline extensions (e.g. autoresearch,
        // linear); the package under test is the path-backed extension.
        const zvecExtension = extensionsResult.extensions.find((e) => e.tools.has("zvec_search"));
        expect(zvecExtension).toBeDefined();
        expect([...zvecExtension!.tools.keys()].sort()).toEqual([
            "zvec_index",
            "zvec_search",
            "zvec_status",
        ]);
        expect([...zvecExtension!.commands.keys()]).toEqual(["zg"]);
        expect(zvecExtension!.handlers.get("session_start")?.length).toBe(1);
    });

    test("requested zvec tools are registered and active through the session", () => {
        for (const name of ["zvec_search", "zvec_index", "zvec_status"]) {
            expect(session.getAllToolNames()).toContain(name);
            expect(session.getActiveToolNames()).toContain(name);
        }
    });
});
