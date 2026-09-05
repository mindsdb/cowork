// Keep dependency-free: api.js and artifactWorkspaceApi.js both import this, and the latter already
// imports api.js.
// Older chat cards carry short ids or stableId; adopt stableId like the server so migrated
// artifacts remain editable.

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
