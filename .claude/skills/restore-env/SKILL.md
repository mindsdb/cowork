---
name: restore-env
description: restore a previously stashed Anton environment. use when asked to restore env, unstash, get back previous settings, or undo an onboarding reset.
---

# Restore Anton Environment

Move `~/.anton.bak` back to `~/.anton`.

## Steps

1. Check if `~/.anton.bak` exists. If not, tell the user there's nothing to restore.
2. If `~/.anton` currently exists, remove it first (it's just onboarding artifacts from testing).
3. Run `mv ~/.anton.bak ~/.anton`
4. Confirm it worked. Remind user to restart Anton.
