import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { flushSync } from 'react-dom';
import Ico from './components/Icons';
import { pickConnectWelcome } from './lib/connectWelcomes';
// OnboardingShell removed — antontron's renderer handles terms/install/
// provider setup. The cowork app is mounted by CoworkApp.tsx only after
// those gates pass, so AppCore renders unconditionally here.
import Sidebar from './components/Sidebar';
import MobileShell from './components/MobileShell';
import { ConfirmModal } from './components/ConfirmModal';
import HomeView from './views/HomeView';
import ChatView from './views/ChatView';
import ProjectsView from './views/ProjectsView';
import ScheduledView from './views/ScheduledView';
import TasksView from './views/TasksView';
import ScheduleDetailView from './views/ScheduleDetailView';
import ArtifactsView from './views/ArtifactsView';
import DispatchView from './views/DispatchView';
import CustomizeView from './views/CustomizeView';
import SettingsView from './views/SettingsView';
import UtilitiesView from './views/UtilitiesView';
import SearchModal from './components/SearchModal';
import ConnectorPicker from './components/connector/ConnectorPicker';
import ServerOfflineHelpModal from './components/ServerOfflineHelpModal';
import { setForm as setDataVaultForm, getFormState as getDataVaultFormState } from './components/datavault/formStore';
import { host } from '../platform/host';
import { useBreakpoint } from './hooks/useBreakpoint';
import { fetchSessions, fetchSession, fetchProjects, fetchArtifacts, fetchSettings, fetchHealth,
         createProject, updateSettings, streamNewSession, streamMessage,
         streamDataVaultSubmission,
         allocateConversationId, uploadAttachments,
         deleteAttachment, searchCowork, fetchPins, pinTask, unpinTask,
         recordTaskVisit, fetchSchedules, createSchedule, updateSchedule, deleteSchedule,
         pauseSchedule, resumeSchedule, runScheduleNow, fetchDatasources, MOCK_DATA,
         renameConversation, deleteConversation, deleteConversationTurn, moveConversation,
         deleteProject, cancelScratchpad, cancelResponse, fetchConnector,
         fetchSavedConnection, deleteDatasource,
         fetchInFlightStatus, tailInFlight, fetchInFlightList } from './api';
import { initialStreamState, reduceStream } from './lib/responseStreamAdapter';

// One-of-ten encouraging follow-ups picked when a connect task is
// created. Reads as a friendly nudge after the connect-intro card —
// keeps the chat surface inviting and signals that the agent is
// available for free-form questions about the form.
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

async function resolveComposerAttachmentsForSend(projectName, sessionId, attachments) {
  const list = Array.isArray(attachments) ? attachments : [];
  const pending = list.filter(isPendingFileAttachment);
  const rest = list.filter((a) => !isPendingFileAttachment(a));
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
  const merged = [...rest, ...uploaded];
  return { merged, attachmentIds: merged.map((x) => x.id) };
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

const THINKING_PLACEHOLDER = 'Thinking...';

// Friendly continuation prompts. We reach for one of these when the
// user lands on a conversation that was streaming when the app or
// server died (or the user closed the window mid-turn). The prompt
// becomes a synthetic assistant message (or the tail of one) so the
// user has something to react to instead of staring at frozen
// "thinking" indicators.
const CONTINUE_PROMPTS = [
  'Looks like we paused mid-flow. Want to pick up where we left off?',
  'Got cut off before I could finish. Should I keep going?',
  "Hey — looks like our last run got cut short. Continue from here?",
  "I lost my place when the session ended. Want me to resume the work?",
  "Things stopped before I wrapped up. Ready to continue?",
  "Looks like that turn didn't finish. Want me to take another swing at it?",
  'We left this one mid-thought — keep going, or pivot to something else?',
  "Got disconnected. Should I resume from where I was?",
  "That last task didn't complete. Want to pick it back up?",
  'Picking back up — should I continue, or are we moving on?',
];

function pickContinuePrompt() {
  return CONTINUE_PROMPTS[Math.floor(Math.random() * CONTINUE_PROMPTS.length)];
}

function stripStreaming(messages) {
  return messages.filter((m) => m.role !== '_streaming');
}

// Status values the stream reducer leaves behind for IN-FLIGHT step
// activity. A clean turn closes everything to 'completed' / 'done' /
// 'error' / 'cancelled'. Anything else is "this step was running
// when the stream died" — we'll mark them done on reload so the rail
// stops claiming work is still happening.
const RUNNING_STEP_STATUSES = new Set([
  'pending', 'thinking', 'streaming', 'in_progress', 'running',
]);

// Reconcile a task's stored streaming/running state against whether
// a real SSE stream is alive for it RIGHT NOW. Called when the user
// navigates into a task. Three concerns:
//
//   1. `_streaming` UI placeholder rows — if no live stream exists
//      for this task, the placeholder is a zombie from a previous
//      run; drop it.
//   2. Step rows whose `status` says they're still working —
//      collapse them to `completed` so the progress box doesn't
//      keep animating.
//   3. If anything was clearly mid-flight (zombie placeholder, or a
//      trailing user message with no assistant reply), append a
//      friendly "continue?" assistant message — appending to the
//      last assistant message when there is one, else inserting a
//      fresh one. This is renderer-side only; it never goes to the
//      server (anton's history stays clean) and it gets replaced as
//      soon as the user sends their next message.
function reconcileTaskMessages(messages, isLive, isServerInFlight = false) {
  if (!Array.isArray(messages)) return messages;
  if (isLive) return messages; // legitimate in-flight (local), leave alone
  // If the server says this conversation's producer is still running,
  // we're about to (re)attach via tailInFlight — DON'T inject the
  // "things stopped before I wrapped up" continuation prompt. The
  // live stream will materialize within ~50ms via the reconnect
  // path; showing the stopped message first would be both wrong
  // AND flicker.
  //
  // Step-cleanup (RUNNING_STEP_STATUSES → completed) is also skipped
  // here: those steps may still be progressing under the live tail
  // and we don't want to prematurely flag them done.
  if (isServerInFlight) return messages;
  const hadStreaming = messages.some((m) => m && m.role === '_streaming');
  // Pass 1 — strip _streaming + activity placeholders, mark
  // running steps as completed. Each rewritten message gets a flag
  // so we can avoid double-tagging continuation prompts.
  const cleaned = messages
    .filter((m) => m && m.role !== '_streaming' && m.role !== 'activity')
    .map((m) => {
      if (m.role !== 'assistant') return m;
      if (!Array.isArray(m.steps) || m.steps.length === 0) return m;
      let dirty = false;
      const nextSteps = m.steps.map((s) => {
        if (s && RUNNING_STEP_STATUSES.has(s.status)) {
          dirty = true;
          return { ...s, status: 'completed', completedAt: s.completedAt || Date.now() };
        }
        return s;
      });
      // Also shake out a top-level message-level streamStatus if any
      // (the live stream sets it to 'streaming' / 'tool' / etc.).
      const streamStatusFix = m.streamStatus && m.streamStatus !== 'done'
        ? { streamStatus: 'done' }
        : null;
      if (!dirty && !streamStatusFix) return m;
      return { ...m, ...(dirty ? { steps: nextSteps } : {}), ...(streamStatusFix || {}) };
    });

  // Decide whether a continuation prompt is warranted.
  // Triggers:
  //   • we just stripped a `_streaming` row, OR
  //   • the last surviving message is a user message with no reply,
  //     OR an assistant message we just had to clean up.
  let wantContinuation = hadStreaming;
  if (!wantContinuation && cleaned.length > 0) {
    const last = cleaned[cleaned.length - 1];
    if (last && last.role === 'user') wantContinuation = true;
  }
  if (!wantContinuation) return cleaned;

  const prompt = pickContinuePrompt();
  const last = cleaned[cleaned.length - 1];
  if (last && last.role === 'assistant' && !last._continuationAppended) {
    // Append to the existing assistant message (per request: "if the
    // last message is from anton, append into it").
    const sep = last.content && last.content.length ? '\n\n' : '';
    return [
      ...cleaned.slice(0, -1),
      { ...last, content: (last.content || '') + sep + prompt, _continuationAppended: true },
    ];
  }
  // Otherwise inject a fresh assistant message.
  return [
    ...cleaned,
    {
      role: 'assistant',
      content: prompt,
      steps: [],
      startedAt: Date.now(),
      _continuationAppended: true,
      _client_only: true,
    },
  ];
}

function removeThinkingPlaceholder(messages) {
  return messages.filter((m) => !(m.role === 'activity' && m.placeholder));
}

function withThinkingPlaceholder(messages) {
  return [
    ...removeThinkingPlaceholder(stripStreaming(messages)),
    {
      role: 'activity',
      content: THINKING_PLACEHOLDER,
      kind: 'placeholder',
      phase: 'reasoning',
      state: 'running',
      placeholder: true,
    },
  ];
}

function markActivityDone(messages) {
  return messages.map((m) => (
    m.role === 'activity' && m.state === 'running'
      ? { ...m, state: 'done' }
      : m
  ));
}

function humanizeToken(value) {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function describeActivity(event) {
  if (event?.type === 'tool_result') {
    const action = humanizeToken(event.action || 'used');
    const name = humanizeToken(event.name || 'tool');
    return `${action.charAt(0).toUpperCase()}${action.slice(1)} ${name}`.trim();
  }

  const message = humanizeToken(event?.message);
  if (message) return message;

  const phase = humanizeToken(event?.phase);
  const normalizedPhase = phase.toLowerCase();
  if (normalizedPhase === 'reasoning') return THINKING_PLACEHOLDER;
  if (normalizedPhase === 'reasoning done') return 'Finished reasoning';
  if (normalizedPhase === 'context') return 'Updated context';

  return phase ? `Anton is ${phase}` : 'Anton is working';
}

// ─── Per-turn step persistence ───────────────────────────────────────────
//
// Anton's history file (the canonical conversation record) only stores
// {role, content}. The streaming adapter builds richer step data —
// scratchpad cells, artifacts, reasoning timing — but those are dropped
// on persistence and would be lost on conversation reload, leaving the
// chat with no Thinking block, no inline artifact cards, and an empty
// Scratchpad modal.
//
// We sidecar the full step list in localStorage keyed by conversation
// id → assistant turn index. Persistence is local to this install
// (fine for a desktop app); promote to a server-side sidecar later if
// cross-device sync matters.
//
// Schema (per turn):
//   { steps: ThinkingStep[], startedAt: number }
//
// ThinkingStep shape mirrors `responseStreamAdapter`'s output, including
// the `_isScratchpad` / `_scratchpadTabId` markers the ScratchpadModal
// keys off so tabs reattach when the conversation is reopened.
const CONV_TURNS_KEY = (cid) => `anton:conv-turns:${cid}`;
const LEGACY_ARTIFACTS_KEY = (cid) => `anton:conv-artifacts:${cid}`;

function readConvTurns(cid) {
  if (!cid) return null;
  try {
    const raw = localStorage.getItem(CONV_TURNS_KEY(cid));
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

function writeConvTurns(cid, data) {
  if (!cid) return;
  try { localStorage.setItem(CONV_TURNS_KEY(cid), JSON.stringify(data)); }
  catch {} // private mode / quota — fail silently
}

// One-time migration from the old artifact-only sidecar. Each entry
// was an array of artifact-shape steps; promote it to the new shape.
function migrateLegacyArtifacts(cid) {
  if (!cid) return;
  try {
    const legacy = localStorage.getItem(LEGACY_ARTIFACTS_KEY(cid));
    if (!legacy) return;
    const map = JSON.parse(legacy);
    if (!map || typeof map !== 'object') return;
    const next = readConvTurns(cid) || {};
    for (const [idx, arts] of Object.entries(map)) {
      if (!Array.isArray(arts) || arts.length === 0) continue;
      const existing = next[idx]?.steps || [];
      next[idx] = { steps: [...existing, ...arts], startedAt: next[idx]?.startedAt || null };
    }
    writeConvTurns(cid, next);
    localStorage.removeItem(LEGACY_ARTIFACTS_KEY(cid));
  } catch {}
}

// Replay the server-persisted event log for one assistant turn
// through the same reducer the live stream uses. The resulting
// `steps` and `startedAt` are identical to what the client would
// have built during a fresh stream — no parity drift.
function reduceServerEvents(events, fallbackStartedAt) {
  if (!Array.isArray(events) || events.length === 0) return null;
  let state = initialStreamState();
  for (const ev of events) {
    try { state = reduceStream(state, ev); } catch {}
  }
  return {
    steps: state.steps || [],
    startedAt: state.startedAt || fallbackStartedAt || null,
  };
}

// Walk a messages payload from the server and, for any assistant
// turn that carries an `events` array (the new sidecar), derive
// `steps`/`startedAt` via the live reducer. Drops the raw `events`
// so React state doesn't carry the redundant log around.
function hydrateMessagesFromServerEvents(messages) {
  if (!Array.isArray(messages)) return messages;
  return messages.map((m) => {
    if (m.role !== 'assistant') return m;
    const events = m.events;
    if (!Array.isArray(events) || events.length === 0) return m;
    const reduced = reduceServerEvents(events, m.startedAt);
    const { events: _drop, ...rest } = m;
    if (!reduced || reduced.steps.length === 0) return rest;
    return {
      ...rest,
      steps: reduced.steps,
      startedAt: rest.startedAt || reduced.startedAt,
    };
  });
}

// Persist the full step set for one assistant turn so reload restores
// the Thinking block, scratchpad tabs, and inline artifact cards.
// `turnIndex` is the 0-based position of this assistant message among
// all assistant messages in the conversation.
function persistTurnState(cid, turnIndex, steps, startedAt) {
  if (!cid || !Array.isArray(steps) || steps.length === 0) return;
  const map = readConvTurns(cid) || {};
  // Strip any non-serialisable fields (refs, functions). The step
  // shape is plain data otherwise.
  const sanitized = steps.map((s) => ({
    id: s.id,
    label: s.label || null,
    badge: s.badge || null,
    icon: s.icon || null,
    status: s.status || 'completed',
    startedAt: s.startedAt ?? null,
    completedAt: s.completedAt ?? null,
    reasoningStartedAt: s.reasoningStartedAt ?? null,
    executionStartedAt: s.executionStartedAt ?? null,
    executionCompletedAt: s.executionCompletedAt ?? null,
    data: s.data || null,
    output: typeof s.output === 'string' ? s.output : null,
    result: s.result || null,
    stderr: s.stderr || null,
    _isScratchpad: !!s._isScratchpad,
    _scratchpadTabId: s._scratchpadTabId || null,
  }));
  map[turnIndex] = { steps: sanitized, startedAt: startedAt ?? null };
  writeConvTurns(cid, map);
}

// Merge persisted step + timing data onto assistant messages by turn
// index. Idempotent — if a message already has steps from a fresh
// stream we don't overwrite (the live data is more accurate).
function mergeConvTurns(cid, messages) {
  if (!cid || !messages) return messages;
  migrateLegacyArtifacts(cid);
  const map = readConvTurns(cid);
  if (!map) return messages;
  let assistantIdx = 0;
  return messages.map((m) => {
    if (m.role !== 'assistant') return m;
    const saved = map[assistantIdx];
    assistantIdx += 1;
    if (!saved || !Array.isArray(saved.steps) || saved.steps.length === 0) return m;
    const hasLiveSteps = Array.isArray(m.steps) && m.steps.length > 0;
    if (hasLiveSteps) return m;
    return {
      ...m,
      steps: saved.steps,
      startedAt: m.startedAt || saved.startedAt || null,
    };
  });
}

// Merge a fresh fetchSessions response with the existing tasks,
// preserving any in-memory state the server hasn't seen yet.
//
// Why: anton flushes `_history.json` only at the end of a successful
// turn. While a stream is in flight the user-typed message + the
// assistant's `_streaming` row + any captured progress live ONLY in
// React state. A naive `setTasks(serverData)` after fetchSessions
// blows that away — most visibly when the user navigates to recents
// during the very first turn of a new task and comes back: the
// chat is empty and the title shows the raw conversation id.
//
// Strategy: take the server's tasks (authoritative for title /
// project / status / order), but for each task that exists locally
// AND is mid-stream OR has unsaved messages, keep the local
// messages array.
function mergeTasksFromServer(serverTasks, localTasks) {
  const local = Array.isArray(localTasks) ? localTasks : [];
  if (!Array.isArray(serverTasks)) return local;
  const localById = new Map(local.map((t) => [t.id, t]));
  // Take whichever of (local, server) updatedAt is newer. A turn
  // in flight has a fresh client stamp (handleSendInTask /
  // handleSendFromHome) but a stale server stamp (server only
  // bumps _meta.json on completion). Without this guard, a
  // fetchSessions mid-stream would slide the just-revived task
  // back down the list as soon as it lands.
  const _newerUpdatedAt = (a, b) => {
    const aa = Date.parse(a || '') || 0;
    const bb = Date.parse(b || '') || 0;
    return aa >= bb ? a : b;
  };
  const merged = serverTasks.map((server) => {
    const l = localById.get(server.id);
    if (!l) return server;
    const lMessages = Array.isArray(l.messages) ? l.messages : [];
    const isStreaming = lMessages.some((m) => m.role === '_streaming');
    const hasLocalContent = lMessages.length > 0;
    if (!isStreaming && !hasLocalContent) {
      // Even without live messages, prefer the locally-bumped
      // updatedAt if it's newer — handleSendInTask stamps the task
      // before any stream events arrive, so a fetchSessions that
      // races between user-click-send and the first SSE event must
      // not overwrite the bump.
      return { ...server, updatedAt: _newerUpdatedAt(l.updatedAt, server.updatedAt) };
    }
    return {
      ...server,
      // Local wins for the live conversation surface.
      messages: lMessages,
      status: l.status || server.status,
      // Preserve in-flight attachments tracked client-side.
      attachments: lMessages.length && Array.isArray(l.attachments) && l.attachments.length
        ? l.attachments
        : server.attachments,
      // Muted-datasource toggles can change while a turn streams; keep
      // the client list when present.
      disabledConnections: l.disabledConnections ?? server.disabledConnections ?? [],
      updatedAt: _newerUpdatedAt(l.updatedAt, server.updatedAt),
    };
  });
  // Carry over local-only tasks the server hasn't seen yet (e.g. a
  // tmp-id task whose first stream hasn't resolved a real cid).
  const serverIds = new Set(serverTasks.map((t) => t.id));
  for (const t of local) {
    if (!serverIds.has(t.id)) merged.unshift(t);
  }
  return merged;
}

function appendActivity(messages, event) {
  const content = describeActivity(event);
  const cleaned = removeThinkingPlaceholder(messages);
  const previous = cleaned[cleaned.length - 1];
  if (previous?.role === 'activity' && previous.content === content) {
    return [...cleaned.slice(0, -1), { ...previous, state: 'running' }];
  }
  return [
    ...cleaned,
    {
      role: 'activity',
      content,
      kind: event?.type || 'progress',
      phase: event?.phase || null,
      state: 'running',
    },
  ];
}

export default function App() {
  return <AppCore />;
}

function AppCore() {
  const [settings, setSettings] = useState({
    greeting: "Let's knock something off your list",
    tone: 'balanced',
    defaultModel: 'claude-sonnet-4-6',
    autoPin: true,
    showDots: true,
    showCounters: true,
    accentVariant: 'aqua',
  });

  const [tasks, setTasks] = useState([]);
  // IDs of tasks deleted this session. Used to filter them out of
  // subsequent fetchSessions responses so zombies can't reappear.
  const deletedTaskIdsRef = useRef(new Set());
  const [projects, setProjects] = useState([]);
  const [artifacts, setArtifacts] = useState([]);
  const [scheduled, setScheduled] = useState([]);
  // Flat session→schedule map sourced from `GET /v1/schedules`.
  // Lets TasksView collapse all conversations belonging to one
  // schedule into a single grouped row instead of listing each
  // execution separately.
  const [scheduleRunsIndex, setScheduleRunsIndex] = useState({});
  const [pins, setPins] = useState([]);
  const [connectors, setConnectors] = useState([]);
  const [composerAttachments, setComposerAttachments] = useState([]);
  /** Muted vault connections for the next send (all composers); persisted on stream. */
  const [composerDisabledConnections, setComposerDisabledConnections] = useState([]);
  const [searchOpen, setSearchOpen] = useState(false);
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
  const composerMuteLastTaskIdRef = useRef(null);
  const prevRouteForComposerMuteRef = useRef(null);

  // Per-task queue of user messages waiting for the current turn to
  // finish before they get sent. When the user fires another message
  // while a stream is in flight we push to this queue instead of
  // trying to start a parallel turn (anton-core can't handle that
  // gracefully). After the active turn's onDone/onError fires we
  // drain one item from the queue.
  const [messageQueue, setMessageQueue] = useState({}); // { [taskId]: [{id, text}] }
  const messageQueueRef = useRef({});
  useEffect(() => { messageQueueRef.current = messageQueue; }, [messageQueue]);

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

  const refreshInFlightSet = useCallback(async () => {
    const items = await fetchInFlightList();
    const ids = items.map((it) => it.conversation_id).filter(Boolean);
    setInFlightSet((prev) => {
      // Diff: if the server says a cid is GONE but we had it, the
      // stream just finished from elsewhere — that's the signal to
      // refetch that conversation's messages so the UI catches up.
      const next = new Set(ids);
      const finished = [...prev].filter((cid) => !next.has(cid));
      if (finished.length > 0) {
        // Defer the refetch so we don't synchronously trigger a
        // re-render storm.
        setTimeout(() => {
          finished.forEach((cid) => {
            fetchSession(cid).then((fresh) => {
              if (!fresh || !Array.isArray(fresh.messages)) return;
              setTasks((tasksPrev) => tasksPrev.map((t) => {
                if (t.id !== cid) return t;
                const fromServer = hydrateMessagesFromServerEvents(fresh.messages);
                const enriched = mergeConvTurns(cid, fromServer);
                return { ...t, messages: reconcileTaskMessages(enriched, false, false), status: 'idle' };
              }));
            }).catch(() => {});
          });
        }, 0);
      }
      return next;
    });
  }, []);

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

  // Heartbeat poll — every 5 seconds, but ONLY while the set is
  // non-empty. When nothing's in flight, an idle tab makes zero
  // background HTTP calls. When something IS in flight, the poll
  // catches the "the other client just finished it" case for
  // multi-monitor users who can see both windows at once and don't
  // generate a focus event to trigger a manual refresh.
  useEffect(() => {
    if (inFlightSet.size === 0) return undefined;
    const timer = setInterval(() => { refreshInFlightSet(); }, 5000);
    return () => clearInterval(timer);
  }, [inFlightSet.size, refreshInFlightSet]);

  const enqueueMessage = (taskId, text) => {
    const item = { id: `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`, text };
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

  const handleStopStream = useCallback(async (opts = {}) => {
    // `silent: true` aborts the stream without leaving the "Task stopped"
    // assistant placeholder behind — used when the caller is about to
    // remove the user turn anyway (delete flow), so the placeholder
    // would just flash on screen for a frame before being pruned.
    const silent = opts?.silent === true;
    // Snapshot the conversation_id BEFORE we clear the ref — we need
    // it for the server-side cancel call below.
    const cidToCancel = activeStreamingTaskIdRef.current;
    // 1) Cancel the running scratchpad (if any) so anton stops
    //    executing user code mid-cell.
    const padName = activeScratchpadRef.current;
    if (padName) {
      try { await cancelScratchpad(padName); } catch {}
    }
    // 2) Phase 3 — explicit server-side cancel. Under the Phase 1
    //    producer/consumer split, aborting the SSE fetch alone no
    //    longer halts the underlying turn; we have to signal the
    //    producer task directly. Fire-and-forget: we don't await it
    //    on the user-facing path because local state teardown is what
    //    the user actually sees. The producer's CancelledError branch
    //    handles history finalize + buffer Cancelled terminal.
    if (cidToCancel) {
      cancelResponse(cidToCancel).catch(() => { /* idempotent */ });
      // Cache: we just told the server to cancel, so this conversation
      // is no longer "in flight" from our point of view. The fetch
      // abort below will short-circuit the SSE consumer before its
      // onDone/onError fires, so we can't rely on those to update the
      // cache — drop the mark here.
      markInFlightDone(cidToCancel);
    }
    // 3) Abort the SSE fetch so the renderer stops accumulating events.
    //    With Phase 1 this is only consumer-side cleanup; the producer
    //    is unaffected (good when the user closes a tab, also OK here
    //    because step 2 already told the producer to stop).
    const ctrl = activeStreamCtrlRef.current;
    if (ctrl) {
      try { ctrl.abort(); } catch {}
      activeStreamCtrlRef.current = null;
    }
    activeScratchpadRef.current = null;
    activeStreamingTaskIdRef.current = null;

    if (silent) {
      // Just strip the `_streaming` + stale `activity` rows; the caller
      // will follow up with its own state mutation (e.g. delete the user
      // turn) and we don't want a "stopped" message lingering between.
      setTasks((prev) => prev.map((t) => {
        const before = t.messages || [];
        const filtered = before.filter((m) => m.role !== '_streaming' && m.role !== 'activity');
        if (filtered.length === before.length) return t;
        return { ...t, status: 'idle', messages: filtered };
      }));
      return;
    }

    // 3) Roll the streaming placeholder into a final assistant
    //    message. Drop the in-flight steps so the rail's Progress
    //    + ThinkingBlock collapse cleanly, and leave a friendly
    //    confirmation in place of any partial body text.
    const STOP_MESSAGES = [
      'Task stopped — let me know what to try next.',
      'Got it, I stepped back. Want to take another angle?',
      'Stopped here. What would you like me to do instead?',
      'Paused as requested. Ready when you are.',
      'All halted. Tell me how to proceed.',
      'Done — execution stopped on your call.',
      'Standing by. Send another prompt when you\'re ready.',
      'Task halted gracefully. What\'s next?',
    ];
    const stoppedMsg = STOP_MESSAGES[Math.floor(Math.random() * STOP_MESSAGES.length)];

    setTasks((prev) => prev.map((t) => {
      const streaming = (t.messages || []).find((m) => m.role === '_streaming');
      if (!streaming) return t;
      const others = t.messages
        .filter((m) => m.role !== '_streaming')
        .filter((m) => m.role !== 'activity'); // also clear stale activity rows
      return {
        ...t,
        status: 'idle',
        messages: [...others, {
          role: 'assistant',
          content: stoppedMsg,
          // Empty steps so Progress + ThinkingBlock stop rendering
          // for this turn — the rail returns to its idle state.
          steps: [],
          startedAt: streaming.startedAt,
        }],
      };
    }));
  }, []);

  // Per-task streaming state is derived inside ChatView (it has the
  // task object via props). Don't compute it here — `activeTaskId` is
  // declared further down and reading it before initialization throws
  // a TDZ ReferenceError at first render.
  const [models] = useState(MOCK_DATA.models);
  // The user's preferred collapsed state for the sidebar. Effective
  // collapsed-ness is derived below — we only honor this value while
  // viewing a chat task; every other surface (home, projects,
  // artifacts, settings, scheduled, …) keeps the sidebar expanded so
  // the user can navigate via it directly. Locking outside chat
  // means the collapse affordance is hidden in those views too.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { isMobile, isNarrow } = useBreakpoint();

  // iOS Safari (and Android Chrome) auto-zoom the page in when a text
  // input with font-size < 16px gets focus, and don't zoom back out
  // when it loses focus / the form is submitted — the user is left
  // viewing a permanently-magnified app after sending a chat message.
  //
  // Rather than bumping every input to 16px on mobile (which would
  // distort the composer's design metrics), we toggle the viewport
  // meta tag around text-input focus: locking `maximum-scale=1` on
  // focusin prevents the zoom from happening, restoring the original
  // value on focusout returns pinch-zoom to the user for the rest of
  // the app. Net effect matches "auto-dezoom after submit" without
  // any visible zoom flash.
  useEffect(() => {
    if (!isMobile) return undefined;
    const meta = document.querySelector('meta[name="viewport"]');
    if (!meta) return undefined;
    const original = meta.getAttribute('content') || '';
    const ZOOM_LOCK = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no';

    // Only the input types that actually trigger iOS auto-zoom — skip
    // checkboxes / dates / file pickers / buttons (no text caret, no
    // zoom). contenteditable surfaces count too.
    const SKIP_INPUT_TYPES = new Set([
      'button', 'submit', 'reset', 'image', 'file',
      'checkbox', 'radio', 'range', 'color',
      'date', 'time', 'datetime-local', 'month', 'week',
    ]);
    const isTextInput = (el) => {
      if (!el || el.nodeType !== 1) return false;
      const tag = el.tagName;
      if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
      if (tag === 'INPUT') {
        const t = (el.type || 'text').toLowerCase();
        return !SKIP_INPUT_TYPES.has(t);
      }
      return !!el.isContentEditable;
    };

    const onFocusIn = (e) => {
      if (isTextInput(e.target)) meta.setAttribute('content', ZOOM_LOCK);
    };
    const onFocusOut = (e) => {
      if (!isTextInput(e.target)) return;
      // Defer the restore one tick — restoring synchronously can race
      // with iOS committing the blur and leave the viewport stuck at
      // the zoomed scale on some iOS versions.
      setTimeout(() => meta.setAttribute('content', original), 0);
    };

    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      meta.setAttribute('content', original);
    };
  }, [isMobile]);

  // On narrow screens (< 900px), sidebar is a slide-over overlay — track open state separately.
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  // Routes where the user can collapse the sidebar. Currently:
  // chat task only.
  const sidebarCollapsibleRoutes = useMemo(() => new Set(['task']), []);
  // Theme (light | dark) — persisted in localStorage so the choice
  // survives reloads. The animated background canvas (gravity-field)
  // and the body's bg colour both follow this value.
  const [theme, setTheme] = useState(() => {
    try {
      const saved = window.localStorage.getItem('anton.theme');
      return saved === 'light' || saved === 'dark' ? saved : 'dark';
    } catch { return 'dark'; }
  });

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

  useEffect(() => {
    try { window.localStorage.setItem('anton.theme', theme); } catch {}
    // Swap body class so kit's gf-theme-* page background colour applies.
    document.body.classList.remove('gf-theme-dark', 'gf-theme-light');
    document.body.classList.add(theme === 'light' ? 'gf-theme-light' : 'gf-theme-dark');
    document.body.dataset.theme = theme;
    // Tell the gravity field to swap palettes live.
    if (window.gravityField && typeof window.gravityField.setTheme === 'function') {
      window.gravityField.setTheme(theme);
    }
  }, [theme]);

  // Mirror the Dot grid setting to a body class so the gravity-field
  // canvas can be hidden via CSS. `display: none` also lets the
  // canvas's requestAnimationFrame loop idle when the user has
  // turned the pattern off — no draw cost while invisible.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.body.classList.toggle('gf-dots-off', settings.showDots === false);
  }, [settings.showDots]);

  const [route, setRoute] = useState('home');         // home | task | projects | scheduled | schedule-detail | artifacts | dispatch | customize | settings
  // Keep a ref of the live route so the keydown listener (bound
  // once on mount) can read it without a re-bind on every nav.
  routeRef.current = route;
  // Effective collapse state: only honor the user's preference while
  // the route allows it (chat task). Everywhere else the sidebar
  // stays expanded — gives the user permanent access to the nav.
  const sidebarCollapsedEffective =
    !isNarrow && sidebarCollapsibleRoutes.has(route) && sidebarCollapsed;
  const [activeTaskId, setActiveTaskId] = useState(null);
  const [selectedScheduleId, setSelectedScheduleId] = useState(null);
  const [selectedProject, setSelectedProject] = useState(null);
  const [selectedModel, setSelectedModel] = useState(MOCK_DATA.models[0]);
  // In the hosted web shell the FastAPI process IS the host — there
  // is no subprocess to start/stop, and the SPA only loads at all if
  // the server is up. Seed online so downstream gates (`if (!serverOnline) return;`)
  // don't block the initial render waiting for a poll that never matters.
  const [serverOnline, setServerOnline] = useState(host.isWeb);
  const [serverBusy, setServerBusy] = useState(false);
  const [serverBusyKind, setServerBusyKind] = useState('starting'); // 'starting' | 'stopping'
  // `config_ready` deliberately omitted from the initial state — the
  // boot-time settings redirect at line ~798 keys off `=== false` so
  // that "not yet fetched" (undefined) and "server confirmed
  // unconfigured" (false) are distinguishable. Seeding it as `false`
  // here causes a spurious redirect to Settings on first paint when
  // serverOnline starts true (the web shell), before fetchHealth has
  // even returned.
  const [health, setHealth] = useState({ status: 'offline', anton_available: false });

  // OTA UI update state
  const [updateStatus, setUpdateStatus] = useState(null); // { phase, version }
  const [updateApplying, setUpdateApplying] = useState(false);

  // Load data from server on mount
  const refreshData = useCallback(() => {
    fetchHealth().then((h) => {
      setHealth(h);
      setServerOnline(h.status === 'ok');
    });
    fetchSessions().then((data) => {
      if (Array.isArray(data)) setTasks((prev) => mergeTasksFromServer(data, prev).filter((t) => !deletedTaskIdsRef.current.has(t.id)));
    });
    fetchProjects().then((data) => { if (Array.isArray(data)) setProjects(data); });
    fetchArtifacts().then((data) => { if (Array.isArray(data)) setArtifacts(data); });
    fetchPins().then((data) => setPins(data.pins || []));
    fetchSchedules().then((data) => {
      setScheduled(data.schedules || []);
      setScheduleRunsIndex(data.runs_index || {});
    });
    fetchDatasources()
      .then((data) => setConnectors(Array.isArray(data?.connections) ? data.connections : []))
      .catch(() => setConnectors([]));
    fetchSettings().then((data) => {
      if (data && typeof data === 'object') {
        setSettings((prev) => ({ ...prev, ...data }));
        const modelId = data.defaultModel || data.planningModel;
        const m = MOCK_DATA.models.find((x) => x.id === modelId);
        setSelectedModel(m || {
          id: modelId,
          name: modelId || 'Anton model',
          desc: data.providerLabel ? `${data.providerLabel} planning model` : 'Configured Anton planning model',
        });
      }
    });
  }, []);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  // Allow descendants (e.g. ProjectsView's rename / create flow) to
  // ask for a fresh projects list without prop-drilling a refetch
  // handler. Also refetch sessions: a rename rewrites every
  // conversation's _meta.json with the new project name, so the
  // in-memory task list (which carries projectName per task) needs
  // to re-read or else it keeps pointing at the old project.
  useEffect(() => {
    const handler = () => {
      fetchProjects().then((data) => { if (Array.isArray(data)) setProjects(data); });
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

  // One-shot: once the backend has been online at least once during
  // this app session, the home view should skip the boot
  // choreography (orb → caret → typewriter). Re-running the intro on
  // every "new task" click is jarring; the choreography is a "the
  // app is starting" cue, not a per-navigation flourish.
  const [bootIntroDone, setBootIntroDone] = useState(false);
  useEffect(() => {
    if (serverOnline && !bootIntroDone) setBootIntroDone(true);
  }, [serverOnline, bootIntroDone]);

  // Listen for OTA update status pushed from main process. No-op in
  // web — host returns a noop unsubscriber there.
  useEffect(() => {
    return host.onUpdateStatus((status) => {
      setUpdateStatus(status);
    });
  }, []);

  const handleApplyUpdate = useCallback(async () => {
    console.log('[ui-update] install clicked, applying update...');
    if (updateApplying) { console.log('[ui-update] already applying, skipping'); return; }
    setUpdateApplying(true);
    setUpdateStatus({ phase: 'downloading', version: updateStatus?.version });
    try {
      const result = await host.applyUpdate();
      console.log('[ui-update] applyUpdate result:', result);
      // Window will reload with the new bundle — no further action needed
    } catch (err) {
      console.error('[ui-update] applyUpdate failed:', err);
      setUpdateApplying(false);
      setUpdateStatus({ phase: 'error' });
    }
  }, [updateApplying, updateStatus]);

  // ── Boot lifecycle decisions ─────────────────────────────────────
  // Both of these used to live inside HomeView, but the user can
  // navigate (settings → home → settings) which would re-mount
  // HomeView and re-fire each. App.jsx is the natural home — these
  // refs are app-session-level by virtue of being component-scoped
  // here, not view-scoped.

  // Watchdog — if the local backend never comes online, pop the help
  // modal so the user has logs / restart available. Once.
  const bootWatchdogFiredRef = useRef(false);
  useEffect(() => {
    if (serverOnline) return undefined;
    if (bootWatchdogFiredRef.current) return undefined;
    const t = setTimeout(() => {
      bootWatchdogFiredRef.current = true;
      setServerHelpOpen(true);
    }, 12_000);
    return () => clearTimeout(t);
  }, [serverOnline]);

  // Config redirect — server is up but config_ready is explicitly
  // false → take the user to Settings so they can finish setup.
  // Tested as `=== false` (not falsy) on purpose: we don't want to
  // route on initial undefined / pending values, only on a confirmed
  // negative from the server. Once per session.
  const bootConfigRedirectFiredRef = useRef(false);
  useEffect(() => {
    if (bootConfigRedirectFiredRef.current) return;
    if (!serverOnline) return;
    // Web sessions (mobile or desktop browser) always land on the
    // new-task composer regardless of config state. The auto-redirect
    // to Settings is Electron-only — there a missing provider means
    // the install can't reach any LLM at all. In the hosted web
    // shell, config is centralized server-side, so first-paint
    // shouldn't shove the user into a configuration screen.
    if (host.isWeb) return;
    if (health.config_ready === false) {
      bootConfigRedirectFiredRef.current = true;
      setRoute('settings');
    }
  }, [serverOnline, health.config_ready]);

  // Default the new-task project to "general". If the projects list
  // is loaded and it doesn't include "general", create it first. The
  // server provisions general on startup, so this only fires on
  // upgrades from an older build that didn't have that.
  const generalDefaultRef = useRef(false);
  useEffect(() => {
    if (selectedProject) return;        // user has picked something — don't override
    if (!serverOnline) return;          // wait for server
    if (generalDefaultRef.current) return; // only run once per session
    if (projects.length === 0) return;  // wait for projects to load
    const general = projects.find((p) => p.name === 'general');
    if (general) {
      generalDefaultRef.current = true;
      setSelectedProject(general);
      return;
    }
    // No general project — bootstrap it then re-fetch + select.
    generalDefaultRef.current = true;
    (async () => {
      try {
        await createProject('general');
        const fresh = await fetchProjects();
        if (Array.isArray(fresh)) setProjects(fresh);
        const created = (fresh || []).find((p) => p.name === 'general');
        if (created) setSelectedProject(created);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[default-project] could not bootstrap general', e);
        generalDefaultRef.current = false; // allow retry on next render
      }
    })();
  }, [projects, selectedProject, serverOnline]);

  // Seed server state from main's truth on first paint so the toggle
  // button reflects reality (running OR starting) even before /health
  // has returned. While main is mid-start, show the spinner; poll
  // every 600 ms until it resolves — OR until we've polled long
  // enough that we'd expect main to have decided one way or the
  // other.
  //
  // The earlier version stopped as soon as `info.starting === false`,
  // which lost the race against main's boot path: the renderer
  // mounts and runs its first tick before main has finished
  // `checkInstallStatus()` + spawned the python (so `pendingStart`
  // is still null and `info.starting === false` even though the
  // boot path is about to start one). The renderer would settle on
  // "offline" and never re-poll, leaving the user looking at a
  // grey status pill while a perfectly healthy server was
  // listening in the background.
  //
  // Fix: keep ticking until either `info.running` flips true OR a
  // hard ceiling elapses (45s — same upper bound as `startServer`'s
  // health-probe timeout). After the ceiling we stop and trust the
  // status pill / sidebar toggle to recover by user action.
  useEffect(() => {
    if (host.isWeb) return; // No server lifecycle to poll in the hosted web shell.
    let cancelled = false;
    let timer = null;
    const startedAt = Date.now();
    const POLL_CEILING_MS = 45_000;

    const tick = async () => {
      try {
        const info = await host.serverInfo();
        if (cancelled || !info) return;
        if (typeof info.running === 'boolean') setServerOnline(info.running);
        const running = info.running === true;
        const starting = info.starting === true;
        if (starting) {
          setServerBusyKind('starting');
          setServerBusy(true);
          timer = setTimeout(tick, 600);
        } else if (!info.running) {
          // Server isn't starting yet (e.g. checkInstallStatus still
          // resolving) — keep polling so we catch it when it comes up.
          setServerBusy(false);
          timer = setTimeout(tick, 1000);
        } else {
          setServerBusy(false);
        }
        // Keep polling until we see `running=true`, OR until the
        // ceiling elapses. Polling while `running=false` covers the
        // window where main is still resolving `checkInstallStatus`
        // before kicking off `startServer`.
        if (!running && Date.now() - startedAt < POLL_CEILING_MS) {
          timer = setTimeout(tick, 600);
        }
      } catch {
        // Polling errors (IPC blip, restart) shouldn't kill the
        // loop — keep trying within the ceiling so a transient
        // hiccup doesn't strand the renderer in offline state.
        if (Date.now() - startedAt < POLL_CEILING_MS) {
          timer = setTimeout(tick, 600);
        }
      }
    };

    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
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
      const modelId = latest.defaultModel || latest.planningModel;
      const m = MOCK_DATA.models.find((x) => x.id === modelId);
      setSelectedModel(m || { id: modelId, name: modelId || 'Anton model', desc: 'Configured Anton planning model' });
    }
    return result;
  }, [settings]);

  const activeTasks = tasks.filter((t) => t.status === 'active');
  const currentTask = tasks.find((t) => t.id === activeTaskId) || (route === 'task' ? tasks[0] : null);
  // Tasks belong to one project for life. Resolve via projectName
  // first (server's canonical id), then projectPath, then fall back
  // to the currently-selected project for orphans.
  const currentTaskProject = (() => {
    if (!currentTask) return selectedProject;
    if (currentTask.projectName) {
      const byName = projects.find((p) => p.name === currentTask.projectName);
      if (byName) return byName;
    }
    if (currentTask.projectPath) {
      const byPath = projects.find((p) => p.path === currentTask.projectPath);
      if (byPath) return byPath;
      return {
        id: currentTask.projectPath,
        name: currentTask.projectName || currentTask.projectPath.split('/').pop(),
        path: currentTask.projectPath,
      };
    }
    return selectedProject;
  })();
  const currentTaskModel = currentTask?.model
    ? (models.find((m) => m.id === currentTask.model) || { id: currentTask.model, name: currentTask.model, desc: 'Configured Anton model' })
    : selectedModel;

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

    let assistantContent = '';
    let streamState = initialStreamState();

    const flushStreaming = () => {
      setTasks((prev) => prev.map((t) => {
        if (t.id !== taskId) return t;
        const msgs = removeThinkingPlaceholder(stripStreaming(t.messages));
        return { ...t, status: 'active', messages: [...msgs, {
          role: '_streaming',
          content: streamState.bodyText || assistantContent,
          steps: streamState.steps,
          startedAt: streamState.startedAt,
          streamStatus: streamState.status,
        }] };
      }));
    };

    activeStreamingTaskIdRef.current = taskId;
    activeStreamCtrlRef.current = tailInFlight(taskId, {
      fromSeq: 0, // Replay from the start — the reducer is idempotent
                  // over text deltas, and from_seq=0 keeps the rebuild
                  // simple. A per-task last-seen-seq optimisation is
                  // possible later if we see network overhead.
      onEvent(ev) {
        streamState = reduceStream(streamState, ev);
        const open = streamState.steps.find((s) => s.status === 'in_progress' && s._isScratchpad);
        if (open?._scratchpadTabId) activeScratchpadRef.current = open._scratchpadTabId;
        flushSync(() => flushStreaming());
      },
      onChunk(chunk) { assistantContent += chunk; },
      onDone() {
        activeStreamCtrlRef.current = null;
        activeScratchpadRef.current = null;
        activeStreamingTaskIdRef.current = null;
        markInFlightDone(taskId);
        const finalContent = streamState.bodyText || assistantContent;
        const finalSteps = streamState.steps;
        const finalStartedAt = streamState.startedAt;
        let assistantTurnIndex = 0;
        setTasks((prev) => prev.map((t) => {
          if (t.id !== taskId) return t;
          const msgs = markActivityDone(removeThinkingPlaceholder(stripStreaming(t.messages)));
          assistantTurnIndex = msgs.filter((m) => m.role === 'assistant').length;
          return finalContent
            ? { ...t, status: 'idle', messages: [...msgs, {
                role: 'assistant',
                content: finalContent,
                steps: finalSteps,
                startedAt: finalStartedAt,
              }] }
            : { ...t, status: 'idle', messages: msgs };
        }));
        if (finalContent) {
          persistTurnState(taskId, assistantTurnIndex, finalSteps, finalStartedAt);
        }
        fetchArtifacts().then((data) => { if (Array.isArray(data)) setArtifacts(data); });
      },
      onError(message, event) {
        activeStreamCtrlRef.current = null;
        activeScratchpadRef.current = null;
        activeStreamingTaskIdRef.current = null;
        markInFlightDone(taskId);
        setTasks((prev) => prev.map((t) => {
          if (t.id !== taskId) return t;
          const msgs = markActivityDone(removeThinkingPlaceholder(stripStreaming(t.messages)));
          return { ...t, status: 'error', messages: [...msgs, { role: 'error', content: message || 'Anton could not complete this task.', code: event?.code }] };
        }));
      },
    });
    return true;
  }, [markInFlight, markInFlightDone]);

  const selectTask = (id) => {
    if (isNarrow) setMobileSidebarOpen(false);
    const task = tasks.find((t) => t.id === id);
    if (task) {
      // Record the visit for recents ordering, but never auto-pin.
      // Pin/unpin is now an explicit action via the task menu.
      recordTaskVisit(task, false).then(() => {
        fetchPins().then((data) => setPins(data.pins || []));
        fetchSessions().then((data) => {
      if (Array.isArray(data)) setTasks((prev) => mergeTasksFromServer(data, prev).filter((t) => !deletedTaskIdsRef.current.has(t.id)));
    });
      }).catch(() => {});

      // Is this conversation actually mid-stream right now? If yes,
      // we LEAVE running indicators alone. If no, the reconcile pass
      // will collapse zombie steps and may inject a "want to
      // continue?" prompt for the user.
      const isLive = (
        !!activeStreamCtrlRef.current
        && activeStreamingTaskIdRef.current === id
      );

      // Cross-client cache (Option B): when the server says this
      // conversation's producer is still running, skip the "things
      // stopped" continuation prompt. The reconnect path below will
      // attach to the live tail within ~50ms; showing the stopped
      // message in between would flicker.
      const isServerInFlight = inFlightSetRef.current.has(id);

      // If this task didn't get its messages preloaded (we only fan
      // out to the recent N at startup), fetch them now so the chat
      // view doesn't render empty.
      if (!task.messages || task.messages.length === 0) {
        fetchSession(id).then((fresh) => {
          if (!fresh || !Array.isArray(fresh.messages) || fresh.messages.length === 0) return;
          // Two layers of restoration, in order of trust:
          //   1. Server sidecar (`{cid}_turns.json`) — events for each
          //      assistant turn, replayed through the same reducer the
          //      live stream uses. Survives any client reset and
          //      anyone reading the conversation gets the same view.
          //   2. localStorage sidecar — legacy fallback for turns
          //      created before the server sidecar shipped.
          const fromServer = hydrateMessagesFromServerEvents(fresh.messages);
          const enriched = mergeConvTurns(id, fromServer);
          const reconciled = reconcileTaskMessages(enriched, isLive, isServerInFlight);
          const dc = Array.isArray(fresh.disabledConnections) ? fresh.disabledConnections : undefined;
          setTasks((prev) => prev.map((t) =>
            t.id === id ? {
              ...t,
              messages: reconciled,
              ...(dc !== undefined ? { disabledConnections: dc } : {}),
            } : t
          ));
        }).catch(() => {});
      } else {
        // Already preloaded — still hydrate once so reopening surfaces
        // any data persisted in a prior session.
        setTasks((prev) => prev.map((t) => {
          if (t.id !== id) return t;
          const fromServer = hydrateMessagesFromServerEvents(t.messages);
          const enriched = mergeConvTurns(id, fromServer);
          return { ...t, messages: reconcileTaskMessages(enriched, isLive, isServerInFlight) };
        }));
      }
    }
    setComposerAttachments([]);
    setActiveTaskId(id);
    setRoute('task');
    // Phase 2 reconnect — fire-and-forget. If a turn is still running
    // server-side for this conversation (closed-tab-came-back, or
    // opened from another tab/device), this re-attaches the live SSE
    // stream and replays from seq 0. Cheap no-op when the producer
    // isn't running.
    reconnectInFlight(id).catch(() => { /* probe failures are silent */ });
  };

  const newTask = () => {
    if (isNarrow) setMobileSidebarOpen(false);
    setActiveTaskId(null);
    setComposerAttachments([]);
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
  const handleConnectorPicked = async (connector) => {
    setConnectorPickerOpen(false);
    if (!connector?.id) return;

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
      // No registry entry — fall back to the chat-agent flow.
      Promise.resolve().then(() => handleSendFromHome(`Connect ${label}`));
    }
  };
  // Keep the ref synced so the Cmd/Ctrl+N keydown handler always calls
  // the latest newTask closure (which captures fresh setRoute/setTasks).
  useEffect(() => { newTaskRef.current = newTask; });

  const clearActive = useCallback(() => {
    setTasks((prev) => prev.map((t) => t.status === 'active' ? { ...t, status: 'idle' } : t));
  }, []);

  const navigate = (key) => {
    if (isNarrow) setMobileSidebarOpen(false);
    if (key === 'artifacts') {
      fetchArtifacts().then((data) => { if (Array.isArray(data)) setArtifacts(data); });
    }
    if (key === 'projects') {
      fetchProjects().then((data) => { if (Array.isArray(data)) setProjects(data); });
      // Clicking "Projects" in the sidebar should always land on the
      // grid of all projects, not the previously-selected project's
      // detail. Clear the selection so ProjectsView starts in grid
      // mode. The chat-header crumb routes through onOpenProject
      // (which sets selectedProject AFTER routing) so it's unaffected.
      setSelectedProject(null);
    }
    if (key === 'scheduled') {
      fetchSchedules().then((data) => {
      setScheduled(data.schedules || []);
      setScheduleRunsIndex(data.runs_index || {});
    });
    }
    setRoute(key);
  };

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
    if (target?.pendingFile) return;
    try {
      await deleteAttachment(id);
    } catch {
      // The UI has already removed the pending attachment; stale server cleanup is harmless here.
    }
  };

  // Send from the home screen — creates a new session
  const handleSendFromHome = async (text) => {
    // Orphan fallback: if the user hasn't picked a project, route the
    // task into "general" (server provisions it on startup). If for
    // any reason it isn't in the projects list yet (e.g. an upgrade
    // from a build that didn't auto-create it), bootstrap it now.
    let generalProject = projects.find((p) => p.name === 'general');
    if (!selectedProject && !generalProject) {
      try {
        await createProject('general');
        const fresh = await fetchProjects();
        if (Array.isArray(fresh)) setProjects(fresh);
        generalProject = (fresh || []).find((p) => p.name === 'general');
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[handleSendFromHome] could not bootstrap general project', e);
      }
    }
    const effectiveProjectName = selectedProject?.name || 'general';
    const effectiveProjectPath = selectedProject?.path || generalProject?.path || null;

    const disabledForSend = normalizeComposerDisabledConnections(composerDisabledConnections);

    const rawComposer = composerAttachments;
    const hasPendingFiles = rawComposer.some(isPendingFileAttachment);
    const taskId = hasPendingFiles ? allocateConversationId() : `tmp-${Date.now()}`;

    const { merged: sendingAttachments, attachmentIds } = await resolveComposerAttachmentsForSend(
      effectiveProjectName,
      hasPendingFiles ? taskId : null,
      rawComposer,
    );
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
      model: selectedModel?.id ?? null,
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

    let assistantContent = '';
    let resolvedId = taskId;
    // Adapter state — folded by every raw SSE event so the streaming
    // message can carry structured ThinkingStep[] for the UI.
    let streamState = initialStreamState();

    const flushStreamingMessage = () => {
      setTasks((prev) => prev.map((t) => {
        if (t.id !== resolvedId && t.id !== taskId) return t;
        const msgs = removeThinkingPlaceholder(stripStreaming(t.messages));
        return { ...t, messages: [...msgs, {
          role: '_streaming',
          content: streamState.bodyText || assistantContent,
          steps: streamState.steps,
          startedAt: streamState.startedAt,
          streamStatus: streamState.status,
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
              messages: withThinkingPlaceholder([
                { role: 'user', content: text, attachments: sendingAttachments },
              ]),
            }
          : t,
      ));
      activeStreamCtrlRef.current = streamNewSessionFn();
      // Tag which task is mid-flight so reconcileTaskMessages can
      // tell legitimate running indicators from zombies on reload.
      activeStreamingTaskIdRef.current = taskId;
    };
    const streamNewSessionFn = () => streamNewSession(text, {
      conversationId: hasPendingFiles ? taskId : undefined,
      projectName: effectiveProjectName,
      projectPath: effectiveProjectPath,
      model: selectedModel?.id,
      attachmentIds,
      disabledConnections: disabledForSend,
      onEvent(ev) {
        streamState = reduceStream(streamState, ev);
        // Track latest in-progress scratchpad so the Stop button
        // can cancel anton's current cell, not just abort our stream.
        const open = streamState.steps.find((s) => s.status === 'in_progress' && s._isScratchpad);
        if (open?._scratchpadTabId) activeScratchpadRef.current = open._scratchpadTabId;
        flushSync(() => flushStreamingMessage());
      },
      onChunk(chunk, sid) {
        if (sid && sid !== resolvedId) {
          const previousId = resolvedId;
          resolvedId = sid;
          setTasks((prev) => prev.map((t) =>
            t.id === previousId || t.id === taskId
              ? { ...t, id: sid }
              : t,
          ));
          setActiveTaskId(sid);
        }
        assistantContent += chunk;
        // The adapter already accumulates bodyText; the chunk callback
        // remains the source of truth for resolving conversation id.
      },
      onProgress(event, sid) {
        // Track the resolved conversation id (in case onChunk hasn't
        // run yet for this stream — onChunk does the same dance).
        if (sid && sid !== resolvedId) {
          const previousId = resolvedId;
          resolvedId = sid;
          setTasks((prev) => prev.map((t) => t.id === previousId || t.id === taskId ? { ...t, id: sid } : t));
          setActiveTaskId(sid);
        }
        // Intentionally a no-op for messages: every `response.in_progress`
        // event already passed through onEvent → flushStreamingMessage,
        // which is the source of truth for the streaming row + steps.
        // The previous implementation appended an `activity` row here
        // and stripped the `_streaming` row in the process — but the
        // chat scroll filters activity rows out (they're never visible)
        // while losing the streaming row blanked the AnswerTurn until
        // the body deltas started.
      },
      onToolResult(event, sid) {
        if (sid && sid !== resolvedId) {
          const previousId = resolvedId;
          resolvedId = sid;
          setTasks((prev) => prev.map((t) => t.id === previousId || t.id === taskId ? { ...t, id: sid } : t));
          setActiveTaskId(sid);
        }
        // See onProgress comment — same reasoning. The adapter (via
        // onEvent) captures scratchpad results into the steps array.
      },
      onDone(sid) {
        activeStreamCtrlRef.current = null;
        activeScratchpadRef.current = null;
        activeStreamingTaskIdRef.current = null;
        const finalId = sid || resolvedId;
        const finalContent = streamState.bodyText || assistantContent;
        const finalSteps = streamState.steps;
        const finalStartedAt = streamState.startedAt;
        let assistantTurnIndex = 0;
        setTasks((prev) => prev.map((t) => {
          if (t.id !== finalId && t.id !== resolvedId && t.id !== taskId) return t;
          const msgs = markActivityDone(removeThinkingPlaceholder(stripStreaming(t.messages)));
          // Count prior assistant turns BEFORE adding the new one so
          // the persisted index lines up with what mergeConvTurns
          // expects on reload (the merge walks assistant messages in
          // the same order and looks up by index).
          assistantTurnIndex = msgs.filter((m) => m.role === 'assistant').length;
          return finalContent
            ? { ...t, id: finalId, status: 'idle', messages: [...msgs, {
                role: 'assistant',
                content: finalContent,
                steps: finalSteps,
                startedAt: finalStartedAt,
              }] }
            : { ...t, id: finalId, status: 'idle', messages: msgs };
        }));
        setActiveTaskId(finalId);
        // Persist all step data (scratchpad cells, artifacts, timing)
        // so reopening the conversation restores the Thinking block,
        // inline artifact cards, and scratchpad tabs. Anton's own
        // history file doesn't carry step metadata, so this is a
        // sidecar in localStorage.
        if (finalContent) {
          persistTurnState(finalId, assistantTurnIndex, finalSteps, finalStartedAt);
        }
        fetchArtifacts().then((data) => { if (Array.isArray(data)) setArtifacts(data); });
      },
      onError(message, event) {
        activeStreamCtrlRef.current = null;
        activeScratchpadRef.current = null;
        activeStreamingTaskIdRef.current = null;
        setTasks((prev) => prev.map((t) => {
          if (t.id !== resolvedId && t.id !== taskId) return t;
          const msgs = markActivityDone(removeThinkingPlaceholder(stripStreaming(t.messages)));
          return { ...t, status: 'error', messages: [...msgs, { role: 'error', content: message || 'Anton could not complete this task.', code: event?.code }] };
        }));
        fetchHealth().then((h) => setHealth(h));
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
  const handleSendInTask = async (text) => {
    if (!currentTask) return;
    const id = currentTask.id;

    // Anton-core can't run two turns in parallel against the same
    // conversation, so if a stream is in flight (or one is about to
    // start) for this task we queue the new message and let
    // onDone/onError drain it.
    //
    // The check covers two race conditions:
    //   1) `activeStreamCtrlRef` is already set — a fully launched
    //      stream is in flight.
    //   2) `activeStreamingTaskIdRef` matches but the controller
    //      hasn't been assigned yet — a previous invocation is mid-
    //      await (resolving attachments). Without this leg, two
    //      rapid clicks both pass the guard and we'd end up with
    //      two parallel streams, the first one's controller leaked.
    if (activeStreamingTaskIdRef.current === id || activeStreamCtrlRef.current) {
      enqueueMessage(id, text);
      return;
    }
    // Synchronous reservation so a second invocation that fires
    // before our awaits resolve sees us as "in flight."
    activeStreamingTaskIdRef.current = id;
    // Cross-client cache: we know this conversation is about to be
    // mid-stream. Marking immediately (rather than waiting for the
    // /in-flight-list poll to discover it) means reconcileTaskMessages
    // never has to lie when another tab opens this conversation.
    markInFlight(id);

    const disabledForSend = normalizeComposerDisabledConnections(composerDisabledConnections);

    const taskProjectName = currentTask.projectName
      || (currentTaskProject?.name)
      || null;
    const taskProjectPath = currentTask.projectPath
      || currentTaskProject?.path
      || null;
    const taskModel = currentTask.model || selectedModel?.id || null;

    let sendingAttachments, attachmentIds;
    try {
      ({ merged: sendingAttachments, attachmentIds } = await resolveComposerAttachmentsForSend(
        taskProjectName,
        id,
        composerAttachments,
      ));
    } catch (err) {
      // Attachment resolution failed before we ever started the
      // stream — release the reservation so the user's next send
      // doesn't get stuck in the queue forever.
      activeStreamingTaskIdRef.current = null;
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
    setComposerAttachments([]);

    let assistantContent = '';
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
      setTasks((prev) => prev.map((t) =>
        t.id === previousId || t.id === id ? { ...t, id: sid } : t,
      ));
      // Move the in-flight + active refs onto the new id so cancel /
      // reconcile passes look at the right key.
      if (activeStreamingTaskIdRef.current === previousId) {
        activeStreamingTaskIdRef.current = sid;
      }
      markInFlightDone(previousId);
      markInFlight(sid);
      setActiveTaskId((curr) => (curr === previousId ? sid : curr));
    };

    const flushStreaming = () => {
      setTasks((prev) => prev.map((t) => {
        if (t.id !== id && t.id !== resolvedId) return t;
        const msgs = removeThinkingPlaceholder(stripStreaming(t.messages));
        return { ...t, messages: [...msgs, {
          role: '_streaming',
          content: streamState.bodyText || assistantContent,
          steps: streamState.steps,
          startedAt: streamState.startedAt,
          streamStatus: streamState.status,
        }] };
      }));
    };

    // If a connect form is active for this conversation, append a
     // redacted snapshot of its state to the *sent* text so the agent
     // sees what the user has selected / filled. The on-screen bubble
     // keeps the original text — Anton-only context, never shown.
    const connectFormState = getDataVaultFormState(id);
    const connectContext = describeConnectFormState(connectFormState);
    const sendText = connectContext ? `${text}\n\n${connectContext}` : text;

    // Tag this task as currently streaming so reconcileTaskMessages
    // can distinguish a real in-flight turn from a zombie placeholder.
    activeStreamingTaskIdRef.current = id;
    activeStreamCtrlRef.current = streamMessage(id, sendText, {
      projectName: taskProjectName,
      projectPath: taskProjectPath,
      model: taskModel,
      attachmentIds,
      disabledConnections: disabledForSend,
      onEvent(ev) {
        // Adopt the server's canonical id as soon as it lands. The
        // server's `chat_stream` strips `tmp-` prefixes and mints a
        // fresh id; the new value rides on `response.created`.
        const sid = ev?.conversation_id || ev?.response?.conversation_id;
        if (sid) adoptServerId(sid);
        streamState = reduceStream(streamState, ev);
        const open = streamState.steps.find((s) => s.status === 'in_progress' && s._isScratchpad);
        if (open?._scratchpadTabId) activeScratchpadRef.current = open._scratchpadTabId;
        flushSync(() => flushStreaming());
      },
      onChunk(chunk, sid) {
        if (sid) adoptServerId(sid);
        // The adapter accumulates bodyText already; this callback is
        // redundant for content but cheap and useful as a fallback if
        // the adapter ever fails to parse a delta.
        assistantContent += chunk;
      },
      onDone() {
        activeStreamCtrlRef.current = null;
        activeScratchpadRef.current = null;
        activeStreamingTaskIdRef.current = null;
        markInFlightDone(resolvedId);
        if (resolvedId !== id) markInFlightDone(id);
        const finalContent = streamState.bodyText || assistantContent;
        const finalSteps = streamState.steps;
        const finalStartedAt = streamState.startedAt;
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
              }] }
            : { ...t, status: 'idle', messages: msgs };
        }));
        if (finalContent) {
          // Sidecar — see persistTurnState comment for the full schema.
          persistTurnState(resolvedId, assistantTurnIndex, finalSteps, finalStartedAt);
        }
        fetchArtifacts().then((data) => { if (Array.isArray(data)) setArtifacts(data); });
        // Drain the next queued message for this task (if any) so a
        // user who fired multiple prompts mid-stream gets each one
        // sent in order. Keyed off the original local id since that's
        // what enqueueMessage used while the adoption was pending.
        const next = popQueueHead(id);
        if (next) {
          Promise.resolve().then(() => handleSendInTask(next.text));
        }
      },
      onError(message, event) {
        activeStreamCtrlRef.current = null;
        activeScratchpadRef.current = null;
        activeStreamingTaskIdRef.current = null;
        markInFlightDone(resolvedId);
        if (resolvedId !== id) markInFlightDone(id);
        setTasks((prev) => prev.map((t) => {
          if (t.id !== id && t.id !== resolvedId) return t;
          const msgs = markActivityDone(removeThinkingPlaceholder(stripStreaming(t.messages)));
          return { ...t, status: 'error', messages: [...msgs, { role: 'error', content: message || 'Anton could not complete this task.', code: event?.code }] };
        }));
        fetchHealth().then((h) => setHealth(h));
        // Same drain on error so a failed turn doesn't strand the
        // queue. The next item gets its own shot at the LLM.
        const next = popQueueHead(id);
        if (next) {
          Promise.resolve().then(() => handleSendInTask(next.text));
        }
      },
    });
  };

  // Submit a data-vault form. Drives a fresh assistant turn from the
  // cowork agent endpoint instead of the LLM — same SSE stream shape,
  // same React state machine. The user sees a normal Anton bubble
  // appear after they submit; under the hood the LLM never read the
  // values. Mirrors handleSendInTask but wired to streamDataVaultSubmission.
  const handleSubmitDataVaultForm = ({ formId, formSpec, values, skipped }) => {
    if (!currentTask) return;
    const id = currentTask.id;

    setTasks((prev) => prev.map((t) =>
      t.id === id
        ? { ...t, status: 'active' }
        : t,
    ));

    let assistantContent = '';
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
      setTasks((prev) => prev.map((t) =>
        t.id === previousId || t.id === id ? { ...t, id: sid } : t,
      ));
      if (activeStreamingTaskIdRef.current === previousId) {
        activeStreamingTaskIdRef.current = sid;
      }
      setActiveTaskId((curr) => (curr === previousId ? sid : curr));
    };

    const flushStreaming = () => {
      setTasks((prev) => prev.map((t) => {
        if (t.id !== id && t.id !== resolvedId) return t;
        const msgs = removeThinkingPlaceholder(stripStreaming(t.messages));
        return { ...t, messages: [...msgs, {
          role: '_streaming',
          content: streamState.bodyText || assistantContent,
          steps: streamState.steps,
          startedAt: streamState.startedAt,
          streamStatus: streamState.status,
        }] };
      }));
    };

    activeStreamingTaskIdRef.current = id;
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
      onEvent(ev) {
        const sid = ev?.conversation_id || ev?.response?.conversation_id;
        if (sid) adoptServerId(sid);
        streamState = reduceStream(streamState, ev);
        flushSync(() => flushStreaming());
      },
      onChunk(chunk, sid) {
        if (sid) adoptServerId(sid);
        assistantContent += chunk;
      },
      onDone(sid) {
        if (sid) adoptServerId(sid);
        activeStreamCtrlRef.current = null;
        activeStreamingTaskIdRef.current = null;
        const finalContent = streamState.bodyText || assistantContent;
        const finalSteps = streamState.steps;
        const finalStartedAt = streamState.startedAt;
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
              }] }
            : { ...t, status: 'idle', messages: msgs };
        }));
        if (finalContent) {
          persistTurnState(resolvedId, assistantTurnIndex, finalSteps, finalStartedAt);
        }
        // A successful save changes the connectors list — refetch
        // so the Connect Apps and Data page reflects it immediately.
        fetchDatasources()
          .then((data) => setConnectors(Array.isArray(data?.connections) ? data.connections : []))
          .catch(() => {});
      },
      onError(message) {
        activeStreamCtrlRef.current = null;
        activeStreamingTaskIdRef.current = null;
        setTasks((prev) => prev.map((t) => {
          if (t.id !== id && t.id !== resolvedId) return t;
          const msgs = markActivityDone(removeThinkingPlaceholder(stripStreaming(t.messages)));
          return { ...t, status: 'error', messages: [...msgs, {
            role: 'error',
            content: message || 'Form submission failed.',
          }] };
        }));
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
    deletedTaskIdsRef.current.add(taskId);
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    // Optimistically remove from pins so the sidebar clears immediately.
    setPins((prev) => prev.filter((p) => p.id !== taskId));
    if (activeTaskId === taskId) {
      setActiveTaskId(null);
      setRoute('home');
    }
    // Skip the server call for tasks that never got persisted (still
    // wearing a tmp- id from before the first stream chunk arrived).
    if (typeof taskId === 'string' && taskId.startsWith('tmp-')) {
      // eslint-disable-next-line no-console
      console.log('[performDeleteTask] tempId — local-only delete');
      return;
    }
    try {
      await Promise.all([
        deleteConversation(taskId),
        unpinTask(taskId).catch(() => {}), // unpin is a no-op if not pinned
      ]);
      // eslint-disable-next-line no-console
      console.log('[performDeleteTask] server delete ok');
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[performDeleteTask] server delete failed', e);
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
    // silent flag keeps the abort from injecting a "Task stopped"
    // placeholder which would only flash before being pruned.
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
          t.id === taskId ? { ...t, messages: fresh.messages } : t,
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
    // Optimistic — drop locally before the round-trip.
    setProjects((prev) => prev.filter((p) => p.name !== project.name));
    setTasks((prev) => prev.filter((t) =>
      t.projectName !== project.name && t.projectPath !== project.path
    ));
    if (selectedProject?.name === project.name) setSelectedProject(null);
    try { await deleteProject(project.name); } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[performDeleteProject] failed', e);
    }
    // Refresh from server to recover the canonical state.
    fetchProjects().then((data) => { if (Array.isArray(data)) setProjects(data); }).catch(() => {});
    fetchSessions().then((data) => {
      if (Array.isArray(data)) setTasks((prev) => mergeTasksFromServer(data, prev).filter((t) => !deletedTaskIdsRef.current.has(t.id)));
    }).catch(() => {});
  };

  const handleMoveTaskToProject = async (taskId, projectName) => {
    // eslint-disable-next-line no-console
    console.log('[handleMoveTaskToProject]', taskId, '→', projectName);
    if (!projectName) return;
    setTasks((prev) => prev.map((t) =>
      t.id === taskId
        ? { ...t, projectName, projectPath: projects.find((p) => p.name === projectName)?.path || t.projectPath }
        : t
    ));
    try {
      await moveConversation(taskId, projectName);
      // eslint-disable-next-line no-console
      console.log('[handleMoveTaskToProject] server move ok');
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[handleMoveTaskToProject] server move failed', e);
    }
    // Refresh sessions so the server's canonical project mapping wins
    // if our optimistic guess was wrong.
    const fresh = await fetchSessions();
    if (Array.isArray(fresh)) setTasks(fresh.filter((t) => !deletedTaskIdsRef.current.has(t.id)));
  };

  const refreshSchedules = async () => {
    const data = await fetchSchedules();
    setScheduled(data.schedules || []);
    setScheduleRunsIndex(data.runs_index || {});
  };

  const handleCreateSchedule = async (payload) => {
    await createSchedule(payload);
    await refreshSchedules();
  };

  const handleUpdateSchedule = async (id, payload) => {
    await updateSchedule(id, payload);
    await refreshSchedules();
  };

  const handleDeleteSchedule = async (id) => {
    await deleteSchedule(id);
    await refreshSchedules();
  };

  const handlePauseSchedule = async (id) => {
    await pauseSchedule(id);
    await refreshSchedules();
  };

  const handleResumeSchedule = async (id) => {
    await resumeSchedule(id);
    await refreshSchedules();
  };

  const handleRunScheduleNow = async (id) => {
    await runScheduleNow(id);
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
  const modelOptions = selectedModel && !models.some((m) => m.id === selectedModel.id)
    ? [selectedModel, ...models]
    : models;

  return (
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
      {/* Mobile backdrop — dims content behind the open drawer. Suppressed
          on isMobile widths where MobileShell renders its own scrim. */}
      {isNarrow && !isMobile && (
        <div
          onClick={() => setMobileSidebarOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 100,
            background: 'rgba(0,0,0,0.35)',
            backdropFilter: 'blur(2px)',
            WebkitAppRegion: 'no-drag',
            opacity: mobileSidebarOpen ? 1 : 0,
            pointerEvents: mobileSidebarOpen ? 'auto' : 'none',
            transition: 'opacity 280ms cubic-bezier(0.32, 0.72, 0, 1)',
          }}
        />
      )}

      {/*
        Floating hamburger — on desktop: visible when sidebar is collapsed
        (chat route only). On narrow desktop: opens the slide-over sidebar.
        Suppressed entirely on isMobile — MobileShell has its own hamburger.
      */}
      {!isMobile && (
      <button
        onClick={() => isNarrow ? setMobileSidebarOpen(true) : setSidebarCollapsed(false)}
        title="Open sidebar"
        className="icon-btn"
        style={{
          position: 'absolute',
          // On Electron, left: 97 clears the macOS traffic lights (which end ~x:80).
          // On web there are no traffic lights so left: 18 sits flush with the app edge.
          top: 18, left: host.isWeb ? 18 : 97,
          zIndex: 10,
          WebkitAppRegion: 'no-drag',
          opacity: isNarrow
            ? (mobileSidebarOpen ? 0 : 1)
            : (sidebarCollapsedEffective ? 1 : 0),
          transform: (isNarrow ? !mobileSidebarOpen : sidebarCollapsedEffective)
            ? 'translateX(0)' : 'translateX(-8px)',
          pointerEvents: (isNarrow ? !mobileSidebarOpen : sidebarCollapsedEffective)
            ? 'auto' : 'none',
          transition:
            'opacity 280ms cubic-bezier(0.32, 0.72, 0, 1) 120ms, ' +
            'transform 360ms cubic-bezier(0.32, 0.72, 0, 1) 80ms',
        }}
      >
        {Ico.sidebarExpandRight(15)}
      </button>
      )}

      {/*
        Sidebar — on narrow desktop it's a fixed overlay drawer; on desktop
        it's a normal flex item. `display: contents` makes the wrapper
        transparent to the flex layout so Sidebar participates as a direct
        flex child. Suppressed entirely on isMobile — MobileShell replaces
        the desktop sidebar with a mobile-native drawer.
      */}
      {!isMobile && (
      <div
        className={isNarrow ? 'sidebar-overlay-wrap' : undefined}
        style={isNarrow ? {
          position: 'fixed',
          top: 9, bottom: 9, left: 9,
          zIndex: 101,
          transform: mobileSidebarOpen ? 'translateX(0)' : 'translateX(calc(-100% - 18px))',
          transition: 'transform 380ms cubic-bezier(0.22, 1, 0.36, 1)',
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
          activeTaskId={activeTaskId}
          serverOnline={serverOnline}
          onNavigate={navigate}
          onSelectTask={selectTask}
          onNewTask={newTask}
          onOpenSearch={() => setSearchOpen(true)}
          collapsed={sidebarCollapsedEffective}
          onToggleCollapsed={
            isNarrow
              ? () => setMobileSidebarOpen(false)
              : (sidebarCollapsibleRoutes.has(route)
                  ? () => setSidebarCollapsed((c) => !c)
                  : undefined)
          }
          onPinTask={handlePinTask}
          onUnpinTask={handleUnpinTask}
          onRenameTask={handleRenameTask}
          onDeleteTask={handleDeleteTask}
          onMoveTaskToProject={handleMoveTaskToProject}
          projects={projects}
          schedules={scheduled}
          scheduleRunsIndex={scheduleRunsIndex}
          onOpenSchedule={(scheduleId) => {
            if (isNarrow) setMobileSidebarOpen(false);
            setSelectedScheduleId(scheduleId);
            setRoute('schedule-detail');
          }}
          serverBusy={serverBusy}
          serverBusyKind={serverBusyKind}
          showCounters={settings.showCounters !== false}
          updateAvailable={updateStatus?.phase === 'available' ? { version: updateStatus.version } : null}
          onApplyUpdate={handleApplyUpdate}
          onShowServerHelp={() => setServerHelpOpen(true)}
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

      {(() => {
      const mainEl = (
      <main style={{
        flex: 1, minWidth: 0, minHeight: 0,
        display: 'flex', flexDirection: 'column',
        background: mainBg,
      }}>
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
            projects={projects}
            models={modelOptions}
            attachments={composerAttachments}
            connectors={connectors}
            onAttachFiles={handleAttachFiles}
            onRemoveAttachment={handleRemoveAttachment}
            disabledConnections={composerDisabledConnections}
            onUpdateConnectorMute={handleComposerConnectorMute}
            onCreateProject={(args) => handleCreateProject({ ...args, _inline: true })}
            configReady={health.config_ready ?? settings.configReady}
            configError={health.config_error ?? settings.configError}
            onOpenSettings={() => setRoute('settings')}
            serverOnline={serverOnline}
            onShowServerHelp={() => setServerHelpOpen(true)}
            skipIntro={bootIntroDone}
          />
        )}

        {route === 'task' && currentTask && (
          <ChatView
            task={currentTask}
            onSend={handleSendInTask}
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
            attachments={composerAttachments}
            connectors={connectors}
            onAttachFiles={handleAttachFiles}
            disabledConnections={composerDisabledConnections}
            onRemoveAttachment={handleRemoveAttachment}
            onUpdateConnectorMute={handleComposerConnectorMute}
            onPinTask={handlePinTask}
            onUnpinTask={handleUnpinTask}
            onRenameTask={handleRenameTask}
            onDeleteTask={handleDeleteTask}
            onDeleteTurn={(turnIdx) => handleDeleteTurnRequest(currentTask?.id, turnIdx)}
            onMoveTaskToProject={handleMoveTaskToProject}
            onStop={handleStopStream}
            onSubmitDataVaultForm={handleSubmitDataVaultForm}
            onNavigateToConnectors={() => navigate('customize')}
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
            sidebarCollapsed={isNarrow || sidebarCollapsedEffective}
          />
        )}

        {route === 'projects' && (
          <ProjectsView
            projects={projects}
            selectedProject={selectedProject}
            tasks={tasks}
            scheduled={scheduled}
            scheduleRunsIndex={scheduleRunsIndex}
            models={modelOptions}
            onSelectProject={(p) => setSelectedProject(p)}
            onCreateProject={handleCreateProject}
            onSendInProject={(text) => {
              // Sending from project detail = same path as home, but
              // selectedProject is already pinned to this project so
              // the new task lands in the right workspace.
              handleSendFromHome(text);
            }}
            onSelectTask={selectTask}
            onDeleteTask={handleDeleteTask}
            onDeleteProject={handleDeleteProject}
            attachments={composerAttachments}
            connectors={connectors}
            onAttachFiles={handleAttachFiles}
            onRemoveAttachment={handleRemoveAttachment}
            disabledConnections={composerDisabledConnections}
            onUpdateConnectorMute={handleComposerConnectorMute}
            onOpenSchedule={(task) => {
              // Same handler ScheduledView uses — routes to the
              // schedule detail page for the clicked row.
              setSelectedScheduleId(task.id);
              setRoute('schedule-detail');
            }}
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
          />
        )}

        {route === 'schedule-detail' && (
          <ScheduleDetailView
            task={scheduled.find((s) => s.id === selectedScheduleId) || null}
            projects={projects}
            models={modelOptions}
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
          />
        )}

        {route === 'dispatch' && (
          <DispatchView onSetUpLater={() => setRoute('home')} />
        )}

        {route === 'customize' && (
          <CustomizeView
            connectors={connectors}
            onConnectionsSynced={(next) =>
              setConnectors(Array.isArray(next) ? next : [])}
            onOpenSettings={() => setRoute('settings')}
            onConnectNew={handleStartConnectChat}
            onReconnect={(spec) => handleConnectorPicked(spec)}
          />
        )}

        {route === 'settings' && (
          <SettingsView settings={settings} setSetting={setSetting} onSave={saveSettings} theme={theme} onThemeChange={setTheme} />
        )}

        {/* Legacy 'connect' kind removed — Connect Apps and Data is now
            the canonical surface for connector management (route
            'customize'). UtilitiesView only carries memory / skills /
            publish now. */}
        {['memory', 'skills', 'publish'].includes(route) && (
          <UtilitiesView
            kind={route}
            project={selectedProject}
            onRefreshArtifacts={() => fetchArtifacts().then((data) => { if (Array.isArray(data)) setArtifacts(data); })}
          />
        )}
      </main>
      );
      return isMobile ? (
        <MobileShell
          route={route}
          currentTask={currentTask}
          selectedProject={selectedProject}
          tasks={tasks}
          projects={projects}
          scheduled={scheduled}
          artifacts={artifacts}
          onNavigate={navigate}
          onSelectTask={selectTask}
          onSelectProject={(p) => {
            // Drawer → project tap with tasks: show the project's task
            // list (ProjectsView in detail mode). MobileShell only
            // dispatches here when there ARE tasks; the empty-project
            // case routes through onNewTaskInProject instead. On a
            // mobile viewport, project-detail's rail (Working folder,
            // Context, Scheduled) stacks below the task list — see
            // the @media block in globals.css.
            if (p) setSelectedProject(p);
            setRoute('projects');
          }}
          onNewTaskInProject={(p) => {
            // Empty project → drop the user into the composer with
            // this project preselected. HomeView's first send creates
            // the task on the server with projectName attached.
            if (p) setSelectedProject(p);
            setActiveTaskId(null);
            setRoute('home');
          }}
          onOpenSchedule={(scheduleId) => {
            setSelectedScheduleId(scheduleId);
            setRoute('schedule-detail');
          }}
          onNewTask={newTask}
          onNewProject={() => {
            // Mobile FAB → "New project". The modal lives inside
            // ProjectsView, so navigate there first (clearing any
            // selected project so we land on the grid, not detail),
            // then dispatch the event ProjectsView listens for. The
            // small delay lets React commit ProjectsView's mount
            // before the listener attaches.
            setSelectedProject(null);
            setRoute('projects');
            setTimeout(() => {
              window.dispatchEvent(new CustomEvent('anton:open-new-project'));
            }, 60);
          }}
        >
          {mainEl}
        </MobileShell>
      ) : mainEl;
      })()}
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

      {!host.isWeb && (
      <ServerOfflineHelpModal
        open={serverHelpOpen}
        onClose={() => setServerHelpOpen(false)}
        serverOnline={serverOnline}
        serverBusy={serverBusy}
        serverBusyKind={serverBusyKind}
        onStart={async () => {
          // Atomic start — used by both the offline "Start" button
          // and the composed "Restart" path inside the modal.
          setServerBusyKind('starting');
          setServerBusy(true);
          try {
            if (serverOnline) {
              setServerBusyKind('stopping');
              setServerBusy(true);
              try {
                const stopRes = await host.serverStop?.();
                if (stopRes) setServerOnline(!!stopRes.running);
              } catch {}
            }
            setServerBusyKind('starting');
            setServerBusy(true);
            const result = await host.serverStart?.();
            if (result) {
              setServerOnline(!!result.running);
              if (result.running) setTimeout(refreshData, 400);
            }
          } catch {} finally {
            setServerBusy(false);
          }
        }}
        onStop={async () => {
          // Atomic stop — used by the new modal "Stop" button so the
          // user can shut down the backend without it immediately
          // re-starting. The previous single-button onRetry forced
          // stop+start every click and made it impossible to leave
          // the backend off.
          setServerBusyKind('stopping');
          setServerBusy(true);
          try {
            const result = await host.serverStop();
            if (result) setServerOnline(!!result.running);
          } catch {} finally {
            setServerBusy(false);
          }
        }}
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
        message="This removes both your question and Anton's response from the conversation. Any scratchpad cells, artifacts, or memory writes anton produced as part of this turn stay on disk. This can't be undone."
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

      {/* Floating theme toggle (bottom-right). Lives outside the sidebar so
          it's always reachable, including when the sidebar is collapsed. */}
      <button
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        aria-label="Toggle colour theme"
        className="floating-theme-toggle"
        style={{ WebkitAppRegion: 'no-drag' }}
      >
        {theme === 'dark' ? Ico.sun(15) : Ico.moon(15)}
      </button>

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
}
