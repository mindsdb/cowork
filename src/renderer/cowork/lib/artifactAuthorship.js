// Whose artifact this is, as far as the viewer is allowed to know (ENG-2979).
//
// shared_resources.py never names another member: it returns an actor's
// identity only to that actor. So this marker said "not you", never who.
// With live apps on, two places name another member, and only to someone that
// member shared with: `ownerEmail` in the shared-live-apps list, and
// `receivedFrom` on a copy's card in the artifact list (lib/liveAppSharing.js).
//
// In MindsHub mode the artifact's capabilities carry `ownerUserId` when the
// owner is known (ENG-4455), every caller there being a member of the same
// org. The caller names that id through MindsHub (useArtifactAuthorship) and
// passes the name in; until it has one, the marker says "Another member".
//
// Keyed on `role`, never on `canEdit`: the server lowers `canEdit` for an owner
// who lacks the `artifact.manage` product permission, and that artifact is
// still theirs.
//
// No capabilities, no marker. That is fail-open on purpose, unlike
// canUseSharedResource: this is a hint, and the server enforces every action.
import { otherActorLabel } from './sharedResourceAccess';
import i18n from '../../lib/i18n';

const tr = (key, vars) => i18n.t(`messages.artifactAuthorship.${key}`, { ns: 'projects', ...vars });

export const UNKNOWN_OWNER_LABEL = 'Unknown owner';
export const unknownOwnerLabel = () => tr('unknownOwner');

/* Built per call so the copy follows the current language. */
const OTHER_MEMBER = () => Object.freeze({
  kind: 'other',
  label: otherActorLabel(),
  description: tr('otherMemberDescription'),
});

const UNKNOWN_OWNER = () => Object.freeze({
  kind: 'unknown',
  label: unknownOwnerLabel(),
  description: tr('unknownOwnerDescription'),
});

/* A named owner: who, and the same "review, not change" line. */
const NAMED_OWNER = (name) => Object.freeze({
  kind: 'other',
  label: name,
  description: tr('namedOwnerDescription', { name }),
});

/** The owner's MindsHub user id to name, or null when the marker names
    nobody (the viewer's own artifact, an unknown owner, an older server). */
export function artifactOwnerUserId(capabilities) {
  if (!capabilities || capabilities.ownerUnknown === true) return null;
  if (capabilities.role !== 'reviewer') return null;
  const id = capabilities.ownerUserId;
  return typeof id === 'string' && id ? id : null;
}

// `ownerName`: the owner's display name, once MindsHub has named
// `capabilities.ownerUserId`. Without it a reviewer reads "Another member".
export function artifactAuthorship(capabilities, { ownerName = null } = {}) {
  if (!capabilities) return null;
  // Checked first: the server sends it together with role 'reviewer'.
  if (capabilities.ownerUnknown === true) return UNKNOWN_OWNER();
  if (capabilities.role === 'reviewer') {
    const name = typeof ownerName === 'string' ? ownerName.trim() : '';
    return name && artifactOwnerUserId(capabilities) ? NAMED_OWNER(name) : OTHER_MEMBER();
  }
  return null;
}
