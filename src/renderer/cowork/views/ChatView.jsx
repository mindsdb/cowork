import { downloadUnavailableMessage } from '../lib/browserDownload';
import { diagnostic } from '../../../shared/diagnostics';
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
import Ico from '../components/Icons';
import { CircleAlert } from 'lucide-react';
import { Icon } from '../components/ui/Icon';
import ArtifactRepairCard from '../components/ArtifactRepairCard';
import { parseArtifactRepairPrompt } from '../lib/artifactRepairPrompt';
import { inlineSubmitChatPrompt, parseQuickEditPrompt } from '../lib/quickEditPrompt';
import { MESSAGE_CARD_SLOT, cardRevisionId, inlineArtifactKey, isSupersededInline, latestInlineArtifactByKey } from '../lib/inlineArtifactCards';
import { artifactShareState } from '../lib/orgSharing';
import { planQuickEditCards } from '../lib/quickEditGroup';
import { QuickEditGroupCard } from '../components/chat/QuickEditGroupCard';
import { ArtifactRefPill } from '../components/artifacts/ArtifactRefPill';
import Composer from '../components/Composer';
import CodingTerminal from '../components/CodingTerminal';
import { ActionBar, Alert, Badge, Card, Collapsible, Tooltip } from '../components/ui';
import { Modal, ModalBody } from '../components/ui/Modal';
import { MarkdownContent } from '../components/markdown/MarkdownContent';
import { ThinkingBlock } from '../components/thinking/ThinkingBlock';
import { WorkingIndicator } from '../components/thinking/WorkingIndicator';
import { FirstTake } from '../components/thinking/FirstTake';
import { stepDisplayLabel } from '../lib/responseStreamAdapter';
import { OrbitProvider } from '../lib/orbitRegistry';
import { ChatTranscriptContext, useTaskTranscript } from '../lib/chatTranscriptContext';
import CopyDiagnosticsButton from '../components/CopyDiagnosticsButton';
import { TaskMenu } from '../components/TaskMenu';
import { ScratchpadModal } from '../components/thinking/ScratchpadModal';
import ContextFileModal from '../components/project/ContextFileModal';
import { ProgressBox, WorkingFolderBox, ContextBox } from '../components/rail';
import { ArtifactViewer } from '../components/artifact';
import { ArtifactInlinePreview } from '../components/artifact/ArtifactInlinePreview';
import DocCard from '../components/doc/DocCard';
import DocColumn from '../components/doc/DocColumn';
import { isDocArtifact } from '../components/doc/docArtifact';
import { docGridColumns } from '../components/doc/docLayout';
import { useDocBesideChat } from '../components/doc/useDocBesideChat';
import SkillCard from '../components/SkillCard';
import ConnectorDraftCard from '../components/ConnectorDraftCard';
import AskUserCard from '../components/AskUserCard';
import HandOverCard from '../components/HandOverCard';
import ChatCardShell, { cardActions } from '../components/ChatCardShell';
import { DataVaultFormPanel } from '../components/datavault/DataVaultFormPanel';
import { getForm as getDataVaultForm, setForm as setDataVaultForm, subscribe as subscribeDataVaultForm, clearForm as clearDataVaultForm } from '../components/datavault/formStore';
import { FormErrorBoundary } from '../components/datavault/FormErrorBoundary';
import { revealArtifact, attachmentRawUrl, artifactServeUrl, fetchHealth, provisionBrowser, openBrowserAt } from '../api';
import { AttachmentThumbnail, useBlobImageSrc } from '../components/AttachmentThumbnail';
import { GeneratedImageCard } from '../components/GeneratedImageCard';
import { normalizeArtifactRecord } from '../lib/artifactPaths';
import { BACKEND_ARTIFACT_TYPES, canDownloadArtifact, canDownloadOrgDraft, canPreviewLocally, canPreviewOrgDraft, isBackendArtifact, isHtmlArtifact, isImageArtifact, isInlineArtifact, isPublishableArtifact, isWidgetArtifact } from '../lib/artifactKinds';
import { useLiveApps } from '../../lib/liveApps';
import { canPreviewDocument } from '../preview/kinds';
import { downloadArtifactFile } from '../lib/artifactDownload';
import { openAuthenticatedResource } from '../lib/authenticatedResource';
import { latestSkillCardIndexByKey } from '../lib/skillCards';
import { BROWSER_BADGE, browserSessionIdIn, conversationUsedBrowser, desktopTaskSession, latestBrowserSessionIdIn } from '../lib/browserSession';
import { BrowserPanel } from '../components/browser/BrowserPanel';
import BlankBrowserPanel from '../components/browser/BlankBrowserPanel';
import ProjectBrowsers from '../components/browser/ProjectBrowsers';
import { browserInsteadRequest } from '../lib/connectorWebsites';
import TopShortcuts from '../components/TopShortcuts';
import VoiceOrb from '../components/VoiceOrb';
import { isPersonsBrowserTurn, isPositionClickCard } from '../lib/browserApproval';
import { BROWSER_ACTION_BADGE, groupBrowserSteps } from '../lib/browserSteps';
import { BROWSER_APPROVAL_BADGE, answeredBrowserStep } from '../lib/browserStepPrompt';
import { BROWSER_HANDOVER_BADGE, finishedHandOverStep, isHandOverCard } from '../lib/browserHandOverPrompt';
import { openNeeds } from '../lib/voice/callNeeds';
import { BrowserHandOverContext } from '../lib/browserHandOverContext';
import { dropHandBack } from '../lib/browserHandBack';
import { useBrowserPrefs } from '../lib/browserPrefs';
import Button from '../components/ui/Button';
import { createBrowserWarmUp } from '../lib/browserWarmUp';
import { useNativeOverlay } from '../lib/nativeOverlay';
import { nextScrollAnchor } from '../lib/scrollAnchor';
import { host, isWeb } from '../../platform/host';
import { PLATFORM_UI } from '../../lib/deployment';
import { Crumb as CrumbButton, CrumbSep } from '../components/ui/Crumb';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { useIntersection } from '../hooks/useIntersection';
import { useRevealOnHover } from '../hooks/useRevealOnHover';
import { harnessLabel } from '../lib/agentLabel';
import { artifactOpenTarget, noPreviewDownloadedNote } from '../lib/artifactActions';
import { revalidate as revalidateArtifacts, setArtifactsScope, useArtifactCardBySlug, useArtifactLiveness } from '../lib/artifactsStore';
import { useOrgMode } from '../../lib/orgMode';
import { displayModelLabel } from '../lib/settingsTransform';
import { providerOverloadedButtons } from '../lib/turnErrorActions';
import { isSkippedFailedAssistant, isOrphanUser as isOrphanUserPure, lastVisibleTurnIdx } from '../lib/turnVisibility';
import { isThinkingActive } from '../lib/thinkingActive';
import { splitTurnSegments, liveSegmentIndex } from '../lib/turnSegments';
import { addonRowLabel, needsOwnTurn, queuedReasonKey } from '../lib/addons';
import { linkFigureSteps } from '../lib/figureSources';
import { MINDS_BILLING_URL } from '../../lib/mindsUrls';
import { billingActions, billingCopyKey, offersBilling } from '../lib/billingLinks';
import { useBudgetsUrl } from '../hooks/useBudgetsUrl';
import { useConsoleLink } from '../hooks/useConsoleLink';
import { useUpgradeOffer } from '../hooks/useUpgradeOffer';
import { cleanRequiredTier } from '../lib/subscriptionPlan';
import { trackBillingOpened, trackKeyProvisioningRefused } from '../lib/analytics';
import { useHubUsageContext } from '../lib/hubUsageContext';
import { budgetPeriodOf, budgetScopeOf, budgetModelName } from '../lib/budgetScope';
import { USAGE_ACTIONS, upgradeAction, usageActionUrl, formatResetTime, formatPercentShort, freeAllowanceState, isBalanceEmpty, allowanceStopCopy, freeServingPausedCopy, budgetExceededCopy } from '../lib/usageWarnings';
import { MINDSHUB_AIR_MODEL_ID } from '../lib/modelCatalog';
import { usageNoticeBuckets } from '../lib/usageNoticePlacement';
import { ChatScroller } from '../components/chat/ChatScroller';
import { useStickToBottom } from '../components/chat/useStickToBottom';
import { useDockInset } from '../components/chat/useDockInset';
import { ReportContentButton } from '../components/chat/ReportContentButton';
import { TurnActions } from '../components/chat/TurnActions';
import { NextSteps } from '../components/chat/NextSteps';
import { nextStepsFor, offersNextSteps, scheduledPromptFor } from '../lib/nextSteps';
import { UserTurn } from '../components/chat/UserTurn';
import i18n, { currentLocale, useTranslation } from '../../lib/i18n';
import { productName } from '../../lib/deploymentBrand';

// Chat-namespace text for helpers that run outside a component.
const tc = (key, vars) => i18n.t(key, { ns: 'chat', ...vars });

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

// ─── small shared atoms ──────────────────────────────────────────────────
function formatTime(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(currentLocale(), { hour: 'numeric', minute: '2-digit', hour12: true });
}

// Footer meta under an answer — "Jun 21, 7:39 AM". Date included because
// the meta is the only per-turn timestamp now that the eyebrow is gone.
function formatMetaTime(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const month = d.toLocaleString(currentLocale(), { month: 'short' });
  return tc('chatView.turn.metaDateTime', { month, day: d.getDate(), time: formatTime(d) });
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
  const { t } = useTranslation('chat');
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
                ? <>{t('chatView.connectIntro.clickToReopen')} <span aria-hidden className="text-accent">→</span></>
                : <>{t('chatView.connectIntro.fillOutForm')} <span aria-hidden className="text-accent">→</span></>}
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
                label={t('chatView.connectIntro.cancel')}
              />
            )}
            {onDisconnect && (
              <ConnectIntroPillButton
                kind="danger"
                onClick={onDisconnect}
                renderIcon={(s) => Ico.trash(s)}
                label={t('chatView.connectIntro.disconnect')}
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
  if (src === 'connector') return tc('chatView.attachment.connector');
  if (a.mime && String(a.mime).startsWith('image/')) return tc('chatView.attachment.image');
  return tc('chatView.attachment.file');
}

// The line under a message the person sent while Anton was working
// (ENG-4194): where it went, and while Anton has not read it, a way to move it
// to the queue instead.
function AddonNote({ label, onMoveToQueue }) {
  const { t } = useTranslation('chat');
  return (
    <div className="flex items-center justify-end gap-2 font-body text-[12px] leading-[1.4] text-ink-3" data-testid="addon-note">
      <span role="status" aria-live="polite" className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="text-ink-4">{Ico.arrowUpLeft(12)}</span>
        {label}
      </span>
      {onMoveToQueue && (
        <button
          type="button"
          onClick={onMoveToQueue}
          className="py-0.5 px-2 rounded-full bg-transparent border border-solid border-line text-ink-2 font-body text-[12px] cursor-pointer hover:bg-surface-2 hover:text-ink transition-[background,color] duration-hover ease-[ease]"
        >
          {t('chatView.addon.moveToQueue')}
        </button>
      )}
    </div>
  );
}

// A message added to the running task, inside the turn at the point it joined.
// `onMoveToQueue` is only passed for the live turn, and only offered on this
// client's own messages (`data.own`): another client's — shown since ENG-4208,
// say after a reload — is never taken into this client's queue.
function AddonRow({ step, agentLabel, onMoveToQueue }) {
  const { t } = useTranslation('chat');
  const data = step?.data || {};
  const { key, canMove } = addonRowLabel(data.state);
  const label = t(`chatView.addon.${key}`, { agent: agentLabel || 'Anton' });
  return (
    <div className={data.state === 'sending' || data.state === 'withdrawing' ? 'opacity-70 [transition:opacity_var(--dur-hover)_ease]' : undefined} data-testid="addon-row" data-addon-state={data.state}>
      <UserTurn
        content={data.text || ''}
        turnId={step.id}
        actions={(
          <AddonNote
            label={label}
            onMoveToQueue={canMove && onMoveToQueue && data.addon_id && data.own
              ? () => onMoveToQueue(data.addon_id, data.text || '', data.decided_by || null)
              : null}
          />
        )}
      />
    </div>
  );
}

// The user's side of a Cowork turn: the shared UserTurn bubble, plus the
// attachments and artifact-repair card only Cowork messages carry.
function CoworkUserTurn({ content: rawContent, attachments, onDelete, onEdit, isLast, projectName, projectId, conversationId, turnId, streaming = false, deleting = false, addonLabel = null, onOpenArtifact = null }) {
  // An "Address with agent" handoff is a machine prompt — ids, a base revision
  // and the raw thread JSON — so it renders as a card rather than as the wall of
  // identifiers it literally is. Null for every ordinary message.
  const { t } = useTranslation('chat');
  // A message from the artifact viewer's chat bar (ENG-4227) ends in
  // "(About the artifact `<slug>`.)" for the agent; the turn shows the user's
  // words and names the artifact as a pill under them instead.
  const aboutArtifact = parseQuickEditPrompt(rawContent);
  const content = aboutArtifact ? aboutArtifact.text : rawContent;
  const repair = parseArtifactRepairPrompt(content);
  const attachmentRows = attachments?.map((a) => {
    // Image attachments preview inline as a thumbnail (fetched as a
    // blob — the CSP blocks a direct loopback <img src>). Clicking
    // opens the full image in a browser tab on web and saves it on
    // desktop (openAuthenticatedResource). We can only build the
    // raw URL when the conversation is project-scoped; without it,
    // fall back to the icon+name chip.
    const isImage = a.mime && String(a.mime).startsWith('image/');
    const rawUrl = isImage ? attachmentRawUrl(projectName, conversationId, a.id) : null;
    if (rawUrl) {
      return (
        <AttachmentThumbnail
          key={a.id}
          url={rawUrl}
          alt={a.name || t('chatView.attachment.image')}
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
  });
  const artifactPill = aboutArtifact ? (
    <div className="user-turn-artifact-ref">
      <ArtifactRefPill slug={aboutArtifact.slug} onOpen={onOpenArtifact} />
    </div>
  ) : null;
  // An inline artifact's Submit (ENG-4684) also carries the page's state as
  // JSON for the agent: folded under the pill, not shown as a wall of it.
  const submittedState = aboutArtifact?.json != null ? (
    <div className="user-turn-artifact-state" data-testid="user-turn-artifact-state">
      <Collapsible variant="compact" title={t('chatView.turn.submittedData')}>
        <pre className="m-0 max-h-60 overflow-auto rounded-md bg-surface-2 p-2 font-mono text-xs text-ink-2">{aboutArtifact.json}</pre>
      </Collapsible>
    </div>
  ) : null;
  const actions = deleting ? (
    <span
      // Primary ink, not the usual meta grey: the turn around it is at
      // 60% opacity, which drags --ink-4 to roughly 1.7:1 against the page.
      className="font-[family-name:var(--font-body)] text-[13px] leading-[1.5] text-ink shrink-0 mt-1"
    >
      {t('chatView.turn.deleting')}
    </span>
  ) : (
    <TurnActions
      text={content || ''}
      copyLabel={t('chatView.turn.copyMessage')}
      onEdit={onEdit ? () => onEdit(content) : null}
      onDelete={onDelete}
      isLast={isLast}
      align="right"
    />
  );
  // A saved message that joined a running task but has no turn to sit in.
  const shownActions = addonLabel ? <><AddonNote label={addonLabel} />{actions}</> : actions;
  return (
    <UserTurn
      content={content}
      turnId={turnId}
      deleting={deleting}
      attachments={attachmentRows}
      footer={submittedState ? <>{artifactPill}{submittedState}</> : artifactPill}
      actions={shownActions}
    >
      {repair ? <ArtifactRepairCard repair={repair} projectId={projectId} streaming={streaming} /> : null}
    </UserTurn>
  );
}

// OrbitProvider `size` for the chat orb — WorkingIndicator's anchor
// box matches this so the morph centers on it exactly.
const CHAT_ORB_SIZE = 22;
// The width the chat needs to dock the right rail beside the conversation: a
// reading column of at least 640px, its 40px gutters, and the 320px rail.
const RAIL_DOCK_MIN_PX = 640 + 40 * 2 + 320;

// Why an answer stopped early, keyed by response.completed's incomplete_details.reason,
// or user_stopped when the turn ended on response.cancelled (someone pressed Stop).
// Values are chat-namespace keys, translated at render.
const INCOMPLETE_REASON_KEYS = {
  spend_ceiling: 'chatView.incomplete.spendCeiling',
  round_cap: 'chatView.incomplete.roundCap',
  handback_budget: 'chatView.incomplete.handbackBudget',
  handback_verifier_failure: 'chatView.incomplete.handbackVerifierFailure',
  handback_stuck: 'chatView.incomplete.handbackStuck',
  retry_exhausted: 'chatView.incomplete.retryExhausted',
  question_unanswered: 'chatView.incomplete.questionUnanswered',
  content_filter: 'chatView.incomplete.contentFilter',
  user_stopped: 'chatView.incomplete.userStopped',
};

// ─── Anton answer turn — content stack ────────────────────────────────────
// No eyebrow header: while in flight the ThinkingBlock / WorkingIndicator
// is the single indicator; once done, a hover-only footer (bottom-right)
// names the agent that answered and when.
function AnswerTurn({ state = 'done', time, children, showActions = true, copyText, onDelete, agentLabel, isLast, conversationId, messageId, deleting = false }) {
  const { t } = useTranslation('chat');
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
            <TurnActions text={copyText || ''} copyLabel={t('chatView.turn.copyResponse')} onDelete={onDelete} isLast={isLast}>
              <ReportContentButton conversationId={conversationId} messageId={messageId} />
            </TurnActions>
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

/** @typedef {import('../lib/figureSources').FigureSources} FigureSources */
/** @typedef {import('../lib/figureSources').LinkedFigureSource} LinkedFigureSource */

/**
 * Whether View file can read a figure source's project path in this chat.
 * The path is relative to the project the answer ran in, and the viewer reads
 * it from the chat's current project: with no project there is nothing to
 * read it from, and after Move to project the same path there names another
 * file. An answer saved before figure sources named their project (no
 * project_id) reads it from the current project.
 *
 * @param {FigureSources | null | undefined} figureSources
 * @param {string | null} projectId the chat's current project
 * @param {string | null} projectName
 */
function canReadFigurePaths(figureSources, projectId, projectName) {
  if (!projectName) return false;
  const ranIn = figureSources?.project_id ?? null;
  return ranIn == null || ranIn === projectId;
}

export function TextBlock({
  text,
  id,
  complete = true,
  conversationId = null,
  /* A finished answer's figure sources (lib/figureSources), the turn's steps
     they name, the opener for one of those steps by its id, and the opener
     for the file a source read, called with the source. */
  figureSources = null,
  steps = null,
  onOpenStep = null,
  onViewFile = null,
  // The chat's current project, which View file reads a project path from.
  projectId = null,
  projectName = null,
  // Settings > Appearance "Show where figures came from"; off renders no marks.
  showFigureSources = true,
}) {
  const figures = useMemo(() => {
    if (!showFigureSources) return null;
    const linked = linkFigureSteps(figureSources, steps);
    if (!linked) return null;
    /* A file this chat cannot read offers no View file: a project path
       outside the project it reads from, or an attachment with no route to
       read it by (attachmentRawUrl needs the project and the conversation). */
    const readsPaths = canReadFigurePaths(figureSources, projectId, projectName);
    const readable = (source) => ({
      ...source,
      path: readsPaths ? source.path : null,
      attachment_id: source.attachment_id && attachmentRawUrl(projectName, conversationId, source.attachment_id)
        ? source.attachment_id
        : null,
    });
    return linked.map((figure) => ({ ...figure, sources: figure.sources.map(readable) }));
  }, [showFigureSources, figureSources, steps, projectId, projectName, conversationId]);
  /* MarkdownContent is memoized, and callers pass fresh openers every render.
     Hand it openers that keep their identity and call the latest one at click
     time, so a settled answer skips re-rendering while another one streams. */
  const openStepRef = useRef(onOpenStep);
  const viewFileRef = useRef(onViewFile);
  useEffect(() => {
    openStepRef.current = onOpenStep;
    viewFileRef.current = onViewFile;
  });
  const hasOpenStep = !!onOpenStep;
  const hasViewFile = !!onViewFile;
  const openStep = useMemo(
    () => (hasOpenStep ? (stepId) => openStepRef.current?.(stepId) : null),
    [hasOpenStep],
  );
  const viewFile = useMemo(
    () => (hasViewFile ? (source) => viewFileRef.current?.(source) : null),
    [hasViewFile],
  );
  // Full markdown rendering — GFM tables, lists, code blocks (with
  // chartjs/chart and data-vault-form support), links, etc. via
  // react-markdown + our MarkdownContent override map.
  return (
    <MarkdownContent
      text={text}
      id={id}
      complete={complete}
      conversationId={conversationId}
      isAssistant
      figureSources={figures}
      onOpenFigureStep={openStep}
      onViewFigureFile={viewFile}
    />
  );
}

/**
 * The figure viewer's file. A project file is read by its path from the
 * chat's project. A file attached to the chat is read by its files-store id
 * through its attachment route, and shown as text when it is text; `filePath` is its
 * name then, for the header and the image check, as the Context card's
 * attachment viewer does.
 *
 * @param {LinkedFigureSource | null} source
 * @param {string | undefined} projectName
 * @param {string | undefined} projectPath
 * @param {string | null | undefined} conversationId
 */
function figureFileViewerProps(source, projectName, projectPath, conversationId) {
  if (!source?.path && source?.attachment_id) {
    const name = source.label || tc('chatView.figureFile.attachedFile');
    return {
      title: name,
      filePath: name,
      rawUrl: attachmentRawUrl(projectName, conversationId, source.attachment_id),
      showRawText: true,
    };
  }
  return { projectName, projectPath, filePath: source?.path || '' };
}

/**
 * The figure viewer's note. It shows the file as it is now, which a later
 * upload under the same name may have changed; the step shows what it read.
 *
 * @param {LinkedFigureSource | null} source
 */
function figureFileNote(source) {
  return source?.stepId
    ? tc('chatView.figureFile.noteWithStep')
    : tc('chatView.figureFile.note');
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
    title: data.title || step.label || tc('chatView.artifactCard.fallbackTitle'),
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
//
// `latestInline` and `messageIndex` fold an inline card a later one shows
// again (latestInlineArtifactByKey): one live frame per artifact.
function StepArtifacts({ steps, onOpen, onShare, projectPath, live = false, activeDocId = null, latestInline = null, messageIndex = null, onInlineSubmit = null }) {
  const artifacts = steps?.filter((s) => s.badge === 'Artifact') || [];
  if (artifacts.length === 0) return null;
  return (
    <div className="flex flex-col gap-3 mt-1">
      {artifacts.map((s) => {
        const card = artifactStepToCard(s, projectPath);
        // A doc opens beside the chat in the doc editor, not in the file viewer.
        if (isDocArtifact(card)) {
          return <DocCard key={s.id} artifact={card} onOpen={onOpen} live={live} active={!!activeDocId && card.id === activeDocId} />;
        }
        return (
          <ArtifactCard
            key={s.id}
            artifact={card}
            onOpen={onOpen}
            onShare={onShare}
            live={live}
            inlineSuperseded={isSupersededInline(latestInline, s.data, messageIndex, s.id)}
            onInlineSubmit={onInlineSubmit}
          />
        );
      })}
    </div>
  );
}

// An inline artifact a later card shows again (ENG-4684) renders as the plain
// artifact card: "This was updated. See the latest version below." scrolls to
// the live copy (the card marked with the same `data-inline-artifact` key),
// and "Preview this version" opens the page as this card made it.
export function scrollToLiveInlineArtifact(key) {
  if (!key || typeof document === 'undefined') return false;
  const live = [...document.querySelectorAll('[data-inline-artifact]')]
    .filter((el) => el.getAttribute('data-inline-artifact') === key);
  const target = live[live.length - 1];
  if (!target) return false;
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return true;
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

/** A message that finished live a moment ago (ENG-3554): its steps fold
 *  shut on screen. Past that, it renders folded like any older turn. */
const JUST_FINISHED_MS = 2000;
function justFinished(message) {
  return typeof message?._justFinishedAt === 'number' && Date.now() - message._justFinishedAt < JUST_FINISHED_MS;
}

/* With Only show the browser when I'm needed, an answered approval and a
   hand-over handed back or stopped follow the turn's Browser row. */
const followsBrowserRow = (step) => answeredBrowserStep(step) || finishedHandOverStep(step);

function TurnSegments({ steps, startedAt, endedAt = null, conversationId, conversationLive, reopenable = false, reply = null, onAnswered, onAnswerAsMessage, onActivateStep, live = null, idPrefix = '', collapseOnMount = false, agentLabel = null, onMoveAddonToQueue = null, imageSource = null }) {
  // Only show the browser when I'm needed (Settings): a turn's browser steps
  // are one row, labelled by the latest (lib/browserSteps.js).
  const { onlyWhenNeeded } = useBrowserPrefs();
  const segments = useMemo(
    () => splitTurnSegments(onlyWhenNeeded ? groupBrowserSteps(steps, { follows: followsBrowserRow }) : steps, { startedAt, endedAt, conversationLive, reopenable, reply }),
    [steps, startedAt, endedAt, conversationLive, reopenable, reply, onlyWhenNeeded],
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
    if (seg.kind === 'image') {
      out.push(
        // A picture generate_image wrote, where it was made (ENG-4024). Same
        // spacing as a tool's message: it is not part of a block.
        <div key={seg.key} style={{ marginTop: prevWasCard ? 12 : 4 }}>
          <GeneratedImageCard
            image={seg.step.data || {}}
            projectName={imageSource?.projectName ?? null}
            projectPath={imageSource?.projectPath || ''}
            onOpen={imageSource?.onOpen ?? null}
          />
        </div>,
      );
      prevWasCard = true;
      return;
    }
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
    if (seg.kind === 'addon') {
      out.push(
        <div key={seg.key} style={{ marginTop: prevWasCard ? 12 : 8, marginBottom: 4 }}>
          <AddonRow step={seg.step} agentLabel={agentLabel} onMoveToQueue={live ? onMoveAddonToQueue : null} />
        </div>,
      );
      prevWasCard = true;
      return;
    }
    if (seg.kind === 'question') {
      out.push(
        // Spacing: 4px under a block, 12px between consecutive cards.
        <div key={seg.key} style={{ marginTop: prevWasCard ? 12 : 4 }}>
          {isHandOverCard(seg.step.data) ? (
            <HandOverCard
              step={seg.step}
              conversationId={conversationId}
              onAnswered={onAnswered}
              ended={Boolean(seg.step.data?.answer) || seg.expired}
            />
          ) : (
          <AskUserCard
            step={seg.step}
            conversationId={conversationId}
            expired={seg.expired}
            reopened={seg.reopened}
            lateAnswer={seg.lateAnswer}
            onAnswered={onAnswered}
            onAnswerAsMessage={onAnswerAsMessage}
          />
          )}
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
          currentLabel={pendingQuestion ? pendingQuestion.label : ((active && stepDisplayLabel(active)) || live.placeholderLabel || null)}
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
        endedAt={seg.endedAt}
        isActive={false}
        onActivateStep={onActivateStep}
        // Only the last block was open on screen while the turn ran.
        collapseOnMount={collapseOnMount && idx === segments.length - 1}
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

// Renders any badge='Connector' steps as inline connector template cards: a
// template a cloud turn built, which the member saves from the card.
function StepConnectorDrafts({ steps, onConnect }) {
  const drafts = steps?.filter((s) => s.badge === 'Connector') || [];
  if (drafts.length === 0) return null;
  return (
    <div className="flex flex-col gap-3 mt-1">
      {drafts.map((s) => (
        <ConnectorDraftCard key={s.id} connector={s.data || {}} onConnect={onConnect} />
      ))}
    </div>
  );
}

export function ArtifactCard({ artifact, onOpen, onShare = null, live = false, inlineSuperseded = false, onInlineSubmit = null }) {
  // This card is an artifact surface like the panel's rows, so it answers to the
  // same deployment gate. Without it the chat offered a local preview, Export
  // and Show in Finder for content an org deployment does not serve, while the
  // panel had already stopped offering them for the very same artifact.
  const { t } = useTranslation('chat');
  const orgMode = useOrgMode();
  const liveApps = useLiveApps();
  // Same question the artifacts panel answers by simply not listing the row:
  // is this artifact still there? The card outlives the artifact because it is
  // rendered from the turn's persisted stream events, which no delete rewrites.
  const deleted = useArtifactLiveness(artifact, { live });
  // A chat card carries no capabilities (only the artifacts list adds them),
  // so the listed card for the same artifact says whether the person may edit it.
  const listedCard = useArtifactCardBySlug(artifact.capabilities ? '' : artifact.slug);
  const capabilities = artifact.capabilities || listedCard?.capabilities || null;
  // What opens in the viewer carries them too, as an artifact from the list
  // does: a preview that loads no workspace to say (a PDF, Word, Excel or
  // PowerPoint file) shows Share and its chat bar by them (ENG-4687).
  const forViewer = capabilities && !artifact.capabilities ? { ...artifact, capabilities } : artifact;
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
  const revealLabel = platform === 'darwin' ? t('chatView.artifactCard.showInFinder') : t('chatView.artifactCard.showInFolder');

  // `note` reads like `ok` but stays as long as an error, since it is a sentence.
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
   * Electron bridge, or on web to a download. In org mode the same question is
   * answered from the authenticated draft URL instead, which rules images and
   * fullstack apps out. The document types (.xlsx, .docx, .pptx, .pdf) join
   * both answers wherever the shared document gate allows them.
   */
  const isImage = isImageArtifact(artifact);
  const canPreviewDoc = canPreviewDocument(artifact, host);
  const canPreviewInline = canPreviewLocally(artifact) || canPreviewDoc;
  const canPreviewDraft = canPreviewOrgDraft(artifact) || canPreviewDoc;
  // Thumbnail bytes for the icon slot — same CSP workaround AttachmentThumbnail
  // uses (loopback <img src> is blocked; fetch + blob: URL is not). '' when not
  // an image, or before the artifact card carries a serveUrl (org mode, or the
  // live-turn card streamed in ahead of ChatView.jsx's serveUrl passthrough).
  const { src: thumbSrc } = useBlobImageSrc({ url: isImage ? (artifactServeUrl(artifact) || null) : null });
  // A widget (ENG-4684) collects input in the chat and is not a deliverable:
  // no Share, and no shared page to open (a stray published URL included).
  const widget = isWidgetArtifact(artifact);
  const published = !!artifact.publishedUrl && !widget;
  const hasBridge = host.isElectron || !host.isWeb;
  const canDownload = canDownloadArtifact(artifact);
  const openTarget = artifactOpenTarget({
    orgMode,
    published,
    canPreviewInline,
    canPreviewDraft,
    hasBridge,
    hasDraft: canDownloadOrgDraft(artifact),
    canDownload,
  });
  /*
   * Org-mode destinations, a download and a document preview are addressed by
   * the server card, through the draft, serve or shared URL, so a path this
   * client could not canonicalize does not disable them. The local preview and
   * the desktop OS handoff still need the local path.
   *
   * `deleted` stays in both branches. It is the one term of `canAct` that says
   * nothing about addressing: a deleted artifact has a perfectly good draft URL
   * and still cannot be opened, so dropping it here would leave a tombstoned
   * card looking live and hand the whole guard to handleOpen alone.
   */
  const needsLocalPath = !orgMode && openTarget !== 'download' && !canPreviewDoc;
  const canActivate = !!openTarget && (needsLocalPath ? canAct : !deleted);
  const activateLabel = openTarget === 'published'
    ? t('chatView.artifactCard.openShared')
    : openTarget === 'download'
      ? t('chatView.artifactCard.download')
      : openTarget === 'os' ? t('chatView.artifactCard.open') : t('chatView.artifactCard.openPreview');
  /*
   * What the card says when it has nowhere to go. Neither org mode nor web has
   * a local file to blame, and blaming one is actively wrong there: the card
   * prints its own server path two lines down. Desktop keeps the path reason it
   * can act on.
   */
  const noDestinationReason = !openTarget
    ? (orgMode
      ? t('chatView.artifactCard.noPreviewNoLink')
      : t('chatView.artifactCard.noDownloadableFile'))
    : (disabledReason || t('chatView.artifactCard.noFilePath'));
  /*
   * The shared URL stays reachable beside the preview: it is the address a
   * collaborator gets, and the chat turn is where the artifact was just made.
   *
   * Awaited so a rejected bridge call is caught rather than left unhandled.
   * No raw window.open fallback: host.openExternal is what restricts the
   * agent-writable URL to http(s)/mailto.
   */
  const handleOpenPublished = async () => {
    try { await host.openExternal(artifact.publishedUrl); } catch {}
  };
  const handleOpen = async () => {
    /*
     * The branches that need no local file return before the `canAct` check, so
     * they would survive a deletion. Their buttons are not rendered in that
     * state, but relying on two conditions in different parts of the file
     * agreeing is not worth the risk.
     */
    if (deleted) {
      showStatus('error', t('chatView.artifactCard.deletedStatus'));
      return;
    }
    if (openTarget === 'preview' && onOpen) {
      /*
       * The viewer reads the draft URL in org mode and the local bytes on
       * desktop, so it opens on either without a canonical path of its own.
       */
      // A live inline page hands over where the user is in it (its tab or
      // slide, scroll, hash), for the viewer to open on the same place.
      const view = liveInline ? liveInlineViewRef.current : null;
      if (view) onOpen(forViewer, { view });
      else onOpen(forViewer);
      return;
    }
    if (openTarget === 'published') {
      await handleOpenPublished();
      return;
    }
    if (openTarget === 'download') {
      /*
       * Nothing here can render the file and nothing shared it: the draft or
       * serve URL still streams it, so the click saves it instead of
       * dead-ending, and says why once the save went through.
       */
      await downloadFile('note', noPreviewDownloadedNote());
      return;
    }
    if (openTarget === null) {
      showStatus('error', noDestinationReason);
      return;
    }
    await openInDefaultApp();
  };
  const openInDefaultApp = async () => {
    if (!canAct) {
      showStatus('error', disabledReason || t('chatView.artifactCard.noPathAvailable'));
      return;
    }
    try {
      const result = await host.openPath(path);
      if (result && result.ok === false) throw new Error(result.reason || t('chatView.artifactCard.couldNotOpen'));
      showStatus('ok', t('chatView.artifactCard.opened'));
    }
    catch (e) {
      // eslint-disable-next-line no-console
      diagnostic("renderer.cowork.views.ChatView", "ERROR", "artifact_open_failed", '[artifact-open] failed', e);
      showStatus('error', e?.message || t('chatView.artifactCard.couldNotOpen'));
      revalidateAfterFailure();
    }
  };
  const handleReveal = async () => {
    if (!canAct) {
      showStatus('error', disabledReason || t('chatView.artifactCard.noPathAvailable'));
      return;
    }
    let bridgeError = null;
    try {
      const result = await host.showItemInFolder(path);
      if (result?.ok) {
        showStatus('ok', platform === 'darwin' ? t('chatView.artifactCard.shownInFinder') : t('chatView.artifactCard.shownInFolder'));
        return;
      }
      bridgeError = result?.reason || t('chatView.artifactCard.couldNotShow');
    } catch (e) {
      bridgeError = e;
    }

    try {
      await revealArtifact(path);
      showStatus('ok', platform === 'darwin' ? t('chatView.artifactCard.shownInFinder') : t('chatView.artifactCard.shownInFolder'));
    } catch (e) {
      // eslint-disable-next-line no-console
      diagnostic("renderer.cowork.views.ChatView", "ERROR", "artifact_reveal_failed", '[artifact-reveal] failed', e || bridgeError);
      showStatus('error', e?.message || bridgeError?.message || bridgeError || t('chatView.artifactCard.couldNotShow'));
      revalidateAfterFailure();
    }
  };
  /*
   * `canAct` is a desktop notion: a canonical local path. A download is
   * addressed by the draft or serve URL and only names the saved file after
   * the path, so gating on it would refuse the one action that works. `deleted`
   * still applies.
   */
  const downloadFile = async (doneKind, doneText) => {
    if (deleted) {
      showStatus('error', t('chatView.artifactCard.deletedStatus'));
      return;
    }
    if (!(await downloadArtifactFile(artifact, { actionPath: path, entry: 'chat' }))) {
      showStatus('error', downloadUnavailableMessage(t('chatView.artifactCard.noDownloadableFile')));
      return;
    }
    showStatus(doneKind, doneText);
  };
  const handleDownload = () => downloadFile('ok', t('chatView.artifactCard.downloading'));
  /*
   * One primary action button instead of an Open/Show-in-Finder pair: what it
   * does follows what the artifact actually supports — Preview for anything the
   * in-app modal can render, otherwise Download (web, streams the file) or
   * Show in Finder/Explorer (desktop, opens the containing FOLDER, not the
   * file) — never both, and never a generic "Open" that hides which of the
   * two it's about to do. Org mode reads the same rule off the draft URL, and
   * an artifact it cannot render keeps the shared page as its one destination.
   * A Download that stands in for a preview runs the click itself, so it says
   * why it downloaded once the save went through.
   */
  const primaryAction = orgMode
    ? (openTarget === 'preview'
      ? { label: t('chatView.artifactCard.preview'), onClick: handleOpen, tooltip: t('chatView.artifactCard.previewInProduct', { product: productName('Cowork') }) }
      : openTarget === 'published'
        ? { label: t('chatView.artifactCard.open'), onClick: handleOpen, tooltip: t('chatView.artifactCard.openSharedTooltip') }
        : openTarget === 'download'
          ? { label: t('chatView.artifactCard.download'), onClick: handleOpen, tooltip: t('chatView.artifactCard.saveFileTooltip') }
          : null)
    : openTarget === 'preview'
      ? { label: t('chatView.artifactCard.preview'), onClick: handleOpen, tooltip: canAct ? t('chatView.artifactCard.previewPath', { path }) : '' }
      : openTarget === 'download'
        ? { label: t('chatView.artifactCard.download'), onClick: handleOpen, tooltip: canAct ? t('chatView.artifactCard.downloadPath', { path }) : '' }
        // handleReveal already falls back from the Electron bridge to the
        // server-side reveal endpoint and surfaces its own error, so this
        // doesn't gate further on bridge availability the way the old
        // Open button didn't either.
        : openTarget === 'os'
          ? { label: revealLabel, onClick: handleReveal, tooltip: canAct ? t('chatView.artifactCard.actionTarget', { action: revealLabel, target: path }) : '' }
          : null;
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
   *
   * A document preview keeps the file one click away beside it: Download on
   * web, and on desktop Open, which hands the file to the default app.
   */
  // "Shared link" only once the link reaches someone besides the owner
  // (artifactShareState, the Share button's own rule); before that it is
  // just the artifact's link.
  const linkShared = artifactShareState(artifact).shared === true;
  const sharedLinkAction = !deleted && showSharedLink
    ? linkShared
      ? { label: t('chatView.artifactCard.sharedLink'), onClick: handleOpenPublished, tooltip: t('chatView.artifactCard.sharedLinkTooltip') }
      : { label: t('chatView.artifactCard.openLink'), onClick: handleOpenPublished, tooltip: t('chatView.artifactCard.openLinkTooltip') }
    : null;
  const downloadAction = !deleted && openTarget !== 'download'
    && (orgMode ? canDownloadOrgDraft(artifact) : (!hasBridge && canPreviewDoc && canDownload))
    ? { label: t('chatView.artifactCard.download'), onClick: handleDownload, tooltip: t('chatView.artifactCard.saveFileTooltip') }
    : null;
  const openInAppAction = !deleted && !orgMode && hasBridge && canPreviewDoc && openTarget === 'preview'
    ? { label: t('chatView.artifactCard.open'), onClick: openInDefaultApp, tooltip: t('chatView.artifactCard.openInDefaultApp') }
    : null;
  const secondaryAction = sharedLinkAction || downloadAction || openInAppAction;
  /*
   * Share offers the viewer's own Share panel, so it follows the viewer's rule
   * for showing it: a page or document the person may edit, and not a full-stack
   * live app without a page (those share through "Share with…"). Where nothing
   * says whether they may edit it yet (an artifact the list hasn't loaded), the
   * card offers Share and the viewer decides: it opens without the panel for
   * someone who can't manage it. On Desktop the panel needs the local file,
   * which the viewer would show disabled without.
   */
  const shareAction = onShare && !deleted
    && !widget
    && isPublishableArtifact(artifact)
    && !(liveApps && BACKEND_ARTIFACT_TYPES.has(artifact.type) && !published)
    && capabilities?.canEdit !== false
    && (orgMode || canAct)
    ? { label: t('chatView.artifactCard.share'), onClick: () => onShare(forViewer), tooltip: t('chatView.artifactCard.shareTooltip') }
    : null;
  /*
   * An artifact the agent marked to show inline (ENG-4684) shows its live page
   * in the card body, under the same head and actions: Preview still opens it
   * full size in the viewer. Only where this card would preview that page
   * anyway: an HTML page, not a fullstack app (it needs the viewer's proxy),
   * that this deployment can render and that is still there.
   */
  const showInline = isInlineArtifact(artifact)
    && isHtmlArtifact(artifact)
    && !isBackendArtifact(artifact)
    && !canPreviewDoc
    && openTarget === 'preview'
    && canActivate;
  /*
   * A later card shows this artifact live (latestInlineArtifactByKey), so
   * this one is the plain card: no frame until "Preview this version" opens
   * the page as this card made it (its `revisionId`, the revision its turn
   * captured). A card with no revision (one stored before cards carried it,
   * or a turn whose capture failed) offers no "Preview this version": the
   * page as it is now is the live copy below, and showing it here under that
   * label would claim it is this reply's version. It keeps the ordinary
   * Preview, which opens the viewer and its history.
   */
  const superseded = showInline && inlineSuperseded;
  const liveInline = showInline && !superseded;
  const versionRevisionId = superseded ? cardRevisionId(artifact) : '';
  const [versionOpen, setVersionOpen] = useState(false);
  const framed = liveInline || (!!versionRevisionId && versionOpen);
  // The live frame's latest view report (usePreviewView), read by handleOpen.
  const liveInlineViewRef = useRef(null);
  const primaryDisabled = needsLocalPath && !canAct;
  const primaryReason = primaryDisabled ? (disabledReason || t('chatView.artifactCard.noFilePath')) : '';
  // A live inline card is already the page: no Preview button (the title
  // still opens it full size); Share stays.
  const openAction = liveInline
    ? null
    : versionRevisionId
    ? {
      label: versionOpen ? t('chatView.artifactCard.hideVersionPreview') : t('chatView.artifactCard.previewThisVersion'),
      onClick: () => setVersionOpen((v) => !v),
    }
    : !deleted && primaryAction
      ? { ...primaryAction, disabled: primaryDisabled, tooltip: primaryDisabled ? undefined : primaryAction.tooltip }
      : null;
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
    {/* Inline, the card is a group, not a button: a live page cannot sit
        inside a role="button" (its content would leave the accessibility
        tree), and its clicks belong to the page. The title and Preview still
        open the viewer. */}
    <Card
      as="div"
      interactive={canActivate && !framed}
      flat
      padding="none"
      onActivate={canActivate && !framed ? handleOpen : undefined}
      role={framed ? 'group' : undefined}
      aria-label={deleted
        ? t('chatView.artifactCard.deletedAriaLabel', { title: artifact.title })
        : framed
          ? artifact.title
          : (canActivate ? t('chatView.artifactCard.actionTarget', { action: activateLabel, target: artifact.title }) : noDestinationReason)}
      className={cn('railed chat-artifact-card', framed && 'is-inline')}
      data-inline-artifact={liveInline ? inlineArtifactKey(artifact) || undefined : undefined}
      data-testid={superseded ? 'artifact-inline-superseded' : undefined}
    >
      <div
        className={cn(
          'chat-artifact-card__tile grid size-8 shrink-0 place-items-center overflow-hidden rounded-lg bg-accent-bg text-accent',
          deleted && 'opacity-70',
        )}
      >
        {thumbSrc ? (
          <img src={thumbSrc} alt={artifact.title || t('chatView.artifactCard.thumbnailAlt')} className="block size-full object-cover" />
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
          title={deleted ? t('chatView.artifactCard.deletedTitle') : (canActivate ? t('chatView.artifactCard.actionTarget', { action: activateLabel, target: artifact.title }) : noDestinationReason)}
          className="m-0 block min-w-0 cursor-pointer truncate border-0 bg-transparent p-0 text-left font-body text-base font-semibold text-ink underline-offset-[3px] enabled:hover:underline disabled:cursor-not-allowed disabled:opacity-70"
        >{artifact.title}</button>
        <span className="flex min-w-0 items-center gap-1.5 font-body text-xs text-ink-3">
          {superseded ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); scrollToLiveInlineArtifact(inlineArtifactKey(artifact)); }}
              title={t('chatView.artifactCard.goToLatestTooltip')}
              className="m-0 min-w-0 cursor-pointer truncate border-0 bg-transparent p-0 text-left font-body text-xs text-ink-3 underline-offset-[3px] hover:underline"
            >{t('chatView.artifactCard.updatedSeeBelow')}</button>
          ) : (
            <span className="shrink-0">{artifact.kind && artifact.kind !== 'live artifact' ? artifact.kind : t('chatView.artifactCard.liveArtifact')}</span>
          )}
          {deleted && <Badge variant="muted" size="xs">{t('chatView.artifactCard.deletedBadge')}</Badge>}
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
        {shareAction ? (
          /* Preview stays the filled action, with Share a full outlined
             button after it: ActionBar would put its secondary before the
             primary, in the quiet style. */
          <div className="flex min-w-0 flex-wrap items-center justify-start gap-1.5">
            {openAction && (
              <Tooltip content={openAction.tooltip} side="top">
                <Button size="sm" variant="primary" disabled={openAction.disabled} onClick={openAction.onClick}>
                  {openAction.label}
                </Button>
              </Tooltip>
            )}
            <Tooltip content={shareAction.tooltip} side="top">
              <Button size="sm" variant="default" onClick={shareAction.onClick}>{shareAction.label}</Button>
            </Tooltip>
          </div>
        ) : (
          <ActionBar size="sm" align="start" className="flex-wrap" primary={openAction} />
        )}
      </div>
      {framed && (
        <div className="chat-artifact-card__frame">
          <ArtifactInlinePreview
            artifact={artifact}
            title={artifact.title || ''}
            revisionId={versionRevisionId || undefined}
            onSubmit={onInlineSubmit ? (submission) => onInlineSubmit(artifact, submission) : null}
            onView={liveInline ? (view) => { liveInlineViewRef.current = view; } : null}
          />
        </div>
      )}
      {/* The footer is the artifact's location bar: the path at rest, and the
          result of an action for the moment it is on screen. One or the
          other, so a long message never crushes the path beside it. */}
      {status ? (
        <span
          className={cn('card__rail chat-artifact-card__status text-xs', status.kind === 'error' ? 'text-danger' : 'text-accent')}
        >
          {status.text}
        </span>
      ) : (
        <span className="card__rail chat-artifact-card__loc text-xs text-ink-3" title={previewText}>
          {Ico.folder(12)}
          <span className="min-w-0 truncate">{previewText}</span>
        </span>
      )}
      {secondaryAction && (
        <div
          className="card__rail chat-artifact-card__tools"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation(); }}
        >
          <ActionBar
            size="xs"
            secondary={secondaryAction}
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
// Beside a lost connection's error while the app tries to reach the turn
// again; the error goes away once it does.
function Reconnecting() {
  const { t } = useTranslation('chat');
  return (
    <span className="chat-reconnecting" role="status">
      {t('chatView.reconnecting')}<span className="chat-reconnecting__dots" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span>
    </span>
  );
}

function ActionCard({ time, agentLabel, kind, title, body, buttons = [], deleting = false }) {
  return (
    <AnswerTurn state="done" time={time} showActions={false} agentLabel={agentLabel} deleting={deleting}>
      <ChatCardShell className="max-w-[560px]" kind={kind} title={title} actions={cardActions(buttons)}>
        {body}
      </ChatCardShell>
    </AnswerTurn>
  );
}

function ProviderLimitCard({ time, agentLabel, deleting }) {
  const { t } = useTranslation('chat');
  return (
    <ActionCard
      deleting={deleting}
      time={time}
      agentLabel={agentLabel}
      kind={t('chatView.kinds.provider')}
      title={t('chatView.cards.taskStopped')}
      body={t('chatView.cards.providerLimitBody')}
    />
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

export function AllowanceExhaustedCard({
  time, agentLabel, resetAt, usage, isBillingOwner, deleting = false,
}) {
  const { t } = useTranslation('chat');
  const consoleLink = useConsoleLink();
  /* ENG-4186: on a Free plan the highest-intent moment offers Plus first.
     No plan (gate off, older server) or no right to buy: no button, and the
     card reads exactly as before. */
  const upgrade = useUpgradeOffer();
  const getPlus = upgrade.plan?.tier === 'free' && upgrade.canOffer('plus');
  if (!PLATFORM_UI) return <ProviderLimitCard time={time} agentLabel={agentLabel} deleting={deleting} />;
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
      kind={t(offersBilling() ? 'chatView.kinds.billing' : 'chatView.kinds.usage')}
      title={t('chatView.cards.taskStopped')}
      body={allowanceStopCopy({ resetAt, usage })}
      buttons={billingActions([
        ...(getPlus ? [{
          label: upgradeAction('plus').label,
          onClick: () => upgrade.open('plus', 'allowance_card'),
          primary: true,
        }] : []),
        {
          label: t('chatView.cards.addFunds'),
          // The click, not an impression — same rule as
          // the drained-wallet card. token_cap_hit already
          // counts this impression once per receipt in the stream
          // adapter, so every route to billing is counted exactly
          // once and this one is not the exception.
          onClick: () => {
            trackBillingOpened('included_allowance_exhausted');
            host.openExternal(consoleLink(usageActionUrl(USAGE_ACTIONS.addFunds, { isBillingOwner })));
          },
          primary: !getPlus,
        },
        // Only offer auto top up when it isn't already on.
        ...(usage?.autoTopUp?.enabled ? [] : [{
          label: USAGE_ACTIONS.setUpAutoTopUp.label,
          onClick: () => {
            trackBillingOpened('included_allowance_exhausted');
            host.openExternal(consoleLink(usageActionUrl(USAGE_ACTIONS.setUpAutoTopUp, { isBillingOwner })));
          },
        }]),
      ])}
    />
  );
}

/*
 * A Plus or Pro window is used up (`window_allowance_exhausted`, ENG-4186):
 * the model is one the plan covers, one of its two rolling windows (5 hours
 * or 7 days) is spent, and the wallet cannot carry the task past it. The gate
 * sends when that window frees up (`resetAt`) and which window it was. The
 * card says the task is paused until then, and offers the two ways to keep
 * going now: funds, and on Plus, Pro. Never a dollar or token figure.
 */
export function WindowAllowanceExhaustedCard({
  time, agentLabel, resetAt, allowanceWindow, isBillingOwner, deleting = false,
}) {
  const { t } = useTranslation('chat');
  const upgrade = useUpgradeOffer();
  const consoleLink = useConsoleLink();
  if (!PLATFORM_UI) return <ProviderLimitCard time={time} agentLabel={agentLabel} deleting={deleting} />;
  const until = formatResetTime(resetAt);
  const windowKey = allowanceWindow === '7d' || allowanceWindow === '5h' ? allowanceWindow : 'other';
  // The mobile copy names the window and when it frees up, and nothing about the balance.
  const body = until
    ? t(billingCopyKey('chatView.cards.windowPausedUntil'), { window: windowKey, time: until })
    : t(billingCopyKey('chatView.cards.windowPaused'), { window: windowKey });
  const offerPro = upgrade.plan?.tier === 'plus' && upgrade.canOffer('pro');
  return (
    <ActionCard
      deleting={deleting}
      time={time}
      agentLabel={agentLabel}
      kind={t(offersBilling() ? 'chatView.kinds.billing' : 'chatView.kinds.usage')}
      title={t('chatView.cards.windowUsedUpTitle')}
      body={body}
      buttons={billingActions([
        {
          label: t('chatView.cards.addFunds'),
          // The click only; token_cap_hit counted the impression on receipt.
          onClick: () => {
            trackBillingOpened('window_allowance_exhausted');
            host.openExternal(consoleLink(usageActionUrl(USAGE_ACTIONS.addFunds, { isBillingOwner })));
          },
          primary: true,
        },
        ...(offerPro ? [{
          label: upgradeAction('pro').label,
          onClick: () => upgrade.open('pro', 'window_card'),
        }] : []),
      ])}
    />
  );
}

/* "Switch to MindsHub Air": resend the failed message on Air. One action for
   every card that offers it, and nothing when the caller has no switch to give
   (Air locked, no message to resend, or the task is already on Air). */
function switchToAirButtons(onSwitchToAir) {
  return onSwitchToAir ? [{ label: tc('chatView.cards.switchToAir'), onClick: onSwitchToAir }] : [];
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
  const { t } = useTranslation('chat');
  const consoleLink = useConsoleLink();
  if (!PLATFORM_UI) return <ProviderLimitCard time={time} agentLabel={agentLabel} deleting={deleting} />;
  const free = freeAllowanceState(usage);
  if (!offersBilling()) {
    return <ActionCard time={time} agentLabel={agentLabel} deleting={deleting}
      kind={t('chatView.kinds.usage')} title={t('chatView.cards.taskStopped')}
      body={free.status === 'spent' ? allowanceStopCopy({ usage }) : t('chatView.cards.providerLimitBody')}
      buttons={free.status === 'has_room' ? switchToAirButtons(onSwitchToAir) : []} />;
  }
  const walletPaysNow = !!usage?.balance && !isBalanceEmpty(usage.balance);
  const refill = formatResetTime(free.resetsAt);
  const addFunds = {
    label: t('chatView.cards.addFunds'),
    // The click, not an impression. token_cap_hit
    // already counts the impression once per receipt in the
    // stream adapter; an impression here would re-fire on
    // every paint.
    onClick: () => {
      trackBillingOpened('token_limit');
      host.openExternal(consoleLink(usageActionUrl(USAGE_ACTIONS.addFunds, { isBillingOwner })));
    },
    primary: true,
  };
  // Fixed copy, not the server string: the
  // gateway's wording predates pay as you go.
  let body = t(billingCopyKey('chatView.cards.balanceRanOut'));
  let buttons = billingActions([addFunds]);
  if (!walletPaysNow && free.status === 'has_room' && onSwitchToAir) {
    body = t('chatView.cards.balanceEmptyAirLeft');
    buttons = [...billingActions([addFunds]), ...switchToAirButtons(onSwitchToAir)];
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
      kind={t('chatView.kinds.billing')}
      title={t('chatView.cards.taskStopped')}
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
  const { t } = useTranslation('chat');
  const consoleLink = useConsoleLink();
  if (!PLATFORM_UI) {
    return (
      <ActionCard
        deleting={deleting}
        time={time}
        agentLabel={agentLabel}
        kind={t('chatView.kinds.provider')}
        title={t('chatView.cards.providerUnavailableTitle')}
        body={t('chatView.cards.providerPausedBody')}
      />
    );
  }
  /* The sentence lives in lib/usageWarnings because the Settings probe notice
     says the same thing about the same fuse. */
  return (
    <ActionCard
      deleting={deleting}
      time={time}
      agentLabel={agentLabel}
      kind={t('chatView.kinds.usage')}
      title={t('chatView.cards.freeAirPausedTitle')}
      body={freeServingPausedCopy(resetAt)}
      buttons={billingActions([
        {
          label: t('chatView.cards.addFunds'),
          /* The click only, like the other stopped-task cards. Its own
             trigger: a fleet-wide pause is not this user running out. */
          onClick: () => {
            trackBillingOpened('free_serving_paused');
            host.openExternal(consoleLink(usageActionUrl(USAGE_ACTIONS.addFunds, { isBillingOwner })));
          },
          primary: true,
        },
      ])}
    />
  );
}

/*
 * A spending budget is used up (`budget_exceeded`): the gateway's 402
 * on a hard-capped budget, with no reset time. Credits do not lift it, so the
 * card never asks for funds; it links to Budgets, where an administrator
 * raises it. Air may still run on its free allowance, so the switch is offered
 * while the hub read shows room, as on the balance card.
 */
export function BudgetExceededCard({
  time, agentLabel, usage, onSwitchToAir, budgetScope = null, budgetPeriod = null, budgetModelLabel = null,
  deleting = false,
}) {
  const { t } = useTranslation('chat');
  const budgetsUrl = useBudgetsUrl({ fromDenial: true });
  if (!offersBilling()) {
    return <ActionCard time={time} agentLabel={agentLabel} deleting={deleting}
      kind={t('chatView.kinds.usage')} title={t('chatView.cards.taskStopped')}
      body={t('chatView.cards.providerLimitBody')}
      buttons={freeAllowanceState(usage).status === 'has_room' ? switchToAirButtons(onSwitchToAir) : []} />;
  }
  if (!PLATFORM_UI) {
    return (
      <ActionCard
        deleting={deleting}
        time={time}
        agentLabel={agentLabel}
        kind={t('chatView.kinds.provider')}
        title={t('chatView.cards.taskStopped')}
        body={t('chatView.cards.adminSpendingLimitBody')}
      />
    );
  }
  const airHasRoom = freeAllowanceState(usage).status === 'has_room';
  return (
    <ActionCard
      deleting={deleting}
      time={time}
      agentLabel={agentLabel}
      kind={t('chatView.kinds.billing')}
      title={t('chatView.cards.budgetUsedUpTitle', { scope: budgetScopeOf(budgetScope), period: budgetPeriodOf(budgetPeriod) })}
      body={budgetExceededCopy({ usage, budgetScope, budgetModelLabel })}
      buttons={[
        ...billingActions([{
          label: t('chatView.cards.viewBudgets'),
          // The click only, like the other stopped-task cards.
          onClick: () => {
            trackBillingOpened('budget_exceeded');
            host.openExternal(budgetsUrl);
          },
          primary: true,
        }]),
        ...(airHasRoom ? switchToAirButtons(onSwitchToAir) : []),
      ]}
    />
  );
}

/* No provider connected (`provider_required`). HomeView renders the same card
   on the home screen and its first sentence must read the same. */
export function ConnectProviderCard({ time, onOpenSettings, deleting = false }) {
  const { t } = useTranslation('chat');
  const consoleLink = useConsoleLink();
  return (
    <ActionCard
      deleting={deleting}
      time={time}
      kind={t('chatView.kinds.connection')}
      title={PLATFORM_UI ? t('chatView.cards.connectProviderTitle') : t('chatView.cards.providerSetupRequiredTitle')}
      body={PLATFORM_UI
        ? t(billingCopyKey('chatView.cards.connectProviderBody'))
        : t('chatView.cards.providerSetupRequiredBody')}
      buttons={PLATFORM_UI ? [
        ...billingActions([{
          label: t('chatView.cards.startForFree'),
          // The click only. Whether this card deserves an
          // impression event of its own is an open
          // question, and is not settled here.
          onClick: () => {
            trackBillingOpened('connect_provider');
            host.openExternal(consoleLink(MINDS_BILLING_URL));
          },
          primary: true,
        }]),
        { label: t('chatView.cards.openSettings'), onClick: () => onOpenSettings?.('agent'), primary: false },
      ] : []}
    />
  );
}

// ── UsageAlertCard: a usage-state change that happened DURING this task ────
// ENG-1782. Not an error: the turn kept going. The composer bar carries the
// live state for the *next* task; this marks the turn where *this* one's
// allowance changed, and still reads true after the bar moves on or is closed.
// It keeps its own link: most people who reach billing from a chat notice never
// click the bar.
function UsageAlertCard({
  time, agentLabel, kind, resetsAt, fractionLeft, isBillingOwner,
  allowanceWindow = null, percentUsed = null, onWallet = false,
}) {
  const { t } = useTranslation('chat');
  const consoleLink = useConsoleLink();
  // Inside the mobile app only the lines that name no wallet show: the free
  // allowance or a plan window running low, and a plan window used up that
  // paused the task. A window that put the task on the wallet stays hidden.
  const namesNoWallet = kind === 'free_low' || kind === 'window_low' || (kind === 'window_exhausted' && !onWallet);
  if (!PLATFORM_UI || (!offersBilling() && !namesNoWallet)) return null;
  const open = (action) => () => {
    trackBillingOpened('usage_alert', undefined, kind);
    host.openExternal(consoleLink(usageActionUrl(action, { isBillingOwner })));
  };
  if (kind === 'auto_top_up_failed') {
    // The one notice that asks for something, so it stays a card.
    return (
      <ActionCard
        time={time}
        agentLabel={agentLabel}
        kind={t('chatView.kinds.billing')}
        title={t('chatView.cards.autoTopUpFailedTitle')}
        body={t(billingCopyKey('chatView.cards.autoTopUpFailedBody'))}
        buttons={billingActions([
          { label: USAGE_ACTIONS.addFunds.label, onClick: open(USAGE_ACTIONS.addFunds), primary: true },
          { label: USAGE_ACTIONS.updatePaymentMethod.label, onClick: open(USAGE_ACTIONS.updatePaymentMethod) },
        ])}
      />
    );
  }
  // One quiet line, not a card: the composer bar says the same a few pixels
  // below. Running low says what is true of the allowance, not of this turn:
  // the router resolves per turn and can land on a paid model.
  // No usable refill time drops the clause rather than leaving "refills".
  const refillsAt = formatResetTime(resetsAt);
  // A Plus or Pro window (ENG-4186): its share used, or that it filled up,
  // and when it frees up. Never a dollar or token figure.
  const windowVars = { window: allowanceWindow === '7d' ? '7d' : '5h', time: refillsAt || '', percent: `${Math.round(Number(percentUsed) || 0)}%` };
  let text;
  if (kind === 'window_low') {
    text = refillsAt ? t('chatView.usageAlert.windowLowResets', windowVars) : t('chatView.usageAlert.windowLow', windowVars);
  } else if (kind === 'window_exhausted') {
    if (onWallet) text = t('chatView.usageAlert.windowOnWallet', windowVars);
    else text = refillsAt ? t('chatView.usageAlert.windowUsedUntil', windowVars) : t('chatView.usageAlert.windowUsed', windowVars);
  } else if (kind === 'free_low') {
    text = refillsAt
      ? t('chatView.usageAlert.freeLowRefills', { percent: formatPercentShort(fractionLeft), time: refillsAt })
      : t('chatView.usageAlert.freeLow', { percent: formatPercentShort(fractionLeft) });
  } else {
    text = refillsAt
      ? t('chatView.usageAlert.freeUsedUntil', { time: refillsAt })
      : t('chatView.usageAlert.freeUsed');
  }
  return (
    <div className="my-3 flex flex-wrap items-center gap-x-1.5 font-body text-xs text-ink-3">
      <Icon of={CircleAlert} size={14} />
      <span>{text}</span>
      {offersBilling() && (
        <>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            onClick={open(USAGE_ACTIONS.viewUsage)}
            className="border-0 bg-transparent p-0 m-0 font-body text-xs underline underline-offset-2 text-[color:inherit] cursor-pointer hover:text-ink-2"
          >{USAGE_ACTIONS.viewUsage.label}</button>
        </>
      )}
    </div>
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
  kind: kindProp, title: titleProp,
}) {
  const { t } = useTranslation('chat');
  const kind = kindProp ?? t('chatView.kinds.rateLimit');
  const title = titleProp ?? t('chatView.cards.rateLimitedTitle');
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
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [readyAt, remaining]);

  const buttons = onRetry
    ? [{
        label: remaining > 0 ? t('chatView.cards.tryAgainIn', { seconds: remaining }) : t('chatView.cards.tryAgain'),
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
  const { t } = useTranslation('chat');
  const consoleLink = useConsoleLink();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState(null);

  const canReconnect = PLATFORM_UI && Boolean(reconnectable) && !isWeb;

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
        host.openExternal(consoleLink(MINDS_BILLING_URL));
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
        setErr(res?.reason || t('chatView.reconnect.couldNotReconnect'));
      }
    } catch (e) {
      setErr(e?.message || t('chatView.reconnect.failed'));
    } finally {
      setBusy(false);
    }
  };

  // title + body are derived from what this card can actually offer (web-aware),
  // so they never contradict the buttons shown. We deliberately don't reuse the
  // server's copy here: it's provider-aware but not web-aware (it can't know the
  // desktop-only Reconnect is unavailable on web).
  const title = !PLATFORM_UI
    ? t('chatView.reconnect.cannotAuthTitle')
    : done
      ? t('chatView.reconnect.reconnectedTitle')
      : canReconnect ? t('chatView.reconnect.reconnectTitle')
      : reconnectable ? t('chatView.reconnect.signInAgainTitle')
      : t('chatView.reconnect.updateKeyTitle');
  const body = !PLATFORM_UI
    ? t('chatView.reconnect.cannotAuthBody')
    : done
      ? t('chatView.reconnect.reconnectedBody')
      : err || (
          canReconnect
            ? t('chatView.reconnect.reconnectBody')
            : reconnectable
              ? t('chatView.reconnect.signInAgainBody')
              : (providerLabel
                ? t('chatView.reconnect.updateKeyBody', { provider: providerLabel })
                : t('chatView.reconnect.updateKeyBodyGeneric'))
        );

  return (
    <ActionCard
      deleting={deleting}
      time={time}
      agentLabel={agentLabel}
      kind={t('chatView.kinds.connection')}
      title={title}
      body={body}
      buttons={!PLATFORM_UI || done ? [] : [
        ...(canReconnect ? [{
          label: busy ? t('chatView.reconnect.reconnecting') : t('chatView.reconnect.reconnect'),
          onClick: reconnect,
          primary: true,
          busy,
        }] : []),
        // Settings is the primary action when Reconnect isn't available
        // (BYOK key, or web where the IPC flow doesn't exist).
        { label: t('chatView.cards.openSettings'), onClick: () => onOpenSettings?.('agent'), primary: !canReconnect },
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
 * wallet (ENG-1304). Top up balance opens the console (host.openExternal
 * window.opens on web): the add-credits dialog for a billing owner on a credit
 * denial, the billing page otherwise. Open Settings routes there on both shells.
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
  isBillingOwner = false, requiredTier = null, deleting = false,
}) {
  const { t } = useTranslation('chat');
  const consoleLink = useConsoleLink();
  const upgrade = useUpgradeOffer();
  // Same naming rule as the picker (ENG-1638): MindsHub's catalog label when we
  // hold one, else the id-derived form. This card used to call the bare
  // prettifier, so the row the user had just picked as "MindsHub Air" came back
  // as "Mindshub air needs credits" — the same model named two ways on one
  // screen. displayModelLabel finishes multi-part ids (Claude Sonnet, GPT-5.5
  // Mini) and deliberately lowercases some heads (o4 Mini) — never re-case
  // those. Only a bare single-token alias ("sonnet") comes back lowercase, and
  // it reads better capitalized in the title. So capitalize single-word labels
  // only, leaving anything already spaced/cased untouched.
  const raw = displayModelLabel(failedModel, modelLabels) || failedModel || t('chatView.model.thisModel');
  const label = /\s/.test(raw) ? raw : raw.charAt(0).toUpperCase() + raw.slice(1);
  if (code === 'model_restricted' || !PLATFORM_UI) {
    return (
      <ActionCard
        deleting={deleting}
        time={time}
        agentLabel={agentLabel}
        kind={t('chatView.kinds.model')}
        title={code === 'model_restricted' ? t('chatView.model.restrictedTitle', { model: label }) : t('chatView.model.unavailableTitle', { model: label })}
        body={!PLATFORM_UI
          ? t('chatView.model.askOperatorBody')
          : t('chatView.model.restrictedBody')}
        buttons={PLATFORM_UI ? [
          { label: t('chatView.cards.openSettings'), onClick: () => onOpenSettings?.('agent'), primary: true },
        ] : []}
      />
    );
  }
  /* A model outside the plan (`model_not_in_tier`, ENG-4186): the plan's
     allowance does not cover it and the wallet cannot pay for it. Both ways
     out work: a plan that covers it (the tier the gate named), or funds, which
     pay for any model at API rates on any plan. */
  if (code === 'model_not_in_tier') {
    const tier = cleanRequiredTier(requiredTier);
    const offerTier = tier || upgrade.tier;
    const canUpgrade = !!offerTier && upgrade.canOffer(offerTier);
    // Inside the mobile app it reads like the credit denial below: the model
    // is unavailable, with no plan to buy and no word about the balance.
    const billing = offersBilling();
    return (
      <ActionCard
        deleting={deleting}
        time={time}
        agentLabel={agentLabel}
        kind={t('chatView.kinds.model')}
        title={billing
          ? t('chatView.model.notInTierTitle', { model: label })
          : t('chatView.model.unavailableTitle', { model: label })}
        body={billing
          ? t('chatView.model.notInTierBody', { model: label, tier: tier || 'other' })
          : t('chatView.model.askOperatorBody')}
        buttons={[
          ...billingActions([
            ...(canUpgrade ? [{
              label: upgradeAction(offerTier).label,
              onClick: () => upgrade.open(offerTier, 'model_card'),
              primary: true,
            }] : []),
            {
              label: t('chatView.cards.addFunds'),
              onClick: () => {
                trackBillingOpened('model_not_in_tier');
                host.openExternal(consoleLink(usageActionUrl(USAGE_ACTIONS.addFunds, { isBillingOwner })));
              },
              primary: !canUpgrade,
            },
          ]),
          ...switchToAirButtons(onSwitchToAir),
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
    // Only a credit denial opens the add-credits dialog: credits cannot turn a
    // disabled model back on, so that row keeps the plain billing page.
    host.openExternal(consoleLink(denied ? usageActionUrl(USAGE_ACTIONS.addFunds, { isBillingOwner }) : MINDS_BILLING_URL));
  };
  const title = denied && offersBilling()
    ? t('chatView.model.needsCreditsTitle', { model: label })
    : t('chatView.model.unavailableTitle', { model: label });

  // Fixed copy, not the server's error string (ENG-1304): old gateways word
  // these denials as access problems ("your workspace does not have access"),
  // which under pay as you go misdescribes an empty wallet.
  return (
    <ActionCard
      deleting={deleting}
      time={time}
      agentLabel={agentLabel}
      kind={t('chatView.kinds.model')}
      title={title}
      body={denied
        ? t(offersBilling() ? 'chatView.model.needsCreditsBody' : 'chatView.model.askOperatorBody')
        : t('chatView.model.disabledBody')}
      buttons={denied
        ? [
            ...billingActions([{ label: t('chatView.model.topUpBalance'), onClick: openBilling, primary: true }]),
            // Only while Air can still run (free allowance or a payable
            // wallet) — a switch offer into another locked model is the same
            // dead end this card exists to close.
            ...switchToAirButtons(onSwitchToAir),
          ]
        : [
            { label: t('chatView.cards.openSettings'), onClick: () => onOpenSettings?.('agent'), primary: true },
            ...billingActions([{ label: t('chatView.model.topUpBalance'), onClick: openBilling }]),
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
  const { t } = useTranslation('chat');
  const onManaged = Boolean(reconnectable);
  const who = !PLATFORM_UI ? t('chatView.overloaded.theModelProvider') : onManaged ? 'MindsHub' : (providerLabel || t('chatView.overloaded.theModelProvider'));
  const base = (PLATFORM_UI && errorText)
    || t('chatView.overloaded.body', { who });
  const body = !PLATFORM_UI || onManaged
    ? base
    : t('chatView.overloaded.withFailover', { base });

  return (
    <ActionCard
      deleting={deleting}
      time={time}
      agentLabel={agentLabel}
      kind={t('chatView.kinds.provider')}
      title={t('chatView.overloaded.title', { who })}
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
      // The doc it was sent beside, when this app sent it: a resend goes with
      // that one, never with whatever doc is open now. Asked for as a doc, it
      // is asked for as one again.
      return {
        text: m.content,
        attachments: Array.isArray(m.attachments) ? m.attachments : [],
        docContext: m.docContext || null,
        output: m.output || null,
      };
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

// Module-level so the per-task debounce survives switching tasks (ENG-3188).
export const warmBrowser = createBrowserWarmUp(() => provisionBrowser());

// ─── Main view ───────────────────────────────────────────────────────────
/** Sent for the person when they click Done after the turn that handed them the browser ended. */
export const BROWSER_DONE_MESSAGE = 'Done: I handed the browser back to you. Carry on from where you stopped.';

export default function ChatView({
  task,
  // The last /health snapshot, for the diagnostics a user copies off a failed
  // turn. Read from App rather than re-fetched at click time: the turn may
  // have failed because the server is the thing that went away.
  health,
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
  onAddSharePointFiles,
  onFetchGoogleDriveProjectFiles,
  onRemoveGoogleDriveProjectFile,
  onAddNotionProjectPages,
  onFetchNotionProjectPages,
  onRemoveNotionProjectPage,
  disabledConnections,
  onUpdateConnectorMute,
  onStartVoiceCall = null,
  dictationAvailable = false,
  // A voice call asked to show this task's browser: {taskId, sessionId, at}.
  browserRequest = null,
  // The project's tasks ({id, title}), for the browser pane's list of the
  // project's browsers, and how to go to another task's browser.
  projectTasks = null,
  onOpenTaskBrowser = null,
  // On a phone: the voice call's card, shown at the top of the chat.
  phoneCallCard = null,
  // On a phone: the voice call itself (useVoiceCall's), for the speaking orb
  // shown in place of the card while the browser is expanded.
  phoneCall = null,
  // Bumped by the phone top bar's browser icon: open this task's browser.
  openBrowserSignal = 0,
  browserSwitch = null,
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
  // Opens a saved custom connector's connect form from its draft card.
  onConnectCustomConnector,
  onDismissConnectForm,
  onCancelModify,
  onDisconnectModify,
  onMoveTaskToProject,
  onOpenProject,
  onOpenProjectsList,
  onOpenSettings,
  codingModelDefault,
  harnessClaudeCodeEnabled,
  /* The shared browser is on for this task: on in Settings and not switched
     off in the task's + menu. Only then does a Browser step open the pane,
     and, on the web, a task that used the browser start it early. */
  browserOn = false,
  /* Settings > Appearance "Show where figures came from": mark each figure in
     a finished answer with the step it came from. On unless the user turned
     it off. */
  showFigureSources = true,
  onStop,
  projects = [],
  // Messages the user typed while Anton was mid-turn. Displayed as
  // pills above the Composer; drain into onSend automatically when
  // the active turn finishes.
  queuedMessages = [],
  onRemoveFromQueue,
  onAddQueuedToTask,
  onMoveAddonToQueue,
  onResendQueued,
  // A doc to open beside this chat as it shows, then `onDocDocked`.
  dockDoc = null,
  onDocDocked,
  agentLabel,
  // Conversation ids the server currently has an active producer for
  // (App.jsx's cross-client sync feed). Used to decide whether an
  // unanswered AskUser card is still live or "expired" — replay
  // resurrects unanswered questions from persisted history, and a
  // click on one with no live run behind it would 404.
  inFlightSet,
  // ({ prompt, projectId, answerKey }) — opens the new-schedule form filled
  // in with the message a finished answer replied to; a save marks that
  // answer scheduled (lib/scheduledAnswers). Without it, no schedule step.
  onScheduleFromChat = null,
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
  // One side of a model comparison: the transcript only. The Compare screen
  // owns the header, the shared composer and the side panel, so none of them
  // render here.
  pane = false,
}) {
  const { t } = useTranslation('chat');
  const scrollRef = useRef(null);
  const { isNarrow, paneFloats, isMobile } = useBreakpoint();
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
  // The rail docks beside the conversation only when the conversation keeps
  // its full reading width next to it; otherwise it opens over the top.
  const [railFits, setRailFits] = useState(true);
  const railFloats = isNarrow || !railFits;
  const effectiveRailOpen = !pane && !railFloats && railOpen;
  // A comparison pane never resends on its own: it would give one side a
  // turn the other never got, and the two would stop being comparable.
  const sendAgain = pane ? undefined : (text, attachments, docContext = null, output = null) => (
    onSend?.(text, attachments, { docContext, ...(output ? { output } : {}) })
  );
  const railOverlayOpen = !pane && railFloats && railNarrowOpen;
  /* The floating rail drawer counts as an overlay, so the desktop browser
     pane's native view steps aside rather than draw over it. */
  useNativeOverlay(railOverlayOpen);
  // Step id whose scratchpad cells are visible in the modal. null = closed.
  const [openScratchpadStepId, setOpenScratchpadStepId] = useState(null);
  /* The figure source (a LinkedFigureSource) whose file is open in the
     figure viewer. null = closed. */
  const [figureFileSource, setFigureFileSource] = useState(null);
  /* The project-relative path of a generated image open in the file viewer
     (ENG-4024). null = closed. */
  const [openImagePath, setOpenImagePath] = useState(null);
  // Inline ArtifactCard → viewer. HTML artifacts open in the sandboxed
  // iframe modal; text artifacts (.md/.txt/.csv) open the same viewer
  // but render via the inline text path (no iframe, no OS handoff).
  // Anything else still routes through the Electron OS handler via
  // openPath inside the card.
  const [previewArt, setPreviewArt] = useState(null);
  const isStreaming = task.messages.some((m) => m.role === '_streaming');
  // The doc open beside the chat. A doc the agent creates in this
  // conversation opens here the moment it exists. A comparison pane has no
  // right-hand column, so no doc opens there.
  const docSide = useDocBesideChat({
    taskId: task?.id, projectId: project?.id, streaming: isStreaming, onSend, enabled: !pane,
  });
  // A doc the app brought this chat up for ("Edit with agent" on a doc from
  // the library) opens beside it, once.
  useEffect(() => {
    if (!dockDoc) return;
    docSide.open(dockDoc);
    onDocDocked?.();
  }, [dockDoc, docSide.open, onDocDocked]);
  // A new object per Share click, so the viewer opens its panel once per click.
  const [previewShare, setPreviewShare] = useState(null);
  // Where a live inline page was when its Preview was clicked (a new object
  // per click), for the viewer to open on the same place.
  const [previewViewRequest, setPreviewViewRequest] = useState(null);
  const handleArtifactOpen = (artifact, { view = null } = {}) => {
    if (isDocArtifact(artifact)) {
      docSide.open(artifact);
      return;
    }
    // The card already filters: it only calls onOpen for previewable
    // types (HTML / md / txt / csv). Dispatch straight to the viewer.
    setPreviewShare(null);
    setPreviewViewRequest(view ? { view } : null);
    setPreviewArt(artifact);
  };
  const handleArtifactShare = (artifact) => {
    // A doc shares from its own pane, which knows the page follows its edits.
    if (isDocArtifact(artifact)) {
      docSide.open(artifact);
      return;
    }
    setPreviewShare({});
    setPreviewViewRequest(null);
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

  // A mid-task send holds its queue slot while the server decides (ENG-4194);
  // the running turn already shows it as "Sending…", so the chip appears only
  // if that turn ends first.
  const shownQueue = queuedMessages.filter((q) => !(q.addonOffer && isStreaming));
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
      key={`usage-${n.createdAt}-${n.kind}-${n.fractionLeft ?? ''}-${n.window ?? ''}`}
      time={formatMetaTime(n.createdAt)}
      agentLabel={agentLabel}
      kind={n.kind}
      resetsAt={n.resetsAt}
      fractionLeft={n.fractionLeft}
      allowanceWindow={n.window ?? null}
      percentUsed={n.percentUsed ?? null}
      onWallet={!!n.onWallet}
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
  // Where an inline generated image (ENG-4024) is read from: the project the
  // chat runs in, whose folder is Anton's workspace. The project's slug
  // addresses its files route and is never shown. Memoised so the turn
  // segments it rides into don't re-render on its account.
  const projectSlug = project?.name ?? null;
  const generatedImageSource = useMemo(() => ({
    projectName: projectSlug,
    projectPath: artifactProjectPath,
    onOpen: setOpenImagePath,
  }), [projectSlug, artifactProjectPath]);
  // Which project's artifacts the liveness store should describe. An effect, not
  // a render-time call: the store emits. Both deps are primitives, so an equal
  // scope cannot re-trigger it.
  useEffect(() => {
    setArtifactsScope({ projectId: project?.id || '', projectPath: artifactProjectPath });
  }, [project?.id, artifactProjectPath]);
  const taskAttachments = task.attachments || visibleMessages.flatMap((m) => m.attachments || []);
  /* The shared browser's pane shows one session: the live turn's, when its
     Browser step appears, or the one whose Browser step the person clicks.
     Past turns never open it on their own. Closing it sets null, so a pane
     closed mid-turn stays closed until a later turn's step or a click opens
     it. ChatView isn't keyed by task, so a task change starts over. The web
     shows the browser router's viewer and a desktop shell that hosts the
     in-app browser shows its own; an older shell has no pane. A comparison
     pane has no right-hand column. Switching the browser off applies from
     the next message, so the live turn's own session stays viewable, and its
     Browser step stays clickable, until that turn ends. */
  const [shownBrowserId, setShownBrowserId] = useState(null);
  const shownBrowserRef = useRef(null);
  shownBrowserRef.current = shownBrowserId;
  /* Bumped when a hand-back asks the pane to show its browser, so a pane
     that already gave up on its viewer asks again (BrowserPanel's
     `retrySignal`). */
  const [browserRetry, setBrowserRetry] = useState(0);
  // Bumped by closing the pane and by a task change, so a browser still
  // opening doesn't show after it, or in another task.
  const openSeqRef = useRef(0);
  useEffect(() => {
    openSeqRef.current += 1;
    setShownBrowserId(null);
    /* A task change takes the pane off this browser, so a hand-back still
       waiting for its viewer ends, whoever asked for it (the hand-over card,
       or a voice call's browser_done), and a later hand-over never gets it
       (lib/browserHandBack.js). Null at first mount, so StrictMode's extra
       cleanup ends nothing. */
    return () => dropHandBack(shownBrowserRef.current);
  }, [task.id]);
  const liveBrowserId = browserSessionIdIn(streamingMsg?.steps);
  /* With Only show the browser when I'm needed on (Settings, the default),
     the pane doesn't open while the agent browses: only when it's the
     person's turn, a card the browser asks them (a held step to approve, a
     sign-in, a CAPTCHA or another hand-over), keyed by that card so each
     new one opens it again. The browser button opens it at any time. */
  const { onlyWhenNeeded } = useBrowserPrefs();
  const personsTurnId = (streamingMsg?.steps || []).find(isPersonsBrowserTurn)?.data?.question_id || null;
  const personsTurnBrowserId = personsTurnId
    ? (liveBrowserId || latestBrowserSessionIdIn(visibleMessages, streamingMsg))
    : null;
  useEffect(() => {
    if (browserOn && liveBrowserId && !onlyWhenNeeded) setShownBrowserId(liveBrowserId);
  }, [browserOn, liveBrowserId, task.id, onlyWhenNeeded]);
  useEffect(() => {
    if (!browserOn || !onlyWhenNeeded || !personsTurnBrowserId) return;
    // A phone push notification is the natural follow-up here once the iPhone app lands.
    setShownBrowserId(personsTurnBrowserId);
    setBrowserMinimized(false);
  }, [browserOn, onlyWhenNeeded, personsTurnId, personsTurnBrowserId, task.id]);
  const viewable = (sessionId) => !!sessionId && (browserOn || sessionId === liveBrowserId);
  // A request (a voice call's show_browser or browser_done) applies once:
  // coming back to the task later doesn't open the pane again. Like the
  // hand-over card's, it asks a pane that gave up on its viewer to try again.
  const appliedBrowserRequestRef = useRef(null);
  useEffect(() => {
    if (browserRequest?.taskId !== task.id || !browserRequest.sessionId) return;
    if (appliedBrowserRequestRef.current === browserRequest.at) return;
    appliedBrowserRequestRef.current = browserRequest.at;
    setShownBrowserId(browserRequest.sessionId);
    setBrowserRetry((n) => n + 1);
  }, [browserRequest, task.id]);
  /* Show browser on the web shows the pane at once: the start page while the
     task's browser opens (`openingBrowser`), then that browser, on the blank
     tab it opened (`blankOpenedId`). */
  const [openingBrowser, setOpeningBrowser] = useState(false);
  const [blankOpenedId, setBlankOpenedId] = useState(null);
  useEffect(() => { setOpeningBrowser(false); setBlankOpenedId(null); }, [task.id]);
  // A doc open beside the chat holds the right-hand column; the browser pane,
  // in any of its states, comes back when the doc closes.
  const docHoldsColumn = Boolean(docSide.doc);
  const browserOpen = !pane && !docHoldsColumn && (host.isWeb || host.supportsInAppBrowser) && viewable(shownBrowserId);
  const openingBrowserOpen = !pane && !docHoldsColumn && openingBrowser && !browserOpen && host.isWeb;
  /* The top-right Show browser icon, in a task whose browser is off or could
     not open: a blank page that asks where to go. The real pane takes its
     place as soon as the turn's Browser step arrives. */
  const [blankBrowser, setBlankBrowser] = useState(false);
  useEffect(() => { setBlankBrowser(false); }, [task.id]);
  useEffect(() => { if (browserOpen) setBlankBrowser(false); }, [browserOpen]);
  const blankBrowserOpen = !pane && !docHoldsColumn && blankBrowser && !browserOpen && (host.isWeb || host.supportsInAppBrowser);
  const browserPaneOpen = browserOpen || blankBrowserOpen || openingBrowserOpen;
  /* On a phone the pane docks at the top of the chat (no taller than half
     the screen) and minimizes to its header instead of closing. It expands
     when Anton starts using the browser, and minimizes when the turn ends so
     the answer shows. */
  const [browserMinimized, setBrowserMinimized] = useState(false);
  useEffect(() => { setBrowserMinimized(false); }, [task.id]);
  useEffect(() => { if (liveBrowserId && !onlyWhenNeeded) setBrowserMinimized(false); }, [liveBrowserId, onlyWhenNeeded]);
  const wasStreamingRef = useRef(false);
  useEffect(() => {
    if (wasStreamingRef.current && !isStreaming && isMobile && browserOpen) setBrowserMinimized(true);
    wasStreamingRef.current = isStreaming;
  }, [isStreaming, isMobile, browserOpen]);
  const browserDock = isMobile && !pane
    ? { collapsed: browserMinimized, onToggle: () => setBrowserMinimized((m) => !m) }
    : null;
  // Anton handed the browser to the person (the viewer says so): it opens,
  // and the strip under it says what to do.
  const [browserHandoff, setBrowserHandoff] = useState(null);
  // It comes back by itself once the person did what it waits for (the viewer says so).
  const [handoffWatching, setHandoffWatching] = useState(false);
  /* Whether a turn ran while the person held the browser: a turn that ended
     waiting for them can't see Done, so Done carries it on (`onBrowserControl`).
     A turn still running sees Done itself, and one the person stopped stays
     stopped: from the composer (`stopTurn`) or the hand-over card's Stop
     (`stopTask` in the card's context). The card's Stop ends the turn only
     once anton reads it, so until that turn ends it no longer counts as held
     (`stoppedFromCardRef`). */
  const heldThroughTurnRef = useRef(false);
  const stoppedFromCardRef = useRef(false);
  const streamingRef = useRef(isStreaming);
  streamingRef.current = isStreaming;
  if (browserHandoff && isStreaming && !stoppedFromCardRef.current) heldThroughTurnRef.current = true;
  useEffect(() => { if (!isStreaming) stoppedFromCardRef.current = false; }, [isStreaming]);
  useEffect(() => {
    setBrowserHandoff(null);
    heldThroughTurnRef.current = false;
    stoppedFromCardRef.current = false;
  }, [task.id, shownBrowserId]);
  const onBrowserControl = (holder, reason, watching = false) => {
    setHandoffWatching(holder === 'human' && watching);
    if (holder === 'human') {
      setBrowserHandoff(reason || tc('browser.handOverFallback', { agent: harnessLabel(task?.harness) || 'Anton' }));
      setBrowserMinimized(false);
      if (streamingRef.current && !stoppedFromCardRef.current) heldThroughTurnRef.current = true;
      return;
    }
    setBrowserHandoff(null);
    const waiting = heldThroughTurnRef.current && !streamingRef.current;
    heldThroughTurnRef.current = false;
    if (waiting && onSend) onSend(BROWSER_DONE_MESSAGE);
  };
  // Stop: the turn didn't end waiting on the person, so Done carries nothing on.
  const stopTurn = onStop ? (...args) => {
    heldThroughTurnRef.current = false;
    return onStop(...args);
  } : onStop;
  const askingUser = (streamingMsg?.steps || []).some(
    (s) => s.badge === 'AskUser' && !s.data?.answer && !isPositionClickCard(s.data),
  );
  /* Overlay mode only: below 640 the pane docks and carries the phone's own
     strip; from 1160 up the pane sits beside the chat, already visible. */
  const browserPaneOverlay = paneFloats && !isMobile;
  /* What the overlay strip says is waiting, read from the card itself (not
     `browserHandoff`/`handoffWatching` below, which come from the viewer and
     can lag the card: a hand-over card can open before the viewer reports who
     holds the browser). `openNeed` already excludes answered and
     auto-approved cards and tells a hand-over from a plain question by the
     card's own prompt; this is deliberately narrower than `askingUser` above,
     which lets an auto-approved card through. */
  const browserWaitNeed = browserPaneOverlay ? openNeeds(streamingMsg?.steps)[0] || null : null;
  /* Whether the step is the person's turn in the browser, by its id prefix
     (isPersonsBrowserTurn's own test), not by whether `openNeed` managed to
     parse its prompt into a hand-over: both the message and the button must
     agree on this even when the prompt doesn't match the shape anton writes
     (changed wording, a multi-line reason), where `openNeed` falls back to
     `kind: 'question'`. Disagreeing would tell the person to go to a chat
     that has nothing for them (the question wording, no button) or hand them
     a button that takes the page away mid hand-over. */
  const browserWaitIsHandOver = Boolean(browserWaitNeed) && /^browser:(?!approve:)/.test(browserWaitNeed.questionId);
  const browserWaitMessage = !browserWaitNeed ? ''
    : browserWaitIsHandOver
    // The page's own host leads the reason, so a lookalike page can't pass
    // its words off as the app's (LocalBrowserStage's own hint, the same way).
    // `site`/`watching` are unset when the prompt didn't parse; `text` is
    // still the card's own text either way (its full prompt, in that case).
    ? (browserWaitNeed.watching
      ? tc('browser.overlayHandOverWatching', { site: browserWaitNeed.site || tc('browser.aNewTab'), reason: browserWaitNeed.text, agent: harnessLabel(task?.harness) || 'Anton' })
      : tc('browser.overlayHandOver', { site: browserWaitNeed.site || tc('browser.aNewTab'), reason: browserWaitNeed.text }))
    : tc('browser.overlayQuestion', { agent: harnessLabel(task?.harness) || 'Anton' });
  /* The live region announces content CHANGES, so its text is held in state
     and written from an effect rather than rendered straight from
     `browserWaitMessage`: a region whose first commit already has the text
     is silent (AskUserCard.jsx's own announcement does the same). Gated on
     the panel actually being mounted: the card and the panel's own open
     often land in the same commit (the default "only when needed" path),
     and filling the announcement in that same commit would mean the
     region's first commit, once the footer mounts, already has the text. */
  const [browserWaitAnnouncement, setBrowserWaitAnnouncement] = useState('');
  useEffect(() => {
    setBrowserWaitAnnouncement(browserPaneOpen ? browserWaitMessage : '');
  }, [browserWaitMessage, browserPaneOpen]);
  const phoneBrowserExpanded = Boolean(browserDock) && browserPaneOpen && !browserMinimized;
  // While it is expanded the page under it stays put: no scroll, so typing in
  // the address row can't move the screen.
  useEffect(() => {
    if (!phoneBrowserExpanded) return undefined;
    const root = document.documentElement;
    root.classList.add('phone-browser-open');
    // No zoom while it is open: a tap in the browser's own address field
    // happens inside its frame, where the app's focus-based zoom lock
    // (useViewportZoomLock) never hears it.
    const meta = document.querySelector('meta[name="viewport"]');
    const viewportBefore = meta?.getAttribute('content') || null;
    meta?.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no');
    // The phone's keyboard, while the composer under the browser has focus:
    // the composer rides above it (--phone-keyboard, globals.css).
    const keepTop = () => {
      window.setTimeout(() => window.scrollTo(0, 0), 0);
      const vv = window.visualViewport;
      const keyboard = vv ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0;
      root.style.setProperty('--phone-keyboard', `${keyboard}px`);
    };
    window.addEventListener('focusin', keepTop);
    window.visualViewport?.addEventListener('resize', keepTop);
    return () => {
      root.classList.remove('phone-browser-open');
      root.style.removeProperty('--phone-keyboard');
      if (meta && viewportBefore !== null) meta.setAttribute('content', viewportBefore);
      window.removeEventListener('focusin', keepTop);
      window.visualViewport?.removeEventListener('resize', keepTop);
    };
  }, [phoneBrowserExpanded]);
  /* The inline pane holds the right-hand column, where a docked rail would
     go, so the rail and its Expand button step aside. A rail that floats
     opens over the pane instead. */
  const railHidden = browserPaneOpen && !paneFloats && !railFloats;
  const latestBrowserId = latestBrowserSessionIdIn(visibleMessages, streamingMsg);
  // Always there where a browser can show: the browser Anton last used here,
  // or the blank page.
  // Only while the shared browser is on for this task (Settings, beta, and the task's own switch).
  const showBrowserShortcut = !browserPaneOpen && Boolean(browserOn) && (host.isWeb || host.supportsInAppBrowser);
  // An address typed in the blank page opens in the task's own browser, with
  // no agent: through the server on the web, the app's own browser on the
  // desktop. The real pane then shows it.
  /** `url` null opens the task's browser on a blank tab, where the real pane shows the start page. */
  const openUrlInTask = async (url) => {
    const seq = openSeqRef.current;
    let sessionId;
    if (host.isWeb) {
      sessionId = (await openBrowserAt(task.id, url))?.session_id;
    } else {
      sessionId = await desktopTaskSession(task.id);
      await host.inAppBrowser.open(sessionId, url);
    }
    if (seq !== openSeqRef.current) return sessionId;
    if (sessionId) {
      if (url === null) setBlankOpenedId(sessionId);
      setShownBrowserId(sessionId);
    }
    setOpeningBrowser(false);
    return sessionId;
  };
  useEffect(() => {
    if (openBrowserSignal) openBrowserFromShortcut();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openBrowserSignal]);
  // On the web, the project's browsers beside the pane's X.
  const projectBrowsers = host.isWeb && browserOn && projectTasks ? (
    <ProjectBrowsers
      taskId={task.id}
      tasks={projectTasks}
      onReopen={(url) => { void openUrlInTask(url).catch(() => {}); }}
      onOpenTaskBrowser={onOpenTaskBrowser}
    />
  ) : null;
  const openBrowserFromShortcut = () => {
    setBrowserMinimized(false);
    if (viewable(latestBrowserId)) {
      setShownBrowserId(latestBrowserId);
      return;
    }
    /* No browser here yet: open the task's real browser on a blank tab, so
       the pane is the same one the agent uses, with the start page over the
       blank tab. The standalone start page stays for a browser that is off or
       that could not open. */
    if (!browserOn) {
      setBlankBrowser(true);
      return;
    }
    if (host.isWeb) setOpeningBrowser(true);
    const seq = openSeqRef.current;
    const fallBack = () => {
      if (seq !== openSeqRef.current) return;
      setOpeningBrowser(false);
      setBlankBrowser(true);
    };
    openUrlInTask(null).then((id) => { if (!id) fallBack(); }, fallBack);
  };
  const closeBrowserPanel = () => {
    // A closed pane shows this browser no more: a hand-back waiting for its viewer ends.
    dropHandBack(shownBrowserId);
    openSeqRef.current += 1;
    setOpeningBrowser(false);
    setShownBrowserId(null);
  };
  const closeBlankBrowser = () => { openSeqRef.current += 1; setBlankBrowser(false); };
  /* The pane's footer, overlay mode only: a live region, mounted whether or
     not anything is waiting (so its first text change is heard, not its
     first mount), plus the visible strip while something is. A hand-over
     gets the message and no button: its whole instruction is to work in the
     page, so a button whose only effect takes the page away is the wrong
     offer; a plain question's button closes the pane it sits on (each panel
     closes itself differently) and returns to the card. */
  const browserWaitFooter = (closePane) => (browserPaneOverlay ? (
    <>
      <div className="sr-only" role="status" aria-live="polite">{browserWaitAnnouncement}</div>
      {browserWaitMessage && (
        <div className="browser-panel__wait-strip">
          <p>{browserWaitMessage}</p>
          {!browserWaitIsHandOver && (
            <Button size="sm" onClick={() => { closePane(); scrollToBottom(); }}>
              {tc('browser.overlayGoToQuestion')}
            </Button>
          )}
        </div>
      )}
    </>
  ) : null);
  const browserNode = (
    <>
      {(browserOpen || openingBrowserOpen) && (
        <BrowserPanel
          sessionId={browserOpen ? shownBrowserId : null}
          startBlank={openingBrowserOpen || (browserOpen && shownBrowserId === blankOpenedId)}
          agentLabel={harnessLabel(task?.harness) || 'Anton'}
          onClose={closeBrowserPanel}
          extraActions={projectBrowsers}
          dock={browserDock}
          onControl={onBrowserControl}
          retrySignal={browserRetry}
          taskKey={task.id}
          onSend={onSend ? (text) => onSend(text) : undefined}
          onDraft={(text) => setComposerPrefill((prev) => ({ text, bump: (prev?.bump || 0) + 1, append: true }))}
          onOpenUrl={openUrlInTask}
          footer={browserWaitFooter(closeBrowserPanel)}
        />
      )}
      {blankBrowserOpen && (
        <BlankBrowserPanel
          taskKey={task.id}
          agentLabel={harnessLabel(task?.harness) || 'Anton'}
          browserOn={!!browserOn}
          onSend={onSend ? (text) => onSend(text) : undefined}
          onOpenUrl={openUrlInTask}
          onClose={closeBlankBrowser}
          dock={browserDock}
          footer={browserWaitFooter(closeBlankBrowser)}
        />
      )}
    </>
  );
  // A phone's task: the call's card, then the browser, then the chat. With
  // the browser expanded over the top 80%, the card gives way to a small orb
  // at its bottom edge, and the strip under it speaks only when Anton needs
  // the person.
  const needsUser = browserHandoff && handoffWatching
    ? tc('browser.phoneYourTurnWatching', { reason: browserHandoff, agent: harnessLabel(task?.harness) || 'Anton' })
    : browserHandoff
    ? tc('browser.phoneYourTurn', { reason: browserHandoff })
    : askingUser ? tc('browser.phoneQuestion', { agent: harnessLabel(task?.harness) || 'Anton' }) : '';
  // Otherwise the strip says what Anton is doing right now: the live step.
  const liveSteps = (streamingMsg?.steps || []).filter((s) => s.badge !== 'AskUser' && s.label);
  const nowDoing = isStreaming
    ? (liveSteps[liveSteps.length - 1]?.label || tc('browser.phoneWorking'))
    : tc('browser.phoneDone');
  const callLive = Boolean(phoneCall && phoneCall.phase !== 'idle' && phoneCall.phase !== 'ended');
  const phoneDock = browserDock && (phoneCallCard || browserPaneOpen) ? (
    <div className="chat-phone-dock">
      {!phoneBrowserExpanded && phoneCallCard}
      {browserNode}
      {/* Under the expanded browser: the call's orb (or a button to start
          one) beside what Anton needs from the person or else what he's
          doing, and the composer under them (globals.css). */}
      {phoneBrowserExpanded && (
        <div className={`phone-browser-strip${needsUser ? ' is-asking' : ''}`}>
          {callLive ? (
            <VoiceOrb call={phoneCall} onClick={() => setBrowserMinimized(true)} />
          ) : onStartVoiceCall ? (
            <button
              type="button"
              className="phone-browser-strip__talk"
              aria-label={tc('browser.talkTo', { agent: harnessLabel(task?.harness) || 'Anton' })}
              onClick={() => onStartVoiceCall()}
            >
              {Ico.mic(16)}
            </button>
          ) : null}
          <div className="phone-browser-strip__text" role="status" aria-live="polite">
            <p>{needsUser || nowDoing}</p>
            {needsUser && <Button size="sm" onClick={() => setBrowserMinimized(true)}>{tc('browser.phoneMinimize')}</Button>}
          </div>
        </div>
      )}
    </div>
  ) : null;
  // The floating Expand button's spot, when it shows; the icons sit beside it.
  const expandShown = !pane && !railHidden && !(effectiveRailOpen || railOverlayOpen);
  /* The web browser takes a while to wake, so a task that used it starts it
     when it opens and when the person types. The desktop has nothing to
     start. */
  const usedBrowser = useMemo(
    () => conversationUsedBrowser(visibleMessages, streamingMsg),
    [visibleMessages, streamingMsg],
  );
  const warmsBrowser = host.isWeb && browserOn && usedBrowser;
  useEffect(() => {
    if (warmsBrowser) warmBrowser(task.id);
  }, [warmsBrowser, task.id]);
  /* A click on a step, in the transcript or the rail's progress card. A
     Browser step shows its session in the pane; any other step opens its
     cells in the scratchpad viewer, under its message's key `prefix`. */
  const activateStep = (prefix) => (step) => {
    // A Browser step, a browser call, a turn's browser row or a browser step
    // the person answered shows its browser.
    if (step?.badge === BROWSER_BADGE || step?.badge === BROWSER_ACTION_BADGE || step?.badge === BROWSER_APPROVAL_BADGE || step?.badge === BROWSER_HANDOVER_BADGE) {
      const sessionId = step.data?.sessionId || latestBrowserId;
      if (viewable(sessionId)) {
        setShownBrowserId(sessionId);
        setBrowserMinimized(false);
      }
      return;
    }
    if (prefix) setOpenScratchpadStepId(prefixId(prefix, step.id));
  };
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
  // One live frame per inline artifact (ENG-4684): the latest card showing it
  // inline keeps the frame, earlier ones fold to a chip. Same order as skills.
  const latestInlineArtifact = useMemo(
    () => latestInlineArtifactByKey(streamingMsg ? [...visibleMessages, streamingMsg] : visibleMessages),
    [visibleMessages, streamingMsg],
  );
  // An inline page's Submit is a chat turn, sent the way a question card's
  // typed answer is: the quick-edit bar's prompt about the artifact, plus the
  // page's state. [] so it does not take the composer's staged files.
  const handleInlineSubmit = onSend
    ? (artifact, { state, message }) => onSend(inlineSubmitChatPrompt(artifact, message, state), [])
    : null;

  const stick = useStickToBottom(scrollRef);
  const { scrollToBottom, follow: followEnd, anchorLastTurn } = stick;
  const dockRef = useDockInset();
  const scrollAnchorRef = useRef(null);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { action, scrollHeightDelta, anchor } = nextScrollAnchor({
      taskId: task.id,
      renamedFrom: task.renamedFrom,
      messages: visibleMessages,
      previousAnchor: scrollAnchorRef.current,
      scrollHeight: el.scrollHeight,
    });
    // Loading an older page prepends content above what's on screen —
    // shifting scrollTop by the same delta keeps the reader's position
    // steady instead of yanking them to the bottom. A reply landing only
    // follows a reader who was already at the end.
    if (action === 'hold') el.scrollTop += scrollHeightDelta;
    else if (action === 'end') scrollToBottom();
    // In a comparison pane a follow-up arrives in both panes at once, so it
    // follows the end rather than moving each pane to the new turn's top.
    else if (action === 'sent') { if (pane) followEnd(); else anchorLastTurn(); }
    else followEnd();
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
  useIntersection(
    loadEarlierSentinelRef,
    (intersecting) => { if (intersecting) onLoadEarlierMessages({ auto: true }); },
    // Start the fetch slightly before the top is actually reached, so the
    // page is usually already there by the time the reader gets there.
    { rootRef: scrollRef, rootMargin: '200px 0px 0px 0px', enabled: !!(task.hasMoreMessages && onLoadEarlierMessages) },
    [task.id, onLoadEarlierMessages, loadingEarlierMessages],
  );

  // Outer ref + conv-column ref. The orb canvas binds to the conv
  // column so the floating orb is naturally clipped to that area
  // (can't leak into the rail visually when a slot is near the right
  // edge). chatRef stays as the panel-level ancestor.
  const chatRef = useRef(null);
  useEffect(() => {
    const el = chatRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => setRailFits(entry.contentRect.width >= RAIL_DOCK_MIN_PX));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
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
  /* The hand-over card's browser, pane and carry-on (components/HandOverCard).
     A turn that ended while the person held the browser carries on from the
     card's Done, continue as from the browser's Done (onBrowserControl), and
     only once: the flag that would send it again is cleared first. */
  const handOverBrowserId = liveBrowserId || latestBrowserId;
  /* A Done that waits for the pane's viewer is for the hand-over open when
     it was asked for, and a voice call's browser_done has no card to end its
     wait. So the wait ends when that hand-over is answered mid-turn (the
     browser came back another way: nothing is left to hand back), and when
     the task starts a new turn (whatever waits is for an earlier turn's
     hand-over). A viewer that comes later then never runs an old Done for
     the next hand-over. A turn that ends with its hand-over still open
     leaves the wait alone: that Done still carries the task on
     (onBrowserControl). */
  const openHandOverId = (streamingMsg?.steps || [])
    .find((s) => s.badge === 'AskUser' && !s.data?.answer && isHandOverCard(s.data))?.data?.question_id || null;
  useEffect(() => {
    if (!openHandOverId) return undefined;
    const browser = handOverBrowserId;
    return () => { if (streamingRef.current) dropHandBack(browser); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openHandOverId]);
  const turnSeenRef = useRef({ taskId: null, streaming: false });
  useEffect(() => {
    const before = turnSeenRef.current;
    turnSeenRef.current = { taskId: task.id, streaming: isStreaming };
    if (before.taskId === task.id && !before.streaming && isStreaming) dropHandBack(handOverBrowserId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id, isStreaming]);
  const handOverValue = useMemo(() => ({
    sessionId: handOverBrowserId,
    paneShown: browserOpen && !browserMinimized,
    openBrowser: () => {
      setBrowserMinimized(false);
      if (viewable(handOverBrowserId)) {
        setShownBrowserId(handOverBrowserId);
        // A pane that already gave up on its viewer asks again, so the hand-back gets one or ends.
        setBrowserRetry((n) => n + 1);
      } else {
        // No pane shows this browser here: a hand-back waiting for its viewer ends.
        dropHandBack(handOverBrowserId);
      }
    },
    continueTask: onSend ? () => {
      heldThroughTurnRef.current = false;
      onSend(BROWSER_DONE_MESSAGE);
    } : null,
    stopTask: () => {
      heldThroughTurnRef.current = false;
      if (streamingRef.current) stoppedFromCardRef.current = true;
    },
    agentLabel: harnessLabel(task?.harness) || 'Anton',
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [handOverBrowserId, browserOpen, browserMinimized, onSend, task?.harness, browserOn, liveBrowserId]);

  // The artifact viewer's chat bar (ENG-4227) mirrors the agent's reply to a
  // message it sent into this chat, from these same messages.
  // Quick edits from the artifact viewer, adjacent ones merged into one card.
  const quickEditPlan = planQuickEditCards(visibleMessages);
  const chatTranscript = useTaskTranscript(task);

  return (
    <ChatTranscriptContext.Provider value={chatTranscript}>
    <BrowserHandOverContext.Provider value={handOverValue}>
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
      className={`flex-1 min-h-0 grid grid-rows-[1fr] ${docSide.resizing ? '' : 'transition-[grid-template-columns] duration-layout ease-out'} bg-transparent font-body text-ink-2 relative overflow-hidden ${browserPaneOpen && !paneFloats ? 'grid-cols-[minmax(0,1fr)_minmax(440px,50%)]' : effectiveRailOpen ? 'grid-cols-[minmax(0,1fr)_320px]' : 'grid-cols-[minmax(0,1fr)_0px]'}`}
      // A doc open beside the chat takes the right column (the rail steps aside).
      style={docSide.doc && !isNarrow ? { gridTemplateColumns: docGridColumns(docSide.share, docSide.expanded) } : undefined}
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
        className={`relative overflow-hidden grid ${pane ? 'grid-rows-[1fr]' : phoneDock ? 'grid-rows-[auto_auto_1fr]' : 'grid-rows-[auto_1fr]'} min-w-0 min-h-0`}
      >
        {/* Floating expand-rail button — appears on the right edge of
            the conv column when the rail is collapsed. Mirror of the
            sidebar's hamburger pattern. */}
        {!pane && !railHidden && (<Tooltip content={t('chatView.header.expandPanel')}>
          <button
            type="button"
            onClick={() => railFloats ? setRailNarrowOpen(true) : setRailOpen(true)}
            aria-label={t('chatView.header.expandPanel')}
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
        </Tooltip>)}

        {/* Beside it: the browser icon. With the rail open it sits beside
            its Collapse button instead. */}
        {!pane && !(effectiveRailOpen || railOverlayOpen) && (
          <TopShortcuts
            className="chat-top-shortcuts absolute top-3.5 z-10"
            style={{ right: expandShown ? 44 : 14 }}
            onShowBrowser={showBrowserShortcut ? openBrowserFromShortcut : null}
          />
        )}

        {/* Header — reserve the shell-owned titlebar-safe inset on top so the
            breadcrumbs drop below the macOS traffic lights (and the floating
            open-sidebar button) whenever the sidebar isn't docked over that
            corner, staying left-aligned with the transcript below. `--titlebar-
            safe-top` is set on <main> by the shell and is 0 when the sidebar/
            rail covers the zone, so max() keeps the normal 14px padding then. */}
        {!pane && (<div
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
                    label={t('chatView.header.apps')}
                    onClick={() => onNavigateToConnectors?.()}
                    title={t('chatView.header.connectAppsAndData')}
                  />
                );
              }
              return (
                <>
                  <CrumbButton
                    label={t('chatView.header.projects')}
                    onClick={() => onOpenProjectsList?.()}
                    title={t('chatView.header.allProjects')}
                  />
                  {project?.name && (
                    <>
                      <CrumbSep />
                      <CrumbButton
                        label={projectLabel(project)}
                        onClick={() => onOpenProject?.(project)}
                        title={t('chatView.header.openProject', { project: projectLabel(project) })}
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
                <Tooltip content={t('chatView.header.taskMenu')}>
                  <button
                    ref={settingsBtnRef}
                    type="button"
                    aria-label={t('chatView.header.taskMenu')}
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
        </div>)}
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

        {phoneDock}

        {isClaudeCodeTask ? (
          <CodingTerminal
            taskId={task.id}
            projectPath={artifactProjectPath}
            message={task.messages?.[0]?.content}
            model={typeof model === 'string' ? model : model?.id}
          />
        ) : (
        <>
        {/* Scrollable conversation. Its end is padded by the measured
            height of the floating composer (useDockInset), so the last
            reply always scrolls clear however tall the draft grows. */}
        <ChatScroller
          stick={stick}
          minimap={!pane}
          scrollProps={{ 'data-scroll': 'true' }}
          className={`scroll-clean ${pane ? 'pt-4' : 'pt-8'} bg-transparent [-webkit-app-region:no-drag] select-text`}
        >
          <div className="chat-transcript-col chat-column flex flex-col gap-7">
            {task.hasMoreMessages && (
              // Adapted from Sidebar's dashed-pill "Show more" idiom.
              <button
                type="button"
                ref={loadEarlierSentinelRef}
                onClick={() => onLoadEarlierMessages?.()}
                disabled={loadingEarlierMessages}
                className="mt-0 mx-0 mb-1 py-[7px] px-2.5 bg-transparent border border-dashed border-line-2 rounded-[7px] text-ink-3 font-[family-name:var(--font-body)] text-[12px] cursor-pointer flex items-center justify-center gap-2 hover:bg-surface-2 hover:border-line hover:text-ink disabled:opacity-60 disabled:cursor-default [transition:background_120ms_ease,color_120ms_ease,border-color_120ms_ease]"
              >
                <span>{loadingEarlierMessages ? t('chatView.transcript.loading') : t('chatView.transcript.loadEarlier')}</span>
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
                // An old quick-edit request: the card after it shows it.
                if (quickEditPlan.hidden.has(i)) return null;
                const orphan = isOrphanUser(i);
                // A question the server never saw has no id; it is removed
                // locally, by the row itself, once nothing is streaming.
                const neverSent = !m.id && !isStreaming
                  && (m._unsent || String(task?.id ?? '').startsWith('tmp-'));
                let deleteThisTurn = null;
                if (orphan && !deleteInFlight && onDeleteTurn && m.id) deleteThisTurn = () => onDeleteTurn(m.id);
                else if (orphan && !deleteInFlight && onDeleteTurn && neverSent) deleteThisTurn = () => onDeleteTurn({ localRow: m });
                return (
                  <CoworkUserTurn
                    key={messageKey(m, i)}
                    turnId={messageKey(m, i)}
                    content={m.content}
                    attachments={m.attachments}
                    projectName={project?.name}
                    projectId={project?.id}
                    conversationId={task?.id}
                    // Only the last turn can still be the one being worked on,
                    // and only then does "Making changes" describe the present.
                    streaming={isStreaming && i === lastTurnIdx}
                    // A row the server has seen is hidden until it has an id, not
                    // sent to 422; no turn offers a delete while one is out.
                    onDelete={deleteThisTurn}
                    deleting={isTurnBeingDeleted(i)}
                    isLast={i === lastTurnIdx}
                    addonLabel={m._addon ? t(`chatView.addon.${addonRowLabel('saved').key}`, { agent: agentLabel || 'Anton' }) : null}
                    onOpenArtifact={handleArtifactOpen}
                    onEdit={pane ? null : (text) => {
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
                      <WorkingIndicator label={m._label || t('chatView.transcript.thinking')} />
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
                    title={m.content || t('chatView.transcript.connect')}
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
                          ? () => onSwitchToAirAndResend(balanceResend.text, balanceResend.attachments, balanceResend.docContext)
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
                /* A spending budget is used up: Budgets, not funds,
                   and Air while its free allowance has room. */
                if (m.code === 'budget_exceeded') {
                  const budgetResend = lastUserMessageBefore(visibleMessages, i);
                  return (
                    <BudgetExceededCard
                      key={messageKey(m, i)}
                      deleting={deletingThisTurn}
                      time={formatMetaTime(m.createdAt)}
                      agentLabel={agentLabel}
                      usage={hubUsage?.usage}
                      budgetScope={m.budgetScope}
                      budgetPeriod={m.budgetPeriod}
                      budgetModelLabel={m.budgetModel ? budgetModelName(m.budgetModel, modelLabels) : null}
                      onSwitchToAir={
                        onSwitchToAirAndResend && budgetResend && taskModelId !== MINDSHUB_AIR_MODEL_ID
                          ? () => onSwitchToAirAndResend(budgetResend.text, budgetResend.attachments)
                          : undefined
                      }
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
                if (m.code === 'model_access_denied' || m.code === 'model_disabled' || m.code === 'model_restricted'
                  || m.code === 'model_not_in_tier') {
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
                      isBillingOwner={isBillingOwner}
                      requiredTier={m.requiredTier ?? null}
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
                      onRetry={resend && sendAgain ? () => sendAgain(resend.text, resend.attachments, resend.docContext, resend.output) : undefined}
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
                      kind={t('chatView.kinds.model')}
                      title={badModel ? t('chatView.errors.modelNotFoundNamedTitle', { model: badModel }) : t('chatView.errors.modelNotFoundTitle')}
                      body={!PLATFORM_UI
                        ? t('chatView.errors.modelNotFoundOperatorBody')
                        : badModel
                          ? t('chatView.errors.modelNotFoundNamedBody', { model: badModel })
                          : t('chatView.errors.modelNotFoundBody')}
                      /* With platform UI on, offer Open Settings only.
                         cowork-server does apply a turn's
                         own model (the request's `model`, handed to
                         providers.build_llm_client as `model_override`), so a
                         "Switch to MindsHub Air" here would move this one task.
                         The dead id lives in the planning_model setting, though,
                         and every new task would fail on it again, so the card
                         sends the user to where the id is set. */
                      buttons={PLATFORM_UI ? [
                        { label: t('chatView.cards.openSettings'), onClick: () => onOpenSettings?.('agent'), primary: true },
                      ] : []}
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
                      kind={t('chatView.kinds.attachment')}
                      title={t('chatView.errors.imageFormatTitle')}
                      body={t('chatView.errors.imageFormatBody')}
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
                      kind={t('chatView.kinds.conversation')}
                      title={t('chatView.errors.contentRecoveryTitle')}
                      body={t('chatView.errors.contentRecoveryBody')}
                      buttons={resend && sendAgain
                        ? [{ label: t('chatView.cards.tryAgain'), onClick: () => sendAgain(resend.text, resend.attachments, resend.docContext, resend.output), primary: true }]
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
                      kind={t('chatView.kinds.attachment')}
                      title={t('chatView.errors.contentTooLargeTitle')}
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
                      kind={PLATFORM_UI ? t('chatView.kinds.billing') : t('chatView.kinds.provider')}
                      title={PLATFORM_UI ? t('chatView.errors.billingUnavailableTitle') : t('chatView.cards.providerUnavailableTitle')}
                      body={PLATFORM_UI
                        ? t('chatView.errors.billingUnavailableBody')
                        : t('chatView.errors.providerUnauthorizedBody')}
                      buttons={resend && sendAgain
                        ? [{ label: t('chatView.cards.tryAgain'), onClick: () => sendAgain(resend.text, resend.attachments, resend.docContext, resend.output), primary: true }]
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
                      kind={t('chatView.kinds.agent')}
                      title={t('chatView.errors.workerUnresponsiveTitle')}
                      body={t('chatView.errors.workerUnresponsiveBody')}
                      buttons={resend && sendAgain
                        ? [{ label: t('chatView.cards.tryAgain'), onClick: () => sendAgain(resend.text, resend.attachments, resend.docContext, resend.output), primary: true }]
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
                      kind={t('chatView.kinds.agent')}
                      title={t('chatView.errors.modelTimeoutTitle')}
                      body={PLATFORM_UI
                        ? t('chatView.errors.modelTimeoutBody')
                        : t('chatView.errors.modelTimeoutOperatorBody')}
                      buttons={[
                        ...(resend && sendAgain
                          ? [{ label: t('chatView.cards.tryAgain'), onClick: () => sendAgain(resend.text, resend.attachments, resend.docContext, resend.output), primary: true }]
                          : []),
                        ...(PLATFORM_UI ? [{ label: t('chatView.cards.openSettings'), onClick: () => onOpenSettings?.('agent') }] : []),
                      ]}
                    />
                  );
                }
                /* The server stopped while the turn ran (`turn_lost`): a
                 * shutdown or a crash. The answer above ends where it was cut
                 * off, and nothing about the question failed, so Try again
                 * sends it again. A proxy that outlives a crash sends this
                 * code live; boot recovery saves it for a reload. */
                if (m.code === 'turn_lost') {
                  const resend = lastUserMessageBefore(visibleMessages, i);
                  return (
                    <ActionCard
                      key={messageKey(m, i)}
                      deleting={deletingThisTurn}
                      time={formatMetaTime(m.createdAt)}
                      agentLabel={agentLabel}
                      kind={t('chatView.kinds.agent')}
                      title={t('chatView.errors.turnLostTitle')}
                      body={t('chatView.errors.turnLostBody')}
                      buttons={resend && sendAgain
                        ? [{ label: t('chatView.cards.tryAgain'), onClick: () => sendAgain(resend.text, resend.attachments, resend.docContext, resend.output), primary: true }]
                        : []}
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
                      kind={t('chatView.kinds.agent')}
                      title={t('chatView.errors.stalledTitle')}
                      body={<>
                        {t('chatView.errors.stalledBody', { product: productName('Cowork') })}
                        {m._reconnecting && <Reconnecting />}
                      </>}
                      buttons={resend && !turnMayBeRunning && sendAgain
                        ? [{ label: t('chatView.cards.tryAgain'), onClick: () => sendAgain(resend.text, resend.attachments, resend.docContext, resend.output), primary: true }]
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
                // A Plus or Pro window used up with an empty wallet (gateway
                // 429 `window_allowance_exhausted`, ENG-4186): paused until
                // the window frees up, with funds and Pro as ways on.
                if (m.code === 'window_allowance_exhausted') {
                  return (
                    <WindowAllowanceExhaustedCard
                      key={messageKey(m, i)}
                      deleting={deletingThisTurn}
                      time={formatMetaTime(m.createdAt)}
                      agentLabel={agentLabel}
                      resetAt={m.resetAt}
                      allowanceWindow={m.allowanceWindow ?? null}
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
                      onRetry={rlResend && sendAgain ? () => sendAgain(rlResend.text, rlResend.attachments, rlResend.docContext, rlResend.output) : undefined}
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
                      kind={t('chatView.kinds.server')}
                      title={t('chatView.errors.serverBusyTitle')}
                      body={m.content}
                      retryAt={m.retryAt}
                      onRetry={busyResend && sendAgain ? () => sendAgain(busyResend.text, busyResend.attachments, busyResend.docContext, busyResend.output) : undefined}
                    />
                  );
                }
                /* A proxy in front of the server refused the question with a
                   503 `cowork_unavailable`: it could open no connection to the
                   server, as while the server starts again after a crash.
                   Nothing reached the server, so waiting is the fix, with the
                   same Retry gate counted down to the proxy's Retry-After. */
                if (m.code === 'cowork_unavailable') {
                  const unavailableResend = lastUserMessageBefore(visibleMessages, i);
                  return (
                    <RateLimitedCard
                      key={messageKey(m, i)}
                      deleting={deletingThisTurn}
                      time={formatMetaTime(m.createdAt)}
                      agentLabel={agentLabel}
                      kind={t('chatView.kinds.server')}
                      title={t('chatView.errors.coworkUnavailableTitle')}
                      body={m.content}
                      retryAt={m.retryAt}
                      onRetry={unavailableResend && sendAgain
                        ? () => sendAgain(unavailableResend.text, unavailableResend.attachments, unavailableResend.docContext, unavailableResend.output)
                        : undefined}
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
                      <div>{m.content}{m._reconnecting && <Reconnecting />}</div>
                      {m.requestId && (
                        <div
                          className="mt-1 text-xs flex items-center gap-2 flex-wrap"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          <span>{t('chatView.errors.reference', { id: m.requestId })}</span>
                          <CopyDiagnosticsButton
                            requestId={m.requestId}
                            code={m.code}
                            health={health}
                          />
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
              // Quick edits from the artifact viewer's bar (ENG-4227): one
              // card per burst, without a turn's toolbar or agent label.
              // Adjacent cards are drawn as one, at the first (planQuickEditCards).
              if (quickEditPlan.hidden.has(i)) return null;
              const quickEditGroup = quickEditPlan.cards.get(i);
              if (quickEditGroup) {
                return (
                  <div key={messageKey(m, i)} className={deletingThisTurn ? 'opacity-60' : undefined}>
                    <QuickEditGroupCard
                      group={quickEditGroup}
                      onOpenArtifact={handleArtifactOpen}
                      conversationId={deletingThisTurn ? undefined : task.id}
                    />
                  </div>
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
                  conversationId={task.id}
                  messageId={m.id}
                  // Anchored on this assistant message's own id; hidden, not
                  // disabled, without one. A partial kept after a transport
                  // failure whose recovery also failed has none until reload.
                  onDelete={m.id && !deleteInFlight ? () => onDeleteTurn?.(m.id) : null}
                  deleting={deletingThisTurn}
                  agentLabel={harnessLabel(m.harness) || t('chatView.turn.agentFallback')}
                  isLast={i === lastTurnIdx}
                >
                  {/* Above the text: a question is asked, then answered, then
                      (at most) the turn's closing text streams — so every
                      card and block precedes the text that came after. */}
                  {justFinished(m) && m._leavingTake && <FirstTake take={null} leavingText={m._leavingTake} />}
                  <TurnSegments
                    steps={m.steps}
                    startedAt={m.startedAt}
                    endedAt={m.endedAt}
                    conversationId={task.id}
                    // A completed turn by construction — `visibleMessages`
                    // excludes the `_streaming` row — so no question rendered
                    // here belongs to the live turn, whatever else is in flight
                    // on this conversation.
                    conversationLive={false}
                    // Only the latest turn, with nothing in flight, can still
                    // take an answer to a question that timed out: once a newer
                    // message is sent, the conversation has moved past it. And
                    // only where a message can be sent: a comparison pane whose
                    // side takes no message right now gets no onSend.
                    reopenable={!!onSend && i === lastTurnIdx && !isStreaming && !inFlightSet?.has(task.id)}
                    reply={visibleMessages[i + 1]?.role === 'user' && typeof visibleMessages[i + 1].content === 'string'
                      ? visibleMessages[i + 1].content
                      : null}
                    onAnswered={onQuestionAnswered}
                    // [] so a pick does not take the composer's staged files.
                    onAnswerAsMessage={(text) => onSend?.(text, [])}
                    onActivateStep={activateStep(messageKey(m, i))}
                    agentLabel={agentLabel}
                    idPrefix={messageKey(m, i)}
                    // Only right after it finished live: reopening the task
                    // later shows the steps already folded.
                    collapseOnMount={justFinished(m)}
                    imageSource={generatedImageSource}
                  />
                  <TextBlock
                    text={m.content}
                    id={m.id || `msg-${i}`}
                    complete
                    conversationId={task.id}
                    figureSources={m.figureSources}
                    steps={m.steps}
                    onOpenStep={(stepId) => setOpenScratchpadStepId(prefixId(messageKey(m, i), stepId))}
                    onViewFile={setFigureFileSource}
                    projectId={project?.id ?? null}
                    projectName={project?.name ?? null}
                    showFigureSources={showFigureSources}
                  />
                  {m.artifact && (
                    <ArtifactCard
                      artifact={normalizeArtifactRecord(m.artifact, artifactProjectPath)}
                      onOpen={handleArtifactOpen}
                      onShare={handleArtifactShare}
                      inlineSuperseded={isSupersededInline(latestInlineArtifact, m.artifact, i, MESSAGE_CARD_SLOT)}
                      onInlineSubmit={handleInlineSubmit}
                    />
                  )}
                  <StepArtifacts steps={m.steps} onOpen={handleArtifactOpen} onShare={handleArtifactShare} projectPath={artifactProjectPath} activeDocId={docSide.doc?.artifactId} latestInline={latestInlineArtifact} messageIndex={i} onInlineSubmit={handleInlineSubmit} />
                  <StepSkills steps={m.steps} latestByKey={latestSkillCardByKey} messageIndex={i} projectName={project?.name} />
                  <StepConnectorDrafts steps={m.steps} onConnect={onConnectCustomConnector} />
                  {(() => {
                    if (!onSend || !offersNextSteps({
                      isLatest: i === lastTurnIdx,
                      inFlight: isStreaming || !!inFlightSet?.has(task.id),
                      answer: m,
                      followedByFailure: visibleMessages.slice(i + 1)
                        .some((row) => row.role === 'error' || row.role === 'provider_required'),
                    })) return null;
                    let u = i - 1;
                    while (u >= 0 && visibleMessages[u].role !== 'user') u -= 1;
                    const userMessage = u >= 0 ? visibleMessages[u] : null;
                    const firstUserIdx = visibleMessages.findIndex((row) => row.role === 'user');
                    const { resultKind, steps } = nextStepsFor({
                      firstUserText: firstUserIdx >= 0 ? visibleMessages[firstUserIdx].content : '',
                      userMessage,
                      // Only when the history is loaded from its start can
                      // the first loaded message be the conversation's first.
                      isFirstTurn: !task.hasMoreMessages && u >= 0 && u === firstUserIdx,
                      answer: m,
                    }, { canSchedule: !!onScheduleFromChat && !!scheduledPromptFor(userMessage) });
                    const answerKey = `${task.id}:${messageKey(m, i)}`;
                    return (
                      <NextSteps
                        answerKey={answerKey}
                        resultKind={resultKind}
                        steps={steps}
                        onSend={onSend}
                        onSchedule={() => onScheduleFromChat?.({
                          prompt: scheduledPromptFor(userMessage),
                          projectId: task.projectId ?? null,
                          answerKey,
                        })}
                      />
                    );
                  })()}
                  {m.incompleteReason && (
                    // role="note": a saved answer's notice must not be announced again on every reload.
                    // A Stop is the person's own choice, so it reads as a plain note, not a warning.
                    <Alert
                      variant={m.incompleteReason === 'user_stopped' ? 'info' : 'warning'}
                      role="note"
                      icon={m.incompleteReason === 'user_stopped' ? undefined : Ico.warning(16)}
                      className="mt-2"
                      data-testid="incomplete-reason"
                    >
                      {t(INCOMPLETE_REASON_KEYS[m.incompleteReason] || 'chatView.incomplete.fallback')}
                    </Alert>
                  )}
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
                {/* The instant first take; the adapter drops it once Anton
                    writes, asks the user, or the turn ends. */}
                <FirstTake take={streamingMsg.firstTake} />
                <TurnSegments
                  steps={streamingMsg.steps}
                  startedAt={streamingMsg.startedAt}
                  conversationId={task.id}
                  conversationLive={isStreaming || !!inFlightSet?.has(task.id)}
                  onAnswered={onQuestionAnswered}
                  onActivateStep={activateStep(streamingKey)}
                  idPrefix={streamingKey}
                  agentLabel={agentLabel}
                  onMoveAddonToQueue={onMoveAddonToQueue}
                  imageSource={generatedImageSource}
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
                <StepArtifacts steps={streamingMsg.steps} onOpen={handleArtifactOpen} onShare={handleArtifactShare} projectPath={artifactProjectPath} activeDocId={docSide.doc?.artifactId} live latestInline={latestInlineArtifact} messageIndex={visibleMessages.length} onInlineSubmit={handleInlineSubmit} />
                <StepSkills steps={streamingMsg.steps} latestByKey={latestSkillCardByKey} messageIndex={visibleMessages.length} projectName={project?.name} />
                <StepConnectorDrafts steps={streamingMsg.steps} onConnect={onConnectCustomConnector} />
              </AnswerTurn>
            ) : isStreaming && (
              <AnswerTurn state="thinking" showActions={false}>
                <WorkingIndicator label={t('chatView.transcript.streaming')} />
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
              {deleteInFlight ? t('chatView.transcript.deletingExchange') : ''}
            </div>
          </div>
        </ChatScroller>

        {/* Floating composer — no gradient fade behind it. Earlier we
            had a 220px linear-gradient(transparent → var(--bg)) overlay
            so messages would soften into the bg above the composer, but
            with the gravity-field showing through it read as a dark
            band at the bottom of the chat. The composer's own border +
            shadow give enough visual separation on its own. */}
        {!pane && (<div ref={dockRef} className="chat-floating-composer absolute left-10 right-10 max-sm:left-3.5 max-sm:right-3.5 bottom-[22px] flex flex-col items-center gap-2 pointer-events-auto [--composer-max-width:720px]">
          {/* Queued-messages strip — pills with each waiting prompt
              + a × to drop it. The pills cross-fade in/out so the
              transition between queue states reads as deliberate. */}
          {shownQueue.length > 0 && (
            <div className="w-full max-w-[720px] flex flex-col gap-1.5 py-2.5 px-3 rounded-[14px] bg-[color-mix(in_srgb,var(--accent)_8%,var(--surface))] border border-solid border-[color-mix(in_srgb,var(--accent)_22%,var(--line))] shadow-[0_8px_24px_rgba(0,0,0,0.10)] animate-[queue-pop-in_var(--dur-layout)_var(--ease-out)]">
              <div className="section-label text-accent flex items-center gap-1.5">
                <span className="pulse-dot w-1.5 h-1.5 rounded-full bg-accent shadow-[0_0_6px_var(--accent-glow)]" />
                {t('chatView.queue.status', { count: shownQueue.length, agent: agentLabel || 'Anton' })}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {shownQueue.map((q) => (
                  <span
                    key={q.id}
                    // The full text on hover, unless the chip has a reason to
                    // show there: two tooltips at once overlap (ENG-4194).
                    title={queuedReasonKey(q.queuedReason) || q.unconfirmed ? undefined : q.text}
                    data-testid="queued-chip"
                    data-paused={q.paused || undefined}
                    aria-busy={q.addonPending || undefined}
                    className={`inline-flex items-center gap-1.5 max-w-full pt-[5px] pr-1 pb-[5px] pl-3 rounded-full bg-surface border border-solid border-line font-body text-sm text-ink-2 transition-[background,border-color,opacity] duration-hover ease-[ease]${q.addonPending ? ' opacity-70' : ''}`}
                  >
                    {(() => {
                      const text = <span className="max-w-[360px] overflow-hidden text-ellipsis whitespace-nowrap">{q.text}</span>;
                      // Nobody could say whether it joined the task: it waits
                      // for the person instead of running a second time.
                      if (q.unconfirmed) {
                        return (
                          <Tooltip content={t('chatView.addon.unconfirmed')}>
                            <span className="inline-flex min-w-0" data-testid="queued-unconfirmed">{text}</span>
                          </Tooltip>
                        );
                      }
                      // Why it waits rather than joining the running task (ENG-4194).
                      const why = queuedReasonKey(q.queuedReason);
                      return why ? (
                        <Tooltip content={t(`chatView.addon.queued.${why}`)}>
                          <span className="inline-flex min-w-0" data-testid="queued-reason" data-reason={why}>{text}</span>
                        </Tooltip>
                      ) : text;
                    })()}
                    {/* The person's own override of the queue (ENG-4194), like
                        the Coding view's Steer: only while this task's turn is
                        running, and text only — files always wait. */}
                    {q.unconfirmed && onResendQueued ? (
                      <button
                        type="button"
                        onClick={() => onResendQueued(q.id)}
                        title={t('chatView.addon.unconfirmed')}
                        className="py-0 px-2 rounded-full bg-transparent border border-solid border-line text-ink-2 font-body text-[12px] cursor-pointer flex-shrink-0 hover:bg-surface-2 hover:text-ink"
                      >{t('chatView.addon.sendAgain')}</button>
                    ) : null}
                    {q.addonPending ? (
                      <span role="status" className="text-ink-3 text-[12px] px-1" aria-label={t('chatView.addon.addingToTask')}>…</span>
                    ) : (onAddQueuedToTask && isStreaming && !q.paused && !String(task?.id ?? '').startsWith('tmp-') && !(q.attachments || []).length && !needsOwnTurn(q) && (
                      <Tooltip content={t('chatView.addon.addToTask')}>
                        <button
                          type="button"
                          onClick={() => onAddQueuedToTask(q.id)}
                          aria-label={t('chatView.addon.addToTask')}
                          className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-transparent border-0 text-ink-4 cursor-pointer flex-shrink-0 hover:bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] hover:text-accent"
                        >{Ico.arrowUpLeft(12)}</button>
                      </Tooltip>
                    ))}
                    <Tooltip content={t('chatView.queue.remove')}>
                      <button
                        type="button"
                        onClick={() => onRemoveFromQueue?.(q.id)}
                        aria-label={t('chatView.queue.remove')}
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
            onAddSharePointFiles={onAddSharePointFiles}
            conversationId={task.id}
            disabledConnections={disabledConnections ?? task.disabledConnections ?? []}
            onUpdateConnectorMute={onUpdateConnectorMute}
            onStartVoiceCall={onStartVoiceCall}
            dictationAvailable={dictationAvailable}
            browserSwitch={browserSwitch}
            onRemoveAttachment={onRemoveAttachment}
            placeholder={t('chatView.composer.replyPlaceholder')}
            metaReadOnly
            modelReadOnly={false}
            hideMeta
            streaming={isStreaming}
            onStop={stopTurn}
            prefill={composerPrefill}
            onOpenSettings={onOpenSettings}
            codingModelDefault={codingModelDefault}
            harnessClaudeCodeEnabled={harnessClaudeCodeEnabled}
            onTypingChange={warmsBrowser ? (typing) => { if (typing) warmBrowser(task.id); } : undefined}
          />
        </div>)}
        </>
        )}
      </div>

      {!pane && (<>
      {/* ─── Shared browser ─── takes the right-hand column while open (on
          a phone it docks at the top of the chat instead: phoneDock). */}
      {!browserDock && browserNode}

      {/* ─── Right rail ─── */}
      {/* On narrow screens: translucent backdrop behind the overlay rail */}
      {railFloats && (
        <div
          onClick={() => setRailNarrowOpen(false)}
          className="fixed inset-0 z-50 bg-[rgba(0,0,0,0.35)] backdrop-blur-[2px] transition-opacity duration-layout ease-out [-webkit-app-region:no-drag]"
          style={{
            opacity: railOverlayOpen ? 1 : 0,
            pointerEvents: railOverlayOpen ? 'auto' : 'none',
          }}
        />
      )}
      {docSide.doc && (
        <DocColumn side={docSide} narrow={isNarrow} areaRef={chatRef} />
      )}
      <aside
        /* Narrow: fixed overlay that slides in from the right.
           Wide: inline grid column.
           While the shared browser holds the right-hand column on a wide
           screen, the docked rail steps aside rather than add a third grid
           track. A floating rail takes no track, so it still opens. */
        className={`chat-rail-aside flex flex-col gap-2.5 pt-3.5 px-3.5 pb-[22px] overflow-x-hidden overflow-y-auto [-webkit-app-region:no-drag] ${railHidden ? 'hidden ' : ''}${
          railFloats
            ? 'fixed top-[9px] bottom-[9px] right-[9px] w-[min(85vw,320px)] z-[51] bg-surface border border-solid border-line rounded-[14px] shadow-sh-2 transition-transform duration-layout ease-out'
            : 'bg-transparent min-w-0 transition-opacity duration-layout ease-[ease]'
        }`}
        style={railFloats ? {
          transform: railOverlayOpen ? 'translateX(0)' : 'translateX(calc(100% + 18px))',
        } : {
          visibility: effectiveRailOpen ? 'visible' : 'hidden',
          opacity: effectiveRailOpen ? 1 : 0,
          // The doc open beside the chat holds this column.
          ...(docSide.doc ? { display: 'none' } : null),
        }}
      >
        {/* Rail header bar — collapse button. Stays visible on mobile
            so the user has an explicit way to dismiss the rail (which
            on phone hosts the data-vault form fullscreen). The
            FLOATING expand button outside is the one hidden via
            .chat-rail-toggle in globals.css. */}
        <div className="chat-rail-close-row flex items-center justify-end flex-shrink-0">
          {!pane && (
            <TopShortcuts
              onShowBrowser={showBrowserShortcut ? openBrowserFromShortcut : null}
            />
          )}
          <Tooltip content={t('chatView.header.collapsePanel')}>
            <button
              type="button"
              className="chat-rail-close"
              onClick={() => railFloats ? setRailNarrowOpen(false) : setRailOpen(false)}
              aria-label={t('chatView.header.collapsePanel')}
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
          onActivateStep={activateStep(railMsgKey)}
        />
        <WorkingFolderBox
          project={project}
          isStreaming={isStreaming}
          conversationId={task?.id || null}
          onAddressWithAgent={({ prompt }) => onSend?.(prompt)}
          onOpenDoc={docSide.open}
        />
        <ContextBox
          projects={projects}
          project={project}
          conversationId={task?.id}
          refreshKey={contextRefreshKey}
          onAddGoogleDriveFiles={onAddGoogleDriveProjectFiles}
          onAddSharePointFiles={onAddSharePointFiles}
          onFetchGoogleDriveFiles={onFetchGoogleDriveProjectFiles}
          onRemoveGoogleDriveFile={onRemoveGoogleDriveProjectFile}
          onAddNotionPages={onAddNotionProjectPages}
          onFetchNotionPages={onFetchNotionProjectPages}
          onRemoveNotionPage={onRemoveNotionProjectPage}
        />
      </aside>
      </>)}

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

      {/* The file a figure's source read, opened from the figure's popover;
          one viewer for the whole chat. The agent named the file, so the
          viewer offers no Open (it hands the file to the OS default app). No
          Edit or Delete either: the file is the figure's evidence, and the
          Context card's list would not hear of a change. */}
      <ContextFileModal
        open={figureFileSource != null}
        {...figureFileViewerProps(figureFileSource, project?.name, artifactProjectPath, task?.id)}
        showOpenAction={false}
        showEditAction={false}
        remover={null}
        note={figureFileNote(figureFileSource)}
        onClose={() => setFigureFileSource(null)}
      />

      {/* A generated image opened from its inline card (ENG-4024). Read only:
          the picture is the agent's output, and edits belong in a new turn.
          The agent named the path, so, as in the figure viewer, no Open (it
          hands the file to the OS default app). */}
      <ContextFileModal
        open={openImagePath != null}
        projectName={project?.name}
        projectPath={artifactProjectPath}
        filePath={openImagePath || ''}
        showOpenAction={false}
        showEditAction={false}
        remover={null}
        onClose={() => setOpenImagePath(null)}
      />

      {/* Inline ArtifactCard viewer — same modal the Live artifacts
          page and the Working folder card use. The card only routes
          HTML here; non-HTML opens straight in the OS via openPath. */}
      <ArtifactViewer
        open={!!previewArt}
        artifact={previewArt}
        shareRequest={previewShare}
        shareEntry={previewShare ? 'chat_card' : 'viewer'}
        viewRequest={previewViewRequest}
        onInlineSubmit={handleInlineSubmit}
        onClose={() => { setPreviewArt(null); setPreviewShare(null); setPreviewViewRequest(null); }}
        onChange={(updated) => setPreviewArt(updated)}
        conversationId={task?.id || null}
        onAddressWithAgent={({ prompt }) => onSend?.(prompt)}
      />

      {/* Data-vault connection form — a centered modal so it's
          front-and-center when a connector is picked. The panel draws its
          own header (breadcrumb + X) and actions. */}
      <Modal
        open={formActive}
        onClose={() => (onDismissConnectForm
          ? onDismissConnectForm(task?.id || '')
          : clearDataVaultForm(task?.id || ''))}
        size="sm"
        width="min(90vw, 460px)"
        maxHeight="85vh"
        ariaLabel={t('chatView.transcript.connect')}
      >
        <ModalBody padding="0">
            <FormErrorBoundary>
              <DataVaultFormPanel
                conversationId={task?.id || ''}
                onContinue={(payload) => onSend?.(payload?.text || '[form action]')}
                onSubmit={onSubmitDataVaultForm}
                onNavigateToConnectors={onNavigateToConnectors}
                onClose={onDismissConnectForm}
                /* Only in a conversation the agent can carry on in the
                   browser: not a connect form opened from the picker. */
                onUseBrowser={onSend && browserOn && (host.isWeb || host.supportsInAppBrowser)
                  && task?.id && !String(task.id).startsWith('tmp-connect-')
                  ? ({ name, url }) => {
                    if (onDismissConnectForm) onDismissConnectForm(task.id);
                    else clearDataVaultForm(task.id);
                    onSend(browserInsteadRequest(name, url));
                  }
                  : undefined}
              />
            </FormErrorBoundary>
        </ModalBody>
      </Modal>
    </div>
    </BrowserHandOverContext.Provider>
    </ChatTranscriptContext.Provider>
  );
}
