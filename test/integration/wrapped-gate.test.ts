/**
 * Actual-host wrapped-gate execution and ToolExecutionComponent render smoke.
 *
 * The worker (test/helpers/session-worker.ts) is spawned with explicit env so
 * the fake `zg` and the disposable agent dir are present in Bun's startup env
 * snapshot before the host is imported. Inside, the REAL session
 * (createAgentSession) exposes the approval-gated wrapped tools via
 * session.getToolByName, and the public ToolExecutionComponent renders the
 * extension's real renderCall/renderResult with a real theme. Hermetic: fake
 * zg only, no network/model/credentials, no skip gates.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { createFakeZg, createTempDirectory, type FakeZg } from "../helpers/fake-zg.ts";

const ROOT = createTempDirectory("omp-zvec-grep-wrapped-");
const ws = path.join(ROOT, "ws");
const agentDir = path.join(ROOT, "agent");
const stateDir = path.join(ROOT, "state");
let fake: FakeZg;

const workerPath = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "..",
    "helpers",
    "session-worker.ts",
);

beforeAll(() => {
    fs.mkdirSync(ws, { recursive: true });
    fs.mkdirSync(agentDir, { recursive: true });
    fs.mkdirSync(stateDir, { recursive: true });
    fake = createFakeZg(ROOT);
});

afterAll(() => {
    fs.rmSync(ROOT, { recursive: true, force: true });
});

describe("wrapped session tools and real ToolExecutionComponent rendering", () => {
    test("wrapped zvec tools execute through the session; render callbacks render with a real theme", () => {
        const env: Record<string, string | undefined> = {
            ...process.env,
            PATH: `${fake.binDir}:${process.env.PATH ?? ""}`,
            PI_CODING_AGENT_DIR: agentDir,
            ZVEC_WS: ws,
            ZVEC_AGENT: agentDir,
            ZFAKE_STATE_DIR: stateDir,
        };
        delete env.OMP_PROFILE;
        delete env.PI_PROFILE;
        const result = Bun.spawnSync([process.execPath, workerPath], {
            env,
            cwd: ROOT,
            stdout: "pipe",
            stderr: "pipe",
        });
        expect(result.exitCode, result.stdout.toString() + result.stderr.toString()).toBe(0);
        expect(result.stdout.toString()).toContain("WORKER_OK wrapped");
    }, 60_000);
});
