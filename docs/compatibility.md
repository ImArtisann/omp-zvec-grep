# Compatibility baseline

Recorded before native source edits on 2026-09-05.

## Upstream source

- Repository: `https://github.com/MikkelKappelPersson/pi-zvec-grep`
- Exact cloned SHA: `db7b42db4a84dc724c3347fbcc2bdf32792882d6`
- Upstream release: `v0.3.1`
- Git remote is retained as `upstream`; this port is developed on
  `feat/native-omp-port`.

## Runtime releases

- Oh My Pi package: `@oh-my-pi/pi-coding-agent@18.1.11`
- Oh My Pi companion TUI: `@oh-my-pi/pi-tui@18.1.11`
- Oh My Pi release tag commit: `e3106be68f778635da3a17106835ce2e0e6992af`
- Bun: `1.4.2`
- zvec-grep CLI: `0.2.1` (`zg --version`)
- zvec-grep release tag commit: `426cd3bf9bf81f34a884945abafc58709897dadf`

## Baseline test lanes

The inherited upstream baseline has two intentionally separate lanes:

1. **Hermetic lane (default):** the test harness prepends a deterministic fake
   `zg` executable to `PATH`; it uses no installed zvec CLI, model, network, or
   embedding downloads. The pure core and extension-surface checks run against
   that fake. This is the reproducible default for development and CI.
2. **Real CLI lane (opt-in):** `test/verify-cli.mjs` invokes the installed `zg`
   executable and therefore depends on the pinned released CLI, its local
   model/cache state, and the fixture workspace. It is not part of the hermetic
   default.

The native port must keep these lanes separate. No extension-load path may
install or download `zg`, models, or network resources.

## Recorded upstream baseline outcome

Command: `npm test` from the cloned v0.3.1 tree on Bun 1.4.2 / Node 22.22.0
(2026-09-05).

- The real CLI lane (`npm run cli:test`) passed all assertions, including
  `zg --version` = `0.2.1`, query/index flags, managed `rg` behavior, and
  no-index diagnostics.
- The hermetic surface lane (`npm run surface:test`) ran 71 assertions: 66
  passed and 5 failed because macOS temporary-directory paths were compared
  lexically (`/private/var/...` observed by the harness vs `/var/...` expected).
  The failures were `search cwd resolved relative to ctx.cwd`,
  `search cwd falls back to ctx.cwd`, `index cwd is the workspace root`,
  `/zg status <path> pins cwd`, and
  `/zg index <path> indexes the named workspace`.
- Because the inherited `npm test` chain stops at the surface lane, the
  remaining pure hermetic suites were run individually: `verify-queries.mjs` 21
  passed; `verify-indexing.mjs` 17 passed; `verify-errors.mjs` 10 passed;
  `verify-settings.mjs` all assertions passed; `verify-format.mjs` all
  assertions passed.
- `verify-autoindex.mjs` failed at its first assertion
  (`autoIndex on + ready: the guard ran`; observed `undefined`, expected `true`)
  after package metadata was replaced while source was still unedited; its
  legacy registration path is incompatible with the native metadata. This is
  retained as a baseline observation, not treated as a native-port result.

## Native bring-up evidence

(Corrected in place 2026-09-05: the PTY incident disclosure and the cancellation
evidence below were updated to match the later host-verification results instead
of preserving earlier inaccurate wording.)

- `bun run typecheck` passes against OMP 18.1.11 public declarations.
- A real disposable fixture indexed successfully with the installed `zg 0.2.1`:
  one file scanned/added, one entity, then status reported 100% ready and a
  semantic query returned `auth.ts:1` (`matchedBy=fts+vector`). The first local
  model preparation downloaded 16 KiB; this was explicit smoke work, never
  extension-load behavior.
- Actual OMP 18.1.11 PTY loaded the absolute extension path and rendered
  `/zg help` and `/zg settings`; SettingsList navigation changed auto-index,
  save persisted it on reopen, and Esc restored the editor; the same flow later
  passed in an isolated environment. **Incident disclosure (2026-09-05):** the
  first PTY ran under the normal (non-isolated) agent profile, and its
  `/zg settings` save wrote `autoIndex: true` to the real user-config path
  `~/.omp/agent/omp-zvec-grep/config.json`. That file was then removed without a
  prior stat or read, so its pre-existence cannot be established; targeted
  recovery found no backup, and it cannot be claimed that no user config was
  lost. The user was informed. The isolated rerun (disposable
  `PI_CODING_AGENT_DIR` and `HOME`, `OMP_SKIP_SETUP=1`, absolute extension path)
  passed: `/zg help`; `/zg settings`, DOWN DOWN ENTER changed auto-index, save;
  Esc restored the editor; reopening showed the setting on; Esc. Rule for host
  tests: set `PI_CODING_AGENT_DIR` (and `HOME`) to disposable directories before
  process launch — never the normal profile.
- A fresh SDK wrapper/render smoke was attempted but blocked by the locally
  installed OMP native addon leaf not being discoverable from Bun's cache
  (`pi_natives.darwin-arm64.node` resolution failure). This is an environment
  prerequisite for the host harness, not a zvec/model installation requirement.

Exact real-CLI fixture lines:

```text
status-before: ? Workspace index is not configured
index: files  1 scanned, 1 added, 0 modified, 0 retried, 0 unchanged, 0 deleted, 0 failed
index: entities  1
status-after: ✓ Workspace index is ready
status-after: Coverage  ████████████████████ 100%  1 / 1 files
query-after: #1 matchedBy=fts+vector auth.ts:1
```

The first direct cancellation attempt completed its tiny fixture rebuild before
SIGINT could interrupt it; it is not counted as cancellation proof. A later
active cancellation proof used a disposable fixture of 20,000 files:
`zg index . --rebuild` was interrupted with SIGINT after about one second while
the index was actively building, yielding `status: null`, `signal: SIGINT`,
`interrupted: true`; the fixture was removed afterwards.

## Final native port suite results (2026-09-05)

Recorded from the final local run on macOS arm64 with Bun 1.4.2, after the
auto-index lifecycle hardening and the native renderer-edge coverage:

- `bun run check` — PASS, warning-free (typecheck, oxlint, format check). One
  oxlint unicorn warning (`no-useless-length-check`, agent-added, not from the
  upstream baseline) had appeared at `test/helpers/session-worker.ts:147`; it
  was removed by dropping a redundant `updates.length > 0 &&` prefix on an
  `updates.some(...)` render assertion (`some([])` is already `false`), so the
  final check reports zero warnings.
- `bun test` — PASS, 26 tests / 99 expectations (hermetic default; deterministic
  fake `zg`, no network/model), measured with the obsolete lifecycle draft
  harness removed (`test/helpers/lifecycle-worker.ts`,
  `test/integration/lifecycle.test.ts`).
- `bun run test:integration` — PASS, 8 tests / 23 expectations (real SDK loader
  worker and renderer gate suites; `sdk-real` 2/11, fake/wrapped gate 6/12).
- `bun run test:cli` — PASS against the real installed `zg 0.2.1`.
- `bun scripts/validate-pack.mjs` — PASS. Packs 18 entries (required source and
  docs present; no `test/`, `.github/`, or `scripts/` content), installs the
  tarball out of tree into a consumer-local npm peer graph under a disposable
  agent dir/HOME, and loads the installed extension through the public OMP SDK
  (`createAgentSession` + `ToolExecutionComponent`) to execute and render
  `zvec_status` against a fake `zg` that prints exactly the ready line. The
  probe asserts the extension loaded with no `extensionsResult` errors, the
  result text carries `Workspace index is ready`, and the rendered component
  includes the status renderer's custom `index ready` verdict line — proving the
  real result callback rendered, not a host-error fallback. This resolves the
  earlier local limitation note (the installed OMP native addon leaf not
  resolvable from Bun's cache); that history is preserved above in the bring-up
  evidence.
- Real CLI cancellation — proven separately (20k-file fixture, SIGINT; see
  above).
- CI on GitHub — verified green on the first push (run `34004218551` at
  `6c27cb4`): both `Verify (ubuntu-latest)` (Linux x64) and `Verify (macos-15)`
  (Apple Silicon) completed **success**. The push/PR matrix never publishes; the
  package is published public only through the explicit publish workflow. A
  later public-release push produces a distinct run, recorded here when it
  happens.
- Package identity (0.1.0 cutover): the native extension is published public as
  `@artisann-studios/omp-zvec-grep` (`publishConfig.access: public`), and the
  GitHub repository is public; its runtime/config identity is unchanged
  (`omp-zvec-grep` user config dir and tool/command names are stable).
