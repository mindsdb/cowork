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

This runs three processes concurrently:

1. `tsc --watch` for main process
2. `vite dev` for renderer (port 5173)
3. Electron with `VITE_DEV=1` flag

---

## Architecture

```
src/
  main/                  # Electron main process (Node.js)
    index.ts             # Window creation, IPC handlers, menu, project/minds management
    anton-process.ts     # PTY process manager (Map<projectName, ptyProcess>)
    installer.ts         # Auto-installer for Anton CLI (uv + git + Xcode CLT)
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
> This repo now includes a dedicated Windows workflow:
> `.github/workflows/windows-installer.yml`
>
> Trigger it from GitHub Actions (workflow_dispatch) or by pushing a `v*` tag (for example `v0.9.0`).

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

## CI/CD

### GitHub Actions example

```yaml
name: Build & Release

on:
  push:
    tags: ["v*"]

jobs:
  build-mac:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npx electron-rebuild -f -w node-pty
      - run: npm run dist:mac
        env:
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
      - uses: actions/upload-artifact@v4
        with:
          name: mac-build
          path: release/*.dmg

  build-win:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npx electron-rebuild -f -w node-pty
      - run: npm run dist:win
        env:
          CSC_LINK: ${{ secrets.WIN_CSC_LINK }}
          CSC_KEY_PASSWORD: ${{ secrets.WIN_CSC_KEY_PASSWORD }}
      - uses: actions/upload-artifact@v4
        with:
          name: win-build
          path: release/*.exe
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
