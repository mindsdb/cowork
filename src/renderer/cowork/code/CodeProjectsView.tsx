import { useMemo, useState } from 'react';

import Ico from '../components/Icons';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import type { CodeProject } from './api';
import { relativeTime } from './presentation';


export function CodeProjectsView({
  projects,
  selectedId,
  loading,
  error,
  onOpen,
  onCreate,
  onEdit,
}: {
  projects: CodeProject[];
  selectedId: string | null;
  loading: boolean;
  error: string;
  onOpen: (id: string) => void;
  onCreate: () => void;
  onEdit: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return projects
      .filter((project) => !normalized || project.name.toLowerCase().includes(normalized) || project.folders.some((folder) => folder.name.toLowerCase().includes(normalized)))
      .sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at));
  }, [projects, query]);

  return (
    <main className="code-projects-view">
      <header className="code-projects-view__header">
        <div>
          <h1>Projects</h1>
          <p>Folders, team skills, and defaults shared by coding tasks.</p>
        </div>
        <Button variant="primary" onClick={onCreate}>{Ico.plus(13)} New project</Button>
      </header>

      <label className="code-projects-view__search">
        <span aria-hidden="true">{Ico.search(15)}</span>
        <Input value={query} onChange={setQuery} placeholder="Search projects" aria-label="Search projects" />
      </label>

      <div className="code-projects-table" aria-label="Code Projects">
        <div className="code-projects-table__head" aria-hidden="true">
          <span>Project</span>
          <span>Folders</span>
          <span>Updated</span>
          <span />
        </div>
        {loading && <div className="code-projects-table__empty">Loading projects…</div>}
        {!loading && error && <div className="code-projects-table__empty is-error">{error}</div>}
        {!loading && !error && visible.map((project) => (
          <div className={`code-project-row${selectedId === project.id ? ' is-current' : ''}`} key={project.id}>
            <button type="button" className="code-project-row__main" onClick={() => onOpen(project.id)} aria-label={`Start a task in ${project.name}`}>
              <span className="code-project-row__folder" aria-hidden="true">{Ico.folder(15)}</span>
              <span className="code-project-row__name">
                <strong>{project.name}</strong>
                <small>{project.folders.map((folder) => folder.name).join(', ')}</small>
              </span>
            </button>
            <span className="code-project-row__count">{project.folders.length}</span>
            <span className="code-project-row__updated">{relativeTime(project.updated_at)}</span>
            <Button icon variant="subtle" size="sm" aria-label={`Edit ${project.name}`} onClick={() => onEdit(project.id)}>{Ico.settings(13)}</Button>
          </div>
        ))}
        {!loading && !error && !visible.length && (
          <div className="code-projects-table__empty">
            <span>{projects.length ? 'No projects match your search.' : 'Create a project to group the folders your work spans.'}</span>
            {!projects.length && <Button variant="subtle" size="sm" onClick={onCreate}>Create project</Button>}
          </div>
        )}
      </div>
    </main>
  );
}
