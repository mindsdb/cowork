import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Ico from '../Icons';
import { Button } from '../ui';
import { MarkdownContent } from '../markdown/MarkdownContent';
import { ThinkingBlock } from '../thinking/ThinkingBlock';
import { WorkingIndicator } from '../thinking/WorkingIndicator';

const MIN_W = 300;
const MAX_W = 480;

const QUICK_CHIPS = [
  'Summarize this page',
  'Extract key data',
  'Fill this form for me',
  'Research this topic',
];

function clampWidth(w) {
  return Math.max(MIN_W, Math.min(MAX_W, Math.round(w)));
}

function UserBubble({ children }) {
  return (
    <div style={{
      alignSelf: 'flex-end', maxWidth: '85%',
      background: 'var(--surface-3)', color: 'var(--ink)',
      borderRadius: 18, padding: '8px 12px',
      fontSize: 13, lineHeight: 1.45,
      whiteSpace: 'pre-wrap', overflowWrap: 'break-word',
      userSelect: 'text',
    }}>
      {children}
    </div>
  );
}

// Friendly failure surface for a turn whose stream errored — the raw
// error text is detail, not the headline, and Retry re-sends the last
// user message.
function ErrorTurn({ msg, onRetry }) {
  return (
    <div style={{
      alignSelf: 'stretch', minWidth: 0, fontSize: 13,
      display: 'flex', alignItems: 'flex-start', gap: 8,
    }}>
      <span style={{ display: 'inline-flex', flex: '0 0 auto', marginTop: 1, color: 'var(--danger)' }}>
        {Ico.warning(14)}
      </span>
      <div style={{ flex: 1, minWidth: 0, lineHeight: 1.45 }}>
        <div style={{ color: 'var(--danger)' }}>
          The agent couldn't be reached — is the server running?
        </div>
        {msg.content && (
          <div style={{
            marginTop: 2, fontSize: 12, color: 'var(--ink-4)',
            overflowWrap: 'break-word',
          }}>
            {msg.content}
          </div>
        )}
        {onRetry && (
          <div style={{ marginTop: 8 }}>
            <Button variant="default" size="sm" onClick={onRetry}>Retry</Button>
          </div>
        )}
      </div>
    </div>
  );
}

function AssistantTurn({ msg, conversationId, onRetry }) {
  if (msg.isError) return <ErrorTurn msg={msg} onRetry={onRetry} />;
  return (
    <div style={{ alignSelf: 'stretch', minWidth: 0, fontSize: 13 }}>
      {msg.steps?.length > 0 && (
        // No onActivateStep — steps render non-interactive here. The dock
        // has no ScratchpadModal to activate them into (ChatView wires
        // one); without the callback ThinkingStep attaches no click
        // handler or pointer cursor.
        <ThinkingBlock steps={msg.steps} startedAt={msg.startedAt} isActive={false} />
      )}
      {msg.content && (
        <MarkdownContent
          text={msg.content}
          id={msg.id}
          complete
          conversationId={conversationId}
        />
      )}
    </div>
  );
}

function LiveTurn({ live, conversationId }) {
  const thinking = live.status !== 'streaming' && live.status !== 'done';
  const currentLabel = [...(live.steps || [])].reverse().find((s) => s.status === 'in_progress')?.label || null;
  return (
    <div style={{ alignSelf: 'stretch', minWidth: 0, fontSize: 13 }}>
      {live.steps?.length > 0 && (
        <ThinkingBlock
          steps={live.steps}
          startedAt={live.startedAt}
          isActive={thinking}
          currentLabel={currentLabel}
        />
      )}
      {!live.steps?.length && !live.bodyText && (
        <WorkingIndicator label="Thinking…" />
      )}
      {live.bodyText && (
        <MarkdownContent
          text={live.bodyText}
          id="browser-agent-live"
          complete={false}
          conversationId={conversationId}
        />
      )}
    </div>
  );
}

function Composer({ streaming, onSend, onStop }) {
  const [value, setValue] = useState('');
  const taRef = useRef(null);

  const autoGrow = () => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    // Cap at ~5 rows (13px × 1.45 ≈ 19px/row + 16px vertical padding).
    el.style.height = `${Math.min(el.scrollHeight, 111)}px`;
    el.style.overflowY = el.scrollHeight > 111 ? 'auto' : 'hidden';
  };

  const submit = () => {
    const text = value.trim();
    if (!text || streaming) return;
    onSend(text);
    setValue('');
    requestAnimationFrame(() => {
      if (taRef.current) { taRef.current.style.height = 'auto'; taRef.current.style.overflowY = 'hidden'; }
    });
  };

  const canSend = value.trim().length > 0 && !streaming;
  return (
    <div style={{ padding: '10px 12px', borderTop: '1px solid var(--line)', flex: '0 0 auto' }}>
      <div className="browser-composer" style={{
        display: 'flex', alignItems: 'flex-end', gap: 8, padding: '8px 8px 8px 12px',
      }}>
        <textarea
          ref={taRef}
          rows={1}
          value={value}
          placeholder="Ask about this page…"
          aria-label="Message the Browser Agent"
          onChange={(e) => { setValue(e.target.value); autoGrow(); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
          }}
        />
        {/* House send/stop language: .send-btn + the Composer's danger
            stop treatment (tinted at rest, solid danger on hover). */}
        {streaming ? (
          <button
            type="button"
            className="send-btn stop"
            onClick={onStop}
            title="Stop generation"
            aria-label="Stop generating"
            style={{
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
            type="button"
            className="send-btn"
            disabled={!canSend}
            onClick={submit}
            title="Send"
            aria-label="Send"
          >
            {Ico.send(15)}
          </button>
        )}
      </div>
    </div>
  );
}

// The right-side agent panel — the browser's copilot. Wide screens: a
// resizable column the parent grid animates in/out (380ms easeOutExpo);
// narrow (<900px): a fixed full-height drawer with a click-away scrim.
export default function AgentDock({
  open,
  width,
  onResize,
  onResizingChange,
  onClose,
  narrow,
  agent,
}) {
  const { messages, live, streaming, send, stop, getConversationId } = agent;
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef(null);
  const scrollRef = useRef(null);
  const conversationId = getConversationId();

  // Follow the stream only while the user is pinned to the bottom —
  // scrolling up mid-turn must not yank the transcript back down. The
  // pin re-arms within 40px of the bottom, and on every new send.
  const pinnedRef = useRef(true);
  const handleTranscriptScroll = (e) => {
    const el = e.currentTarget;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 40;
  };
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [messages.length, live?.bodyText, live?.steps?.length, open]);

  const handleSend = (text) => {
    pinnedRef.current = true;
    send(text);
  };

  // Retry target for error turns — the most recent user message.
  let lastUserText = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user' && messages[i].content) {
      lastUserText = messages[i].content;
      break;
    }
  }

  // End the drag if the dock closes mid-gesture or the view unmounts
  // mid-gesture (route leave) — the parent must re-show the native view.
  useEffect(() => {
    if (!open) setDragging(false);
  }, [open]);
  useEffect(() => () => onResizingChange?.(false), [onResizingChange]);

  // Pointer capture (not window listeners): while captured, every move/up
  // for this pointer retargets to the resizer element no matter where the
  // cursor goes, and React drops the handlers on unmount — no leaks. The
  // parent hides the native WebContentsView for the drag's duration: it's
  // an OS-level view above the DOM that swallows pointer events, so a
  // leftward resize would otherwise stall instantly.
  const startDrag = (e) => {
    if (narrow || !onResize) return;
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startWidth: width, pointerId: e.pointerId };
    setDragging(true);
    onResizingChange?.(true);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
  };
  const moveDrag = (e) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    onResize(clampWidth(d.startWidth + (d.startX - e.clientX)));
  };
  const endDrag = (e) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    onResizingChange?.(false);
  };

  const empty = messages.length === 0 && !live;

  const panel = (
    <aside
      aria-label="Browser Agent"
      aria-hidden={!open}
      className={narrow ? 'browser-dock-drawer' : 'browser-dock-panel'}
      style={narrow ? {
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 'min(340px, calc(100vw - 32px))',
        zIndex: 60,
        transform: open ? 'translateX(0)' : 'translateX(calc(100% + 8px))',
        boxShadow: open ? 'var(--sh-3)' : 'none',
        pointerEvents: open ? 'auto' : 'none',
        // visibility (not just opacity/transform) keeps the closed panel
        // out of the tab order and the a11y tree; the CSS transition
        // delays the flip until the slide/fade completes.
        visibility: open ? 'visible' : 'hidden',
        background: 'var(--surface)',
        borderLeft: '1px solid var(--line)',
        display: 'flex', flexDirection: 'column',
        fontFamily: 'var(--font-body)',
      } : {
        width, minWidth: width, height: '100%',
        background: 'var(--surface)',
        borderLeft: '1px solid var(--line)',
        display: 'flex', flexDirection: 'column',
        position: 'relative', overflow: 'hidden',
        fontFamily: 'var(--font-body)',
        opacity: open ? 1 : 0,
        visibility: open ? 'visible' : 'hidden',
        pointerEvents: open ? 'auto' : 'none',
        userSelect: dragging ? 'none' : 'auto',
      }}
    >
      {!narrow && open && (
        <div
          className={`browser-dock-resizer${dragging ? ' is-dragging' : ''}`}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize Browser Agent panel"
          aria-valuenow={width}
          aria-valuemin={MIN_W}
          aria-valuemax={MAX_W}
          tabIndex={0}
          onKeyDown={(e) => {
            // The dock sits on the right: ← widens, → narrows.
            if (e.key === 'ArrowLeft') { e.preventDefault(); onResize?.(clampWidth(width + 16)); }
            else if (e.key === 'ArrowRight') { e.preventDefault(); onResize?.(clampWidth(width - 16)); }
          }}
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        />
      )}

      {/* Header */}
      <div style={{
        height: 40, flex: '0 0 auto',
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '0 12px',
        borderBottom: '1px solid var(--line)',
      }}>
        <span style={{ display: 'inline-flex', color: 'var(--accent)' }}>{Ico.sparkle(14)}</span>
        <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
          Browser Agent
        </span>
        {streaming && (
          <span
            className="browser-pulse"
            title="Agent is working"
            style={{
              width: 7, height: 7, borderRadius: '50%',
              background: 'var(--accent)', flex: '0 0 auto',
            }}
          />
        )}
        <button
          type="button"
          className="icon-btn"
          aria-label="Close Browser Agent"
          onClick={onClose}
        >
          {Ico.close(13)}
        </button>
      </div>

      {/* Body */}
      {empty ? (
        <div style={{
          flex: 1, minHeight: 0, overflowY: 'auto',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: '24px 20px', gap: 6, textAlign: 'center',
        }}>
          <span style={{
            width: 44, height: 44, borderRadius: '50%',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--accent-bg)', color: 'var(--accent)',
            marginBottom: 6,
          }}>
            {Ico.sparkle(20)}
          </span>
          <div className="s-h3" style={{ fontSize: 15 }}>Your browsing copilot</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-3)', maxWidth: '30ch', lineHeight: 1.5 }}>
            It can see and drive these tabs — ask it to read, click, fill, or research.
          </div>
          <div style={{
            display: 'flex', flexWrap: 'wrap', justifyContent: 'center',
            gap: 8, marginTop: 16,
          }}>
            {QUICK_CHIPS.map((chip) => (
              <button
                key={chip}
                type="button"
                className="browser-chip"
                onClick={() => handleSend(chip)}
              >
                {chip}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div
          ref={scrollRef}
          className="scroll-clean"
          aria-live="polite"
          onScroll={handleTranscriptScroll}
          style={{
            flex: 1, minHeight: 0, overflowY: 'auto',
            padding: 12,
            display: 'flex', flexDirection: 'column', gap: 12,
            // body is user-select:none — opt the transcript back in so
            // replies can be selected/copied (same as ChatView).
            userSelect: 'text',
          }}
        >
          {messages.map((m, i) => m.role === 'user' ? (
            <UserBubble key={m.id || `u-${i}`}>{m.content}</UserBubble>
          ) : (
            <AssistantTurn
              key={m.id || `a-${i}`}
              msg={m}
              conversationId={conversationId}
              onRetry={m.isError && lastUserText ? () => handleSend(lastUserText) : undefined}
            />
          ))}
          {live && <LiveTurn live={live} conversationId={conversationId} />}
        </div>
      )}

      <Composer streaming={streaming} onSend={handleSend} onStop={stop} />
    </aside>
  );

  if (!narrow) return panel;
  return (
    <>
      <div
        aria-hidden="true"
        className="browser-dock-scrim"
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 59,
          background: 'color-mix(in srgb, var(--ink) 18%, transparent)',
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
        }}
      />
      {panel}
    </>
  );
}
