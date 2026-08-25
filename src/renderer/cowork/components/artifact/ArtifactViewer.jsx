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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  allocateConversationId,
  mountArtifactPreview,
  previewArtifact,
  unpublishArtifact,
} from '../../api';
import { deleteArtifactAndSync } from '../../lib/artifactsStore';
import { needsClientUnpublishBeforeDelete } from '../../lib/artifactActions';
import { downloadArtifactFile } from '../../lib/artifactDownload';
import { loadArtifactDraftText } from '../../lib/artifactWorkspaceApi';
import { isPublishableArtifact, BACKEND_ARTIFACT_TYPES, publishBlockedReason } from '../../lib/artifactKinds';
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
import {
  artifactExtension,
  countCsvRows,
  csvRowsToGfmTable,
  CSV_PREVIEW_ROW_LIMIT,
  isTextArtifact,
  isAbsoluteArtifactPreviewUrl,
  parseCsv,
  withArtifactCommentFlag,
  withArtifactVersion,
} from './artifactPreviewUtils';

// Extensions we render inline with the lightweight text preview path
// (server `/v1/artifacts/preview` → text body). `.md` gets the full
// markdown renderer; `.csv` gets a parsed table; `.txt` and friends
// fall back to a monospace block.


export function ArtifactViewer({
  open,
  artifact,
  onClose,
  onChange,
  onDelete,
  onAddressWithAgent,
  conversationId = null,
}) {
  const orgMode = useOrgMode();
  const actionPath = artifact?.canonicalPath || artifact?.file_path || artifact?.path || '';
  const displayPath = artifact?.displayPath || actionPath;
  const disabledReason = artifact?.actionDisabledReason || '';
  const hasActionPath = !!actionPath && !disabledReason;
  const draftPreviewUrl = artifact?.draftUrl || '';
  const hasPreviewSource = hasActionPath || !!draftPreviewUrl;
  const isBackendArtifact = BACKEND_ARTIFACT_TYPES.has(artifact?.type);
  // Non-empty when this artifact's type may never be published (e.g.
  // fullstack-stateful-app). Drives the Publish action's disabled state.
  const publishBlock = publishBlockedReason(artifact);
  // Backend artifacts treat the folder, not the entry html, as the
  // "thing" the user opens in their OS or browser. Prefer the server's
  // `folder` (the artifact's slug dir) — for fullstack apps the primary
  // sits in a `static/` subdir, so stripping the filename off the path
  // would point at `static/`, not the slug folder. Fall back to that
  // strip for records that don't carry `folder` (e.g. from a chat bubble).
  const artifactFolder = artifact?.folder || actionPath.replace(/[\\/][^\\/]*$/, '') || actionPath;
  // Mounted preview URL — iframe loads this with `src=` so relative
  // `<script>` / `<link>` refs in the HTML resolve against a real URL.
  // (srcdoc has no base URL → relative refs 404.)
  const [previewUrl, setPreviewUrl] = useState('');
  // 'static' (HTML asset bundle) | 'proxy' (fullstack) — the comment marker
  // layer is server-injected only on the static serve path, so the pin/mode
  // affordance and the activation flag are gated on this.
  const [previewKind, setPreviewKind] = useState('');
  // Whether the iframe has finished its first paint — drives the loading
  // placeholder so it lingers past "URL is ready" until content is visible.
  const [iframeReady, setIframeReady] = useState(false);
  // Text preview state for .md/.txt/.csv — populated via
  // `/v1/artifacts/preview`. Holds `{ content, truncated, mime }`.
  const [textPreview, setTextPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [backendPort, setBackendPort] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  // Manual-reload counter — bumped by the link-pill reload button to
  // force a fresh mount/fetch even when the artifact's mtime is unchanged.
  const [reloadNonce, setReloadNonce] = useState(0);
  // Comments chrome state. The top bar owns ONE switch (commentsOpen) that
  // shows/hides the floating comments toolbar; the toolbar owns the rest —
  // comment-placement mode, the inbox sidebar, marker visibility, leaving.
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [markersShown, setMarkersShown] = useState(true);
  const [repairBusy, setRepairBusy] = useState(false);
  const [textSelection, setTextSelection] = useState(null);
  const [feedbackNotice, setFeedbackNotice] = useState('');
  // Per-open counter used as a cache-buster fallback for artifacts whose
  // object carries no `mtime` (e.g. chat-bubble previews built from stream
  // steps). Increments only when there's no mtime, so every (re)open of
  // such an artifact fetches fresh content (ENG-375).
  const openNonceRef = useRef(0);
  const textContentRef = useRef(null);

  // Publish/access state machine — the single source of truth for the
  // <PublishMenu> popover and the link-pill's published-URL display.
  const pub = usePublish(artifact, { onChange, enabled: open });
  const workspace = useArtifactWorkspace(artifact, { open, onChange });
  const repairConversationId = useMemo(
    () => conversationId || (open && artifact?.stableId ? allocateConversationId() : ''),
    [artifact?.stableId, conversationId, open],
  );
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
    || (artifact?.stableId ? `artifact/${artifact.stableId}` : '');
  const commentsEnabled = !!artifactKey && (
    workspace.commentsReady
    || (!!pub.publishedUrl && pub.accessMode === 'restricted')
  );
  const _akParts = artifactKey.split('/');
  const commentUserDir = _akParts[0] || '';
  const commentReportId = _akParts.slice(1).join('/') || '';

  // Iframe handle + shared comments state. One `useArtifactComments` instance
  // backs BOTH the inbox panel and the on-artifact marker layer (injected by
  // cowork-server) — `useArtifactCommentLayer` bridges to that layer over
  // postMessage. Both stay dormant when comments are disabled.
  const iframeRef = useRef(null);
  const comments = useArtifactComments(commentUserDir, commentReportId, {
    enabled: open && commentsEnabled,
    onUnread: workspace.capabilities?.role === 'owner' ? notifyUnreadFeedback : undefined,
  });
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
    onStatus: comments.setStatus,
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
      const requested = await workspace.addressWithAgent({
        thread,
        conversationId: repairConversationId,
      });
      if (requested) {
        let started;
        try {
          started = await onAddressWithAgent({
            artifact,
            prompt: requested.prompt,
            repair: requested.repair,
            conversationId: repairConversationId,
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
      setErr(requestError?.message || 'Could not send this comment to the agent');
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

  // Reset the painted flag whenever the mounted URL changes so the
  // placeholder reappears for the new content.
  useEffect(() => { setIframeReady(false); }, [previewUrl]);

  // Esc-to-close + portal + body-scroll lock all live in <Modal>.

  // Mount the artifact when opened.
  //   - Text (.md/.txt/.csv): skip the iframe entirely and fetch the
  //     body via `/v1/artifacts/preview` so we can render it inline.
  //   - Static (HTML-only): server registers the parent dir under a
  //     token and returns a URL that serves the entry HTML; sibling
  //     assets resolve naturally because they share the URL prefix.
  //   - Proxy (backend+frontend): main hosts a loopback HTTP forwarder
  //     pointed at the artifact's backend port (read lazily from
  //     metadata.json on every request, so a restarted backend on a
  //     new port keeps working).
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
    setPreviewKind('');
    setBackendPort(null);
    setTextPreview(null);
    let cancelled = false;
    if (isText) {
      const previewRequest = draftPreviewUrl
        ? loadArtifactDraftText(draftPreviewUrl)
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
        .catch((e) => { if (!cancelled) setErr(e?.message || 'Could not load preview'); })
        .finally(() => { if (!cancelled) setLoading(false); });
      return () => { cancelled = true; };
    }
    // Cache-buster for the iframe so a content change (or just reopening /
    // a manual reload) fetches fresh content instead of the webview's
    // first-loaded copy. Prefer the server's content `mtime` — it changes
    // only on a real edit — and fold in the per-open nonce + manual-reload
    // counter so reopens and the reload button always re-fetch.
    // The revision id is the authoritative content version once the workspace
    // has loaded. It changes after every manual or agent save, even when the
    // parent artifact list has not refreshed its filesystem mtime yet.
    const baseVersion = workspace.currentRevision?.id
      || artifact?.mtime
      || (openNonceRef.current += 1);
    const cacheVersion = `${baseVersion}.${reloadNonce}`;
    if (draftPreviewUrl && !isText && (!isBackendArtifact || !hasActionPath)) {
      const rawUrl = isAbsoluteArtifactPreviewUrl(draftPreviewUrl)
        ? draftPreviewUrl
        : `${host.getApiOrigin()}${draftPreviewUrl}`;
      setPreviewKind('static');
      setPreviewUrl(commentsEnabled
        ? withArtifactCommentFlag(withArtifactVersion(rawUrl, cacheVersion))
        : withArtifactVersion(rawUrl, cacheVersion));
      setLoading(false);
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
          // Fullstack previews flow through the proxy, which injects the marker
          // layer into the root HTML on the same activation flag (see
          // preview_proxy.py). Bake it in at mount time — same rationale as the
          // static branch below (stable src, no reactive reload).
          setPreviewUrl(commentsEnabled
            ? withArtifactCommentFlag(withArtifactVersion(iframeUrl, cacheVersion))
            : withArtifactVersion(iframeUrl, cacheVersion));
          if (typeof port === 'number') setBackendPort(port);
          return;
        }
        if (!url) throw new Error('Preview mount returned no URL');
        if (cancelled) return;
        setPreviewKind('static');
        // Bake the comment-layer activation flag into the URL at mount time
        // (rather than swapping the iframe `src` reactively later) so the src
        // stays stable — no gratuitous reload/flicker. Injecting the layer into
        // an already-loaded cross-origin iframe is impossible, so enabling
        // comments after load inherently needs a remount; commentsEnabled is in
        // this effect's deps to make that a single, intentional re-run.
        setPreviewUrl(commentsEnabled
          ? withArtifactCommentFlag(withArtifactVersion(url, cacheVersion))
          : withArtifactVersion(url, cacheVersion));
        // NOTE (ENG-931): we deliberately do NOT adopt the server's published
        // URL here anymore. usePublish's open refresh() already pulls the
        // authoritative published/access state from /artifacts/status for every
        // artifact type (including chat-bubble stubs). The old adoption fired
        // onChange({ ...artifact, publishedUrl }) from this async callback's
        // STALE closure (stale `artifact` lacking accessMode/accessEmails, and a
        // stale `!pub.publishedUrl` guard), which raced with refresh() and
        // clobbered the just-loaded restricted access list back to "public".
      })
      .catch((e) => { if (!cancelled) setErr(e?.message || 'Could not load artifact'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, artifact?.path, artifact?.mtime, actionPath, hasPreviewSource, disabledReason, draftPreviewUrl, isText, reloadNonce, commentsEnabled, workspace.currentRevision?.id]);

  // Parse CSV → GFM pipe table once per loaded text. We cap at
  // CSV_PREVIEW_ROW_LIMIT data rows to keep the markdown renderer
  // snappy on large files; the total row count is computed separately
  // so we can show a "showing N of M" notice.
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

  if (!open || !artifact) return null;

  const title = artifact.title || artifact.path?.split('/').pop();
  const isPublished = !!pub.publishedUrl;

  // Open the local file only when the file is actually on this machine
  // (Electron + loopback server). When the desktop app points at a REMOTE
  // server, or in web, the path is on the server box, so we fall back to
  // the HTTP serve/published URL.
  const canOpenLocalFile = host.isElectron && host.isLocalApiOrigin();
  const canOpenInBrowser = isPublished || canOpenLocalFile || !!artifact?.serveUrl;

  // Open the artifact's containing folder in the OS file manager.
  const onOpenFolder = async () => {
    if (!canOpenLocalFile) return;
    try {
      const res = await host.openPath(artifactFolder || actionPath);
      if (res && res.ok === false) setErr(res.reason || 'Could not open folder.');
    } catch (e) {
      setErr(e?.message || 'Could not open folder.');
    }
  };

  // Force-refresh the preview (re-mount / re-fetch).
  const onReload = () => {
    if (!hasPreviewSource) return;
    setIframeReady(false);
    setReloadNonce((n) => n + 1);
  };

  // Open the published URL in the default browser; falls back to a new
  // window if the OS handoff is unavailable.
  const onOpenPublished = async () => {
    if (!pub.publishedUrl) return;
    try { await host.openExternal(pub.publishedUrl); }
    catch { window.open(pub.publishedUrl, '_blank', 'noreferrer'); }
  };

  // Open the local file / served preview (HTML → default browser, other
  // types → their default app). Handles backend artifacts + the web shell.
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

  // The link-pill arrow: published → open the public URL; otherwise → open
  // the local/served preview.
  const onOpenInBrowser = () => (isPublished ? onOpenPublished() : onOpenOS());

  // Universal "save to disk" — type-agnostic stream through the sidecar's
  // serve endpoint with Content-Disposition: attachment.
  const onDownload = () => {
    if (!downloadArtifactFile(artifact, { actionPath })) {
      setErr(disabledReason || 'This artifact has no serve URL yet.');
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
    // Deletion is centralized through cowork-server (not shell.trashItem)
    // so the server's unpublish-before-delete guard always runs. The whole
    // artifact folder is removed (not just the primary file) so metadata.json
    // goes too and the artifact disappears from the listing.
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
        commentsEnabled={commentsEnabled}
        commentsOpen={commentsOpen}
        comments={comments}
        toggleComments={toggleComments}
        canManage={canManage}
        publishable={publishable}
        pub={pub}
        hasActionPath={hasActionPath}
        isPublished={isPublished}
        publishBlock={publishBlock}
        disabledReason={disabledReason}
        canOpenInBrowser={canOpenInBrowser}
        canOpenLocalFile={canOpenLocalFile}
        isBackendArtifact={isBackendArtifact}
        backendPort={backendPort}
        artifact={artifact}
        deleteBusy={deleteBusy}
        onReload={onReload}
        onOpenInBrowser={onOpenInBrowser}
        onOpenFolder={onOpenFolder}
        onOpenOS={onOpenOS}
        onDownload={onDownload}
        onTrash={onTrash}
        onClose={onClose}
      />

      {workspace.currentRevision && (
        <ArtifactRevisionBar
          revision={workspace.currentRevision}
          revisions={workspace.revisions}
          status={workspace.status}
          dirty={workspace.dirty}
          canEdit={workspace.capabilities?.canEdit !== false}
          onSave={() => workspace.save()}
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

      <ArtifactViewerBody
        workspace={workspace}
        draftPreviewUrl={draftPreviewUrl}
        err={err}
        setErr={setErr}
        isText={isText}
        loading={loading}
        textPreview={textPreview}
        textContentRef={textContentRef}
        captureTextSelection={captureTextSelection}
        textExt={textExt}
        artifact={artifact}
        csvPreview={csvPreview}
        onDownload={onDownload}
        onOpenOS={onOpenOS}
        previewUrl={previewUrl}
        previewKind={previewKind}
        iframeRef={iframeRef}
        title={title}
        iframeReady={iframeReady}
        setIframeReady={setIframeReady}
        layer={layer}
        commentsOpen={commentsOpen}
        commentsEnabled={commentsEnabled}
        inboxOpen={inboxOpen}
        setInboxOpen={setInboxOpen}
        markersShown={markersShown}
        setMarkersShown={setMarkersShown}
        toggleComments={toggleComments}
        commentUserDir={commentUserDir}
        commentReportId={commentReportId}
        comments={comments}
        addressCommentWithAgent={addressCommentWithAgent}
        createArtifactComment={createArtifactComment}
        textSelection={textSelection}
        setTextSelection={setTextSelection}
        repairBusy={repairBusy}
        setRepairBusy={setRepairBusy}
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
