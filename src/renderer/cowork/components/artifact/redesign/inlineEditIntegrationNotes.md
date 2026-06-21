# Direct (in-place) editing — integration contract

**Goal:** the user edits an artifact by *clicking and typing* — instant, no AI,
no agent round-trip — and each committed edit persists as a **new artifact
version**. Two surfaces:

| Surface | Module | What it edits |
|---|---|---|
| Prose / markdown | `EditableProse.jsx` | paragraph blocks of a `.md`/`.txt` doc |
| HTML preview (slide deck) | `useIframeInlineEdit.js` | the live, **same-origin** preview iframe |

Both feed a single persist helper, `saveArtifactContent.js`, which versions the
change through the existing artifact-edit pipeline (propose → accept, with OCC).

These are **new, self-contained modules**. Nothing existing was edited. This
file is the wiring guide. (Distinct from `editIntegrationNotes.md`, which covers
the *AI* "Fix it in place" flow — `EditableBlock`/`Puck`/`InlineDiff`. Direct
edit and AI edit can coexist; see "Coexistence" below.)

---

## 0. The persist contract (read first)

```js
import { saveArtifactContent } from './redesign/saveArtifactContent.js';

const res = await saveArtifactContent({
  path,            // artifact path (host already has it: versionPathOf(artifact))
  projectName,     // host already has it; only used by the write fallback
  oldContent,      // FULL file text BEFORE the edit
  newContent,      // FULL file text AFTER the edit
  baseVersionId,   // host already has it: versionsState.currentVersionId
  // target,       // optional; defaults to basename(path) = the file inside the artifact folder
});
// → { ok:true, noop:true }                                  nothing changed (no network, no version)
// → { ok:true, versionId }                                  committed; new version created
// → { ok:true, versionId:null, fallback:'write' }           edit router not mounted → wrote bytes, NO version
// → { ok:false, conflict:{ message, currentVersionId } }    OCC lost (artifact moved); host decides next step
```

**Which API path it uses & how it versions.** `saveArtifactContent` calls
`proposeArtifactEdit` then `acceptArtifactEdit` (both already in `api.js`). The
backend (`services/artifact_edits.py`) treats the edit as a **whole-file
`replace_text`**: it finds `oldContent` in `target` and swaps in `newContent`,
then records a new `ai_edit` snapshot — i.e. a real version, with
optimistic-concurrency control keyed on `baseVersionId`. This is why we send the
*entire* old file as `oldText`: it's the compare-and-swap `find` string, and it
guarantees we only overwrite the exact bytes the user was looking at.

We deliberately do **not** call `writeProjectFile` directly for the happy path —
it writes bytes but creates no version and does no OCC. `writeProjectFile` is
only the **fallback** when the `/artifacts/edits/*` router isn't mounted
(404/405/501); in that case `versionId` is `null` and `fallback:'write'` tells
the host not to promise a version.

**After every successful save the host MUST bump its reload token** so the
canvas re-fetches/reloads the freshly-versioned bytes (the host already has
`bumpReload()` and `loadVersions()` — reuse `handleCommitted`).

---

## 1. Add an "Edit" mode toggle (host state)

Add one boolean to `ArtifactWorkspaceRedesign` and a toggle in the `TopBar`
(next to the existing comment-mode toggle):

```jsx
const [editMode, setEditMode] = useState(false);
// ...
<TopBar
  /* …existing props… */
  // e.g. add an "Edit" pill; mutually-exclusive with comment mode is nice-to-have:
  onToggleEdit={() => { setEditMode(v => !v); setCommentMode(false); }}
  editMode={editMode}
/>
```

A shared save handler both surfaces call (reuses the existing `handleCommitted`):

```jsx
const handleDirectSave = useCallback(async ({ oldContent, newContent }) => {
  const res = await saveArtifactContent({
    path, projectName, oldContent, newContent, baseVersionId,
  });
  if (res.noop) return;
  if (res.ok) {
    // versionId may be null in the write-fallback case — handleCommitted handles both.
    handleCommitted({ versionId: res.versionId });   // flashes + loadVersions() + bumpReload()
    return;
  }
  if (res.conflict) {
    flash(res.conflict.message);   // host decides: reload latest, or hand to agent to merge
    bumpReload();                  // pull the newer bytes so the next edit re-bases
  }
}, [path, projectName, baseVersionId, handleCommitted, flash, bumpReload]);
```

> `handleCommitted` already does `flash(...) + onChange(...) + loadVersions() +
> bumpReload()`. Bumping reload after a save is therefore handled for you — just
> route both surfaces through it.

---

## 2. Wire the PROSE canvas (`EditableProse`)

`ProseCanvas` already loads the doc and splits it into `state.blocks` via
`splitParagraphs`. In **edit mode**, render `EditableProse` instead of mapping
`EditableBlock` (or render it alongside — see Coexistence). It needs the same
blocks plus the save handler:

```jsx
import { EditableProse } from './redesign/EditableProse.jsx';

{editMode ? (
  <EditableProse
    blocks={state.blocks}            // same array ProseCanvas already computed
    active={editMode}
    onSaveContent={handleDirectSave} // ({ oldContent, newContent }) → saveArtifactContent
    // onSaveText={({ oldText, newText, blockIndex }) => {}}  // optional per-block delta
  />
) : (
  state.blocks.map((para, i) => <EditableBlock key={i} /* …AI flow… */ />)
)}
```

- `EditableProse` keeps a **local working copy** of the blocks so multi-paragraph
  edits in one session rejoin correctly into the full file. It re-seeds when the
  incoming `blocks` change (e.g. after your reload-token bump re-fetches).
- It joins blocks with `"\n\n"` (override via `separator`) to reconstruct the
  full document — matching `splitParagraphs`' blank-line split. `onSaveContent`
  hands you `{ oldContent, newContent }` ready for `saveArtifactContent`.
- Commit triggers: **blur** of a changed block, or **Enter** (Shift+Enter = newline
  within the block). **Esc** reverts the block. No-op blurs never save.

---

## 3. Wire the HTML preview (`useIframeInlineEdit`)

`HtmlCanvas` renders the preview `<iframe>`. Two small changes:

**(a) Give the iframe a ref** (the iframe currently has none):

```jsx
const iframeRef = useRef(null);
// …
<iframe ref={iframeRef} /* …existing key/src/sandbox/style… */ />
```

The existing `sandbox="allow-scripts allow-same-origin allow-forms allow-popups"`
already includes `allow-same-origin`, which is what makes `contentDocument`
reachable — keep it.

**(b) Drive the hook from edit mode:**

```jsx
import { useIframeInlineEdit } from './redesign/useIframeInlineEdit.js';
import { saveArtifactContent } from './redesign/saveArtifactContent.js';

const { supported, editing, commit } = useIframeInlineEdit({
  iframeRef,
  active: editMode,
  onSaveHtml: async ({ oldHtml, newHtml }) => {
    await handleDirectSave({ oldContent: oldHtml, newContent: newHtml });
  },
  onError: (msg) => flash(msg),
});
```

- When `editMode` flips true the hook marks text elements `contentEditable`,
  paints a hover/focus outline, and you should show a floating **"Done"** button
  that calls `commit()` then `setEditMode(false)`. (The hook also commits on each
  changed-element blur and on Enter in headings/links/cells, so "Done" is a
  safety net + an explicit exit.)
- `onSaveHtml` gives you the **full `documentElement.outerHTML`** (our injected
  style + editable markers stripped) as `oldHtml`/`newHtml` → straight into
  `handleDirectSave`. For an HTML artifact `target` defaults to `basename(path)`
  (e.g. `index.html`), which is the file the deck serves — correct for the
  whole-file swap.
- **`supported`**: `null` while probing, `true` once engaged, `false` if the
  document is cross-origin / inaccessible (or the iframe never loaded). Gate the
  Edit toggle (or show "This preview can't be edited inline") on `supported !==
  false`. Since the preview is same-origin via the :5173 proxy, `supported`
  should be `true` in practice — but the hook degrades safely if it isn't.
- The hook **only toggles `contentEditable`** and attaches listeners + one
  `<style>`; it never restructures the DOM, so the deck's own scripts/styles keep
  running. On deactivate / unmount / iframe reload it removes all of that.

> Because `HtmlCanvas`'s `<iframe key>` includes `reloadToken`, your post-save
> `bumpReload()` remounts the iframe with the new bytes. The hook cleans up the
> old document and re-engages the new one (it watches `load`), so edit mode keeps
> working across the reload without extra wiring.

---

## 4. Coexistence with the AI "Fix it in place" flow

- **Prose:** `EditableBlock` (AI) and `EditableProse` (direct) are independent.
  Simplest UX: a mode toggle that swaps which one renders (shown above). If you
  want both at once, render `EditableProse` and keep a separate "Ask AI" affordance
  — but don't make the same `<p>` both `contentEditable` and an `EditableBlock`
  select target, or the click handlers fight.
- **HTML:** there is no AI inline flow for the iframe today, so `useIframeInlineEdit`
  owns it outright when `editMode` is on.
- **Comment mode:** keep edit mode and comment mode mutually exclusive (toggling
  one clears the other) — both attach click/selection behavior to the canvas.

---

## 5. Data flow summary

```
                   ┌─ EditableProse  ──onSaveContent({oldContent,newContent})─┐
 user types ──────►│                                                          ├─► handleDirectSave
                   └─ useIframeInlineEdit ─onSaveHtml({oldHtml,newHtml})──────┘        │
                                                                                       ▼
                                                       saveArtifactContent({path,target,oldContent,newContent,baseVersionId})
                                                                                       │
                                          proposeArtifactEdit (validate oldText in target)
                                                                                       │
                                          acceptArtifactEdit  (OCC swap → NEW ai_edit version)  ──► { ok, versionId } | { conflict }
                                                                                       │
                                            handleCommitted → flash + loadVersions() + bumpReload()
                                                                                       │
                                            canvas re-fetch (prose) / iframe remount (html) shows the new version
```

---

## Limitations & notes

- **Whole-file replace, not per-region patch.** Direct edits persist the entire
  file as one `replace_text` (find = full old content). This is robust and always
  versions, but it means two people directly editing the *same file* at once will
  409 on the second save (by design — OCC). The host surfaces the conflict; a
  3-way merge is a future enhancement (the backend's `accept_edit` has a
  `TODO(merge)` for disjoint auto-merge). Different paragraphs of the same prose
  doc still collide because it's one file — acceptable for v1.
- **Markdown is edited as raw source text.** `EditableProse` edits the literal
  markdown of each block (matching what `ProseCanvas` shows). It is *not* a
  rich-text WYSIWYG markdown editor — typing `**bold**` persists those literal
  characters. `readPlainText` strips any pasted HTML/`&nbsp;`/`<br>` back to clean
  text + newlines so the `.md` stays clean.
- **Element types we will NOT make editable in the iframe** (would corrupt
  structure or behavior): `script, style, noscript, template, iframe, object,
  embed, svg, canvas, video, audio, img, input, textarea, select, button, option,
  head/title/meta/link/base`. Also, a `<div>` is only made editable when it is a
  *text leaf* (text with no element children) — wrapper `<div>`s are left alone so
  their children's structure is preserved. Inline children (`span`, `em`, `a`
  inside a marked `<p>`) are edited as part of their nearest editable ancestor,
  not as separate islands. Verified against a synthetic tree: a `<p><span/><em/></p>`
  marks the `<p>` once; the `<span>`/`<em>`/`<script>` are not independently editable.
- **Cross-origin defense.** Every `contentDocument` access is `try/catch`-wrapped;
  the hook reports `supported:false` rather than throwing if the frame is ever
  cross-origin or not yet loaded. Same-origin (the :5173 proxy) is the expected
  case.
- **No agent, no latency UI.** These editors never call the LLM and show no
  shimmer — the only async is the persist call, which the host can treat as
  optimistic (the DOM already shows the user's text). If a save fails, the host's
  `flash(...)` is the recovery surface; the user's typed text is still on screen.
- **`writeProjectFile` fallback caveat.** If the edit router is unavailable,
  `saveArtifactContent` falls back to `writeProjectFile`, which needs
  `projectName` — pass it. That path persists bytes but yields no version
  (`versionId:null`), so the scrubber won't gain an entry until the router is
  mounted.
```
