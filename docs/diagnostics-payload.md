# Failure diagnostics payload

| | |
|---|---|
| **Status** | Current |
| **Last updated** | 2026-09-11 |
| **Applies to** | `cowork` renderer |
| **Scope** | What "Copy diagnostics" puts on the clipboard, and why the boundary sits where it does |

## Purpose

The generic turn-failure card says an unexpected error occurred and shows a
reference id. "Copy diagnostics" beside it puts everything a support reply
needs on the clipboard in one click, so reporting a failure does not start with
the user opening a log file by hand.

This note exists so the next person to extend the payload knows the boundary is
deliberate.

## What it contains

Assembled by `src/renderer/cowork/lib/diagnostics.js`:

- The version rows from `lib/versionRows.js` — App shell, the build ring when
  known, UI, Server, Agent. The same function feeds the Updates settings panel,
  so the two cannot report different versions.
- `Reference:` — the turn's server-side correlation id.
- `Error code:` — the failure's wire code.
- A note that the server was unreachable, when the backend rows are blank.
- `Recent server log:` — the sidecar tail from `server:get-diagnostics`,
  scrubbed and limited to the last `LOG_TAIL_LINES` lines. Omitted entirely
  when empty.

## What it does not contain, on purpose

- **No traceback, exception text, or provider internals.** The server curates
  recognised failures and falls back to a generic message so internals never
  leak; the card keeps that rule. The gap this payload closes was that the
  generic branch gave the user no handle, not that it withheld detail.
- **Nothing beyond `server:get-diagnostics`.** The log is that IPC call's
  existing `recentLog`. Extending the payload means widening that surface,
  which is a separate decision with its own review.
- **No upload.** Clipboard only. Anything that transmits a user's log off the
  machine needs its own consent question.

## The scrub

`scrubLog()` redacts secret-shaped values — DSN credentials, bearer tokens,
recognisable provider key formats, and `key=value` pairs whose name says the
value is a secret — before the text is shown or copied.

It runs at every renderer consumer of the tail, not just the clipboard: the
backend settings panel and the offline help modal render the same text. If you
add a third consumer, call `scrubLog` there too.

**It is not a boundary around the log itself.** The sidecar's output is written
unredacted to `cowork-server.log` (see `main/server-process.ts`), which Help >
Reveal Logs opens, and it crosses IPC raw before any scrub happens. The scrub
covers what this app displays or copies, and nothing further upstream.

So it is a safety net over a surface we do not fully control, not a licence to
log secrets in the first place. Server-side logging rules still apply, and the
right fix for a leaked value is to stop logging it.
