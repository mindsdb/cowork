// Whose artifact this is, as far as the viewer is allowed to know (ENG-2979).
//
// shared_resources.py never names another member: it returns an actor's
// identity only to that actor. So this marker can say "not you", never who.
// With live apps on, two places name another member, and only to someone that
// member shared with: `ownerEmail` in the shared-live-apps list, and
// `receivedFrom` on a copy's card in the artifact list (lib/liveAppSharing.js).
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

export function artifactAuthorship(capabilities) {
  if (!capabilities) return null;
  // Checked first: the server sends it together with role 'reviewer'.
  if (capabilities.ownerUnknown === true) return UNKNOWN_OWNER();
  if (capabilities.role === 'reviewer') return OTHER_MEMBER();
  return null;
}
