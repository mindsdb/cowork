// Whose artifact this is, as far as the viewer is allowed to know (ENG-2979).
//
// The server never names another member: shared_resources.py returns an
// actor's identity only to that actor. So the UI can say "not you", never who.
//
// Keyed on `role`, never on `canEdit`: the server lowers `canEdit` for an owner
// who lacks the `artifact.manage` product permission, and that artifact is
// still theirs.
//
// No capabilities, no marker. That is fail-open on purpose, unlike
// canUseSharedResource: this is a hint, and the server enforces every action.
import { OTHER_ACTOR_LABEL } from './sharedResourceAccess';

export const UNKNOWN_OWNER_LABEL = 'Unknown owner';

const OTHER_MEMBER = Object.freeze({
  kind: 'other',
  label: OTHER_ACTOR_LABEL,
  description: 'Created by another member of this project. You can review it but not change it.',
});

const UNKNOWN_OWNER = Object.freeze({
  kind: 'unknown',
  label: UNKNOWN_OWNER_LABEL,
  description: "Nobody is recorded as this artifact's owner.",
});

export function artifactAuthorship(capabilities) {
  if (!capabilities) return null;
  // Checked first: the server sends it together with role 'reviewer'.
  if (capabilities.ownerUnknown === true) return UNKNOWN_OWNER;
  if (capabilities.role === 'reviewer') return OTHER_MEMBER;
  return null;
}
