# CLAUDE.md
# MindsHub Cowork — build & dev notes

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Stack

Electron 39 + Vite + React 19 + Tailwind desktop app with a FastAPI Python sidecar (`cowork-server`) managed via `uv`.

## Commands

### Build & run

```sh
# Full Electron build → release/mac-arm64/MindsHub Cowork.app
PATH="/opt/homebrew/opt/node@20/bin:$PATH" npm run pack
```

- Output: `release/mac-arm64/MindsHub Cowork.app`
- Confirm with: `stat -f "%Sm" -t "%H:%M:%S" "release/mac-arm64/MindsHub Cowork.app"`
- Code-sign warnings ("0 valid identities found") are expected in dev — ignore.
- Build is the only way to verify Python server changes; the renderer is bundled into the same artifact.

> **iCloud builds** — If the repo lives under `~/Documents` (iCloud Drive), codesign will fail with
> `resource fork, Finder information, or similar detritus not allowed` on the GPU Helper binary.
> The `scripts/strip-xattrs.js` `afterPack` hook clears `com.apple.provenance` and
> `com.apple.FinderInfo`, but iCloud re-tags binaries in the race window before signing.
> Build to `/tmp` instead and copy back:
>
> ```sh
> PATH="/opt/homebrew/opt/node@20/bin:$PATH" \
>   npx electron-builder --mac --arm64 --config.directories.output=/tmp/minds-build
> cp -R /tmp/minds-build/mac-arm64 release/
> ```

### Dev mode (renderer only, faster iteration)

```sh
PATH="/opt/homebrew/opt/node@20/bin:$PATH" npm run dev

# Web SPA (no Electron) — spins up cowork-server + Vite on http://localhost:5173/
npm run dev:web
npm run build:web   # → dist/renderer-web/
```

### Type checking

```sh
npm run typecheck   # main (tsconfig.main.json) + renderer (tsconfig.json) + tests (tsconfig.test.json)
```

### Testing

Vitest runs two projects — `main`
(node env, `src/main` + `src/shared`) and `renderer` (happy-dom env,
`src/renderer`). Tests are **colocated** (`foo.test.ts` beside `foo.ts`);
shared setup lives in `tests/` (autouse env scrub, `TZ=UTC`, network deny —
`fetch` throws unless a test installs its own mock).

```sh
npm test                     # unit + component (fast, no Electron/network)
npm run test:watch           # local TDD loop
npm run test:coverage        # + enforces coverage floors (vitest.config.ts)
npm run test:e2e             # Playwright Electron boot smoke (needs npm run build)
npm run check:cowork-purity  # no direct window.antontron outside platform/host.ts
```

**Norms:**

- **A PR that fixes a bug adds a regression test for it. A PR that adds logic
  adds tests for that logic.** Decision logic goes in pure functions
  (`src/main/update-logic.ts` pattern) tested directly; orchestration gets at
  most 1–2 integration-style tests with mocks.
- Coverage floors in [vitest.config.ts](vitest.config.ts) are **ratcheted from
  measured values — raise them when coverage grows, never lower them to make a
  failing PR pass**. `update-logic.ts` and `server-source.ts` are locked at
  100%.
- Never touch `window.antontron` inside `src/renderer/cowork/` — go through
  [src/renderer/platform/host.ts](src/renderer/platform/host.ts). CI enforces
  this.
- Test files never ship: production tsconfigs exclude `**/*.test.*`; keep it
  that way.
- CI: `tests-unit.yml` gates PRs (typecheck + purity + coverage + renderer
  build); `pack-smoke.yml` and `tests-e2e.yml` run nightly, non-blocking.
- The IPC channel map is snapshot-locked
  (`src/shared/__snapshots__/`) — renaming a channel is a **breaking protocol
  change** (OTA renderers can lag main), not a refactor.

### Python server

The backend is `cowork-server`, a separate package installed via `uv tool install`. It is **not** vendored in this repo.

```sh
# Dev: run from the sibling cowork-server/ source directory
uv run cowork-server

# Packaged: binary lives in ~/.local/bin/cowork-server (macOS/Linux)
# or %LOCALAPPDATA%/bin/cowork-server.exe (Windows)
```

FastAPI runs loopback-only at `127.0.0.1:26866`. CORS defaults to localhost origins only; override with `COWORK_ALLOWED_ORIGINS='["*"]'` for cloud/VPC deployments or an ingress-controlled environment.

**Optional bearer-token authentication** — off by default. Set in `~/.cowork/.env`:

```
COWORK_REQUIRE_AUTH=true
COWORK_AUTH_TOKEN=<your-token>   # omit to auto-generate on first startup
```

When `COWORK_REQUIRE_AUTH=true` and `COWORK_AUTH_TOKEN` is empty, the server generates a cryptographically random token at startup and writes it back to `~/.cowork/.env`. The desktop app reads the same file and injects `Authorization: Bearer <token>` on every API request automatically. The `/api/v1/health/` endpoint is always exempt.

#### Install source & channel

Where cowork-server **and** its `anton-agent` dependency are installed from is centralized in [src/main/server-source.ts](src/main/server-source.ts) — shared by the installer and the auto-updater so they can't disagree (a PyPI updater must never clobber a git install, and vice-versa).

Default: **git, branch `main`** for both. Override via env (the parent `minds` repo sets these while developing; a release pins a tag or flips to PyPI):

| Env var | Default | Effect |
|---|---|---|
| `COWORK_SERVER_CHANNEL` | `git` | `git` = install from repo; `pypi` = published wheel (release) |
| `COWORK_SERVER_REF` | `main` | cowork-server branch / tag / commit (git channel) |
| `ANTON_REF` | `main` | anton branch / tag / commit — applied via `uv ... --with`, overriding cowork-server's `tool.uv.sources` pin |
| `COWORK_SERVER_PACKAGE` | — | escape hatch: a literal `uv` spec (local path, custom URL); wins over all |
| `ANTON_PACKAGE` | — | escape hatch for anton; only honoured when `COWORK_SERVER_PACKAGE` is also set. Must be an absolute path or valid `uv` spec. **Requires** `backend/core_api/pyproject.toml` `[tool.uv.sources]` to be updated to `{ path = "../../core_agent" }` first — uv rejects conflicting URL sources for the same package. |

```sh
# develop against a feature branch of anton + cowork-server:
export COWORK_SERVER_REF=feat/x ANTON_REF=feat/y
# cut a release build (published wheel + PyPI auto-update):
export COWORK_SERVER_CHANNEL=pypi
```

`anton` itself is also a uv git source inside cowork-server's `pyproject.toml` (`[tool.uv.sources] anton-agent = { git = …, branch = "main" }`), which governs `uv sync` / `make dev`. The `ANTON_REF` env override only affects the `uv tool install` (desktop) path.

Sanity-check Python syntax before building (pack bundles files as-is without parsing):

```sh
python3 -c "import ast; ast.parse(open('server/anton_api/<file>.py').read())"
```

## Architecture

### Process model

```
Electron main (Node/TS)
  ├── spawns cowork-server subprocess (src/main/server-process.ts)
  ├── manages OAuth PKCE loopback (src/main/oauth-service.ts)
  ├── handles IPC from renderer (src/main/index.ts)
  └── exposes bridge via contextBridge (src/main/preload.ts → window.antontron)

Electron renderer (React/TS, sandboxed)
  ├── platform abstraction: src/renderer/platform/host.ts  ← all bridge access here
  ├── app routing/lifecycle: src/renderer/App.tsx
  └── chat SPA: src/renderer/cowork/  ← HTTP only, never IPC directly
```

All IPC channel names are defined as constants in [src/shared/ipc-channels.ts](src/shared/ipc-channels.ts). Add new channels there first.

### Dual-mode: Electron vs. Web

The app ships as both an Electron desktop app and a headless web SPA (served by cowork-server). The abstraction lives entirely in [src/renderer/platform/host.ts](src/renderer/platform/host.ts):

- `isElectron` / `isWeb` — runtime flags
- `getApiOrigin()` — `http://127.0.0.1:26866` (Electron) or `window.location.origin` (web)
- `serverInfo/Start/Stop()` — IPC in Electron, no-ops/stubs in web
- `oauthConnect()` — full PKCE flow in Electron, error stub in web

**Never import `window.antontron` directly inside `src/renderer/cowork/`** — every bridge call must go through `host.ts`. Electron-only affordances (server control pill, OAuth IPC, OS shell buttons) are gated behind `host.isWeb`.

### App startup flow

`App.tsx` drives the screen sequence:

1. Loading → check install (`antonInstalled` + `serverDepsReady`)
2. Terms consent → Setup wizard (installer) → Onboarding (provider selection)
3. IntroSequence → CoworkApp (main chat UI)

The installer ([src/main/installer.ts](src/main/installer.ts)) handles first-run: Xcode CLT, git, uv, cowork-server, verify, start. Minimum server version: `0.1.10`.

### OTA updates

- **UI**: CI publishes `dist/renderer/` as `ui-bundle.tar.gz` to `mindsdb/antontron-releases`. Main process fetches + caches in `~/Library/Application Support/anton/ui-cache/` (see [src/main/ui-updater.ts](src/main/ui-updater.ts)).
- **Server**: source-aware (see [src/main/server-updater.ts](src/main/server-updater.ts)). A **git** install updates by re-pulling the configured branch/tag HEAD (trigger = changed remote commit SHA via `git ls-remote`) for cowork-server **and** anton; a **PyPI** install updates by version comparison + `uv tool install --upgrade`. It detects which from the tool venv's `direct_url.json`.
- Both have rollback on failure. Disable server auto-update with `COWORK_SERVER_DISABLE_AUTOUPDATE=1`. Bypass UI updates with `DEV_MODE=full` in `~/.anton/.env`.

### User config

Settings live in `~/.anton/.env` (API keys, consent flags, provider choice). Server state: `~/.anton/cowork/state.json`.

### Theming

Dark/light via `body[data-theme="dark"]` selector. Colors defined as CSS variables (`--bg`, `--surface`, `--ink`, `--accent`, …) and aliased in [tailwind.config.js](tailwind.config.js). Tailwind's preflight is disabled to preserve existing inline styles.

### Renderer component layering

- **`components/ui/`** — pure primitives (buttons, inputs, cards, menu/modal primitives, pills, spinners). No product-specific logic.
- **`components/`** — reusable app-level compositions (`OverflowMenu`, `ConfirmModal`, `TaskMenu`) that combine primitives with Cowork icons/labels/patterns.
- **Feature folders** (`rail/`, `task/`, `project/`, etc.) — domain-specific components. Prefer shared `Menu` or `OverflowMenu` over hand-rolling portals/outside-click/keyboard handling.

## Misc

- DevTools: `ANTON_DEVTOOLS=1` or Cmd+Option+I (auto-open removed).
- Debug Electron with DevTools open from start: `npm run dev:debug`.
- Renderer build-time globals: `__APP_VERSION__`, `__GIT_HASH__`, `__BUILD_TIME__` (baked by Vite).
- Build target toggle: `BUILD_TARGET=web vite build src/renderer` for web SPA.
