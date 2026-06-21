# VersionDiff — integration notes

Makes the **Compare** action on a version actually *show* what changed, instead of
just previewing the older version on the canvas. Renders a centered modal over the
workspace with a line-level diff (red removed / green added / dim unchanged context,
long unchanged runs collapse to `… N unchanged lines …`).

File: `./VersionDiff.jsx` — new, self-contained, no new deps.

---

## Diff source: client-side line diff (not the backend `/diff` endpoint)

A real diff endpoint **does** exist:

- Backend: `GET /artifacts/{artifact_id}/diff` (`cowork-server-direction-2/cowork/api/v1/endpoints/artifact_versions.py`, `diff_versions` → `_diff_versions_fallback`). Returns a **checkpoint-manifest** diff: per-file `status` (added/modified/removed) plus, only when called with `kind="text"`, a server-side `unified_diff` per file.
- Client: `fetchArtifactChanges(path, { from, to })` in `api.js` → calls `/artifacts/diff`, returns `{ available, textDiff, changedFiles, … }`.

**I used a client-side line diff instead**, because:

1. It diffs the exact bytes the workspace already trusts for a version — the `previewArtifact(path, { versionId })` content — so the diff always matches what Preview shows. The manifest diff is keyed off checkpoint snapshot paths and can return *no* text (text is only attached for `kind="text"` and only under the per-side char limit).
2. It needs no checkpoint-id translation and no extra round-trip, and it can't return "unavailable" (the endpoint can 404/501 before the version service ships).
3. The bar for this task is a clean, readable text/line diff of the two versions' content — which this nails.

The diff is a compact **LCS over lines** (lines interned to ints, `Int32Array` table). No deps.

**Limits** (constants at the top of the file):
- `MAX_DIFF_CHARS = 1_500_000` per side — above this it shows "too large to diff in the browser".
- `MAX_RENDER_ROWS = 4000` — the diff is computed over the full text, but rendered rows are capped (header shows "showing first 4000 rows"). Keeps the DOM/main thread sane on huge files.
- Unchanged runs longer than ~8 lines collapse to a divider, keeping 3 lines of context each side.

> **If you later want the backend's structured/visual diff** (multi-file or image artifacts): call `fetchArtifactChanges(path, { from: fromVersion.id, to: toVersion.id })`, and when `available` render `changedFiles` / `visualDiff`, falling back to this client line-diff otherwise. The component is the right shell for that — drop the extra fetch into the existing `useEffect`.

---

## Props

```jsx
<VersionDiff
  open={boolean}            // show/hide
  onClose={() => {}}        // close handler (also Esc + backdrop click)
  path={string}            // artifact path → previewArtifact
  fromVersion={{ id, n, label }}  // the picked (usually older) version
  toVersion={{ id, n, label }}    // usually the current version
  // previewArtifact={fn}   // optional fetcher override (tests/standalone)
/>
```

- `id` is the load-bearing field — it's the `versionId` passed to `previewArtifact`. `n` and `label` are display-only (header pills).
- Renders nothing when `open` is false.
- **Standalone**: omit `path`/`fromVersion` and it uses built-in mock content, so it renders in a gallery with no backend. It auto-imports the real `previewArtifact` from `../../../api` otherwise.
- `toVersion.label === 'current'` renders the "current" affordance in the header.

---

## Wiring into `ArtifactWorkspaceRedesign.jsx`

The workspace already has everything needed: `path`, `versions` (mapped to `{ id, n, label, … }` by `mapVersions`), and `baseVersionId` (= `versionsState.currentVersionId`, the current version's id). Today `onCompareVersion` just does `setViewingN(ev.versionN)` — i.e. previews, no diff. Replace that with opening this modal.

### 1. Import (top of file, with the other redesign imports)

```js
import { VersionDiff } from './VersionDiff';
```

### 2. State — hold the from/to pair for the open diff

```js
// null when closed; { from, to } when comparing.
const [compareState, setCompareState] = useState(null);
```

### 3. An opener that resolves a version number `n` → the {from, to} pair

`versions` are `{ id, n, label, current }`; `baseVersionId` is the current id.
The compare events carry `versionN` (see `onCompareVersion` / `onRestoreVersion`).

```js
const openCompare = useCallback((n) => {
  const from = versions.find((v) => v.n === n);
  if (!from) return;
  const current = versions.find((v) => v.id === baseVersionId)
    || versions[versions.length - 1];
  // Comparing the current version against itself is a no-op.
  if (!current || current.id === from.id) return;
  setCompareState({
    from,                                        // { id, n, label }
    to: { ...current, label: 'current' },       // mark the right side as "current"
  });
}, [versions, baseVersionId]);
```

### 4. Point the existing Compare actions at it

Replace the placeholder on the `StoryRail` (the version feed) …

```js
// before:  onCompareVersion={(ev) => setViewingN(ev.versionN)}
onCompareVersion={(ev) => openCompare(ev.versionN)}
```

… and the `HistoryPanel`'s `onCompare` if/where it's mounted (it passes `(n) => void`):

```js
onCompare={(n) => openCompare(n)}
```

`VersionScrubber` keeps `onScrub`/`onRestore` as-is — scrubbing is preview, Compare is the diff modal.

### 5. Render at the workspace root (sibling of the shell, alongside the toast)

```jsx
<VersionDiff
  open={!!compareState}
  path={path}
  fromVersion={compareState?.from}
  toVersion={compareState?.to}
  onClose={() => setCompareState(null)}
/>
```

That's the whole change: one import, one state cell, one `openCompare` callback, two
handler swaps, one render. No existing behavior is removed — Preview/scrub still work.

---

## Styling / house rules

- React 19 hooks, no new deps, inline styles + CSS vars only.
- Portals to `document.body` at `z-index: 90` (above the workspace, matching the Modal `default` layer of 80; sits just over it). Uses `--bg`/`--surface`/`--surface-2`/`--line`/`--ink`/`--ink-2`/`--ink-3`/`--ink-4`, the diff tokens `--diff-add` `rgba(74,222,128,.16)` / `--diff-del` `rgba(248,113,113,.14)`, and `--font-mono` for the diff body. Every var has a hard-coded dark fallback so it also renders outside the token theme.
- Reuses the global `modal-fade-in` + `popIn` keyframes from `redesign.css`; the body uses the existing `rd-scroll` thin-scrollbar class. Esc + backdrop click close; body scroll is locked while open.
- I did **not** reuse `../../ui/Modal`. The diff wants a tall, fixed-height, edge-to-edge mono scroll body and its own header pills; a bespoke fixed overlay (same tokens/animations) was cleaner than fighting `ModalBody` padding. Swapping to `Modal`+`ModalHeader`+`ModalBody` later is straightforward if consolidation is preferred.

## Optional: add to the barrel

`index.js` currently only exports the M0 chassis. If you want `VersionDiff` importable from the package root:

```js
export { VersionDiff } from './VersionDiff';
```
