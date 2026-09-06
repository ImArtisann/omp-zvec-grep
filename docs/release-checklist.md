# Release checklist — private 0.1.0 cutover

This checklist validates the private `0.1.0` native port cutover.
`omp-zvec-grep` is **never published**: no `npm publish`, no public visibility,
no GitHub Release, and no npm OIDC/trusted-publishing configuration exists.
"Release" here means recording the cutover state and proving it end to end.

## Reference pins

- OMP: `@oh-my-pi/pi-coding-agent@18.1.11` (+ `pi-tui`, `pi-utils`), tag
  `e3106be68f778635da3a17106835ce2e0e6992af`
- Bun: `1.4.2`
- zvec-grep CLI: `zg 0.2.1` (`@zvec/zvec-grep@0.2.1`,
  `426cd3bf9bf81f34a884945abafc58709897dadf`)
- Upstream ported source: `pi-zvec-grep` v0.3.1
  (`db7b42db4a84dc724c3347fbcc2bdf32792882d6`)

See `docs/compatibility.md` for the baseline and evidence.

## Local preflight (developer machine, macOS arm64)

- [ ] `bun install --frozen-lockfile` succeeds
- [ ] `bun run check` passes (typecheck, lint, format:check)
- [ ] `bun test` passes (hermetic default; deterministic fake `zg`, no network)
- [ ] `bun run test:integration` passes (explicit hermetic suites)
- [ ] `bun run test:cli` passes against the installed `zg 0.2.1` (real-CLI
      contract; requires the pinned CLI on `PATH`, model-free today)
- [ ] `bun scripts/validate-pack.mjs` passes: private guard, no publish
      script/workflow, exact pack contents (no `test/`, `.github/`, `scripts/`
      in the tarball), out-of-tree install, entry present
- [ ] Record actual suite counts in `docs/compatibility.md` from the runs above
      (no fabricated numbers)

## GitHub validation (private repo)

Push/PR runs of `.github/workflows/ci.yml` consume normal Actions minutes on the
private repo; that is planned and allowed. A workflow being present is not a
result — only an actual green run is.

- [ ] Push the cutover branch and open the PR to `main`; the CI matrix job
      passes on `ubuntu-latest` (Linux x64) and `macos-15` (Apple Silicon)
- [ ] Review the real-CLI lane consciously: `real-zg-smoke` is manual-only
      (`workflow_dispatch`). Trigger it and confirm `bun run test:cli` passes
      with the pinned `zg` installed by the job. It stays opt-in because an
      index-building assertion would download a local embedding model on first
      build
- [ ] Run "Release validation (manual, no publish)" from Actions on the cutover
      branch or tag: it runs check + hermetic suites + pack validation and never
      requests publish permissions. When run on a tag, the tag must equal
      `v0.1.0` (`scripts/validate-pack.mjs --tag` enforces the match)
- [ ] Record in `docs/compatibility.md` that these GitHub runs happened and what
      they showed

## If a tag is used for the cutover

- [ ] Tag must be exactly `v0.1.0` (matches `package.json` version; enforced by
      the validation script)
- [ ] Tags stay private-repo-internal; do not create a GitHub Release, do not
      publish anything

## Explicit non-goals (never steps)

- [ ] No `npm publish` (no authorization; package must stay `private: true`)
- [ ] No npm OIDC token or trusted-publishing configuration is added
- [ ] No public visibility of the repo or any artifact
- [ ] No automatic migration or deletion of old Pi-era configs or indexes; the
      opt-in transfer helper is copy-only (see `docs/pi-config-migration.md`)
- [ ] No claim that untested CI lanes have run

## Before any future public step (not planned)

- [ ] Verify npm name availability for the intended package name (never checked;
      do not assume)
- [ ] Verify registry requirements (package, provenance, access tokens) and
      obtain explicit authorization — none exists today
- [ ] Revisit this checklist and the release-validation workflow before any
      publication is considered
