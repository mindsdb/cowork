import type {
  CodingEvent,
  CodingSession,
  CodeComputer,
  CodeProject,
  DiffFile,
  EngineCapability,
  GitState,
  SessionCreateBody,
  ProjectFolder,
  ProjectResource,
  SkillLibraryItem,
  WorkspaceInspection,
} from './api';
import { DEFAULT_CODING_AGENT_MODEL } from './defaults';


const NOW = '2026-08-21T19:40:00Z';
const ROOT = '/Users/developer/Projects/atlas-web';
const WORKTREE = '/Users/developer/.cowork/coding/worktrees/atlas-web/task-73c4';
// Keep visual QA representative of the production coding-model contract. A
// deliberately tiny fixture made a healthy catalogue look regressed when the
// fixture build was mistaken for the signed-in app.
const FIXTURE_MODEL_IDS = [
  'mindshub_air', 'qwen', 'deepseek', 'sonnet', 'fable', 'gpt-mini',
  'gpt-nano', 'gpt-luna', 'kimi', 'glm', 'grok', 'gpt-codex',
  'gemini-flash', 'grok-4-5', 'gpt-terra', 'gpt', 'opus', 'muse-spark',
  'haiku', 'gemini',
];


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
  } else if (name.startsWith('delivery-')) {
    const workspaces = [
      {
        folder_id: 'app', folder_name: 'Atlas web', source_path: ROOT, workspace_path: WORKTREE,
        workspace_kind: 'git_worktree' as const, repository_root: ROOT,
        base_revision: '91ef52ea6f3ab14d', base_branch: 'staging', task_branch: 'cowork/atlas/task-73c4', source_dirty: false,
      },
      {
        folder_id: 'server', folder_name: 'Atlas API', source_path: '/Users/developer/Projects/atlas-api',
        workspace_path: '/Users/developer/.cowork/coding/worktrees/atlas-api/task-73c4',
        workspace_kind: 'git_worktree' as const, repository_root: '/Users/developer/Projects/atlas-api',
        base_revision: '38ad71b4ef201c0a', base_branch: 'staging', task_branch: 'cowork/atlas/task-73c4-server', source_dirty: false,
      },
    ];
    primary = session({
      project_id: 'project-atlas',
      project_name: 'Atlas',
      workspaces,
      source_contexts: [{
        provider: 'linear', kind: 'issue', url: 'https://linear.app/mindsdb/issue/ENG-421',
        title: 'Preserve checkout details after a failed request', external_id: 'ENG-421',
        connection_name: 'linear-work', body: 'Improve checkout recovery.', state: 'In Review',
        author: 'Ian', comments: [{
          id: 'comment-1', author: 'Reviewer', body: 'Please cover the recovery path.',
          url: 'https://linear.app/mindsdb/issue/ENG-421#comment-1', created_at: NOW,
        }], attachments: [],
      }],
      deliveries: name === 'delivery-review' ? [{
        provider: 'github', action: 'draft_pull_request', target_url: 'https://github.com/mindsdb/atlas-web.git',
        status: 'published', external_url: 'https://github.com/mindsdb/atlas-web/pull/142',
        detail: 'Draft pull request created', folder_id: 'app', folder_name: 'Atlas web',
        base_branch: 'staging', task_branch: 'cowork/atlas/task-73c4', connection_name: 'github-work', created_at: NOW,
      }, {
        provider: 'linear', action: 'result', target_url: 'https://linear.app/mindsdb/issue/ENG-421',
        status: 'published', external_url: 'https://linear.app/mindsdb/issue/ENG-421#comment-finish',
        detail: 'Published with Linear work', connection_name: 'linear-work', created_at: NOW,
      }] : [],
    });
    files = FILES.map((file, index) => ({
      ...file,
      folder_id: index === FILES.length - 1 ? 'server' : 'app',
      folder_name: index === FILES.length - 1 ? 'Atlas API' : 'Atlas web',
    }));
  }

  const sessions = [primary, ...sideSessions(name === 'sidebar' ? 12 : 6)];
  return { primary, events, files, sessions };
}


function copy<T>(value: T): T {
  return structuredClone(value);
}


function taskTitle(prompt: string): string {
  const compact = prompt.trim().replace(/\s+/g, ' ');
  if (!compact) return 'Coding task';
  return compact.length <= 72 ? compact : `${compact.slice(0, 71).trimEnd()}…`;
}


export function getCodeFixtureApi() {
  const name = activeFixtureName();
  if (!name) return null;
  const state = fixtureState(name);
  let sessions = name === 'new' || name === 'empty' || name === 'work-search' ? [] : state.sessions;
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
  let projects: CodeProject[] = [{
    schema_version: 2,
    id: 'project-atlas',
    name: 'Atlas',
    resources: [{
      kind: 'repository', id: 'atlas-web', name: 'atlas-web',
      source_url: 'https://github.com/mindsdb/atlas-web.git', local_path: ROOT,
      computer_id: null, default_branch: 'staging', checkout_strategy: 'worktree', commands: [],
    }],
    folders: [{ id: 'atlas-web', name: 'atlas-web', path: ROOT, base_branch: 'staging', commands: [] }],
    skill_sources: [],
    connections: name.startsWith('delivery-') || name === 'work-search' ? [
      { provider: 'github', name: 'github-work', label: 'MindsDB GitHub' },
      { provider: 'linear', name: 'linear-work', label: 'MindsDB Linear' },
    ] : [],
    environment: { variables: {}, port_names: ['PORT'] },
    default_engine_id: 'codex',
    default_model: DEFAULT_CODING_AGENT_MODEL,
    permission_mode: 'supervised',
    created_at: NOW,
    updated_at: NOW,
  }];
  const fixtureComputer: CodeComputer = {
    schema_version: 1,
    id: 'fixture-computer',
    name: 'This computer',
    status: 'online',
    active_run_count: 0,
    last_seen_at: NOW,
    capabilities: {
      platform: 'darwin', architecture: 'arm64', runtime_version: '2.0.7',
      protocol_versions: ['1.0'], agent_engines: ['codex'], shells: ['bash', 'zsh'],
      has_git: true, has_terminal: true, supports_local_folders: true, max_concurrent_runs: 4,
    },
  };
  const skillItems: SkillLibraryItem[] = [
    { id: 'source-engineering:review/SKILL.md', kind: 'skill', name: 'Code review', description: 'Review changes against team engineering standards.', origin: 'team', source_id: 'source-engineering', source_name: 'Engineering standards', path: 'review/SKILL.md', version: 'a1b2c3d4e5f6', enabled: true, enabled_project_ids: ['project-atlas'] },
    { id: 'source-engineering:AGENTS.md', kind: 'instructions', name: 'AGENTS.md', description: '', origin: 'team', source_id: 'source-engineering', source_name: 'Engineering standards', path: 'AGENTS.md', version: 'a1b2c3d4e5f6', enabled: true, enabled_project_ids: ['project-atlas'] },
    { id: 'personal:review', kind: 'skill', name: 'Review', description: 'Run a fresh, skeptical pass over completed work.', origin: 'personal', source_name: 'Yours', path: 'review', enabled: true, enabled_project_ids: [] },
    { id: 'personal:craft-ui', kind: 'skill', name: 'Craft world-class UI', description: 'Design and verify polished product interfaces.', origin: 'built_in', source_name: 'MindsHub', path: 'craft-ui', enabled: true, enabled_project_ids: [] },
    { id: 'personal:thermo-nuclear-code-quality-review', kind: 'skill', name: 'Thermo-Nuclear Code Quality Review', description: 'Run an extremely strict maintainability review for abstraction quality, giant files, and spaghetti-condition growth.', origin: 'built_in', source_name: 'MindsHub', path: 'thermo-nuclear-code-quality-review', enabled: true, enabled_project_ids: [] },
  ];

  const skillLibraryPage = () => ({
    sources: [{
      id: 'source-engineering', name: 'Engineering standards', repository: 'https://github.com/mindsdb/engineering-skills',
      branch: 'main', current_revision: 'a1b2c3d4e5f6', available_revision: 'a1b2c3d4e5f6',
      update_available: false, last_checked_at: NOW, item_count: 2,
      enabled_project_count: projects.filter((project) => (project.skill_sources || []).some(
        (source) => source.source_id === 'source-engineering' && source.enabled_paths.length > 0,
      )).length,
      diff: '',
    }],
    items: copy(skillItems),
  });
  const assignSkillSource = (projectId: string, sourceId: string, enabledPaths: string[]) => {
    const enabled = new Set(enabledPaths);
    projects = projects.map((project) => {
      if (project.id !== projectId) return project;
      const skillSources = (project.skill_sources || []).filter((source) => source.source_id !== sourceId);
      if (enabledPaths.length) {
        skillSources.push({ source_id: sourceId, enabled_paths: [...enabledPaths].sort() });
      }
      return { ...project, skill_sources: skillSources, updated_at: NOW };
    });
    for (const item of skillItems) {
      if (item.source_id !== sourceId) continue;
      const projectIds = new Set(item.enabled_project_ids);
      if (enabled.has(item.path)) projectIds.add(projectId);
      else projectIds.delete(projectId);
      item.enabled_project_ids = [...projectIds];
      item.enabled = item.enabled_project_ids.length > 0;
    }
  };

  return {
    engines: async () => copy(engines),
    models: async () => ({ items: [...FIXTURE_MODEL_IDS] }),
    inspect: async (path: string): Promise<WorkspaceInspection> => ({
      path, exists: true, is_directory: true, is_git: true, repository_root: path,
      branch: 'staging', revision: '91ef52ea6f3ab14d', dirty: false,
    }),
    projects: async () => ({ items: copy(projects) }),
    project: async (id: string) => copy(projects.find((item) => item.id === id) || projects[0]),
    projectFolders: async (id: string) => ({
      items: (projects.find((item) => item.id === id)?.folders || []).map((folder) => ({
        folder: copy(folder),
        inspection: {
          path: folder.path, exists: true, is_directory: true, is_git: true,
          repository_root: folder.path, branch: folder.base_branch || 'staging',
          revision: '91ef52ea6f3ab14d', dirty: false,
        },
        base_branch_available: true,
      })),
    }),
    projectResources: async (id: string) => ({
      items: (projects.find((item) => item.id === id)?.resources || []).map((resource) => ({
        resource: copy(resource),
        availability: {
          resource_id: resource.id,
          status: 'available' as const,
          eligible_computer_ids: [fixtureComputer.id],
          required_computer_id: resource.kind === 'local_folder' ? fixtureComputer.id : null,
          detail: '',
        },
      })),
    }),
    projectComputers: async () => ({ items: [copy(fixtureComputer)] }),
    computers: async () => ({ items: [copy(fixtureComputer)] }),
    resolveLocalResource: async (folder: ProjectFolder): Promise<ProjectResource> => ({
      kind: 'repository', id: folder.id, name: folder.name,
      source_url: `https://github.com/mindsdb/${folder.name}.git`, local_path: folder.path,
      computer_id: null, default_branch: folder.base_branch, checkout_strategy: 'worktree',
      commands: folder.commands,
    }),
    createProject: async (body: Pick<CodeProject, 'name' | 'resources' | 'skill_sources' | 'connections' | 'environment' | 'default_engine_id' | 'default_model' | 'permission_mode'>) => {
      const created: CodeProject = {
        schema_version: 2, id: `project-${Date.now()}`, ...body,
        folders: body.resources.map((resource) => ({
          id: resource.id, name: resource.name,
          path: resource.kind === 'repository' ? resource.local_path || resource.source_url || resource.name : resource.path,
          base_branch: resource.kind === 'repository' ? resource.default_branch : null,
          commands: resource.commands,
        })),
        created_at: NOW, updated_at: NOW,
      };
      projects = [created, ...projects];
      return copy(created);
    },
    updateProject: async (id: string, body: Partial<CodeProject>) => {
      projects = projects.map((item) => item.id === id ? { ...item, ...body, updated_at: NOW } : item);
      return copy(projects.find((item) => item.id === id) || projects[0]);
    },
    deleteProject: async (id: string) => { projects = projects.filter((item) => item.id !== id); },
    skillLibrary: async () => skillLibraryPage(),
    skillDocument: async (itemId: string, selectedPath?: string) => {
      const item = skillItems.find((candidate) => candidate.id === itemId);
      if (!item) throw new Error('Skill not found.');
      const files = item.kind === 'skill' ? ['SKILL.md', 'references/checklist.md'] : [item.path];
      const path = selectedPath || files[0];
      if (!files.includes(path)) throw new Error('Skill file not found.');
      const content = path === 'references/checklist.md'
        ? '# Review checklist\n\n- Inspect the complete diff.\n- Run focused verification.\n- Report only evidence-backed findings.'
        : `---\nname: ${item.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}\ndescription: ${item.description}\n---\n\n# ${item.name}\n\n${item.description}\n\n## How to use it\n\nApply this guidance deliberately, verify the result, and report material findings clearly.`;
      return { item: copy(item), files, selected_path: path, content };
    },
    addSkillSource: async () => ({ id: 'source-new', name: 'Team skills', repository: ROOT, branch: 'main', current_revision: 'abc123', available_revision: 'abc123', update_available: false, last_checked_at: NOW, item_count: 1, enabled_project_count: 0, diff: '' }),
    refreshSkillSource: async () => ({ id: 'source-engineering', name: 'Engineering standards', repository: ROOT, branch: 'main', current_revision: 'a1b2c3', available_revision: 'a1b2c3', update_available: false, last_checked_at: NOW, item_count: 2, enabled_project_count: 1, diff: '' }),
    applySkillSource: async () => ({ id: 'source-engineering', name: 'Engineering standards', repository: ROOT, branch: 'main', current_revision: 'a1b2c3', available_revision: 'a1b2c3', update_available: false, last_checked_at: NOW, item_count: 2, enabled_project_count: 1, diff: '' }),
    removeSkillSource: async () => undefined,
    setProjectSkillSource: async (projectId: string, sourceId: string, enabledPaths: string[]) => {
      assignSkillSource(projectId, sourceId, enabledPaths);
      return skillLibraryPage();
    },
    setSkillSourceProjects: async (sourceId: string, assignments: Array<{ project_id: string; enabled_paths: string[] }>) => {
      for (const assignment of assignments) {
        assignSkillSource(assignment.project_id, sourceId, assignment.enabled_paths);
      }
      return skillLibraryPage();
    },
    configurePlaybook: async () => ({ configured: true, update_available: false, items: [], diff: '' }),
    playbook: async () => ({ configured: false, update_available: false, items: [], diff: '' }),
    removePlaybook: async () => undefined,
    refreshPlaybook: async () => ({ configured: true, update_available: false, items: [], diff: '' }),
    applyPlaybook: async () => ({ configured: true, update_available: false, items: [], diff: '' }),
    setPlaybookItems: async () => ({ configured: true, update_available: false, items: [], diff: '' }),
    integrations: async () => ({ items: [] }),
    readSourceContext: async (_id: string, body: { provider: 'github' | 'linear' | 'slack'; kind: 'issue' | 'pull_request' | 'conversation'; url: string }) => ({
      ...body, title: 'Linked work', external_id: 'fixture-1', body: 'Fixture source context',
    }),
    searchWorkItems: async (_id: string, body: { provider: 'github' | 'linear'; query: string; connection_name?: string | null }) => ({
      incomplete: false,
      items: [{
        provider: body.provider,
        kind: 'issue' as const,
        url: body.provider === 'github' ? 'https://github.com/mindsdb/cowork/issues/42' : 'https://linear.app/mindsdb/issue/ENG-42',
        title: body.query || 'Improve Code delivery',
        external_id: body.provider === 'github' ? 'mindsdb/cowork#42' : 'ENG-42',
        state: 'Open',
        scope: body.provider === 'github' ? 'mindsdb/cowork' : 'Engineering',
        assignee: 'Ian',
        updated_at: NOW,
        connection_name: body.connection_name || `${body.provider}-work`,
      }],
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
      const project = projects.find((item) => item.id === body.project_id)
        || (body.path ? undefined : projects[0]);
      const sourcePath = body.path || project?.folders[0]?.path || ROOT;
      const created = session({
        id: 'task-created', title: taskTitle(body.prompt), source_path: sourcePath,
        workspace_path: `${sourcePath}/.cowork-task`, repository_root: sourcePath,
        project_id: project?.id, project_name: project?.name,
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
    steerQueued: async (id: string, instructionId: string) => {
      const instruction = (selected(id).queued_instructions || []).find((item) => item.id === instructionId);
      if (!instruction) throw new Error('Queued instruction not found');
      const events = eventMap.get(id) || [];
      events.push(event(events.length + 1, 'user_message', { title: 'Guidance', text: instruction.prompt }));
      eventMap.set(id, events);
      return copy(update(id, {
        queued_instructions: (selected(id).queued_instructions || []).filter((item) => item.id !== instructionId),
      }));
    },
    runQueued: async (id: string) => copy(selected(id)),
    cancel: async (id: string) => copy(update(id, { status: 'cancelled', active_turn_id: null })),
    recover: async (id: string) => copy(update(id, {
      status: 'ready',
      run_status: 'recovering',
      computer_status: 'online',
      last_error: null,
    })),
    approve: async (id: string, _approvalId: string, decision: string) => copy(update(id, {
      status: decision === 'deny' ? 'cancelled' : 'running', pending_approval: null,
    })),
    git: async (id: string) => copy(git(id)),
    diff: async (id: string) => ({ files: copy(fileMap.get(id) || []) }),
    branch: async (id: string, branch: string) => ({ ...copy(git(id)), branch, detached: false }),
    commit: async (id: string, _message: string) => copy(git(id)),
    apply: async (_id: string) => ({ status: 'applied', snapshot: '/tmp/cowork-recovery.patch' }),
    validate: async () => ({ items: [] }),
    deliveryPlan: async () => {
      const connected = [{
        provider: 'github' as const, connection_name: 'github-work', label: 'MindsDB GitHub',
        status: name === 'delivery-blocked' ? 'reconnect' as const : 'connected' as const,
        detail: name === 'delivery-blocked' ? 'Reconnect to continue using this tool' : '',
      }];
      const baseItems = [
        {
          folder_id: 'app', folder_name: 'Atlas web', workspace_path: WORKTREE,
          remote_url: 'https://github.com/mindsdb/atlas-web.git', base_branch: 'staging',
          task_branch: 'cowork/atlas/task-73c4', status: 'ready' as const, detail: '',
        },
        {
          folder_id: 'server', folder_name: 'Atlas API', workspace_path: '/Users/developer/.cowork/coding/worktrees/atlas-api/task-73c4',
          remote_url: 'https://github.com/mindsdb/atlas-api.git', base_branch: 'staging',
          task_branch: 'cowork/atlas/task-73c4-server', status: 'ready' as const, detail: '',
        },
      ];
      if (name === 'delivery-blocked') {
        return { integrations: connected, items: [
          { ...baseItems[0], status: 'needs_commit' as const, detail: 'Commit this folder before creating its draft pull request' },
          { ...baseItems[1], status: 'unavailable' as const, detail: 'Add an origin remote before creating a draft pull request' },
        ] };
      }
      if (name === 'delivery-review') {
        return { integrations: connected, items: [{
          ...baseItems[0], status: 'published' as const,
          external_url: 'https://github.com/mindsdb/atlas-web/pull/142', connection_name: 'github-work',
          pull_request_status: {
            state: 'open' as const, review_state: 'changes_requested' as const, ci_state: 'failing' as const,
            number: 142, title: 'Refine checkout validation and recovery states',
            url: 'https://github.com/mindsdb/atlas-web/pull/142', updated_at: NOW,
            checks: [
              {
                id: 'check-frontend', name: 'Frontend tests', state: 'failing' as const,
                url: 'https://github.com/mindsdb/atlas-web/actions/runs/1', detail: 'Checkout recovery › retains customer details after a rejected request',
                annotations: [{
                  path: 'src/checkout/CheckoutForm.test.tsx', start_line: 167, end_line: 167,
                  level: 'failure' as const, title: 'Expected the email field to retain its value', message: 'Received an empty string.',
                }],
              },
              { name: 'Lint', state: 'passing' as const, url: 'https://github.com/mindsdb/atlas-web/actions/runs/2' },
            ],
            feedback: [{
              id: 'review-1', author: 'reviewer', state: 'changes_requested',
              body: 'Please retain the draft if validation itself fails.',
              url: 'https://github.com/mindsdb/atlas-web/pull/142#discussion_r1',
              path: 'src/checkout/CheckoutForm.tsx', line: 96, thread_id: 'thread-review-1',
              resolved: false, outdated: false, created_at: NOW,
            }], detail: '',
          },
        }, baseItems[1]] };
      }
      return { items: baseItems, integrations: connected };
    },
    updateDeliveryPolicy: async (id: string, policy: NonNullable<CodingSession['delivery_policy']>) => copy(update(id, { delivery_policy: policy })),
    claimDeliveryAutomation: async () => ({ claimed: true, attempts: 1, limit: 2 }),
    draftPullRequests: async (_id: string, body: { title: string }) => ({ items: [{
      provider: 'github' as const, action: 'draft_pull_request' as const,
      target_url: 'https://github.com/mindsdb/atlas-web.git', status: 'published' as const,
      external_url: 'https://github.com/mindsdb/atlas-web/pull/101', detail: body.title,
      folder_id: 'app', folder_name: 'Atlas web', base_branch: 'staging',
      task_branch: 'cowork/atlas/task-73c4', created_at: NOW,
    }] }),
    pullRequestAction: async (_id: string, body: { action: 'ready' | 'merge' | 'resolve_thread'; target_url: string }) => ({
      state: body.action === 'merge' ? 'merged' as const : 'open' as const,
      review_state: 'approved' as const,
      ci_state: 'passing' as const,
      number: 101,
      title: 'Improve checkout recovery',
      url: body.target_url,
      updated_at: NOW,
      checks: [],
      feedback: [],
      detail: body.action === 'merge' ? 'Merged' : 'Ready for review',
    }),
    publish: async (_id: string, body: { provider: 'github' | 'linear' | 'slack'; action: 'progress' | 'result'; target_url: string }) => ({
      ...body, status: 'published' as const, detail: 'Published', created_at: NOW, external_url: body.target_url,
    }),
    completeSource: async (_id: string, body: { provider: 'github' | 'linear'; target_url: string }) => ({
      ...body, action: 'complete_source' as const, status: 'published' as const,
      detail: 'Marked complete', created_at: NOW, external_url: body.target_url,
    }),
    terminals: async () => ({ items: [{ id: 'fixture-terminal', label: 'Terminal 1', created_at: NOW, status: 'stopped' as const }] }),
    terminalShells: async () => ({
      platform: 'darwin',
      resolved: 'bash' as const,
      items: [
        { id: 'auto' as const, label: 'Automatic — Bash' },
        { id: 'bash' as const, label: 'Bash' },
        { id: 'zsh' as const, label: 'zsh' },
        { id: 'system' as const, label: 'System default — zsh' },
      ],
    }),
    createTerminal: async () => ({ id: 'fixture-terminal-2', label: 'Terminal 2', created_at: NOW, status: 'stopped' as const }),
    renameTerminal: async (_id: string, terminalId: string, label: string) => ({ id: terminalId, label, created_at: NOW, status: 'running' as const }),
    deleteTerminal: async () => undefined,
    terminal: async () => ({ status: 'stopped' as const, items: [], first_seq: 0, next_seq: 0 }),
    startTerminal: async () => ({ status: 'running' as const, process_id: 'fixture-terminal', items: [], first_seq: 0, next_seq: 0 }),
    terminalInput: async () => ({ status: 'running' as const, process_id: 'fixture-terminal', items: [], first_seq: 0, next_seq: 0 }),
    resizeTerminal: async () => ({ status: 'running' as const, process_id: 'fixture-terminal', items: [], first_seq: 0, next_seq: 0 }),
    stopTerminal: async () => ({ status: 'exited' as const, process_id: 'fixture-terminal', items: [], first_seq: 0, next_seq: 0, exit_code: 0 }),
  };
}
