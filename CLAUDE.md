# Anton Cowork — build & dev notes

Electron + Vite + React + Tailwind desktop app with a FastAPI Python sidecar.
Cross-platform (macOS + Windows) shell that wraps the `anton` Python package; the Electron main process manages the sidecar at `127.0.0.1:26866`. The same React SPA also builds as a headless web app — both paths go through a single platform abstraction so the SPA never branches on host directly.

> Workspace-level navigation lives in `antonworld/.claude/CLAUDE.md`. Detailed architecture notes are at the bottom of this file.

## Build the app

```sh
PATH="/opt/homebrew/opt/node@20/bin:$PATH" npm run pack
```

- Output: `release/mac-arm64/Anton.app`
- Confirm with: `stat -f "%Sm" -t "%H:%M:%S" release/mac-arm64/Anton.app`
- Code-sign warnings ("0 valid identities found") are expected in dev — ignore.
- Build is the only way to verify Python server changes; the renderer is bundled into the same artifact.

## Dev mode (renderer only, faster iteration)

```sh
PATH="/opt/homebrew/opt/node@20/bin:$PATH" npm run dev
```

Hot-reloads the React renderer; the Python sidecar still needs the packaged binary OR a manual `python server/main.py` running on `127.0.0.1:26866`.

## Server

```sh
python server/main.py
```

Loopback-only FastAPI; CORS locked to the renderer origin. Default port `26866`.

## Web build (headless SPA — no Electron)

```sh
npm run dev:web    # boots FastAPI sidecar + Vite, opens http://localhost:5173/
npm run build:web  # produces dist/renderer-web/
```

`dev:web` mirrors how Electron starts its python sidecar — the Vite
process is held back until `/health` returns 200, so the developer
doesn't see a wall of `ECONNREFUSED`. Vite middleware rewrites bare `/`
to `/index-web.html` so the canonical URL works.

The cowork SPA is shell-agnostic. **Never import `window.antontron`
directly inside `src/renderer/cowork/`** — every bridge call goes
through `src/renderer/platform/host.ts`, which falls back to safe
defaults when the bridge is absent (web). Electron-only affordances
(server pill, OS shell buttons, OAuth IPC flow) are gated behind
`host.isWeb`.

## Sanity-check Python before building

Edits to `server/anton_api/*.py` aren't caught by `npm run pack` (it just bundles them as-is). Run a quick parse-check:

```sh
python3 -c "import ast; ast.parse(open('server/anton_api/<file>.py').read())"
```

## Docs

- `docs/index.html` — landing page
- `docs/server-api.html` — API reference
- `docs/data-vault.html` — vault architecture + flow diagram

Open with `open docs/index.html`.

## Misc

- DevTools no longer auto-open. Set `ANTON_DEVTOOLS=1` to flip back on, or use Cmd+Option+I.
- Anton core lives at `/Users/jorgestorres/Documents/GitHub/anton/anton/` — referenced by the bundled server, not vendored.

---

# Architecture & Conventions

## Entry Points
- **Electron main**: `src/main/index.ts` — window creation, IPC handlers, installer, server lifecycle, OTA UI updates.
- **Renderer (Electron)**: `src/renderer/main.tsx` → `App.tsx` → `CoworkApp.tsx`.
- **Renderer (web)**: `src/renderer/web-main.tsx` (direct SPA, skips onboarding).
- **FastAPI sidecar**: `server/main.py` — runs on `127.0.0.1:26866`, calls into Anton.

## Key Files / Layout
```
src/
  main/
    index.ts              # Electron window + IPC handlers
    installer.ts          # Auto-installs Anton via `uv tool install`
    server-process.ts     # Manages FastAPI sidecar lifecycle
    ui-updater.ts         # OTA update system (fetch, verify, cache, rollback)
    preload.ts            # contextBridge → exposes `window.antontron`
  renderer/
    App.tsx               # Onboarding gates → CoworkApp
    CoworkApp.tsx         # Main chat shell
    platform/host.ts      # ONLY sanctioned host bridge — the SPA never touches window.antontron directly
    cowork/               # Shared SPA — must not import window.antontron
    web-main.tsx          # Web entry
  shared/
    ipc-channels.ts       # All IPC channel constants
server/
  main.py                 # FastAPI sidecar entry
  anton_api/              # Route handlers wrapping the anton package
  requirements.txt        # Python deps for the sidecar
electron-builder.yml      # macOS DMG / Windows NSIS packaging
```

## OTA UI Updates
- The Electron **shell** ships rarely; the React **renderer** updates frequently via GitHub Releases.
- On launch the main process polls a `latest.json` published to a public releases repo, downloads new bundles, SHA-256-verifies them, caches with rollback, and swaps on next reload.
- Two modes (Settings → Updates): `auto` (silent) and `manual` (banner). Persisted as `UI_UPDATE_MODE` in `~/.anton/.env`.
- Boot loads the cached UI **instantly** with no network block, then checks for updates in the background.

## Platform Abstraction — `src/renderer/platform/host.ts`
The SPA in `src/renderer/cowork/` **never imports `window.antontron`**. All host-bridge access goes through `host.ts`, which provides parallel implementations for Electron and web (`getApiOrigin`, `openExternal`, `serverInfo/Start/Stop`, `oauthConnect`, `openPath`, etc.). Features that require Electron-only IPC (server power pill, "Show in Finder", "Move to Trash") are gated behind `host.isWeb`. The `npm run check:cowork-purity` script enforces this.

## IPC Channels (all in `src/shared/ipc-channels.ts`)
Broad families: `install:*` (installer), `server:*` (sidecar lifecycle), `oauth:connect`, `settings:*`, `ui:update-*` (OTA), `app:*` (platform info), `shell:*` (OS shell ops).

## Environment Variables (written to `~/.anton/.env` by the app)
`ANTON_ANTHROPIC_API_KEY`, `ANTON_OPENAI_API_KEY`, `ANTON_OPENAI_BASE_URL`, `ANTON_MINDS_API_KEY`, `ANTON_MINDS_URL`, `ANTON_MINDS_MIND_NAME`, `ANTON_MINDS_DATASOURCE`, `ANTON_MINDS_DATASOURCE_ENGINE`, `ANTON_MINDS_SSL_VERIFY`, `ANTON_PLANNING_MODEL`, `ANTON_CODING_MODEL`, `ANTON_MEMORY_MODE`, plus `DEV_MODE` (`live` → Vite on `localhost:5173`, `full` → bundled only, unset → prod + OTA) and `UI_UPDATE_MODE` (`auto` | `manual`).

## Gotchas
1. **Port `26866` is hardcoded**: changing it requires updates in the Electron main process, the Vite proxy config, and the web entry script.
2. **OTA cache invalidation**: if a packaged build looks stale, the local UI cache is serving an old bundle. Force-refresh with `DEV_MODE=full` in `~/.anton/.env`, or delete `~/Library/Application Support/anton/ui-cache/current/` (macOS).
3. **Sidecar dep healing**: if `anton` self-update wipes Python deps, `server/main.py` auto-reinstalls from `server/requirements.txt` and re-execs. Do **not** remove `_missing_server_deps()` / `_heal_and_reexec_if_deps_missing()`.
4. **`server/` ships inside the packaged app**: `electron-builder.yml` bundles `server/` (excluding `__pycache__` and `.venv`). Changes there require a rebuild.
5. **Snapshot vs bundled renderer**: prod = OTA-cached UI if available, else bundled. `DEV_MODE=full` = always bundled. `DEV_MODE=live` = always Vite dev server.

## Relationship to Other Projects
- **Wraps `anton/`**: the FastAPI sidecar is a thin REST/SSE bridge around the `anton` Python package. Anton's `ChatSession`, tool dispatch, and memory are all reached through that layer.
- **Independent of OpenClaw**: OpenClaw is a separate agent platform; Cowork doesn't depend on it.
- **Independent of `mindshub_services/`**: Cowork is a local-only runtime; it does not call provisioning lambdas. `mindshub_services` provisions **remote** Cowork instances via a separate code path (Lightsail + `cowork.pkr.hcl`).
