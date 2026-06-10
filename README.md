```
   █▀▄▀█ █ █▄ █ █▀▄ █▀   █▀▀ █▀█ █ █ █ █▀█ █▀█ █▄▀
   █ ▀ █ █ █ ▀█ █▄▀ ▄█   █▄▄ █▄█ ▀▄▀▄▀ █▄█ █▀▄ █ █
```

# Minds Cowork

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/mindsdb/cowork)

The Electron desktop app and web SPA for **Minds Cowork** — MindsDB's AI coworker platform. Cross-platform (macOS + Windows), auto-installs the backend on first run, and provides a chat-based UI backed by a FastAPI server, with Minds integration.

The project is split across two repos:

| Repo | Purpose | Language |
|------|---------|----------|
| [`mindsdb/cowork`](https://github.com/mindsdb/cowork) (this repo) | Electron shell + React SPA | TypeScript / React |
| [`mindsdb/cowork-server`](https://github.com/mindsdb/cowork-server) | FastAPI backend — projects, conversations, agent orchestration | Python |

The frontend and backend are developed and released independently. At runtime, the Electron main process spawns `cowork-server` as a local sidecar and communicates with it over HTTP (`127.0.0.1:26866`). Both the UI and server support over-the-air updates — see [Over-the-Air Updates](#over-the-air-updates).

---

## Environments

Minds Cowork runs in several contexts. The React SPA is identical across all of them — only the shell and server lifecycle differ.

| Environment | Frontend | Backend | How to run |
|-------------|----------|---------|------------|
| **Local dev (Electron)** | Vite dev server on `:5173` | `uv run cowork-server` from sibling source dir | `npm run dev` |
| **Local dev (web)** | Vite dev server on `:5173` | `uv run cowork-server` from sibling source dir | `npm run dev:web` |
| **Packaged Electron** (macOS/Windows) | Bundled or OTA-cached React build | `cowork-server` binary via `uv tool install` from PyPI | Download from [downloads.mindsdb.com](https://downloads.mindsdb.com) |
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
| _(unset)_ | Production mode — loads OTA-cached UI if available, otherwise bundled |

To set it, add `DEV_MODE=full` (or `live`) to `~/.anton/.env`. Remove the line to return to production behavior. When `DEV_MODE` is set, the OTA update check is skipped entirely.

> **Tip**: If you build the app and it looks outdated, the OTA cache may be serving an older published bundle. Either set `DEV_MODE=full` to bypass it, or clear the cache: `rm -rf ~/Library/Application\ Support/anton/ui-cache/current`

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
    installer.ts         # First-run installer for cowork-server (uv + git + Xcode CLT)
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

Minds Cowork has two independent OTA update channels so both the React frontend and the Python backend can be updated without shipping a new `.dmg` or `.exe`. The Electron shell itself changes rarely and is updated via the traditional installer release flow.

### Server updates (PyPI)

After the server boots successfully, the main process checks [PyPI](https://pypi.org/project/cowork-server/) for a newer `cowork-server` version. If one exists, it stops the server, upgrades via `uv tool install --upgrade --reinstall cowork-server`, restarts, and probes `/health`. If the health check fails, the previous version is reinstalled automatically (rollback). Set `COWORK_SERVER_DISABLE_AUTOUPDATE=1` to opt out.

See `src/main/server-updater.ts` for the implementation.

### UI updates (GitHub Releases)

The React UI updates via a separate public repo: [`mindsdb/antontron-releases`](https://github.com/mindsdb/antontron-releases). This avoids baking GitHub tokens into the app.

```
┌─────────────────────────────────────┐        ┌──────────────────────────────────┐
│  mindsdb/cowork (PRIVATE)           │        │  mindsdb/antontron-releases      │
│                                     │        │  (PUBLIC)                        │
│  source code lives here             │        │                                  │
│                                     │  push  │  GitHub Releases:                │
│  .github/workflows/publish-ui.yml ──┼───────▶│    ui-v1.2.0/ui-bundle.tar.gz   │
│                                     │        │                                  │
│                                     │        │  GitHub Pages (gh-pages branch): │
│                                     │        │    latest.json                   │
└─────────────────────────────────────┘        └──────────────────────────────────┘
                                                              ▲
                                                              │ HTTPS (no auth)
                                                              │
                                                 ┌────────────┴─────────────┐
                                                 │   Minds Cowork app       │
                                                 │   (every user's machine) │
                                                 └──────────────────────────┘
```

How it works:

1. Code is merged to `main` (or a `ui-v*` tag is pushed)
2. The `publish-ui` workflow builds the renderer and creates a `.tar.gz` bundle with a SHA-256 checksum
3. Using a `RELEASES_TOKEN`, it pushes the bundle as a GitHub Release and updates `latest.json` on GitHub Pages — both on the public `antontron-releases` repo
4. On every launch, the app fetches `latest.json` (static file, no auth, no API rate limits)
5. If a newer version exists, the bundle is downloaded, SHA-256 verified, and cached
6. In **auto** mode the UI reloads silently; in **manual** mode a sidebar banner lets the user choose when to apply. The preference is configurable in Settings → Updates.

#### Automatic deployment

The workflow triggers automatically on three events:

| Trigger | When | Version format | Example |
| --- | --- | --- | --- |
| **Push to `main`** | Any merge that changes `src/renderer/`, `src/shared/`, or `package.json` | `{pkg.version}-{sha}` | `1.0.1-a3b4c5d` |
| **Tag push** | `git tag ui-v1.2.0 && git push origin ui-v1.2.0` | Clean version from tag | `1.2.0` |
| **Manual dispatch** | [Actions UI](https://github.com/mindsdb/cowork/actions/workflows/publish-ui.yml) → Run workflow | Whatever you enter (or pkg.version + sha if empty) | `1.2.0` |

Every merge to `main` that touches UI files automatically deploys to all users — no manual tagging required. Use explicit tags (`ui-v*`) for milestone releases. The workflow checks for duplicate versions and skips if already published.

#### Publishing manually

```bash
# Option A: tag
git tag ui-v1.2.0 && git push origin ui-v1.2.0

# Option B: GitHub Actions UI → Publish UI Bundle → Run workflow

# Option C: just merge to main (auto-publishes if renderer files changed)
```

#### Verifying a deploy

- **Manifest**: https://mindsdb.github.io/antontron-releases/latest.json
- **Release**: https://github.com/mindsdb/antontron-releases/releases
- **In the app**: Settings → Updates shows App, UI, and Server versions

### Security

- Every UI bundle is integrity-checked with **SHA-256** before extraction
- Checksum mismatch → update discarded, app loads last known good UI
- Previous UI version kept on disk for automatic **rollback**
- All downloads over HTTPS
- `RELEASES_TOKEN` only has write access to the public releases repo — source code is never exposed

### Boot sequence

```
App starts
  ├─ If DEV_MODE is set → load Vite dev server or bundled renderer, skip OTA
  ├─ Load cached UI (instant, no network needed)
  │   └─ Falls back to bundled renderer if no cache
  ├─ Start cowork-server (spawn process, wait for /health)
  │   └─ After healthy: background PyPI check for server updates
  └─ After renderer loads:
      └─ Background: check GitHub Pages for UI updates
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
3. [`.github/workflows/release.yml`](.github/workflows/release.yml) automatically creates the git tag and GitHub release. The `v*` tag triggers [`prod-build-installer.yml`](.github/workflows/prod-build-installer.yml), which builds, signs, and uploads installers to S3.

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

# Windows — NSIS installer (x64)
npm run dist:win
```

Prerequisites: Node.js 18+, npm. For signed builds: Apple Developer certificates (macOS) or EV code signing certificate (Windows).

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
codesign -dv --verbose=4 "release/mac-universal/Minds Cowork.app"
xcrun stapler validate "release/Minds Cowork-0.1.0-universal.dmg"
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
| **preview** | PR with `signed-macos-pkg` or `signed-windows-ev` label | `s3://anton-installer/anton/{mac,windows}/previews/` |
| **stable** | Push to `main` | `s3://anton-installer/anton/{mac,windows}/snapshots/` |
| **prod** | Push tag `v*` | `s3://anton-installer/anton/{mac,windows}/anton-{version}.{pkg,exe}` + `anton-latest.{pkg,exe}` |

Prod is gated: the upload job asserts `package.json` version matches the release tag.

### S3 layout

The bucket is **`anton-installer`** in `us-east-1`. It is **private** — no public reads, no public ACLs. Everything is served through CloudFront. AWS credentials come from the `mdb-prod` pod's IAM role (not GitHub secrets). The role must have `s3:PutObject` on `arn:aws:s3:::anton-installer/anton/*`.

```
s3://anton-installer/
  anton/
    mac/
      anton-{version}.pkg            # prod — versioned
      anton-latest.pkg               # prod — always points at the most recent release
      previews/anton-{version}-preview-{sha}.pkg
      snapshots/anton-{version}-stable-{sha}.pkg
    windows/
      anton-{version}.exe
      anton-latest.exe
      previews/anton-{version}-preview-{sha}.exe
      snapshots/anton-{version}-stable-{sha}.exe
```

No sidecar `.sha256` files are published — the `.pkg` is notarized by Apple and the `.exe` is EV-signed via SSL.com, so OS-level signature verification is the integrity guarantee.

> **Lifecycle tip**: set bucket lifecycle rules to auto-expire objects under `previews/` (e.g. 14 days) and `snapshots/` (e.g. 60 days) to keep costs bounded. Prod objects have no expiration.

### Public downloads at `downloads.mindsdb.com`

End users never hit S3 directly. The `anton-installer` bucket is fronted by a CloudFront distribution aliased to **`https://downloads.mindsdb.com`**.

- macOS: https://downloads.mindsdb.com/anton/mac/anton-latest.pkg
- Windows: https://downloads.mindsdb.com/anton/windows/anton-latest.exe

Public URL layout:

```
https://downloads.mindsdb.com/
  anton/
    mac/
      anton-{version}.pkg                              # prod — versioned
      anton-latest.pkg                                 # prod — always the newest release
      previews/anton-{version}-preview-{sha}.pkg
      snapshots/anton-{version}-stable-{sha}.pkg
    windows/
      anton-{version}.exe
      anton-latest.exe
      previews/anton-{version}-preview-{sha}.exe
      snapshots/anton-{version}-stable-{sha}.exe
```

Infrastructure:

- **CloudFront + ACM + S3 OAC** live in [`terraform/newprod/us-east-1/anton/cloudfront.tf`](../terraform/newprod/us-east-1/anton/cloudfront.tf), which also defines the bucket policy / public-access-block that keep the bucket private and reachable only via CloudFront's Origin Access Control.
- The bucket resource is in [`terraform/newprod/us-east-1/anton/s3.tf`](../terraform/newprod/us-east-1/anton/s3.tf).
- The CloudFront domain name is published via [`terraform/newprod/us-east-1/anton/outputs.tf`](../terraform/newprod/us-east-1/anton/outputs.tf) (`cloudfront_downloads_domain_name`) and consumed by the Cloudflare stack.
- DNS (`downloads.mindsdb.com` CNAME + ACM validation records) is managed in [`terraform/newprod/global/cloudflare/downloads.mindsdb.com-domain.tf`](../terraform/newprod/global/cloudflare/downloads.mindsdb.com-domain.tf).

CloudFront behavior:

- Path mapping is **1:1** — the S3 key `anton/mac/anton-latest.pkg` is reachable at `https://downloads.mindsdb.com/anton/mac/anton-latest.pkg`.
- Viewer-protocol policy is `redirect-to-https`.
- `GET /` → 302 redirect to `https://mindsdb.com` via the `downloads-root-redirect` CloudFront Function (viewer-request).
- `GET /<missing key>` (S3 403/404) → 302 redirect to `https://mindsdb.com` via the `downloads-error-redirect` CloudFront Function (viewer-response). Unknown paths bounce to the marketing site instead of returning an XML error.
- Default cache TTL is 1 hour, max 24 hours. Compression is enabled. No query strings or cookies are forwarded.

> **Cache invalidations**: `anton-latest.{pkg,exe}` is overwritten on each prod release, so CloudFront may serve the stale copy for up to 1 hour. Create an invalidation for `/anton/mac/anton-latest.pkg` and/or `/anton/windows/anton-latest.exe` if a release needs to be visible immediately. Versioned URLs (`anton-{version}.pkg`) are immutable and never need invalidation.

The [`upload-installer-to-s3.yml`](.github/workflows/upload-installer-to-s3.yml) workflow prints both the `s3://` URI and the `https://downloads.mindsdb.com/...` URL for every object it uploads in its GitHub step summary, so PRs and releases have a clickable public URL in the Actions run.

### Workflow files

| Workflow | Trigger | Purpose |
| --- | --- | --- |
| [`release.yml`](.github/workflows/release.yml) | Version bump merged to `main` | Creates git tag + GitHub release |
| [`dev-build-installer.yml`](.github/workflows/dev-build-installer.yml) | PR with label | Preview builds |
| [`staging-build-installer.yml`](.github/workflows/staging-build-installer.yml) | Push to `main` | Stable builds |
| [`prod-build-installer.yml`](.github/workflows/prod-build-installer.yml) | Push tag `v*` | Prod builds |
| [`build-macos-pkg.yml`](.github/workflows/build-macos-pkg.yml) | Called | Build + sign + notarize `.pkg` |
| [`build-windows-installer.yml`](.github/workflows/build-windows-installer.yml) | Called | Build + sign `.exe` |
| [`upload-installer-to-s3.yml`](.github/workflows/upload-installer-to-s3.yml) | Called | Upload to S3 |
| [`publish-ui.yml`](.github/workflows/publish-ui.yml) | Push to `main` / `ui-v*` tag / manual | OTA UI bundle publish |

### Required GitHub Secrets

Apple signing: `APPLE_DEV_ID_APP_CERT_B64`, `APPLE_DEV_ID_APP_CERT_PASSWORD`, `APPLE_DEV_ID_INSTALLER_CERT_B64`, `APPLE_DEV_ID_INSTALLER_CERT_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `APPLE_INSTALLER_IDENTITY`

Windows signing: `SSL_USERNAME`, `SSL_PASSWORD`, `SSL_CREDENTIAL_ID`, `SSL_TOTP_SECRET`

OTA UI publishing: `RELEASES_TOKEN` (fine-grained PAT scoped to `mindsdb/antontron-releases`)

> **No AWS secrets.** The upload job runs on `mdb-prod` and picks up AWS credentials from the pod's IAM role. The role must have `s3:PutObject` on `arn:aws:s3:::anton-installer/anton/*`.

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
| `UI_UPDATE_MODE` | Settings | OTA UI update behavior (`auto` / `manual`; default `auto`) |
| `COWORK_SERVER_DISABLE_AUTOUPDATE` | Manual | Set to `1` to skip automatic server updates on launch |

---

## Troubleshooting

### App shows blank white screen

```bash
npm run build
ls dist/renderer/index.html
```

### Server shows "Disconnected" immediately after launch

The packaged `.app` doesn't inherit shell PATH. Ensure cowork-server is installed: `uv tool install cowork-server`. Check that `~/.local/bin/cowork-server` exists.

### macOS Gatekeeper blocks unsigned app

```bash
# Dev only
xattr -cr "/Applications/Minds Cowork.app"
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
