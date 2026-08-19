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
- One mode governs the cowork-server update, the UI (OTA) bundle, **and** the
  shell auto-updater's download step (in manual mode the shell waits at
  "available" for an explicit Download click instead of downloading on its own).
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

## Shell automatic update lifecycle (ENG-850)

Eligible packaged prod/stable builds contain a channel-specific
`electron-updater` feed. Stable is the first automatic-update rollout ring;
prod remains disabled by default until stable completes signed N → N+1 smoke
testing and its observation window. `SHELL_AUTO_UPDATE_ENABLED=false` is the
emergency stable kill switch, while `true` explicitly opts prod into QA. The
ENG-849 manual installer notice remains the disabled/failure fallback.

When enabled, main owns one immutable shell-update snapshot:

`idle → checking → available → downloading → ready-to-install → installing`

- Auto mode downloads after detection and installs on normal app quit. Manual
  mode waits for an explicit download and explicit restart. Either way the quit
  path first drains any in-flight UI/server apply (bounded) before the process
  terminates, so the on-quit install cannot overlap an apply.
- Concurrent boot, periodic, and manual checks coalesce into one operation.
- The renderer pulls the snapshot on mount and subscribes to full snapshot
  changes, so a UI reload cannot lose progress/readiness state.
- A downloaded target is persisted as small durable evidence. The next launch
  compares the running internal SemVer with that target and reports a
  recoverable `install-not-applied` failure if relaunch stayed on the old shell.
- UI/server apply and shell install share a maintenance gate; shell install
  also waits for active server lifecycle work. The explicit in-app install
  enters the gate directly; the auto-mode on-quit install is serialized by the
  quit drain above.
- Signature/checksum failures are terminal for automatic update, while the
  existing manual installer URL remains available.

## Build kinds

Each packaged build carries a build kind, baked into `build-config.json` in
the app resources by its installer workflow. It gates **UI OTA** (ENG-670 /
PR #401); update polling and server updates run in every packaged build.

| Build kind | Built by | Update polling + server updates | UI OTA | Shell auto-update (ENG-850) |
|---|---|---|---|---|
| `prod` | `prod-build-installer.yml` (release) | ✅ | **✅ enabled** | ⚙️ opt-in (`SHELL_AUTO_UPDATE_ENABLED=true`) + ENG-849 manual notice always on |
| `stable` | `staging-build-installer.yml` (staging) | ✅ | ❌ bundled UI | **✅ default on** (first rollout ring; `=false` kill switch) |
| `preview` | `dev-build-installer.yml` (per-PR) | ✅ | ❌ bundled UI | ❌ fail closed |
| `dev` | unpackaged local run | ❌ no polling | ❌ bundled UI | ❌ not packaged |

- Non-prod kinds keep the renderer bundled in the build so testers always run
  the branch-under-test UI, never a hot-updated one.
- The shell channels are separate from UI OTA: `stable` gets automatic shell
  updates by default while running its bundled UI, and `prod` gets the ENG-849
  manual "download the installer" notice even when auto-update is left opt-out.
- Resolution order: `COWORK_BUILD_KIND` env → `build-config.json` → `dev` if
  unpackaged. The OTA gate uses the strict resolver (`buildKindStrict()`):
  a missing/malformed/unrecognized kind is **never** treated as `prod`, so a
  mispackaged build fails safe to OTA-off.
- QA override: `OTA_UI=on|off` flips the gate in any build without a rebuild
  (`otaUiEnabled()` in `update-logic.ts`).

## Stream repair: a prod install holding a pre-release

Only staging-ring builds (`stable`, `preview`) follow the rc pre-release
stream; `prod` resolves stable releases only. But a prod machine can still
*hold* an rc — e.g. a uv tool dir once shared with a staging build — and an
rc sorts above the stable it precedes, so the plain "is PyPI newer" check
reports it up to date forever.

Every PyPI-channel check therefore starts with a stream check, logged as one
line naming the build kind, the installed `cowork-server` and `anton-agent`
versions, and the verdict (`stream check: build=… — off stream, repairing
to …` / `on stream, nothing to repair`). On a prod build holding a
pre-release the check reports an available update, and the boot pass applies
it: the latest stable is reinstalled (with whatever `anton-agent` its wheel
resolves) and health-checked. If the stable server cannot boot — typically
because the rc migrated the database ahead of it — the rc is restored, the
app comes back up, and the repair retries on the next launch. Data under
the cowork home is never touched; projects, conversations, and credentials
all survive the repair.

The repair is boot-only. Mid-session polls, the Settings check, and a manual
"Restart now" never surface or apply it — a downgrade offer in the update
pill reads as the app being confused, so the stranded install simply repairs
itself on the next launch.

## Sample scenarios: what the user sees

The app updates three independently-versioned pieces, each through its own
mechanism and its own on-screen surface:

- **UI** (React renderer) — hot-swapped OTA bundle (`prod` builds only).
- **Server** (`cowork-server` sidecar) — reinstalled and restarted in place.
- **Shell** (the Electron app binary) — cannot hot-update; replaced by an
  automatic background download that installs on relaunch (`stable` by default,
  `prod` opt-in), or a hand-downloaded installer.

UI and server are **coupled** and auto-apply together at boot (server first).
The shell is **independent** and always needs a restart to take effect. That
split is why there is never a single combined "3 updates" prompt — the seamless
pair and the restart-required shell are different surfaces:

- **UI/server auto-apply** (boot) → a brief full-screen overlay (spinner +
  "Updating…" / "Almost there…"), then the window reloads.
- **UI/server found mid-session** → a sidebar **"Update ready — Restart"** pill
  and a Settings → Updates card ("Server → …" / "UI → …").
- **Shell** (auto-update) → a sidebar pill + Settings card that walk the phases
  **"New app version available" → "Downloading update (42%)…" → "App update
  ready — Restart"**.
- **Shell** (manual fallback) → a dismissible **"New version available —
  Download"** notice linking to the installer.

| Updates pending | What the user sees |
|---|---|
| **Server only, at boot** | Auto-applies. Brief overlay ("Almost there…"), then the window reloads on the new sidecar. Effectively invisible. |
| **Server only, found mid-session** (4h periodic) | No auto-apply. A sidebar "Update ready — Restart" pill + Settings card ("Server → `<version>`"). Clicking it reloads the window and restarts the sidecar — *not* a full app relaunch. |
| **Server only, server is down** | Force-applied immediately regardless of mode — recovery, not routine. Overlay + reload. |
| **Server on the wrong stream** (prod build holding a pre-release) | Repaired like a boot server update: overlay + reload onto the latest stable. If the stable server can't boot against the rc-migrated database, the pre-release is restored and the app comes back up; the repair retries next launch. The boot log's "stream check" line records what happened. |
| **UI only, at boot** (`prod`) | Auto-applies. Overlay + health-checked reload (the new bundle has 15s to load or it rolls back and quarantines). |
| **UI only, found mid-session** | Banner only; applies on the next relaunch or when the user clicks Restart. |
| **Server + UI, at boot** | Both auto-apply, server first, in one pass → one overlay + one reload. If the server update fails, the UI is deferred to the next pass (tandem coupling). |
| **Shell only** (auto-update eligible) | Independent of the overlay. The pill/card walk "available → downloading (%) → ready-to-install". Background download; nothing installs until the user clicks **Restart** (or, in auto mode, on the next normal quit). |
| **Shell only** (auto-update disabled/failed, `prod`) | Falls back to the "New version available — Download" notice → installer on `downloads.mindshub.ai`. The user downloads it, quits the app, and runs the installer by hand. |
| **Shell + Server + UI, all pending** | Two experiences at once: server + UI apply seamlessly at boot (overlay + reload), while the shell surfaces as a *separate*, non-blocking "App update ready — Restart" notice the user actions whenever convenient. No combined prompt. |

Notes:

- **Taskbar pins survive both Windows update paths** (ENG-1367). The
  auto-updater runs the installer with `--updated`, and manual installer runs
  keep shortcuts because the assisted installer is built without
  `allowToChangeInstallationDirectory` — either way the previous version's
  uninstaller is invoked with `--keep-shortcuts`, so the Start-Menu shortcut
  and AppUserModelID the pin references are preserved. The pin is only lost
  when *updating to* a build older than this fix, whose installer still
  deleted them on manual runs.
- The **"Current version"** readout in Settings collapses UI + server + agent
  into one unified CalVer and flags "⚠ out of sync" when they drift more than
  `SKEW_WARN_DAYS` apart — so a server-only update that lands before its matching
  UI can briefly show that warning until the next UI bundle catches up. The app
  shell is shown on its own line (it changes only on reinstall/relaunch).
- A **failed** UI/server apply keeps the banner as a "Try again" retry instead
  of silently vanishing until the next poll.

## Related

- Disable server auto-update entirely: `COWORK_SERVER_DISABLE_AUTOUPDATE=1`.
- Manifest: `https://mindsdb.github.io/antontron-releases/latest.json`,
  published by `.github/workflows/publish-ui.yml` on every push to `main`.
