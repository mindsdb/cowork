// Fail open: report deletion only when a loaded, in-scope index provably lacks the card.
// Server cards identify root folders; chat cards can identify nested files, so compare folder
// prefixes.
// Bridge legacy eight-character hex ids to full ids; a missed match must not hide a live artifact.

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

// Bridge only hex ids: taking a slug prefix would falsely match unrelated artifacts with the same
// name prefix.
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
    // Legacy and widened ids share this prefix. Collisions can retain a deleted card, never hide a
    // live one.
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
 * Check tombstones before newborn/live exemptions, so same-session deletions win.
 * Exempt newborn cards before consulting an older index, then fail open on unknown or out-of-scope
 * state.
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
