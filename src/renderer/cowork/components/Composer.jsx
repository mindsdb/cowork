import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Ico from './Icons';

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
  const taRef = useRef(null);
  const fileRef = useRef(null);
  const wrapRef = useRef(null);
  const composerStageRef = useRef(null);
  const attachMenuRef = useRef(null);

  /** Space we want cleared above the composer before opening the menu upward (~collapsed height + margin). */
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

  useEffect(() => {
    if (!taRef.current) return;
    taRef.current.style.height = 'auto';
    taRef.current.style.height = Math.min(220, taRef.current.scrollHeight) + 'px';
  }, [value]);

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
    const stage = composerStageRef.current;
    if (!stage) return;
    const r = stage.getBoundingClientRect();
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

      <div ref={composerStageRef} style={{ position: 'relative', width: '100%' }}>
        <div className={`composer-wrap${focused ? ' focused' : ''}`}>
          {attachments.length > 0 && (
            <div className="attachment-strip">
              {attachments.map((attachment) => (
                <AttachmentChip key={attachment.id} attachment={attachment} onRemove={onRemoveAttachment} />
              ))}
            </div>
          )}

          <textarea
            ref={taRef}
            className="composer-textarea"
            placeholder={placeholder}
            disabled={disabled}
            value={value}
            onChange={(e) => { setValue(e.target.value); bumpTyping(); }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={(e) => {
              if (!disabled && e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            rows={1}
          />

          <div className="composer-toolbar">
            <button
              className="composer-icon"
              title="Add context"
              disabled={disabled || busy}
              onClick={() => {
                if (openMenu === 'attach') {
                  setOpenMenu(null);
                  return;
                }
                const stage = composerStageRef.current;
                if (stage) {
                  const r = stage.getBoundingClientRect();
                  setAttachMenuBelow(r.top < ATTACH_MENU_TOP_RESERVE_PX + 24);
                } else setAttachMenuBelow(false);
                setOpenMenu('attach');
              }}
            >
              {Ico.plus(15)}
            </button>
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
          {connectorsOpen && (
            <div style={{
              borderTop: '1px solid var(--border-0)',
              marginTop: 4, paddingTop: 4,
              maxHeight: 220, overflowY: 'auto',
            }}>
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
          )}
          {error && (
            <div style={{ padding: '6px 14px', fontSize: 12, color: 'var(--danger-600, #b3261e)' }}>{error}</div>
          )}
        </div>
        )}
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
