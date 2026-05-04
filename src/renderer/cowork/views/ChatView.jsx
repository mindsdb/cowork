/* Anton Chat — Direction A: Conservative.
   Near-1:1 port of docs/design-guidelines/chat.html (ChatConservative).
   Editorial, document-like. Inter body, Josefin display, mono for operator
   metadata. Centered ~720px column, OrbitMorph-led Anton turns, floating
   composer, right rail with collapsible cards.

   Wired against the live message model (role: user|assistant|error|activity,
   plus _streaming) and our real Composer + project/model state. Tokens come
   from CSS vars so the panel reads correctly in both light and dark themes. */

import { useEffect, useMemo, useRef, useState } from 'react';
import Ico from '../components/Icons';
import Composer from '../components/Composer';
import { OrbitMorph } from '../components/ui';
import { MarkdownContent } from '../components/markdown/MarkdownContent';
import { ThinkingBlock } from '../components/thinking/ThinkingBlock';
import { OrbitProvider, useOrbitSlot } from '../lib/orbitRegistry';
import { PhaseProgress } from '../components/thinking/PhaseProgress';
import { TaskMenu } from '../components/TaskMenu';
import { ScratchpadModal } from '../components/thinking/ScratchpadModal';
import { WorkingFolderLive } from '../components/rail/WorkingFolderLive';
import { ContextCard } from '../components/rail/ContextCard';

// Token shorthand mapped to our globals.css custom properties so the same
// inline-styled JSX picks up the active theme.
const T = {
  bg:       'var(--bg)',
  surface:  'var(--surface)',
  surface2: 'var(--surface-2)',
  surface3: 'var(--surface-3)',
  line:     'var(--line)',
  line2:    'var(--line)',
  ink:      'var(--ink)',
  ink2:     'var(--ink-2)',
  ink3:     'var(--ink-3)',
  ink4:     'var(--ink-4)',
  accent:   'var(--accent)',
  success:  '#1F8F5F',
};

const FONT_DISPLAY = "'Josefin Sans', sans-serif";
const FONT_MONO    = "'JetBrains Mono', monospace";
const FONT_BODY    = "'Inter', system-ui, sans-serif";

// ─── small shared atoms ──────────────────────────────────────────────────
function formatTime(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function dividerLabel(date = new Date()) {
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  const month = date.toLocaleString('en-US', { month: 'short' });
  return `${sameDay ? 'Today' : date.toLocaleString('en-US', { weekday: 'short' })} · ${month} ${date.getDate()}`;
}

function Divider({ label }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      fontFamily: FONT_DISPLAY, fontWeight: 600, letterSpacing: '0.18em',
      fontSize: 10.5, color: T.ink4, textTransform: 'uppercase',
      marginTop: 8,
    }}>
      <span style={{ flex: 1, height: 1, background: T.line }} />
      <span>{label}</span>
      <span style={{ flex: 1, height: 1, background: T.line }} />
    </div>
  );
}

function MessageActions({ getText }) {
  // Just Copy for now — refresh / thumbs up / thumbs down hidden until
  // the underlying actions are wired.
  const onCopy = () => {
    try {
      const text = typeof getText === 'function' ? getText() : '';
      if (text) navigator.clipboard?.writeText?.(text);
    } catch {}
  };
  return (
    <div style={{ display: 'flex', gap: 4, marginTop: 4, color: T.ink4 }}>
      <button
        type="button"
        title="Copy"
        onClick={onCopy}
        style={{
          cursor: 'pointer',
          background: 'transparent',
          border: 0,
          padding: 0,
          width: 26, height: 26, borderRadius: 6,
          display: 'grid', placeItems: 'center',
          color: 'inherit',
        }}
      >
        {Ico.copy(13)}
      </button>
    </div>
  );
}

// ─── User pill ───────────────────────────────────────────────────────────
function UserTurn({ content, attachments, time }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
      <div style={{ maxWidth: '78%', display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
        <div style={{
          background: T.surface,
          border: `1px solid ${T.line}`,
          borderRadius: 18,
          padding: '14px 18px',
          fontFamily: FONT_BODY,
          fontSize: 14.5, lineHeight: 1.55, color: T.ink,
          boxShadow: '0 1px 0 rgba(15,16,17,0.02)',
          whiteSpace: 'pre-wrap',
          userSelect: 'text',
        }}>
          {content}
        </div>
        {attachments?.map((a) => (
          <div key={a.id} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            background: T.surface, border: `1px solid ${T.line}`,
            borderRadius: 12, padding: '8px 12px',
            fontFamily: FONT_BODY, fontSize: 12.5, color: T.ink2,
          }}>
            <span style={{ color: T.ink3, display: 'inline-flex' }}>
              {a.kind === 'url' ? Ico.globe(13) : a.kind === 'snippet' ? Ico.code(13) : Ico.doc(13)}
            </span>
            <span style={{ color: T.ink }}>{a.name || (a.kind === 'url' ? 'URL' : a.kind === 'snippet' ? 'Snippet' : 'File')}</span>
            <span style={{ fontFamily: FONT_MONO, fontSize: 10.5, color: T.ink4 }}>
              {a.size || a.extractionStatus || ''}
            </span>
          </div>
        ))}
        {time && (
          <span style={{ fontFamily: FONT_MONO, fontSize: 10.5, color: T.ink4, letterSpacing: '0.04em' }}>
            you · {time}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Anton answer turn — content stack ────────────────────────────────────
// `slotIdHeader` lets the parent register this turn's ANTON label as an
// orb anchor (used while the request is "thinking" with no steps yet).
function AnswerTurn({ state = 'done', time, children, showActions = true, copyText, slotIdHeader }) {
  const headerRef = useOrbitSlot(slotIdHeader || `__none__:${Math.random()}`);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 4 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        {/* Wrap the ANTON wordmark so the orb can anchor over it. The
            slot only registers when slotIdHeader is provided. */}
        <span ref={slotIdHeader ? headerRef : undefined} style={{
          fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 13,
          letterSpacing: '0.14em', textTransform: 'uppercase', color: T.ink,
          // Reserve a little space so the orb has room when it lands here.
          paddingLeft: slotIdHeader ? 28 : 0,
        }}>Anton</span>
        {time && (
          <span style={{ fontFamily: FONT_MONO, fontSize: 10.5, color: T.ink4, letterSpacing: '0.04em' }}>
            {state === 'thinking' ? `${time} · drafting` : time}
          </span>
        )}
      </div>
      {children}
      {showActions && state !== 'thinking' && <MessageActions getText={() => copyText || ''} />}
    </div>
  );
}

function TextBlock({ text, id, complete = true }) {
  // Full markdown rendering — GFM tables, lists, code blocks (with
  // chartjs/chart support), links, etc. via react-markdown + our
  // MarkdownContent override map.
  return <MarkdownContent text={text} id={id} complete={complete} />;
}

// Convert an artifact step (from the SSE adapter, badge='Artifact')
// into the shape ArtifactCard expects. Used to render inline cards
// at the end of an assistant turn — like mdb-ai surfaces results.
function artifactStepToCard(step) {
  const data = step.data || {};
  return {
    title: data.title || step.label || 'Artifact',
    kind: data.action ? `${data.action}` : 'live artifact',
    icon: 'doc',
    file_path: data.file_path,
    preview: data.file_path ? [{ heading: data.file_path }] : [],
  };
}

// Renders any badge='Artifact' steps as inline ArtifactCards.
function StepArtifacts({ steps }) {
  const artifacts = steps?.filter((s) => s.badge === 'Artifact') || [];
  if (artifacts.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 4 }}>
      {artifacts.map((s) => <ArtifactCard key={s.id} artifact={artifactStepToCard(s)} />)}
    </div>
  );
}

function ArtifactCard({ artifact }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '64px 1fr auto', alignItems: 'center', gap: 16,
      background: T.surface, border: `1px solid ${T.line}`,
      borderRadius: 14, padding: '14px 16px',
      boxShadow: '0 1px 0 rgba(15,16,17,0.02), 0 8px 20px rgba(15,16,17,0.04)',
    }}>
      <div style={{
        width: 64, height: 64, background: T.surface2, borderRadius: 8,
        display: 'grid', placeItems: 'center', color: T.accent,
      }}>
        {artifact.icon === 'doc' ? Ico.doc(26) : Ico.sparkle(26)}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
        <span style={{
          fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 16, color: T.ink,
          letterSpacing: '0.01em',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{artifact.title}</span>
        <span style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: T.ink3 }}>
          {artifact.kind || 'live artifact'}
        </span>
        {artifact.preview?.[0]?.text && (
          <span style={{ fontFamily: FONT_MONO, fontSize: 10.5, color: T.ink4, marginTop: 2, letterSpacing: '0.04em' }}>
            {artifact.preview[0].heading || artifact.preview[0].text}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <SmallBtn>View</SmallBtn>
        <SmallBtn primary>Open</SmallBtn>
      </div>
    </div>
  );
}

function SmallBtn({ primary, children }) {
  return (
    <button style={{
      all: 'unset', cursor: 'pointer',
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '6px 10px', borderRadius: 7,
      background: primary ? T.accent : T.surface,
      color: primary ? '#fff' : T.ink,
      border: `1px solid ${primary ? T.accent : T.line2}`,
      fontFamily: FONT_BODY, fontSize: 12, fontWeight: 500,
    }}>{children}</button>
  );
}

// Streaming cursor — blinking accent caret. Doubles as the orb's body
// anchor while text is being delivered.
function StreamCursor({ slotId }) {
  const ref = useOrbitSlot(slotId || `__none__:${Math.random()}`);
  return (
    <span ref={slotId ? ref : undefined} style={{
      display: 'inline-block', width: 8, height: 14,
      background: T.accent, marginLeft: 4, verticalAlign: 'text-bottom',
      animation: 'cb 1s steps(2) infinite',
    }} />
  );
}

// ─── Right rail: collapsible cards ────────────────────────────────────────
//
// Two visual modes:
//   default — boxed card with border, header has a divider below
//   slim    — borderless / no header divider; body padding tighter.
//             Used for Context per the spec ("one line has no underline
//             unlike the header of the chat").
//
// Body always has maxHeight + overflowY: auto so a long Working-folder
// or Progress list scrolls inside its own card rather than pushing the
// whole rail past the viewport.
function RailCard({ title, defaultOpen = false, slim = false, maxBodyHeight = 320, children }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div style={{
      background: T.surface,
      border: `1px solid ${T.line}`,
      borderRadius: 12,
      overflow: 'hidden',
      flexShrink: 0,
    }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          cursor: 'pointer',
          background: 'transparent',
          border: 0,
          padding: '11px 14px',
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          textAlign: 'left',
          font: 'inherit',
          color: 'inherit',
        }}
      >
        <span style={{
          fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600,
          color: T.ink, letterSpacing: '-0.005em',
          minWidth: 0, flex: 1,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {title}
        </span>
        <span style={{ color: T.ink4, display: 'inline-flex', flexShrink: 0 }} title={open ? 'Collapse' : 'Expand'}>
          {open ? Ico.chevDown(12) : Ico.chevRight(12)}
        </span>
      </button>
      {open && (
        <div style={{
          padding: '4px 14px 14px',
          // `slim` keeps the bubble surface + border but drops the
          // top divider so the header reads as a single continuous
          // line above the body (per spec for Context).
          borderTop: slim ? 'none' : `1px solid ${T.line}`,
          maxHeight: maxBodyHeight,
          overflowY: 'auto',
        }}>
          {children}
        </div>
      )}
    </div>
  );
}

function ProgressList({ steps }) {
  if (!steps?.length) {
    return <p style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: T.ink4, padding: '8px 0 4px' }}>
      Steps appear here while Anton works.
    </p>;
  }
  // Inputs only — we surface the one_line_description (the human-
  // readable title of each scratchpad cell or artifact). Code + output
  // never show here per design; they live in the full expansion.
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 8 }}>
      {steps.map((step) => {
        const done = step.status === 'completed';
        const current = step.status === 'in_progress';
        const text = step.data?.one_line_description || step.label || step._scratchpadTabId || 'Step';
        return (
          <div key={step.id} title={text} style={{
            display: 'flex', alignItems: 'flex-start', gap: 10,
            fontFamily: FONT_BODY, fontSize: 12.5,
            color: done ? T.ink4 : T.ink2,
          }}>
            <span style={{
              width: 14, height: 14, borderRadius: 99, marginTop: 2, flex: '0 0 auto',
              background: done ? T.accent : 'transparent',
              border: `1.4px solid ${done || current ? T.accent : T.line}`,
              display: 'grid', placeItems: 'center',
            }}>
              {done && <span style={{ color: '#fff', display: 'inline-flex' }}>{Ico.check(9)}</span>}
              {current && <span style={{
                width: 5, height: 5, borderRadius: 99, background: T.accent,
              }} />}
            </span>
            <span style={{
              flex: 1, minWidth: 0,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{text}</span>
          </div>
        );
      })}
    </div>
  );
}

function WorkingFolder({ project, files = [], onOpenScratchpad }) {
  return (
    <div style={{ paddingTop: 8 }}>
      {project && (
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 2, paddingBottom: 8,
          marginBottom: 6, borderBottom: `1px solid ${T.line}`,
        }}>
          <span style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: T.ink, fontWeight: 500 }}>
            {project.name}
          </span>
          <span style={{
            fontFamily: FONT_MONO, fontSize: 10.5, color: T.ink4, letterSpacing: '0.04em',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{project.path}</span>
        </div>
      )}
      {files.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {files.map((f) => (
            <div key={f.name} style={{
              display: 'grid', gridTemplateColumns: '18px 1fr auto', alignItems: 'center', gap: 8,
              padding: '6px 4px', borderRadius: 6,
            }}>
              <span style={{ color: T.ink3, display: 'inline-flex' }}>{Ico.doc(14)}</span>
              <span style={{
                fontFamily: FONT_BODY, fontSize: 12.5, color: T.ink,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{f.name}</span>
              <span style={{ fontFamily: FONT_MONO, fontSize: 10, color: T.ink4 }}>
                {f.live ? <span style={{ color: T.accent }}>● live</span> : (f.size || '')}
              </span>
            </div>
          ))}
        </div>
      ) : !project && (
        <p style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: T.ink4, padding: '8px 0 4px' }}>
          No project selected for this task.
        </p>
      )}
      {onOpenScratchpad && (
        <button onClick={onOpenScratchpad} style={{
          all: 'unset', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 6, marginTop: 10,
          padding: '6px 8px', fontFamily: FONT_BODY, fontSize: 12, color: T.ink3,
          width: 'calc(100% - 16px)',
        }}>
          <span style={{ display: 'inline-flex' }}>{Ico.folder(13)}</span>
          <span>Open scratchpad</span>
          <span style={{ color: T.ink4, marginLeft: 'auto', display: 'inline-flex' }}>{Ico.chevRight(11)}</span>
        </button>
      )}
    </div>
  );
}

function ContextSection({ attachments = [] }) {
  if (!attachments.length) {
    return <p style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: T.ink4, padding: '8px 0 4px' }}>
      Attached files, URLs, and snippets appear here.
    </p>;
  }
  return (
    <div style={{ paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {attachments.map((a) => (
        <div key={a.id} style={{
          display: 'flex', alignItems: 'center', gap: 8,
          fontFamily: FONT_BODY, fontSize: 12.5, color: T.ink2,
        }}>
          <span style={{ color: T.ink3, display: 'inline-flex' }}>
            {a.kind === 'url' ? Ico.globe(13) : a.kind === 'snippet' ? Ico.code(13) : Ico.doc(13)}
          </span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {a.name || a.kind || 'attachment'}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Header crumb helpers ────────────────────────────────────────────────
function CrumbSep() {
  return (
    <span
      aria-hidden="true"
      style={{
        color: T.ink4, fontFamily: FONT_DISPLAY, fontWeight: 400,
        fontSize: 14, lineHeight: 1, padding: '0 2px', flexShrink: 0,
        userSelect: 'none',
      }}
    >›</span>
  );
}

function CrumbButton({ label, onClick, title, maxWidth }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      // Explicit resets instead of `all: unset` — the latter wipes
      // -webkit-app-region back to its initial which interacts badly
      // with the chat outer's drag region. With explicit no-drag,
      // clicks reliably reach the button.
      style={{
        cursor: 'pointer',
        background: 'transparent',
        border: 0,
        outline: 0,
        font: 'inherit',
        fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 13,
        letterSpacing: '0.04em', color: T.ink3,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        maxWidth, flexShrink: 1,
        padding: '2px 6px', borderRadius: 5,
        transition: 'color 120ms ease, background 120ms ease',
        WebkitAppRegion: 'no-drag',
      }}
      onMouseOver={(e) => {
        e.currentTarget.style.color = 'var(--ink)';
        e.currentTarget.style.background = 'var(--surface-2)';
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.color = 'var(--ink-3)';
        e.currentTarget.style.background = 'transparent';
      }}
    >
      {label}
    </button>
  );
}

// ─── Main view ───────────────────────────────────────────────────────────
export default function ChatView({
  task,
  onSend,
  onBack,
  project,
  model,
  attachments,
  connectors,
  onAttachFiles,
  onAttachConnector,
  onRemoveAttachment,
  onPinTask,
  onUnpinTask,
  onRenameTask,
  onDeleteTask,
  onMoveTaskToProject,
  onOpenProject,
  onOpenProjectsList,
  projects = [],
  sidebarCollapsed = false,
}) {
  const scrollRef = useRef(null);
  const [railOpen, setRailOpen] = useState(true);
  // Step id whose scratchpad cells are visible in the modal. null = closed.
  const [openScratchpadStepId, setOpenScratchpadStepId] = useState(null);
  // Task settings menu (kebab in header).
  const settingsBtnRef = useRef(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsAnchor, setSettingsAnchor] = useState(null);

  const isStreaming = task.messages.some((m) => m.role === '_streaming');
  const visibleMessages = task.messages.filter((m) => m.role !== '_streaming');
  const dialogMessageCount = visibleMessages.filter((m) => ['user', 'assistant', 'error'].includes(m.role)).length;
  const streamingMsg = task.messages.find((m) => m.role === '_streaming');
  const taskAttachments = task.attachments || visibleMessages.flatMap((m) => m.attachments || []);
  // Source of truth for the rail Progress card: the live streaming
  // message's steps if a request is in flight, otherwise the steps
  // from the most recent assistant turn. Both come from the SSE
  // adapter so the shape is identical.
  const railSteps = (() => {
    if (streamingMsg && streamingMsg.steps?.length) return streamingMsg.steps;
    for (let i = visibleMessages.length - 1; i >= 0; i--) {
      const m = visibleMessages[i];
      if (m.role === 'assistant' && m.steps?.length) return m.steps;
    }
    return [];
  })();

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [task.messages.length, isStreaming]);

  // Outer ref + conv-column ref. The orb canvas binds to the conv
  // column so the floating orb is naturally clipped to that area
  // (can't leak into the rail visually when a slot is near the right
  // edge). chatRef stays as the panel-level ancestor.
  const chatRef = useRef(null);
  const convRef = useRef(null);

  // Compute which orb slot should be active right now and what state
  // the orb should display. The lifecycle:
  //   - response in flight, no steps yet → header slot, 'thinking'
  //   - some step in_progress             → that step's row, 'thinking'
  //   - all steps done, body streaming    → body caret, 'thinking'
  //   - response done                     → no active slot, 'done'
  const orbView = useMemo(() => {
    if (!streamingMsg) return { state: null, activeSlot: null };
    const steps = streamingMsg.steps || [];
    const inProgress = steps.find((s) => s.status === 'in_progress');
    const status = streamingMsg.streamStatus;
    if (status === 'done') return { state: 'done', activeSlot: 'body:streaming' };
    if (inProgress) return { state: 'thinking', activeSlot: `step:${inProgress.id}` };
    if (streamingMsg.content) return { state: 'thinking', activeSlot: 'body:streaming' };
    return { state: 'thinking', activeSlot: 'header:streaming' };
  }, [streamingMsg]);

  return (
    <div ref={chatRef} style={{
      flex: 1, minHeight: 0,
      display: 'grid',
      // minmax(0, 1fr) is critical — bare `1fr` lets the grid track
      // EXPAND past its allocated size when an unbreakable child (e.g.
      // a very long task title) demands more width, which pushes the
      // rail off-screen and causes content to bleed visually behind
      // the rail. minmax(0, …) tells grid the column can shrink to 0,
      // so the conv col stays inside its track and content clips.
      gridTemplateColumns: railOpen ? 'minmax(0, 1fr) 320px' : 'minmax(0, 1fr) 0px',
      // Without an explicit row, the implicit row is sized to content,
      // so the scroll region's inner content height grows the row past
      // the container — the scroll bar never appears. 1fr forces the
      // row to fill the container height so the inner overflowY can
      // create a real scroll context.
      gridTemplateRows: '1fr',
      transition: 'grid-template-columns 220ms cubic-bezier(.2,.7,.3,1)',
      // Transparent so the gravity-field grid behind the app shows through.
      background: 'transparent',
      fontFamily: FONT_BODY,
      color: T.ink2,
      position: 'relative',
      overflow: 'hidden',
    }}>
      <OrbitProvider
        canvasRef={convRef}
        scrollRef={scrollRef}
        size={22}
        state={orbView.state}
        activeSlot={orbView.activeSlot}
      >
      {/* ─── Conversation column ─── */}
      <div ref={convRef} style={{
        position: 'relative', overflow: 'hidden',
        // Grid auto/1fr is more deterministic than nested flex+min-height
        // for the "header + scrollable body" layout — the 1fr row pins
        // the scroll area to the column's available height, so the inner
        // overflowY can actually scroll.
        display: 'grid',
        gridTemplateRows: 'auto 1fr',
        minWidth: 0, minHeight: 0,
      }}>
        {/* Floating expand-rail button — appears on the right edge of
            the conv column when the rail is collapsed. Mirror of the
            sidebar's hamburger pattern. */}
        <button
          type="button"
          onClick={() => setRailOpen(true)}
          title="Expand panel"
          aria-label="Expand panel"
          style={{
            position: 'absolute',
            top: 14, right: 14,
            zIndex: 10,
            width: 28, height: 28,
            borderRadius: 6,
            display: 'inline-grid', placeItems: 'center',
            cursor: 'pointer',
            background: 'transparent',
            border: 0,
            color: T.ink3,
            opacity: railOpen ? 0 : 1,
            transform: railOpen ? 'translateX(8px)' : 'translateX(0)',
            pointerEvents: railOpen ? 'none' : 'auto',
            transition:
              `opacity 280ms cubic-bezier(0.32,0.72,0,1) ${railOpen ? '0ms' : '120ms'}, ` +
              `transform 360ms cubic-bezier(0.32,0.72,0,1) ${railOpen ? '0ms' : '80ms'}`,
            WebkitAppRegion: 'no-drag',
          }}
          onMouseOver={(e) => { e.currentTarget.style.color = 'var(--ink)'; e.currentTarget.style.background = 'var(--surface-2)'; }}
          onMouseOut={(e) => { e.currentTarget.style.color = 'var(--ink-3)'; e.currentTarget.style.background = 'transparent'; }}
        >
          {Ico.panelExpandLeft(15)}
        </button>

        {/* Header — when the sidebar is collapsed, the floating hamburger
            sits at x:97 in the window, so push the header content right
            so the back button + title don't slide under it. */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: sidebarCollapsed ? '14px 28px 14px 130px' : '14px 28px',
          borderBottom: `1px solid ${T.line}`,
          background: 'transparent',
          flexShrink: 0,
          // Belt + suspenders: even if a flex child miscalculates by a
          // pixel, this prevents the header from visually pushing past
          // the conv-col grid track (which is what was making the icons
          // appear to slide behind the right rail).
          minWidth: 0, overflow: 'hidden',
          transition: 'padding 240ms cubic-bezier(0.32, 0.72, 0, 1)',
        }}>
          {/* Left side: [Project] › [Task]. The project crumb is a
              clickable button that returns home with that project
              pre-selected (the equivalent of "new task in this project"). */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            minWidth: 0, flex: '1 1 0',
            overflow: 'hidden',
          }}>
            {/* Projects › [project] › [task] — text-only crumb. The
                separator is a typographic › (single right-pointing
                angle quote) so we don't need any chevron SVGs. */}
            <CrumbButton
              label="Projects"
              onClick={() => onOpenProjectsList?.()}
              title="All projects"
            />
            {project?.name && (
              <>
                <CrumbSep />
                <CrumbButton
                  label={project.name}
                  onClick={() => onOpenProject?.(project)}
                  title={`Open project: ${project.name}`}
                  maxWidth={200}
                />
              </>
            )}
            <CrumbSep />
            <span title={task.title} style={{
              fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 14,
              letterSpacing: '0.04em', color: T.ink,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              overflowWrap: 'anywhere',
              minWidth: 0, flex: '1 1 0',
            }}>{task.title}</span>
          </div>

          {/* Right side — pin status only. The kebab and rail toggle
              both lived here previously but moved out: rail collapse
              has its own button in the rail header (and a floating
              expander on the conv column when collapsed); pin/rename/
              delete/move/etc. are reachable via the sidebar's task
              kebab on the same conversation. */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 4,
            flexShrink: 0,
          }}>
            {task.pinned && (
              <span title="Pinned" style={{
                display: 'inline-grid', placeItems: 'center',
                width: 22, height: 22, color: T.accent, flexShrink: 0,
              }}>{Ico.pin(13)}</span>
            )}
          </div>
        </div>
        {/* Settings menu kept mounted but hidden; reachable later if
            we add another trigger for it. */}
        <TaskMenu
          task={task}
          projects={projects}
          open={settingsOpen}
          anchorRect={settingsAnchor}
          showHeaderActions
          onClose={() => setSettingsOpen(false)}
          onPin={() => onPinTask?.(task)}
          onUnpin={() => onUnpinTask?.(task.id)}
          onRename={() => {
            const next = window.prompt('Rename task', task.title || '');
            if (next != null) onRenameTask?.(task.id, next);
          }}
          onDelete={() => onDeleteTask?.(task.id)}
          onMoveToProject={(p) => onMoveTaskToProject?.(task.id, p.name)}
          onSchedule={() => {
            // Placeholder — schedule UX is WIP. Drop a hint into the
            // composer-friendly inbox by sending a message that asks
            // anton to set one up.
            onSend?.('Schedule this task to recur — let me confirm the cadence.');
          }}
          onTurnIntoSkill={() => {
            // Per spec: send a message asking anton to turn this turn
            // into a reusable skill, then let the chat continue.
            onSend?.('Turn this conversation into a reusable skill.');
          }}
        />

        {/* Scrollable conversation */}
        <div ref={scrollRef} data-scroll="true" style={{
          minHeight: 0, overflowY: 'auto', overflowX: 'hidden',
          padding: '32px 28px 220px',
          background: 'transparent',
          WebkitAppRegion: 'no-drag',
        }}>
          <div style={{
            maxWidth: 720, margin: '0 auto',
            display: 'flex', flexDirection: 'column', gap: 28,
          }}>
            <Divider label={dividerLabel(new Date())} />

            {visibleMessages.map((m, i) => {
              if (m.role === 'user') {
                return (
                  <UserTurn
                    key={i}
                    content={m.content}
                    attachments={m.attachments}
                    time={formatTime(m.createdAt)}
                  />
                );
              }
              if (m.role === 'activity') return null; // surfaced in the rail's Progress
              if (m.role === 'error') {
                return (
                  <AnswerTurn key={i} state="done" time={formatTime(m.createdAt)} showActions={false}>
                    <div style={{
                      border: '1px solid #F0C2B5',
                      background: '#FFF7F4',
                      color: '#8F321A',
                      borderRadius: 10,
                      padding: '10px 12px',
                      fontFamily: FONT_BODY, fontSize: 13.5, lineHeight: 1.5,
                      userSelect: 'text',
                    }}>{m.content}</div>
                  </AnswerTurn>
                );
              }
              return (
                <AnswerTurn key={i} state="done" time={formatTime(m.createdAt)} copyText={m.content}>
                  {m.steps?.length > 0 && (
                    <ThinkingBlock
                      steps={m.steps}
                      startedAt={m.startedAt}
                      isActive={false}
                      onActivateStep={(step) => setOpenScratchpadStepId(step.id)}
                    />
                  )}
                  <TextBlock text={m.content} id={m.id || `msg-${i}`} complete />
                  {m.artifact && <ArtifactCard artifact={m.artifact} />}
                  <StepArtifacts steps={m.steps} />
                </AnswerTurn>
              );
            })}

            {streamingMsg ? (
              <AnswerTurn state="thinking" time={formatTime(Date.now())} showActions={false} slotIdHeader="header:streaming">
                {streamingMsg.steps?.length > 0 && (
                  <ThinkingBlock
                    steps={streamingMsg.steps}
                    startedAt={streamingMsg.startedAt}
                    isActive={streamingMsg.streamStatus !== 'done' && streamingMsg.streamStatus !== 'streaming'}
                    onActivateStep={(step) => setOpenScratchpadStepId(step.id)}
                  />
                )}
                <div style={{ position: 'relative' }}>
                  <TextBlock text={streamingMsg.content} id="streaming" complete={false} />
                  <StreamCursor slotId="body:streaming" />
                </div>
                <StepArtifacts steps={streamingMsg.steps} />
              </AnswerTurn>
            ) : isStreaming && (
              <AnswerTurn state="thinking" time={formatTime(Date.now())} showActions={false}>
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  fontFamily: FONT_MONO, fontSize: 11, color: T.ink4,
                }}>
                  <StreamCursor />
                  <span>streaming…</span>
                </div>
              </AnswerTurn>
            )}
          </div>
        </div>

        {/* Floating composer + gradient mask */}
        <div style={{
          position: 'absolute', left: 0, right: 0, bottom: 0, height: 220,
          pointerEvents: 'none',
          background: `linear-gradient(to bottom, color-mix(in srgb, var(--bg) 0%, transparent) 0%, var(--bg) 60%)`,
        }} />
        <div className="chat-floating-composer" style={{
          position: 'absolute', left: 28, right: 28, bottom: 22,
          display: 'flex', justifyContent: 'center',
          pointerEvents: 'auto',
          ['--composer-max-width']: '720px',
        }}>
          <Composer
            onSend={onSend}
            project={project}
            onProjectChange={() => {}}
            model={model}
            onModelChange={() => {}}
            projects={[]}
            models={model ? [model] : []}
            attachments={attachments}
            connectors={connectors}
            onAttachFiles={onAttachFiles}
            onAttachConnector={onAttachConnector}
            onRemoveAttachment={onRemoveAttachment}
            placeholder="Reply…"
            metaReadOnly
            hideMeta
          />
        </div>
      </div>

      {/* ─── Right rail ─── */}
      <aside style={{
        background: 'transparent',
        padding: '14px 14px 22px',
        visibility: railOpen ? 'visible' : 'hidden',
        opacity: railOpen ? 1 : 0,
        transition: 'opacity 180ms ease',
        display: 'flex', flexDirection: 'column', gap: 10,
        // overflowX hidden is defensive: when the grid column shrinks
        // to 0 (collapsed), card content shouldn't visually spill
        // back into the conversation column.
        overflowX: 'hidden',
        overflowY: 'auto',
        minWidth: 0,
        WebkitAppRegion: 'no-drag',
      }}>
        {/* Rail header bar — dedicated collapse-to-right button at the
            top-right corner. Mirrors the sidebar's collapse pattern. */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
          flexShrink: 0,
        }}>
          <button
            type="button"
            onClick={() => setRailOpen(false)}
            title="Collapse panel"
            aria-label="Collapse panel"
            style={{
              all: 'unset', cursor: 'pointer',
              width: 26, height: 26, borderRadius: 6,
              display: 'inline-grid', placeItems: 'center',
              color: T.ink3,
            }}
            onMouseOver={(e) => { e.currentTarget.style.color = 'var(--ink)'; e.currentTarget.style.background = 'var(--surface-2)'; }}
            onMouseOut={(e) => { e.currentTarget.style.color = 'var(--ink-3)'; e.currentTarget.style.background = 'transparent'; }}
          >
            {Ico.panelCollapseRight(15)}
          </button>
        </div>
        <RailCard title="Progress" defaultOpen maxBodyHeight={300}>
          <PhaseProgress
            steps={railSteps}
            streamStatus={streamingMsg?.streamStatus || (railSteps.length ? 'done' : null)}
            conversationId={task.id || ''}
            onActivateStep={(step) => setOpenScratchpadStepId(step.id)}
          />
        </RailCard>
        <RailCard title="Working folder" defaultOpen maxBodyHeight={320}>
          <WorkingFolderLive
            project={project}
            isStreaming={isStreaming}
            streamStartedAt={streamingMsg?.startedAt}
          />
        </RailCard>
        {/* Context — slim header with no underline, expanded by
            default per spec. The expander icon on the right doubles
            as the collapse button. */}
        <RailCard title="Context" defaultOpen slim maxBodyHeight={360}>
          <ContextCard project={project} />
        </RailCard>
      </aside>

      {/* keyframes for the streaming cursor */}
      <style>{`@keyframes cb { 0%,49%{opacity:1} 50%,100%{opacity:0} }`}</style>
      </OrbitProvider>

      {/* Scratchpad viewer — pools steps from every assistant turn in
          this task so tabs persist across the conversation, mirroring
          mdb-ai's grouping by `name`. */}
      <ScratchpadModal
        open={openScratchpadStepId != null}
        onClose={() => setOpenScratchpadStepId(null)}
        steps={[
          ...visibleMessages.flatMap((m) => m.steps || []),
          ...(streamingMsg?.steps || []),
        ]}
        focusStepId={openScratchpadStepId}
      />
    </div>
  );
}
