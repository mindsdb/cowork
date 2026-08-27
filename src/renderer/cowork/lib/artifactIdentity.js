// One artifact identity, client side.
//
// Dependency-free on purpose: both `api.js` and `artifactWorkspaceApi.js` need
// these, and `artifactWorkspaceApi.js` already imports from `api.js`.
//
// The server sends `id` as a full UUID in bare hex. A card replayed from a
// conversation recorded before ids were widened carries the old
// eight-character id — and, for a short window, a separate `stableId` field.
// The server adopts that field as the artifact's id, so the client does too:
// otherwise reopening an old conversation shows preview-only for an artifact
// whose folder on disk is fully migrated.

const UUID_SHAPE = /^([0-9a-f]{8})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{12})$/i;

// The bare-hex spelling of one value, or '' when it is not a full identity.
export function fullArtifactId(value) {
  const match = UUID_SHAPE.exec(String(value || ''));
  return match ? match.slice(1).join('').toLowerCase() : '';
}

// The artifact's identity, or '' when the card carries none the server can
// resolve (a pre-widening card with no `stableId` to fall back on).
export function artifactIdentity(artifact) {
  return fullArtifactId(artifact?.id) || fullArtifactId(artifact?.stableId);
}

// The `artifact/<uuid>` key one comment thread lives under, across the private
// draft and every published version. Canonical DASHED spelling — the same key
// the server's card builder, the publish response and the upload lambda emit,
// so a locally derived key can never fork the threads.
export function artifactCommentsKey(value) {
  const hex = fullArtifactId(value);
  if (!hex) return '';
  const groups = [
    hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20),
  ];
  return `artifact/${groups.join('-')}`;
}
