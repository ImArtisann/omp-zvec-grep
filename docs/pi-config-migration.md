# Migrating user settings from a Pi-era config

`omp-zvec-grep` is a native Oh My Pi extension and a port of the earlier
`pi-zvec-grep` (Pi) extension. Nothing migrates automatically: there is no
importer in the extension, and the port never reads the old Pi config. Moving
your user-level settings is an **explicit, one-time, opt-in step** you run
yourself. This page documents a small copy-only script you save and run once. It
is documentation, not a shipped extension feature.

What you get out of it: your `defaultLimit` and `autoIndex` values, copied into
the native extension's user config. What it never does: write over an existing
destination, copy scope flags, delete the old config, or rebuild or drop any zg
index (not needed — the port uses the same `zg` CLI and the same
`<workspace>/.zvec-grep` index location, so existing indexes keep working).

## What is copied

Only the user-value fields that the native extension understands, validated the
same way the extension validates them:

- `defaultLimit` — a number 1–50 (rounded); anything else is skipped.
- `autoIndex` — a boolean; anything else is skipped.

Scope keys (`projectScope`, `settingsScope`) are **never** copied; no other keys
are copied. If the source has no valid fields, the script exits without writing
anything.

## Prerequisites

- A checkout of `omp-zvec-grep` with dependencies installed
  (`bun install --frozen-lockfile`) so the public `@oh-my-pi/pi-utils`
  `getAgentDir()` resolves under the project's Bun (tested on Bun 1.4.2).
  Imports resolve relative to the script file, so keep the script inside the
  checkout (the root is convenient) — a copy in `/tmp` or another arbitrary path
  would resolve `@oh-my-pi/pi-utils` from a different package graph.
- The old Pi-era config file you want to copy from. You must identify it
  yourself — it is the `pi-zvec-grep/config.json` user config under the Pi agent
  directory you used (its exact location depends on that old installation and is
  not guessed here).

## The transfer script

Save the following as `migrate-old-pi-config.mjs` **at the checkout root** (do
not commit it), so the `@oh-my-pi/pi-utils` import resolves against the
checkout's `node_modules`, then run it with the project's Bun:

```js
#!/usr/bin/env bun
// One-time, explicit, copy-only transfer of USER-level settings (defaultLimit,
// autoIndex) from an old Pi-era pi-zvec-grep config.json into this native OMP
// extension's user config. Scope flags are never copied, the source is never
// modified, and no zg index is touched.
// Usage: bun migrate-old-pi-config.mjs <old-config.json> [<agent-dir>] [--yes]
import * as fs from "node:fs";
import * as path from "node:path";
import { getAgentDir } from "@oh-my-pi/pi-utils";

const positional = process.argv.slice(2).filter((arg) => arg !== "--yes");
const [sourceArg, destDirArg] = positional;
const write = process.argv.includes("--yes");
if (!sourceArg) {
    console.error(
        "usage: migrate-old-pi-config.mjs <old-config.json> [<agent-dir>] [--yes]",
    );
    process.exit(2);
}
const source = path.resolve(sourceArg);
const destDir = path.resolve(destDirArg ?? getAgentDir());
const destination = path.join(destDir, "omp-zvec-grep", "config.json");
console.log(`resolved agent dir: ${destDir}`);
console.log(
    `env: PI_CODING_AGENT_DIR=${process.env.PI_CODING_AGENT_DIR ?? "(unset)"} ` +
        `OMP_PROFILE=${process.env.OMP_PROFILE ?? "(unset)"} ` +
        `PI_PROFILE=${process.env.PI_PROFILE ?? "(unset)"}`,
);

let raw;
try {
    raw = JSON.parse(fs.readFileSync(source, "utf8"));
} catch {
    console.error(`source not readable as JSON: ${source}`);
    process.exit(1);
}
const values = {};
if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    const limit = raw.defaultLimit;
    if (
        typeof limit === "number" &&
        Number.isFinite(limit) &&
        limit >= 1 &&
        limit <= 50
    )
        values.defaultLimit = Math.round(limit);
    const auto = raw.autoIndex;
    if (typeof auto === "boolean") values.autoIndex = auto;
}
console.log(`source: ${source}`);
console.log(
    `fields to copy: ${Object.keys(values).length === 0 ? "(none)" : JSON.stringify(values)}`,
);
if (Object.keys(values).length === 0) {
    console.error(
        "no valid user-value fields found; nothing to copy (exiting without writing).",
    );
    process.exit(1);
}
if (!write) {
    console.log(`dry run: would create ${destination} (re-run with --yes).`);
    process.exit(0);
}
try {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, JSON.stringify(values, null, 2) + "\n", {
        flag: "wx",
    });
    console.log(`wrote ${destination}`);
} catch {
    console.error(
        `refusing to write: destination already exists (${destination}).`,
    );
    console.error(
        "Re-enter the values via /zg settings instead; the source is untouched.",
    );
    process.exit(1);
}
```

## Transfer steps

Run the script from the checkout root. It defaults to a **dry run** and prints
the resolved destination and its environment inputs before any write:

```sh
bun migrate-old-pi-config.mjs /path/to/old/pi-zvec-grep/config.json
```

Verify the printed `resolved agent dir`. The destination is
`<agent dir>/omp-zvec-grep/config.json`, where the agent dir comes from the
public `getAgentDir()` — it honors `PI_CODING_AGENT_DIR`, `OMP_PROFILE`, and
`PI_PROFILE`, i.e. the same profile environment the extension runs under. If the
extension lives under a named profile whose environment is not present in this
shell, pass that profile's agent directory as the second positional argument
(never a guessed `~/.omp` path):

```sh
bun migrate-old-pi-config.mjs \
  /path/to/old/pi-zvec-grep/config.json \
  /path/to/that/profile/agent/dir
```

When the printed plan is right, write it:

```sh
bun migrate-old-pi-config.mjs /path/to/old/pi-zvec-grep/config.json --yes
```

The destination file is created **exclusively** (the `wx` flag): creation fails
if anything already exists at the path, including a dangling symlink — the
destination must not exist, and you should never delete an existing file to make
room. The old config and any zg indexes are never modified. After the transfer,
delete the saved script and verify the values via `/zg settings` (they show
immediately).

## Manual alternative

You do not need the script: open `/zg settings` inside omp and re-enter the two
values (`defaultLimit`, `autoIndex`). The menu creates the user config file when
it is missing and updates it normally when it exists (unrelated keys in an
existing user file are preserved on save; scope flags there are ignored and
stripped on the next user-layer save).

## Guarantees

- Copy only: source config is opened read-only, never rewritten or deleted.
- Destination must not exist — created exclusively with the `wx` flag (fails on
  any existing path, including a dangling symlink); no overwrite, no clobber, no
  merge.
- Only `defaultLimit`/`autoIndex` are written; scope flags are ignored.
- No index operations: existing `.zvec-grep` indexes are neither rebuilt nor
  dropped by the extension or by this transfer.
- Dry run by default; the resolved destination is always printed first.
