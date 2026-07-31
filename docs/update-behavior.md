# Desktop update behavior

Reference for how and *when* the Cowork desktop app applies updates.
Source of truth: `src/main/updater.ts` (orchestration) and `decideUpdateApply()`
in `src/main/update-logic.ts`.

## Default behavior (everyone)

Since ENG-858, there is no user-facing update setting — Settings → Updates
no longer has an Auto/Manual control. Server and UI updates auto-apply at
boot for every install.

| Check | When | Can it apply? |
|---|---|---|
| **Boot check** | Once, right after the renderer loads at launch | Yes |
| **Periodic check** | Every 4 hours while running | Never — banner only |

The 4-hour periodic checks **never** auto-apply — they only show the
"update available" banner. A user who leaves the app running for days stays
on their launch-time version until they relaunch or click the banner.

## Escape hatch: `UI_UPDATE_MODE=manual`

- Env-only — hand-set `UI_UPDATE_MODE=manual` in `~/.anton/.env`. There is no
  UI for this; it's a support mitigation (pin a user to manual if a bad
  version ships) and a QA version-pinning lever, not a setting anyone
  discovers on their own.
- With it set: **the app never updates on its own.** Boot and periodic checks
  become detection-only; both just show the banner. Updates apply only when
  the user triggers them (banner / "Check for updates"), running the same
  apply sequence as the default.
- One mode governs **both** the cowork-server update and the UI (OTA) bundle.
- Pre-existing `UI_UPDATE_MODE=manual` entries from before ENG-858 continue
  to work exactly as before — nothing to migrate.

## The one exception (default and the escape hatch)

If **cowork-server is down**, an available *server* update applies
immediately — regardless of mode, on any check, not just boot. A newer server
build may be exactly what fixes the crash, so this is recovery, not a routine
update. Server-only: the UI bundle never force-applies on a down server.

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

## Shell (installer) update notice (ENG-849)

The Electron **shell** (`src/main`, preload, the runtime, native deps) is *not*
covered by OTA — it updates only when the user downloads and reinstalls a new
installer. So the app can't apply a shell update; it can only *notice* one:

- The boot/periodic poll compares the installed shell CalVer against
  `shellVersion` in `latest.json`. If a newer shell exists it pushes a
  `shell-available` status.
- Surfaced as a dismissible sidebar banner ("New version available — Download")
  and an "App update available" card in Settings → Updates, both linking to the
  installer on `downloads.mindshub.ai`. Detection only — never downloads or
  installs.
- **Prod-only.** The manifest is prod-only and a non-prod build must never be
  pointed at a prod installer (ENG-676), so non-prod builds don't check.
- `shellVersion` is written by `publish-ui.yml` **only on the auto-release
  path** (where a prod installer actually ships), so a UI-only re-publish can't
  fabricate a phantom "reinstall" notice.
- Banner dismissal is **per-version** (localStorage) — a dismissed notice
  reappears when a newer shell ships. Settings always shows the current state.

Auto-download / install-on-relaunch (electron-updater) is a separate,
out-of-scope effort (ENG-850).

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
