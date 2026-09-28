import { useCallback, useEffect, useRef, useState } from 'react';
import { artifactCommentsKey, artifactIdentity } from '../../lib/artifactIdentity';
import { useArtifactComments, useArtifactCommentLayer } from './comments';

export function useArtifactViewerComments(artifact, { open, pub, workspace, iframeRef }) {
  // Comments chrome state. The top bar owns ONE switch (commentsOpen) that
  // shows/hides the floating comments toolbar; the toolbar owns the rest —
  // comment-placement mode, the inbox sidebar, marker visibility, leaving.
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [markersShown, setMarkersShown] = useState(true);
  const [textSelection, setTextSelection] = useState(null);
  const [feedbackNotice, setFeedbackNotice] = useState('');
  const textContentRef = useRef(null);

  const notifyUnreadFeedback = useCallback(() => {
    setFeedbackNotice('New feedback arrived. Open Review to see the issue.');
  }, []);

  useEffect(() => {
    if (!feedbackNotice) return undefined;
    const timer = window.setTimeout(() => setFeedbackNotice(''), 6000);
    return () => window.clearTimeout(timer);
  }, [feedbackNotice]);

  // A stable composite key backs one thread across private drafts and published
  // versions. Derived before the early return so the hooks run unconditionally.
  const artifactKey = artifact?.artifactKey
    || pub.artifactKey
    || artifactCommentsKey(artifactIdentity(artifact));
  const commentsEnabled = !!artifactKey && (
    workspace.commentsReady
    || (!!pub.publishedUrl && pub.accessMode === 'restricted')
  );
  // Injecting the inert marker bridge only needs the stable comment identity;
  // it does not need to wait for the comments transport to finish provisioning.
  // Waiting used to remount the whole HTML artifact as commentsReady flipped.
  const commentLayerRequested = !!artifactKey;
  const artifactKeyParts = artifactKey.split('/');
  const commentUserDir = artifactKeyParts[0] || '';
  const commentReportId = artifactKeyParts.slice(1).join('/') || '';

  const comments = useArtifactComments(commentUserDir, commentReportId, {
    enabled: open && commentsEnabled,
    onUnread: workspace.capabilities?.role === 'owner' ? notifyUnreadFeedback : undefined,
  });

  // Every resolve, from the inbox panel and from the on-artifact pin popover
  // alike, releases whatever repair was waiting on that thread. Resolving is
  // the decision the accept-or-reject rule was protecting, and a path that
  // skips this is the wedge itself. Release after the resolve, never before:
  // a released repair can no longer be decided.
  const setCommentStatus = useCallback(async (threadId, nextStatus) => {
    const ok = await comments.setStatus(threadId, nextStatus);
    if (ok && nextStatus === 'resolved') {
      await workspace.releaseRepairsForComment(threadId);
    }
    return ok;
  }, [comments, workspace]);
  const createArtifactComment = useCallback((payload) => comments.create({
    ...payload,
    revisionId: workspace.currentRevision?.id || null,
  }), [comments.create, workspace.currentRevision?.id]);
  // The injected layer owns the on-artifact UI (pins, hover highlight, thread
  // popovers) and reports mode changes; this hook pushes the thread list down
  // and exposes the imperative controls the toolbar + inbox drive. Marker
  // visibility rides the pushed list (Hide comment ⇒ empty list ⇒ no pins),
  // so it works against the layer without a server change.
  const layer = useArtifactCommentLayer(iframeRef, {
    threads: comments.threads,
    viewer: comments.viewer,
    // Only accept mutation intents from the artifact frame while the user has
    // explicitly opened review controls. Agent-produced scripts otherwise get
    // no ambient path to act through the owner's comment session.
    enabled: open && commentsEnabled && commentsOpen,
    markersVisible: commentsOpen && markersShown,
    onCreate: createArtifactComment,
    onReply: comments.reply,
    onStatus: setCommentStatus,
    onEditThread: comments.editThread,
    onDeleteThread: comments.deleteThread,
    onEditReply: comments.editReply,
    onDeleteReply: comments.deleteReply,
  });

  // One switch for the whole comments chrome. Opening resets to the default
  // sub-state (markers on, inbox closed); closing also drops the iframe out of
  // comment-placement mode so no pin cursor lingers on a "plain" preview.
  const toggleComments = () => {
    setCommentsOpen((was) => {
      if (was) layer.exitMode();
      setInboxOpen(false);
      setMarkersShown(true);
      return !was;
    });
  };

  useEffect(() => {
    if (workspace.mode === 'review' && commentsEnabled) {
      setFeedbackNotice('');
      setCommentsOpen(true);
      setInboxOpen(true);
      return;
    }
    if (workspace.mode === 'edit') {
      layer.exitMode();
      setCommentsOpen(false);
      setInboxOpen(false);
    }
    if (workspace.mode !== 'review') setTextSelection(null);
  }, [commentsEnabled, layer.exitMode, workspace.mode]);

  useEffect(() => {
    if (inboxOpen && comments.unreadCount > 0) comments.markRead();
  }, [comments.markRead, comments.unreadCount, inboxOpen]);

  const captureTextSelection = () => {
    if (workspace.mode !== 'review' || !commentsEnabled) return;
    const selection = window.getSelection?.();
    const quote = selection?.toString().trim();
    const root = textContentRef.current;
    if (!quote || !root || !selection?.anchorNode || !root.contains(selection.anchorNode)) return;
    setTextSelection({
      type: 'text-quote',
      path: workspace.source?.path || artifact?.primary || '',
      quote: quote.slice(0, 500),
      revisionId: workspace.currentRevision?.id || null,
    });
  };

  return {
    comments,
    commentsEnabled,
    commentLayerRequested,
    commentUserDir,
    commentReportId,
    commentsOpen,
    inboxOpen,
    setInboxOpen,
    markersShown,
    setMarkersShown,
    textSelection,
    setTextSelection,
    textContentRef,
    feedbackNotice,
    layer,
    toggleComments,
    setCommentStatus,
    createArtifactComment,
    captureTextSelection,
  };
}
