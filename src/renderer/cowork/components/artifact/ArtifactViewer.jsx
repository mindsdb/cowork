import { downloadUnavailableMessage } from '../../lib/browserDownload';
// Inline preview modal for artifacts. Renders the artifact's content in a
// sandboxed iframe (HTML / fullstack) or inline (md / csv / txt). The top
// bar has three responsive zones:
//
//   left   — artifact title (truncated)
//   middle — Preview / Source / Review modes
//   right  — Publish control · ⋯ menu · close
//
// With quick edits on (capabilities.canQuickEdit, ENG-4227), Preview carries a
// chat bar at the bottom: the user asks for a change and the server makes it
// directly or hands it to the artifact's chat (quickEdit/useQuickEdit).
//
// Publish/unpublish/update/change-access all live in the <PublishMenu>
// popover, backed by the usePublish state machine — so this component is
// just chrome + preview.

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  allocateConversationId,
  mountArtifactPreview,
  sendablePicks,
  previewArtifact,
  unpublishArtifact,
  artifactServeUrl,
} from '../../api';
// Only the feedback notice near the bottom of this file still draws an icon
// here; the rest of the chrome moved to ArtifactViewerHeader/Body and took the
// import with it, which left that one call site referencing nothing.
import Ico from '../Icons';
import { deleteArtifactAndSync } from '../../lib/artifactsStore';
import { needsClientUnpublishBeforeDelete } from '../../lib/artifactActions';
import { useArtifactAuthorship } from '../../hooks/useArtifactAuthorship';
import { downloadArtifactFile } from '../../lib/artifactDownload';
import { fetchAuthenticatedResponse } from '../../lib/authenticatedResource';
import {
  // Aliased: the component keeps its own `artifactRef` (a React ref).
  artifactRef as artifactWorkspaceRef,
  createDraftLink,
  loadArtifactDraftText,
  loadArtifactDraftDocument,
  loadArtifactRevisions,
} from '../../lib/artifactWorkspaceApi';
import { threadImageFiles } from '../../lib/commentImages';
import { isOpenThread } from '../../lib/commentsReducer';
import { commentFixMessage } from '../../lib/commentFixRequest';
import { imageAttachment } from '../../lib/imageAttachments';
import {
  RefusedDraftLink,
  draftLinkLifetimeMs,
  draftLinkUrl,
  draftLinksWithdrawal,
} from '../../lib/draftLinkRules';
import { setDraftLinks, useDraftLinks } from '../../../lib/draftLinks';
import { trackArtifactStatsOpened } from '../../lib/analytics';
import { UNKNOWN_SHARE_SNAPSHOT, reportWithdrawal, shareSnapshot } from '../../lib/artifactShareAnalytics';
import { diagnostic } from '../../../../shared/diagnostics';
import { artifactCommentsKey, artifactIdentity } from '../../lib/artifactIdentity';
import { isPublishableArtifact, isImageArtifact, BACKEND_ARTIFACT_TYPES } from '../../lib/artifactKinds';
import { useBlobImageSrc } from '../AttachmentThumbnail';
import { Modal } from '../ui/Modal';
import { ConfirmModal } from '../ConfirmModal';
import { host } from '../../../platform/host';
import { useOrgMode } from '../../../lib/orgMode';
import { useLiveApps } from '../../../lib/liveApps';
import { useLiveApp } from '../../hooks/useLiveApp';
import { launchLiveAppPrompt, liveAppViewerNotice } from '../../lib/liveAppState';
import { usePublish } from './publish/usePublish';
import { stopSharingNotice } from './publish/linkLeftLive';
import { useArtifactComments, useArtifactCommentLayer } from './comments';
// Imported past the index so a test that mocks './comments' keeps the real
// posting and image upload, which used to live in this file.
import { useCommentActions } from './comments/useCommentActions';
import { ArtifactRevisionBar } from './workspace/ArtifactRevisionBar';
import { useArtifactWorkspace } from './workspace/useArtifactWorkspace';
import { ArtifactViewerHeader } from './ArtifactViewerHeader';
import { ArtifactViewerBody } from './ArtifactViewerBody';
import { usePreviewDiagnostics } from './usePreviewDiagnostics';
import { normalizePreviewView, usePreviewView } from './usePreviewView';
import { usePreviewFit } from './usePreviewFit';
import { usePreviewCheckTarget } from './usePreviewCheckTarget';
import { usePreviewReloadTransition } from './usePreviewReloadTransition';
import { useViewerLayers } from './useViewerLayers';
import { useViewerModal } from './useViewerLayout';
import { ViewerModeRail } from './ViewerModeRail';
import { useOriginChatAction } from './useOriginChatAction';
import { QuickEditBar } from './quickEdit/QuickEditBar';
import { useQuickEdit } from './quickEdit/useQuickEdit';
import { countUserPrompts } from '../../lib/quickEditPrompt';
import { useChatTranscript, useConversationTranscript, useConversationTranscripts } from '../../lib/chatTranscriptContext';
import { requestConversationRefresh } from '../../lib/conversationRefresh';
import { useModelPickerContext } from '../../lib/modelPickerContext';
import { ModelEffortPicker, pickedEffort } from '../ModelEffortPicker';
import { MODEL_ROUTER } from '../../lib/modelCatalog';
import { useArtifactStats } from './stats/useArtifactStats';
import { inlineHtmlFromApi } from '../../lib/inlineHtmlAssets';
import { canPreviewDocument, documentPreviewType } from '../../preview/kinds';
import { useTranslation } from '../../../lib/i18n';
import { htmlText, showArtifactOnScreen } from '../../lib/voice/screenArtifacts';
import './artifactWorkspace.css';
import {
  artifactExtension,
  countCsvRows,
  draftNavigationIsAuthorized,
  draftPreviewErrorMessage,
  isTextArtifact,
  isAbsoluteArtifactPreviewUrl,
  canFetchDraftWithCredentials,
  injectDraftBaseHref,
  draftDirectoryUrl,
  draftFileName,
  limitArtifactFrames,
  summarizeCsvPreview,
  withArtifactCommentFlag,
  withArtifactVersion,
} from './artifactPreviewUtils';

// Extensions we render inline with the lightweight text preview path
// (server `/v1/artifacts/preview` → text body). `.md` gets the full
// markdown renderer; `.csv` gets a parsed table; `.txt` and friends
// fall back to a monospace block.


// Turns draft links off for this page when a failed request says so
// (draftLinksWithdrawal), and logs why: a page that silently stops using
// links would hide a misconfigured draft host. Every preview then reruns
// through srcdoc. True when links went off.
async function withdrawDraftLinks(error) {
  const event = await draftLinksWithdrawal(error, host.checkConfigured);
  if (!event) return false;
  diagnostic('renderer.cowork.components.artifact.ArtifactViewer', 'WARNING', event, error);
  setDraftLinks(false);
  return true;
}

// Every onChange payload is `{ ...artifact, ...fields }`, so identity fields
// carry over from the artifact the report started from.
function isSameArtifact(a, b) {
  if (!a || !b) return false;
  if (a.id || b.id) return a.id === b.id;
  return (a.path || '') === (b.path || '');
}

// How long "Published" stays after a reviewed change goes live.
const PUBLISHED_NOTICE_MS = 4000;

/* The prompt's text when a close would drop Edit text. While the workspace
   status is 'saving', a request that has already gone out decides what
   happens to the text: a save keeps it unless the save fails, and a revision
   restore replaces it. So that prompt says the edits may be lost. */
const CLOSE_PROMPTS = {
  unsaved: 'viewer.closePrompt.unsaved',
  saving: 'viewer.closePrompt.saving',
};

export function ArtifactViewer({
  open,
  artifact,
  onClose,
  onChange,
  onDelete,
  onAddressWithAgent,
  conversationId = null,
  resolveRepairConversation = null,
  // Outside a chat: show chat `id` (the bar's "Open in chat"). The viewer
  // stays open while the agent works there, and follows the reply itself.
  onOpenConversation = null,
  // One Share clicked outside the viewer (a new object per click): the viewer
  // opens with its Share panel showing. `shareEntry` names where, for the
  // sharing events of that panel only; later opens are the header's own.
  shareRequest = null,
  shareEntry = 'viewer',
  // One open-comments counter clicked outside the viewer (a new object per
  // click, ENG-4560): the viewer opens on its Comments panel this time, and
  // later opens keep the layers this device remembers.
  commentsRequest = null,
}) {
  const { t } = useTranslation('artifacts');
  const orgMode = useOrgMode();
  const liveApps = useLiveApps();
  const actionPath = artifact?.canonicalPath || artifact?.file_path || artifact?.path || '';
  const displayPath = artifact?.displayPath || actionPath;
  const disabledReason = artifact?.actionDisabledReason || '';
  const hasActionPath = !!actionPath && !disabledReason;
  const draftPreviewUrl = artifact?.draftUrl || '';
  // Org web: when the deployment serves drafts on a draft host through signed
  // links (/health's draft_links), the HTML preview opens one; otherwise the
  // srcdoc path below stays as it was.
  const draftLinks = useDraftLinks();
  // Only a draft on this server's drafts route has a link to ask for: an
  // embedded (data:/blob:) or another origin's draft URL keeps its own route.
  const draftLinkEnabled = host.isWeb && draftLinks
    && !!draftPreviewUrl && canFetchDraftWithCredentials(draftPreviewUrl, host.getApiOrigin());
  const hasPreviewSource = hasActionPath || !!draftPreviewUrl;
  const isBackendArtifact = BACKEND_ARTIFACT_TYPES.has(artifact?.type);
  /* An .xlsx, .docx, .pptx or .pdf file with a renderer is read-only here:
     no editable source, no comments and no agent repair. It previews in the
     sandboxed document frame only where canPreviewDocument says this shell
     may mount that frame. */
  const documentType = documentPreviewType(artifact);
  const showDocumentPreview = !!documentType && canPreviewDocument(artifact, host);
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
  // Fetched draft HTML rendered via the iframe's `srcdoc` instead of `src=`
  // — set only by the draft-preview branch below (see
  // docs/artifact-collaboration-workflow/task-org-draft-preview-401.md).
  // Kept separate from `previewUrl` (always exactly one of the two is
  // non-empty) rather than merged into one variant type: every existing
  // `src=`-based preview path — proxy, locally-mounted static — is untouched
  // by that fix and keeps reading `previewUrl` exactly as before.
  const [previewDoc, setPreviewDoc] = useState('');
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
  // "Open in a browser tab" failures: shown beside the preview, never in its
  // place, and cleared when another artifact opens.
  const [tabError, setTabError] = useState('');
  useEffect(() => { setTabError(''); }, [open, artifact?.id]);
  // The preview's signed link has expired: pages and files the draft loads
  // from now on are refused until a reload asks for a new link.
  const [draftLinkExpired, setDraftLinkExpired] = useState(false);
  const [backendPort, setBackendPort] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  // Manual-reload counter — bumped by the link-pill reload button to
  // force a fresh mount/fetch even when the artifact's mtime is unchanged.
  const [reloadNonce, setReloadNonce] = useState(0);
  const liveAppView = liveApps && isBackendArtifact;
  const liveAppRead = useLiveApp(artifact, { enabled: open && liveAppView, refreshKey: reloadNonce });
  const liveAppNotice = liveAppViewerNotice(liveAppRead);
  const liveAppAddress = liveAppNotice?.address || '';
  // Comments chrome state. The top bar owns ONE switch (commentsOpen) that
  // shows/hides the floating comments toolbar; the toolbar owns the rest —
  // comment-placement mode, marker visibility, leaving.
  const [commentsOpen, setCommentsOpen] = useState(false);
  // The docked side panel: the comments inbox or Stats, never both.
  const [sidePanel, setSidePanel] = useState(null);
  const inboxOpen = sidePanel === 'comments';
  // The inbox controls keep their boolean interface. Opening the inbox
  // replaces Stats; closing it leaves Stats alone.
  const sidePanelRef = useRef(sidePanel);
  sidePanelRef.current = sidePanel;
  const setLayerRef = useRef(null);
  const setInboxOpen = useCallback((next) => {
    const value = typeof next === 'function' ? next(sidePanelRef.current === 'comments') : next;
    // The inbox takes the slot from Stats, so the Stats layer goes off too.
    if (value) setLayerRef.current?.('stats', false);
    setSidePanel((current) => {
      if (value) return 'comments';
      return current === 'comments' ? null : current;
    });
  }, []);
  const [markersShown, setMarkersShown] = useState(true);
  const [repairBusy, setRepairBusy] = useState(false);
  const [textSelection, setTextSelection] = useState(null);
  const [feedbackNotice, setFeedbackNotice] = useState('');
  // Dismissed per repair, not per open: a suggestion the artifact has moved
  // past is worth mentioning once, not on every visit to the artifact.
  const [dismissedRepairId, setDismissedRepairId] = useState('');
  // Rendered twice: inline in the repair notice, and as the discard dialog's
  // error, so a failure is visible whether or not that dialog is open.
  const [repairNoticeError, setRepairNoticeError] = useState('');
  // The repair the create guard named, so the refusal can offer a way out
  // instead of stating a fact the user cannot act on.
  const [blockedBy, setBlockedBy] = useState(null);
  const [pendingDiscard, setPendingDiscard] = useState(null);
  // The CLOSE_PROMPTS entry showing before a close drops Edit text, or null.
  const [closePrompt, setClosePrompt] = useState(null);
  // Per-open counter used as a cache-buster fallback for artifacts whose
  // object carries no `mtime` (e.g. chat-bubble previews built from stream
  // steps). Increments only when there's no mtime, so every (re)open of
  // such an artifact fetches fresh content (ENG-375).
  const openNonceRef = useRef(0);
  const textContentRef = useRef(null);

  // Publish/access state machine — the single source of truth for the
  // <PublishMenu> popover and the link-pill's published-URL display.
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
  const [closedShareRequest, setClosedShareRequest] = useState(null);
  const panelEntry = shareRequest && closedShareRequest !== shareRequest ? shareEntry : 'viewer';
  const pub = usePublish(artifact, { onChange: reportChange, enabled: open, entry: panelEntry });
  const workspace = useArtifactWorkspace(artifact, {
    open,
    onChange: reportChange,
    previewOnly: !!documentType,
  });
  // The viewer's layers over its one preview (ENG-4227): Live edit (the
  // editor), Comments and Stats, each a tab on the panel rail with its own
  // side panel; Live edit and Comments are remembered on this device.
  const { layers, setLayer, restoreLayers } = useViewerLayers();
  setLayerRef.current = setLayer;
  // Comments asked for from outside: on for this open only, not remembered.
  // Closing puts the remembered layers back for the next open.
  useEffect(() => {
    if (open && commentsRequest) setLayer('comments', true, { remember: false });
  }, [open, commentsRequest, setLayer]);
  useEffect(() => {
    if (!open) restoreLayers();
  }, [open, restoreLayers]);
  const sidePanelId = useId();
  const { layout, toggle: toggleLayout, modalProps } = useViewerModal(open);
  // The bar takes the caret when the viewer opens (QuickEditBar), once per open.
  const [barFocusRequest, setBarFocusRequest] = useState(0);
  const barFocusUsed = useRef(0);
  useEffect(() => { if (open) setBarFocusRequest((n) => n + 1); }, [open, artifact?.id]);
  const [sourceOffPrompt, setSourceOffPrompt] = useState(false);
  // Fallback target for a repair: a brand-new chat. Used when the viewer has no
  // host chat (opened from the artifacts list) and the host either offers no
  // resolver or can't reach the chat that created the artifact.
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
  /* Hides the unsaved-edit prompt when the host closes the viewer or switches
     the artifact, since the workspace resets that draft on the same change. */
  useEffect(() => {
    setClosePrompt(null);
  }, [open, artifact?.id]);

  const notifyUnreadFeedback = useCallback(() => {
    setFeedbackNotice(t('viewer.newFeedback'));
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
  const commentsEnabled = !documentType && !!artifactKey && (
    workspace.commentsReady
    || (!!pub.publishedUrl && pub.accessMode === 'restricted')
  );
  // Injecting the inert marker bridge only needs the stable comment identity;
  // it does not need to wait for the comments transport to finish provisioning.
  // Waiting used to remount the whole HTML artifact as commentsReady flipped.
  const commentLayerRequested = !documentType && !!artifactKey;
  // Read by the load effect below rather than listed as its dependency. The key
  // can arrive from the status refresh after the preview painted — late on a
  // slow connection — and swapping `src` then reloads the page the user is
  // looking at just to add an inert bridge (ENG-3070).
  const commentLayerRequestedRef = useRef(commentLayerRequested);
  commentLayerRequestedRef.current = commentLayerRequested;
  // Whether the mounted preview was loaded with the bridge.
  const commentLayerMountedRef = useRef(false);
  // Where the editor was when Live edit went off, for a comment-layer reload
  // that follows to land there too.
  const leftEditorViewRef = useRef(null);
  const _akParts = artifactKey.split('/');
  const commentUserDir = _akParts[0] || '';
  const commentReportId = _akParts.slice(1).join('/') || '';

  // Iframe handle + shared comments state. One `useArtifactComments` instance
  // backs BOTH the inbox panel and the on-artifact marker layer (injected by
  // cowork-server) — `useArtifactCommentLayer` bridges to that layer over
  // postMessage. Both stay dormant when comments are disabled.
  const iframeRef = useRef(null);
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
  // Where the user is in the preview, so Edit opens on the same slide. Same
  // gate and reset as the diagnostics above, for the same reasons.
  // A reload the viewer makes after a change keeps the place
  // (`keepPlace`, below): the preview goes back to the same slide.
  const previewView = usePreviewView(iframeRef, {
    enabled: open && !!(previewUrl || previewDoc),
    resetKey: previewUrl || previewDoc,
    scopeKey: open ? `${artifact?.id || ''}:${artifact?.path || ''}` : '',
  });
  // A page cut off in the frame with nothing to scroll is fitted to it.
  const previewFit = usePreviewFit(iframeRef, {
    enabled: open && !!(previewUrl || previewDoc),
    resetKey: previewUrl || previewDoc,
  });
  const comments = useArtifactComments(commentUserDir, commentReportId, {
    enabled: open && commentsEnabled,
    onUnread: workspace.capabilities?.role === 'owner' ? notifyUnreadFeedback : undefined,
  });

  // A short quote of the blocking thread, so the refusal names the comment the
  // user has to deal with rather than the artifact as a whole.
  const blockedComment = useMemo(() => {
    if (!blockedBy?.commentThreadId) return '';
    const thread = (comments.threads || [])
      .find((item) => item.id === blockedBy.commentThreadId);
    const text = (thread?.payload?.text || '').trim();
    return text.length > 60 ? `${text.slice(0, 60)}…` : text;
  }, [blockedBy?.commentThreadId, comments.threads]);

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
  // Comments and replies from a composer here or the on-artifact layer, with
  // their images (useCommentActions).
  const {
    create: createArtifactComment,
    reply: replyToComment,
    loadImage: readCommentImage,
  } = useCommentActions(artifact, comments, {
    revisionId: workspace.currentRevision?.id || null,
    onError: setErr,
  });
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
    // A live app's pane holds the app's own code and no comment layer, so no
    // frame there may drive comments.
    enabled: open && commentsEnabled && commentsOpen && !liveAppView,
    markersVisible: commentsOpen && markersShown,
    onCreate: createArtifactComment,
    onReply: replyToComment,
    onStatus: setCommentStatus,
    onEditThread: comments.editThread,
    onDeleteThread: comments.deleteThread,
    onEditReply: comments.editReply,
    onDeleteReply: comments.deleteReply,
    loadImage: readCommentImage,
  });

  // One switch for the whole comments chrome. Opening resets to the default
  // sub-state (markers on, no side panel); closing also drops the iframe out of
  // comment-placement mode so no pin cursor lingers on a "plain" preview.
  // Either way Stats closes, since it shares the docked slot.
  // Comments and Live edit are exclusive (useViewerLayers): Comments on turns
  // Live edit off, so unsaved editor text is asked about first, and Comments
  // opens once the user agrees to drop it.
  // The layer to turn on once the user agrees to drop unsaved Live edit text.
  const layerAfterSourceOffRef = useRef(null);
  // Comments opened from its tab starts in Comment mode, ready to place one,
  // not Navigate. Restored on open, it starts in Navigate as before.
  const commentModeOnOpenRef = useRef(false);
  const toggleComments = () => {
    const on = !(layers.comments && commentsEnabled);
    if (on && layers.source && workspace.dirty) {
      layerAfterSourceOffRef.current = 'comments';
      setSourceOffPrompt(true);
      return;
    }
    commentModeOnOpenRef.current = on;
    setLayer('comments', on);
  };

  // Stats is the third layer (ENG-4455): on, it turns Live edit and Comments
  // off (comment mode included, so no markers are drawn beside it), asking
  // first about unsaved Live edit text, as Comments does.
  const toggleStats = (on) => {
    if (on && layers.source && workspace.dirty) {
      layerAfterSourceOffRef.current = 'stats';
      setSourceOffPrompt(true);
      return;
    }
    setLayer('stats', on);
  };

  // The Comments layer drives the comments chrome. Turned on (or restored on
  // open, once comments are available) it opens with the inbox and markers;
  // turned off it leaves comment mode and closes the inbox.
  useEffect(() => {
    if (open && layers.comments && commentsEnabled) {
      setFeedbackNotice('');
      setMarkersShown(true);
      setCommentsOpen(true);
      setSidePanel('comments');
      if (commentModeOnOpenRef.current) {
        commentModeOnOpenRef.current = false;
        layer.enterModeWhenReady?.();
      }
      return;
    }
    commentModeOnOpenRef.current = false;
    layer.exitMode();
    setCommentsOpen(false);
    setSidePanel((current) => (current === 'comments' ? null : current));
    setTextSelection(null);
  }, [open, layers.comments, commentsEnabled, layer.exitMode, layer.enterModeWhenReady]);

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
    // With the "Ask for a change" bar, the comment is sent there as a message,
    // so its progress shows where every other change does, and comments sent
    // while one runs queue up behind it (ENG-4383).
    if (canQuickEdit && thread?.id) {
      if (quickEdit.runningThreadId === thread.id || quickEdit.queuedThreadIds.includes(thread.id)) return;
      const imageFiles = await threadImageFiles(thread, readCommentImage);
      // Not awaited: the bar shows the run, and the inbox follows it there.
      void quickEdit.send(commentFixMessage(thread), {
        images: imageFiles.map(imageAttachment),
        threadId: thread.id,
      });
      return;
    }
    if (!onAddressWithAgent || repairBusy) return;
    setRepairBusy(true);
    setErr('');
    try {
      // Settle the target chat BEFORE the repair record exists. cowork-server
      // finishes a queued handoff only in a turn whose conversation matches the
      // id stored on it, so a repair minted against one chat and run in another
      // would stay queued forever. Inside a chat that's this chat; from the
      // artifacts list the host resolves the chat that created the artifact and
      // falls back to a fresh one.
      const targetConversationId = conversationId
        || (resolveRepairConversation ? await resolveRepairConversation(artifact) : '')
        || repairConversationId;
      const requested = await workspace.addressWithAgent({
        thread,
        conversationId: targetConversationId,
        // Normalized, folded and capped by the hook; the server reads
        // message, file and line, caps again and owns the prompt's size.
        previewErrors: diagnostics.errors,
      });
      if (requested) {
        // The thread's images go with the prompt, which names them in order
        // (ENG-4410).
        const imageFiles = await threadImageFiles(thread, readCommentImage);
        // The repair is reviewed here, so the viewer stays open and follows
        // the turn (ENG-4560).
        const restoreAgentChat = followAgentChat(targetConversationId);
        let started;
        try {
          started = await onAddressWithAgent({
            artifact,
            prompt: requested.prompt,
            repair: requested.repair,
            conversationId: targetConversationId,
            attachments: imageFiles.map(imageAttachment),
            inBackground: true,
          });
        } catch (startError) {
          restoreAgentChat();
          try { await workspace.cancelRepair(requested.repair.id); } catch { /* keep original error */ }
          throw startError;
        }
        if (started === false) {
          restoreAgentChat();
          await workspace.cancelRepair(requested.repair.id);
          // `false` has several causes (no provider, a project this user can't
          // run, a chat deleted meanwhile), so the message names none of them.
          setErr(t('viewer.agentCouldNotStart'));
        }
      }
    } catch (requestError) {
      if (requestError?.status === 422 && requestError?.detail?.repairId) {
        setBlockedBy(requestError.detail);
      } else {
        setErr(requestError?.message || t('viewer.sendToAgentFailed'));
      }
    } finally {
      setRepairBusy(false);
    }
  };

  const captureTextSelection = () => {
    if (!commentsOpen || !commentsEnabled) return;
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

  /* A page previewed by URL (the desktop, and the web with draft links)
     shows in a frame this page can't read: sandboxed without same-origin
     access, and on the web on the draft host. Its HTML is read the way a
     text preview is, for the operator below: through the drafts route when
     the draft can carry the person's credential, else the desktop's file
     preview. Only once the operator first asks, so a page opened outside a
     call is read once, for its frame. */
  const readsPreviewSource = open && previewKind === 'static' && !!previewUrl
    && (draftPreviewUrl ? canFetchDraftWithCredentials(draftPreviewUrl, host.getApiOrigin()) : !host.isWeb);
  /* The page's HTML as read so far (`html`) and whether the read is still on
     its way (`reading`), for the page shown now: the first call starts the
     read. Null when the page needs none. */
  const previewSourceRef = useRef(null);
  useEffect(() => {
    previewSourceRef.current = null;
    if (!readsPreviewSource) return undefined;
    let cancelled = false;
    let source = null;
    const read = async () => (draftPreviewUrl ? loadArtifactDraftText(draftPreviewUrl) : previewArtifact(actionPath));
    previewSourceRef.current = () => {
      if (source) return source;
      source = { html: '', reading: true };
      read()
        .then((data) => {
          if (typeof data?.content === 'string') source.html = data.content;
        })
        .catch((error) => {
          // The operator then says no text of it can be read.
          if (!cancelled) diagnostic('renderer.cowork.components.artifact.ArtifactViewer', 'WARNING', 'artifact_screen_text_read_failed', error);
        })
        .finally(() => { source.reading = false; });
      return source;
    };
    return () => {
      cancelled = true;
      previewSourceRef.current = null;
    };
  }, [readsPreviewSource, previewUrl, draftPreviewUrl, actionPath]);

  /* What a voice call's operator reads of this artifact while it is open
     (lib/voice/screenArtifacts.js): its title, its type and the text it
     shows, read when the operator asks. */
  const onScreenRef = useRef(null);
  onScreenRef.current = { artifact, textPreview, previewDoc, textExt };
  useEffect(() => {
    if (!open || !artifact) return undefined;
    return showArtifactOnScreen(() => {
      const { artifact: shown, textPreview: text, previewDoc: doc, textExt: ext } = onScreenRef.current;
      if (!shown) return null;
      let visible = text?.content || '';
      if (!visible) {
        try { visible = iframeRef.current?.contentDocument?.body?.innerText || ''; } catch { visible = ''; }
      }
      if (!visible && doc) visible = htmlText(doc);
      const source = visible ? null : previewSourceRef.current?.();
      if (source) visible = htmlText(source.html);
      const type = shown.type || (ext || artifactExtension(shown.path || '')).replace(/^\./, '');
      return { title: shown.title || shown.path?.split('/').pop() || '', type, text: visible, reading: Boolean(source?.reading) };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, artifact?.path]);
  /*
   * With live apps on, a full-stack app shares through "Share with…" on its
   * card, and cowork-server refuses to publish one as a page, so the header
   * offers no page Share until it is published (it never is, unless that
   * happened before live apps were turned on).
   */
  const publishable = isPublishableArtifact(artifact) && !(liveApps && isBackendArtifact && !pub.publishedUrl);
  const canManage = workspace.capabilities
    ? workspace.capabilities.canEdit !== false
    : artifact?.capabilities
      ? artifact.capabilities.canEdit !== false
      : !orgMode;
  // Unlike canManage, a client-side guess must never override the card's
  // server-sent role: a guessed reviewer would hide "Another member" on the
  // user's own artifact, and a guessed owner would hide it on a colleague's.
  // Server-sent workspace capabilities win; otherwise the card's (ENG-2979).
  // The owner is named once MindsHub answers for `ownerUserId` (ENG-4455).
  const authorship = useArtifactAuthorship(
    (workspace.capabilitiesFromServer ? workspace.capabilities : null) ?? artifact?.capabilities,
  );

  // Stats are for the owner of a published artifact only.
  const statsAvailable = !!pub.publishedUrl && canManage;
  const statsOpen = open && statsAvailable && sidePanel === 'stats';
  const stats = useArtifactStats(artifact, { enabled: statsOpen });
  // The Stats layer drives the docked slot. It turns off when Stats stops
  // being available and with the viewer, so the next artifact does not open
  // and report it unasked. The comments inbox keeps its state across closes.
  useEffect(() => {
    if (open && layers.stats && statsAvailable) {
      layer.exitMode();
      setSidePanel('stats');
      return;
    }
    setSidePanel((current) => (current === 'stats' ? null : current));
    if (layers.stats) setLayer('stats', false);
  }, [open, layers.stats, statsAvailable, layer.exitMode, setLayer]);
  // One event per open and artifact, after its first successful load. The
  // viewer outlives an artifact switch, so the ref holds which artifact was
  // reported rather than a flag. The hook returns no data for an artifact it
  // has not loaded yet, so a switch never reports the previous numbers.
  const statsIdentity = artifactIdentity(artifact) || artifact?.id || '';
  const statsTrackedRef = useRef(null);
  useEffect(() => {
    if (!statsOpen) {
      statsTrackedRef.current = null;
      return;
    }
    if (statsTrackedRef.current === statsIdentity || !stats.data) return;
    statsTrackedRef.current = statsIdentity;
    trackArtifactStatsOpened({
      artifactId: statsIdentity,
      accessMode: pub.accessLoaded ? pub.accessMode : null,
      hasViews: (stats.data.total_views || 0) > 0,
    });
  }, [statsOpen, stats.data, statsIdentity, pub.accessLoaded, pub.accessMode]);

  // Image artifacts skip the HTML mount pipeline entirely (there's no server
  // dir to register for iframe serving) and load straight from the artifact's
  // serve URL — same CSP workaround as AttachmentThumbnail (fetch + blob:,
  // since a direct loopback <img src> is blocked). `withArtifactVersion` busts the
  // fetch on a content change or a manual reload, matching the iframe/text
  // cache-busting below. A Markdown document's own images key on the same
  // version (ArtifactViewerBody), so Reload fetches them again too.
  const contentVersion = `${artifact?.mtime ?? 0}.${reloadNonce}`;
  const isImage = isImageArtifact(artifact);
  const imageRawUrl = isImage ? artifactServeUrl(artifact) : '';
  const imageUrl = imageRawUrl
    ? withArtifactVersion(imageRawUrl, contentVersion)
    : '';
  const { src: imageSrc, failed: imageFailed } = useBlobImageSrc({ url: imageUrl || null });

  // Reset the painted flag whenever the mounted preview changes so the
  // placeholder reappears for the new content.
  useEffect(() => { setIframeReady(false); }, [previewUrl, previewDoc]);

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
      setErr(disabledReason || t('viewer.noLocalPath'));
      return;
    }
    setLoading(true);
    setErr('');
    setPreviewUrl('');
    setPreviewDoc('');
    setPreviewKind('');
    setBackendPort(null);
    setTextPreview(null);
    setDraftLinkExpired(false);
    let cancelled = false;
    const withCommentLayer = commentLayerRequestedRef.current;
    commentLayerMountedRef.current = withCommentLayer;
    if (isText) {
      const previewRequest = draftPreviewUrl
        ? loadArtifactDraftText(draftPreviewUrl, {
            // The same split the draft-HTML branch makes below, so a
            // data:/blob: or cross-origin draft renders here too instead of
            // failing only for text.
            withCredentials: canFetchDraftWithCredentials(draftPreviewUrl, host.getApiOrigin()),
            // Only the full body can be counted; the viewer gets the cut text.
            countRows: textExt === '.csv' ? countCsvRows : undefined,
          })
        : previewArtifact(actionPath);
      previewRequest
        .then((data) => {
          if (cancelled) return;
          if (!data || typeof data.content !== 'string') {
            throw new Error(t('viewer.noContent'));
          }
          setTextPreview({
            content: data.content,
            truncated: !!data.truncated,
            mime: data.mime || '',
            totalRows: Number.isInteger(data.total_rows) && data.total_rows >= 0 ? data.total_rows : null,
          });
        })
        .catch((e) => { if (!cancelled) setErr(draftPreviewErrorMessage(e)); })
        .finally(() => { if (!cancelled) setLoading(false); });
      return () => { cancelled = true; };
    }
    if (isImage) {
      // The `imageSrc` hook above does its own fetch keyed on `imageUrl`;
      // nothing to mount server-side for a plain image file.
      setLoading(false);
      return () => { cancelled = true; };
    }
    if (liveAppView) {
      // Nothing to mount here: LiveAppPanel shows a running app from its own
      // address, or the notice, never the serve route's backend-less copy.
      setLoading(false);
      return () => { cancelled = true; };
    }
    if (showDocumentPreview) {
      /* DocumentPreview fetches the file and renders it in its own frame. No
         preview URL or document is set and iframeRef stays unattached, so
         usePreviewDiagnostics and the comment bridge never see that frame. */
      setLoading(false);
      return () => { cancelled = true; };
    }
    // Cache-buster for the iframe so a content change (or just reopening /
    // a manual reload) fetches fresh content instead of the webview's
    // first-loaded copy. Prefer the server's content `mtime` — it changes
    // only on a real edit — and fold in the per-open nonce + manual-reload
    // counter so reopens and the reload button always re-fetch.
    // Workspace saves explicitly bump reloadNonce below. Keeping the initial
    // revision response out of this key prevents a just-painted iframe from
    // being thrown away merely because editing metadata finished loading.
    const baseVersion = artifact?.mtime || (openNonceRef.current += 1);
    const cacheVersion = `${baseVersion}.${reloadNonce}`;
    if (draftPreviewUrl && !isText && (!isBackendArtifact || !hasActionPath)) {
      const linkRef = draftLinkEnabled ? artifactWorkspaceRef(artifact) : null;
      if (linkRef) {
        // Navigate the frame to a fresh signed link on the draft host. The
        // document then carries that host's own CSP, so CDN scripts, web fonts
        // and remote images load as in a browser tab, and the sandbox below
        // still has no allow-same-origin. A new link on every open and reload:
        // each expires in 30 minutes, and then the viewer offers a reload.
        setPreviewKind('static');
        let expiry = null;
        createDraftLink(linkRef.projectRef, linkRef.artifactId)
          .then((link) => {
            if (cancelled) return;
            const linked = draftLinkUrl(link);
            setPreviewUrl(withCommentLayer
              ? withArtifactCommentFlag(withArtifactVersion(linked, cacheVersion))
              : withArtifactVersion(linked, cacheVersion));
            expiry = setTimeout(() => setDraftLinkExpired(true), draftLinkLifetimeMs(link.expiresAt));
          })
          .catch(async (e) => {
            if (cancelled) return;
            // Links off reruns this effect, which then takes the srcdoc path.
            if (await withdrawDraftLinks(e)) return;
            if (cancelled) return;
            setErr(draftPreviewErrorMessage(e, t('viewer.loadDraftFailed')));
          })
          .finally(() => { if (!cancelled) setLoading(false); });
        return () => {
          cancelled = true;
          clearTimeout(expiry);
        };
      }
      const rawUrl = isAbsoluteArtifactPreviewUrl(draftPreviewUrl)
        ? draftPreviewUrl
        : `${host.getApiOrigin()}${draftPreviewUrl}`;
      const fetchUrl = withCommentLayer
        ? withArtifactCommentFlag(withArtifactVersion(rawUrl, cacheVersion))
        : withArtifactVersion(rawUrl, cacheVersion);
      setPreviewKind('static');
      // Navigate the iframe unless fetch+srcdoc is the only way to carry a
      // credential. Navigation is the preferred path, not merely an
      // equivalent one: a `srcdoc` document inherits the shell's CSP, which
      // blocks the artifact's CDN scripts, web fonts and remote images — the
      // same file renders completely in a browser (ENG-2818).
      //
      // Three cases navigate, and only the third is about authorization —
      // hence `shouldNavigate` rather than a name claiming all three are
      // authorized, which the first two are not:
      //
      //  - Embedded (data:/blob:) content makes no network request at all, so
      //    there is nothing for a credential to protect.
      //  - A genuinely cross-origin absolute URL must never receive the web
      //    Keycloak bearer `authFetch` would attach (the old `src=`
      //    navigation never sent it either), so navigating is the only safe
      //    option rather than an authorized one.
      //  - Desktop against the local loopback, where the main process already
      //    injects the bearer into iframe navigations at the network layer,
      //    so the 401 below cannot occur. See draftNavigationIsAuthorized.
      const shouldNavigate =
        !canFetchDraftWithCredentials(rawUrl, host.getApiOrigin())
        || draftNavigationIsAuthorized(host.isElectron, host.isLocalApiOrigin());
      if (shouldNavigate) {
        setPreviewUrl(fetchUrl);
        setLoading(false);
        return () => { cancelled = true; };
      }
      // Org deployment: a plain iframe `src=` navigation cannot carry the
      // Authorization header the forward-auth ingress in front of the drafts
      // endpoint requires (the ingress `auth-url` reads only
      // `Authorization: Bearer`), so fetch through authFetch (like Edit's
      // source load) and hand the result to the iframe via srcdoc instead of
      // navigating it directly. This path pays the inherited-CSP cost above;
      // lifting it for Cloud needs an ingress change (ENG-2818).
      // previewUrl/previewDoc were both already reset to '' at the top of
      // this effect, so setting only one of them here is enough to keep them
      // mutually exclusive.
      const reading = new AbortController();
      loadArtifactDraftDocument(fetchUrl)
        .then(async (doc) => {
          if (cancelled) return;
          if (doc.isHtml) {
            // The files the draft loads from its folder can't carry the token
            // either, so inline them with it. The inliner never reads above the
            // draft's own folder, so that folder is its root. If inlining fails,
            // the draft still shows as it loaded. This branch is removed once
            // drafts are served by signed link; the inliner stays, because the
            // HTML editor and the revision comparison use it too.
            const html = await inlineHtmlFromApi(doc.content, {
              rootUrl: draftDirectoryUrl(fetchUrl),
              filePath: draftFileName(fetchUrl),
              signal: reading.signal,
              chatWorkspaces: false,
            }).catch(() => injectDraftBaseHref(doc.content, fetchUrl));
            if (cancelled) return;
            setPreviewDoc(limitArtifactFrames(html));
          } else {
            // Non-HTML draft content type: org mode's draft preview only ever
            // offers .html here (md/txt/csv already took the isText branch
            // above), so this is expected only on Desktop. The fetch above
            // already ran, so the iframe fetching fetchUrl again is a second
            // round-trip — acceptable on Desktop's local loopback server; on
            // web it degrades to the pre-fix behavior (the iframe navigation
            // may hit the same 401 this task fixes for HTML), which is no
            // worse than before this change.
            setPreviewUrl(fetchUrl);
          }
        })
        .catch((e) => {
          if (cancelled) return;
          setErr(draftPreviewErrorMessage(e, t('viewer.loadDraftFailed')));
        })
        .finally(() => { if (!cancelled) setLoading(false); });
      return () => { cancelled = true; reading.abort(); };
    }
    mountArtifactPreview(actionPath)
      .then(async ({ kind, url, artifactDir, port, proxyUrl, backendRunning, launchError }) => {
        if (kind === 'proxy') {
          if (!artifactDir) throw new Error(t('viewer.noArtifactDir'));
          if (backendRunning === false) {
            throw new Error(launchError || t('viewer.backendFailed'));
          }
          if (!proxyUrl) throw new Error(t('viewer.proxyUnavailable'));
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
          setPreviewUrl(withCommentLayer
            ? withArtifactCommentFlag(withArtifactVersion(iframeUrl, cacheVersion))
            : withArtifactVersion(iframeUrl, cacheVersion));
          if (typeof port === 'number') setBackendPort(port);
          return;
        }
        if (!url) throw new Error(t('viewer.noMountUrl'));
        if (cancelled) return;
        setPreviewKind('static');
        // Bake the inert comment bridge into the first URL whenever the card
        // has a stable identity. Transport readiness can then change without
        // swapping this cross-origin iframe's `src` or flashing the preview.
        setPreviewUrl(withCommentLayer
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
      .catch((e) => { if (!cancelled) setErr(e?.message || t('viewer.loadFailed')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, artifact?.path, artifact?.mtime, actionPath, hasPreviewSource, disabledReason, draftPreviewUrl, isText, textExt, isImage, liveAppView, showDocumentPreview, reloadNonce, draftLinkEnabled]);

  // Opening comments on a preview mounted before the key arrived is the one
  // time a reload is worth it: the user asked for the markers.
  useEffect(() => {
    if (!open || !commentsOpen || !commentLayerRequested) return;
    if (!(previewUrl || previewDoc) || commentLayerMountedRef.current) return;
    // The page comes back on the slide the user was commenting on, or the
    // one they were editing when they came from Live edit.
    previewView.keepPlace(leftEditorViewRef.current);
    leftEditorViewRef.current = null;
    setReloadNonce((n) => n + 1);
  }, [open, commentsOpen, commentLayerRequested, previewUrl, previewDoc, previewView.keepPlace]);

  // Parse CSV → GFM pipe table once per loaded text. We cap at
  // CSV_PREVIEW_ROW_LIMIT data rows to keep the markdown renderer
  // snappy on large files.
  const csvPreview = useMemo(() => {
    if (!isText || textExt !== '.csv' || !textPreview?.content) return null;
    return summarizeCsvPreview(textPreview.content, {
      truncated: textPreview.truncated,
      totalRows: textPreview.totalRows,
    });
  }, [isText, textExt, textPreview?.content, textPreview?.truncated, textPreview?.totalRows]);

  // Keep these callbacks above the early return: the viewer remains mounted
  // while `open` changes, so every render must execute the same hook sequence.
  const reloadPreview = useCallback(() => {
    if (!hasPreviewSource) return;
    setIframeReady(false);
    setReloadNonce((n) => n + 1);
  }, [hasPreviewSource]);

  // Keeping the place across a reload the viewer makes after a change
  // (ENG-4383): a save, a quick edit, an agent's change, the preview check,
  // the comment layer arriving. The preview goes back to the slide it was
  // on, or, with Live edit on, to the one the editor is on, since that is
  // where the user was working. The user's own Reload (the ⋯ menu) starts
  // the page over, as a reload in a browser would.
  const editorViewRef = useRef(null);
  const onEditorView = useCallback((view) => { editorViewRef.current = view; }, []);
  useEffect(() => { editorViewRef.current = null; }, [open, artifact?.id, artifact?.path]);
  const sourceOnRef = useRef(false);
  const { keepPlace, forgetPlace } = previewView;
  const keepPreviewPlace = useCallback(() => {
    keepPlace(sourceOnRef.current ? editorViewRef.current : null);
  }, [keepPlace]);
  const reloadKeepingPlace = useCallback(() => {
    keepPreviewPlace();
    reloadPreview();
  }, [keepPreviewPlace, reloadPreview]);
  const onReload = useCallback(() => {
    forgetPlace();
    reloadPreview();
  }, [forgetPlace, reloadPreview]);
  // Content that changed elsewhere (the host reports a new mtime) reloads
  // the preview through its new version: that keeps the place too.
  const mtimeRef = useRef({ key: '', mtime: null });
  useEffect(() => {
    const key = `${artifact?.id || ''}:${artifact?.path || ''}`;
    const mtime = artifact?.mtime ?? null;
    const previous = mtimeRef.current;
    mtimeRef.current = { key, mtime };
    if (open && previous.key === key && previous.mtime !== null && mtime !== previous.mtime) keepPreviewPlace();
  }, [open, artifact?.id, artifact?.path, artifact?.mtime, keepPreviewPlace]);

  const saveWorkspace = useCallback(async (...args) => {
    const saved = await workspace.save(...args);
    if (saved) reloadKeepingPlace();
    return saved;
  }, [reloadKeepingPlace, workspace.save]);

  // The agent's preview check (ENG-4207): while this viewer shows an iframe
  // preview, a check for its slug reloads it here and reports what it saw.
  // Not gated on previewUrl/previewDoc: a reload clears both for a moment,
  // and the check must not lose its viewer to its own reload. Live apps,
  // documents, images and text have no diagnostics to report, so a check for
  // them answers "unavailable".
  const framedPreview = open && hasPreviewSource && !isImage && !isText && !showDocumentPreview && !liveAppView;
  // A quick edit's reloads (its preview check, the applied edit, its Undo)
  // cover the preview while it reloads instead of flashing it blank
  // (usePreviewReloadTransition). Other reloads stay as they were.
  const previewReload = usePreviewReloadTransition({
    enabled: framedPreview,
    iframeReady,
    hold: previewView.whenRestored,
  });
  const reloadPreviewSmoothly = useCallback(() => {
    void previewReload.reload(reloadKeepingPlace);
  }, [reloadKeepingPlace, previewReload.reload]);
  usePreviewCheckTarget({
    slug: artifact?.slug || artifactFolder.split(/[\\/]/).filter(Boolean).pop() || '',
    enabled: framedPreview,
    reload: reloadPreviewSmoothly,
    iframeReady,
    errors: diagnostics.errors,
  });

  // The chat the viewer sits in, when it does: the bar mirrors the agent's
  // reply to a message it handed to that chat from the same task state the
  // transcript renders (no second stream). Another chat's messages are not it.
  const inChatTranscript = useChatTranscript();
  // Outside a chat (the Artifacts page) the viewer stays open when it hands a
  // message to the artifact's chat, and follows that chat's transcript from
  // the app's task state instead (ENG-4560).
  const [agentChatId, setAgentChatId] = useState(null);
  useEffect(() => { setAgentChatId(null); }, [open, artifact?.id]);
  const agentChatIdRef = useRef(agentChatId);
  agentChatIdRef.current = agentChatId;
  const handedOffTranscript = useConversationTranscript(inChatTranscript ? null : agentChatId);
  const transcripts = useConversationTranscripts();
  const transcriptsRef = useRef(transcripts);
  transcriptsRef.current = transcripts;
  // Follow chat `id` from here on; the returned function puts back the one
  // followed before, for a send that did not start.
  const followAgentChat = (id) => {
    if (inChatTranscript || !id) return () => {};
    const before = agentChatIdRef.current;
    agentChatIdRef.current = String(id);
    setAgentChatId(String(id));
    return () => {
      agentChatIdRef.current = before;
      setAgentChatId(before);
    };
  };
  const chatTranscript = inChatTranscript || handedOffTranscript;
  const chatMessages = chatTranscript
    && (!conversationId || String(chatTranscript.conversationId || '') === String(conversationId))
    ? chatTranscript.messages
    : null;

  // A turn in this chat may change the artifact (a bar message the agent took
  // over, or any other turn). When one ends, ask for the head revision once:
  // if it moved since the turn began, show the new content (behind the reload
  // cover) and refresh the revision line, or, over unsaved editor text, say
  // so instead of reloading. The signal is the chat's own live row, so
  // nothing polls.
  const chatLive = !!chatMessages?.some((m) => m?.role === '_streaming');
  const [changedElsewhere, setChangedElsewhere] = useState(false);
  useEffect(() => { setChangedElsewhere(false); }, [open, artifact?.id]);
  const turnWatchRef = useRef({ live: false, startHead: null });
  // A change to a published artifact from the bar is reviewed before it goes
  // live (ENG-4409): the comparison opens with Publish this change, Keep as
  // draft and, for a direct edit, Undo. Desktop only: MindsHub mode
  // autopublishes, and has no Update to offer.
  const reviewsPublish = !!pub.publishedUrl && !pub.orgMode && canManage && publishable && hasActionPath;
  // The bar handed a message to this chat, so the turn that ends next is the
  // one that made its change.
  const handedOffRef = useRef(false);
  useEffect(() => { handedOffRef.current = false; }, [open, artifact?.id]);
  const latestRef = useRef({});
  latestRef.current = { workspace, artifact, pub, reviewsPublish };
  useEffect(() => {
    const watch = turnWatchRef.current;
    if (!open) {
      watch.live = chatLive;
      return;
    }
    if (chatLive && !watch.live) watch.startHead = workspace.currentRevision?.id || null;
    if (!chatLive && watch.live) {
      const startHead = watch.startHead;
      const handedOff = handedOffRef.current;
      handedOffRef.current = false;
      void (async () => {
        let head = null;
        try {
          const { workspace: ws, artifact: card } = latestRef.current;
          const data = await loadArtifactRevisions(card, ws.source?.path || null);
          head = data?.revisions?.[0]?.id || null;
        } catch {
          return;
        }
        const { workspace: ws, artifact: card } = latestRef.current;
        // Unchanged, or already shown (an applied quick edit refreshed it).
        if (!head || head === startHead || head === (ws.currentRevision?.id || null)) return;
        if (ws.dirty) {
          setChangedElsewhere(true);
          return;
        }
        void previewReload.reload(() => {
          reloadKeepingPlace();
          reportChange({ ...card, mtime: Date.now() / 1000 });
        });
        try { await ws.load(); } catch { /* the preview shows the change either way */ }
        const { pub: publication, reviewsPublish: reviews } = latestRef.current;
        if (handedOff && reviews && startHead) {
          void publication.refresh?.();
          await ws.reviewPublish?.(startHead, head);
        }
      })();
    }
    watch.live = chatLive;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatLive, open]);
  const reloadChangedElsewhere = () => {
    setChangedElsewhere(false);
    void previewReload.reload(() => {
      reloadKeepingPlace();
      reportChange({ ...artifact, mtime: Date.now() / 1000 });
    });
    void workspace.load().catch(() => {});
  };
  // The bar's model and effort, picked with the composer's own picker and
  // catalog. Effort null is "no pick": medium where the model offers it.
  const modelPicker = useModelPickerContext();
  const [barModel, setBarModel] = useState(MODEL_ROUTER);
  const [barEffort, setBarEffort] = useState(null);

  // Quick edits (ENG-4227): offered in Preview to whoever can edit, when the
  // server turned them on. A file the viewer only previews has nothing to edit.
  const canQuickEdit = workspace.capabilities?.canQuickEdit === true
    && workspace.capabilities?.canEdit !== false
    && !documentType;
  // The chat the artifact belongs to, chosen the way a comment repair chooses
  // it: this chat, else the one that made the artifact.
  const resolveArtifactConversation = async () => conversationId
    || (resolveRepairConversation ? await resolveRepairConversation(artifact) : '')
    || '';
  // Comments the bar resolved by applying their fix, so an Undo reopens them.
  const resolvedByEditRef = useRef(new Set());
  const quickEdit = useQuickEdit(artifact, {
    enabled: open && canQuickEdit,
    // Without a decisions model every message goes to the chat. An older
    // server that sends no flag edits directly, as it did before the flag.
    direct: workspace.capabilities?.quickEditDirect !== false,
    headRevisionId: workspace.currentRevision?.id || null,
    resolveConversation: async () => (await resolveArtifactConversation()) || null,
    // Same send the comment repair uses, with a fresh chat as the last resort.
    // Outside a chat the turn runs in that chat without leaving this page.
    continueInChat: async (prompt, images = [], { recount } = {}) => {
      if (!onAddressWithAgent) return false;
      const target = (await resolveArtifactConversation()) || repairConversationId;
      // The chat followed until now may not be this one: count the prompt's
      // earlier copies in the chat it goes to.
      if (!inChatTranscript && target) {
        recount?.(countUserPrompts(transcriptsRef.current?.(target)?.messages, prompt));
      }
      const restoreAgentChat = followAgentChat(target);
      handedOffRef.current = true;
      let started = false;
      try {
        started = await onAddressWithAgent({
          artifact, prompt, conversationId: target, attachments: images, inBackground: true,
        });
      } finally {
        if (started === false) {
          handedOffRef.current = false;
          restoreAgentChat();
        }
      }
      return started !== false;
    },
    countInChat: (prompt) => countUserPrompts(chatMessages, prompt),
    picks: () => {
      const { model, reasoningEffort } = sendablePicks(
        barModel?.id,
        pickedEffort({ model: barModel, effort: barEffort, modelMeta: modelPicker?.modelMeta }),
      );
      return { model, reasoningEffort };
    },
    // As after a Source save: the host hears of the new content (its card
    // and any URL it derives), and the preview reloads in the same render.
    onApplied: async ({ previewFresh = false, edit = null } = {}) => {
      // The server keeps the edit (or its undo) in the chat's quick-edit card;
      // the open chat fetches it again to show it.
      if (conversationId) requestConversationRefresh(conversationId);
      const loading = workspace.load().catch(() => { /* the preview shows the change either way */ });
      // The edit's own preview check already reloaded the preview after its
      // last write: a second reload would only flash the same page.
      if (!previewFresh) {
        // As after a Source save: the host hears of the new content and the
        // preview reloads, in one render, behind the reload cover. Not
        // awaited: the bar is free again while the cover fades.
        void previewReload.reload(() => {
          reloadKeepingPlace();
          reportChange({ ...artifact, mtime: Date.now() / 1000 });
        });
      }
      await loading;
      if (!reviewsPublish) return;
      // The draft is now ahead of the published page (or, after an undo, may
      // be level with it again): the Share control learns which.
      void pub.refresh();
      if (edit?.previousRevisionId && edit.revisionId) {
        await workspace.reviewPublish?.(edit.previousRevisionId, edit.revisionId, { replyId: edit.replyId });
      }
    },
    onStale: () => { void workspace.load(); },
    // A comment sent to the bar (Address with agent) is resolved once the
    // edit made for it is applied, as the agent's repair resolved it, and
    // opened again if that edit is undone. Only a comment still open is
    // resolved, and only one resolved this way is reopened.
    onThreadAddressed: (threadId) => {
      const thread = comments.threads.find((item) => item.id === threadId);
      if (!thread || thread.status === 'resolved' || thread.status === 'dismissed') return;
      resolvedByEditRef.current.add(threadId);
      void setCommentStatus(threadId, 'resolved');
    },
    onThreadReopened: (threadId) => {
      if (!resolvedByEditRef.current.delete(threadId)) return;
      // Dismissed or reopened by hand since: the person's choice stands.
      const thread = comments.threads.find((item) => item.id === threadId);
      if (thread?.status !== 'resolved') return;
      void setCommentStatus(threadId, 'open');
    },
  });

  // The publish review's choices (ENG-4409). Publish this change re-publishes
  // the draft to the same link with the same access (usePublish update), then
  // says "Published" for a moment. Keep as draft closes it, leaving the
  // header's "Unshared changes" and the Share panel's Update. Undo is the
  // bar's own, offered while that edit is still the one to undo.
  const [publishReviewFailed, setPublishReviewFailed] = useState(false);
  const [changePublished, setChangePublished] = useState(false);
  const reviewingPublish = workspace.comparison?.kind === 'publish';
  useEffect(() => { setPublishReviewFailed(false); }, [workspace.comparison]);
  useEffect(() => { setChangePublished(false); }, [open, artifact?.id]);
  useEffect(() => {
    if (!changePublished) return undefined;
    const timer = setTimeout(() => setChangePublished(false), PUBLISHED_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [changePublished]);
  const reviewReplyId = reviewingPublish ? workspace.comparison.review?.replyId || null : null;
  const reviewReply = reviewReplyId ? quickEdit.messages.find((m) => m.id === reviewReplyId) : null;
  const publishReview = reviewingPublish ? {
    busy: pub.phase === 'updating' || !!reviewReply?.undoing,
    error: (publishReviewFailed && pub.error) || reviewReply?.undoError || '',
    onPublish: async () => {
      setPublishReviewFailed(false);
      if (await pub.update()) {
        workspace.setComparison(null);
        setChangePublished(true);
      } else {
        setPublishReviewFailed(true);
      }
    },
    onKeepDraft: () => {
      workspace.setComparison(null);
      void pub.refresh();
    },
    onUndo: reviewReplyId && quickEdit.undoableId === reviewReplyId && !quickEdit.running
      ? async () => {
        if (await quickEdit.undo(reviewReplyId)) workspace.setComparison(null);
      }
      : undefined,
  } : null;

  // Changes not shared yet (ENG-4595): the draft has moved past the live
  // page. Opening the artifact shows them against the shared version, with
  // Publish changes and Keep as draft, once per open; the header's "Unshared
  // changes" opens the same review again. The shared version is the one the
  // workspace load names (`publishedRevision`).
  const unsharedFrom = workspace.publishedRevision?.id || null;
  const unsharedTo = workspace.currentRevision?.id || null;
  const canReviewUnshared = open && canManage && publishable && !!pub.publishedUrl && !!pub.modified
    && !!unsharedFrom && !!unsharedTo && unsharedFrom !== unsharedTo;
  const reviewUnshared = useCallback(() => {
    if (!canReviewUnshared || workspace.comparison) return;
    void workspace.reviewPublish(unsharedFrom, unsharedTo, { unshared: true });
  }, [canReviewUnshared, unsharedFrom, unsharedTo, workspace]);
  // The artifact whose review has shown this open: once per open, so keeping
  // the draft (or a quick edit's own review) never brings it back by itself.
  const unsharedShownRef = useRef('');
  const unsharedKey = open ? (artifactIdentity(artifact) || artifact?.path || '') : '';
  useEffect(() => {
    if (!unsharedKey) unsharedShownRef.current = '';
  }, [unsharedKey]);
  useEffect(() => {
    if (!canReviewUnshared || !unsharedKey || unsharedShownRef.current === unsharedKey) return;
    // Not over something already on screen, a running edit or unsaved text.
    if (workspace.comparison || quickEdit.running || workspace.dirty) return;
    unsharedShownRef.current = unsharedKey;
    reviewUnshared();
  }, [canReviewUnshared, unsharedKey, workspace.comparison, workspace.dirty, quickEdit.running, reviewUnshared]);

  // Live edit (`source`): the code editor, in the preview's place at any
  // width. Turning it off with unsaved text asks first.
  const canSource = !!workspace.source && workspace.capabilities?.canEdit !== false;
  const sourceOn = layers.source && canSource;
  sourceOnRef.current = sourceOn;
  // Leaving Live edit for Comments, Stats or the plain preview (ENG-4455):
  // the preview goes to where the editor was, so the user stays on the slide
  // they were working on. The preview can only take a place as it loads, so
  // it reloads behind the cover, unless the comment layer is about to reload
  // it anyway, which then lands there. Nothing reloads when the editor is
  // where the preview already is.
  const wasSourceOnRef = useRef(sourceOn);
  useEffect(() => {
    const was = wasSourceOnRef.current;
    wasSourceOnRef.current = sourceOn;
    if (!was || sourceOn || !open || !framedPreview) return;
    const view = editorViewRef.current;
    if (!view) return;
    const editorAt = JSON.stringify(normalizePreviewView({ ...view, type: 'view' }));
    if (editorAt === JSON.stringify(previewView.view)) return;
    if (layers.comments && commentLayerRequested && !commentLayerMountedRef.current) {
      leftEditorViewRef.current = view;
      return;
    }
    // Comments asked for Comment mode on the page this reload replaces.
    const commentMode = layers.comments;
    void previewReload.reload(() => {
      if (commentMode) layer.enterModeOnNextLoad?.();
      keepPlace(view);
      reloadPreview();
    });
  // Only on Live edit going off; the rest is read as it is then.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceOn]);
  const setSourceLayer = (on) => {
    if (!on && workspace.dirty) {
      setSourceOffPrompt(true);
      return;
    }
    setLayer('source', on);
  };
  // `workspace.mode` and `setMode`, for the callers that still speak modes:
  // 'edit' is Source on, 'review' Comments on, 'preview' neither.
  const viewerMode = sourceOn ? 'edit' : (commentsOpen ? 'review' : 'preview');
  const setViewerMode = (mode) => {
    if (mode === 'edit') setLayer('source', true);
    else if (mode === 'review') setLayer('comments', true);
    else {
      setSourceLayer(false);
      setLayer('comments', false);
    }
  };
  const workspaceView = { ...workspace, mode: viewerMode, setMode: setViewerMode };

  /* Closing resets the workspace, which drops Edit text that was never saved,
     so the Close button, Esc and the backdrop ask first while there is some.
     The text stays unsaved until a save's reply arrives, so a close during a
     save asks too, with the prompt for a save in flight. `then` runs once the
     viewer has closed (Open chat's way out), so not if the person stays. */
  const closeThen = (then) => {
    if (workspace.dirty) {
      setClosePrompt({ key: workspace.status === 'saving' ? CLOSE_PROMPTS.saving : CLOSE_PROMPTS.unsaved, then });
      return;
    }
    onClose?.();
    then?.();
  };
  // Modal hands its own argument to onClose; a plain close runs nothing after.
  const requestClose = () => closeThen(null);
  // The rail's Open chat: the chat this artifact was made in.
  const openChatAction = useOriginChatAction({ artifact, open, conversationId, close: closeThen });

  if (!open || !artifact) return null;

  const title = artifact.title || artifact.path?.split('/').pop();
  const isPublished = !!pub.publishedUrl;

  // Open the local file only when the file is actually on this machine
  // (Electron + loopback server). When the desktop app points at a REMOTE
  // server, or in web, the path is on the server box, so we fall back to
  // the HTTP serve/published URL.
  const canOpenLocalFile = host.isElectron && host.isLocalApiOrigin();

  // Open the artifact's containing folder in the OS file manager.
  const onOpenFolder = async () => {
    if (!canOpenLocalFile) return;
    try {
      const res = await host.openPath(artifactFolder || actionPath);
      if (res && res.ok === false) setErr(res.reason || t('viewer.openFolderFailed'));
    } catch (e) {
      setErr(e?.message || t('viewer.openFolderFailed'));
    }
  };

  // Open the local file / served preview (HTML → default browser, other
  // types → their default app). Handles backend artifacts + the web shell.
  const onOpenOS = async () => {
    if (isBackendArtifact && canOpenLocalFile) {
      if (!backendPort) {
        setErr(t('viewer.portNotReady'));
        return;
      }
      try { await host.openExternal(`http://127.0.0.1:${backendPort}`); }
      catch (e) { setErr(e?.message || t('viewer.openFailed')); }
      return;
    }
    if (!canOpenLocalFile) {
      const rel = artifact?.serveUrl || '';
      const url = rel
        ? (rel.startsWith('http') ? rel : `${host.getApiOrigin()}${rel}`)
        : (pub.publishedUrl || '');
      if (url) {
        try { await host.openExternal(url); }
        catch (e) { setErr(e?.message || t('viewer.openFailed')); }
        return;
      }
      setErr(t('viewer.remoteNoUrl'));
      return;
    }
    if (!hasActionPath) {
      setErr(disabledReason || t('viewer.noLocalPath'));
      return;
    }
    try {
      const result = await host.openPath(actionPath);
      if (result && result.ok === false) throw new Error(result.reason || t('viewer.openArtifactFailed'));
    } catch (e) {
      setErr(e?.message || t('viewer.openFailed'));
    }
  };

  // A running live app's own address; the controls that call this show only
  // while there is one.
  const onOpenLiveApp = async () => {
    try { await host.openExternal(liveAppAddress); }
    catch (e) { setErr(e?.message || t('viewer.openFailed')); }
  };

  // Launch asks the agent in a chat of the app's project, which launches it
  // behind the usual card; the viewer closes so the chat shows.
  const onLaunchLiveApp = async () => {
    try {
      const started = await onAddressWithAgent({ artifact, prompt: launchLiveAppPrompt(artifact), conversationId });
      if (started === false) setErr(t('viewer.agentCouldNotLaunch'));
      else onClose?.();
    } catch (e) {
      setErr(e?.message || t('viewer.askLaunchFailed'));
    }
  };

  // "Open this artifact in a browser tab", for the control beside the mode
  // tabs, which org mode keeps too. No raw window.open fallback:
  // host.openExternal is what restricts the agent-writable URL to
  // http(s)/mailto, so a failure is reported instead of bypassing it.
  //
  // Preference order: the published URL is what the artifact *is* and what a
  // person would share; the served URL is desktop's local HTTP view; the
  // authenticated draft URL is org mode's route to an artifact nobody has
  // published yet. A live app has one address, where it runs; a copy of its
  // page anywhere else has no backend.
  const browserTabTarget = liveAppView
    ? liveAppAddress
    : pub.publishedUrl || artifact?.serveUrl || draftPreviewUrl || '';
  // ...but only `publishedUrl` carries its own origin; the server returns
  // `serveUrl` and `draftUrl` origin-relative. Web tolerates that because
  // `window.open` resolves against the page, and desktop no longer reaches
  // here with a relative value at all (see `onOpenInBrowserTab` below).
  // Absolutized anyway, through the same helper the draft-preview path above
  // uses, so the value means one thing on both shells: a relative URL handed
  // to `shell.openExternal` opens nothing and reports success (ENG-2847).
  const browserTabUrl = !browserTabTarget || isAbsoluteArtifactPreviewUrl(browserTabTarget)
    ? browserTabTarget
    : `${host.getApiOrigin()}${browserTabTarget}`;

  // Org web, unpublished: the authenticated draft URL cannot open in a tab (the
  // tab carries no bearer), so open a fresh signed link instead, in a tab
  // opened inside the click (host.openPendingTab), where popup blockers allow
  // it. A failure is shown next to the preview, never in its place, and only
  // while the same artifact is open.
  const openDraftLinkInTab = async (ref) => {
    const clicked = artifact;
    setTabError('');
    const tab = host.openPendingTab();
    if (!tab) {
      setTabError(t('viewer.popupBlocked'));
      return;
    }
    try {
      const url = draftLinkUrl(await createDraftLink(ref.projectRef, ref.artifactId));
      if (!tab.navigate(url)) throw new RefusedDraftLink();
    } catch (e) {
      tab.close();
      await withdrawDraftLinks(e);
      if (openRef.current && isSameArtifact(artifactRef.current, clicked)) {
        setTabError(draftPreviewErrorMessage(e, t('viewer.openInBrowserFailed')));
      }
    }
  };

  // An unpublished draft the preview opens by link opens by link in a tab
  // too. A live app opens where it runs, a backend artifact with an action
  // path previews through its own runtime, and a card without a full identity
  // cannot ask for a link: these keep the old route. So do text, images and
  // Office and PDF files, whose own previews set their tab rules.
  const draftLinkRef = !isPublished && !liveAppView && draftLinkEnabled
    && !isText && !isImage && !documentType && !(isBackendArtifact && hasActionPath)
    ? artifactWorkspaceRef(artifact)
    : null;

  // On desktop an unpublished artifact CANNOT be opened over the served URL,
  // however well-formed it is: the loopback server requires a bearer token
  // (`require_auth` defaults on in local tenancy), and main injects that token
  // into this window's own session only (`app.ts` webRequest). shell.openExternal
  // launches a separate browser process, which carries no such header and gets
  // 401. The local file needs no credential, so hand it to the OS instead —
  // the same route the header's Open button takes. `onOpenOS` already owns
  // the fullstack-backend and missing-path cases, so delegate rather than
  // restate them.
  //
  // Published stays on openExternal: that URL is public, absolute, and the
  // thing a person actually wants a tab of. Org/web has no local file, so it
  // stays on the URL too.
  //
  // NOT `draftNavigationIsAuthorized` (ENG-2818), despite the matching shape:
  // that answers whether a navigation *inside this window* is authorized, and
  // it is true here — main's header injection covers the app's own requests.
  // This control leaves the window entirely, which is the one case that
  // injection does not reach.
  const onOpenInBrowserTab = () => {
    if (!isPublished && canOpenLocalFile && !liveAppView) return onOpenOS();
    if (draftLinkRef) return openDraftLinkInTab(draftLinkRef);
    if (!browserTabUrl) return;
    host.openExternal(browserTabUrl).catch(() => {
      setErr(t('viewer.openInBrowserFailed'));
    });
  };

  // Universal "save to disk" — type-agnostic stream with
  // Content-Disposition: attachment, through the serve URL on desktop or the
  // authenticated draft URL on an org deployment (ENG-2044).
  const onDownload = async () => {
    if (!(await downloadArtifactFile(artifact, { actionPath, entry: 'viewer' }))) {
      setErr(downloadUnavailableMessage(disabledReason || t('viewer.noDownload')));
    }
  };

  const onTrash = () => {
    if (pub.busy || deleteBusy) return;
    if (!hasActionPath) {
      setErr(disabledReason || t('viewer.noLocalPath'));
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
      let leftLive = '';
      const before = pub.accessLoaded ? shareSnapshot(pub) : UNKNOWN_SHARE_SNAPSHOT;
      const clientUnpublishes = needsClientUnpublishBeforeDelete({ orgMode, published: isPublished });
      if (clientUnpublishes) {
        leftLive = stopSharingNotice(await unpublishArtifact(actionPath));
        reportWithdrawal(artifact, { entry: 'viewer_delete', before, leftLive: !!leftLive });
      }
      await deleteArtifactAndSync(artifact);
      // On Web the server takes the page down as part of the delete, and the
      // delete fails if it cannot, so a delete that succeeded took it down.
      if (!clientUnpublishes && isPublished) reportWithdrawal(artifact, { entry: 'viewer_delete', before });
      setConfirmDelete(false);
      onDelete?.(actionPath, { notice: leftLive });
      // The artifact is gone but its page is still open to anyone with the
      // link: say so here rather than close over it.
      if (leftLive) {
        setErr(leftLive);
        return;
      }
      onClose?.();
    } catch (e) {
      setConfirmDelete(false);
      setErr(e?.message || t('viewer.deleteFailed'));
    } finally {
      setDeleteBusy(false);
    }
  };

  // The panel rail on the viewer's right edge (ViewerModeRail, ENG-4455): one
  // tab per layer this person may use, each opening its side panel. Clicking
  // the open one closes it; the unsaved Live edit prompt guards both ways out.
  // Comments still to review: open ones, as an inbox counts what is in it.
  // Resolved and dismissed ones are done with.
  const openCommentCount = (comments.threads || []).filter(isOpenThread).length;
  const railTabs = [
    canSource && {
      id: 'source',
      icon: Ico.edit(16),
      label: t('layers.source'),
      description: t('rail.sourceHint'),
      pressed: sourceOn,
      onSelect: () => setSourceLayer(!sourceOn),
    },
    commentsEnabled && {
      id: 'comments',
      icon: Ico.chats(16),
      label: t('layers.comments'),
      description: t('rail.commentsHint'),
      pressed: !!commentsOpen,
      onSelect: () => toggleComments(),
      badge: openCommentCount,
      badgeLabel: t('rail.commentsOpen', { count: openCommentCount }),
    },
    statsAvailable && {
      id: 'stats',
      icon: Ico.chartColumn(16),
      label: t('layers.stats'),
      description: t('rail.statsHint'),
      pressed: statsOpen,
      onSelect: () => toggleStats(!statsOpen),
    },
  ].filter(Boolean);
  // The address pill: where this artifact can be opened. A published page or
  // a running live app has its own address; a draft has the address the
  // browser-tab action opens, or none until a signed link is minted.
  const addressModel = liveAppView && liveAppAddress
    ? { kind: 'live', url: liveAppAddress, fallback: title }
    : isPublished
      ? { kind: 'published', url: pub.publishedUrl, fallback: title }
      // Embedded content (data:/blob:) is no address to read or copy.
      : { kind: 'draft', url: draftLinkRef || /^(?:data|blob):/i.test(browserTabUrl) ? '' : browserTabUrl, fallback: artifact.slug || title };
  const headerReview = {
    enabled: commentsEnabled,
    open: commentsOpen,
    controller: comments,
    onToggle: toggleComments,
  };
  const bodyStats = {
    open: statsOpen,
    controller: stats,
    accessMode: pub.accessMode,
    accessLoaded: !!pub.accessLoaded,
    onClose: () => setLayer('stats', false),
  };
  const publication = {
    canManage,
    publishable,
    controller: pub,
    hasActionPath,
    isPublished,
    disabledReason,
    shareRequest,
    onShareRequestClosed: () => setClosedShareRequest(shareRequest),
    onReviewUnshared: canReviewUnshared && !workspace.comparison ? reviewUnshared : null,
  };
  const artifactActions = {
    canOpenInBrowserTab: !!browserTabUrl,
    canOpenLocalFile,
    isBackendArtifact,
    isLiveApp: liveAppView,
    opensDraftLinkInTab: !!draftLinkRef,
    backendPort,
    artifact,
    deleteBusy,
    onReload,
    onOpenInBrowserTab,
    onOpenFolder,
    onOpenOS,
    onDownload,
    onTrash,
  };
  /* The document preview's plain source and callbacks. The draft URL is made
     absolute here and versioned like the image URL, so a reload or a new
     mtime remounts the preview with a new frame and token. fetchFile hands
     DocumentPreview's abort signal to fetchAuthenticatedResponse as its
     `signal` option. */
  const documentPreview = showDocumentPreview ? {
    source: {
      url: withArtifactVersion(
        isAbsoluteArtifactPreviewUrl(draftPreviewUrl) ? draftPreviewUrl : `${host.getApiOrigin()}${draftPreviewUrl}`,
        contentVersion,
      ),
      previewType: documentType,
      filename: title || 'file',
    },
    fetchFile: (url, signal) => fetchAuthenticatedResponse(url, { signal }),
    download: () => downloadArtifactFile(artifact, { actionPath, entry: 'viewer' }),
    openInDefaultApp: onOpenOS,
    onLoadError: (loadError) => setErr(draftPreviewErrorMessage(loadError, t('viewer.loadFileFailed'))),
  } : null;
  const previewModel = {
    draftUrl: draftPreviewUrl,
    contentVersion,
    document: documentPreview,
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
    liveApp: liveAppView
      ? { notice: liveAppNotice, state: liveAppRead.state, reloadKey: reloadNonce, onOpen: onOpenLiveApp, onLaunch: onAddressWithAgent ? onLaunchLiveApp : undefined }
      : null,
    url: previewUrl,
    doc: previewDoc,
    kind: previewKind,
    iframeRef,
    view: previewView,
    fitStyle: previewFit.style,
    // The Live editor's own place, for a save made from it (keepPreviewPlace).
    onEditorView,
    title,
    iframeReady,
    setIframeReady,
    onReload,
    // The quick-edit reload cover: 'idle' | 'covering' | 'waiting' | 'revealing'.
    reloadPhase: previewReload.phase,
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
    onAddressWithAgent: documentType ? undefined : addressCommentWithAgent,
    onCreate: createArtifactComment,
    loadCommentImage: readCommentImage,
    // Comments sent to the "Ask for a change" bar: the one it is on, and
    // those waiting their turn.
    agentRunningThreadId: canQuickEdit ? quickEdit.runningThreadId : null,
    agentQueuedThreadIds: canQuickEdit ? quickEdit.queuedThreadIds : [],
    textSelection,
    setTextSelection,
  };

  const headerLayout = {
    ...layout,
    onToggle: toggleLayout,
  };

  return (
    <Modal
      open={open}
      onClose={requestClose}
      {...modalProps}
      labelledBy="artifact-viewer-title"
    >
      <ArtifactViewerHeader
        title={title}
        authorship={authorship}
        workspace={workspaceView}
        review={headerReview}
        publication={publication}
        actions={artifactActions}
        diagnostics={diagnostics}
        address={addressModel}
        layout={headerLayout}
        onClose={requestClose}
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
          saveInEditor={sourceOn}
        />
      )}
      {(workspace.error || workspace.conflict) && (
        <div className="artifact-workspace-notice" role="alert">
          {workspace.conflict
            ? t('viewer.conflict')
            : workspace.error}
        </div>
      )}
      {tabError && (
        <div className="artifact-workspace-notice" role="alert">{tabError}</div>
      )}
      {changedElsewhere && (
        <button type="button" className="artifact-feedback-notice" onClick={reloadChangedElsewhere}>
          {Ico.reload(14)} <span>{t('viewer.changedElsewhere')}</span>
        </button>
      )}
      {draftLinkExpired && (
        <button type="button" className="artifact-feedback-notice" onClick={onReload}>
          {Ico.reload(14)} <span>{t('viewer.linkExpired')}</span>
        </button>
      )}
      {changePublished && (
        <div className="artifact-feedback-notice is-status" role="status">
          {Ico.check(14)} <span>{t('viewer.changePublished')}</span>
        </div>
      )}
      {feedbackNotice && (
        <button
          type="button"
          className="artifact-feedback-notice"
          onClick={() => setLayer('comments', true)}
        >
          {Ico.chats(14)} <span>{feedbackNotice}</span>
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
              ? t('viewer.suggestionSuperseded')
              : t('viewer.suggestionWaiting')}
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
                setRepairNoticeError(noticeError?.message || t('viewer.openSuggestionFailed'));
              } finally {
                setRepairBusy(false);
              }
            }}
          >
            {t('viewer.viewChange')}
          </button>
          <button
            type="button"
            disabled={repairBusy}
            onClick={() => setPendingDiscard({ repairId: workspace.repair.id })}
          >
            {t('revisionBar.discard')}
          </button>
          <button
            type="button"
            className="artifact-repair-notice-dismiss"
            aria-label={t('publish.dismiss')}
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
              ? t('viewer.blockedFor', { comment: blockedComment })
              : t('viewer.blockedFile')}
          </span>
          <button
            type="button"
            disabled={repairBusy}
            onClick={() => setPendingDiscard({ repairId: blockedBy.repairId, clearBlocker: true })}
          >
            {t('viewer.discardPending')}
          </button>
          <button
            type="button"
            className="artifact-repair-notice-dismiss"
            aria-label={t('publish.dismiss')}
            onClick={() => setBlockedBy(null)}
          >
            {Ico.close(12)}
          </button>
        </div>
      )}

      {/* The body and, on its right edge, the panel rail. */}
      <div className="artifact-viewer-workarea">
        <ArtifactViewerBody
          layers={{
            source: sourceOn,
            // The Live edit panel's close: the same way out as its rail tab.
            onExitSource: () => setSourceLayer(false),
            // Save and Discard, in the Live edit panel.
            editActions: {
              dirty: !!workspace.dirty,
              saving: workspace.status === 'saving',
              canEdit: workspace.capabilities?.canEdit !== false,
              onSave: () => saveWorkspace(),
              onDiscard: workspace.discard,
            },
          }}
          workspace={{ ...workspaceView, save: saveWorkspace }}
          preview={previewModel}
          review={bodyReview}
          stats={bodyStats}
          agentReview={{ busy: repairBusy, setBusy: setRepairBusy }}
          publishReview={publishReview}
          sidePanelId={sidePanelId}
        />
        <ViewerModeRail
          label={t('rail.ariaLabel')}
          tabs={railTabs}
          actions={openChatAction ? [openChatAction] : []}
          panelId={sidePanelId}
        />
      </div>

      {canQuickEdit && (
        <QuickEditBar
          controller={quickEdit}
          chatMessages={chatMessages}
          // Messages go to the chat without a decisions model, and the chat
          // has its own picker, so the bar shows none then.
          picker={quickEdit.direct && modelPicker ? (
            <ModelEffortPicker
              models={modelPicker.models}
              modelMeta={modelPicker.modelMeta}
              model={barModel}
              onModelChange={(next) => { setBarModel(next); setBarEffort(null); }}
              effort={barEffort}
              onEffortChange={setBarEffort}
            />
          ) : null}
          // Unsaved editor text: sending asks to save or discard it first,
          // so the edit never lands on top of it.
          unsaved={!!workspace.dirty}
          onSaveUnsaved={async () => {
            const saved = await saveWorkspace();
            return saved?.revision?.id || null;
          }}
          onDiscardUnsaved={workspace.discard}
          focusRequest={barFocusRequest}
          focusUsed={barFocusUsed}
          // Inside a chat, closing the viewer shows it. Outside one, the host
          // opens the chat the bar handed the message to.
          onOpenChat={!inChatTranscript && onOpenConversation && agentChatId
            ? () => onOpenConversation(chatTranscript?.conversationId || agentChatId)
            : onClose}
          // A comment the agent worked on in the chat: once its turn ends the
          // bar asks whether to resolve it (ENG-4560).
          threadStatus={(threadId) => (comments.threads || []).find((item) => item.id === threadId)?.status || null}
          onResolveThread={(threadId) => setCommentStatus(threadId, 'resolved')}
        />
      )}

      <ConfirmModal
        open={sourceOffPrompt}
        title={t('layers.sourceOffPrompt.title')}
        message={t('layers.sourceOffPrompt.message')}
        confirmLabel={t('layers.sourceOffPrompt.confirmLabel')}
        cancelLabel={t('viewer.keepEditing')}
        destructive
        onClose={() => {
          layerAfterSourceOffRef.current = null;
          setSourceOffPrompt(false);
        }}
        onConfirm={() => {
          setSourceOffPrompt(false);
          workspace.discard();
          // Asked on the way to Comments or Stats: open it, which turns Live
          // edit off.
          const next = layerAfterSourceOffRef.current;
          if (next) {
            layerAfterSourceOffRef.current = null;
            if (next === 'comments') commentModeOnOpenRef.current = true;
            setLayer(next, true);
          } else {
            setLayer('source', false);
          }
        }}
      />

      <ConfirmModal
        open={!!pendingDiscard}
        title={t('viewer.discardTitle')}
        message={t('viewer.discardMessage')}
        confirmLabel={t('revisionBar.discard')}
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
            setRepairNoticeError(discardError?.message || t('viewer.discardFailed'));
          } finally {
            setRepairBusy(false);
          }
        }}
      />

      <ConfirmModal
        open={!!closePrompt}
        title={closePrompt ? t(`${closePrompt.key}.title`) : undefined}
        message={closePrompt ? t(`${closePrompt.key}.message`) : undefined}
        confirmLabel={closePrompt ? t(`${closePrompt.key}.confirmLabel`) : undefined}
        cancelLabel={t('viewer.keepEditing')}
        destructive
        onClose={() => setClosePrompt(null)}
        onConfirm={() => {
          const then = closePrompt?.then;
          setClosePrompt(null);
          onClose?.();
          then?.();
        }}
      />

      {/* Delete confirmation */}
      <ConfirmModal
        open={confirmDelete}
        title={t('viewer.deleteTitle')}
        message={t('viewer.deleteMessage', { title })}
        confirmLabel={t('common.delete')}
        destructive
        busy={deleteBusy}
        busyLabel={t('status.deleting')}
        onConfirm={onConfirmDelete}
        onClose={() => { if (!deleteBusy) setConfirmDelete(false); }}
      />
    </Modal>
  );
}
