// DocPane — a doc open beside the chat (or in a modal from the library).
//
// Header: title, live state ("Agent is writing", "Saving…"), version history,
// export, share, expand and close. It saves itself as you type, like a Google
// Doc: no save button. The clock lists the versions its editing sessions left;
// picking one shows it read-only, ready to restore.
// Body: the tabs (two or more) and the page. The pane reports what the person
// is looking at — tab, selection — so the next chat message carries it as the
// doc view context. Cmd+Z and Shift+Cmd+Z are the doc's undo and redo
// (useDoc), and a deletion offers its undo in a notice.
// As a preview (`variant="modal"`) it has the artifact viewer's panel rail on
// its right edge: Add tab, and Comments, which opens the viewer's comments
// inbox beside the page. Comments sit on blocks (docComments); the doc beside
// a chat has no rail and adds tabs from the page and the tab list instead.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, ChevronDown, FilePlus, FileText, Maximize2, Minimize2, X } from 'lucide-react';
import { Icon } from '../ui/Icon';
import { Button, Menu, Spinner, Tooltip } from '../ui';
import DocAskBar from './DocAskBar';
import DocCanvas from './DocCanvas';
import DocHeaderTitle from './DocHeaderTitle';
import { ShowTabsButton, TabRail, TabStrip, tabElementId, useTabsHidden } from './DocTabs';
import { docPageTarget } from './docArtifact';
import { useDoc } from './useDoc';
import { noteArtifactRenamed } from '../../lib/artifactsStore';
import { PendingEdits, useSaveIndicator } from './useSaveIndicator';
import { downloadDocExport, fetchDoc, fetchDocMarkdown, followDoc, postDocOps, uploadDocImage } from './docApi';
import { DocImageLoader } from './blocks';
import { blockPlainText, isTextBlock } from './docModel';
import { placeCaret } from './caret';
import { useDraftImageLoader } from '../artifact/draftImages';
import { copyText } from '../../lib/clipboard';
import { RestoreDialog, RestoredNote, VersionBanner, VersionMenu } from './DocVersions';
import { useVersionHistory } from './useVersionHistory';
import { changedSince } from './versionHistory';
import { PublishMenu } from '../artifact/publish/PublishMenu';
import { usePublish } from '../artifact/publish/usePublish';
import { maximizeKeyShortcuts } from '../artifact/useViewerLayout';
import { ViewerModeRail } from '../artifact/ViewerModeRail';
import { ViewerSidePanel } from '../artifact/ViewerSidePanel';
import { CommentsPanel } from '../artifact/comments';
import Ico from '../Icons';
import { commentFixMessage } from '../../lib/commentFixRequest';
import { threadImageFiles } from '../../lib/commentImages';
import { imageAttachment } from '../../lib/imageAttachments';
import { commentedBlocks, docAnchorStates, docCommentSelector, threadLocations } from './docComments';
import { useDocComments } from './useDocComments';
import { commentKindFor, isOpenThread } from '../../lib/commentsReducer';
import { host } from '../../../platform/host';
import { useOrgMode } from '../../../lib/orgMode';
import { useDocsEnabled } from '../../../lib/docsEnabled';
import { sharedTranslator, useTranslation } from '../../../lib/i18n';
import '../artifact/artifactWorkspace.css';
import './doc.css';
import './docPane.css';

// The app's own server, as the transport useDoc reads and writes through.
const LOCAL_TRANSPORT = { fetchDoc, followDoc, postDocOps };
const NO_TABS = new Set();
const NO_FLASH = {};
const NO_BLOCKS = new Set();
const NO_LOCATIONS = new Map();
const NO_STATES = {};
// How long a block a comment card was clicked for stays marked.
const FOCUS_MS = 1600;

/**
 * Whose top-left corner the header sits in, where something is drawn over
 * it: a Mac draws the window's buttons over a pane that fills the window, and
 * an expanded pane reaches the edge of the app's main column, where the shell
 * floats its open-sidebar button while the sidebar is folded away.
 */
export function headerCorner({ fillsWindow, expanded }) {
  if (fillsWindow) return host.isElectron && host.isMac() ? 'window' : undefined;
  return expanded ? 'main' : undefined;
}

const tr = sharedTranslator('docs');

// What a doc downloads as, in the menu's order: the formats the server offers
// here (PDF needs a render service), or all of them from a server that doesn't say.
const EXPORTS = ['docx', 'pdf', 'md', 'html'];
export function exportChoices(offered) {
  return EXPORTS.filter((fmt) => !Array.isArray(offered) || offered.includes(fmt));
}

const DELETES = new Set(['delete', 'delete_tab', 'delete_column', 'delete_rows']);

/**
 * What a deletion took, for the notice that offers to undo it: null for any
 * other edit, and for a merge or an empty line going (Backspace), which take
 * nothing a person would want back.
 */
export function deletionNotice(doc, ops, tabId) {
  if (!doc || !ops?.length || !ops.every((op) => DELETES.has(op.op))) return null;
  const op = ops[0];
  const tab = doc.tabs.find((t) => t.id === (op.tab || tabId)) || doc.tabs[0];
  switch (op.op) {
    case 'delete_tab': {
      const gone = doc.tabs.find((t) => t.id === op.tab);
      return gone ? tr('notice.deletedTab', { title: gone.title }) : null;
    }
    case 'delete_column': {
      const col = tab?.blocks.find((b) => b.id === op.table)?.columns?.find((c) => c.id === op.col);
      return col ? tr('notice.deletedColumn', { name: col.name }) : null;
    }
    case 'delete_rows': return tr('notice.deletedRows', { count: op.rows.length });
    default: {
      const gone = (tab?.blocks || []).filter((b) => op.target.includes(b.id));
      if (!gone.some((b) => !isTextBlock(b) || blockPlainText(b).trim())) return null;
      return tr('notice.deletedBlocks', { count: gone.length });
    }
  }
}

/** What a refused edit's banner says: the server's words are the agent's, naming ops by number. */
export function writeErrorText(e) {
  return tr(e?.code === 'too_big' || e?.status === 413 ? 'notice.editTooBig' : 'notice.editFailed');
}

export default function DocPane({
  projectRef, artifactId, title: fallbackTitle, variant = 'side', expanded = false, fillsWindow = false,
  onToggleExpand, maximized = false, onToggleMaximized, onClose, onAskAgent, onViewChange,
}) {
  const {
    doc, status, error, capabilities, card, apply: applyOps, undo, redo, flash, agentActive, saving, writeError,
    clearWriteError,
  } = useDoc({ projectRef, artifactId, transport: LOCAL_TRANSPORT });
  const { t } = useTranslation('docs');
  // Export and full screen use the artifact viewer's own words.
  const { t: tArtifacts } = useTranslation('artifacts');
  // Images beside the doc, fetched with the app's credentials (the shell shows
  // only blob: images from its own server).
  const loadImage = useDraftImageLoader(card?.draftUrl, null);
  const orgMode = useOrgMode();
  const docsEnabled = useDocsEnabled();
  // A doc is shared as its rendered page (doc.html), through the same publish
  // flow and access choices (public, password, named people, only me) as any
  // HTML artifact. The controller addresses the page, not the JSON beside it.
  const shareTarget = useMemo(() => docPageTarget(card), [card]);
  // A rename, by the person or the agent, reaches every list showing the doc's card.
  const docTitle = doc?.title;
  useEffect(() => {
    if (docTitle) noteArtifactRenamed(artifactId, docTitle);
  }, [artifactId, docTitle]);
  const pub = usePublish(shareTarget, { enabled: !!shareTarget });
  const canShare = !!shareTarget && capabilities?.canEdit !== false;
  const [activeTab, setActiveTab] = useState(null);
  const [unseen, setUnseen] = useState(new Set());
  const [notice, setNotice] = useState(null);
  const [narrow, setNarrow] = useState(false);
  const rootRef = useRef(null);
  const tabsId = useId();
  // The tab rail folds away, as the app's sidebar does; Show tabs, where the
  // rail's Hide tabs sat, brings it back. Focus follows to the control that is left.
  const [tabsHidden, setTabsHidden] = useTabsHidden();
  const showTabsRef = useRef(null);
  const hideTabs = useCallback(() => {
    setTabsHidden(true);
    requestAnimationFrame(() => showTabsRef.current?.focus());
  }, [setTabsHidden]);
  const showTabs = useCallback(() => {
    setTabsHidden(false);
    requestAnimationFrame(() => rootRef.current?.querySelector('.doc-tabs [aria-selected="true"]')?.focus());
  }, [setTabsHidden]);
  // What the person last picked in the page, `{ tab, selection }`, for the
  // chat's next message. One object per pick: the chat tells a pick a message
  // already took from a new one by it.
  const selection = useRef(null);
  const editable = capabilities?.canEdit !== false;
  // Every "Edit with agent" entry in the canvas hangs off this handler. The
  // server's canAddressWithAgent already includes the right to edit (and, in
  // org mode, to run the agent); missing capabilities keep the entry, as they
  // keep `editable`.
  const askAgent = docsEnabled && capabilities?.canAddressWithAgent !== false ? onAskAgent : undefined;
  const warn = useCallback((text) => setNotice({ tone: 'warn', text }), []);

  // Every edit from the page and the tabs comes through here: a deletion,
  // once it lands, offers its undo.
  const docRef = useRef(doc);
  docRef.current = doc;
  const apply = useCallback((ops, opts = {}) => {
    const what = deletionNotice(docRef.current, ops, opts.tab);
    const sent = applyOps(ops, opts);
    if (what) sent.then((res) => { if (res) setNotice({ tone: 'info', text: what, undo: true }); });
    return sent;
  }, [applyOps]);
  const stepBack = useCallback(async (kind) => {
    const done = await (kind === 'redo' ? redo() : undo());
    if (done === 'changed') warn(t(kind === 'redo' ? 'notice.cantRedo' : 'notice.cantUndo'));
    return done;
  }, [undo, redo, warn, t]);
  const renameDoc = useCallback((title) => apply([{ op: 'rename_doc', title }]), [apply]);
  const uploadImage = useCallback(async (file) => {
    try {
      return await uploadDocImage(projectRef, artifactId, file);
    } catch (e) {
      warn(e.message || t('notice.imageFailed'));
      return null;
    }
  }, [projectRef, artifactId, warn, t]);
  const history = useVersionHistory({ projectRef, artifactId, onError: warn });
  // An earlier version being looked at, read-only, in place of the doc; its
  // blocks that read differently now are marked.
  const version = history.preview;
  const changed = useMemo(() => (version ? changedSince(version.doc, doc) : undefined), [version, doc]);

  useEffect(() => {
    if (!rootRef.current || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([e]) => {
      setNarrow(e.contentRect.width < 620);
      // Where the pane starts in the window, for a header that clears what the
      // shell draws in the window's corner (docPane.css, data-corner='main').
      e.target.style.setProperty('--doc-left', `${Math.round(e.target.getBoundingClientRect().left)}px`);
    });
    ro.observe(rootRef.current);
    return () => ro.disconnect();
  }, []);

  const tab = useMemo(() => doc?.tabs?.find((t) => t.id === activeTab) || doc?.tabs?.[0] || null, [doc, activeTab]);

  // A tab the person adds opens at once, its title selected to be named.
  const [naming, setNaming] = useState(null);
  const addTab = useCallback(async () => {
    const before = new Set(doc.tabs.map((t) => t.id));
    const res = await apply([{ op: 'add_tab', title: 'Untitled' }]);
    const created = res?.doc?.tabs?.find((t) => !before.has(t.id));
    if (created) {
      setActiveTab(created.id);
      setNaming(created.id);
      setTabsHidden(false); // adding a tab is working with tabs: bring them back
    }
  }, [doc, apply, setTabsHidden]);
  const named = useCallback(() => setNaming(null), []);
  const shown = version?.doc || doc;
  const shownTab = version ? shown.tabs.find((t) => t.id === activeTab) || shown.tabs[0] : tab;

  // ── The preview's rail and its comments ──
  const preview = variant === 'modal';
  // Adding a tab from the page and the tab list; a preview adds it from the rail.
  const addOnPage = editable && !version && !preview ? addTab : undefined;
  const {
    enabled: commentsEnabled, threads, viewer: commentViewer, markRead, unreadCount,
    create: createComment, setStatus: setCommentStatus, loadImage: loadCommentImage, ...comments
  } = useDocComments({ projectRef, artifactId, enabled: preview, onError: warn });
  const [commentsOpen, setCommentsOpen] = useState(false);
  const sidePanelId = useId();
  const inboxOpen = commentsOpen && commentsEnabled;
  useEffect(() => {
    if (inboxOpen && unreadCount > 0) markRead();
  }, [inboxOpen, unreadCount, markRead]);
  // Where each comment sits now; only the open inbox and the page beside it ask.
  const locations = useMemo(() => (inboxOpen ? threadLocations(doc, threads) : NO_LOCATIONS), [inboxOpen, doc, threads]);
  // While the inbox slides out its cards keep no anchor labels rather than read as detached.
  const anchorStates = useMemo(
    () => (locations === NO_LOCATIONS ? NO_STATES : docAnchorStates(threads, locations)),
    [threads, locations],
  );
  const commented = useMemo(
    () => (version ? NO_BLOCKS : commentedBlocks(threads, locations)),
    [version, threads, locations],
  );
  // The blocks a card in the inbox points at: while it is hovered, and for a
  // moment after it is clicked (its tab opened and the page scrolled there).
  const [hoveredId, setHoveredId] = useState(null);
  const [focused, setFocused] = useState(null);
  const focusThread = useCallback((threadId) => {
    const where = locations.get(threadId);
    if (!where) return;
    setActiveTab(where.tabId);
    setFocused({ blockIds: where.blockIds });
  }, [locations]);
  // A card resolved or reopened under the pointer can leave the list without
  // a mouseleave, so acting on one drops its highlight (a deleted one leaves
  // `locations`, and its highlight with it).
  const onCommentStatus = useCallback((id, status) => {
    setHoveredId(null);
    return setCommentStatus(id, status);
  }, [setCommentStatus]);
  useEffect(() => {
    if (!focused) return undefined;
    const first = rootRef.current?.querySelector(`[data-block-id="${focused.blockIds[0]}"]`);
    first?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    const timer = setTimeout(() => setFocused(null), FOCUS_MS);
    return () => clearTimeout(timer);
  }, [focused]);
  const highlighted = useMemo(() => {
    if (version) return NO_BLOCKS;
    const ids = [...(locations.get(hoveredId)?.blockIds || []), ...(focused?.blockIds || [])];
    return ids.length ? new Set(ids) : NO_BLOCKS;
  }, [version, locations, hoveredId, focused]);
  const commentKind = commentKindFor(commentViewer);
  // The inbox opens first: the new thread shows there, and so does a failure to post it.
  const commentOnBlocks = useCallback(({ tab: tabId, blockIds, quote, text }) => {
    setCommentsOpen(true);
    return createComment({ selector: docCommentSelector({ tab: tabId, blockIds, quote }), text, kind: commentKind });
  }, [createComment, commentKind]);
  // A comment sent to the agent goes the way "Edit with agent" goes, on the
  // blocks it was made on, with the thread's words and images.
  const viewedTabId = tab?.id || null;
  const addressWithAgent = useCallback(async (thread) => {
    if (!askAgent) return;
    const where = locations.get(thread.id);
    const files = await threadImageFiles(thread, loadCommentImage);
    askAgent({
      blockIds: where?.blockIds || [],
      request: commentFixMessage(thread),
      tabId: where?.tabId || viewedTabId,
      attachments: files.map(imageAttachment),
    });
  }, [askAgent, locations, viewedTabId, loadCommentImage]);
  const openComments = threads.filter(isOpenThread).length;
  const railTabs = !preview || !doc ? [] : [
    editable && !version && {
      id: 'add-tab',
      icon: <Icon of={FilePlus} size={16} />,
      label: t('tabs.add'),
      description: t('tabs.addHint'),
      onSelect: addTab,
    },
    commentsEnabled && {
      id: 'comments',
      icon: Ico.chats(16),
      label: tArtifacts('layers.comments'),
      description: tArtifacts('rail.commentsHint'),
      pressed: inboxOpen,
      onSelect: () => setCommentsOpen((open) => !open),
      badge: openComments,
      badgeLabel: tArtifacts('rail.commentsOpen', { count: openComments }),
    },
  ].filter(Boolean);

  // A tab the agent writes into while the person reads another gets a dot.
  const prevFlash = useRef(flash);
  useEffect(() => {
    if (!doc || flash === prevFlash.current) return;
    prevFlash.current = flash;
    const ids = new Set(Object.keys(flash));
    const touchedTabs = doc.tabs.filter((t) => t.blocks.some((b) => ids.has(b.id))).map((t) => t.id);
    if (touchedTabs.length) setUnseen((s) => new Set([...s, ...touchedTabs]));
  }, [flash, doc]);
  useEffect(() => {
    if (tab?.id) setUnseen((s) => { if (!s.has(tab.id)) return s; const n = new Set(s); n.delete(tab.id); return n; });
  }, [tab?.id]);

  // What the chat sends with the next message.
  const reportView = useCallback(() => {
    if (!doc || !tab) return;
    // A pick belongs to its tab: another tab opening drops it.
    if (selection.current?.tab !== tab.id) selection.current = null;
    onViewChange?.({
      artifactId,
      projectId: projectRef,
      title: doc.title,
      tab: tab.id,
      tabTitle: tab.title,
      rev: doc.rev,
      mode: editable ? 'edit' : 'view',
      ...(selection.current ? { selection: selection.current.selection } : {}),
    });
  }, [doc, tab, artifactId, projectRef, editable, onViewChange]);
  useEffect(() => { reportView(); }, [reportView]);
  // null: the caret is back in the page (a selection that left it, for the
  // composer, keeps the pick; see useCanvasSelection).
  const onSelectionChange = useCallback((sel) => {
    selection.current = sel
      ? { tab: tab.id, selection: { blockIds: sel.blockIds.slice(0, 50), quote: sel.quote?.slice(0, 2000) } }
      : null;
    reportView();
  }, [reportView, tab]);

  const [exporting, setExporting] = useState(false);
  const exportAs = async (format) => {
    setExporting(true);
    try {
      const name = await downloadDocExport(projectRef, artifactId, format);
      // The download is handed on, not finished: the desktop app asks where
      // to save it, and the person can still cancel.
      setNotice({ tone: 'info', text: t('export.exporting', { name }) });
    } catch (e) {
      setNotice({ tone: 'warn', text: e.message || t('export.failed') });
    } finally {
      setExporting(false);
    }
  };
  const copyMarkdown = async () => {
    try {
      const md = await fetchDocMarkdown(projectRef, artifactId);
      // The shared helper, not navigator.clipboard alone: the app refuses the
      // clipboard permission, and the click's activation is spent by the fetch.
      if (!await copyText(md)) throw new Error(t('export.copyDocFailed'));
      setNotice({ tone: 'info', text: t('export.copied') });
    } catch (e) {
      setNotice({ tone: 'warn', text: e.message || t('export.copyFailed') });
    }
  };
  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(null), notice.undo ? 6000 : 2600);
    return () => clearTimeout(t);
  }, [notice]);

  // Cmd+Z and Shift+Cmd+Z (or Cmd+Y) anywhere in the doc: the doc's undo and
  // redo, never the browser's. Typing not yet saved is saved first (the field
  // left), so it is the step undone; the caret goes back to its block after.
  // The Edit menu's Undo reaches the page as a historyUndo input, taken here
  // too (its Redo never does: the browser offers a redo only after an undo of
  // its own). A name or address being typed (an input) keeps its own undo.
  const lastStep = useRef(0);
  const stepFromKeys = useCallback((kind, from) => {
    lastStep.current = Date.now();
    const root = rootRef.current;
    const active = document.activeElement;
    const inPane = root?.contains(active);
    // The block the caret is in (or the input names), and the one before it:
    // an undo that takes the block away, a split put back, leaves the caret
    // where its text went.
    const at = (inPane ? active : from)?.closest?.('[data-block-id]');
    const blocks = at ? [...root.querySelectorAll('[data-block-id]')] : [];
    const near = [at, blocks[blocks.indexOf(at) - 1]].map((b) => b?.dataset.blockId).filter(Boolean);
    if (inPane) active.blur();
    stepBack(kind).then(() => {
      const pane = rootRef.current;
      if (!pane || !(inPane || pane.contains(from))) return;
      const el = near.map((id) => pane.querySelector(`[data-block-id="${id}"] [contenteditable="true"]`)).find(Boolean);
      if (el) { placeCaret(el, 'end'); return; }
      // No block to go back to: the pane keeps the focus, so the next Cmd+Z or
      // Shift+Cmd+Z still reaches it (from the page's body, a redo never would).
      pane.tabIndex = -1;
      pane.addEventListener('blur', () => pane.removeAttribute('tabindex'), { once: true });
      pane.focus({ preventScroll: true });
    });
  }, [stepBack]);
  const ownUndo = (target) => editable && !version && !(target instanceof HTMLInputElement);
  const onKeyDownCapture = (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod || e.altKey) return;
    const key = e.key.toLowerCase();
    // In the doc's text, Cmd+B, I and K format; never the app's sidebar or search.
    if (['b', 'i', 'k'].includes(key) && !e.shiftKey && e.target.isContentEditable) e.preventDefault();
    if (!(key === 'z' || (key === 'y' && !e.shiftKey)) || !ownUndo(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    stepFromKeys(key === 'y' || e.shiftKey ? 'redo' : 'undo');
  };
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;
    const onBeforeInput = (e) => {
      if (e.inputType !== 'historyUndo' && e.inputType !== 'historyRedo') return;
      if (!ownUndo(e.target)) return;
      e.preventDefault();
      if (Date.now() - lastStep.current > 300) stepFromKeys(e.inputType === 'historyRedo' ? 'redo' : 'undo', e.target);
    };
    el.addEventListener('beforeinput', onBeforeInput, true);
    return () => el.removeEventListener('beforeinput', onBeforeInput, true);
  });

  const pubRefresh = pub.refresh;
  const lastRev = useRef(null);
  useEffect(() => {
    // In org mode a read here is the owner-only audience route, which an edit
    // never changes; the page itself follows edits on the server.
    if (orgMode || !doc || !pub.publishedUrl) return undefined;
    if (lastRev.current === doc.rev) return undefined;
    lastRev.current = doc.rev;
    const t = setTimeout(() => { pubRefresh?.(); }, 1200);
    return () => clearTimeout(t);
  }, [orgMode, doc, pub.publishedUrl, pubRefresh]);

  // Published: the shared link, behind whatever access it was given. Not yet:
  // the page itself, opened from disk in the default browser (desktop), the
  // way any other artifact opens before it is shared.
  const canOpenLocally = host.isElectron && !!card?.htmlPath;
  const canOpenInBrowser = !!pub.publishedUrl || canOpenLocally;
  const openLabel = t(pub.publishedUrl ? 'pane.openSharedPage' : 'pane.openInBrowser');
  const expandLabel = t(expanded ? 'pane.showChat' : 'pane.expand');
  // The artifact viewer's own words for the same toggle.
  const maximizeLabel = tArtifacts(maximized ? 'layout.restore' : 'layout.maximize');
  const exportLabel = t('export.label');
  const openInBrowser = async () => {
    try {
      if (pub.publishedUrl) {
        await host.openExternal(pub.publishedUrl);
        return;
      }
      const res = await host.openPath(card.htmlPath);
      if (res && res.ok === false) throw new Error(res.reason || t('notice.openPageFailed'));
    } catch (e) {
      setNotice({ tone: 'warn', text: e.message || t('notice.openInBrowserFailed') });
    }
  };

  // Like Claude Docs and Notion, nothing at rest: a doc is always saved.
  // "Saving…" covers typed text waiting to be sent as well as the request; a
  // failed save shows its own banner.
  const { saving: showSaving, onPendingChange } = useSaveIndicator(saving);

  // The agent writing this doc, as its own changes show: a turn running in
  // the chat beside it may be about something else entirely.
  const live = agentActive;
  const tabbed = (shown?.tabs.length || 0) > 1;
  const headerTitle = shown?.title || fallbackTitle || t('doc');
  const offline = writeError?.code === 'offline';
  const statusEl = live
    ? <span className="doc-header__status doc-header__status--agent"><span className="doc-header__pulse" aria-hidden="true" />{t('pane.status.agentWriting')}</span>
    : offline
      ? <span className="doc-header__status doc-header__status--warn">{t('pane.status.notSaved')}</span>
      : showSaving
        ? <span className="doc-header__status">{t('pane.status.saving')}</span>
        : null;

  return (
    <section
      ref={rootRef}
      className={`doc-root ${variant === 'modal' ? 'doc-pane--modal' : 'doc-pane'} ${narrow ? 'doc-root--narrow' : ''}`}
      data-corner={headerCorner({ fillsWindow, expanded })}
      aria-label={headerTitle}
      onKeyDownCapture={onKeyDownCapture}
    >
      <header className="doc-header">
        <span className="doc-header__icon"><Icon of={FileText} size={16} /></span>
        {/* A version looked at shows its own title: restoring it brings that back too. */}
        <DocHeaderTitle title={headerTitle}
          onRename={doc && editable && !version ? renameDoc : undefined} />
        <span aria-live="polite">{statusEl}</span>
        {doc && (
          <Tooltip content={canOpenInBrowser ? openLabel : t('pane.shareToOpen')}>
            <button type="button" className="doc-iconbtn" aria-label={openLabel}
              disabled={!canOpenInBrowser} onClick={openInBrowser}>
              <Icon of={ArrowUpRight} size={16} />
            </button>
          </Tooltip>
        )}
        {doc && editable && <VersionMenu history={history} />}
        {doc && canShare && <PublishMenu controller={pub} noun="doc" followsEdits />}
        {/* Worn like the artifact viewer's Export (ArtifactExportMenu). */}
        {doc && (
          <Menu
            ariaLabel={exportLabel}
            align="end"
            trigger={
              <Button size="sm" disabled={exporting}>
                {exporting
                  ? (<><Spinner style={{ color: 'currentColor' }} /> {tArtifacts('export.exporting')}</>)
                  : (<>{tArtifacts('export.export')} <span className="inline-flex text-ink-3"><Icon of={ChevronDown} size={14} /></span></>)}
              </Button>
            }
            items={[
              ...exportChoices(capabilities?.exportFormats)
                .map((key) => ({ key, label: t(`export.format.${key}`), onClick: () => exportAs(key) })),
              { divider: true },
              { key: 'copy', label: t('export.copyMarkdown'), onClick: copyMarkdown },
            ]}
          />
        )}
        {/* Expand or full screen, then close, past a divider: the artifact viewer's window controls. */}
        {(onToggleExpand || onToggleMaximized || onClose) && (
          <div className="doc-header__window-controls">
            {onToggleExpand && (
              <Tooltip content={expandLabel}>
                <button type="button" className="doc-iconbtn" aria-label={expandLabel} onClick={onToggleExpand}>
                  <Icon of={expanded ? Minimize2 : Maximize2} size={16} />
                </button>
              </Tooltip>
            )}
            {onToggleMaximized && (
              <Tooltip content={maximizeLabel}>
                <button type="button" className="doc-iconbtn" aria-label={maximizeLabel}
                  aria-keyshortcuts={maximizeKeyShortcuts()}
                  onClick={onToggleMaximized}>
                  <Icon of={maximized ? Minimize2 : Maximize2} size={16} />
                </button>
              </Tooltip>
            )}
            {onClose && (
              <Tooltip content={t('pane.close')}>
                <button type="button" className="doc-iconbtn" aria-label={t('pane.closeDoc')} onClick={onClose}><Icon of={X} size={16} /></button>
              </Tooltip>
            )}
          </div>
        )}
      </header>

      {version && <VersionBanner history={history} />}
      {/* No stale refusals here: the app sends no ifRev, and its server
          rebases every edit onto the doc as it stands. */}
      {writeError && (
        <div className="doc-banner" role="alert">
          {offline
            ? t('pane.offline')
            : writeErrorText(writeError)}
          <span className="doc-banner__spacer" />
          {!offline && <button type="button" className="doc-addbtn" onClick={clearWriteError}>{t('pane.dismiss')}</button>}
        </div>
      )}
      {notice && (
        <div className={`doc-banner ${notice.tone === 'info' ? 'doc-banner--info' : ''}`} role="status">
          {notice.text}
          {notice.undo && (
            <>
              <span className="doc-banner__spacer" />
              <button type="button" className="doc-addbtn" onClick={() => { setNotice(null); stepBack('undo'); }}>{t('pane.undo')}</button>
            </>
          )}
        </div>
      )}

      {/* The page and, as a preview, the comments panel and the panel rail beside it. */}
      <div className="artifact-viewer-workarea">
        <div className="artifact-viewer-body">
          <div className="doc-workarea__main">
            {status === 'loading' && !doc && (
              <div className="doc-scroll"><div className="doc-skeleton" aria-label={t('pane.loading')}><div /><div /><div style={{ width: '82%' }} /><div style={{ width: '64%' }} /></div></div>
            )}
            {status === 'error' && !doc && (
              <div className="doc-state">{error?.status === 404 ? t('pane.gone') : t('pane.openFailed', { reason: error?.message || '' })}</div>
            )}
            {shown && shownTab && (
              <div className="doc-body" data-tabs-hidden={(tabbed && !narrow && tabsHidden) || undefined}>
                {tabbed && !narrow && (
                  <TabRail tabs={shown.tabs} activeId={shownTab.id} unseen={version ? NO_TABS : unseen} editable={editable && !version}
                    onSelect={setActiveTab} apply={apply} idBase={tabsId} hidden={tabsHidden} onHide={hideTabs} addable={!preview} />
                )}
                {tabbed && !narrow && tabsHidden && (
                  <ShowTabsButton onShow={showTabs} changed={unseen.size > 0 && !version} buttonRef={showTabsRef} />
                )}
                <div className="doc-scroll">
                  {tabbed && narrow && (
                    <TabStrip tabs={shown.tabs} activeId={shownTab.id} onSelect={setActiveTab} idBase={tabsId}
                      onAdd={addOnPage} unseen={version ? NO_TABS : unseen} />
                  )}
                  <div {...(tabbed ? { role: 'tabpanel', id: `${tabsId}-panel`, 'aria-labelledby': tabElementId(tabsId, shownTab.id) } : {})}>
                    <PendingEdits.Provider value={onPendingChange}>
                      <DocImageLoader.Provider value={loadImage}>
                      <DocCanvas
                        key={version ? `${shownTab.id}@${version.entry.rev}` : shownTab.id}
                        doc={shown}
                        tab={shownTab}
                        editable={editable && !version}
                        apply={apply}
                        flash={version ? NO_FLASH : flash}
                        changed={changed}
                        agentLive={live}
                        onAskAgent={version ? undefined : askAgent}
                        onSelectionChange={onSelectionChange}
                        onAddTab={addOnPage}
                        nameTitle={naming === shownTab.id}
                        onNamed={named}
                        onUploadImage={uploadImage}
                        onComment={commentsEnabled && !version ? commentOnBlocks : undefined}
                        commented={commented}
                        highlighted={highlighted}
                      />
                      </DocImageLoader.Provider>
                    </PendingEdits.Provider>
                  </div>
                </div>
              </div>
            )}
          </div>
          {preview && (
            <ViewerSidePanel id={sidePanelId} mode={inboxOpen ? 'comments' : null} label={tArtifacts('layers.comments')}>
              {() => (
                <CommentsPanel
                  threads={threads}
                  anchorStates={anchorStates}
                  error={comments.error}
                  expired={comments.expired}
                  viewer={commentViewer}
                  capabilities={comments.capabilities}
                  onStatus={onCommentStatus}
                  onAddressWithAgent={askAgent ? addressWithAgent : undefined}
                  onDeleteThread={comments.deleteThread}
                  onEditThread={comments.editThread}
                  onCreate={createComment}
                  onReply={comments.reply}
                  loadImage={loadCommentImage}
                  onHoverThread={setHoveredId}
                  onLeaveThread={() => setHoveredId(null)}
                  onFocusThread={focusThread}
                  onClose={() => setCommentsOpen(false)}
                />
              )}
            </ViewerSidePanel>
          )}
        </div>
        {preview && <ViewerModeRail label={tArtifacts('rail.ariaLabel')} tabs={railTabs} panelId={sidePanelId} />}
      </div>
      {/* The preview's "Ask for a change" bar, as the artifact viewer has. */}
      {preview && doc && askAgent && !version && (
        <DocAskBar artifact={card || { id: artifactId, title: doc.title }} tabId={tab?.id || null} onAskAgent={askAgent} />
      )}
      {version && <RestoreDialog history={history} shared={!!pub.publishedUrl} agentWriting={live} />}
      <RestoredNote history={history} />
    </section>
  );
}
