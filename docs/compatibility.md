# Compatibility baseline

Recorded before native source edits on 2026-09-05.

## Upstream source

- Repository: `https://github.com/MikkelKappelPersson/pi-zvec-grep`
- Exact cloned SHA: `db7b42db4a84dc724c3347fbcc2bdf32792882d6`
- Upstream release: `v0.3.1`
- Git remote is retained as `upstream`; this port is developed on `feat/native-omp-port`.

## Runtime releases

- Oh My Pi package: `@oh-my-pi/pi-coding-agent@18.1.11`
- Oh My Pi companion TUI: `@oh-my-pi/pi-tui@18.1.11`
- Oh My Pi release tag commit: `e3106be68f778635da3a17106835ce2e0e6992af`
- Bun: `1.4.2`
- zvec-grep CLI: `0.2.1` (`zg --version`)
- zvec-grep release tag commit: `426cd3bf9bf81f34a884945abafc58709897dadf`

## Baseline test lanes

The inherited upstream baseline has two intentionally separate lanes:

1. **Hermetic lane (default):** the test harness prepends a deterministic fake `zg` executable to `PATH`; it uses no installed zvec CLI, model, network, or embedding downloads. The pure core and extension-surface checks run against that fake. This is the reproducible default for development and CI.
2. **Real CLI lane (opt-in):** `test/verify-cli.mjs` invokes the installed `zg` executable and therefore depends on the pinned released CLI, its local model/cache state, and the fixture workspace. It is not part of the hermetic default.

The native port must keep these lanes separate. No extension-load path may install or download `zg`, models, or network resources.

## Recorded upstream baseline outcome

Command: `npm test` from the cloned v0.3.1 tree on Bun 1.4.2 / Node 22.22.0 (2026-09-05).

- The real CLI lane (`npm run cli:test`) passed all assertions, including `zg --version` = `0.2.1`, query/index flags, managed `rg` behavior, and no-index diagnostics.
- The hermetic surface lane (`npm run surface:test`) ran 71 assertions: 66 passed and 5 failed because macOS temporary-directory paths were compared lexically (`/private/var/...` observed by the harness vs `/var/...` expected). The failures were `search cwd resolved relative to ctx.cwd`, `search cwd falls back to ctx.cwd`, `index cwd is the workspace root`, `/zg status <path> pins cwd`, and `/zg index <path> indexes the named workspace`.
- Because the inherited `npm test` chain stops at the surface lane, the remaining pure hermetic suites were run individually: `verify-queries.mjs` 21 passed; `verify-indexing.mjs` 17 passed; `verify-errors.mjs` 10 passed; `verify-settings.mjs` all assertions passed; `verify-format.mjs` all assertions passed.
- `verify-autoindex.mjs` failed at its first assertion (`autoIndex on + ready: the guard ran`; observed `undefined`, expected `true`) after package metadata was replaced while source was still unedited; its legacy registration path is incompatible with the native metadata. This is retained as a baseline observation, not treated as a native-port result.

## Native bring-up evidence

- `bun run typecheck` passes against OMP 18.1.11 public declarations.
- A real disposable fixture indexed successfully with the installed `zg 0.2.1`: one file scanned/added, one entity, then status reported 100% ready and a semantic query returned `auth.ts:1` (`matchedBy=fts+vector`). The first local model preparation downloaded 16 KiB; this was explicit smoke work, never extension-load behavior.
- Actual OMP 18.1.11 PTY loaded the absolute extension path and rendered `/zg help` and `/zg settings`; SettingsList navigation changed auto-index, save persisted it on reopen, and Esc restored the editor. The first PTY used the normal agent profile; its temporary config was removed after the smoke. Subsequent host tests must set `PI_CODING_AGENT_DIR` to a disposable directory before process launch.
- A fresh SDK wrapper/render smoke was attempted but blocked by the locally installed OMP native addon leaf not being discoverable from Bun's cache (`pi_natives.darwin-arm64.node` resolution failure). This is an environment prerequisite for the host harness, not a zvec/model installation requirement.
