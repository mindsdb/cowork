// Inline preview modal for artifacts. Renders the artifact's content in a
// sandboxed iframe (HTML / fullstack) or inline (md / csv / txt). The top
// bar has three responsive zones:
//
//   left   — artifact title (truncated)
//   middle — Preview / Edit / Review modes
//   right  — comments · Publish control · ⋯ menu · close
//
// Publish/unpublish/update/change-access all live in the <PublishMenu>
// popover, backed by the usePublish state machine — so this component is
// just chrome + preview.

import { useCallback, useRef, useState } from 'react';
import Ico from '../Icons';
import { artifactAuthorship } from '../../lib/artifactAuthorship';
import { isPublishableArtifact, BACKEND_ARTIFACT_TYPES } from '../../lib/artifactKinds';
import { Modal } from '../ui/Modal';
import { ConfirmModal } from '../ConfirmModal';
import { useOrgMode } from '../../../lib/orgMode';
import { usePublish } from './publish/usePublish';
import { ArtifactRevisionBar } from './workspace/ArtifactRevisionBar';
import { useArtifactWorkspace } from './workspace/useArtifactWorkspace';
import { ArtifactViewerHeader } from './ArtifactViewerHeader';
import { ArtifactViewerBody } from './ArtifactViewerBody';
import { usePreviewDiagnostics } from './usePreviewDiagnostics';
import { useArtifactPreview } from './useArtifactPreview';
import { useArtifactViewerComments } from './useArtifactViewerComments';
import { useArtifactRepair } from './useArtifactRepair';
import { useArtifactViewerActions } from './useArtifactViewerActions';
import './artifactWorkspace.css';

// Every onChange payload is `{ ...artifact, ...fields }`, so identity fields
// carry over from the artifact the report started from.
function isSameArtifact(a, b) {
  if (!a || !b) return false;
  if (a.id || b.id) return a.id === b.id;
  return (a.path || '') === (b.path || '');
}

export function ArtifactViewer({
  open,
  artifact,
  onClose,
  onChange,
  onDelete,
  onAddressWithAgent,
  conversationId = null,
  resolveRepairConversation = null,
}) {
  const orgMode = useOrgMode();
  const actionPath = artifact?.canonicalPath || artifact?.file_path || artifact?.path || '';
  const disabledReason = artifact?.actionDisabledReason || '';
  const hasActionPath = !!actionPath && !disabledReason;
  const isBackendArtifact = BACKEND_ARTIFACT_TYPES.has(artifact?.type);
  const [err, setErr] = useState('');
  const iframeRef = useRef(null);
  // The hooks below report back from async work (status refreshes, saves) that
  // can settle after the viewer closed or moved to another artifact. Hosts
  // handle onChange by setting their preview state to the updated artifact, so
  // a late report would reopen a closed viewer or swap the one on screen
  // (ENG-3070). Refs are written during render so a close is seen immediately.
  const openRef = useRef(open);
  openRef.current = open;
  const artifactRef = useRef(artifact);
  artifactRef.current = artifact;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const reportChange = useCallback((updated) => {
    if (!openRef.current || !isSameArtifact(updated, artifactRef.current)) return;
    onChangeRef.current?.(updated);
  }, []);
  const pub = usePublish(artifact, { onChange: reportChange, enabled: open });
  const workspace = useArtifactWorkspace(artifact, { open, onChange: reportChange });
  const {
    comments, commentsEnabled, commentLayerRequested, commentUserDir, commentReportId,
    commentsOpen, inboxOpen, setInboxOpen, markersShown, setMarkersShown,
    textSelection, setTextSelection, textContentRef, feedbackNotice, layer,
    toggleComments, setCommentStatus, createArtifactComment, captureTextSelection,
  } = useArtifactViewerComments(artifact, { open, pub, workspace, iframeRef });
  const {
    draftPreviewUrl, previewUrl, previewDoc, previewKind, iframeReady, setIframeReady,
    textPreview, loading, backendPort, isText, textExt, isImage, imageSrc, imageFailed,
    csvPreview, onReload,
  } = useArtifactPreview(artifact, {
    open, actionPath, hasActionPath, disabledReason, isBackendArtifact,
    commentLayerRequested, setError: setErr,
  });
  // Reset key, not a URL: the srcdoc branch swaps `previewDoc` and leaves
  // `previewUrl` empty, so keying on the URL alone would carry the previous
  // document's errors onto a new one in org mode.
  //
  // Gated on a preview actually being mounted, not just on `open`: text and
  // image artifacts never mount an iframe, so `iframeRef.current` stays null
  // and the sender check below degrades to "accept anyone" — and the HTML
  // comparison view mounts its own `sandbox="allow-scripts"` frames of
  // agent-written HTML that could otherwise post into this channel. Same
  // rationale as the comments bridge's `commentsOpen` gate below.
  const diagnostics = usePreviewDiagnostics(iframeRef, {
    enabled: open && !!(previewUrl || previewDoc),
    resetKey: previewUrl || previewDoc,
  });
  const {
    repairBusy, setRepairBusy, dismissedRepairId, setDismissedRepairId, repairNoticeError,
    blockedBy, setBlockedBy, blockedComment, pendingDiscard, setPendingDiscard,
    addressCommentWithAgent, viewRepairChange, confirmDiscardRepair,
  } = useArtifactRepair(artifact, {
    open, workspace, comments, diagnostics, conversationId, resolveRepairConversation,
    onAddressWithAgent, setError: setErr,
  });
  const {
    confirmDelete, setConfirmDelete, deleteBusy, canOpenLocalFile, canOpenInBrowser,
    browserTabUrl, onOpenFolder, onOpenOS, onOpenInBrowser, onOpenInBrowserTab,
    onDownload, onTrash, onConfirmDelete,
  } = useArtifactViewerActions(artifact, {
    actionPath, hasActionPath, disabledReason, isBackendArtifact, backendPort,
    orgMode, pub, onDelete, onClose, setError: setErr,
  });

  const saveWorkspace = useCallback(async (...args) => {
    const saved = await workspace.save(...args);
    if (saved) onReload();
    return saved;
  }, [onReload, workspace.save]);

  if (!open || !artifact) return null;

  const title = artifact.title || artifact.path?.split('/').pop();
  const isPublished = !!pub.publishedUrl;
  const publishable = isPublishableArtifact(artifact);
  const canManage = workspace.capabilities
    ? workspace.capabilities.canEdit !== false
    : artifact?.capabilities
      ? artifact.capabilities.canEdit !== false
      : !orgMode;
  // Unlike canManage, a client-side guess must never override the card's
  // server-sent role: a guessed reviewer would hide "Another member" on the
  // user's own artifact, and a guessed owner would hide it on a colleague's.
  // Server-sent workspace capabilities win; otherwise the card's (ENG-2979).
  const authorship = artifactAuthorship(
    (workspace.capabilitiesFromServer ? workspace.capabilities : null) ?? artifact?.capabilities,
  );

  const headerReview = {
    enabled: commentsEnabled,
    open: commentsOpen,
    controller: comments,
    onToggle: toggleComments,
  };
  const publication = {
    canManage,
    publishable,
    controller: pub,
    hasActionPath,
    isPublished,
    disabledReason,
  };
  const artifactActions = {
    canOpenInBrowser,
    canOpenInBrowserTab: !!browserTabUrl,
    canOpenLocalFile,
    isBackendArtifact,
    backendPort,
    artifact,
    deleteBusy,
    onReload,
    onOpenInBrowser,
    onOpenInBrowserTab,
    onOpenFolder,
    onOpenOS,
    onDownload,
    onTrash,
  };
  const previewModel = {
    draftUrl: draftPreviewUrl,
    error: err,
    setError: setErr,
    isText,
    isImage,
    imageSrc,
    imageFailed,
    loading,
    text: textPreview,
    textContentRef,
    captureTextSelection,
    textExtension: textExt,
    artifact,
    csv: csvPreview,
    onDownload,
    onOpenOS,
    url: previewUrl,
    doc: previewDoc,
    kind: previewKind,
    iframeRef,
    title,
    iframeReady,
    setIframeReady,
    onReload,
  };
  const bodyReview = {
    layer,
    open: commentsOpen,
    enabled: commentsEnabled,
    inboxOpen,
    setInboxOpen,
    markersShown,
    setMarkersShown,
    onToggle: toggleComments,
    userDir: commentUserDir,
    reportId: commentReportId,
    controller: comments,
    onStatus: setCommentStatus,
    onAddressWithAgent: addressCommentWithAgent,
    onCreate: createArtifactComment,
    textSelection,
    setTextSelection,
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      width="min(1080px, 94vw)"
      height="min(820px, 88vh)"
      labelledBy="artifact-viewer-title"
    >
      <ArtifactViewerHeader
        title={title}
        authorship={authorship}
        workspace={workspace}
        review={headerReview}
        publication={publication}
        actions={artifactActions}
        diagnostics={diagnostics}
        onClose={onClose}
      />

      {workspace.currentRevision && (
        <ArtifactRevisionBar
          revision={workspace.currentRevision}
          revisions={workspace.revisions}
          status={workspace.status}
          dirty={workspace.dirty}
          canEdit={workspace.capabilities?.canEdit !== false}
          onSave={() => saveWorkspace()}
          onDiscard={workspace.discard}
          onCompare={workspace.compareRevision}
        />
      )}
      {(workspace.error || workspace.conflict) && (
        <div className="artifact-workspace-notice" role="alert">
          {workspace.conflict
            ? 'This draft changed elsewhere. Your text is still here; reload the latest revision before saving.'
            : workspace.error}
        </div>
      )}
      {feedbackNotice && (
        <button
          type="button"
          className="artifact-feedback-notice"
          onClick={() => workspace.setMode('review')}
        >
          {Ico.chats(15)} <span>{feedbackNotice}</span>
        </button>
      )}
      {/* A superseded suggestion is still decidable, so it is announced rather
          than taking over the canvas the way a current one does. */}
      {/* Any pending suggestion, not only a superseded one: the comparison
          auto-opens at most once, so without this a decision closed without
          being made would have no way back and would keep gating the file. */}
      {workspace.repairPending
        && !workspace.comparison
        && workspace.repair.id !== dismissedRepairId && (
        <div className="artifact-repair-notice" role="status">
          <span>
            {workspace.repairSuperseded
              ? 'An agent suggestion from before your last edit is still open.'
              : 'An agent suggestion is waiting on your decision.'}
            {repairNoticeError ? ` ${repairNoticeError}` : ''}
          </span>
          <button
            type="button"
            disabled={repairBusy}
            onClick={viewRepairChange}
          >
            View change
          </button>
          <button
            type="button"
            disabled={repairBusy}
            onClick={() => setPendingDiscard({ repairId: workspace.repair.id })}
          >
            Discard
          </button>
          <button
            type="button"
            className="artifact-repair-notice-dismiss"
            aria-label="Dismiss"
            onClick={() => setDismissedRepairId(workspace.repair.id)}
          >
            {Ico.close(12)}
          </button>
        </div>
      )}
      {/* The create guard names its blocker, so the refusal carries the way
          out rather than describing a state the user cannot change. */}
      {blockedBy && (
        <div className="artifact-repair-notice" role="status">
          <span>
            {blockedComment
              ? `An agent suggestion for “${blockedComment}” is still waiting on a decision.`
              : 'An agent suggestion on this file is still waiting on a decision.'}
          </span>
          <button
            type="button"
            disabled={repairBusy}
            onClick={() => setPendingDiscard({ repairId: blockedBy.repairId, clearBlocker: true })}
          >
            Discard the pending suggestion
          </button>
          <button
            type="button"
            className="artifact-repair-notice-dismiss"
            aria-label="Dismiss"
            onClick={() => setBlockedBy(null)}
          >
            {Ico.close(12)}
          </button>
        </div>
      )}

      <ArtifactViewerBody
        workspace={{ ...workspace, save: saveWorkspace }}
        preview={previewModel}
        review={bodyReview}
        agentReview={{ busy: repairBusy, setBusy: setRepairBusy }}
      />

      <ConfirmModal
        open={!!pendingDiscard}
        title="Discard this suggestion?"
        message={'The agent\'s change stays in this artifact\'s history, but the '
          + 'suggestion is closed and will not be applied.'}
        confirmLabel="Discard"
        destructive
        busy={repairBusy}
        error={repairNoticeError}
        onClose={() => setPendingDiscard(null)}
        onConfirm={confirmDiscardRepair}
      />

      {/* Delete confirmation */}
      <ConfirmModal
        open={confirmDelete}
        title="Delete artifact?"
        message={`"${title}" will be permanently deleted. This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        busy={deleteBusy}
        busyLabel="Deleting…"
        onConfirm={onConfirmDelete}
        onClose={() => { if (!deleteBusy) setConfirmDelete(false); }}
      />
    </Modal>
  );
}
