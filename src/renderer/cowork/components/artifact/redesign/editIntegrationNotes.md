# M1 "Fix it in place" — integration contract

This documents exactly what the integration agent must implement so the inline-edit
UI (`useInlineEdit` → `EditableBlock`/`Puck`/`InlineDiff`) talks to the real backend
instead of the built-in mock.

The UI is **transport-agnostic**. It never calls `fetch` itself. You wire it up by
passing two async functions plus a `baseVersionId` into `useInlineEdit` (or, more
commonly, into `<EditableBlock>`, which forwards them):

```js
<EditableBlock
  text={block.text}
  target={{ artifactId, blockId: block.id, range: block.range }}
  baseVersionId={artifact.versionId}
  proposeEdit={proposeEdit}     // ← you implement
  commitEdit={commitEdit}       // ← you implement
  onComment={handleComment}     // optional: persist the comment
  onCommitted={handleCommitted} // update local doc state + version
  onToast={showToast}
/>
```

## The two functions

### `proposeEdit({ target, instruction }) → Promise<{ oldText, newText }>`

Called when the user submits a prompt (or taps a chip) in the puck. It should ask the
backend (which calls the LLM) for a rewrite and resolve with the **before** and
**after** text.

- `target` — opaque, whatever you passed to `EditableBlock`'s `target` prop. Recommended
  shape: `{ artifactId, blockId, range }`. The UI does not inspect it.
- `instruction` — the user's natural-language ask, e.g. `"Shorten"`, `"Make it warmer"`.
- **Resolve** with `{ oldText, newText }` (both strings).
  - If `newText.trim() === oldText.trim()`, the hook treats it as a **no-op**: it does
    NOT enter the diff state, returns to idle, and raises the toast
    *"Already looks good — no change suggested"*. (You can also short-circuit this
    server-side and still return equal strings — the UI handles it either way.)
- **Reject** (throw) to signal a generation failure. The hook returns to idle and
  toasts the error's `.message` (fallback: *"Anton could not draft a change — try
  again"*). Keep messages human and reassuring.

Suggested wire call:

```
POST /artifacts/edits/propose
{
  "artifactId":   "art_123",
  "blockId":      "blk_email3",        // or a range / selector for the target
  "baseVersionId":"v4",                // the version the user is looking at
  "instruction":  "Shorten",
  "type":         "document"           // prose; lets the model pick track-change granularity
}
→ 200 { "oldText": "...", "newText": "...", "proposalId": "prop_789" }
```

> Keep a handle on `proposalId` if your backend issues one (stash it on the resolved
> object or in a ref keyed by `target`); you'll echo it back on accept so the server can
> correlate. The UI itself doesn't need it.

### `commitEdit({ target, newText, baseVersionId }) → Promise<{ ok, versionId } | conflict>`

Called when the user clicks **Keep**. It must perform a **compare-and-swap**: only apply
`newText` if the artifact is still at `baseVersionId`. This is what prevents one
collaborator's Keep from silently clobbering another's edit.

- **Success** → resolve `{ ok: true, versionId, text? }`. The hook fires
  `onCommitted({ target, newText, versionId })` and returns to idle. Use `versionId` to
  advance your local artifact version (and your scrubber, story feed, etc.).
- **Conflict (the artifact moved since `baseVersionId`)** → signal it **either** way:
  - resolve `{ conflict: { message } }` (or `{ ok: false }` / `{ status: 409 }`), **or**
  - throw an error with `err.status === 409` (or `err.code === 'conflict'`).

  On conflict the hook **stays in the diff state** and surfaces the conflict inline. The
  `InlineDiff` swaps its primary button label from **Keep** to **Merge & keep** and shows
  the message *"This changed since you started — Anton can merge your edit"* (override via
  `conflict.message`). Nothing is lost — the user's proposed `newText` is still on screen.

Suggested wire call:

```
POST /artifacts/edits/accept
{
  "artifactId":    "art_123",
  "blockId":       "blk_email3",
  "proposalId":    "prop_789",         // optional, if propose returned one
  "newText":       "...",
  "baseVersionId": "v4"                // compare-and-swap key
}
→ 200  { "ok": true, "versionId": "v5" }
→ 409  { "error": "version_conflict", "currentVersionId": "v6",
         "message": "This changed since you started — Anton can merge your edit" }
```

## Handling the 409 conflict (recommended flow)

The shipped UI does the minimum-good thing: it keeps the proposal on screen, relabels the
button **Merge & keep**, and shows the conflict message. To make **Merge & keep** actually
merge, the integration layer owns the retry — the hook will call your `commitEdit` again
when the button is pressed, so:

1. On the **first** 409, capture `currentVersionId` from the response.
2. Run a 3-way merge server-side (base = `baseVersionId`, ours = `newText`, theirs =
   current). Anton can do this with the LLM if it's prose. Two outcomes:
   - **Clean merge** → re-attempt the accept with `baseVersionId = currentVersionId` and
     the merged text; on success resolve `{ ok: true, versionId }` as normal.
   - **Hard conflict** → resolve `{ conflict: { message: "Anton merged what he could —
     review the overlap" } }` and (ideally) feed a fresh `proposeEdit`-shaped diff back
     into the block so the user re-confirms.
3. Update the `baseVersionId` prop you pass to `EditableBlock` whenever the artifact
   version changes underneath you (e.g. from a realtime channel), so the *next* edit
   starts from the right base and conflicts stay rare.

> Minimum viable integration: implement propose + accept with a strict compare-and-swap
> and just surface the 409 (no auto-merge). The UI is already correct for that — "Merge &
> keep" will simply re-POST; if you haven't advanced `baseVersionId`, it 409s again and
> the user can Undo. Add real merging in a follow-up.

## Optional: `onComment({ target, text })`

Fired when the user submits the puck's comment face. Persist it against `target`
(e.g. `POST /artifacts/{id}/comments` with the block/range) and add it to the story feed.
The UI clears the puck and returns to idle on its own.

## Contract signatures (copy/paste)

```ts
type Target = { artifactId: string; blockId?: string; range?: unknown; text?: string };

function proposeEdit(args: { target: Target; instruction: string }):
  Promise<{ oldText: string; newText: string }>;

function commitEdit(args: { target: Target; newText: string; baseVersionId?: string }):
  Promise<
    | { ok: true; versionId: string; text?: string }
    | { conflict: { message?: string } }
    | { ok: false; status?: 409 }
  >; // …or throw { status: 409 } for a conflict

function onComment(args: { target: Target; text: string }): void;
function onCommitted(args: { target: Target; newText: string; versionId?: string }): void;
```

## Notes & guarantees the UI already provides

- **Stale-response safety.** Each `select`/`submitPrompt`/`keep` bumps an internal request
  id; a slow `proposeEdit`/`commitEdit` that resolves after the user moved on is dropped.
  Your implementation does not need to debounce.
- **Latency UX.** While `proposeEdit` is pending the block shows a shimmer skeleton +
  "Anton is rewriting this line…". There is no built-in timeout — if your backend can
  hang, race it against your own timeout and `throw` so the UI recovers.
- **Keyboard.** Enter submits the prompt/comment, Esc cancels the puck. No extra wiring.
- **Mock fallback.** Omit `proposeEdit`/`commitEdit` and the hook uses an in-memory mock
  (~1200ms latency, keyword-branched rewrite, always-ok commit). Useful for Storybook /
  tests; never makes a network call.
