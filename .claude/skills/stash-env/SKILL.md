---
name: stash-env
description: stash the current Anton environment so you can test onboarding from scratch. use when asked to reset onboarding, stash env, save env state, or test the fresh-user experience.
---

# Stash Anton Environment

Move `~/.anton` to `~/.anton.bak` so the app boots into onboarding like a new user.

## Steps

1. Check if `~/.anton.bak` already exists. If so, tell the user and stop — don't overwrite a previous stash.
2. Run `mv ~/.anton ~/.anton.bak`
3. Confirm it worked. Remind user to restart Anton and that `/restore-env` brings it back.
