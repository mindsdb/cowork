# Desktop update behavior — Auto vs. Manual

Reference for how and *when* the Cowork desktop app applies updates.
Source of truth: `src/main/updater.ts` (orchestration) and `decideUpdateApply()`
in `src/main/update-logic.ts`.

## The setting

- `UI_UPDATE_MODE` in `~/.anton/.env` — `manual` or `auto`.
- **Default is `auto`** (any value other than the literal `manual` means auto).
- One mode governs **both** the cowork-server update and the UI (OTA) bundle.

## When the app checks

Identical in both modes (packaged, non-dev builds only):

| Check | When | Can it apply? |
|---|---|---|
| **Boot check** | Once, right after the renderer loads at launch | Auto mode only |
| **Periodic check** | Every 4 hours while running | Never — banner only |

## Auto (default)

- **Updates apply at launch, and only at launch.** The boot check
  auto-applies whatever is available.
- The 4-hour periodic checks **never** auto-apply, even in auto mode — they
  only show the "update available" banner. A user who leaves the app running
  for days stays on their launch-time version until they relaunch or click
  the banner.

## Manual

- **The app never updates on its own.** Boot and periodic checks are
  detection-only; both just show the banner.
- Updates apply only when the user triggers them (banner / "Check for
  updates"), running the same apply sequence as auto.

## The one exception (both modes)

If **cowork-server is down**, an available *server* update applies
immediately — regardless of mode, on any check, not just boot. A newer server
build may be exactly what fixes the crash, so this is recovery, not a routine
update. Server-only: the UI bundle never auto-applies in manual mode.

## What "applying" looks like

Always the same sequence, whether triggered by the boot check or the user:

1. **Server first** — update cowork-server; roll back if it fails its health
   probe.
2. **UI second, only if the server landed cleanly** — a failed server update
   defers the UI bundle to the next pass (tandem coupling).
3. **Window reload:**
   - UI swap → health-checked reload: the new bundle has 15s to finish
     loading, else automatic rollback (quarantine + reload the fallback).
   - Server-only update → plain reload of the unchanged renderer.

Net effect: every applied update — even server-only at boot — produces one
visible refresh of the window.

## Build kinds

Each packaged build carries a build kind, baked into `build-config.json` in
the app resources by its installer workflow. It gates **UI OTA** (ENG-670 /
PR #401); update polling and server updates run in every packaged build.

| Build kind | Built by | Update polling + server updates | UI OTA |
|---|---|---|---|
| `prod` | `prod-build-installer.yml` (release) | ✅ | **✅ enabled** |
| `stable` | `staging-build-installer.yml` (staging) | ✅ | ❌ bundled UI |
| `preview` | `dev-build-installer.yml` (per-PR) | ✅ | ❌ bundled UI |
| `dev` | unpackaged local run | ❌ no polling | ❌ bundled UI |

- Non-prod kinds keep the renderer bundled in the build so testers always run
  the branch-under-test UI, never a hot-updated one.
- Resolution order: `COWORK_BUILD_KIND` env → `build-config.json` → `dev` if
  unpackaged. The OTA gate uses the strict resolver (`buildKindStrict()`):
  a missing/malformed/unrecognized kind is **never** treated as `prod`, so a
  mispackaged build fails safe to OTA-off.
- QA override: `OTA_UI=on|off` flips the gate in any build without a rebuild
  (`otaUiEnabled()` in `update-logic.ts`).

## Related

- Disable server auto-update entirely: `COWORK_SERVER_DISABLE_AUTOUPDATE=1`.
- Manifest: `https://mindsdb.github.io/antontron-releases/latest.json`,
  published by `.github/workflows/publish-ui.yml` on every push to `main`.
