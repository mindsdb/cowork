/* Anton Chat — Direction A: Conservative.
   Near-1:1 port of docs/design-guidelines/chat.html (ChatConservative).
   Editorial, document-like. Inter body, Inter headings, mono for operator
   metadata. Centered ~720px column, OrbitMorph-led Anton turns, floating
   composer, right rail with collapsible cards.

   Wired against the live message model (role: user|assistant|error|activity,
   plus _streaming) and our real Composer + project/model state. Tokens come
   from CSS vars so the panel reads correctly in both light and dark themes. */

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { projectLabel } from '../lib/projectLabel';
import { cn } from '../lib/cn';
import { createPortal } from 'react-dom';
import Ico from '../components/Icons';
import ArtifactRepairCard from '../components/ArtifactRepairCard';
import { parseArtifactRepairPrompt } from '../lib/artifactRepairPrompt';
import Composer from '../components/Composer';
import CodingTerminal from '../components/CodingTerminal';
import { ActionBar, Alert, Badge, Card, Tooltip } from '../components/ui';
import { MarkdownContent } from '../components/markdown/MarkdownContent';
import { ThinkingBlock } from '../components/thinking/ThinkingBlock';
import { WorkingIndicator } from '../components/thinking/WorkingIndicator';
import { OrbitProvider } from '../lib/orbitRegistry';
import { copyText } from '../lib/clipboard';
import { TaskMenu } from '../components/TaskMenu';
import { ScratchpadModal } from '../components/thinking/ScratchpadModal';
import { ProgressBox, WorkingFolderBox, ContextBox } from '../components/rail';
import { ArtifactViewer } from '../components/artifact';
import SkillCard from '../components/SkillCard';
import AskUserCard from '../components/AskUserCard';
import ChatCardShell, { cardActions } from '../components/ChatCardShell';
import { DataVaultFormPanel } from '../components/datavault/DataVaultFormPanel';
import { getForm as getDataVaultForm, setForm as setDataVaultForm, subscribe as subscribeDataVaultForm, clearForm as clearDataVaultForm } from '../components/datavault/formStore';
import { FormErrorBoundary } from '../components/datavault/FormErrorBoundary';
import { revealArtifact, attachmentRawUrl, artifactServeUrl, fetchHealth } from '../api';
import { AttachmentThumbnail, useBlobImageSrc } from '../components/AttachmentThumbnail';
import { normalizeArtifactRecord } from '../lib/artifactPaths';
import { canDownloadOrgDraft, canPreviewLocally, canPreviewOrgDraft, isImageArtifact } from '../lib/artifactKinds';
import { downloadArtifactFile } from '../lib/artifactDownload';
import { openAuthenticatedResource } from '../lib/authenticatedResource';
import { latestSkillCardIndexByKey } from '../lib/skillCards';
import { nextScrollAnchor } from '../lib/scrollAnchor';
import { host, isWeb } from '../../platform/host';
import { Crumb as CrumbButton, CrumbSep } from '../components/ui/Crumb';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { useRevealOnHover } from '../hooks/useRevealOnHover';
import { harnessLabel } from '../lib/agentLabel';
import { artifactOpenTarget } from '../lib/artifactActions';
import { revalidate as revalidateArtifacts, setArtifactsScope, useArtifactLiveness } from '../lib/artifactsStore';
import { useOrgMode } from '../../lib/orgMode';
import { displayModelLabel } from '../lib/settingsTransform';
import { providerOverloadedButtons } from '../lib/turnErrorActions';
import { isSkippedFailedAssistant, isOrphanUser as isOrphanUserPure, lastVisibleTurnIdx } from '../lib/turnVisibility';
import { isThinkingActive } from '../lib/thinkingActive';
import { splitTurnSegments, liveSegmentIndex } from '../lib/turnSegments';
import { MINDS_BILLING_URL } from '../../lib/mindsUrls';
import { trackBillingOpened, trackKeyProvisioningRefused } from '../lib/analytics';
import { useHubUsageContext } from '../lib/hubUsageContext';
import { USAGE_ACTIONS, usageActionUrl, formatResetTime, formatPercentShort, freeAllowanceState, isBalanceEmpty, allowanceStopCopy, freeServingPausedCopy } from '../lib/usageWarnings';
import { MINDSHUB_AIR_MODEL_ID } from '../lib/modelCatalog';
import { usageNoticeBuckets } from '../lib/usageNoticePlacement';

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

const FONT_MONO    = "var(--font-mono)";

// ─── small shared atoms ──────────────────────────────────────────────────
function formatTime(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

// Footer meta under an answer — "Jun 21, 7:39 AM". Date included because
// the meta is the only per-turn timestamp now that the eyebrow is gone.
function formatMetaTime(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const month = d.toLocaleString('en-US', { month: 'short' });
  return `${month} ${d.getDate()}, ${formatTime(d)}`;
}

// ─── Shared turn-action toolbar ──────────────────────────────────────────
// Used by both user and assistant turns for consistent styling. Actions
// fade in on hover of the parent turn, but stay visible when `isLast`
// is true (matching Claude's pattern where the most recent exchange
// always shows its toolbar).
const ICON_SZ = 16;
function TurnActions({ getText, onEdit, onDelete, isLast = false, align = 'left' }) {
  const [copied, setCopied] = useState(false);
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
    <div
      className={`turn-actions${isLast ? ' is-last' : ''} ${align === 'right' ? 'justify-end' : 'justify-start'}`}
    >
      {onEdit && (
        <Tooltip content="Edit and resend">
          <button
            type="button"
            className="turn-action-btn"
            onClick={onEdit}
            aria-label="Edit and resend this message"
          >
            {Ico.edit ? Ico.edit(ICON_SZ) : Ico.pencil ? Ico.pencil(ICON_SZ) : Ico.code(ICON_SZ)}
          </button>
        </Tooltip>
      )}
      <Tooltip content={copied ? 'Copied' : 'Copy'}>
        <button
          type="button"
          className="turn-action-btn"
          aria-label={copied ? 'Copied' : 'Copy'}
          onClick={onCopy}
          // cascade-forced: .turn-action-btn sets `color: inherit` at rest, which
          // beats a text-accent utility (equal specificity, globals.css loads later).
          style={copied ? { color: 'var(--accent)' } : undefined}
        >
          {copied ? Ico.check(ICON_SZ) : Ico.copy(ICON_SZ)}
        </button>
      </Tooltip>
      {onDelete && (
        <Tooltip content="Delete">
          <button
            type="button"
            className="turn-action-btn turn-action-btn--danger"
            aria-label="Delete"
            onClick={onDelete}
          >
            {Ico.trash(ICON_SZ)}
          </button>
        </Tooltip>
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
// TurnActions and removes both halves. The orphan case has no
// assistant bubble, so we surface the delete here instead.
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
  const iconName = connector?.logo || 'database';
  const Icon = (Ico[iconName] || Ico.database);
  const clickable = typeof onClickCard === 'function';
  // No "Anton" eyebrow on this bubble — the follow-up assistant
  // turn that always renders right after it carries its own,
  // and two headers stacked back-to-back read as a stutter. The
  // card itself is visually distinct enough to stand on its own.
  return (
    <div className="flex flex-col gap-2 pb-1">
      <div className="flex items-center gap-2.5 flex-wrap">
        <div
          role={clickable ? 'button' : undefined}
          tabIndex={clickable ? 0 : undefined}
          onClick={clickable ? onClickCard : undefined}
          onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClickCard(); } } : undefined}
          onMouseEnter={() => onHoverChange?.(true)}
          onMouseLeave={() => onHoverChange?.(false)}
          className={`inline-flex items-center gap-3 py-3 px-3.5 rounded-xl max-w-[78%] outline-none bg-surface border border-solid border-line hover:border-accent hover:bg-[color-mix(in_srgb,var(--accent)_10%,var(--surface))] hover:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_18%,transparent)] transition-[border-color,background,box-shadow] duration-hover ease-[ease] ${clickable ? 'cursor-pointer' : 'cursor-default'}`}
        >
          <span
            className="inline-grid place-items-center w-9 h-9 rounded-lg bg-surface-2 flex-shrink-0"
            style={{ color: connector?.logo_color || 'var(--ink-3)' }}
          >
            {Icon(20)}
          </span>
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="font-display font-semibold text-base text-ink tracking-normal">{title}</span>
            <span className="font-body text-sm text-ink-3">
              {clickable
                ? <>Click to re-open the form <span aria-hidden className="text-accent">→</span></>
                : <>Fill out the form on the side panel <span aria-hidden className="text-accent">→</span></>}
            </span>
          </div>
        </div>
        {modify && (
          <div className="inline-flex items-center gap-1.5">
            {onCancel && (
              <ConnectIntroPillButton
                kind="ghost"
                onClick={onCancel}
                // Inline left-arrow glyph — Icons.jsx doesn't ship a
                // chevronLeft yet, and the `←` matches the "Back to
                // options" treatment used elsewhere in the codebase.
                renderIcon={() => (
                  <span aria-hidden className="text-base leading-none inline-block -mt-px">←</span>
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
  const isDanger = kind === 'danger';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 py-1.5 px-3 rounded-full font-body text-sm font-medium cursor-pointer transition-colors duration-hover ease-[ease] border border-solid ${
        isDanger
          ? 'bg-[color-mix(in_srgb,var(--danger)_8%,transparent)] border-[color-mix(in_srgb,var(--danger)_30%,transparent)] text-danger hover:bg-[color-mix(in_srgb,var(--danger)_14%,transparent)] hover:border-[color-mix(in_srgb,var(--danger)_45%,transparent)]'
          : 'bg-transparent border-transparent text-ink-3 hover:bg-[var(--ghost-hover)] active:bg-[var(--ghost-press)] hover:text-ink'
      }`}
    >
      <span className="inline-flex items-center">
        {typeof renderIcon === 'function' ? renderIcon(14) : null}
      </span>
      {label}
    </button>
  );
}

function userTurnAttachmentIcon(a) {
  const src = a.source || a.kind || 'file';
  if (src === 'connector') return Ico.link(14);
  if (a.mime && String(a.mime).startsWith('image/')) return Ico.image(14);
  return Ico.doc(14);
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

// Long user messages clamp to ~8 lines behind a "Show more" toggle so a big
// pasted prompt doesn't dominate the viewport before the answer starts.
const USER_CLAMP_MAX_PX = 176;

function UserTurn({ content, attachments, time, onDelete, onEdit, isLast, projectName, projectId, conversationId, streaming = false, deleting = false }) {
  const contentRef = useRef(null);
  const [collapsed, setCollapsed] = useState(true);
  const [overflowing, setOverflowing] = useState(false);
  // An "Address with agent" handoff is a machine prompt — ids, a base revision
  // and the raw thread JSON — so it renders as a card rather than as the wall of
  // identifiers it literally is. Null for every ordinary message.
  const repair = parseArtifactRepairPrompt(content);
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return undefined;
    // scrollHeight reports full content height even while max-height clamps
    // the box, so overflow is measurable without expanding first. Re-runs on
    // width changes (sidebar toggle, window resize) via the ResizeObserver.
    const measure = () => setOverflowing(el.scrollHeight > USER_CLAMP_MAX_PX + 8);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [content]);
  return (
    <div
      className={`user-turn${deleting ? ' opacity-60 [transition:opacity_var(--dur-hover)_ease]' : ''}`}
      aria-busy={deleting || undefined}
    >
      <div className="user-turn-inner">
        <div className="user-turn-bubble">
          {/* User messages flow through the same markdown pipeline as
              assistant turns so fenced code blocks, bold/italic, lists,
              etc. typed in the composer render properly. Forms and
              charts are gated off so a user typing a special fence in
              the composer can't trigger the side-effect renderers
              reserved for assistant output. */}
          {repair ? (
            <ArtifactRepairCard
              repair={repair}
              projectId={projectId}
              streaming={streaming}
            />
          ) : (
          <div
            ref={contentRef}
            className={collapsed && overflowing ? 'user-turn-clamp user-turn-clamp--faded' : undefined}
            style={collapsed && overflowing ? { maxHeight: USER_CLAMP_MAX_PX } : undefined}
          >
            <MarkdownContent
              text={content}
              variant="user"
              enableForms={false}
              enableCharts={false}
            />
          </div>
          )}
          {!repair && overflowing && (
            <button
              type="button"
              className="user-turn-more"
              aria-expanded={!collapsed}
              onClick={() => setCollapsed((c) => !c)}
            >
              {collapsed ? 'Show more' : 'Show less'}
            </button>
          )}
        </div>
        {attachments?.map((a) => {
          // Image attachments preview inline as a thumbnail (fetched as a
          // blob — the CSP blocks a direct loopback <img src>). Clicking
          // opens the full image via the OS/browser. We can only build the
          // raw URL when the conversation is project-scoped; without it,
          // fall back to the icon+name chip.
          const isImage = a.mime && String(a.mime).startsWith('image/');
          const rawUrl = isImage ? attachmentRawUrl(projectName, conversationId, a.id) : null;
          if (rawUrl) {
            return (
              <AttachmentThumbnail
                key={a.id}
                url={rawUrl}
                alt={a.name || 'Image'}
                onOpen={() => {
                  openAuthenticatedResource(rawUrl, { filename: a.name }).catch(() => {});
                }}
              />
            );
          }
          return (
            <div key={a.id} className="user-turn-attachment">
              <span className="user-turn-attachment-icon">
                {userTurnAttachmentIcon(a)}
              </span>
              <span className="user-turn-attachment-name">{userTurnAttachmentLabel(a)}</span>
              <span className="user-turn-attachment-meta">{userTurnAttachmentMeta(a)}</span>
            </div>
          );
        })}
        {deleting ? (
          <span
            // Primary ink, not the usual meta grey: the turn around it is at
            // 60% opacity, which drags --ink-4 to roughly 1.7:1 against the page.
            className="font-[family-name:var(--font-body)] text-[13px] leading-[1.5] text-ink shrink-0 mt-1"
          >
            Deleting…
          </span>
        ) : (
          <TurnActions
            getText={() => content || ''}
            onEdit={onEdit ? () => onEdit(content) : null}
            onDelete={onDelete}
            isLast={isLast}
            align="right"
          />
        )}
      </div>
    </div>
  );
}

// OrbitProvider `size` for the chat orb — WorkingIndicator's anchor
// box matches this so the morph centers on it exactly.
const CHAT_ORB_SIZE = 22;

// ─── Anton answer turn — content stack ────────────────────────────────────
// No eyebrow header: while in flight the ThinkingBlock / WorkingIndicator
// is the single indicator; once done, a hover-only footer (bottom-right)
// names the agent that answered and when.
function AnswerTurn({ state = 'done', time, children, showActions = true, copyText, onDelete, agentLabel, isLast, deleting = false }) {
  return (
    <div
      // marginTop pulls the answer closer to ITS question (the column gap
      // is sized for the roomier answer → next-question separation).
      className={`answer-turn flex flex-col gap-2.5 -mt-2.5 pb-1${deleting ? ' opacity-60 [transition:opacity_var(--dur-hover)_ease]' : ''}`}
      aria-busy={deleting || undefined}
    >
      {children}
      {state !== 'thinking' && (
        <div className="flex items-center gap-2">
          {showActions && !deleting && (
            <TurnActions getText={() => copyText || ''} onDelete={onDelete} isLast={isLast} />
          )}
          {/* Agent always named; the timestamp joins it when the caller
              resolved one. No message row carries `createdAt` — the server
              sends `created_at` and nothing maps it. */}
          <span className="turn-meta">
            {time ? `${time} · ` : ''}{agentLabel || 'Anton'}
          </span>
        </div>
      )}
    </div>
  );
}

function TextBlock({ text, id, complete = true, conversationId = null }) {
  // Full markdown rendering — GFM tables, lists, code blocks (with
  // chartjs/chart and data-vault-form support), links, etc. via
  // react-markdown + our MarkdownContent override map.
  return <MarkdownContent text={text} id={id} complete={complete} conversationId={conversationId} isAssistant />;
}

// Convert an artifact step (from the SSE adapter, badge='Artifact')
// into the shape ArtifactCard expects. Used to render inline cards
// at the end of an assistant turn — like mdb-ai surfaces results.
export function artifactStepToCard(step, projectPath) {
  const data = step.data || {};
  const path = data.file_path || data.path || '';
  // Lower-cased extension (no leading dot) for HTML detection downstream.
  const ext = (path.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
  const card = normalizeArtifactRecord({
    // Preserve the complete server card that the stream adapter stored. In
    // particular, id + draftUrl + capabilities are what make the
    // immediately opened viewer editable and reviewable. Keeping the payload
    // whole also prevents each new artifact field from requiring another
    // fragile pass-through list here.
    ...data,
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
//
// `live` says whether these steps belong to a turn still in flight. It rides
// down to the card because an artifact the agent created THIS turn cannot be in
// an artifacts index that was loaded before it existed, and judging it against
// one would mark a brand-new artifact "Deleted".
function StepArtifacts({ steps, onOpen, projectPath, live = false }) {
  const artifacts = steps?.filter((s) => s.badge === 'Artifact') || [];
  if (artifacts.length === 0) return null;
  return (
    <div className="flex flex-col gap-3 mt-1">
      {artifacts.map((s) => (
        <ArtifactCard
          key={s.id}
          artifact={artifactStepToCard(s, projectPath)}
          onOpen={onOpen}
          live={live}
        />
      ))}
    </div>
  );
}

// One turn's steps and ask_user cards, rendered in event order: work done
// after an answer appears below that answer's card, not above it (ENG-2981).
// Segments and the per-question expiry rules come from `splitTurnSegments`.
//
// `live` is set only for the streaming turn. It marks the ONE segment that
// carries the in-flight header (orb slot, live thought, working label) —
// `liveSegmentIndex` puts it above a pending card and below an answered one.
// Every other segment is a finished, collapsed block.
// Step ids repeat across turns (`step-1` in every turn); prefixed with the
// turn's key they are unique across the conversation.
const prefixId = (msgKey, stepId) => `${msgKey}::${stepId}`;

// A tool's message to the user, rendered like an agent message. Memoised: the
// live turn re-renders on every progress line, the message never changes.
const ToolMessage = memo(function ToolMessage({ markdown, id, conversationId }) {
  return (
    <MarkdownContent
      text={markdown}
      id={id}
      complete
      conversationId={conversationId}
      isAssistant
      enableForms={false}
    />
  );
});

function TurnSegments({ steps, startedAt, conversationId, conversationLive, onAnswered, onActivateStep, live = null, idPrefix = '' }) {
  const segments = useMemo(
    () => splitTurnSegments(steps, { startedAt, conversationLive }),
    [steps, startedAt, conversationLive],
  );
  const liveIdx = live ? liveSegmentIndex(segments) : -1;
  // The live segment sits right before a pending question, if there is one.
  const next = live ? segments[liveIdx + 1] : null;
  const pendingQuestion = next?.kind === 'question' && !next.step.data?.answer ? next.step : null;
  // Any boundary — a question card or a tool's message — keeps the live
  // header up for the rest of the turn: without it the working indicator
  // vanishes while the segment below the boundary is still empty.
  const hasBoundary = segments.length > 1;

  const out = [];
  let prevWasCard = false;
  segments.forEach((seg, idx) => {
    if (seg.kind === 'message') {
      out.push(
        // Same spacing as a question card: the message is not part of a block.
        <div key={seg.key} style={{ marginTop: prevWasCard ? 12 : 4 }}>
          <ToolMessage
            markdown={seg.step.data?.markdown || ''}
            id={prefixId(idPrefix, seg.step.id)}
            conversationId={conversationId}
          />
        </div>,
      );
      prevWasCard = true;
      return;
    }
    if (seg.kind === 'question') {
      out.push(
        // Spacing: 4px under a block, 12px between consecutive cards.
        <div key={seg.key} style={{ marginTop: prevWasCard ? 12 : 4 }}>
          <AskUserCard
            step={seg.step}
            conversationId={conversationId}
            expired={seg.expired}
            onAnswered={onAnswered}
          />
        </div>,
      );
      prevWasCard = true;
      return;
    }
    if (idx === liveIdx) {
      // Same condition the single streaming ThinkingBlock used: also the
      // pre-step "Thinking…" placeholder, so right after an answer the empty
      // segment below the card shows that work has resumed. In a turn that
      // asked a question it is also shown for as long as the turn runs, even
      // with no steps of its own: before the split the AskUser step counted
      // as a step and kept this header — and the orb slot it carries — up to
      // the end of the turn. Without that the working indicator would vanish
      // while a question waits after streamed text, or once the closing text
      // starts streaming below the answered card.
      const show = seg.steps.length > 0
        || live.currentThought?.text
        || (live.isActive && !live.hasBodyText)
        || pendingQuestion
        || (live.isActive && hasBoundary);
      if (!show) return;
      // The header stays the WORKING message — never the live thought text.
      // When collapsed, ThinkingBlock appends the model-wait status after it.
      // While a question waits, it is the question's label, as before this
      // split (the AskUser step was the last in-progress step).
      const active = [...seg.steps].reverse().find((s) => s.status === 'in_progress');
      out.push(
        <ThinkingBlock
          key={seg.key}
          steps={seg.steps}
          startedAt={seg.startedAt}
          isActive={live.isActive}
          slotId={live.slotId}
          currentThought={live.currentThought}
          currentLabel={pendingQuestion ? pendingQuestion.label : (active?.label || live.placeholderLabel || null)}
          onActivateStep={onActivateStep}
        />,
      );
      prevWasCard = false;
      return;
    }
    if (seg.steps.length === 0) return;
    out.push(
      <ThinkingBlock
        key={seg.key}
        steps={seg.steps}
        startedAt={seg.startedAt}
        isActive={false}
        onActivateStep={onActivateStep}
      />,
    );
    prevWasCard = false;
  });
  return out;
}

// Renders any badge='Skill' steps as inline SkillCards — a skill the agent
// BUILT this turn. Sibling of StepArtifacts, but explicitly NOT the artifact
// system: a skill is a draft the user saves or downloads from the card.
function StepSkills({ steps, latestByKey, messageIndex, projectName }) {
  let skills = steps?.filter((s) => s.badge === 'Skill') || [];
  // Show a skill card only at the latest turn that emitted its slug — earlier
  // (superseded) copies are hidden so the chat holds one card per skill.
  if (latestByKey && messageIndex != null) {
    skills = skills.filter((s) => latestByKey.get(s._skillKey || s.data?.slug || s.id) === messageIndex);
  }
  if (skills.length === 0) return null;
  return (
    <div className="flex flex-col gap-3 mt-1">
      {skills.map((s) => (
        <SkillCard key={s.id} skill={s.data || {}} projectName={projectName} />
      ))}
    </div>
  );
}

export function ArtifactCard({ artifact, onOpen, live = false }) {
  // This card is an artifact surface like the panel's rows, so it answers to the
  // same deployment gate. Without it the chat offered a local preview, Export
  // and Show in Finder for content an org deployment does not serve, while the
  // panel had already stopped offering them for the very same artifact.
  const orgMode = useOrgMode();
  // Same question the artifacts panel answers by simply not listing the row:
  // is this artifact still there? The card outlives the artifact because it is
  // rendered from the turn's persisted stream events, which no delete rewrites.
  const deleted = useArtifactLiveness(artifact, { live });
  const [status, setStatus] = useState(null);
  const statusTimerRef = useRef(null);
  useLayoutEffect(() => () => {
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
  }, []);

  const path = artifact.canonicalPath || artifact.file_path || artifact.path;
  const displayPath = artifact.displayPath || path;
  const disabledReason = artifact.actionDisabledReason || '';
  const canAct = !!path && !disabledReason && !deleted;
  const platform = host.getPlatform();
  const revealLabel = platform === 'darwin' ? 'Show in Finder' : 'Show in folder';

  const showStatus = (kind, text) => {
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    setStatus({ kind, text });
    statusTimerRef.current = setTimeout(() => setStatus(null), kind === 'ok' ? 1800 : 3200);
  };

  // An action that failed may have failed because the artifact is gone. Ask the
  // server rather than guess from the error: a 404 detail, an Electron bridge
  // `{ ok: false }` and a transient network blip are indistinguishable here, and
  // only the artifacts list can settle it. Best-effort — a failed revalidation
  // just leaves the card as it was.
  const revalidateAfterFailure = () => { revalidateArtifacts().catch(() => {}); };

  /*
   * Match the Working folder card's behavior: HTML and text artifacts
   * (.md/.txt/.csv) and images open the in-app viewer — HTML via sandboxed
   * iframe, text via inline markdown / table / preformatted render, images
   * from the serve URL. Anything else falls through to the OS handler via the
   * Electron bridge. In org mode the same question is answered from the
   * authenticated draft URL instead, which rules images and fullstack apps out.
   */
  const isImage = isImageArtifact(artifact);
  const canPreviewInline = canPreviewLocally(artifact);
  const canPreviewDraft = canPreviewOrgDraft(artifact);
  // Thumbnail bytes for the icon slot — same CSP workaround AttachmentThumbnail
  // uses (loopback <img src> is blocked; fetch + blob: URL is not). '' when not
  // an image, or before the artifact card carries a serveUrl (org mode, or the
  // live-turn card streamed in ahead of ChatView.jsx's serveUrl passthrough).
  const { src: thumbSrc } = useBlobImageSrc({ url: isImage ? (artifactServeUrl(artifact) || null) : null });
  const published = !!artifact.publishedUrl;
  const openTarget = artifactOpenTarget({
    orgMode,
    published,
    canPreviewInline,
    canPreviewDraft,
    hasBridge: host.isElectron || !host.isWeb,
    hasDraft: canDownloadOrgDraft(artifact),
  });
  /*
   * Org-mode destinations are addressed by the server card, through the draft
   * URL or the shared URL, so a path this client could not canonicalize does
   * not disable them. Desktop still needs the local path it hands to the OS.
   *
   * `deleted` stays in both branches. It is the one term of `canAct` that says
   * nothing about addressing: a deleted artifact has a perfectly good draft URL
   * and still cannot be opened, so dropping it here would leave a tombstoned
   * card looking live and hand the whole guard to handleOpen alone.
   */
  const canActivate = orgMode ? (!!openTarget && !deleted) : canAct;
  const activateLabel = openTarget === 'published'
    ? 'Open shared artifact'
    : openTarget === 'download'
      ? 'Download'
      : openTarget === 'os' ? 'Open' : 'Open preview';
  /*
   * What the card says when it has nowhere to go. Org mode has no local file to
   * blame, and blaming one is actively wrong there: the card prints its own
   * server path two lines down. Desktop keeps the path reason it can act on.
   */
  const noDestinationReason = orgMode && !openTarget
    ? 'This artifact cannot be previewed and has no shared link yet.'
    : (disabledReason || 'No file path');
  /*
   * The shared URL stays reachable beside the preview: it is the address a
   * collaborator gets, and the chat turn is where the artifact was just made.
   *
   * `host.openExternal` is async, so the await is what makes the catch reach a
   * rejected bridge call. Without it the try block returns before the promise
   * settles: the fallback below never runs on the one failure it exists for,
   * and the rejection escapes as an unhandled one.
   */
  const handleOpenPublished = async () => {
    try { await host.openExternal(artifact.publishedUrl); }
    catch { window.open(artifact.publishedUrl, '_blank', 'noopener,noreferrer'); }
  };
  const handleOpen = async () => {
    /*
     * The branches that need no local file return before the `canAct` check, so
     * they would survive a deletion. Their buttons are not rendered in that
     * state, but relying on two conditions in different parts of the file
     * agreeing is not worth the risk.
     */
    if (deleted) {
      showStatus('error', 'This artifact was deleted.');
      return;
    }
    if (openTarget === 'preview' && onOpen) {
      /*
       * The viewer reads the draft URL in org mode and the local bytes on
       * desktop, so it opens on either without a canonical path of its own.
       */
      onOpen(artifact);
      return;
    }
    if (openTarget === 'published') {
      await handleOpenPublished();
      return;
    }
    if (openTarget === 'download') {
      /*
       * Org mode, an artifact the draft cannot render and nobody shared: the
       * authenticated draft URL still streams the file, so the click saves it
       * instead of dead-ending on "no shared link yet" (ENG-2044).
       */
      handleDownload();
      return;
    }
    if (openTarget === null) {
      showStatus('error', orgMode
        ? noDestinationReason
        : (disabledReason || 'No artifact file path is available.'));
      return;
    }
    if (!canAct) {
      showStatus('error', disabledReason || 'No artifact file path is available.');
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
      revalidateAfterFailure();
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
      revalidateAfterFailure();
    }
  };
  const handleDownload = async () => {
    /*
     * `canAct` is a desktop notion — a canonical local path. Org mode addresses
     * the file by its draft URL and never has such a path, so gating on it
     * there would refuse the one action that works. `deleted` still applies.
     */
    if (orgMode ? deleted : !canAct) {
      showStatus('error', orgMode
        ? 'This artifact was deleted.'
        : (disabledReason || 'No artifact file path is available.'));
      return;
    }
    if (!(await downloadArtifactFile(artifact, { actionPath: path }))) {
      showStatus('error', 'This artifact has no downloadable file yet.');
      return;
    }
    showStatus('ok', 'Downloading…');
  };
  /*
   * One primary action button instead of an Open/Show-in-Finder pair: what it
   * does follows what the artifact actually supports — Preview for anything the
   * in-app modal can render, otherwise Download (web, streams the file) or
   * Show in Finder/Explorer (desktop, opens the containing FOLDER, not the
   * file) — never both, and never a generic "Open" that hides which of the
   * two it's about to do. Org mode reads the same rule off the draft URL, and
   * an artifact it cannot render keeps the shared page as its one destination.
   */
  const primaryAction = orgMode
    ? (openTarget === 'preview'
      ? { label: 'Preview', onClick: handleOpen, tooltip: 'Preview this artifact in Cowork' }
      : openTarget === 'published'
        ? { label: 'Open', onClick: handleOpen, tooltip: 'Open the shared artifact' }
        : openTarget === 'download'
          ? { label: 'Download', onClick: handleDownload, tooltip: 'Save this artifact\'s file' }
          : null)
    : canPreviewInline
      ? { label: 'Preview', onClick: handleOpen, tooltip: canAct ? `Preview ${path}` : '' }
      : host.isWeb
        ? { label: 'Download', onClick: handleDownload, tooltip: canAct ? `Download ${path}` : '' }
        // handleReveal already falls back from the Electron bridge to the
        // server-side reveal endpoint and surfaces its own error, so this
        // doesn't gate further on bridge availability the way the old
        // Open button didn't either.
        : { label: revealLabel, onClick: handleReveal, tooltip: canAct ? `${revealLabel}: ${path}` : '' };
  /*
   * Only when the primary button is the preview: otherwise "Open" already is
   * the shared page and a second button would point at the same place.
   */
  const showSharedLink = orgMode && published && openTarget === 'preview';
  /*
   * Org mode: every artifact with a primary file can be saved through its
   * draft URL, previewable ones included, unless Download already IS the
   * primary action (ENG-2044). The shared link, when there is one, is the
   * visible secondary and Download moves behind "…"; otherwise Download is
   * the secondary.
   */
  const sharedLinkAction = !deleted && showSharedLink
    ? { label: 'Shared link', onClick: handleOpenPublished, tooltip: 'Open the shared artifact in a new tab' }
    : null;
  const downloadAction = !deleted && orgMode && canDownloadOrgDraft(artifact) && openTarget !== 'download'
    ? { label: 'Download', onClick: handleDownload, tooltip: 'Save this artifact\'s file' }
    : null;
  const primaryDisabled = !orgMode && !canAct;
  const primaryReason = primaryDisabled ? (disabledReason || 'No file path') : '';
  const previewText = artifact.preview?.[0]?.heading || artifact.preview?.[0]?.text || displayPath;
  /*
   * Whole-card click → preview. The inner buttons (the primary action,
   * Title) all stopPropagation so their own handlers run instead of
   * bubbling up to this. Disabled paths fall through to a status toast
   * instead of opening, mirroring the prior button behaviour. Cursor +
   * hover lift mark the entire surface as interactive at a glance.
   */
  return (
    <>
      {/* Outside the Card on purpose: Card renders role="button", and ARIA
          treats a button's non-focusable descendants as presentational, so a
          region nested inside it can be left out of the accessibility tree.
          It mounts empty because `status` starts null, which is what lets
          aria-live see a content CHANGE when an action fills it. */}
      <div className="sr-only" role="status" aria-live="polite">{status?.text ?? ''}</div>
    <Card
      as="div"
      interactive={canActivate}
      flat
      padding="none"
      onActivate={canActivate ? handleOpen : undefined}
      aria-label={deleted
        ? `Deleted artifact: ${artifact.title}`
        : (canActivate ? `${activateLabel}: ${artifact.title}` : noDestinationReason)}
      className="railed chat-artifact-card"
    >
      <div
        className={cn(
          'chat-artifact-card__tile grid size-8 shrink-0 place-items-center overflow-hidden rounded-lg bg-accent-bg text-accent',
          deleted && 'opacity-70',
        )}
      >
        {thumbSrc ? (
          <img src={thumbSrc} alt={artifact.title || 'Artifact thumbnail'} className="block size-full object-cover" />
        ) : (
          isImage ? Ico.image(16) : (artifact.icon === 'doc' ? Ico.doc(16) : Ico.sparkle(16))
        )}
      </div>
      <div className="chat-artifact-card__text flex min-w-0 flex-col gap-0.5">
        {/* The title is a keyboard stop of its own: it opens what the card
            opens, and carries the reason in `title` when there is nowhere to
            go. Preflight is off, so the native button chrome is reset here. */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); if (canActivate) handleOpen(); }}
          disabled={!canActivate}
          title={deleted ? 'This artifact was deleted' : (canActivate ? `${activateLabel}: ${artifact.title}` : noDestinationReason)}
          className="m-0 block min-w-0 cursor-pointer truncate border-0 bg-transparent p-0 text-left font-body text-base font-semibold text-ink underline-offset-[3px] enabled:hover:underline disabled:cursor-not-allowed disabled:opacity-70"
        >{artifact.title}</button>
        <span className="flex min-w-0 items-center gap-1.5 font-body text-xs text-ink-3">
          <span className="shrink-0">{artifact.kind || 'live artifact'}</span>
          {deleted && <Badge variant="muted" size="xs">Deleted</Badge>}
        </span>
        {/* A disabled button takes no hover, so its reason is said here, in
            the text column: beside the button it would widen the actions
            track and squeeze the title to nothing. */}
        {!deleted && primaryAction && primaryReason && (
          <span className="font-body text-xs text-ink-4">{primaryReason}</span>
        )}
      </div>
      {/* The card is role="button" with a whole-surface click and Enter/Space
          handler. Actions, and the overflow menu whose events React bubbles
          through its portal, must not also open the preview. Only Enter and
          Space stop here: other keys (Cmd+K, Cmd+N, Escape) must still reach
          the window-level shortcut listeners. */}
      <div
        className="chat-artifact-card__actions"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation(); }}
      >
        <ActionBar
          size="sm"
          align="start"
          className="flex-wrap"
          primary={!deleted && primaryAction
            ? { ...primaryAction, disabled: primaryDisabled, tooltip: primaryDisabled ? undefined : primaryAction.tooltip }
            : null}
        />
      </div>
      {/* The footer is the artifact's location bar: the path at rest, and the
          result of an action for the moment it is on screen. One or the
          other, so a long message never crushes the path beside it. */}
      {status ? (
        <span
          className={cn('card__rail chat-artifact-card__status font-mono text-xs', status.kind === 'error' ? 'text-danger' : 'text-accent')}
        >
          {status.text}
        </span>
      ) : (
        <span className="card__rail chat-artifact-card__loc font-mono text-xs text-ink-3" title={previewText}>
          {Ico.folder(12)}
          <span className="min-w-0 truncate">{previewText}</span>
        </span>
      )}
      {(sharedLinkAction || downloadAction) && (
        <div
          className="card__rail chat-artifact-card__tools"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation(); }}
        >
          <ActionBar
            size="xs"
            secondary={sharedLinkAction || downloadAction}
            overflow={[sharedLinkAction && downloadAction]}
          />
        </div>
      )}
    </Card>
    </>
  );
}

// Streaming cursor — blinking accent caret (orb stays on the header).
function StreamCursor() {
  return (
    <span className="inline-block w-2 h-3.5 bg-accent ml-1 align-text-bottom animate-[cb_1s_steps(2)_infinite]" />
  );
}

// Right-rail boxes (Progress/WorkingFolder/Context) live in
// components/rail/. The local RailCard that used to live here was
// removed when ChatView switched to those wrappers.

// ProgressList / WorkingFolder / ContextSection were the legacy
// inline rail bodies; they're now folded into the rail box wrappers
// (PhaseProgress / WorkingFolderLive / ContextCard) which are
// composed via ProgressBox / WorkingFolderBox / ContextBox.


// Wait for the sidecar to be answering before telling the user to resend, so
// the resend doesn't hit a cold server (any 200 from /health = up). Signing in
// used to restart it; it no longer does, but it still starts one that died.
async function waitForServerReady(timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if (await fetchHealth()) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 600));
  }
  return false;
}

// Mid-conversation provider auth failure (`provider_auth`): the credential the
// gateway sees is invalid (revoked / rotated / never provisioned / org drift),
// so chat calls 401.
//
// ── ActionCard: the shared shell for inline "actionable error" cards ───────
// One chrome for the reconnect / token-limit / model-403 / provider-required
// cards (ENG-650), drawn by ChatCardShell. Callers own copy, button wiring and
// the `kind` named in the card's top row (Billing, Model, …); the shell owns
// layout and the action hierarchy (`cardActions`: the button marked `primary`
// is the filled action, the next is the quiet secondary, any further ones go
// behind "…").
// buttons: [{ label, onClick, primary, disabled, busy }]. An empty list hides
// the row (e.g. reconnect's "done" state).
function ActionCard({ time, agentLabel, kind, title, body, buttons = [], deleting = false }) {
  return (
    <AnswerTurn state="done" time={time} showActions={false} agentLabel={agentLabel} deleting={deleting}>
      <ChatCardShell className="max-w-[560px]" kind={kind} title={title} actions={cardActions(buttons)}>
        {body}
      </ChatCardShell>
    </AnswerTurn>
  );
}

// ── AllowanceExhaustedCard: the free allowance, not a drained wallet ───────
// ENG-1537. auth's `access.py` issues `included_allowance_exhausted` ONLY for a
// free-bucket model on an org that has NEVER topped up, so this user has not
// spent money — they used the free allowance, and it refills. Two things follow,
// and the old shared out-of-credits card got both wrong: the reset date is a
// genuinely free way forward (hiding it while asking for money is the defect),
// and "unlock" is literally true, because non-free models need a wallet this
// org doesn't have.
//
// One branch names no refill at all: an org with no free grant (the hub usage
// read's limit is 0, from auth's `free_grant_eligible: false`) has nothing to
// wait for, so the card says so in the console's words and asks for funds.
// `allowanceStopCopy` in lib/usageWarnings writes both branches, shared with
// the Settings probe notice.
//
// The refill is formatted here, not server-side: only the client knows the
// viewer's timezone, and parsing it on the server shifts the day for some
// users.

/* " at 2:15 PM", or nothing when the gate gave no usable instant, so no
   sentence promises a schedule the response never named. The guards are
   `formatResetTime`'s, shared with the composer bar. */
function refillClause(resetAt, lead) {
  const time = formatResetTime(resetAt);
  return time ? `${lead} at ${time}` : lead;
}

export function AllowanceExhaustedCard({
  time, agentLabel, resetAt, usage, isBillingOwner, deleting = false,
}) {
  /* A desktop or hosted turn carries the gate's reset_at. A hosted turn from a
     cowork-server that predates it arrives with none, and the hub usage read
     carries the same allowance's refill, so the free way forward still has a
     time. The read also says when the org has no grant to refill at all. */
  return (
    <ActionCard
      deleting={deleting}
      time={time}
      agentLabel={agentLabel}
      // The gate only issues this code when the org has no
      // balance to fall onto, so the turn ended.
      kind="Billing"
      title="Task stopped"
      body={allowanceStopCopy({ resetAt, usage })}
      buttons={[
        {
          label: 'Add funds',
          // The click, not an impression — same rule as
          // the drained-wallet card. token_cap_hit already
          // counts this impression once per receipt in the stream
          // adapter, so every route to billing is counted exactly
          // once and this one is not the exception.
          onClick: () => {
            trackBillingOpened('included_allowance_exhausted');
            host.openExternal(usageActionUrl(USAGE_ACTIONS.addFunds, { isBillingOwner }));
          },
          primary: true,
        },
        // Only offer auto top up when it isn't already on.
        ...(usage?.autoTopUp?.enabled ? [] : [{
          label: USAGE_ACTIONS.setUpAutoTopUp.label,
          onClick: () => {
            trackBillingOpened('included_allowance_exhausted');
            host.openExternal(usageActionUrl(USAGE_ACTIONS.setUpAutoTopUp, { isBillingOwner }));
          },
        }]),
      ]}
    />
  );
}

/* "Switch to MindsHub Air": resend the failed message on Air. One action for
   every card that offers it, and nothing when the caller has no switch to give
   (Air locked, no message to resend, or the task is already on Air). */
function switchToAirButtons(onSwitchToAir) {
  return onSwitchToAir ? [{ label: 'Switch to MindsHub Air', onClick: onSwitchToAir }] : [];
}

/*
 * Drained wallet (`token_limit`): the gate's 402 `wallet_empty`, and any
 * billing stop a hosted turn can only report by exception type. The hub usage
 * read says which limit fired, and the fixed copy is the fallback whenever that
 * read has nothing to speak from.
 *
 * The card stays in the task long after the stop, and `usage` is the read as
 * it is now. Once that read shows a wallet that can pay (a balance that
 * `isBalanceEmpty` does not flag), as after a top up, today's allowance says
 * nothing about why this task stopped, so neither branch below speaks from it.
 * A read with no balance says nothing about the wallet either way:
 * cowork-server's `HubUsageView` leaves it null when the wallet read fails or
 * the caller may not see the wallet, as in a starter-tier org. The stop stands
 * then, and both branches stay open.
 *
 * - The free allowance has room. auth's `access.py` always lets a free-bucket
 *   model run while its allowance lasts, whatever the wallet holds, so the stop
 *   was a priced model. Offer the switch, when the caller has one.
 * - The free allowance is spent and its refill time is usable. Name both
 *   resources and the free way forward, in `allowanceStopCopy`'s words, which
 *   the spent-allowance card uses for the same state.
 * - Anything else (usage dark, no grant, uncapped, no usable time, no switch
 *   to offer, a wallet that can pay now): the fixed copy, exactly as before.
 *
 * `usage` is the `/hub/usage/` view (null outside the provider).
 */
export function BalanceEmptyCard({
  time, agentLabel, usage, isBillingOwner, onSwitchToAir, deleting = false,
}) {
  const free = freeAllowanceState(usage);
  const walletPaysNow = !!usage?.balance && !isBalanceEmpty(usage.balance);
  const refill = formatResetTime(free.resetsAt);
  const addFunds = {
    label: 'Add funds',
    // The click, not an impression. token_cap_hit
    // already counts the impression once per receipt in the
    // stream adapter; an impression here would re-fire on
    // every paint.
    onClick: () => {
      trackBillingOpened('token_limit');
      host.openExternal(usageActionUrl(USAGE_ACTIONS.addFunds, { isBillingOwner }));
    },
    primary: true,
  };
  // Fixed copy, not the server string: the
  // gateway's wording predates pay as you go.
  let body = 'Your balance ran out before this task finished. Add funds before starting another task.';
  let buttons = [addFunds];
  if (!walletPaysNow && free.status === 'has_room' && onSwitchToAir) {
    body = "Your balance is empty, so this model can't run. MindsHub Air still has free allowance left.";
    buttons = [addFunds, ...switchToAirButtons(onSwitchToAir)];
  } else if (!walletPaysNow && free.status === 'spent' && refill) {
    body = allowanceStopCopy({ usage });
  }
  return (
    <ActionCard
      deleting={deleting}
      time={time}
      agentLabel={agentLabel}
      // A billing failure ends the turn; there is no resume,
      // so this is "stopped", never "paused".
      kind="Billing"
      title="Task stopped"
      body={body}
      buttons={buttons}
    />
  );
}

/*
 * Free MindsHub Air paused for everyone (`free_serving_paused`): auth's daily
 * free-Air spend fuse tripped (`free_air_daily_spend_fuse_exceeded`, issued by
 * auth's `entitlements/views/inference_authorize.py`). It stops only orgs whose
 * wallet cannot pay, it is not this user's allowance, and it lifts at the next
 * UTC midnight, which the gate sends as reset_at on a desktop or a hosted turn.
 * So the card says it is not their allowance, names when it lifts, and offers
 * the one thing that gets them working before then. A hosted turn from a
 * cowork-server that predates reset_at there carries none, and the card then
 * says it lifts when the daily budget resets.
 */
export function FreeServingPausedCard({
  time, agentLabel, resetAt, isBillingOwner, deleting = false,
}) {
  /* The sentence lives in lib/usageWarnings because the Settings probe notice
     says the same thing about the same fuse. */
  return (
    <ActionCard
      deleting={deleting}
      time={time}
      agentLabel={agentLabel}
      kind="Usage"
      title="Free MindsHub Air is paused"
      body={freeServingPausedCopy(resetAt)}
      buttons={[
        {
          label: 'Add funds',
          /* The click only, like the other stopped-task cards. Its own
             trigger: a fleet-wide pause is not this user running out. */
          onClick: () => {
            trackBillingOpened('free_serving_paused');
            host.openExternal(usageActionUrl(USAGE_ACTIONS.addFunds, { isBillingOwner }));
          },
          primary: true,
        },
      ]}
    />
  );
}

/* No provider connected (`provider_required`). HomeView renders the same card
   on the home screen and its first sentence must read the same. */
export function ConnectProviderCard({ time, onOpenSettings, deleting = false }) {
  return (
    <ActionCard
      deleting={deleting}
      time={time}
      kind="Connection"
      title="Connect a provider to start chatting"
      body="Start with MindsHub and get a free allowance on MindsHub Air, then pay as you go. Or add your own API key in Settings."
      buttons={[
        {
          label: 'Start for free',
          // The click only. Whether this card deserves an
          // impression event of its own is an open
          // question, and is not settled here.
          onClick: () => {
            trackBillingOpened('connect_provider');
            host.openExternal(MINDS_BILLING_URL);
          },
          primary: true,
        },
        { label: 'Open Settings', onClick: () => onOpenSettings?.('agent') },
      ]}
    />
  );
}

// ── UsageAlertCard: a usage-state change that happened DURING this task ────
// ENG-1782. Not an error: the turn kept going. Free tokens ran out and the
// task moved onto the paid balance, or an auto top up failed. The composer
// notice carries the same facts for the *next* task; this card explains why
// *this* one's behaviour changed, in the timeline where it happened.
function UsageAlertCard({ time, agentLabel, kind, resetsAt, fractionLeft, isBillingOwner }) {
  const open = (action) => () => {
    trackBillingOpened('usage_alert');
    host.openExternal(usageActionUrl(action, { isBillingOwner }));
  };
  if (kind === 'free_low') {
    // Headline names the crossing, not the count: the composer bar carries
    // the live count a few pixels above, and two identical headlines that
    // then drift apart (the bar tracks the next poll, this card is frozen at
    // the crossing) read as two different figures for one number.
    // The body says what is true of the allowance rather than of this turn.
    // The router resolves per turn and can land on a paid model, so "this
    // task is running on free tokens" is a claim the crossing does not prove.
    return (
      <ActionCard
        time={time}
        agentLabel={agentLabel}
        kind="Usage"
        title="Free Air allowance running low"
        body={`${formatPercentShort(fractionLeft)} of your allowance is left. When it is used up, MindsHub Air moves onto your balance${refillClause(resetsAt, ' until it refills')}.`}
        buttons={[{ label: USAGE_ACTIONS.viewUsage.label, onClick: open(USAGE_ACTIONS.viewUsage) }]}
      />
    );
  }
  if (kind === 'auto_top_up_failed') {
    return (
      <ActionCard
        time={time}
        agentLabel={agentLabel}
        kind="Billing"
        title="Auto top up failed"
        body="We couldn't add funds to your balance. Add funds or update your payment method to keep tasks running."
        buttons={[
          { label: USAGE_ACTIONS.addFunds.label, onClick: open(USAGE_ACTIONS.addFunds), primary: true },
          { label: USAGE_ACTIONS.updatePaymentMethod.label, onClick: open(USAGE_ACTIONS.updatePaymentMethod) },
        ]}
      />
    );
  }
  return (
    <ActionCard
      time={time}
      agentLabel={agentLabel}
      kind="Usage"
      title="Free Air allowance used up"
      body={`This task is now using your balance${refillClause(resetsAt, ' until your allowance refills')}.`}
      buttons={[{ label: USAGE_ACTIONS.viewUsage.label, onClick: open(USAGE_ACTIONS.viewUsage) }]}
    />
  );
}

// ── RateLimitedCard: a velocity limit, NOT an out-of-credits state ─────────
// ENG-1537. The org exceeded requests/tokens per minute; credits cannot lift
// that ceiling, so this card must never offer a top-up. anton already waited
// in-turn (up to ~90s) before this rendered, so reaching it means the window
// hadn't cleared — which is precisely why Retry is time-gated against the
// gateway's own Retry-After: an immediate retry re-sends a large context into
// the limiter that just refused it, reproducing the amplification loop the fix
// removed, only user-initiated.
//
// No hint (older gateway, stripped header) → an ungated Retry. Better an
// honest button than an invented countdown.
// Longest we will ever disable Retry. The server clamps nothing, and anton
// cards immediately above its own 60s cap rather than sleeping — so a large
// hint arrives here as a real value. Ungated it would disable the button for
// hours (measured: retryAfter=30000 gated for 8.3h), which is indistinguishable
// from a broken card (ENG-1537 review).
const MAX_RETRY_GATE_MS = 10 * 60 * 1000;

/* `kind` and `title` default to the rate limit's. A busy server (`server_busy`)
   passes its own: the same wait-then-retry gate, but a cause the user's own
   requests didn't create. */
function RateLimitedCard({
  time, agentLabel, body, retryAt, onRetry, deleting = false,
  kind = 'Rate limit', title = 'Too many requests too quickly',
}) {
  const readyAt = useMemo(() => {
    // The server sends an ABSOLUTE, offset-bearing instant. Deliberately not
    // derived from the message's created_at + retryAfter: created_at is
    // serialised offset-less, so JS parses it as local time — the gate lasts
    // hours west of UTC and no-ops east of it, and a TZ=UTC suite sees neither.
    if (typeof retryAt !== 'string') return null;
    // REQUIRE an offset. An offset-less timestamp is what made the original bug
    // invisible: JS parses "2026-08-12T01:04:55" as LOCAL time, so the gate ran
    // ~7h long west of UTC and no-opped east of it — and the suite pins TZ=UTC
    // globally, so no assertion could see either direction. Rejecting the naive
    // form here turns that whole class of regression into "no gate" rather than
    // "a wrong gate", and makes it testable in any zone.
    if (!/(?:Z|[+-]\d{2}:?\d{2})$/.test(retryAt)) return null;
    const at = new Date(retryAt).getTime();
    if (Number.isNaN(at)) return null;
    return Math.min(at, Date.now() + MAX_RETRY_GATE_MS);
  }, [retryAt]);

  const [now, setNow] = useState(() => Date.now());
  const remaining = readyAt ? Math.max(0, Math.ceil((readyAt - now) / 1000)) : 0;

  useEffect(() => {
    if (!readyAt || remaining <= 0) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [readyAt, remaining]);

  const buttons = onRetry
    ? [{
        label: remaining > 0 ? `Try again in ${remaining}s` : 'Try again',
        onClick: remaining > 0 ? undefined : onRetry,
        disabled: remaining > 0,
        primary: true,
      }]
    : [];

  /* A screen reader announces the refusal through this alert region. It mounts
     empty and fills on the next commit, because a live region announces content
     changes, not the text it mounts with. The countdown button stays outside
     it, so its ticking label is not read out every second. */
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => {
    setAnnouncement(body ? `${title}. ${body}` : title);
  }, [title, body]);

  return (
    <>
      <div className="sr-only" role="alert">{announcement}</div>
      <ActionCard
        deleting={deleting}
        time={time}
        agentLabel={agentLabel}
        kind={kind}
        title={title}
        body={body}
        buttons={buttons}
      />
    </>
  );
}

// For **MindsHub** (`reconnectable`), the fix is to re-provision the key in
// place via mindshubFinalize (the same step login runs) — no logout. For a
// **BYOK** provider, only the user can fix their own key, so we point them to
// Settings instead of dragging them into a MindsHub login. Reconnect is also
// desktop-only (finalize/login are Electron IPC), so on web we fall back to
// Settings too.
function ReconnectCard({ time, agentLabel, onOpenSettings, reconnectable, providerLabel, deleting = false }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState(null);

  const canReconnect = Boolean(reconnectable) && !isWeb;

  const reconnect = async () => {
    if (busy) return;
    setErr(null);
    setBusy(true);
    try {
      let res = await host.mindshubFinalize();
      if (res?.upgradeRequired) {
        // Two events, not one (ENG-1533). The refusal is the state — countable
        // here against the other two handlers, which answer it differently (BYOK
        // on first run, nothing at all on SSO sign-in). The billing open is what
        // this handler did about it, and joins the paywall funnel.
        trackKeyProvisioningRefused('billing_opened');
        trackBillingOpened('key_provisioning_refused');
        host.openExternal(MINDS_BILLING_URL);
        return;
      }
      if (!res?.ok) {
        // No usable session to re-provision from → full sign-in.
        res = await host.mindshubLogin();
      }
      if (res?.ok) {
        // finalize no longer restarts the sidecar, but it does start one that
        // died, so wait for health before telling the user to resend.
        await waitForServerReady();
        setDone(true);
      } else {
        setErr(res?.reason || 'Could not reconnect. Try signing out and back in.');
      }
    } catch (e) {
      setErr(e?.message || 'Reconnect failed.');
    } finally {
      setBusy(false);
    }
  };

  // title + body are derived from what this card can actually offer (web-aware),
  // so they never contradict the buttons shown. We deliberately don't reuse the
  // server's copy here: it's provider-aware but not web-aware (it can't know the
  // desktop-only Reconnect is unavailable on web).
  const title = done
    ? 'Reconnected'
    : canReconnect ? 'Reconnect to continue'
    : reconnectable ? 'Sign in again'
    : 'Update your API key';
  const body = done
    ? 'Your MindsHub session was refreshed. Send your message again to continue.'
    : err || (
        canReconnect
          ? "Your MindsHub session is no longer valid. Reconnect to keep going — you won't lose this conversation."
          : reconnectable
            ? 'Your MindsHub session is no longer valid. Open Settings to sign in again.'
            : `Your ${providerLabel || 'provider'} API key is no longer valid. Update it in Settings to continue.`
      );

  return (
    <ActionCard
      deleting={deleting}
      time={time}
      agentLabel={agentLabel}
      kind="Connection"
      title={title}
      body={body}
      buttons={done ? [] : [
        ...(canReconnect ? [{
          label: busy ? 'Reconnecting…' : 'Reconnect',
          onClick: reconnect,
          primary: true,
          busy,
        }] : []),
        // Settings is the primary action when Reconnect isn't available
        // (BYOK key, or web where the IPC flow doesn't exist).
        { label: 'Open Settings', onClick: () => onOpenSettings?.('agent'), primary: !canReconnect },
      ]}
    />
  );
}

/*
 * Legacy model-403 (`model_access_denied` / `model_disabled`): back-compat
 * only. The current gateway never emits a 403 model denial — a wallet that
 * can't pay comes back as 402 `wallet_empty`, which the server maps to
 * `token_limit` and the out-of-credits card renders. These codes only arrive
 * from older pre-wallet gateway/anton versions, so the branch stays. Two
 * flavors, keyed on the structured code:
 *
 * - `model_access_denied` — old gateways sent this when the account couldn't
 *   cover the model, so lead with Top up balance (plus the conditional
 *   Switch to MindsHub Air escape hatch).
 * - `model_disabled` — an admin turned the model off; credits don't unlock
 *   it, so lead with Open Settings (Top up balance stays as a secondary
 *   escape hatch since some old gateways used this code for credit locks).
 *
 * The body is OUR copy, never the server's error string — old gateways word
 * these as access problems, which under pay as you go misdescribes an empty
 * wallet (ENG-1304). Top up balance is just a billing link (host.openExternal
 * window.opens on web); Open Settings routes there on both shells.
 *
 * A third flavor is current, not legacy: `model_restricted`, an org admin's
 * model rule. The gateway names it on its 403 (`X-MindsHub-Deny-Detail` /
 * `error.deny_detail`) and cowork-server relays it as this code. Money cannot
 * unlock it, so the card offers Open Settings only: no Top up, no Air switch.
 * A hosted turn cannot name the model, so the title falls back to
 * "This model is restricted".
 */
export function ModelUnavailableCard({
  time, agentLabel, onOpenSettings, code, failedModel, onSwitchToAir, modelLabels,
  deleting = false,
}) {
  // Same naming rule as the picker (ENG-1638): MindsHub's catalog label when we
  // hold one, else the id-derived form. This card used to call the bare
  // prettifier, so the row the user had just picked as "MindsHub Air" came back
  // as "Mindshub air needs credits" — the same model named two ways on one
  // screen. displayModelLabel finishes multi-part ids (Claude Sonnet, GPT-5.5
  // Mini) and deliberately lowercases some heads (o4 Mini) — never re-case
  // those. Only a bare single-token alias ("sonnet") comes back lowercase, and
  // it reads better capitalized in the title. So capitalize single-word labels
  // only, leaving anything already spaced/cased untouched.
  const raw = displayModelLabel(failedModel, modelLabels) || failedModel || 'This model';
  const label = /\s/.test(raw) ? raw : raw.charAt(0).toUpperCase() + raw.slice(1);
  if (code === 'model_restricted') {
    return (
      <ActionCard
        deleting={deleting}
        time={time}
        agentLabel={agentLabel}
        kind="Model"
        title={`${label} is restricted`}
        body="An admin in your organization restricted this model. Choose another model in Settings."
        buttons={[
          { label: 'Open Settings', onClick: () => onOpenSettings?.('agent'), primary: true },
        ]}
      />
    );
  }
  const denied = code === 'model_access_denied';
  // One handler for both button rows, so the recorded trigger always matches the
  // card that was actually rendered (ENG-1533). Both rows offer Top up balance,
  // but only the `denied` row is a credit denial — the other is the
  // admin-disabled model, where the top-up is a legacy escape hatch (see the
  // header comment). Labelling both `model_access_denied` would invent a credit
  // denial that never happened.
  const openBilling = () => {
    trackBillingOpened(denied ? 'model_access_denied' : 'model_disabled');
    host.openExternal(MINDS_BILLING_URL);
  };
  const title = denied
    ? `${label} needs credits`
    : `${label} isn't available right now`;

  // Fixed copy, not the server's error string (ENG-1304): old gateways word
  // these denials as access problems ("your workspace does not have access"),
  // which under pay as you go misdescribes an empty wallet.
  return (
    <ActionCard
      deleting={deleting}
      time={time}
      agentLabel={agentLabel}
      kind="Model"
      title={title}
      body={denied
        ? "You don't have enough credits for this model. Top up your balance to use it."
        : 'This model is turned off for your workspace. Choose another model in Settings.'}
      buttons={denied
        ? [
            { label: 'Top up balance', onClick: openBilling, primary: true },
            // Only while Air can still run (free allowance or a payable
            // wallet) — a switch offer into another locked model is the same
            // dead end this card exists to close.
            ...switchToAirButtons(onSwitchToAir),
          ]
        : [
            { label: 'Open Settings', onClick: () => onOpenSettings?.('agent'), primary: true },
            { label: 'Top up balance', onClick: openBilling },
          ]}
    />
  );
}

// Mid-conversation transient provider incident (`provider_overloaded`,
// ENG-673): the provider (or an upstream it routes to) was overloaded/erroring
// mid-stream and anton's backoff-retry ran out of time. Unlike the model-403
// cases this is TRANSIENT, so **Retry** is the primary action (resend the last
// message).
//
// The MindsHub angle depends on how the user is set up (the `reconnectable`
// flag = "already on MindsHub Cloud"):
//  - On MindsHub Cloud → the cross-provider failover already applied and the
//    whole set was down; there's nothing to switch to, so just Retry.
//  - BYOK/direct → surface MindsHub's failover as the durable fix: informational
//    in the body, plus a "Set up MindsHub" route to Settings. Deliberately NOT a
//    raw "Subscribe" button — that would mis-nudge a user who already subscribes
//    but chose BYOK (the ENG-514 lesson); Settings is where connect / switch /
//    subscribe are resolved for real.
function ProviderOverloadedCard({
  time, agentLabel, onOpenSettings, onRetry, reconnectable, providerLabel, errorText,
  deleting = false,
}) {
  const onManaged = Boolean(reconnectable);
  const who = onManaged ? 'MindsHub' : (providerLabel || 'The model provider');
  const base = errorText
    || `${who} had a temporary incident and didn't recover in time. Try again in a moment.`;
  const body = onManaged
    ? base
    : `${base} MindsHub automatically routes around provider outages like this, so tasks keep running.`;

  return (
    <ActionCard
      deleting={deleting}
      time={time}
      agentLabel={agentLabel}
      kind="Provider"
      title={`${who} is having a temporary issue`}
      body={body}
      buttons={providerOverloadedButtons({ reconnectable: onManaged, onRetry, onOpenSettings })}
    />
  );
}

/* Most recent user message before index `i`, the message whose turn failed,
   as `{ text, attachments }`, or null when there is none. Used by failure cards
   whose action is "resend the failed message". `attachments` is the message's
   own list, [] when it had none: a resend passes it to onSend so the files and
   Drive references go with the question again, and an empty list keeps the
   composer's staged files out of the resend. */
function lastUserMessageBefore(visibleMessages, i) {
  for (let j = i - 1; j >= 0; j--) {
    const m = visibleMessages[j];
    if (m?.role === 'user' && typeof m.content === 'string' && m.content) {
      return { text: m.content, attachments: Array.isArray(m.attachments) ? m.attachments : [] };
    }
  }
  return null;
}

/**
 * The pending composer redirect for the task on screen, or null.
 *
 * A drain is per-conversation: a reconnected background stream (tailInFlight)
 * can drain task A's queue while the user is looking at task B, and A's text
 * must neither land in B's composer nor be dropped while it waits for A to be
 * opened again. Hence a per-task map rather than one shared slot.
 *
 * The entry carries the drained `attachments` alongside the text for the same
 * reason: the staged-attachment list in App.jsx is app-wide, so files staged at
 * drain time would appear on — and be sent from — whichever conversation is
 * open. They are handed to the parent only when this task's entry is consumed.
 */
export function redirectForTask(redirects, taskId) {
  if (!redirects || !taskId) return null;
  return redirects[taskId] || null;
}

// ─── Main view ───────────────────────────────────────────────────────────
export default function ChatView({
  task,
  onSend,
  onSwitchToAirAndResend,
  onBack,
  project,
  model,
  onModelChange,
  // Reasoning-effort pick for the current model (ENG-1940) — sibling to
  // model/onModelChange, same optionality: a caller that omits these just
  // never sees the EffortSelect pill (Composer defaults `effort` to '').
  effort,
  onEffortChange,
  // Full catalog for the model picker (ENG-1656: task view can change its
  // model, not just display it). Falls back to a single-item list of just
  // the current model when omitted, so existing callers/tests that don't
  // pass these keep working exactly as before — a flat, unpickable menu.
  models,
  modelMeta,
  // Catalog display labels by id (settings.modelLabels), so failure cards name
  // a model exactly as the picker does (ENG-1638).
  modelLabels,
  attachments,
  connectors,
  onAttachFiles,
  onAddGoogleDriveFiles,
  onAddNotionPages,
  onAddGoogleDriveProjectFiles,
  onFetchGoogleDriveProjectFiles,
  onRemoveGoogleDriveProjectFile,
  onAddNotionProjectPages,
  onFetchNotionProjectPages,
  onRemoveNotionProjectPage,
  disabledConnections,
  onUpdateConnectorMute,
  onRemoveAttachment,
  onPinTask,
  onUnpinTask,
  onRenameTask,
  onDeleteTask,
  onDeleteTurn,
  // "Load earlier messages": present only when the task's most recent page
  // doesn't cover its whole history. Fired both by scrolling to the top of
  // the transcript and by the explicit button. Omitted callers (existing
  // tests, any surface that doesn't paginate) simply never see either
  // affordance — task.hasMoreMessages is falsy for them.
  onLoadEarlierMessages,
  loadingEarlierMessages,
  // Anchor id of the turn whose delete is on the wire, or null. The same id
  // this view hands to onDeleteTurn.
  deletingTurnMessageId = null,
  onSubmitDataVaultForm,
  onNavigateToConnectors,
  onDismissConnectForm,
  onCancelModify,
  onDisconnectModify,
  onMoveTaskToProject,
  onOpenProject,
  onOpenProjectsList,
  onOpenSettings,
  codingModelDefault,
  harnessClaudeCodeEnabled,
  onStop,
  projects = [],
  // Messages the user typed while Anton was mid-turn. Displayed as
  // pills above the Composer; drain into onSend automatically when
  // the active turn finishes.
  queuedMessages = [],
  onRemoveFromQueue,
  agentLabel,
  // Conversation ids the server currently has an active producer for
  // (App.jsx's cross-client sync feed). Used to decide whether an
  // unanswered AskUser card is still live or "expired" — replay
  // resurrects unanswered questions from persisted history, and a
  // click on one with no live run behind it would 404.
  inFlightSet,
  // Pending composer redirects from App.jsx, keyed by conversation id:
  // {[taskId]: {text, attachments, bump}}. A question appeared while messages
  // were queued for that task, so their text and files are handed back to its
  // composer instead of being auto-sent as the answer or left queued to
  // deadlock. Only this task's entry is read, and consuming it calls
  // onComposerRedirectConsumed(taskId, attachments) so the parent stages the
  // files against THIS task and deletes the entry, which is also what stops it
  // re-firing on a later remount.
  composerRedirects,
  onComposerRedirectConsumed,
  // Lets App.jsx release a dead question's grip on the composer (see
  // handleSendInTask's pendingQuestionFor check) as soon as the card
  // itself learns the question is gone.
  onQuestionAnswered,
}) {
  const scrollRef = useRef(null);
  const { isNarrow } = useBreakpoint();
  // Wide: inline grid column. Narrow: fixed overlay from the right.
  const [railOpen, setRailOpen] = useState(true);
  const [railNarrowOpen, setRailNarrowOpen] = useState(false);
  // Composer prefill — set by clicking Edit on a user message, or by this
  // task's entry in App.jsx's `composerRedirects` (a question appeared while
  // messages were queued). `bump` is a monotonically-increasing nonce so the
  // Composer's sync effect runs even when re-editing/re-redirecting the same
  // text.
  const [composerPrefill, setComposerPrefill] = useState({ text: '', bump: 0 });
  // Forward App.jsx's redirect for THIS task into the same prefill state Edit
  // uses, so Composer only has to react to one prefill prop. Consuming the entry
  // (deleting it in the parent) is what stops a stale drain re-applying on
  // remount.
  useEffect(() => {
    const redirect = redirectForTask(composerRedirects, task?.id);
    if (!redirect) return;
    const restored = redirect.text || '';
    if (restored) {
      // `append` unconditionally, and there is nothing left to decide: since
      // ENG-1221 the composer's text comes from `lib/draftStore` keyed by
      // surface (Composer's `useDraft(conversationId)`, and this view passes
      // `conversationId={task.id}`), so the value on screen IS this task's own
      // draft — another conversation's draft can no longer be in the box, which
      // is the state the old `draftTaskRef` ownership check existed to detect.
      // A drain hands the user's own queued text BACK to them, so it joins that
      // draft instead of destroying it. Do not reintroduce a guard here: with a
      // per-surface store, "not ours" is unreachable, and a guard that misfires
      // silently deletes text the user is mid-typing.
      setComposerPrefill((prev) => ({
        text: restored,
        bump: (prev?.bump || 0) + 1,
        append: true,
      }));
    }
    // The files travel with the text on the same entry, so they are staged by
    // the parent here — once, for the task actually on screen — rather than
    // app-wide at drain time.
    onComposerRedirectConsumed?.(task?.id, redirect.attachments);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composerRedirects, task?.id]);
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
  // Coding mode (ENG-1656 follow-up): a claude-code-harness task never goes
  // through anton's chat pipeline — it embeds a live PTY terminal instead of
  // the message transcript + Composer (see CodingTerminal / coding-terminal.ts).
  const isClaudeCodeTask = task?.harness === 'claude-code';
  const subscribeFormStore = useMemo(
    () => (onChange) => subscribeDataVaultForm(taskId, onChange),
    [taskId],
  );
  const formActive = useSyncExternalStore(
    subscribeFormStore,
    () => !!getDataVaultForm(taskId),
    () => false,
  );

  // Inline title rename — same affordance the project detail header
  // uses. Hover surfaces the kebab; Rename in the menu flips the
  // title span into an <input>; Enter commits, Esc cancels.
  const { revealed: titleControlsShown, hoverProps: titleHoverProps } = useRevealOnHover(settingsOpen);
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
  // Usage state (ENG-1782): decides where "Add funds" lands and whether the
  // stopped-task cards offer auto top up. Null outside the provider (tests).
  const hubUsage = useHubUsageContext();
  const isBillingOwner = !!hubUsage?.usage?.isBillingOwner;
  // The model the next send in this task uses, which the Air switch would change.
  const taskModelId = typeof model === 'string' ? model : model?.id ?? null;
  // Usage alerts sit at the turn they happened in (lib/usageNoticePlacement).
  // Computed out here because the last bucket renders below the streaming turn,
  // a sibling of these rows. Keyed by identity: a positional key would collide.
  const usageBuckets = usageNoticeBuckets(visibleMessages, task.usageNotices);
  const usageCard = (n) => (
    <UsageAlertCard
      key={`usage-${n.createdAt}-${n.kind}-${n.fractionLeft ?? ''}`}
      time={formatMetaTime(n.createdAt)}
      agentLabel={agentLabel}
      kind={n.kind}
      resetsAt={n.resetsAt}
      fractionLeft={n.fractionLeft}
      isBillingOwner={isBillingOwner}
    />
  );
  // Bumps when a turn finishes (assistant message committed) — not only
  // when messages.length changes. Replacing `_streaming` with `assistant`
  // often leaves length unchanged, which previously skipped memory refresh.
  const contextRefreshKey = useMemo(() => {
    const msgs = task?.messages ?? [];
    const assistants = msgs.filter((m) => m.role === 'assistant').length;
    return `${task?.status ?? 'idle'}:${assistants}:${msgs.length}`;
  }, [task?.status, task?.messages]);
  const dialogMessageCount = visibleMessages.filter((m) => ['user', 'assistant', 'error', 'provider_required'].includes(m.role)).length;
  const streamingMsg = task.messages.find((m) => m.role === '_streaming');
  const artifactProjectPath = task.projectPath || project?.path || '';
  // Which project's artifacts the liveness store should describe. An effect, not
  // a render-time call: the store emits. Both deps are primitives, so an equal
  // scope cannot re-trigger it.
  useEffect(() => {
    setArtifactsScope({ projectId: project?.id || '', projectPath: artifactProjectPath });
  }, [project?.id, artifactProjectPath]);
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
  // A row without an id keys off the nearest id-bearing row before it, so
  // prepending an older page leaves its key, and its local state, alone.
  const rowKeys = [];
  let keyAnchorId = null;
  let idlessSinceAnchor = 0;
  visibleMessages.forEach((m, i) => {
    if (m?.id) {
      keyAnchorId = m.id;
      idlessSinceAnchor = 0;
      rowKeys.push(`m:${m.id}`);
      return;
    }
    idlessSinceAnchor += 1;
    rowKeys.push(keyAnchorId ? `after:${keyAnchorId}:${m?.role}:${idlessSinceAnchor}` : `m:idx-${i}`);
  });
  const messageKey = (_m, i) => rowKeys[i];
  const streamingKey = streamingMsg
    ? `streaming:${streamingMsg.id || 'live'}`
    : null;
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

  // One inline skill card per slug — shown only at the LATEST turn that emitted
  // it, so a refined skill's card moves down to the newest version and earlier
  // copies disappear. Streaming message is last in chronological order.
  const latestSkillCardByKey = useMemo(
    () => latestSkillCardIndexByKey(streamingMsg ? [...visibleMessages, streamingMsg] : visibleMessages),
    [visibleMessages, streamingMsg],
  );

  const scrollAnchorRef = useRef(null);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { isPrepend, scrollHeightDelta, anchor } = nextScrollAnchor({
      taskId: task.id,
      messages: visibleMessages,
      previousAnchor: scrollAnchorRef.current,
      scrollHeight: el.scrollHeight,
    });
    // Loading an older page prepends content above what's on screen —
    // shifting scrollTop by the same delta keeps the reader's position
    // steady instead of yanking them to the bottom.
    if (isPrepend) {
      el.scrollTop += scrollHeightDelta;
    } else {
      el.scrollTop = el.scrollHeight;
    }
    scrollAnchorRef.current = anchor;
    // visibleMessages is a fresh array every render (task.messages.filter(...),
    // not memoized) — depending on task.messages.length instead keeps this
    // effect firing only when the count actually changes, same as before.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id, task.messages.length, isStreaming]);

  // Content can grow while the message count stays put, and the prepend delta
  // is measured from this snapshot, so it tracks that growth. It never scrolls.
  useEffect(() => {
    const col = scrollRef.current?.querySelector('.chat-transcript-col');
    if (!col) return undefined;
    const ro = new ResizeObserver(() => {
      const el = scrollRef.current;
      const anchor = scrollAnchorRef.current;
      if (!el || anchor?.taskId !== task.id) return;
      scrollAnchorRef.current = { ...anchor, scrollHeight: el.scrollHeight };
    });
    ro.observe(col);
    return () => ro.disconnect();
  }, [task.id]);

  // Inverted infinite scroll: reaching the top of the transcript pulls the
  // next older page in, which is the behaviour a long conversation is
  // expected to have. The button below stays as the explicit affordance and
  // as the fallback wherever IntersectionObserver is unavailable.
  //
  // Firing repeatedly is safe: onLoadEarlierMessages guards its own dispatch
  // against a fetch already in flight and against there being nothing more to
  // load. Re-running once a load settles re-checks a reader who is still
  // parked at the top and needs the page after this one.
  const loadEarlierSentinelRef = useRef(null);
  useEffect(() => {
    if (!task.hasMoreMessages || !onLoadEarlierMessages) return undefined;
    if (typeof IntersectionObserver === 'undefined') return undefined;
    const root = scrollRef.current;
    const sentinel = loadEarlierSentinelRef.current;
    if (!root || !sentinel) return undefined;
    const observer = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) onLoadEarlierMessages({ auto: true }); },
      // Start the fetch slightly before the top is actually reached, so the
      // page is usually already there by the time the reader gets there.
      { root, rootMargin: '200px 0px 0px 0px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [task.hasMoreMessages, task.id, onLoadEarlierMessages, loadingEarlierMessages]);

  // Outer ref + conv-column ref. The orb canvas binds to the conv
  // column so the floating orb is naturally clipped to that area
  // (can't leak into the rail visually when a slot is near the right
  // edge). chatRef stays as the panel-level ancestor.
  const chatRef = useRef(null);
  const convRef = useRef(null);

  // The orb anchors to the ThinkingBlock header's WorkingIndicator box —
  // the same header renders the pre-step placeholder and the
  // active-with-steps state, on one `header:streaming` slot — for as long
  // as there's real work going on. Steps and thoughts keep streaming above
  // the growing answer text throughout, so the orb stays put for the whole turn
  // rather than handing off once body text starts. In a turn with ask_user
  // questions that header belongs to the live segment (TurnSegments): above a
  // pending card, below the last answered one, kept until the turn ends. Shares
  // isThinkingActive with ThinkingBlock's own header so the two can't
  // drift out of sync again the way they did before (ENG-1107/1109):
  // whatever keeps the steps panel expanded is exactly what should keep
  // the orb anchored.
  const orbView = useMemo(() => {
    if (!streamingMsg) return { state: null, activeSlot: null };
    if (!isThinkingActive(streamingMsg.streamStatus)) return { state: null, activeSlot: null };
    return { state: 'thinking', activeSlot: 'header:streaming' };
  }, [streamingMsg]);

  const deleteInFlight = deletingTurnMessageId != null;

  return (
    <div
      ref={chatRef}
      // minmax(0, 1fr) is critical — bare `1fr` lets the grid track EXPAND
      // past its allocated size when an unbreakable child (e.g. a very long
      // task title) demands more width, which pushes the rail off-screen and
      // causes content to bleed visually behind the rail. minmax(0, …) tells
      // grid the column can shrink to 0, so the conv col stays inside its
      // track and content clips. On narrow screens the rail is always a
      // fixed overlay, so the grid is always single-column.
      // gridTemplateRows: without an explicit row, the implicit row is sized
      // to content, so the scroll region's inner content height grows the
      // row past the container — the scroll bar never appears. 1fr forces
      // the row to fill the container height so the inner overflowY can
      // create a real scroll context.
      className={`flex-1 min-h-0 grid grid-rows-[1fr] transition-[grid-template-columns] duration-layout ease-out bg-transparent font-body text-ink-2 relative overflow-hidden ${effectiveRailOpen ? 'grid-cols-[minmax(0,1fr)_320px]' : 'grid-cols-[minmax(0,1fr)_0px]'}`}
    >
      <OrbitProvider
        canvasRef={convRef}
        scrollRef={scrollRef}
        size={CHAT_ORB_SIZE}
        state={orbView.state}
        activeSlot={orbView.activeSlot}
      >
      {/* ─── Conversation column ─── */}
      <div
        ref={convRef}
        // Grid auto/1fr is more deterministic than nested flex+min-height
        // for the "header + scrollable body" layout — the 1fr row pins
        // the scroll area to the column's available height, so the inner
        // overflowY can actually scroll.
        className="relative overflow-hidden grid grid-rows-[auto_1fr] min-w-0 min-h-0"
      >
        {/* Floating expand-rail button — appears on the right edge of
            the conv column when the rail is collapsed. Mirror of the
            sidebar's hamburger pattern. */}
        <Tooltip content="Expand panel">
          <button
            type="button"
            onClick={() => isNarrow ? setRailNarrowOpen(true) : setRailOpen(true)}
            aria-label="Expand panel"
            // Only the truly dynamic bits (opacity/transform/pointerEvents driven by
            // rail-open state, and the transition's per-state delay) stay inline —
            // resting/hover color+background moved to className below so the
            // hover: utility can win (an inline color/background at rest would
            // otherwise out-specificity any stylesheet hover rule).
            style={{
              opacity: (effectiveRailOpen || railOverlayOpen) ? 0 : 1,
              transform: (effectiveRailOpen || railOverlayOpen) ? 'translateX(8px)' : 'translateX(0)',
              pointerEvents: (effectiveRailOpen || railOverlayOpen) ? 'none' : 'auto',
              transition:
                `opacity var(--dur-layout) var(--ease-out) ${(effectiveRailOpen || railOverlayOpen) ? '0ms' : 'calc(3 * var(--dur-stagger))'}, ` +
                `transform var(--dur-layout) var(--ease-out) ${(effectiveRailOpen || railOverlayOpen) ? '0ms' : 'calc(2 * var(--dur-stagger))'}`,
            }}
            className="chat-rail-toggle absolute top-3.5 right-3.5 z-10 w-7 h-7 rounded-md inline-grid place-items-center cursor-pointer bg-transparent border-0 text-ink-3 hover:text-ink hover:bg-surface-2 [-webkit-app-region:no-drag]"
          >
            {Ico.panelExpandLeft(16)}
          </button>
        </Tooltip>

        {/* Header — reserve the shell-owned titlebar-safe inset on top so the
            breadcrumbs drop below the macOS traffic lights (and the floating
            open-sidebar button) whenever the sidebar isn't docked over that
            corner, staying left-aligned with the transcript below. `--titlebar-
            safe-top` is set on <main> by the shell and is 0 when the sidebar/
            rail covers the zone, so max() keeps the normal 14px padding then. */}
        <div
          // Belt + suspenders: even if a flex child miscalculates by a
          // pixel, min-w-0 + overflow-hidden prevents the header from
          // visually pushing past the conv-col grid track (which is what
          // was making the icons appear to slide behind the right rail).
          className="flex items-center justify-between pt-[max(14px,var(--titlebar-safe-top,0px))] pb-3.5 pr-7 pl-7 max-sm:pr-3.5 max-sm:pl-3.5 bg-transparent flex-shrink-0 min-w-0 overflow-hidden transition-[padding] duration-layout ease-out"
        >
          {/* Left side: [Project] › [Task] for chat tasks, or
              [Apps] › [Task] for connect-data flows (Connect Gmail,
              Modify gmail-prod, …). The connect-data flow is
              detectable from the synthetic `connect_intro` message
              that handleConnectorPicked / handleModifyConnection
              inject as the first assistant message — that's stable
              across the lifetime of the task whether or not the
              form is currently mounted in the rail. */}
          <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
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
                        label={projectLabel(project)}
                        onClick={() => onOpenProject?.(project)}
                        title={`Open project: ${projectLabel(project)}`}
                        maxWidth={200}
                      />
                    </>
                  )}
                </>
              );
            })()}
            <CrumbSep />
            <div
              {...titleHoverProps}
              className="flex items-center gap-1 min-w-0 flex-1"
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
                  // Match the breadcrumb links (Crumb = 13px) — this is the
                  // current crumb, so it's a CrumbCurrent sibling in every
                  // way but its interactivity (click opens the task menu,
                  // dbl-click edits), hence not the component itself.
                  className="flex-1 min-w-0 font-display font-semibold text-[13px] tracking-normal text-ink bg-surface-2 border border-solid border-accent rounded-[5px] py-0.5 px-1.5 outline-none"
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
                  className="font-display font-semibold text-[13px] tracking-normal text-ink overflow-hidden text-ellipsis whitespace-nowrap [overflow-wrap:anywhere] min-w-0 flex-initial cursor-pointer"
                >{task.title}</span>
              )}
              {task.pinned && !titleEditing && (
                <span aria-hidden className="inline-flex flex-shrink-0 text-accent">
                  {Ico.pin(12)}
                </span>
              )}
              {!titleEditing && (
                <Tooltip content="Task menu">
                  <button
                    ref={settingsBtnRef}
                    type="button"
                    aria-label="Task menu"
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
                    // Only opacity/pointerEvents (titleControlsShown-driven) stay
                    // inline — resting/hover background+color moved to className
                    // so hover: can win (see the rail-toggle button above for why).
                    style={{
                      opacity: titleControlsShown ? 1 : 0,
                      pointerEvents: titleControlsShown ? 'auto' : 'none',
                    }}
                    className={`w-[22px] h-[22px] rounded-[5px] border-0 inline-grid place-items-center flex-shrink-0 cursor-pointer transition-[opacity,color,background] duration-hover ease-[ease] [-webkit-app-region:no-drag] text-ink-3 hover:text-ink hover:bg-surface-2 ${settingsOpen ? 'bg-surface-2' : 'bg-transparent'}`}
                  >
                    {Ico.moreVert(14)}
                  </button>
                </Tooltip>
              )}
            </div>
          </div>

          {/* Right side reserved for future header chips. The kebab
              and rail toggle moved out; pin lives inline with the
              title now (above) so it stays visually attached to the
              task it acts on. */}
          <div className="flex items-center gap-1 flex-shrink-0" />
        </div>
        {/* Task menu — anchored to the kebab next to the title.
            Items: Pin/Unpin · Rename · Delete. Move-to-project,
            Schedule and Turn-into-skill are intentionally excluded
            here — the focused three-action set matches the project
            detail header's pattern. */}
        <TaskMenu
          task={task}
          projects={projects}
          agentLabel={agentLabel}
          open={settingsOpen}
          anchorRect={settingsAnchor}
          hideRename={false}
          hideMoveToProject={!onMoveTaskToProject}
          onClose={() => setSettingsOpen(false)}
          onPin={() => onPinTask?.(task)}
          onUnpin={() => onUnpinTask?.(task.id)}
          onRename={() => setTitleEditing(true)}
          onDelete={() => onDeleteTask?.(task.id)}
          onMoveToProject={() => onMoveTaskToProject?.(task)}
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

        {isClaudeCodeTask ? (
          <CodingTerminal
            taskId={task.id}
            projectPath={artifactProjectPath}
            message={task.messages?.[0]?.content}
            model={typeof model === 'string' ? model : model?.id}
          />
        ) : (
        <>
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
        <div
          ref={scrollRef}
          data-scroll="true"
          className="scroll-clean min-h-0 overflow-y-auto overflow-x-hidden pt-8 px-7 max-sm:px-3.5 pb-[180px] mb-[25px] bg-transparent [-webkit-app-region:no-drag] select-text"
        >
          <div className="chat-transcript-col max-w-[720px] mx-auto flex flex-col gap-7">
            {task.hasMoreMessages && (
              // Adapted from Sidebar's dashed-pill "Show more" idiom.
              <button
                type="button"
                ref={loadEarlierSentinelRef}
                onClick={() => onLoadEarlierMessages?.()}
                disabled={loadingEarlierMessages}
                className="mt-0 mx-0 mb-1 py-[7px] px-2.5 bg-transparent border border-dashed border-line-2 rounded-[7px] text-ink-3 font-[family-name:var(--font-body)] text-[12px] cursor-pointer flex items-center justify-center gap-2 hover:bg-surface-2 hover:border-line hover:text-ink disabled:opacity-60 disabled:cursor-default [transition:background_120ms_ease,color_120ms_ease,border-color_120ms_ease]"
              >
                <span>{loadingEarlierMessages ? 'Loading…' : 'Load earlier messages'}</span>
              </button>
            )}
            {(() => {
              // Skip + orphan rules live together in lib/turnVisibility so a
              // user message whose only assistant bubble is skipped keeps the
              // delete affordance the hidden bubble used to carry (ENG-1304,
              // PR #580 review).
              const isOrphanUser = (atIdx) => isOrphanUserPure(visibleMessages, atIdx);
              // The id this turn hands to onDeleteTurn: its assistant reply,
              // or the user row itself when nothing answered it. Resolved from
              // any row in the turn, so an activity or error card dims with the
              // exchange it belongs to rather than on its own.
              const turnAnchorIdAt = (atIdx) => {
                let start = atIdx;
                while (start > 0 && visibleMessages[start]?.role !== 'user') start -= 1;
                if (visibleMessages[start]?.role !== 'user') return null;
                if (isOrphanUser(start)) return visibleMessages[start].id ?? null;
                for (let k = start + 1; k < visibleMessages.length; k++) {
                  if (visibleMessages[k]?.role === 'user') break;
                  // A reply with no id was never persisted, so the user row still anchors the turn.
                  if (visibleMessages[k]?.role === 'assistant') return visibleMessages[k].id ?? visibleMessages[start].id ?? null;
                }
                return visibleMessages[start].id ?? null;
              };
              const isTurnBeingDeleted = (atIdx) => deletingTurnMessageId != null
                && turnAnchorIdAt(atIdx) === deletingTurnMessageId;
              // Index of the last user or assistant message that renders —
              // its actions stay always-visible (Claude pattern: most recent
              // exchange shows its toolbar). Skipped failed-assistant bubbles
              // don't count (PR #580 review), so a final failed turn keeps
              // the toolbar on the user message. When streaming, nothing
              // needs isLast since the streaming turn has no actions yet.
              const lastTurnIdx = streamingMsg ? -1 : lastVisibleTurnIdx(visibleMessages);
              const turns = visibleMessages.map((m, i) => {
              if (m.role === 'user') {
                const orphan = isOrphanUser(i);
                // A question the server never saw has no id; it is removed
                // locally, by the row itself, once nothing is streaming.
                const neverSent = !m.id && !isStreaming
                  && (m._unsent || String(task?.id ?? '').startsWith('tmp-'));
                let deleteThisTurn = null;
                if (orphan && !deleteInFlight && m.id) deleteThisTurn = () => onDeleteTurn?.(m.id);
                else if (orphan && !deleteInFlight && neverSent) deleteThisTurn = () => onDeleteTurn?.({ localRow: m });
                return (
                  <UserTurn
                    key={messageKey(m, i)}
                    content={m.content}
                    attachments={m.attachments}
                    projectName={project?.name}
                    projectId={project?.id}
                    conversationId={task?.id}
                    // Only the last turn can still be the one being worked on,
                    // and only then does "Making changes" describe the present.
                    streaming={isStreaming && i === lastTurnIdx}
                    time={formatTime(m.createdAt)}
                    // A row the server has seen is hidden until it has an id, not
                    // sent to 422; no turn offers a delete while one is out.
                    onDelete={deleteThisTurn}
                    deleting={isTurnBeingDeleted(i)}
                    isLast={i === lastTurnIdx}
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
              // Every row of a turn dims together, so this resolves the
              // turn's own anchor id from whatever kind of row this is.
              const deletingThisTurn = isTurnBeingDeleted(i);
              if (m.role === 'activity') {
                // Activity rows normally live in the rail's Progress
                // only. Exception: when this is the just-sent
                // "thinking" placeholder AND no streaming row exists
                // yet (some code path stripped the stub injected by
                // `withThinkingPlaceholder`, or a future caller adds
                // an activity without the stub), surface it inline as
                // a thinking bubble so the chat scroll never goes
                // silent between user-send and first SSE chunk.
                if (m.placeholder && !streamingMsg) {
                  return (
                    <AnswerTurn key={messageKey(m, i)} state="thinking" showActions={false}>
                      <WorkingIndicator label={m._label || 'Thinking…'} />
                    </AnswerTurn>
                  );
                }
                return null;
              }
              if (m._kind === 'connect_intro') {
                // The card is clickable: clicking it re-opens the
                // form panel when it's been closed. We stash the
                // original spec on the message at creation time
                // (App.jsx) so re-publishing is a one-liner. If the
                // form is currently active there's nothing to do —
                // the panel is already on the right rail.
                const cachedSpec = m._form_spec || null;
                // Card click re-publishes the cached spec if the user
                // dismissed/submitted the form — the modal re-mounts.
                // If the form is already active the modal is visible,
                // so no action is needed.
                const reopenForm = cachedSpec && !formActive
                  ? () => setDataVaultForm(task?.id, cachedSpec)
                  : undefined;
                return (
                  <ConnectIntroBubble
                    key={messageKey(m, i)}
                    title={m.content || 'Connect'}
                    connector={m.connector}
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
                // Out-of-credits: render an actionable card instead of a
                // plain error. Reused for ANY turn that fails with the
                // `token_limit` code — the first message on a fresh account
                // that's spent its free tokens, or a mid-session exhaustion.
                // Single CTA on purpose (ENG-1169): the out-of-credits
                // moment funnels to top-up; BYOK setup stays in Settings.
                if (m.code === 'token_limit') {
                  const balanceResend = lastUserMessageBefore(visibleMessages, i);
                  return (
                    <BalanceEmptyCard
                      key={messageKey(m, i)}
                      deleting={deletingThisTurn}
                      time={formatMetaTime(m.createdAt)}
                      agentLabel={agentLabel}
                      usage={hubUsage?.usage}
                      isBillingOwner={isBillingOwner}
                      /* The switch resends the failed message on Air, so it
                         needs one to resend, and a task already on Air has
                         nothing to switch to. */
                      onSwitchToAir={
                        onSwitchToAirAndResend && balanceResend && taskModelId !== MINDSHUB_AIR_MODEL_ID
                          ? () => onSwitchToAirAndResend(balanceResend.text, balanceResend.attachments)
                          : undefined
                      }
                    />
                  );
                }
                /* Free MindsHub Air paused fleet-wide by auth's daily spend
                   fuse: not this user's allowance, and funds get them going. */
                if (m.code === 'free_serving_paused') {
                  return (
                    <FreeServingPausedCard
                      key={messageKey(m, i)}
                      deleting={deletingThisTurn}
                      time={formatMetaTime(m.createdAt)}
                      agentLabel={agentLabel}
                      resetAt={m.resetAt}
                      isBillingOwner={isBillingOwner}
                    />
                  );
                }
                // Provider auth failure mid-conversation → offer Reconnect
                // (re-provision the key in place), not "Subscribe".
                if (m.code === 'provider_auth') {
                  return (
                    <ReconnectCard
                      key={messageKey(m, i)}
                      deleting={deletingThisTurn}
                      time={formatMetaTime(m.createdAt)}
                      agentLabel={agentLabel}
                      onOpenSettings={onOpenSettings}
                      reconnectable={m.reconnectable}
                      providerLabel={m.providerLabel}
                    />
                  );
                }
                /* Legacy model-403 (pre-wallet gateways only): current
                 * gateways report wallet denials as `token_limit`, rendered
                 * by the out-of-credits card above. Offer Top up balance and,
                 * while Air is payable, a one-click switch that resends the
                 * failed message on it — never "try again".
                 *
                 * `model_restricted` shares the card: an org admin's model
                 * rule, which the card answers with Open Settings only. */
                if (m.code === 'model_access_denied' || m.code === 'model_disabled' || m.code === 'model_restricted') {
                  const deniedResend = lastUserMessageBefore(visibleMessages, i);
                  return (
                    <ModelUnavailableCard
                      key={messageKey(m, i)}
                      deleting={deletingThisTurn}
                      time={formatTime(m.createdAt)}
                      agentLabel={agentLabel}
                      onOpenSettings={onOpenSettings}
                      code={m.code}
                      failedModel={m.failedModel}
                      modelLabels={modelLabels}
                      onSwitchToAir={
                        onSwitchToAirAndResend && deniedResend
                          ? () => onSwitchToAirAndResend(deniedResend.text, deniedResend.attachments)
                          : undefined
                      }
                    />
                  );
                }
                // Transient provider incident that outlasted anton's retry
                // budget → Retry (resend the last user message), plus a MindsHub
                // failover nudge for BYOK users (ENG-673).
                if (m.code === 'provider_overloaded') {
                  const resend = lastUserMessageBefore(visibleMessages, i);
                  return (
                    <ProviderOverloadedCard
                      key={messageKey(m, i)}
                      deleting={deletingThisTurn}
                      time={formatMetaTime(m.createdAt)}
                      agentLabel={agentLabel}
                      onOpenSettings={onOpenSettings}
                      onRetry={resend ? () => onSend?.(resend.text, resend.attachments) : undefined}
                      reconnectable={m.reconnectable}
                      providerLabel={m.providerLabel}
                      errorText={m.content}
                    />
                  );
                }
                /* A model the provider can't serve (404 `model_not_found`) —
                 * removed, renamed, or never existed (a provider name pasted
                 * where an alias belongs). Credits can't fix it; the next step
                 * is picking a real model.
                 *
                 * The body quotes the RAW id, not modelLabel's prettified
                 * version: the point is for the user to recognise the exact
                 * string sitting in their settings, and prettifying an id that
                 * isn't a real model would obscure the typo (ENG-1358).
                 * `failedModel` is absent from a server too old to send it, so
                 * the copy degrades to the unnamed wording rather than
                 * rendering an empty quote. */
                /* `unknown_model` is the pre-rename code. Accept BOTH: the
                 * renderer updates OTA and can lead a pinned server (a server
                 * update isn't always pending, so updater.ts applies the UI
                 * alone), and dropping the old code would regress those users to
                 * the buttonless danger alert ENG-1282 removed. It also covers
                 * disabled-auto-update and git-pinned installs, which no
                 * minServerVersion bump would reach. */
                if (m.code === 'model_not_found' || m.code === 'unknown_model') {
                  const badModel = typeof m.failedModel === 'string' ? m.failedModel.trim() : '';
                  return (
                    <ActionCard
                      key={messageKey(m, i)}
                      deleting={deletingThisTurn}
                      time={formatMetaTime(m.createdAt)}
                      agentLabel={agentLabel}
                      kind="Model"
                      title={badModel ? `"${badModel}" isn't a model we can use` : "That model isn't available"}
                      body={badModel
                        ? `Your settings point at "${badModel}", which this provider doesn't offer — so nothing was sent. Pick a model from the list in Settings.`
                        : "The selected model was removed or isn't offered anymore. Switch to another model in Settings."}
                      /* Open Settings only. cowork-server does apply a turn's
                         own model (the request's `model`, handed to
                         providers.build_llm_client as `model_override`), so a
                         "Switch to MindsHub Air" here would move this one task.
                         The dead id lives in the planning_model setting, though,
                         and every new task would fail on it again, so the card
                         sends the user to where the id is set. */
                      buttons={[
                        { label: 'Open Settings', onClick: () => onOpenSettings?.('agent'), primary: true },
                      ]}
                    />
                  );
                }
                // Unsupported attachment image (`image_format`): the fix is on
                // the user's side — re-upload as PNG/JPEG — so the card names
                // it and offers no dead-end buttons.
                if (m.code === 'image_format') {
                  return (
                    <ActionCard
                      key={messageKey(m, i)}
                      deleting={deletingThisTurn}
                      time={formatMetaTime(m.createdAt)}
                      agentLabel={agentLabel}
                      kind="Attachment"
                      title="That image couldn't be read"
                      body="The attached image is in a format the model can't process. Convert it to PNG or JPEG and send it again."
                    />
                  );
                }
                // Content-shaped provider rejection (`content_recovery`,
                // ENG-1992): distinct from `image_format` on purpose — this
                // is an internal serialization mismatch, not anything wrong
                // with the image itself, and the server has ALREADY stripped
                // the offending content from this conversation's history by
                // the time this code reaches the client. Re-uploading fixes
                // nothing here, so the card offers "Try again" instead —
                // the same message now sends clean.
                if (m.code === 'content_recovery') {
                  const resend = lastUserMessageBefore(visibleMessages, i);
                  return (
                    <ActionCard
                      key={messageKey(m, i)}
                      deleting={deletingThisTurn}
                      time={formatMetaTime(m.createdAt)}
                      agentLabel={agentLabel}
                      kind="Conversation"
                      title="Fixed an issue with this conversation"
                      body="An image earlier in this conversation couldn't be sent to the model due to an internal formatting issue. It's been removed automatically — you can keep going."
                      buttons={resend
                        ? [{ label: 'Try again', onClick: () => onSend?.(resend.text, resend.attachments), primary: true }]
                        : []}
                    />
                  );
                }
                // An image the provider refused as too LARGE
                // (`content_too_large`, ENG-2689). Deliberately NOT the
                // `content_recovery` card above: that one says "fixed, keep
                // going", which is true for a serialization mismatch we
                // caused and false here. The server has stripped the image
                // either way, so the conversation is unstuck — but what the
                // user asked for still hasn't happened, and only they can fix
                // it by attaching something smaller.
                //
                // No Retry button, on purpose. Resending the same text now
                // that the image is gone would run a turn that answers a
                // question about an image the model can no longer see — a
                // confidently wrong answer is worse than no answer. The body
                // is the server's message rather than fixed copy because it
                // carries the provider's own limit and remedy, which is more
                // specific than anything hardcoded here.
                if (m.code === 'content_too_large') {
                  return (
                    <ActionCard
                      key={messageKey(m, i)}
                      deleting={deletingThisTurn}
                      time={formatMetaTime(m.createdAt)}
                      agentLabel={agentLabel}
                      kind="Attachment"
                      title="That image is too large"
                      body={m.content}
                    />
                  );
                }
                // Transient billing/policy outage at the gateway
                // (`policy_unavailable`): retryable and not the user's fault,
                // so the next step is simply resending the failed message.
                if (m.code === 'policy_unavailable') {
                  const resend = lastUserMessageBefore(visibleMessages, i);
                  return (
                    <ActionCard
                      key={messageKey(m, i)}
                      deleting={deletingThisTurn}
                      time={formatMetaTime(m.createdAt)}
                      agentLabel={agentLabel}
                      kind="Billing"
                      title="Billing is temporarily unavailable"
                      body="MindsHub couldn't confirm billing for this request. This is temporary — try again in a moment."
                      buttons={resend
                        ? [{ label: 'Try again', onClick: () => onSend?.(resend.text, resend.attachments), primary: true }]
                        : []}
                    />
                  );
                }
                /* The turn never reached the agent (`worker_unresponsive`):
                 * the worker stopped answering before anything ran. Kept apart
                 * from anton_error, which means the agent DID run and raised
                 * something we don't recognise. The difference is what the user
                 * should do: retry works here, and reporting an agent bug does
                 * not. Copy lives in the renderer rather than echoing m.content
                 * so it can be improved OTA, same as the other retryable cards
                 * (ENG-2126). */
                if (m.code === 'worker_unresponsive') {
                  const resend = lastUserMessageBefore(visibleMessages, i);
                  return (
                    <ActionCard
                      key={messageKey(m, i)}
                      deleting={deletingThisTurn}
                      time={formatMetaTime(m.createdAt)}
                      agentLabel={agentLabel}
                      kind="Agent"
                      title="The agent didn't start"
                      body="This turn never reached the agent, so nothing ran. That's a fault on our side, not a problem with your request. Try again in a moment."
                      buttons={resend
                        ? [{ label: 'Try again', onClick: () => onSend?.(resend.text, resend.attachments), primary: true }]
                        : []}
                    />
                  );
                }
                /* The model call sent nothing until its deadline
                 * (`model_timeout`), so the server ended the turn. The provider
                 * is the likely cause, not the request: a retry often works,
                 * and if it keeps happening another model is the way out. */
                if (m.code === 'model_timeout') {
                  const resend = lastUserMessageBefore(visibleMessages, i);
                  return (
                    <ActionCard
                      key={i}
                      deleting={deletingThisTurn}
                      time={formatMetaTime(m.createdAt)}
                      agentLabel={agentLabel}
                      kind="Agent"
                      title="The model didn't respond"
                      body="The model stopped sending anything, so this turn was ended. Try again. If it keeps happening, pick another model in Settings."
                      buttons={[
                        ...(resend
                          ? [{ label: 'Try again', onClick: () => onSend?.(resend.text, resend.attachments), primary: true }]
                          : []),
                        { label: 'Open Settings', onClick: () => onOpenSettings?.('agent') },
                      ]}
                    />
                  );
                }
                /* The UI heard nothing from the turn for its idle window
                 * (`stalled`). The tab ends only its own reader and sends no
                 * cancel, so the turn may still be running on the server. A
                 * saved `stalled` record, from an older client's tagged
                 * cancel, renders the same card after a reload. Try again
                 * waits until the conversation has no live turn, as the copy
                 * asks. */
                if (m.code === 'stalled') {
                  const resend = lastUserMessageBefore(visibleMessages, i);
                  const turnMayBeRunning = isStreaming || !!inFlightSet?.has(task.id);
                  return (
                    <ActionCard
                      key={i}
                      deleting={deletingThisTurn}
                      time={formatMetaTime(m.createdAt)}
                      agentLabel={agentLabel}
                      kind="Agent"
                      title="The response stalled"
                      body="Cowork stopped hearing from the agent. The answer may still be running. Wait for it to finish before sending again."
                      buttons={resend && !turnMayBeRunning
                        ? [{ label: 'Try again', onClick: () => onSend?.(resend.text, resend.attachments), primary: true }]
                        : []}
                    />
                  );
                }
                // Spent FREE allowance (gateway 429
                // `included_allowance_exhausted`): not a drained wallet, so it
                // names the refill time as a free alternative and says what
                // credits actually unlock (ENG-1537).
                if (m.code === 'included_allowance_exhausted') {
                  return (
                    <AllowanceExhaustedCard
                      key={messageKey(m, i)}
                      deleting={deletingThisTurn}
                      time={formatMetaTime(m.createdAt)}
                      agentLabel={agentLabel}
                      resetAt={m.resetAt}
                      usage={hubUsage?.usage}
                      isBillingOwner={isBillingOwner}
                    />
                  );
                }
                // Velocity rate-limit (gateway 429 `rate_limited`): waiting is
                // the fix, so the card says so and offers a time-gated Retry —
                // never a top-up, which is what this used to show (ENG-1537).
                if (m.code === 'rate_limited') {
                  const rlResend = lastUserMessageBefore(visibleMessages, i);
                  return (
                    <RateLimitedCard
                      key={messageKey(m, i)}
                      deleting={deletingThisTurn}
                      time={formatMetaTime(m.createdAt)}
                      agentLabel={agentLabel}
                      body={m.content}
                      retryAt={m.retryAt}
                      onRetry={rlResend ? () => onSend?.(rlResend.text, rlResend.attachments) : undefined}
                    />
                  );
                }
                /* No database connection freed in time on cowork-server
                   (`server_busy`), refused before the stream with a 503 or
                   ended inside it with response.failed. Waiting is the fix, so
                   it shares the rate limit's Retry gate, counted down to the
                   server's Retry-After, under its own title. */
                if (m.code === 'server_busy') {
                  const busyResend = lastUserMessageBefore(visibleMessages, i);
                  return (
                    <RateLimitedCard
                      key={i}
                      deleting={deletingThisTurn}
                      time={formatMetaTime(m.createdAt)}
                      agentLabel={agentLabel}
                      kind="Server"
                      title="The server is busy"
                      body={m.content}
                      retryAt={m.retryAt}
                      onRetry={busyResend ? () => onSend?.(busyResend.text, busyResend.attachments) : undefined}
                    />
                  );
                }
                // `anton_error` and anything unmapped: a deliberately generic
                // bucket with no known next step, so no card — but still a
                // failure, rendered as a danger alert so it never reads as a
                // finished answer. Richer treatment is ENG-1093's review.
                // `requestId` is the one thing this bucket can still offer —
                // the turn's own server-side correlation id, so a report of
                // this generic message can be pinned to actual logs.
                //
                // Deliberately scoped to this bucket only: every carded code
                // above (rate_limited, model_not_found, etc.) also hydrates
                // `requestId` but doesn't render it — a card already tells
                // the user what to do, so a raw id there would be noise, not
                // help. A user who wants to report a CARDED failure still has
                // nothing to quote; that's an intentional gap, not a bug.
                /* A second question refused with a 409 (`turn_in_progress`)
                   lands here too: the server's sentence tells the user to wait
                   for the running answer, and nothing resends it for them. */
                return (
                  <AnswerTurn key={messageKey(m, i)} state="done" time={formatMetaTime(m.createdAt)} showActions={false} agentLabel={agentLabel} deleting={deletingThisTurn}>
                    <Alert variant="danger">
                      <div>{m.content}</div>
                      {m.requestId && (
                        <div className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                          Reference: {m.requestId}
                        </div>
                      )}
                    </Alert>
                  </AnswerTurn>
                );
              }
              if (m.role === 'provider_required') {
                return (
                  <ConnectProviderCard
                    key={messageKey(m, i)}
                    deleting={deletingThisTurn}
                    time={formatMetaTime(m.createdAt)}
                    onOpenSettings={onOpenSettings}
                  />
                );
              }
              // A turn that failed before producing anything renders no
              // bubble — the blank block above billing cards (ENG-1304).
              // Same predicate keeps isOrphanUser's delete affordance honest.
              if (isSkippedFailedAssistant(visibleMessages, i)) {
                return null;
              }
              return (
                <AnswerTurn
                  key={messageKey(m, i)}
                  state="done"
                  // `createdAt` is never set on a message row, so the replayed
                  // start time supplies this — and a replay with no steps has
                  // no startedAt either, so that turn shows no time.
                  time={formatMetaTime(m.createdAt || m.startedAt)}
                  copyText={m.content}
                  // Anchored on this assistant message's own id; hidden, not
                  // disabled, without one. A partial kept after a transport
                  // failure whose recovery also failed has none until reload.
                  onDelete={m.id && !deleteInFlight ? () => onDeleteTurn?.(m.id) : null}
                  deleting={deletingThisTurn}
                  agentLabel={harnessLabel(m.harness) || 'Agent'}
                  isLast={i === lastTurnIdx}
                >
                  {/* Above the text: a question is asked, then answered, then
                      (at most) the turn's closing text streams — so every
                      card and block precedes the text that came after. */}
                  <TurnSegments
                    steps={m.steps}
                    startedAt={m.startedAt}
                    conversationId={task.id}
                    // A completed turn by construction — `visibleMessages`
                    // excludes the `_streaming` row — so no question rendered
                    // here belongs to the live turn, whatever else is in flight
                    // on this conversation.
                    conversationLive={false}
                    onAnswered={onQuestionAnswered}
                    onActivateStep={(step) => setOpenScratchpadStepId(prefixId(messageKey(m, i), step.id))}
                    idPrefix={messageKey(m, i)}
                  />
                  <TextBlock text={m.content} id={m.id || `msg-${i}`} complete conversationId={task.id} />
                  {m.artifact && (
                    <ArtifactCard
                      artifact={normalizeArtifactRecord(m.artifact, artifactProjectPath)}
                      onOpen={handleArtifactOpen}
                    />
                  )}
                  <StepArtifacts steps={m.steps} onOpen={handleArtifactOpen} projectPath={artifactProjectPath} />
                  <StepSkills steps={m.steps} latestByKey={latestSkillCardByKey} messageIndex={i} projectName={project?.name} />
                </AnswerTurn>
              );
              });
              // The trailing bucket renders after the streaming turn below, so
              // a live turn's notice cannot split the question from its reply.
              const rendered = [];
              turns.forEach((node, i) => {
                usageBuckets[i].forEach((n) => rendered.push(usageCard(n)));
                rendered.push(node);
              });
              return rendered;
            })()}

            {streamingMsg ? (
              <AnswerTurn state="thinking" showActions={false}>
                {/* ONE in-flight header for the whole pre-answer phase.
                    ThinkingBlock renders its active header even with zero
                    steps, so it also serves as the pre-step "Thinking…"
                    placeholder — the bridge state between the first stream
                    event arriving (which strips the activity placeholder)
                    and the first step, thought, or body chunk landing.
                    Routing the placeholder through the SAME component keeps
                    the header's box identical from placeholder → steps and
                    keeps the element mounted across that transition, so the
                    indicator no longer jumps ~8px when reasoning traces
                    begin. Hidden once real body text streams with no steps,
                    so a plain text answer isn't topped by a "Thinking…"
                    header. `_placeholderLabel` is set by the pre-first-event
                    stub in App.jsx `withThinkingPlaceholder` ("Creating
                    task…" for new tasks, "Thinking…" for replies).
                    With questions, the header is in the live segment (TurnSegments). */}
                <TurnSegments
                  steps={streamingMsg.steps}
                  startedAt={streamingMsg.startedAt}
                  conversationId={task.id}
                  conversationLive={isStreaming || !!inFlightSet?.has(task.id)}
                  onAnswered={onQuestionAnswered}
                  onActivateStep={(step) => setOpenScratchpadStepId(prefixId(streamingKey, step.id))}
                  idPrefix={streamingKey}
                  live={{
                    isActive: isThinkingActive(streamingMsg.streamStatus),
                    currentThought: streamingMsg.currentThought,
                    placeholderLabel: streamingMsg._placeholderLabel || null,
                    hasBodyText: !!streamingMsg.content,
                    slotId: 'header:streaming',
                  }}
                />
                {streamingMsg.content && (
                  <div className="relative">
                    <TextBlock text={streamingMsg.content} id="streaming" complete={false} conversationId={task.id} />
                    <StreamCursor />
                  </div>
                )}
                <StepArtifacts steps={streamingMsg.steps} onOpen={handleArtifactOpen} projectPath={artifactProjectPath} live />
                <StepSkills steps={streamingMsg.steps} latestByKey={latestSkillCardByKey} messageIndex={visibleMessages.length} projectName={project?.name} />
              </AnswerTurn>
            ) : isStreaming && (
              <AnswerTurn state="thinking" showActions={false}>
                <WorkingIndicator label="Streaming…" />
              </AnswerTurn>
            )}

            {/* Notices from the turn still running, below the answer rather
                than above it: the crossing happened during this turn. With
                nothing streaming this is just the end of the conversation. */}
            {usageBuckets[visibleMessages.length].map(usageCard)}
            {/* Always mounted, and outside the turn it describes: a region
                inserted at the moment it should speak is not reliably
                announced, and the turn is aria-busy, which tells a reader to
                hold off on that subtree. */}
            <div
              className="sr-only"
              role="status"
              aria-live="polite"
              data-testid="delete-turn-status"
            >
              {deleteInFlight ? 'Deleting the selected exchange.' : ''}
            </div>
          </div>
        </div>

        {/* Floating composer — no gradient fade behind it. Earlier we
            had a 220px linear-gradient(transparent → var(--bg)) overlay
            so messages would soften into the bg above the composer, but
            with the gravity-field showing through it read as a dark
            band at the bottom of the chat. The composer's own border +
            shadow give enough visual separation on its own. */}
        <div className="chat-floating-composer absolute left-7 right-7 max-sm:left-3.5 max-sm:right-3.5 bottom-[22px] flex flex-col items-center gap-2 pointer-events-auto [--composer-max-width:720px]">
          {/* Queued-messages strip — pills with each waiting prompt
              + a × to drop it. The pills cross-fade in/out so the
              transition between queue states reads as deliberate. */}
          {queuedMessages.length > 0 && (
            <div className="w-full max-w-[720px] flex flex-col gap-1.5 py-2.5 px-3 rounded-[14px] bg-[color-mix(in_srgb,var(--accent)_8%,var(--surface))] border border-solid border-[color-mix(in_srgb,var(--accent)_22%,var(--line))] shadow-[0_8px_24px_rgba(0,0,0,0.10)] animate-[queue-pop-in_var(--dur-layout)_var(--ease-out)]">
              <div className="section-label text-accent flex items-center gap-1.5">
                <span className="pulse-dot w-1.5 h-1.5 rounded-full bg-accent shadow-[0_0_6px_var(--accent-glow)]" />
                {queuedMessages.length} queued · waiting for {agentLabel || 'Anton'}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {queuedMessages.map((q) => (
                  <span
                    key={q.id}
                    title={q.text}
                    className="inline-flex items-center gap-1.5 max-w-full pt-[5px] pr-1 pb-[5px] pl-3 rounded-full bg-surface border border-solid border-line font-body text-sm text-ink-2 transition-[background,border-color] duration-hover ease-[ease]"
                  >
                    <span className="max-w-[360px] overflow-hidden text-ellipsis whitespace-nowrap">{q.text}</span>
                    <Tooltip content="Remove from queue">
                      <button
                        type="button"
                        onClick={() => onRemoveFromQueue?.(q.id)}
                        aria-label="Remove from queue"
                        className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-transparent border-0 text-ink-4 cursor-pointer flex-shrink-0 hover:bg-[color-mix(in_srgb,var(--danger)_14%,transparent)] hover:text-danger"
                      >{Ico.close(12)}</button>
                    </Tooltip>
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
            onModelChange={onModelChange || (() => {})}
            effort={effort}
            onEffortChange={onEffortChange || (() => {})}
            projects={[]}
            models={models || (model ? [model] : [])}
            modelMeta={modelMeta}
            attachments={attachments}
            connectors={connectors}
            onNavigateToConnectors={onNavigateToConnectors}
            onAttachFiles={onAttachFiles}
            onAddGoogleDriveFiles={onAddGoogleDriveFiles}
            onAddNotionPages={onAddNotionPages}
            conversationId={task.id}
            disabledConnections={disabledConnections ?? task.disabledConnections ?? []}
            onUpdateConnectorMute={onUpdateConnectorMute}
            onRemoveAttachment={onRemoveAttachment}
            placeholder="Reply…"
            metaReadOnly
            modelReadOnly={false}
            hideMeta
            streaming={isStreaming}
            onStop={onStop}
            prefill={composerPrefill}
            onOpenSettings={onOpenSettings}
            codingModelDefault={codingModelDefault}
            harnessClaudeCodeEnabled={harnessClaudeCodeEnabled}
          />
        </div>
        </>
        )}
      </div>

      {/* ─── Right rail ─── */}
      {/* On narrow screens: translucent backdrop behind the overlay rail */}
      {isNarrow && (
        <div
          onClick={() => setRailNarrowOpen(false)}
          className="fixed inset-0 z-50 bg-[rgba(0,0,0,0.35)] backdrop-blur-[2px] transition-opacity duration-layout ease-out [-webkit-app-region:no-drag]"
          style={{
            opacity: railOverlayOpen ? 1 : 0,
            pointerEvents: railOverlayOpen ? 'auto' : 'none',
          }}
        />
      )}
      <aside
        // Narrow: fixed overlay that slides in from the right.
        // Wide: inline grid column.
        className={`chat-rail-aside flex flex-col gap-2.5 pt-3.5 px-3.5 pb-[22px] overflow-x-hidden overflow-y-auto [-webkit-app-region:no-drag] ${
          isNarrow
            ? 'fixed top-[9px] bottom-[9px] right-[9px] w-[min(85vw,320px)] z-[51] bg-surface border border-solid border-line rounded-[14px] shadow-sh-2 transition-transform duration-layout ease-out'
            : 'bg-transparent min-w-0 transition-opacity duration-layout ease-[ease]'
        }`}
        style={isNarrow ? {
          transform: railOverlayOpen ? 'translateX(0)' : 'translateX(calc(100% + 18px))',
        } : {
          visibility: effectiveRailOpen ? 'visible' : 'hidden',
          opacity: effectiveRailOpen ? 1 : 0,
        }}
      >
        {/* Rail header bar — collapse button. Stays visible on mobile
            so the user has an explicit way to dismiss the rail (which
            on phone hosts the data-vault form fullscreen). The
            FLOATING expand button outside is the one hidden via
            .chat-rail-toggle in globals.css. */}
        <div className="chat-rail-close-row flex items-center justify-end flex-shrink-0">
          <Tooltip content="Collapse panel">
            <button
              type="button"
              className="chat-rail-close"
              onClick={() => isNarrow ? setRailNarrowOpen(false) : setRailOpen(false)}
              aria-label="Collapse panel"
              // kept inline: same all:unset cascade-priority reason as ArtifactCard's
              // buttons — every property here stays co-located with the reset, and
              // the hover color/background mutation needs a subsequent inline write
              // to win over the reset.
              style={{
                all: 'unset', cursor: 'pointer',
                width: 26, height: 26, borderRadius: 6,
                display: 'inline-grid', placeItems: 'center',
                color: T.ink3,
              }}
              onMouseOver={(e) => { e.currentTarget.style.color = 'var(--ink)'; e.currentTarget.style.background = 'var(--surface-2)'; }}
              onMouseOut={(e) => { e.currentTarget.style.color = 'var(--ink-3)'; e.currentTarget.style.background = 'transparent'; }}
            >
              {Ico.panelCollapseRight(16)}
            </button>
          </Tooltip>
        </div>
        <ProgressBox
          steps={railSteps}
          streamStatus={streamingMsg?.streamStatus}
          conversationId={task.id || ''}
          onActivateStep={(step) => railMsgKey
            ? setOpenScratchpadStepId(prefixId(railMsgKey, step.id))
            : null}
        />
        <WorkingFolderBox
          project={project}
          isStreaming={isStreaming}
          conversationId={task?.id || null}
          onAddressWithAgent={({ prompt }) => onSend?.(prompt)}
        />
        <ContextBox
          projects={projects}
          project={project}
          conversationId={task?.id}
          refreshKey={contextRefreshKey}
          onAddGoogleDriveFiles={onAddGoogleDriveProjectFiles}
          onFetchGoogleDriveFiles={onFetchGoogleDriveProjectFiles}
          onRemoveGoogleDriveFile={onRemoveGoogleDriveProjectFile}
          onAddNotionPages={onAddNotionProjectPages}
          onFetchNotionPages={onFetchNotionProjectPages}
          onRemoveNotionPage={onRemoveNotionProjectPage}
        />
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
        conversationId={task?.id || null}
        onAddressWithAgent={({ prompt }) => onSend?.(prompt)}
      />

      {/* Data-vault connection form — rendered as a centered modal
          overlay so it's front-and-center when a connector is picked. */}
      {formActive && createPortal(
        <div
          onClick={() => (onDismissConnectForm
            ? onDismissConnectForm(task?.id || '')
            : clearDataVaultForm(task?.id || ''))}
          // autoprefixer adds the -webkit-backdrop-filter prefix at build time,
          // so no separate WebkitBackdropFilter declaration is needed here.
          className="fixed inset-0 z-[200] bg-[rgba(0,0,0,0.5)] backdrop-blur-[3px] flex items-center justify-center"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-[min(90vw,460px)] max-h-[85vh] overflow-y-auto rounded-xl"
          >
            <FormErrorBoundary>
              <DataVaultFormPanel
                conversationId={task?.id || ''}
                onContinue={(payload) => onSend?.(payload?.text || '[form action]')}
                onSubmit={onSubmitDataVaultForm}
                onNavigateToConnectors={onNavigateToConnectors}
                onClose={onDismissConnectForm}
              />
            </FormErrorBoundary>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
