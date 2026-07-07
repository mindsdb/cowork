# QA & Testing Plan — MindsHub Cowork

Status: **implemented through Phase 5** (2026-07-03). Phases 0–5 of §8 are
live: Vitest harness (77 unit/component tests), PR CI (`tests-unit.yml`),
nightly `pack-smoke.yml` + `tests-e2e.yml`, the cowork purity guard, and
coverage floors in `vitest.config.ts`. Still open: the preload↔host
bridge-shape contract check (§5a.5) and running the §12 manual release smoke
per release. Developer-facing norms live in CLAUDE.md → Testing.

---

## 1. Where we are today

- **0 test files, 0 test tooling.** No `test` script in `package.json`, no test
  runner in `devDependencies`, no `__tests__` in source (the one under
  `dist/main/` is build output).
- The app is Electron 39 + Vite 6 + React 19 + Tailwind, with a **separate**
  Python backend (`cowork-server`) that is *not* vendored here. So this plan
  covers the **Electron/renderer** codebase only. Backend tests belong in the
  `cowork-server` repo and are out of scope here (see §9).
- Two runtime targets share the renderer: **Electron desktop** and a **headless
  web SPA**. The abstraction seam is [src/renderer/platform/host.ts](src/renderer/platform/host.ts).

Because there is nothing to preserve, we can choose conventions cleanly.

---

## 2. Goals & principles

1. **Fast feedback first.** The default `npm test` must run in seconds with no
   Electron launch, no Python, no network. Slow/E2E suites are opt-in.
2. **Test the risky logic, not the framework.** Prioritize code where a bug is
   silent and expensive — the install-source resolver, the auto-updater
   (git-vs-PyPI detection, rollback), version comparison, IPC contract.
3. **One runner.** Use **Vitest** everywhere (unit + component). We are already
   on Vite, so config/transforms/ESM are shared for free.
4. **Deterministic.** No test may depend on the real filesystem outside a temp
   dir, real `git`/`uv` binaries, real network, wall-clock time, or the host's
   env vars. Everything risky is injected or mocked. Pin the environment
   globally so a result never depends on the machine: **`TZ=UTC`** and a fixed
   **`LANG`/locale** in the test env (date/`toLocaleString` output is otherwise
   host-dependent), and seed any randomness. Scrub host env vars before every
   test rather than trusting a clean shell (see §6).
5. **Colocate, don't quarantine.** Tests live next to the code they cover
   (`server-source.test.ts` beside `server-source.ts`), so they move/rename/
   delete with it.
6. **Grow the pyramid bottom-up.** Many unit tests, some component tests, a
   thin layer of E2E smoke tests. Don't invert it.

---

## 3. Tooling decisions

Reflecting current best practice for a Vite + React 19 + Electron stack.

| Layer | Tool | Why |
|---|---|---|
| Unit (main process, shared, pure renderer logic) | **Current Vitest major** | Same Vite pipeline; native TS/ESM; fast watch mode. The de-facto standard for Vite projects. |
| Component / hooks (React) | **Vitest + @testing-library/react 16 + @testing-library/jest-dom** | Standard, framework-agnostic, accessibility-first queries; user-centric assertions. |
| DOM environment (default) | **happy-dom** | Fastest environment; sufficient for hooks + most component tests. |
| High-fidelity component tests (opt-in, later) | **Vitest Browser Mode** (Playwright provider) | Runs component tests in a **real** browser instead of a simulated DOM. Use only for the handful of components where happy-dom fidelity isn't enough — don't add it in Phase 0. |
| E2E (real app) | **Playwright** (`_electron` API) | First-class Electron support; can also drive the web SPA build. Trace-on-retry for debugging flakes. |
| Coverage | **Vitest `--coverage` (v8 provider)** | Built in; v8 provider is fast and now AST-accurate. PR reporting via `davelosert/vitest-coverage-report-action`. |

**Vitest config style:** use the `projects` field **inside** the main
`vitest.config.ts` (Vitest 3+). The old standalone `vitest.workspace.ts` file is
deprecated — don't use it.

Phase 0 `devDependencies` (pin to the current major at implementation time):
`vitest`, `@vitest/coverage-v8`, `@testing-library/react`, `@testing-library/jest-dom`,
`@testing-library/user-event`, and `happy-dom`.

Defer `@vitest/browser` + `playwright` until Phase 4 or until a specific
component proves happy-dom is not enough.

---

## 4. Project layout & config

```
vitest.config.ts                 # root: two projects (main, renderer)
.github/
  workflows/tests-unit.yml               # PR CI (Phase 0)
  actions/retry/action.yml       # flaky-install retry (Phase 0.5)
tests/
  setup-env.ts                   # SHARED: autouse env scrub + TZ/locale + fetch deny (both projects)
  setup-renderer.ts              # renderer-only: jest-dom matchers, RTL cleanup
  helpers/                       # shared factories, temp-dir + env sandbox utils
src/main/*.test.ts               # main-process unit tests (node env)
src/shared/*.test.ts             # shared unit tests (node env)
src/renderer/**/*.test.{js,jsx,ts,tsx}
                                  # renderer unit/component tests (happy-dom env)
e2e/                             # Playwright specs (added later)
  *.spec.ts
```

Use Vitest **projects** (workspace) so main-process tests run in the `node`
environment and renderer tests in `happy-dom` — one command, correct env per file:

```ts
// vitest.config.ts (sketch)
export default defineConfig({
  test: {
    coverage: { provider: 'v8', reporter: ['text', 'html'] },   // root-only option
    projects: [
      { test: { name: 'main',     environment: 'node',
                include: ['src/main/**/*.test.ts', 'src/shared/**/*.test.ts'],
                setupFiles: ['tests/setup-env.ts'] } },
      { test: { name: 'renderer', environment: 'happy-dom',
                include: ['src/renderer/**/*.test.{js,jsx,ts,tsx}'],
                setupFiles: ['tests/setup-env.ts', 'tests/setup-renderer.ts'] } },
    ],
  },
})
```

> **`setupFiles` must be listed in *each* project — do not rely on root-level
> inheritance.** In Vitest's `projects` model each project resolves as its own
> config, and root-level project-scoped options like `setupFiles` do **not**
> reliably merge into projects across versions. Putting the env setup only at the
> root (or only under `renderer`) silently skips it for `main` tests — the exact
> failure mode where a developer's shell env leaks into updater/installer tests.
> Split the two concerns: **`tests/setup-env.ts`** (shared — autouse env scrub +
> `TZ`/locale, §6) in both projects; **`tests/setup-renderer.ts`** (jsdom matchers,
> RTL cleanup) in renderer only.

`package.json` scripts to add:

```jsonc
"test":          "vitest run",          // CI: one-shot
"test:watch":    "vitest",              // local dev
"test:ui":       "vitest --ui",         // optional
"test:coverage": "vitest run --coverage",
"typecheck":     "npm run typecheck:main && npm run typecheck:renderer",
"typecheck:main": "tsc -p tsconfig.main.json --noEmit",
"typecheck:renderer": "tsc --noEmit",
"test:e2e":      "playwright test",     // added in Phase 4, NOT part of `test`
```

---

## 5. What to test, by layer

### 5a. Main-process unit tests (highest ROI — start here)

> **Testability refactor budget (rule).** Before testing updater/installer
> *orchestration*, extract the pure **decision logic** into small
> exported/internal functions (which channel? update needed? roll back?). Tests
> then cover those decision functions **directly**, with only one or two
> integration-style tests exercising the orchestration wrapper. This is an
> explicit, sanctioned pre-test refactor — don't fight private helpers and
> brittle `vi.mock` chains to test through the top-level entry point. Keep the
> refactors minimal and behavior-preserving (see §10.4).

These are near-pure TS modules with real consequences. Priority order:

1. **[src/main/server-source.ts](src/main/server-source.ts)** — the install-source
   resolver. Small, pure, and the exact place a past bug let the PyPI updater
   clobber a git install. Test matrix over env vars:
   - `getChannel()`: default → `git`; `COWORK_SERVER_CHANNEL=pypi` → `pypi`;
     case-insensitive; garbage value → `git`.
   - `getCoworkRef()` / `getAntonRef()`: default `main`; env override;
     whitespace-only → falls back to `main`; build-ref fallback path.
   - `getInstallSpec()` — the important one:
     - git channel, `antonRef=main` → **no** `--with` arg (regression guard for
       the "conflicting URLs" bug that broke every fresh install).
     - git channel, non-default `ANTON_REF` → injects one `--with` pair.
     - `COWORK_SERVER_PACKAGE` escape hatch wins over channel; `ANTON_PACKAGE`
       only honored alongside it.
     - pypi channel → `cowork-server>=<MIN_VERSION>`, no `--with`.
     - explicit `coworkRef`/`antonRef` opts (rollback path) override env.
   - Requires an **env sandbox** helper (save/clear/restore `process.env`).

2. **[src/main/server-updater.ts](src/main/server-updater.ts)** — channel
   detection from `direct_url.json`, git-vs-PyPI update decision, version
   comparison, rollback-on-failure. Inject/mock `fs`, `child_process`
   (`git ls-remote`, `uv`), so no real binaries/network. This is the second
   highest-risk module.
   - Extract or expose a small injected core for the currently-private helpers
     (`readVcsInfo`, `lsRemote`, `compareVersions`, PyPI update decision,
     git rollback decision). Avoid testing only through `maybeUpdateServer()`,
     which otherwise requires too much module mocking.
   - Add fixtures for `direct_url.json`: git install, PyPI install, malformed
     JSON, missing `vcs_info`, missing dist-info, and multiple dist-info
     entries where the correct package must be selected.

3. **[src/main/installer.ts](src/main/installer.ts)** — extract and test the pure
   helpers (version parsing/compare, min-version gate `0.1.10`, command
   construction). The orchestration that shells out stays behind mocks or is
   left to E2E.

4. **[src/main/ui-updater.ts](src/main/ui-updater.ts)** — cache path resolution,
   version/SHA gating, tarball extract flow (mock `fs` + fetch). Rollback path.
   Lower priority while OTA UI is disabled; move it earlier if that flag is
   re-enabled.

5. **[src/shared/ipc-channels.ts](src/shared/ipc-channels.ts)** — trivial but
   worth a guard test: channel name constants are unique and stable (renaming a
   channel is a breaking main↔renderer contract change).
   Also add a bridge-shape contract check so `preload.ts` and
   `src/renderer/platform/host.ts` stay aligned as IPC methods are added,
   renamed, or removed.

**Mocking strategy for main:** prefer **dependency injection** where a small
refactor allows (pass an exec/fs interface), fall back to `vi.mock('node:fs')`
/ `vi.mock('node:child_process')`. Never touch the real HOME dir — point any
path logic at an `os.tmpdir()` sandbox created/removed per test.

### 5b. Renderer unit / component tests

1. **[src/renderer/platform/host.ts](src/renderer/platform/host.ts)** — the
   Electron-vs-web seam. Test `isElectron`/`isWeb`, `getApiOrigin()` (127.0.0.1
   vs `window.location.origin`), and that web-mode stubs return the documented
   no-op/error shapes. Drive it by mocking `window.antontron` presence and
   `window.location`. Because `host.ts` computes the bridge at import time,
   tests must set up `window.antontron` first, then dynamically import the
   module after `vi.resetModules()`.
2. **Pure helpers** under `src/renderer/lib/` and `src/renderer/cowork/lib/`
   (formatting, parsing, state reducers) — cheap, high-value unit tests.
3. **Custom hooks** in `src/renderer/cowork/hooks/` — with
   `@testing-library/react`'s `renderHook`. Mock `host.ts`, not `fetch`
   directly, so tests exercise the same seam the app uses.
4. **A few representative components** (`components/ui/` primitives first —
   buttons/modals/menus — then one composed feature view). Assert behavior
   (renders, click handlers, disabled/gated states), not markup snapshots.

**Do not** snapshot-test large components; they rot and nobody reads the diffs.
Prefer explicit assertions.

### 5c. E2E smoke tests (thin, later)

Playwright `_electron.launch()` against the built app. Keep to a handful of
**smoke** flows, not exhaustive coverage:
- App boots to the expected first screen (loading → terms/onboarding).
- Renderer loads without console errors.
- (If feasible in CI) server-control affordances render in Electron mode.
E2E that needs a live `cowork-server` + real provider keys is **manual/nightly**,
not part of PR CI.

**Packaged-artifact smoke — two tiers, and the cheap one comes early.**
Source-level tests never exercise what `electron-builder` actually ships — the
renderer is bundled into the `.app`, and packaging can silently drop or misplace
assets (fonts, logos, the built `index.html`, `renderer-web/`). This is the class
of break `tsc` and unit tests structurally cannot catch — see the analogous
"typecheck ≠ build" gap in §7. Packaging bugs are high-severity (codesign, the
iCloud xattr issue in CLAUDE.md), so split it:

- **Tier 1 — file-existence smoke (Phase 2–3, not Phase 4).** `npm run pack`
  (which is `electron-builder --dir`, no dmg/notarize) then assert the packaged
  output contains the **main entry**, the **renderer `index.html` + assets**, and
  the expected resource dirs. Fast, no Electron launch, no Playwright. Runs as
  its own job — **cannot be in the fast PR gate**: `--mac` needs a **macOS
  runner** and is minutes-scale, so it's a separate/nightly job that can start as
  early as Phase 2–3.
- **Tier 2 — launch smoke (Phase 4).** Playwright `_electron.launch()` against
  the packaged app: the bundle actually loads and boots without console errors.

Both stay out of the fast PR CI. Live-`cowork-server` / real-provider-key flows
remain manual/nightly.

---

## 6. Cross-cutting test infrastructure

The first three are **autouse** — they live in **`tests/setup-env.ts`**, the
shared setup wired into *both* Vitest projects (§4), and run before every test.
The rest are **opt-in helpers** a test imports when it needs them.

- **Autouse env scrub** (runs before *every* test — not opt-in):
  unconditionally clear the vars that change behavior or could reach a real
  service — `COWORK_SERVER_*`, `ANTON_*`, `DEV_MODE`, `COWORK_ALLOWED_ORIGINS`,
  and any provider/API keys. A developer's shell (or a leaky earlier test) must
  never silently flip a channel, hit a real endpoint, or change a default. Tests
  that need a var set do so explicitly. Belt-and-suspenders: also set the same
  keys to empty in the CI job env (§7). This is the *default*; the per-test env
  sandbox below is for scoped overrides on top of the scrubbed baseline.
- **Network deny (hard invariant)**: in `setup-env.ts`, replace `global.fetch`
  (and `XMLHttpRequest` in the renderer project) with a stub that **throws** on
  any call, so an unmocked network access fails the test loudly instead of
  silently hitting the wire or hanging. A test that legitimately needs a
  response opts in by installing its own mock/`vi.fn` for that call. For
  Node-side code (updater/installer), the network path is `git ls-remote`/`uv`
  via `child_process` — there is no clean global trap for that, so it is instead
  denied *by construction*: those modules take an injected exec/fs interface
  (§10.4) and tests pass a fake runner, leaving the real `spawn` no way to fire.
- **Global determinism** (autouse): `process.env.TZ = 'UTC'`, fixed locale, and a
  fixed seed for any randomness — so date formatting and ordering are
  host-independent (see §2).
- **Env sandbox helper** (`tests/helpers/env.ts`): snapshot `process.env`, apply
  overrides, restore in `afterEach`. For tests that need a specific var set.
- **Temp-dir helper**: `mkdtemp` under `os.tmpdir()`, auto-cleanup. For anything
  touching `~/.anton`, `state.json`, ui-cache.
- **Fake exec/git/uv**: a small injectable command runner returning canned
  stdout/exit codes, so updater/installer logic is tested without binaries.
- **`window.antontron` factory**: builds a mock preload bridge for renderer
  tests that need Electron mode.
- **Fake timers** (`vi.useFakeTimers`) for any polling/retry/backoff logic.
- **Import-state helper** for renderer modules that read globals at import time:
  reset modules, mutate `window`, import dynamically, and clean up after each
  test.
- **Purity/static guard**: add an npm script that fails if cowork renderer code
  touches `window.antontron` outside `src/renderer/platform/host.ts`. This can
  be a tiny script at first and later move into ESLint if/when linting is added.
  Name it **`check:cowork-purity`** and reconcile the dangling reference in
  [host.ts:8-9](src/renderer/platform/host.ts#L8), whose comment already claims
  this guard exists — it does **not** today (no ESLint config, no `lint` script,
  no eslint dep), and the comment says `pnpm` although this repo is **npm**
  everywhere. Wire it into the CI job (§7) so the claim becomes true.

---

## 7. CI integration (GitHub Actions)

### Current state

There is **no PR CI that runs tests or typecheck today.** Existing workflows are
all build/release/publish:

- `dev-build-installer.yml` — the only `pull_request` trigger, but gated behind a
  `signed-macos-pkg` / `signed-windows-ev` label; builds installers, runs no tests.
- `build-macos-pkg.yml`, `build-windows-installer.yml`, `prod-build-installer.yml`,
  `upload-installer-to-s3.yml` — `workflow_call` reusable build jobs.
- `staging-build-installer.yml`, `release.yml`, `publish-ui.yml` — `push` /
  dispatch release/publish.
- `cla.yml` — CLA check on `pull_request_target`.

Convention: **Node 20** via `actions/setup-node` with npm. We follow it.

### New workflow: `.github/workflows/tests-unit.yml`

A dedicated, fast, **required** check that runs on every PR and on push to `main`.
This is the automation this plan hinges on — it must exist by end of Phase 0.

```yaml
name: CI
on:
  pull_request:
    paths-ignore: ['**/*.md', 'docs/**']   # docs-only PRs skip CI
  push:
    branches: [main]
permissions:                       # least privilege; job-level bump for PR comment
  contents: read
concurrency:                       # cancel superseded PR runs; never cancel main
  group: ci-${{ github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}
jobs:
  test:
    runs-on: ubuntu-latest         # no macOS runner needed — unit/component only
    timeout-minutes: 10            # backstop against a hung run eating minutes
    env:                           # belt-and-suspenders: no real API calls even if a test leaks
      COWORK_SERVER_CHANNEL: ""
      ANTHROPIC_API_KEY: ""
      OPENAI_API_KEY: ""
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - uses: ./.github/actions/retry      # native/registry install flakes self-heal
        with:
          command: npm ci
      - name: Typecheck (main + renderer)
        run: npm run typecheck
      - name: Unit + component tests + coverage
        run: npm run test:coverage     # no Electron, no Python, no network
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: coverage
          path: coverage/

  # Real `vite build` of the renderer. `tsc --noEmit` does NOT exercise Vite's
  # module resolution/bundling — an unresolvable package export or bad asset
  # import passes typecheck and only breaks at pack/release time. This job
  # fails that class of break in CI. (Renderer build only — not the full
  # electron-builder pack, which is slower and lives in the release workflows.)
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - uses: ./.github/actions/retry
        with:
          command: npm ci
      - run: npm run build:renderer
```

Notes / rationale:
- **Ubuntu, not macOS** — the unit/component suite has no native/Electron
  dependency, so it runs on the cheapest/fastest runner. E2E (Phase 4) will need
  a separate job (and possibly macOS) since it launches the real app.
- **Node 22** — Node 20 reached **end-of-life in April 2026**, so pinning to it
  means an unsupported runtime. 22 is supported and matches the actual local dev
  environment (`node -v` → 22.x), avoiding test-on-X/ship-on-Y drift. The
  existing **release workflows still pin Node 20** and should be migrated to 22
  in a separate PR — flagged, not bundled here.
- **Typecheck is in the same job** — cheap, and `tsc --noEmit` (both configs) is
  already the documented static gate in CLAUDE.md. Folding it into CI closes the
  gap where type errors only surface at build/release time.
- **Coverage runs the suite once** — avoid `npm test` followed by
  `npm run test:coverage`, which doubles CI time without adding signal.
- **`cancel-in-progress` only on PRs** — superseded PR runs are cancelled to
  keep the queue cheap, but pushes to `main` never cancel each other (each merge
  commit must get a full, recorded result).
- **`build` job** catches the "typecheck ≠ build" gap (see the job comment); it
  runs in parallel with `test`.
- **`timeout-minutes` on every job** — a hung process can otherwise burn the
  full 6h runner budget.
- **Empty API keys in job env** — belt-and-suspenders with the autouse env
  scrub (§6): even a leaked call can't reach a real provider.
- **Coverage is report-only and artifact-only in Phase 0** — uploaded as an
  artifact, no PR comment. The comment action (`davelosert/vitest-coverage-report-action`)
  needs `pull-requests: write`; deferring it keeps this workflow at
  `contents: read` and adds no permission/security surface up front. Add the
  comment in Phase 2/5 *if* people actually read coverage on PRs.
- Keep the `test` job under **~2 min**; if it creeps up, split typecheck into
  its own parallel job.

**Why a single flat workflow, not an orchestrator.** A sibling repo uses a
`detect-changes` orchestrator that fans out per-package `workflow_call`
sub-workflows behind one aggregate gate — the right shape for a **monorepo** with
independently-changing packages. Cowork is a **single package** (`src/main` +
`src/renderer`, one `package.json`), so that machinery is pure overhead here. We
keep one flat `tests-unit.yml`; the only path-gating we borrow is the cheap
`paths-ignore` docs skip above. Revisit the orchestrator only if this repo ever
splits into multiple independently-built packages.

**Retry composite action (`.github/actions/retry`).** `npm ci` and native
module installs (node-gyp header fetches, Electron binary downloads) fail
intermittently on transient network/toolchain blips. A tiny composite action
retries the command N times so CI self-heals instead of needing a manual re-run.
It's a **Phase 0.5** hardening step — Phase 0's `tests-unit.yml` can ship with a plain
`- run: npm ci`, and 0.5 swaps in `uses: ./.github/actions/retry` (the YAML above
shows the post-0.5 target state):

```yaml
# .github/actions/retry/action.yml
name: Retry a flaky command
description: Run a shell command, retrying on non-zero exit (for flaky installs).
inputs:
  command:  { description: Shell command to run and retry, required: true }
  attempts: { description: Max attempts, default: "3" }
  delay:    { description: Seconds between attempts, default: "10" }
runs:
  using: composite
  steps:
    - shell: bash
      env: { _CMD: ${{ inputs.command }}, _ATTEMPTS: ${{ inputs.attempts }}, _DELAY: ${{ inputs.delay }} }
      # command passed via env, never interpolated into the script body, so
      # quotes/specials can't break or inject into the runner.
      run: |
        set -uo pipefail
        n=0
        while :; do
          n=$((n + 1))
          if bash -c "$_CMD"; then exit 0; fi
          if [ "$n" -ge "$_ATTEMPTS" ]; then echo "::error::failed after $n attempts: $_CMD"; exit 1; fi
          echo "::warning::attempt $n failed; retrying in ${_DELAY}s"; sleep "$_DELAY"
        done
```

**Supply-chain hardening (2026 best practice).** This app handles OAuth tokens
and auto-updates itself, so CI is part of the trust boundary. For this new
workflow:
- **Pin third-party actions to a full commit SHA**, not a floating tag
  (`uses: davelosert/vitest-coverage-report-action@<sha>  # v2.x`). First-party
  `actions/*` may stay on major tags. Adopt Dependabot's `github-actions`
  ecosystem to keep pinned SHAs current.
- Set an explicit least-privilege **`permissions:`** block at the workflow top.
  Phase 0 needs only `contents: read`. Add `pull-requests: write` **later and
  scoped to a single job** if/when the coverage-comment action is introduced
  (Phase 2/5) — not up front.
- `npm ci` (lockfile-exact), never `npm install`, in CI.

### Making it required

Once `tests-unit.yml` is green and stable on a few PRs, add the `test` job to the repo's
**branch protection → required status checks** for `main`. Until then it runs
non-blocking so we can shake out flakiness.

### Coverage policy

- **Artifact-only in Phase 0** — upload the coverage report, no PR comment, no
  gate. A global % gate on day one incentivizes low-value tests.
- **Phase 2/5**: add the PR-comment action (with the scoped `pull-requests: write`)
  only if it's read, then introduce a **soft floor on `src/main/`** (e.g. 70%)
  and ratchet upward. The floor is Phase 5.

### E2E in CI

Playwright/Electron E2E (Phase 4) starts as a **separate, non-blocking** job (or
nightly `schedule`), because it needs a full build and is slower/flakier. Once a
tiny boot smoke is stable, it can be promoted to a required check. Flows needing
a live `cowork-server` + real provider keys stay manual/nightly.

---

## 8. Phased rollout

Phase 0 is deliberately **minimal** so the first PR is small enough to merge
quickly. Everything that isn't strictly needed to get one real test running
green in CI is pushed to 0.5 or later.

| Phase | Scope | Exit criteria |
|---|---|---|
| **0. Harness + CI (minimal)** | Vitest with 2 projects (main + renderer, §4); scripts `test` / `typecheck` / `test:coverage` / `build:renderer`; `tests-unit.yml` running on every PR (plain `npm ci`, artifact-only coverage); a **minimal per-test env sandbox** helper; **exactly one real regression test**. | `npm run test` runs both projects · `npm run typecheck` runs main+renderer · `npm run build:renderer` runs in CI · CI runs on every PR · the one test asserts *`server-source` default git install must not add `--with`*. |
| **0.5 Hardening** | `.github/actions/retry` (swapped into `tests-unit.yml`); `tests/setup-env.ts` wired into **both** projects — autouse env scrub, `TZ=UTC`/locale, hard `fetch` deny (§6). | Env scrub + network-deny provably run in main-process tests, not just renderer. |
| **1. Core logic** | Full unit coverage of `server-source.ts` + `ipc-channels.ts`. | Every `getInstallSpec` branch + the IPC contract guard covered. |
| **2. Updaters/installer** | Decision-logic extraction + tests for `server-updater.ts`, `ui-updater.ts`, pure `installer.ts` helpers (injected exec/fs, §5a rule). **Tier-1 packaging file-smoke** job (§5c) can start here. | Git-vs-PyPI detection + rollback paths covered; packaged output has main entry + renderer assets. |
| **3. Renderer** | `host.ts` seam, renderer `lib/` helpers, key hooks, a few `ui/` primitives, and the cowork purity/static guard. | happy-dom project green; host abstraction tested in both modes; direct bridge access blocked outside `host.ts`. |
| **4. E2E + launch smoke** | Playwright Electron launch + boot smoke (Tier-2, §5c), separate CI job. | App boots headless without console errors. |
| **5. Enforce** | Coverage PR comment (if read) + soft floor on `src/main/`, ratchet. Document "add a test with your PR" norm. | Coverage floor active; norm in CONTRIBUTING/CLAUDE.md. |

The one Phase 0 test is a **real** `server-source.ts` regression test, never a
throwaway placeholder. 0.5 onward follow as capacity allows.

---

## 9. Explicitly out of scope (here)

- **`cowork-server` (Python/FastAPI) tests** — belong in that repo (`pytest`),
  not this one. The desktop repo only sanity-checks Python *syntax* pre-build
  (per CLAUDE.md); functional backend testing is separate.
- **Anton agent** testing — its own repo.
- Full-coverage E2E of provider/OAuth flows requiring live credentials — manual
  QA / nightly, not PR CI.

---

## 10. Decisions (resolved — 2026 best practice)

Locked in per "do whatever is current best practice." No blockers remain for
Phase 0.

1. **Renderer DOM env → happy-dom** as the default (fastest). For the few
   components where simulated-DOM fidelity isn't enough, add **Vitest Browser
   Mode** later for those specific tests rather than adding the dependency in
   Phase 0.
2. **Coverage → artifact-only** in Phase 0 (no PR comment, so the workflow stays
   `contents: read`); add the PR comment in Phase 2/5 if read, and a soft floor
   on `src/main/` in Phase 5. No hard gate on day one.
3. **E2E → separate/nightly job at first**. Promote only a tiny stable boot smoke
   to required status later if it proves non-flaky.
4. **DI over deep mocks** → yes, make **minimal** refactors to `server-updater.ts`
   / `installer.ts` to inject an exec/fs interface. Injection is the current
   best-practice default; reserve `vi.mock` of `node:*` for cases not worth a
   refactor.
5. **CI supply-chain** → SHA-pin third-party actions + Dependabot `github-actions`
   updates + least-privilege `permissions:` (see §7).
6. **Node version** → **Node 22**. Node 20 is EOL (April 2026); 22 is supported
   and matches local dev. Release workflows (still on 20) migrate separately.

---

## 11. Prior art

Several patterns here are adapted from a mature sibling repo's CI
(`hermes-agent`), fitted to a single-package Electron/TS app:

- **retry composite action** for flaky `npm ci`/native installs (§7).
- **real build job** because typecheck ≠ build (§7).
- **autouse env scrub + `TZ=UTC`/locale pinning** for determinism (§2, §6).
- **packaged-artifact smoke test** — test what's shipped, not just `src/` (§5c).
- **`cancel-in-progress` on PRs only**, per-job `timeout-minutes`, docs-only
  `paths-ignore` (§7).

Deliberately **not** adopted (monorepo- or Python-specific): the
`detect-changes` orchestrator + `workflow_call` fan-out (we're single-package —
see §7), per-file subprocess isolation (Vitest isolates per worker), duration-
based test sharding (premature at this scale), and Python tooling (ruff/ty,
`uv.lock` checks, `.pth`/install-hook supply-chain scanners). One principle worth
keeping regardless: **automated checks must stay high-signal** — a gate that
fires on nearly every PR trains reviewers to ignore it.

---

## 12. Manual release smoke (NOT PR CI)

Automated tests cannot see the failure modes that hurt a desktop app most:
codesigning/notarization, the iCloud xattr detritus issue (CLAUDE.md), OS-level
install/upgrade, and OAuth token persistence across restarts. This is a **human
checklist run per release**, not a CI gate — it complements, never replaces, the
automated suite. Several items map directly to the two known top user-pain
issues (API key breaking on update; server won't start), so they are not
optional.

Per release, on a machine that is **not** the build machine:

- [ ] Fresh install on macOS **Apple Silicon** and **Intel**
- [ ] Fresh install on **Windows**
- [ ] **Upgrade** from the previous released version (settings/keys survive)
- [ ] OAuth login **and token persistence** — reconnect not required after restart
- [ ] App **restart after an update** applies cleanly
- [ ] `cowork-server` **installs from a clean machine** (no dev toolchain present)
- [ ] **Recovery when server install/update fails** — app degrades gracefully,
      surfaces a real error, and offers a retry (not a silent hang)
- [ ] **Uninstall / reinstall** leaves no broken state in `~/.anton`

Keep this list in the release runbook and check it before publishing.
