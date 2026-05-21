---
name: ota
description: manage the Anton UI update system. use when asked to check UI publish status, switch dev mode (live/bundled/production), or trigger a UI publish.
---

# Anton UI Updates

Anton's renderer UI can be updated independently from the Electron app itself. When code under `src/renderer/**` is pushed to `main`, a CI workflow automatically builds the renderer and publishes it as a downloadable bundle. Users' apps pick up new bundles on launch.

This skill helps you answer: **"Are users seeing what's in our code?"** and manage how your local app loads the renderer.

## Key locations

| What | Path |
|------|------|
| Config file | `~/.anton/.env` |
| OTA cache | `~/Library/Application Support/Anton/ui-cache/` |
| Published manifest | `https://mindsdb.github.io/cowork/latest.json` |
| Publish workflow | `.github/workflows/publish-ui.yml` (repo: `mindsdb/cowork`) |
| Releases | `https://github.com/mindsdb/cowork/releases` (filter `ui-v*`) |

## Actions

When the user invokes `/ota`, determine which action they want. **If unclear, default to Status.**

---

### 1. Status

**Default action.** Answers: "Is the published UI in sync with what's in main?"

Steps:

1. Read `~/.anton/.env` and report the current `DEV_MODE` value. Explain what it means using the friendly names from the dev mode table below.
2. Fetch `https://mindsdb.github.io/cowork/latest.json` — extract the published version (which includes a git short SHA, e.g. `2.0.4-e94e713`).
3. Run `git log --oneline -1 origin/main -- src/renderer/ src/shared/ package.json` to get the latest commit on main that would trigger a publish.
4. Compare the SHA in the published version against the SHA from step 3. Report whether they match.
5. If they don't match, check if a publish workflow is currently running: `gh run list --workflow=publish-ui.yml --repo mindsdb/cowork --limit 3` and report its status.
6. Check for local uncommitted or unpushed renderer changes: `git diff --stat HEAD -- src/renderer/` and `git log --oneline origin/main..HEAD -- src/renderer/`. If there are local changes, note that these won't be published until pushed to main.

Present the output as a markdown table with two columns. Use bold for the labels. Example:

```markdown
## UI Update Status

| | |
|---|---|
| **Dev mode** | Bundled (default) -- app uses the renderer shipped in the .app |
| **Published version** | `2.0.4-e94e713` |
| **Latest on main** | `e94e713` -- "fix sidebar toggle" |
| **In sync?** | Yes |
| **Local changes** | 2 uncommitted files in `src/renderer/` *(won't reach users until pushed to main)* |

If there are CI failures, add a row:

| **Publish CI** | Last 3 runs failed -- run `/ota publish` to retry or investigate |
```

Rules for the status table:
- Always include Dev mode, Published version, Latest on main, and In sync rows.
- Only include Local changes row if there are actual local changes.
- Only include Publish CI row if runs have failed or are in progress.
- For "In sync?", use "Yes" or "No -- published version is N commits behind main".
- If out of sync, add a brief suggestion after the table: either wait for CI or run `/ota publish`.

---

### 2. Dev Mode

Switch how the local app loads the renderer. There are three modes:

| Friendly name | DEV_MODE value | What it does |
|---|---|---|
| **Live** | `DEV_MODE=live` | Loads renderer from Vite dev server at `localhost:5173`. Use when actively editing renderer code -- gives you hot reload. You must have `npm run dev` running. |
| **Bundled** | `DEV_MODE=full` | Uses the renderer built into the .app package. Ignores any OTA updates. This is the current default when DEV_MODE is not set. |
| **Production** | `DEV_MODE=ota` | Uses the OTA update system -- downloads published bundles on launch, just like a real user would see. Use to verify that a publish worked correctly. |

Steps:

1. If the user didn't specify a mode, show the current mode (read `~/.anton/.env`) and present the three options with their descriptions. Ask which they'd like.
2. Read `~/.anton/.env`.
3. If a `DEV_MODE=...` line exists, replace it with the new value. If switching to Bundled and no `DEV_MODE` line exists, no change is needed (it's the default).
4. If no `DEV_MODE` line exists, append the new value.
5. Write the file back, preserving all other lines.
6. Confirm the change and remind the user to **restart the app** for it to take effect.
7. If setting to **Live**, remind them to run `npm run dev` first.
8. If setting to **Production**, also clear the OTA cache (`rm -rf ~/Library/Application\ Support/Anton/ui-cache/`) so the app downloads a fresh bundle on next launch.

---

### 3. Publish

Manually trigger a UI publish. This is rarely needed since publishing happens automatically on push to main, but useful when:
- CI didn't trigger for some reason
- You want to force a re-publish of the current version

Steps:

1. First, check if there's already a recent successful publish that matches main: run `gh run list --workflow=publish-ui.yml --repo mindsdb/cowork --limit 3` and show the results.
2. If the latest run succeeded and matches the current main HEAD, tell the user it's already published -- no action needed.
3. Otherwise, trigger the workflow: `gh workflow run publish-ui.yml --repo mindsdb/cowork`
4. Confirm it was triggered and show how to monitor: `gh run list --workflow=publish-ui.yml --repo mindsdb/cowork --limit 1`
5. Note that it typically takes 1-2 minutes to complete, and users' apps will pick up the new version on their next launch.

---

## Safety

- Never modify source files (`src/main/ui-updater.ts`, etc.) through this skill -- operational management only.
- Always read `~/.anton/.env` before writing to avoid clobbering other settings.
- When modifying env vars, preserve all other lines including comments and blank lines.
- The OTA cache (`ui-cache/`) only contains downloaded bundles that will be re-fetched -- safe to delete.
