# Release checklist — public @artisann-studios/omp-zvec-grep 0.1.0

This checklist covers the first release of the native port:
`@artisann-studios/omp-zvec-grep@0.1.0`, published to the npm registry under the
`artisann-studios` scope as a **public** package (anyone can install it; no paid
org plan is required). The GitHub repository
(`https://github.com/ImArtisann/omp-zvec-grep`) is also public. "Release" means
publishing the package and proving it end to end.

## Publication prerequisites (mostly one-time)

- [ ] An npm account that is an **owner/member of the `artisann-studios` org**
      with write access to the `omp-zvec-grep` package/scope (verified:
      `artisann` is an owner). Public scoped publication needs no paid plan.
- [ ] A **Granular Access Token (GAT)** for that account, stored only as the
      GitHub Actions secret `NPM_TOKEN`: scope limited to the
      `@artisann-studios/omp-zvec-grep` package, permission **Read and write**,
      **Bypass 2FA** enabled (a CI job cannot answer an OTP), expiry **≤ 90
      days** (classic/legacy tokens were removed by npm in Nov 2025; the npm CLI
      can only create read-only/legacy tokens, so a granular token is created in
      the npm web UI at npmjs.com → Access Tokens). Record token **metadata
      only** (scope, expiry, secret name) — never the token value. If the
      brand-new package is not yet selectable in the token UI, publish the first
      release first, then mint the exact-package token.
- [ ] Trusted publishing / OIDC is **not** configured (a token was requested);
      it would avoid a stored token and add provenance, but requires wiring npm
      trusted-publisher settings. If that route is preferred later, revisit this
      checklist before switching.

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
- [ ] `bun scripts/validate-pack.mjs` passes the scoped public guards: `name` =
      `@artisann-studios/omp-zvec-grep`, not `private`, `publishConfig.access` =
      `public`, `publish.yml` present, exact pack contents (no `test/`,
      `.github/`, `scripts/` in the tarball), and a real out-of-tree install
      whose public-SDK load/execute/render proves the real status result renders
      the custom `index ready` verdict
- [ ] Record actual suite counts in `docs/compatibility.md` from the runs above
      (no fabricated numbers)

## GitHub validation (public repo)

Push/PR runs of `.github/workflows/ci.yml` verify the branch. A workflow being
present is not a result — only an actual green run is.

- [ ] Push the release branch; the CI matrix passes on `ubuntu-latest` (Linux
      x64) and `macos-15` (Apple Silicon)
- [ ] Optionally trigger the real-CLI lane consciously: `real-zg-smoke` is
      manual-only (`workflow_dispatch`) and installs the pinned `zg` in the job;
      it stays opt-in because future index-building assertions would download a
      local embedding model on first build
- [ ] Record in `docs/compatibility.md` which GitHub runs happened and what they
      showed

## Publish (public, explicit)

- [ ] Confirm `NPM_TOKEN` is set as an Actions secret on the repo
- [ ] Run "Publish (scoped, public)" from Actions (`workflow_dispatch`) on the
      release commit, **or** push tag `v0.1.0` (the workflow triggers on `v*`
      tags and `validate-pack.mjs --tag` enforces the tag equals the package
      version). The workflow runs the full verification then publishes
- [ ] Only the publish step uses `NPM_TOKEN` (with
      `npm publish --ignore-scripts` so dev lifecycle/husky hooks never run with
      the token); the repo and workflow request no provenance (not wired)

## Verify the published artifact

- [ ] `npm view @artisann-studios/omp-zvec-grep@0.1.0` shows the version, public
      access, and expected dist integrity
- [ ] An isolated `npm install @artisann-studios/omp-zvec-grep@0.1.0` (no auth
      needed for a public package) succeeds and loads through the actual OMP
      loader/render, not just the pack probe
- [ ] Record the publish + verification result in `docs/compatibility.md`

## If a git tag is used

- [ ] Tag must be exactly `v0.1.0` (matches `package.json` version; enforced by
      the validation script)

## Explicit non-goals (never steps)

- [ ] No restricted/org-private publication is used — the package is public
- [ ] No npm OIDC/trusted-publishing configuration is added (token route is
      used); no provenance is forced where the registry/repo do not support it
- [ ] Nothing ever targets or pushes to the upstream `pi-zvec-grep` repo, and no
      token grants anything there
- [ ] No automatic migration or deletion of old Pi-era configs or indexes; the
      opt-in transfer helper is copy-only (see `docs/pi-config-migration.md`)
- [ ] No claim that a publish ran until an actual publish is observed
- [ ] No auto broad staging of unrelated user-owned repo tooling
      (`.coderabbit.yaml`, `.husky/`, `tools/`, etc.)
