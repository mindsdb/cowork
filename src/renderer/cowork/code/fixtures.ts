import type {
  CodingEvent,
  CodingSession,
  DiffFile,
  EngineCapability,
  GitState,
  SessionCreateBody,
  WorkspaceInspection,
} from './api';
import { DEFAULT_CODING_AGENT_MODEL } from './defaults';


const NOW = '2026-08-21T19:40:00Z';
const ROOT = '/Users/developer/Projects/atlas-web';
const WORKTREE = '/Users/developer/.cowork/coding/worktrees/atlas-web/task-73c4';


function activeFixtureName(): string | null {
  if (!import.meta.env.DEV || typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('codeFixture');
}


export function codeFixtureReviewOpen(): boolean {
  return !!activeFixtureName() && new URLSearchParams(window.location.search).get('codeReview') === 'open';
}


function session(overrides: Partial<CodingSession> = {}): CodingSession {
  return {
    schema_version: 1,
    id: 'task-73c4',
    title: 'Refine checkout validation and recovery states',
    engine_id: 'codex',
    engine_adapter_version: '1',
    model: DEFAULT_CODING_AGENT_MODEL,
    permission_mode: 'supervised',
    status: 'completed',
    source_path: ROOT,
    workspace_path: WORKTREE,
    workspace_kind: 'git_worktree',
    repository_root: ROOT,
    base_revision: '91ef52ea6f3ab14d8048f2b24d841ff1bb96e44b',
    source_dirty: false,
    workspace_warning: null,
    engine_session_id: 'codex-thread-73c4',
    active_turn_id: null,
    pending_approval: null,
    last_error: null,
    event_count: 12,
    created_at: '2026-08-21T19:24:00Z',
    updated_at: NOW,
    ...overrides,
  };
}


function event(seq: number, type: CodingEvent['type'], values: Partial<CodingEvent> = {}): CodingEvent {
  return {
    schema_version: 1,
    seq,
    timestamp: `2026-08-21T19:${String(24 + Math.min(seq, 35)).padStart(2, '0')}:00Z`,
    type,
    title: '',
    text: '',
    phase: 'completed',
    item_id: null,
    turn_id: 'turn-1',
    data: {},
    ...values,
  };
}


const BASE_EVENTS: CodingEvent[] = [
  event(1, 'session', { title: 'Task workspace ready', text: 'Created an isolated detached worktree.', data: { workspaceKind: 'git_worktree' } }),
  event(2, 'user_message', { title: 'You', text: 'Make checkout validation easier to understand, preserve entered details after a failed request, and cover the recovery path with focused tests.' }),
  event(3, 'plan', { title: 'Plan', phase: 'progress', data: { plan: [
    { step: 'Inspect the checkout form and current validation tests', status: 'completed' },
    { step: 'Centralize field errors and retain form state after failure', status: 'completed' },
    { step: 'Add recovery coverage and run focused checks', status: 'completed' },
  ] } }),
  event(4, 'reasoning', { title: 'Reviewed the form flow', text: 'The request error path clears the draft before the response has succeeded.', item_id: 'reason-1' }),
  event(5, 'command', { title: 'Searched checkout state', text: 'rg -n "submitCheckout|validation" src tests', data: { command: 'rg -n "submitCheckout|validation" src tests' }, item_id: 'cmd-1' }),
  event(6, 'file_change', { title: 'Updated checkout form', text: 'src/checkout/CheckoutForm.tsx', data: { path: 'src/checkout/CheckoutForm.tsx' }, item_id: 'file-1' }),
  event(7, 'file_change', { title: 'Added recovery tests', text: 'src/checkout/CheckoutForm.test.tsx', data: { path: 'src/checkout/CheckoutForm.test.tsx' }, item_id: 'file-2' }),
  event(8, 'command', { title: 'Ran focused tests', text: 'npm test -- CheckoutForm', data: { command: 'npm test -- CheckoutForm' }, item_id: 'cmd-2' }),
  event(9, 'agent_message', { title: 'Agent', text: 'Updated checkout validation so each field keeps its own actionable error, and the draft now remains intact when the request fails.\n\nAdded focused coverage for both the validation and recovery paths. `npm test -- CheckoutForm` passes.', phase: 'completed', item_id: 'message-1' }),
  event(10, 'session', { title: 'Task completed', text: 'The coding turn completed.', data: { status: 'completed' } }),
];


const FILES: DiffFile[] = [
  {
    path: 'src/checkout/CheckoutForm.tsx',
    status: 'M', additions: 34, deletions: 18, binary: false,
    patch: '@@ -82,13 +82,18 @@\n- setDraft(emptyDraft);\n- await submitCheckout(payload);\n+ const result = await submitCheckout(payload);\n+ if (result.ok) {\n+   setDraft(emptyDraft);\n+ }\n+ setFieldErrors(result.fieldErrors);',
  },
  {
    path: 'src/checkout/CheckoutForm.test.tsx',
    status: 'M', additions: 48, deletions: 2, binary: false,
    patch: '@@ -144,6 +144,21 @@\n+it("keeps the customer draft after a failed request", async () => {\n+  await submitRejectedCheckout();\n+  expect(screen.getByLabelText("Email")).toHaveValue("ian@example.com");\n+});',
  },
  {
    path: 'src/checkout/validation.ts',
    status: 'A', additions: 29, deletions: 0, binary: false,
    patch: '@@ -0,0 +1,29 @@\n+export function checkoutErrors(draft: CheckoutDraft) {\n+  return validateFields(draft, checkoutRules);\n+}',
  },
];


function sideSessions(count = 9): CodingSession[] {
  const titles = [
    'Add keyboard navigation to command menu',
    'Fix Windows path handling in imports',
    'Tighten billing webhook verification',
    'Document the local development setup',
    'Reduce dashboard query fan-out',
    'Update empty states for first-run teams',
    'Investigate flaky export test',
    'Add CSV delimiter detection',
    'Remove legacy feature flag bridge',
    'Improve project search ranking',
    'Migrate toast timing to shared tokens',
    'Audit settings form focus order',
  ];
  return titles.slice(0, count).map((title, index) => session({
    id: `task-side-${index}`,
    title,
    status: index === 0 ? 'running' : index === 1 ? 'awaiting_approval' : index === 2 ? 'failed' : 'completed',
    repository_root: index % 3 === 0 ? '/Users/developer/Projects/cowork' : index % 3 === 1 ? '/Users/developer/Projects/cowork-server' : ROOT,
    source_path: index % 3 === 0 ? '/Users/developer/Projects/cowork' : index % 3 === 1 ? '/Users/developer/Projects/cowork-server' : ROOT,
    workspace_path: `/Users/developer/.cowork/coding/worktrees/task-side-${index}`,
    created_at: `2026-08-${String(20 - Math.floor(index / 3)).padStart(2, '0')}T12:00:00Z`,
    updated_at: `2026-08-21T${String(18 - index).padStart(2, '0')}:30:00Z`,
    pending_approval: null,
    last_error: index === 2 ? 'The model connection closed before the turn completed.' : null,
  }));
}


function fixtureState(name: string) {
  let primary = session();
  let events = [...BASE_EVENTS];
  let files = [...FILES];

  if (name === 'running' || name === 'sidebar') {
    primary = session({ status: 'running', active_turn_id: 'turn-1', updated_at: NOW });
    events = BASE_EVENTS.slice(0, 8).map((item) => item.seq === 8 ? { ...item, phase: 'progress' as const } : item);
  } else if (name === 'approval') {
    primary = session({
      status: 'awaiting_approval',
      active_turn_id: 'turn-1',
      pending_approval: {
        id: 'approval-1',
        kind: 'command',
        title: 'Run the full frontend test suite?',
        detail: 'npm test -- --runInBand',
        cwd: WORKTREE,
        risk: 'This command can execute package scripts in the task workspace.',
        scope: 'task',
        allow_session: true,
      },
    });
    events = BASE_EVENTS.slice(0, 7);
  } else if (name === 'retry' || name === 'failed') {
    const retryEvents = Array.from({ length: name === 'retry' ? 5 : 1 }, (_, index) => event(11 + index, 'error', {
      title: 'Agent connection lost',
      text: `The model connection closed before a response was complete. Reconnecting… ${index + 1}/${name === 'retry' ? 5 : 1}`,
      phase: 'failed',
    }));
    primary = session({ status: 'failed', last_error: 'The model connection closed before the turn completed.', event_count: 10 + retryEvents.length });
    events = [...BASE_EVENTS.slice(0, 8), ...retryEvents];
    files = [];
  } else if (name === 'stopped') {
    primary = session({ status: 'cancelled' });
    events = BASE_EVENTS.slice(0, 8);
  } else if (name === 'interrupted') {
    primary = session({ status: 'interrupted' });
    events = BASE_EVENTS.slice(0, 8);
  } else if (name === 'direct') {
    primary = session({
      status: 'completed',
      source_path: '/Users/developer/Documents/small-site',
      workspace_path: '/Users/developer/Documents/small-site',
      workspace_kind: 'direct_folder',
      repository_root: null,
      base_revision: null,
      source_dirty: false,
      workspace_warning: 'This task edits the selected folder directly and has no Git-backed recovery.',
    });
  } else if (name === 'long') {
    events = [...BASE_EVENTS.slice(0, 9), event(12, 'agent_message', {
      title: 'Agent',
      text: `## Implementation summary\n\n${'The checkout flow now preserves user-entered information while mapping server failures back to individual fields. '.repeat(16)}\n\n\`\`\`ts\nconst result = await submitCheckout(draft);\nif (!result.ok) setFieldErrors(result.fieldErrors);\n\`\`\``,
    })];
  } else if (name === 'many-files') {
    files = Array.from({ length: 18 }, (_, index) => ({
      ...FILES[index % FILES.length],
      path: index < FILES.length ? FILES[index].path : `src/checkout/components/RecoveryState${index}.tsx`,
      additions: 8 + index,
      deletions: index % 5,
    }));
  }

  const sessions = [primary, ...sideSessions(name === 'sidebar' ? 12 : 6)];
  return { primary, events, files, sessions };
}


function copy<T>(value: T): T {
  return structuredClone(value);
}


export function getCodeFixtureApi() {
  const name = activeFixtureName();
  if (!name) return null;
  const state = fixtureState(name);
  let sessions = name === 'new' || name === 'empty' ? [] : state.sessions;
  const eventMap = new Map<string, CodingEvent[]>([[state.primary.id, state.events]]);
  const fileMap = new Map<string, DiffFile[]>([[state.primary.id, state.files]]);

  const selected = (id: string) => {
    const found = sessions.find((item) => item.id === id);
    if (!found) throw new Error('coding session not found');
    return found;
  };
  const update = (id: string, values: Partial<CodingSession>) => {
    sessions = sessions.map((item) => item.id === id ? { ...item, ...values, updated_at: NOW } : item);
    return selected(id);
  };
  const git = (id: string): GitState => {
    const item = selected(id);
    return {
      is_git: item.workspace_kind === 'git_worktree',
      branch: item.workspace_kind === 'git_worktree' ? null : undefined,
      revision: item.base_revision,
      detached: item.workspace_kind === 'git_worktree',
      dirty: (fileMap.get(id) || []).length > 0,
      status_lines: (fileMap.get(id) || []).map((file) => `${file.status} ${file.path}`),
      worktree_path: item.workspace_path,
      source_path: item.source_path,
    };
  };

  const engines: EngineCapability[] = [{
    id: 'codex', label: 'Codex', adapter_version: '1', available: true,
    supports_steering: true, supports_approvals: true, supports_reasoning: true,
    supports_diff_events: true, supports_models: true,
    supports_terminal: true,
  }];

  return {
    engines: async () => copy(engines),
    models: async () => ({ items: [DEFAULT_CODING_AGENT_MODEL, 'fable', 'sonnet', 'gpt-5.5-mini'] }),
    inspect: async (path: string): Promise<WorkspaceInspection> => ({
      path, exists: true, is_directory: true, is_git: true, repository_root: path,
      branch: 'staging', revision: '91ef52ea6f3ab14d', dirty: false,
    }),
    sessions: async (includeArchived = false) => {
      if (name === 'error') throw new Error('Could not reach the local coding service.');
      if (name === 'loading') await new Promise((resolve) => window.setTimeout(resolve, 8_000));
      return { items: copy(includeArchived ? sessions : sessions.filter((item) => !item.archived)) };
    },
    session: async (id: string) => copy(selected(id)),
    workspaceFiles: async () => ({ items: [] }),
    extensions: async () => ({
      skills: [{ id: 'review', label: 'Review', description: 'Review completed work', status: 'enabled', detail: 'user', path: '/skills/review/SKILL.md' }],
      mcp_servers: [], hooks: [], apps: [], plugins: [], errors: [],
    }),
    platformStatus: async () => ({ platform: 'darwin', windows_sandbox: null }),
    setupWindowsSandbox: async () => ({ platform: 'win32', windows_sandbox: 'ready', setup_started: true }),
    updateSession: async (id: string, body: Partial<CodingSession>) => copy(update(id, body)),
    renameSession: async (id: string, title: string) => copy(update(id, { title })),
    setArchived: async (id: string, archived: boolean) => copy(update(id, { archived })),
    forkSession: async (id: string) => {
      const parent = selected(id);
      const forked = session({ ...parent, id: `${parent.id}-fork`, title: `${parent.title} (fork)`, archived: false });
      sessions = [forked, ...sessions];
      eventMap.set(forked.id, copy(eventMap.get(parent.id) || []));
      fileMap.set(forked.id, copy(fileMap.get(parent.id) || []));
      return copy(forked);
    },
    deleteSession: async (id: string) => { sessions = sessions.filter((item) => item.id !== id); },
    events: async (id: string, after = 0) => {
      const items = (eventMap.get(id) || []).filter((item) => item.seq > after);
      return { items: copy(items), next_seq: items.at(-1)?.seq || after };
    },
    create: async (body: SessionCreateBody) => {
      const created = session({
        id: 'task-created', title: body.prompt.slice(0, 72), source_path: body.path,
        workspace_path: `${body.path}/.cowork-task`, repository_root: body.path,
        engine_id: body.engine_id || 'codex', model: body.model || DEFAULT_CODING_AGENT_MODEL,
        permission_mode: body.permission_mode || 'supervised', status: 'running',
      });
      sessions = [created, ...sessions];
      eventMap.set(created.id, [event(1, 'user_message', { text: body.prompt })]);
      fileMap.set(created.id, []);
      return copy(created);
    },
    turn: async (id: string, prompt: string) => {
      const events = eventMap.get(id) || [];
      events.push(event(events.length + 1, 'user_message', { text: prompt }));
      eventMap.set(id, events);
      return copy(update(id, { status: 'running' }));
    },
    steer: async (id: string, prompt: string) => {
      const events = eventMap.get(id) || [];
      events.push(event(events.length + 1, 'user_message', { title: 'Guidance', text: prompt }));
      eventMap.set(id, events);
      return copy(selected(id));
    },
    queue: async (id: string, prompt: string) => copy(update(id, {
      queued_instructions: [
        ...(selected(id).queued_instructions || []),
        { id: `queue-${Date.now()}`, prompt, created_at: NOW },
      ],
    })),
    removeQueued: async (id: string, instructionId: string) => copy(update(id, {
      queued_instructions: (selected(id).queued_instructions || []).filter((item) => item.id !== instructionId),
    })),
    runQueued: async (id: string) => copy(selected(id)),
    cancel: async (id: string) => copy(update(id, { status: 'cancelled', active_turn_id: null })),
    approve: async (id: string, _approvalId: string, decision: string) => copy(update(id, {
      status: decision === 'deny' ? 'cancelled' : 'running', pending_approval: null,
    })),
    git: async (id: string) => copy(git(id)),
    diff: async (id: string) => ({ files: copy(fileMap.get(id) || []) }),
    branch: async (id: string, branch: string) => ({ ...copy(git(id)), branch, detached: false }),
    commit: async (id: string, _message: string) => copy(git(id)),
    apply: async (_id: string) => ({ status: 'applied', snapshot: '/tmp/cowork-recovery.patch' }),
    terminal: async () => ({ status: 'stopped' as const, items: [], first_seq: 0, next_seq: 0 }),
    startTerminal: async () => ({ status: 'running' as const, process_id: 'fixture-terminal', items: [], first_seq: 0, next_seq: 0 }),
    terminalInput: async () => ({ status: 'running' as const, process_id: 'fixture-terminal', items: [], first_seq: 0, next_seq: 0 }),
    resizeTerminal: async () => ({ status: 'running' as const, process_id: 'fixture-terminal', items: [], first_seq: 0, next_seq: 0 }),
    stopTerminal: async () => ({ status: 'exited' as const, process_id: 'fixture-terminal', items: [], first_seq: 0, next_seq: 0, exit_code: 0 }),
  };
}
