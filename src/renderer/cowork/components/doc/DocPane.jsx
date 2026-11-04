// DocPane — a doc open beside the chat (or in a modal from the library).
//
// Header: title, live state ("Agent is writing", "Saving…"), export, share,
// expand and close. It saves itself as you type, like a Google Doc: no save
// button, no versions to manage (snapshots are still kept server-side).
// Body: the tabs (two or more) and the page. The pane reports what the person
// is looking at — tab, selection — so the next chat message carries it as the
// doc view context. Cmd+Z and Shift+Cmd+Z are the doc's undo and redo
// (useDoc), and a deletion offers its undo in a notice.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, Download, FileText, Maximize2, Minimize2, PanelLeftOpen, X } from 'lucide-react';
import { Icon } from '../ui/Icon';
import { Menu, Tooltip } from '../ui';
import DocCanvas from './DocCanvas';
import { TabRail, TabStrip, tabElementId, useTabsHidden } from './DocTabs';
import { docPageTarget } from './docArtifact';
import { useDoc } from './useDoc';
import { PendingEdits, useSaveIndicator } from './useSaveIndicator';
import { downloadDocExport, fetchDoc, fetchDocMarkdown, followDoc, postDocOps, uploadDocImage } from './docApi';
import { DocImageLoader } from './blocks';
import { blockPlainText, isTextBlock } from './docModel';
import { placeCaret } from './caret';
import { useDraftImageLoader } from '../artifact/draftImages';
import { copyText } from '../../lib/clipboard';
import { PublishMenu } from '../artifact/publish/PublishMenu';
import { usePublish } from '../artifact/publish/usePublish';
import { host } from '../../../platform/host';
import { useOrgMode } from '../../../lib/orgMode';
import './doc.css';
import './docPane.css';

// The app's own server, as the transport useDoc reads and writes through.
const LOCAL_TRANSPORT = { fetchDoc, followDoc, postDocOps };

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

// What a doc downloads as, in the menu's order: the formats the server offers
// here (PDF needs a render service), or all of them from a server that doesn't say.
const EXPORTS = [['docx', 'Word (.docx)'], ['pdf', 'PDF'], ['md', 'Markdown'], ['html', 'HTML page']];
export function exportChoices(offered) {
  return EXPORTS.filter(([fmt]) => !Array.isArray(offered) || offered.includes(fmt));
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
      return gone ? `Deleted the tab “${gone.title}”` : null;
    }
    case 'delete_column': {
      const col = tab?.blocks.find((b) => b.id === op.table)?.columns?.find((c) => c.id === op.col);
      return col ? `Deleted the column “${col.name}”` : null;
    }
    case 'delete_rows': return op.rows.length === 1 ? 'Deleted a row' : `Deleted ${op.rows.length} rows`;
    default: {
      const gone = (tab?.blocks || []).filter((b) => op.target.includes(b.id));
      if (!gone.some((b) => !isTextBlock(b) || blockPlainText(b).trim())) return null;
      return gone.length === 1 ? 'Deleted a block' : `Deleted ${gone.length} blocks`;
    }
  }
}

/** What a refused edit's banner says: the server's words are the agent's, naming ops by number. */
export function writeErrorText(e) {
  return e?.code === 'too_big' || e?.status === 413
    ? 'That edit was too large to save. The doc shows what is saved.'
    : 'That edit couldn’t be saved. The doc shows what is saved.';
}

export default function DocPane({
  projectRef, artifactId, title: fallbackTitle, variant = 'side', expanded = false, fillsWindow = false,
  onToggleExpand, onClose, onAskAgent, onViewChange,
}) {
  const {
    doc, status, error, capabilities, card, apply: applyOps, undo, redo, flash, agentActive, saving, writeError,
    clearWriteError,
  } = useDoc({ projectRef, artifactId, transport: LOCAL_TRANSPORT });
  // Images beside the doc, fetched with the app's credentials (the shell shows
  // only blob: images from its own server).
  const loadImage = useDraftImageLoader(card?.draftUrl, null);
  const orgMode = useOrgMode();
  // A doc is shared as its rendered page (doc.html), through the same publish
  // flow and access choices (public, password, named people, only me) as any
  // HTML artifact. The controller addresses the page, not the JSON beside it.
  const shareTarget = useMemo(() => docPageTarget(card), [card]);
  const pub = usePublish(shareTarget, { enabled: !!shareTarget && !orgMode });
  const canShare = !orgMode && !!shareTarget && capabilities?.canEdit !== false;
  const [activeTab, setActiveTab] = useState(null);
  const [unseen, setUnseen] = useState(new Set());
  const [notice, setNotice] = useState(null);
  const [narrow, setNarrow] = useState(false);
  const rootRef = useRef(null);
  const tabsId = useId();
  // The tab rail folds away, as the app's sidebar does; the header's leading
  // icon brings it back. Focus follows to the control that is left.
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
    if (done === 'changed') warn(kind === 'redo' ? 'Can’t redo that: the doc has changed since.' : 'Can’t undo that: it has changed since.');
    return done;
  }, [undo, redo, warn]);
  const uploadImage = useCallback(async (file) => {
    try {
      return await uploadDocImage(projectRef, artifactId, file);
    } catch (e) {
      warn(e.message || 'Couldn’t add that image');
      return null;
    }
  }, [projectRef, artifactId, warn]);

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

  const exportAs = async (format) => {
    try {
      const name = await downloadDocExport(projectRef, artifactId, format);
      // The download is handed on, not finished: the desktop app asks where
      // to save it, and the person can still cancel.
      setNotice({ tone: 'info', text: `Exporting ${name}…` });
    } catch (e) {
      setNotice({ tone: 'warn', text: e.message || 'Export failed' });
    }
  };
  const copyMarkdown = async () => {
    try {
      const md = await fetchDocMarkdown(projectRef, artifactId);
      // The shared helper, not navigator.clipboard alone: the app refuses the
      // clipboard permission, and the click's activation is spent by the fetch.
      if (!await copyText(md)) throw new Error('Couldn’t copy the doc');
      setNotice({ tone: 'info', text: 'Copied as Markdown' });
    } catch (e) {
      setNotice({ tone: 'warn', text: e.message || 'Copy failed' });
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
  const ownUndo = (target) => editable && !(target instanceof HTMLInputElement);
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
    if (!doc || !pub.publishedUrl) return undefined;
    if (lastRev.current === doc.rev) return undefined;
    lastRev.current = doc.rev;
    const t = setTimeout(() => { pubRefresh?.(); }, 1200);
    return () => clearTimeout(t);
  }, [doc, pub.publishedUrl, pubRefresh]);

  // Published: the shared link, behind whatever access it was given. Not yet:
  // the page itself, opened from disk in the default browser (desktop), the
  // way any other artifact opens before it is shared.
  const canOpenLocally = host.isElectron && !!card?.htmlPath;
  const canOpenInBrowser = !!pub.publishedUrl || canOpenLocally;
  const openInBrowser = async () => {
    try {
      if (pub.publishedUrl) {
        await host.openExternal(pub.publishedUrl);
        return;
      }
      const res = await host.openPath(card.htmlPath);
      if (res && res.ok === false) throw new Error(res.reason || 'Could not open the page');
    } catch (e) {
      setNotice({ tone: 'warn', text: e.message || 'Could not open this doc in a browser' });
    }
  };

  // Like Claude Docs and Notion, nothing at rest: a doc is always saved.
  // "Saving…" covers typed text waiting to be sent as well as the request; a
  // failed save shows its own banner.
  const { saving: showSaving, onPendingChange } = useSaveIndicator(saving);

  // The agent writing this doc, as its own changes show: a turn running in
  // the chat beside it may be about something else entirely.
  const live = agentActive;
  const tabbed = (doc?.tabs.length || 0) > 1;
  const offline = writeError?.code === 'offline';
  const statusEl = live
    ? <span className="doc-header__status doc-header__status--agent"><span className="doc-header__pulse" aria-hidden="true" />Agent is writing</span>
    : offline
      ? <span className="doc-header__status doc-header__status--warn">Not saved yet</span>
      : showSaving
        ? <span className="doc-header__status">Saving…</span>
        : null;

  return (
    <section
      ref={rootRef}
      className={`doc-root ${variant === 'modal' ? 'doc-pane--modal' : 'doc-pane'} ${narrow ? 'doc-root--narrow' : ''}`}
      data-corner={headerCorner({ fillsWindow, expanded })}
      aria-label={doc?.title || fallbackTitle || 'Doc'}
      onKeyDownCapture={onKeyDownCapture}
    >
      <header className="doc-header">
        {tabbed && !narrow && tabsHidden ? (
          <Tooltip content="Show tabs">
            <button type="button" ref={showTabsRef} className="doc-iconbtn doc-header__tabs" onClick={showTabs}
              aria-label={unseen.size ? 'Show tabs (a tab has changed)' : 'Show tabs'}>
              <Icon of={PanelLeftOpen} size={16} />
              {unseen.size > 0 && <span className="doc-header__tabs-dot" />}
            </button>
          </Tooltip>
        ) : (
          <span className="doc-header__icon"><Icon of={FileText} size={16} /></span>
        )}
        <span className="doc-header__title" title={doc?.title || fallbackTitle}>{doc?.title || fallbackTitle || 'Doc'}</span>
        <span aria-live="polite">{statusEl}</span>
        {doc && (
          <Menu
            ariaLabel="Export"
            tooltip="Export"
            trigger={<button type="button" className="doc-iconbtn" aria-label="Export"><Icon of={Download} size={16} /></button>}
            items={[
              { heading: 'Download as' },
              ...exportChoices(capabilities?.exportFormats)
                .map(([key, label]) => ({ key, label, onClick: () => exportAs(key) })),
              { divider: true },
              { key: 'copy', label: 'Copy as Markdown', onClick: copyMarkdown },
            ]}
          />
        )}
        {doc && canShare && <PublishMenu controller={pub} noun="doc" followsEdits />}
        {doc && (
          <Tooltip content={canOpenInBrowser
            ? (pub.publishedUrl ? 'Open the shared page' : 'Open in browser')
            : 'Share it to open it in a browser'}>
            <button type="button" className="doc-iconbtn" aria-label={pub.publishedUrl ? 'Open the shared page' : 'Open in browser'}
              disabled={!canOpenInBrowser} onClick={openInBrowser}>
              <Icon of={ArrowUpRight} size={16} />
            </button>
          </Tooltip>
        )}
        {onToggleExpand && (
          <Tooltip content={expanded ? 'Show the chat' : 'Expand'}>
            <button type="button" className="doc-iconbtn" aria-label={expanded ? 'Show the chat' : 'Expand'} onClick={onToggleExpand}>
              <Icon of={expanded ? Minimize2 : Maximize2} size={16} />
            </button>
          </Tooltip>
        )}
        {onClose && (
          <Tooltip content="Close">
            <button type="button" className="doc-iconbtn" aria-label="Close doc" onClick={onClose}><Icon of={X} size={16} /></button>
          </Tooltip>
        )}
      </header>

      {/* No stale refusals here: the app sends no ifRev, and its server
          rebases every edit onto the doc as it stands. */}
      {writeError && (
        <div className="doc-banner" role="alert">
          {offline
            ? 'Can’t reach Cowork’s local server. Your edits are kept here and will save as soon as it’s back.'
            : writeErrorText(writeError)}
          <span className="doc-banner__spacer" />
          {!offline && <button type="button" className="doc-addbtn" onClick={clearWriteError}>Dismiss</button>}
        </div>
      )}
      {notice && (
        <div className={`doc-banner ${notice.tone === 'info' ? 'doc-banner--info' : ''}`} role="status">
          {notice.text}
          {notice.undo && (
            <>
              <span className="doc-banner__spacer" />
              <button type="button" className="doc-addbtn" onClick={() => { setNotice(null); stepBack('undo'); }}>Undo</button>
            </>
          )}
        </div>
      )}

      {status === 'loading' && !doc && (
        <div className="doc-scroll"><div className="doc-skeleton" aria-label="Loading doc"><div /><div /><div style={{ width: '82%' }} /><div style={{ width: '64%' }} /></div></div>
      )}
      {status === 'error' && !doc && (
        <div className="doc-state">{error?.status === 404 ? 'This doc no longer exists.' : `Could not open this doc. ${error?.message || ''}`}</div>
      )}
      {doc && tab && (
        <div className="doc-body">
          {tabbed && !narrow && (
            <TabRail tabs={doc.tabs} activeId={tab.id} unseen={unseen} editable={editable}
              onSelect={setActiveTab} apply={apply} idBase={tabsId} hidden={tabsHidden} onHide={hideTabs} />
          )}
          <div className="doc-scroll">
            {tabbed && narrow && (
              <TabStrip tabs={doc.tabs} activeId={tab.id} onSelect={setActiveTab} idBase={tabsId}
                onAdd={editable ? addTab : undefined} unseen={unseen} />
            )}
            <div {...(tabbed ? { role: 'tabpanel', id: `${tabsId}-panel`, 'aria-labelledby': tabElementId(tabsId, tab.id) } : {})}>
              <PendingEdits.Provider value={onPendingChange}>
                <DocImageLoader.Provider value={loadImage}>
                <DocCanvas
                  key={tab.id}
                  doc={doc}
                  tab={tab}
                  editable={editable}
                  apply={apply}
                  flash={flash}
                  agentLive={live}
                  onAskAgent={onAskAgent}
                  onSelectionChange={onSelectionChange}
                  onAddTab={addTab}
                  nameTitle={naming === tab.id}
                  onNamed={named}
                  onUploadImage={uploadImage}
                />
                </DocImageLoader.Provider>
              </PendingEdits.Provider>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
