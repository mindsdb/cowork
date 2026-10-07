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

- Env-only — hand-set `UI_UPDATE_MODE=manual` in the `.env` of the build's Cowork
  home: `~/.cowork` for prod, `~/.cowork-stable` for stable, or that home's
  `accounts/<id>/` when accounts have their own data roots. There is no
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
covered by OTA — it changes only when the app relaunches into a new build,
either through the background auto-update below (ENG-850) or a hand-installed
installer. The notice in this section is the fallback for shells that cannot
update themselves (auto-update disabled or terminally failed, Linux, and shells
from before 2.26.8.24.1). It can only *notice* an update, never apply one:

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
`electron-updater` feed. Both rings auto-update by default: stable led the
rollout, and prod followed once the signed N → N+1 swap-on-relaunch smoke
passed (macOS and Windows) and its observation window closed.
`SHELL_AUTO_UPDATE_ENABLED=false` is the emergency kill switch for either ring;
since both rings default on, `=false` is the only value that changes behavior
(`=true` just restates the default). The ENG-849 manual installer notice remains
the disabled/failure fallback.

When enabled, main owns one immutable shell-update snapshot:

`idle → checking → available → downloading → ready-to-install → installing`

- Auto mode downloads after detection and installs on normal app quit. Manual
  mode waits for an explicit download and explicit restart. Either way the quit
  path first drains any in-flight UI/server apply (bounded) before the process
  terminates, so the on-quit install cannot overlap an apply.
- **Restart asks first while tasks run (ENG-3291).** A restart that stops the
  sidecar ends every running turn. So the in-app Restart (Settings card,
  sidebar banner, and any other button that reaches `installShellAutoUpdate`
  or a UI/server apply that includes a server update) first asks main how
  many turns the sidecar is running, bounded at 2 seconds in total. Main reads
  two things at once: chat turns from `/responses/in-flight-list`, and Code
  turns as `/coding/sessions` entries whose status is `running` or
  `awaiting_approval`, since the stop interrupts those through
  `/coding/runtime/prepare-shutdown`. Either read failing counts as "cannot
  tell". The session status is persisted state, so a stale `running` left by a
  crash asks once too often, never too seldom. With none, the
  restart proceeds as before. Otherwise main answers
  `{ confirm: true, runningTasks }` instead of acting, and the renderer shows
  one dialog, "Stop N running tasks and restart?", with **Restart anyway** and
  **Cancel**. Cancel leaves the update ready. When the sidecar does not answer
  in time, `runningTasks` is null and the dialog says Cowork cannot tell. The
  exchange lives in `src/renderer/platform/restart-guard.ts` behind
  `host.applyUpdate` / `host.installShellAutoUpdate`, so every restart button
  inherits it; the dialog is `RestartConfirmHost`, mounted once in `App.tsx`.
  A plain quit (Cmd+Q) does not ask.
- **The sidecar stops before the shell exits.** `installShellAutoUpdate` first
  freezes the pending install (`ready-to-install` → `installing`), so a
  background refresh that finds a newer build during the stop is refused rather
  than moving the target. It then stops the sidecar (bounded, then
  force-reaped, like the quit drain) and only then calls `quitAndInstall`. The
  install counts as launched only when the app begins quitting (electron-
  updater's `before-quit-for-update`, or Electron's `before-quit`). A normal
  return from `quitAndInstall` is not enough: the library's `install()` catches
  installer exceptions, emits `error` and returns false, and on macOS Squirrel
  can fail while staging the bundle after the call returns. If the stop throws,
  the installer throws or reports an `error` event, or the app has not begun
  quitting within 60 seconds, the install is re-armed (`INSTALL_ABORTED`, back
  to `ready-to-install` with the reason on the snapshot) and the sidecar is
  started again, so an app that stays open keeps its backend. The boot install of a stranded update (ENG-2764) goes through
  the same function. On macOS the updater's quit tears the process down before
  `before-quit` can drain, so without this the shell was gone while a turn was
  still being written. The quit drain then finds nothing left to stop.
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
- A stalled check or download cannot starve later checks. `CHECK_REQUESTED` is
  refused while the phase is `checking` or `downloading`, so a check or download
  that settled without emitting its event would otherwise hold that phase for
  the rest of the process. The next `check()` abandons a check idle for more
  than 10 minutes (recoverable `check-stalled`) or a download with no progress
  event for 30 minutes (`download-stalled`), then proceeds. A stalled refresh
  behind a pending install just ends, leaving the armed download alone.
  `check-stalled` raises no banner, since there is nothing for the user to
  retry; the next scheduled check simply runs. `download-stalled` keeps its
  target and offers Retry. electron-updater deduplicates: a second
  `checkForUpdates()` or `downloadUpdate()` returns the promise already in
  flight. So abandoning a download also cancels it in the updater, through a
  CancellationToken the adapter mints for every download it starts, which
  settles that promise and frees the slot for a fresh transfer. The token
  cannot come from the check result: the library emits `update-available`,
  which starts the automatic download, before it creates that token. A check needs no cancelling: its feed
  request has a 60-second socket timeout in the library, so it always settles
  with an `error`, and a new check meanwhile adopts the same pending promise
  rather than starting a second request. Cancellation reaches only the
  transfer itself: a download stalled inside the library's checksum validation
  or its rename retries is not cancellable and stays bounded by the library.
  An `installing` phase that neither quits the app nor reports an error within
  60 seconds is re-armed by the install's own launch window (see the quit order
  above), which also restores the sidecar, so the stall guard leaves it alone.
  A late `error` from an operation the guard already abandoned
  is dropped rather than reported twice. While a check or download is in
  flight the periodic timer runs every 30 minutes, as it does with an install
  pending, so a stalled one is released within 30 minutes of crossing its
  threshold.

### Watching a rollout in PostHog

- `shell_update_phase` records each shell auto-update milestone once per app
  run, from the first launch screen onward: `available` (an update was found;
  in auto mode, its download started), `ready-to-install`, `installing` (the
  user clicked Restart, or launch installed a stranded update; `install_source`
  is `user` or `boot`),
  `failed` (with `error_code` and `recoverable`), and
  `relaunched`. `relaunched` is the boot verdict on the previous download:
  `error_code` is `install-not-applied` when the app came back on the old
  shell, and `install_source` is `boot` when a launch-time install produced the
  verdict. Count `installing` with `install_source=boot` against `relaunched`
  with the same source to watch the stranded-install rollout. `relaunched`
  fires once per install attempt: a launch that reports it rewrites the
  evidence as reported, so later launches still on the old shell stay quiet. An install on normal quit sends no `installing`; it appears only as
  the next launch's `relaunched`. Checks that find nothing send nothing.
- `boot_screen_resolved` carries `shell_version` and `build_kind` on every
  launch. Use them for shell adoption, not `app_version`: that is the running
  UI bundle, which OTA moves independently of the shell.

### Stranded updates: installed at the next launch (ENG-2764)

Install-on-quit only runs on a clean quit. After a force-quit, crash, or reboot,
the update stays downloaded and uninstalled, and the user meets the same banner
every launch.

When `shell-update-target.json` shows an earlier launch downloaded a target
this launch is not running, and no install of that target has been attempted,
by a boot install or a Restart click, the loading gate also waits on the shell
boot check, for up to 10 seconds in all, hand-off included. Every other launch
skips the wait. If that check replays a cached download, the app installs it
and relaunches before it is shown. The install starts only after the OTA boot
apply has settled, so it never quits the app mid-apply; the gate is held by
that apply anyway. On Windows the loading screen reads "Installing the update
— Cowork will reopen…" while the quit drains; on macOS the updater closes the
window before the renderer paints. The stale record stays on disk until the
check answers, so a crash in between does not lose it. `decideBootShellInstall`
in `src/main/update-logic.ts` requires all of:

- the snapshot is at `ready-to-install`;
- the mode is `auto`;
- no bytes were transferred this launch. electron-updater replays a cached
  download without emitting `download-progress`, so this separates a stranded
  update from a fresh one. The gate is released at the first progress event, and
  a fresh download is left to the banner and the next quit;
- no install of this target has been attempted. A failed boot install is
  marked before it runs; a failed Restart click leaves `installSource` behind.
  Either falls back to the banner.

A stranded update and a failed install look the same afterwards, so the attempt
is recorded in `shell-update-target.json` before it is made. The marker persists
until the target installs or a newer target replaces it, and the install is
skipped if the marker cannot be written.

## Supported desktop window (ENG-1047)

The three parts run on three clocks, and the shell's is the slowest: after each
release the boot check applies the new UI and sidecar at once, while the new
shell only starts downloading and installs on the next quit. So on an existing
install every new UI first runs on the previous shell, and an app that sat
unlaunched for weeks runs a brand-new UI on a weeks-old shell until its user
restarts. The UI copes by probing bridge methods and falling back silently,
which is how a 5-week-old shell came to hide Code mode and the onboarding
organization picker on 6 October 2026 without a word. This section names how
far back that gap may reach.

**The window.** A prod shell is supported when both hold:

- it is **`2.26.9.21.1` or newer** — the hard floor. That shell introduced
  per-account data roots (ENG-548) and the post-update auth probe (ENG-2852);
  older shells show one account's data to whoever signs in, and it already
  carries every bridge member today's UI reads;
- it is **at most 14 days older than the newest published prod shell**, the
  `shellVersion` in `latest.json`. Measured against the shell, never the UI:
  UI-only publishes ship without a new shell, so a rule measured against the UI
  would call the newest shell too old after a pause in shell releases. Prod
  shells shipped 11 times in the 33 days to 4 October 2026, never more than 6
  days apart, so 14 days spans at least two releases.

The newest published prod shell is always inside the window. Web, stable and
preview builds are never judged: web has no shell, and stable/preview always run
their bundled UI, so their shell and UI cannot drift apart.

**Where it lives.** Both values are constants in
[src/shared/shell-support.ts](../src/shared/shell-support.ts)
(`MIN_SUPPORTED_SHELL`, `SUPPORTED_SHELL_WINDOW_DAYS`), applied by the pure
`assessShellSupport()`. They are the ENG-1047 proposal, pending the product
decision recorded on that ticket. **Who moves them:** the engineer shipping a
UI or cowork-server change that an older shell cannot run raises the floor in
the same PR, with this section and cowork-server's `README.md` updated to match.
The window should move only when a shell below it would break, not on a
schedule.

**No server ceiling.** Shells keep taking every new cowork-server release, as
they do today. cowork-server keeps its desktop-facing contract working for
every shell in the window (`tests/test_desktop_contract.py` there is the
guard), and server-side compatibility fixes keep reaching shells below it.

**What a user below the window sees.** The check runs in the UI bundle, because
that is the only code that reaches shells already installed. On the first
screen after launch — onboarding or the chat app — a warning names the installed
shell version and offers one action: **Restart to update** when the auto-updater
has the new shell downloaded, **Download update** when it has found one, and
**Download the latest app** (opens `https://mindshub.ai/download`) on shells that
cannot update themselves. Dismissing it lasts for that launch only. Settings →
Updates marks the App shell row "⚠ too old" and says so in a warning under the
version block. When the UI cannot read or parse a version the rule needs — the
installed shell version, or the manifest's `shellVersion` — it shows nothing and
the app works as before.

Not covered here, by design: a shell too old to load OTA bundles at all (before
2.26.7.20.1) never runs this code, so only cowork-server reaches it; a
minimum-shell field in the manifest that the shell itself enforces would reach
only shells built after it ships and is a follow-up once the window has settled.

## Build kinds

Each packaged build carries a build kind, baked into `build-config.json` in
the app resources by its installer workflow. It gates **UI OTA** (ENG-670 /
PR #401); update polling and server updates run in every packaged build.

| Build kind | Built by | Update polling + server updates | UI OTA | Shell auto-update (ENG-850) |
|---|---|---|---|---|
| `prod` | `prod-build-installer.yml` (release) | ✅ | **✅ enabled** | **✅ default on** (`=false` kill switch) + ENG-849 manual notice always on |
| `stable` | `staging-build-installer.yml` (staging) | ✅ | ❌ bundled UI | **✅ default on** (first rollout ring; `=false` kill switch) |
| `preview` | `dev-build-installer.yml` (per-PR) | ✅ | ❌ bundled UI | ❌ fail closed |
| `dev` | unpackaged local run | ❌ no polling | ❌ bundled UI | ❌ not packaged |

- Non-prod kinds keep the renderer bundled in the build so testers always run
  the branch-under-test UI, never a hot-updated one.
- The shell channels are separate from UI OTA: both `stable` and `prod` get
  automatic shell updates by default (`stable` while running its bundled UI).
  The disabled/failure fallback is the **prod-only** ENG-849 manual "download
  the installer" notice (see "Prod-only" above) — `stable` has no manual notice,
  so a disabled or failed `stable` auto-update surfaces only in Settings.
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

### Going back to an older shell mixes account data again

Per-account data roots live in the shell, not the sidecar: the shell decides
which root to hand over and sets `COWORK_HOME` accordingly. A build from before
that existed does not read the partition — it uses the shared home for whoever
signs in.

So on an older shell every account sees the data at the shared root, which
belongs to whichever account owns it, and any account partitioned into
`<home>/accounts/<id>/` finds its own data missing. Nothing is deleted: the
subtrees stay on disk and reappear when a partition-aware build runs again. But
while the older build is in use the isolation is simply not there, and the
account that owns the shared root has its tasks, files, provider keys and
connector credentials visible to anyone who signs in.

This matters in two ordinary situations, neither of which is an update failure:

- A deliberate downgrade, or a machine kept on an older channel.
- A local `npm run pack`, which is prod-kind and therefore shares the
  production data home. A developer building locally on a machine that also
  runs the released app is exactly this case.

There is no in-app guard, because the build that would have to warn is the one
that knows nothing about partitions. Treat it as a property of downgrading
rather than a bug to be reported.

## Sample scenarios: what the user sees

The app updates three independently-versioned pieces, each through its own
mechanism and its own on-screen surface:

- **UI** (React renderer) — hot-swapped OTA bundle (`prod` builds only).
- **Server** (`cowork-server` sidecar) — reinstalled and restarted in place.
- **Shell** (the Electron app binary) — cannot hot-update; replaced by an
  automatic background download that installs on relaunch (`stable` and `prod`
  by default), or a hand-downloaded installer.

UI and server are **coupled** and auto-apply together at boot (server first).
The shell is **independent** and always needs a restart to take effect.

The sidebar shows **exactly one update banner** (or none), chosen by the pure
`deriveUpdateBanner()` in [src/shared/update-banner.ts](../src/shared/update-banner.ts)
and mirrored by Settings → Updates. Priority is **shell-first**: whenever a
shell update is pending (auto-update or the manual notice), it owns the banner
slot and the OTA "Restart" is suppressed. A shell relaunch is the superset
action — the boot check auto-applies any pending UI/server OTA on relaunch — so
one click updates everything, and an OTA reload never leaves a shell banner
behind. Historically each mechanism had its own block with only pairwise guards,
so an OTA update and a shell auto-update (which poll together) stacked into two
pills, and an OTA reload — which does *not* relaunch the shell — left the shell
banner behind; the single derived banner removes both.

The possible banners, in priority order:

- **Shell** (auto-update) → a pill that walks the phases **"New app version
  available — Download" → "Downloading update (42%)…" → "Update ready — Restart
  now"** (in auto mode the download happens on its own; a restart installs it).
  In auto mode the pill is a shortcut: `autoInstallOnAppQuit` installs the update
  on the next normal quit, and the tooltip says so. Manual mode shows no such
  tooltip. The OTA pill's tooltip likewise notes the next launch applies it.
- **Shell** (manual fallback) → a dismissible **"New version available —
  Download"** notice linking to the installer.
- **UI/server found mid-session** (only when no shell update is pending) → a
  sidebar **"Update ready — Restart"** pill and a Settings card ("Server → …" /
  "UI → …"). The Restart reloads the renderer.
- **UI/server auto-apply** (boot) is not a banner at all → a brief full-screen
  overlay (spinner + "Downloading the latest update…" / "Finishing up…"), then
  the window reloads.

The boot overlay describes **OTA only** (ENG-2764). A shell download is never
applied by the gate, so naming it announced an update the app then asked the user
to apply by hand. The copy makes no completion claim ("Finishing up…"), so it
cannot contradict a pending shell update.

| Updates pending | What the user sees |
|---|---|
| **Server only, at boot** | Auto-applies. Brief overlay ("Almost there…"), then the window reloads on the new sidecar. Effectively invisible. |
| **Server only, found mid-session** (4h periodic) | No auto-apply. A sidebar "Update ready — Restart" pill + Settings card ("Server → `<version>`"). Clicking it reloads the window and restarts the sidecar — *not* a full app relaunch. |
| **Server only, server is down** | Force-applied immediately regardless of mode — recovery, not routine. Overlay + reload. |
| **Server on the wrong stream** (prod build holding a pre-release) | Repaired like a boot server update: overlay + reload onto the latest stable. If the stable server can't boot against the rc-migrated database, the pre-release is restored and the app comes back up; the repair retries next launch. The boot log's "stream check" line records what happened. |
| **UI only, at boot** (`prod`) | Auto-applies. Overlay + health-checked reload (the new bundle has 15s to load or it rolls back and quarantines). |
| **UI only, found mid-session** | Banner only; applies on the next relaunch or when the user clicks Restart. |
| **Server + UI, at boot** | Both auto-apply, server first, in one pass → one overlay + one reload. If the server update fails, the UI is deferred to the next pass (tandem coupling). |
| **Shell downloaded but never installed** (force-quit, crash, reboot) | The next launch installs it and relaunches before the app is shown. A failed attempt falls back to the banner. |
| **Shell only** (auto-update eligible) | Never named on the loading screen. The pill/card walk "available → downloading (%) → ready-to-install". In auto mode the update installs on the next normal quit, and **Restart now** is the shortcut. |
| **Shell only** (auto-update disabled/failed, `prod`) | Falls back to the "New version available — Download" notice → installer on `downloads.mindshub.ai`. The user downloads it, quits the app, and runs the installer by hand. |
| **Shell below the supported window** (`prod`, see above) | On the first screen after launch, a warning names the installed shell and offers one action — Restart / Download through the auto-updater, or the download page on shells that cannot update themselves. Dismissible per launch; Settings → Updates marks the App shell "⚠ too old". |
| **Shell + Server + UI, all pending** (mid-session) | One shell-first banner. Server + UI apply seamlessly at boot (overlay + reload); mid-session the shell banner owns the slot and the OTA "Restart" is suppressed, because the shell relaunch applies the pending UI/server OTA at boot anyway. One "Restart" resolves all three — no stacked pills, and nothing lingers after the relaunch. |

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
  shell is shown on its own line (it changes only on a relaunch), with the
  supported-window verdict beside it.
  The Server and Agent rows read `/health` with a 10-second bound and retry
  every 5 seconds while the panel is open; until a read answers they show
  "Loading…" and then "Unavailable", never a bare dash, and the details Copy
  copies that state (ENG-3291).
- A **failed** UI/server apply keeps the banner as a "Try again" retry instead
  of silently vanishing until the next poll.

## Related

- Disable server auto-update entirely: `COWORK_SERVER_DISABLE_AUTOUPDATE=1`.
- Manifest: `https://mindsdb.github.io/antontron-releases/latest.json`,
  published by `.github/workflows/publish-ui.yml` on every push to `main`.
