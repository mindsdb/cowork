// Boot-update gate budget + race (ENG-749).
//
// The renderer holds the loading screen until the boot sequence settles: the
// sidecar start decision plus the boot-time update poll. A boot server update
// stops the sidecar, reinstalls it, and restarts it — during which the server is
// down — so the gate must stay closed until that finishes, or it flashes the
// chat UI in a "Connect a provider" state.
//
// There is exactly ONE authoritative budget, and it lives here in main (not the
// renderer), sized from the real operation caps the poll can hit. An earlier
// renderer-side 45s fail-open sat *inside* that envelope and could release the
// gate mid-reinstall — the bug this module fixes. The renderer now simply waits
// for main to settle.

import { SERVER_START_CAP_MS } from '../shared/server-status';

// runUv's reinstall cap — the `execFile(..., { timeout })` in server-updater.ts
// (`runUv`). Mirrored here as a named constant so the budget below is
// authoritative; keep in sync with that call site.
export const SERVER_REINSTALL_CAP_MS = 180_000;

// Last-resort upper bound on how long the gate holds the loading screen. Sized
// from the real caps: a server update reinstalls (SERVER_REINSTALL_CAP_MS) and
// restarts (SERVER_START_CAP_MS) the sidecar, and a failed attempt rolls back
// with the same two steps — plus a minute of slack for a UI download/reload.
// Every operation the poll runs is individually bounded, so the gate normally
// resolves long before this; the budget only fires if one genuinely hangs, and
// is deliberately far larger than any single op so it never fires during a
// legitimately slow update.
export const BOOT_UPDATE_BUDGET_MS =
  2 * (SERVER_REINSTALL_CAP_MS + SERVER_START_CAP_MS) + 60_000;

/**
 * Resolve when the boot sequence `settled` promise resolves, or after
 * `budgetMs` as a last-resort backstop against a hung boot poll — whichever
 * comes first. Never rejects.
 */
export function awaitBootGate(
  settled: Promise<void>,
  budgetMs: number = BOOT_UPDATE_BUDGET_MS,
): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, budgetMs);
    // Don't let the backstop timer keep the process alive on quit.
    timer.unref?.();
    settled.then(finish, finish);
  });
}
