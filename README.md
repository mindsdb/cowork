```
      ▄▀█ █▄ █ ▀█▀ █▀█ █▄ █
      █▀█ █ ▀█  █  █▄█ █ ▀█
         Desktop App
```

# Anton Desktop

The official Electron desktop app for **[Anton](https://github.com/mindsdb/anton)** — MindsDB's autonomous AI coworker. Cross-platform (macOS + Windows), auto-installs Anton on first run, and provides a polished terminal interface with project management and Minds integration.

---

## Quick Start

```bash
# Install dependencies
npm install

# Rebuild node-pty for Electron's Node ABI
npx electron-rebuild -f -w node-pty

# Build everything (main + renderer)
npm run build

# Run locally
npm start
```

### Dev Mode (hot reload for renderer)

```bash
npm run dev
```

### Dev Mode With Inspector

```bash
npm run dev:debug
```

This opens the Electron app against the Vite dev server and auto-opens Chromium DevTools in a detached window.

This runs three processes concurrently:

1. `tsc --watch` for main process
2. `vite dev` for renderer (port 5173)
3. Electron with `VITE_DEV=1` flag

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

1. The Anton FastAPI sidecar on `127.0.0.1:26866` (using your `uv tool install anton` interpreter — same as the Electron path).
2. Vite dev server on `localhost:5173`, with `BUILD_TARGET=web`.

The dev server opens at `http://localhost:5173/` (a small Vite
middleware rewrites `/` → `/index-web.html` so the bare URL is
canonical). API calls hit the FastAPI sidecar via Vite's
`/v1` and `/health` proxies. Press `Ctrl-C` once for a clean
shutdown — vite quiesces first, then the python child.

If you haven't installed Anton yet, `dev:web` will print:

```
✗ Anton Python interpreter not found at ~/.local/share/uv/tools/anton/bin/python.
  Run `uv tool install anton` first, then re-run `npm run dev:web`.
```

### Build a production bundle

```bash
npm run build:web
```

Outputs to `dist/renderer-web/` (separate from `dist/renderer/` which is
the Electron build). Drop this directory behind any static-file server
and point its `/v1` requests at a running Anton FastAPI process.

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
    index.ts             # Window creation, IPC handlers, menu, project/minds management
    anton-process.ts     # PTY process manager (Map<projectName, ptyProcess>)
    installer.ts         # Auto-installer for Anton CLI (uv + git + Xcode CLT)
    ui-updater.ts        # OTA UI update system (fetch, verify, cache, rollback)
    preload.ts           # contextBridge — exposes antontron API to renderer
  renderer/              # React UI (bundled by Vite)
    App.tsx              # App flow: loading -> setup -> onboarding -> terminal
    pages/
      Setup.tsx          # Install wizard with step progress
      Onboarding.tsx     # LLM provider selection (Anthropic / Minds)
      Terminal.tsx       # Multi-terminal interface, projects sidebar, minds panel
    styles.css           # Full dark cyberpunk theme
    global.d.ts          # TypeScript types for window.antontron API
  shared/
    ipc-channels.ts      # All IPC channel constants
assets/
  icon.png / icon.icns   # App icon (gradient cyan-to-purple "A")
```

### Key Design Decisions

- **Multi-process terminals**: Each project gets its own independent `node-pty` process. Switching projects shows/hides xterm instances — no restart. Managed via `Map<string, ptyProcess>` in `anton-process.ts`.

- **Login shell spawning**: On macOS, Anton is launched via `zsh -l -i -c anton` so packaged `.app` bundles inherit the user's PATH (homebrew, cargo, uv, etc).

- **Banner suppression**: The app sets `ANTON_SUPPRESS_BANNER=1` env var when spawning Anton to skip the ASCII art banner in the terminal.

- **Clipboard image paste**: Intercepts paste events on the xterm container, saves image to temp file via IPC, and auto-sends `/image <path>` to the PTY.

- **Minds integration**: The GUI replicates Anton's `/connect` flow — lists minds via REST API, handles datasource selection (normalizes string/object refs), writes the same env vars to `~/.anton/.env`, and auto-restarts Anton to pick up new config.

- **OTA UI updates**: The Electron shell ships rarely, but the React UI updates frequently via GitHub Releases. On every boot, the main process checks a static `latest.json` on GitHub Pages (no API rate limits), downloads new bundles in the background, verifies SHA-256 integrity, and swaps atomically with rollback support. Zero user interaction — updates apply on next launch.

---

## IPC Reference

All channels defined in `src/shared/ipc-channels.ts`:

| Channel                                             | Direction | Purpose                                   |
| --------------------------------------------------- | --------- | ----------------------------------------- |
| `install:check`                                     | invoke    | Check if Anton CLI is installed           |
| `install:start`                                     | invoke    | Run the installer                         |
| `install:log/progress/done/error`                   | send      | Installer status events                   |
| `anton:start`                                       | invoke    | Start PTY for a project                   |
| `anton:data`                                        | send      | PTY stdout data (tagged with projectName) |
| `anton:input`                                       | send      | Write to PTY stdin                        |
| `anton:resize`                                      | send      | Resize PTY                                |
| `anton:exit`                                        | send      | PTY exit event                            |
| `anton:kill`                                        | send      | Kill a project's PTY                      |
| `minds:status/list/get/connect/disconnect`          | invoke    | Minds server integration                  |
| `clipboard:save-image`                              | invoke    | Save clipboard image to temp file         |
| `settings:save/check-configured/validate`           | invoke    | Settings & API key management             |
| `projects:list/create/delete/get-active/set-active` | invoke    | Project CRUD                              |

---

## Project Management

Projects live in `{userData}/projects/`. Each project is a directory with its own `.anton/` folder (memory, episodes, secrets). The `default` project is always created and pinned to the top of the sidebar.

State is tracked in `{userData}/state.json`:

```json
{ "activeProject": "default" }
```

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
7. Auto-restarts Anton to pick up new config

---

## Building for Distribution

### Prerequisites

- Node.js 18+
- npm
- For macOS signing: Apple Developer account + certificates
- For Windows signing: EV code signing certificate

### macOS

```bash
# Build unsigned DMG (universal: x64 + arm64)
npm run dist:mac
# Output: release/Anton-{version}-universal.dmg
```

### Windows

```bash
# Build NSIS installer (x64, recommended)
npm run dist:win
# Output: release/Anton-Setup-{version}.exe
```

```bash
# Alias for local/manual Windows release
npm run release:win:local

# If you explicitly need x64 + arm64
npm run dist:win:all
```

> **Note**: Windows builds can be cross-compiled from macOS, but `node-pty` native modules require the target platform. For production Windows builds, build on a Windows machine or use CI.
>
> Production Windows installers are built by [`.github/workflows/prod-build-installer.yml`](.github/workflows/prod-build-installer.yml), which is fired automatically by the auto-release flow described in [Releasing](#releasing). Don't push `v*` tags manually — bump `"version"` in `package.json` and merge to `main` instead.

---

## Code Signing

### macOS Code Signing + Notarization

#### 1. Get certificates from Apple Developer portal

You need two certificates:

- **Developer ID Application** — signs the app binary
- **Developer ID Installer** — signs the DMG/pkg (optional but recommended)

```bash
# Verify your certificates are installed
security find-identity -v -p codesigning
# Should show: "Developer ID Application: Your Org (TEAMID)"
```

#### 2. Set environment variables

```bash
# Apple ID credentials for notarization
export APPLE_ID="your@email.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"  # Generate at appleid.apple.com
export APPLE_TEAM_ID="YOUR_TEAM_ID"

# OR use API key (recommended for CI)
export APPLE_API_KEY_ID="XXXXXXXXXX"
export APPLE_API_KEY_ISSUER="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
export APPLE_API_KEY="/path/to/AuthKey_XXXXXXXXXX.p8"
```

Where to export them:

```bash
# Option A: Current terminal session only (recommended for local/manual release)
export APPLE_ID="your@email.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="YOUR_TEAM_ID"
npm run dist:mac:dmg-custom
```

```bash
# Option B: Persist in zsh profile (loads in every new terminal)
echo 'export APPLE_ID="your@email.com"' >> ~/.zshrc
echo 'export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"' >> ~/.zshrc
echo 'export APPLE_TEAM_ID="YOUR_TEAM_ID"' >> ~/.zshrc
source ~/.zshrc
```

```bash
# Verify env vars are present
env | rg '^APPLE_'
```

#### 3. electron-builder config (already included in this repo)

```yaml
mac:
  hardenedRuntime: true
  gatekeeperAssess: false
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist

afterSign: scripts/notarize.js
```

#### 4. Entitlements file (already included)

`build/entitlements.mac.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <key>com.apple.security.cs.allow-dyld-environment-variables</key>
    <true/>
    <key>com.apple.security.cs.disable-library-validation</key>
    <true/>
</dict>
</plist>
```

> These entitlements are required because `node-pty` uses native code and JIT.

#### 5. Notarization script (already included)

`scripts/notarize.js`:

```js
const { notarize } = require("@electron/notarize");

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== "darwin") return;

  const appName = context.packager.appInfo.productFilename;

  console.log("Notarizing...");
  await notarize({
    // Use Apple ID auth:
    tool: "notarytool",
    appBundleId: "com.anton.app",
    appPath: `${appOutDir}/${appName}.app`,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID,

    // OR use API key auth (uncomment):
    // appleApiKey: process.env.APPLE_API_KEY,
    // appleApiKeyId: process.env.APPLE_API_KEY_ID,
    // appleApiIssuer: process.env.APPLE_API_KEY_ISSUER,
  });
  console.log("Notarization complete.");
};
```

If `@electron/notarize` is missing in your local install:

```bash
npm install --save-dev @electron/notarize
```

#### 6. Build signed + notarized

```bash
npm run dist:mac
# electron-builder will: sign -> notarize -> staple -> create DMG
```

#### Troubleshooting macOS signing

```bash
# Check if app is signed
codesign -dv --verbose=4 "release/mac-universal/Anton.app"

# Check notarization status
xcrun stapler validate "release/Anton-0.1.0-universal.dmg"

# If "Developer ID" identity not found, open Keychain Access
# and verify the certificate is in "login" keychain, not expired
```

If you get `ModuleNotFoundError: No module named 'distutils'` while rebuilding `node-pty`:

```bash
# node-gyp@9.x requires Python <= 3.11
export npm_config_python=/opt/homebrew/bin/python3.11
npm rebuild node-pty
npm run dist:mac
```

---

### Windows Code Signing

#### Option A: EV Certificate (USB token)

Most EV certificates come on a hardware USB token (SafeNet, YubiKey).

```bash
# Set env vars
export CSC_LINK="/path/to/certificate.pfx"       # or .p12
export CSC_KEY_PASSWORD="your-password"

# For USB tokens (SafeNet eToken):
export CSC_LINK=""  # empty — electron-builder finds it via signtool
export WIN_CSC_LINK=""

# Build
npm run dist:win
```

#### Option B: Azure Trusted Signing (cloud-based, no USB)

Microsoft's cloud signing service — recommended for CI/CD.

1. Set up Azure Trusted Signing in Azure Portal
2. Install the signing tool:

```bash
dotnet tool install --global AzureSignTool
```

3. Add to `electron-builder.yml`:

```yaml
win:
  signingHashAlgorithms: [sha256]
  sign: scripts/azure-sign.js
```

4. Create `scripts/azure-sign.js`:

```js
exports.default = async function sign(configuration) {
  const { execSync } = require("child_process");
  const filePath = configuration.path;

  execSync(
    `AzureSignTool sign \
    -kvu "${process.env.AZURE_KEY_VAULT_URI}" \
    -kvi "${process.env.AZURE_CLIENT_ID}" \
    -kvs "${process.env.AZURE_CLIENT_SECRET}" \
    -kvt "${process.env.AZURE_TENANT_ID}" \
    -kvc "${process.env.AZURE_CERT_NAME}" \
    -tr http://timestamp.digicert.com \
    -td sha256 \
    "${filePath}"`,
    { stdio: "inherit" },
  );
};
```

#### Option C: Self-signed (dev/testing only)

```powershell
# PowerShell — create a self-signed cert
$cert = New-SelfSignedCertificate -Subject "CN=Anton Dev" -Type CodeSigningCert -CertStoreLocation Cert:\CurrentUser\My
Export-PfxCertificate -Cert $cert -FilePath anton-dev.pfx -Password (ConvertTo-SecureString -String "password" -Force -AsPlainText)
```

```bash
export CSC_LINK="anton-dev.pfx"
export CSC_KEY_PASSWORD="password"
npm run dist:win
```

> Self-signed apps will still trigger SmartScreen warnings. Only EV certs or Azure Trusted Signing build SmartScreen reputation.

---

## Over-the-Air UI Updates

The desktop shell (Electron main process) handles PTY, IPC, and native OS integration — it changes rarely. The renderer (React UI) is where most iteration happens. Anton Desktop ships with an **OTA update system** that lets you push UI updates to every installed app without shipping a new `.dmg` or `.exe`.

### Two-Repo Architecture

Because `mindsdb/antontron` is **private**, the app can't fetch releases from it without baked-in tokens. Instead, OTA assets are published to a **separate public repo**: [`mindsdb/antontron-releases`](https://github.com/mindsdb/antontron-releases).

```
┌─────────────────────────────────────┐        ┌──────────────────────────────────┐
│  mindsdb/antontron (PRIVATE)        │        │  mindsdb/antontron-releases      │
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
                                                 │   Anton Desktop App      │
                                                 │   (every user's machine) │
                                                 └──────────────────────────┘
```

### How It Works

1. Code is merged to `main` (or a `ui-v*` tag is pushed)
2. The `publish-ui` workflow in the **private** repo builds the renderer
3. It creates a `.tar.gz` bundle, computes a SHA-256 checksum
4. Using a `RELEASES_TOKEN`, it pushes the bundle as a **GitHub Release** and updates `latest.json` on **GitHub Pages** — both on the **public** `antontron-releases` repo
5. Every Anton Desktop launch, the app fetches `https://mindsdb.github.io/antontron-releases/latest.json` (static file, no auth, no API rate limits)
6. If a newer version exists, it downloads the bundle, **verifies the SHA-256 checksum**, and caches it
7. **Next launch** loads the updated UI — zero user interaction required

### Automatic Deployment

The workflow triggers automatically on three events:

| Trigger | When | Version format | Example |
| --- | --- | --- | --- |
| **Push to `main`** | Any merge that changes `src/renderer/`, `src/shared/`, or `package.json` | `{pkg.version}-{sha}` | `1.0.1-a3b4c5d` |
| **Tag push** | `git tag ui-v1.2.0 && git push origin ui-v1.2.0` | Clean version from tag | `1.2.0` |
| **Manual dispatch** | [Actions UI](https://github.com/mindsdb/antontron/actions/workflows/publish-ui.yml) → Run workflow | Whatever you enter (or pkg.version + sha if empty) | `1.2.0` |

This means **every merge to `main` that touches UI files automatically deploys to all users**. No manual tagging required for day-to-day work. Use explicit tags (`ui-v*`) for milestone releases.

The workflow also checks if the version is already published and **skips duplicate releases** — safe to re-run.

### Publishing Manually

#### Option A: Command Line

```bash
git tag ui-v1.2.0
git push origin ui-v1.2.0
```

#### Option B: GitHub UI

1. Go to [**Actions → Publish UI Bundle**](https://github.com/mindsdb/antontron/actions/workflows/publish-ui.yml)
2. Click **"Run workflow"** (top right)
3. Branch: `main`
4. Version: `1.2.0` (leave empty to auto-generate from package.json)
5. Click the green **"Run workflow"** button

#### Option C: Just merge to `main`

If your PR changes anything in `src/renderer/`, `src/shared/`, or `package.json`, merging it will automatically publish a new UI version.

### Verifying a Deploy

After the workflow completes:

- **Manifest**: https://mindsdb.github.io/antontron-releases/latest.json — should show the new version, download URL, and SHA-256
- **Release**: https://github.com/mindsdb/antontron-releases/releases — should show the new `ui-v*` release with `ui-bundle.tar.gz` attached
- **In the app**: Launch Anton Desktop, then check **Anton → About Anton** — shows `1.0.1 (UI: 1.2.0)` when OTA is active

### Security

- Every bundle is integrity-checked with **SHA-256** before extraction
- Checksum mismatch → update is silently discarded, app loads last known good UI
- Previous version is kept on disk for automatic **rollback** if the new UI fails to load
- All downloads over HTTPS from GitHub's CDN
- The `RELEASES_TOKEN` only has write access to the public `antontron-releases` repo — source code in the private repo is never exposed

### Boot Sequence

```
App starts
  ├─ Load cached UI (instant, no network needed)
  │   └─ Falls back to bundled renderer if no cache exists
  └─ Background: fetch latest.json from GitHub Pages
      └─ If new version → download → verify SHA-256 → cache
          └─ Applied on next launch
```

The app **never blocks on a network request** — it always loads immediately from cache or bundled files, and downloads updates silently in the background.

### File Layout

On disk (Electron `userData` directory):

```
{userData}/ui-cache/
  version.json          # { "version": "1.2.0" }
  current/              # Active renderer bundle (index.html + assets)
  previous/             # Rollback copy of the prior version
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

## Releasing

Anton Desktop uses an automated release flow. The single source of truth for the package version is [`package.json`](package.json) (`"version"`). Every build workflow reads this field, and the prod upload job ([`upload-installer-to-s3.yml`](.github/workflows/upload-installer-to-s3.yml)) asserts it matches the release tag before publishing to S3.

### How to ship a new version

1. Open a PR that bumps `"version"` in [`package.json`](package.json) (e.g. `2.0.4` → `2.0.5`). Follow [SemVer](https://semver.org/).
2. Get it reviewed and merge to `main`.
3. That's it. On merge, [`.github/workflows/release.yml`](.github/workflows/release.yml) automatically:
   - Creates the matching git tag (`v2.0.5`).
   - Publishes a GitHub release with auto-generated notes.
   - The `v*` tag push triggers [`prod-build-installer.yml`](.github/workflows/prod-build-installer.yml), which builds + signs + uploads the macOS `.pkg` and Windows `.exe` to `s3://anton-installer/anton/{mac,windows}/` and serves them at `https://downloads.mindsdb.com/anton/...`.

### What you should NOT do

- **Don't create GitHub releases manually.** The `v*` tag namespace is locked via a repo ruleset — only the release workflow can create them. Manual attempts will be rejected by GitHub.
- **Don't push `v*` tags directly.** Same protection applies.
- **Don't edit `"version"` in `package.json` outside a dedicated bump PR.** Keep version bumps small and reviewable so the auto-release diff is easy to audit.

### Editing CI / workflows

Anything under [`.github/`](.github/) is owned by `@mindsdb/devops` via [CODEOWNERS](.github/CODEOWNERS). PRs touching workflows, actions, or release configuration require their review before merge.

### Hotfixes / out-of-band releases

If you genuinely need to release outside the normal flow (e.g. an admin hotfix), coordinate with `@mindsdb/devops` to bypass the tag ruleset. The prod upload job's package.json-vs-tag guard at [`upload-installer-to-s3.yml`](.github/workflows/upload-installer-to-s3.yml) will still verify the release tag matches `package.json` `"version"` and fail loudly on mismatch.

---

## CI/CD

### Installer release flow

The macOS (`.pkg`) and Windows (`.exe`) installers are built on GitHub-hosted runners (needed for Apple notarization / SSL.com signing) and then uploaded to S3 from the self-hosted `mdb-prod` pod. There are three flavors of build — **preview**, **stable**, and **prod** — distinguished only by when they run and the S3 path (and therefore the public `downloads.mindsdb.com` path) they land on.

| Flavor | Trigger | What builds | S3 destination |
| --- | --- | --- | --- |
| **preview** | PR with `signed-macos-pkg` label → macOS only. PR with `signed-windows-ev` label → Windows only. | `anton-{version}-preview-{sha}.pkg` / `.exe` | `s3://anton-installer/anton/{mac,windows}/previews/` |
| **stable** | Push to `main` | Both platforms, `anton-{version}-stable-{sha}.pkg` / `.exe` | `s3://anton-installer/anton/{mac,windows}/snapshots/` |
| **prod** | Push tag `v*` | Both platforms, `anton-{version}.pkg` / `.exe` | `s3://anton-installer/anton/{mac,windows}/anton-{version}.{pkg,exe}` and `anton-latest.{pkg,exe}` |

A PR without the matching `signed-*` label does nothing — no build, no upload.

Prod is gated by a version check: the first thing the upload job does when `build_kind == prod` is assert that `package.json` version equals the release tag (with the leading `v` stripped). Mismatch → workflow fails before anything reaches S3.

### S3 layout

The bucket is **`anton-installer`** in `us-east-1` (separate from the other `anton` bucket, which is in `us-east-2`). It is **private** — no public reads, no public ACLs, no presigned URLs for regular downloads. Everything is served through the CloudFront distribution described below. AWS credentials are **not** configured as GitHub secrets — they come from the `mdb-prod` pod's IAM role, the same way [`release-gui-to-production.yml`](release-gui-to-production.yml) works in the GUI repo. The role must have `s3:PutObject` on `arn:aws:s3:::anton-installer/anton/*`.

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

End users never hit S3 directly. The `anton-installer` bucket is fronted by a CloudFront distribution aliased to **`https://downloads.mindsdb.com`**, which is how all installers are distributed publicly.

Infrastructure:

- **CloudFront + ACM + S3 OAC** live in [`terraform/newprod/us-east-1/anton/cloudfront.tf`](../terraform/newprod/us-east-1/anton/cloudfront.tf), which also defines the bucket policy / public-access-block that keep the bucket itself private and reachable only via CloudFront's Origin Access Control.
- The bucket resource is in [`terraform/newprod/us-east-1/anton/s3.tf`](../terraform/newprod/us-east-1/anton/s3.tf).
- The CloudFront domain name is published via [`terraform/newprod/us-east-1/anton/outputs.tf`](../terraform/newprod/us-east-1/anton/outputs.tf) (`cloudfront_downloads_domain_name`) and consumed by the Cloudflare stack.
- DNS — the `downloads.mindsdb.com` CNAME and the ACM validation records — is managed in [`terraform/newprod/global/cloudflare/downloads.mindsdb.com-domain.tf`](../terraform/newprod/global/cloudflare/downloads.mindsdb.com-domain.tf).

CloudFront behavior:

- Path mapping is **1:1** — CloudFront does not rewrite the key, so the S3 key `anton/mac/anton-latest.pkg` is reachable at `https://downloads.mindsdb.com/anton/mac/anton-latest.pkg`.
- Viewer-protocol policy is `redirect-to-https`.
- `GET /` is rewritten to a 302 redirect to `https://mindsdb.com` by the `downloads-root-redirect` CloudFront Function (viewer-request).
- `GET /<missing key>` (S3 403/404) is rewritten to a 302 redirect to `https://mindsdb.com` by the `downloads-error-redirect` CloudFront Function (viewer-response). In other words, the bucket never leaks its existence — unknown paths bounce to the marketing site instead of returning an XML error.
- Default cache TTL is 1 hour, max 24 hours. Compression is enabled. No query strings or cookies are forwarded.

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

Stable download links to share externally:

- macOS latest: https://downloads.mindsdb.com/anton/mac/anton-latest.pkg
- Windows latest: https://downloads.mindsdb.com/anton/windows/anton-latest.exe

The [`upload-installer-to-s3.yml`](.github/workflows/upload-installer-to-s3.yml) workflow prints both the `s3://` URI and the `https://downloads.mindsdb.com/...` URL for every object it uploads in its GitHub step summary, so PRs and releases have a clickable public URL in the Actions run.

> **Cache invalidations**: because `anton-latest.{pkg,exe}` is overwritten on every prod release, CloudFront may serve the stale copy for up to the `default_ttl` (currently 1 hour). If a release needs to be visible immediately, create an invalidation for `/anton/mac/anton-latest.pkg` and/or `/anton/windows/anton-latest.exe`. Versioned URLs (`anton-{version}.pkg`) are immutable and never need invalidation.

### Workflow files

The layout mirrors the MindsDB `dev-/staging-/prod-` pattern: one small top-level file per trigger, shared work in `workflow_call` files.

| Workflow | Kind | Trigger | What it does |
| --- | --- | --- | --- |
| [`dev-build-installer.yml`](.github/workflows/dev-build-installer.yml) | Instance | `pull_request` | Label-gates per platform and wires to the build + upload called workflows with `build_kind: preview` |
| [`staging-build-installer.yml`](.github/workflows/staging-build-installer.yml) | Instance | Push to `main` | Builds both platforms with `build_kind: stable` |
| [`prod-build-installer.yml`](.github/workflows/prod-build-installer.yml) | Instance | Push tag `v*` | Builds both platforms with `build_kind: prod` (upload does the version vs tag check) |
| [`build-macos-pkg.yml`](.github/workflows/build-macos-pkg.yml) | Called (`workflow_call`) | — | Builds + signs + notarizes the `.pkg` on `macos-latest`, renames to the final artifact name, uploads as GitHub artifact |
| [`build-windows-installer.yml`](.github/workflows/build-windows-installer.yml) | Called (`workflow_call`) | — | Builds + SSL.com-signs + verifies the `.exe` on `windows-latest`, renames, uploads as GitHub artifact |
| [`upload-installer-to-s3.yml`](.github/workflows/upload-installer-to-s3.yml) | Called (`workflow_call`) | — | Runs on `mdb-prod`, downloads the GitHub artifact, runs the prod version check, `aws s3 cp` to the correct path |
| [`publish-ui.yml`](.github/workflows/publish-ui.yml) | Standalone | Push to `main` (renderer changes), `ui-v*` tag, manual | Publishes the renderer bundle to `mindsdb/antontron-releases` (unrelated to installer flow) |

The build workflows expose an `artifact_name` output; the instance workflows pass it through to the upload workflow so the artifact name is the single source of truth and no filename is computed twice.

### Required GitHub Secrets

Configured in [**antontron → Settings → Secrets → Repository secrets**](https://github.com/mindsdb/antontron/settings/secrets/actions).

Apple signing / notarization (used by `build-macos-pkg.yml`):

- `APPLE_DEV_ID_APP_CERT_B64`
- `APPLE_DEV_ID_APP_CERT_PASSWORD`
- `APPLE_DEV_ID_INSTALLER_CERT_B64`
- `APPLE_DEV_ID_INSTALLER_CERT_PASSWORD`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`
- `APPLE_INSTALLER_IDENTITY` (example: `Developer ID Installer: Your Org (TEAMID)`)

Windows signing via SSL.com eSigner (used by `build-windows-installer.yml`):

- `SSL_USERNAME`
- `SSL_PASSWORD`
- `SSL_CREDENTIAL_ID`
- `SSL_TOTP_SECRET`

OTA UI publishing (used by `publish-ui.yml`):

- `RELEASES_TOKEN` — fine-grained PAT scoped to `mindsdb/antontron-releases` with **Contents** (read/write) + **Metadata** (read)

> **No AWS secrets.** The upload job runs on `mdb-prod` and picks up AWS credentials from the pod's IAM role. The role must have `s3:PutObject` on `arn:aws:s3:::anton-installer/anton/*`.

### OTA UI publishing setup

This section covers the one-time setup for [`publish-ui.yml`](.github/workflows/publish-ui.yml) only — it's independent of the installer flow above.

1. Create [`mindsdb/antontron-releases`](https://github.com/mindsdb/antontron-releases) as a **public** repo. It only holds release assets and `latest.json` — no source code.
2. Create the `RELEASES_TOKEN`:
   - [**GitHub → Settings → Developer settings → Fine-grained tokens**](https://github.com/settings/tokens?type=beta)
   - Name: `antontron-releases-deploy`
   - Repository access: only `mindsdb/antontron-releases`
   - Permissions: Contents (read/write), Metadata (read)
   - Save the token as `RELEASES_TOKEN` in [antontron → Settings → Secrets → Actions](https://github.com/mindsdb/antontron/settings/secrets/actions).
3. Enable GitHub Pages on `antontron-releases`: Settings → Pages → Source "Deploy from a branch" → Branch `gh-pages` / `/ (root)`. The `gh-pages` branch is created automatically by the first workflow run.
4. Verify with:

```bash
curl https://mindsdb.github.io/antontron-releases/latest.json
```

---

## Updating the Icon

The app icon is a gradient cyan-to-purple "A" on a dark background.

```bash
# Generate icon.png and icon.icns from the SVG
node scripts/generate-icon.js
```

Source SVG is in `assets/icon.svg`. The script renders it to PNG then uses `sips` + `iconutil` to create the `.icns` for macOS.

For Windows, electron-builder auto-converts `icon.png` to `.ico`.

---

## Environment Variables (Anton)

These are written to `~/.anton/.env` by the app and read by Anton at startup:

| Variable                        | Source      | Purpose                             |
| ------------------------------- | ----------- | ----------------------------------- |
| `ANTON_ANTHROPIC_API_KEY`       | Onboarding  | Anthropic API key                   |
| `ANTON_OPENAI_API_KEY`          | Onboarding  | Minds/OpenAI-compatible API key     |
| `ANTON_OPENAI_BASE_URL`         | Onboarding  | Minds server URL (as OpenAI base)   |
| `ANTON_MINDS_API_KEY`           | Minds panel | Minds API key for datasources       |
| `ANTON_MINDS_URL`               | Minds panel | Minds server URL                    |
| `ANTON_MINDS_MIND_NAME`         | Minds panel | Selected mind name                  |
| `ANTON_MINDS_DATASOURCE`        | Minds panel | Selected datasource                 |
| `ANTON_MINDS_DATASOURCE_ENGINE` | Minds panel | Datasource engine type              |
| `ANTON_MINDS_SSL_VERIFY`        | Minds panel | SSL cert verification (true/false)  |
| `ANTON_PLANNING_MODEL`          | Settings    | Model for planning tasks            |
| `ANTON_CODING_MODEL`            | Settings    | Model for coding tasks              |
| `ANTON_MEMORY_MODE`             | Settings    | Memory mode (autopilot/copilot/off) |
| `ANTON_SUPPRESS_BANNER`         | Auto-set    | Suppresses ASCII art banner in PTY  |

---

## Troubleshooting

### `node-pty` build fails during install

```bash
# Ensure Python setuptools is available (needed by node-gyp)
pip3 install setuptools

# Rebuild for Electron's Node version
npx electron-rebuild -f -w node-pty
```

### App shows blank white screen

```bash
# Make sure both main and renderer are built
npm run build

# Check if Vite output exists
ls dist/renderer/index.html
```

### Anton shows "Disconnected" immediately after launch

The packaged `.app` doesn't inherit shell PATH. This is handled by spawning through a login shell (`zsh -l -i -c anton`). If issues persist, check that Anton is in `~/.local/bin/` or on the default PATH.

### macOS Gatekeeper blocks unsigned app

```bash
# Remove quarantine attribute (dev only)
xattr -cr "/Applications/Anton.app"
```

---

## Tech Stack

| Layer     | Tech                                   |
| --------- | -------------------------------------- |
| Framework | Electron 34                            |
| Renderer  | React 19 + TypeScript + Vite 6         |
| Terminal  | xterm.js 5                             |
| PTY       | node-pty 1                             |
| Markdown  | marked 17                              |
| Packaging | electron-builder 25                    |
| Styling   | Pure CSS (custom dark cyberpunk theme) |

---

_Built by MindsDB. Anton is the autonomous AI coworker._
