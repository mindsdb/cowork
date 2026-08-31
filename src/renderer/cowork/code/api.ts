import { getApiOrigin, isElectron, serverStart } from '../../platform/host';
import { getCodeFixtureApi } from './fixtures';
import type {
  CodeComputer,
  ComputerStatus,
  ProjectCommand,
  ProjectFolder,
  ProjectResource,
  ProjectResourceState,
  ResourceAvailability,
  TaskRunStatus,
} from './resourceModels';

export { projectResources } from './resourceModels';
export type {
  CodeComputer,
  ComputerStatus,
  LocalFolderResource,
  ProjectCommand,
  ProjectFolder,
  ProjectResource,
  ProjectResourceState,
  RepositoryResource,
  ResourceAvailability,
  TaskRunStatus,
} from './resourceModels';

export type CodingStatus =
  | 'ready'
  | 'running'
  | 'awaiting_approval'
  | 'completed'
  | 'cancelled'
  | 'interrupted'
  | 'failed';

export type PermissionMode = 'read_only' | 'supervised' | 'workspace' | 'full_access';
export type ApprovalDecision = 'approve_once' | 'approve_session' | 'deny';

export interface SessionCreateBody {
  path?: string;
  project_id?: string;
  resource_ids?: string[];
  computer_id?: string;
  prompt: string;
  allow_direct_folder?: boolean;
  engine_id?: string;
  model?: string;
  permission_mode?: PermissionMode;
  reasoning_effort?: ReasoningEffort | null;
  service_tier?: ServiceTier;
  personality?: Personality;
  network_access?: boolean;
  web_search?: boolean;
  additional_dirs?: string[];
  attachments?: InputReference[];
  source_contexts?: SourceContext[];
}

interface CreateCodeTaskBase {
  prompt: string;
  engineId: string;
  model: string;
  permissionMode: PermissionMode;
  attachments: InputReference[];
  sourceContexts: SourceContext[];
  resourceIds?: string[];
  computerId?: string;
}

export type CreateCodeTaskInput = CreateCodeTaskBase & (
  | { projectId: string; path?: never }
  | { projectId: null; path: string }
);

export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
export type ServiceTier = 'standard' | 'priority';
export type Personality = 'none' | 'friendly' | 'pragmatic';

export interface RuntimeControls {
  model: string;
  permission_mode: PermissionMode;
  reasoning_effort: ReasoningEffort | null;
  service_tier: ServiceTier;
  personality: Personality;
  network_access: boolean;
  web_search: boolean;
  additional_dirs: string[];
}

export interface RuntimeRegistrationToken {
  registration_token: string;
  expires_in_seconds: number;
}

export interface RecoveryOption {
  computer: CodeComputer;
  mode: 'restore' | 'recreate';
  preserves_workspace_changes: boolean;
  recommended: boolean;
  detail: string;
}

export interface RecoveryPlan {
  run_id: string;
  options: RecoveryOption[];
}

export type SessionUpdateBody = Partial<RuntimeControls>;

export interface PendingApproval {
  id: string;
  kind: string;
  title: string;
  detail: string;
  cwd?: string | null;
  risk: string;
  scope: string;
  allow_session: boolean;
}

export interface ResolvedSkill {
  id: string;
  kind: 'skill' | 'instructions' | 'workflow';
  name: string;
  description: string;
  origin: 'team' | 'personal' | 'built_in';
  source_id?: string | null;
  source_name: string;
  source_path: string;
  version?: string | null;
  content_hash: string;
}

export interface TaskCapabilities {
  files: boolean;
  review: boolean;
  terminal: boolean;
  project_actions: boolean;
  slash_commands: boolean;
  task_controls: boolean;
  extensions: boolean;
  platform_settings: boolean;
  fork: boolean;
  open_workspace: boolean;
}

export interface CodingSession {
  schema_version: number;
  id: string;
  title: string;
  engine_id: string;
  engine_adapter_version: string;
  model: string;
  permission_mode: PermissionMode;
  reasoning_effort?: ReasoningEffort | null;
  service_tier?: ServiceTier;
  personality?: Personality;
  network_access?: boolean;
  web_search?: boolean;
  additional_dirs?: string[];
  status: CodingStatus;
  project_id?: string | null;
  project_name?: string | null;
  task_id?: string | null;
  run_id?: string | null;
  computer_id?: string | null;
  run_status?: TaskRunStatus | null;
  computer_name?: string | null;
  computer_status?: ComputerStatus | null;
  computer_is_local?: boolean;
  task_capabilities?: TaskCapabilities;
  resource_ids?: string[];
  scope_all_project_resources?: boolean;
  runtime_epoch?: number;
  source_path: string;
  workspace_path: string;
  workspace_kind: 'git_worktree' | 'local_copy' | 'direct_folder';
  workspaces?: TaskWorkspace[];
  repository_root?: string | null;
  base_revision?: string | null;
  source_dirty: boolean;
  workspace_warning?: string | null;
  guidance_summary?: string | null;
  resolved_skills?: ResolvedSkill[];
  skill_roots?: string[];
  skill_instructions?: string;
  allocated_ports?: Record<string, number>;
  source_contexts?: SourceContext[];
  deliveries?: DeliveryRecord[];
  delivery_policy?: DeliveryAutomationPolicy;
  engine_session_id?: string | null;
  active_turn_id?: string | null;
  pending_approval?: PendingApproval | null;
  queued_instructions?: QueuedInstruction[];
  pinned?: boolean;
  archived?: boolean;
  last_error?: string | null;
  event_count: number;
  created_at: string;
  updated_at: string;
}

export interface DeliveryAutomationPolicy {
  fix_failing_checks: boolean;
  mark_ready_when_passing: boolean;
  merge_when_approved: boolean;
  complete_source_after_merge: boolean;
  archive_after_merge: boolean;
  max_fix_attempts: number;
}

export interface QueuedInstruction {
  id: string;
  prompt: string;
  created_at: string;
  attachments?: InputReference[];
}

export interface InputReference {
  name: string;
  path: string;
  kind: 'mention' | 'local_image';
  resource_id?: string;
  relative_path?: string;
  line_start?: number;
  line_end?: number;
  content_hash?: string;
}

export interface ExtensionEntry {
  id: string;
  label: string;
  description: string;
  status: string;
  detail: string;
  path?: string | null;
}

export interface ExtensionInventory {
  skills: ExtensionEntry[];
  mcp_servers: ExtensionEntry[];
  hooks: ExtensionEntry[];
  apps: ExtensionEntry[];
  plugins: ExtensionEntry[];
  errors: string[];
  config_path?: string | null;
}

export interface RuntimePlatformStatus {
  platform: string;
  windows_sandbox?: string | null;
  setup_started?: boolean;
}

export interface CodingEvent {
  schema_version: number;
  seq: number;
  timestamp: string;
  type: 'session' | 'user_message' | 'agent_message' | 'reasoning' | 'plan' | 'tool' | 'command' | 'file_change' | 'diff' | 'child_work' | 'approval' | 'usage' | 'error';
  title: string;
  text: string;
  phase?: 'started' | 'progress' | 'completed' | 'failed' | 'pending' | null;
  item_id?: string | null;
  turn_id?: string | null;
  data: Record<string, unknown>;
}

export interface WorkspaceInspection {
  path: string;
  exists: boolean;
  is_directory: boolean;
  is_git: boolean;
  repository_root?: string | null;
  branch?: string | null;
  revision?: string | null;
  dirty: boolean;
  warning?: string | null;
}

export interface TaskWorkspace {
  folder_id: string;
  folder_name: string;
  source_path: string;
  workspace_path: string;
  workspace_kind: 'git_worktree' | 'local_copy' | 'direct_folder';
  repository_root?: string | null;
  base_revision?: string | null;
  base_branch?: string | null;
  task_branch?: string | null;
  source_dirty: boolean;
}

export interface GitState {
  folder_id?: string | null;
  folder_name?: string | null;
  is_git: boolean;
  branch?: string | null;
  revision?: string | null;
  detached: boolean;
  dirty: boolean;
  status_lines: string[];
  worktree_path: string;
  source_path: string;
}

export interface ProjectCommandResult {
  command_id: string;
  label: string;
  folder_id: string;
  phase: 'setup' | 'validate';
  return_code: number;
  output: string;
}

export interface ProjectActionRunResponse {
  terminal_id: string;
  label: string;
  preview_url?: string | null;
}

export interface ProjectActionSummary {
  id: string;
  resource_id: string;
  label: string;
  resource_name: string;
}

export interface ProjectActionPage {
  items: ProjectActionSummary[];
  preview_url?: string | null;
}

export interface ProjectFolderInspection {
  folder: ProjectFolder;
  inspection: WorkspaceInspection;
  base_branch_available: boolean;
}

export interface ProjectConnection {
  provider: 'github' | 'linear' | 'slack';
  name: string;
  label: string;
}

export interface PlaybookReference {
  repository: string;
  branch: string;
  applied_revision?: string | null;
  available_revision?: string | null;
  cache_path?: string | null;
  last_checked_at?: string | null;
}

export interface ProjectSkillSource {
  source_id: string;
  enabled_paths: string[];
}

export interface CodeProject {
  schema_version: number;
  id: string;
  name: string;
  resources: ProjectResource[];
  folders: ProjectFolder[];
  playbook?: PlaybookReference | null;
  skill_sources?: ProjectSkillSource[];
  connections: ProjectConnection[];
  environment: { variables: Record<string, string>; port_names: string[] };
  default_engine_id: string;
  default_model: string;
  permission_mode: PermissionMode;
  created_at: string;
  updated_at: string;
}

export interface SkillLibraryItem {
  id: string;
  kind: 'skill' | 'instructions' | 'workflow';
  name: string;
  description: string;
  origin: 'team' | 'personal' | 'built_in';
  source_id?: string | null;
  source_name: string;
  path: string;
  version?: string | null;
  enabled: boolean;
  enabled_project_ids: string[];
}

export interface SkillLibrarySource {
  id: string;
  name: string;
  repository: string;
  branch: string;
  current_revision: string;
  available_revision: string;
  update_available: boolean;
  last_checked_at: string;
  item_count: number;
  enabled_project_count: number;
  diff: string;
  error?: string | null;
}

export interface SkillLibraryPage {
  sources: SkillLibrarySource[];
  items: SkillLibraryItem[];
}

export interface SkillLibraryDocument {
  item: SkillLibraryItem;
  files: string[];
  selected_path: string;
  content: string;
}

export interface PlaybookItem {
  kind: 'skill' | 'instructions' | 'workflow';
  name: string;
  path: string;
  description: string;
  enabled: boolean;
}

export interface PlaybookStatus {
  configured: boolean;
  current_revision?: string | null;
  available_revision?: string | null;
  update_available: boolean;
  items: PlaybookItem[];
  diff: string;
  error?: string | null;
}

export interface SourceContext {
  provider: 'github' | 'linear' | 'slack';
  kind: 'issue' | 'pull_request' | 'conversation';
  url: string;
  title: string;
  external_id: string;
  connection_name?: string | null;
  body: string;
  state?: string;
  author?: string;
  comments?: SourceComment[];
  attachments?: SourceAttachment[];
}

export interface WorkItemSummary {
  provider: 'github' | 'linear';
  kind: 'issue' | 'pull_request';
  url: string;
  title: string;
  external_id: string;
  state: string;
  scope: string;
  assignee: string;
  updated_at: string;
  connection_name: string;
}

export interface WorkItemPage {
  items: WorkItemSummary[];
  incomplete: boolean;
}

export interface SourceComment {
  id: string;
  author: string;
  body: string;
  url: string;
  created_at: string;
}

export interface SourceAttachment {
  id: string;
  title: string;
  url: string;
}

export interface DeliveryRecord {
  provider: 'github' | 'linear' | 'slack';
  action: 'progress' | 'result' | 'draft_pull_request' | 'complete_source';
  target_url: string;
  status: 'pending' | 'published' | 'failed';
  external_url?: string | null;
  detail: string;
  folder_id?: string | null;
  folder_name?: string | null;
  base_branch?: string | null;
  task_branch?: string | null;
  connection_name?: string | null;
  created_at: string;
}

export interface PullRequestStatus {
  state: 'draft' | 'open' | 'merged' | 'closed';
  review_state: 'approved' | 'changes_requested' | 'pending' | 'none';
  ci_state: 'passing' | 'failing' | 'pending' | 'none';
  number?: number | null;
  title?: string;
  url?: string;
  updated_at?: string;
  checks?: PullRequestCheck[];
  feedback?: PullRequestFeedback[];
  detail: string;
}

export interface PullRequestCheck {
  id?: string;
  name: string;
  state: 'passing' | 'failing' | 'pending' | 'neutral';
  url: string;
  detail?: string;
  annotations?: PullRequestAnnotation[];
}

export interface PullRequestAnnotation {
  path: string;
  start_line?: number | null;
  end_line?: number | null;
  level: 'notice' | 'warning' | 'failure';
  title: string;
  message: string;
}

export interface PullRequestFeedback {
  id: string;
  author: string;
  state: string;
  body: string;
  url: string;
  path: string;
  line?: number | null;
  created_at: string;
  thread_id?: string;
  resolved?: boolean;
  outdated?: boolean;
}

export interface DeliveryPlanItem {
  folder_id: string;
  folder_name: string;
  workspace_path: string;
  remote_url?: string | null;
  base_branch?: string | null;
  task_branch?: string | null;
  status: 'ready' | 'needs_commit' | 'no_changes' | 'unavailable' | 'published';
  detail: string;
  external_url?: string | null;
  connection_name?: string | null;
  pull_request_status?: PullRequestStatus | null;
  status_error?: string | null;
}

export interface DeliveryPlan {
  items: DeliveryPlanItem[];
  integrations?: IntegrationStatus[];
}

export interface IntegrationStatus {
  provider: 'github' | 'linear' | 'slack';
  connection_name: string;
  label: string;
  status: 'connected' | 'reconnect' | 'missing';
  detail: string;
}

export interface DiffFile {
  folder_id?: string | null;
  folder_name?: string | null;
  path: string;
  status: string;
  additions: number;
  deletions: number;
  patch: string;
  binary: boolean;
  staged?: boolean;
  unstaged?: boolean;
}

export interface EngineCapability {
  manifest_version?: number;
  id: string;
  label: string;
  adapter_version: string;
  available: boolean;
  reason?: string | null;
  supports_steering?: boolean;
  supports_approvals?: boolean;
  supports_reasoning?: boolean;
  supports_diff_events?: boolean;
  supports_models?: boolean;
  supports_terminal?: boolean;
  features?: Record<string, 'supported' | 'unsupported'>;
  commands?: EngineCommand[];
}

export interface EngineCommand {
  name: string;
  label: string;
  description: string;
  argument_hint?: string | null;
  action: 'turn' | 'goal' | 'compact' | 'status' | 'client';
  client_action?: 'controls' | 'skills' | 'mcp' | 'fork' | 'terminal' | null;
}

export type TerminalStatus = 'stopped' | 'running' | 'exited' | 'failed';
export type TerminalShellPreference = 'auto' | 'bash' | 'zsh' | 'fish' | 'system' | 'pwsh' | 'powershell' | 'cmd';

export interface TerminalShellInventory {
  platform: string;
  resolved: TerminalShellPreference;
  items: Array<{ id: TerminalShellPreference; label: string }>;
}

export interface TerminalChunk {
  seq: number;
  data_base64: string;
  stream: 'stdout' | 'stderr';
  cap_reached: boolean;
  timestamp: string;
}

export interface TerminalPage {
  process_id?: string | null;
  status: TerminalStatus;
  items: TerminalChunk[];
  first_seq: number;
  next_seq: number;
  exit_code?: number | null;
  error?: string | null;
}

export interface TerminalTab {
  id: string;
  label: string;
  created_at: string;
}

export interface TerminalTabState extends TerminalTab {
  status: TerminalStatus;
  exit_code?: number | null;
  error?: string | null;
}

export interface TerminalTabPage {
  items: TerminalTabState[];
}

const EVENT_TYPES = new Set<CodingEvent['type']>([
  'session', 'user_message', 'agent_message', 'reasoning', 'plan', 'tool',
  'command', 'file_change', 'diff', 'child_work', 'approval', 'usage', 'error',
]);
const EVENT_PHASES = new Set<NonNullable<CodingEvent['phase']>>([
  'started', 'progress', 'completed', 'failed', 'pending',
]);

export async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${getApiOrigin()}/api/v1/coding${path}`;
  const method = (init?.method || 'GET').toUpperCase();
  // Every write gets a sidecar preflight. Retrying after fetch fails would be
  // unsafe because the server may already have committed the mutation; making
  // availability an invariant at this shared boundary gives projects, tasks,
  // approvals, and future writes the same recovery behavior without replaying
  // any of them.
  if (method !== 'GET' && method !== 'HEAD') await ensureCodeService();
  const request = {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  };
  let response: Response;
  try {
    response = await fetch(url, request);
  } catch (error) {
    // Reads are safe to repeat. If the desktop sidecar disappeared, ask main
    // to recover it and retry once. Mutations are deliberately not replayed:
    // the server may have committed one before the connection dropped.
    if (!isElectron || (method !== 'GET' && method !== 'HEAD')) throw error;
    const recovered = await serverStart();
    if (!recovered.running) {
      throw new Error(recovered.error || 'The local Code service could not start.');
    }
    response = await fetch(url, request);
  }
  if (!response.ok) {
    let detail = `Coding request failed (${response.status})`;
    try {
      const body = await response.json();
      if (typeof body?.detail === 'string') detail = body.detail;
    } catch {
      // Preserve the status-based message when an intermediary returns HTML.
    }
    if (response.status === 404 && detail === 'Not Found') {
      detail = 'This desktop build is connected to an older backend that does not support Code Mode. Restart the app with the matching cowork-server build.';
    }
    throw new Error(detail);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

async function ensureCodeService(): Promise<void> {
  if (!isElectron) return;
  const result = await serverStart();
  if (!result.running) {
    throw new Error(result.error || 'The local Code service could not start.');
  }
}

const liveCodingApi = {
  engines: () => requestJson<EngineCapability[]>('/engines'),
  models: (engineId: string) => requestJson<{ items: string[] }>(`/models?engineId=${encodeURIComponent(engineId)}`),
  inspect: (path: string) => requestJson<WorkspaceInspection>(`/workspace/inspect?path=${encodeURIComponent(path)}`),
  projects: () => requestJson<{ items: CodeProject[] }>('/projects'),
  project: (id: string) => requestJson<CodeProject>(`/projects/${encodeURIComponent(id)}`),
  projectFolders: (id: string) => requestJson<{ items: ProjectFolderInspection[] }>(`/projects/${encodeURIComponent(id)}/folders`),
  projectResources: (id: string) => requestJson<{ items: ProjectResourceState[] }>(`/projects/${encodeURIComponent(id)}/resources`),
  projectComputers: (id: string, resourceIds: string[] | undefined, engineId?: string) => {
    const query = new URLSearchParams();
    resourceIds?.forEach((resourceId) => query.append('resourceId', resourceId));
    if (engineId) query.set('engineId', engineId);
    const suffix = query.size ? `?${query.toString()}` : '';
    return requestJson<{ items: CodeComputer[] }>(`/projects/${encodeURIComponent(id)}/computers${suffix}`);
  },
  computers: () => requestJson<{ items: CodeComputer[] }>('/computers'),
  computerRegistrationToken: () => requestJson<RuntimeRegistrationToken>('/runtime/registration-token', {
    method: 'POST',
  }),
  renameComputer: (id: string, name: string) => requestJson<CodeComputer>(`/computers/${encodeURIComponent(id)}`, {
    method: 'PATCH', body: JSON.stringify({ name }),
  }),
  revokeComputer: (id: string) => requestJson<void>(`/computers/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  }),
  resolveLocalResource: (body: ProjectFolder) => requestJson<ProjectResource>('/project-resources/inspect', {
    method: 'POST', body: JSON.stringify(body),
  }),
  createProject: (body: Pick<CodeProject, 'name' | 'resources' | 'connections' | 'environment' | 'skill_sources' | 'default_engine_id' | 'default_model' | 'permission_mode'>) =>
    requestJson<CodeProject>('/projects', { method: 'POST', body: JSON.stringify(body) }),
  updateProject: (id: string, body: Partial<CodeProject>) => requestJson<CodeProject>(`/projects/${encodeURIComponent(id)}`, {
    method: 'PATCH', body: JSON.stringify(body),
  }),
  deleteProject: (id: string) => requestJson<void>(`/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  skillLibrary: (projectId?: string | null) => requestJson<SkillLibraryPage>(
    `/skills/library${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`,
  ),
  skillDocument: (itemId: string, path?: string) => requestJson<SkillLibraryDocument>(
    `/skills/library/content?itemId=${encodeURIComponent(itemId)}${path ? `&path=${encodeURIComponent(path)}` : ''}`,
  ),
  addSkillSource: (body: { name?: string; repository: string; branch: string }) => requestJson<SkillLibrarySource>('/skills/sources', {
    method: 'POST', body: JSON.stringify(body),
  }),
  refreshSkillSource: (id: string) => requestJson<SkillLibrarySource>(`/skills/sources/${encodeURIComponent(id)}/refresh`, { method: 'POST' }),
  applySkillSource: (id: string) => requestJson<SkillLibrarySource>(`/skills/sources/${encodeURIComponent(id)}/apply`, { method: 'POST' }),
  removeSkillSource: (id: string) => requestJson<void>(`/skills/sources/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  setProjectSkillSource: (projectId: string, sourceId: string, enabledPaths: string[]) => requestJson<SkillLibraryPage>(
    `/projects/${encodeURIComponent(projectId)}/skills/${encodeURIComponent(sourceId)}`,
    { method: 'PUT', body: JSON.stringify({ enabled_paths: enabledPaths }) },
  ),
  setSkillSourceProjects: (sourceId: string, assignments: Array<{ project_id: string; enabled_paths: string[] }>) => requestJson<SkillLibraryPage>(
    `/skills/sources/${encodeURIComponent(sourceId)}/projects`,
    { method: 'PUT', body: JSON.stringify({ assignments }) },
  ),
  configurePlaybook: (id: string, repository: string, branch: string) => requestJson<PlaybookStatus>(`/projects/${encodeURIComponent(id)}/playbook`, {
    method: 'POST', body: JSON.stringify({ repository, branch }),
  }),
  playbook: (id: string) => requestJson<PlaybookStatus>(`/projects/${encodeURIComponent(id)}/playbook`),
  removePlaybook: (id: string) => requestJson<void>(`/projects/${encodeURIComponent(id)}/playbook`, { method: 'DELETE' }),
  refreshPlaybook: (id: string) => requestJson<PlaybookStatus>(`/projects/${encodeURIComponent(id)}/playbook/refresh`, { method: 'POST' }),
  applyPlaybook: (id: string) => requestJson<PlaybookStatus>(`/projects/${encodeURIComponent(id)}/playbook/apply`, { method: 'POST' }),
  setPlaybookItems: (id: string, enabledPaths: string[]) => requestJson<PlaybookStatus>(`/projects/${encodeURIComponent(id)}/playbook/items`, {
    method: 'POST', body: JSON.stringify({ enabled_paths: enabledPaths }),
  }),
  integrations: (id: string) => requestJson<{ items: IntegrationStatus[] }>(`/projects/${encodeURIComponent(id)}/integrations`),
  readSourceContext: (id: string, body: Omit<SourceContext, 'title' | 'external_id' | 'body'>) => requestJson<SourceContext>(`/projects/${encodeURIComponent(id)}/source-context`, {
    method: 'POST', body: JSON.stringify(body),
  }),
  searchWorkItems: (id: string, body: { provider: 'github' | 'linear'; query: string; connection_name?: string | null; limit?: number }) => requestJson<WorkItemPage>(`/projects/${encodeURIComponent(id)}/work-items/search`, {
    method: 'POST', body: JSON.stringify(body),
  }),
  sessions: (includeArchived = false) => requestJson<{ items: CodingSession[] }>(`/sessions?includeArchived=${includeArchived}`),
  session: (id: string) => requestJson<CodingSession>(`/sessions/${encodeURIComponent(id)}`),
  workspaceFiles: (id: string, query = '') => requestJson<{ items: InputReference[] }>(
    `/sessions/${encodeURIComponent(id)}/workspace/files?query=${encodeURIComponent(query)}`,
  ),
  extensions: (id: string) => requestJson<ExtensionInventory>(`/sessions/${encodeURIComponent(id)}/extensions`),
  platformStatus: (id: string) => requestJson<RuntimePlatformStatus>(`/sessions/${encodeURIComponent(id)}/platform`),
  setupWindowsSandbox: (id: string) => requestJson<RuntimePlatformStatus>(`/sessions/${encodeURIComponent(id)}/windows-sandbox/setup`, { method: 'POST' }),
  updateSession: (id: string, body: SessionUpdateBody) => requestJson<CodingSession>(`/sessions/${encodeURIComponent(id)}`, {
    method: 'PATCH', body: JSON.stringify(body),
  }),
  deleteSession: (id: string) => requestJson<void>(`/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  renameSession: (id: string, title: string) => requestJson<CodingSession>(`/sessions/${encodeURIComponent(id)}/rename`, {
    method: 'POST', body: JSON.stringify({ title }),
  }),
  setPinned: (id: string, pinned: boolean) => requestJson<CodingSession>(`/sessions/${encodeURIComponent(id)}/${pinned ? 'pin' : 'unpin'}`, { method: 'POST' }),
  setArchived: (id: string, archived: boolean) => requestJson<CodingSession>(`/sessions/${encodeURIComponent(id)}/${archived ? 'archive' : 'unarchive'}`, { method: 'POST' }),
  forkSession: (id: string) => requestJson<CodingSession>(`/sessions/${encodeURIComponent(id)}/fork`, { method: 'POST' }),
  events: (id: string, after = 0) => requestJson<{ items: CodingEvent[]; next_seq: number }>(`/sessions/${encodeURIComponent(id)}/events?after=${after}`),
  create: (body: SessionCreateBody) =>
    requestJson<CodingSession>('/sessions', { method: 'POST', body: JSON.stringify(body) }),
  turn: (id: string, prompt: string, attachments: InputReference[] = []) =>
    requestJson<CodingSession>(`/sessions/${encodeURIComponent(id)}/turns`, { method: 'POST', body: JSON.stringify({ prompt, attachments }) }),
  steer: (id: string, prompt: string, attachments: InputReference[] = []) =>
    requestJson<CodingSession>(`/sessions/${encodeURIComponent(id)}/steer`, { method: 'POST', body: JSON.stringify({ prompt, attachments }) }),
  queue: (id: string, prompt: string, attachments: InputReference[] = []) =>
    requestJson<CodingSession>(`/sessions/${encodeURIComponent(id)}/queue`, { method: 'POST', body: JSON.stringify({ prompt, attachments }) }),
  removeQueued: (id: string, instructionId: string) =>
    requestJson<CodingSession>(`/sessions/${encodeURIComponent(id)}/queue/${encodeURIComponent(instructionId)}`, { method: 'DELETE' }),
  steerQueued: (id: string, instructionId: string) =>
    requestJson<CodingSession>(`/sessions/${encodeURIComponent(id)}/queue/${encodeURIComponent(instructionId)}/steer`, { method: 'POST' }),
  runQueued: (id: string) =>
    requestJson<CodingSession>(`/sessions/${encodeURIComponent(id)}/queue/run`, { method: 'POST' }),
  cancel: (id: string) => requestJson<CodingSession>(`/sessions/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
  recoveryOptions: (id: string) => requestJson<RecoveryPlan>(
    `/sessions/${encodeURIComponent(id)}/recovery-options`,
  ),
  recover: (id: string, computerId?: string, allowRecreate = false) => requestJson<CodingSession>(`/sessions/${encodeURIComponent(id)}/recover`, {
    method: 'POST', body: JSON.stringify({ computer_id: computerId || null, allow_recreate: allowRecreate }),
  }),
  approve: (id: string, approvalId: string, decision: ApprovalDecision) =>
    requestJson<CodingSession>(`/sessions/${encodeURIComponent(id)}/approvals/${encodeURIComponent(approvalId)}`, {
      method: 'POST',
      body: JSON.stringify({ decision }),
    }),
  git: (id: string) => requestJson<GitState>(`/sessions/${encodeURIComponent(id)}/git`),
  diff: (id: string) => requestJson<{ files: DiffFile[] }>(`/sessions/${encodeURIComponent(id)}/diff`),
  reviewFile: (id: string, body: { folder_id?: string | null; path: string; action: 'stage' | 'unstage' | 'discard' }) =>
    requestJson<{ files: DiffFile[] }>(`/sessions/${encodeURIComponent(id)}/review/file`, {
      method: 'POST', body: JSON.stringify(body),
    }),
  branch: (id: string, name: string) => requestJson<GitState>(`/sessions/${encodeURIComponent(id)}/branch`, { method: 'POST', body: JSON.stringify({ name }) }),
  commit: (id: string, message: string) => requestJson<GitState>(`/sessions/${encodeURIComponent(id)}/commit`, { method: 'POST', body: JSON.stringify({ message }) }),
  apply: (id: string) => requestJson<{ status: string; snapshot?: string | null }>(`/sessions/${encodeURIComponent(id)}/apply`, { method: 'POST' }),
  validate: (id: string) => requestJson<{ items: ProjectCommandResult[] }>(`/sessions/${encodeURIComponent(id)}/validate`, { method: 'POST' }),
  runProjectAction: (id: string, body: { resource_id: string; command_id: string; shell?: TerminalShellPreference; cols?: number; rows?: number }) =>
    requestJson<ProjectActionRunResponse>(`/sessions/${encodeURIComponent(id)}/project-actions/run`, {
      method: 'POST', body: JSON.stringify(body),
    }),
  projectActions: (id: string) => requestJson<ProjectActionPage>(`/sessions/${encodeURIComponent(id)}/project-actions`),
  deliveryPlan: (id: string) => requestJson<DeliveryPlan>(`/sessions/${encodeURIComponent(id)}/delivery`),
  updateDeliveryPolicy: (id: string, body: DeliveryAutomationPolicy) => requestJson<CodingSession>(`/sessions/${encodeURIComponent(id)}/delivery-policy`, {
    method: 'PUT', body: JSON.stringify(body),
  }),
  claimDeliveryAutomation: (id: string, fingerprint: string) => requestJson<{ claimed: boolean; attempts: number; limit: number }>(`/sessions/${encodeURIComponent(id)}/delivery-automation/claim`, {
    method: 'POST', body: JSON.stringify({ fingerprint }),
  }),
  draftPullRequests: (id: string, body: { title: string; body: string; drafts?: Array<{ folder_id: string; title: string; body: string }>; connection_name?: string | null; confirmed: boolean }) => requestJson<{ items: DeliveryRecord[] }>(`/sessions/${encodeURIComponent(id)}/draft-pull-requests`, {
    method: 'POST', body: JSON.stringify(body),
  }),
  pullRequestAction: (id: string, body: { action: 'ready' | 'merge' | 'resolve_thread'; target_url: string; connection_name?: string | null; thread_id?: string | null; confirmed: boolean }) => requestJson<PullRequestStatus>(`/sessions/${encodeURIComponent(id)}/pull-request-action`, {
    method: 'POST', body: JSON.stringify(body),
  }),
  publish: (id: string, body: { provider: 'github' | 'linear' | 'slack'; action: 'progress' | 'result'; target_url: string; text: string; connection_name?: string | null; confirmed: boolean }) => requestJson<DeliveryRecord>(`/sessions/${encodeURIComponent(id)}/publish`, {
    method: 'POST', body: JSON.stringify(body),
  }),
  completeSource: (id: string, body: { provider: 'github' | 'linear'; action: 'complete'; target_url: string; connection_name?: string | null; confirmed: boolean }) => requestJson<DeliveryRecord>(`/sessions/${encodeURIComponent(id)}/source-action`, {
    method: 'POST', body: JSON.stringify(body),
  }),
  terminals: (id: string) => requestJson<TerminalTabPage>(`/sessions/${encodeURIComponent(id)}/terminals`),
  terminalShells: () => requestJson<TerminalShellInventory>('/terminal-shells'),
  createTerminal: (id: string, label?: string) => requestJson<TerminalTabState>(`/sessions/${encodeURIComponent(id)}/terminals`, {
    method: 'POST', body: JSON.stringify({ label: label || null }),
  }),
  renameTerminal: (id: string, terminalId: string, label: string) => requestJson<TerminalTabState>(
    `/sessions/${encodeURIComponent(id)}/terminals/${encodeURIComponent(terminalId)}`,
    { method: 'PATCH', body: JSON.stringify({ label }) },
  ),
  deleteTerminal: (id: string, terminalId: string) => requestJson<void>(
    `/sessions/${encodeURIComponent(id)}/terminals/${encodeURIComponent(terminalId)}`,
    { method: 'DELETE' },
  ),
  terminal: (id: string, terminalId: string, after = 0) => requestJson<TerminalPage>(
    `/sessions/${encodeURIComponent(id)}/terminals/${encodeURIComponent(terminalId)}?after=${after}`,
  ),
  startTerminal: (id: string, terminalId: string, cols: number, rows: number, shell: TerminalShellPreference = 'auto') => requestJson<TerminalPage>(
    `/sessions/${encodeURIComponent(id)}/terminals/${encodeURIComponent(terminalId)}/start`,
    { method: 'POST', body: JSON.stringify({ cols, rows, shell }) },
  ),
  terminalInput: (id: string, terminalId: string, dataBase64: string) => requestJson<TerminalPage>(
    `/sessions/${encodeURIComponent(id)}/terminals/${encodeURIComponent(terminalId)}/input`,
    { method: 'POST', body: JSON.stringify({ data_base64: dataBase64 }) },
  ),
  resizeTerminal: (id: string, terminalId: string, cols: number, rows: number) => requestJson<TerminalPage>(
    `/sessions/${encodeURIComponent(id)}/terminals/${encodeURIComponent(terminalId)}/resize`,
    { method: 'POST', body: JSON.stringify({ cols, rows }) },
  ),
  stopTerminal: (id: string, terminalId: string) => requestJson<TerminalPage>(
    `/sessions/${encodeURIComponent(id)}/terminals/${encodeURIComponent(terminalId)}/stop`,
    { method: 'POST' },
  ),
};

const fixtureCodingApi = getCodeFixtureApi();
export const codingApi: typeof liveCodingApi = fixtureCodingApi
  ? { ...liveCodingApi, ...fixtureCodingApi }
  : liveCodingApi;

export function openCodingEventStream(
  sessionId: string,
  after: number,
  onEvent: (event: CodingEvent) => void,
  onError: () => void,
): () => void {
  if (fixtureCodingApi) return () => {};
  const url = `${getApiOrigin()}/api/v1/coding/sessions/${encodeURIComponent(sessionId)}/stream?after=${after}`;
  const source = new EventSource(url);
  source.addEventListener('coding-event', (raw) => {
    try {
      const parsed: unknown = JSON.parse((raw as MessageEvent).data);
      if (isCodingEvent(parsed)) onEvent(parsed);
    } catch {
      // The sidecar validates its own output, but an OTA renderer may meet an
      // older/newer schema. Ignore malformed frames rather than crashing UI.
    }
  });
  source.onerror = onError;
  return () => source.close();
}

export function openCodingTerminalStream(
  sessionId: string,
  terminalId: string,
  after: number,
  onOutput: (chunk: TerminalChunk) => void,
  onState: (state: TerminalPage) => void,
  onError: () => void,
): () => void {
  if (fixtureCodingApi) return () => {};
  const url = `${getApiOrigin()}/api/v1/coding/sessions/${encodeURIComponent(sessionId)}/terminals/${encodeURIComponent(terminalId)}/stream?after=${after}`;
  const source = new EventSource(url);
  source.addEventListener('terminal-output', (raw) => {
    try {
      const parsed: unknown = JSON.parse((raw as MessageEvent).data);
      if (isTerminalChunk(parsed)) onOutput(parsed);
    } catch {
      // Ignore malformed sidecar frames; a compatible later frame can still
      // keep the live terminal usable during mixed-version desktop updates.
    }
  });
  source.addEventListener('terminal-state', (raw) => {
    try {
      const parsed: unknown = JSON.parse((raw as MessageEvent).data);
      if (isTerminalPage(parsed)) {
        onState(parsed);
        source.close();
      }
    } catch {
      // See terminal-output handling above.
    }
  });
  source.onerror = onError;
  return () => source.close();
}

export function isCodingEvent(value: unknown): value is CodingEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Partial<CodingEvent>;
  return event.schema_version === 1
    && Number.isInteger(event.seq)
    && (event.seq ?? -1) >= 0
    && typeof event.timestamp === 'string'
    && typeof event.type === 'string'
    && EVENT_TYPES.has(event.type as CodingEvent['type'])
    && typeof event.title === 'string'
    && typeof event.text === 'string'
    && (event.phase == null || EVENT_PHASES.has(event.phase))
    && (event.item_id == null || typeof event.item_id === 'string')
    && (event.turn_id == null || typeof event.turn_id === 'string')
    && !!event.data
    && typeof event.data === 'object'
    && !Array.isArray(event.data);
}

export function isTerminalChunk(value: unknown): value is TerminalChunk {
  if (!value || typeof value !== 'object') return false;
  const chunk = value as Partial<TerminalChunk>;
  return Number.isInteger(chunk.seq)
    && (chunk.seq ?? -1) > 0
    && typeof chunk.data_base64 === 'string'
    && (chunk.stream === 'stdout' || chunk.stream === 'stderr')
    && typeof chunk.cap_reached === 'boolean'
    && typeof chunk.timestamp === 'string';
}

export function isTerminalPage(value: unknown): value is TerminalPage {
  if (!value || typeof value !== 'object') return false;
  const page = value as Partial<TerminalPage>;
  return ['stopped', 'running', 'exited', 'failed'].includes(page.status || '')
    && Number.isInteger(page.next_seq)
    && Number.isInteger(page.first_seq)
    && Array.isArray(page.items)
    && page.items.every(isTerminalChunk)
    && (page.process_id == null || typeof page.process_id === 'string')
    && (page.exit_code == null || Number.isInteger(page.exit_code))
    && (page.error == null || typeof page.error === 'string');
}
