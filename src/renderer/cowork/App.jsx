import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { flushSync } from 'react-dom';
import Ico from './components/Icons';
import MoveToProjectModal from './components/MoveToProjectModal';
import { pickConnectWelcome } from './lib/connectWelcomes';
import { isAntonConfigError, normalizeAntonError } from './lib/antonErrors';
import { mergeTasksFromServer } from './lib/mergeTasks';
// OnboardingShell removed — the desktop shell's renderer handles terms/install/
// provider setup. The cowork app is mounted by CoworkApp.tsx only after
// those gates pass, so AppCore renders unconditionally here.
import Sidebar from './components/Sidebar';
import ThemeModal from './components/ThemeModal';
import AppShell from './components/AppShell';
import { ConfirmModal } from './components/ConfirmModal';
import { Modal, ModalHeader, ModalBody, ModalFooter } from './components/ui/Modal';
import { Button, Tooltip } from './components/ui';
import { ToastProvider, useToastManager } from './components/ui/Toast';
import HomeView from './views/HomeView';
import ChatView from './views/ChatView';
import ProjectsView from './views/ProjectsView';
import ScheduledView from './views/ScheduledView';
import TasksView from './views/TasksView';
import ScheduleDetailView from './views/ScheduleDetailView';
import ArtifactsView from './views/ArtifactsView';
import CustomizeView from './views/CustomizeView';
import SettingsView from './views/settings/SettingsView';
import UtilitiesView from './views/UtilitiesView';
import SkillsView from './views/SkillsView';
import SearchModal from './components/SearchModal';
import ConnectorPicker from './components/connector/ConnectorPicker';
import ServerOfflineHelpModal from './components/ServerOfflineHelpModal';
import ComingSoonModal from './components/ComingSoonModal';
import { setForm as setDataVaultForm, getForm as getDataVaultForm, clearForm as clearDataVaultForm, patchForm as patchDataVaultForm, getFormState as getDataVaultFormState, setFormState as setDataVaultFormState, getSelectedMethod as getDataVaultSelectedMethod, setSelectedMethod as setDataVaultSelectedMethod, subscribe as subscribeDataVaultForm } from './components/datavault/formStore';
import { extractFormSpec } from './components/datavault/parseFormSpec';
import { host } from '../platform/host';
import { applyNavTitleColor } from '../lib/navBranding';
import { getAgentLabel } from './lib/agentLabel';
import { resolveTaskProject } from './lib/resolveTaskProject';
import { selectNextQueuedTask, mergeQueuesForAdoptedId, reservationReleaseDecision, finishedCids } from './lib/messageQueue';
import { loadCachedSettings } from './lib/settingsCache';
import { useOrgMode } from '../lib/orgMode';
import { clearDraft, moveDraft } from './lib/draftStore';
import { useBreakpoint } from './hooks/useBreakpoint';
import { useGoogleDrivePicker } from './hooks/useGoogleDrivePicker';
import { useViewportZoomLock } from './hooks/useViewportZoomLock';
import { useBootDecisions } from './hooks/useBootDecisions';
import { useServerControl } from './hooks/useServerControl';
import { useSidebarNav } from './hooks/useSidebarNav';
import { useSso } from './hooks/useSso';
import { useAccountUser } from './hooks/useAccountUser';
import { useHubUsage } from './hooks/useHubUsage';
import { HubUsageContext } from './lib/hubUsageContext';
import { usageTransitions } from './lib/usageWarnings';
import { useThemeSkin } from './hooks/useThemeSkin';
import { useAppUpdates } from './hooks/useAppUpdates';
import { deriveUpdateBanner } from '../../shared/update-banner';
import { useSchedules } from './hooks/useSchedules';
import { fetchSessions, fetchSession, fetchConversationList, fetchProjects, fetchArtifacts, fetchSettings, fetchHealth,
         createProject, updateSettings, streamNewSession, streamMessage,
         streamDataVaultSubmission,
         allocateConversationId, uploadAttachments,
         deleteAttachment, searchCowork, fetchPins, pinTask, unpinTask,
         recordTaskVisit,
         runScheduleNow, fetchDatasources, MOCK_DATA,
         renameConversation, deleteConversation, deleteConversationTurn, moveConversation, moveTaskToProject,
         deleteProject, cancelScratchpad, cancelResponse, fetchConnector,
         fetchSavedConnection, deleteDatasource, deletePickedFile,
         fetchInFlightStatus, tailInFlight, fetchInFlightList, submitAnswer,
         fetchRecommendedModels, createConversation, revealSettingKey } from './api';
import { initialStreamState, reduceStream } from './lib/responseStreamAdapter';
import {
  stripStreaming,
  reconcileTaskMessages,
  removeThinkingPlaceholder,
  withThinkingPlaceholder,
  markActivityDone,
  applySessionMessages,
  persistTurnState,
  mergeConvTurns,
} from './lib/conversationHistory';
import { noteArtifactsFromSteps } from './lib/artifactsStore';
import { isArtifactTipDismissed, dismissArtifactTip, dismissIfUntouched } from './components/onboarding/onboardingStore';
import { recommendedModelOptions, providerValueToType,
         mergeRecommendedModels } from './lib/settingsTransform';
import { trackDataSourceConnected, trackArtifactBuilt, trackAgentSessionStarted, trackAppInstalled, trackFirstQuery, trackFirstResponse, classifyFirstResponse, trackTurnFailed } from './lib/analytics';
import { MODEL_ROUTER_ID, MODEL_ROUTER, MINDSHUB_AIR_MODEL_ID, isModelLocked } from './lib/modelCatalog';
import {
  CoworkProvider,
  CoworkRouterProvider,
  ConversationUnavailable,
  ConversationLoading,
  createCoworkRouter,
  initialNavState,
  markOptimisticConversation,
  clearOptimisticConversation,
} from './CoworkRouter';
import { Outlet } from 'react-router-dom';

/* One-of-ten encouraging follow-ups picked when a connect task is
 * created. Reads as a friendly nudge after the connect-intro card —
 * keeps the chat surface inviting and signals that the agent is
 * available for free-form questions about the form.
*/
const CONNECT_FOLLOWUPS = [
  "Have a question about any of the fields? I'm happy to explain.",
  "Need help finding your credentials? Just ask.",
  "If anything's unclear, let me know — I can walk you through it.",
  "Curious what a specific field expects? I can clarify.",
  "Want more detail on any of the steps? Just ask.",
  "Have questions before you submit? I'm here.",
  "Want me to explain any of the fields more deeply? Let me know.",
  "Happy to clarify anything before you fill it out.",
  "If you'd like more context on a field, just ask.",
  "Any questions about the setup? I'm here to help.",
];

// Print a version/build banner to the browser console on startup so
// developers and QA can quickly confirm which releases are running.
// UI line prints immediately (build-time). Server versions are fetched
// eagerly from /health so they appear even if AppCore hasn't mounted.
{
  const ui = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '?';
  const hash = typeof __GIT_HASH__ !== 'undefined' && __GIT_HASH__ ? __GIT_HASH__ : '';
  const built = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : '';
  console.log(
    '%c Cowork %c Build Info ',
    'background:#7CC4B6;color:#fff;font-weight:bold;padding:2px 6px;border-radius:3px 0 0 3px',
    'background:#334;color:#eee;padding:2px 6px;border-radius:0 3px 3px 0',
  );
  console.log(`  UI (cowork):  ${ui}${hash ? ` (${hash})` : ''}${built ? `  built ${built}` : ''}`);
  fetchHealth().then((h) => {
    if (!h || h.status === 'offline') return;
    console.log(`  Server (cowork-server):  ${h.server_version || '?'}`);
    console.log(`  Agent (anton-agent):     ${h.anton_version || '?'}`);
  }).catch(() => {});
}

// Build a short context block describing the user's current
// connect-form state. Sent appended to chat messages so the agent
// has continuous awareness of what the user is connecting and how
// far along they are. Secret values are mentioned as "(filled)" or
// "(redacted)" but their actual values are never included.
function describeConnectFormState(state) {
  if (!state) return '';
  const lines = [];
  if (state.title) lines.push(`Connector: ${state.title}`);
  if (state.methodLabel || state.method) {
    lines.push(`Selected method: ${state.methodLabel || state.method}`);
  } else {
    lines.push('Selected method: (none yet)');
  }
  const entries = Object.entries(state.fields || {});
  if (entries.length === 0) {
    lines.push('Filled fields: (none yet)');
  } else {
    const parts = entries.map(([k, v]) =>
      v === '__REDACTED__' ? `${k}: (filled, redacted)` : `${k}: ${v}`
    );
    lines.push(`Filled fields: ${parts.join('; ')}`);
  }
  return [
    '[connect form state — Anton-only context, do not echo back]',
    ...lines,
  ].join('\n');
}

function isPendingFileAttachment(a) {
  return !!(a && a.pendingFile instanceof File);
}

// Google-Drive-picked files aren't uploaded bytes — the agent reads them
// directly via the connector's persisted `_picked_files` grant (see
// cowork-server's harness integration_guidance), independent of any one
// message. The chip is a visual confirmation only, so it must never be
// resolved to an upload or sent as a real attachment id.
function isReferenceOnlyAttachment(a) {
  return !!(a && a.source === 'gdrive');
}

// Activation gate (ENG-736): fire from the chat send/reply terminal handlers,
// not the shared reducer (it also drives non-chat probes and replay).
// trackFirstResponse dedupes once per user; wrapped so analytics can't break the turn.
function fireFirstResponse(result) {
  if (!result) return; // no terminal outcome observed — record nothing
  try {
    trackFirstResponse(result.outcome, result.reason);
  } catch {
    /* analytics must never break the turn */
  }
}

/**
 * The question a turn is currently blocked on, or null.
 *
 * Derived from the live stream steps rather than tracked separately, so it
 * cannot drift: the answered state arrives on an event and clears this by
 * construction.
 *
 * `allow_custom` travels with it because the composer has to know whether typed
 * text can be an answer at all. Absent means true — the same permissive default
 * the adapter applies (`event.allow_custom !== false`), so only an explicit
 * `false` counts as select-only.
 */
export function pendingQuestionFor(steps) {
  const pending = (steps || []).filter(
    (s) => s.badge === 'AskUser' && !s.data?.answer,
  );
  if (pending.length === 0) return null;
  const last = pending[pending.length - 1];
  return {
    question_id: last.data.question_id,
    allow_custom: last.data.allow_custom !== false,
  };
}

/**
 * Text to put back in the composer when a question appears while messages
 * are queued.
 *
 * A message queued before the question existed was written for a different
 * purpose: auto-sending it as the answer would silently pick an option the
 * user never chose, and leaving it queued deadlocks (the queue drains on turn
 * completion, which cannot happen while the question is pending). So it goes
 * back to the user to decide.
 */
export function drainQueueToInput(queued) {
  return (queued || []).map((m) => m.text).filter(Boolean).join('\n');
}

/**
 * The files those same queued messages were carrying.
 *
 * `enqueueMessage` deliberately stores `attachments` with each item, because a
 * queue that held text only lost the user's files. Handing the text back to the
 * composer without the files reintroduces exactly that loss: the queue entry is
 * deleted immediately after the drain, so anything not returned here is gone
 * with no error, no chip, and no upload.
 *
 * Deduped by id — a drained item that gets re-queued reuses its own list, so
 * the same attachment object can appear under more than one queued message.
 */
export function drainQueueAttachments(queued) {
  const seen = new Set();
  const out = [];
  (queued || []).forEach((m) => {
    (m.attachments || []).forEach((a) => {
      if (!a || seen.has(a.id)) return;
      seen.add(a.id);
      out.push(a);
    });
  });
  return out;
}

/**
 * The live steps with one question removed.
 *
 * Retiring a dead card must not blank the whole mirror: if a DIFFERENT question
 * in the same conversation is genuinely live, blanking drops its interception,
 * and nothing re-arms it — the mirror is only rewritten by a stream event, and
 * while a question is pending no further events arrive. The composer would stop
 * redirecting, the next send would queue behind a turn that cannot complete,
 * and it would sit there until the server's 300 s timeout.
 *
 * No questionId (a caller that cannot say which question died) falls back to
 * the blanket clear.
 */
export function retireQuestionFromSteps(steps, questionId) {
  if (!questionId) return [];
  return (steps || []).filter(
    (s) => !(s.badge === 'AskUser' && s.data?.question_id === questionId),
  );
}

/**
 * Decides whether a freshly-appeared question should hand a task's queued
 * messages back to the composer: which key the messages sit under, and which
 * conversation the text must be handed back to.
 *
 * Those are not always the same id. `enqueueMessage` keys the queue by the id
 * the task had when the message was typed, and `adoptServerId` renames the task
 * without re-keying the queue — so a message queued before `response.created`
 * lands stays filed under a now-dead `tmp-…` id. The queue therefore has to be
 * looked up across every id the stream is known by, while the redirect must be
 * keyed by the id the task actually has now, or ChatView (which renders the
 * adopted id) would never match it and the text would be lost.
 *
 * `taskIds[0]` is the current id by construction: every caller passes the
 * stream's live `resolvedId` first, followed by the id it started with.
 *
 * Pure so the decision can be tested without a stream. Returns null when
 * nothing should happen, else {taskId, queueTaskId, questionId, text,
 * attachments}. The
 * caller is responsible for adding `questionId` to the drained set
 * synchronously, before any setState — that is what makes the drain
 * exactly-once even though clearing the queue is async.
 */
export function planQueueDrain(steps, taskIds, queues, drainedQuestionIds) {
  const pending = pendingQuestionFor(steps);
  if (!pending) return null;
  if (drainedQuestionIds?.has(pending.question_id)) return null;
  const ids = (taskIds || []).filter(Boolean);
  const queueTaskId = ids.find((tid) => ((queues || {})[tid] || []).length > 0);
  if (!queueTaskId) return null;
  return {
    taskId: ids[0],
    queueTaskId,
    questionId: pending.question_id,
    text: drainQueueToInput(queues[queueTaskId]),
    attachments: drainQueueAttachments(queues[queueTaskId]),
  };
}

/**
 * What a composer send should do when a question may be pending.
 *
 * `submitAnswer` never throws — it maps every failure onto a status — so the
 * caller cannot tell "the text became the answer" from "the answer was lost"
 * without looking at the status. This makes that exhaustive:
 *
 *   - `send`     — no question pending, or the question is gone: run the
 *                  normal send so the user's text is never discarded.
 *                  `release: true` additionally means the stale question must
 *                  be dropped from the live-steps mirror — and `questionId`
 *                  says WHICH one, so the caller retires that question instead
 *                  of blanking the mirror and taking a live sibling's
 *                  interception with it (see retireQuestionFromSteps).
 *   - `consumed` — the text became the answer; the send is over.
 *   - `fail`     — the submit failed in a way the user can retry. The caller
 *                  throws `message` so the composer surfaces it and keeps the
 *                  typed text (see Composer's handleSend).
 *   - `blocked`  — the question does not take typed answers, so nothing is sent
 *                  at all. Handled exactly like `fail` by the caller (message
 *                  surfaced, text kept), but decided before any network call.
 */
export async function resolvePendingAnswer({ steps, conversationId, text, submit }) {
  const pending = pendingQuestionFor(steps);
  if (!pending) return { action: 'send' };
  const payload = { text };
  // A select-only question rejects free text server-side (INVALID_OPTION → 400),
  // and its card deliberately renders no place to type — so the composer is the
  // only place left, and what lands here is usually not an answer at all
  // ("cancel, I changed my mind"). Submitting it produced a 400 and a toast
  // saying the answer was rejected, about a message that was never an answer,
  // with no way out. Decide it here instead, before any network call, and say
  // what does work. Sending it as a normal message is not an option: it would
  // queue behind the turn this question is blocking.
  if (pending.allow_custom === false && payload.text && !payload.values) {
    return {
      action: 'blocked',
      message: 'This question needs one of the options above. Pick one, or press Skip if you want to type something else.',
    };
  }
  const result = await submit(conversationId, pending.question_id, payload);
  const status = result?.status;
  if (status === 'not_found' || status === 'already_answered') {
    // The question died with its run (or someone else answered it). The typed
    // text was written as an answer, but it is still the user's words — send
    // it as a message rather than dropping it on the floor.
    return { action: 'send', release: true, questionId: pending.question_id };
  }
  if (status === 'error' || status === 'rejected') {
    return {
      action: 'fail',
      message: status === 'rejected'
        ? 'That answer was rejected. Try one of the offered options.'
        : 'Could not send your answer. Please try again.',
    };
  }
  // A success body carries no `status` at all (`{accepted: true}`) — api.js
  // only sets one for the failures above. So "no status" means the text became
  // the answer, while any status we do NOT recognise is one the server grew
  // later: release and send it, rather than silently swallowing the text.
  if (status) return { action: 'send', release: true, questionId: pending.question_id };
  return { action: 'consumed' };
}

async function resolveComposerAttachmentsForSend(projectName, sessionId, attachments) {
  const list = Array.isArray(attachments) ? attachments : [];
  const pending = list.filter(isPendingFileAttachment);
  const reference = list.filter(isReferenceOnlyAttachment);
  const rest = list.filter((a) => !isPendingFileAttachment(a) && !isReferenceOnlyAttachment(a));
  if (pending.length) {
    if (!projectName || !sessionId) {
      throw new Error('Pick a project and use a saved conversation before sending file attachments.');
    }
    if (String(sessionId).startsWith('tmp-')) {
      throw new Error('Wait until this conversation has started before sending file attachments.');
    }
  }
  let uploaded = [];
  if (pending.length) {
    const files = pending.map((p) => p.pendingFile);
    uploaded = await uploadAttachments(files, { projectName, sessionId });
  }
  // `reference` chips ride along for display (so the sent message's chat
  // history still shows which Drive files were relevant) but are excluded
  // from attachmentIds — there is no backend attachment record for them.
  const resolved = [...rest, ...uploaded];
  const merged = [...resolved, ...reference];
  return { merged, attachmentIds: resolved.map((x) => x.id), reference };
}

// Google-Drive-picked files carry no real attachment id (see
// isReferenceOnlyAttachment above), so unlike a normal attachment the
// agent gets no signal at all that a message's "this file" refers to
// one of them. Named explicitly here so Anton can resolve the
// reference — same hidden-context pattern as describeConnectFormState.
function describeGoogleDriveReferenceFiles(reference) {
  if (!reference?.length) return '';
  const lines = reference.map((f) => `- ${f.name || 'untitled'} (Drive file id: ${f.driveFileId || f.id})`);
  return [
    '[Google Drive files added via the picker for this message — Anton-only context, do not echo back]',
    'The user just added the following Google Drive file(s). When they refer to "this file"/"these files" '
      + 'in the message above, they mean these — read them with files.get(fileId=...):',
    ...lines,
  ].join('\n');
}

function normalizeComposerDisabledConnections(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((d) => ({
      engine: String(d.engine || '').trim(),
      name: String(d.name || '').trim(),
    }))
    .filter((d) => d.engine && d.name);
}

const ACCENT_VARS = {
  aqua:  {},
  ocean: { '--primary-700': '#276F86', '--primary-600': '#3796B3', '--primary-500': '#53AECA', '--primary-400': '#48BEE3', '--primary-300': '#71CDE9', '--primary-50': '#E2F5FD' },
  sage:  { '--primary-700': '#3D6159', '--primary-600': '#4D7A70', '--primary-500': '#5D9287', '--primary-400': '#78BAAC', '--primary-300': '#84CCBD', '--primary-50': '#D3F9F0' },
  stone: { '--primary-700': '#3A464B', '--primary-600': '#55666D', '--primary-500': '#64777E', '--primary-400': '#7D95A1', '--primary-300': '#A0BECA', '--primary-50': '#EBF2F5' },
};

// Open the data-vault side panel for a form the agent just streamed.
// Called from the stream `onDone` handlers — the deterministic, fires-
// exactly-once-per-turn place to do this. We can't rely on the
// in-markdown MarkdownCode path: by the time the streamed block is
// `complete`, its message has committed to history and mounts
// already-complete, so MarkdownCode's "historical replay" guard
// (which exists to stop dismissed forms reappearing on navigation)
// suppresses the dispatch. onDone only runs for a live turn, so it
// has no such ambiguity. No-op for the overwhelming majority of turns
// that carry no form fence.
function openStreamedForm(conversationId, finalContent) {
  if (!conversationId || !finalContent) return;
  let result;
  try {
    result = extractFormSpec(finalContent);
  } catch {
    return;
  }
  if (result.found && result.spec) {
    setDataVaultForm(conversationId, result.spec);
  }
}

async function loadSessionMessagesWithRetry(
  cid,
  { isLive = false, isServerInFlight = false, skipLocalSidecar = false } = {},
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) {
      await new Promise((resolve) => { setTimeout(resolve, 50 * attempt); });
    }
    const fresh = await fetchSession(cid);
    if (!fresh || !Array.isArray(fresh.messages)) continue;
    return {
      messages: applySessionMessages(cid, fresh.messages, { isLive, isServerInFlight, skipLocalSidecar }),
      disabledConnections: fresh.disabledConnections,
    };
  }
  return null;
}

// How long to wait before the next `GET /schedules/` poll:
// - close to the soonest due schedule (so a background run shows up promptly)
// - but never more than MAX (a heartbeat for cross-client changes / clock drift)
// - and never less than MIN (so an overdue-but-not-yet-processed schedule can't turn into a busy loop).
// RUN_BUFFER gives the time to actually finish task before we go check.
const SCHEDULE_POLL_MAX_DELAY_MS = 10 * 60 * 1000;
const SCHEDULE_POLL_MIN_DELAY_MS = 60 * 1000;
const SCHEDULE_POLL_RUN_BUFFER_MS = 60 * 1000;

function nextPollDelay(schedules) {
  // A run in flight: poll at the floor so the Running state clears soon
  // after the run finishes — nothing else refreshes it.
  if ((schedules || []).some((s) => s.running)) return SCHEDULE_POLL_MIN_DELAY_MS;
  const dueTimes = (schedules || [])
    .filter((s) => s.enabled && s.nextRunAt)
    .map((s) => new Date(s.nextRunAt).getTime())
    .filter(Number.isFinite);
  if (dueTimes.length === 0) return SCHEDULE_POLL_MAX_DELAY_MS;
  const earliest = Math.min(...dueTimes);
  const untilDue = earliest - Date.now() + SCHEDULE_POLL_RUN_BUFFER_MS;
  return Math.min(SCHEDULE_POLL_MAX_DELAY_MS, Math.max(untilDue, SCHEDULE_POLL_MIN_DELAY_MS));
}

// Monotonic token guarding project-detail resolution. A `/projects/:id` fetch
// captures the token with begin() and applies its result only while isCurrent()
// still holds. Both starting a newer detail (begin) AND leaving detail — to the
// grid, Home, or any other route (leave) — advance the token, so a slow
// `/projects/:A` response can neither overwrite a later `/projects/:B` nor
// re-select A after the user has navigated away (e.g. Back to the grid).
export function makeProjectDetailToken() {
  let current = 0;
  return {
    begin: () => ++current,
    leave: () => { current += 1; },
    isCurrent: (captured) => captured === current,
  };
}

export default function App() {
  return (
    <ToastProvider>
      <AppCore />
    </ToastProvider>
  );
}

function AppCore() {
  // Seed from the read-through cache of the last settings fetch, not a literal
  // set of defaults — the server (GET /settings/) is the single source of truth
  // and returns every field's resolved default, so the boot fetch (below) fills
  // this. On the very first launch the cache is empty and the app renders the
  // server's values within one fetch. This removes the hard-coded copy whose
  // values could drift from the server's (e.g. showDots). See ENG-941/ENG-1125.
  const [settings, setSettings] = useState(loadCachedSettings);

  const agentLabel = getAgentLabel(settings);

  const [tasks, setTasks] = useState([]);
  const tasksRef = useRef(tasks);
  useEffect(() => { tasksRef.current = tasks; }, [tasks]);
  // IDs of tasks deleted this session. Used to filter them out of
  // subsequent fetchSessions responses so zombies can't reappear.
  const deletedTaskIdsRef = useRef(new Set());
  const [projects, setProjects] = useState([]);
  const [moveModalTask, setMoveModalTask] = useState(null);  // task pending a move-to-project
  const [artifacts, setArtifacts] = useState([]);
  // First-artifact tip (ENG-1137). Armed only when the FIRST artifacts
  // fetch of the session comes back empty — an account that already has
  // artifacts is not a first-run and must never see the tip. Once armed,
  // the 0 → ≥1 transition (the user's first artifact finishing) opens it.
  //   null  = undecided (fetch hasn't resolved yet)
  //   true  = armed (fresh account, watching for the first artifact)
  //   false = decided-off (existing account, or already fired)
  const artifactTipArmedRef = useRef(null);
  const [artifactTipOpen, setArtifactTipOpen] = useState(false);
  // Same shape, for the sidebar checklist: flipped by the session's first
  // sessions fetch (see refreshData) so the freshness call is taken once.
  const onboardingFreshnessResolvedRef = useRef(false);
  useEffect(() => {
    if (artifactTipArmedRef.current !== true) return;
    if (artifacts.length >= 1) {
      artifactTipArmedRef.current = false;
      setArtifactTipOpen(true);
    }
  }, [artifacts.length]);
  const handleArtifactTipDismiss = useCallback(() => {
    setArtifactTipOpen(false);
    dismissArtifactTip();
  }, []);
  // Scheduled-task data + CRUD lifecycle (list, runs index, refresh, and the
  // create/update/delete/pause/resume handlers) live in useSchedules. The
  // poll effect, selectedScheduleId, and handleRunScheduleNow stay below —
  // they cross into the task-list and routing domains.
  const {
    scheduled,
    scheduleRunsIndex,
    refreshSchedules,
    handleCreateSchedule,
    handleUpdateSchedule,
    handleDeleteSchedule,
    handlePauseSchedule,
    handleResumeSchedule,
  } = useSchedules();
  const [pins, setPins] = useState([]);
  const [connectors, setConnectors] = useState([]);
  const [composerAttachments, setComposerAttachments] = useState([]);
  /** Muted vault connections for the next send (all composers); persisted on stream. */
  const [composerDisabledConnections, setComposerDisabledConnections] = useState([]);
  const [composerPrefill, setComposerPrefill] = useState(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // null = no section selected: the mobile master-detail shows its section
  // list; desktop (no list) falls back to 'agent' where it's read.
  const [settingsSection, setSettingsSection] = useState(null);
  const [connectorPickerOpen, setConnectorPickerOpen] = useState(false);
  const [serverHelpOpen, setServerHelpOpen] = useState(false);
  // Pending delete confirm — task id whose delete is awaiting user
  // confirmation in the modal. null = no modal.
  const [pendingDeleteTaskId, setPendingDeleteTaskId] = useState(null);
  // Pending project delete — same pattern but for entire projects.
  const [pendingDeleteProject, setPendingDeleteProject] = useState(null);

  // Live stream control — refs to the active fetch's AbortController
  // and the latest scratchpad name so we can fire a Stop that aborts
  // both the SSE read and the in-flight scratchpad cell.
  const activeStreamCtrlRef = useRef(null);
  const activeScratchpadRef = useRef(null);
  // Which task id (if any) the active stream belongs to. Used to
  // distinguish "this conversation is mid-flight, keep the running
  // indicators" from "this conversation has zombie running indicators
  // from a stream that died (server restart, network blip, app close
  // mid-turn)" when the user navigates back to it. See
  // `reconcileTaskMessages` for the cleanup it enables.
  const activeStreamingTaskIdRef = useRef(null);
  // Latest toast manager, reachable from callbacks (like handleStopStream)
  // defined above where useToastManager() is called. Synced in an effect below.
  const toastManagerRef = useRef(null);
  // True once the active stream's SSE socket delivers any event — client-side
  // proof the turn started, independent of when it shows up in the in-flight
  // poll (which lags Redis/replica registration). The stranded-slot self-heal
  // reads it to tell a slow-to-register turn from a never-started fast-fail.
  // Reset to false at every new stream reservation below.
  const activeStreamProducedRef = useRef(false);
  const activeStreamGenerationRef = useRef(0);
  const composerMuteLastTaskIdRef = useRef(null);
  const prevRouteForComposerMuteRef = useRef(null);

  // Per-task queue of user messages waiting for the current turn to
  // finish before they get sent. When the user fires another message
  // while a stream is in flight we push to this queue instead of
  // trying to start a parallel turn (anton-core can't handle that
  // gracefully). After the active turn's onDone/onError fires we
  // drain one item from the queue.
  const [messageQueue, setMessageQueue] = useState({}); // { [taskId]: [{id, text, attachments}] }
  const messageQueueRef = useRef({});
  useEffect(() => { messageQueueRef.current = messageQueue; }, [messageQueue]);
  // `reconnectInFlight` is a mount-frozen useCallback (all its deps are
  // stable), so it cannot close over the render-fresh `drainNextQueuedMessage`
  // without also capturing a stale `handleSendInTask` (and its stale
  // `projects`/`health` fallbacks). It reads the latest drain through this ref
  // instead — assigned right after the drain is defined and read only from
  // async completion callbacks, never during render.
  const drainNextQueuedMessageRef = useRef(null);

  // Running tally for the stranded-reservation self-heal (reservationReleaseDecision):
  // a stream that dies with no terminal pins the slot forever, so the in-flight
  // poll releases it once the server lists then stops listing the task.
  const staleReservationRef = useRef({ cid: null, misses: 0, seen: false, lastMissAt: 0 });

  // Serializes refreshInFlightSet so overlapping interval/focus polls can't
  // double-count a miss (see the wrapper below).
  const refreshInFlightInProgressRef = useRef(false);

  // Mirror "a reservation has an unresolved miss" into state so the 5s heartbeat
  // stays alive for the follow-up polls a release needs — the first miss empties
  // inFlightSet, which would otherwise tear down the size-gated interval before
  // the miss that releases the slot arrives.
  const [hasPendingReservationMiss, setHasPendingReservationMiss] = useState(false);

  // Live steps per task, so handleSendInTask can see a pending question
  // without threading stream state through the composer.
  const liveStepsRef = useRef({});

  // question_id values we've already drained a pre-existing queue for.
  // Explicit one-shot guard rather than relying on "the queue is already
  // empty after the first drain" — clearing the queue goes through
  // setState, which is async, so a second event landing before that state
  // commits would otherwise see the same non-empty queue and drain twice.
  const drainedQuestionsRef = useRef(new Set());

  // Pending composer redirects, keyed by conversation: a drained queue is
  // handed back to the composer of the task it came from (see
  // drainQueueToInput), never to whichever task happens to be on screen.
  // ChatView consumes its own key and calls onComposerRedirectConsumed(taskId),
  // which deletes just that entry. One slot per task, not one globally: a
  // background task's drain must be able to wait, unconsumed, while another
  // task drains, without either losing its text. Consumable rather than
  // sticky, so a consumed entry cannot re-apply when ChatView remounts.
  const [composerRedirects, setComposerRedirects] = useState({}); // { [taskId]: {text, bump} }
  const composerRedirectBumpRef = useRef(0);

  // Cross-client sync cache (Option B). Conversations that have an
  // in-flight producer task on the server, regardless of which client
  // started them. Synchronously consulted by reconcileTaskMessages so
  // the "things stopped before I wrapped up" prompt never appears for
  // a conversation that's actually still running.
  //
  // Kept fresh by four signals:
  //   1. App boot — initial fetch.
  //   2. Window focus — every return from another tab/window/client.
  //   3. Heartbeat — every 5s, but ONLY while the set is non-empty.
  //      (No polling when nothing's in flight; idle tabs cost zero.)
  //   4. Local mutation — markInFlight / markInFlightDone fire when
  //      this tab itself starts / finishes a stream, so we beat any
  //      server round-trip for our own activity.
  const [inFlightSet, setInFlightSet] = useState(() => new Set());
  const inFlightSetRef = useRef(inFlightSet);
  useEffect(() => { inFlightSetRef.current = inFlightSet; }, [inFlightSet]);

  // The reconcile body. Wrapped by refreshInFlightSet below with a re-entrancy
  // guard; declared first so the wrapper can reference it without a TDZ.
  const reconcileInFlight = useCallback(async () => {
    const items = await fetchInFlightList();
    // A failed poll returns null, NOT [] — don't reconcile: treating it as "server
    // reports nothing" would clear inFlightSet and count a false miss, so two blips
    // could abort a healthy turn. Skip; the tally is preserved for the next poll.
    if (items === null) return;
    const ids = items.map((it) => it.conversation_id).filter(Boolean);

    // Stranded-reservation self-heal (see reservationReleaseDecision). A stream
    // that dies without a terminal leaves activeStreamingTaskIdRef/CtrlRef set
    // forever, so drainNextQueuedMessage self-blocks and every later message
    // strands at "N queued"; on relaunch reconnectInFlight re-attaches and
    // re-wedges (the "stuck at Queued that survives restarts" bug). `ids` is the
    // server's authoritative list, so a task we hold but it no longer lists is
    // released and drained.
    const streaming = activeStreamingTaskIdRef.current;
    // Pre-flight = slot reserved but no controller yet (send awaiting uploads).
    // Releasing then would let the send reassign the refs into a second
    // concurrent stream on one conversation; a real strand still holds its dead
    // controller.
    const preflight = Boolean(streaming) && !activeStreamCtrlRef.current;
    // Suppresses the unseen reap when the turn has produced events but the poll
    // hasn't listed it yet (see reservationReleaseDecision / the ref's decl).
    const producedData = activeStreamProducedRef.current;
    // Wall-clock lets the decision space misses across real poll intervals.
    const decision = reservationReleaseDecision(
      streaming, ids, staleReservationRef.current, { preflight, producedData, now: Date.now() },
    );
    staleReservationRef.current = {
      cid: decision.cid, misses: decision.misses, seen: decision.seen, lastMissAt: decision.lastMissAt,
    };
    if (decision.release && streaming) {
      const ctrl = activeStreamCtrlRef.current;
      if (ctrl) { try { ctrl.abort(); } catch { /* already closed */ } }
      activeStreamCtrlRef.current = null;
      activeScratchpadRef.current = null;
      activeStreamingTaskIdRef.current = null;
      activeStreamProducedRef.current = false;
      staleReservationRef.current = { cid: null, misses: 0, seen: false, lastMissAt: 0 };
      // Clear the dead turn's live steps like every terminal path, else a turn
      // blocked on an ask_user question stays in liveStepsRef and the next
      // message gets redirected into answering a gone run. Alias-aware so a
      // tmp->canonical pre-adoption id is cleared too.
      releaseLiveStepsWithAliases(streaming);
      // setInFlightSet below drops `streaming` and its finished-diff marks the
      // task idle, so no explicit markInFlightDone. Drain via the ref (this
      // callback is mount-frozen and would close over a stale drain).
      drainNextQueuedMessageRef.current?.();
    }
    // Keep the heartbeat alive across an unresolved miss so the releasing poll
    // fires (see hasPendingReservationMiss); a release resets the tally to 0.
    setHasPendingReservationMiss(staleReservationRef.current.misses > 0);

    setInFlightSet((prev) => {
      // Diff: if the server says a cid is GONE but we had it, the
      // stream just finished from elsewhere — that's the signal to
      // refetch that conversation's messages so the UI catches up.
      const next = new Set(ids);
      const finished = finishedCids(prev, ids, activeStreamingTaskIdRef.current);
      if (finished.length > 0) {
        // Defer the refetch so we don't synchronously trigger a
        // re-render storm.
        setTimeout(() => {
          finished.forEach((cid) => {
            fetchSession(cid).then((fresh) => {
              if (!fresh || !Array.isArray(fresh.messages)) return;
              setTasks((tasksPrev) => tasksPrev.map((t) => {
                if (t.id !== cid) return t;
                return {
                  ...t,
                  messages: applySessionMessages(cid, fresh.messages),
                  status: 'idle',
                };
              }));
            }).catch(() => {});
          });
        }, 0);
      }
      return next;
    });
  }, []);

  const refreshInFlightSet = useCallback(async () => {
    // Coalesce overlapping polls (5s interval + focus refresh) so two concurrent
    // reconciles can't read the same pre-write tally and double-count a miss. An
    // in-flight reconcile has fresh data coming, so a concurrent caller returns.
    if (refreshInFlightInProgressRef.current) return;
    refreshInFlightInProgressRef.current = true;
    try {
      await reconcileInFlight();
    } finally {
      refreshInFlightInProgressRef.current = false;
    }
  }, [reconcileInFlight]);

  const markInFlight = useCallback((cid) => {
    if (!cid) return;
    setInFlightSet((prev) => {
      if (prev.has(cid)) return prev;
      const next = new Set(prev);
      next.add(cid);
      return next;
    });
  }, []);

  const markInFlightDone = useCallback((cid) => {
    if (!cid) return;
    setInFlightSet((prev) => {
      if (!prev.has(cid)) return prev;
      const next = new Set(prev);
      next.delete(cid);
      return next;
    });
  }, []);

  // Boot-time hydration of the in-flight set + focus-event refresh.
  // Must come AFTER `refreshInFlightSet` is declared — the deps array
  // is evaluated at render time and would TDZ-throw otherwise.
  useEffect(() => {
    refreshInFlightSet();
    const onFocus = () => { refreshInFlightSet(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshInFlightSet]);

  // Stray-drop guard: a file dropped OUTSIDE a registered dropzone would
  // otherwise make the (Electron) window navigate to / open the file.
  // Swallowing the default dragover+drop at the window level kills that
  // navigation; React's per-zone onDrop still fires (it stops propagation).
  useEffect(() => {
    const prevent = (e) => { e.preventDefault(); };
    window.addEventListener('dragover', prevent, false);
    window.addEventListener('drop', prevent, false);
    return () => {
      window.removeEventListener('dragover', prevent, false);
      window.removeEventListener('drop', prevent, false);
    };
  }, []);

  // Heartbeat poll — every 5 seconds, but ONLY while the set is
  // non-empty. When nothing's in flight, an idle tab makes zero
  // background HTTP calls. When something IS in flight, the poll
  // catches the "the other client just finished it" case for
  // multi-monitor users who can see both windows at once and don't
  // generate a focus event to trigger a manual refresh.
  useEffect(() => {
    // Also runs on an unresolved reservation miss even when the set is empty:
    // releasing the slot needs a follow-up poll, and the miss is what empties
    // the set.
    if (inFlightSet.size === 0 && !hasPendingReservationMiss) return undefined;
    const timer = setInterval(() => { refreshInFlightSet(); }, 5000);
    return () => clearInterval(timer);
  }, [inFlightSet.size, hasPendingReservationMiss, refreshInFlightSet]);

  const enqueueMessage = (taskId, text, attachments = [], disabledConnections = []) => {
    // `attachments` rides with the queued item so a message sent while a
    // turn is in flight keeps its files — the drain re-resolves/uploads
    // them. Without this the queue stored text only and files were lost.
    // `disabledConnections` is likewise captured at enqueue so a drained
    // turn honors the connection-disable state as it was when the user hit
    // send, not whatever the composer happens to show when it finally
    // drains (which, for a cross-task drain, belongs to another task).
    const item = { id: `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`, text, attachments, disabledConnections };
    setMessageQueue((prev) => ({ ...prev, [taskId]: [...(prev[taskId] || []), item] }));
  };
  const removeFromQueue = (taskId, itemId) => {
    setMessageQueue((prev) => {
      const arr = (prev[taskId] || []).filter((q) => q.id !== itemId);
      const next = { ...prev };
      if (arr.length === 0) delete next[taskId];
      else next[taskId] = arr;
      return next;
    });
  };
  const popQueueHead = (taskId) => {
    const arr = messageQueueRef.current[taskId] || [];
    if (arr.length === 0) return null;
    const [head, ...rest] = arr;
    setMessageQueue((prev) => {
      const next = { ...prev };
      if (rest.length === 0) delete next[taskId];
      else next[taskId] = rest;
      return next;
    });
    return head;
  };
  // When the server mints a canonical id for a task that was streaming under
  // a tmp id, move any messages queued under the old id(s) onto the new one.
  // The drain finds a task by its queue key, so a queue left under a stale
  // id would never re-match the task (ENG-1378).
  const migrateQueuedMessages = (fromIds, toId) => {
    setMessageQueue((prev) => mergeQueuesForAdoptedId(prev, fromIds, toId));
  };

  const clearQueueForTask = (taskId) => {
    setMessageQueue((prev) => {
      if (!prev[taskId]) return prev;
      const next = { ...prev };
      delete next[taskId];
      return next;
    });
  };

  // Called from every stream's onEvent, right after reduceStream. Keeps
  // liveStepsRef current (so handleSendInTask can see a pending question
  // without threading stream state through the composer) and, the first
  // time a question appears while messages are queued, hands them back to
  // the user as composer text instead of answering with text written for
  // something else or leaving them queued to deadlock.
  const updateLiveStepsAndDrainQueue = (taskIds, steps) => {
    // Every stream's onEvent funnels through here (after dropping stale-generation
    // events), so reaching this line means the active stream delivered data.
    // Record it for the stranded-slot self-heal (see activeStreamProducedRef).
    activeStreamProducedRef.current = true;
    // Anything the agent just produced is alive by definition, whatever a
    // previously-loaded artifacts index says. This is the only live-stream
    // collector, and the replay paths do not call it, so registering here
    // cannot mistake a reopened conversation's old artifacts for new ones.
    noteArtifactsFromSteps(steps);
    taskIds.forEach((tid) => {
      if (tid) liveStepsRef.current[tid] = steps;
    });
    const plan = planQueueDrain(
      steps,
      taskIds,
      messageQueueRef.current,
      drainedQuestionsRef.current,
    );
    if (!plan) return;
    // Synchronous, before any setState: clearing the queue is async, so a
    // second event landing before that commits would otherwise see the same
    // non-empty queue and drain it twice.
    drainedQuestionsRef.current.add(plan.questionId);
    // Clear under the key the messages are filed under, but redirect to the
    // conversation the task is known by now — see planQueueDrain.
    clearQueueForTask(plan.queueTaskId);
    composerRedirectBumpRef.current += 1;
    // Only the newly restored batch, and only under this task's key — never
    // accumulated (that re-injects an earlier drain's text) and never into a
    // shared slot (that discards an earlier drain's text).
    //
    // The files those queued messages were carrying ride the SAME entry as the
    // text, because they have to travel together: `clearQueueForTask` above
    // deletes the only other reference to them, while `composerAttachments` is a
    // single app-wide list that is not keyed by task. Staging them here would
    // therefore put task A's files on whatever task happens to be on screen, and
    // sending from there would upload and send them against the wrong
    // conversation. They are staged when — and only when — this task's redirect
    // is consumed, by the ChatView actually showing this task.
    setComposerRedirects((prev) => ({
      ...prev,
      [plan.taskId]: {
        text: plan.text,
        attachments: plan.attachments,
        bump: composerRedirectBumpRef.current,
      },
    }));
  };

  // Drops any pending question these conversations were blocked on, so the
  // composer stops redirecting typed text into a question nobody can answer
  // any more. Called from every terminal path (done, error, cancel, Stop) —
  // including for `cancelled`, which the stream call sites bail out on before
  // handleStreamError ever runs.
  const releaseLiveSteps = useCallback((ids) => {
    (ids || []).forEach((tid) => { if (tid) delete liveStepsRef.current[tid]; });
  }, []);

  // Same, plus every alias of the conversation. Stop only knows the adopted
  // id, but a stream that started on a `tmp-…` id wrote its steps under BOTH
  // keys, and the pre-adoption one is unreachable by name once the task has
  // been renamed — it would leak in the map forever. The aliases hold the
  // identical steps array (the only writer is updateLiveStepsAndDrainQueue,
  // which assigns the same reference to every id), so value identity is
  // exactly the alias set.
  const releaseLiveStepsWithAliases = useCallback((taskId) => {
    if (!taskId) return;
    const dying = liveStepsRef.current[taskId];
    delete liveStepsRef.current[taskId];
    if (!dying) return;
    Object.keys(liveStepsRef.current).forEach((key) => {
      if (liveStepsRef.current[key] === dying) delete liveStepsRef.current[key];
    });
  }, []);

  // Retires ONE question from the mirror (see retireQuestionFromSteps for why
  // granularity matters), leaving anything else the conversation is blocked on
  // intact.
  //
  // Aliases share one array reference (see releaseLiveStepsWithAliases), so the
  // replacement is written under every key holding it — otherwise the aliases
  // diverge and the pre-adoption id keeps serving the retired question.
  const retireLiveQuestion = useCallback((conversationId, questionId) => {
    if (!conversationId) return;
    const steps = liveStepsRef.current[conversationId];
    if (!steps) return;
    const next = retireQuestionFromSteps(steps, questionId);
    Object.keys(liveStepsRef.current).forEach((key) => {
      if (liveStepsRef.current[key] === steps) liveStepsRef.current[key] = next;
    });
  }, []);

  const handleStopStream = useCallback(async (opts = {}) => {
    const silent = opts?.silent === true;

    let cidToCancel = activeStreamingTaskIdRef.current;
    if (!cidToCancel) {
      const streamingTask = tasksRef.current.find(
        (t) => (t.messages || []).some((m) => m.role === '_streaming'),
      );
      cidToCancel = streamingTask?.id ?? null;
    }

    // Ask the server to cancel *before* any local teardown. On `error` the
    // request never landed, so the cancel flag was not written and the remote
    // turn may still be running (and spending tokens). Bail out with the
    // in-flight state — Stop control, heartbeat, live stream — fully intact so
    // the toast's "try again" is actually actionable; tearing down first would
    // strip the very UI the user needs to retry. This ordering is the whole
    // point of ENG-1919. The `silent` idle-timeout caller still fires the
    // cancel but tears down regardless of the result and never toasts.
    if (cidToCancel) {
      const cancelResult = await cancelResponse(cidToCancel);
      if (!silent && cancelResult?.status === 'error') {
        toastManagerRef.current?.add({
          type: 'danger',
          title: 'Couldn’t stop the task — it may still be running. Check your connection and try again.',
        });
        return;
      }
    }

    activeStreamGenerationRef.current += 1;

    const padName = activeScratchpadRef.current;
    if (padName) {
      try { await cancelScratchpad(padName); } catch {}
    }

    const ctrl = activeStreamCtrlRef.current;
    if (ctrl) {
      try { ctrl.abort(); } catch {}
      activeStreamCtrlRef.current = null;
    }

    setTasks((prev) => prev.map((t) => {
      const streaming = (t.messages || []).some((m) => m.role === '_streaming');
      if (!streaming && t.id !== cidToCancel) return t;
      if (!streaming) return t;
      return {
        ...t,
        status: 'idle',
        messages: (t.messages || []).filter(
          (m) => m.role !== '_streaming' && m.role !== 'activity',
        ),
      };
    }));

    if (cidToCancel) {
      markInFlightDone(cidToCancel);
      // Stop kills the run, and with it any question that run was waiting
      // on. Without this the composer stays hijacked: the next send would be
      // routed into submitAnswer, 404 on the dead run, and the user's text
      // would be discarded.
      releaseLiveStepsWithAliases(cidToCancel);
      setMessageQueue((prev) => {
        const next = { ...prev };
        delete next[cidToCancel];
        return next;
      });
      // Prune the ref in lockstep: the sibling drain below reads
      // messageQueueRef synchronously and the state→ref effect hasn't run yet,
      // so without this it would still see (and could re-pick) the cancelled
      // task's own queue.
      const prunedQueue = { ...messageQueueRef.current };
      delete prunedQueue[cidToCancel];
      messageQueueRef.current = prunedQueue;
    }

    activeScratchpadRef.current = null;
    activeStreamingTaskIdRef.current = null;

    // Stop frees the shared stream slot with no onDone/onError behind it — the
    // generation bump above silences the aborted run's cancelled callback — so
    // a message queued against a *different* task would strand forever at
    // "N queued · waiting for Anton" with no future turn to release it. Sweep
    // the siblings now (the cancelled task's own queue was just deleted). Via
    // the ref because a memoized handleStopStream would close over a stale
    // drain (same reason reconnect uses it).
    drainNextQueuedMessageRef.current?.();

    if (silent || !cidToCancel) return;

    try {
      const loaded = await loadSessionMessagesWithRetry(cidToCancel, { skipLocalSidecar: true });
      if (loaded) {
        setTasks((prev) => prev.map((t) =>
          t.id === cidToCancel
            ? {
                ...t,
                status: 'idle',
                messages: loaded.messages,
                ...(Array.isArray(loaded.disabledConnections)
                  ? { disabledConnections: loaded.disabledConnections }
                  : {}),
              }
            : t,
        ));
      }
    } catch { /* placeholders already stripped */ }
  }, [markInFlightDone, releaseLiveStepsWithAliases]);

  const handleStreamError = useCallback(async (taskIds, cid, message, event) => {
    const ids = [...new Set(taskIds.filter(Boolean))];
    // A dead turn must not leave a stale pending question behind — that
    // would permanently redirect the composer into a question nobody can
    // ever answer. Deliberately BEFORE the `cancelled` bail-out.
    releaseLiveSteps(ids);
    if (event?.code === 'cancelled') return;
    // Activation gate (ENG-736): chat turn failed. Shared sink for every chat
    // send/reply/reconnect error, so a failed first query records its reason.
    fireFirstResponse(classifyFirstResponse({
      failed: true,
      code: event?.code,
      isConfigError: isAntonConfigError(message, event),
    }));
    activeStreamCtrlRef.current = null;
    activeScratchpadRef.current = null;
    activeStreamingTaskIdRef.current = null;
    ids.forEach((id) => markInFlightDone(id));

    const loaded = cid ? await loadSessionMessagesWithRetry(cid) : null;
    // A stream that merely dropped mid-answer can still have finished on the
    // server — the reload then carries no error message. Gating on the same
    // check the UI uses means a turn the user actually saw succeed doesn't
    // also count as a failure. Unlike fireFirstResponse (once per user), this
    // fires on every failed turn — the failure rate had no measurement at
    // all before this.
    const hasError = loaded
      ? loaded.messages.some((m) => m.role === 'error' || m.role === 'provider_required')
      : true;
    // `some()` over the whole history is right for the UI status below, but
    // it's a permanent yes once any earlier turn in the conversation has
    // ever failed — worthless as a failure-tracking gate, since it also
    // counts turns that actually recovered. A server-declared
    // response.failed (api.js's onError passes the raw SSE message through,
    // so `type` survives) is authoritative on its own. Only the client-side
    // transport codes (stream_error, reconnect_error, stalled) need the
    // reload heuristic, and only against the *last* turn.
    const lastMessage = loaded?.messages?.[loaded.messages.length - 1];
    const lastTurnFailed = loaded
      ? lastMessage?.role === 'error' || lastMessage?.role === 'provider_required'
      : true;
    if (event?.type === 'response.failed' || lastTurnFailed) trackTurnFailed(cid, event);
    setTasks((prev) => prev.map((t) => {
      if (!ids.includes(t.id)) return t;
      if (loaded) {
        return {
          ...t,
          status: hasError ? 'error' : 'idle',
          messages: loaded.messages,
          ...(Array.isArray(loaded.disabledConnections)
            ? { disabledConnections: loaded.disabledConnections }
            : {}),
        };
      }
      const msgs = markActivityDone(removeThinkingPlaceholder(stripStreaming(t.messages)));
      const configError = isAntonConfigError(message, event);
      const displayError = normalizeAntonError(message, event);
      const trailer = configError
        ? { role: 'provider_required' }
        : {
            role: 'error',
            content: displayError,
            code: event?.code,
            reconnectable: event?.reconnectable ?? null,
            providerLabel: event?.provider_label ?? null,
            failedModel: event?.model ?? null,
            // ENG-1537 review: this local trailer is reached when
            // loadSessionMessagesWithRetry gives up after 3 attempts — which is
            // MORE likely precisely when the gateway is rate-limiting. Without
            // these the rate-limit card loses its gate and the allowance card
            // always reads "resets on next month".
            retryAfter: typeof event?.retry_after === 'number' ? event.retry_after : null,
            retryAt: typeof event?.retry_at === 'string' ? event.retry_at : null,
            resetAt: typeof event?.reset_at === 'string' ? event.reset_at : null,
            requestId: typeof event?.request_id === 'string' ? event.request_id : null,
          };
      return {
        ...t,
        status: configError ? 'idle' : 'error',
        messages: [...msgs, trailer],
      };
    }));
    if (isAntonConfigError(message, event)) {
      fetchHealth().then((h) => setHealth(h));
    }
  }, [markInFlightDone, releaseLiveSteps]);

  // Per-task streaming state is derived inside ChatView (it has the
  // task object via props). Don't compute it here — `activeTaskId` is
  // declared further down and reading it before initialization throws
  // a TDZ ReferenceError at first render.
  // Composer model options for the active (planning) provider. Sourced from
  // the backend-overlaid recommendedModels map (single source of truth in
  // cowork-server) — names come from MindsHub's own label for the model where
  // it publishes one, else derived from the id, never hardcoded. Empty until
  // settings load; the composer then shows just the configured model.
  const models = useMemo(() => {
    const providerType = providerValueToType(settings.planningProvider) || 'minds-cloud';
    return recommendedModelOptions(settings.recommendedModels, providerType, settings.modelLabels)
      .map((o) => ({ id: o.id, name: o.label }));
  }, [settings.recommendedModels, settings.planningProvider, settings.modelLabels]);
  // Picker metadata for the composer's model menu, passed as one bag so the
  // components in between don't grow a prop each. The composer groups rather than
  // App because ChatView builds its own single-item list, which stays ungrouped.
  // Re-check wallet availability when the composer's model menu opens, so a top-up
  // made outside the app unlocks its models without a restart. This is what makes
  // it safe for the composer to DISABLE a locked model at all: `modelEnabled` is
  // otherwise refreshed only by the Settings picker, so a user who hits "Add
  // credits" (which opens an external browser), tops up and comes back would find
  // the row still greyed until they visited Settings or restarted. Settings has had
  // this since ENG-412; this is parity with it.
  //
  // A failed refresh leaves the map we hold in place — mergeRecommendedModels never
  // lets an empty response overwrite it, and a model absent from the map counts as
  // available — so this can never lock the picker.
  const refreshModelAvailability = useCallback(async () => {
    const data = await fetchRecommendedModels({ refresh: true });
    const merged = mergeRecommendedModels(settings, data);
    if (merged) setSettings((prev) => ({ ...prev, ...merged }));
  }, [settings]);

  const modelMeta = useMemo(() => ({
    modelProviders: settings.modelProviders,
    modelFamilies: settings.modelFamilies,
    modelEnabled: settings.modelEnabled,
    // Which models advertise reasoning-effort levels (ENG-1940) — same
    // settings key SettingsView's per-role effort picker reads, so
    // Composer's EffortSelect stays in lockstep with it.
    modelEfforts: settings.modelEfforts,
    // Account-wide harness toggle (web-only Settings → Agent Harness) —
    // EffortSelect needs this outside coding mode, where Composer's own
    // harness state is hardcoded 'anton' and can't say whether Hermes is
    // actually configured account-wide.
    harness: settings.harness,
    onRefresh: refreshModelAvailability,
  }), [settings.modelProviders, settings.modelFamilies, settings.modelEnabled, settings.modelEfforts, settings.harness, refreshModelAvailability]);
  const { isMobile, isNarrow } = useBreakpoint();

  // iOS/Android auto-zoom workaround: toggle the viewport meta tag around
  // text-input focus so mobile browsers don't leave the app magnified.
  useViewportZoomLock(isMobile);

  // Coding Mode gets the same off-canvas popout treatment as the narrow/
  // tablet band (640-900): the docked sidebar is hidden entirely and
  // replaced by the floating hamburger, sliding in over the content instead
  // of pushing it — even on a full-width desktop viewport, since the
  // composer needs the room for its harness-picker chrome. Desktop-only
  // (Coding Mode doesn't exist on web) and never applies on true mobile
  // (<640) — MobileShell already owns that layout outright.
  // Coding Mode is parked behind CODING_MODE_OPTIONS_ENABLED (main/preload —
  // defaults false when unset) while it's unfinished: this forces every
  // consumer of the user's own codingModeEnabled preference to read as off
  // when the build-level flag is off, even if a stale `true` is already
  // sitting in someone's local settings from earlier testing — there'd be no
  // UI left to turn it back off otherwise, since the toggle and its Settings
  // section are hidden the same way (see navItemsForHost / the floating
  // corner toggle below).
  const codingModeActive = host.codingModeOptionsEnabled && !!settings.codingModeEnabled;
  // Nav-shell layout state (collapsed rail, off-canvas popout, collapsible
  // routes, and the derived popout flag) lives in useSidebarNav.
  const {
    sidebarCollapsed, setSidebarCollapsed,
    navPopoutOpen, setNavPopoutOpen,
    sidebarCollapsibleRoutes,
    sidebarPopout,
  } = useSidebarNav({ isNarrow, isMobile, codingModeActive });
  // Theme (light | dark), skin, the custom-skin recipe, and the Display
  // picker modal — plus the body-class / gravity-field / persistence side
  // effects that keep them applied — all live in useThemeSkin.
  const {
    theme, setTheme,
    skin, setSkin,
    themeModalOpen, setThemeModalOpen,
    customTheme, setCustomTheme,
  } = useThemeSkin();
  // Non-null = show the "coming soon to Cloud" popup for this feature name.
  const [comingSoonFeature, setComingSoonFeature] = useState(null);
  const orgMode = useOrgMode();

  // Routes that allow the sidebar to be collapsed via Cmd+B. Read via
  // a ref so the keydown listener (mounted once) sees the live route
  // without needing to rebind on every navigation.
  const routeRef = useRef('home');
  // Global keyboard shortcuts. Cmd/Ctrl+B toggles the sidebar (chat
  // only), Cmd/Ctrl+K opens search, Cmd/Ctrl+N starts a new task.
  useEffect(() => {
    const onKey = (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.altKey || e.shiftKey) return;
      const key = e.key.toLowerCase();
      if (key === 'b') {
        // Sidebar collapse is a chat-view affordance. Outside of
        // task view we keep it expanded so the user can always see
        // the navigation rail; swallow the shortcut quietly there.
        if (!sidebarCollapsibleRoutes.has(routeRef.current)) return;
        e.preventDefault();
        setSidebarCollapsed((c) => !c);
      } else if (key === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      } else if (key === 'n') {
        e.preventDefault();
        // Defined later in the function — access via closure (newTask).
        // Use a microtask to escape the read-before-define order issue.
        Promise.resolve().then(() => {
          if (typeof newTaskRef.current === 'function') newTaskRef.current();
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sidebarCollapsibleRoutes]);

  // After a *mouse* click on a button, drop its keyboard focus so a later
  // stray Space/Enter doesn't re-trigger that button (e.g. clicking
  // "Projects" in the sidebar shouldn't leave Space wired to it).
  // Pure keyboard navigation (Tab → Enter/Space) is untouched because we
  // only run on mouse events; :focus-visible still draws the ring for
  // genuine keyboard focus.
  useEffect(() => {
    const onMouseUp = (e) => {
      const btn = e.target instanceof Element
        ? e.target.closest('button, [role="button"]')
        : null;
      if (btn && !btn.matches('input, textarea, select, [contenteditable="true"]')) {
        requestAnimationFrame(() => { try { btn.blur(); } catch {} });
      }
    };
    document.addEventListener('mouseup', onMouseUp, true);
    return () => document.removeEventListener('mouseup', onMouseUp, true);
  }, []);

  // Latest newTask handler kept in a ref so the keydown listener — bound
  // once on mount — always invokes the up-to-date function.
  const newTaskRef = useRef(null);

  // Sidebar title color — a synced Setting (like the greeting), independent
  // of the skin/CustomTheme system above, so it applies in every style.
  useEffect(() => {
    applyNavTitleColor(settings.navTitleColor);
  }, [settings.navTitleColor]);

  // Mirror the Dot grid setting to a body class so the gravity-field
  // canvas can be hidden via CSS. `display: none` also lets the
  // canvas's requestAnimationFrame loop idle when the user has
  // turned the pattern off — no draw cost while invisible.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.body.classList.toggle('gf-dots-off', settings.showDots === false);
  }, [settings.showDots]);

  // Seed nav state from the address bar so a web deep-link / refresh paints the
  // right view instead of flashing Home. Electron's memory router starts at `/`.
  const initialNav = useRef(initialNavState()).current;
  // The router is created once (memory router on Electron, browser router on
  // web). It's stateless w.r.t. AppCore — nav state flows through context.
  const routerRef = useRef(null);
  if (!routerRef.current) routerRef.current = createCoworkRouter();
  const [route, setRoute] = useState(initialNav.route); // home | task | projects | scheduled | schedule-detail | artifacts | channels | customize
  // Keep a ref of the live route so the keydown listener (bound
  // once on mount) can read it without a re-bind on every nav.
  routeRef.current = route;
  // Route-aware gravity-field intensity: dense work surfaces quiet the
  // light-mode field (gf-quiet + gravity-field.css) so it never competes
  // with content; the home stage keeps the full ambient motion.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.body.classList.toggle('gf-quiet', route !== 'home');
    return () => document.body.classList.remove('gf-quiet');
  }, [route]);
  // Effective collapse state: only honor the user's preference while
  // the route allows it (chat task). Everywhere else the sidebar
  // stays expanded — gives the user permanent access to the nav. Never
  // applies in popout mode (narrow band or Coding Mode) — there the
  // sidebar is either fully hidden or slid in as an overlay, not docked
  // at a collapsed width.
  const sidebarCollapsedEffective =
    !sidebarPopout && sidebarCollapsibleRoutes.has(route) && sidebarCollapsed;
  const [activeTaskId, setActiveTaskId] = useState(initialNav.activeTaskId);
  // Set when the `/c/:id` loader hit an operational failure (not a 404): the
  // view offers a retry instead of losing the URL.
  const [conversationError, setConversationError] = useState(null);
  // Seed from a `/scheduled/:id` deep-link so refresh restores the detail view.
  // (selectedProject is resolved from its id by the project route, so null here.)
  const [selectedScheduleId, setSelectedScheduleId] = useState(initialNav.selectedScheduleId ?? null);
  const [selectedProject, setSelectedProject] = useState(null);
  // The project-detail id currently being resolved from the fetched list, or
  // null once settled. Distinct from `selectedProject` (which the whole app
  // reads and the URL bridge mirrors): while this differs from the selection we
  // render the grid, not a stale project, under `/projects/:id`. Seeded so a
  // refresh on a detail URL shows the loading grid, not a flash of the list.
  const [projectDetailPending, setProjectDetailPending] = useState(
    initialNav.route === 'projects' ? (initialNav.selectedProjectId ?? null) : null
  );
  // Monotonic request token so a slow `/projects/:A` response can't overwrite a
  // later `/projects/:B` resolution, nor re-select A after the user leaves detail
  // (Back to the grid / Home / any route). See makeProjectDetailToken.
  const projectDetailTokenRef = useRef(null);
  if (projectDetailTokenRef.current === null) projectDetailTokenRef.current = makeProjectDetailToken();
  // Defaults to "Model Router" — defer to whatever this account's Settings
  // has configured — until a composer picks a concrete model for a task.
  // Never re-synced from settings after that: its whole point is that it
  // always tracks Settings live, server-side, without the renderer needing
  // to know the current planning/coding/router model.
  const [selectedModel, setSelectedModel] = useState(MODEL_ROUTER);
  // Reasoning-effort pick for the home/new-task composer (ENG-1940) —
  // sibling state to selectedModel. '' means "no explicit pick, use the
  // model's (or account's) default effort" — never re-synced from
  // settings, same rationale as selectedModel just above.
  const [selectedEffort, setSelectedEffort] = useState('');
  // Local cowork-server lifecycle — online/busy state, start & stop, and the
  // first-paint seed-and-poll — lives in useServerControl. It re-fetches
  // through refreshDataRef after a manual start (refreshData writes
  // serverOnline via setServerOnline, so it's wired in by ref just below).
  const refreshDataRef = useRef(null);
  const {
    serverOnline, setServerOnline,
    serverBusy, setServerBusy,
    serverBusyKind, setServerBusyKind,
    handleServerStart, handleServerStop,
  } = useServerControl({ refreshDataRef });

  // `config_ready` deliberately omitted from the initial state — the
  // boot-time settings redirect at line ~798 keys off `=== false` so
  // that "not yet fetched" (undefined) and "server confirmed
  // unconfigured" (false) are distinguishable. Seeding it as `false`
  // here causes a spurious redirect to Settings on first paint when
  // serverOnline starts true (the web shell), before fetchHealth has
  // even returned.
  const [health, setHealth] = useState({ status: 'offline', anton_available: false });

  // Desktop "app installed" — fire once per install, after the backend is up
  // (health 'ok'). Captured under the anonymous device id if the user hasn't
  // signed in yet, and merged into the account on first login (ENG-537).
  // trackAppInstalled self-guards with a localStorage marker, so re-running is safe.
  useEffect(() => {
    if (host.isElectron && health.status === 'ok') trackAppInstalled();
  }, [health.status]);

  const toastManager = useToastManager();
  useEffect(() => { toastManagerRef.current = toastManager; }, [toastManager]);
  // OTA UI update + shell (desktop binary) update lifecycle — status, the
  // apply/download/dismiss handlers, and the host subscriptions that feed
  // them — all live in useAppUpdates.
  const {
    updateStatus,
    shellUpdate,
    shellAutoUpdate,
    shellUpdateDismissed,
    handleApplyUpdate,
    handleDownloadShellUpdate,
    handleShellAutoUpdateDownload,
    handleShellAutoUpdateInstall,
    handleShellAutoUpdateRetry,
    handleShellAutoUpdateAction,
    dismissShellUpdate,
  } = useAppUpdates();

  // Collapse the three update mechanisms into one shell-first banner (or null).
  // The manual notice is dismissal-filtered here before it can win the slot.
  const updateBanner = deriveUpdateBanner({
    ota: updateStatus,
    shellAuto: shellAutoUpdate,
    shellManual: shellUpdate && shellUpdate.version !== shellUpdateDismissed ? shellUpdate : null,
  });
  const handleUpdateAction = useCallback((action) => {
    if (action === 'apply-ota') return handleApplyUpdate();
    if (action === 'shell-auto') return handleShellAutoUpdateAction();
    if (action === 'download-installer') return handleDownloadShellUpdate();
    return undefined;
  }, [handleApplyUpdate, handleShellAutoUpdateAction, handleDownloadShellUpdate]);

  // Load data from server on mount
  const refreshData = useCallback(() => {
    fetchHealth().then((h) => {
      setHealth(h);
      setServerOnline(h.status === 'ok');
    });
    fetchSessions().then((data) => {
      if (!Array.isArray(data)) return;
      // One-time freshness decision for the onboarding checklist, taken on
      // the session's first successful fetch (refreshData also polls, hence
      // the ref guard): an account that already has tasks is not a first
      // run, and would otherwise sit on a permanent, undismissable 0/4 card.
      if (!onboardingFreshnessResolvedRef.current) {
        onboardingFreshnessResolvedRef.current = true;
        if (data.length > 0) dismissIfUntouched();
      }
      setTasks((prev) => mergeTasksFromServer(data, prev).filter((t) => !deletedTaskIdsRef.current.has(t.id)));
    });
    fetchProjects().then((data) => { if (Array.isArray(data)) setProjects(data); });
    fetchArtifacts().then((data) => {
      if (!Array.isArray(data)) return;
      // One-time arm/disarm decision for the first-artifact tip, taken on
      // the session's first successful fetch: empty list = fresh account
      // (watch for the first artifact); anything else = existing account
      // (flag it dismissed so no later session shows the tip either).
      if (artifactTipArmedRef.current === null) {
        if (data.length === 0 && !isArtifactTipDismissed()) {
          artifactTipArmedRef.current = true;
        } else {
          artifactTipArmedRef.current = false;
          if (data.length > 0) dismissArtifactTip();
        }
      }
      setArtifacts(data);
    });
    fetchPins().then((data) => setPins(data.pins || []));
    refreshSchedules();
    fetchDatasources()
      .then((data) => setConnectors(Array.isArray(data?.connections) ? data.connections : []))
      .catch(() => setConnectors([]));
    fetchSettings().then((data) => {
      if (data && typeof data === 'object') {
        setSettings((prev) => ({ ...prev, ...data }));
      }
    });
  }, []);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  // Expose the latest refreshData to useServerControl (it re-fetches after a
  // manual start) without a definition-order cycle — refreshData writes the
  // hook's serverOnline, so the hook can't take it as a direct argument.
  useEffect(() => { refreshDataRef.current = refreshData; }, [refreshData]);

  // Allow descendants (e.g. ProjectsView's rename / create flow) to
  // ask for a fresh projects list without prop-drilling a refetch
  // handler. Also refetch sessions: a rename rewrites every
  // conversation's _meta.json with the new project name, so the
  // in-memory task list (which carries projectName per task) needs
  // to re-read or else it keeps pointing at the old project.
  useEffect(() => {
    const handler = () => {
      fetchProjects().then((data) => {
        if (!Array.isArray(data)) return;
        setProjects(data);
        // A rename leaves selectedProject holding the old name; re-anchor
        // it by id so in-project sends and the breadcrumb pick up the
        // current name instead of 404ing on the stale one (ENG-1028).
        setSelectedProject((prev) => (prev?.id && data.find((p) => p.id === prev.id)) || prev);
      });
      fetchSessions().then((data) => {
      if (Array.isArray(data)) setTasks((prev) => mergeTasksFromServer(data, prev).filter((t) => !deletedTaskIdsRef.current.has(t.id)));
    });
    };
    window.addEventListener('anton:projects-changed', handler);
    return () => window.removeEventListener('anton:projects-changed', handler);
  }, []);

  // Connect Apps and Data (customize) updates its own listing after
  // disconnect, but App-level `connectors` feeds the chat composer (+ →
  // Connectors). Refresh when leaving this route so the menu matches the vault.
  useEffect(() => {
    if (route !== 'customize') return undefined;
    return () => {
      fetchDatasources()
        .then((data) => setConnectors(Array.isArray(data?.connections) ? data.connections : []))
        .catch(() => {});
    };
  }, [route]);

  // Whenever serverOnline flips from false → true (boot finishing,
  // user manually starting, etc.), re-fetch everything. Without this,
  // the initial refreshData() on a slow-cold-boot returns empties and
  // the UI is stuck showing "configure anton" until the user cycles
  // the toggle by hand.
  const wasOnlineRef = useRef(false);
  useEffect(() => {
    if (serverOnline && !wasOnlineRef.current) {
      refreshData();
    }
    wasOnlineRef.current = serverOnline;
  }, [serverOnline, refreshData]);

  // Session-scoped boot decisions (skip-intro flag, offline watchdog,
  // config-redirect, default-project bootstrap) live in useBootDecisions.
  const bootIntroDone = useBootDecisions({
    serverOnline,
    health,
    projects,
    selectedProject,
    setServerHelpOpen,
    setSettingsSection,
    setSettingsOpen,
    setSelectedProject,
    setProjects,
  });

  // Listen for background OAuth refresh failures pushed from main process.
  // timeout: 0 — persists until the user manually dismisses it, same as
  // the previous hand-rolled banner (these need action, not a fade-out).
  useEffect(() => {
    return host.onOAuthRefreshError((payload) => {
      toastManager.add({
        type: payload.permanent ? 'danger' : 'warning',
        timeout: 0,
        title: (
          <>
            <strong>{payload.engine}</strong>
            {payload.permanent
              ? ' connection needs to be reconnected — refresh token expired.'
              : ' connection refresh failed — retrying automatically.'}
          </>
        ),
      });
    });
  }, []);

  const saveSettings = useCallback(async (patch = settings) => {
    const result = await updateSettings(patch);
    setSettings((prev) => ({
      ...prev,
      configReady: result.configReady ?? prev.configReady,
      configError: result.configError ?? prev.configError,
    }));
    const h = await fetchHealth();
    setHealth(h);
    setServerOnline(h.status === 'ok');
    const latest = await fetchSettings();
    if (latest && typeof latest === 'object') {
      setSettings((prev) => ({ ...prev, ...latest }));
    }
    return result;
  }, [settings]);

  const activeTasks = tasks.filter((t) => t.status === 'active');
  const resolvedTask = tasks.find((t) => t.id === activeTaskId) || null;
  // Only fall back to a default task when no id is requested. A requested id
  // that isn't local yet (deep link / scheduled-run open) is still loading —
  // falling back to tasks[0] would flash an unrelated recent conversation.
  const currentTask = resolvedTask || (route === 'task' && !activeTaskId ? tasks[0] : null);
  // Loader hit a transient failure and there's nothing local — show the retry
  // rather than an empty (or, via the old `tasks[0]` fallback, wrong) ChatView.
  // A locally-available conversation keeps rendering during a blip.
  const showConversationError =
    route === 'task' &&
    conversationError != null &&
    conversationError === activeTaskId &&
    !resolvedTask;
  // Requested id not resolved and not (yet) errored: show a loading state, not
  // the wrong conversation, until openConversation merges it into local state.
  const showConversationLoading =
    route === 'task' && activeTaskId != null && !resolvedTask && !showConversationError;
  // A detail URL whose id isn't yet the selected project (resolving, or cold
  // deep link): show the grid, never a stale project, under `/projects/:id`.
  const projectDetailResolving =
    projectDetailPending != null &&
    !(selectedProject && (selectedProject.id === projectDetailPending || selectedProject.name === projectDetailPending));
  const selectedProjectForView = projectDetailResolving ? null : selectedProject;
  const currentTaskProject = resolveTaskProject(currentTask, projects) || selectedProject;
  const currentTaskModel = currentTask?.model
    ? (currentTask.model === MODEL_ROUTER_ID
        ? MODEL_ROUTER
        : (models.find((m) => m.id === currentTask.model) || { id: currentTask.model, name: currentTask.model, desc: 'Configured planning model' }))
    : selectedModel;
  // Sibling to currentTaskModel (ENG-1940): the task's own effort pick if
  // it has one, else whatever the home composer currently shows.
  const currentTaskEffort = currentTask?.reasoningEffort ?? selectedEffort;

  // "Switch to MindsHub Air" escape hatch on the model-denial card
  // (ENG-1304): offered only while Air itself is payable — the free monthly
  // grant covers Air, so it's the one model an empty wallet can usually
  // still run. `modelEnabled` is the same availability map the Settings
  // picker tags rows with (absent id ⇒ available).
  const airAvailableForSwitch =
    (settings.recommendedModels?.['minds-cloud'] || []).includes(MINDSHUB_AIR_MODEL_ID)
    && !isModelLocked(settings.modelEnabled, MINDSHUB_AIR_MODEL_ID);
  const handleSwitchToAirAndResend = (text) => {
    if (!currentTask || !text) return;
    // Persist the switch on the task so follow-up sends stay on Air, and
    // override the same send explicitly — the state write isn't visible to
    // handleSendInTask's closure within this tick.
    setTasks((prev) => prev.map((t) => (t.id === currentTask.id ? { ...t, model: MINDSHUB_AIR_MODEL_ID } : t)));
    handleSendInTask(text, null, { modelOverride: MINDSHUB_AIR_MODEL_ID });
  };

  useEffect(() => {
    const prev = prevRouteForComposerMuteRef.current;
    prevRouteForComposerMuteRef.current = route;
    if (prev === 'task' && (route === 'home' || route === 'projects')) {
      composerMuteLastTaskIdRef.current = null;
      setComposerDisabledConnections([]);
    }
  }, [route]);

  useEffect(() => {
    if (route !== 'task' || !currentTask?.id) return;
    const tid = currentTask.id;
    if (composerMuteLastTaskIdRef.current === tid) return;
    composerMuteLastTaskIdRef.current = tid;
    setComposerDisabledConnections(
      normalizeComposerDisabledConnections(currentTask.disabledConnections),
    );
  }, [route, currentTask?.id]);

  // Phase 2 reconnect — when the user opens a conversation whose
  // turn is still running server-side (closed-tab-and-came-back, or
  // opened from another window), re-attach to the producer's buffer
  // and resume the live stream. Idempotent + cheap on the no-op
  // path: a single GET /responses/in-flight probe, then nothing if
  // there's no live producer.
  //
  // Mirrors handleSendInTask's stream handlers verbatim — duplication
  // tolerated to keep this surgery contained. (A shared
  // buildStreamHandlers() refactor is a fine follow-up once both
  // paths have stabilised.)
  const reconnectInFlight = useCallback(async (taskId) => {
    if (!taskId) return false;
    // Already tailing locally — second-mount of the same task should
    // not double up.
    if (activeStreamingTaskIdRef.current === taskId && activeStreamCtrlRef.current) {
      return true;
    }
    let status;
    try {
      status = await fetchInFlightStatus(taskId);
    } catch {
      return false;
    }
    if (!status || !status.in_flight) return false;

    // Cache sync: the probe just confirmed the producer is alive.
    // Mark it now so any concurrent reconcile (e.g. switching to a
    // sibling tab) sees the right state without needing its own probe.
    markInFlight(taskId);

    let streamState = initialStreamState();

    const flushStreaming = () => {
      setTasks((prev) => prev.map((t) => {
        if (t.id !== taskId) return t;
        const msgs = removeThinkingPlaceholder(stripStreaming(t.messages));
        return { ...t, status: 'active', messages: [...msgs, {
          role: '_streaming',
          content: streamState.bodyText,
          steps: streamState.steps,
          currentThought: streamState.currentThought,
          startedAt: streamState.startedAt,
          streamStatus: streamState.status,
          harness: streamState.harness,
        }] };
      }));
    };

    activeStreamingTaskIdRef.current = taskId;
    activeStreamProducedRef.current = false; // fresh stream: no events yet
    const streamGen = activeStreamGenerationRef.current;
    activeStreamCtrlRef.current = tailInFlight(taskId, {
      fromSeq: 0, // Replay from the start — the reducer is idempotent
                  // over text deltas, and from_seq=0 keeps the rebuild
                  // simple. A per-task last-seen-seq optimisation is
                  // possible later if we see network overhead.
      onEvent(ev) {
        if (streamGen !== activeStreamGenerationRef.current) return;
        streamState = reduceStream(streamState, ev);
        updateLiveStepsAndDrainQueue([taskId], streamState.steps);
        const open = streamState.steps.find((s) => s.status === 'in_progress' && s._isScratchpad);
        if (open?._scratchpadTabId) activeScratchpadRef.current = open._scratchpadTabId;
        flushSync(() => flushStreaming());
      },
      onDone() {
        if (streamGen !== activeStreamGenerationRef.current) return;
        activeStreamCtrlRef.current = null;
        activeScratchpadRef.current = null;
        activeStreamingTaskIdRef.current = null;
        markInFlightDone(taskId);
        releaseLiveSteps([taskId]);
        const finalContent = streamState.bodyText;
        const finalSteps = streamState.steps;
        const finalStartedAt = streamState.startedAt;
        const finalHarness = streamState.harness;
        const configErrorInBody = finalContent && isAntonConfigError(finalContent, null);
        // Activation gate (ENG-736): a completed turn (status 'done') is a real
        // answer (success), unless a config error was wrapped into its 200 body.
        // A reconnect that saw no completion records nothing.
        fireFirstResponse(classifyFirstResponse({
          completed: streamState.status === 'done',
          isConfigError: !!configErrorInBody,
        }));
        let assistantTurnIndex = 0;
        setTasks((prev) => prev.map((t) => {
          if (t.id !== taskId) return t;
          const msgs = markActivityDone(removeThinkingPlaceholder(stripStreaming(t.messages)));
          assistantTurnIndex = msgs.filter((m) => m.role === 'assistant').length;
          if (configErrorInBody) {
            return { ...t, status: 'idle', messages: [...msgs, { role: 'provider_required' }] };
          }
          return finalContent
            ? { ...t, status: 'idle', messages: [...msgs, {
                role: 'assistant',
                content: finalContent,
                steps: finalSteps,
                startedAt: finalStartedAt,
                harness: finalHarness,
              }] }
            : { ...t, status: 'idle', messages: msgs };
        }));
        if (finalContent && !configErrorInBody) {
          persistTurnState(taskId, assistantTurnIndex, finalSteps, finalStartedAt);
          // Open the side panel if the agent streamed a connect form.
          openStreamedForm(taskId, finalContent);
        }
        fetchArtifacts().then((data) => { if (Array.isArray(data)) setArtifacts(data); });
        // A reconnect tail also holds the shared stream slot, so a message
        // queued against any task while it ran must be drained here too —
        // otherwise it strands at "N queued · waiting for Anton" (ENG-1378).
        // Via the ref because this closure is mount-frozen (see its decl).
        drainNextQueuedMessageRef.current?.(taskId);
      },
      onError(message, event) {
        // Order matters twice over. The generation guard comes first: a
        // superseded stream's late abort must not clear liveStepsRef for a
        // NEWER run on the same conversation. The release then comes before
        // the `cancelled` bail-out, because an aborted run's question is dead
        // too and leaving it behind would hijack the composer.
        if (streamGen !== activeStreamGenerationRef.current) return;
        releaseLiveSteps([taskId]);
        if (event?.code === 'cancelled') return;
        void (async () => {
          await handleStreamError([taskId], taskId, message, event);
          // See onDone — the reconnect slot frees here, so drain too.
          drainNextQueuedMessageRef.current?.(taskId);
        })();
      },
    });
    return true;
  }, [markInFlight, markInFlightDone, handleStreamError]);

  // Navigation intent only: flipping route + activeTaskId drives the URL to
  // `/c/:id`, whose loader + openConversation() (below) do the hydration and
  // stream reattach — so sidebar click / deep link / refresh / Back all run one
  // path.
  const selectTask = (id) => {
    if (sidebarPopout) setNavPopoutOpen(false);
    // Clear the composer here (the sync nav intent), not in openConversation:
    // that runs after the async loader and would wipe a queued-message redirect
    // ChatView stages for the conversation. Matches staging's ordering.
    setComposerAttachments([]);
    setActiveTaskId(id);
    setRoute('task');
  };

  // Hydrate + reattach the conversation the `/c/:id` route resolved. `loaded` is
  // the loader result: `{ task }`, `{ optimistic: true }` (new-chat mid-send —
  // messages live locally, don't clobber), or `{ unavailable: true }` (transient
  // failure).
  const openConversation = useCallback((id, loaded) => {
    setActiveTaskId(id);
    setRoute('task');
    // Composer is cleared by selectTask (sync), not here — see there. On a
    // loader failure flag it for a retry; any resolvable result clears a stale
    // error. The render only shows it when the conversation is absent locally,
    // so a sidebar click during a blip keeps rendering.
    if (loaded?.unavailable) setConversationError(id);
    else setConversationError((cur) => (cur === id ? null : cur));
    // Phase 2 reconnect — fire-and-forget. If a turn is still running
    // server-side for this conversation (closed-tab-came-back, or opened
    // from another tab/device), this re-attaches the live SSE stream and
    // replays from seq 0. Cheap no-op when the producer isn't running.
    reconnectInFlight(id).catch(() => { /* probe failures are silent */ });
    if (!loaded || loaded.optimistic || loaded.unavailable || !loaded.task) return;
    const fresh = loaded.task;
    // Is this conversation actually mid-stream right now? If yes, we LEAVE
    // running indicators alone. If no, reconcile strips zombie placeholders
    // and collapses stale step state.
    const isLive = activeStreamingTaskIdRef.current === id;
    // Cross-client cache (Option B): when the server says this
    // conversation's producer is still running, skip the "things stopped"
    // continuation prompt — the reconnect above attaches to the live tail.
    const isServerInFlight = inFlightSetRef.current.has(id);

    // Record the visit for recents ordering (never auto-pin), then refresh
    // pins + the capped recents list. Runs before the empty-transcript return
    // below so every successful open updates recency — matching the prior
    // selectTask path, which recorded a visit regardless of message count.
    recordTaskVisit(fresh, false).then(() => {
      fetchPins().then((data) => setPins(data.pins || []));
      fetchSessions().then((data) => {
        if (Array.isArray(data)) setTasks((prev) => mergeTasksFromServer(data, prev).filter((t) => !deletedTaskIdsRef.current.has(t.id)));
      });
    }).catch(() => {});

    // Empty and not mid-flight: surface the record so a capped-list deep
    // link (conversation absent from the recents fetch) still renders, but
    // don't wipe any locally-restored messages.
    if ((!Array.isArray(fresh.messages) || fresh.messages.length === 0) && !isServerInFlight) {
      setTasks((prev) => (prev.some((t) => t.id === id) ? prev : [fresh, ...prev]));
      return;
    }

    // Two layers of restoration, in order of trust: the server sidecar
    // (`{cid}_turns.json`) replayed through the live-stream reducer, then a
    // legacy localStorage sidecar. Merge into recents, inserting the
    // conversation if it wasn't in the capped fetch.
    const reconciled = applySessionMessages(id, Array.isArray(fresh.messages) ? fresh.messages : [], { isLive, isServerInFlight });
    const dc = Array.isArray(fresh.disabledConnections) ? fresh.disabledConnections : undefined;
    const patch = (t) => ({ ...t, messages: reconciled, ...(dc !== undefined ? { disabledConnections: dc } : {}) });
    setTasks((prev) => (prev.some((t) => t.id === id)
      ? prev.map((t) => (t.id === id ? patch(t) : t))
      : [patch(fresh), ...prev]));
  }, [reconnectInFlight]);

  const newTask = () => {
    if (sidebarPopout) setNavPopoutOpen(false);
    setActiveTaskId(null);
    setComposerAttachments([]);
    setComposerPrefill(null);
    setRoute('home');
  };

  const handleNavigateHomeWithPrefill = (text, projectName) => {
    setActiveTaskId(null);
    setComposerAttachments([]);
    setComposerPrefill({ text, bump: Date.now() });
    const targetName = projectName || 'general';
    const proj = projects.find((p) => p.name === targetName);
    if (proj) setSelectedProject(proj);
    setRoute('home');
  };

  // "+ Connect" entry — surfaces the ConnectorPicker modal. The user
  // browses or searches the predefined registry; on pick, we kick
  // off a new task whose first user message names the chosen
  // connector ("Connect Gmail"), which the existing agent / form
  // pipeline already knows how to route. Wiring the picker straight
  // to a renderer-side DataVaultForm (no chat round-trip) is the
  // next step — for this round we keep the agent path so we can
  // validate the picker UX without rewriting the form flow.
  const handleStartConnectChat = () => {
    setConnectorPickerOpen(true);
  };
  // Modify-existing-connection flow: same chat-task + form shape as
  // handleConnectorPicked, but skips the picker (engine is known)
  // and pre-fills every field the renderer is allowed to see —
  // non-secrets verbatim from the vault, secrets as the
  // `ANTON_VAULT_KEEP` sentinel. Saving via the existing submission
  // path runs the server-side merge: any field still carrying the
  // sentinel resolves to its prior on-disk value, so the user only
  // re-types what they actually want to change.
  const handleModifyConnection = async (connection) => {
    if (!connection?.engine) return;
    // Connector spec + saved record fetched in parallel — both feed
    // into the injected form. The spec gives us field shape (types,
    // labels, descriptions, secret flags); the saved record gives
    // us the values to pre-fill.
    const [full, savedRaw] = await Promise.all([
      fetchConnector(connection.engine).catch((e) => {
        // eslint-disable-next-line no-console
        console.warn('[connectors] failed to load full spec for modify', e);
        return null;
      }),
      fetchSavedConnection(connection.engine, connection.name).catch((e) => {
        // eslint-disable-next-line no-console
        console.warn('[connectors] failed to load saved connection for modify', e);
        return null;
      }),
    ]);
    const saved = savedRaw || { fields: {}, secureKeys: [] };
    const savedFields = saved.fields || {};

    const label = full?.label || connection.engine;
    const tempId = 'tmp-modify-' + Date.now();
    const hasLiteralForm = !!(full && full.form);

    setTasks((prev) => [{
      id: tempId,
      title: `Modify ${connection.name || label}`,
      subtitle: 'just now',
      status: hasLiteralForm ? 'idle' : 'active',
      messages: hasLiteralForm
        ? [
            {
              role: 'assistant',
              _kind: 'connect_intro',
              connector: {
                id: full.id,
                label,
                logo: full.form?.logo || full.logo,
                logo_color: full.form?.logo_color || full.logo_color,
              },
              content: `Modify ${connection.name || label}`,
              // Modify-specific metadata so ChatView can render the
              // intro card with Cancel + Disconnect actions instead
              // of the plain "fill out the form" affordance.
              _modify: true,
              _engine: connection.engine,
              _existing_name: connection.name,
              _client_only: true,
            },
            {
              role: 'assistant',
              content: `Update the credentials or settings for "${connection.name}" — saving overwrites the existing connection.`,
              _client_only: true,
            },
          ]
        : [
            {
              role: 'assistant',
              content: `Let's update ${connection.name || label}.`,
              _client_only: true,
            },
          ],
      projectName: selectedProject?.name || 'general',
      projectPath: selectedProject?.path || null,
      model: selectedModel?.id || null,
      reasoningEffort: selectedEffort || null,
      attachments: [],
    }, ...prev]);
    setActiveTaskId(tempId);
    setComposerAttachments([]);
    setRoute('task');


    if (hasLiteralForm) {
      // Underscore-prefixed keys in the vault record are metadata
      // stamps from previous saves (e.g. `_method`, `_connector_id`)
      // — not user-typed inputs. Read what we need before filtering.
      const savedMethodId = savedFields._method || null;
      // Build the value map for actual user fields. Strip the meta
      // stamps so they never render as form inputs.
      const valueByName = Object.fromEntries(
        Object.entries(savedFields).filter(([k]) => !k.startsWith('_'))
      );

      // Pure synthesis — the synthetic method's fields come from
      // the saved record alone, with NO attribute borrowing from
      // any spec method. The user's intent: "append a new option,
      // not append to the attributes of an existing option". So we
      // build each field from scratch using only what we know
      // about the saved key — the key name (titlecased into a
      // human label) and whether it was classified secret on save.
      // The rendered form is exactly what's in the vault: same
      // keys, no spec leakage, no surprise fields.
      const niceLabel = (name) => String(name || '')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());

      const syntheticFields = Object.keys(valueByName).map((k) => {
        const isSecret = (saved.secureKeys || []).includes(k);
        return {
          name: k,
          label: niceLabel(k),
          type: isSecret ? 'password' : 'text',
          secret: isSecret,
          required: false,
          default: valueByName[k],
        };
      });

      const isMultiMethod = Array.isArray(full.form.methods) && full.form.methods.length > 0;
      const matchedSpecMethod = isMultiMethod
        ? (full.form.methods.find((m) => m && m.id === savedMethodId) || null)
        : null;

      let nextSpec;
      if (isMultiMethod) {
        // Synthesize a NEW method option with id `__edit_current__`.
        // The original methods stay in the array untouched — the
        // picker shows the synthetic *plus* every original, so the
        // user can edit current values OR start fresh on any method.
        //
        // `_underlying_method` carries the saved method's real id
        // through to submit. The form panel reads this and sends it
        // as the `method` / `auth_method` to the server, so server-
        // side validation accepts the submit (it sees a real id).
        // OAuth submit_action / oauth metadata / actions are
        // inherited from the matched original so the OAuth launch
        // path still triggers when the original method was OAuth.
        // When the saved method id no longer matches anything in
        // the spec (renamed / removed in a connector update), we
        // still publish the synthetic — `_underlying_method` is
        // null and the submit falls through the agent's custom
        // save path, which doesn't validate against the spec's
        // method list.
        const synthMethod = {
          id: '__edit_current__',
          label: 'Currently saved values',
          description: 'Edit the values stored for this connection.',
          fields: syntheticFields,
          // No `submit_action` / `oauth` / `actions` inherited from
          // any spec method — the synthetic stands on its own. The
          // submit goes through the regular agent path; if the user
          // wants to re-run OAuth (or any other launch flow), they
          // click "Back to options" and pick the original method,
          // which still has those affordances.
          //
          // Hidden marker — server-side validation rejects unknown
          // method ids, so on submit the form panel sends the saved
          // method's real id (resolved through `_underlying_method`)
          // as the `method` / `auth_method`. Synthetic id stays
          // local, used only for picker selection + state keying.
          _underlying_method: matchedSpecMethod?.id || null,
        };
        nextSpec = {
          ...full.form,
          // ADD, don't replace. Synthetic at the front so the picker
          // shows it first (and so `selected_method = __edit_current__`
          // resolves to it on initial render).
          methods: [synthMethod, ...full.form.methods],
          selected_method: '__edit_current__',
          engine: full.form.engine || full.id,
          _connector_id: full.id,
          _secure_keys: saved.secureKeys || [],
          _modify: true,
          _existing_name: connection.name,
          name: connection.name,
          user_label: saved.user_label || null,
          logo: full.form.logo || full.logo,
          logo_color: full.form.logo_color || full.logo_color,
        };
      } else {
        // Single-method form — there's no method picker, so we just
        // replace top-level fields with the synthetic ones. There's
        // nothing to "go back to" anyway.
        nextSpec = {
          ...full.form,
          fields: syntheticFields,
          engine: full.form.engine || full.id,
          _connector_id: full.id,
          _secure_keys: saved.secureKeys || [],
          _modify: true,
          _existing_name: connection.name,
          name: connection.name,
          user_label: saved.user_label || null,
          logo: full.form.logo || full.logo,
          logo_color: full.form.logo_color || full.logo_color,
        };
      }
      setDataVaultForm(tempId, nextSpec);
      // Cache the spec on the connect_intro message so the bubble
      // can re-publish it (re-open the panel) if the user closes
      // the form and clicks the card.
      setTasks((prev) => prev.map((t) => t.id !== tempId ? t : {
        ...t,
        messages: t.messages.map((m) =>
          m && m._kind === 'connect_intro' ? { ...m, _form_spec: nextSpec } : m
        ),
      }));
    } else {
      // No registry entry — fall back to the chat-agent flow. Anton
      // can still walk the user through the change.
      Promise.resolve().then(() => handleSendFromHome(`Update connection ${connection.name} (${label}).`));
    }
  };
  // Cancel a modify-flow task: drop the synthetic chat task we
  // just created and route back to the Connect Apps and Data page.
  // Modify tasks are always tmp- (we never persist them server-
  // side until the user actually saves), so the local cleanup is
  // sufficient — no `/conversations` DELETE round-trip.
  const handleCancelModify = (taskId) => {
    if (taskId) {
      deletedTaskIdsRef.current.add(taskId);
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      if (activeTaskId === taskId) setActiveTaskId(null);
    }
    setRoute('customize');
  };
  // Disconnect from a modify-flow task: delete the vault entry +
  // close the task. Confirmation is on the renderer side because
  // this is destructive and easy to mis-click. After success the
  // user lands back on the Connect Apps grid where they'd expect
  // to see the connection gone.
  const handleDisconnectFromModify = async (taskId, engine, name) => {
    if (!engine || !name) return;
    if (!window.confirm(`Disconnect ${engine}/${name}?`)) return;
    try {
      await deleteDatasource(engine, name);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[connectors] disconnect failed', e);
      alert(`Could not disconnect: ${e?.message || e}`);
      return;
    }
    if (taskId) {
      deletedTaskIdsRef.current.add(taskId);
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      if (activeTaskId === taskId) setActiveTaskId(null);
    }
    // Refresh the connectors mirror so the apps page reflects the
    // removal immediately on landing.
    try {
      const fresh = await fetchDatasources();
      setConnectors(Array.isArray(fresh?.connections) ? fresh.connections : []);
    } catch { /* best-effort refresh */ }
    // Project files' Context card holds its own Google Drive file list and
    // has no other way to learn this connection (and its _picked_files
    // grant) is gone — see the matching dispatch in CustomizeView.handleDelete.
    window.dispatchEvent(new CustomEvent('anton:connections-changed'));
    setRoute('customize');
  };
  // Picker hands us a summary record (id + label + …). The user
  // wants to land in a normal chat task — not a separate modal —
  // so the scratchpad / agent loop is available for any iteration
  // beyond the initial form. We just skip the LLM round-trip for
  // *getting* the form: known id → known JSON spec → inject directly
  // into the form store, and the chat-side DataVaultFormPanel picks
  // it up. Submission goes through the existing handleSubmitDataVaultForm
  // path so the agent can probe credentials, retry, etc.
  //
  // If the registry lookup fails (network, id not in registry), we
  // fall back to the chat-agent path so picking a connector is
  // never a dead end.
  // Where the user was when they opened the connect flow, so closing the
  // connect modal BEFORE connecting returns them there (the connectors
  // panel, or the chat card they came from) instead of stranding them in
  // the throwaway "Connect X" task the flow spins up (ENG-1534). Keyed by
  // connect task id (not a single slot) so a second connect/reconnect
  // started before an earlier one is dismissed doesn't clobber the first
  // task's origin.
  const connectOriginsRef = useRef(new Map());

  // Dismiss a connect form. For a not-yet-connected throwaway connect task,
  // drop the task and restore the origin route/task; otherwise just clear
  // the form (existing behavior — e.g. after a successful connect, which has
  // already turned the task into a real conversation).
  const handleConnectFormDismiss = (taskId) => {
    const origin = connectOriginsRef.current.get(taskId);
    const spec = getDataVaultForm(taskId);
    const isConnectTemp = typeof taskId === 'string' && taskId.startsWith('tmp-connect-');
    clearDataVaultForm(taskId);
    if (origin && isConnectTemp && !spec?._is_success) {
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      setActiveTaskId(origin.taskId);
      setRoute(origin.route);
      connectOriginsRef.current.delete(taskId);
    }
  };

  const handleConnectorPicked = async (connector) => {
    setConnectorPickerOpen(false);
    if (!connector?.id) return;
    // Snapshot the origin now, before we switch into the connect task below.
    const originRoute = route;
    const originTaskId = activeTaskId;

    let full = null;
    try {
      full = await fetchConnector(connector.id);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[connectors] failed to load full spec, falling back to chat', e);
    }

    const label = full?.label || connector.label || connector.id;
    const tempId = 'tmp-connect-' + Date.now();
    const hasLiteralForm = !!(full && full.form);

    setTasks((prev) => [{
      id: tempId,
      title: `Connect ${label}`,
      subtitle: 'just now',
      status: hasLiteralForm ? 'idle' : 'active',
      messages: hasLiteralForm
        ? [
            {
              role: 'assistant',
              _kind: 'connect_intro',
              connector: {
                id: full.id,
                label,
                logo: full.form?.logo || full.logo,
                logo_color: full.form?.logo_color || full.logo_color,
              },
              content: `Connect ${label}`,
              _client_only: true,
            },
            {
              role: 'assistant',
              content: CONNECT_FOLLOWUPS[Math.floor(Math.random() * CONNECT_FOLLOWUPS.length)],
              _client_only: true,
            },
          ]
        : [
            {
              role: 'assistant',
              content: `Let's connect ${label}.`,
              _client_only: true,
            },
          ],
      projectName: selectedProject?.name || 'general',
      projectPath: selectedProject?.path || null,
      model: selectedModel?.id || null,
      reasoningEffort: selectedEffort || null,
      attachments: [],
    }, ...prev]);
    setActiveTaskId(tempId);
    setComposerAttachments([]);
    setRoute('task');

    if (hasLiteralForm) {
      // Inject the form spec directly. DataVaultFormPanel reads
      // from the same store; no LLM ever sees the prompt. We also
      // stamp the connector id on the spec so the panel can route
      // OAuth (and any other auth shape) submits through the
      // connector-aware save endpoint instead of the legacy
      // datasources path.
      const connectSpec = {
        ...full.form,
        // Stamp the canonical engine slug so server-side code
        // (datavault_agent: "Trying to connect to **<engine>**…",
        // probe prompt, vault save path) has a deterministic id
        // even when the connector JSON's `form` block doesn't
        // repeat it. Connector JSONs use top-level `id` as the
        // engine slug; we treat that as the source of truth.
        engine: full.form.engine || full.id,
        _connector_id: full.id,
        logo: full.form.logo || full.logo,
        logo_color: full.form.logo_color || full.logo_color,
      };
      setDataVaultForm(tempId, connectSpec);
      // Remember where to return if the user closes the connect modal
      // before actually connecting — the connect task above is throwaway
      // until then (ENG-1534).
      connectOriginsRef.current.set(tempId, { route: originRoute, taskId: originTaskId });
      // Cache the original spec on the connect_intro message so the
      // bubble can re-publish it to the form store if the user
      // closes the panel and clicks the card to bring it back.
      setTasks((prev) => prev.map((t) => t.id !== tempId ? t : {
        ...t,
        messages: t.messages.map((m) =>
          m && m._kind === 'connect_intro' ? { ...m, _form_spec: connectSpec } : m
        ),
      }));
    } else {
      // No registry entry — fall back to the chat-agent flow. This IS a real
      // connect attempt (anton drives it), so there's no throwaway task to
      // return from.
      Promise.resolve().then(() => handleSendFromHome(`Connect ${label}`));
    }
    return tempId;
  };

  const {
    driveAccountChoice,
    driveConnectPrompt,
    resolveDriveAccountChoice,
    cancelDriveAccountChoice,
    confirmDriveConnect,
    cancelDriveConnect,
    handleAddGoogleDriveFiles,
    handleAddGoogleDriveProjectFiles,
    fetchGoogleDriveReferenceFiles,
    removeGoogleDriveFileReference,
  } = useGoogleDrivePicker({
    selectedProject,
    currentTask,
    setComposerAttachments,
    setActiveTaskId,
    setRoute,
  });

  // Keep the ref synced so the Cmd/Ctrl+N keydown handler always calls
  // the latest newTask closure (which captures fresh setRoute/setTasks).
  useEffect(() => { newTaskRef.current = newTask; });

  const clearActive = useCallback(() => {
    setTasks((prev) => prev.map((t) => t.status === 'active' ? { ...t, status: 'idle' } : t));
  }, []);

  // MindsHub SSO — connected flag, sign-in error, and the login/provisioning
  // flow (incl. the main-process auth-changed subscription) live in useSso.
  const { ssoConnected, ssoError, handleSsoSignIn } = useSso({
    settingsOpen,
    setSettingsSection,
    setSettingsOpen,
    refreshData,
  });

  // Usage warnings (ENG-1782). One poll for the whole app; the composer notice
  // and Settings → Usage read it through HubUsageContext. Re-read when a turn
  // finishes too, so a task that just spent the last free tokens flips the
  // notice without waiting for the next tick.
  const accountUser = useAccountUser(ssoConnected);
  const { usage: hubUsage, refresh: refreshHubUsage } = useHubUsage(accountUser);
  const hubUsageCtx = useMemo(() => ({
    usage: hubUsage,
    providerType: providerValueToType(settings.planningProvider) || 'minds-cloud',
    refresh: refreshHubUsage,
  }), [hubUsage, settings.planningProvider, refreshHubUsage]);
  const prevInFlightSize = useRef(inFlightSet.size);
  useEffect(() => {
    if (inFlightSet.size < prevInFlightSize.current) refreshHubUsage();
    prevInFlightSize.current = inFlightSet.size;
  }, [inFlightSet.size, refreshHubUsage]);
  // A usage change DURING a task lands in that task's timeline: free tokens
  // ran out (the task went on, now on the balance) or an auto top up failed.
  // Kept on the task as `usageNotices`, not in `messages`: they are not turns,
  // ChatView renders them after the transcript so the reply stays next to its
  // question, and they are client-side only (gone on reload, by design).
  const prevHubUsage = useRef(hubUsage);
  useEffect(() => {
    const changes = usageTransitions(prevHubUsage.current, hubUsage);
    prevHubUsage.current = hubUsage;
    const streamingId = activeStreamingTaskIdRef.current;
    if (!changes.length || !streamingId) return;
    const createdAt = new Date().toISOString();
    setTasks((prev) => prev.map((t) => (
      t.id === streamingId
        ? { ...t, usageNotices: [...(t.usageNotices || []), ...changes.map((c) => ({ ...c, createdAt }))] }
        : t
    )));
  }, [hubUsage]);

  // Open the Settings surface. A named section drills straight to it (desktop
  // and the mobile master-detail alike). A bare open leaves desktop on its
  // last section (it has no list) but resets the mobile surface to its section
  // list — hence the isMobile-gated null. Single home for this rule so the
  // call sites don't each re-spell it.
  const openSettings = (section = null) => {
    // Channels lives inside Settings, not behind its own route, so it needs
    // its own org-mode intercept here rather than reusing navigate()'s.
    if (orgMode && section === 'channels') {
      setComingSoonFeature('Channels');
      return;
    }
    if (section) setSettingsSection(section);
    else if (isMobile) setSettingsSection(null);
    setSettingsOpen(true);
  };

  const navigate = (key) => {
    if (sidebarPopout) setNavPopoutOpen(false);
    if (key === 'settings' || key.startsWith('settings:')) {
      // Targeted (settings:backend) opens that section; a bare `settings`
      // opens the mobile section list (null) / desktop's last section.
      openSettings(key.includes(':') ? key.split(':')[1] : null);
      return;
    }
    if (key === 'projects') {
      // Clicking "Projects" in the sidebar should always land on the grid of
      // all projects, not the previously-selected project's detail. Clearing
      // here (not in enterRoute) keeps the chat-header crumb path — which
      // routes through onOpenProject and sets selectedProject AFTER routing —
      // unaffected.
      setSelectedProject(null);
    }
    // Flip route state; the URL bridge mirrors it and the route element's
    // enterRoute() (re)fetches that view's data.
    setRoute(key);
  };

  // Same safety net for Channels: the in-Settings nav calls onSectionChange
  // (= setSettingsSection) directly, bypassing openSettings entirely.
  useEffect(() => {
    if (orgMode && settingsSection === 'channels') {
      setComingSoonFeature('Channels');
      setSettingsSection('agent');
    }
  }, [orgMode, settingsSection]);

  // URL → state sync for the route elements. enterRoute is the single place a
  // view's entry data is (re)fetched, so in-app nav / deep link / refresh /
  // Back-Forward all run the same path.
  const enterHome = useCallback(() => {
    setRoute('home');
    setConversationError(null);
    projectDetailTokenRef.current.leave(); // supersede any in-flight detail resolve
    setProjectDetailPending(null);
  }, []);

  const enterRoute = useCallback((key) => {
    setRoute(key);
    setConversationError(null);
    projectDetailTokenRef.current.leave(); // supersede any in-flight detail resolve
    setProjectDetailPending(null); // leaving a detail route (or landing on the grid)
    if (key === 'artifacts') {
      fetchArtifacts().then((data) => { if (Array.isArray(data)) setArtifacts(data); });
    } else if (key === 'projects') {
      // Bare `/projects` is the grid — clear the selection so a Back from
      // `/projects/:id` doesn't render stale detail (detail = enterProjectDetail).
      setSelectedProject(null);
      fetchProjects().then((data) => { if (Array.isArray(data)) setProjects(data); });
    } else if (key === 'scheduled') {
      refreshSchedules();
    }
  }, [refreshSchedules]);

  // Detail routes → state (v1). No single-resource loader: resolve the entity
  // client-side from the fetched list, so refresh / deep-link restore the
  // selection with no server change.
  // Returns a promise resolving to `false` when the id isn't in the list (the
  // route element then replaces the dead URL with `/projects`), else truthy.
  const enterProjectDetail = useCallback((projectId) => {
    setRoute('projects');
    setConversationError(null);
    // Resolving this id: render the grid (not a stale project) until it settles.
    setProjectDetailPending(projectId);
    const reqId = projectDetailTokenRef.current.begin();
    return fetchProjects().then((data) => {
      if (!projectDetailTokenRef.current.isCurrent(reqId)) return true; // superseded — a newer id owns pending, or we left detail
      if (!Array.isArray(data)) { setProjectDetailPending(null); return true; }
      setProjects(data);
      const found = data.find((p) => p.id === projectId || p.name === projectId);
      if (found) { setProjectDetailPending(null); setSelectedProject(found); return true; }
      // Confirmed missing: keep `pending` set (stays on the grid) — the route
      // element replaces the URL with `/projects`, whose enterRoute clears it.
      return false;
    }).catch(() => {
      if (projectDetailTokenRef.current.isCurrent(reqId)) setProjectDetailPending(null);
      return true; // transient failure → keep the URL, don't bounce
    });
  }, []);

  const enterScheduleDetail = useCallback((scheduleId) => {
    setRoute('schedule-detail');
    setSelectedScheduleId(scheduleId);
    setConversationError(null);
    refreshSchedules().catch(() => {});
  }, [refreshSchedules]);

  const attachmentProjectPath = currentTask?.projectPath || selectedProject?.path || null;
  const attachmentProjectName = currentTask?.projectName || selectedProject?.name || null;
  const attachmentSessionId = route === 'task' && currentTask && !String(currentTask.id).startsWith('tmp-') ? currentTask.id : null;

  const handleAttachFiles = (files) => {
    const list = Array.from(files || []).map((file) => ({
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
      source: 'file',
      pendingFile: file,
      name: file.name,
      mime: file.type || undefined,
      size: file.size,
    }));
    setComposerAttachments((prev) => [...prev, ...list]);
  };

  const handleComposerConnectorMute = useCallback((connector, useInChat) => {
    const engine = String(connector?.engine || '').trim();
    const name = String(connector?.name || '').trim();
    if (!engine || !name) return;
    const pk = (x) => `${x.engine.toLowerCase()}\t${x.name}`;
    const ckey = pk({ engine, name });
    setComposerDisabledConnections((prev) => {
      const cur = normalizeComposerDisabledConnections(prev);
      let next;
      if (useInChat) {
        next = cur.filter((x) => pk(x) !== ckey);
      } else {
        if (cur.some((x) => pk(x) === ckey)) return cur;
        next = [...cur, { engine, name }];
      }
      const sig = (arr) => [...arr.map(pk)].sort().join('|');
      if (sig(cur) === sig(next)) return cur;
      return next;
    });
  }, []);

  const handleRemoveAttachment = async (id) => {
    const target = composerAttachments.find((a) => a.id === id);
    setComposerAttachments((prev) => prev.filter((attachment) => attachment.id !== id));
    if (target?.pendingFile || isReferenceOnlyAttachment(target)) return;
    try {
      await deleteAttachment(id);
    } catch {
      // The UI has already removed the pending attachment; stale server cleanup is harmless here.
    }
  };

  // Authoritative provider-readiness check, run right before a send.
  // We can't trust the in-memory `health` here: it's fetched at boot
  // and on focus, so right after a fresh sign-in (especially a free
  // account that lands without a key) it can still read stale —
  // config_ready=true from the previous user, or undefined before the
  // first fetch lands. Either way the old gate (`config_ready !== false`)
  // would pass and we'd start a turn against a missing/foreign key,
  // which is exactly the "it does operations then shows the upgrade
  // card" bug. Re-fetch /health synchronously so the provider-required
  // card shows immediately, before any operation runs. Falls back to
  // the cached value only if the live fetch fails.
  const ensureProviderReady = useCallback(async () => {
    try {
      const fresh = await fetchHealth();
      if (fresh && typeof fresh === 'object') {
        setHealth(fresh);
        setServerOnline(fresh.status === 'ok');
        return fresh.config_ready !== false;
      }
    } catch {
      // Network blip — fall through to the cached value.
    }
    return health?.config_ready !== false;
  }, [health]);

  // Coding mode (MVP, ENG-1656 follow-up): the task never goes through
  // anton/`/responses` — it's recorded (harness/model) via a direct
  // conversation-create call, then ChatView renders a live embedded
  // terminal (CodingTerminal) for it instead of the normal chat transcript,
  // running `claude` in a real PTY cwd'd to the project folder. Thrown
  // errors here surface through the composer's existing inline error UI
  // (same as any other send failure) — no separate toast plumbing needed.
  const launchCodingModeTask = async (text, meta) => {
    let generalProject = projects.find((p) => p.name === 'general');
    const effectiveProject = selectedProject || generalProject;
    if (!effectiveProject?.path) {
      throw new Error('Pick a project with a folder before launching Claude Code.');
    }
    if (!meta.model || meta.model === MODEL_ROUTER_ID) {
      throw new Error('Pick a model before launching Claude Code.');
    }
    const authToken = await revealSettingKey('minds');
    if (!authToken) {
      throw new Error('No MindsHub API key configured — sign in with MindsHub or add a key in Settings before using coding mode.');
    }
    const conversation = await createConversation({
      project: effectiveProject.name,
      projectId: effectiveProject.id,
      topic: text.length > 60 ? text.slice(0, 57) + '…' : text,
      harness: meta.harness,
      model: meta.model,
    });
    const taskId = conversation?.id;
    if (!taskId) {
      throw new Error('Could not create the Claude Code task.');
    }
    setTasks((prev) => [{
      id: taskId,
      title: text.length > 60 ? text.slice(0, 57) + '…' : text,
      subtitle: 'just now',
      status: 'idle',
      messages: [{ role: 'user', content: text, attachments: [] }],
      projectName: effectiveProject.name,
      projectId: effectiveProject.id,
      projectPath: effectiveProject.path,
      harness: meta.harness,
      model: meta.model,
      attachments: [],
      disabledConnections: [],
      pinned: false,
      updatedAt: null,
      createdAt: null,
    }, ...prev]);
    setActiveTaskId(taskId);
    setRoute('task');
  };

  // Ensure the fallback `general` project exists and return it, or null if it
  // could not be found or created. Shared by the home and in-chat send paths so
  // the bootstrap dance (find-by-name → createProject → refetch) lives in one
  // place. Returns null rather than throwing so a caller can surface an
  // actionable error instead of sending against a project that isn't there.
  const ensureGeneralProject = async () => {
    const existing = projects.find((p) => p.name === 'general');
    if (existing) return existing;
    try {
      await createProject('general');
      const fresh = await fetchProjects();
      if (Array.isArray(fresh)) setProjects(fresh);
      // createProject resolved, so `general` exists even if this refetch came
      // back stale — fall back to a name-only record so the caller adopts it.
      return (fresh || []).find((p) => p.name === 'general') || { name: 'general' };
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[ensureGeneralProject] could not bootstrap general project', e);
      return null;
    }
  };

  // Send from the home screen — creates a new session
  const handleSendFromHome = async (text, meta) => {
    if (meta?.harness === 'claude-code') {
      return launchCodingModeTask(text, meta);
    }
    // Preflight: no provider configured → render an action card task
    // instead of routing through anton's LLM path.
    if (!(await ensureProviderReady())) {
      const taskId = `tmp-${Date.now()}`;
      const generalFallback = projects.find((p) => p.name === 'general');
      const effectiveProjectName = selectedProject?.name || 'general';
      const effectiveProjectId = (selectedProject ? selectedProject.id : generalFallback?.id) || null;
      const effectiveProjectPath = selectedProject?.path
        || generalFallback?.path
        || null;
      setTasks((prev) => [{
        id: taskId,
        title: text.length > 60 ? text.slice(0, 57) + '…' : text,
        subtitle: 'just now',
        status: 'idle',
        messages: [
          { role: 'user', content: text, attachments: [] },
          { role: 'provider_required' },
        ],
        projectPath: effectiveProjectPath,
        projectName: effectiveProjectName,
        projectId: effectiveProjectId,
        model: selectedModel?.id ?? null,
        reasoningEffort: selectedEffort ?? null,
        attachments: [],
        disabledConnections: [],
        updatedAt: new Date().toISOString(),
      }, ...prev]);
      setActiveTaskId(taskId);
      setRoute('task');
      setComposerAttachments([]);
      return;
    }

    // Orphan fallback: if the user hasn't picked a project, route the
    // task into "general" (server provisions it on startup). If for
    // any reason it isn't in the projects list yet (e.g. an upgrade
    // from a build that didn't auto-create it), bootstrap it now.
    let generalProject = projects.find((p) => p.name === 'general');
    if (!selectedProject && !generalProject) {
      generalProject = await ensureGeneralProject();
    }
    const effectiveProjectName = selectedProject?.name || 'general';
    const effectiveProjectId = (selectedProject ? selectedProject.id : generalProject?.id) || null;
    const effectiveProjectPath = selectedProject?.path || generalProject?.path || null;

    const disabledForSend = normalizeComposerDisabledConnections(composerDisabledConnections);

    const rawComposer = composerAttachments;
    const hasPendingFiles = rawComposer.some(isPendingFileAttachment);
    const taskId = hasPendingFiles ? allocateConversationId() : `tmp-${Date.now()}`;
    // Flag the not-yet-persisted id so the route loader renders from local
    // state instead of 404ing home.
    markOptimisticConversation(taskId);

    const { merged: sendingAttachments, attachmentIds, reference } = await resolveComposerAttachmentsForSend(
      effectiveProjectName,
      hasPendingFiles ? taskId : null,
      rawComposer,
    );
    const sendText = reference.length ? `${text}\n\n${describeGoogleDriveReferenceFiles(reference)}` : text;
    setComposerAttachments([]);

    // Two-phase send so the new-task experience matches the in-chat
    // send. Previously we shipped the user message + placeholder in the
    // very same frame as the route change, which meant the activity
    // placeholder (filtered out of the chat scroll, only visible in the
    // rail) flashed in then vanished as soon as the first stream event
    // replaced it with a still-empty `_streaming` row. Now:
    //   1. Create an EMPTY task shell + route to it. ChatView mounts
    //      cleanly with no messages.
    //   2. On the next animation frame (after the chat view commits),
    //      add the user message + thinking placeholder, then kick the
    //      stream. From that point the flow is identical to
    //      handleSendInTask.
    const newT = {
      id: taskId,
      title: text.length > 60 ? text.slice(0, 57) + '…' : text,
      subtitle: 'just now',
      status: 'active',
      messages: [],
      projectPath: effectiveProjectPath,
      projectName: effectiveProjectName,
      projectId: effectiveProjectId,
      model: selectedModel?.id ?? null,
      reasoningEffort: selectedEffort ?? null,
      // The composer's harness pick (ENG-1656 follow-up) — Anton or
      // Hermes here; 'claude-code' never reaches this function (the top
      // of handleSendFromHome routes it to launchCodingModeTask instead).
      harness: meta?.harness || null,
      attachments: sendingAttachments,
      disabledConnections: disabledForSend,
      // Stamp a client-side timestamp so the Sidebar's sort-by-
      // updatedAt sees this task as the freshest. Without it, brand-
      // new tasks would sort to the bottom (no updatedAt) until the
      // server's first response back-fills the field.
      updatedAt: new Date().toISOString(),
    };
    setTasks((prev) => [newT, ...prev]);
    setActiveTaskId(taskId);
    setRoute('task');

    let resolvedId = taskId;
    // Server mints the canonical id on `response.created` for tmp- tasks.
    // adoptServerId keeps activeStreamingTaskIdRef (and cancel) in sync.
    const adoptServerId = (sid) => {
      if (!sid || sid === resolvedId) return;
      const previousId = resolvedId;
      resolvedId = sid;
      // Carry over a reply the user started typing under the tmp- id.
      moveDraft(previousId, sid);
      // The canonical id isn't loadable yet either — keep the loader off it.
      markOptimisticConversation(sid);
      setTasks((prev) => prev.map((t) => (
        t.id === previousId || t.id === taskId ? { ...t, id: sid } : t
      )));
      if (activeStreamingTaskIdRef.current === previousId) {
        activeStreamingTaskIdRef.current = sid;
      }
      markInFlightDone(previousId);
      markInFlight(sid);
      setActiveTaskId((curr) => (curr === previousId ? sid : curr));
      migrateQueuedMessages([previousId, taskId], sid);
    };
    // Adapter state — folded by every raw SSE event so the streaming
    // message can carry structured ThinkingStep[] for the UI.
    let streamState = initialStreamState();

    const flushStreamingMessage = () => {
      setTasks((prev) => prev.map((t) => {
        if (t.id !== resolvedId && t.id !== taskId) return t;
        const msgs = removeThinkingPlaceholder(stripStreaming(t.messages));
        return { ...t, messages: [...msgs, {
          role: '_streaming',
          content: streamState.bodyText,
          steps: streamState.steps,
          currentThought: streamState.currentThought,
          startedAt: streamState.startedAt,
          streamStatus: streamState.status,
          harness: streamState.harness,
        }] };
      }));
    };

    // Phase 2 — runs after ChatView has mounted with the empty task.
    // Append the user message + thinking placeholder, then start the
    // stream. Two RAFs give React a guaranteed paint between phases
    // (one to commit the route+task, one to commit the empty mount).
    const startConversation = () => {
      setTasks((prev) => prev.map((t) =>
        t.id === taskId
          ? {
              ...t,
              messages: withThinkingPlaceholder(
                [{ role: 'user', content: text, attachments: sendingAttachments }],
                // New-task path: the placeholder phase is genuinely
                // "spinning up the conversation" — anton-core has to
                // boot the LLM session, attach memories, etc. — so
                // calling it "Creating task…" is more truthful than
                // "Thinking…". The reply path (handleSendInTask)
                // uses the default label since the session is
                // already warm by then.
                { label: 'Creating task…' },
              ),
            }
          : t,
      ));
      activeStreamCtrlRef.current = streamNewSessionFn();
      // Tag which task is mid-flight so reconcileTaskMessages can
      // tell legitimate running indicators from zombies on reload.
      activeStreamingTaskIdRef.current = taskId;
      activeStreamProducedRef.current = false; // fresh stream: no events yet
      markInFlight(taskId);
    };
    trackAgentSessionStarted();
    trackFirstQuery();
    const streamGen = activeStreamGenerationRef.current;
    const streamNewSessionFn = () => streamNewSession(sendText, {
      conversationId: hasPendingFiles ? taskId : undefined,
      projectName: effectiveProjectName,
      projectId: effectiveProjectId,
      projectPath: effectiveProjectPath,
      model: selectedModel?.id,
      reasoningEffort: selectedEffort || null,
      harness: meta?.harness,
      attachmentIds,
      disabledConnections: disabledForSend,
      onEvent(ev) {
        if (streamGen !== activeStreamGenerationRef.current) return;
        const sid = ev?.conversation_id || ev?.response?.conversation_id;
        if (sid) adoptServerId(sid);
        streamState = reduceStream(streamState, ev);
        updateLiveStepsAndDrainQueue([resolvedId, taskId], streamState.steps);
        // Track latest in-progress scratchpad so the Stop button
        // can cancel anton's current cell, not just abort our stream.
        const open = streamState.steps.find((s) => s.status === 'in_progress' && s._isScratchpad);
        if (open?._scratchpadTabId) activeScratchpadRef.current = open._scratchpadTabId;
        flushSync(() => flushStreamingMessage());
      },
      onProgress(event, sid) {
        if (streamGen !== activeStreamGenerationRef.current) return;
        if (sid) adoptServerId(sid);
        // Intentionally a no-op for messages: every `response.in_progress`
        // event already passed through onEvent → flushStreamingMessage,
        // which is the source of truth for the streaming row + steps.
      },
      onToolResult(event, sid) {
        if (sid) adoptServerId(sid);
        // See onProgress comment — same reasoning. The adapter (via
        // onEvent) captures scratchpad results into the steps array.
      },
      onDone(sid) {
        if (streamGen !== activeStreamGenerationRef.current) return;
        activeStreamCtrlRef.current = null;
        activeScratchpadRef.current = null;
        activeStreamingTaskIdRef.current = null;
        const finalId = sid || resolvedId;
        // Turn done → conversation persisted; drop the optimistic flag so a
        // later revisit hydrates fresh instead of replaying this snapshot.
        clearOptimisticConversation(finalId);
        markInFlightDone(finalId);
        if (finalId !== taskId) markInFlightDone(taskId);
        releaseLiveSteps([finalId, taskId]);
        const finalContent = streamState.bodyText;
        const finalSteps = streamState.steps;
        const finalStartedAt = streamState.startedAt;
        const finalHarness = streamState.harness;
        // Anton sometimes wraps auth failures into a 200 stream that
        // emits the error as plain assistant text. Detect that case
        // and replace the assistant turn with the provider_required
        // card instead of rendering the raw SDK message.
        const configErrorInBody = finalContent && isAntonConfigError(finalContent, null);
        // Activation gate (ENG-736): a completed turn (status 'done') is a real
        // answer (success), unless a config error was wrapped into its 200 body.
        // A reconnect that saw no completion records nothing.
        fireFirstResponse(classifyFirstResponse({
          completed: streamState.status === 'done',
          isConfigError: !!configErrorInBody,
        }));
        let assistantTurnIndex = 0;
        setTasks((prev) => prev.map((t) => {
          if (t.id !== finalId && t.id !== resolvedId && t.id !== taskId) return t;
          const msgs = markActivityDone(removeThinkingPlaceholder(stripStreaming(t.messages)));
          // Count prior assistant turns BEFORE adding the new one so
          // the persisted index lines up with what mergeConvTurns
          // expects on reload (the merge walks assistant messages in
          // the same order and looks up by index).
          assistantTurnIndex = msgs.filter((m) => m.role === 'assistant').length;
          if (configErrorInBody) {
            return { ...t, id: finalId, status: 'idle', messages: [...msgs, { role: 'provider_required' }] };
          }
          return finalContent
            ? { ...t, id: finalId, status: 'idle', messages: [...msgs, {
                role: 'assistant',
                content: finalContent,
                steps: finalSteps,
                startedAt: finalStartedAt,
                harness: finalHarness,
              }] }
            : { ...t, id: finalId, status: 'idle', messages: msgs };
        }));
        setActiveTaskId(finalId);
        // Persist all step data (scratchpad cells, artifacts, timing)
        // so reopening the conversation restores the Thinking block,
        // inline artifact cards, and scratchpad tabs. Anton's own
        // history file doesn't carry step metadata, so this is a
        // sidecar in localStorage.
        if (finalContent && !configErrorInBody) {
          persistTurnState(finalId, assistantTurnIndex, finalSteps, finalStartedAt);
          // If the agent streamed a connect form, open the side panel
          // now (keyed to the resolved conversation id the panel reads).
          openStreamedForm(finalId, finalContent);
        }
        fetchArtifacts().then((data) => { if (Array.isArray(data)) setArtifacts(data); });
        // This turn held the shared stream slot; drain anything queued
        // against any task while it ran (ENG-1378).
        drainNextQueuedMessage(finalId);
      },
      onError(message, event) {
        if (streamGen !== activeStreamGenerationRef.current) return;
        releaseLiveSteps([resolvedId, taskId]);
        if (event?.code === 'cancelled') return;
        void (async () => {
          await handleStreamError([resolvedId, taskId], resolvedId, message, event);
          drainNextQueuedMessage(resolvedId);
        })();
      },
    });

    // Schedule phase 2 after ChatView has had a chance to mount and
    // paint with the empty task. Two RAFs is the safest pattern: the
    // first fires after React commits the route change; the second
    // fires after the browser has painted that commit. Only then do
    // we add the user message + thinking placeholder and start the
    // SSE stream — same shape as handleSendInTask from that point on.
    requestAnimationFrame(() => requestAnimationFrame(startConversation));
  };

  // Send inside an existing task
  const handleSendInTask = async (text, queuedAttachments = null, opts = {}) => {
    // opts.targetTask lets the queue drain re-send to a specific task the
    // user may not currently be viewing (ENG-1378); a fresh composer send
    // defaults to the task on screen.
    const targetTask = opts.targetTask || currentTask;
    if (!targetTask) return;
    const id = targetTask.id;

    // Preflight: same gate as handleSendFromHome. Append the user's
    // turn + the action card and stop before any in-flight reservation.
    if (!(await ensureProviderReady())) {
      setTasks((prev) => prev.map((t) =>
        t.id === id
          ? {
              ...t,
              status: 'idle',
              updatedAt: new Date().toISOString(),
              messages: [
                ...t.messages,
                { role: 'user', content: text, attachments: [] },
                { role: 'provider_required' },
              ],
            }
          : t,
      ));
      // Only a fresh send owns the live composer's attachments; a drained
      // queued item must not clear the composer of whatever task is on screen.
      if (queuedAttachments == null) setComposerAttachments([]);
      return;
    }

    // A pending question owns the composer: typed text is the answer, not a
    // new message. Queuing it instead would deadlock — the queue drains on
    // turn completion, and the turn cannot complete until this is answered.
    const answerOutcome = await resolvePendingAnswer({
      steps: liveStepsRef.current[id],
      conversationId: id,
      text,
      submit: submitAnswer,
    });
    if (answerOutcome.action === 'consumed') {
      // The text became the answer — but `submitAnswer` sends `{text}` only, so
      // no file travelled with it. Clearing the staged attachments here would
      // destroy them: never uploaded, never sent, never mentioned. So leave
      // them staged for the next real message (a drained queued item's files
      // have no composer entry of their own, so put them back), and say out
      // loud that they did not go — silence is the failure this whole path
      // exists to prevent.
      const orphaned = queuedAttachments ?? composerAttachments;
      if (queuedAttachments != null && queuedAttachments.length > 0) {
        setComposerAttachments((prev) => {
          const have = new Set(prev.map((a) => a.id));
          const back = queuedAttachments.filter((a) => a && !have.has(a.id));
          return back.length > 0 ? [...prev, ...back] : prev;
        });
      }
      if (orphaned.length > 0) {
        toastManager.add({
          type: 'warning',
          title: orphaned.length === 1
            ? 'Your file was not sent — the agent asked a question first. It is still attached.'
            : `Your ${orphaned.length} files were not sent — the agent asked a question first. They are still attached.`,
        });
      }
      return;
    }
    if (answerOutcome.action === 'fail' || answerOutcome.action === 'blocked') {
      // Two mechanisms, both already used in this file: a toast so the user
      // actually sees the failure, and a throw so Composer's handleSend keeps
      // the typed text instead of clearing it (it only clears after onSend
      // resolves). The interception stays armed — liveStepsRef is untouched —
      // so the retry goes to the same question.
      //
      // `blocked` (a select-only question) rides the same path on purpose: the
      // user's text must survive so they can copy it out, and nothing was sent.
      toastManager.add({ type: 'danger', title: answerOutcome.message });
      throw new Error(answerOutcome.message);
    }
    if (answerOutcome.release) {
      // The question is gone. Release the composer and fall through to the
      // normal send below, so the typed text becomes a message instead of
      // being silently dropped.
      //
      // Retire exactly the question that was answered, never the whole mirror:
      // a blanket clear would also drop a live sibling question's interception,
      // and nothing re-arms it while that sibling blocks the turn (see
      // retireQuestionFromSteps). retireLiveQuestion also rewrites every alias,
      // which a direct assignment to this one id would not.
      retireLiveQuestion(id, answerOutcome.questionId);
    }

    // Anton-core can't run two turns in parallel against the same
    // conversation, so if a stream is in flight (or one is about to
    // start) for this task we queue the new message and let
    // onDone/onError drain it.
    //
    // The check covers two race conditions:
    //   1) `activeStreamCtrlRef` is already set — a fully launched
    //      stream is in flight.
    //   2) `activeStreamingTaskIdRef` is set but the controller hasn't
    //      been assigned yet — a previous invocation is mid-await
    //      (resolving attachments). This holds for ANY task's
    //      reservation, not just this id: two rapid clicks on the same
    //      task, or a manual send that lands while a cross-task drain
    //      (ENG-1378) is between reserving the slot and awaiting
    //      attachments, both otherwise pass the guard and start a second
    //      parallel stream against anton-core (which runs one turn at a
    //      time). The reservation is always cleared on done/error, so a
    //      broadened guard cannot wedge later sends.
    if (activeStreamingTaskIdRef.current || activeStreamCtrlRef.current) {
      // Queue with the files attached so a mid-stream send doesn't drop
      // them. A fresh send takes the composer's attachments and clears
      // them (the queued item now owns them); a re-enqueued queued item
      // reuses its own and leaves the live composer untouched.
      enqueueMessage(
        id,
        text,
        queuedAttachments ?? composerAttachments,
        opts.disabledConnections != null ? opts.disabledConnections : composerDisabledConnections,
      );
      if (queuedAttachments == null) setComposerAttachments([]);
      return;
    }
    // Synchronous reservation so a second invocation that fires
    // before our awaits resolve sees us as "in flight."
    activeStreamingTaskIdRef.current = id;
    activeStreamProducedRef.current = false; // fresh stream: no events yet
    // Cross-client cache: we know this conversation is about to be
    // mid-stream. Marking immediately (rather than waiting for the
    // /in-flight-list poll to discover it) means reconcileTaskMessages
    // never has to lie when another tab opens this conversation.
    markInFlight(id);

    const disabledForSend = normalizeComposerDisabledConnections(
      opts.disabledConnections != null ? opts.disabledConnections : composerDisabledConnections,
    );

    // A drained item's target task may not be the one on screen, so resolve
    // its project independently rather than reusing the current view's
    // `currentTaskProject`. Keep the same `|| selectedProject` last-resort
    // that `currentTaskProject` has, so a project-less task's drained send
    // resolves the same project a live send to it would (parity — otherwise
    // even the on-screen task's own follow-up loses the fallback on drain).
    const taskProject = opts.targetTask
      ? (resolveTaskProject(targetTask, projects) || selectedProject)
      : currentTaskProject;
    let taskProjectName = targetTask.projectName
      || (taskProject?.name)
      || null;
    let taskProjectId = targetTask.projectId
      || taskProject?.id
      || null;
    let taskProjectPath = targetTask.projectPath
      || taskProject?.path
      || null;

    // A file upload needs a project (uploadAttachments writes the bytes under
    // one). An existing task with no project — the user never picked a working
    // folder — would otherwise throw in resolveComposerAttachmentsForSend and
    // strand the image at "Queued" with the send going nowhere. A home send
    // already bootstraps `general` in this case; do the same here so an
    // in-chat attachment send doesn't dead-end where a home send wouldn't.
    const attachmentsForSend = queuedAttachments ?? composerAttachments;
    if (!taskProjectName && (attachmentsForSend || []).some(isPendingFileAttachment)) {
      const general = await ensureGeneralProject();
      // Only adopt `general` if it actually exists now. If the bootstrap
      // failed, leave the project unset so resolveComposerAttachmentsForSend
      // throws the actionable "Pick a project…" error (surfaced via the toast
      // below) rather than sending against a project that isn't there.
      if (general) {
        taskProjectName = general.name || 'general';
        taskProjectId = general.id || null;
        taskProjectPath = general.path || null;
      }
    }
    // opts.modelOverride carries a same-tick model switch (the "Switch to
    // MindsHub Air" card action, ENG-1304) — targetTask is a render-scope
    // closure, so a setTasks({...model}) just before this call would not be
    // visible here yet. The `selectedModel` fallback is the on-screen model
    // picker, so only a live send to the task on screen may inherit it; a
    // drained off-screen task must not pick up whatever model the current
    // view happens to show — it falls through to the server default instead.
    const taskModel = opts.modelOverride
      || targetTask.model
      || (opts.targetTask ? null : selectedModel?.id)
      || null;
    // Sibling precedence chain to taskModel (ENG-1940): a same-tick
    // override, else the task's own saved pick, else — only for a live
    // send to the task on screen — the home composer's current pick.
    // selectedEffort defaults to '', so the trailing `|| null` collapses
    // that (and any other falsy pick) to null the same way taskModel's does.
    const taskEffort = (opts.effortOverride
      ?? targetTask.reasoningEffort
      ?? (opts.targetTask ? null : selectedEffort))
      || null;

    let sendingAttachments, attachmentIds, driveReference;
    try {
      ({ merged: sendingAttachments, attachmentIds, reference: driveReference } = await resolveComposerAttachmentsForSend(
        taskProjectName,
        id,
        // A drained queued item carries its own attachments; only a
        // fresh send pulls from the live composer.
        queuedAttachments ?? composerAttachments,
      ));
    } catch (err) {
      // Attachment resolution failed before we ever started the
      // stream — release the reservation so the user's next send
      // doesn't get stuck in the queue forever.
      activeStreamingTaskIdRef.current = null;
      // Make the failure impossible to miss. The inline composer error alone
      // was easy to overlook, so a file that couldn't upload just sat at
      // "Queued" with no visible reason (the exact shape of the stuck-upload
      // report). Surface a toast too, then re-throw so Composer keeps the text
      // and the staged file for a retry.
      toastManager.add({
        type: 'danger',
        title: err?.message || 'Could not send your attachment. Please try again.',
      });
      throw err;
    }

    setTasks((prev) => prev.map((t) =>
      t.id === id
        ? {
            ...t,
            disabledConnections: disabledForSend,
            status: 'active',
            attachments: [...(t.attachments || []), ...sendingAttachments],
            messages: withThinkingPlaceholder([...t.messages, { role: 'user', content: text, attachments: sendingAttachments }]),
            // "Reviving" a task (replying in an existing one) must
            // bump updatedAt locally — the server only rewrites
            // _meta.json when the turn completes, but we want
            // Sidebar's sort-by-updatedAt to move this task to the
            // top the instant the user hits send. mergeTasksFromServer
            // keeps the higher of (local, server) updatedAt so a
            // mid-stream fetchSessions can't regress this.
            updatedAt: new Date().toISOString(),
          }
        : t,
    ));
    // A fresh send just consumed the live composer's attachments; a
    // drained queued item brought its own, so don't wipe whatever the
    // user may have started composing since.
    if (queuedAttachments == null) setComposerAttachments([]);

    let streamState = initialStreamState();
    // `id` is the local task id we started with. If it's a temporary
    // (`tmp-connect-…`), the server replaces it with a fresh canonical
    // id and returns the new value via `response.created`. We adopt
    // that id everywhere the local task is keyed — without this the
    // server has a real conversation but the client keeps showing
    // (and persisting in-flight refs against) the tmp- id, and the
    // next fetchSessions would surface BOTH rows.
    let resolvedId = id;
    const adoptServerId = (sid) => {
      if (!sid || sid === resolvedId) return;
      const previousId = resolvedId;
      resolvedId = sid;
      // Carry over a reply the user started typing under the tmp- id.
      moveDraft(previousId, sid);
      markOptimisticConversation(sid);
      setTasks((prev) => prev.map((t) => (
        t.id === previousId || t.id === id ? { ...t, id: sid } : t
      )));
      // Move the in-flight + active refs onto the new id so cancel /
      // reconcile passes look at the right key.
      if (activeStreamingTaskIdRef.current === previousId) {
        activeStreamingTaskIdRef.current = sid;
      }
      markInFlightDone(previousId);
      markInFlight(sid);
      setActiveTaskId((curr) => (curr === previousId ? sid : curr));
      migrateQueuedMessages([previousId, id], sid);
      // Migrate the form store so a success-state panel (e.g. the
      // OAuth success screen set just before onContinue was called)
      // survives the ID change and stays visible under the new task id.
      const existingForm = getDataVaultForm(previousId);
      if (existingForm) {
        const existingFormState = getDataVaultFormState(previousId);
        const existingMethod = getDataVaultSelectedMethod(previousId);
        setDataVaultForm(sid, existingForm);
        if (existingFormState) setDataVaultFormState(sid, existingFormState);
        if (existingMethod) setDataVaultSelectedMethod(sid, existingMethod);
        clearDataVaultForm(previousId);
      }
    };

    const flushStreaming = () => {
      setTasks((prev) => prev.map((t) => {
        if (t.id !== id && t.id !== resolvedId) return t;
        const msgs = removeThinkingPlaceholder(stripStreaming(t.messages));
        return { ...t, messages: [...msgs, {
          role: '_streaming',
          content: streamState.bodyText,
          steps: streamState.steps,
          currentThought: streamState.currentThought,
          startedAt: streamState.startedAt,
          streamStatus: streamState.status,
          harness: streamState.harness,
        }] };
      }));
    };

    // If a connect form is active for this conversation, append a
     // redacted snapshot of its state to the *sent* text so the agent
     // sees what the user has selected / filled. The on-screen bubble
     // keeps the original text — Anton-only context, never shown.
    const connectFormState = getDataVaultFormState(id);
    const connectContext = describeConnectFormState(connectFormState);
    const driveContext = describeGoogleDriveReferenceFiles(driveReference);
    const hiddenContext = [connectContext, driveContext].filter(Boolean).join('\n\n');
    const sendText = hiddenContext ? `${text}\n\n${hiddenContext}` : text;

    // Tag this task as currently streaming so reconcileTaskMessages
    // can distinguish a real in-flight turn from a zombie placeholder.
    activeStreamingTaskIdRef.current = id;
    const streamGen = activeStreamGenerationRef.current;
    activeStreamCtrlRef.current = streamMessage(id, sendText, {
      projectName: taskProjectName,
      projectId: taskProjectId,
      projectPath: taskProjectPath,
      model: taskModel,
      reasoningEffort: taskEffort,
      attachmentIds,
      disabledConnections: disabledForSend,
      onEvent(ev) {
        if (streamGen !== activeStreamGenerationRef.current) return;
        // Adopt the server's canonical id as soon as it lands. The
        // server's `chat_stream` strips `tmp-` prefixes and mints a
        // fresh id; the new value rides on `response.created`.
        const sid = ev?.conversation_id || ev?.response?.conversation_id;
        if (sid) adoptServerId(sid);
        streamState = reduceStream(streamState, ev);
        updateLiveStepsAndDrainQueue([resolvedId, id], streamState.steps);
        const open = streamState.steps.find((s) => s.status === 'in_progress' && s._isScratchpad);
        if (open?._scratchpadTabId) activeScratchpadRef.current = open._scratchpadTabId;
        flushSync(() => flushStreaming());
      },
      onDone() {
        if (streamGen !== activeStreamGenerationRef.current) return;
        activeStreamCtrlRef.current = null;
        activeScratchpadRef.current = null;
        activeStreamingTaskIdRef.current = null;
        // Turn done → conversation persisted; drop the optimistic flag (set if
        // `id` was a tmp-connect id that adopted a server id).
        clearOptimisticConversation(resolvedId);
        markInFlightDone(resolvedId);
        if (resolvedId !== id) markInFlightDone(id);
        releaseLiveSteps([resolvedId, id]);
        const finalContent = streamState.bodyText;
        const finalSteps = streamState.steps;
        const finalStartedAt = streamState.startedAt;
        const finalHarness = streamState.harness;
        const configErrorInBody = finalContent && isAntonConfigError(finalContent, null);
        // Activation gate (ENG-736): a completed turn (status 'done') is a real
        // answer (success), unless a config error was wrapped into its 200 body.
        // A reconnect that saw no completion records nothing.
        fireFirstResponse(classifyFirstResponse({
          completed: streamState.status === 'done',
          isConfigError: !!configErrorInBody,
        }));
        let assistantTurnIndex = 0;
        setTasks((prev) => prev.map((t) => {
          if (t.id !== id && t.id !== resolvedId) return t;
          const msgs = markActivityDone(removeThinkingPlaceholder(stripStreaming(t.messages)));
          assistantTurnIndex = msgs.filter((m) => m.role === 'assistant').length;
          if (configErrorInBody) {
            return { ...t, status: 'idle', messages: [...msgs, { role: 'provider_required' }] };
          }
          return finalContent
            ? { ...t, status: 'idle', messages: [...msgs, {
                role: 'assistant',
                content: finalContent,
                steps: finalSteps,
                startedAt: finalStartedAt,
                harness: finalHarness,
              }] }
            : { ...t, status: 'idle', messages: msgs };
        }));
        if (finalContent && !configErrorInBody) {
          // Sidecar — see persistTurnState comment for the full schema.
          persistTurnState(resolvedId, assistantTurnIndex, finalSteps, finalStartedAt);
          openStreamedForm(resolvedId, finalContent);
        }
        fetchArtifacts().then((data) => { if (Array.isArray(data)) setArtifacts(data); });
        // Drain the next queued message now that the single stream slot is
        // free. Sweeps every task's queue (preferring this task for FIFO
        // order on its own follow-ups), not just the finishing task's — a
        // message queued for a different task while this one streamed must
        // not strand forever at "N queued · waiting for Anton" (ENG-1378).
        drainNextQueuedMessage(resolvedId);
      },
      onError(message, event) {
        if (streamGen !== activeStreamGenerationRef.current) return;
        releaseLiveSteps([resolvedId, id]);
        if (event?.code === 'cancelled') return;
        void (async () => {
          await handleStreamError([resolvedId, id], resolvedId, message, event);
          // See onDone — drain across all tasks once the slot frees.
          drainNextQueuedMessage(resolvedId);
        })();
      },
    });
  };

  // Drain the next queued message once the single stream slot is free.
  // Sending is serialized app-wide (anton-core runs one turn at a time),
  // but queues are per-task — so after a turn ends we must sweep every
  // task's queue, not just the finishing one. `preferredTaskId` (the
  // finishing task) is tried first so its own follow-ups keep FIFO order.
  const drainNextQueuedMessage = (preferredTaskId) => {
    // Slot re-reserved (a new turn already started) — that turn's own
    // onDone/onError will drain next. Prevents launching two parallel turns.
    if (activeStreamCtrlRef.current || activeStreamingTaskIdRef.current) return;
    const taskId = selectNextQueuedTask(
      messageQueueRef.current,
      new Set(tasksRef.current.map((t) => t.id)),
      preferredTaskId,
    );
    if (!taskId) return;
    const targetTask = tasksRef.current.find((t) => t.id === taskId);
    if (!targetTask) return;
    const next = popQueueHead(taskId);
    if (!next) return;
    // handleSendInTask can reject (answer submit, or attachment resolution).
    // The item is already popped, so a bare then() would both surface an
    // unhandled rejection AND silently lose the message + its file. Put it back
    // on the queue instead — it stays visible as "queued" rather than
    // vanishing, and handleSendInTask surfaces why it failed.
    Promise.resolve().then(() => handleSendInTask(next.text, next.attachments || [], {
      targetTask,
      disabledConnections: next.disabledConnections,
    })).catch(() => {
      enqueueMessage(taskId, next.text, next.attachments || [], next.disabledConnections || []);
    });
  };
  // Keep the mount-frozen reconnect closure pointed at the current drain (and
  // thus the current handleSendInTask). See the ref declaration above.
  drainNextQueuedMessageRef.current = drainNextQueuedMessage;

  // Submit a data-vault form. Drives a fresh assistant turn from the
  // cowork agent endpoint instead of the LLM — same SSE stream shape,
  // same React state machine. The user sees a normal Anton bubble
  // appear after they submit; under the hood the LLM never read the
  // values. Mirrors handleSendInTask but wired to streamDataVaultSubmission.
  const handleSubmitDataVaultForm = ({ formId, formSpec, values, skipped, name, method }) => {
    if (!currentTask) return;
    const id = currentTask.id;

    setTasks((prev) => prev.map((t) =>
      t.id === id
        ? { ...t, status: 'active' }
        : t,
    ));

    let streamState = initialStreamState();
    // See handleSendInTask for the rationale — the datavault stream's
    // `response.created` carries the server-minted id when the client
    // sent a `tmp-connect-…` tmp id. Adopting it here keeps the local
    // task keyed against the same id the server is persisting under,
    // so a subsequent fetchSessions doesn't end up with two rows for
    // the same conversation.
    let resolvedId = id;
    const adoptServerId = (sid) => {
      if (!sid || sid === resolvedId) return;
      const previousId = resolvedId;
      resolvedId = sid;
      // Carry over a reply the user started typing under the tmp- id.
      moveDraft(previousId, sid);
      markOptimisticConversation(sid);
      setTasks((prev) => prev.map((t) => (
        t.id === previousId || t.id === id ? { ...t, id: sid } : t
      )));
      if (activeStreamingTaskIdRef.current === previousId) {
        activeStreamingTaskIdRef.current = sid;
      }
      setActiveTaskId((curr) => (curr === previousId ? sid : curr));
      migrateQueuedMessages([previousId, id], sid);
      // Migrate the formStore entry so the DataVaultFormPanel
      // (which re-subscribes under the new id) and incoming
      // data-vault-form-patch blocks (keyed to the new id) both
      // find the form. Without this the panel loses its spec and
      // the success patch falls through to a bare setForm.
      const existingForm = getDataVaultForm(previousId);
      if (existingForm) {
        const existingFormState = getDataVaultFormState(previousId);
        const existingMethod = getDataVaultSelectedMethod(previousId);
        setDataVaultForm(sid, existingForm);
        if (existingFormState) setDataVaultFormState(sid, existingFormState);
        if (existingMethod) setDataVaultSelectedMethod(sid, existingMethod);
        clearDataVaultForm(previousId);
      }
    };

    const flushStreaming = () => {
      setTasks((prev) => prev.map((t) => {
        if (t.id !== id && t.id !== resolvedId) return t;
        const msgs = removeThinkingPlaceholder(stripStreaming(t.messages));
        return { ...t, messages: [...msgs, {
          role: '_streaming',
          content: streamState.bodyText,
          steps: streamState.steps,
          currentThought: streamState.currentThought,
          startedAt: streamState.startedAt,
          streamStatus: streamState.status,
          harness: streamState.harness,
        }] };
      }));
    };

    activeStreamingTaskIdRef.current = id;
    activeStreamProducedRef.current = false; // fresh stream: no events yet
    // Same generation guard the other three stream sites carry, in the same
    // order: generation → release → (`cancelled` bail, where the transport
    // reports one). It is not enough that "this stream cannot carry ask_user"
    // — that is a claim about today's server, while onEvent below pushes
    // through the same `updateLiveStepsAndDrainQueue` and `reduceStream` as
    // every other site. Two ways a superseded data-vault stream would
    // otherwise stall the composer:
    //   (a) its late onEvent overwrites liveStepsRef[cid] with its own steps,
    //       masking a newer run's pending question — no ask_user needed on
    //       this stream at all;
    //   (b) its late onDone/onError deletes the newer run's entry.
    // Either way the composer stops redirecting, the next send is queued
    // behind a turn that cannot complete, and it sits there until the
    // server's 300 s question timeout.
    //
    // The counter is deliberately global rather than per conversation: there
    // is only ever one `activeStreamCtrlRef` slot, so only one stream can be
    // live, and the sole bump site (handleStopStream) explicitly releases the
    // conversation it just stopped. Making it per conversation would buy
    // nothing while one-stream-at-a-time holds.
    const streamGen = activeStreamGenerationRef.current;
    activeStreamCtrlRef.current = streamDataVaultSubmission({
      formId,
      // Pass the local id only when it's a real server id — otherwise
      // send null so the server mints a fresh canonical id. (The
      // server has a defensive guard for this too, but skipping the
      // tmp- id at the wire saves a round-trip's worth of confusion.)
      conversationId: id && !String(id).startsWith('tmp-') ? id : null,
      formSpec,
      values,
      skipped,
      name,
      method,
      onEvent(ev) {
        if (streamGen !== activeStreamGenerationRef.current) return;
        const sid = ev?.conversation_id || ev?.response?.conversation_id;
        if (sid) adoptServerId(sid);
        streamState = reduceStream(streamState, ev);
        updateLiveStepsAndDrainQueue([resolvedId, id], streamState.steps);
        // The probe's `data-vault-form-patch` success signal travels
        // inside the SSE body text, but MarkdownCode can't process it
        // (the streaming message has complete=false, and the final
        // assistant message mounts as historical). Detect the terminal
        // `response.completed` event with status "success" and flip
        // the form store directly so the DataVaultFormPanel shows the
        // success state and the user can dismiss the modal.
        if (ev?.type === 'response.completed') {
          const cid = resolvedId || id;
          const currentForm = getDataVaultForm(cid);
          if (currentForm) {
            const respStatus = ev?.response?.status;
            if (respStatus === 'success') {
              patchDataVaultForm(cid, {
                form_id: currentForm.form_id,
                _is_probing: false,
                _is_success: true,
                status_text: null,
                form_error: null,
              });
              trackDataSourceConnected(formSpec?._connector_id || formSpec?.engine || currentForm._connector_id || currentForm.engine || name || 'unknown');
            } else if (respStatus === 'retry' || respStatus === 'failed') {
              patchDataVaultForm(cid, {
                form_id: currentForm.form_id,
                _is_probing: false,
                _is_success: false,
                status_text: null,
              });
            }
          }
        }
        flushSync(() => flushStreaming());
      },
      onChunk(chunk, sid) {
        if (streamGen !== activeStreamGenerationRef.current) return;
        if (sid) adoptServerId(sid);
        // data-vault-form-patch blocks are delivered as complete deltas —
        // parse and apply them immediately so the panel can show the
        // spinner (_is_probing), status updates, and the error card
        // (form_error) in real-time without waiting for MarkdownCode.
        const patchMatch = /```data-vault-form-patch\n([\s\S]*?)\n```/.exec(chunk);
        if (patchMatch) {
          try {
            const patch = JSON.parse(patchMatch[1]);
            patchDataVaultForm(resolvedId || id, patch);
          } catch {}
        }
      },
      onDone(sid) {
        if (streamGen !== activeStreamGenerationRef.current) return;
        if (sid) adoptServerId(sid);
        activeStreamCtrlRef.current = null;
        activeStreamingTaskIdRef.current = null;
        releaseLiveSteps([resolvedId, id]);
        // Turn done → conversation persisted; drop the optimistic flag.
        clearOptimisticConversation(resolvedId);
        const finalContent = streamState.bodyText;
        const finalSteps = streamState.steps;
        const finalStartedAt = streamState.startedAt;
        const finalHarness = streamState.harness;
        let assistantTurnIndex = 0;
        setTasks((prev) => prev.map((t) => {
          if (t.id !== id && t.id !== resolvedId) return t;
          const msgs = markActivityDone(removeThinkingPlaceholder(stripStreaming(t.messages)));
          assistantTurnIndex = msgs.filter((m) => m.role === 'assistant').length;
          return finalContent
            ? { ...t, status: 'idle', messages: [...msgs, {
                role: 'assistant',
                content: finalContent,
                steps: finalSteps,
                startedAt: finalStartedAt,
                harness: finalHarness,
              }] }
            : { ...t, status: 'idle', messages: msgs };
        }));
        if (finalContent) {
          persistTurnState(resolvedId, assistantTurnIndex, finalSteps, finalStartedAt);
          openStreamedForm(resolvedId, finalContent);
        }
        // A successful save changes the connectors list — refetch
        // so the Connect Apps and Data page reflects it immediately.
        fetchDatasources()
          .then((data) => setConnectors(Array.isArray(data?.connections) ? data.connections : []))
          .catch(() => {});
        // This turn held the shared stream slot; drain anything queued
        // against any task while it ran (ENG-1378).
        drainNextQueuedMessage(resolvedId);
      },
      // No `cancelled` bail here, unlike the other three sites: this
      // transport's onError takes a message only, with no event/code to
      // inspect. An abort therefore lands as a plain error — but the
      // generation guard above already swallows it, because the only thing
      // that aborts this stream is handleStopStream, which bumps first.
      onError(message) {
        if (streamGen !== activeStreamGenerationRef.current) return;
        activeStreamCtrlRef.current = null;
        activeStreamingTaskIdRef.current = null;
        releaseLiveSteps([resolvedId, id]);
        setTasks((prev) => prev.map((t) => {
          if (t.id !== id && t.id !== resolvedId) return t;
          const msgs = markActivityDone(removeThinkingPlaceholder(stripStreaming(t.messages)));
          return { ...t, status: 'error', messages: [...msgs, {
            role: 'error',
            content: message || 'Form submission failed.',
          }] };
        }));
        drainNextQueuedMessage(resolvedId);
      },
    });
  };

  const setSetting = (key, value) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const handleCreateProject = async ({ name, _alreadyCreated, _inline }) => {
    // The new-project modal does the create + anton.md write +
    // file uploads in one atomic flow; when it calls back here it
    // sets `_alreadyCreated` so we skip the duplicate POST and just
    // refresh the projects list + pin the new one as selected.
    const project = _alreadyCreated
      ? { name }
      : await createProject(name);
    const latest = await fetchProjects();
    let selected = project;
    if (Array.isArray(latest)) {
      setProjects(latest);
      selected = latest.find((p) => p.name === project.name) || project;
      setSelectedProject(selected);
    }
    // `_inline` is set by the home composer's "+ New project" row —
    // the user is mid-task and shouldn't be teleported to the
    // projects grid just because they named a project for the
    // pending prompt. All other call sites (the modal, the projects
    // grid card) already live on or want to land on /projects.
    if (!_inline) setRoute('projects');
    return selected;
  };

  const handlePinTask = async (task) => {
    await pinTask(task);
    setTasks((prev) => prev.map((item) => item.id === task.id ? { ...item, pinned: true } : item));
    const data = await fetchPins();
    setPins(data.pins || []);
  };

  const handleUnpinTask = async (id) => {
    await unpinTask(id);
    setTasks((prev) => prev.map((item) => item.id === id ? { ...item, pinned: false } : item));
    const data = await fetchPins();
    setPins(data.pins || []);
  };

  const handleRenameTask = async (taskId, newTitle) => {
    if (!newTitle?.trim()) return;
    const next = newTitle.trim();
    // Optimistic update — flip back if the server rejects.
    setTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, title: next } : t));
    try {
      await renameConversation(taskId, next);
    } catch {
      // Reload from server on failure to recover the canonical title.
      const fresh = await fetchSessions();
      if (Array.isArray(fresh)) setTasks(fresh.filter((t) => !deletedTaskIdsRef.current.has(t.id)));
    }
  };

  // Two-step delete: open the confirm modal, run the actual delete
  // when the user confirms. Replaces the native window.confirm so the
  // dialog matches the rest of the UX.
  const handleDeleteTask = (taskId) => {
    // eslint-disable-next-line no-console
    console.log('[handleDeleteTask] open confirm for', taskId);
    setPendingDeleteTaskId(taskId);
  };
  const performDeleteTask = async (taskId) => {
    if (!taskId) return;
    // eslint-disable-next-line no-console
    console.log('[performDeleteTask] confirmed', taskId);
    const task = tasks.find((t) => t.id === taskId);
    // Fire-and-forget: stop the PTY (if still running) and remove its git
    // worktree/branch under <project>/.claude_tasks/<taskId>/ so deleted
    // tasks don't leave orphaned directories behind. A no-op on web/for
    // non-claude-code tasks (host.removeCodingTask itself no-ops there).
    if (task?.harness === 'claude-code' && task?.projectPath) {
      host.removeCodingTask(taskId, task.projectPath).catch(() => {});
    }
    deletedTaskIdsRef.current.add(taskId);
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    // Its unsent reply draft has nowhere to go back to.
    clearDraft(taskId);
    // Optimistically remove from pins so the sidebar clears immediately.
    setPins((prev) => prev.filter((p) => p.item_id !== taskId));
    if (activeTaskId === taskId) {
      setActiveTaskId(null);
      // Only fall back to home when we're *viewing* the task that
      // just got deleted — leaving the chat view on a phantom id
      // would be incoherent. From any other surface (project view,
      // scheduled, settings, etc.) the user expects to stay where
      // they were and just see the row disappear from the list.
      if (route === 'task') setRoute('home');
    }
    // Skip the server call for tasks that never got persisted (still
    // wearing a tmp- id from before the first stream chunk arrived).
    if (typeof taskId === 'string' && taskId.startsWith('tmp-')) {
      // eslint-disable-next-line no-console
      console.log('[performDeleteTask] tempId — local-only delete');
      return;
    }
    try {
      await deleteConversation(taskId);
      // eslint-disable-next-line no-console
      console.log('[performDeleteTask] server delete ok');
      // Unpin only once the delete has really happened. Run in parallel, a
      // refused delete still committed the unpin server-side, and the
      // restored row came back silently unpinned across reloads.
      await unpinTask(taskId).catch(() => {}); // unpin is a no-op if not pinned
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[performDeleteTask] server delete failed', e);
      /*
        The chat is still on the server, so put the row back rather than leave
        the sidebar claiming it is gone. Console-only used to mean the user saw
        a successful delete, deleted it again on the next visit, and only found
        out on a reload. The access log carried the same ids two and three
        times over.

        Dropping the tombstone first is what makes the refetch work at all:
        every consumer of fetchSessions filters through deletedTaskIdsRef, and
        nothing else ever clears it, so the row would stay hidden for the life
        of the mount. Same recovery as handleRenameTask above.

        The route is deliberately not restored. The user asked to leave this
        chat, and yanking them back into it is a bigger surprise than the row
        reappearing in the list where the toast says to look.
      */
      deletedTaskIdsRef.current.delete(taskId);
      const fresh = await fetchSessions().catch(() => null);
      setTasks((prev) => {
        /*
          fetchSessions resolves [] when the server is unreachable, so treat
          an empty answer as no answer — replacing the list with it would
          blank every chat in the sidebar. mergeTasksFromServer, same as
          every other consumer, keeps streaming messages, model pins and
          tmp- rows that a wholesale replace would clobber. prev already
          lost this row to the optimistic filter above, so when the refetch
          brought nothing back, re-seat the captured task — the toast says
          the chat is back in the list, and it has to be true.
        */
        const merged = mergeTasksFromServer(fresh?.length ? fresh : null, prev);
        if (task && !merged.some((t) => t.id === taskId)) merged.unshift(task);
        return merged.filter((t) => !deletedTaskIdsRef.current.has(t.id));
      });
      toastManager.add({
        type: 'danger',
        // Needs action before it makes sense to move on, so it persists
        // until dismissed, like the OAuth refresh-failure toast.
        timeout: 0,
        title: "Couldn't delete this chat. It is back in your list; try again.",
        description: e?.message,
      });
    }
    fetchPins().then((data) => setPins(data.pins || [])).catch(() => {});
  };

  // Pending delete-turn confirm payload — null when no modal is open.
  // The user clicked the trash on the assistant message at this turn
  // index of the conversation; we open ConfirmModal, then on confirm
  // hit the API and re-hydrate the chat from the truncated history.
  const [pendingDeleteTurn, setPendingDeleteTurn] = useState(null);

  const handleDeleteTurnRequest = (taskId, turnIndex) => {
    if (!taskId || typeof turnIndex !== 'number') return;
    setPendingDeleteTurn({ taskId, turnIndex });
  };

  const performDeleteTurn = async (taskId, turnIndex) => {
    if (!taskId || typeof turnIndex !== 'number') return;
    // If anton is actively streaming a response to the turn being
    // deleted, stop the stream first so the SSE connection doesn't
    // keep producing events for a turn that no longer exists. The
    // silent flag skips the post-cancel session refetch.
    if (activeStreamingTaskIdRef.current === taskId) {
      try { await handleStopStream({ silent: true }); } catch {}
    }
    if (typeof taskId === 'string' && taskId.startsWith('tmp-')) {
      // No server-side history yet — drop the local pair only.
      setTasks((prev) => prev.map((t) => {
        if (t.id !== taskId) return t;
        let assistantSeen = -1;
        let dropFromUserAt = -1;
        let dropEnd = (t.messages || []).length;
        for (let i = 0; i < (t.messages || []).length; i++) {
          const m = t.messages[i];
          if (m.role === 'user' && dropFromUserAt === -1 && assistantSeen + 1 === turnIndex) {
            dropFromUserAt = i;
          }
          if (m.role === 'assistant') {
            assistantSeen += 1;
            if (dropFromUserAt !== -1 && assistantSeen > turnIndex) {
              dropEnd = i;
              break;
            }
          }
        }
        if (dropFromUserAt === -1) return t;
        return {
          ...t,
          messages: [
            ...t.messages.slice(0, dropFromUserAt),
            ...t.messages.slice(dropEnd === t.messages.length ? dropEnd : dropEnd),
          ],
        };
      }));
      return;
    }
    try {
      await deleteConversationTurn(taskId, turnIndex);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[performDeleteTurn] server delete failed', e);
      alert(`Could not delete this exchange: ${e?.message || e}`);
      return;
    }
    // Re-fetch the conversation so `tasks[].messages` reflects the
    // truncated server history (and any reindexed events sidecar).
    try {
      const fresh = await fetchSession(taskId);
      if (fresh && Array.isArray(fresh.messages)) {
        setTasks((prev) => prev.map((t) =>
          t.id === taskId
            ? { ...t, messages: applySessionMessages(taskId, fresh.messages) }
            : t,
        ));
      }
    } catch {}
  };

  const handleDeleteProject = (project) => {
    if (!project?.name) return;
    setPendingDeleteProject(project);
  };
  const performDeleteProject = async (project) => {
    if (!project?.name) return;
    // The server cascades a project delete to its conversations (ENG-701),
    // so tombstone their ids the same way performDeleteTask does for a single
    // delete. Without this, an in-flight fetchSessions that started before the
    // delete resolves with stale data, and mergeTasksFromServer's carry-over
    // re-adds the (now server-deleted) conversations — leaving a "ghost" that
    // opens but errors on send, until an app restart (ENG-666). Match by name
    // OR path: the server stamps conv.project = project.name (and project_path
    // = project.path), so this catches every conversation in the project.
    const doomedTaskIds = tasksRef.current
      .filter((t) => t.projectName === project.name || t.projectPath === project.path)
      .map((t) => t.id);
    doomedTaskIds.forEach((id) => deletedTaskIdsRef.current.add(id));
    // The project's own composer draft, plus every draft belonging to a
    // conversation the server is about to cascade-delete.
    clearDraft(`project:${project.id || project.name}`);
    doomedTaskIds.forEach((id) => clearDraft(id));
    // Optimistic — drop locally before the round-trip.
    setProjects((prev) => prev.filter((p) => p.name !== project.name));
    setTasks((prev) => prev.filter((t) =>
      t.projectName !== project.name && t.projectPath !== project.path
    ));
    if (selectedProject?.name === project.name) setSelectedProject(null);
    // If the conversation currently open belonged to this project, clear it —
    // otherwise currentTask silently falls back to tasks[0] (an unrelated
    // conversation from another project). Only leave the chat view when we're
    // actually on it; from the projects view (where deletes usually happen)
    // the user should stay put — same policy as performDeleteTask.
    if (activeTaskId && doomedTaskIds.includes(activeTaskId)) {
      setActiveTaskId(null);
      if (route === 'task') setRoute('home');
    }
    try { await deleteProject(project); } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[performDeleteProject] failed', e);
    }
    // Refresh from server to recover the canonical state.
    fetchProjects().then((data) => { if (Array.isArray(data)) setProjects(data); }).catch(() => {});
    fetchSessions().then((data) => {
      if (Array.isArray(data)) setTasks((prev) => mergeTasksFromServer(data, prev).filter((t) => !deletedTaskIdsRef.current.has(t.id)));
    }).catch(() => {});
  };

  // Opening the picker just stashes the task; the modal collects the
  // destination + "move everything" choice and calls handleConfirmMove.
  const handleOpenMoveModal = (task) => {
    if (task?.id) setMoveModalTask(task);
  };

  const handleConfirmMove = async (destName, { isNew = false, moveEverything = true } = {}) => {
    const task = moveModalTask;
    if (!task || !destName) return;
    let targetName = destName;
    let targetPath = task.projectPath;
    try {
      if (isNew) {
        const created = await createProject(destName);
        targetName = created?.name || destName;
        targetPath = created?.path || targetPath;
        const freshProjects = await fetchProjects();
        if (Array.isArray(freshProjects)) setProjects(freshProjects);
      } else {
        targetPath = projects.find((p) => p.name === targetName)?.path || targetPath;
      }
      // Optimistic: show the task under the new project immediately.
      setTasks((prev) => prev.map((t) =>
        t.id === task.id
          ? { ...t, projectName: targetName, projectPath: targetPath }
          : t
      ));
      await moveTaskToProject(task.id, targetName, moveEverything);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[move task] failed', e);
    } finally {
      setMoveModalTask(null);
    }
    // Server is canonical — refresh tasks + projects after the move.
    const fresh = await fetchSessions();
    if (Array.isArray(fresh)) setTasks(fresh.filter((t) => !deletedTaskIdsRef.current.has(t.id)));
    const freshProjects = await fetchProjects();
    if (Array.isArray(freshProjects)) setProjects(freshProjects);
  };

  // Diffs the full conversation list against known tasks and adds any
  // unseen ones — catches every new conversation since the last check,
  // not just the most recent one.
  const syncNewConversations = useCallback(async () => {
    const conversations = await fetchConversationList();
    const known = new Set(tasksRef.current.map((t) => t.id));
    const unseenIds = conversations.map((c) => c.id).filter((id) => id && !known.has(id));
    if (unseenIds.length === 0) return;
    const SYNC_CAP = 50;
    const toFetch = unseenIds.slice(0, SYNC_CAP);
    const freshTasks = await Promise.all(toFetch.map((id) => fetchSession(id)));
    setTasks((prev) => {
      let next = prev;
      for (const task of freshTasks) {
        if (!task || deletedTaskIdsRef.current.has(task.id)) continue;
        if (next.some((t) => t.id === task.id)) continue;
        next = [task, ...next];
      }
      return next;
    });
  }, []);

  // Recomputed whenever an enabled schedule's due time or running state
  // changes — used as the poll effect's dependency below instead of
  // `scheduled.length`, which stays the same across an edit/pause/resume.
  // The running flag matters: when "Run now" flips it on, the pending long
  // timer must be replaced with the tight in-flight cadence.
  const scheduleKey = scheduled
    .filter((s) => s.enabled || s.running)
    .map((s) => `${s.nextRunAt}:${s.running ? 1 : 0}`)
    .join(',');

  // Self-adjusting poll (not a fixed interval): reschedules itself after
  // every tick based on the freshest `nextRunAt`, so an idle app with
  // schedules due far in the future stays quiet, while one with something
  // due soon checks close to that moment. Skipped entirely when there are
  // no schedules at all — nothing to poll for.
  useEffect(() => {
    let cancelled = false;
    let timer = setTimeout(tick, nextPollDelay(scheduled));
    async function tick() {
      const list = await refreshSchedules();
      const known = new Set(tasksRef.current.map((t) => t.id));
      const hasNewRun = list.some((s) => s.lastResultConversationId && !known.has(s.lastResultConversationId));
      if (hasNewRun) await syncNewConversations();
      if (cancelled) return;
      timer = setTimeout(tick, nextPollDelay(list));
    }
    return () => { cancelled = true; clearTimeout(timer); };
  }, [scheduleKey, refreshSchedules, syncNewConversations]);

  const handleRunScheduleNow = async (id) => {
    const result = await runScheduleNow(id);
    // The server creates the conversation eagerly and returns its id.
    // Mark it in-flight locally so reconcileTaskMessages doesn't inject
    // a spurious "got interrupted" prompt before the 5s poll catches up,
    // then navigate straight to the new run so the user sees it stream.
    if (result?.conversation_id) {
      markInFlight(result.conversation_id);
      setActiveTaskId(result.conversation_id);
      setRoute('task');
    }
    await refreshSchedules();
    refreshData();
  };

  const handleSearchSelect = (result) => {
    if (result.type === 'task' || (result.type === 'pin' && result.route === 'task')) {
      selectTask(result.id);
    } else if (result.type === 'project') {
      const project = projects.find((p) => p.name === result.id || p.path === result.id);
      if (project) setSelectedProject(project);
      setRoute('projects');
    } else if (result.type === 'attachment' && result.sessionId) {
      selectTask(result.sessionId);
    } else if (result.type === 'schedule') {
      setRoute('scheduled');
    } else {
      setRoute('artifacts');
    }
  };

  const { showDots, accentVariant } = settings;
  const accentCss = ACCENT_VARS[accentVariant] || {};
  // appStyle + mainBg deliberately transparent so the gravity-field
  // canvas painted behind the React root is the visible background.
  // Individual views can supply their own surface (HomeView is fully
  // transparent — the greeting + composer float over the field;
  // dense views like Settings get a subtle frosted overlay below).
  const appStyle = { width: '100vw', height: '100vh', background: 'transparent' };

  const mainBg = 'transparent';

  // One shell-owned top inset the content header uses to clear the macOS
  // traffic lights and the floating open-sidebar button when neither is
  // covered by a docked sidebar: the tablet band (640–900, sidebar is an
  // off-canvas popout) and a collapsed sidebar on the chat route. Reserving
  // the space on TOP (not the left) keeps every header's title/crumb aligned
  // with the body beneath it and uses the full width, instead of shoving the
  // header right into a lopsided gutter. Both the lights and the hamburger
  // sit within the top ~44px, so 52 clears them on either platform (web has
  // no lights but still floats the hamburger). Exposed as `--titlebar-safe-top`
  // on <main> and consumed by PageHeader / view headers.
  const contentChromeExposed = sidebarPopout || sidebarCollapsedEffective;
  const titlebarSafeTop = contentChromeExposed ? 52 : 0;

  // Model Router isn't a real catalog model — Composer.jsx injects its own
  // pinned row directly, so it must not also get merged in here or it'd
  // show up twice (once pinned, once sorted into the "Other" maker group).
  const modelOptions = selectedModel && selectedModel.id !== MODEL_ROUTER_ID && !models.some((m) => m.id === selectedModel.id)
    ? [selectedModel, ...models]
    : models;

  // Props for the mobile drawer (MobileShell), which AppShell renders below
  // the phone breakpoint. Kept here (not in AppShell) because every handler
  // closes over App's navigation state.
  const mobileShellProps = {
    route,
    currentTask,
    selectedProject,
    tasks,
    projects,
    scheduled,
    artifacts,
    onNavigate: navigate,
    onSelectTask: selectTask,
    onSelectProject: (p) => {
      // Drawer → project tap with tasks: show the project's task list
      // (ProjectsView in detail mode). MobileShell only dispatches here when
      // there ARE tasks; the empty-project case routes through
      // onNewTaskInProject instead.
      if (p) setSelectedProject(p);
      setRoute('projects');
    },
    onNewTaskInProject: (p) => {
      // Empty project → drop into the composer with the project preselected.
      if (p) setSelectedProject(p);
      setActiveTaskId(null);
      setRoute('home');
    },
    onOpenSchedule: (scheduleId) => {
      setSelectedScheduleId(scheduleId);
      setRoute('schedule-detail');
    },
    onNewTask: newTask,
    onNewProject: () => {
      // Mobile FAB → "New project". The modal lives inside ProjectsView, so
      // navigate there (on the grid, not detail), then dispatch the event
      // ProjectsView listens for once mounted.
      setSelectedProject(null);
      setRoute('projects');
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('anton:open-new-project'));
      }, 60);
    },
    navTitle: settings.navTitle || null,
    navLogo: settings.navLogo || null,
    // Mobile has no room for the desktop floating-toggle-row (bottom-right,
    // over the FAB) — the theme toggle moves into the top bar, opposite the
    // hamburger, and the coding-mode toggle is dropped entirely rather than
    // hunting for a second spot.
    theme,
    showThemeToggle: settings.showThemeToggle !== false,
    onToggleTheme: () => {
      if (settings.show8bitToggle === false) {
        setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
      } else {
        setThemeModalOpen(true);
      }
    },
  };

  // The app chrome — sidebar, content column, modals. Still holds the
  // `route`-keyed view switch plus the router's <Outlet/>; handed to the router
  // via context.
  const shell = (
    <div style={{
      ...appStyle, ...accentCss,
      display: 'flex', gap: 9, padding: 9,
      position: 'relative',
      // Make the whole window draggable. Buttons/inputs/textareas stay
      // clickable via the global `no-drag` rule in globals.css. Scrollable
      // surfaces, <main>, the composer, etc. opt out below so they don't
      // intercept drag on their own surface.
      WebkitAppRegion: 'drag',
    }}>
      {/*
        Sidebar — a docked flex item across the whole desktop + tablet range
        (≥640). `display: contents` makes the wrapper transparent to the flex
        layout so Sidebar participates as a direct flex child. Suppressed on
        isMobile — MobileShell replaces it with a mobile drawer below 640.
      */}
      {/* Narrow-band popout backdrop — dims content behind the slid-in
          sidebar. Same 320ms curve as the drawer so the two read as one
          motion (the old overlay used mismatched 280/380ms durations). */}
      {sidebarPopout && !isMobile && (
        <div
          onClick={() => setNavPopoutOpen(false)}
          aria-hidden="true"
          style={{
            position: 'fixed', inset: 0, zIndex: 100,
            background: 'rgba(0,0,0,0.35)',
            backdropFilter: 'blur(2px)',
            // Only opt out of the window drag region while the scrim is
            // actually up — it's a full-viewport `inset: 0` box, so leaving
            // it permanently `no-drag` (as when this only fired for the
            // rare narrow band) killed dragging the whole window the
            // moment Coding Mode made this common, even while invisible:
            // Electron computes the drag region from app-region CSS, not
            // from opacity/pointer-events. Closed, it just inherits the
            // ancestor `drag` region again.
            WebkitAppRegion: navPopoutOpen ? 'no-drag' : 'drag',
            opacity: navPopoutOpen ? 1 : 0,
            pointerEvents: navPopoutOpen ? 'auto' : 'none',
            transition: 'opacity 320ms cubic-bezier(0.32, 0.72, 0, 1)',
          }}
        />
      )}

      {/* Floating corner row — back to its original bottom-right placement,
          matching the onboarding pages (App.tsx's .arcade-theme-toggle,
          which never moved). Same corner on every route, task view
          included — one consistent location, not a bespoke per-view
          control.
            - Display Settings: opens ThemeModal (Light/Dark + Normal/8-Bit
              picker) — the sidebar's old "Display settings" button (now
              removed) folded into this.
            - Coding Mode (desktop only): a bare "</>" glyph beside it,
              deliberately un-boxed so it reads as a status indicator, not
              a second button of the same weight — lit accent when on,
              greyed out when off. Toggles the setting directly on click;
              no modal, since there's nothing else to configure here.
            - Hidden entirely on mobile — MobileShell renders its own theme
              toggle in the top bar (opposite the hamburger) instead, and
              the coding-mode toggle is dropped there rather than given a
              second spot.
            - Narrow/tablet band (popout sidebar, not yet phone-width): the
              bottom-right corner overlaps task rows and the composer's
              send button there, so the row moves to the top-right instead
              — just left of the per-view expand/collapse-right-panel
              button (see .floating-toggle-row--top-right). This is keyed
              on the true viewport band (`isNarrow`), not `sidebarPopout` —
              Coding Mode's popout sidebar is desktop-width, so this row
              stays put in its usual bottom-right corner there. */}
      {!isMobile && (() => {
        const showCodingToggle = !host.isWeb && host.codingModeOptionsEnabled && settings.showCodingModeToggle !== false;
        const codingModeOn = showCodingToggle && codingModeActive;
        const showThemeToggle = settings.showThemeToggle !== false || settings.show8bitToggle !== false;
        if (!showCodingToggle && !showThemeToggle) return null;
        return (
          <div className={`floating-toggle-row [-webkit-app-region:no-drag]${isNarrow ? ' floating-toggle-row--top-right' : ''}`}>
            {showCodingToggle && (
              <Tooltip content={codingModeOn ? 'Turn off coding mode' : 'Turn on coding mode'}>
                <button
                  type="button"
                  onClick={() => {
                    const next = !settings.codingModeEnabled;
                    setSetting('codingModeEnabled', next);
                    saveSettings({ codingModeEnabled: next }).catch(() => {});
                  }}
                  aria-label={codingModeOn ? 'Turn off coding mode' : 'Turn on coding mode'}
                  aria-pressed={codingModeOn}
                  className={'coding-mode-toggle' + (codingModeOn ? ' is-on' : '')}
                >
                  {Ico.code(15)}
                </button>
              </Tooltip>
            )}
            {showThemeToggle && (
              // With the 8-bit skin toggle hidden there's nothing else to
              // pick in the modal — just flip dark/light directly. The
              // modal only earns the extra click when it actually offers
              // something beyond that.
              <Tooltip content={settings.show8bitToggle === false ? 'Toggle dark/light mode' : 'Display settings'}>
                <button
                  onClick={() => {
                    if (settings.show8bitToggle === false) {
                      setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
                    } else {
                      setThemeModalOpen(true);
                    }
                  }}
                  aria-label={settings.show8bitToggle === false ? 'Toggle dark/light mode' : 'Open display settings'}
                  className="floating-toggle"
                >
                  {theme === 'dark' ? Ico.sun(15) : Ico.moon(15)}
                </button>
              </Tooltip>
            )}
          </div>
        );
      })()}

      {!isMobile && (
      <div
        style={sidebarPopout ? {
          // Popout: off-canvas fixed drawer, slid in on navPopoutOpen. Same
          // 320ms curve as the scrim above. Docked (display:contents)
          // otherwise — a wide desktop viewport with Coding Mode off.
          position: 'fixed', top: 9, bottom: 9, left: 9, zIndex: 101,
          transform: navPopoutOpen ? 'translateX(0)' : 'translateX(calc(-100% - 18px))',
          transition: 'transform 320ms cubic-bezier(0.32, 0.72, 0, 1)',
          willChange: 'transform',
          WebkitAppRegion: 'no-drag',
        } : { display: 'contents' }}
      >
        <Sidebar
          tasks={tasks}
          pins={pins}
          scheduledCount={scheduled.length}
          projectsCount={projects.length}
          artifactsCount={artifacts.length}
          connectorsCount={connectors.length}
          activeRoute={route === 'task' ? null : (route === 'schedule-detail' ? 'scheduled' : route)}
          settingsActive={settingsOpen}
          // Only mark a recent as "selected" while actually viewing a task —
          // activeTaskId persists across navigation, so passing it unconditionally
          // left the last-opened task highlighted on Projects/Settings/etc.
          activeTaskId={route === 'task' ? activeTaskId : null}
          serverOnline={serverOnline}
          agentLabel={agentLabel}
          isSsoConnected={ssoConnected}
          onNavigate={navigate}
          onSelectTask={selectTask}
          onNewTask={newTask}
          onOpenSearch={() => setSearchOpen(true)}
          collapsed={sidebarCollapsedEffective}
          onToggleCollapsed={
            sidebarPopout
              ? () => setNavPopoutOpen(false)
              : (sidebarCollapsibleRoutes.has(route)
                  ? () => setSidebarCollapsed((c) => !c)
                  : undefined)
          }
          onPinTask={handlePinTask}
          onUnpinTask={handleUnpinTask}
          onRenameTask={handleRenameTask}
          onDeleteTask={handleDeleteTask}
          onMoveTaskToProject={handleOpenMoveModal}
          projects={projects}
          schedules={scheduled}
          scheduleRunsIndex={scheduleRunsIndex}
          onOpenSchedule={(scheduleId) => {
            if (sidebarPopout) setNavPopoutOpen(false);
            setSelectedScheduleId(scheduleId);
            setRoute('schedule-detail');
          }}
          serverBusy={serverBusy}
          serverBusyKind={serverBusyKind}
          showCounters={settings.showCounters !== false}
          navTitle={settings.navTitle || null}
          navLogo={settings.navLogo || null}
          updateBanner={updateBanner}
          onUpdateAction={handleUpdateAction}
          onDismissUpdate={dismissShellUpdate}
          onStartChat={(text) => {
            // Popout sidebar (narrow desktop, or Coding Mode) is an overlay
            // drawer. Close it like navigate/onOpenSchedule do, so the new
            // task isn't buried under it.
            if (sidebarPopout) setNavPopoutOpen(false);
            handleSendFromHome(text);
          }}
          // Hold the tip while the popout drawer is shut: Sidebar sees
          // collapsed={false} there, but the whole wrapper is translated
          // off-screen, so its anchor is invisible. The armed state
          // survives — it opens when the drawer does.
          artifactTipOpen={artifactTipOpen && !(sidebarPopout && !navPopoutOpen)}
          onArtifactTipDismiss={handleArtifactTipDismiss}
          onShowServerHelp={() => openSettings('backend')}
          onToggleServer={async () => {
            if (serverBusy) return;
            // Decide intent from main's actual state, not renderer state.
            // Treat "running OR mid-start" as up so a click during boot
            // stops the in-flight start instead of double-spawning python.
            let actuallyRunning = serverOnline;
            let actuallyStarting = false;
            try {
              const info = await host.serverInfo();
              if (info) {
                if (typeof info.running === 'boolean') actuallyRunning = info.running;
                if (typeof info.starting === 'boolean') actuallyStarting = info.starting;
              }
            } catch {}
            const isUp = actuallyRunning || actuallyStarting;
            const goingUp = !isUp;
            setServerBusyKind(goingUp ? 'starting' : 'stopping');
            setServerBusy(true);
            try {
              const result = goingUp
                ? await host.serverStart()
                : await host.serverStop();
              if (result) {
                setServerOnline(!!result.running);
                if (result.running) setTimeout(refreshData, 400);
              }
            } catch {} finally {
              setServerBusy(false);
            }
          }}
        />
      </div>
      )}

      <AppShell
        isMobile={isMobile}
        mainBg={mainBg}
        titlebarSafeTop={titlebarSafeTop}
        showFloatingHamburger={sidebarPopout ? !navPopoutOpen : sidebarCollapsedEffective}
        onOpenSidebar={sidebarPopout ? () => setNavPopoutOpen(true) : () => setSidebarCollapsed(false)}
        mobileShellProps={mobileShellProps}
      >
        {/* Mounts the matched child route element, which syncs `route` /
            `activeTaskId` to the URL. It renders no visible output — the
            active view is still chosen by the `route`-keyed switch below. */}
        <Outlet />
        {route === 'home' && (
          <HomeView
            greeting={settings.greeting}
            showDots={showDots}
            activeTasks={activeTasks}
            onSelectTask={selectTask}
            onClearActive={clearActive}
            onSend={handleSendFromHome}
            project={selectedProject}
            onProjectChange={setSelectedProject}
            model={selectedModel}
            onModelChange={setSelectedModel}
            effort={selectedEffort}
            onEffortChange={setSelectedEffort}
            projects={projects}
            models={modelOptions}
            modelMeta={modelMeta}
            attachments={composerAttachments}
            connectors={connectors}
            onNavigateToConnectors={() => navigate('customize')}
            onAttachFiles={handleAttachFiles}
            onAddGoogleDriveFiles={handleAddGoogleDriveFiles}
            onRemoveAttachment={handleRemoveAttachment}
            disabledConnections={composerDisabledConnections}
            onUpdateConnectorMute={handleComposerConnectorMute}
            onCreateProject={(args) => handleCreateProject({ ...args, _inline: true })}
            configReady={health.config_ready ?? settings.configReady}
            configError={health.config_error ?? settings.configError}
            onOpenSettings={openSettings}
            modelLabels={settings.modelLabels}
            codingModelDefault={settings.codingModel}
            harnessHermesEnabled={settings.harnessHermesEnabled ?? true}
            harnessClaudeCodeEnabled={settings.harnessClaudeCodeEnabled ?? true}
            serverOnline={serverOnline}
            agentLabel={agentLabel}
            onShowServerHelp={() => openSettings('backend')}
            skipIntro={bootIntroDone}
            prefill={composerPrefill}
            onPrefill={(text, select) => setComposerPrefill({ text, bump: Date.now(), select })}
            codingModeEnabled={codingModeActive}
          />
        )}

        {route === 'task' && showConversationError && <ConversationUnavailable />}

        {route === 'task' && showConversationLoading && <ConversationLoading />}

        {route === 'task' && currentTask && !showConversationError && (
          <ChatView
            task={currentTask}
            onSend={handleSendInTask}
            onSwitchToAirAndResend={airAvailableForSwitch ? handleSwitchToAirAndResend : undefined}
            onOpenSettings={openSettings}
            modelLabels={settings.modelLabels}
            codingModelDefault={settings.codingModel}
            harnessHermesEnabled={settings.harnessHermesEnabled ?? true}
            harnessClaudeCodeEnabled={settings.harnessClaudeCodeEnabled ?? true}
            queuedMessages={messageQueue[currentTask?.id] || []}
            onRemoveFromQueue={(itemId) => removeFromQueue(currentTask?.id, itemId)}
            onBack={() => {
              // Returning home = "new task in this project". Pre-select
              // the task's project so the home composer is ready to go.
              if (currentTaskProject) setSelectedProject(currentTaskProject);
              setRoute('home');
            }}
            project={currentTaskProject}
            model={currentTaskModel}
            onModelChange={(m) => {
              // Same pattern as handleSwitchToAirAndResend: write the pick
              // onto the task itself so it's visible immediately (drives
              // currentTaskModel) and so handleSendInTask's existing
              // `currentTask.model` fallback picks it up on the very next
              // send, with no changes needed there.
              if (!currentTask) return;
              setTasks((prev) => prev.map((t) => (t.id === currentTask.id ? { ...t, model: m.id } : t)));
            }}
            effort={currentTaskEffort}
            onEffortChange={(e) => {
              if (!currentTask) return;
              setTasks((prev) => prev.map((t) => (t.id === currentTask.id ? { ...t, reasoningEffort: e } : t)));
            }}
            models={modelOptions}
            modelMeta={modelMeta}
            attachments={composerAttachments}
            connectors={connectors}
            onAttachFiles={handleAttachFiles}
            onAddGoogleDriveFiles={handleAddGoogleDriveFiles}
            onAddGoogleDriveProjectFiles={handleAddGoogleDriveProjectFiles}
            onFetchGoogleDriveProjectFiles={fetchGoogleDriveReferenceFiles}
            onRemoveGoogleDriveProjectFile={removeGoogleDriveFileReference}
            disabledConnections={composerDisabledConnections}
            onRemoveAttachment={handleRemoveAttachment}
            onUpdateConnectorMute={handleComposerConnectorMute}
            onPinTask={handlePinTask}
            onUnpinTask={handleUnpinTask}
            onRenameTask={handleRenameTask}
            onDeleteTask={handleDeleteTask}
            onDeleteTurn={(turnIdx) => handleDeleteTurnRequest(currentTask?.id, turnIdx)}
            onMoveTaskToProject={handleOpenMoveModal}
            onStop={handleStopStream}
            onSubmitDataVaultForm={handleSubmitDataVaultForm}
            onNavigateToConnectors={() => navigate('customize')}
            onDismissConnectForm={handleConnectFormDismiss}
            onCancelModify={handleCancelModify}
            onDisconnectModify={handleDisconnectFromModify}
            onOpenProject={(p) => {
              if (p) setSelectedProject(p);
              setRoute('projects');
            }}
            onOpenProjectsList={() => {
              // "Projects" crumb → projects grid view (no specific
              // project selected). Clearing selectedProject ensures
              // ProjectsView starts in grid mode rather than detail.
              setSelectedProject(null);
              setRoute('projects');
            }}
            projects={projects}
            agentLabel={agentLabel}
            inFlightSet={inFlightSet}
            composerRedirects={composerRedirects}
            onComposerRedirectConsumed={(taskId, attachments) => {
              // The drained files are staged here, at consumption time, and never
              // at drain time: `composerAttachments` is app-wide, so staging a
              // background task's files early would show them as chips on
              // whatever conversation is open and send them there. The consumer
              // hands them back because it is the one that knows the redirect was
              // for the task on screen.
              const back = Array.isArray(attachments) ? attachments : [];
              if (back.length > 0) {
                setComposerAttachments((prev) => {
                  const have = new Set(prev.map((a) => a.id));
                  const fresh = back.filter((a) => a && !have.has(a.id));
                  return fresh.length > 0 ? [...prev, ...fresh] : prev;
                });
              }
              setComposerRedirects((prev) => {
                if (!taskId || !prev[taskId]) return prev;
                const next = { ...prev };
                delete next[taskId];
                return next;
              });
            }}
            onQuestionAnswered={(result, conversationId, questionId) => {
              // Keyed off the conversation the card was rendered with, not the
              // currently-open task — the card knows which conversation it
              // belongs to and this must not depend on them being the same.
              // And keyed off the question too: a dead card must not take a
              // live sibling's interception down with it.
              if (!conversationId) return;
              if (result?.status === 'not_found' || result?.status === 'already_answered') {
                retireLiveQuestion(conversationId, questionId);
                return;
              }
              // A retryable failure only clears the card's `busy`: the button
              // flashes disabled and comes back, so the user believes the click
              // landed. It did not — the answer was never recorded and the agent
              // stays blocked until the server's 300 s timeout. The composer path
              // already surfaces exactly these two statuses with a toast; the
              // card path must too, and the asymmetry was the defect.
              if (result?.status === 'error') {
                toastManager.add({
                  type: 'danger',
                  title: 'Could not send your answer. Please try again.',
                });
              } else if (result?.status === 'rejected') {
                // From a button press this means the app submitted a shape the
                // card itself rendered — a stale or raced card, not something the
                // user can fix by choosing differently.
                toastManager.add({
                  type: 'danger',
                  title: 'That answer was not accepted. Reload the conversation to see the question as it stands now.',
                });
              }
            }}
          />
        )}

        {route === 'projects' && (
          <ProjectsView
            projects={projects}
            selectedProject={selectedProjectForView}
            loading={projectDetailResolving}
            tasks={tasks}
            scheduled={scheduled}
            scheduleRunsIndex={scheduleRunsIndex}
            models={modelOptions}
            modelMeta={modelMeta}
            model={selectedModel}
            onModelChange={setSelectedModel}
            effort={selectedEffort}
            onEffortChange={setSelectedEffort}
            onSelectProject={(p) => setSelectedProject(p)}
            onCreateProject={handleCreateProject}
            onSendInProject={(text, meta) => {
              // Sending from project detail = same path as home, but
              // selectedProject is already pinned to this project so
              // the new task lands in the right workspace.
              handleSendFromHome(text, meta);
            }}
            codingModeEnabled={codingModeActive}
            onSelectTask={selectTask}
            onDeleteTask={handleDeleteTask}
            onMoveTaskToProject={handleOpenMoveModal}
            onDeleteProject={handleDeleteProject}
            attachments={composerAttachments}
            connectors={connectors}
            onNavigateToConnectors={() => navigate('customize')}
            onAttachFiles={handleAttachFiles}
            onAddGoogleDriveFiles={handleAddGoogleDriveFiles}
            onAddGoogleDriveProjectFiles={handleAddGoogleDriveProjectFiles}
            onFetchGoogleDriveProjectFiles={fetchGoogleDriveReferenceFiles}
            onRemoveGoogleDriveProjectFile={removeGoogleDriveFileReference}
            onRemoveAttachment={handleRemoveAttachment}
            disabledConnections={composerDisabledConnections}
            onUpdateConnectorMute={handleComposerConnectorMute}
            onOpenSchedule={(task) => {
              // Same handler ScheduledView uses — routes to the
              // schedule detail page for the clicked row.
              setSelectedScheduleId(task.id);
              setRoute('schedule-detail');
            }}
            agentLabel={agentLabel}
            onOpenSettings={openSettings}
            modelLabels={settings.modelLabels}
            codingModelDefault={settings.codingModel}
            harnessHermesEnabled={settings.harnessHermesEnabled ?? true}
            harnessClaudeCodeEnabled={settings.harnessClaudeCodeEnabled ?? true}
          />
        )}

        {route === 'scheduled' && (
          <ScheduledView
            scheduled={scheduled}
            projects={projects}
            models={modelOptions}
            selectedProject={selectedProject}
            selectedModel={selectedModel}
            onCreate={handleCreateSchedule}
            onUpdate={handleUpdateSchedule}
            onDelete={handleDeleteSchedule}
            onPause={handlePauseSchedule}
            onResume={handleResumeSchedule}
            onRunNow={handleRunScheduleNow}
            onOpenSchedule={(task) => {
              setSelectedScheduleId(task.id);
              setRoute('schedule-detail');
            }}
            onOpenProject={(p) => {
              if (p) setSelectedProject(p);
              setRoute('projects');
            }}
            agentLabel={agentLabel}
          />
        )}

        {route === 'schedule-detail' && (
          <ScheduleDetailView
            task={scheduled.find((s) => s.id === selectedScheduleId) || null}
            projects={projects}
            models={modelOptions}
            agentLabel={agentLabel}
            onBack={() => { setSelectedScheduleId(null); setRoute('scheduled'); }}
            onUpdate={handleUpdateSchedule}
            onDelete={async (id) => {
              await handleDeleteSchedule(id);
              setSelectedScheduleId(null);
              setRoute('scheduled');
            }}
            onPause={handlePauseSchedule}
            onResume={handleResumeSchedule}
            onRunNow={handleRunScheduleNow}
            onOpenRunSession={(sessionId) => {
              if (!sessionId) return;
              // Scheduled runs create real conversations on the
              // server, but they may not be in our local recents list
              // yet (e.g. the run fired while we were on another
              // device or before this session's last fetch). Refresh
              // tasks in parallel so currentTask resolves once the
              // server response lands, and route immediately so the
              // user sees the navigation happen.
              fetchSessions().then((data) => {
                if (Array.isArray(data)) {
                  setTasks((prev) =>
                    mergeTasksFromServer(data, prev)
                      .filter((t) => !deletedTaskIdsRef.current.has(t.id))
                  );
                }
              }).catch(() => {});
              setActiveTaskId(sessionId);
              setRoute('task');
            }}
          />
        )}

        {route === 'artifacts' && (
          <ArtifactsView
            artifacts={artifacts}
            projects={projects}
            agentLabel={agentLabel}
            onOpenProject={(p) => {
              // Pin the project so ProjectsView opens directly in detail
              // (its `selectedProject` effect mirrors that into local
              // `detailProject` state on mount), then flip the route.
              if (p) setSelectedProject(p);
              setRoute('projects');
            }}
          />
        )}

        {route === 'tasks' && (
          <TasksView
            tasks={tasks}
            projects={projects}
            schedules={scheduled}
            scheduleRunsIndex={scheduleRunsIndex}
            onOpenTask={(id) => selectTask(id)}
            onOpenProject={(p) => {
              if (p) setSelectedProject(p);
              setRoute('projects');
            }}
            onOpenSchedule={(scheduleId) => {
              setSelectedScheduleId(scheduleId);
              setRoute('schedule-detail');
            }}
            onDeleteTask={handleDeleteTask}
            onMoveTaskToProject={handleOpenMoveModal}
          />
        )}


        {route === 'customize' && (
          <CustomizeView
            connectors={connectors}
            onConnectionsSynced={(next) =>
              setConnectors(Array.isArray(next) ? next : [])}
            onOpenSettings={openSettings}
            onConnectNew={handleStartConnectChat}
            onReconnect={(spec) => handleConnectorPicked(spec)}
            agentLabel={agentLabel}
          />
        )}

        {/* Settings modal — rendered over whatever route is active */}
        {/* Mobile (ENG-990): Settings is a full page with accordion nav, not
            a modal. Gated on isMobile; desktop keeps the two-column modal. */}
        {isMobile ? (
          // Full-page master-detail surface. A fullBleed Modal (Base UI dialog)
          // brings the focus trap + restore, scroll lock, and Esc dismissal a
          // hand-rolled <div> can't; SettingsView owns its top bar (contextual
          // back / title) and scroll body. onClose closes it from the list.
          <Modal
            open={settingsOpen}
            onClose={() => setSettingsOpen(false)}
            fullBleed
            labelledBy="settings-mobile-title"
          >
            <SettingsView
              mobile
              onClose={() => setSettingsOpen(false)}
              settings={settings} setSetting={setSetting} onSave={saveSettings}
              theme={theme} onThemeChange={setTheme}
              skin={skin} onSkinChange={setSkin}
              customTheme={customTheme} onCustomThemeChange={setCustomTheme}
              agentLabel={agentLabel}
              section={settingsSection}
              onSectionChange={setSettingsSection}
              serverOnline={serverOnline}
              serverBusy={serverBusy}
              serverBusyKind={serverBusyKind}
              onStartServer={handleServerStart}
              onStopServer={handleServerStop}
              isSsoConnected={ssoConnected}
              ssoError={ssoError}
              onSsoSignIn={!ssoConnected && host.isElectron ? async () => { setSettingsOpen(false); await handleSsoSignIn(); } : undefined}
              shellUpdate={shellUpdate}
              onDownloadShellUpdate={handleDownloadShellUpdate}
              shellAutoUpdate={shellAutoUpdate}
              onDownloadShellAutoUpdate={handleShellAutoUpdateDownload}
              onInstallShellAutoUpdate={handleShellAutoUpdateInstall}
              onRetryShellAutoUpdate={handleShellAutoUpdateRetry}
            />
          </Modal>
        ) : (
          <Modal open={settingsOpen} onClose={() => setSettingsOpen(false)} size="lg" height="min(820px, 88vh)" labelledBy="settings-modal-title">
            <ModalHeader
              id="settings-modal-title"
              title="Settings"
              onClose={() => setSettingsOpen(false)}
              right={!ssoConnected && host.isElectron ? (
                <Tooltip content="Sign in with MindsHub to use managed models">
                  <button
                    type="button"
                    onClick={async () => { setSettingsOpen(false); await handleSsoSignIn(); }}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      padding: '5px 11px', borderRadius: 7,
                      border: '1px solid var(--border-subtle)',
                      background: 'transparent',
                      color: 'var(--ink-3)',
                      fontFamily: 'var(--font-body)', fontSize: 12.5,
                      cursor: 'pointer', flexShrink: 0,
                      transition: 'background 120ms ease, color 120ms ease, border-color 120ms ease',
                    }}
                    onMouseOver={(e) => { e.currentTarget.style.background = 'var(--surface-2)'; e.currentTarget.style.color = 'var(--ink)'; }}
                    onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--ink-3)'; }}
                  >Sign in</button>
                </Tooltip>
              ) : undefined}
            />
            <ModalBody padding="0" style={{ overflowY: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <SettingsView
                settings={settings} setSetting={setSetting} onSave={saveSettings}
                theme={theme} onThemeChange={setTheme}
                skin={skin} onSkinChange={setSkin}
                customTheme={customTheme} onCustomThemeChange={setCustomTheme}
                agentLabel={agentLabel}
                section={settingsSection || 'agent'}
                onSectionChange={setSettingsSection}
                serverOnline={serverOnline}
                serverBusy={serverBusy}
                serverBusyKind={serverBusyKind}
                onStartServer={handleServerStart}
                onStopServer={handleServerStop}
                isSsoConnected={ssoConnected}
                ssoError={ssoError}
                onSsoSignIn={!ssoConnected && host.isElectron ? async () => { setSettingsOpen(false); await handleSsoSignIn(); } : undefined}
                shellUpdate={shellUpdate}
                onDownloadShellUpdate={handleDownloadShellUpdate}
                shellAutoUpdate={shellAutoUpdate}
                onDownloadShellAutoUpdate={handleShellAutoUpdateDownload}
                onInstallShellAutoUpdate={handleShellAutoUpdateInstall}
                onRetryShellAutoUpdate={handleShellAutoUpdateRetry}
              />
            </ModalBody>
          </Modal>
        )}

        {/* Legacy 'connect' kind removed — Connect Apps and Data is now
            the canonical surface for connector management (route
            'customize'). UtilitiesView only carries memory / skills /
            publish now. */}
        {route === 'skills' && <SkillsView onCreateWithCowork={handleNavigateHomeWithPrefill} onTryInChat={handleNavigateHomeWithPrefill} />}
        {['memory', 'publish'].includes(route) && (
          <UtilitiesView
            kind={route}
            project={selectedProject}
            onRefreshArtifacts={() => fetchArtifacts().then((data) => { if (Array.isArray(data)) setArtifacts(data); })}
            agentLabel={agentLabel}
          />
        )}
      </AppShell>
      <SearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSearch={searchCowork}
        onSelect={handleSearchSelect}
      />

      <ConnectorPicker
        open={connectorPickerOpen}
        onClose={() => setConnectorPickerOpen(false)}
        onPick={handleConnectorPicked}
      />

      <ThemeModal
        open={themeModalOpen}
        onClose={() => setThemeModalOpen(false)}
        theme={theme}
        onThemeChange={setTheme}
        skin={skin}
        onSkinChange={setSkin}
      />

      <ComingSoonModal
        feature={comingSoonFeature}
        onClose={() => setComingSoonFeature(null)}
      />

      {!host.isWeb && (
      <ServerOfflineHelpModal
        open={serverHelpOpen}
        onClose={() => setServerHelpOpen(false)}
        serverOnline={serverOnline}
        serverBusy={serverBusy}
        serverBusyKind={serverBusyKind}
        agentLabel={agentLabel}
        onStart={handleServerStart}
        onStop={handleServerStop}
      />
      )}

      <ConfirmModal
        open={pendingDeleteTaskId != null}
        title="Delete this task?"
        message="The conversation history and any per-task scratchpad cells will be removed. This can't be undone."
        confirmLabel="Delete"
        cancelLabel="Keep"
        destructive
        onClose={() => setPendingDeleteTaskId(null)}
        onConfirm={async () => {
          const id = pendingDeleteTaskId;
          setPendingDeleteTaskId(null);
          await performDeleteTask(id);
        }}
      />

      <ConfirmModal
        open={pendingDeleteTurn != null}
        title="Delete this exchange?"
        message={`This removes both your question and ${agentLabel}'s response from the conversation. Any scratchpad cells, artifacts, or memory writes produced as part of this turn stay on disk. This can't be undone.`}
        confirmLabel="Delete"
        cancelLabel="Keep"
        destructive
        onClose={() => setPendingDeleteTurn(null)}
        onConfirm={async () => {
          const payload = pendingDeleteTurn;
          setPendingDeleteTurn(null);
          if (payload) await performDeleteTurn(payload.taskId, payload.turnIndex);
        }}
      />

      <ConfirmModal
        open={pendingDeleteProject != null}
        title={`Delete project "${pendingDeleteProject?.name}"?`}
        message="All conversations, scratchpad output, memory, and artifacts under this project will be removed from disk. This can't be undone."
        confirmLabel="Delete project"
        cancelLabel="Keep"
        destructive
        onClose={() => setPendingDeleteProject(null)}
        onConfirm={async () => {
          const p = pendingDeleteProject;
          setPendingDeleteProject(null);
          await performDeleteProject(p);
        }}
      />

      <MoveToProjectModal
        open={!!moveModalTask}
        task={moveModalTask}
        projects={projects}
        onClose={() => setMoveModalTask(null)}
        onConfirm={handleConfirmMove}
      />

      {/* Shown when picking/attaching Google Drive files with no
          google_drive connection yet — see useGoogleDrivePicker. */}
      <ConfirmModal
        open={!!driveConnectPrompt}
        title="Connect Google Drive?"
        message="You need to connect your Google Drive account to add files from Drive."
        confirmLabel="Connect"
        cancelLabel="Cancel"
        onConfirm={confirmDriveConnect}
        onClose={cancelDriveConnect}
      />

      {/* Shown when picking/attaching Google Drive files and more than
          one google_drive connection exists — see useGoogleDrivePicker. */}
      <Modal
        open={!!driveAccountChoice}
        onClose={cancelDriveAccountChoice}
        size="sm"
        labelledBy="gdrive-account-picker-title"
      >
        <ModalHeader
          id="gdrive-account-picker-title"
          title="Choose a Google Drive account"
          subtitle="More than one Google Drive account is connected — pick which one to use."
          onClose={cancelDriveAccountChoice}
        />
        <ModalBody>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {(driveAccountChoice?.connections || []).map((c) => (
              <button
                key={c.name}
                type="button"
                onClick={() => resolveDriveAccountChoice(c)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 12px', borderRadius: 8,
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--surface)',
                  color: 'var(--ink)',
                  fontFamily: 'var(--font-body)', fontSize: 13.5,
                  cursor: 'pointer', textAlign: 'left',
                  transition: 'background 120ms ease',
                }}
                onMouseOver={(e) => { e.currentTarget.style.background = 'var(--surface-2)'; }}
                onMouseOut={(e) => { e.currentTarget.style.background = 'var(--surface)'; }}
              >
                <span style={{ color: 'var(--ink-3)', display: 'inline-flex', flexShrink: 0 }}>{Ico.googleDrive(16)}</span>
                <span>{c.display_name || c.name}</span>
              </button>
            ))}
          </div>
        </ModalBody>
      </Modal>

      {/* OTA update overlay — shown during auto-update download/reload */}
      {(updateStatus?.phase === 'downloading' || updateStatus?.phase === 'reloading') && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexDirection: 'column', gap: 16,
          background: 'rgba(10, 10, 15, 0.85)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
        }}>
          <div style={{
            width: 40, height: 40,
            border: '3px solid rgba(93,146,135,0.3)',
            borderTopColor: 'var(--sage-500, #5D9287)',
            borderRadius: '50%',
            animation: 'spin 800ms linear infinite',
          }} />
          <div style={{
            fontSize: 14, fontWeight: 500,
            color: 'var(--text-strong, #e0e0e0)',
            fontFamily: 'var(--font-sans)',
          }}>
            {updateStatus.phase === 'downloading'
              ? `Updating${updateStatus.version ? ` to ${updateStatus.version}` : ''}...`
              : 'Almost there...'}
          </div>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}
    </div>
  );

  // Hand the shell + nav state + URL→state handlers to the router; CoworkLayout
  // renders `shell` and the route elements consume the handlers.
  const coworkValue = {
    shell,
    route,
    activeTaskId,
    // Bridge mirrors the selected detail entity into the URL. Prefer the stable
    // id; fall back to name for projects that predate ids.
    selectedProjectId: selectedProject?.id || selectedProject?.name || null,
    selectedScheduleId,
    enterHome,
    enterRoute,
    openConversation,
    enterProjectDetail,
    enterScheduleDetail,
  };

  return (
    <HubUsageContext.Provider value={hubUsageCtx}>
      <CoworkProvider value={coworkValue}>
        <CoworkRouterProvider router={routerRef.current} />
      </CoworkProvider>
    </HubUsageContext.Provider>
  );
}
