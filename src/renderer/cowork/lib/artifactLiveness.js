// Is the artifact behind this card still there?
//
// Split from artifactsStore.js on purpose: the store owns state, network and the
// React subscription, this file owns the decision — so the decision is testable
// as a table instead of through a mounted component with a mocked fetch.
//
// The whole file is built around one rule: NEVER report a deletion we are not
// sure of. A card wrongly marked "Deleted" loses the user their artifact from
// the UI while the bytes are still on disk, which is worse than the stale-card
// bug this exists to fix. So every guard below fails open, and `true` is only
// returned when a loaded, in-scope index provably lacks the card.
//
// Matching is deliberately many-keys-against-many-indices rather than one
// computed key compared for equality. Two shapes of card meet here:
//
//   * SERVER cards, from `/artifacts/` (cowork-server `card_for_folder`): carry
//     `folder` (the artifact root) and `path` (the primary file `_pick_primary`
//     chose inside it).
//   * CHAT cards, from `artifactStepToCard` (ENG-1680): no folder, and the path
//     is whatever the stream announced in `step.data.file_path`.
//
// Their paths legitimately disagree — a fullstack artifact keeps its entry point
// in `static/`, one level below the root — so paths are matched against FOLDERS
// with a prefix test, not compared to each other. And a card persisted before
// ids were widened carries the short eight-character id rather than the full
// identity, so a card can carry an id of a different sort than its counterpart;
// a one-sided key would miss and the miss would read as a deletion. The
// widening kept the short id as the full id's first eight characters, so both
// spellings are indexed and both are looked up.

function textValue(value) {
  return value == null ? '' : String(value).trim();
}

// Forward slashes, no trailing separator. Windows paths reach us in both shapes
// (the server sends what the OS gave it; the stream may carry either).
function normPath(value) {
  return textValue(value).replace(/\\/g, '/').replace(/\/+$/, '');
}

function parentPath(value) {
  const normalized = normPath(value);
  const cut = normalized.lastIndexOf('/');
  return cut > 0 ? normalized.slice(0, cut) : '';
}

// The trailing slash matters: without it `/…/al` would swallow `/…/alpha`.
function isUnder(path, folder) {
  const p = normPath(path);
  const f = normPath(folder);
  if (!p || !f) return false;
  return p === f || p.startsWith(`${f}/`);
}

export function emptyArtifactIndex() {
  return { ids: new Set(), projectSlugs: new Set(), folders: [] };
}

// The `id` prefix that a pre-widening card carries whole. Mirrors anton's
// ARTIFACT_ID_SLUG_PREFIX_LEN.
const ID_PREFIX_LEN = 8;

// Ids are hex: 32 characters since the widening, eight before it. Only those
// shapes get bridged by prefix. Any other `id` a card might carry — a slug, a
// composite key — shares its first eight characters with every sibling spelled
// alike (`q3-launch-…` vs `q3-launch-…`), and bridging those would silently
// match unrelated artifacts, so a card whose artifact really is gone would
// keep reading as "still there".
const HEX_ID = /^[0-9a-f]+$/;

/** Every way this card can be recognised. Absent keys are `''`, never null, so
 *  callers can test with a plain truthiness check. */
export function artifactKeys(card) {
  const id = textValue(card?.id).toLowerCase();
  const slug = textValue(card?.slug);
  const projectId = textValue(card?.projectId);
  const path = textValue(card?.canonicalPath) || textValue(card?.file_path) || textValue(card?.path);
  return {
    id,
    // Bridges the two id spellings: a widened server card and the pre-widening
    // chat card for the same artifact share these eight characters. Indexing
    // both can only ever produce a false "still there", never a false
    // "deleted" — the direction this file is built to fail in. Hex only, so
    // the bridge cannot reach past the widening it exists for.
    idPrefix: HEX_ID.test(id) && id.length >= ID_PREFIX_LEN ? id.slice(0, ID_PREFIX_LEN) : '',
    // Only a PAIR identifies an artifact: a slug is unique within a project's
    // conversation at best (see ENG-1678), never globally.
    projectSlug: projectId && slug ? `${projectId}/${slug}` : '',
    path,
    // Server cards name their root; chat cards only imply it through the file.
    folder: textValue(card?.folder) || parentPath(path),
  };
}

export function buildArtifactIndex(cards) {
  const index = emptyArtifactIndex();
  for (const card of Array.isArray(cards) ? cards : []) {
    const keys = artifactKeys(card);
    if (keys.id) index.ids.add(keys.id);
    if (keys.idPrefix) index.ids.add(keys.idPrefix);
    if (keys.projectSlug) index.projectSlugs.add(keys.projectSlug);
    const folder = normPath(keys.folder);
    if (folder && !index.folders.includes(folder)) index.folders.push(folder);
  }
  return index;
}

/** Union, without mutating either operand. `b` may be null. */
export function mergeArtifactIndex(a, b) {
  const base = a || emptyArtifactIndex();
  if (!b) {
    return {
      ids: new Set(base.ids),
      projectSlugs: new Set(base.projectSlugs),
      folders: [...base.folders],
    };
  }
  return {
    ids: new Set([...base.ids, ...b.ids]),
    projectSlugs: new Set([...base.projectSlugs, ...b.projectSlugs]),
    folders: [...new Set([...base.folders, ...b.folders])],
  };
}

export function matchesIndex(card, index) {
  if (!card || !index) return false;
  const keys = artifactKeys(card);
  if (keys.id && index.ids.has(keys.id)) return true;
  if (keys.idPrefix && index.ids.has(keys.idPrefix)) return true;
  if (keys.projectSlug && index.projectSlugs.has(keys.projectSlug)) return true;
  if (keys.path && index.folders.some((folder) => isUnder(keys.path, folder))) return true;
  return false;
}

function hasUsableKeys(card) {
  const keys = artifactKeys(card);
  return Boolean(keys.id || keys.projectSlug || keys.path);
}

// Could this card's artifact even appear in the index we hold? A scoped list
// covers one project, so a card from elsewhere is absent for a reason that has
// nothing to do with deletion. The global list needs no such guard — it spans
// every project the caller can see, so a miss there is real.
function isInScope(card, scope) {
  if (!scope || scope.kind === 'global') return true;
  const cardProjectId = textValue(card?.projectId);
  const scopeProjectId = textValue(scope.projectId);
  if (cardProjectId && scopeProjectId) return cardProjectId === scopeProjectId;
  const path = artifactKeys(card).path;
  if (scope.projectPath && path) return isUnder(path, scope.projectPath);
  return false;
}

/**
 * `true` only when a loaded, in-scope index provably lacks this card.
 *
 * Order is load-bearing:
 *   - tombstone first, so an artifact created AND deleted in one session reads
 *     as deleted rather than as newborn;
 *   - `live`/born next, so an artifact the agent just made is not judged by an
 *     index that predates it (§4.5);
 *   - then the fail-open guards, then the index itself.
 */
export function isArtifactDeleted(card, { index, tombstones, born, scope, live } = {}) {
  if (!card) return false;
  if (matchesIndex(card, tombstones)) return true;
  if (live) return false;
  if (matchesIndex(card, born)) return false;
  if (!index) return false;
  if (!isInScope(card, scope)) return false;
  if (!hasUsableKeys(card)) return false;
  return !matchesIndex(card, index);
}
