import { useMemo, useRef, useState } from 'react';
import Ico from '../components/Icons';
import {
  CollectionState, FilterChips, FilterMenu, FilterRow, ListGroup, PageHeader, SearchInput, SortPill,
  useCollectionShortcut, type Filter, type StatusTone,
} from '../components/collection';
import Alert from '../components/ui/Alert';
import Button from '../components/ui/Button';
import Menu from '../components/ui/Menu';
import { projectResources, type CodeProject, type CodingSession } from './api';
import { codingSessionStatus } from './presentation';
import { TaskRow } from '../components/task/TaskRows';
import { projectActions } from './projectActions';
import { useCodeTaskMenu, type CodeTaskListActions } from './useCodeTaskMenu';
import './code-tasks.css';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'attention', label: 'Needs attention' },
  { value: 'accent', label: 'In progress' },
  { value: 'success', label: 'Completed' },
  { value: 'danger', label: 'Failed' },
  { value: 'neutral', label: 'Ready or stopped' },
];

const SORT_OPTIONS = [
  { id: 'updated', label: 'Recently updated' },
  { id: 'created', label: 'Recently created' },
  { id: 'title', label: 'Title' },
];

const TONE: Record<ReturnType<typeof codingSessionStatus>['tone'], StatusTone> = {
  warning: 'warning', accent: 'accent', success: 'success', danger: 'danger', neutral: 'muted',
};

export function CodeTasksView({
  sessions, projects, projectId = null, active = true, loading, error,
  onOpen, onOpenProject, onNewTask, onEditProject, onDeleteProject, onBack, onRetry, taskActions,
}: {
  sessions: CodingSession[];
  projects: CodeProject[];
  projectId?: string | null;
  active?: boolean;
  loading: boolean;
  error: string;
  onOpen: (id: string) => void;
  onOpenProject: (id: string) => void;
  onNewTask: (projectId: string | null) => void;
  onEditProject: (id: string) => void;
  onDeleteProject: (id: string) => void;
  onBack: () => void;
  onRetry: () => void;
  taskActions?: CodeTaskListActions;
}) {
  const [query, setQuery] = useState('');
  const [projectFilter, setProjectFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [archived, setArchived] = useState(false);
  const [sort, setSort] = useState('updated');
  const inputRef = useRef<HTMLInputElement>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const taskMenu = useCodeTaskMenu({
    onTogglePinned: (task) => {
      const pinned = !task.pinned;
      setActionError(null);
      taskActions?.onSetPinned(task.id, pinned)
        .catch(() => setActionError(`Couldn't ${pinned ? 'pin' : 'unpin'} this task.`));
    },
    onRename: (id, title) => taskActions!.onRename(id, title),
    onSetArchived: (id, archive) => taskActions!.onSetArchived(id, archive),
    onDelete: (id) => taskActions!.onDelete(id),
    onError: setActionError,
  });
  useCollectionShortcut(inputRef, active);

  const projectNames = useMemo(() => {
    // Include removed projects in the filter so their task history stays
    // findable. IDs, not names, distinguish projects with the same name.
    const names = new Map<string, string>();
    for (const task of sessions) {
      if (task.project_id) names.set(task.project_id, task.project_name || 'Unavailable project');
    }
    for (const project of projects) names.set(project.id, project.name);
    return names;
  }, [projects, sessions]);
  const projectOptions = useMemo(() => {
    const nameCounts = new Map<string, number>();
    for (const name of projectNames.values()) nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
    const options = Array.from(projectNames, ([value, name]) => {
      if (nameCounts.get(name) === 1) return { value, label: name };
      const project = projects.find(item => item.id === value);
      const resource = project && projectResources(project)[0];
      const task = sessions.find(item => item.project_id === value);
      const location = resource
        ? resource.kind === 'repository' ? resource.local_path || resource.source_url || resource.name : resource.path
        : task?.repository_root || task?.source_path;
      return { value, label: `${name} — ${location || value}` };
    });
    // Shared locations (or missing metadata) must not reintroduce ambiguity.
    return options.map(option => {
      const label = options.some(other => other.value !== option.value && other.label === option.label)
        ? `${option.label} (${option.value})` : option.label;
      return { ...option, label, title: label };
    }).sort((a, b) => a.label.localeCompare(b.label));
  }, [projects, sessions, projectNames]);
  const project = projects.find(item => item.id === projectId);
  const scope = projectId || projectFilter;
  const newTaskProjectId = scope === 'all' || scope === 'none' ? null : scope;
  const canCreate = !newTaskProjectId || projects.some(item => item.id === newTaskProjectId);
  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    return sessions.filter(task => {
      const tone = codingSessionStatus(task).tone;
      // Queued work is in progress even though its status dot is neutral.
      const group = tone === 'neutral' && task.run_status === 'queued' ? 'accent' : tone;
      return (
      !!task.archived === archived
      && (scope === 'all' || (scope === 'none' ? !task.project_id : task.project_id === scope))
      && (statusFilter === 'all' || (statusFilter === 'attention'
        ? ['warning', 'danger'].includes(group)
        : group === statusFilter))
      && (!search || [task.title, task.project_id ? projectNames.get(task.project_id) : '', task.repository_root, task.source_path]
        .some(value => value?.toLowerCase().includes(search)))
      );
    }).sort((left, right) => (sort === 'title'
      ? (left.title || '').localeCompare(right.title || '')
      : Date.parse(sort === 'created' ? right.created_at : right.updated_at) - Date.parse(sort === 'created' ? left.created_at : left.updated_at)));
  }, [sessions, scope, archived, statusFilter, query, projectNames, sort]);
  // Search and filters narrow this; zero here is "nothing yet", not "no match".
  const total = useMemo(() => sessions.filter(task => !!task.archived === archived
    && (!projectId || task.project_id === projectId)).length, [sessions, archived, projectId]);

  const clearFilters = () => { setProjectFilter('all'); setStatusFilter('all'); setArchived(false); };
  const filters: Filter[] = [
    // A project's own page is already scoped, so it has no project facet.
    ...(projectId ? [] : [{
      id: 'project', label: 'Project', value: projectFilter, allValue: 'all', onChange: setProjectFilter,
      options: [{ value: 'all', label: 'All projects' }, { value: 'none', label: 'No project' }, ...projectOptions],
    }]),
    { id: 'status', label: 'Status', value: statusFilter, allValue: 'all', onChange: setStatusFilter, options: STATUS_OPTIONS },
    { id: 'archived', label: 'Archived', toggle: true, value: archived, onChange: setArchived },
  ];

  return (
    <main className="code-tasks-view">
      {/* Drill-down trail, rendered into the app titlebar like every other
          breadcrumb: Projects › project. */}
      {projectId && <PageHeader
        crumbs={[{ label: 'Projects', onClick: onBack, title: 'All projects' }]}
        current={projectNames.get(projectId) || 'Unavailable project'}
      />}
      <div className={`code-tasks-view__header${projectId ? ' code-tasks-view__header--project' : ''}`}><PageHeader
        title={projectId ? projectNames.get(projectId) || 'Unavailable project' : 'All tasks'}
        subtitle={projectId ? 'Coding tasks in this project.' : undefined}
        actions={<div className="code-tasks-view__actions">
          {project && <Menu
            trigger={<Button icon variant="subtle" aria-label={`${project.name} actions`}>{Ico.moreVert(16)}</Button>}
            items={projectActions(project.id, onEditProject, onDeleteProject)}
          />}
          <Button variant="primary" disabled={!canCreate || loading} onClick={() => onNewTask(newTaskProjectId)}>{Ico.plus(14)} New task</Button>
        </div>}
      /></div>
      <FilterRow
        search={<SearchInput value={query} onChange={setQuery} inputRef={inputRef} placeholder="Search tasks" />}
        filter={<FilterMenu filters={filters} />}
        chips={<FilterChips filters={filters} onClear={clearFilters} />}
        sort={<SortPill value={sort} onChange={setSort} options={SORT_OPTIONS} />}
        counts={!loading && !error ? (filtered.length === total
          ? `${total} ${total === 1 ? 'task' : 'tasks'}`
          : `${filtered.length} of ${total} tasks`) : undefined}
      />
      <div className="mx-8 grid gap-4">
        {actionError && <Alert variant="danger">{actionError}</Alert>}
        {error && <Alert variant="danger">{error}<div className="mt-2"><Button variant="subtle" size="sm" onClick={onRetry}>Try again</Button></div></Alert>}
        {/* A failed load shows the error alone, never an empty state. */}
        {!(error && !sessions.length) && <CollectionState
          loading={loading && !sessions.length}
          skeleton="group"
          skeletonCount={4}
          total={total}
          shown={filtered.length}
          noMatchTitle="No matching tasks"
          clearLabel="Clear filters"
          onClear={() => { setQuery(''); setProjectFilter('all'); setStatusFilter('all'); }}
          empty={archived
            ? { title: 'No archived tasks', description: 'Tasks you archive will appear here.' }
            : { icon: Ico.code(20), title: 'No tasks yet', description: 'Start a task to begin working on your code.' }}
        >
          <ListGroup aria-label={projectId ? 'Project tasks' : 'Code tasks'}>
            {filtered.map(task => {
              const status = codingSessionStatus(task);
              const name = task.project_id ? projectNames.get(task.project_id) : undefined;
              return <TaskRow
                key={task.id}
                title={task.title}
                onOpen={() => onOpen(task.id)}
                project={!projectId && name ? { label: name, onOpen: () => onOpenProject(task.project_id!) } : null}
                // Ready, stopped and completed are the resting states; the
                // row shows status only when there's something to notice.
                status={status.tone === 'neutral' || status.tone === 'success' ? null : { label: status.label, tone: TONE[status.tone] }}
                updatedAt={task.updated_at}
                menuItems={taskActions ? taskMenu.items(task) : undefined}
              />;
            })}
          </ListGroup>
        </CollectionState>}
      </div>
      {taskMenu.dialogs}
    </main>
  );
}
