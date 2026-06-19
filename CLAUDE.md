# CLAUDE.md
# MindsHub Cowork — build & dev notes

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Stack

Electron 39 + Vite + React 19 + Tailwind desktop app with a FastAPI Python sidecar (`cowork-server`) managed via `uv`.

## Commands

### Build & run

```sh
# Full Electron build → release/mac-arm64/Minds Cowork.app
PATH="/opt/homebrew/opt/node@20/bin:$PATH" npm run pack

# Dev mode — hot-reloads renderer (needs cowork-server running separately)
- Output: `release/mac-arm64/MindsHub Cowork.app`
- Confirm with: `stat -f "%Sm" -t "%H:%M:%S" "release/mac-arm64/MindsHub Cowork.app"`
- Code-sign warnings ("0 valid identities found") are expected in dev — ignore.
- Build is the only way to verify Python server changes; the renderer is bundled into the same artifact.

## Dev mode (renderer only, faster iteration)

```sh
PATH="/opt/homebrew/opt/node@20/bin:$PATH" npm run dev

# Web SPA (no Electron) — spins up cowork-server + Vite on http://localhost:5173/
npm run dev:web
npm run build:web   # → dist/renderer-web/
```

Confirm build timestamp: `stat -f "%Sm" -t "%H:%M:%S" "release/mac-arm64/Minds Cowork.app"`

Code-sign warnings ("0 valid identities found") are expected in dev — ignore.

### Type checking

```sh
# Main process (Electron/Node)
npx tsc -p tsconfig.main.json --noEmit

# Renderer (React/Vite) — tsc doesn't emit, Vite handles bundling
npx tsc --noEmit
```

### Python server

The backend is `cowork-server`, a separate package installed via `uv tool install`. It is **not** vendored in this repo.

```sh
# Dev: run from the sibling cowork-server/ source directory
uv run cowork-server

# Packaged: binary lives in ~/.local/bin/cowork-server (macOS/Linux)
# or %LOCALAPPDATA%/bin/cowork-server.exe (Windows)
```

FastAPI runs loopback-only at `127.0.0.1:26866`. CORS is locked to the renderer origin.

#### Install source & channel

Where cowork-server **and** its `anton-agent` dependency are installed from is centralized in [src/main/server-source.ts](src/main/server-source.ts) — shared by the installer and the auto-updater so they can't disagree (a PyPI updater must never clobber a git install, and vice-versa).

Default: **git, branch `main`** for both. Override via env (the parent `minds` repo sets these while developing; a release pins a tag or flips to PyPI):

| Env var | Default | Effect |
|---|---|---|
| `COWORK_SERVER_CHANNEL` | `git` | `git` = install from repo; `pypi` = published wheel (release) |
| `COWORK_SERVER_REF` | `main` | cowork-server branch / tag / commit (git channel) |
| `ANTON_REF` | `main` | anton branch / tag / commit — applied via `uv ... --with`, overriding cowork-server's `tool.uv.sources` pin |
| `COWORK_SERVER_PACKAGE` | — | escape hatch: a literal `uv` spec (local path, custom URL); wins over all |

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

The installer ([src/main/installer.ts](src/main/installer.ts)) handles first-run: Xcode CLT, git, uv, cowork-server, verify, start. Minimum server version: `0.1.9`.

### OTA updates

- **UI**: CI publishes `dist/renderer/` as `ui-bundle.tar.gz` to `mindsdb/antontron-releases`. Main process fetches + caches in `~/Library/Application Support/anton/ui-cache/` (see [src/main/ui-updater.ts](src/main/ui-updater.ts)).
- **Server**: source-aware (see [src/main/server-updater.ts](src/main/server-updater.ts)). A **git** install updates by re-pulling the configured branch/tag HEAD (trigger = changed remote commit SHA via `git ls-remote`) for cowork-server **and** anton; a **PyPI** install updates by version comparison + `uv tool install --upgrade`. It detects which from the tool venv's `direct_url.json`.
- Both have rollback on failure. Disable server auto-update with `COWORK_SERVER_DISABLE_AUTOUPDATE=1`. Bypass UI updates with `DEV_MODE=full` in `~/.anton/.env`.

### User config

Settings live in `~/.anton/.env` (API keys, consent flags, provider choice). Server state: `~/.anton/cowork/state.json`.

### Theming

Dark/light via `body[data-theme="dark"]` selector. Colors defined as CSS variables (`--bg`, `--surface`, `--ink`, `--accent`, …) and aliased in [tailwind.config.js](tailwind.config.js). Tailwind's preflight is disabled to preserve existing inline styles.

## Misc

- DevTools: `ANTON_DEVTOOLS=1` or Cmd+Option+I (auto-open removed).
- Debug Electron with DevTools open from start: `npm run dev:debug`.
- Renderer build-time globals: `__APP_VERSION__`, `__GIT_HASH__`, `__BUILD_TIME__` (baked by Vite).
- Build target toggle: `BUILD_TARGET=web vite build src/renderer` for web SPA.
