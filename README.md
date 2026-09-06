# omp-zvec-grep

Native [Oh My Pi](https://github.com/can1357/oh-my-pi) extension for local
[zvec-grep](https://github.com/zvec-ai/zvec-grep) (`zg`). It adds hybrid
lexical/vector search, workspace indexing, index status, and the `/zg` command
to OMP.

## Requirements

- Oh My Pi `18.1.11` (the package's pinned peer version).
- Bun `1.4.2` or newer. OMP loads the TypeScript extension with Bun.
- The separate `zg` CLI `0.2.1`, installed on `PATH`:
  `npm install --global @zvec/zvec-grep@0.2.1`. The `zg` CLI requires Node.js
  `22` or newer.

The extension does not install `zg`, download a model during extension load, or
make network requests while loading. The first real index build can download the
embedding model used by `zg`.

## Install in OMP

The public npm package is:

```sh
omp plugin install @artisann-studios/omp-zvec-grep@0.1.0
```

The package is public; npm authentication is not needed to install it. Start a
new OMP session after installation. If OMP is already running, use the pinned
host command `/reload-plugins` instead.

To use a checkout for one launch:

```sh
omp --extension /absolute/path/to/omp-zvec-grep/index.ts
```

To persist a local checkout as a plugin:

```sh
omp plugin link /absolute/path/to/omp-zvec-grep
```

The package manifest declares the extension entry point through
`omp.extensions`, which is the OMP plugin convention.

## First run

The commands below intentionally distinguish shell commands from commands typed
inside an interactive OMP session:

1. **Shell:** install the package and the separate `zg` prerequisite above.
2. **Shell:** open OMP in the workspace you want to index:
   `omp --cwd /absolute/path/to/workspace`.
3. **In OMP:** run `/zg settings`, then choose the settings scope, default
   search limit, and whether auto-indexing should be on.
4. **In OMP:** run `/zg index`, then `/zg status` to confirm the index is ready.
5. **In OMP:** ask the agent a semantic question that the indexed workspace can
   answer.

## Use it

A workspace must have an index before search can return results.

- `/zg index [path]` creates or updates the index for the current directory or
  the supplied path. `/zg rebuild [path]` rebuilds it and `/zg drop [path]`
  removes it; both are explicitly destructive operations.
- `/zg status [path]` reports whether the index is ready, missing, or stale.
- `/zg` and `/zg help` show the command help. A path containing spaces can be
  quoted as the whole remainder, for example `/zg status "/path/with spaces"`.
- `zvec_search` is the agent tool for semantic, fuzzy, or location-unknown
  questions. It supports query groups, a result limit, path/file/symbol filters,
  and an optional workspace root.
- `zvec_index` creates, updates, rebuilds, or drops an index. Its `root` is
  required.
- `zvec_status` reports index presence, coverage, and freshness; missing or
  stale indexes are normal status results, not tool failures.

For exact strings, regular expressions, filenames, counts, file lists, or pipes,
use OMP's native `grep`/`glob` tools or the shell's `rg`. Use `zvec_search` for
meaning-based or fuzzy discovery.

## Configure with `/zg settings`

Run `/zg settings` in an interactive OMP session. Settings are managed by the
extension's menu; they are not OMP settings and should not be placed in an OMP
settings file.

The menu controls:

- **Settings scope** — `user` uses the active OMP agent directory's
  `omp-zvec-grep/config.json`; `project` uses the current workspace's
  `.zvec-grep/config.json`. A project file is self-contained: when its
  `projectScope` flag is true, its values are combined with built-in defaults,
  never with user values. A committed project file therefore affects only that
  repository. Choosing `user` leaves a project file dormant rather than deleting
  it.
- **Default search limit** — defaults to `7`, accepts `1`–`50`, and applies only
  when a search call does not provide its own limit. An explicit tool-call limit
  wins.
- **Auto index on start** — off by default. When enabled, each session start
  checks the workspace with `zg status --check-ready` and builds a missing or
  stale index in the background. The build may download the local embedding
  model.

The active OMP agent directory follows OMP's profile and `PI_CODING_AGENT_DIR`
resolution. The project path is anchored at the current working directory; it
does not walk up to another repository. Configuration files are read fresh so
changes made in `/zg settings` take effect without reinstalling the plugin.

## Development

From a checkout with Bun `1.4.2+`:

```sh
bun install --frozen-lockfile
bun run check
bun test
bun run test:integration
```

`bun run test:cli` is a separate opt-in smoke lane for the real `zg 0.2.1`
installed on `PATH`; it is not part of the hermetic default tests and may
prepare a local embedding model if its assertions are expanded.

## Move old Pi settings (optional)

The native port does not read or migrate the old `pi-zvec-grep` configuration.
If needed, follow the explicit, copy-only procedure in
[docs/pi-config-migration.md](docs/pi-config-migration.md). It transfers only
`defaultLimit` and `autoIndex`, refuses to overwrite an existing destination,
never copies scope flags, and never changes an index.

## Attribution and compatibility

This is a native port of `pi-zvec-grep` v0.3.1. Upstream attribution and the
Apache-2.0 license are retained in [UPSTREAM.md](UPSTREAM.md) and
[LICENSE](LICENSE). Supported-version and platform evidence is recorded in
[docs/compatibility.md](docs/compatibility.md).
