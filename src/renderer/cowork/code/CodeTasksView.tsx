import { useMemo, useRef, useState } from 'react';
import Ico from '../components/Icons';
import { PageHeader, FilterRow, SearchInput, useCollectionShortcut } from '../components/collection';
import Button from '../components/ui/Button';
import Select from '../components/ui/Select';
import { type CodeProject, type CodingSession } from './api';
import { codingSessionStatus, relativeTime } from './presentation';
import './code-tasks.css';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'attention', label: 'Needs attention' },
  { value: 'accent', label: 'In progress' },
  { value: 'success', label: 'Completed' },
  { value: 'danger', label: 'Failed' },
  { value: 'neutral', label: 'Ready or stopped' },
];

export function CodeTasksView({
  sessions, projects, projectId = null, active = true, loading, error,
  onOpen, onOpenProject, onNewTask, onEditProject, onBack, onRetry,
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
  onBack: () => void;
  onRetry: () => void;
}) {
  const [query, setQuery] = useState('');
  const [projectFilter, setProjectFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [archiveFilter, setArchiveFilter] = useState('current');
  const inputRef = useRef<HTMLInputElement>(null);
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
      (archiveFilter === 'archived' ? task.archived : !task.archived)
      && (scope === 'all' || (scope === 'none' ? !task.project_id : task.project_id === scope))
      && (statusFilter === 'all' || (statusFilter === 'attention'
        ? ['warning', 'danger'].includes(group)
        : group === statusFilter))
      && (!search || [task.title, task.project_id ? projectNames.get(task.project_id) : '', task.repository_root, task.source_path]
        .some(value => value?.toLowerCase().includes(search)))
      );
    }).sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at));
  }, [sessions, scope, archiveFilter, statusFilter, query, projectNames]);
  const hasFilters = !!query || statusFilter !== 'all' || (!projectId && projectFilter !== 'all');

  return (
    <main className="code-tasks-view">
      {projectId && <div className="code-tasks-view__back"><Button variant="subtle" size="sm" onClick={onBack}>{Ico.chevLeft(13)} Projects</Button></div>}
      <div className={`code-tasks-view__header${projectId ? ' code-tasks-view__header--project' : ''}`}><PageHeader
        title={projectId ? projectNames.get(projectId) || 'Unavailable project' : 'All tasks'}
        subtitle={projectId ? 'Coding tasks in this project.' : undefined}
        actions={<div className="code-tasks-view__actions">
          {project && <Button icon variant="subtle" aria-label={`Edit ${project.name}`} onClick={() => onEditProject(project.id)}>{Ico.settings(15)}</Button>}
          <Button variant="primary" disabled={!canCreate || loading} onClick={() => onNewTask(newTaskProjectId)}>{Ico.plus(13)} New task</Button>
        </div>}
      /></div>
      <FilterRow
        search={<SearchInput value={query} onChange={setQuery} inputRef={inputRef} placeholder="Search tasks" />}
        sort={<>
          {!projectId && <Select className="code-tasks-view__project-filter" variant="pill" label="Project" ariaLabel="Filter by project" value={projectFilter} onValueChange={setProjectFilter} options={[
            { value: 'all', label: 'All projects' }, { value: 'none', label: 'No project' },
            ...Array.from(projectNames, ([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label)),
          ]} />}
          <Select variant="pill" label="Status" ariaLabel="Filter by status" value={statusFilter} onValueChange={setStatusFilter} options={STATUS_OPTIONS} />
          <Select variant="pill" label="Show" ariaLabel="Task history" value={archiveFilter} onValueChange={setArchiveFilter} options={[
            { value: 'current', label: 'Unarchived' }, { value: 'archived', label: 'Archived' },
          ]} />
        </>}
        counts={!loading && !error ? `${filtered.length} ${filtered.length === 1 ? 'task' : 'tasks'} · Most recently updated first` : undefined}
      />
      <div className="code-tasks-view__body" aria-busy={loading}>
        {error && <div className="code-tasks-view__notice" role="alert"><p>{error}</p><Button variant="subtle" size="sm" onClick={onRetry}>Try again</Button></div>}
        {loading && !sessions.length ? <p className="code-tasks-view__notice" role="status">Loading tasks…</p> : (
          filtered.length ? <table className="code-tasks-table" aria-label={projectId ? 'Project tasks' : 'Code tasks'}>
            <thead><tr><th scope="col">Task</th><th scope="col">Project</th><th scope="col">Status</th><th scope="col">Updated</th></tr></thead>
            <tbody>{filtered.map(task => {
              const status = codingSessionStatus(task);
              const name = task.project_id ? projectNames.get(task.project_id) : undefined;
              return <tr key={task.id}>
                <td className="code-tasks-table__title"><button type="button" title={task.title} onClick={() => onOpen(task.id)}>{task.title || 'Untitled task'}</button></td>
                <td className="code-tasks-table__project">{task.project_id
                  ? <button type="button" title={name} onClick={() => onOpenProject(task.project_id!)}>{name}</button>
                  : <span className="code-tasks-table__muted">No project</span>}</td>
                <td><span className={`code-task-status is-${status.tone}`}><i aria-hidden="true" />{status.label}</span></td>
                <td className="code-tasks-table__updated"><time dateTime={task.updated_at} title={new Date(task.updated_at).toLocaleString()}>{relativeTime(task.updated_at)}</time></td>
              </tr>;
            })}</tbody>
          </table> : !error && !loading && <div className="code-tasks-view__notice">
            <h2>{hasFilters ? 'No matching tasks' : archiveFilter === 'archived' ? 'No archived tasks' : 'No tasks yet'}</h2>
            <p>{hasFilters ? 'Try another search or clear the filters.' : archiveFilter === 'archived' ? 'Tasks you archive will appear here.' : 'Start a task to begin working on your code.'}</p>
            {hasFilters && <Button variant="subtle" size="sm" onClick={() => { setQuery(''); setProjectFilter('all'); setStatusFilter('all'); }}>Clear filters</Button>}
          </div>
        )}
      </div>
    </main>
  );
}
