/**
 * Hermetic execute/command suite for the zvec extension, run against the real
 * host loader/runner in an ISOLATED Bun worker.
 *
 * Why a worker: Bun child processes inherit the env snapshot the process
 * STARTED with, so a fake `zg` on PATH and an isolated agent dir
 * (PI_CODING_AGENT_DIR) must be present at worker startup. The parent spawns
 * the worker (test/helpers/zg-worker.ts) with an explicit env — fake bin dir
 * first on PATH, OMP_PROFILE/PI_PROFILE unset — and asserts clean exit. No
 * real zg, no network, no skip gates: this suite always runs under default
 * `bun test`.
 *
 * Every case gets its own fixture (workspace, agent dir, state dir) so the
 * suite stays order-independent and full-suite-safe.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { createFakeZg, createTempDirectory, type FakeZg } from "../helpers/fake-zg.ts";

const ROOT = createTempDirectory("omp-zvec-grep-fakezg-");
let fake: FakeZg;
let caseIndex = 0;

const workerPath = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "..",
    "helpers",
    "zg-worker.ts",
);

function runWorker(
    mode: string,
    extra: Record<string, string> = {},
): { code: number; stdout: string; stderr: string } {
    const label = mode === "" ? "default" : mode;
    const caseRoot = path.join(ROOT, `case-${caseIndex++}-${label}`);
    const ws = path.join(caseRoot, "ws");
    const agentDir = path.join(caseRoot, "agent");
    const stateDir = path.join(caseRoot, "state");
    fs.mkdirSync(ws, { recursive: true });
    fs.mkdirSync(agentDir, { recursive: true });
    fs.mkdirSync(stateDir, { recursive: true });
    const env: Record<string, string | undefined> = {
        ...process.env,
        PATH: `${fake.binDir}:${process.env.PATH ?? ""}`,
        PI_CODING_AGENT_DIR: agentDir,
        ZVEC_WS: ws,
        ZVEC_AGENT: agentDir,
        ZFAKE_STATE_DIR: stateDir,
        ...extra,
    };
    delete env.OMP_PROFILE;
    delete env.PI_PROFILE;
    if (mode === "") delete env.ZFAKE_MODE;
    else env.ZFAKE_MODE = mode;
    const result = Bun.spawnSync([process.execPath, workerPath], {
        env,
        cwd: caseRoot,
        stdout: "pipe",
        stderr: "pipe",
    });
    return {
        code: result.exitCode ?? 1,
        stdout: result.stdout.toString(),
        stderr: result.stderr.toString(),
    };
}

beforeAll(() => {
    fake = createFakeZg(ROOT);
});

afterAll(() => {
    fs.rmSync(ROOT, { recursive: true, force: true });
});

describe("hermetic zvec execute + /zg dispatch against a deterministic fake zg", () => {
    test("default: query flags/cwd, default limit, index modes, status outcome, /zg dispatch", () => {
        const run = runWorker("");
        expect(run.code, run.stdout + run.stderr).toBe(0);
        expect(run.stdout).toContain("WORKER_OK mode=default");
    });

    test("missing-index: query surfaces zg diagnostics; status stays a normal outcome", () => {
        const run = runWorker("missing-index");
        expect(run.code, run.stdout + run.stderr).toBe(0);
        expect(run.stdout).toContain("WORKER_OK mode=missing-index");
    });

    test("ready: status reports ready through tool and /zg status", () => {
        const run = runWorker("ready");
        expect(run.code, run.stdout + run.stderr).toBe(0);
        expect(run.stdout).toContain("WORKER_OK mode=ready");
    });

    test("stale-slow: an abort signal cancels an in-flight index", () => {
        const run = runWorker("stale-slow", { ZFAKE_INDEX_SLEEP: "60" });
        expect(run.code, run.stdout + run.stderr).toBe(0);
        expect(run.stdout).toContain("WORKER_OK mode=stale-slow");
    });
});
