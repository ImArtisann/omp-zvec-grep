# Release checklist — restricted @artisann-studios/omp-zvec-grep 0.1.0

This checklist covers the first restricted release of the native port:
`@artisann-studios/omp-zvec-grep@0.1.0`, published to the npm registry org
`artisann-studios` as a **restricted (org-private)** package. The package is
**never public**, and the GitHub repository
(`https://github.com/ImArtisann/omp-zvec-grep`) **stays private**. "Release"
means publishing the restricted package and proving it end to end.

## Publication prerequisites (external, one-time)

- [ ] An npm account that is a **member of the `artisann-studios` org** with
      write access to the `omp-zvec-grep` package/scope.
- [ ] The npm org plan **allows private (restricted) packages**. A free-plan org
      cannot host restricted scoped packages; if restricted is unavailable,
      publication must stop and be reported — do not publish publicly.
- [ ] A **Granular Access Token (GAT)** for that account: scope limited to the
      `@artisann-studios/omp-zvec-grep` package, permission **Read and write**,
      **Bypass 2FA** enabled (a CI job cannot answer an OTP), expiry **≤ 90
      days** (classic/legacy tokens were removed by npm in Nov 2025 and cannot
      be used). The token is stored only as the GitHub Actions secret
      `NPM_TOKEN` on the private repo — never in the tree or logs. A brand-new
      package may not yet be selectable in the granular-token UI; if so, do
      **not** mint an all-org/all-packages write credential. Prefer an
      authenticated local bootstrap publish that creates the package, then mint
      the exact-package GAT for the workflow. If that is not possible, mint the
      shortest-lived org-scope token for the single first release and
      revoke/replace it with an exact-package token as soon as the package
      exists. Record token **metadata only** (scope, expiry, secret name) here —
      never the token value. No org membership changes, billing/plan purchases,
      or public access are made as part of this.
- [ ] Trusted publishing / OIDC is **not** configured (a token was requested);
      it would avoid a stored token and add provenance, but requires wiring npm
      trusted-publisher settings for the workflow. If that route is preferred
      later, revisit this checklist before switching.

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
- [ ] `bun run check` passes warning-free (typecheck, lint, format:check)
- [ ] `bun test` passes (hermetic default; deterministic fake `zg`, no network)
- [ ] `bun run test:integration` passes (explicit hermetic suites)
- [ ] `bun run test:cli` passes against the installed `zg 0.2.1` (real-CLI
      contract; requires the pinned CLI on `PATH`, model-free today)
- [ ] `bun scripts/validate-pack.mjs` passes the scoped restricted guards:
      `name` = `@artisann-studios/omp-zvec-grep`, not `private`,
      `publishConfig.access` = `restricted`, `publish.yml` present, exact pack
      contents (no `test/`, `.github/`, `scripts/` in the tarball), and a real
      out-of-tree install whose public-SDK load/execute/render proves the real
      status result renders the custom `index ready` verdict
- [ ] Record actual suite counts in `docs/compatibility.md` from the runs above
      (no fabricated numbers)

## GitHub validation (private repo)

Push/PR runs of `.github/workflows/ci.yml` consume normal Actions minutes on the
private repo; that is planned and allowed. A workflow being present is not a
result — only an actual green run is.

- [ ] Push the release branch; the CI matrix job passes on `ubuntu-latest`
      (Linux x64) and `macos-15` (Apple Silicon)
- [ ] Optionally trigger the real-CLI lane consciously: `real-zg-smoke` is
      manual-only (`workflow_dispatch`) and installs the pinned `zg` in the job;
      it stays opt-in because future index-building assertions would download a
      local embedding model on first build
- [ ] Record in `docs/compatibility.md` that these GitHub runs happened and what
      they showed (e.g. run `34004218551` at `6c27cb4` was green on both OS)

## Publish (restricted, explicit)

- [ ] Confirm `NPM_TOKEN` is set as an Actions secret on the private repo
- [ ] Run "Publish (scoped, restricted)" from Actions (`workflow_dispatch`) on
      the release commit, **or** push tag `v0.1.0` (the workflow triggers on
      `v*` tags and `validate-pack.mjs --tag` enforces the tag equals the
      package version). The workflow runs the full verification then publishes
- [ ] Only the publish step uses `NPM_TOKEN`; the repo and workflow request no
      provenance (not wired), no upstream target, and no public access

## Verify the published artifact

- [ ] `npm view @artisann-studios/omp-zvec-grep@0.1.0` shows the version,
      restricted access, and expected dist integrity
- [ ] An isolated authenticated
      `npm install     @artisann-studios/omp-zvec-grep@0.1.0` (member token)
      succeeds and loads through the actual OMP loader/render, not just the pack
      probe
- [ ] Confirm access stays restricted (no public visibility flag)
- [ ] Record the publish + verification result in `docs/compatibility.md`

## If a git tag is used

- [ ] Tag must be exactly `v0.1.0` (matches `package.json` version; enforced by
      the validation script)
- [ ] Tags stay private-repo-internal; no GitHub Release is created

## Explicit non-goals (never steps)

- [ ] No public visibility: the package stays `restricted`, the repo stays
      private
- [ ] No npm OIDC/trusted-publishing configuration is added (token route is
      used); no provenance is forced where the registry/repo do not support it
- [ ] Nothing ever targets or pushes to the upstream `pi-zvec-grep` repo, and no
      token grants anything there
- [ ] No automatic migration or deletion of old Pi-era configs or indexes; the
      opt-in transfer helper is copy-only (see `docs/pi-config-migration.md`)
- [ ] No claim that a publish ran until an actual publish is observed
- [ ] No auto broad staging of user-owned repo tooling (`.coderabbit.yaml`,
      `.husky/`, `tools/`, etc.)

## Before any future public step (not planned)

- [ ] Verify registry requirements and obtain explicit authorization — none
      exists today for public publication
- [ ] Revisit this checklist and the publish/release workflows before any change
      to package visibility is considered
