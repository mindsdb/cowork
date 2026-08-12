# MindsHub Cowork - Frontend

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/mindsdb/cowork)

The Electron desktop app and web SPA for **MindsHub Cowork** — MindsDB's AI coworker platform. Cross-platform (macOS + Windows), auto-installs the backend on first run, and provides a chat-based UI backed by a FastAPI server, with Minds integration.

The project is split across two repos:

| Repo | Purpose | Language |
|------|---------|----------|
| [`mindsdb/cowork`](https://github.com/mindsdb/cowork) (this repo) | Electron shell + React SPA | TypeScript / React |
| [`mindsdb/cowork-server`](https://github.com/mindsdb/cowork-server) | FastAPI backend — projects, conversations, agent orchestration | Python |

The frontend and backend are developed and released independently. At runtime, the Electron main process spawns `cowork-server` as a local sidecar and communicates with it over HTTP (`127.0.0.1:26866`). Both the UI and server support over-the-air updates — see [Over-the-Air Updates](#over-the-air-updates).

---

## Environments

MindsHub Cowork runs in several contexts. The React SPA is identical across all of them — only the shell and server lifecycle differ.

| Environment | Frontend | Backend | How to run |
|-------------|----------|---------|------------|
| **Local dev (Electron)** | Vite dev server on `:5173` | `uv run cowork-server` from sibling source dir | `npm run dev` |
| **Local dev (web)** | Vite dev server on `:5173` | `uv run cowork-server` from sibling source dir | `npm run dev:web` |
| **Packaged Electron** (macOS/Windows) | Bundled or OTA-cached React build | `cowork-server` binary via `uv tool install` from PyPI | Download from [downloads.mindshub.ai](https://downloads.mindshub.ai) |
| **Docker** (web deployment) | Static files served by uvicorn | `cowork-server` installed in `/opt/venv` | `docker build` + `docker run` |

---

## Quick Start

### Local development

Both dev modes expect a sibling `cowork-server` directory (override with `COWORK_SERVER_DIR`):

```
parent/
  cowork/              ← this repo
  cowork-server/       ← github.com/mindsdb/cowork-server
```

```bash
npm install

# Build everything (main + renderer)
npm run build

# Run locally
npm start
```

Or jump straight into dev mode:

```bash
# Electron dev (hot reload for renderer)
npm run dev

# Web dev (no Electron, opens in browser)
npm run dev:web
```

In dev mode the server runs from source (`uv run cowork-server`), so local Python edits are picked up immediately.

#### Environment variables

Copy `.env.example` to `.env` and fill in any optional tokens (e.g. `VITE_POSTHOG_MINDSHUB_MAIN_PROJECT_TOKEN` for analytics). Vite auto-loads `.env` at build/dev time. The `.env` file is gitignored.

### Dev Mode With Inspector

```bash
npm run dev:debug
```

This opens the Electron app against the Vite dev server and auto-opens Chromium DevTools in a detached window. It runs three processes concurrently:

1. `tsc --watch` for main process
2. `vite dev` for renderer (port 5173)
3. Electron with `VITE_DEV=1` flag

### DEV_MODE (packaged app testing)

When testing a packaged build (`npm run pack`), the `DEV_MODE` variable in `~/.anton/.env` controls which renderer the app loads:

| Value | Behavior |
|-------|----------|
| `live` | Load from Vite dev server (`localhost:5173`) — requires `npm run dev:renderer` running separately |
| `full` | Load the bundled renderer only — skips OTA cache entirely |
| _(unset)_ | Production mode — loads OTA-cached UI if available (`prod` builds only — see [Over-the-Air Updates](#over-the-air-updates)), otherwise bundled |

To set it, add `DEV_MODE=full` (or `live`) to `~/.anton/.env`. Remove the line to return to production behavior. When `DEV_MODE` is set, the OTA update check is skipped entirely.

> **Tip**: If you build the app and it looks outdated, the OTA cache may be serving an older published bundle. Either set `DEV_MODE=full` to bypass it, or clear the cache: `rm -rf ~/Library/Application\ Support/anton/ui-cache/current`

### Fresh-install reset (macOS)

To test first-run onboarding you need a true fresh-install state. App state lives in six places: the cowork homes (`~/.cowork` plus per-build-kind variants), the legacy `~/.anton` home, the Electron userData dir, the log dir, the uv-managed tool installs, and the macOS Keychain (connector OAuth tokens). This zsh function wipes them all — drop it in `~/.zshrc`:

```zsh
# Reset MindsHub Cowork to a fresh-install state: kills the app, wipes
# per-user state (API keys, chat history, .env, DB, OTA cache, keychain
# tokens), and uninstalls the uv-managed packages so the .app runs full
# onboarding on next launch.
# Usage: anton-reset [--deep]   (--deep also removes uv itself + shims)
anton-reset() {
  local deep=0
  [[ "$1" == "--deep" ]] && deep=1

  echo "About to wipe Cowork state for $(whoami) (HOME: $HOME)"
  (( deep )) && echo "Deep mode: also removes uv and ~/.local/share/uv"
  read -q "?Proceed? [y/N] " || { echo; echo "Aborted."; return 1; }
  echo

  # Stop the app (current product name, plus older builds)
  killall "MindsHub Cowork" 2>/dev/null
  killall Anton 2>/dev/null
  sleep 1

  # Per-user runtime state — all build kinds (prod uses ~/.cowork;
  # dev/preview/stable use suffixed homes)
  rm -rf "$HOME/Library/Application Support/anton" \
         "$HOME/Library/Logs/anton" \
         "$HOME/.anton" \
         "$HOME/.cowork" "$HOME/.cowork-dev" "$HOME/.cowork-preview" "$HOME/.cowork-stable"
  rm -f  "$HOME/Library/Preferences/com.anton.app.plist"

  # Connector OAuth tokens live in the macOS Keychain, not on disk
  while security delete-generic-password -s cowork-oauth >/dev/null 2>&1; do :; done

  # uv-installed packages (the installer re-installs these on next run)
  uv tool uninstall anton anton-agent cowork-server 2>/dev/null

  # Deep clean: force the installer to bootstrap uv itself too
  if (( deep )); then
    rm -f  "$HOME/.local/bin/uv" "$HOME/.local/bin/uvx" "$HOME/.local/bin/anton"
    rm -rf "$HOME/.local/share/uv" "$HOME/.cache/uv"
  fi

  # Verify the key file is actually gone (the critical check)
  if [[ -e "$HOME/.anton/.env" || -e "$HOME/.cowork/.env" ]]; then
    echo "STILL THERE: a .env survived the wipe"
    return 1
  fi
  echo "GONE: all Cowork state removed. Relaunch the .app for fresh onboarding."
}
```

---

## Web Build

The cowork SPA also runs as a plain web app, served by the same FastAPI
backend. The renderer is shell-agnostic — there is one source tree, one
component library, and two entrypoints.

### Run dev (web)

```bash
npm run dev:web
```

This boots both processes:

1. The cowork-server FastAPI backend on `127.0.0.1:26866` (via `uv run cowork-server` from the sibling source directory).
2. Vite dev server on `localhost:5173`, with `BUILD_TARGET=web`.

The dev server opens at `http://localhost:5173/` (a small Vite
middleware rewrites `/` → `/index-web.html` so the bare URL is
canonical). API calls hit the FastAPI sidecar via Vite's
`/v1` and `/health` proxies. Press `Ctrl-C` once for a clean
shutdown — vite quiesces first, then the python child.

### Build a production bundle

```bash
npm run build:web
```

Outputs to `dist/renderer-web/` (separate from `dist/renderer/` which is
the Electron build). Drop this directory behind any static-file server
and point its `/v1` requests at a running cowork-server process.

### Platform abstraction

The cowork tree (`src/renderer/cowork/`) **never** touches
`window.antontron` directly. All host-bridge access goes through
`src/renderer/platform/host.ts`, which exposes:

| Method | Electron | Web |
|---|---|---|
| `getPlatform()` / `isMac()` | `'darwin' \| 'win32' \| 'linux'` | `'web'` / `false` |
| `getApiOrigin()` | `http://127.0.0.1:26866` | `window.location.origin` |
| `openExternal(url)` | Electron shell.openExternal | `window.open(url, '_blank')` |
| `openPath` / `showItemInFolder` / `trashItem` | OS shell | `{ ok: false, reason: 'unsupported' }` |
| `serverInfo` / `serverStart` / `serverStop` | IPC to main | static `{running: true, …}` |
| `oauthConnect(...)` | IPC PKCE loopback flow | inline error (redirect-based OAuth not yet wired) |

Affordances that depend on Electron-only bridge calls (server pill +
power button in the sidebar, "Open in OS" / "Show in Finder" /
"Move to Trash" buttons in the artifact views, the
`ServerOfflineHelpModal`) are hidden when `host.isWeb` is true.

### Web entry layout

```
src/renderer/
  index.html              # Electron entry (loads main.tsx)
  index-web.html          # Web entry (loads web-main.tsx)
  main.tsx                # Electron entry: App.tsx → CoworkApp (with onboarding gates)
  web-main.tsx            # Web entry: cowork SPA directly (no onboarding gates)
  platform/host.ts        # Shell abstraction (the only sanctioned bridge surface)
  cowork/                 # The shared SPA — never imports window.antontron
```

`vite.config.ts` branches on `BUILD_TARGET=web`: when set, `rollupOptions.input`
points at `index-web.html` and `outDir` becomes `dist/renderer-web/`. When
unset (the Electron path), behavior is byte-identical to before.

---

## Architecture

```
src/
  main/                  # Electron main process (Node.js)
    index.ts             # Window creation, IPC handlers, menu
    installer.ts         # First-run installer for cowork-server (uv; plus git + Xcode CLT on git-channel builds only)
    server-process.ts    # FastAPI sidecar lifecycle (start/stop/health)
    server-updater.ts    # OTA server update (PyPI check, upgrade, rollback)
    ui-updater.ts        # OTA UI update system (fetch, verify, cache, rollback)
    preload.ts           # contextBridge — exposes antontron API to renderer
  renderer/              # React UI (bundled by Vite)
    App.tsx              # App flow: loading -> setup -> onboarding -> cowork
    CoworkApp.tsx        # Main chat-based cowork shell
    pages/
      Setup.tsx          # Install wizard with step progress
      Onboarding.tsx     # LLM provider selection (Anthropic / Minds)
    cowork/              # Shared SPA — never imports window.antontron
    platform/host.ts     # Shell abstraction (the only sanctioned bridge surface)
    styles.css           # Full dark theme
    global.d.ts          # TypeScript types for window.antontron API
  shared/
    ipc-channels.ts      # All IPC channel constants
assets/
  icon.png / icon.icns   # App icon (gradient cyan-to-purple "A")
```

### Key Design Decisions

- **FastAPI sidecar**: The Electron main process manages the [`cowork-server`](https://github.com/mindsdb/cowork-server) Python FastAPI backend on `127.0.0.1:26866`, installed from [PyPI](https://pypi.org/project/cowork-server/) via `uv tool install`. The renderer communicates exclusively through this HTTP API — there is no PTY or terminal emulator.

- **Minds integration**: The GUI replicates the `/connect` flow — lists minds via REST API, handles datasource selection (normalizes string/object refs), writes env vars to `~/.anton/.env`, and auto-restarts the server to pick up new config.

- **OTA updates**: Both the React UI and the Python backend update over-the-air without requiring a new installer. See [Over-the-Air Updates](#over-the-air-updates).

---

## IPC Reference

All channels defined in `src/shared/ipc-channels.ts`:

| Channel                                             | Direction | Purpose                                   |
| --------------------------------------------------- | --------- | ----------------------------------------- |
| `install:check`                                     | invoke    | Check if cowork-server is installed       |
| `install:start`                                     | invoke    | Run the installer                         |
| `install:log/progress/done/error`                   | send      | Installer status events                   |
| `install:cancel`                                    | invoke    | Cancel an in-progress install             |
| `install:cancelled`                                 | send      | Confirms install was cancelled            |
| `settings:read/save/check-configured/validate`      | invoke    | Settings & API key management             |
| `terms:accept`                                      | invoke    | Record terms acceptance                   |
| `ui:update-check`                                   | invoke    | Check for OTA UI updates                  |
| `ui:update-apply`                                   | invoke    | Download and apply a pending UI update    |
| `ui:update-status`                                  | send      | Update status events (available/reloading)|
| `server:restart`                                    | invoke    | Restart the FastAPI sidecar               |
| `server:update-status`                              | send      | Server OTA update progress (PyPI check)   |
| `auth:get-access-token`                             | invoke    | Retrieve current access token             |
| `auth:logout`                                       | invoke    | Clear auth session                        |
| `oauth:cancel`                                      | invoke    | Cancel an in-progress PKCE OAuth flow     |
| `mindshub:login`                                    | invoke    | Start MindsHub OAuth login                |
| `mindshub:refresh`                                  | invoke    | Refresh MindsHub token                    |
| `mindshub:finalize`                                 | invoke    | Commit MindsHub credentials to env        |
| `mindshub:get-cached-token`                         | invoke    | Read cached MindsHub token                |
| `app:ready`                                         | send      | App finished initializing                 |
| `app:get-platform/ui-version/open-external`         | invoke    | Platform info, open URLs                  |
| `shell:show-item-in-folder`                         | invoke    | OS shell operations                       |

---

## Minds Integration

The GUI provides a visual `/connect` flow:

1. If LLM provider is Minds (from onboarding), credentials are pre-filled
2. Lists available minds via `GET /api/v1/minds/`
3. Handles datasource selection (auto-selects if only one)
4. Fetches engine type via `GET /api/v1/datasources`
5. Writes to `~/.anton/.env`:
   - `ANTON_MINDS_API_KEY`
   - `ANTON_MINDS_URL`
   - `ANTON_MINDS_MIND_NAME`
   - `ANTON_MINDS_DATASOURCE`
   - `ANTON_MINDS_DATASOURCE_ENGINE`
   - `ANTON_MINDS_SSL_VERIFY`
6. Writes mind's system prompt to project cortex
7. Auto-restarts the server to pick up new config

---

## Over-the-Air Updates

MindsHub Cowork has two independent OTA update channels so both the React frontend and the Python backend can be updated without shipping a new `.dmg` or `.exe`. The Electron shell itself (everything in `src/main/` and the preload) is **not** covered by OTA and only updates via a new installer.

UI OTA is gated by build kind (ENG-670): enabled in **`prod` builds only** — `stable`, `preview`, and `dev` builds always run their bundled renderer so testers see the branch under test. For *when* updates apply (boot vs. periodic checks, the server-down recovery exception, the `UI_UPDATE_MODE` escape hatch), see [docs/update-behavior.md](docs/update-behavior.md).

### Server updates (source-aware)

The server updater detects how `cowork-server` was installed (from the tool venv's `direct_url.json`) and updates accordingly:

- **git install** — re-pulls the configured branch/tag HEAD for `cowork-server` **and** `anton` (trigger: changed remote commit SHA via `git ls-remote`)
- **PyPI install** — version comparison against [PyPI](https://pypi.org/project/cowork-server/), then `uv tool install --upgrade`

After an upgrade the server is restarted and probed via `/health`; on failure the previous version is reinstalled automatically, and the rollback itself is health-verified (a still-broken rollback raises a critical notification rather than being reported as recovered). If the server is **down**, an available server update is applied immediately regardless of update mode — recovery, not routine maintenance. Set `COWORK_SERVER_DISABLE_AUTOUPDATE=1` to opt out.

See `src/main/server-updater.ts` for the implementation.

### UI updates (GitHub Releases)

The React UI updates via a separate public repo: [`mindsdb/antontron-releases`](https://github.com/mindsdb/antontron-releases). This avoids baking GitHub tokens into the app.

```
┌─────────────────────────────────────┐        ┌──────────────────────────────────┐
│  mindsdb/cowork (PRIVATE)           │        │  mindsdb/antontron-releases      │
│                                     │        │  (PUBLIC)                        │
│  source code lives here             │        │                                  │
│                                     │  push  │  GitHub Releases:                │
│  .github/workflows/publish-ui.yml ──┼───────▶│    ui-v2.26.7.16.1/…tar.gz      │
│                                     │        │                                  │
│                                     │        │  GitHub Pages (gh-pages branch): │
│                                     │        │    latest.json                   │
└─────────────────────────────────────┘        └──────────────────────────────────┘
                                                              ▲
                                                              │ HTTPS (no auth)
                                                              │
                                                 ┌────────────┴─────────────┐
                                                 │   MindsHub Cowork app       │
                                                 │   (every user's machine) │
                                                 └──────────────────────────┘
```

How it works:

1. Code is merged to `main` — **every** push to `main` runs the prod pipeline (`prod-build-deploy.yml`), whose `auto-release` job computes a CalVer version (e.g. `2.26.7.16.1`) via the shared `calver-release.yml` reusable in [mindsdb/github-actions](https://github.com/mindsdb/github-actions), tags it, builds the prod installer, and calls `publish-ui` with that exact version, so the UI bundle and the prod app installer always publish the **same** version
2. The `publish-ui` workflow builds the renderer (with the version baked into `__APP_VERSION__`) and creates a `.tar.gz` bundle with a SHA-256 checksum
3. Using a `RELEASES_TOKEN`, it pushes the bundle as a GitHub Release and updates `latest.json` on GitHub Pages — both on the public `antontron-releases` repo
4. The app checks `latest.json` at launch and every 4 hours (static file, no auth, no API rate limits)
5. An update is taken only if it passes the safety gates: strictly newer than the installed UI (no downgrades), SHA-256 verified, the server-first coupling held (a failed server update defers the UI), and any declared `min_server_version` floor satisfied
6. **The update is applied automatically at boot** — the UI reloads silently, no user choice involved. There is no manual/auto setting in Settings anymore (ENG-858); `UI_UPDATE_MODE` in `~/.anton/.env` remains as an env-only support/QA escape hatch, not a user-facing preference. A mid-session periodic check (every 4h) still only surfaces a banner and never auto-applies, so a long-running session can always see and apply an update without an unplanned reload. A freshly-swapped bundle must finish loading within 15s or it is rolled back and quarantined. See [docs/update-behavior.md](docs/update-behavior.md) for the full timing rules.

#### Publishing

| Trigger | When | Version |
| --- | --- | --- |
| **Push to `main`** (normal path) | Every merge — the release train's auto-release calls `publish-ui` | Canonical CalVer, identical to the prod installer (e.g. `2.26.7.16.1`) |
| **Manual dispatch** | [Actions UI](https://github.com/mindsdb/cowork/actions/workflows/publish-ui.yml) → Run workflow — re-publish/backfill | Entered version, or derived from `git describe` if empty |
| **Tag push** | `git tag ui-v2.26.7.16.2 && git push origin ui-v2.26.7.16.2` — UI-only release | From the tag |

The workflow checks for duplicate versions and skips if already published. Because the client refuses downgrades, un-shipping a bad bundle means publishing a **newer** fixed version, not re-pointing `latest.json` at an older one.

#### Verifying a deploy

- **Manifest**: https://mindsdb.github.io/antontron-releases/latest.json
- **Release**: https://github.com/mindsdb/antontron-releases/releases
- **In the app**: Settings → Updates shows App, UI, and Server versions

### Security

- Every UI bundle is integrity-checked with **SHA-256** before extraction
- Checksum mismatch → update discarded, app loads last known good UI
- Previous UI version kept on disk for automatic **rollback**; a bundle that fails its post-swap load check is rolled back and **quarantined** (never re-applied)
- Cache slots carry versioned provenance (`.ota-meta.json`) and are served only when strictly **newer than the bundled renderer** — a stale or legacy cache can never downgrade the UI
- OTA runs only in `prod` builds; the gate fails safe to OFF if the packaged build kind is missing or unrecognized
- All downloads over HTTPS
- `RELEASES_TOKEN` only has write access to the public releases repo — source code is never exposed

### Boot sequence

```
App starts
  ├─ If DEV_MODE is set → load Vite dev server or bundled renderer, skip OTA
  ├─ Load cached UI (instant, no network needed)
  │   └─ Served only if: OTA enabled (prod build) + valid provenance
  │      + strictly newer than bundled + server-compat floor verified;
  │      otherwise the bundled renderer loads
  ├─ Start cowork-server (spawn process, poll /health while the child lives)
  └─ After renderer loads: boot update check (UI manifest + server, in parallel)
      ├─ apply now (server first, then UI, health-checked reload) — unless the
      │   UI_UPDATE_MODE=manual escape hatch is set (support/QA only), then banner only
      └─ then re-check every 4h (banner only, never auto-applies)
```

The app **never blocks on a network request** — it always loads immediately from cache or bundled files.

### File layout (on disk)

```
{userData}/ui-cache/
  version.json          # { "version": "1.2.0" }
  current/              # Active renderer bundle
  previous/             # Rollback copy
```

On GitHub (`mindsdb/antontron-releases`):

```
gh-pages branch:
  latest.json           # { "version": "1.2.0", "url": "...", "sha256": "..." }

GitHub Releases:
  ui-v1.2.0/
    ui-bundle.tar.gz    # The renderer build output
```

---

## Desktop Builds & Releasing

> This section applies to the **packaged Electron app** (macOS `.pkg` / Windows `.exe`). Not relevant for local development or Docker deployments.

### Releasing

The single source of truth for the app version is [`package.json`](package.json) (`"version"`).

1. Open a PR that bumps `"version"` in `package.json` (e.g. `2.0.5` → `2.0.6`).
2. Merge to `main`.
3. [`.github/workflows/prod-build-deploy.yml`](.github/workflows/prod-build-deploy.yml) automatically creates the git tag and GitHub release, then cuts the installers from it in the same run via [`build-installers.yml`](.github/workflows/build-installers.yml), which builds, signs, and uploads them to S3.

**Don't:**
- Create GitHub releases manually — the `v*` tag namespace is locked via a repo ruleset.
- Push `v*` tags directly — same protection applies.
- Edit `"version"` in `package.json` outside a dedicated bump PR — keep version bumps small and reviewable.

Anything under [`.github/`](.github/) is owned by `@mindsdb/devops` via [CODEOWNERS](.github/CODEOWNERS). PRs touching workflows require their review.

For hotfixes or out-of-band releases, coordinate with `@mindsdb/devops` to bypass the tag ruleset. The prod upload job still verifies `package.json` version matches the release tag.

### Building locally

```bash
# macOS — unsigned DMG (universal: x64 + arm64)
npm run dist:mac

# macOS — .app only, no DMG (faster, unsigned)
npm run pack

# Windows — NSIS installer (x64)
npm run dist:win
```

Prerequisites: Node.js 18+, npm. For signed builds: Apple Developer certificates (macOS) or EV code signing certificate (Windows).

#### Building from local uncommitted source (via parent Makefile)

When working in the `minds-platform` superproject, use `make pack-local` instead of `npm run pack`. It installs `cowork-server` from the local `backend/core_api/` directory (no push required), builds to `/tmp` to avoid the iCloud re-tagging codesign failure, then copies the result to `frontend/release/mac-arm64/`.

```bash
# from the minds-platform root:
make pack-local
# launch the built app with local server (auto-update disabled):
COWORK_SERVER_DISABLE_AUTOUPDATE=1 open "frontend/release/mac-arm64/MindsHub Cowork.app"
```

> **iCloud builds** — If the repo lives under `~/Documents` (iCloud Drive), `npm run pack` fails with `resource fork, Finder information, or similar detritus not allowed` during codesign. Build to `/tmp` manually:
>
> ```bash
> PATH="/opt/homebrew/opt/node@20/bin:$PATH" \
>   npx electron-builder --mac --arm64 --config.directories.output=/tmp/minds-build
> cp -R /tmp/minds-build/mac-arm64 release/
> ```

### Code signing

<details>
<summary>macOS Code Signing + Notarization</summary>

#### 1. Get certificates from Apple Developer portal

You need two certificates:

- **Developer ID Application** — signs the app binary
- **Developer ID Installer** — signs the DMG/pkg (optional but recommended)

```bash
security find-identity -v -p codesigning
# Should show: "Developer ID Application: Your Org (TEAMID)"
```

#### 2. Set environment variables

```bash
# Option A: Apple ID + app-specific password
export APPLE_ID="your@email.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"  # Generate at appleid.apple.com
export APPLE_TEAM_ID="YOUR_TEAM_ID"

# Option B: API key (recommended for CI)
export APPLE_API_KEY_ID="XXXXXXXXXX"
export APPLE_API_KEY_ISSUER="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
export APPLE_API_KEY="/path/to/AuthKey_XXXXXXXXXX.p8"
```

#### 3. Build signed + notarized

```bash
npm run dist:mac
# electron-builder will: sign -> notarize -> staple -> create DMG
```

The `electron-builder.yml` config and `scripts/notarize.js` hook are already included in this repo. The hardened-runtime entitlements (`build/entitlements.mac.plist`) are required because Electron uses JIT and dynamic linking.

#### Troubleshooting

```bash
codesign -dv --verbose=4 "release/mac-universal/MindsHub Cowork.app"
xcrun stapler validate "release/MindsHub Cowork-0.1.0-universal.dmg"
```

</details>

<details>
<summary>Windows Code Signing</summary>

#### Option A: EV Certificate (USB token)

```bash
export CSC_LINK="/path/to/certificate.pfx"
export CSC_KEY_PASSWORD="your-password"
npm run dist:win
```

#### Option B: Azure Trusted Signing (cloud-based, recommended for CI)

See `scripts/azure-sign.js` for the signing hook configuration.

#### Option C: Self-signed (dev/testing only)

```powershell
$cert = New-SelfSignedCertificate -Subject "CN=Cowork Dev" -Type CodeSigningCert -CertStoreLocation Cert:\CurrentUser\My
Export-PfxCertificate -Cert $cert -FilePath cowork-dev.pfx -Password (ConvertTo-SecureString -String "password" -Force -AsPlainText)
```

> Self-signed apps trigger SmartScreen warnings. Only EV certs or Azure Trusted Signing build SmartScreen reputation.

</details>

---

## CI/CD

> Relevant for maintainers shipping desktop releases.

### Installer build flow

Installers are built on GitHub-hosted runners (required for Apple notarization and SSL.com signing) and uploaded to S3 from the self-hosted `mdb-prod` pod.

| Flavor | Trigger | S3 destination |
| --- | --- | --- |
| **preview** | PR with `signed-macos-pkg` or `signed-windows-ev` label | `s3://anton-installer/mindshub-cowork/{mac,windows}/previews/` |
| **stable** | Push to `staging` | `s3://anton-installer/mindshub-cowork/{mac,windows}/snapshots/` + `mindshub-cowork-staging.{pkg,exe}` + `staging.json` |
| **prod** | Push to `main` (via the CalVer release) | `s3://anton-installer/mindshub-cowork/{mac,windows}/mindshub-cowork-{version}.{pkg,exe}` + `mindshub-cowork-latest.{pkg,exe}` + `latest.json` |

### S3 layout

The bucket is **`anton-installer`** in `us-east-1`. It is **private** — no public reads, no public ACLs. Everything is served through CloudFront. AWS credentials come from the `mdb-prod` pod's IAM role (not GitHub secrets). The role has `s3:GetObject`, `s3:PutObject`, `s3:ListBucket` and `s3:DeleteObject` on `arn:aws:s3:::anton-installer` and `arn:aws:s3:::anton-installer/*`, granted by the `AllowS3AntonInstallerAccess` statement in `templates/eks-oidc-roles/github-runner.tf` in the `mindsdb/terraform` repo.

```
s3://anton-installer/
  mindshub-cowork/
    mac/
      latest.json                                  # prod — manifest: version, url, size, sha256
      staging.json                                 # stable — the same, for the staging ring
      mindshub-cowork-{version}.pkg                # prod — versioned, written once
      mindshub-cowork-latest.pkg                   # prod — alias, rewritten every release
      mindshub-cowork-staging.pkg                  # stable — alias, rewritten every staging push
      previews/mindshub-cowork-{version}-preview-{sha}.pkg
      snapshots/mindshub-cowork-{version}-stable-{sha}.pkg
    windows/
      latest.json
      staging.json
      mindshub-cowork-{version}.exe
      mindshub-cowork-latest.exe
      mindshub-cowork-staging.exe
      previews/mindshub-cowork-{version}-preview-{sha}.exe
      snapshots/mindshub-cowork-{version}-stable-{sha}.exe
```

Each manifest is named after the alias it supersedes, so a consumer already reading `-latest` or `-staging` knows which one is its own. Preview builds get no manifest: they are per-pull-request, and nothing should be advertising one.

**A version's bytes are published once.** If a versioned key already exists with different bytes (rebuilding a version re-signs it, and signing stamps a timestamp), the release fails rather than replacing them. Cut a new version instead of republishing one. The `-latest` and `-staging` aliases are then written as server-side copies of that key, so the alias always serves the exact build the manifest names.

That rule covers the released channels. **Previews overwrite**, because they are per-pull-request and get rebuilt whenever anyone re-runs the job, and "cut a new version" is not something a branch can do. Only a genuine `404` from S3 counts as "not published yet" for the released channels; a `403`, a throttle or an expired token stops the release rather than being read as absence.

**Object headers** are set at publish time, because CloudFront otherwise applies its own one-hour default to everything:

| Object | `Cache-Control` | Why |
| --- | --- | --- |
| Versioned installers | `public, max-age=31536000, immutable` | The bytes never change, so a resume can trust a validator that never moves |
| `-latest` / `-staging` aliases | `public, max-age=60` | Rewritten every release; a minute bounds how long a stale edge copy outlives one |
| `previews/` builds | `public, max-age=60` | Overwritten on a re-run, so `immutable` would strand the previous bytes at the edge |
| `latest.json` / `staging.json` | `no-cache, no-store, must-revalidate` | A cached manifest would hide a release entirely |

Installers also carry `Content-Type: application/octet-stream` and `Content-Disposition: attachment; filename="mindshub-cowork-{version}.{pkg,exe}"`, so a file saved from the alias URL is still named after the version it actually is.

No sidecar `.sha256` files are published. The checksum lives in `latest.json`, and OS-level signature verification (Apple notarization, SSL.com EV) remains the tamper guarantee.

> **Lifecycle tip**: set bucket lifecycle rules to auto-expire objects under `previews/` (e.g. 14 days) and `snapshots/` (e.g. 60 days) to keep costs bounded. Prod objects have no expiration. The bucket has no `abort_incomplete_multipart_upload` rule today, so a failed upload leaves billable orphaned parts.

### Public downloads at `downloads.mindshub.ai`

End users never hit S3 directly. The `anton-installer` bucket is fronted by a CloudFront distribution aliased to **`https://downloads.mindshub.ai`** (the legacy domain `downloads.mindsdb.com` also continues to work during the transition).

**Start from the manifest, not the alias.** `latest.json` names the immutable URL for the current release and the checksum to verify it against, which is the only combination that survives an interrupted download:

```console
$ curl -sS https://downloads.mindshub.ai/mindshub-cowork/mac/latest.json
{
  "version": "2.26.8.10.1",
  "key": "mindshub-cowork/mac/mindshub-cowork-2.26.8.10.1.pkg",
  "url": "https://downloads.mindshub.ai/mindshub-cowork/mac/mindshub-cowork-2.26.8.10.1.pkg",
  "size_bytes": 220393119,
  "sha256": "…",
  "published_at": "2026-08-12T00:22:46.681Z"
}
```

The `-latest` aliases stay for the consumers that hardcode them, and still work:

- macOS: https://downloads.mindshub.ai/mindshub-cowork/mac/mindshub-cowork-latest.pkg
- Windows: https://downloads.mindshub.ai/mindshub-cowork/windows/mindshub-cowork-latest.exe

The difference matters mid-download. An alias is rewritten on every release, so a transfer interrupted across one resumes with a validator that no longer matches and gets the whole body again instead of the tail. A versioned URL is written once, so the resume succeeds, and the manifest's `sha256` is how a truncated file gets told apart from a good one.

Infrastructure:

- **CloudFront + ACM + S3 OAC** live in [`terraform/newprod/us-east-1/anton/cloudfront.tf`](../terraform/newprod/us-east-1/anton/cloudfront.tf), which also defines the bucket policy / public-access-block that keep the bucket private and reachable only via CloudFront's Origin Access Control.
- The bucket resource is in [`terraform/newprod/us-east-1/anton/s3.tf`](../terraform/newprod/us-east-1/anton/s3.tf).
- The CloudFront domain name is published via [`terraform/newprod/us-east-1/anton/outputs.tf`](../terraform/newprod/us-east-1/anton/outputs.tf) (`cloudfront_downloads_domain_name`) and consumed by the Cloudflare stack.
- DNS (`downloads.mindshub.ai` CNAME + ACM validation records) is managed in [`terraform/newprod/global/cloudflare/downloads.mindshub.ai-domain.tf`](../terraform/newprod/global/cloudflare/downloads.mindshub.ai-domain.tf). Legacy DNS (`downloads.mindsdb.com`) is in [`downloads.mindsdb.com-domain.tf`](../terraform/newprod/global/cloudflare/downloads.mindsdb.com-domain.tf).

CloudFront behavior:

- Path mapping is **1:1** — the S3 key `mindshub-cowork/mac/mindshub-cowork-latest.pkg` is reachable at `https://downloads.mindshub.ai/mindshub-cowork/mac/mindshub-cowork-latest.pkg`.
- Viewer-protocol policy is `redirect-to-https`.
- `GET /` → 302 redirect to `https://mindshub.ai` via the `downloads-root-redirect` CloudFront Function (viewer-request).
- `GET /<missing key>` (S3 403/404) → `/redirect.html`, 665 bytes of meta-refresh HTML pointing at `https://mindshub.ai`, served under a `404`. It answered `200` until ENG-1432 corrected the two `custom_error_response` blocks, which is how a missing manifest could pass a status check.
- Cache TTL: min 0, default 1 hour, max 24 hours. The default applies only to objects whose origin sends no `Cache-Control`, and min 0 is what lets `no-store` on `latest.json` be honoured. The 24-hour max caps edge retention, so `max-age=31536000` on a versioned key is a year to the browser and a day at the edge.
- Compression is enabled, but no installer content type is on CloudFront's compressible list. No query strings or cookies are forwarded, so a `?cachebust=` suffix does nothing here.

> **Check these URLs by their bytes, not their status.** A correct status still cannot tell a current object from a stale one, which is the failure an immutable key is most exposed to. And `curl --retry` fires only on a timeout or a 408/429/5xx, so it does not cover the case that actually needs waiting: a key created moments ago, shadowed by an edge that cached the `404` for it. Both checks in the release parse the body and compare a checksum, and wait in an explicit loop.

> **Cache invalidations**: the aliases carry `max-age=60`, so a stale edge copy expires in a minute and a release needs no invalidation to become visible. Versioned URLs are immutable and never need one. Nothing in the release calls for an invalidation, though the `mdb-prod` runner does hold `cloudfront:CreateInvalidation` on `*` already, through the inline sam-deploy policy attached to the same role.

Two things watch this path. [`upload-installer-to-s3.yml`](.github/workflows/upload-installer-to-s3.yml) verifies its own work before the release goes green: it re-reads every uploaded object from S3 and compares checksums, then fetches the manifest over the CDN, checks its `sha256` against the installer the run built, and asserts the versioned URL answers a `Range` request with a `206` and a stable ETag. [`release-smoke.yml`](.github/workflows/release-smoke.yml) then downloads the result in a real Chromium, the way a user does, and runs nightly to catch a key that was correct at publish time and has since drifted. The release runs it against the **prod channel only**, passing the version it just tagged: `staging.json` is written by a push to `staging`, so asserting it from the prod pipeline would fail a release that worked, and without the version the suite would pass just as happily against the manifest the previous release left behind. The nightly run takes both channels and pins neither.

### Workflow files

| Workflow | Trigger | Purpose |
| --- | --- | --- |
| [`dev-build-deploy.yml`](.github/workflows/dev-build-deploy.yml) | Pull request | Tests, PR env, and label-gated preview installers |
| [`staging-build-deploy.yml`](.github/workflows/staging-build-deploy.yml) | Push to `staging` | Tests, staging image + rollout, stable installers |
| [`prod-build-deploy.yml`](.github/workflows/prod-build-deploy.yml) | Push to `main` | Tests, prod image, CalVer tag + release, prod installers, OTA UI bundle |
| [`build-deploy.yml`](.github/workflows/build-deploy.yml) | Called | Build + push the web SPA image, then roll it out |
| [`build-installers.yml`](.github/workflows/build-installers.yml) | Called | Both platforms' installers: build, sign, upload |
| [`pipeline-watchdog.yml`](.github/workflows/pipeline-watchdog.yml) | Scheduled | Alerts on runs that never started (`startup_failure`) |
| [`build-macos-pkg.yml`](.github/workflows/build-macos-pkg.yml) | Called | Build + sign + notarize `.pkg` |
| [`build-windows-installer.yml`](.github/workflows/build-windows-installer.yml) | Called | Build + sign `.exe` |
| [`upload-installer-to-s3.yml`](.github/workflows/upload-installer-to-s3.yml) | Called | Publish to S3, write `latest.json`, verify over the CDN |
| [`release-smoke.yml`](.github/workflows/release-smoke.yml) | Called after a prod release / nightly | Download the published installers in a real Chromium and check them |
| [`publish-ui.yml`](.github/workflows/publish-ui.yml) | Push to `main` / `ui-v*` tag / manual | OTA UI bundle publish |

### Required GitHub Secrets

Apple signing: `APPLE_DEV_ID_APP_CERT_B64`, `APPLE_DEV_ID_APP_CERT_PASSWORD`, `APPLE_DEV_ID_INSTALLER_CERT_B64`, `APPLE_DEV_ID_INSTALLER_CERT_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `APPLE_INSTALLER_IDENTITY`

Windows signing: `SSL_USERNAME`, `SSL_PASSWORD`, `SSL_CREDENTIAL_ID`, `SSL_TOTP_SECRET`

OTA UI publishing: `RELEASES_TOKEN` (fine-grained PAT scoped to `mindsdb/antontron-releases`)

> **No AWS secrets.** The upload job runs on `mdb-prod` and picks up AWS credentials from the pod's IAM role. The role needs `s3:GetObject` and `s3:PutObject` on `arn:aws:s3:::anton-installer/*` — `GetObject` as well as `PutObject`, because the publish path reads a key back to check whether it already holds these bytes, and copies the versioned key onto the alias server-side.

### OTA UI publishing setup

This section covers the one-time setup for [`publish-ui.yml`](.github/workflows/publish-ui.yml) only — it's independent of the installer flow above.

1. Create [`mindsdb/antontron-releases`](https://github.com/mindsdb/antontron-releases) as a **public** repo. It only holds release assets and `latest.json` — no source code.
2. Create the `RELEASES_TOKEN`:
   - [**GitHub → Settings → Developer settings → Fine-grained tokens**](https://github.com/settings/tokens?type=beta)
   - Name: `antontron-releases-deploy`
   - Repository access: only `mindsdb/antontron-releases`
   - Permissions: Contents (read/write), Metadata (read)
   - Save the token as `RELEASES_TOKEN` in the source repo's Settings → Secrets → Actions.
3. Enable GitHub Pages on `antontron-releases`: Settings → Pages → Source "Deploy from a branch" → Branch `gh-pages` / `/ (root)`. The `gh-pages` branch is created automatically by the first workflow run.
4. Verify with:

```bash
curl https://mindsdb.github.io/antontron-releases/latest.json
```

---

## Updating the Icon

```bash
node scripts/generate-icon.js
```

Source SVG is in `assets/icon.svg`. The script renders to PNG then creates `.icns` (macOS) via `sips` + `iconutil`. Windows `.ico` is auto-generated by electron-builder.

---

## Environment Variables

| Variable | Source | Purpose |
| --- | --- | --- |
| `ANTON_ANTHROPIC_API_KEY` | Onboarding | Anthropic API key |
| `ANTON_OPENAI_API_KEY` | Onboarding | Minds/OpenAI-compatible API key |
| `ANTON_OPENAI_BASE_URL` | Onboarding | Minds server URL (as OpenAI base) |
| `ANTON_MINDS_API_KEY` | Minds panel | Minds API key for datasources |
| `ANTON_MINDS_URL` | Minds panel | Minds server URL |
| `ANTON_MINDS_MIND_NAME` | Minds panel | Selected mind name |
| `ANTON_MINDS_DATASOURCE` | Minds panel | Selected datasource |
| `ANTON_MINDS_DATASOURCE_ENGINE` | Minds panel | Datasource engine type |
| `ANTON_MINDS_SSL_VERIFY` | Minds panel | SSL cert verification (true/false) |
| `ANTON_PLANNING_MODEL` | Settings | Model for planning tasks |
| `ANTON_CODING_MODEL` | Settings | Model for coding tasks |
| `ANTON_MEMORY_MODE` | Settings | Memory mode (autopilot/copilot/off) |
| `ANTON_LANGFUSE_HEADERS` | Manual | Set to `1` to emit Langfuse-* headers on LLM calls |
| `DEV_MODE` | Manual | Renderer source override (`live` = Vite dev server, `full` = bundled only, unset = production with OTA) |
| `UI_UPDATE_MODE` | Manual | OTA UI update behavior (`auto` / `manual`; default `auto`). Env-only support/QA escape hatch — no Settings UI control (ENG-858) |
| `COWORK_SERVER_DISABLE_AUTOUPDATE` | Manual | Set to `1` to skip automatic server updates on launch |
| `COWORK_SERVER_PACKAGE` | Manual | Override install source with a literal `uv` spec (local path, custom URL, etc.) — wins over all channel/ref logic |
| `ANTON_PACKAGE` | Manual | Override anton install source (local path / uv spec); only honoured when `COWORK_SERVER_PACKAGE` is also set |

---

## Troubleshooting

### App shows blank white screen

```bash
npm run build
ls dist/renderer/index.html
```

### Server shows "Disconnected" immediately after launch

The packaged `.app` doesn't inherit shell PATH. Ensure cowork-server is installed: `uv tool install cowork-server`. Check that `~/.local/bin/cowork-server` exists.

### Backend takes a long time to come up on a first launch (Windows)

Expected, and it is waited out rather than killed. The first execution of a
freshly installed uv venv makes Windows Defender scan hundreds of MB of DLLs
and `.pyd` files, which can push the pre-uvicorn import phase past half a
minute; every launch after that is warm and takes a couple of seconds.

The start wait is progress-aware: `/health` is polled for as long as the child
process is alive, up to a hard cap (`SERVER_START_CAP_MS`, 180s, in
[src/shared/server-status.ts](src/shared/server-status.ts)). A sidecar that
dies is reported the moment it exits, with its exit code and stderr, rather
than after the full budget. The renderer's status poll is derived from the same
cap so the UI cannot declare the backend offline while the main process is
still waiting.

One cap covers every build and platform, deliberately. A dev-only allowance
means a start that passes locally can still be killed in a packaged build, so
the failure would only ever reproduce on a customer's machine. The cap is
therefore sized for the slowest case any build can hit (a dev source tree
building a fresh `.venv` on a cold cache) and everything else inherits it. It
costs nothing in the normal case: the wait ends the moment `/health` answers or
the process dies, so the cap only ever bounds a process that is genuinely still
alive and still starting.

Failures are classified rather than collapsed into one timeout message:

| Diagnostics `lastErrorKind` | Means |
|---|---|
| `spawn-error` | The OS refused to launch the program (`EPERM` from antivirus, `ENOENT` from a broken shim). Nothing ran, so there is no log. |
| `exited` | It ran and died during boot. Exit code + captured output are the evidence. |
| `timeout` | Still alive and still silent at the cap. Almost always a very slow first import. |
| `not-installed` | The backend or `uv` isn't on disk; re-run the installer. |

After a failed start the whole process tree is killed (`taskkill /F /T` on
Windows, process-group signal elsewhere), so a retry never collides with a
leftover `python.exe` holding the port. If something else still holds it, the
diagnostics name the PID.

Finding that PID on Windows means parsing `netstat -ano`, where the state
column is both translated and variable in length (`ABHÖREN` on German,
`IN ASCOLTO` on Italian, and a two-word state shifts every column after it).
The lookup reads none of it: a listening socket is the only TCP row with an
all-zero foreign address, and the PID is always the last column.

### macOS Gatekeeper blocks unsigned app

```bash
# Dev only
xattr -cr "/Applications/MindsHub Cowork.app"
```

---

## Tech Stack

| Layer     | Tech                                   |
| --------- | -------------------------------------- |
| Framework | Electron 34                            |
| Renderer  | React 19 + TypeScript + Vite 6         |
| Backend   | FastAPI (Python, [`cowork-server`](https://pypi.org/project/cowork-server/) via PyPI) |
| Markdown  | marked 17                              |
| Packaging | electron-builder 25                    |
| Styling   | Tailwind CSS + custom theme            |

---

_Built by MindsDB._
