import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { flushSync } from 'react-dom';
import Ico from './components/Icons';
import MoveToProjectModal from './components/MoveToProjectModal';
import { pickConnectWelcome } from './lib/connectWelcomes';
// OnboardingShell removed — the desktop shell's renderer handles terms/install/
// provider setup. The cowork app is mounted by CoworkApp.tsx only after
// those gates pass, so AppCore renders unconditionally here.
import Sidebar from './components/Sidebar';
import MobileShell from './components/MobileShell';
import { ConfirmModal } from './components/ConfirmModal';
import { Modal, ModalHeader, ModalBody } from './components/ui/Modal';
import { ToastProvider, useToastManager } from './components/ui/Toast';
import HomeView from './views/HomeView';
import ChatView from './views/ChatView';
import ProjectsView from './views/ProjectsView';
import ScheduledView from './views/ScheduledView';
import TasksView from './views/TasksView';
import ScheduleDetailView from './views/ScheduleDetailView';
import ArtifactsView from './views/ArtifactsView';
import ChannelsView from './views/ChannelsView';
import CustomizeView from './views/CustomizeView';
import SettingsView from './views/SettingsView';
import UtilitiesView from './views/UtilitiesView';
import SkillsView from './views/SkillsView';
import SearchModal from './components/SearchModal';
import ConnectorPicker from './components/connector/ConnectorPicker';
import ServerOfflineHelpModal from './components/ServerOfflineHelpModal';
import { setForm as setDataVaultForm, getForm as getDataVaultForm, clearForm as clearDataVaultForm, patchForm as patchDataVaultForm, getFormState as getDataVaultFormState, setFormState as setDataVaultFormState, getSelectedMethod as getDataVaultSelectedMethod, setSelectedMethod as setDataVaultSelectedMethod, subscribe as subscribeDataVaultForm } from './components/datavault/formStore';
import { extractFormSpec } from './components/datavault/parseFormSpec';
import { host, getAccessToken } from '../platform/host';
import { SERVER_START_CAP_MS } from '../../shared/server-status';
import { loadSkin, persistSkin, nextSkin, skinLabel } from '../lib/skins';
import { loadCustomTheme, persistCustomTheme, applyCustomTheme } from '../lib/customTheme';
import { applyNavTitleColor } from '../lib/navBranding';
import { getAgentLabel } from './lib/agentLabel';
import { useBreakpoint } from './hooks/useBreakpoint';
import { useGoogleDrivePicker } from './hooks/useGoogleDrivePicker';
import { fetchSessions, fetchSession, fetchConversationList, fetchProjects, fetchArtifacts, fetchSettings, fetchHealth,
         createProject, updateSettings, streamNewSession, streamMessage,
         streamDataVaultSubmission,
         allocateConversationId, uploadAttachments,
         deleteAttachment, searchCowork, fetchPins, pinTask, unpinTask,
         recordTaskVisit, fetchSchedules, createSchedule, updateSchedule, deleteSchedule,
         pauseSchedule, resumeSchedule, runScheduleNow, fetchDatasources, MOCK_DATA,
         renameConversation, deleteConversation, deleteConversationTurn, moveConversation, moveTaskToProject,
         deleteProject, cancelScratchpad, cancelResponse, fetchConnector,
         fetchSavedConnection, deleteDatasource, deletePickedFile,
         fetchInFlightStatus, tailInFlight, fetchInFlightList } from './api';
import { initialStreamState, reduceStream } from './lib/responseStreamAdapter';
import { modelLabel, recommendedModelOptions, providerValueToType } from './lib/settingsTransform';
import { trackDataSourceConnected, trackArtifactBuilt, trackAgentSessionStarted, trackAppInstalled, trackFirstQuery } from './lib/analytics';

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

function isAntonConfigError(message, event) {
  const text = String(message || '');
  return (
    event?.code === 'config_required' ||
    /Configure ANTON_/i.test(text) ||
    /Could not resolve authentication method/i.test(text) ||
    /Expected one of api_key, auth_token, or credentials/i.test(text)
  );
}

function normalizeAntonError(message, event) {
  if (isAntonConfigError(message, event)) {
    return 'No LLM provider is configured for this account. Subscribe with MindsHub or add your own provider in Settings.';
  }
  const text = String(message || '');
  return text || 'Could not complete this task.';
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

const THINKING_PLACEHOLDER = 'Thinking...';

function stripStreaming(messages) {
  return messages.filter((m) => m.role !== '_streaming');
}

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
// navigates into a task:
//   1. Drop `_streaming` / activity placeholders when not live.
//   2. Collapse in-progress steps to `completed` when not tailing.
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
  if (isServerInFlight) {
    // If the conversation is in-flight but has no visible content yet
    // (e.g. a scheduled task that just started), show a thinking
    // placeholder so the user sees activity instead of a blank chat.
    const hasContent = messages.length > 0 && messages.some(
      (m) => m && (m.role === 'assistant' || m.role === '_streaming'),
    );
    if (!hasContent) return withThinkingPlaceholder(messages, { label: 'Running task…' });
    return messages;
  }
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

  return cleaned;
}

function removeThinkingPlaceholder(messages) {
  return messages.filter((m) => !(m.role === 'activity' && m.placeholder));
}

function withThinkingPlaceholder(messages, opts = {}) {
  // Caller-supplied label so the new-task path can read "Creating
  // task…" while a reply uses the generic "Thinking…". Both the
  // activity placeholder (fallback render in ChatView) and the
  // `_streaming` stub (primary render via the existing streaming
  // branch) carry the same string, so whichever lands in the
  // viewport reads consistently.
  const label = opts.label || 'Thinking…';
  // Two rows:
  //   1. The activity placeholder — kept so any code path that
  //      consumes it (rail Progress card today, future surfaces) sees
  //      the "user just sent" signal.
  //   2. A `_streaming` stub — picked up by ChatView's existing
  //      streaming render block (`!streamingMsg.steps?.length &&
  //      !streamingMsg.content` branch), which renders an animated
  //      cursor + label inline below the user's message. Without
  //      this, the chat scroll is silent between send and the first
  //      SSE event — fine on a warm session (~sub-second) but
  //      painful on a brand-new task where anton's bootstrap can
  //      take 20-30s. The stub gets stripped + replaced by the real
  //      streaming row on the first `flushStreamingMessage` call,
  //      at which point `_placeholderLabel` is gone and the label
  //      naturally falls back to the default "Thinking…".
  return [
    ...removeThinkingPlaceholder(stripStreaming(messages)),
    {
      role: 'activity',
      content: label,
      kind: 'placeholder',
      phase: 'reasoning',
      state: 'running',
      placeholder: true,
      _label: label,
    },
    {
      role: '_streaming',
      content: '',
      steps: [],
      startedAt: Date.now(),
      // 'thinking' (not 'starting') so PhaseProgress treats the turn
      // as `isInFlight` and renders the Thinking phase row in the
      // rail — otherwise the card falls into its "Steps appear here
      // while Anton works" placeholder branch, which contradicts
      // the inline cursor in the chat scroll.
      streamStatus: 'thinking',
      _placeholderLabel: label,
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

function describeActivity(event, agentName = 'Anton') {
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

  return phase ? `${agentName} is ${phase}` : `${agentName} is working`;
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
    try { state = reduceStream(state, ev, Date.now, { replay: true }); } catch {}
  }
  return {
    steps: state.steps || [],
    startedAt: state.startedAt || fallbackStartedAt || null,
    // 'done' once the persisted events carried response.completed,
    // 'error' on response.failed — the authoritative "this turn
    // finished" signal from the detached stream buffer.
    status: state.status,
  };
}

function failedEventMeta(events) {
  if (!Array.isArray(events)) return null;
  const ev = [...events].reverse().find((e) => e?.type === 'response.failed');
  if (!ev) return null;
  return {
    code: ev.code || null,
    message: ev.error || ev.message || '',
    reconnectable: ev.reconnectable ?? null,
    providerLabel: ev.provider_label ?? null,
    // model-403 (model_access_denied / model_disabled): which model the
    // gateway rejected, so the card can name it. `failedModel` locally —
    // "model" is too overloaded in message objects.
    failedModel: ev.model ?? null,
  };
}

// Walk a messages payload from the server and, for any assistant
// turn that carries an `events` array (the new sidecar), derive
// `steps`/`startedAt` via the live reducer. A terminal
// `response.failed` becomes a client-side error bubble after the
// partial assistant turn. Drops the raw `events` array.
function hydrateMessagesFromServerEvents(messages) {
  if (!Array.isArray(messages)) return messages;
  const out = [];
  for (const m of messages) {
    if (!m || m.role !== 'assistant' || !Array.isArray(m.events) || m.events.length === 0) {
      out.push(m);
      continue;
    }
    const reduced = reduceServerEvents(m.events, m.startedAt);
    const { events: _drop, ...rest } = m;
    if (!reduced) {
      out.push(rest);
      continue;
    }
    const turnComplete = reduced.status === 'done' || reduced.status === 'error';
    const completeFlag = turnComplete ? { _turnComplete: true } : {};
    out.push({
      ...rest,
      ...completeFlag,
      ...(reduced.steps.length > 0
        ? { steps: reduced.steps, startedAt: rest.startedAt || reduced.startedAt }
        : {}),
    });
    if (reduced.status === 'error') {
      const failed = failedEventMeta(m.events);
      const code = failed?.code || null;
      const errText = failed?.message || 'An unexpected error occurred.';
      if (isAntonConfigError(errText, { code })) {
        out.push({ role: 'provider_required' });
      } else {
        out.push({
          role: 'error',
          content: normalizeAntonError(errText, { code }),
          code,
          reconnectable: failed?.reconnectable ?? null,
          providerLabel: failed?.providerLabel ?? null,
          failedModel: failed?.failedModel ?? null,
        });
      }
    }
  }
  return out;
}

function applySessionMessages(
  cid,
  rawMessages,
  { isLive = false, isServerInFlight = false, skipLocalSidecar = false } = {},
) {
  const hydrated = hydrateMessagesFromServerEvents(rawMessages);
  const merged = skipLocalSidecar ? hydrated : mergeConvTurns(cid, hydrated);
  return reconcileTaskMessages(merged, isLive, isServerInFlight);
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
    _isToolCall: !!s._isToolCall,
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
    if (m._turnComplete) return m;
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
  // Take whichever of (local, server) updatedAt is newer. When a turn
  // is in flight, handleSendInTask / handleSendFromHome stamp a fresh
  // client updatedAt the instant the user sends, but the server's value
  // only catches up once the turn's messages persist (the server derives
  // updated_at from the latest message — ENG-961). Keeping the newer of
  // the two stops a fetchSessions mid-stream from sliding the just-revived
  // task back down the list before the server value lands.
  const _newerUpdatedAt = (a, b) => {
    const aa = Date.parse(a || '') || 0;
    const bb = Date.parse(b || '') || 0;
    return aa >= bb ? a : b;
  };
  const merged = serverTasks.map((server) => {
    const l = localById.get(server.id);
    if (!l) return server;
    const lMessages = Array.isArray(l.messages) ? l.messages : [];
    const sMessages = Array.isArray(server.messages) ? server.messages : [];
    const isStreaming = lMessages.some((m) => m?.role === '_streaming');
    const hasLocalContent = lMessages.length > 0;
    const countAssistants = (msgs) => (msgs || []).filter((m) => m?.role === 'assistant').length;
    if (!isStreaming && !hasLocalContent) {
      // Even without live messages, prefer the locally-bumped
      // updatedAt if it's newer — handleSendInTask stamps the task
      // before any stream events arrive, so a fetchSessions that
      // races between user-click-send and the first SSE event must
      // not overwrite the bump.
      return { ...server, updatedAt: _newerUpdatedAt(l.updatedAt, server.updatedAt) };
    }
    if (!isStreaming && countAssistants(sMessages) > countAssistants(lMessages)) {
      return {
        ...server,
        updatedAt: _newerUpdatedAt(l.updatedAt, server.updatedAt),
        disabledConnections: l.disabledConnections ?? server.disabledConnections ?? [],
        attachments: lMessages.length && Array.isArray(l.attachments) && l.attachments.length
          ? l.attachments
          : server.attachments,
      };
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

export default function App() {
  return (
    <ToastProvider>
      <AppCore />
    </ToastProvider>
  );
}

function AppCore() {
  const [settings, setSettings] = useState({
    greeting: "Let's knock something off your list",
    tone: 'balanced',
    defaultModel: 'claude-sonnet-4-6',
    autoPin: true,
    // Animated dot-grid background off by default — a flat surface reads
    // calmer and cohesive with the rest of the UI. Users can opt back in
    // via Settings → Personalization → Animated background.
    showDots: false,
    showCounters: true,
    navTitle: '',
    navTitleColor: '',
    navLogo: '',
    showThemeToggle: true,
    show8bitToggle: true,
    accentVariant: 'aqua',
  });

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
  const [composerPrefill, setComposerPrefill] = useState(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // null = no section selected: the mobile master-detail shows its section
  // list; desktop (no list) falls back to 'agent' where it's read.
  const [settingsSection, setSettingsSection] = useState(null);
  const [ssoConnected, setSsoConnected] = useState(false);
  // Last sign-in failure, painted on the Settings account card. Cleared
  // on retry and on any authenticated push from main (ENG-761).
  const [ssoError, setSsoError] = useState('');
  // Re-entry guard: a second "Sign in" click while a browser flow is
  // already open would spawn a second loopback attempt.
  const ssoBusyRef = useRef(false);
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
    if (inFlightSet.size === 0) return undefined;
    const timer = setInterval(() => { refreshInFlightSet(); }, 5000);
    return () => clearInterval(timer);
  }, [inFlightSet.size, refreshInFlightSet]);

  const enqueueMessage = (taskId, text, attachments = []) => {
    // `attachments` rides with the queued item so a message sent while a
    // turn is in flight keeps its files — the drain re-resolves/uploads
    // them. Without this the queue stored text only and files were lost.
    const item = { id: `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`, text, attachments };
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
    const silent = opts?.silent === true;
    activeStreamGenerationRef.current += 1;

    let cidToCancel = activeStreamingTaskIdRef.current;
    if (!cidToCancel) {
      const streamingTask = tasksRef.current.find(
        (t) => (t.messages || []).some((m) => m.role === '_streaming'),
      );
      cidToCancel = streamingTask?.id ?? null;
    }

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
      try { await cancelResponse(cidToCancel); } catch { /* idempotent */ }
      markInFlightDone(cidToCancel);
      setMessageQueue((prev) => {
        const next = { ...prev };
        delete next[cidToCancel];
        return next;
      });
    }

    activeScratchpadRef.current = null;
    activeStreamingTaskIdRef.current = null;

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
  }, [markInFlightDone]);

  const handleStreamError = useCallback(async (taskIds, cid, message, event) => {
    if (event?.code === 'cancelled') return;
    activeStreamCtrlRef.current = null;
    activeScratchpadRef.current = null;
    activeStreamingTaskIdRef.current = null;
    const ids = [...new Set(taskIds.filter(Boolean))];
    ids.forEach((id) => markInFlightDone(id));

    const loaded = cid ? await loadSessionMessagesWithRetry(cid) : null;
    setTasks((prev) => prev.map((t) => {
      if (!ids.includes(t.id)) return t;
      if (loaded) {
        const hasError = loaded.messages.some(
          (m) => m.role === 'error' || m.role === 'provider_required',
        );
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
  }, [markInFlightDone]);

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
      .map((o) => ({ id: o.id, name: o.label, desc: '' }));
  }, [settings.recommendedModels, settings.planningProvider, settings.modelLabels]);
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
  // Skin — a second styling axis, orthogonal to light/dark. Each entry
  // in the SKINS registry (lib/skins.ts) maps to a token-override
  // stylesheet keyed on body[data-skin]; both color schemes have a
  // variant per skin, so the two toggles compose freely.
  const [skin, setSkin] = useState(loadSkin);
  // The "design your own" recipe behind the `custom` skin — edited in
  // Settings → Appearance, applied as inline body token overrides.
  const [customTheme, setCustomTheme] = useState(loadCustomTheme);

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

  useEffect(() => {
    persistSkin(skin);
    document.body.dataset.skin = skin;
  }, [skin]);

  // Custom-skin recipe → inline body tokens. Applied only while the
  // custom skin is active; cleared otherwise so the stylesheet-driven
  // skins are untouched.
  useEffect(() => {
    persistCustomTheme(customTheme);
    applyCustomTheme(skin === 'custom' ? customTheme : null, theme === 'light' ? 'light' : 'dark');
  }, [skin, customTheme, theme]);

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

  const [route, setRoute] = useState('home');         // home | task | projects | scheduled | schedule-detail | artifacts | channels | customize
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
  // stays expanded — gives the user permanent access to the nav.
  const sidebarCollapsedEffective =
    !isNarrow && sidebarCollapsibleRoutes.has(route) && sidebarCollapsed;
  const [activeTaskId, setActiveTaskId] = useState(null);
  const [selectedScheduleId, setSelectedScheduleId] = useState(null);
  const [selectedProject, setSelectedProject] = useState(null);
  // Set from the configured planning model once settings load.
  const [selectedModel, setSelectedModel] = useState(null);
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

  // Desktop "app installed" — fire once per install, after the backend is up
  // (health 'ok'). Captured under the anonymous device id if the user hasn't
  // signed in yet, and merged into the account on first login (ENG-537).
  // trackAppInstalled self-guards with a localStorage marker, so re-running is safe.
  useEffect(() => {
    if (host.isElectron && health.status === 'ok') trackAppInstalled();
  }, [health.status]);

  // OTA UI update state
  const [updateStatus, setUpdateStatus] = useState(null); // { phase, version }
  const [updateApplying, setUpdateApplying] = useState(false);
  const toastManager = useToastManager();

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
        setSelectedModel({
          id: modelId,
          name: modelLabel(modelId) || modelId || 'Planning model',
          desc: data.providerLabel ? `${data.providerLabel} planning model` : 'Configured planning model',
        });
      }
    });
  }, []);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  const handleServerStart = useCallback(async () => {
    setServerBusyKind('starting');
    setServerBusy(true);
    try {
      const result = await host.serverStart?.();
      if (result) {
        setServerOnline(!!result.running);
        if (result.running) setTimeout(refreshData, 400);
      }
    } catch {} finally { setServerBusy(false); }
  }, [refreshData]);

  const handleServerStop = useCallback(async () => {
    setServerBusyKind('stopping');
    setServerBusy(true);
    try {
      const result = await host.serverStop?.();
      if (result) setServerOnline(!!result.running);
    } catch {} finally { setServerBusy(false); }
  }, []);

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
      // Missing provider → land straight on the Agent (provider) section, on
      // desktop and in the mobile master-detail alike.
      setSettingsSection('agent');
      setSettingsOpen(true);
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
  // hard ceiling elapses. After the ceiling we stop and trust the
  // status pill / sidebar toggle to recover by user action.
  //
  // The ceiling has to outlast main's start budget, or this loop declares
  // the backend offline while main is still legitimately waiting for it —
  // the user sees the failure panel for a start that goes on to succeed.
  // Derived from the shared cap rather than a second hand-picked number so
  // the two cannot drift apart.
  useEffect(() => {
    if (host.isWeb) return; // No server lifecycle to poll in the hosted web shell.
    let cancelled = false;
    let timer = null;
    const startedAt = Date.now();
    const POLL_CEILING_MS = SERVER_START_CAP_MS + 60_000;

    // Exactly one timer per tick. An earlier version scheduled inside the
    // starting/not-running branch AND again below it, overwriting `timer` and
    // leaking the first — so the poll rate doubled every tick. A warm start
    // resolved in two ticks and hid it; a slow start would have turned it into
    // thousands of concurrent polls.
    const tick = async () => {
      try {
        const info = await host.serverInfo();
        if (cancelled || !info) return;
        const running = info.running === true;
        const starting = info.starting === true;
        if (typeof info.running === 'boolean') setServerOnline(running);
        if (starting) setServerBusyKind('starting');
        setServerBusy(starting);
        if (running) return; // settled
        // Keep polling while main says it's still starting (main owns the
        // hard cap, so this can't run forever), and otherwise until the
        // ceiling — which covers the window where main is still resolving
        // `checkInstallStatus` before kicking off `startServer`.
        if (starting || Date.now() - startedAt < POLL_CEILING_MS) {
          timer = setTimeout(tick, starting ? 600 : 1000);
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
      setSelectedModel({ id: modelId, name: modelLabel(modelId) || modelId || 'Planning model', desc: 'Configured planning model' });
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
    ? (models.find((m) => m.id === currentTask.model) || { id: currentTask.model, name: currentTask.model, desc: 'Configured planning model' })
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
          harness: streamState.harness,
        }] };
      }));
    };

    activeStreamingTaskIdRef.current = taskId;
    const streamGen = activeStreamGenerationRef.current;
    activeStreamCtrlRef.current = tailInFlight(taskId, {
      fromSeq: 0, // Replay from the start — the reducer is idempotent
                  // over text deltas, and from_seq=0 keeps the rebuild
                  // simple. A per-task last-seen-seq optimisation is
                  // possible later if we see network overhead.
      onEvent(ev) {
        if (streamGen !== activeStreamGenerationRef.current) return;
        streamState = reduceStream(streamState, ev);
        const open = streamState.steps.find((s) => s.status === 'in_progress' && s._isScratchpad);
        if (open?._scratchpadTabId) activeScratchpadRef.current = open._scratchpadTabId;
        flushSync(() => flushStreaming());
      },
      onChunk(chunk) {
        if (streamGen !== activeStreamGenerationRef.current) return;
        assistantContent += chunk;
      },
      onDone() {
        if (streamGen !== activeStreamGenerationRef.current) return;
        activeStreamCtrlRef.current = null;
        activeScratchpadRef.current = null;
        activeStreamingTaskIdRef.current = null;
        markInFlightDone(taskId);
        const finalContent = streamState.bodyText || assistantContent;
        const finalSteps = streamState.steps;
        const finalStartedAt = streamState.startedAt;
        const finalHarness = streamState.harness;
        const configErrorInBody = finalContent && isAntonConfigError(finalContent, null);
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
      },
      onError(message, event) {
        if (event?.code === 'cancelled') return;
        if (streamGen !== activeStreamGenerationRef.current) return;
        void handleStreamError([taskId], taskId, message, event);
      },
    });
    return true;
  }, [markInFlight, markInFlightDone, handleStreamError]);

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
      // we LEAVE running indicators alone. If no, reconcile strips
      // zombie placeholders and collapses stale step state.
      const isLive = activeStreamingTaskIdRef.current === id;

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
          if (!fresh || !Array.isArray(fresh.messages)) return;
          // Server-in-flight conversations may have no messages yet
          // (e.g. a scheduled task that just started). Don't bail —
          // reconcile will inject a thinking placeholder.
          if (fresh.messages.length === 0 && !isServerInFlight) return;
          // Two layers of restoration, in order of trust:
          //   1. Server sidecar (`{cid}_turns.json`) — events for each
          //      assistant turn, replayed through the same reducer the
          //      live stream uses. Survives any client reset and
          //      anyone reading the conversation gets the same view.
          //   2. localStorage sidecar — legacy fallback for turns
          //      created before the server sidecar shipped.
          const reconciled = applySessionMessages(id, fresh.messages, { isLive, isServerInFlight });
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
          return { ...t, messages: applySessionMessages(id, t.messages, { isLive, isServerInFlight }) };
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

  useEffect(() => {
    if (!settingsOpen) return;
    getAccessToken().then((token) => setSsoConnected(!!token)).catch(() => {});
  }, [settingsOpen]);

  // Authoritative signed-in state, pushed from the main process on every
  // token-store transition (login, silent refresh, logout, session
  // death). The UI no longer depends solely on the promise of whichever
  // call initiated the sign-in — that promise can be lost (ENG-761)
  // while the main process is in fact authenticated, or vice versa.
  useEffect(() => {
    if (!host.isElectron) return undefined;
    return host.onMindsHubAuthChanged(({ authenticated }) => {
      setSsoConnected(!!authenticated);
      if (authenticated) setSsoError('');
    });
  }, []);

  const handleSsoSignIn = async () => {
    if (!host.isElectron || ssoBusyRef.current) return;
    ssoBusyRef.current = true;
    setSsoError('');
    try {
      const loginResult = await host.mindshubLogin();
      if (!loginResult?.ok) {
        // ENG-761: this used to silently return — the browser said
        // "You're authorized!" while the app showed nothing. Surface the
        // failure where the user will look for it: the account card.
        setSsoError(String(loginResult?.reason || 'Sign in failed. Please try again.'));
        setSettingsSection('account');
        setSettingsOpen(true);
        return;
      }
      // Signed in — flip the UI now; key provisioning below takes several
      // seconds (org bootstrap + server restart) and is not a sign-in gate.
      setSsoConnected(true);
      try {
        await host.mindshubFinalize();
      } catch (e) {
        console.warn('[sso] finalize failed after sign-in (account is authenticated):', e);
      }
      refreshData();
    } finally {
      ssoBusyRef.current = false;
    }
  };

  // Open the Settings surface. A named section drills straight to it (desktop
  // and the mobile master-detail alike). A bare open leaves desktop on its
  // last section (it has no list) but resets the mobile surface to its section
  // list — hence the isMobile-gated null. Single home for this rule so the
  // call sites don't each re-spell it.
  const openSettings = (section = null) => {
    if (section) setSettingsSection(section);
    else if (isMobile) setSettingsSection(null);
    setSettingsOpen(true);
  };

  const navigate = (key) => {
    if (key === 'settings' || key.startsWith('settings:')) {
      // Targeted (settings:backend) opens that section; a bare `settings`
      // opens the mobile section list (null) / desktop's last section.
      openSettings(key.includes(':') ? key.split(':')[1] : null);
      return;
    }
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

  // Send from the home screen — creates a new session
  const handleSendFromHome = async (text) => {
    // Preflight: no provider configured → render an action card task
    // instead of routing through anton's LLM path.
    if (!(await ensureProviderReady())) {
      const taskId = `tmp-${Date.now()}`;
      const effectiveProjectName = selectedProject?.name || 'general';
      const effectiveProjectPath = selectedProject?.path
        || projects.find((p) => p.name === 'general')?.path
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
        model: selectedModel?.id ?? null,
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
    // Server mints the canonical id on `response.created` for tmp- tasks.
    // adoptServerId keeps activeStreamingTaskIdRef (and cancel) in sync.
    const adoptServerId = (sid) => {
      if (!sid || sid === resolvedId) return;
      const previousId = resolvedId;
      resolvedId = sid;
      setTasks((prev) => prev.map((t) =>
        t.id === previousId || t.id === taskId ? { ...t, id: sid } : t,
      ));
      if (activeStreamingTaskIdRef.current === previousId) {
        activeStreamingTaskIdRef.current = sid;
      }
      markInFlightDone(previousId);
      markInFlight(sid);
      setActiveTaskId((curr) => (curr === previousId ? sid : curr));
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
          content: streamState.bodyText || assistantContent,
          steps: streamState.steps,
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
      markInFlight(taskId);
    };
    trackAgentSessionStarted();
    trackFirstQuery();
    const streamGen = activeStreamGenerationRef.current;
    const streamNewSessionFn = () => streamNewSession(sendText, {
      conversationId: hasPendingFiles ? taskId : undefined,
      projectName: effectiveProjectName,
      projectPath: effectiveProjectPath,
      model: selectedModel?.id,
      attachmentIds,
      disabledConnections: disabledForSend,
      onEvent(ev) {
        if (streamGen !== activeStreamGenerationRef.current) return;
        const sid = ev?.conversation_id || ev?.response?.conversation_id;
        if (sid) adoptServerId(sid);
        streamState = reduceStream(streamState, ev);
        // Track latest in-progress scratchpad so the Stop button
        // can cancel anton's current cell, not just abort our stream.
        const open = streamState.steps.find((s) => s.status === 'in_progress' && s._isScratchpad);
        if (open?._scratchpadTabId) activeScratchpadRef.current = open._scratchpadTabId;
        flushSync(() => flushStreamingMessage());
      },
      onChunk(chunk, sid) {
        if (streamGen !== activeStreamGenerationRef.current) return;
        if (sid) adoptServerId(sid);
        assistantContent += chunk;
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
        markInFlightDone(finalId);
        if (finalId !== taskId) markInFlightDone(taskId);
        const finalContent = streamState.bodyText || assistantContent;
        const finalSteps = streamState.steps;
        const finalStartedAt = streamState.startedAt;
        const finalHarness = streamState.harness;
        // Anton sometimes wraps auth failures into a 200 stream that
        // emits the error as plain assistant text. Detect that case
        // and replace the assistant turn with the provider_required
        // card instead of rendering the raw SDK message.
        const configErrorInBody = finalContent && isAntonConfigError(finalContent, null);
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
      },
      onError(message, event) {
        if (event?.code === 'cancelled') return;
        if (streamGen !== activeStreamGenerationRef.current) return;
        void handleStreamError([resolvedId, taskId], resolvedId, message, event);
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
  const handleSendInTask = async (text, queuedAttachments = null) => {
    if (!currentTask) return;
    const id = currentTask.id;

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
      setComposerAttachments([]);
      return;
    }

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
      // Queue with the files attached so a mid-stream send doesn't drop
      // them. A fresh send takes the composer's attachments and clears
      // them (the queued item now owns them); a re-enqueued queued item
      // reuses its own and leaves the live composer untouched.
      enqueueMessage(id, text, queuedAttachments ?? composerAttachments);
      if (queuedAttachments == null) setComposerAttachments([]);
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
          content: streamState.bodyText || assistantContent,
          steps: streamState.steps,
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
      projectPath: taskProjectPath,
      model: taskModel,
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
        const open = streamState.steps.find((s) => s.status === 'in_progress' && s._isScratchpad);
        if (open?._scratchpadTabId) activeScratchpadRef.current = open._scratchpadTabId;
        flushSync(() => flushStreaming());
      },
      onChunk(chunk, sid) {
        if (streamGen !== activeStreamGenerationRef.current) return;
        if (sid) adoptServerId(sid);
        // The adapter accumulates bodyText already; this callback is
        // redundant for content but cheap and useful as a fallback if
        // the adapter ever fails to parse a delta.
        assistantContent += chunk;
      },
      onDone() {
        if (streamGen !== activeStreamGenerationRef.current) return;
        activeStreamCtrlRef.current = null;
        activeScratchpadRef.current = null;
        activeStreamingTaskIdRef.current = null;
        markInFlightDone(resolvedId);
        if (resolvedId !== id) markInFlightDone(id);
        const finalContent = streamState.bodyText || assistantContent;
        const finalSteps = streamState.steps;
        const finalStartedAt = streamState.startedAt;
        const finalHarness = streamState.harness;
        const configErrorInBody = finalContent && isAntonConfigError(finalContent, null);
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
        // Drain the next queued message for this task (if any) so a
        // user who fired multiple prompts mid-stream gets each one
        // sent in order. Keyed off the original local id since that's
        // what enqueueMessage used while the adoption was pending.
        const next = popQueueHead(id);
        if (next) {
          Promise.resolve().then(() => handleSendInTask(next.text, next.attachments || []));
        }
      },
      onError(message, event) {
        if (event?.code === 'cancelled') return;
        if (streamGen !== activeStreamGenerationRef.current) return;
        void (async () => {
          await handleStreamError([resolvedId, id], resolvedId, message, event);
          const next = popQueueHead(id);
          if (next) {
            Promise.resolve().then(() => handleSendInTask(next.text, next.attachments || []));
          }
        })();
      },
    });
  };

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
          content: streamState.bodyText || assistantContent,
          steps: streamState.steps,
          startedAt: streamState.startedAt,
          streamStatus: streamState.status,
          harness: streamState.harness,
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
      name,
      method,
      onEvent(ev) {
        const sid = ev?.conversation_id || ev?.response?.conversation_id;
        if (sid) adoptServerId(sid);
        streamState = reduceStream(streamState, ev);
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
        if (sid) adoptServerId(sid);
        assistantContent += chunk;
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
        if (sid) adoptServerId(sid);
        activeStreamCtrlRef.current = null;
        activeStreamingTaskIdRef.current = null;
        const finalContent = streamState.bodyText || assistantContent;
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

  const refreshSchedules = useCallback(async () => {
    const data = await fetchSchedules();
    const list = data.schedules || [];
    setScheduled(list);
    setScheduleRunsIndex(data.runs_index || {});
    return list;
  }, []);

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
          settingsActive={settingsOpen}
          // Only mark a recent as "selected" while actually viewing a task —
          // activeTaskId persists across navigation, so passing it unconditionally
          // left the last-opened task highlighted on Projects/Settings/etc.
          activeTaskId={route === 'task' ? activeTaskId : null}
          serverOnline={serverOnline}
          agentLabel={agentLabel}
          theme={theme}
          onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          skin={skin}
          // While a Custom theme is active, the sidebar's "8-bit" button
          // can't flip `skin` straight to '8bit'/'normal' — that would
          // silently discard the CustomTheme recipe (it only applies while
          // skin === 'custom'). Repurpose the same button to toggle just
          // the mono/8-bit font instead, so it stays meaningful without
          // resetting anything.
          onToggleSkin={() => {
            if (skin === 'custom') {
              setCustomTheme((prev) => ({ ...prev, font: prev.font === 'mono' ? 'standard' : 'mono' }));
            } else {
              setSkin(skin === '8bit' ? 'normal' : '8bit');
            }
          }}
          is8bitActive={skin === 'custom' ? customTheme.font === 'mono' : skin !== 'normal'}
          showThemeToggle={settings.showThemeToggle !== false}
          show8bitToggle={settings.show8bitToggle !== false}
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
          onMoveTaskToProject={handleOpenMoveModal}
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
          navTitle={settings.navTitle || null}
          navLogo={settings.navLogo || null}
          updateAvailable={updateStatus?.phase === 'available' ? { version: updateStatus.version } : null}
          onApplyUpdate={handleApplyUpdate}
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

      {(() => {
      const mainEl = (
      <main style={{
        flex: 1, minWidth: 0, minHeight: 0,
        display: 'flex', flexDirection: 'column',
        background: mainBg,
        // Opt the whole content column out of the window drag region.
        // Without this, the empty canvas inherits the root's
        // `-webkit-app-region: drag` (App container), and Electron then
        // swallows mouse events over it — so clicking the canvas never
        // reaches any outside-click handler and dropdowns can't dismiss
        // (desktop only; the web build has no drag regions). The window
        // still drags via the sidebar header and the window's top strip.
        WebkitAppRegion: 'no-drag',
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
            serverOnline={serverOnline}
            agentLabel={agentLabel}
            onShowServerHelp={() => openSettings('backend')}
            skipIntro={bootIntroDone}
            prefill={composerPrefill}
          />
        )}

        {route === 'task' && currentTask && (
          <ChatView
            task={currentTask}
            onSend={handleSendInTask}
            onOpenSettings={openSettings}
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
            agentLabel={agentLabel}
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


        {route === 'channels' && (
          <ChannelsView />
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
            />
          </Modal>
        ) : (
          <Modal open={settingsOpen} onClose={() => setSettingsOpen(false)} size="lg" height="min(820px, 88vh)" labelledBy="settings-modal-title">
            <ModalHeader
              id="settings-modal-title"
              title="Settings"
              onClose={() => setSettingsOpen(false)}
              right={!ssoConnected && host.isElectron ? (
                <button
                  type="button"
                  onClick={async () => { setSettingsOpen(false); await handleSsoSignIn(); }}
                  title="Sign in with MindsHub to use managed models"
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
          navTitle={settings.navTitle || null}
          navLogo={settings.navLogo || null}
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
}
