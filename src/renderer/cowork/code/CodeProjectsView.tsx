import { useMemo, useState } from 'react';

import Ico from '../components/Icons';
import Alert from '../components/ui/Alert';
import Button from '../components/ui/Button';
import { CollectionState, FilterRow, ListGroup, ListItem, PageHeader, SearchInput } from '../components/collection';
import { projectResources, type CodeProject } from './api';
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
      .filter((project) => !normalized || project.name.toLowerCase().includes(normalized) || projectResources(project).some((resource) => resource.name.toLowerCase().includes(normalized)))
      .sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at));
  }, [projects, query]);

  return (
    <main className="code-projects-view">
      <PageHeader
        title="Projects"
        subtitle="Repositories, folders, skills, and defaults shared by coding tasks."
        actions={<Button variant="primary" onClick={onCreate}>{Ico.plus(13)} New project</Button>}
      />
      <FilterRow search={<SearchInput value={query} onChange={setQuery} placeholder="Search projects" shortcut="" />} />

      <div className="mx-8">
        {error ? <Alert variant="danger">{error}</Alert> : (
          <CollectionState
            loading={loading}
            skeleton="group"
            skeletonCount={4}
            total={projects.length}
            shown={visible.length}
            query={query}
            onClear={() => setQuery('')}
            empty={{
              icon: Ico.folder(20),
              title: 'No projects yet',
              description: 'Create a project to bring related repositories and folders together.',
              action: <Button variant="subtle" onClick={onCreate}>Create project</Button>,
            }}
          >
            <ListGroup density="compact" aria-label="Code Projects">
              {visible.map((project) => {
                const resources = projectResources(project);
                return (
                  <ListItem
                    key={project.id}
                    leading={Ico.folder(15)}
                    title={project.name}
                    description={resources.map((resource) => resource.name).join(', ') || undefined}
                    onActivate={() => onOpen(project.id)}
                    activateLabel={`View tasks in ${project.name}`}
                    selected={selectedId === project.id}
                    meta={<>
                      <span>{resources.length} {resources.length === 1 ? 'resource' : 'resources'}</span>
                      <time dateTime={project.updated_at}>{relativeTime(project.updated_at)}</time>
                    </>}
                    actions={<Button icon variant="subtle" size="sm" aria-label={`Edit ${project.name}`} onClick={() => onEdit(project.id)}>{Ico.settings(13)}</Button>}
                  />
                );
              })}
            </ListGroup>
          </CollectionState>
        )}
      </div>
    </main>
  );
}
