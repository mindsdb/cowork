import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Ico from './Icons';
import {
  parseFences,
  fenceCtxAtParsed,
  stackEmptyBeforeLine,
  parseOpenerLine,
} from './composerFences';
import { HighlightOverlay } from './composerHighlight';
import { useFileDrop, FileDropOverlay, extractClipboardFiles } from '../lib/useFileDrop';
import { AttachmentThumbnail } from './AttachmentThumbnail';
import { useSkills } from '../lib/skillsStore';

// Detect a "/" slash-command token immediately before the caret. Returns the
// token's start index (the "/") and the lowercased query fragment, or null when
// the caret isn't in a slash token. A token starts at the input start or after
// whitespace, so "/" only triggers at a word boundary (not inside a word/path).
function detectSlashToken(text, caret) {
  const before = text.slice(0, Math.max(0, caret));
  const m = before.match(/(^|\s)\/([\w-]*)$/);
  if (!m) return null;
  return { start: caret - m[2].length - 1, query: m[2].toLowerCase() };
}

function AttachmentChip({ attachment, onRemove }) {
  const src = attachment.source || attachment.kind || 'file';
  const isImage = attachment.mime && String(attachment.mime).startsWith('image/');
  const label = src === 'connector' ? 'Connector' : src === 'gdrive' ? 'Google Drive' : isImage ? 'Image' : 'File';
  const status = attachment.pendingFile
    ? 'Queued'
    : (attachment.extractionStatus && attachment.extractionStatus !== 'ready'
      ? attachment.extractionStatus.replace('_', ' ')
      : null);
  // Pending image uploads carry the original File, so preview it straight
  // from a local object URL (no fetch). Other attachments keep the glyph.
  const showThumb = isImage && attachment.pendingFile;
  return (
    <div className="attachment-chip" title={attachment.note || attachment.textPreview || attachment.name}>
      <span className="attachment-chip-icon">
        {showThumb ? <AttachmentThumbnail file={attachment.pendingFile} cover size={30} alt={attachment.name || 'Image'} />
          : src === 'connector' ? Ico.link(13)
            : src === 'gdrive' ? Ico.googleDrive(13)
              : isImage ? Ico.image(13)
                : Ico.doc(13)}
      </span>
      <span className="attachment-chip-body">
        <span className="attachment-chip-name">{attachment.name || label}</span>
        <span className="attachment-chip-meta">{status || label}</span>
      </span>
      {onRemove && (
        <button className="attachment-chip-remove" title="Remove attachment" onClick={() => onRemove(attachment.id)}>
          x
        </button>
      )}
    </div>
  );
}

export default function Composer({
  onSend,
  project,
  onProjectChange,
  model,
  onModelChange,
  projects,
  models,
  attachments = [],
  connectors = [],
  onNavigateToConnectors,
  onAttachFiles,
  onAddGoogleDriveFiles,
  /** When set with `onUpdateConnectorMute`, Connectors submenu toggles mute (applied when you send). */
  conversationId = null,
  disabledConnections = [],
  onUpdateConnectorMute,
  onRemoveAttachment,
  placeholder = 'Hi Boss, how can I help you today?',
  disabled = false,
  metaReadOnly = false,
  hideMeta = false,
  // When true, suppress the model picker but keep the project picker.
  // Used on the home (new task) composer where we want the user to
  // pick a project but not fuss with model selection.
  hideModel = false,
  // When true, the send button is replaced with a stop button that
  // calls onStop (cancel the in-flight stream + scratchpad).
  streaming = false,
  onStop,
  // Optional — invoked with `true` while the user is actively typing
  // and `false` after a short idle window. The home view uses this
  // to wake up the OrbitMorph from idle while the user is typing.
  onTypingChange,
  // Optional `{ text, bump }`. When `bump` changes, the composer's
  // value resets to `text` and the textarea focuses. Used by Edit-
  // and-resend on prior user messages; bump-based so repeated edits
  // of the same text still re-fill the input.
  prefill = null,
  // Optional — when supplied, the project menu shows a "+ New project"
  // row that swaps into an inline input on click. Receives `{ name }`
  // and is expected to resolve to the created project record; we then
  // call `onProjectChange` with it so the new project is pre-selected
  // for the task being composed. When omitted, the row is hidden.
  onCreateProject = null,
}) {
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const [openMenu, setOpenMenu] = useState(null);
  /** Project-picker menu state. The menu is a search-first picker:
      one input at the top filters the project list AND doubles as
      the "+ Create '<typed>'" entry when no results match — same
      pattern as Linear/Notion's command palette, so the user goes
      from "I can't find it" to "make it" without changing surfaces.
      `flipUp` anchors the menu above the pill when there's no room
      below (chat composer glued to the viewport bottom). */
  const [projectSearch, setProjectSearch] = useState('');
  const [projectMenuBusy, setProjectMenuBusy] = useState(false);
  const [projectMenuError, setProjectMenuError] = useState('');
  const projectSearchRef = useRef(null);
  const projectPillRef = useRef(null);
  const projectMenuRef = useRef(null);
  /** Attach menu opens above the composer by default; flip down when clipped (e.g. project view composer at scroll top). */
  const [attachMenuBelow, setAttachMenuBelow] = useState(false);
  const [connectorsOpen, setConnectorsOpen] = useState(false);
  const [gdrivePickerBusy, setGdrivePickerBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [listening, setListening] = useState(false);
  /** True when the caret is currently inside a fenced block. The boolean
      changes much less often than the caret itself, so we track caret
      position in a ref and only set state on the derived flag. */
  const [inFence, setInFence] = useState(false);
  /** "/" slash-command menu: a filterable skill picker above the input.
      `slashTokenStartRef` records the index of the "/" so accept can replace
      the whole "/<frag>" token. Mirrors the project-menu pattern but the
      filter is the composer text itself (no separate search input). */
  const [slashMenuBelow, setSlashMenuBelow] = useState(false);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState('');
  const [slashIndex, setSlashIndex] = useState(0);
  const slashTokenStartRef = useRef(0);
  const { skills: allSkills } = useSkills();
  const taRef = useRef(null);
  /** Mirror element for the source-mode highlight overlay. Sized and
      styled to match the textarea exactly so the overlay aligns with
      the underlying chars; scrollTop is synced from the textarea's
      onScroll so long content scrolls in lockstep. */
  const overlayRef = useRef(null);
  const fileRef = useRef(null);
  const wrapRef = useRef(null);
  /** Caret position the textarea last reported. Updated on input and
      selection events; consumed by handlers that need the live caret
      without a render cycle. */
  const caretPosRef = useRef(0);
  /** Caret position to apply on the NEXT layout-effect pass — used by
      the setValue fallback path when execCommand('insertText') isn't
      available. Gated on that path only so the execCommand branch
      (which manages its own caret) doesn't collide. */
  const pendingCaretRef = useRef(null);
  /** Positioning context for the attach (+) menu — tight box around the + control so the menu aligns with the activator. */
  const attachAnchorRef = useRef(null);
  const attachMenuRef = useRef(null);

  const navigateToConnectors = useCallback(() => {
    setOpenMenu(null);
    setConnectorsOpen(false);
    onNavigateToConnectors?.();
  }, [onNavigateToConnectors]);

  /** Space we want cleared above the + control before opening the menu upward (~menu height + margin). */
  const ATTACH_MENU_TOP_RESERVE_PX = 200;

  // Typing notifier — fires `onTypingChange(true)` on input and
  // `onTypingChange(false)` after ~1s of inactivity. The home view
  // uses this to wake the OrbitMorph from idle while the user is
  // composing. We hold the timer in a ref so re-renders don't reset
  // it. Deliberately not gated on focus — pasting also counts.
  const typingTimerRef = useRef(null);
  const wasTypingRef = useRef(false);
  const notifyTyping = (active) => {
    if (typeof onTypingChange !== 'function') return;
    if (wasTypingRef.current === active) return;
    wasTypingRef.current = active;
    try { onTypingChange(active); } catch {}
  };
  const bumpTyping = () => {
    notifyTyping(true);
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    // 1-second debounce — once the user pauses for ~1s, signal the
    // host to start the fade-out animation. Resuming typing inside
    // the fade reverses it (the host's CSS transitions handle the
    // mid-flight reversal automatically).
    typingTimerRef.current = setTimeout(() => notifyTyping(false), 1000);
  };
  useEffect(() => () => {
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    // On unmount, bring the orb back to idle if we were the ones who
    // turned it on — otherwise a snapshot stuck in 'thinking' would
    // outlive the component.
    if (wasTypingRef.current) {
      try { onTypingChange?.(false); } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const recognitionRef = useRef(null);

  // All fence-context lookups in this component MUST consume this memoized result.
  // Never call parseFences(value) directly — it walks the full string on every call.
  // Caret and key handlers branch off `parsedFences.fences` instead of reparsing
  // on every keystroke / selection event.
  const parsedFences = useMemo(() => parseFences(value), [value]);

  // Auto-resize the textarea up to a max height; past that it scrolls.
  // The overlay is absolutely positioned with `inset: 0`, so it follows
  // the shell (which sizes to the textarea) automatically — no separate
  // height bookkeeping needed here.
  useEffect(() => {
    if (!taRef.current) return;
    taRef.current.style.height = 'auto';
    taRef.current.style.height = Math.min(220, taRef.current.scrollHeight) + 'px';
  }, [value]);

  // After every commit: apply any pending caret position from the
  // setValue fallback path, then re-derive `inFence` from the current
  // textarea state. Runs before paint (useLayoutEffect) so the visual
  // indicator can't lag a frame behind the caret. Only sets state when
  // the boolean actually flips — flat int updates stay on the ref.
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    if (pendingCaretRef.current != null) {
      const target = pendingCaretRef.current;
      ta.selectionStart = ta.selectionEnd = target;
      pendingCaretRef.current = null;
    }
    const pos = ta.selectionStart;
    caretPosRef.current = pos;
    const next = fenceCtxAtParsed(parsedFences.fences, pos) !== null;
    setInFence((prev) => (prev === next ? prev : next));
    // Re-sync overlay scroll after any value change so the freshly
    // re-laid-out overlay matches the textarea's current scrollTop.
    if (overlayRef.current) {
      overlayRef.current.scrollTop = ta.scrollTop;
      overlayRef.current.scrollLeft = ta.scrollLeft;
    }
  });

  // Refresh the caret-position ref + derived inFence flag on selection
  // events. Cheap: an int write to a ref plus a setState that no-ops
  // unless the boolean actually changes. Memoized on `parsedFences` so
  // every invocation closes over the latest cached parse result without
  // forcing a re-parse of `value`.
  const syncCaret = useCallback(() => {
    const ta = taRef.current;
    if (!ta) return;
    const pos = ta.selectionStart;
    caretPosRef.current = pos;
    const next = fenceCtxAtParsed(parsedFences.fences, pos) !== null;
    setInFence((prev) => (prev === next ? prev : next));
  }, [parsedFences]);

  // Mirror the textarea's scroll position onto the overlay so long
  // content stays char-for-char aligned through wheel/keyboard scroll.
  const handleScroll = (e) => {
    const ta = e.currentTarget;
    if (overlayRef.current) {
      overlayRef.current.scrollTop = ta.scrollTop;
      overlayRef.current.scrollLeft = ta.scrollLeft;
    }
  };

  // execCommand('insertText') routes the mutation through the
  // browser's native undo stack, so Cmd+Z reverses just the inserted
  // snippet rather than the whole controlled-textarea state. Falls
  // back to a setValue path (handled by the caller via
  // `pendingCaretRef`) when execCommand returns false — Firefox can be
  // spotty here, especially inside React-controlled textareas, but
  // Chromium/Electron handles it cleanly.
  const insertTextWithUndo = (text, caretAfter) => {
    const ta = taRef.current;
    if (!ta) return false;
    if (document.activeElement !== ta) ta.focus();
    try {
      if (document.execCommand('insertText', false, text)) {
        ta.selectionStart = ta.selectionEnd = caretAfter;
        return true;
      }
    } catch {
      // Future Chromium may throw on the deprecated API. Fall through
      // to the caller's setValue fallback.
    }
    return false;
  };

  // ── "/" slash-command menu ─────────────────────────────────────────
  // Recompute the active slash token from the text + caret. Called on every
  // input/caret change; opens the menu when the caret sits in a "/<frag>"
  // token and closes it otherwise.
  const refreshSlash = useCallback((text, caret) => {
    const tok = detectSlashToken(text, caret);
    if (tok) {
      slashTokenStartRef.current = tok.start;
      setSlashQuery(tok.query);
      setSlashIndex(0);
      if (wrapRef.current) {
        const r = wrapRef.current.getBoundingClientRect();
        setSlashMenuBelow(r.top < 340);
      }
      setSlashOpen(true);
    } else {
      setSlashOpen((prev) => (prev ? false : prev));
    }
  }, []);

  // The menu items: a small built-in action row (matching the reference) plus
  // the live skills filtered by the typed fragment. Reads the shared store, so
  // saving/deleting a skill anywhere updates this list with no reload.
  const slashItems = useMemo(() => {
    if (!slashOpen) return [];
    const builtins = [
      { id: 'add-files', label: 'add-files', hint: 'Open file picker', kind: 'action',
        run: () => fileRef.current?.click() },
    ];
    const currentProject = project?.name;
    const skillRows = (allSkills || [])
      .filter((s) => {
        if (s.enabled === false) return false;
        const skillProject = s.projects?.[0] || s.project;
        if (!skillProject) return true;
        return skillProject === currentProject;
      })
      .map((s) => ({
        id: `skill:${s.label}`, label: s.label, hint: s.description || '', kind: 'skill', name: s.label,
      }));
    const all = [...builtins, ...skillRows];
    if (!slashQuery) return all;
    return all.filter(
      (i) => i.label.toLowerCase().includes(slashQuery) || (i.hint || '').toLowerCase().includes(slashQuery),
    );
  }, [slashOpen, slashQuery, allSkills, project]);

  const closeSlash = useCallback(() => setSlashOpen((prev) => (prev ? false : prev)), []);

  // Known skill names — the overlay colours only "/<known-skill>" tokens (not
  // arbitrary slashes like a file path), matching how the sent message tints
  // mentions. Kept as a Set for O(1) membership in the highlighter.
  const mentionNames = useMemo(
    () => new Set((allSkills || []).map((s) => s.label).filter(Boolean)),
    [allSkills],
  );

  // Accept an item: actions run after stripping the "/frag" token; skills are
  // inserted as a plain "/slug " mention (no backticks). The overlay + the sent
  // message colour any "/<known-skill>" token in the brand accent, so the
  // mention reads distinctly without literal backtick characters. Replacement
  // goes through insertTextWithUndo so Cmd+Z reverses it.
  const acceptSlash = useCallback((item) => {
    if (!item) return;
    const ta = taRef.current;
    const caret = ta ? ta.selectionStart : caretPosRef.current;
    const start = slashTokenStartRef.current;
    setSlashOpen(false);
    if (item.kind === 'action') {
      const next = value.slice(0, start) + value.slice(caret);
      pendingCaretRef.current = start;
      setValue(next);
      requestAnimationFrame(() => { try { item.run?.(); } catch { /* noop */ } });
      return;
    }
    const mention = '/' + item.name + ' ';
    const caretAfter = start + mention.length;
    if (ta) { ta.focus(); try { ta.setSelectionRange(start, caret); } catch { /* noop */ } }
    if (!insertTextWithUndo(mention, caretAfter)) {
      pendingCaretRef.current = caretAfter;
      setValue(value.slice(0, start) + mention + value.slice(caret));
    }
  }, [value]);

  // Edit-and-resend: when ChatView bumps `prefill`, drop the supplied
  // text into the composer and focus the textarea so the user can
  // immediately tweak + send. Guarded on `bump > 0` so the initial
  // `{text: '', bump: 0}` doesn't clobber a draft on mount.
  useEffect(() => {
    if (!prefill || !prefill.bump) return;
    setValue(prefill.text || '');
    setError('');
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (!ta) return;
      ta.focus();
      try {
        const end = (prefill.text || '').length;
        ta.setSelectionRange(end, end);
      } catch {}
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill?.bump]);

  // Close the open meta-pill menu on any press that isn't on the menu
  // popup itself or a trigger pill. The previous version only closed on
  // presses OUTSIDE the whole composer (`!wrapRef.contains`), which
  // wrongly treated the chat input (also inside the composer) as "inside
  // the menu" — so clicking the textarea left the menu open. Scoping to
  // `.menu` (any popup) + the trigger pills closes it for everything
  // else, the textarea included.
  useEffect(() => {
    if (!openMenu) return undefined;
    const handler = (e) => {
      const t = e.target;
      // Inside the open popup → keep open (items close themselves onClick).
      if (t?.closest?.('.menu')) return;
      // On a trigger pill → let its own onClick toggle it (closing here
      // would race it straight back open).
      if (t?.closest?.('.meta-pill, .composer-icon')) return;
      setOpenMenu(null);
      setConnectorsOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openMenu]);

  // Reset the project menu's transient state every time it closes, and
  // autofocus the search input on open so the user can start filtering
  // immediately (also doubles as "tap-to-type" on mobile where there's
  // no keyboard shortcut to open the menu).
  useEffect(() => {
    if (openMenu !== 'project') {
      setProjectSearch('');
      setProjectMenuBusy(false);
      setProjectMenuError('');
      return;
    }
    const id = requestAnimationFrame(() => {
      projectSearchRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [openMenu]);

  // Outside-click dismissal for every meta-pill menu (project / attach /
  // model) is handled in one place: the wrapRef `mousedown` listener
  // above. It closes whichever menu is open (they share `openMenu`) on a
  // press outside the composer. This works on desktop because the
  // content column (`<main>` in App.jsx) opts out of the window drag
  // region — otherwise Electron would swallow mouse events over the
  // canvas and the press would never reach the listener.

  // Filter + create logic shared by Enter-on-search-input and the
  // explicit create footer. Defined inside the component body so the
  // menu render can call into them without prop-drilling.
  const _projectSearchTrimmed = projectSearch.trim();
  const _filteredProjects = _projectSearchTrimmed
    ? projects.filter((p) => p.name.toLowerCase().includes(_projectSearchTrimmed.toLowerCase()))
    : projects;
  // Case-insensitive exact match short-circuits "create" so Enter on
  // a search term that already names a project selects it rather than
  // POSTing a duplicate (the server would reject anyway, but failing
  // fast on the client keeps the UX snappy).
  const _projectExactMatch = _projectSearchTrimmed
    ? projects.find((p) => p.name.toLowerCase() === _projectSearchTrimmed.toLowerCase())
    : null;
  const _canCreateFromSearch = !!onCreateProject && !!_projectSearchTrimmed && !_projectExactMatch;

  const createProjectFromSearch = async () => {
    if (!_canCreateFromSearch || projectMenuBusy) return;
    setProjectMenuBusy(true);
    setProjectMenuError('');
    try {
      const created = await onCreateProject({ name: _projectSearchTrimmed });
      if (created) onProjectChange?.(created);
      setOpenMenu(null);
    } catch (e) {
      setProjectMenuError(e?.message || 'Could not create project.');
    } finally {
      setProjectMenuBusy(false);
    }
  };

  const submitProjectSearch = () => {
    if (projectMenuBusy) return;
    // Any results → Enter selects the top match (or the exact match
    // when it's not at the top, e.g. an alphabetised list where the
    // exact "acme" sits below "acme-engineering" / "acme-marketing").
    if (_filteredProjects.length > 0) {
      const pick = _projectExactMatch || _filteredProjects[0];
      onProjectChange?.(pick);
      setOpenMenu(null);
      return;
    }
    // Zero results with text → create. Empty search is a no-op
    // (Enter on an empty filter shouldn't do anything surprising).
    if (_canCreateFromSearch) {
      createProjectFromSearch();
    }
  };

  const updateAttachPlacement = () => {
    const anchor = attachAnchorRef.current;
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const measured = attachMenuRef.current?.offsetHeight;
    const reserve = Math.max(measured ?? 0, ATTACH_MENU_TOP_RESERVE_PX) + 24;
    setAttachMenuBelow(r.top < reserve);
  };

  useLayoutEffect(() => {
    if (openMenu !== 'attach') return;
    updateAttachPlacement();
  }, [openMenu, connectorsOpen, busy, disabled]);

  async function handleAttachFiles(files) {
    if (!files?.length || !onAttachFiles) return;
    setError('');
    try {
      await Promise.resolve(onAttachFiles(files));
      setOpenMenu(null);
    } catch (err) {
      setError(err.message || 'Could not attach files.');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function handleAddGoogleDriveFiles() {
    if (!onAddGoogleDriveFiles || gdrivePickerBusy) return;
    setError('');
    setGdrivePickerBusy(true);
    setOpenMenu(null);
    try {
      await Promise.resolve(onAddGoogleDriveFiles(project?.name));
    } catch (err) {
      setError(err.message || 'Could not add Google Drive files.');
    } finally {
      setGdrivePickerBusy(false);
    }
  }

  // Drag OS files onto the composer to attach them to the message.
  const { isDragging: filesDragging, dropHandlers: fileDropHandlers } = useFileDrop({
    onFiles: handleAttachFiles,
    disabled: disabled || busy || !onAttachFiles,
  });

  // Paste (⌘V) an image/gif/file straight into the composer. A <textarea>
  // can't hold binary clipboard data, so without this the paste is a silent
  // no-op. Route any file items to the same attach path as drag-drop and the
  // file picker; a plain-text paste carries no file items and falls through
  // to the textarea's default handling.
  const handlePaste = (event) => {
    if (disabled || busy || !onAttachFiles) return;
    const files = extractClipboardFiles(event.clipboardData);
    if (!files.length) return;
    event.preventDefault();
    handleAttachFiles(files);
  };

  function pairKey(engine, name) {
    return `${String(engine || '').trim().toLowerCase()}\t${String(name || '').trim()}`;
  }

  function isConnectionDisabled(connector) {
    const k = pairKey(connector.engine, connector.name);
    return (disabledConnections || []).some((d) => pairKey(d.engine, d.name) === k);
  }

  const canMuteConnectors = typeof onUpdateConnectorMute === 'function';

  async function setConnectorUseInChat(connector, useInChat) {
    if (!canMuteConnectors) return;
    setBusy(true);
    setError('');
    try {
      await Promise.resolve(onUpdateConnectorMute(connector, useInChat));
    } catch (err) {
      setError(err?.message || 'Could not update datasource setting.');
    } finally {
      setBusy(false);
    }
  }

  const handleSend = async () => {
    if (disabled || !value.trim()) return;
    setBusy(true);
    try {
      await Promise.resolve(onSend(value.trim()));
      setValue('');
      // Clear the error only AFTER a successful send. Clearing it up
      // front meant a user hammering Send/Enter on a failing send wiped
      // the error before they could read it — the failure looked like a
      // silent no-op.
      setError('');
      if (taRef.current) taRef.current.style.height = 'auto';
    } catch (err) {
      setError(err?.message || 'Could not send.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => () => {
    const rec = recognitionRef.current;
    if (rec) { try { rec.abort(); } catch {} }
  }, []);

  return (
    <div ref={wrapRef} {...fileDropHandlers} style={{ width: '100%', maxWidth: 'var(--composer-max-width, 640px)', position: 'relative' }}>
      <FileDropOverlay active={filesDragging} label="Drop files to attach" />
      <input
        ref={fileRef}
        type="file"
        multiple
        hidden
        onChange={(event) => handleAttachFiles(event.target.files)}
      />

      <div style={{ width: '100%' }}>
        <div className={`composer-wrap${focused ? ' focused' : ''}${inFence ? ' in-fence' : ''}`} style={{ position: 'relative' }}>

          {/* "/" slash-command menu — anchored to composer-wrap so it appears
              just above/below the textarea, not below the toolbar. */}
          {slashOpen && slashItems.length > 0 && (
            <div
              className="menu"
              role="listbox"
              aria-label="Skills and actions"
              onMouseDown={(e) => e.preventDefault()}
              style={{
                position: 'absolute', left: 0, right: 0,
                ...(slashMenuBelow
                  ? { top: 'calc(100% + 8px)', bottom: 'auto' }
                  : { top: 'auto', bottom: 'calc(100% + 8px)' }),
                maxHeight: 'min(50vh, 320px)', overflowY: 'auto', padding: '4px 0', zIndex: 40,
              }}
            >
              {slashItems.map((item, i) => {
                const active = i === Math.min(slashIndex, slashItems.length - 1);
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="option"
                    aria-selected={active}
                    className="menu-item"
                    onMouseEnter={() => setSlashIndex(i)}
                    onClick={() => acceptSlash(item)}
                    style={active ? { background: 'var(--surface-2)' } : undefined}
                  >
                    <span style={{ display: 'inline-flex', color: 'var(--frost-700, var(--ink-3))' }}>
                      {item.kind === 'action' ? Ico.upload(15) : Ico.cube(15)}
                    </span>
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }}>
                      {item.label}
                    </span>
                    {item.hint && (
                      <span style={{ color: 'var(--ink-3)', fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '46%' }}>
                        {item.hint}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          {attachments.length > 0 && (
            <div className="attachment-strip">
              {attachments.map((attachment) => (
                <AttachmentChip key={attachment.id} attachment={attachment} onRemove={onRemoveAttachment} />
              ))}
            </div>
          )}

          <div className="composer-input-shell">
            <div
              ref={overlayRef}
              className="composer-textarea-overlay"
              aria-hidden="true"
            >
              <HighlightOverlay text={value} mentionNames={mentionNames} />
            </div>
            <textarea
            ref={taRef}
            className="composer-textarea"
            placeholder={placeholder}
            disabled={disabled}
            value={value}
            onChange={(e) => { setValue(e.target.value); bumpTyping(); refreshSlash(e.target.value, e.target.selectionStart); }}
            onPaste={handlePaste}
            onFocus={() => setFocused(true)}
            onBlur={() => { setFocused(false); setTimeout(() => closeSlash(), 120); }}
            onSelect={(e) => { syncCaret(); refreshSlash(e.target.value, e.target.selectionStart); }}
            onClick={(e) => { syncCaret(); refreshSlash(e.target.value, e.target.selectionStart); }}
            onScroll={handleScroll}
            onKeyDown={(e) => {
              if (disabled) return;

              // (S) Slash-command menu: intercept navigation/accept BEFORE the
              // send / fence logic so Enter picks an item instead of sending.
              if (slashOpen && slashItems.length > 0) {
                const n = slashItems.length;
                const idx = Math.min(slashIndex, n - 1);
                if (e.key === 'ArrowDown') { e.preventDefault(); setSlashIndex((idx + 1) % n); return; }
                if (e.key === 'ArrowUp')   { e.preventDefault(); setSlashIndex((idx - 1 + n) % n); return; }
                if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); acceptSlash(slashItems[idx]); return; }
                if (e.key === 'Escape')    { e.preventDefault(); closeSlash(); return; }
              }
              const ta = e.currentTarget;
              const pos = ta.selectionStart;
              const txt = value;
              const fences = parsedFences.fences;

              if (e.key === 'Enter') {
                // (A) Cmd/Ctrl+Enter sends from anywhere — including
                // inside a fence and even with Shift held.
                if (e.metaKey || e.ctrlKey) {
                  e.preventDefault();
                  handleSend();
                  return;
                }
                // Shift+Enter: default browser newline.
                if (e.shiftKey) return;

                // Inside a fenced block — Enter inserts a newline, never sends.
                const ctx = fenceCtxAtParsed(fences, pos);
                if (ctx) {
                  e.preventDefault();
                  if (!insertTextWithUndo('\n', pos + 1)) {
                    pendingCaretRef.current = pos + 1;
                    setValue(txt.slice(0, pos) + '\n' + txt.slice(pos));
                  }
                  return;
                }

                // (F) Closing-fence line ergonomics — if the caret is on
                // a paired closing fence line, insert a content line
                // ABOVE the closer and land on it, staying inside the
                // (now-extended) block.
                const lineStart = txt.lastIndexOf('\n', pos - 1) + 1;
                const onCloser = fences.find(
                  (f) => f.char === lineStart && !f.isOpening,
                );
                if (onCloser) {
                  e.preventDefault();
                  ta.selectionStart = ta.selectionEnd = lineStart;
                  if (!insertTextWithUndo('\n', lineStart)) {
                    pendingCaretRef.current = lineStart;
                    setValue(txt.slice(0, lineStart) + '\n' + txt.slice(lineStart));
                  }
                  return;
                }

                // Auto-expand on a clean opener line, only when the
                // parser's stack would be empty BEFORE this line —
                // i.e. the user is starting a fresh block, not closing
                // or interrupting a prior unbalanced one. Closer
                // length matches the opener's run length so
                // 4-backtick fences pair with 4-backtick closers.
                const lineEndIdx = txt.indexOf('\n', pos);
                const lineEnd = lineEndIdx === -1 ? txt.length : lineEndIdx;
                const currentLine = txt.slice(lineStart, lineEnd);
                const opener = parseOpenerLine(currentLine);
                if (opener && stackEmptyBeforeLine(txt, lineStart)) {
                  e.preventDefault();
                  const closer = '`'.repeat(opener.len);
                  const insertion = '\n\n' + closer;
                  const caretAfter = lineEnd + 1; // empty middle line
                  ta.selectionStart = ta.selectionEnd = lineEnd;
                  if (!insertTextWithUndo(insertion, caretAfter)) {
                    pendingCaretRef.current = caretAfter;
                    setValue(txt.slice(0, lineEnd) + insertion + txt.slice(lineEnd));
                  }
                  return;
                }

                // Default: send.
                e.preventDefault();
                handleSend();
                return;
              }

              // (B) Escape inside a fence — caret jumps to the line
              // right after the closing ```. If there's no line after,
              // append one. No content inserted inside the fence.
              if (e.key === 'Escape') {
                const ctx = fenceCtxAtParsed(fences, pos);
                if (!ctx) return;
                e.preventDefault();
                const afterClosingNL = txt.indexOf('\n', ctx.close.end);
                if (afterClosingNL === -1) {
                  ta.selectionStart = ta.selectionEnd = txt.length;
                  if (!insertTextWithUndo('\n', txt.length + 1)) {
                    pendingCaretRef.current = txt.length + 1;
                    setValue(txt + '\n');
                  }
                } else {
                  ta.selectionStart = ta.selectionEnd = afterClosingNL + 1;
                  syncCaret();
                }
                return;
              }

              if (e.key === 'ArrowDown') {
                const ctx = fenceCtxAtParsed(fences, pos);
                if (ctx) {
                  const lineEndIdx = txt.indexOf('\n', pos);
                  const lineEnd = lineEndIdx === -1 ? txt.length : lineEndIdx;
                  if (lineEnd >= ctx.contentEnd) {
                    e.preventDefault();
                    const afterClosingNL = txt.indexOf('\n', ctx.close.end);
                    const target = afterClosingNL === -1 ? txt.length : afterClosingNL + 1;
                    ta.selectionStart = ta.selectionEnd = target;
                    syncCaret();
                  }
                }
                return;
              }

              if (e.key === 'ArrowUp') {
                const lineStart = txt.lastIndexOf('\n', pos - 1) + 1;
                if (lineStart === 0) return;
                const prevLineEnd = lineStart - 1;
                const prevLineStart = txt.lastIndexOf('\n', prevLineEnd - 1) + 1;
                const prevLine = txt.slice(prevLineStart, prevLineEnd);
                if (/^`{3,}\s*$/.test(prevLine)) {
                  const idx = fences.findIndex((f) => f.char === prevLineStart);
                  if (idx >= 0 && !fences[idx].isOpening) {
                    e.preventDefault();
                    ta.selectionStart = ta.selectionEnd = prevLineStart - 1;
                    syncCaret();
                  }
                }
                return;
              }
            }}
            rows={1}
            spellCheck={false}
          />
          </div>

          <div className="composer-toolbar">
            <span
              ref={attachAnchorRef}
              style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}
            >
              <button
                className="composer-icon"
                title="Add context"
                disabled={disabled || busy}
                onClick={() => {
                  if (openMenu === 'attach') {
                    setOpenMenu(null);
                    return;
                  }
                  const anchor = attachAnchorRef.current;
                  if (anchor) {
                    const r = anchor.getBoundingClientRect();
                    setAttachMenuBelow(r.top < ATTACH_MENU_TOP_RESERVE_PX + 24);
                  } else setAttachMenuBelow(false);
                  setOpenMenu('attach');
                }}
              >
                {Ico.plus(15)}
              </button>
              {openMenu === 'attach' && (
                <div
                  ref={attachMenuRef}
                  className={`menu${attachMenuBelow ? ' menu--drop-down' : ''}`}
                  style={{
                    left: 0,
                    minWidth: 240,
                    ...(attachMenuBelow
                      ? { top: 'calc(100% + 6px)' }
                      : { bottom: 'calc(100% + 6px)' }),
                  }}
                >
                  <button className="menu-item" onClick={() => fileRef.current?.click()}>
                    {Ico.attach(14)} Attach files or photos
                  </button>
                  {onAddGoogleDriveFiles && (
                    <button
                      className="menu-item"
                      onClick={handleAddGoogleDriveFiles}
                      disabled={gdrivePickerBusy}
                    >
                      {Ico.googleDrive(14)} {gdrivePickerBusy ? 'Opening Google Drive…' : 'Add files from Google Drive'}
                    </button>
                  )}
                  <button
                    className="menu-item"
                    onClick={() => setConnectorsOpen((o) => !o)}
                    aria-expanded={connectorsOpen}
                  >
                    {Ico.link(14)}
                    <span style={{ flex: 1 }}>Connectors</span>
                    <span style={{ display: 'inline-flex', color: 'var(--frost-500)' }}>
                      {connectorsOpen ? Ico.chevDown(12) : Ico.chevRight(12)}
                    </span>
                  </button>
                  <div
                    className={`menu-connectors-accordion${connectorsOpen ? ' is-open' : ''}`}
                    aria-hidden={!connectorsOpen}
                  >
                    <div className="menu-connectors-accordion__inner">
                      <div
                        className="menu-connectors-accordion__scroll"
                        inert={!connectorsOpen || undefined}
                      >
                        {connectors.length === 0 ? (
                          <div style={{ padding: '8px 14px', fontSize: 12.5, color: 'var(--frost-600)' }}>
                            No connectors yet. Add one in{' '}
                            {onNavigateToConnectors ? (
                              <button
                                type="button"
                                onClick={navigateToConnectors}
                                style={{
                                  margin: 0,
                                  padding: 0,
                                  border: 0,
                                  background: 'transparent',
                                  color: 'var(--accent)',
                                  font: 'inherit',
                                  cursor: 'pointer',
                                  textDecoration: 'underline',
                                  textUnderlineOffset: 2,
                                }}
                              >
                                Connect Apps and Data
                              </button>
                            ) : (
                              'Connect Apps and Data'
                            )}
                            .
                          </div>
                        ) : (
                          connectors.map((c) => {
                            const muted = isConnectionDisabled(c);
                            return (
                              <div
                                key={`${c.engine}:${c.name}`}
                                className="menu-item"
                                style={{
                                  paddingLeft: 12,
                                  paddingRight: 12,
                                  cursor: 'default',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 10,
                                  flexWrap: 'nowrap',
                                }}
                                onMouseDown={(e) => e.stopPropagation()}
                              >
                                <span style={{ display: 'inline-flex', color: 'var(--frost-700)', flexShrink: 0 }}>{Ico.link(13)}</span>
                                <span style={{
                                  flex: '1 1 120px',
                                  minWidth: 0,
                                  display: 'flex',
                                  flexDirection: 'column',
                                  alignItems: 'flex-start',
                                  gap: 2,
                                }}
                                >
                                  <span style={{ fontWeight: 500 }}>{c.name}</span>
                                  <span style={{ fontSize: 11, color: 'var(--frost-600)' }}>{c.displayName || c.engine}</span>
                                </span>
                                {canMuteConnectors ? (
                                  <button
                                    type="button"
                                    role="switch"
                                    aria-checked={!muted}
                                    aria-label={muted ? `Enable ${c.name} for this chat` : `Disable ${c.name} for this chat`}
                                    className={`toggle${!muted ? ' on' : ''}`}
                                    disabled={busy}
                                    style={{ flexShrink: 0 }}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setConnectorUseInChat(c, muted);
                                    }}
                                  >
                                    <span className="toggle-thumb" />
                                  </button>
                                ) : null}
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </div>
                  {error && (
                    <div style={{ padding: '6px 14px', fontSize: 12, color: 'var(--danger-600, #b3261e)' }}>{error}</div>
                  )}
                </div>
              )}
            </span>
            <div style={{ flex: 1 }} />
            {/* Mic / voice input intentionally hidden — voice flow isn't
                wired through anton yet. We keep speechSupported state
                around so we can reinstate later by re-rendering the
                button (e.g. behind a `showMic` prop). */}
            {streaming && onStop ? (
              <button
                className="send-btn stop"
                onClick={onStop}
                title="Stop generation"
                aria-label="Stop generation"
                style={{
                  // Theme-aware "stop" treatment — uses the danger token
                  // on a soft tinted surface, with an outline that
                  // intensifies on hover. Matches the chat header
                  // unpublish button so the destructive vocabulary is
                  // consistent across surfaces.
                  background: 'var(--danger-bg)',
                  color: 'var(--danger)',
                  border: '1px solid color-mix(in srgb, var(--danger) 35%, transparent)',
                  boxShadow: 'none',
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.background = 'var(--danger)';
                  e.currentTarget.style.color = '#fff';
                  e.currentTarget.style.borderColor = 'var(--danger)';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.background = 'var(--danger-bg)';
                  e.currentTarget.style.color = 'var(--danger)';
                  e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--danger) 35%, transparent)';
                }}
              >
                {Ico.stop(14)}
              </button>
            ) : (
              <button
                className="send-btn"
                disabled={disabled || !value.trim() || busy}
                onClick={handleSend}
                title="Send"
              >
                {Ico.send(15)}
              </button>
            )}
          </div>
        </div>
      </div>

      {!hideMeta && (
        <div className="meta-row">
          {metaReadOnly ? (
            <>
              <span className="meta-pill" title="Project is fixed for this task">
                {Ico.folder(14)}
                <span>{project ? project.name : 'No project'}</span>
              </span>
              {!hideModel && (
                <span className="meta-pill" title="Model is fixed for this task">
                  <span>{model?.name ?? 'Model'}</span>
                </span>
              )}
            </>
          ) : (
            <>
              {/* Wrap the pill in its own relative anchor so the
                  menu (position: absolute) measures against the pill,
                  not against the composer wrap. Earlier the menu's
                  containing block was the wrap (~the whole composer),
                  so `bottom: calc(100% + 6px)` placed the menu above
                  the ENTIRE composer rather than just above the pill.
                  An inline-block span hugs the pill's box exactly. */}
              <span
                style={{ position: 'relative', display: 'inline-flex' }}
              >
                <button
                  ref={projectPillRef}
                  className="meta-pill"
                  onClick={() => setOpenMenu(openMenu === 'project' ? null : 'project')}
                  title="Choose project"
                >
                  {Ico.folder(14)}
                  <span>{project ? project.name : 'Work in a project'}</span>
                  <span style={{ display: 'inline-flex', color: 'var(--frost-500)' }}>{Ico.chevDown(13)}</span>
                </button>

                {openMenu === 'project' && !metaReadOnly && (
                  <div
                    ref={projectMenuRef}
                    className="menu menu--drop-down"
                    style={{
                      // Always drop downward from the pill. The
                      // earlier flip-up was over-engineering: the
                      // chat-view composer (which is glued to the
                      // viewport bottom) sets `metaReadOnly` and
                      // hides this menu entirely, so by construction
                      // every surface that opens the menu (home view,
                      // projects view) has plenty of room below. The
                      // menu's max-height + internal scroll caps it
                      // if the viewport is unusually short.
                      left: 0,
                      top: 'calc(100% + 6px)',
                      minWidth: 260,
                      maxHeight: 'min(60vh, 360px)',
                      display: 'flex', flexDirection: 'column',
                      overflow: 'hidden',
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* Search input — sticky header (first flex
                        child of a non-scrolling container). */}
                    <div style={{ padding: '4px 6px 6px' }}>
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        background: 'var(--surface-2)',
                        border: '1px solid var(--line)',
                        borderRadius: 6, padding: '4px 8px',
                      }}>
                        <span style={{ display: 'inline-flex', color: 'var(--frost-600)' }}>{Ico.folder(13)}</span>
                        <input
                          ref={projectSearchRef}
                          type="text"
                          value={projectSearch}
                          onChange={(e) => {
                            setProjectSearch(e.target.value);
                            setProjectMenuError('');
                          }}
                          placeholder={onCreateProject ? 'Search or create…' : 'Search projects…'}
                          disabled={projectMenuBusy}
                          spellCheck={false}
                          autoCapitalize="none"
                          autoCorrect="off"
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              submitProjectSearch();
                            } else if (e.key === 'Escape') {
                              e.preventDefault();
                              if (_projectSearchTrimmed) setProjectSearch('');
                              else setOpenMenu(null);
                            }
                          }}
                          style={{
                            flex: 1, minWidth: 0,
                            background: 'transparent', border: 0, outline: 'none',
                            color: 'var(--ink)', fontSize: 13,
                          }}
                        />
                      </div>
                    </div>

                    {/* Filtered project list — only scrollable region. */}
                    <div
                      className="project-menu-list"
                      style={{
                        flex: 1, minHeight: 0,
                        overflowY: 'auto',
                        padding: '2px 0',
                      }}
                    >
                      {_filteredProjects.length === 0 ? (
                        <div style={{
                          padding: '10px 12px', fontSize: 12,
                          color: 'var(--frost-600)',
                        }}>
                          {_projectSearchTrimmed
                            ? `No project matches “${_projectSearchTrimmed}”.`
                            : 'No projects yet.'}
                        </div>
                      ) : _filteredProjects.map((p) => (
                        <button
                          key={p.name}
                          className={`menu-item${project?.name === p.name ? ' checked' : ''}`}
                          onClick={() => { onProjectChange(p); setOpenMenu(null); }}
                        >
                          <span style={{ display: 'inline-flex', color: 'var(--frost-700)' }}>{Ico.folder(14)}</span>
                          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                          {project?.name === p.name && <span style={{ color: 'var(--primary-700)' }}>{Ico.check(14)}</span>}
                        </button>
                      ))}
                    </div>

                    {/* "+ New project" footer — always present when
                        `onCreateProject` is wired, so the create
                        affordance is discoverable without first
                        typing something into the search box (which
                        the previous "footer only when no match"
                        rule hid). Label adapts to the search state:
                          - empty            → "New project"
                                                (focuses the search
                                                 input on click).
                          - typed, no match  → "Create '<text>'"
                                                (calls create).
                          - typed, exact     → hidden (no duplicates).
                    */}
                    {onCreateProject && !_projectExactMatch && (
                      <>
                        <div style={{ height: 1, background: 'var(--border-0)', margin: '2px 0' }} />
                        <button
                          className="menu-item"
                          disabled={projectMenuBusy}
                          onClick={() => {
                            if (_canCreateFromSearch) {
                              createProjectFromSearch();
                            } else {
                              projectSearchRef.current?.focus();
                            }
                          }}
                          style={{ color: 'var(--primary-700)' }}
                        >
                          <span style={{ display: 'inline-flex', color: 'var(--primary-700)' }}>{Ico.plus(14)}</span>
                          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {projectMenuBusy
                              ? 'Creating…'
                              : (_canCreateFromSearch
                                  ? <>Create <strong style={{ fontWeight: 600 }}>“{_projectSearchTrimmed}”</strong></>
                                  : 'New project')}
                          </span>
                        </button>
                      </>
                    )}

                    {projectMenuError && (
                      <div style={{
                        padding: '6px 10px', fontSize: 11.5,
                        color: 'var(--danger)',
                        borderTop: '1px solid var(--border-0)',
                      }}>
                        {projectMenuError}
                      </div>
                    )}
                  </div>
                )}
              </span>
              {!hideModel && (
                <button
                  className="meta-pill"
                  onClick={() => setOpenMenu(openMenu === 'model' ? null : 'model')}
                  title="Choose model"
                >
                  <span>{model?.name ?? 'Select model'}</span>
                  <span style={{ display: 'inline-flex', color: 'var(--frost-500)' }}>{Ico.chevDown(13)}</span>
                </button>
              )}
            </>
          )}
        </div>
      )}

      {openMenu === 'model' && !metaReadOnly && (
        <div className="menu" style={{ right: 8, top: 'calc(100% + 6px)', minWidth: 260 }}>
          <div style={{ padding: '6px 10px', fontSize: 11, fontWeight: 600, color: 'var(--frost-600)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Model</div>
          {models.map((m) => (
            <button
              key={m.id}
              className={`menu-item${model?.id === m.id ? ' checked' : ''}`}
              onClick={() => { onModelChange(m); setOpenMenu(null); }}
              style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                <span style={{ flex: 1, fontWeight: 500 }}>{m.name}</span>
                {model?.id === m.id && <span style={{ color: 'var(--primary-700)' }}>{Ico.check(14)}</span>}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--frost-600)' }}>{m.desc}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
