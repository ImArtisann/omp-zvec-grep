import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = mkdtempSync(join(tmpdir(), "omp-zvec-grep-cli-"));
const run = (args: string[]): { status: number | null; stdout: string; stderr: string } =>
    spawnSync("zg", args, { cwd: root, encoding: "utf8" }) as {
        status: number | null;
        stdout: string;
        stderr: string;
    };
const requirePass = (condition: boolean, message: string): void => {
    if (!condition) throw new globalThis.Error(message);
};
try {
    const version = run(["--version"]);
    requirePass(
        version.status === 0 && /\d+\.\d+\.\d+/.test(version.stdout),
        `zg version failed: ${version.stderr}`,
    );
    const queryHelp = run(["query", "--help"]);
    for (const flag of [
        "--hybrid",
        "--fts",
        "--vector",
        "--fuse",
        "--limit",
        "-g",
        "-t",
        "-T",
        "--symbol-type",
        "--prefer-symbol",
        "--modified-after",
        "--modified-before",
    ])
        requirePass(queryHelp.stdout.includes(flag), `query help missing ${flag}`);
    const indexHelp = run(["index", "--help"]);
    for (const flag of [
        "--rebuild",
        "--drop",
        "--yes",
        "--embedding",
        "-g",
        "-t",
        "-T",
        "--hidden",
    ])
        requirePass(indexHelp.stdout.includes(flag), `index help missing ${flag}`);
    writeFileSync(join(root, "sample.txt"), "needle target line\n");
    const rg = run(["query", "--rg", "-F", "needle"]);
    requirePass(rg.status === 0 && rg.stdout.includes("needle"), `managed rg failed: ${rg.stderr}`);
    const missing = run(["query", "no such thing"]);
    requirePass(
        missing.status !== 0 &&
            `${missing.stdout}\n${missing.stderr}`.includes("WORKSPACE_INDEX_NOT_FOUND"),
        "missing-index diagnostic changed",
    );
    for (const banned of ["-c", "-l", "--json"])
        requirePass(
            run(["query", "--rg", banned, "needle"]).status !== 0,
            `managed rg accepted ${banned}`,
        );
    console.log(`real zg smoke passed (${version.stdout.trim()})`);
} finally {
    rmSync(root, { recursive: true, force: true });
}
