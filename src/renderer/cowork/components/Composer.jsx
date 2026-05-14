import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Ico from './Icons';
import {
  parseFences,
  fenceCtxAtParsed,
  stackEmptyBeforeLine,
  parseOpenerLine,
} from './composerFences';
import { HighlightOverlay } from './composerHighlight';

function AttachmentChip({ attachment, onRemove }) {
  const src = attachment.source || attachment.kind || 'file';
  const isImage = attachment.mime && String(attachment.mime).startsWith('image/');
  const label = src === 'connector' ? 'Connector' : isImage ? 'Image' : 'File';
  const status = attachment.pendingFile
    ? 'Queued'
    : (attachment.extractionStatus && attachment.extractionStatus !== 'ready'
      ? attachment.extractionStatus.replace('_', ' ')
      : null);
  return (
    <div className="attachment-chip" title={attachment.note || attachment.textPreview || attachment.name}>
      <span className="attachment-chip-icon">
        {src === 'connector' ? Ico.link(13)
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
  onAttachFiles,
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
}) {
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const [openMenu, setOpenMenu] = useState(null);
  /** Attach menu opens above the composer by default; flip down when clipped (e.g. project view composer at scroll top). */
  const [attachMenuBelow, setAttachMenuBelow] = useState(false);
  const [connectorsOpen, setConnectorsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [listening, setListening] = useState(false);
  /** True when the caret is currently inside a fenced block. The boolean
      changes much less often than the caret itself, so we track caret
      position in a ref and only set state on the derived flag. */
  const [inFence, setInFence] = useState(false);
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

  // Memoized fence parse — recomputed only when `value` changes. Caret
  // and key handlers branch off this instead of reparsing the full
  // composer string on every keystroke / selection event.
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
  // unless the boolean actually changes.
  const syncCaret = () => {
    const ta = taRef.current;
    if (!ta) return;
    const pos = ta.selectionStart;
    caretPosRef.current = pos;
    const next = fenceCtxAtParsed(parsedFences.fences, pos) !== null;
    setInFence((prev) => (prev === next ? prev : next));
  };

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

  useEffect(() => {
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpenMenu(null);
        setConnectorsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

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
    setError('');
    setBusy(true);
    try {
      await Promise.resolve(onSend(value.trim()));
      setValue('');
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
    <div ref={wrapRef} style={{ width: '100%', maxWidth: 'var(--composer-max-width, 640px)', position: 'relative' }}>
      <input
        ref={fileRef}
        type="file"
        multiple
        hidden
        onChange={(event) => handleAttachFiles(event.target.files)}
      />

      <div style={{ width: '100%' }}>
        <div className={`composer-wrap${focused ? ' focused' : ''}${inFence ? ' in-fence' : ''}`}>
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
              <HighlightOverlay text={value} />
            </div>
            <textarea
            ref={taRef}
            className="composer-textarea"
            placeholder={placeholder}
            disabled={disabled}
            value={value}
            onChange={(e) => { setValue(e.target.value); bumpTyping(); }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onSelect={syncCaret}
            onClick={syncCaret}
            onScroll={handleScroll}
            onKeyDown={(e) => {
              if (disabled) return;
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
                            No connectors yet. Add one in Utilities → Datasources.
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
                {Ico.stop(11)}
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
              <button
                className="meta-pill"
                onClick={() => setOpenMenu(openMenu === 'project' ? null : 'project')}
                title="Choose project"
              >
                {Ico.folder(14)}
                <span>{project ? project.name : 'Work in a project'}</span>
                <span style={{ display: 'inline-flex', color: 'var(--frost-500)' }}>{Ico.chevDown(13)}</span>
              </button>
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

      {openMenu === 'project' && !metaReadOnly && (
        <div className="menu" style={{ left: 8, top: 'calc(100% + 6px)', minWidth: 240 }}>
          <div style={{ padding: '6px 10px', fontSize: 11, fontWeight: 600, color: 'var(--frost-600)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Projects</div>
          {projects.map((p) => (
            <button
              key={p.name}
              className={`menu-item${project?.name === p.name ? ' checked' : ''}`}
              onClick={() => { onProjectChange(p); setOpenMenu(null); }}
            >
              <span style={{ display: 'inline-flex', color: 'var(--frost-700)' }}>{Ico.folder(14)}</span>
              <span style={{ flex: 1 }}>{p.name}</span>
              {project?.name === p.name && <span style={{ color: 'var(--primary-700)' }}>{Ico.check(14)}</span>}
            </button>
          ))}
          <div style={{ height: 1, background: 'var(--border-0)', margin: '4px 0' }} />
          <button className="menu-item" onClick={() => { onProjectChange(null); setOpenMenu(null); }}>
            <span style={{ display: 'inline-flex', color: 'var(--frost-700)' }}>{Ico.plus(14)}</span>
            <span>No project</span>
          </button>
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
