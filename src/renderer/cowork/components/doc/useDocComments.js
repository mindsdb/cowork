// A doc's comments, as the artifact viewer has them: the same threads (one
// `artifact/<uuid>` key across the draft and its shared page), the same
// realtime hook, and the same way of turning them on. On the web an owner's
// draft needs its comments switched on first (an auth rule for the
// organization), and a reviewer's GET of the review entry is the grant; the
// desktop keeps them in the doc's own folder and needs nothing.
import { useEffect, useMemo, useState } from 'react';
import { artifactCommentsKey } from '../../lib/artifactIdentity';
import { enableDraftComments, loadArtifactReview } from '../../lib/artifactWorkspaceApi';
import { useArtifactComments, useCommentActions } from '../artifact/comments';
import { host } from '../../../platform/host';

/** Whether the doc's comments can be reached; mirrors useArtifactWorkspace's commentsReady. */
function useCommentsReady(artifact, enabled) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(false);
    if (!enabled) return undefined;
    if (!host.isWeb) {
      setReady(true);
      return undefined;
    }
    let live = true;
    (async () => {
      try {
        const review = await loadArtifactReview(artifact);
        // Absent capabilities: an older server that only speaks the POST.
        if (review?.capabilities?.canEdit === false) {
          if (live) setReady(true);
          return;
        }
        const access = await enableDraftComments(artifact);
        if (live) setReady(!!access?.enabled);
      } catch {
        // No grant, comments down, or a model comparison: the doc has no comments.
        if (live) setReady(false);
      }
    })();
    return () => { live = false; };
  }, [artifact, enabled]);
  return ready;
}

/**
 * @param {{ projectRef: string, artifactId: string, enabled: boolean, onError?: (message: string) => void }} options
 */
export function useDocComments({ projectRef, artifactId, enabled, onError }) {
  const artifact = useMemo(() => ({ id: artifactId, projectId: projectRef }), [artifactId, projectRef]);
  const key = artifactCommentsKey(artifactId);
  const ready = useCommentsReady(artifact, enabled && !!key);
  const [userDir, ...rest] = key.split('/');
  const on = enabled && ready;
  const comments = useArtifactComments(userDir, rest.join('/'), { enabled: on });
  const actions = useCommentActions(artifact, comments, { onError });
  return { ...comments, ...actions, enabled: on };
}

export default useDocComments;
