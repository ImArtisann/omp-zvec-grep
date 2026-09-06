# Compatibility

`omp-zvec-grep` `0.1.0` is the native OMP port of `pi-zvec-grep` `v0.3.1`. The
public package is
[`@artisann-studios/omp-zvec-grep@0.1.0`](https://www.npmjs.com/package/@artisann-studios/omp-zvec-grep).

## Supported versions

| Component | Supported/tested version | Notes                                                                      |
| --------- | ------------------------ | -------------------------------------------------------------------------- |
| Oh My Pi  | `18.1.11`                | `@oh-my-pi/pi-coding-agent`, `pi-tui`, and `pi-utils` are pinned as peers. |
| Bun       | `1.4.2+`                 | OMP loads the TypeScript extension with Bun; local checks use `1.4.2`.     |
| zvec-grep | `0.2.1`                  | Install the separate `@zvec/zvec-grep@0.2.1` CLI as `zg` on `PATH`.        |

The extension does not install `zg` or its embedding model. Loading the
extension does not spawn a subprocess or make a network request. A first real
index build may download the model on behalf of `zg`.

## Platform evidence

- Local macOS arm64 verification passed with Bun `1.4.2`, OMP `18.1.11`, and
  `zg 0.2.1`.
- The GitHub CI matrix passed on `ubuntu-latest` (Linux x64) and `macos-15`
  (Apple Silicon) in runs `34004218551` and `34005227676`. Those runs covered
  the frozen install, typecheck/lint/format checks, hermetic tests, integration
  tests, and pack validation.
- Windows and other platforms are not claimed as tested by this release.

## Verified behavior

The local release checks passed:

- `bun run check` — warning-free typecheck, lint, and format check.
- `bun test` — 26 tests / 99 expectations using a deterministic fake `zg`.
- `bun run test:integration` — 8 tests / 23 expectations using the real OMP SDK
  loader and renderer in isolated workers.
- `bun run test:cli` — contract smoke against the installed `zg 0.2.1`.
- `bun scripts/validate-pack.mjs` — 17 packed entries, no test/CI/script
  content, and an out-of-tree public OMP SDK load/execute/render check.

The hermetic tests do not use a real index, network, model, or embedding
service. The opt-in CLI smoke checks the installed `zg` contract without
requiring a model-building assertion.

## Provenance

- Ported source: `pi-zvec-grep` `db7b42db4a84dc724c3347fbcc2bdf32792882d6`.
- OMP source pin: `e3106be68f778635da3a17106835ce2e0e6992af`.
- zvec-grep source pin: `426cd3bf9bf81f34a884945abafc58709897dadf`.

The upstream Apache-2.0 license and notices remain in [LICENSE](../LICENSE), and
attribution is recorded in [UPSTREAM.md](../UPSTREAM.md).
