/* Anton Chat — Direction A: Conservative.
   Near-1:1 port of docs/design-guidelines/chat.html (ChatConservative).
   Editorial, document-like. Inter body, Inter headings, mono for operator
   metadata. Centered ~720px column, OrbitMorph-led Anton turns, floating
   composer, right rail with collapsible cards.

   Wired against the live message model (role: user|assistant|error|activity,
   plus _streaming) and our real Composer + project/model state. Tokens come
   from CSS vars so the panel reads correctly in both light and dark themes. */

import { forwardRef, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import Ico from '../components/Icons';
import Composer from '../components/Composer';
import CodingTerminal from '../components/CodingTerminal';
import { Alert, Card, Tooltip } from '../components/ui';
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
import { DataVaultFormPanel } from '../components/datavault/DataVaultFormPanel';
import { getForm as getDataVaultForm, setForm as setDataVaultForm, subscribe as subscribeDataVaultForm, clearForm as clearDataVaultForm } from '../components/datavault/formStore';
import { FormErrorBoundary } from '../components/datavault/FormErrorBoundary';
import { revealArtifact, exportArtifact, attachmentRawUrl, fetchHealth } from '../api';
import { AttachmentThumbnail } from '../components/AttachmentThumbnail';
import { normalizeArtifactRecord } from '../lib/artifactPaths';
import { latestSkillCardIndexByKey } from '../lib/skillCards';
import { host, isWeb } from '../../platform/host';
import { Crumb as CrumbButton, CrumbSep } from '../components/ui/Crumb';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { useRevealOnHover } from '../hooks/useRevealOnHover';
import { harnessLabel } from '../lib/agentLabel';
import { artifactOpenTarget, isArtifactActionAvailable } from '../lib/artifactActions';
import { useOrgMode } from '../../lib/orgMode';
import { modelLabel } from '../lib/settingsTransform';
import { providerOverloadedButtons } from '../lib/turnErrorActions';
import { isSkippedFailedAssistant, isOrphanUser as isOrphanUserPure, lastVisibleTurnIdx } from '../lib/turnVisibility';
import { isThinkingActive } from '../lib/thinkingActive';
import { MINDS_BILLING_URL } from '../../lib/mindsUrls';
import { trackBillingOpened, trackKeyProvisioningRefused } from '../lib/analytics';

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

const FONT_DISPLAY = "var(--font-display, 'Inter', sans-serif)";
const FONT_MONO    = "var(--font-mono)";
const FONT_BODY    = "'Inter', system-ui, sans-serif";

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
const ICON_SZ = 15;
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
          className={`inline-flex items-center gap-3 py-3 px-3.5 rounded-xl max-w-[78%] outline-none bg-surface border border-solid border-line hover:border-accent hover:bg-[color-mix(in_srgb,var(--accent)_10%,var(--surface))] hover:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_18%,transparent)] transition-[border-color,background,box-shadow] duration-[140ms] ease-[ease] ${clickable ? 'cursor-pointer' : 'cursor-default'}`}
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
      className={`inline-flex items-center gap-1.5 py-1.5 px-3 rounded-full font-body text-sm font-medium cursor-pointer transition-colors duration-[140ms] ease-[ease] border border-solid ${
        isDanger
          ? 'bg-[color-mix(in_srgb,var(--danger)_8%,transparent)] border-[color-mix(in_srgb,var(--danger)_30%,transparent)] text-danger hover:bg-[color-mix(in_srgb,var(--danger)_14%,transparent)] hover:border-[color-mix(in_srgb,var(--danger)_45%,transparent)]'
          : 'bg-transparent border-transparent text-ink-3 hover:bg-surface-2 hover:border-line hover:text-ink'
      }`}
    >
      <span className="inline-flex items-center">
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

// Long user messages clamp to ~8 lines behind a "Show more" toggle so a big
// pasted prompt doesn't dominate the viewport before the answer starts.
const USER_CLAMP_MAX_PX = 176;

function UserTurn({ content, attachments, time, onDelete, onEdit, isLast, projectName, conversationId }) {
  const contentRef = useRef(null);
  const [collapsed, setCollapsed] = useState(true);
  const [overflowing, setOverflowing] = useState(false);
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
    <div className="user-turn">
      <div className="user-turn-inner">
        <div className="user-turn-bubble">
          {/* User messages flow through the same markdown pipeline as
              assistant turns so fenced code blocks, bold/italic, lists,
              etc. typed in the composer render properly. Forms and
              charts are gated off so a user typing a special fence in
              the composer can't trigger the side-effect renderers
              reserved for assistant output. */}
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
          {overflowing && (
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
                onOpen={() => host.openExternal(rawUrl)}
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
        <TurnActions
          getText={() => content || ''}
          onEdit={onEdit ? () => onEdit(content) : null}
          onDelete={onDelete}
          isLast={isLast}
          align="right"
        />
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
function AnswerTurn({ state = 'done', time, children, showActions = true, copyText, onDelete, agentLabel, isLast }) {
  return (
    <div
      // marginTop pulls the answer closer to ITS question (the column gap
      // is sized for the roomier answer → next-question separation).
      className="answer-turn flex flex-col gap-2.5 -mt-2.5 pb-1"
    >
      {children}
      {state !== 'thinking' && (
        <div className="flex items-center gap-2">
          {showActions && (
            <TurnActions getText={() => copyText || ''} onDelete={onDelete} isLast={isLast} />
          )}
          {/* Agent always named; timestamp joins it when the message has
              one (streamed turns often don't carry createdAt). */}
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
    // Second hand-written field list this card passes through (the adapter's
    // step.data is the first). Both have to carry identity and publish state or
    // the card cannot open, address or delete the artifact in org mode, where
    // there is no path-based fallback to hide the omission.
    id: data.id || '',
    slug: data.slug || '',
    publishedUrl: data.publishedUrl || '',
    projectId: data.projectId || '',
    projectName: data.projectName || '',
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
    <div className="flex flex-col gap-3 mt-1">
      {artifacts.map((s) => (
        <ArtifactCard key={s.id} artifact={artifactStepToCard(s, projectPath)} onOpen={onOpen} />
      ))}
    </div>
  );
}

// Renders any badge='AskUser' steps as inline question cards, the same way
// StepArtifacts renders artifacts — both receive the shared `steps` array.
//
// `expired` is derived PER QUESTION, not per conversation. Conversation-level
// liveness ("this chat has something in flight") is the wrong granularity: it
// renders an unanswered card from an EARLIER turn with live buttons for as long
// as any new stream runs on the same conversation, and clicking it 404s — which
// then retires whatever question the new turn is actually blocked on.
//
// Two rules:
//   - an answered question is never expired; the card renders its outcome, and
//     the generic "no longer active" line would be noise on top of it
//   - only the LAST unanswered question of a LIVE turn can still be answered
//
// That last rule leans on an invariant owned by anton, not by this repo: the
// `ask_user` tool blocks the turn, so anton never publishes a second question
// while one is outstanding, and it always retires the outstanding one (answer,
// cancel, or the server's 300 s timeout) before the turn ends. This repo can
// neither see nor enforce that cross-repo contract, so an earlier unanswered
// card is treated as expired rather than trusted to still be answerable.
function StepQuestions({ steps, conversationId, conversationLive, onAnswered }) {
  const questions = steps?.filter((s) => s.badge === 'AskUser') || [];
  if (questions.length === 0) return null;
  let lastUnanswered = -1;
  questions.forEach((s, i) => { if (!s.data?.answer) lastUnanswered = i; });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 4 }}>
      {questions.map((s, i) => (
        <AskUserCard
          key={s.id}
          step={s}
          conversationId={conversationId}
          expired={!s.data?.answer && !(conversationLive && i === lastUnanswered)}
          onAnswered={onAnswered}
        />
      ))}
    </div>
  );
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

function ArtifactCard({ artifact, onOpen }) {
  // This card is an artifact surface like the panel's rows, so it answers to the
  // same deployment gate. Without it the chat offered a local preview, Export
  // and Show in Finder for content an org deployment does not serve, while the
  // panel had already stopped offering them for the very same artifact.
  const orgMode = useOrgMode();
  const [status, setStatus] = useState(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const statusTimerRef = useRef(null);
  useLayoutEffect(() => () => {
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
  }, []);
  // Close the export menu on any outside click. Clicks on the menu/toggle
  // stopPropagation, so this only fires for clicks elsewhere.
  useEffect(() => {
    if (!exportOpen) return undefined;
    const close = () => setExportOpen(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [exportOpen]);

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
  const published = !!artifact.publishedUrl;
  const openTarget = artifactOpenTarget({
    orgMode, published, canPreviewInline, hasBridge: host.isElectron || !host.isWeb,
  });
  // Document artifacts (markdown/HTML/text) can be exported to PDF/Word/HTML.
  const _EXPORTABLE_EXTS = ['.md', '.markdown', '.html', '.htm', '.txt'];
  const canExport = canAct
    && isArtifactActionAvailable('export', { orgMode, hasBridge: !host.isWeb, published })
    && (_EXPORTABLE_EXTS.includes(lcExt) || _EXPORTABLE_EXTS.some((e) => lcPath.endsWith(e)));
  const canReveal = isArtifactActionAvailable('reveal', {
    orgMode, hasBridge: host.isElectron, published,
  });
  const handleExport = async (fmt) => {
    setExportOpen(false);
    if (!canAct) {
      showStatus('error', disabledReason || 'No artifact file path is available.');
      return;
    }
    setExporting(true);
    showStatus('ok', `Exporting ${fmt.toUpperCase()}…`);
    try {
      const res = await exportArtifact(path, fmt);
      showStatus('ok', `Exported ${res.filename}`);
      // Desktop: open the result in the OS. Web: it's saved in the artifact
      // folder and shows in the Artifacts panel.
      if (!host.isWeb) { try { await host.openPath(res.path); } catch { /* ignore */ } }
    }
    catch (e) {
      // eslint-disable-next-line no-console
      console.error('[artifact-export] failed', e);
      showStatus('error', e?.message || `Could not export ${fmt.toUpperCase()}.`);
    }
    finally {
      setExporting(false);
    }
  };
  const handleOpen = async () => {
    if (openTarget === 'published') {
      // The published URL is the ONLY route to this artifact's bytes on an org
      // deployment, and it carries the access check.
      try { host.openExternal(artifact.publishedUrl); }
      catch { window.open(artifact.publishedUrl, '_blank', 'noreferrer'); }
      return;
    }
    if (openTarget === null) {
      showStatus('error', orgMode
        ? 'This artifact has no published link yet.'
        : (disabledReason || 'No artifact file path is available.'));
      return;
    }
    if (!canAct) {
      showStatus('error', disabledReason || 'No artifact file path is available.');
      return;
    }
    if (openTarget === 'preview' && onOpen) {
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
    <Card
      as="div"
      interactive={canAct}
      padding="cozy"
      onActivate={canAct ? handleOpen : undefined}
      aria-label={canAct ? `Open preview: ${artifact.title}` : disabledReason || 'No file path'}
      className="grid grid-cols-[64px_1fr_auto] items-center gap-4"
    >
      <div className="w-16 h-16 bg-surface-2 rounded-lg grid place-items-center text-accent">
        {artifact.icon === 'doc' ? Ico.doc(26) : Ico.sparkle(26)}
      </div>
      <div className="flex flex-col gap-[3px] min-w-0">
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
          // kept inline: `all: unset` writes an inline declaration for every
          // longhand (incl. color/background), which always beats a Tailwind
          // utility class of equal-or-lower specificity — so every property
          // touched by the reset has to stay co-located here, and the hover
          // recolor below has to keep mutating .style directly for the same reason.
          style={{
            all: 'unset',
            cursor: canAct ? 'pointer' : 'not-allowed',
            fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 16, color: T.ink,
            letterSpacing: '0',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            display: 'block', minWidth: 0,
            transition: 'color 120ms ease',
            opacity: canAct ? 1 : 0.7,
          }}
          onMouseOver={(e) => { if (canAct) { e.currentTarget.style.color = T.accent; e.currentTarget.style.textDecoration = 'underline'; e.currentTarget.style.textUnderlineOffset = '3px'; } }}
          onMouseOut={(e) => { e.currentTarget.style.color = T.ink; e.currentTarget.style.textDecoration = 'none'; }}
        >{artifact.title}</button>
        <span className="font-body text-sm text-ink-3">
          {artifact.kind || 'live artifact'}
        </span>
        {previewText && (
          <span
            title={previewText}
            className="font-mono text-[10.5px] text-ink-4 mt-0.5 tracking-[0.04em] overflow-hidden text-ellipsis whitespace-nowrap"
          >
            {previewText}
          </span>
        )}
      </div>
      <div className="flex gap-1.5">
        {status && (
          <span
            aria-live="polite"
            className={`self-center max-w-[180px] overflow-hidden text-ellipsis whitespace-nowrap font-body text-[11.5px] ${status.kind === 'error' ? 'text-danger' : 'text-accent'}`}
          >
            {status.text}
          </span>
        )}
        {canExport && (
          <div className="relative" onClick={(e) => e.stopPropagation()}>
            <Tooltip content="Export to another format">
              {/* Native title only while disabled — a disabled button fires no
                  hover/focus events, so the styled Tooltip can't open. */}
              <SmallBtn
                disabled={!canAct || exporting}
                onClick={() => setExportOpen((v) => !v)}
                title={(!canAct || exporting) ? 'Export to another format' : undefined}
              >
                Export ▾
              </SmallBtn>
            </Tooltip>
            {exportOpen && (
              <div
                role="menu"
                // No border — floats on --sh-popup alone (ENG-790).
                className="absolute top-[calc(100%+4px)] right-0 z-20 bg-surface rounded-[10px] shadow-sh-popup p-1 min-w-[140px] flex flex-col gap-0.5"
              >
                {[['pdf', 'PDF'], ['docx', 'Word (.docx)'], ['html', 'HTML']].map(([fmt, label]) => (
                  <button
                    key={fmt}
                    type="button"
                    role="menuitem"
                    onClick={(e) => { e.stopPropagation(); handleExport(fmt); }}
                    // kept inline: same all:unset cascade-priority reason as the
                    // title button above — the hover background mutation below
                    // needs a subsequent inline write to win, so it can't move
                    // to a hover: utility class either.
                    style={{
                      all: 'unset', cursor: 'pointer', padding: '7px 10px', borderRadius: 7,
                      fontFamily: FONT_BODY, fontSize: 12.5, color: T.ink,
                    }}
                    onMouseOver={(e) => { e.currentTarget.style.background = T.surface2; }}
                    onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  >{label}</button>
                ))}
              </div>
            )}
          </div>
        )}
        {!host.isWeb && canReveal && (
          <Tooltip content={canAct ? `${revealLabel}: ${path}` : ''}>
            <SmallBtn disabled={!canAct} onClick={handleReveal} title={canAct ? undefined : (disabledReason || 'No file path')}>
              {revealLabel}
            </SmallBtn>
          </Tooltip>
        )}
        {/* Org mode drops the file-path conditions entirely: there the button
            opens the published URL, which has no local path behind it. */}
        {(orgMode ? openTarget === 'published' : (!host.isWeb || isHtml)) && (
          <Tooltip content={orgMode ? 'Open the published artifact' : (canAct ? `Open ${path}` : '')}>
            <SmallBtn
              primary
              disabled={!orgMode && !canAct}
              onClick={handleOpen}
              title={(orgMode || canAct) ? undefined : (disabledReason || 'No file path')}
            >
              Open
            </SmallBtn>
          </Tooltip>
        )}
      </div>
    </Card>
  );
}

// The primary ("Open") CTA no longer hard-fills raw --accent (which glared in
// dark). Both variants are class-based now so the primary can adopt the
// canonical .btn.primary color logic — opaque accent in light, quiet accent
// glass in dark — via .chat-card-btn(--primary) in globals.css.
const SmallBtn = forwardRef(function SmallBtn({ primary, children, onClick, title, disabled, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={(e) => { e.stopPropagation(); if (!disabled) onClick?.(); }}
      title={title}
      disabled={disabled}
      className={primary ? 'chat-card-btn chat-card-btn--primary' : 'chat-card-btn'}
      {...rest}
    >{children}</button>
  );
});

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


// Wait for the sidecar to come back after mindshubFinalize restarts it, so we
// don't tell the user to resend into a cold server (any 200 from /health = up).
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
// cards (previously four byte-identical copies of this scaffolding, drifting
// one tweak at a time — ENG-650). Callers own copy + button wiring; the shell
// owns layout and button styling.
// buttons: [{ label, onClick, primary, disabled, style }] — `style` overlays
// the base for per-button tweaks (e.g. the reconnect busy state). An empty
// list hides the row (e.g. reconnect's "done" state).
function ActionCard({ time, agentLabel, title, body, buttons = [] }) {
  return (
    <AnswerTurn state="done" time={time} showActions={false} agentLabel={agentLabel}>
      <div className="flex flex-col gap-2.5 max-w-[520px] py-4 px-[18px] rounded-xl border border-solid border-line bg-surface">
        {/* .s-h3 already sets color: var(--ink) — no inline override needed. */}
        <div className="s-h3">
          {title}
        </div>
        <div className="font-body text-[13.5px] leading-[1.55] text-ink-2">
          {body}
        </div>
        {buttons.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-1">
            {buttons.map((b, i) => (
              <button
                key={i}
                type="button"
                onClick={b.onClick}
                disabled={b.disabled}
                // bg=ink / text=bg so the label keeps contrast in BOTH themes: light →
                // dark button / light text, dark → light button / dark text. A
                // hardcoded #fff went invisible in dark mode (ink is near-white
                // there → white-on-white).
                className={`rounded-lg py-2 px-3.5 font-body text-[13px] font-medium cursor-pointer ${b.primary ? 'border-0 bg-ink text-bg' : 'border border-solid border-line bg-transparent text-ink'}`}
                style={b.style}
              >{b.label}</button>
            ))}
          </div>
        )}
      </div>
    </AnswerTurn>
  );
}

// ── AllowanceExhaustedCard: the free monthly grant, not a drained wallet ───
// ENG-1537. auth's `access.py` issues `included_allowance_exhausted` ONLY for a
// free-bucket model on an org that has NEVER topped up, so this user has not
// spent money — they used the monthly grant, and it resets. Two things follow,
// and the old shared out-of-credits card got both wrong: the reset date is a
// genuinely free way forward (hiding it while asking for money is the defect),
// and "unlock" is literally true, because non-free models need a wallet this
// org doesn't have.
//
// The date is formatted here, not server-side: only the client knows the
// viewer's timezone, and parsing it on the server shifts the day for some
// users. Anything unusable — absent, malformed, or already past on a reloaded
// conversation — degrades to "next month" rather than rendering "Invalid Date"
// or a stale month.
function formatAllowanceReset(resetAt) {
  if (!resetAt) return 'next month';
  const d = new Date(resetAt);
  if (Number.isNaN(d.getTime())) return 'next month';
  if (d.getTime() <= Date.now()) return 'next month';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
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

function RateLimitedCard({ time, agentLabel, body, retryAt, onRetry }) {
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

  return (
    <ActionCard
      time={time}
      agentLabel={agentLabel}
      title="Too many requests too quickly"
      body={body}
      buttons={buttons}
    />
  );
}

// For **MindsHub** (`reconnectable`), the fix is to re-provision the key in
// place via mindshubFinalize (the same step login runs) — no logout. For a
// **BYOK** provider, only the user can fix their own key, so we point them to
// Settings instead of dragging them into a MindsHub login. Reconnect is also
// desktop-only (finalize/login are Electron IPC), so on web we fall back to
// Settings too.
function ReconnectCard({ time, agentLabel, onOpenSettings, reconnectable, providerLabel }) {
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
      if (res?.ok || res?.apiKey) {
        // finalize restarts the sidecar — wait until it's back so the resend
        // doesn't hit a cold server.
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
      time={time}
      agentLabel={agentLabel}
      title={title}
      body={body}
      buttons={done ? [] : [
        ...(canReconnect ? [{
          label: busy ? 'Reconnecting…' : 'Reconnect',
          onClick: reconnect,
          primary: true,
          disabled: busy,
          style: { cursor: busy ? 'progress' : 'pointer', opacity: busy ? 0.7 : 1 },
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
 */
export function ModelUnavailableCard({ time, agentLabel, onOpenSettings, code, failedModel, onSwitchToAir }) {
  // modelLabel finishes multi-part ids (Claude Sonnet, GPT-5.5 Mini) and
  // deliberately lowercases some heads (o4 Mini) — never re-case those. Only a
  // bare single-token alias ("sonnet") comes back lowercase, and it reads
  // better capitalized in the title. So capitalize single-word labels only,
  // leaving anything modelLabel already spaced/cased untouched.
  const raw = modelLabel(failedModel) || failedModel || 'This model';
  const label = /\s/.test(raw) ? raw : raw.charAt(0).toUpperCase() + raw.slice(1);
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
      time={time}
      agentLabel={agentLabel}
      title={title}
      body={denied
        ? "You don't have enough credits for this model. Top up your balance to use it."
        : 'This model is turned off for your workspace. Choose another model in Settings.'}
      buttons={denied
        ? [
            { label: 'Top up balance', onClick: openBilling, primary: true },
            // Only while Air can still run (free monthly grant or a payable
            // wallet) — a switch offer into another locked model is the same
            // dead end this card exists to close.
            ...(onSwitchToAir ? [{ label: 'Switch to MindsHub Air', onClick: onSwitchToAir }] : []),
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
      time={time}
      agentLabel={agentLabel}
      title={`${who} is having a temporary issue`}
      body={body}
      buttons={providerOverloadedButtons({ reconnectable: onManaged, onRetry, onOpenSettings })}
    />
  );
}

// Most recent user text before index `i` — the message whose turn failed.
// Used by failure cards whose action is "resend the failed message".
function lastUserTextBefore(visibleMessages, i) {
  for (let j = i - 1; j >= 0; j--) {
    const c = visibleMessages[j]?.role === 'user' && visibleMessages[j].content;
    if (typeof c === 'string' && c) return c;
  }
  return '';
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
  // Full catalog for the model picker (ENG-1656: task view can change its
  // model, not just display it). Falls back to a single-item list of just
  // the current model when omitted, so existing callers/tests that don't
  // pass these keep working exactly as before — a flat, unpickable menu.
  models,
  modelMeta,
  attachments,
  connectors,
  onAttachFiles,
  onAddGoogleDriveFiles,
  onAddGoogleDriveProjectFiles,
  onFetchGoogleDriveProjectFiles,
  onRemoveGoogleDriveProjectFile,
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
  onDismissConnectForm,
  onCancelModify,
  onDisconnectModify,
  onMoveTaskToProject,
  onOpenProject,
  onOpenProjectsList,
  onOpenSettings,
  codingModelDefault,
  harnessHermesEnabled,
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
  // Hermes has no memory system of its own — the Context rail's Project/
  // Global memory sections are an Anton concept and don't apply.
  const isHermesTask = task?.harness === 'hermes';
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

  // One inline skill card per slug — shown only at the LATEST turn that emitted
  // it, so a refined skill's card moves down to the newest version and earlier
  // copies disappear. Streaming message is last in chronological order.
  const latestSkillCardByKey = useMemo(
    () => latestSkillCardIndexByKey(streamingMsg ? [...visibleMessages, streamingMsg] : visibleMessages),
    [visibleMessages, streamingMsg],
  );

  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [task.messages.length, isStreaming]);

  // Outer ref + conv-column ref. The orb canvas binds to the conv
  // column so the floating orb is naturally clipped to that area
  // (can't leak into the rail visually when a slot is near the right
  // edge). chatRef stays as the panel-level ancestor.
  const chatRef = useRef(null);
  const convRef = useRef(null);

  // The orb anchors to the WorkingIndicator box (pre-step placeholder,
  // then the ThinkingBlock header) for as long as there's real work
  // going on — steps and thoughts keep streaming above the growing
  // answer text throughout, so the orb stays put for the whole turn
  // rather than handing off once body text starts. Shares
  // isThinkingActive with ThinkingBlock's own header so the two can't
  // drift out of sync again the way they did before (ENG-1107/1109):
  // whatever keeps the steps panel expanded is exactly what should keep
  // the orb anchored.
  const orbView = useMemo(() => {
    if (!streamingMsg) return { state: null, activeSlot: null };
    if (!isThinkingActive(streamingMsg.streamStatus)) return { state: null, activeSlot: null };
    return { state: 'thinking', activeSlot: 'header:streaming' };
  }, [streamingMsg]);

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
      className={`flex-1 min-h-0 grid grid-rows-[1fr] transition-[grid-template-columns] duration-[220ms] ease-[cubic-bezier(.2,.7,.3,1)] bg-transparent font-body text-ink-2 relative overflow-hidden ${effectiveRailOpen ? 'grid-cols-[minmax(0,1fr)_320px]' : 'grid-cols-[minmax(0,1fr)_0px]'}`}
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
                `opacity 280ms cubic-bezier(0.32,0.72,0,1) ${(effectiveRailOpen || railOverlayOpen) ? '0ms' : '120ms'}, ` +
                `transform 360ms cubic-bezier(0.32,0.72,0,1) ${(effectiveRailOpen || railOverlayOpen) ? '0ms' : '80ms'}`,
            }}
            className="chat-rail-toggle absolute top-3.5 right-3.5 z-10 w-7 h-7 rounded-md inline-grid place-items-center cursor-pointer bg-transparent border-0 text-ink-3 hover:text-ink hover:bg-surface-2 [-webkit-app-region:no-drag]"
          >
            {Ico.panelExpandLeft(15)}
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
          className="flex items-center justify-between pt-[max(14px,var(--titlebar-safe-top,0px))] pb-3.5 pr-7 pl-7 bg-transparent flex-shrink-0 min-w-0 overflow-hidden transition-[padding] duration-[240ms] ease-[cubic-bezier(0.32,0.72,0,1)]"
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
                  {Ico.pin(11)}
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
                    className={`w-[22px] h-[22px] rounded-[5px] border-0 inline-grid place-items-center flex-shrink-0 cursor-pointer transition-[opacity,color,background] duration-150 ease-[ease] [-webkit-app-region:no-drag] text-ink-3 hover:text-ink hover:bg-surface-2 ${settingsOpen ? 'bg-surface-2' : 'bg-transparent'}`}
                  >
                    {Ico.moreVert(13)}
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
          className="scroll-clean min-h-0 overflow-y-auto overflow-x-hidden pt-8 px-7 pb-[180px] mb-[25px] bg-transparent [-webkit-app-region:no-drag] select-text"
        >
          <div className="max-w-[720px] mx-auto flex flex-col gap-7">
            {(() => {
              // Track the assistant turn index inline so TurnActions
              // knows which user→answer cycle to delete. The walker
              // mirrors the server's `_count_displayable_assistant_bubbles`
              // contract: each assistant entry counts once. We also
              // count user-input messages so orphan users (stop before
              // any assistant response) can carry their own delete
              // affordance with the right turn index.
              let assistantTurnIdx = -1;
              let userInputIdx = -1;
              // Skip + orphan rules live together in lib/turnVisibility so a
              // user message whose only assistant bubble is skipped keeps the
              // delete affordance the hidden bubble used to carry (ENG-1304,
              // PR #580 review).
              const isOrphanUser = (atIdx) => isOrphanUserPure(visibleMessages, atIdx);
              // Index of the last user or assistant message that renders —
              // its actions stay always-visible (Claude pattern: most recent
              // exchange shows its toolbar). Skipped failed-assistant bubbles
              // don't count (PR #580 review), so a final failed turn keeps
              // the toolbar on the user message. When streaming, nothing
              // needs isLast since the streaming turn has no actions yet.
              const lastTurnIdx = streamingMsg ? -1 : lastVisibleTurnIdx(visibleMessages);
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
                    projectName={project?.name}
                    conversationId={task?.id}
                    time={formatTime(m.createdAt)}
                    onDelete={orphan ? () => onDeleteTurn?.(turnIdxForThisUser) : null}
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
                    <AnswerTurn key={i} state="thinking" showActions={false}>
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
                    key={i}
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
                  return (
                    <ActionCard
                      key={i}
                      time={formatMetaTime(m.createdAt)}
                      agentLabel={agentLabel}
                      title="You're out of credits"
                      // Fixed copy, not the server string (ENG-1304) — the
                      // gateway's wording predates pay as you go.
                      body="You've used your available MindsHub tokens. Top up your balance to keep working."
                      buttons={[
                        {
                          label: 'Top up balance',
                          // ENG-1533: the click, not an impression. token_cap_hit
                          // already counts the impression once per receipt in the
                          // stream adapter; an impression here would re-fire on
                          // every paint.
                          onClick: () => {
                            trackBillingOpened('token_limit');
                            host.openExternal(MINDS_BILLING_URL);
                          },
                          primary: true,
                        },
                      ]}
                    />
                  );
                }
                // Provider auth failure mid-conversation → offer Reconnect
                // (re-provision the key in place), not "Subscribe".
                if (m.code === 'provider_auth') {
                  return (
                    <ReconnectCard
                      key={i}
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
                 * failed message on it — never "try again". */
                if (m.code === 'model_access_denied' || m.code === 'model_disabled') {
                  const deniedPrevUserText = lastUserTextBefore(visibleMessages, i);
                  return (
                    <ModelUnavailableCard
                      key={i}
                      time={formatTime(m.createdAt)}
                      agentLabel={agentLabel}
                      onOpenSettings={onOpenSettings}
                      code={m.code}
                      failedModel={m.failedModel}
                      onSwitchToAir={
                        onSwitchToAirAndResend && deniedPrevUserText
                          ? () => onSwitchToAirAndResend(deniedPrevUserText)
                          : undefined
                      }
                    />
                  );
                }
                // Transient provider incident that outlasted anton's retry
                // budget → Retry (resend the last user message), plus a MindsHub
                // failover nudge for BYOK users (ENG-673).
                if (m.code === 'provider_overloaded') {
                  const prevUserText = lastUserTextBefore(visibleMessages, i);
                  return (
                    <ProviderOverloadedCard
                      key={i}
                      time={formatMetaTime(m.createdAt)}
                      agentLabel={agentLabel}
                      onOpenSettings={onOpenSettings}
                      onRetry={prevUserText ? () => onSend?.(prevUserText) : undefined}
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
                      key={i}
                      time={formatMetaTime(m.createdAt)}
                      agentLabel={agentLabel}
                      title={badModel ? `"${badModel}" isn't a model we can use` : "That model isn't available"}
                      body={badModel
                        ? `Your settings point at "${badModel}", which this provider doesn't offer — so nothing was sent. Pick a model from the list in Settings.`
                        : "The selected model was removed or isn't offered anymore. Switch to another model in Settings."}
                      // Open Settings only. A "Switch to MindsHub Air" button was
                      // tried here and removed: it routes through
                      // handleSendInTask's `modelOverride`, which the in-process
                      // harness ignores entirely (stream_response takes no
                      // `model` — harness.py), so the turn would rerun on the
                      // same dead id while the composer chip claimed otherwise.
                      // The neighbouring model-denial card has the same latent
                      // problem; making that switch real is a product decision
                      // (it means writing the global planning_model setting),
                      // tracked separately rather than faked here.
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
                      key={i}
                      time={formatMetaTime(m.createdAt)}
                      agentLabel={agentLabel}
                      title="That image couldn't be read"
                      body="The attached image is in a format the model can't process. Convert it to PNG or JPEG and send it again."
                    />
                  );
                }
                // Transient billing/policy outage at the gateway
                // (`policy_unavailable`): retryable and not the user's fault,
                // so the next step is simply resending the failed message.
                if (m.code === 'policy_unavailable') {
                  const retryText = lastUserTextBefore(visibleMessages, i);
                  return (
                    <ActionCard
                      key={i}
                      time={formatMetaTime(m.createdAt)}
                      agentLabel={agentLabel}
                      title="Billing is temporarily unavailable"
                      body="MindsHub couldn't confirm billing for this request. This is temporary — try again in a moment."
                      buttons={retryText
                        ? [{ label: 'Try again', onClick: () => onSend?.(retryText), primary: true }]
                        : []}
                    />
                  );
                }
                // Spent FREE monthly allowance (gateway 429
                // `included_allowance_exhausted`): not a drained wallet, so it
                // names the reset date as a free alternative and says what
                // credits actually unlock (ENG-1537).
                if (m.code === 'included_allowance_exhausted') {
                  return (
                    <ActionCard
                      key={i}
                      time={formatMetaTime(m.createdAt)}
                      agentLabel={agentLabel}
                      title="You've used this month's free tokens"
                      body={`Your free allowance resets on ${formatAllowanceReset(m.resetAt)}. Add credits to keep working now and unlock Claude, GPT, Gemini, Kimi, DeepSeek and more.`}
                      buttons={[
                        {
                          label: 'Add credits',
                          // ENG-1533: the click, not an impression — same rule as
                          // the drained-wallet card above. token_cap_hit already
                          // counts this impression once per receipt in the stream
                          // adapter, so every route to billing is counted exactly
                          // once and this one is not the exception.
                          onClick: () => {
                            trackBillingOpened('included_allowance_exhausted');
                            host.openExternal(MINDS_BILLING_URL);
                          },
                          primary: true,
                        },
                      ]}
                    />
                  );
                }
                // Velocity rate-limit (gateway 429 `rate_limited`): waiting is
                // the fix, so the card says so and offers a time-gated Retry —
                // never a top-up, which is what this used to show (ENG-1537).
                if (m.code === 'rate_limited') {
                  const rlRetryText = lastUserTextBefore(visibleMessages, i);
                  return (
                    <RateLimitedCard
                      key={i}
                      time={formatMetaTime(m.createdAt)}
                      agentLabel={agentLabel}
                      body={m.content}
                      retryAt={m.retryAt}
                      onRetry={rlRetryText ? () => onSend?.(rlRetryText) : undefined}
                    />
                  );
                }
                // `anton_error` and anything unmapped: a deliberately generic
                // bucket with no known next step, so no card — but still a
                // failure, rendered as a danger alert so it never reads as a
                // finished answer. Richer treatment is ENG-1093's review.
                return (
                  <AnswerTurn key={i} state="done" time={formatMetaTime(m.createdAt)} showActions={false} agentLabel={agentLabel}>
                    <Alert variant="danger">{m.content}</Alert>
                  </AnswerTurn>
                );
              }
              if (m.role === 'provider_required') {
                return (
                  <ActionCard
                    key={i}
                    time={formatMetaTime(m.createdAt)}
                    title="Connect a provider to start chatting"
                    body="Start with MindsHub and get free monthly tokens on MindsHub Air, then pay as you go. Or add your own API key in Settings."
                    buttons={[
                      {
                        label: 'Start for free',
                        // ENG-1533: the click only. Whether this card deserves an
                        // impression event of its own is an open ENG-1305
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
              assistantTurnIdx += 1;
              // A turn that failed before producing anything renders no
              // bubble — the blank block above billing cards (ENG-1304).
              // Counted first so turn indexing is unchanged; the same
              // predicate keeps isOrphanUser's delete affordance honest.
              if (isSkippedFailedAssistant(visibleMessages, i)) {
                return null;
              }
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
                  // Streamed turns rarely carry createdAt — fall back to the
                  // turn's own start time so the hover meta still has a date.
                  time={formatMetaTime(m.createdAt || m.startedAt)}
                  copyText={m.content}
                  onDelete={() => onDeleteTurn?.(turnIdxForThisBubble)}
                  agentLabel={harnessLabel(m.harness) || 'Agent'}
                  isLast={i === lastTurnIdx}
                >
                  {m.steps?.length > 0 && (
                    <ThinkingBlock
                      steps={m.steps}
                      startedAt={m.startedAt}
                      isActive={false}
                      onActivateStep={(step) => setOpenScratchpadStepId(prefixId(messageKey(m, i), step.id))}
                    />
                  )}
                  {/* Above the text: a question is asked, then answered, then
                      (at most) the turn's closing text streams — so the card
                      always precedes any text that came after the answer. */}
                  <StepQuestions
                    steps={m.steps}
                    conversationId={task.id}
                    // A completed turn by construction — `visibleMessages`
                    // excludes the `_streaming` row — so no question rendered
                    // here belongs to the live turn, whatever else is in flight
                    // on this conversation.
                    conversationLive={false}
                    onAnswered={onQuestionAnswered}
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
            })()}

            {streamingMsg ? (
              <AnswerTurn state="thinking" showActions={false}>
                {(streamingMsg.steps?.length > 0 || streamingMsg.currentThought?.text) && (
                  <ThinkingBlock
                    steps={streamingMsg.steps}
                    startedAt={streamingMsg.startedAt}
                    isActive={isThinkingActive(streamingMsg.streamStatus)}
                    slotId="header:streaming"
                    currentThought={streamingMsg.currentThought}
                    currentLabel={(() => {
                      // The header stays the WORKING message (active step
                      // label, else "Thinking…") — never the live thought
                      // text. The thought has its own distinct line at the
                      // bottom of the steps; letting it also drive the
                      // header made the working message flicker/overwrite
                      // as each reasoning delta streamed in.
                      const active = [...(streamingMsg.steps || [])].reverse().find(s => s.status === 'in_progress');
                      return active?.label || null;
                    })()}
                    onActivateStep={(step) => setOpenScratchpadStepId(prefixId(streamingKey, step.id))}
                  />
                )}
                {/* Above the text: a question is asked, then answered, then
                    (at most) the turn's closing text streams — so the card
                    always precedes any text that came after the answer. */}
                <StepQuestions
                  steps={streamingMsg.steps}
                  conversationId={task.id}
                  conversationLive={isStreaming || !!inFlightSet?.has(task.id)}
                  onAnswered={onQuestionAnswered}
                />
                {/* Bridge state: between the first stream event arriving
                    (which strips the activity placeholder) and the first
                    step, thought, or body chunk landing, the AnswerTurn
                    would otherwise render empty — the user sees the
                    message "appear, vanish, then come back" once
                    scratchpad output starts. Keep the working indicator
                    visible whenever there's nothing else occupying the
                    same slot yet. `_placeholderLabel` is set by the
                    pre-first-event stub in App.jsx
                    `withThinkingPlaceholder` ("Creating task…" for new
                    tasks, "Thinking…" for replies). */}
                {!streamingMsg.steps?.length && !streamingMsg.currentThought?.text && !streamingMsg.content && (
                  <WorkingIndicator
                    slotId="header:streaming"
                    label={streamingMsg._placeholderLabel || 'Thinking…'}
                  />
                )}
                {streamingMsg.content && (
                  <div className="relative">
                    <TextBlock text={streamingMsg.content} id="streaming" complete={false} conversationId={task.id} />
                    <StreamCursor />
                  </div>
                )}
                <StepArtifacts steps={streamingMsg.steps} onOpen={handleArtifactOpen} projectPath={artifactProjectPath} />
                <StepSkills steps={streamingMsg.steps} latestByKey={latestSkillCardByKey} messageIndex={visibleMessages.length} projectName={project?.name} />
              </AnswerTurn>
            ) : isStreaming && (
              <AnswerTurn state="thinking" showActions={false}>
                <WorkingIndicator label="Streaming…" />
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
        <div className="chat-floating-composer absolute left-7 right-7 bottom-[22px] flex flex-col items-center gap-2 pointer-events-auto [--composer-max-width:720px]">
          {/* Queued-messages strip — pills with each waiting prompt
              + a × to drop it. The pills cross-fade in/out so the
              transition between queue states reads as deliberate. */}
          {queuedMessages.length > 0 && (
            <div className="w-full max-w-[720px] flex flex-col gap-1.5 py-2.5 px-3 rounded-[14px] bg-[color-mix(in_srgb,var(--accent)_8%,var(--surface))] border border-solid border-[color-mix(in_srgb,var(--accent)_22%,var(--line))] shadow-[0_8px_24px_rgba(0,0,0,0.10)] animate-[queue-pop-in_220ms_cubic-bezier(0.32,0.72,0,1)]">
              <div className="font-mono text-[10.5px] text-accent tracking-[0.08em] uppercase flex items-center gap-1.5">
                <span className="pulse-dot w-1.5 h-1.5 rounded-full bg-accent shadow-[0_0_6px_var(--accent-glow)]" />
                {queuedMessages.length} queued · waiting for {agentLabel || 'Anton'}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {queuedMessages.map((q) => (
                  <span
                    key={q.id}
                    title={q.text}
                    className="inline-flex items-center gap-1.5 max-w-full pt-[5px] pr-1 pb-[5px] pl-3 rounded-full bg-surface border border-solid border-line font-body text-sm text-ink-2 transition-[background,border-color] duration-[120ms] ease-[ease]"
                  >
                    <span className="max-w-[360px] overflow-hidden text-ellipsis whitespace-nowrap">{q.text}</span>
                    <Tooltip content="Remove from queue">
                      <button
                        type="button"
                        onClick={() => onRemoveFromQueue?.(q.id)}
                        aria-label="Remove from queue"
                        className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-transparent border-0 text-ink-4 cursor-pointer flex-shrink-0 hover:bg-[color-mix(in_srgb,var(--danger)_14%,transparent)] hover:text-danger"
                      >{Ico.close(11)}</button>
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
            projects={[]}
            models={models || (model ? [model] : [])}
            modelMeta={modelMeta}
            attachments={attachments}
            connectors={connectors}
            onNavigateToConnectors={onNavigateToConnectors}
            onAttachFiles={onAttachFiles}
            onAddGoogleDriveFiles={onAddGoogleDriveFiles}
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
            harnessHermesEnabled={harnessHermesEnabled}
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
          className="fixed inset-0 z-50 bg-[rgba(0,0,0,0.35)] backdrop-blur-[2px] transition-opacity duration-[280ms] ease-[cubic-bezier(0.32,0.72,0,1)] [-webkit-app-region:no-drag]"
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
            ? 'fixed top-[9px] bottom-[9px] right-[9px] w-[min(85vw,320px)] z-[51] bg-surface border border-solid border-line rounded-[14px] shadow-sh-2 transition-transform duration-[380ms] ease-[cubic-bezier(0.22,1,0.36,1)]'
            : 'bg-transparent min-w-0 transition-opacity duration-[180ms] ease-[ease]'
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
              {Ico.panelCollapseRight(15)}
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
        />
        <ContextBox
          project={project}
          conversationId={task?.id}
          refreshKey={contextRefreshKey}
          showMemory={!isHermesTask}
          onAddGoogleDriveFiles={onAddGoogleDriveProjectFiles}
          onFetchGoogleDriveFiles={onFetchGoogleDriveProjectFiles}
          onRemoveGoogleDriveFile={onRemoveGoogleDriveProjectFile}
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
