/*
 * What the artifact Share panel knows about who can open an artifact, from
 * its publish controller (usePublish): which reads it still waits on, and
 * whether it may claim "Shared". PublishMenu renders; this decides.
 *
 * MindsHub mode (`orgMode`): its access route takes only the org payload
 * (buildAccessPayload's `orgMode`), and it has none of desktop's `/publish`
 * routes (version history, Stop sharing, Update). Teams and "Everyone at
 * ‹org›" show when sharing is on there.
 *
 * There, the chooser and its Save wait for what sharing allows
 * (`sharingStatus`): a draft read before that would show a share with
 * everyone as a list, and save it as one. They also wait for the access route
 * (`accessStatus`, usePublish's `accessLoaded`), since an org card carries no
 * audience: before it answers they would show, and save, an empty audience.
 * A failed read offers Retry and saves nothing.
 *
 * Published is not the same as shared: an owner-only artifact has a URL that
 * only its owner can open. Until the access route answers, an org card says
 * nothing about who a restricted artifact reaches, so neither the button nor
 * the panel claims "Shared" for it (a public or password card's mode is the
 * card's own to say).
 */

import { artifactShareState, isOrgSharingOn, permissionsUnknown } from '../../../lib/orgSharing';
import { LOAD_STATUS } from '../../../lib/sharingContract';

/** @param {ReturnType<typeof import('./usePublish').usePublish>} pub */
export function useArtifactShareState(pub) {
  const orgMode = pub.orgMode === true;
  const sharing = isOrgSharingOn(pub.orgSharing?.capabilities) ? pub.orgSharing : null;
  const orgName = sharing?.orgName ?? null;
  const sharingStatus = orgMode ? pub.orgSharing.status : LOAD_STATUS.READY;
  const accessStatus = !orgMode || pub.accessLoaded
    ? LOAD_STATUS.READY
    : (pub.accessLoadFailed ? LOAD_STATUS.ERROR : LOAD_STATUS.LOADING);
  const shareState = artifactShareState(pub, {
    orgSharing: !!sharing,
    orgName,
    teams: sharing?.teams?.teams || [],
    audienceKnown: accessStatus === LOAD_STATUS.READY,
  });
  return {
    orgMode,
    sharing,
    orgName,
    sharingStatus,
    sharingReady: sharingStatus === LOAD_STATUS.READY,
    // The answer came back without the caller's permissions: "Everyone" is
    // locked for that reason, and Retry asks again.
    permissionsUnreachable: !!sharing && permissionsUnknown(sharing.capabilities),
    accessStatus,
    shareState,
    isSharedWithSomeone: !!pub.publishedUrl && shareState.shared,
  };
}

export default useArtifactShareState;
