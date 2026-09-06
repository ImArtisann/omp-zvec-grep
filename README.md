# omp-zvec-grep

Private native [Oh My Pi](https://github.com/can1357/oh-my-pi) extension
exposing local [zvec-grep](https://github.com/zvec-ai/zvec-grep) (`zg`) as
agent-native discovery: hybrid lexical + vector search over an indexed
workspace, with explicit index lifecycle and status surfaces. Native OMP port of
`pi-zvec-grep`; upstream history and attribution are retained (see
[UPSTREAM.md](UPSTREAM.md), [LICENSE](LICENSE), and
[docs/compatibility.md](docs/compatibility.md)).

## Requirements

- Oh My Pi `18.1.11` (pinned peer: `@oh-my-pi/pi-coding-agent`,
  `@oh-my-pi/pi-tui`, `@oh-my-pi/pi-utils`).
- The real `zg` CLI `0.2.1` preinstalled on `PATH` (`zg --version`). It is a
  separate install — the extension never installs it:
  `npm i -g @zvec/zvec-grep@0.2.1`. The first actual index build may download a
  local embedding model; nothing downloads during extension load.
- Bun `1.4.2` — the tested runtime: OMP's engine loads TS extensions on Bun, and
  the development toolchain runs on Bun (`engines.bun` requires `>= 1.4.2`; CI
  and local checks pin `1.4.2`).

No extension-load path spawns a subprocess, installs `zg` or models, makes
network requests, or mutates active host tools. Indexing, status, and search
execute the preinstalled `zg` binary with an explicit cwd, an abort signal, and
per-action timeouts.

## Install

The extension publishes to the npm registry under the restricted scope
`@artisann-studios/omp-zvec-grep` — org-private, so only npm accounts authorized
in the `artisann-studios` org (with a scoped read/write access token) can
install it. It is never public. The GitHub repository
`https://github.com/ImArtisann/omp-zvec-grep` is also private. Both routes below
require that org/repo access.

**From npm (published artifact)** — the OMP 18.1.11 plugin CLI accepts npm
specs, so a member of `@artisann-studios` installs the pinned release with:

```sh
omp plugin install @artisann-studios/omp-zvec-grep@0.1.0
```

This resolves against the org registry and needs an authenticated npm session
for a member account. It is only available after the restricted release has
actually been published (see `docs/release-checklist.md`); nothing below claims
a publish that has not run.

**One-off session load** — from the checkout root, load the extension for that
launch only (no persistent change):

```sh
omp --extension ./index.ts
```

The `-e`/`--extension` flag takes an extension file, is repeatable, and accepts
absolute paths (`omp --extension /path/to/omp-zvec-grep/index.ts`).

**Persistent plugin** — record a local checkout as a plugin (symlinked into
OMP's plugins directory and persisted across sessions):

```sh
omp plugin link /absolute/path/to/omp-zvec-grep
```

`omp plugin link` resolves the path against the current directory, so pass an
absolute path; it reads `package.json` (this package is
`name: "@artisann-studios/omp-zvec-grep"`). `omp plugin install /absolute/path`
routes local paths through the same link flow — either verb works for a
directory. New sessions load the linked plugin.

**From the private GitHub repo** — git must authenticate (SSH key or a PAT with
repository scope); an unauthenticated clone is not possible for a private repo.
Clone with access, then link:

```sh
git clone https://github.com/ImArtisann/omp-zvec-grep.git
cd omp-zvec-grep
omp plugin link "$PWD"
```

`/zg settings` requires the interactive TUI; in non-TUI modes it reports that it
is unavailable.

## Surface

- `zvec_search` — hybrid semantic + keyword search over a locally indexed
  workspace. Pass `query`, or explicit groups `queries` / `fts` / `vector`,
  optional `fuse`, `limit` (default 7, hard cap 50), path `globs`, `fileTypes` /
  `excludedFileTypes`, `symbolTypes` / `preferSymbol`, `modifiedAfter` /
  `modifiedBefore`, and a `root` (defaults to the current working directory).
  Use it for semantic, fuzzy, or location-unknown questions.
- `zvec_index` — create/update the workspace index, or `mode: rebuild` /
  `mode: drop` it. `rebuild` and `drop` are destructive and only run on explicit
  request (drop passes `--yes`). Optional `embedding`, `globs`, file-type
  filters, and `hidden`. `root` is required. A workspace must be indexed before
  searching.
- `zvec_status` — report index presence, coverage, and freshness. **Missing or
  stale indices are normal status outcomes**, not tool failures.
- `/zg <index|rebuild|drop|status|settings|help> [path]` — command surface with
  argument completion. `path` is the whole remainder of the argument string and
  may be quoted (`/zg status "/path/with spaces"`) when it contains spaces; bare
  `/zg` or an unknown subcommand prints usage. `rebuild` and `drop` announce
  themselves as explicit destructive operations before running. `/zg settings`
  opens the interactive settings menu.

### Semantic search or native tools?

`zvec_search` answers meaning/fuzzy/unknown-location questions against an index.
For exact strings, regex, filenames, counts, file lists, or anything piped, use
OMP's native `grep`/`glob` tools or the shell's `rg` instead — zg's managed `rg`
subset intentionally cannot do counts, file lists, or pipes. This routing is
baked into the tool descriptions so the agent picks the right surface.

## Configuration

Two layers, both read fresh (cheap per-file mtime cache) so hand edits take
effect immediately:

- **User defaults**: `<agentDir>/omp-zvec-grep/config.json`, where `agentDir` is
  OMP's public `getAgentDir()` (honors `PI_CODING_AGENT_DIR` and OMP profiles;
  this is the native OMP location, not a legacy Pi agent dir shim). This file
  holds values only — scope flags never apply from it, and stray legacy keys are
  stripped on the next user-layer save.
- **Workspace (project)**: `<workspace>/.zvec-grep/config.json`, anchored at the
  current working directory with no walk-up. It is **self-contained**: built-in
  defaults + its contents, with a boolean `projectScope` activation flag. `true`
  makes this file authoritative **for this workspace only** (no user values
  mixed in), so a committed file means the same on every machine and can never
  flip another workspace. `false` (or a hand-written file without the flag)
  leaves the values **dormant** and applies the user layer; deactivating project
  scope preserves the parked values and unrelated keys. A legacy
  `settingsScope: "project"` string is honored as `true` read-only (never
  written).

Defaults: `defaultLimit: 7` (valid range 1–50, hard cap 50) and
`autoIndex: false`. Writes stay inside the resolved workspace and refuse
symlinked, redirected, or non-owned config paths.

**Moving old Pi-era user settings** is an explicit opt-in, one-time step you run
yourself — the extension has no automatic importer and never reads the old
`pi-zvec-grep` user config.
[docs/pi-config-migration.md](docs/pi-config-migration.md) documents a
conservative copy-only snippet plus manual steps: only the user values
`defaultLimit` and `autoIndex` are copied into
`<agentDir>/omp-zvec-grep/config.json` (destination resolved via the public
`getAgentDir()` under the project's Bun, honoring `PI_CODING_AGENT_DIR` and OMP
profiles, or an agent dir you supply), the destination must not already exist,
scope flags are never copied, the old config is never deleted, and zg indexes
are never rebuilt or dropped — zg 0.2.1 indexes at the same `.zvec-grep`
workspace location keep working.

**Auto-index (default off)**: when enabled, every `session_start` runs a
readiness guard (`zg status --check-ready`) in the working directory; only a
missing or stale index triggers a background build (fire-and-forget,
per-workspace deduplication, cancelled at session shutdown). A healthy index
costs one cheap guard call per start. Off by default because the first build can
take a while and may download the local embedding model.

## Errors and rendering

- **Missing index — expected, but status and search differ**: `zvec_status`
  treats a missing or stale index as a normal outcome (a verdict line, never a
  tool failure). `zvec_search` before any index exists is different: zg exits
  nonzero, so the tool throws an error carrying zg's `WORKSPACE_INDEX_NOT_FOUND`
  diagnostic; that error is the expected signal (the tool description tells the
  agent to run `zvec_index` first), not an operational failure such as a missing
  `zg` binary or a timeout.
- **Operational failures**: `zg` not installed →
  `<action> unavailable: zg CLI was not found`; a nonzero exit → the stderr/exit
  code is surfaced; per-action timeouts (query 180s, index 600s, status 30s) →
  `<action> timed out after Ns`; an agent abort/cancel → `<action> cancelled`.
- **Rendering**: tools use native custom renderers (`renderCall` /
  `renderResult`) with themed summary lines — e.g. hit/file counts with a stale
  marker and the top hit headline for search, scanned/entity counts for
  indexing, and a colored verdict line for status — with expandable previews
  that clip long raw output instead of dumping it.

## Development and CI

Requires Bun `1.4.2+` and the OMP `18.1.11` dev pins. No command here publishes
the package; the restricted `@artisann-studios/omp-zvec-grep` release happens
only through the explicit publish workflow (`.github/workflows/publish.yml`).

```sh
bun install --frozen-lockfile
bun run check                 # typecheck + lint + format:check
bun test                      # hermetic default: real host loader, deterministic fake zg
bun run test:integration      # explicit hermetic integration suites
bun run test:cli              # REAL zg contract smoke — explicit opt-in lane
bun scripts/validate-pack.mjs # pack contents + out-of-tree install guard
```

- `bun test` and `test:integration` are hermetic: a deterministic fake `zg` on
  `PATH`, disposable agent/workspace dirs, the real OMP SDK loader/runner
  (`createAgentSession`) in isolated workers — no real zg, no network, no model,
  no skip gates.
- `test:cli` runs `test/cli/smoke.ts` against the **installed** `zg 0.2.1`
  (help/version/rg/no-index contract; deliberately no model or network work
  today). It is not part of the default hermetic command.
- CI (`.github/workflows/ci.yml`) runs the frozen install, `check`, `bun test`,
  `test:integration`, and pack validation on every branch push and pull request
  on `ubuntu-latest` (Linux x64) and `macos-15` (GitHub-hosted Apple Silicon,
  arm64). A separate `real-zg-smoke` job is manual-only (`workflow_dispatch`,
  never push/PR): it pins Node 22 (the zg CLI requires `node >= 22`) and
  installs the pinned upstream `@zvec/zvec-grep@0.2.1` CLI, then runs
  `test:cli`; it stays opt-in because an index-building assertion would download
  a local embedding model on first build.
  `.github/workflows/release-validation.yml` is the manual release-candidate
  gate (read-only, no publish).
- Exercised locally on macOS arm64. The CI lanes (including Linux x64) are
  defined but unverified until GitHub actually runs them — a skipped manual-only
  job is not a result, and nothing here claims any CI lane has run or passed.

## Provenance

Native port of `pi-zvec-grep` v0.3.1
(`db7b42db4a84dc724c3347fbcc2bdf32792882d6`), pinned against OMP `18.1.11`
(`e3106be68f778635da3a17106835ce2e0e6992af`) and zg `0.2.1`
(`426cd3bf9bf81f34a884945abafc58709897dadf`). Upstream Apache-2.0 license and
notices preserved in [LICENSE](LICENSE); provenance in
[UPSTREAM.md](UPSTREAM.md); baseline and evidence in
[docs/compatibility.md](docs/compatibility.md); cutover checklist in
[docs/release-checklist.md](docs/release-checklist.md).
