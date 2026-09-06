/**
 * Deterministic fake `zg` on disk for hermetic omp-zvec-grep tests.
 *
 * Node-only helper (no host imports): writes an executable `zg` into a temp
 * bin dir. Each invocation records `{ cwd, args }` under
 * `$ZFAKE_STATE_DIR/<cmd>.json`. Behavior is driven by `ZFAKE_MODE`:
 *   - default: `query` succeeds; `status` fails (no index)
 *   - "missing-index": `query` fails like a no-index workspace; `status` fails
 *   - "ready": `status` succeeds
 *   - "stale-slow": `status` fails and `index` sleeps `ZFAKE_INDEX_SLEEP` seconds
 *   - "fail-index": `index` exits 1 after recording
 *
 * The fake must be reachable from the ENV SNAPSHOT of the process that runs
 * the code under test (Bun children inherit the env the process started with,
 * not later process.env mutations) — tests spawn an isolated worker with an
 * explicit PATH instead of mutating their own env.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface FakeZg {
    binDir: string;
    stateDir: string;
    readState: (name: string) => { cwd: string; args: string[] } | undefined;
    resetState: () => void;
    clean: () => void;
}

const SCRIPT = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const stateDir = process.env.ZFAKE_STATE_DIR;
const [cmd, ...rest] = process.argv.slice(2);
const record = (name) => {
  if (!stateDir) return;
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, name + '.json'), JSON.stringify({ cwd: process.cwd(), args: rest }));
};
if (cmd === 'query') {
  if (process.env.ZFAKE_MODE === 'missing-index') {
    process.stderr.write('Error: No zvec-grep index found for this workspace\\nCode: ZVEC_GREP.ENGINE.SERVICE.WORKSPACE_INDEX_NOT_FOUND\\n');
    process.exit(1);
  }
  record('query');
  console.log('FAKE-QUERY args: ' + rest.join(' '));
} else if (cmd === 'index') {
  if (process.env.ZFAKE_MODE === 'stale-slow') {
    const ms = Number(process.env.ZFAKE_INDEX_SLEEP || 0) * 1000;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  }
  record('index');
  if (process.env.ZFAKE_MODE === 'fail-index') {
    process.stderr.write('FAKE-INDEX exploded\\n');
    process.exit(1);
  }
  console.log('FAKE-INDEX args: ' + rest.join(' ') + ' cwd=' + process.cwd());
} else if (cmd === 'status') {
  record('status');
  if (process.env.ZFAKE_MODE !== 'ready') {
    console.log('No zvec-grep index found for workspace ' + process.cwd());
    process.exit(1);
  }
  console.log('Workspace index is ready');
} else {
  process.stderr.write('FAKE-ZG unknown command: ' + cmd + '\\n');
  process.exit(2);
}
`;

export function createFakeZg(root: string): FakeZg {
    const binDir = path.join(root, "bin");
    const stateDir = path.join(root, "state");
    fs.mkdirSync(binDir, { recursive: true });
    const zgPath = path.join(binDir, "zg");
    fs.writeFileSync(zgPath, SCRIPT, { mode: 0o755 });
    return {
        binDir,
        stateDir,
        readState: (name) => {
            const file = path.join(stateDir, `${name}.json`);
            if (!fs.existsSync(file)) return undefined;
            return JSON.parse(fs.readFileSync(file, "utf8"));
        },
        resetState: () => {
            if (!fs.existsSync(stateDir)) return;
            for (const f of fs.readdirSync(stateDir)) {
                if (f.endsWith(".json")) fs.rmSync(path.join(stateDir, f));
            }
        },
        clean: () => fs.rmSync(binDir, { recursive: true, force: true }),
    };
}

export function createTempDirectory(prefix = "omp-zvec-grep-test-"): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
