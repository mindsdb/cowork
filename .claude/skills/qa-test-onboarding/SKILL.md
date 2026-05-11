---
name: qa-test-onboarding
description: manually test the full onboarding flow (intro, terms, setup, onboarding) by backing up and clearing app state, launching the app, then restoring state afterward. use when asked to test onboarding, test first-run experience, simulate a fresh install, or verify the setup flow.
---

# QA Test — Onboarding Flow

## Overview

Test the first-run onboarding experience by temporarily clearing all persisted app state so the app behaves as a fresh install. Walk the user through verifying each screen in the flow: Intro → Terms → Setup → Onboarding → CoworkApp.

## Prerequisites

- The app must be built: `PATH="/opt/homebrew/opt/node@20/bin:$PATH" npm run pack`
- The app must NOT be running. Confirm with the user before proceeding.

## State locations

Two directories hold state that gates onboarding:

| Directory | What it holds |
|---|---|
| `~/Library/Application Support/Anton` | Electron user data: projects, preferences, caches |
| `~/.anton` | Server-side config: `.env` (API keys, `ANTON_TERMS_CONSENT`), `data_vault/` |

Both must be moved to simulate a true fresh install. Clearing only one is insufficient — `~/.anton/.env` contains `ANTON_TERMS_CONSENT` and provider keys that skip onboarding screens.

## Procedure

### 1. Back up state

```sh
mv "$HOME/Library/Application Support/Anton" "$HOME/Library/Application Support/Anton.bak"
mv ~/.anton ~/.anton.bak
```

### 2. Launch the app

```sh
./release/mac-arm64/Anton.app/Contents/MacOS/Anton
```

### 3. Verify the flow

Walk through each screen and confirm:

- [ ] **Intro sequence** plays (animation)
- [ ] **Terms consent** screen appears — accept to proceed
- [ ] **Setup / install** screen runs the installer steps
- [ ] **Onboarding** screen asks for API key / provider configuration
- [ ] **CoworkApp** loads after onboarding completes — server status shows online, home view renders

### 4. Quit and restore state

Quit the app (Cmd+Q), then restore:

```sh
rm -rf ~/.anton "$HOME/Library/Application Support/Anton"
mv ~/.anton.bak ~/.anton
mv "$HOME/Library/Application Support/Anton.bak" "$HOME/Library/Application Support/Anton"
```

The `rm -rf` removes any fresh state the app created during testing before restoring the backups.

## Safety rules

- NEVER delete state without backing it up first.
- NEVER run the restore step while the app is still running.
- Always confirm with the user before executing the backup/clear commands.
- If either backup path already exists (e.g. `Anton.bak` from a previous run), ask the user before overwriting.
