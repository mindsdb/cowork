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
import CodeView from './code/CodeView';
import { useCodeModeAccess } from './code/codeModeAccess';
import { DEFAULT_CODING_AGENT_ENGINE, DEFAULT_CODING_AGENT_MODEL } from './code/defaults';
import { useCodeWorkspace } from './code/useCodeWorkspace';
import { useCodeModeLifecycle } from './code/useCodeModeLifecycle';
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
import { canUseSharedResource } from './lib/sharedResourceAccess';
import { selectNextQueuedTask, mergeQueuesForAdoptedId, reservationReleaseDecision, finishedCids } from './lib/messageQueue';
import { loadCachedSettings } from './lib/settingsCache';
import { useOrgMode } from '../lib/orgMode';
import { clearDraft, moveDraft } from './lib/draftStore';
import { useBreakpoint } from './hooks/useBreakpoint';
import { useGoogleDrivePicker } from './hooks/useGoogleDrivePicker';
import { useAccountUser } from './hooks/useAccountUser';
import { skillScopeKey } from './lib/accountUser';
import { useViewportZoomLock } from './hooks/useViewportZoomLock';
import { useBootDecisions } from './hooks/useBootDecisions';
import { useServerControl } from './hooks/useServerControl';
import { useSidebarNav } from './hooks/useSidebarNav';
import { useSso } from './hooks/useSso';
import { useThemeSkin } from './hooks/useThemeSkin';
import { useAppUpdates } from './hooks/useAppUpdates';
import { deriveUpdateBanner } from '../../shared/update-banner';
import { useSchedules } from './hooks/useSchedules';
import { fetchSessions, fetchSession, fetchSessionResult, fetchConversationList, fetchProjects, fetchArtifacts, fetchSettings, fetchHealth,
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
import { resolveRepairConversation } from './lib/artifactRepairChat';
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

// Log UI versions immediately and fetch server versions even before AppCore mounts, for QA
// diagnostics.
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

// Append form context for the agent; describe secret fields as filled/redacted without including
// their values.
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

// Drive chips reference persisted connector grants, not uploaded bytes; never resolve or send them
// as attachment IDs.
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
 * Derive the pending question from live steps so answer events clear it.
 * Only allow_custom: false forbids typed answers; absence matches the adapter’s permissive default.
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
 * Return queued text to the composer when a question appears: auto-answering would change its
 * meaning,
 * and leaving it queued would deadlock behind the blocked turn.
 */
export function drainQueueToInput(queued) {
  return (queued || []).map((m) => m.text).filter(Boolean).join('\n');
}

/**
 * Return files with drained text before deleting the queue. Deduplicate IDs because requeued
 * messages can share attachments.
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
 * Retire only the named question: clearing other pending questions would disable interception until
 * another
 * stream event, leaving new sends stuck behind a blocked turn. Without an ID, clear all.
 */
export function retireQuestionFromSteps(steps, questionId) {
  if (!questionId) return [];
  return (steps || []).filter(
    (s) => !(s.badge === 'AskUser' && s.data?.question_id === questionId),
  );
}

/**
 * Look up queued messages under the current and prior stream IDs; redirect them to taskIds[0], the
 * current ID.
 * Returns null or { taskId, queueTaskId, questionId, text, attachments }. The caller must mark
 * questionId
 * drained synchronously before setState to prevent duplicate drains.
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
 * Interpret submitAnswer statuses: send resumes a normal send, consumed ends it, and fail/blocked
 * preserve
 * composer text while surfacing message. release requires retiring only questionId from the live
 * mirror.
 */
export async function resolvePendingAnswer({ steps, conversationId, text, submit }) {
  const pending = pendingQuestionFor(steps);
  if (!pending) return { action: 'send' };
  const payload = { text };
  // Select-only questions reject typed answers; ordinary sends would queue behind the same blocked
  // turn.
  // Explain the available actions before making a request.
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
  // Success has no status. Unknown statuses release the question and resume send so user text is
  // not silently lost.
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

// Drive references carry no upload ID; name them in agent context so “this file” can resolve to the
// picked file.
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

// Open forms from live onDone callbacks. By MarkdownCode mount, completed content looks historical
// and its
// replay guard suppresses dispatch to prevent dismissed forms reopening on navigation.
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

// Poll near the next due run, allowing a completion buffer. Bound delays to catch cross-client
// changes
// and clock drift without busy-looping on overdue schedules.
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

// Advance on both new detail requests and navigation away so stale responses cannot select a
// project.
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
  // Seed from cached server settings to avoid a separate set of defaults drifting from server
  // resolution.
  const [settings, setSettings] = useState(loadCachedSettings);

  const agentLabel = getAgentLabel(settings);

  const [tasks, setTasks] = useState([]);
  // Distinguish loading and failed lists from an empty account so returning users do not appear to
  // have lost work.
  const [tasksStatus, setTasksStatus] = useState('loading');
  const tasksRef = useRef(tasks);
  // Warm transcripts once per session; health transitions and manual refreshes would otherwise
  // repeat discarded requests.
  const warmedRef = useRef(false);
  useEffect(() => { tasksRef.current = tasks; }, [tasks]);
  // IDs of tasks deleted this session. Used to filter them out of
  // subsequent fetchSessions responses so zombies can't reappear.
  const deletedTaskIdsRef = useRef(new Set());
  const [projects, setProjects] = useState([]);
  const [moveModalTask, setMoveModalTask] = useState(null);  // task pending a move-to-project
  const [artifacts, setArtifacts] = useState([]);
  // Arm only when the first artifact fetch is empty, then fire on the first artifact.
  // null means undecided, true armed, and false existing account/already fired.
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
  /*
   * Show pending deletion on project cards: cascades can be slow, and the confirmation closes to
   * allow navigation.
   */
  const [deletingProjectKeys, setDeletingProjectKeys] = useState([]);

  // Live stream control — refs to the active fetch's AbortController
  // and the latest scratchpad name so we can fire a Stop that aborts
  // both the SSE read and the in-flight scratchpad cell.
  const activeStreamCtrlRef = useRef(null);
  const activeScratchpadRef = useRef(null);
  // Identify the local stream so reconciliation preserves its running indicators and clears
  // abandoned ones.
  const activeStreamingTaskIdRef = useRef(null);
  // Latest toast manager, reachable from callbacks (like handleStopStream)
  // defined above where useToastManager() is called. Synced in an effect below.
  const toastManagerRef = useRef(null);
  // SSE events prove a turn started before it appears in polling; prevent premature reservation
  // cleanup. Reset per stream.
  const activeStreamProducedRef = useRef(false);
  const activeStreamGenerationRef = useRef(0);
  const composerMuteLastTaskIdRef = useRef(null);
  const prevRouteForComposerMuteRef = useRef(null);

  // Queue per task because Anton cannot run concurrent turns safely; drain one after
  // onDone/onError.
  const [messageQueue, setMessageQueue] = useState({}); // { [taskId]: [{id, text, attachments}] }
  const messageQueueRef = useRef({});
  useEffect(() => { messageQueueRef.current = messageQueue; }, [messageQueue]);
  // Reconnect callbacks are stable; read the latest drain through a ref to avoid stale
  // send/project/health state.
  const drainNextQueuedMessageRef = useRef(null);

  // Running tally for the stranded-reservation self-heal (reservationReleaseDecision):
  // a stream that dies with no terminal pins the slot forever, so the in-flight
  // poll releases it once the server lists then stops listing the task.
  const staleReservationRef = useRef({ cid: null, misses: 0, seen: false, lastMissAt: 0 });

  // Serializes refreshInFlightSet so overlapping interval/focus polls can't
  // double-count a miss (see the wrapper below).
  const refreshInFlightInProgressRef = useRef(false);

  // Keep heartbeat polling after a reservation miss empties inFlightSet; release needs follow-up
  // polls.
  const [hasPendingReservationMiss, setHasPendingReservationMiss] = useState(false);

  // Live steps per task, so handleSendInTask can see a pending question
  // without threading stream state through the composer.
  const liveStepsRef = useRef({});

  // Mark drained question IDs synchronously: setState cannot prevent a second event from draining
  // the same queue.
  const drainedQuestionsRef = useRef(new Set());

  // Store consumable redirects per task so background drains retain their text until that task’s
  // ChatView
  // consumes it, without overwriting another task or reapplying on remount.
  const [composerRedirects, setComposerRedirects] = useState({}); // { [taskId]: {text, bump} }
  const composerRedirectBumpRef = useRef(0);

  // Track server producers across clients so reconciliation does not mark remote turns interrupted.
  // Refresh at boot/focus, poll while active, and update immediately on local stream changes.
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

    // Release abandoned stream reservations from the authoritative server list; otherwise later
    // queued messages remain blocked.
    const streaming = activeStreamingTaskIdRef.current;
    // A reserved slot without a controller is still uploading; releasing it could start a second
    // concurrent turn.
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
      // Clear live questions and temporary-ID aliases so later sends cannot answer a dead turn.
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

  // Prevent drops outside registered zones from navigating Electron to the file; zone onDrop
  // handlers still run.
  useEffect(() => {
    const prevent = (e) => { e.preventDefault(); };
    window.addEventListener('dragover', prevent, false);
    window.addEventListener('drop', prevent, false);
    return () => {
      window.removeEventListener('dragover', prevent, false);
      window.removeEventListener('drop', prevent, false);
    };
  }, []);

  // Poll while work is active to notice other clients finishing without a focus event.
  useEffect(() => {
    // Also runs on an unresolved reservation miss even when the set is empty:
    // releasing the slot needs a follow-up poll, and the miss is what empties
    // the set.
    if (inFlightSet.size === 0 && !hasPendingReservationMiss) return undefined;
    const timer = setInterval(() => { refreshInFlightSet(); }, 5000);
    return () => clearInterval(timer);
  }, [inFlightSet.size, hasPendingReservationMiss, refreshInFlightSet]);

  const enqueueMessage = (taskId, text, attachments = [], disabledConnections = []) => {
    // Capture attachments and disabled connections at enqueue time; draining must preserve that
    // send’s files
    // and choices even if another task is now open.
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
  // Move queues to the adopted server ID so the drain can still find their task.
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

  // Update live questions after reduction and return existing queues to their composers when a
  // question appears.
  const updateLiveStepsAndDrainQueue = (taskIds, steps) => {
    // Every stream's onEvent funnels through here (after dropping stale-generation
    // events), so reaching this line means the active stream delivered data.
    // Record it for the stranded-slot self-heal (see activeStreamProducedRef).
    activeStreamProducedRef.current = true;
    // Register newly streamed artifacts as live even if an older index disagrees. Replay does not
    // call this collector.
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
    // Keep each restored batch’s text and files together under its task ID until that task consumes
    // it.
    // The app-wide attachment list could otherwise send a background task’s files to the visible
    // conversation.
    setComposerRedirects((prev) => ({
      ...prev,
      [plan.taskId]: {
        text: plan.text,
        attachments: plan.attachments,
        bump: composerRedirectBumpRef.current,
      },
    }));
  };

  // Every terminal path, including early cancelled returns, must release questions so the composer
  // stops redirecting.
  const releaseLiveSteps = useCallback((ids) => {
    (ids || []).forEach((tid) => { if (tid) delete liveStepsRef.current[tid]; });
  }, []);

  // Temporary and canonical IDs share the same steps array. Remove all entries with that identity
  // so Stop, which knows only the adopted ID, also releases the temporary alias.
  const releaseLiveStepsWithAliases = useCallback((taskId) => {
    if (!taskId) return;
    const dying = liveStepsRef.current[taskId];
    delete liveStepsRef.current[taskId];
    if (!dying) return;
    Object.keys(liveStepsRef.current).forEach((key) => {
      if (liveStepsRef.current[key] === dying) delete liveStepsRef.current[key];
    });
  }, []);

  // Retire one question across every alias sharing its steps array, preserving other pending
  // questions.
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

    // Cancel server-side before local teardown. On failure, retain Stop and stream state so the
    // user can retry.
    // Silent idle-timeout cleanup still tears down regardless of cancellation outcome.
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
      // Release the stopped turn’s question so the next send is not redirected to a dead run.
      releaseLiveStepsWithAliases(cidToCancel);
      setMessageQueue((prev) => {
        const next = { ...prev };
        delete next[cidToCancel];
        return next;
      });
      // Prune the ref synchronously before draining siblings; the state-to-ref effect has not run
      // yet.
      const prunedQueue = { ...messageQueueRef.current };
      delete prunedQueue[cidToCancel];
      messageQueueRef.current = prunedQueue;
    }

    activeScratchpadRef.current = null;
    activeStreamingTaskIdRef.current = null;

    // Stop suppresses terminal callbacks, so explicitly drain sibling queues after releasing the
    // shared slot.
    // Read through the ref to use the current drain.
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
    // Reload may show a successful server turn after transport failure; count failures using the
    // visible result.
    const hasError = loaded
      ? loaded.messages.some((m) => m.role === 'error' || m.role === 'provider_required')
      : true;
    // A response.failed event is authoritative. For transport failures, inspect only the last turn;
    // older failures in the history must not make a recovered turn count as failed.
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
            // Preserve retry/reset metadata when reload fails so the fallback cards retain their
            // deadlines.
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

  // Build composer options from server recommendations and labels; before settings load, show only
  // the configured model.
  const mindsModels = useMemo(() => (
    recommendedModelOptions(settings.recommendedModels, 'minds-cloud', settings.modelLabels)
      .map((o) => ({ id: o.id, name: o.label }))
  ), [settings.recommendedModels, settings.modelLabels]);
  const models = useMemo(() => {
    const providerType = providerValueToType(settings.planningProvider) || 'minds-cloud';
    if (providerType === 'minds-cloud') return mindsModels;
    return recommendedModelOptions(settings.recommendedModels, providerType, settings.modelLabels)
      .map((o) => ({ id: o.id, name: o.label }));
  }, [mindsModels, settings.recommendedModels, settings.planningProvider, settings.modelLabels]);
  // Refresh availability when the menu opens so external wallet top-ups unlock models without
  // restart.
  // Failed or empty refreshes retain the current map; absent model IDs count as available.
  const refreshModelAvailability = useCallback(async () => {
    const data = await fetchRecommendedModels({ refresh: true });
    // keepOrder: the menu is already open on the list we hold when this lands.
    const merged = mergeRecommendedModels(settings, data, { keepOrder: true });
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
    // EffortSelect needs the account harness outside coding mode; Composer’s local harness does not
    // reflect it.
    harness: settings.harness,
    onRefresh: refreshModelAvailability,
  }), [settings.modelProviders, settings.modelFamilies, settings.modelEnabled, settings.modelEfforts, settings.harness, refreshModelAvailability]);
  const { isMobile, isNarrow } = useBreakpoint();

  // iOS/Android auto-zoom workaround: toggle the viewport meta tag around
  // text-input focus so mobile browsers don't leave the app magnified.
  useViewportZoomLock(isMobile);

  // Code availability (release policy) and the user's opt-in (device-local)
  // are deliberately independent. A development fixture may override the UI
  // gate, but production web never can: it has no desktop capability bridge.
  const codeModeAccess = useCodeModeAccess();
  const codeFixtureActive = import.meta.env.DEV
    && new URLSearchParams(window.location.search).has('codeFixture');
  const codeModeEnabled = codeFixtureActive || codeModeAccess.enabled;
  // Nav-shell layout state (collapsed rail, off-canvas popout, collapsible
  // routes, and the derived popout flag) lives in useSidebarNav.
  const {
    sidebarCollapsed, setSidebarCollapsed,
    navPopoutOpen, setNavPopoutOpen,
    sidebarCollapsibleRoutes,
    sidebarPopout,
  } = useSidebarNav({ isNarrow });
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
  // Global keyboard shortcuts. Cmd/Ctrl+B toggles the sidebar in a Cowork
  // task or anywhere in Code; Cmd/Ctrl+K opens search; Cmd/Ctrl+N starts a
  // new task.
  useEffect(() => {
    const onKey = (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.altKey || e.shiftKey) return;
      const key = e.key.toLowerCase();
      if (key === 'b') {
        // Cowork mirrors Main's task-only affordance; Code treats the whole
        // workspace as one collapsible navigation scope.
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

  // Blur mouse-clicked buttons so later Space/Enter cannot retrigger them; keyboard navigation
  // keeps focus.
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

  // The body class hides the dot canvas and lets its animation loop idle while the pattern is off.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const visible = settings.showDots !== false;
    document.body.classList.toggle('gf-dots-off', !visible);
    window.gravityField?.setActive?.(visible);
  }, [settings.showDots]);

  // Keep Cowork and Code mounted across workspace switches to preserve drafts, scroll, selections,
  // and streams.
  const [workspaceMode, setWorkspaceMode] = useState(() => (
    codeFixtureActive
      ? 'code'
      : 'cowork'
  ));
  // Rendering and keyboard routing use the effective mode, so turning the
  // preference off cannot leave a single-frame Code remnant while React runs
  // the transition effect below.
  const effectiveWorkspaceMode = codeModeEnabled && workspaceMode === 'code'
    ? 'code'
    : 'cowork';
  // Do not boot the coding workspace, its data requests, and its hidden
  // composer during an ordinary Cowork session. Mount it on first use, then
  // keep it alive so later Cowork/Code switches preserve in-progress state.
  const [codeWorkspaceMounted, setCodeWorkspaceMounted] = useState(() => codeFixtureActive);
  const changeWorkspace = useCallback((next) => {
    if (next !== 'cowork' && next !== 'code') return;
    if (next === 'code' && !codeModeEnabled) return;
    if (sidebarPopout) setNavPopoutOpen(false);
    if (next === 'code') setCodeWorkspaceMounted(true);
    setWorkspaceMode(next);
  }, [codeModeEnabled, sidebarPopout]);
  const openCode = useCallback(() => changeWorkspace('code'), [changeWorkspace]);
  // Code owns a separate task history, but its route-specific navigation is
  // rendered by the canonical Cowork sidebar instead of a second nested rail.
  const {
    sessions: codingSessions,
    selectedId: activeCodingSessionId,
    newTask: codeNewTask,
    projectsOpen: codeProjectsOpen,
    connectorsOpen: codeConnectorsOpen,
    skillsOpen: codeSkillsOpen,
    setSessions: setCodingSessions,
    openNewTask: openNewCodingTask,
    openProjects: openCodingProjects,
    openConnectors: openCodingConnectors,
    openSkills: openCodingSkills,
    selectSession: selectCodingSession,
    changeSelection: changeCodingSelection,
    setSessionPinned: setCodingSessionPinned,
  } = useCodeWorkspace(openCode);
  const disableCodeWorkspace = useCallback(() => {
    setWorkspaceMode('cowork');
    setCodeWorkspaceMounted(false);
  }, []);
  const reportCodeStopIssue = useCallback(({ discoveryFailed, cancelFailures }) => {
    const title = discoveryFailed
      ? 'Code Mode is hidden, but running tasks could not be fully checked.'
      : cancelFailures === 1
        ? 'Code Mode is hidden, but one task could not be stopped.'
        : `Code Mode is hidden, but ${cancelFailures} tasks could not be stopped.`;
    toastManagerRef.current?.add({
      type: 'warning',
      title,
    });
  }, []);
  useCodeModeLifecycle({
    enabled: codeModeEnabled,
    fixtureActive: codeFixtureActive,
    sessions: codingSessions,
    onDisable: disableCodeWorkspace,
    onSessionsChange: setCodingSessions,
    onStopIssue: reportCodeStopIssue,
  });
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
  routeRef.current = effectiveWorkspaceMode === 'code' ? 'code' : route;
  // Route-aware gravity-field intensity: dense work surfaces quiet the
  // light-mode field (gf-quiet + gravity-field.css) so it never competes
  // with content; the home stage keeps the full ambient motion.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const denseWorkspace = effectiveWorkspaceMode === 'code' || route !== 'home';
    document.body.classList.toggle('gf-quiet', denseWorkspace);
    // The field is decorative, so dense work surfaces update it at a much
    // lower frequency. Its slow drift remains visible without competing with
    // typing, streaming output, or approval interactions on busy machines.
    window.gravityField?.setFrameRate?.(denseWorkspace ? 1 : 4);
    return () => document.body.classList.remove('gf-quiet');
  }, [effectiveWorkspaceMode, route]);
  // Code shares a collapsible navigation pane across its surfaces; Cowork collapses only on focused
  // task routes.
  // Narrow layouts use the overlay drawer.
  const activeSidebarRoute = effectiveWorkspaceMode === 'code' ? 'code' : route;
  const sidebarCanCollapse = !sidebarPopout && sidebarCollapsibleRoutes.has(activeSidebarRoute);
  const sidebarCollapsedEffective = sidebarCanCollapse && sidebarCollapsed;
  const [activeTaskId, setActiveTaskId] = useState(initialNav.activeTaskId);
  // Long-running destructive requests must reconcile against wherever the
  // user navigated while they were in flight, not the render that launched
  // them. Keep the active task alongside routeRef for that success boundary.
  const activeTaskIdRef = useRef(activeTaskId);
  activeTaskIdRef.current = activeTaskId;
  // Set when the `/c/:id` loader hit an operational failure (not a 404): the
  // view offers a retry instead of losing the URL.
  const [conversationError, setConversationError] = useState(null);
  // Seed from a `/scheduled/:id` deep-link so refresh restores the detail view.
  // (selectedProject is resolved from its id by the project route, so null here.)
  const [selectedScheduleId, setSelectedScheduleId] = useState(initialNav.selectedScheduleId ?? null);
  const [selectedProject, setSelectedProject] = useState(null);
  // While resolving a detail URL, show the loading grid instead of the previous project. Seed this
  // on refresh too.
  const [projectDetailPending, setProjectDetailPending] = useState(
    initialNav.route === 'projects' ? (initialNav.selectedProjectId ?? null) : null
  );
  // Monotonic request token so a slow `/projects/:A` response can't overwrite a
  // later `/projects/:B` resolution, nor re-select A after the user leaves detail
  // (Back to the grid / Home / any route). See makeProjectDetailToken.
  const projectDetailTokenRef = useRef(null);
  if (projectDetailTokenRef.current === null) projectDetailTokenRef.current = makeProjectDetailToken();
  // The router sentinel follows server-side account settings until the user picks a concrete model;
  // do not resync that pick.
  const [selectedModel, setSelectedModel] = useState(MODEL_ROUTER);
  // Empty effort defers to the model/account default. Do not resync explicit picks from settings.
  const [selectedEffort, setSelectedEffort] = useState('');
  // Use a ref for manual-start refresh because refreshData also writes serverOnline.
  const refreshDataRef = useRef(null);
  const {
    serverOnline, setServerOnline,
    serverBusy, setServerBusy,
    serverBusyKind, setServerBusyKind,
    handleServerStart, handleServerStop,
  } = useServerControl({ refreshDataRef });

  // Leave config_ready undefined until fetched. false means confirmed unconfigured and would
  // redirect web boot to Settings prematurely.
  const [health, setHealth] = useState({ status: 'offline', anton_available: false });

  // Track installation once desktop health is ready; analytics deduplicates per install and merges
  // the anonymous ID on login.
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
    // A retry after a failure must look like it did something; without this
    // the error copy sits there until the request resolves.
    setTasksStatus((prev) => (prev === 'failed' ? 'loading' : prev));
    // Merges a warmed transcript in without disturbing a live conversation:
    // anything mid-stream, or already filled, keeps what it has.
    const warmTranscript = (id, msgs) => setTasks((prev) => prev.map((t) => {
      if (t.id !== id) return t;
      const local = Array.isArray(t.messages) ? t.messages : [];
      if (local.length > 0) return t;   // covers _streaming too: the placeholder is an element
      return { ...t, messages: msgs };
    }));
    // Claim synchronously: fetchHealth can flip serverOnline and reenter refreshData before the
    // session list resolves.
    const warming = !warmedRef.current;
    if (warming) warmedRef.current = true;
    fetchSessions(warming ? { onItems: warmTranscript } : {}).then((data) => {
      // Release when no transcripts were warmed so an empty/failed list does not prevent a later
      // retry.
      if (warming && !(Array.isArray(data) && data.length > 0)) warmedRef.current = false;
      if (!Array.isArray(data)) {
        // Keep existing rows on failure, but expose Retry when none are visible, including for
        // previously empty accounts.
        setTasksStatus(tasksRef.current.length > 0 ? 'ready' : 'failed');
        return;
      }
      setTasksStatus('ready');
      // Decide onboarding freshness once after a successful list: existing accounts must not retain
      // an untouched checklist.
      if (!onboardingFreshnessResolvedRef.current) {
        onboardingFreshnessResolvedRef.current = true;
        if (data.length > 0) dismissIfUntouched();
      }
      setTasks((prev) => mergeTasksFromServer(data, prev).filter((t) => !deletedTaskIdsRef.current.has(t.id)));
    });
    fetchProjects().then((data) => { if (Array.isArray(data)) setProjects(data); });
    fetchArtifacts().then((data) => {
      if (!Array.isArray(data)) return;
      // Decide freshness once: arm for an empty account, permanently dismiss for an account with
      // artifacts.
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
  }, [refreshSchedules]);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  // Expose the latest refreshData to useServerControl (it re-fetches after a
  // manual start) without a definition-order cycle — refreshData writes the
  // hook's serverOnline, so the hook can't take it as a direct argument.
  useEffect(() => { refreshDataRef.current = refreshData; }, [refreshData]);

  // Project renames also rewrite conversation project names, so refresh sessions alongside the
  // project list.
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

  // Refresh when the server comes online so an empty cold-boot response cannot leave stale
  // configuration UI.
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

  // Offer Air recovery only while it is in the catalog and payable; absent availability entries
  // count as available.
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

  // Probe and reattach when reopening a conversation with a server-side producer; no producer means
  // no SSE request.
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
      fromSeq: 0, // Replay from sequence zero to rebuild the turn through the reducer.
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
        // Reconnect holds the shared stream slot too; drain waiting tasks through the current ref
        // when it finishes.
        drainNextQueuedMessageRef.current?.(taskId);
      },
      onError(message, event) {
        // Reject stale generations before clearing questions from a newer run. Release before the
        // cancelled return too.
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

  // Update navigation only; the route loader and openConversation handle hydration/reconnection for
  // clicks and deep links alike.
  const selectTask = (id) => {
    if (sidebarPopout) setNavPopoutOpen(false);
    setWorkspaceMode('cowork');
    // Clear the composer here (the sync nav intent), not in openConversation:
    // that runs after the async loader and would wipe a queued-message redirect
    // ChatView stages for the conversation. Matches staging's ordering.
    setComposerAttachments([]);
    setActiveTaskId(id);
    setRoute('task');
  };

  // Loader results are { task }, { optimistic: true } for local new-chat messages, or {
  // unavailable: true } for transient failures.
  const openConversation = useCallback((id, loaded) => {
    setActiveTaskId(id);
    setRoute('task');
    // Keep locally available conversations visible during loader failures; clear composer text only
    // in synchronous selectTask.
    if (loaded?.unavailable) setConversationError(id);
    else setConversationError((cur) => (cur === id ? null : cur));
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

    // Record recency before the empty-transcript return so every successful open counts, without
    // auto-pinning.
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

    // Prefer server event replay over the legacy local sidecar; insert conversations omitted from
    // capped recents.
    const reconciled = applySessionMessages(id, Array.isArray(fresh.messages) ? fresh.messages : [], { isLive, isServerInFlight });
    const dc = Array.isArray(fresh.disabledConnections) ? fresh.disabledConnections : undefined;
    const patch = (t) => ({ ...t, messages: reconciled, ...(dc !== undefined ? { disabledConnections: dc } : {}) });
    setTasks((prev) => (prev.some((t) => t.id === id)
      ? prev.map((t) => (t.id === id ? patch(t) : t))
      : [patch(fresh), ...prev]));
  }, [reconnectInFlight]);

  const newTask = () => {
    if (sidebarPopout) setNavPopoutOpen(false);
    setWorkspaceMode('cowork');
    setActiveTaskId(null);
    setComposerAttachments([]);
    setComposerPrefill(null);
    setRoute('home');
  };

  const handleNavigateHomeWithPrefill = (text, projectName) => {
    setWorkspaceMode('cowork');
    setActiveTaskId(null);
    setComposerAttachments([]);
    setComposerPrefill({ text, bump: Date.now() });
    const targetName = projectName || 'general';
    const proj = projects.find((p) => p.name === targetName);
    if (proj) setSelectedProject(proj);
    setRoute('home');
  };

  const handleStartConnectChat = () => {
    setConnectorPickerOpen(true);
  };
  // Prefill saved fields, using ANTON_VAULT_KEEP for secrets. Unchanged sentinels preserve stored
  // values on submit.
  const handleModifyConnection = async (connection) => {
    if (!connection?.engine) return;
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

      // Build synthetic fields only from saved keys and secret flags; borrowing spec attributes
      // would introduce unsaved fields.
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
        // Add a separate edit-current method while preserving the original options. If the saved
        // method no longer
        // exists in the spec, null _underlying_method routes submission through the agent’s custom
        // save path.
        const synthMethod = {
          id: '__edit_current__',
          label: 'Currently saved values',
          description: 'Edit the values stored for this connection.',
          fields: syntheticFields,
          // Do not inherit OAuth/actions: users can choose the original method to rerun those
          // flows.
          // Submit the real _underlying_method ID when present; the synthetic ID is local and fails
          // server validation.
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
  // Unsaved modify tasks are local temporary tasks; cancelling needs no server DELETE.
  const handleCancelModify = (taskId) => {
    if (taskId) {
      deletedTaskIdsRef.current.add(taskId);
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      if (activeTaskId === taskId) setActiveTaskId(null);
    }
    setRoute('customize');
  };
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
  // Remember the origin per connect task so dismissing an unfinished form restores its caller.
  // A single shared slot would lose the origin when connect flows overlap.
  const connectOriginsRef = useRef(new Map());

  // Dismiss unfinished temporary connect tasks back to their origin; successful connections keep
  // their conversation.
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
      // Inject known forms directly; _connector_id routes submission through connector-aware
      // saving, including OAuth.
      const connectSpec = {
        ...full.form,
        // Use the top-level connector ID when the form omits engine so server prompts and vault
        // saves receive the canonical slug.
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

  // Cmd/Ctrl+N follows the workspace on screen while preserving the latest
  // Cowork new-task closure (which captures fresh setRoute/setTasks).
  useEffect(() => {
    newTaskRef.current = effectiveWorkspaceMode === 'code' ? openNewCodingTask : newTask;
  }, [effectiveWorkspaceMode, newTask, openNewCodingTask]);

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
  const codeAccountUser = useAccountUser(ssoConnected);
  const codeSkillScopeKey = skillScopeKey(codeAccountUser);

  // A bare settings open preserves the desktop section but returns mobile to its section list.
  const openSettings = (section = null) => {
    if (section) setSettingsSection(section);
    else if (isMobile) setSettingsSection(null);
    setSettingsOpen(true);
  };

  const navigate = (key) => {
    if (sidebarPopout) setNavPopoutOpen(false);
    // Compatibility for any stale internal entry point while the dedicated
    // workspace switch replaces Code as an ordinary navigation row.
    if (key === 'code') {
      openCode();
      return;
    }
    if (key === 'settings' || key.startsWith('settings:')) {
      // Targeted (settings:backend) opens that section; a bare `settings`
      // opens the mobile section list (null) / desktop's last section.
      openSettings(key.includes(':') ? key.split(':')[1] : null);
      return;
    }
    if (key === 'projects') {
      // Clear selection on sidebar navigation only; the chat-header project link sets selection
      // after routing.
      setSelectedProject(null);
    }
    setWorkspaceMode('cowork');
    // Flip route state; the URL bridge mirrors it and the route element's
    // enterRoute() (re)fetches that view's data.
    setRoute(key);
  };


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

  // Resolve detail IDs from the fetched list. Return false for missing IDs so the route replaces
  // dead URLs with /projects.
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

  // Refresh provider readiness before sending: cached health may belong to the prior user or
  // predate sign-in.
  // Show configuration recovery before operations begin; fall back to cached health only when the
  // read fails.
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

  // Coding tasks create a conversation then run a PTY in the project folder instead of /responses.
  // Throw failures through the composer’s existing inline error handling.
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

  // Find or create the general project; return null on failure so callers can show an error before
  // sending.
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
      const requestedProject = meta?.project || selectedProject;
      const effectiveProjectName = requestedProject?.name || 'general';
      const effectiveProjectId = (requestedProject ? requestedProject.id : generalFallback?.id) || null;
      const effectiveProjectPath = requestedProject?.path
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
      return false;
    }

    // Bootstrap general if no project is selected and an older install has not provisioned it.
    let generalProject = projects.find((p) => p.name === 'general');
    const requestedProject = meta?.project || selectedProject;
    if (!requestedProject && !generalProject) {
      generalProject = await ensureGeneralProject();
    }
    const effectiveProjectName = requestedProject?.name || 'general';
    const effectiveProjectId = (requestedProject ? requestedProject.id : generalProject?.id) || null;
    const effectiveProjectPath = requestedProject?.path || generalProject?.path || null;

    const disabledForSend = normalizeComposerDisabledConnections(composerDisabledConnections);

    const rawComposer = composerAttachments;
    const hasPendingFiles = rawComposer.some(isPendingFileAttachment);
    const suppliedConversationId = meta?.conversationId || null;
    const taskId = suppliedConversationId
      || (hasPendingFiles ? allocateConversationId() : `tmp-${Date.now()}`);
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

    // Mount an empty task first, then add the message/placeholder on the next animation frame.
    // Adding both with the route change makes the thinking indicator flash before the stream
    // replaces it.
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
      // Seed updatedAt so new tasks sort first before the server supplies metadata.
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

    // Add the message and start streaming after the empty ChatView has mounted and painted.
    const startConversation = () => {
      setTasks((prev) => prev.map((t) =>
        t.id === taskId
          ? {
              ...t,
              messages: withThinkingPlaceholder(
                [{ role: 'user', content: text, attachments: sendingAttachments }],
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
      conversationId: suppliedConversationId || (hasPendingFiles ? taskId : undefined),
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
        // Anton may return auth failures as assistant text in a 200 stream; map them to the
        // provider-required card.
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
          // Count before inserting the new assistant message so the persisted index matches reload
          // order.
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
        // Persist step metadata locally for reloads where Anton history omits it.
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

    // Two animation frames allow the empty task view to paint before adding messages and starting
    // SSE.
    requestAnimationFrame(() => requestAnimationFrame(startConversation));
    return true;
  };

  // Return true if sent or queued, false if nothing was sent. Artifact repair callers cancel their
  // preallocated
  // repair record on false so it cannot remain queued for a turn that never started.
  const handleSendInTask = async (text, queuedAttachments = null, opts = {}) => {
    // opts.targetTask lets the queue drain re-send to a specific task the
    // user may not currently be viewing (ENG-1378); a fresh composer send
    // defaults to the task on screen.
    const targetTask = opts.targetTask || currentTask;
    if (!targetTask) return false;
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
      return false;
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
      // Answers send text only. Preserve attachments for the next message, restore drained files to
      // the composer,
      // and tell the user that those files were not sent.
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
      // The text became the answer to the agent's question, so it did not start
      // a turn of its own — a caller waiting on this prompt gets `false`.
      return false;
    }
    if (answerOutcome.action === 'fail' || answerOutcome.action === 'blocked') {
      // Toast the failure and throw so Composer preserves text. Keep interception armed for retry;
      // blocked select-only answers also preserve text and send nothing.
      toastManager.add({ type: 'danger', title: answerOutcome.message });
      throw new Error(answerOutcome.message);
    }
    if (answerOutcome.release) {
      // Resume normal sending after retiring only the gone question, across all aliases. Other
      // pending questions must retain interception.
      retireLiveQuestion(id, answerOutcome.questionId);
    }

    // Serialize sends across all tasks. A reserved ID without a controller still owns the slot
    // while uploading;
    // checking only the controller would allow another send through during that await.
    if (activeStreamingTaskIdRef.current || activeStreamCtrlRef.current) {
      // Transfer fresh composer attachments to the queue; requeued items retain their own files
      // without clearing the live composer.
      enqueueMessage(
        id,
        text,
        queuedAttachments ?? composerAttachments,
        opts.disabledConnections != null ? opts.disabledConnections : composerDisabledConnections,
      );
      if (queuedAttachments == null) setComposerAttachments([]);
      // Queued counts as sent: the drain runs it when the slot frees, so a
      // repair waiting on this prompt will get its turn.
      return true;
    }
    // Synchronous reservation so a second invocation that fires
    // before our awaits resolve sees us as "in flight."
    activeStreamingTaskIdRef.current = id;
    activeStreamProducedRef.current = false; // Mark the reservation immediately so reconciliation sees it before the server poll.
    markInFlight(id);

    const disabledForSend = normalizeComposerDisabledConnections(
      opts.disabledConnections != null ? opts.disabledConnections : composerDisabledConnections,
    );

    // Resolve a drained task’s project independently of the visible task, with the same
    // selectedProject fallback as a live send.
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

    // Uploads need a project; bootstrap general for projectless replies, matching the home-send
    // path.
    const attachmentsForSend = queuedAttachments ?? composerAttachments;
    if (!taskProjectName && (attachmentsForSend || []).some(isPendingFileAttachment)) {
      const general = await ensureGeneralProject();
      // If bootstrap fails, leave the project unset so attachment resolution raises the actionable
      // project error.
      if (general) {
        taskProjectName = general.name || 'general';
        taskProjectId = general.id || null;
        taskProjectPath = general.path || null;
      }
    }
    // Use explicit overrides for same-tick switches before React state updates. Off-screen queued
    // tasks must not
    // inherit the visible composer’s model; they fall back to the server default.
    const taskModel = opts.modelOverride
      || targetTask.model
      || (opts.targetTask ? null : selectedModel?.id)
      || null;
    // Match model precedence for effort, preserving an explicit empty override and excluding the
    // visible picker for queued tasks.
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
      // Toast upload failures and rethrow so Composer preserves text and staged files for retry.
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
            // Bump recency immediately; server timestamps update only at completion, and merging
            // preserves the newer local value.
            updatedAt: new Date().toISOString(),
          }
        : t,
    ));
    // A fresh send just consumed the live composer's attachments; a
    // drained queued item brought its own, so don't wipe whatever the
    // user may have started composing since.
    if (queuedAttachments == null) setComposerAttachments([]);

    let streamState = initialStreamState();
    // Adopt the server ID everywhere a temporary task is keyed so refreshed sessions cannot show
    // duplicate rows.
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

    // Append redacted form/Drive context for Anton while keeping the user’s original text in the
    // visible bubble.
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
        // Release the shared slot and drain across tasks so another task’s queued messages cannot
        // remain stranded.
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
    // The stream is running; whatever happens to it now is reported through the
    // callbacks above, not through this return value.
    return true;
  };

  // Sending is serialized app-wide but queues are per task. Sweep all queues, preferring the
  // finishing task’s FIFO follow-ups.
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
    // Restore the popped item on send rejection so its text/files survive and the rejection is
    // handled.
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

  // Resolve the repair conversation before creating its record and reuse it for sending; the server
  // completes
  // a handoff only in the conversation bound to that record.
  const artifactRepairTargetRef = useRef(null);

  const resolveArtifactRepairConversation = useCallback(async (artifact) => {
    const target = await resolveRepairConversation({
      artifact,
      tasks: tasksRef.current,
      fetchConversation: fetchSessionResult,
    });
    artifactRepairTargetRef.current = target.id ? target : null;
    // Adopt the record now: an origin chat older than the capped recents fetch
    // is unknown to `tasks`, and the send below appends the turn through it.
    if (target.id) {
      setTasks((prev) => (
        prev.some((t) => String(t.id || '') === target.id) ? prev : [target.task, ...prev]
      ));
    }
    return target.id;
  }, []);

  const addressArtifactWithAgent = async ({ artifact, prompt, conversationId }) => {
    const project = projects.find((item) =>
      String(item.id || '') === String(artifact?.projectId || ''))
      || projects.find((item) => item.name === artifact?.projectName)
      || null;
    const target = artifactRepairTargetRef.current;
    artifactRepairTargetRef.current = null;
    // Only resume a chat the repair was actually minted against; anything else
    // (no origin, unreachable chat, a stale resolution) starts a new one.
    if (!target || !conversationId || target.id !== String(conversationId)) {
      return handleSendFromHome(prompt, { project, conversationId });
    }
    // Preflight before touching the chat: returning false makes the viewer
    // cancel the repair, which beats leaving a handoff queued against a turn
    // that never starts.
    if (!(await ensureProviderReady())) return false;
    const targetTask = tasksRef.current.find((t) => String(t.id || '') === target.id) || target.task;
    // The `/c/:id` loader must not re-hydrate over the transcript we adopted
    // while the turn is in flight; the flag drops when the turn completes.
    markOptimisticConversation(target.id);
    selectTask(target.id);
    // handleSendInTask queues the prompt itself if that chat is already busy.
    await handleSendInTask(prompt, [], { targetTask });
    return true;
  };

  // Stream vault submission through the normal turn UI; the LLM never receives the field values.
  const handleSubmitDataVaultForm = ({ formId, formSpec, values, skipped, name, method }) => {
    if (!currentTask) return;
    const id = currentTask.id;

    setTasks((prev) => prev.map((t) =>
      t.id === id
        ? { ...t, status: 'active' }
        : t,
    ));

    let streamState = initialStreamState();
    // Adopt response.created IDs here too so temporary vault tasks do not duplicate persisted
    // conversations on refresh.
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
      // Migrate the form with its task ID so panel subscriptions and incoming patches still find
      // its spec.
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
    activeStreamProducedRef.current = false; // Guard every callback by generation before updating/releasing steps so superseded streams cannot
// erase a
// newer run’s question. A global generation matches the single shared stream slot; Stop releases it
// before reuse.
    const streamGen = activeStreamGenerationRef.current;
    activeStreamCtrlRef.current = streamDataVaultSubmission({
      formId,
      // Send null for temporary IDs so the server creates a canonical conversation ID.
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
        // Apply terminal form success directly: MarkdownCode suppresses incomplete streams and
        // historical completed mounts.
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
        // Form patches arrive as complete deltas; apply immediately so probing and error state
        // update while streaming.
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
      // This transport supplies no cancellation code. Stop bumps the generation before aborting, so
      // its late error is ignored.
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
    // _alreadyCreated means the modal has completed creation/uploads; avoid a duplicate POST.
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
    // Inline project creation keeps the user with the pending composer prompt instead of navigating
    // to Projects.
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
      // Merge list rows: replacing would erase local messages, streaming placeholders, and model
      // pins because fetched rows have empty transcripts.
      if (Array.isArray(fresh)) setTasks((prev) => mergeTasksFromServer(fresh, prev).filter((t) => !deletedTaskIdsRef.current.has(t.id)));
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
    // Remove coding-task PTYs and worktrees so deletion leaves no orphaned directories.
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
      // Only leave the chat view when its displayed task is deleted; deletion elsewhere preserves
      // navigation.
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
       * Remove the tombstone before refetch so a failed deletion restores its row. Preserve the
       * current route
       * rather than pulling the user back into the chat.
       */
      deletedTaskIdsRef.current.delete(taskId);
      const fresh = await fetchSessions().catch(() => null);
      setTasks((prev) => {
        /*
         * Merge valid nonempty results to preserve local transcript/model state. If refetch fails
         * or is empty,
         * restore the captured task so the failed-delete toast accurately reports that it is back.
         */
        const merged = mergeTasksFromServer(Array.isArray(fresh) && fresh.length ? fresh : null, prev);
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

  const [pendingDeleteTurn, setPendingDeleteTurn] = useState(null);

  const handleDeleteTurnRequest = (taskId, turnIndex) => {
    if (!taskId || typeof turnIndex !== 'number') return;
    setPendingDeleteTurn({ taskId, turnIndex });
  };

  const performDeleteTurn = async (taskId, turnIndex) => {
    if (!taskId || typeof turnIndex !== 'number') return;
    // Stop the stream before deleting its turn so late events cannot recreate it. Silent stop skips
    // the session refetch.
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
    if (!canUseSharedResource(project, 'canDelete')) return;
    // Re-confirming a delete that is already on the wire would fire a duplicate
    // DELETE; the project shows its waiting state until the server answers.
    if (deletingProjectKeys.includes(project.id || project.name)) return;
    setPendingDeleteProject(project);
  };
  const performDeleteProject = async (project) => {
    if (!project?.name) return;
    const deletingKey = project.id || project.name;
    setDeletingProjectKeys((prev) => (
      prev.includes(deletingKey) ? prev : [...prev, deletingKey]
    ));
    try {
      await runDeleteProject(project);
    } finally {
      setDeletingProjectKeys((prev) => prev.filter((key) => key !== deletingKey));
    }
  };
  const runDeleteProject = async (project) => {
    // Authorization is server-owned. Do not remove the project, its tasks, or
    // their drafts until DELETE succeeds: a member's 403 must leave the UI in
    // the exact pre-confirmation state instead of briefly looking successful.
    try {
      await deleteProject(project);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[performDeleteProject] failed', e);
      toastManager.add({
        type: 'danger',
        timeout: 0,
        title: "Couldn't delete this project. Nothing was removed; try again.",
        description: e?.message || String(e),
      });
      return;
    }
    // Tombstone cascaded conversations so a pre-delete fetch cannot reinsert them. Match both
    // project name and path.
    const doomedTaskIds = tasksRef.current
      .filter((t) => t.projectName === project.name || t.projectPath === project.path)
      .map((t) => t.id);
    doomedTaskIds.forEach((id) => deletedTaskIdsRef.current.add(id));
    // The project's own composer draft, plus every draft belonging to a
    // conversation the server is about to cascade-delete.
    clearDraft(`project:${project.id || project.name}`);
    doomedTaskIds.forEach((id) => clearDraft(id));
    // The server confirmed deletion, so it is now safe to update local state.
    setProjects((prev) => prev.filter((p) => p.name !== project.name));
    setTasks((prev) => prev.filter((t) =>
      t.projectName !== project.name && t.projectPath !== project.path
    ));
    setSelectedProject((current) => {
      const isDeletedProject = current && (
        (project.id && current.id && current.id === project.id)
        || current.name === project.name
      );
      return isDeletedProject ? null : current;
    });
    // Clear an active task from the deleted project to prevent fallback to an unrelated task; only
    // navigate away from chat.
    const liveActiveTaskId = activeTaskIdRef.current;
    if (liveActiveTaskId && doomedTaskIds.includes(liveActiveTaskId)) {
      activeTaskIdRef.current = null;
      setActiveTaskId(null);
      if (routeRef.current === 'task') setRoute('home');
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
    // Merge, never replace — same reason as handleRenameTask above. Repro for
    // the replace: open chat A, then Move to project on any task; the open
    // transcript went blank with nothing to bring it back.
    if (Array.isArray(fresh)) setTasks((prev) => mergeTasksFromServer(fresh, prev).filter((t) => !deletedTaskIdsRef.current.has(t.id)));
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

  // Restart polling on due-time and running-state changes; schedule count alone misses edits and
  // Run now.
  const scheduleKey = scheduled
    .filter((s) => s.enabled || s.running)
    .map((s) => `${s.nextRunAt}:${s.running ? 1 : 0}`)
    .join(',');

  // Reschedule from the latest nextRunAt after each tick, keeping distant schedules quiet and
  // imminent runs responsive.
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
    // Mark the new run immediately so reconciliation cannot call it interrupted before polling
    // catches up.
    if (result?.conversation_id) {
      markInFlight(result.conversation_id);
      setActiveTaskId(result.conversation_id);
      setRoute('task');
    }
    await refreshSchedules();
    refreshData();
  };

  const handleSearchSelect = (result) => {
    setWorkspaceMode('cowork');
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
  // Transparent shell surfaces expose the gravity-field canvas behind React.
  const appStyle = { width: '100vw', height: '100vh', background: 'transparent' };

  const mainBg = 'transparent';

  // Reserve top space for traffic lights and the floating sidebar button when the sidebar does not
  // cover them.
  // A shared --titlebar-safe-top inset keeps headers aligned with their body content.
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
      // MobileShell opens project details only for projects with tasks; empty projects enter
      // new-task composition.
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
      // Use a window drag region; interactive controls and scrollable/composer surfaces opt out
      // with no-drag.
      WebkitAppRegion: 'drag',
    }}>
      {/*
 * display: contents lets Sidebar participate directly in the shell flex layout. MobileShell
 * supplies the mobile drawer.
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
            // Use no-drag only while the scrim is open. Electron uses app-region CSS even on
            // invisible elements,
            // so a permanent full-window no-drag scrim would disable window dragging.
            WebkitAppRegion: navPopoutOpen ? 'no-drag' : 'drag',
            opacity: navPopoutOpen ? 1 : 0,
            pointerEvents: navPopoutOpen ? 'auto' : 'none',
            transition: 'opacity 320ms cubic-bezier(0.32, 0.72, 0, 1)',
          }}
        />
      )}

      {/* Code has one deliberate entry point while it is opt-in: Settings.
          Keeping this corner control exclusively about appearance prevents a
          hidden product from leaking into ordinary Cowork. */}
      {!isMobile && (settings.showThemeToggle !== false || settings.show8bitToggle !== false) && (
        <div className={`floating-toggle-row [-webkit-app-region:no-drag]${isNarrow ? ' floating-toggle-row--top-right' : ''}`}>
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
        </div>
      )}

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
          tasksStatus={tasksStatus}
          onRetryTasks={refreshData}
          pins={pins}
          scheduledCount={scheduled.length}
          projectsCount={projects.length}
          artifactsCount={artifacts.length}
          connectorsCount={connectors.length}
          activeRoute={effectiveWorkspaceMode === 'code'
            ? null
            : (route === 'task' ? null : (route === 'schedule-detail' ? 'scheduled' : route))}
          activeWorkspace={effectiveWorkspaceMode}
          showWorkspaceSwitch={codeModeEnabled}
          activeCodeRoute={effectiveWorkspaceMode === 'code'
            ? (codeProjectsOpen ? 'projects' : (codeConnectorsOpen ? 'connectors' : (codeSkillsOpen ? 'skills' : null)))
            : null}
          settingsActive={settingsOpen}
          // Only mark a recent as "selected" while actually viewing a task —
          // activeTaskId persists across navigation, so passing it unconditionally
          // left the last-opened task highlighted on Projects/Settings/etc.
          activeTaskId={effectiveWorkspaceMode === 'cowork' && route === 'task' ? activeTaskId : null}
          codingSessions={codingSessions}
          activeCodingSessionId={effectiveWorkspaceMode === 'code' && !codeNewTask && !codeProjectsOpen && !codeConnectorsOpen && !codeSkillsOpen
            ? activeCodingSessionId
            : null}
          serverOnline={serverOnline}
          agentLabel={agentLabel}
          isSsoConnected={ssoConnected}
          onNavigate={navigate}
          onWorkspaceChange={changeWorkspace}
          onSelectTask={selectTask}
          onNewTask={newTask}
          onSelectCodingSession={selectCodingSession}
          onSetCodingSessionPinned={setCodingSessionPinned}
          onNewCodingTask={openNewCodingTask}
          onOpenCodingProjects={openCodingProjects}
          onOpenCodingConnectors={openCodingConnectors}
          onOpenCodingSkills={openCodingSkills}
          onOpenSearch={() => setSearchOpen(true)}
          collapsed={sidebarCollapsedEffective}
          onToggleCollapsed={sidebarPopout
            ? () => setNavPopoutOpen(false)
            : (sidebarCanCollapse ? () => setSidebarCollapsed((c) => !c) : undefined)}
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
          // Hold the armed tip until the popout opens; its anchor is off-screen while the drawer is
          // closed.
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
        {/* Sync the active Cowork route to the address bar even while its
            workspace panel is temporarily hidden behind Code Mode. */}
        <Outlet />
        <div
          className="workspace-mode-panel"
          hidden={effectiveWorkspaceMode !== 'cowork'}
          aria-hidden={effectiveWorkspaceMode !== 'cowork'}
        >
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
            codingModeEnabled={false}
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
              // Stage restored files only when their task consumes the redirect; the app-wide
              // composer could otherwise
              // send a background task’s files to the visible conversation.
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
              // Use the card’s conversation/question IDs; retiring a dead card must not clear
              // another task or a live sibling question.
              if (!conversationId) return;
              if (result?.status === 'not_found' || result?.status === 'already_answered') {
                retireLiveQuestion(conversationId, questionId);
                return;
              }
              // Surface retryable card failures as the composer does; clearing busy alone makes a
              // lost answer look successful.
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
            codingModeEnabled={false}
            onSelectTask={selectTask}
            onDeleteTask={handleDeleteTask}
            onMoveTaskToProject={handleOpenMoveModal}
            onDeleteProject={handleDeleteProject}
            deletingProjectKeys={deletingProjectKeys}
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
              // Navigate immediately and refresh in parallel: scheduled runs may not yet exist in
              // local recents.
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
            onAddressWithAgent={addressArtifactWithAgent}
            resolveRepairConversation={resolveArtifactRepairConversation}
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

        {route === 'skills' && <SkillsView onCreateWithCowork={handleNavigateHomeWithPrefill} onTryInChat={handleNavigateHomeWithPrefill} />}
        {['memory', 'publish'].includes(route) && (
          <UtilitiesView
            projects={projects}
            kind={route}
            project={selectedProject}
            onRefreshArtifacts={() => fetchArtifacts().then((data) => { if (Array.isArray(data)) setArtifacts(data); })}
            agentLabel={agentLabel}
          />
        )}
        </div>

        {codeModeEnabled && codeWorkspaceMounted && (
          <div
            className="workspace-mode-panel"
            hidden={effectiveWorkspaceMode !== 'code'}
            aria-hidden={effectiveWorkspaceMode !== 'code'}
          >
            <CodeView
              active={effectiveWorkspaceMode === 'code'}
              account={codeAccountUser}
              sessions={codingSessions}
              selectedId={activeCodingSessionId}
              newTask={codeNewTask}
              projectsOpen={codeProjectsOpen}
              connectorsOpen={codeConnectorsOpen}
              skillsOpen={codeSkillsOpen}
              defaultEngineId={settings.codingAgentEngine || DEFAULT_CODING_AGENT_ENGINE}
              defaultModel={settings.codingAgentModel || DEFAULT_CODING_AGENT_MODEL}
              models={mindsModels}
              modelMeta={modelMeta}
              skillScopeKey={codeSkillScopeKey}
              connections={connectors}
              onConnectionsChange={setConnectors}
              onOpenConnectors={openCodingConnectors}
              onOpenProjects={openCodingProjects}
              onOpenSkills={openCodingSkills}
              onOpenNewTask={openNewCodingTask}
              onSessionsChange={setCodingSessions}
              onSelectionChange={changeCodingSelection}
            />
          </div>
        )}

        {/* Settings modal — rendered over whatever route is active */}
        {/* Mobile (ENG-990): Settings is a full page with accordion nav, not
            a modal. Gated on isMobile; desktop keeps the two-column modal. */}
        {isMobile ? (
          // Use Modal for focus trapping/restoration, scroll lock, and Escape; SettingsView owns
          // the mobile header and body.
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
        // Cloud: the directory also lists connectors only the desktop app can
        // run. Picking one closes the directory and offers the download rather
        // than opening a connect form that couldn't work here.
        onDesktopOnly={(c) => {
          setConnectorPickerOpen(false);
          setComingSoonFeature(c?.label || 'This connector');
        }}
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
    <CoworkProvider value={coworkValue}>
      <CoworkRouterProvider router={routerRef.current} />
    </CoworkProvider>
  );
}
