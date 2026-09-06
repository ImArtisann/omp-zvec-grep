import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

describe("scoped config persistence", () => {
    test("project scope is isolated from user defaults in a fresh child process", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-zvec-config-test-"));
        const agent = path.join(root, "agent");
        const worker = path.resolve(
            path.dirname(new URL(import.meta.url).pathname),
            "config-worker.ts",
        );
        const result = Bun.spawnSync([process.execPath, worker], {
            cwd: root,
            env: {
                ...process.env,
                PI_CODING_AGENT_DIR: agent,
                HOME: path.join(root, "home"),
                OMP_PROFILE: "",
                PI_PROFILE: "",
            },
            stdout: "pipe",
            stderr: "pipe",
        });
        try {
            expect(result.exitCode, result.stdout.toString() + result.stderr.toString()).toBe(0);
            expect(result.stdout.toString()).toContain(
                "config profile/scoped safety parity passed",
            );
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
