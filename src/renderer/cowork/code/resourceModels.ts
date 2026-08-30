export interface ProjectCommand {
  id: string;
  label: string;
  argv: string[];
  phase: 'setup' | 'validate';
}

export interface ProjectFolder {
  id: string;
  name: string;
  path: string;
  base_branch?: string | null;
  commands: ProjectCommand[];
}

interface ProjectResourceBase {
  id: string;
  name: string;
  commands: ProjectCommand[];
}

export interface RepositoryResource extends ProjectResourceBase {
  kind: 'repository';
  source_url?: string | null;
  provider?: 'github' | 'gitlab' | 'bitbucket' | 'git';
  repository?: string | null;
  connector_name?: string | null;
  local_path?: string | null;
  computer_id?: string | null;
  default_branch?: string | null;
  checkout_strategy: 'worktree' | 'clone';
}

export interface LocalFolderResource extends ProjectResourceBase {
  kind: 'local_folder';
  path: string;
  computer_id: string;
}

export type ProjectResource = RepositoryResource | LocalFolderResource;

export interface ResourceAvailability {
  resource_id: string;
  status: 'available' | 'offline' | 'unavailable';
  eligible_computer_ids: string[];
  required_computer_id?: string | null;
  detail: string;
}

export interface ProjectResourceState {
  resource: ProjectResource;
  availability: ResourceAvailability;
}

export type ComputerStatus = 'online' | 'offline' | 'draining';

export interface CodeComputer {
  schema_version: number;
  id: string;
  name: string;
  status: ComputerStatus;
  active_run_count: number;
  last_seen_at: string;
  capabilities: {
    platform: 'darwin' | 'windows' | 'linux';
    architecture: string;
    runtime_version: string;
    protocol_versions: string[];
    agent_engines: string[];
    shells: string[];
    has_git: boolean;
    has_terminal: boolean;
    supports_local_folders: boolean;
    max_concurrent_runs: number;
  };
}

export type TaskRunStatus =
  | 'queued'
  | 'preparing'
  | 'ready'
  | 'running'
  | 'awaiting_approval'
  | 'completed'
  | 'cancelled'
  | 'interrupted'
  | 'failed'
  | 'recovering';

export function projectResources(project: {
  resources?: ProjectResource[];
  folders: ProjectFolder[];
}): ProjectResource[] {
  if (Array.isArray(project.resources)) return project.resources;
  return project.folders.map((folder) => ({
    kind: 'local_folder',
    id: folder.id,
    name: folder.name,
    path: folder.path,
    computer_id: 'local',
    commands: folder.commands,
  }));
}
