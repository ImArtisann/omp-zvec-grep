import { afterAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-zvec-lifecycle-"));
const worker = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "..",
    "helpers",
    "lifecycle-worker.ts",
);
function run(mode: string): string {
    const caseRoot = path.join(root, mode);
    const agent = path.join(caseRoot, "agent");
    fs.mkdirSync(path.join(caseRoot, "bin"), { recursive: true });
    fs.mkdirSync(agent, { recursive: true });
    const result = Bun.spawnSync([process.execPath, worker], {
        cwd: caseRoot,
        env: {
            ...process.env,
            PATH: `${path.join(caseRoot, "bin")}${path.delimiter}${process.env.PATH ?? ""}`,
            LIFECYCLE_MODE: mode,
            LIFECYCLE_ROOT: caseRoot,
            LIFECYCLE_AGENT: agent,
            LIFECYCLE_STATE: path.join(caseRoot, "state.log"),
            PI_CODING_AGENT_DIR: agent,
            HOME: path.join(caseRoot, "home"),
            OMP_PROFILE: "",
            PI_PROFILE: "",
        },
        stdout: "pipe",
        stderr: "pipe",
    });
    expect(result.exitCode, result.stdout.toString() + result.stderr.toString()).toBe(0);
    return result.stdout.toString();
}
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("auto-index lifecycle behavior", () => {
    test("off, ready, missing, and stale states route correctly", () => {
        expect(run("off")).not.toContain("index:start");
        expect(run("ready")).not.toContain("index:start");
        expect(run("missing")).toContain("index:start");
        expect(run("stale")).toContain("index:start");
    });
    test("deduplicates overlapping starts and releases after failure", () => {
        const dedup = run("dedup");
        expect(dedup.split("index:start").length - 1).toBe(1);
        const failure = run("failure");
        expect(failure).toContain("index:start");
    });
    test("does not build operational errors and aborts on shutdown", () => {
        const shutdown = run("shutdown");
        expect(shutdown).toContain("index:start");
        expect(shutdown).not.toContain("index:done");
    });
});
