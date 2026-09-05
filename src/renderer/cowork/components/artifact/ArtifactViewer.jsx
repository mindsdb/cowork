import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  allocateConversationId,
  mountArtifactPreview,
  previewArtifact,
  unpublishArtifact,
  artifactServeUrl,
} from '../../api';
import Ico from '../Icons';
import { deleteArtifactAndSync } from '../../lib/artifactsStore';
import { needsClientUnpublishBeforeDelete } from '../../lib/artifactActions';
import { downloadArtifactFile } from '../../lib/artifactDownload';
import { loadArtifactDraftText, loadArtifactDraftDocument } from '../../lib/artifactWorkspaceApi';
import { artifactCommentsKey, artifactIdentity } from '../../lib/artifactIdentity';
import { isPublishableArtifact, isImageArtifact, BACKEND_ARTIFACT_TYPES } from '../../lib/artifactKinds';
import { useBlobImageSrc } from '../AttachmentThumbnail';
import { Modal } from '../ui/Modal';
import { ConfirmModal } from '../ConfirmModal';
import { host } from '../../../platform/host';
import { useOrgMode } from '../../../lib/orgMode';
import { usePublish } from './publish/usePublish';
import { useArtifactComments, useArtifactCommentLayer } from './comments';
import { ArtifactRevisionBar } from './workspace/ArtifactRevisionBar';
import { useArtifactWorkspace } from './workspace/useArtifactWorkspace';
import { ArtifactViewerHeader } from './ArtifactViewerHeader';
import { ArtifactViewerBody } from './ArtifactViewerBody';
import './artifactWorkspace.css';
import {
  artifactExtension,
  countCsvRows,
  csvRowsToGfmTable,
  CSV_PREVIEW_ROW_LIMIT,
  draftPreviewErrorMessage,
  isTextArtifact,
  isAbsoluteArtifactPreviewUrl,
  canFetchDraftWithCredentials,
  injectDraftBaseHref,
  parseCsv,
  withArtifactCommentFlag,
  withArtifactVersion,
} from './artifactPreviewUtils';



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
  const displayPath = artifact?.displayPath || actionPath;
  const disabledReason = artifact?.actionDisabledReason || '';
  const hasActionPath = !!actionPath && !disabledReason;
  const draftPreviewUrl = artifact?.draftUrl || '';
  const hasPreviewSource = hasActionPath || !!draftPreviewUrl;
  const isBackendArtifact = BACKEND_ARTIFACT_TYPES.has(artifact?.type);
  // Prefer the artifact folder: fullstack entry HTML can live under static/, whose parent is not
  // the artifact root.
  const artifactFolder = artifact?.folder || actionPath.replace(/[\\/][^\\/]*$/, '') || actionPath;
  // Use a mounted URL so relative scripts and styles resolve against the artifact.
  const [previewUrl, setPreviewUrl] = useState('');
  // Draft HTML uses srcdoc after authenticated fetching; previewUrl and previewDoc are mutually
  // exclusive.
  const [previewDoc, setPreviewDoc] = useState('');
  const [previewKind, setPreviewKind] = useState('');
  // Keep the placeholder until the iframe loads, even after its URL is ready.
  const [iframeReady, setIframeReady] = useState(false);
  // Text preview state for .md/.txt/.csv — populated via
  // `/v1/artifacts/preview`. Holds `{ content, truncated, mime }`.
  const [textPreview, setTextPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [backendPort, setBackendPort] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  // Force a fresh mount/fetch on manual reload even if mtime is unchanged.
  const [reloadNonce, setReloadNonce] = useState(0);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [markersShown, setMarkersShown] = useState(true);
  const [repairBusy, setRepairBusy] = useState(false);
  const [textSelection, setTextSelection] = useState(null);
  const [feedbackNotice, setFeedbackNotice] = useState('');
  // Dismiss per repair so revisiting the artifact does not repeat the same suggestion.
  const [dismissedRepairId, setDismissedRepairId] = useState('');
  // Rendered twice: inline in the repair notice, and as the discard dialog's
  // error, so a failure is visible whether or not that dialog is open.
  const [repairNoticeError, setRepairNoticeError] = useState('');
  const [blockedBy, setBlockedBy] = useState(null);
  const [pendingDiscard, setPendingDiscard] = useState(null);
  // For cards without mtime, bump a per-open nonce so reopening fetches fresh content.
  const openNonceRef = useRef(0);
  const textContentRef = useRef(null);

  const pub = usePublish(artifact, { onChange, enabled: open });
  const workspace = useArtifactWorkspace(artifact, { open, onChange });
  // Allocate a fallback repair chat when there is no host conversation or reachable origin chat.
  const repairConversationId = useMemo(
    () => conversationId || (open && workspace.supported ? allocateConversationId() : ''),
    // `artifact?.id` stays in the deps because switching artifacts has to mint a
    // fresh repair conversation instead of reusing the previous artifact's.
    [artifact?.id, workspace.supported, conversationId, open],
  );
  // Both are per repair, and this component outlives an artifact switch.
  useEffect(() => {
    setRepairNoticeError('');
    setBlockedBy(null);
  }, [workspace.repair?.id, artifact?.id]);

  const notifyUnreadFeedback = useCallback(() => {
    setFeedbackNotice('New feedback arrived. Open Review to see the issue.');
  }, []);

  useEffect(() => {
    if (!feedbackNotice) return undefined;
    const timer = window.setTimeout(() => setFeedbackNotice(''), 6000);
    return () => window.clearTimeout(timer);
  }, [feedbackNotice]);

  // Use one stable comment thread identity across drafts and published versions.
  const artifactKey = artifact?.artifactKey
    || pub.artifactKey
    || artifactCommentsKey(artifactIdentity(artifact));
  const commentsEnabled = !!artifactKey && (
    workspace.commentsReady
    || (!!pub.publishedUrl && pub.accessMode === 'restricted')
  );
  // Inject the inert bridge before comment transport is ready to avoid remounting the preview when
  // readiness changes.
  const commentLayerRequested = !!artifactKey;
  const _akParts = artifactKey.split('/');
  const commentUserDir = _akParts[0] || '';
  const commentReportId = _akParts.slice(1).join('/') || '';

  // Share comments between inbox and iframe markers; the layer bridges them over postMessage.
  const iframeRef = useRef(null);
  const comments = useArtifactComments(commentUserDir, commentReportId, {
    enabled: open && commentsEnabled,
    onUnread: workspace.capabilities?.role === 'owner' ? notifyUnreadFeedback : undefined,
  });

  const blockedComment = useMemo(() => {
    if (!blockedBy?.commentThreadId) return '';
    const thread = (comments.threads || [])
      .find((item) => item.id === blockedBy.commentThreadId);
    const text = (thread?.payload?.text || '').trim();
    return text.length > 60 ? `${text.slice(0, 60)}…` : text;
  }, [blockedBy?.commentThreadId, comments.threads]);

  // Release waiting repairs only after resolving their comment; releasing first would prevent the
  // decision.
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
  // The injected layer owns pins/popovers; push threads and controls over the bridge. An empty
  // thread list hides markers.
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

  // Close placement mode with the comment controls so its cursor cannot remain on a plain preview.
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
    if (!open || workspace.repair?.status !== 'queued') return undefined;
    let cancelled = false;
    const poll = async () => {
      try {
        const detail = await workspace.refreshRepair();
        if (!cancelled && detail?.repair?.status === 'queued') {
          timer = window.setTimeout(poll, 2500);
        }
      } catch {
        if (!cancelled) timer = window.setTimeout(poll, 5000);
      }
    };
    let timer = window.setTimeout(poll, 1200);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [open, workspace.repair?.id, workspace.repair?.status, workspace.refreshRepair]);

  useEffect(() => {
    if (inboxOpen && comments.unreadCount > 0) comments.markRead();
  }, [comments.markRead, comments.unreadCount, inboxOpen]);

  const addressCommentWithAgent = async (thread) => {
    if (!onAddressWithAgent || repairBusy) return;
    setRepairBusy(true);
    setErr('');
    try {
      // Resolve the chat before creating a repair: the server completes handoffs only in the
      // conversation bound to their record.
      const targetConversationId = conversationId
        || (resolveRepairConversation ? await resolveRepairConversation(artifact) : '')
        || repairConversationId;
      const requested = await workspace.addressWithAgent({
        thread,
        conversationId: targetConversationId,
      });
      if (requested) {
        let started;
        try {
          started = await onAddressWithAgent({
            artifact,
            prompt: requested.prompt,
            repair: requested.repair,
            conversationId: targetConversationId,
          });
        } catch (startError) {
          try { await workspace.cancelRepair(requested.repair.id); } catch { /* keep original error */ }
          throw startError;
        }
        if (started === false) {
          await workspace.cancelRepair(requested.repair.id);
          setErr('Connect an agent provider, then try addressing this comment again.');
        }
      }
    } catch (requestError) {
      if (requestError?.status === 422 && requestError?.detail?.repairId) {
        setBlockedBy(requestError.detail);
      } else {
        setErr(requestError?.message || 'Could not send this comment to the agent');
      }
    } finally {
      setRepairBusy(false);
    }
  };

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

  const isText = isTextArtifact(artifact);
  const textExt = isText
    ? ((artifact?.ext || '').toLowerCase() || artifactExtension(actionPath))
    : '';
  const publishable = isPublishableArtifact(artifact);
  const canManage = workspace.capabilities
    ? workspace.capabilities.canEdit !== false
    : artifact?.capabilities
      ? artifact.capabilities.canEdit !== false
      : !orgMode;

  // Images load through versioned blob URLs because CSP blocks direct loopback sources; they need
  // no HTML mount.
  const isImage = isImageArtifact(artifact);
  const imageRawUrl = isImage ? artifactServeUrl(artifact) : '';
  const imageUrl = imageRawUrl
    ? withArtifactVersion(imageRawUrl, `${artifact?.mtime ?? 0}.${reloadNonce}`)
    : '';
  const { src: imageSrc, failed: imageFailed } = useBlobImageSrc({ url: imageUrl || null });

  useEffect(() => { setIframeReady(false); }, [previewUrl, previewDoc]);


  // Text loads inline; static HTML mounts with sibling assets; fullstack previews use the backend
  // proxy,
  // which reads the current port so restarts remain reachable.
  useEffect(() => {
    if (!open || !artifact) return;
    if (!hasPreviewSource) {
      setPreviewUrl('');
      setTextPreview(null);
      setErr(disabledReason || 'This artifact does not have a local file path.');
      return;
    }
    setLoading(true);
    setErr('');
    setPreviewUrl('');
    setPreviewDoc('');
    setPreviewKind('');
    setBackendPort(null);
    setTextPreview(null);
    let cancelled = false;
    if (isText) {
      const previewRequest = draftPreviewUrl
        ? loadArtifactDraftText(draftPreviewUrl, {
            // The same split the draft-HTML branch makes below, so a
            // data:/blob: or cross-origin draft renders here too instead of
            // failing only for text.
            withCredentials: canFetchDraftWithCredentials(draftPreviewUrl, host.getApiOrigin()),
          })
        : previewArtifact(actionPath);
      previewRequest
        .then((data) => {
          if (cancelled) return;
          if (!data || typeof data.content !== 'string') {
            throw new Error('Preview returned no content');
          }
          setTextPreview({
            content: data.content,
            truncated: !!data.truncated,
            mime: data.mime || '',
          });
        })
        .catch((e) => { if (!cancelled) setErr(draftPreviewErrorMessage(e)); })
        .finally(() => { if (!cancelled) setLoading(false); });
      return () => { cancelled = true; };
    }
    if (isImage) {
      // Image fetching is handled by useBlobImageSrc; no server mount is needed.
      setLoading(false);
      return () => { cancelled = true; };
    }
    // Version previews by content mtime (or per-open nonce) plus manual reloads. Do not include the
    // initial
    // revision response: loading editing metadata must not discard a freshly painted iframe.
    const baseVersion = artifact?.mtime || (openNonceRef.current += 1);
    const cacheVersion = `${baseVersion}.${reloadNonce}`;
    if (draftPreviewUrl && !isText && (!isBackendArtifact || !hasActionPath)) {
      const rawUrl = isAbsoluteArtifactPreviewUrl(draftPreviewUrl)
        ? draftPreviewUrl
        : `${host.getApiOrigin()}${draftPreviewUrl}`;
      const fetchUrl = commentLayerRequested
        ? withArtifactCommentFlag(withArtifactVersion(rawUrl, cacheVersion))
        : withArtifactVersion(rawUrl, cacheVersion);
      setPreviewKind('static');
      if (!canFetchDraftWithCredentials(rawUrl, host.getApiOrigin())) {
        // Only same-origin API drafts may use authFetch. Cross-origin URLs must never receive the
        // Keycloak token;
        // data/blob content needs no credentials.
        setPreviewUrl(fetchUrl);
        setLoading(false);
        return () => { cancelled = true; };
      }
      // Iframe navigation cannot attach Authorization, so fetch protected draft HTML and render it
      // through srcdoc.
      // Both preview states are reset before assigning one.
      loadArtifactDraftDocument(fetchUrl)
        .then((doc) => {
          if (cancelled) return;
          if (doc.isHtml) {
            setPreviewDoc(injectDraftBaseHref(doc.content, fetchUrl));
          } else {
            // Non-HTML responses fall back to iframe navigation. This repeats the fetch and may
            // still hit an auth 401 on web.
            setPreviewUrl(fetchUrl);
          }
        })
        .catch((e) => {
          if (cancelled) return;
          setErr(draftPreviewErrorMessage(e, 'Could not load this draft'));
        })
        .finally(() => { if (!cancelled) setLoading(false); });
      return () => { cancelled = true; };
    }
    mountArtifactPreview(actionPath)
      .then(async ({ kind, url, artifactDir, port, proxyUrl, backendRunning, launchError }) => {
        if (kind === 'proxy') {
          if (!artifactDir) throw new Error('Preview mount returned no artifact dir');
          if (backendRunning === false) {
            throw new Error(launchError || 'Backend failed to start');
          }
          if (!proxyUrl) throw new Error('Preview proxy unavailable');
          let iframeUrl = proxyUrl;
          try {
            const u = new URL(proxyUrl);
            if (window.location?.protocol) u.protocol = window.location.protocol;
            if (window.location?.hostname) u.hostname = window.location.hostname;
            iframeUrl = u.toString();
          } catch { /* fall through with the raw URL */ }
          if (cancelled) return;
          setPreviewKind('proxy');
          // Bake comment-layer activation into the proxy URL at mount time to keep its source
          // stable.
          setPreviewUrl(commentLayerRequested
            ? withArtifactCommentFlag(withArtifactVersion(iframeUrl, cacheVersion))
            : withArtifactVersion(iframeUrl, cacheVersion));
          if (typeof port === 'number') setBackendPort(port);
          return;
        }
        if (!url) throw new Error('Preview mount returned no URL');
        if (cancelled) return;
        setPreviewKind('static');
        // Set the inert bridge flag on the first URL so transport readiness does not reload the
        // iframe.
        setPreviewUrl(commentLayerRequested
          ? withArtifactCommentFlag(withArtifactVersion(url, cacheVersion))
          : withArtifactVersion(url, cacheVersion));
        // Let usePublish refresh authoritative access state. Adopting this callback’s stale
        // artifact could overwrite
        // a newly loaded restricted audience with public defaults.
      })
      .catch((e) => { if (!cancelled) setErr(e?.message || 'Could not load artifact'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, artifact?.path, artifact?.mtime, actionPath, hasPreviewSource, disabledReason, draftPreviewUrl, isText, isImage, reloadNonce, commentLayerRequested]);

  // Cap displayed CSV rows for render cost, counting total rows separately for the truncation
  // notice.
  const csvPreview = useMemo(() => {
    if (!isText || textExt !== '.csv' || !textPreview?.content) return null;
    const rows = parseCsv(textPreview.content, CSV_PREVIEW_ROW_LIMIT);
    if (rows.length === 0) return null;
    const totalRows = Math.max(0, countCsvRows(textPreview.content) - 1);
    const shownRows = Math.max(0, rows.length - 1);
    return {
      markdown: csvRowsToGfmTable(rows),
      totalRows,
      shownRows,
      truncated: shownRows < totalRows,
    };
  }, [isText, textExt, textPreview?.content]);

  // Keep hooks above the early return so closing the mounted viewer does not change their sequence.
  const onReload = useCallback(() => {
    if (!hasPreviewSource) return;
    setIframeReady(false);
    setReloadNonce((n) => n + 1);
  }, [hasPreviewSource]);

  const saveWorkspace = useCallback(async (...args) => {
    const saved = await workspace.save(...args);
    if (saved) onReload();
    return saved;
  }, [onReload, workspace.save]);

  if (!open || !artifact) return null;

  const title = artifact.title || artifact.path?.split('/').pop();
  const isPublished = !!pub.publishedUrl;

  // OS paths work only with local Electron; remote/web servers require serve or published URLs.
  const canOpenLocalFile = host.isElectron && host.isLocalApiOrigin();
  const canOpenInBrowser = isPublished || canOpenLocalFile || !!artifact?.serveUrl;

  const onOpenFolder = async () => {
    if (!canOpenLocalFile) return;
    try {
      const res = await host.openPath(artifactFolder || actionPath);
      if (res && res.ok === false) setErr(res.reason || 'Could not open folder.');
    } catch (e) {
      setErr(e?.message || 'Could not open folder.');
    }
  };

  const onOpenPublished = async () => {
    if (!pub.publishedUrl) return;
    try { await host.openExternal(pub.publishedUrl); }
    catch { window.open(pub.publishedUrl, '_blank', 'noreferrer'); }
  };

  // Open HTML previews in the browser and other local files in their default app.
  const onOpenOS = async () => {
    if (isBackendArtifact && canOpenLocalFile) {
      if (!backendPort) {
        setErr('Backend port not available yet — preview is still loading.');
        return;
      }
      try { await host.openExternal(`http://127.0.0.1:${backendPort}`); }
      catch (e) { setErr(e?.message || 'Open failed'); }
      return;
    }
    if (!canOpenLocalFile) {
      const rel = artifact?.serveUrl || '';
      const url = rel
        ? (rel.startsWith('http') ? rel : `${host.getApiOrigin()}${rel}`)
        : (pub.publishedUrl || '');
      if (url) {
        try { await host.openExternal(url); }
        catch { window.open(url, '_blank', 'noreferrer'); }
        return;
      }
      setErr('This artifact is served from a remote server and has no open URL yet.');
      return;
    }
    if (!hasActionPath) {
      setErr(disabledReason || 'This artifact does not have a local file path.');
      return;
    }
    try {
      const result = await host.openPath(actionPath);
      if (result && result.ok === false) throw new Error(result.reason || 'Could not open artifact.');
    } catch (e) {
      setErr(e?.message || 'Open failed');
    }
  };

  const onOpenInBrowser = () => (isPublished ? onOpenPublished() : onOpenOS());

  // The browser-tab control requires a URL; the OS-open action may instead open a file.
  // Prefer published, then served, then authenticated draft URLs.
  const browserTabUrl = pub.publishedUrl || artifact?.serveUrl || draftPreviewUrl || '';
  const onOpenInBrowserTab = () => {
    if (!browserTabUrl) return;
    host.openExternal(browserTabUrl).catch(() => {
      setErr('Could not open this artifact in a browser.');
    });
  };

  // Download through the desktop serve URL or authenticated organization draft URL. ENG-2044.
  const onDownload = async () => {
    if (!(await downloadArtifactFile(artifact, { actionPath }))) {
      setErr(disabledReason || 'This artifact has no downloadable file yet.');
    }
  };

  const onTrash = () => {
    if (pub.busy || deleteBusy) return;
    if (!hasActionPath) {
      setErr(disabledReason || 'This artifact does not have a local file path.');
      return;
    }
    setConfirmDelete(true);
  };

  const onConfirmDelete = async () => {
    // Delete through the server so unpublish-before-delete runs and the whole artifact folder,
    // including metadata, is removed.
    setDeleteBusy(true);
    setErr('');
    try {
      // Desktop's path-addressed delete needs a client-side unpublish first.
      // SaaS performs both operations atomically on the scoped server route.
      if (needsClientUnpublishBeforeDelete({ orgMode, published: isPublished })) {
        await unpublishArtifact(actionPath);
      }
      await deleteArtifactAndSync(artifact);
      setConfirmDelete(false);
      onDelete?.(actionPath);
      onClose?.();
    } catch (e) {
      setConfirmDelete(false);
      setErr(e?.message || 'Delete failed');
    } finally {
      setDeleteBusy(false);
    }
  };

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
        workspace={workspace}
        review={headerReview}
        publication={publication}
        actions={artifactActions}
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
      {/*
 * Offer a way back to every pending decision: comparison auto-opens only once, and an undecided
 * repair keeps gating the file.
 */}
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
            onClick={async () => {
              setRepairNoticeError('');
              setRepairBusy(true);
              try {
                await workspace.refreshRepair();
              } catch (noticeError) {
                setRepairNoticeError(noticeError?.message || 'Could not open that suggestion.');
              } finally {
                setRepairBusy(false);
              }
            }}
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
        onConfirm={async () => {
          setRepairNoticeError('');
          setRepairBusy(true);
          try {
            await workspace.cancelRepair(pendingDiscard.repairId, { discardReady: true });
            if (pendingDiscard.clearBlocker) setBlockedBy(null);
            setPendingDiscard(null);
          } catch (discardError) {
            setRepairNoticeError(discardError?.message || 'Could not discard that suggestion.');
          } finally {
            setRepairBusy(false);
          }
        }}
      />

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
