# Changelog

The native extension publishes as the **public** npm package
`@artisann-studios/omp-zvec-grep` (anyone can install it), and the GitHub
repository is public. The 0.1.0 release below was published 2026-09-05;
subsequent releases run only through the explicit publish.yml workflow after the
release checks pass.

## 0.1.0 (2026-09-05)

Initial public native Oh My Pi port of `pi-zvec-grep` v0.3.1, pinned to OMP
18.1.11 and the upstream `zg` 0.2.1 CLI, published scoped as
`@artisann-studios/omp-zvec-grep@0.1.0` (`publishConfig.access: public`),
verified by an anonymous no-auth install and a real OMP SDK load/execute/render
of the published artifact.

### Added

- Native OMP surface: `zvec_search` (hybrid lexical + vector search),
  `zvec_index` (index/rebuild/drop), and `zvec_status` tools with custom themed
  renderers and explicit-cwd, timeout, and abort-signal handling.
- `/zg <index|rebuild|drop|status|settings|help> [path]` command with argument
  completion, whole-remainder (optionally quoted) paths, and explicit
  destructive-operation wording for rebuild and drop.
- Two-layer configuration: user defaults under
  `getAgentDir()/omp-zvec-grep/config.json` (honors `PI_CODING_AGENT_DIR` and
  OMP profiles) and self-contained per-workspace `.zvec-grep/config.json` behind
  a `projectScope` boolean; dormant values and unrelated keys are preserved;
  default `defaultLimit: 7` (cap 50), `autoIndex: false`.
- Auto-index lifecycle hook (default off): a `session_start` readiness guard
  builds only missing/stale indices in the background, per-workspace
  deduplicated and cancelled at session shutdown.
- Hermetic test harness (deterministic fake `zg`, disposable agent/workspace
  dirs, real OMP `createAgentSession` loader in isolated workers) plus an
  explicit real-CLI contract smoke lane (`bun run test:cli`) against the
  installed `zg` 0.2.1; no model, network, or skip gates in the hermetic
  default.
- Pack and install validation script (`scripts/validate-pack.mjs`): enforces the
  scoped public identity (`name` = `@artisann-studios/omp-zvec-grep`, not
  `private`, `publishConfig.access` = `public`), no in-repo publish script, the
  presence of the publish workflow, exact pack contents, and a real out-of-tree
  install; tag/version agreement when invoked with a tag.
- CI: push/PR verification matrix (Linux x64 and macOS Apple Silicon) for the
  frozen install, check, hermetic tests, and pack validation; a manual-only
  real-`zg` smoke job; a manual, read-only release-validation workflow; and an
  explicit manual/tag publish workflow (`publish.yml`) that re-runs the checks
  and publishes public with the `NPM_TOKEN` secret. Push/PR CI never publishes;
  only the explicit publish workflow does.
- Documentation: upstream compatibility baseline and evidence
  (`docs/compatibility.md`), explicit opt-in migration guide with a copy-only
  transfer snippet for Pi-era user settings (`docs/pi-config-migration.md`).

### Safety notes

- Extension load never installs `zg` or models, downloads anything, or mutates
  active host tools; the first real index build may download a local embedding
  model.
- Nothing is migrated automatically from the old Pi-era `pi-zvec-grep` user
  config; the opt-in transfer is copy-only (destination must not exist), never
  copies scope flags, never deletes the old config, and never rebuilds or drops
  existing zg indexes.
