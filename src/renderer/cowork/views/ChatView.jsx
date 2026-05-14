/* Anton Chat — Direction A: Conservative.
   Near-1:1 port of docs/design-guidelines/chat.html (ChatConservative).
   Editorial, document-like. Inter body, Josefin display, mono for operator
   metadata. Centered ~720px column, OrbitMorph-led Anton turns, floating
   composer, right rail with collapsible cards.

   Wired against the live message model (role: user|assistant|error|activity,
   plus _streaming) and our real Composer + project/model state. Tokens come
   from CSS vars so the panel reads correctly in both light and dark themes. */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import Ico from '../components/Icons';
import Composer from '../components/Composer';
import { OrbitMorph } from '../components/ui';
import { MarkdownContent } from '../components/markdown/MarkdownContent';
import { ThinkingBlock } from '../components/thinking/ThinkingBlock';
import { OrbitProvider, useOrbitSlot } from '../lib/orbitRegistry';
import { copyText } from '../lib/clipboard';
import { TaskMenu } from '../components/TaskMenu';
import { ScratchpadModal } from '../components/thinking/ScratchpadModal';
import { ProgressBox, WorkingFolderBox, ContextBox } from '../components/rail';
import { ArtifactViewer } from '../components/artifact';
import { DataVaultFormPanel } from '../components/datavault/DataVaultFormPanel';
import { getForm as getDataVaultForm, setForm as setDataVaultForm, subscribe as subscribeDataVaultForm } from '../components/datavault/formStore';
import { FormErrorBoundary } from '../components/datavault/FormErrorBoundary';
import { revealArtifact } from '../api';
import { normalizeArtifactRecord } from '../lib/artifactPaths';
import { host } from '../../platform/host';
import { useBreakpoint } from '../hooks/useBreakpoint';

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

function MessageActions({ getText, onDelete }) {
  // Copy + delete for now — refresh / thumbs up / thumbs down hidden
  // until the underlying actions are wired.
  const [copied, setCopied] = useState(false);
  const [deleteHover, setDeleteHover] = useState(false);
  const onCopy = async () => {
    const text = typeof getText === 'function' ? getText() : '';
    if (!text) return;
    const ok = await copyText(text);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }
  };
  return (
    <div style={{ display: 'flex', gap: 4, marginTop: 4, color: T.ink4 }}>
      <button
        type="button"
        title={copied ? 'Copied' : 'Copy response'}
        aria-label={copied ? 'Copied' : 'Copy response'}
        onClick={onCopy}
        style={{
          cursor: 'pointer',
          background: 'transparent',
          border: 0,
          padding: 0,
          width: 26, height: 26, borderRadius: 6,
          display: 'grid', placeItems: 'center',
          color: copied ? 'var(--accent)' : 'inherit',
          transition: 'color 140ms ease',
        }}
      >
        {copied ? Ico.check(13) : Ico.copy(13)}
      </button>
      {onDelete && (
        <button
          type="button"
          title="Delete this question and response"
          aria-label="Delete this question and response"
          onClick={onDelete}
          onMouseEnter={() => setDeleteHover(true)}
          onMouseLeave={() => setDeleteHover(false)}
          style={{
            cursor: 'pointer',
            background: 'transparent',
            border: 0,
            padding: 0,
            width: 26, height: 26, borderRadius: 6,
            display: 'grid', placeItems: 'center',
            color: deleteHover ? 'var(--danger)' : 'inherit',
            transition: 'color 140ms ease',
          }}
        >
          {Ico.trash(13)}
        </button>
      )}
    </div>
  );
}

// ─── User pill ───────────────────────────────────────────────────────────
//
// `onDelete` is set by the parent only when this user message is an
// "orphan" — no assistant response followed it (e.g. the stream was
// stopped before anton produced anything). For paired user→answer
// cycles, the delete affordance lives on the assistant bubble's
// MessageActions and removes both halves. The orphan case has no
// assistant bubble, so we surface the delete here instead — a
// hover-revealed trash glyph just outside the bubble's bottom-left.
// Connect-intro bubble — synthesized assistant turn shown after the
// user picks a connector. Reads as a small card with the connector
// logo + label and a "Fill out the form on the side panel →" prompt.
// Hovering it highlights the form panel on the right rail so the
// affordance is obvious.
//
// In modify mode, the bubble grows two affordances inline next to
// the card: a borderless "← Cancel" and a danger-tinted
// "Disconnect". Both stay in the chat row so the user can bail or
// destroy without scrolling around to find a menu.
function ConnectIntroBubble({ title, connector, onHoverChange, modify = false, onCancel, onDisconnect, onClickCard }) {
  const [hover, setHover] = useState(false);
  const iconName = connector?.logo || 'database';
  const Icon = (Ico[iconName] || Ico.database);
  const clickable = typeof onClickCard === 'function';
  // No "Anton" eyebrow on this bubble — the follow-up assistant
  // turn that always renders right after it carries its own,
  // and two headers stacked back-to-back read as a stutter. The
  // card itself is visually distinct enough to stand on its own.
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div
          role={clickable ? 'button' : undefined}
          tabIndex={clickable ? 0 : undefined}
          onClick={clickable ? onClickCard : undefined}
          onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClickCard(); } } : undefined}
          onMouseEnter={() => { setHover(true); onHoverChange?.(true); }}
          onMouseLeave={() => { setHover(false); onHoverChange?.(false); }}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 12,
            padding: '12px 14px',
            background: hover
              ? 'color-mix(in srgb, var(--accent) 10%, var(--surface))'
              : 'var(--surface)',
            border: `1px solid ${hover ? 'var(--accent)' : T.line}`,
            borderRadius: 12,
            maxWidth: '78%',
            cursor: clickable ? 'pointer' : 'default',
            transition: 'border-color 140ms ease, background 140ms ease, box-shadow 140ms ease',
            boxShadow: hover
              ? `0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent)`
              : 'none',
            outline: 'none',
          }}
        >
          <span style={{
            display: 'inline-grid', placeItems: 'center',
            width: 36, height: 36, borderRadius: 8,
            background: 'var(--surface-2)',
            color: connector?.logo_color || 'var(--ink-3)',
            flexShrink: 0,
          }}>
            {Icon(20)}
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <span style={{
              fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 14,
              color: T.ink, letterSpacing: '-0.005em',
            }}>{title}</span>
            <span style={{
              fontFamily: FONT_BODY, fontSize: 12.5, color: T.ink3,
            }}>
              {clickable
                ? <>Click to re-open the form <span aria-hidden style={{ color: 'var(--accent)' }}>→</span></>
                : <>Fill out the form on the side panel <span aria-hidden style={{ color: 'var(--accent)' }}>→</span></>}
            </span>
          </div>
        </div>
        {modify && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {onCancel && (
              <ConnectIntroPillButton
                kind="ghost"
                onClick={onCancel}
                // Inline left-arrow glyph — Icons.jsx doesn't ship a
                // chevronLeft yet, and the `←` matches the "Back to
                // options" treatment used elsewhere in the codebase.
                renderIcon={() => (
                  <span aria-hidden style={{ fontSize: 14, lineHeight: 1, display: 'inline-block', marginTop: -1 }}>←</span>
                )}
                label="Cancel"
              />
            )}
            {onDisconnect && (
              <ConnectIntroPillButton
                kind="danger"
                onClick={onDisconnect}
                renderIcon={(s) => Ico.trash(s)}
                label="Disconnect"
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Pill-shaped action button used next to the connect-intro card in
// modify mode. Two visual variants:
//   • "ghost"  — borderless, ink color, hover lifts background
//                 (used for Cancel — the safe, reversible action)
//   • "danger" — red border + tint, hover ramps the fill
//                 (used for Disconnect — destructive, asks confirm)
// Icon + label sit inline with a 6px gap; whole button is a single
// rounded shape so the row reads as a clean affordance group next
// to the connector card.
function ConnectIntroPillButton({ kind, renderIcon, label, onClick }) {
  const [hover, setHover] = useState(false);
  const isDanger = kind === 'danger';
  const baseColor = isDanger ? 'var(--danger)' : 'var(--ink-3)';
  const hoverColor = isDanger ? 'var(--danger)' : 'var(--ink)';
  const baseBg = isDanger
    ? 'color-mix(in srgb, var(--danger) 8%, transparent)'
    : 'transparent';
  const hoverBg = isDanger
    ? 'color-mix(in srgb, var(--danger) 14%, transparent)'
    : 'var(--surface-2)';
  const baseBorder = isDanger
    ? '1px solid color-mix(in srgb, var(--danger) 30%, transparent)'
    : '1px solid transparent';
  const hoverBorder = isDanger
    ? '1px solid color-mix(in srgb, var(--danger) 45%, transparent)'
    : '1px solid var(--line)';
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '6px 12px', borderRadius: 999,
        background: hover ? hoverBg : baseBg,
        border: hover ? hoverBorder : baseBorder,
        color: hover ? hoverColor : baseColor,
        fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 500,
        cursor: 'pointer',
        transition: 'background 140ms ease, border-color 140ms ease, color 140ms ease',
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center' }}>
        {typeof renderIcon === 'function' ? renderIcon(13) : null}
      </span>
      {label}
    </button>
  );
}

function userTurnAttachmentIcon(a) {
  const src = a.source || a.kind || 'file';
  if (src === 'connector') return Ico.link(13);
  if (a.mime && String(a.mime).startsWith('image/')) return Ico.image(13);
  return Ico.doc(13);
}

function userTurnAttachmentMeta(a) {
  if (a.extractionStatus && a.extractionStatus !== 'ready') {
    return String(a.extractionStatus).replace(/_/g, ' ');
  }
  if (typeof a.size === 'number' && a.size > 0) {
    return `${Math.ceil(a.size / 1024)} KB`;
  }
  if (a.mime) {
    const tail = String(a.mime).split('/').pop();
    return tail || '';
  }
  return '';
}

function userTurnAttachmentLabel(a) {
  const src = a.source || a.kind || 'file';
  if (a.name) return a.name;
  if (src === 'connector') return 'Connector';
  if (a.mime && String(a.mime).startsWith('image/')) return 'Image';
  return 'File';
}

function UserTurn({ content, attachments, time, onDelete, onEdit }) {
  // Hover affordances are CSS now (`.user-turn:hover .user-turn-action`),
  // so no useState flags here. Edit/Trash stack just outside the bubble's
  // right edge — user messages are right-aligned, so the toolbar belongs
  // on the same side as the speaker (Linear / Slack DM pattern). The
  // `has-meta` / `is-stacked` modifiers raise the buttons over the meta
  // line and over each other when both are present.
  const editClass =
    'user-turn-action'
    + (onDelete ? ' is-stacked' : (time ? ' has-meta' : ''));
  const trashClass =
    'user-turn-action user-turn-action--danger'
    + (time ? ' has-meta' : '');
  return (
    <div className="user-turn">
      <div className="user-turn-inner">
        {onEdit && (
          <button
            type="button"
            className={editClass}
            onClick={() => onEdit(content)}
            title="Edit and resend"
            aria-label="Edit and resend this message"
          >
            {Ico.edit ? Ico.edit(13) : Ico.pencil ? Ico.pencil(13) : Ico.code(13)}
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            className={trashClass}
            onClick={onDelete}
            title="Delete this message"
            aria-label="Delete this message"
          >
            {Ico.trash(13)}
          </button>
        )}
        <div className="user-turn-bubble">
          {/* User messages flow through the same markdown pipeline as
              assistant turns so fenced code blocks, bold/italic, lists,
              etc. typed in the composer render properly. */}
          <MarkdownContent text={content} />
        </div>
        {attachments?.map((a) => (
          <div key={a.id} className="user-turn-attachment">
            <span className="user-turn-attachment-icon">
              {userTurnAttachmentIcon(a)}
            </span>
            <span className="user-turn-attachment-name">{userTurnAttachmentLabel(a)}</span>
            <span className="user-turn-attachment-meta">{userTurnAttachmentMeta(a)}</span>
          </div>
        ))}
        {time && (
          <span className="user-turn-meta">you · {time}</span>
        )}
      </div>
    </div>
  );
}

// OrbitProvider `size` for the chat orb — header slot matches this box.
const CHAT_ORB_SIZE = 22;

// ─── Anton answer turn — content stack ────────────────────────────────────
// `slotIdHeader` lets the parent register an orb anchor beside the label
// (while the request is in flight with no step row / body caret yet).
function AnswerTurn({ state = 'done', time, children, showActions = true, copyText, onDelete, slotIdHeader }) {
  // Stable id: never use Math.random() here (would churn register every render).
  const headerRef = useOrbitSlot(slotIdHeader ?? '__answer_header_inert__');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          {/* Empty box only — orb centers here so it never stacks against glyphs. */}
          {slotIdHeader ? (
            <span
              ref={headerRef}
              aria-hidden
              style={{
                display: 'inline-flex',
                width: CHAT_ORB_SIZE,
                height: CHAT_ORB_SIZE,
                flexShrink: 0,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            />
          ) : null}
          <span style={{
            fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 13,
            letterSpacing: '0.14em', textTransform: 'uppercase', color: T.ink,
          }}>Anton</span>
        </div>
        {time && (
          <span style={{ fontFamily: FONT_MONO, fontSize: 10.5, color: T.ink4, letterSpacing: '0.04em' }}>
            {state === 'thinking' ? `${time} · drafting` : time}
          </span>
        )}
      </div>
      {children}
      {showActions && state !== 'thinking' && (
        <MessageActions getText={() => copyText || ''} onDelete={onDelete} />
      )}
    </div>
  );
}

function TextBlock({ text, id, complete = true, conversationId = null }) {
  // Full markdown rendering — GFM tables, lists, code blocks (with
  // chartjs/chart and data-vault-form support), links, etc. via
  // react-markdown + our MarkdownContent override map.
  return <MarkdownContent text={text} id={id} complete={complete} conversationId={conversationId} />;
}

// Convert an artifact step (from the SSE adapter, badge='Artifact')
// into the shape ArtifactCard expects. Used to render inline cards
// at the end of an assistant turn — like mdb-ai surfaces results.
function artifactStepToCard(step, projectPath) {
  const data = step.data || {};
  const path = data.file_path || data.path || '';
  // Lower-cased extension (no leading dot) for HTML detection downstream.
  const ext = (path.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
  const card = normalizeArtifactRecord({
    title: data.title || step.label || 'Artifact',
    kind: data.action ? `${data.action}` : 'live artifact',
    icon: 'doc',
    path,
    file_path: path,
    ext: ext ? `.${ext}` : '',
    preview: [],
  }, projectPath);
  return {
    ...card,
    preview: card.displayPath ? [{ heading: card.displayPath }] : [],
  };
}

// Renders any badge='Artifact' steps as inline ArtifactCards.
function StepArtifacts({ steps, onOpen, projectPath }) {
  const artifacts = steps?.filter((s) => s.badge === 'Artifact') || [];
  if (artifacts.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 4 }}>
      {artifacts.map((s) => (
        <ArtifactCard key={s.id} artifact={artifactStepToCard(s, projectPath)} onOpen={onOpen} />
      ))}
    </div>
  );
}

function ArtifactCard({ artifact, onOpen }) {
  const [status, setStatus] = useState(null);
  const statusTimerRef = useRef(null);
  useLayoutEffect(() => () => {
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
  }, []);

  const path = artifact.canonicalPath || artifact.file_path || artifact.path;
  const displayPath = artifact.displayPath || path;
  const disabledReason = artifact.actionDisabledReason || '';
  const canAct = !!path && !disabledReason;
  const platform = host.getPlatform();
  const revealLabel = platform === 'darwin' ? 'Show in Finder' : 'Show in folder';

  const showStatus = (kind, text) => {
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    setStatus({ kind, text });
    statusTimerRef.current = setTimeout(() => setStatus(null), kind === 'ok' ? 1800 : 3200);
  };

  // Match the Working folder card's behavior: HTML and text artifacts
  // (.md/.txt/.csv) open the in-app viewer — HTML via sandboxed iframe,
  // text via inline markdown / table / preformatted render. Anything
  // else falls through to the OS handler via the Electron bridge.
  const lcExt = (artifact.ext || '').toLowerCase();
  const lcPath = (path || '').toLowerCase();
  const isHtml = lcExt === '.html' || lcPath.endsWith('.html');
  const _INLINE_TEXT_EXTS = ['.md', '.txt', '.csv'];
  const isInlineText = _INLINE_TEXT_EXTS.includes(lcExt)
    || _INLINE_TEXT_EXTS.some((e) => lcPath.endsWith(e));
  const canPreviewInline = isHtml || isInlineText;
  const handleOpen = async () => {
    if (!canAct) {
      showStatus('error', disabledReason || 'No artifact file path is available.');
      return;
    }
    if (canPreviewInline && onOpen) {
      onOpen(artifact);
      return;
    }
    try {
      const result = await host.openPath(path);
      if (result && result.ok === false) throw new Error(result.reason || 'Could not open artifact.');
      showStatus('ok', 'Opened.');
    }
    catch (e) {
      // eslint-disable-next-line no-console
      console.error('[artifact-open] failed', e);
      showStatus('error', e?.message || 'Could not open artifact.');
    }
  };
  const handleReveal = async () => {
    if (!canAct) {
      showStatus('error', disabledReason || 'No artifact file path is available.');
      return;
    }
    let bridgeError = null;
    try {
      const result = await host.showItemInFolder(path);
      if (result?.ok) {
        showStatus('ok', platform === 'darwin' ? 'Shown in Finder.' : 'Shown in folder.');
        return;
      }
      bridgeError = result?.reason || 'Could not show artifact.';
    } catch (e) {
      bridgeError = e;
    }

    try {
      await revealArtifact(path);
      showStatus('ok', platform === 'darwin' ? 'Shown in Finder.' : 'Shown in folder.');
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[artifact-reveal] failed', e || bridgeError);
      showStatus('error', e?.message || bridgeError?.message || bridgeError || 'Could not show artifact.');
    }
  };
  const previewText = artifact.preview?.[0]?.heading || artifact.preview?.[0]?.text || displayPath;
  // Whole-card click → preview. The inner buttons (Show in Finder,
  // Open, Title) all stopPropagation so their own handlers run
  // instead of bubbling up to this. Disabled paths fall through to
  // a status toast instead of opening, mirroring the prior button
  // behaviour. Cursor + hover lift mark the entire surface as
  // interactive at a glance.
  return (
    <div
      role="button"
      tabIndex={canAct ? 0 : -1}
      aria-label={canAct ? `Open preview: ${artifact.title}` : disabledReason || 'No file path'}
      onClick={() => { if (canAct) handleOpen(); }}
      onKeyDown={(e) => {
        if (!canAct) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleOpen(); }
      }}
      style={{
        display: 'grid', gridTemplateColumns: '64px 1fr auto', alignItems: 'center', gap: 16,
        background: T.surface, border: `1px solid ${T.line}`,
        borderRadius: 14, padding: '14px 16px',
        boxShadow: '0 1px 0 rgba(15,16,17,0.02), 0 8px 20px rgba(15,16,17,0.04)',
        cursor: canAct ? 'pointer' : 'default',
        transition: 'border-color 140ms ease, transform 140ms ease, box-shadow 140ms ease',
        outline: 'none',
      }}
      onMouseOver={(e) => {
        if (!canAct) return;
        e.currentTarget.style.borderColor = T.accent;
        e.currentTarget.style.transform = 'translateY(-1px)';
        e.currentTarget.style.boxShadow = '0 1px 0 rgba(15,16,17,0.02), 0 12px 26px rgba(15,16,17,0.06)';
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.borderColor = T.line;
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = '0 1px 0 rgba(15,16,17,0.02), 0 8px 20px rgba(15,16,17,0.04)';
      }}
    >
      <div style={{
        width: 64, height: 64, background: T.surface2, borderRadius: 8,
        display: 'grid', placeItems: 'center', color: T.accent,
      }}>
        {artifact.icon === 'doc' ? Ico.doc(26) : Ico.sparkle(26)}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
        {/* Title doubles as the primary "open preview" affordance —
            clicking it routes through the same handler the Open
            button uses. Hover gets an accent + underline so the
            interaction reads at a glance. Disabled when there's no
            path to open. */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); if (canAct) handleOpen(); }}
          disabled={!canAct}
          title={canAct ? `Open preview: ${artifact.title}` : disabledReason || 'No file path'}
          style={{
            all: 'unset',
            cursor: canAct ? 'pointer' : 'not-allowed',
            fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 16, color: T.ink,
            letterSpacing: '0.01em',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            display: 'block', minWidth: 0,
            transition: 'color 120ms ease',
            opacity: canAct ? 1 : 0.7,
          }}
          onMouseOver={(e) => { if (canAct) { e.currentTarget.style.color = T.accent; e.currentTarget.style.textDecoration = 'underline'; e.currentTarget.style.textUnderlineOffset = '3px'; } }}
          onMouseOut={(e) => { e.currentTarget.style.color = T.ink; e.currentTarget.style.textDecoration = 'none'; }}
        >{artifact.title}</button>
        <span style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: T.ink3 }}>
          {artifact.kind || 'live artifact'}
        </span>
        {previewText && (
          <span title={previewText} style={{
            fontFamily: FONT_MONO, fontSize: 10.5, color: T.ink4,
            marginTop: 2, letterSpacing: '0.04em',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {previewText}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        {status && (
          <span aria-live="polite" style={{
            alignSelf: 'center',
            maxWidth: 180,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontFamily: FONT_BODY,
            fontSize: 11.5,
            color: status.kind === 'error' ? 'var(--danger)' : T.accent,
          }}>
            {status.text}
          </span>
        )}
        {!host.isWeb && (
          <SmallBtn disabled={!canAct} onClick={handleReveal} title={canAct ? `${revealLabel}: ${path}` : disabledReason || 'No file path'}>
            {revealLabel}
          </SmallBtn>
        )}
        {(!host.isWeb || isHtml) && (
          <SmallBtn primary disabled={!canAct} onClick={handleOpen} title={canAct ? `Open ${path}` : disabledReason || 'No file path'}>
            Open
          </SmallBtn>
        )}
      </div>
    </div>
  );
}

function SmallBtn({ primary, children, onClick, title, disabled }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); if (!disabled) onClick?.(); }}
      title={title}
      disabled={disabled}
      style={{
        all: 'unset', cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '6px 10px', borderRadius: 7,
        background: primary ? T.accent : T.surface,
        color: primary ? '#fff' : T.ink,
        border: `1px solid ${primary ? T.accent : T.line2}`,
        fontFamily: FONT_BODY, fontSize: 12, fontWeight: 500,
        whiteSpace: 'nowrap',
        opacity: disabled ? 0.5 : 1,
      }}
    >{children}</button>
  );
}

// Streaming cursor — blinking accent caret (orb stays on the header).
function StreamCursor() {
  return (
    <span style={{
      display: 'inline-block', width: 8, height: 14,
      background: T.accent, marginLeft: 4, verticalAlign: 'text-bottom',
      animation: 'cb 1s steps(2) infinite',
    }} />
  );
}

// Right-rail boxes (Progress/WorkingFolder/Context) live in
// components/rail/. The local RailCard that used to live here was
// removed when ChatView switched to those wrappers.

// ProgressList / WorkingFolder / ContextSection were the legacy
// inline rail bodies; they're now folded into the rail box wrappers
// (PhaseProgress / WorkingFolderLive / ContextCard) which are
// composed via ProgressBox / WorkingFolderBox / ContextBox.

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
  disabledConnections,
  onUpdateConnectorMute,
  onRemoveAttachment,
  onPinTask,
  onUnpinTask,
  onRenameTask,
  onDeleteTask,
  onDeleteTurn,
  onSubmitDataVaultForm,
  onNavigateToConnectors,
  onCancelModify,
  onDisconnectModify,
  onMoveTaskToProject,
  onOpenProject,
  onOpenProjectsList,
  onStop,
  projects = [],
  sidebarCollapsed = false,
  // Messages the user typed while Anton was mid-turn. Displayed as
  // pills above the Composer; drain into onSend automatically when
  // the active turn finishes.
  queuedMessages = [],
  onRemoveFromQueue,
}) {
  const scrollRef = useRef(null);
  const { isNarrow } = useBreakpoint();
  // Wide: inline grid column. Narrow: fixed overlay from the right.
  const [railOpen, setRailOpen] = useState(true);
  const [railNarrowOpen, setRailNarrowOpen] = useState(false);
  // Composer prefill — set by clicking Edit on a user message.
  // `bump` is a monotonically-increasing nonce so the Composer's
  // sync effect runs even when re-editing the same text.
  const [composerPrefill, setComposerPrefill] = useState({ text: '', bump: 0 });
  // Inline rail only active on wide screens.
  const effectiveRailOpen = !isNarrow && railOpen;
  // Narrow-screen overlay rail.
  const railOverlayOpen = isNarrow && railNarrowOpen;
  // Step id whose scratchpad cells are visible in the modal. null = closed.
  const [openScratchpadStepId, setOpenScratchpadStepId] = useState(null);
  // Inline ArtifactCard → viewer. HTML artifacts open in the sandboxed
  // iframe modal; text artifacts (.md/.txt/.csv) open the same viewer
  // but render via the inline text path (no iframe, no OS handoff).
  // Anything else still routes through the Electron OS handler via
  // openPath inside the card.
  const [previewArt, setPreviewArt] = useState(null);
  const handleArtifactOpen = (artifact) => {
    // The card already filters: it only calls onOpen for previewable
    // types (HTML / md / txt / csv). Dispatch straight to the viewer.
    setPreviewArt(artifact);
  };
  // Task settings menu (kebab in header).
  const settingsBtnRef = useRef(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsAnchor, setSettingsAnchor] = useState(null);
  // Whether a data-vault form is currently active for this conversation.
  // useSyncExternalStore keeps this in sync without useEffect: React
  // re-reads the snapshot whenever the formStore notifies subscribers.
  const taskId = task?.id || '';
  const subscribeFormStore = useMemo(
    () => (onChange) => subscribeDataVaultForm(taskId, onChange),
    [taskId],
  );
  const formActive = useSyncExternalStore(
    subscribeFormStore,
    () => !!getDataVaultForm(taskId),
    () => false,
  );

  // On narrow viewports the rail is closed by default and the floating
  // expand button is hidden — open the overlay when a form spec
  // arrives so the form is reachable. Close it again if the spec
  // goes away (submit/cancel) so the empty fullscreen aside doesn't
  // sit on top of the chat as a blank surface.
  useEffect(() => {
    if (!isNarrow) return;
    setRailNarrowOpen(!!formActive);
  }, [isNarrow, formActive]);

  // Hovering the connect-intro chat bubble highlights the form
  // panel on the right rail. Plain local state so we don't need
  // to lift it further; the panel reads via the `highlighted`
  // prop we pass it below.
  const [formHighlight, setFormHighlight] = useState(false);
  // Inline title rename — same affordance the project detail header
  // uses. Hover surfaces the kebab; Rename in the menu flips the
  // title span into an <input>; Enter commits, Esc cancels.
  const [titleHover, setTitleHover] = useState(false);
  const [titleEditing, setTitleEditing] = useState(false);
  const titleInputRef = useRef(null);

  useLayoutEffect(() => {
    if (!titleEditing) return;
    const id = requestAnimationFrame(() => {
      const el = titleInputRef.current;
      if (!el) return;
      el.focus();
      try { el.select(); } catch {}
    });
    return () => cancelAnimationFrame(id);
  }, [titleEditing]);

  const submitTitleRename = () => {
    const next = titleInputRef.current?.value ?? task.title ?? '';
    const trimmed = next.trim();
    setTitleEditing(false);
    if (!trimmed || trimmed === (task.title || '').trim()) return;
    onRenameTask?.(task.id, trimmed);
  };
  const cancelTitleRename = () => setTitleEditing(false);

  const isStreaming = task.messages.some((m) => m.role === '_streaming');
  const visibleMessages = task.messages.filter((m) => m.role !== '_streaming');
  const dialogMessageCount = visibleMessages.filter((m) => ['user', 'assistant', 'error'].includes(m.role)).length;
  const streamingMsg = task.messages.find((m) => m.role === '_streaming');
  const artifactProjectPath = task.projectPath || project?.path || '';
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

  // Per-message stable key for prefixing step ids in the scratchpad
  // pool. Each message generates step ids that start over at "step-1"
  // for that message — so two messages can share an id like "step-1".
  // Without prefixing, the pooled list passed to ScratchpadModal has
  // duplicate keys (React warning + occasional render glitch) AND the
  // focus-step lookup `steps.find(s => s.id === focusStepId)` returns
  // the FIRST match, which can be the wrong message's step. Prefixing
  // makes the pool unique and keeps focus correlation tight.
  const messageKey = (m, i) =>
    `m:${m?.id || `idx-${i}`}`;
  const streamingKey = streamingMsg
    ? `streaming:${streamingMsg.id || 'live'}`
    : null;
  const prefixId = (msgKey, stepId) => `${msgKey}::${stepId}`;
  const railMsgKey = (() => {
    if (streamingMsg && streamingMsg.steps?.length) return streamingKey;
    for (let i = visibleMessages.length - 1; i >= 0; i--) {
      const m = visibleMessages[i];
      if (m.role === 'assistant' && m.steps?.length) return messageKey(m, i);
    }
    return null;
  })();
  // Build the unified scratchpad pool with prefixed ids. The modal
  // groups by `_scratchpadTabId` so each tab still only contains its
  // own cells; this prefix is purely for global-uniqueness of step
  // ids across the conversation's pooled history.
  const scratchpadStepsPool = useMemo(() => {
    const out = [];
    visibleMessages.forEach((m, i) => {
      const msgKey = messageKey(m, i);
      (m.steps || []).forEach((s) => {
        out.push({ ...s, id: prefixId(msgKey, s.id) });
      });
    });
    if (streamingMsg && streamingKey) {
      (streamingMsg.steps || []).forEach((s) => {
        out.push({ ...s, id: prefixId(streamingKey, s.id) });
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleMessages, streamingMsg]);

  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [task.messages.length, isStreaming]);

  // Outer ref + conv-column ref. The orb canvas binds to the conv
  // column so the floating orb is naturally clipped to that area
  // (can't leak into the rail visually when a slot is near the right
  // edge). chatRef stays as the panel-level ancestor.
  const chatRef = useRef(null);
  const convRef = useRef(null);

  // Orb stays on the ANTON header for the whole streaming turn — it
  // does not follow scratchpad rows or the body caret (avoids stacking
  // against streaming markdown).
  const orbView = useMemo(() => {
    if (!streamingMsg) return { state: null, activeSlot: null };
    const status = streamingMsg.streamStatus;
    if (status === 'done') return { state: 'done', activeSlot: 'header:streaming' };
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
      // On narrow screens the rail is always a fixed overlay, so the
      // grid is always single-column.
      gridTemplateColumns: effectiveRailOpen ? 'minmax(0, 1fr) 320px' : 'minmax(0, 1fr) 0px',
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
        size={CHAT_ORB_SIZE}
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
          className="chat-rail-toggle"
          onClick={() => isNarrow ? setRailNarrowOpen(true) : setRailOpen(true)}
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
            opacity: (effectiveRailOpen || railOverlayOpen) ? 0 : 1,
            transform: (effectiveRailOpen || railOverlayOpen) ? 'translateX(8px)' : 'translateX(0)',
            pointerEvents: (effectiveRailOpen || railOverlayOpen) ? 'none' : 'auto',
            transition:
              `opacity 280ms cubic-bezier(0.32,0.72,0,1) ${(effectiveRailOpen || railOverlayOpen) ? '0ms' : '120ms'}, ` +
              `transform 360ms cubic-bezier(0.32,0.72,0,1) ${(effectiveRailOpen || railOverlayOpen) ? '0ms' : '80ms'}`,
            WebkitAppRegion: 'no-drag',
          }}
          onMouseOver={(e) => { e.currentTarget.style.color = 'var(--ink)'; e.currentTarget.style.background = 'var(--surface-2)'; }}
          onMouseOut={(e) => { e.currentTarget.style.color = 'var(--ink-3)'; e.currentTarget.style.background = 'transparent'; }}
        >
          {Ico.panelExpandLeft(15)}
        </button>

        {/* Header — when the sidebar is overlay/collapsed, the floating
            hamburger button occupies some left space; push the header
            content right to avoid overlap. On web, the hamburger is at
            left: 18 (no traffic lights), so 60px clears it. On Electron,
            left: 97, so 130px clears the traffic lights + hamburger. */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: sidebarCollapsed
            ? `14px 28px 14px ${host.isWeb ? 60 : 130}px`
            : '14px 28px',
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
          {/* Left side: [Project] › [Task] for chat tasks, or
              [Apps] › [Task] for connect-data flows (Connect Gmail,
              Modify gmail-prod, …). The connect-data flow is
              detectable from the synthetic `connect_intro` message
              that handleConnectorPicked / handleModifyConnection
              inject as the first assistant message — that's stable
              across the lifetime of the task whether or not the
              form is currently mounted in the rail. */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            minWidth: 0, flex: '1 1 0',
            overflow: 'hidden',
          }}>
            {(() => {
              // The "Apps" crumb only makes sense while the form
              // panel is on screen — the user is mid-flow connecting
              // or modifying a connection. Once the panel is closed
              // (X button or post-save), the chat is a normal chat
              // pinned to a project, so the breadcrumb pivots to the
              // standard `Projects > <project>` shape and the Apps
              // context falls away.
              const hasConnectIntro = Array.isArray(task?.messages)
                && task.messages.some((m) => m && m._kind === 'connect_intro');
              if (hasConnectIntro && formActive) {
                return (
                  <CrumbButton
                    label="Apps"
                    onClick={() => onNavigateToConnectors?.()}
                    title="Connect Apps and Data"
                  />
                );
              }
              return (
                <>
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
                </>
              );
            })()}
            <CrumbSep />
            <div
              onMouseEnter={() => setTitleHover(true)}
              onMouseLeave={() => setTitleHover(false)}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                minWidth: 0, flex: '1 1 0',
              }}
            >
              {titleEditing ? (
                <input
                  ref={titleInputRef}
                  type="text"
                  defaultValue={task.title || ''}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      submitTitleRename();
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      cancelTitleRename();
                    }
                  }}
                  onBlur={submitTitleRename}
                  spellCheck={false}
                  autoCapitalize="none"
                  autoCorrect="off"
                  style={{
                    flex: '1 1 0', minWidth: 0,
                    fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 14,
                    letterSpacing: '0.04em', color: T.ink,
                    background: 'var(--surface-2)',
                    border: '1px solid var(--accent)',
                    borderRadius: 5, padding: '2px 6px', outline: 'none',
                  }}
                />
              ) : (
                <span
                  role="button"
                  tabIndex={0}
                  title={task.title}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (settingsOpen) { setSettingsOpen(false); return; }
                    const rect = e.currentTarget.getBoundingClientRect();
                    setSettingsAnchor(rect);
                    setSettingsOpen(true);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      const rect = e.currentTarget.getBoundingClientRect();
                      setSettingsAnchor(rect);
                      setSettingsOpen((v) => !v);
                    }
                  }}
                  style={{
                    fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 14,
                    letterSpacing: '0.04em', color: T.ink,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    overflowWrap: 'anywhere',
                    minWidth: 0, flex: '0 1 auto',
                    cursor: 'pointer',
                  }}
                >{task.title}</span>
              )}
              {task.pinned && !titleEditing && (
                <span aria-hidden style={{ display: 'inline-flex', flexShrink: 0, color: T.accent }}>
                  {Ico.pin(11)}
                </span>
              )}
              {!titleEditing && (
                <button
                  ref={settingsBtnRef}
                  type="button"
                  aria-label="Task menu"
                  title="Task menu"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (settingsOpen) {
                      setSettingsOpen(false);
                      return;
                    }
                    const rect = settingsBtnRef.current?.getBoundingClientRect();
                    setSettingsAnchor(rect || null);
                    setSettingsOpen(true);
                  }}
                  style={{
                    width: 22, height: 22, borderRadius: 5,
                    background: settingsOpen ? 'var(--surface-2)' : 'transparent',
                    border: 0,
                    color: 'var(--ink-3)',
                    display: 'inline-grid', placeItems: 'center',
                    flexShrink: 0,
                    opacity: (titleHover || settingsOpen) ? 1 : 0,
                    pointerEvents: (titleHover || settingsOpen) ? 'auto' : 'none',
                    cursor: 'pointer',
                    transition: 'opacity .15s ease, color .15s ease, background .15s ease',
                    WebkitAppRegion: 'no-drag',
                  }}
                  onMouseOver={(e) => { e.currentTarget.style.background = 'var(--surface-2)'; e.currentTarget.style.color = 'var(--ink)'; }}
                  onMouseOut={(e) => { e.currentTarget.style.background = settingsOpen ? 'var(--surface-2)' : 'transparent'; e.currentTarget.style.color = 'var(--ink-3)'; }}
                >
                  {Ico.moreVert(13)}
                </button>
              )}
            </div>
          </div>

          {/* Right side reserved for future header chips. The kebab
              and rail toggle moved out; pin lives inline with the
              title now (above) so it stays visually attached to the
              task it acts on. */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 4,
            flexShrink: 0,
          }} />
        </div>
        {/* Task menu — anchored to the kebab next to the title.
            Items: Pin/Unpin · Rename · Delete. Move-to-project,
            Schedule and Turn-into-skill are intentionally excluded
            here — the focused three-action set matches the project
            detail header's pattern. */}
        <TaskMenu
          task={task}
          projects={projects}
          open={settingsOpen}
          anchorRect={settingsAnchor}
          hideRename={false}
          hideMoveToProject
          onClose={() => setSettingsOpen(false)}
          onPin={() => onPinTask?.(task)}
          onUnpin={() => onUnpinTask?.(task.id)}
          onRename={() => setTitleEditing(true)}
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

        {/* Scrollable conversation.
            Bottom padding clears the floating composer so every
            message is reachable when scrolled to the end. Sized
            generously (~180px) because the composer grows multi-line
            as the user types longer drafts, plus the attachments
            row adds height when files / connectors are attached —
            tighter values clipped the last reply on long sessions.
            `marginBottom: 25` shortens the scroll container so the
            chat surface ends with a calm gap above the window edge
            instead of butting flush against it. */}
        <div ref={scrollRef} data-scroll="true" className="scroll-clean" style={{
          minHeight: 0, overflowY: 'auto', overflowX: 'hidden',
          padding: '32px 28px 180px',
          marginBottom: 25,
          background: 'transparent',
          WebkitAppRegion: 'no-drag',
          userSelect: 'text',
        }}>
          <div style={{
            maxWidth: 720, margin: '0 auto',
            display: 'flex', flexDirection: 'column', gap: 28,
          }}>
            <Divider label={dividerLabel(new Date())} />

            {(() => {
              // Track the assistant turn index inline so MessageActions
              // knows which user→answer cycle to delete. The walker
              // mirrors the server's `_count_displayable_assistant_bubbles`
              // contract: each assistant entry counts once. We also
              // count user-input messages so orphan users (stop before
              // any assistant response) can carry their own delete
              // affordance with the right turn index.
              let assistantTurnIdx = -1;
              let userInputIdx = -1;
              const isOrphanUser = (atIdx) => {
                // Walk forward from this user message — if we hit
                // another user before any assistant, this one is an
                // orphan. End-of-list with no assistant → orphan.
                for (let j = atIdx + 1; j < visibleMessages.length; j++) {
                  const role = visibleMessages[j]?.role;
                  if (role === 'user') return true;
                  if (role === 'assistant') return false;
                }
                return true;
              };
              return visibleMessages.map((m, i) => {
              if (m.role === 'user') {
                userInputIdx += 1;
                const turnIdxForThisUser = userInputIdx;
                const orphan = isOrphanUser(i);
                return (
                  <UserTurn
                    key={i}
                    content={m.content}
                    attachments={m.attachments}
                    time={formatTime(m.createdAt)}
                    onDelete={orphan ? () => onDeleteTurn?.(turnIdxForThisUser) : null}
                    onEdit={(text) => {
                      // Pull the message text back into the composer
                      // for refine-and-resend. Each click bumps the
                      // nonce so identical text re-fills the input
                      // even after the user has cleared it.
                      setComposerPrefill((prev) => ({
                        text,
                        bump: (prev?.bump || 0) + 1,
                      }));
                    }}
                  />
                );
              }
              if (m.role === 'activity') return null; // surfaced in the rail's Progress
              if (m._kind === 'connect_intro') {
                // The card is clickable: clicking it re-opens the
                // form panel when it's been closed. We stash the
                // original spec on the message at creation time
                // (App.jsx) so re-publishing is a one-liner. If the
                // form is currently active there's nothing to do —
                // the panel is already on the right rail.
                const cachedSpec = m._form_spec || null;
                // Card click reopens the form. Two scenarios:
                //   • Form spec is gone (user dismissed / submitted) →
                //     re-publish the cached spec so the panel mounts again.
                //   • Form is already active but the rail is closed
                //     (common on phone, where the rail starts hidden) →
                //     just slide the rail back in.
                const reopenForm = cachedSpec
                  ? () => {
                      if (!formActive) setDataVaultForm(task?.id, cachedSpec);
                      if (isNarrow) setRailNarrowOpen(true);
                      else setRailOpen(true);
                    }
                  : (isNarrow && formActive
                      ? () => setRailNarrowOpen(true)
                      : undefined);
                return (
                  <ConnectIntroBubble
                    key={i}
                    title={m.content || 'Connect'}
                    connector={m.connector}
                    onHoverChange={setFormHighlight}
                    onClickCard={reopenForm}
                    // Modify-flow extras: when set, the bubble
                    // renders Cancel + Disconnect buttons next to
                    // the card. Plain connect intros (no `_modify`)
                    // keep the original layout.
                    modify={!!m._modify}
                    onCancel={m._modify ? () => onCancelModify?.(task?.id) : undefined}
                    onDisconnect={
                      m._modify && m._engine && m._existing_name
                        ? () => onDisconnectModify?.(task?.id, m._engine, m._existing_name)
                        : undefined
                    }
                  />
                );
              }
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
              assistantTurnIdx += 1;
              // The server keys delete_turn by USER-INPUT index, not
              // by assistant index. With orphans (stop before any
              // assistant) those can drift apart, so we use the most
              // recent user-input index as the turn id for the
              // assistant — the user that started this cycle.
              const turnIdxForThisBubble = userInputIdx;
              return (
                <AnswerTurn
                  key={i}
                  state="done"
                  time={formatTime(m.createdAt)}
                  copyText={m.content}
                  onDelete={() => onDeleteTurn?.(turnIdxForThisBubble)}
                >
                  {m.steps?.length > 0 && (
                    <ThinkingBlock
                      steps={m.steps}
                      startedAt={m.startedAt}
                      isActive={false}
                      onActivateStep={(step) => setOpenScratchpadStepId(prefixId(messageKey(m, i), step.id))}
                    />
                  )}
                  <TextBlock text={m.content} id={m.id || `msg-${i}`} complete conversationId={task.id} />
                  {m.artifact && (
                    <ArtifactCard
                      artifact={normalizeArtifactRecord(m.artifact, artifactProjectPath)}
                      onOpen={handleArtifactOpen}
                    />
                  )}
                  <StepArtifacts steps={m.steps} onOpen={handleArtifactOpen} projectPath={artifactProjectPath} />
                </AnswerTurn>
              );
              });
            })()}

            {streamingMsg ? (
              <AnswerTurn state="thinking" time={formatTime(Date.now())} showActions={false} slotIdHeader="header:streaming">
                {streamingMsg.steps?.length > 0 && (
                  <ThinkingBlock
                    steps={streamingMsg.steps}
                    startedAt={streamingMsg.startedAt}
                    isActive={streamingMsg.streamStatus !== 'done' && streamingMsg.streamStatus !== 'streaming'}
                    onActivateStep={(step) => setOpenScratchpadStepId(prefixId(streamingKey, step.id))}
                  />
                )}
                {/* Bridge state: between the first stream event arriving
                    (which strips the activity placeholder) and the first
                    step or body chunk landing, the AnswerTurn would
                    otherwise render empty — the user sees the message
                    "appear, vanish, then come back" once scratchpad
                    output starts. Keep a soft "Thinking…" affordance
                    visible whenever there are no steps and no body text
                    yet. */}
                {!streamingMsg.steps?.length && !streamingMsg.content && (
                  <div style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    fontFamily: FONT_MONO, fontSize: 11, color: T.ink4,
                  }}>
                    <StreamCursor />
                    <span>Thinking…</span>
                  </div>
                )}
                {streamingMsg.content && (
                  <div style={{ position: 'relative' }}>
                    <TextBlock text={streamingMsg.content} id="streaming" complete={false} conversationId={task.id} />
                    <StreamCursor />
                  </div>
                )}
                <StepArtifacts steps={streamingMsg.steps} onOpen={handleArtifactOpen} projectPath={artifactProjectPath} />
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

        {/* Floating composer — no gradient fade behind it. Earlier we
            had a 220px linear-gradient(transparent → var(--bg)) overlay
            so messages would soften into the bg above the composer, but
            with the gravity-field showing through it read as a dark
            band at the bottom of the chat. The composer's own border +
            shadow give enough visual separation on its own. */}
        <div className="chat-floating-composer" style={{
          position: 'absolute', left: 28, right: 28, bottom: 22,
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          gap: 8,
          pointerEvents: 'auto',
          ['--composer-max-width']: '720px',
        }}>
          {/* Queued-messages strip — pills with each waiting prompt
              + a × to drop it. The pills cross-fade in/out so the
              transition between queue states reads as deliberate. */}
          {queuedMessages.length > 0 && (
            <div style={{
              width: '100%', maxWidth: 720,
              display: 'flex', flexDirection: 'column',
              gap: 6,
              padding: '10px 12px',
              borderRadius: 14,
              background: 'color-mix(in srgb, var(--accent) 8%, var(--surface))',
              border: '1px solid color-mix(in srgb, var(--accent) 22%, var(--line))',
              boxShadow: '0 8px 24px rgba(0,0,0,0.10)',
              animation: 'queue-pop-in 220ms cubic-bezier(0.32, 0.72, 0, 1)',
            }}>
              <div style={{
                fontFamily: 'var(--font-mono)', fontSize: 10.5,
                color: 'var(--accent)', letterSpacing: '0.08em',
                textTransform: 'uppercase',
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                <span className="pulse-dot" style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: 'var(--accent)',
                  boxShadow: '0 0 6px var(--accent-glow)',
                }} />
                {queuedMessages.length} queued · waiting for Anton
              </div>
              <div style={{
                display: 'flex', flexWrap: 'wrap', gap: 6,
              }}>
                {queuedMessages.map((q) => (
                  <span
                    key={q.id}
                    title={q.text}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      maxWidth: '100%',
                      padding: '5px 4px 5px 12px',
                      borderRadius: 999,
                      background: 'var(--surface)',
                      border: '1px solid var(--line)',
                      fontFamily: 'var(--font-body)', fontSize: 12.5,
                      color: 'var(--ink-2)',
                      transition: 'background 120ms ease, border-color 120ms ease',
                    }}
                  >
                    <span style={{
                      maxWidth: 360,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{q.text}</span>
                    <button
                      type="button"
                      onClick={() => onRemoveFromQueue?.(q.id)}
                      title="Remove from queue"
                      aria-label="Remove from queue"
                      style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        width: 20, height: 20, borderRadius: 999,
                        background: 'transparent', border: 0,
                        color: 'var(--ink-4)', cursor: 'pointer',
                        flexShrink: 0,
                      }}
                      onMouseOver={(e) => {
                        e.currentTarget.style.background = 'color-mix(in srgb, var(--danger) 14%, transparent)';
                        e.currentTarget.style.color = 'var(--danger)';
                      }}
                      onMouseOut={(e) => {
                        e.currentTarget.style.background = 'transparent';
                        e.currentTarget.style.color = 'var(--ink-4)';
                      }}
                    >{Ico.close(11)}</button>
                  </span>
                ))}
              </div>
            </div>
          )}
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
            conversationId={task.id}
            disabledConnections={disabledConnections ?? task.disabledConnections ?? []}
            onUpdateConnectorMute={onUpdateConnectorMute}
            onRemoveAttachment={onRemoveAttachment}
            placeholder="Reply…"
            metaReadOnly
            hideMeta
            streaming={isStreaming}
            onStop={onStop}
            prefill={composerPrefill}
          />
        </div>
      </div>

      {/* ─── Right rail ─── */}
      {/* On narrow screens: translucent backdrop behind the overlay rail */}
      {isNarrow && (
        <div
          onClick={() => setRailNarrowOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 50,
            background: 'rgba(0,0,0,0.35)',
            backdropFilter: 'blur(2px)',
            opacity: railOverlayOpen ? 1 : 0,
            pointerEvents: railOverlayOpen ? 'auto' : 'none',
            transition: 'opacity 280ms cubic-bezier(0.32, 0.72, 0, 1)',
            WebkitAppRegion: 'no-drag',
          }}
        />
      )}
      <aside className="chat-rail-aside" style={isNarrow ? {
        // Narrow: fixed overlay that slides in from the right
        position: 'fixed',
        top: 9, bottom: 9, right: 9,
        width: 'min(85vw, 320px)',
        zIndex: 51,
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 14,
        boxShadow: 'var(--sh-2)',
        transform: railOverlayOpen ? 'translateX(0)' : 'translateX(calc(100% + 18px))',
        transition: 'transform 380ms cubic-bezier(0.22, 1, 0.36, 1)',
        padding: '14px 14px 22px',
        display: 'flex', flexDirection: 'column', gap: 10,
        overflowX: 'hidden', overflowY: 'auto',
        WebkitAppRegion: 'no-drag',
      } : {
        // Wide: inline grid column
        background: 'transparent',
        padding: '14px 14px 22px',
        visibility: effectiveRailOpen ? 'visible' : 'hidden',
        opacity: effectiveRailOpen ? 1 : 0,
        transition: 'opacity 180ms ease',
        display: 'flex', flexDirection: 'column', gap: 10,
        overflowX: 'hidden',
        overflowY: 'auto',
        minWidth: 0,
        WebkitAppRegion: 'no-drag',
      }}>
        {/* Rail header bar — collapse button. Stays visible on mobile
            so the user has an explicit way to dismiss the rail (which
            on phone hosts the data-vault form fullscreen). The
            FLOATING expand button outside is the one hidden via
            .chat-rail-toggle in globals.css. */}
        <div className="chat-rail-close-row" style={{
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
          flexShrink: 0,
        }}>
          <button
            type="button"
            className="chat-rail-close"
            onClick={() => isNarrow ? setRailNarrowOpen(false) : setRailOpen(false)}
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
        {/* Data-vault form panel — mounts when the conversation has
            an active data-vault-form spec; the form's submit/skip/
            cancel actions become a synthetic chat continuation that
            re-enters the stream so anton can iterate on the form.
            Wrapped in an error boundary so a malformed form spec
            (or render glitch) can't blank the chat surface. */}
        <FormErrorBoundary>
          <DataVaultFormPanel
            conversationId={task.id || ''}
            onContinue={(payload) => onSend?.(payload?.text || '[form action]')}
            onSubmit={onSubmitDataVaultForm}
            onNavigateToConnectors={onNavigateToConnectors}
            highlighted={formHighlight}
          />
        </FormErrorBoundary>
        <ProgressBox
          steps={railSteps}
          streamStatus={streamingMsg?.streamStatus}
          conversationId={task.id || ''}
          onActivateStep={(step) => railMsgKey
            ? setOpenScratchpadStepId(prefixId(railMsgKey, step.id))
            : null}
        />
        {!formActive && (
          <WorkingFolderBox
            project={project}
            isStreaming={isStreaming}
          />
        )}
        {!formActive && (
          <ContextBox
            project={project}
            conversationId={task?.id}
            refreshKey={task?.messages?.length ?? 0}
          />
        )}
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
        steps={scratchpadStepsPool}
        focusStepId={openScratchpadStepId}
      />

      {/* Inline ArtifactCard viewer — same modal the Live artifacts
          page and the Working folder card use. The card only routes
          HTML here; non-HTML opens straight in the OS via openPath. */}
      <ArtifactViewer
        open={!!previewArt}
        artifact={previewArt}
        onClose={() => setPreviewArt(null)}
        onChange={(updated) => setPreviewArt(updated)}
      />
    </div>
  );
}
