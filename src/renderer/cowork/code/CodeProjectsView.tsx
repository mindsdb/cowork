import { useMemo, useState } from 'react';

import Ico from '../components/Icons';
import Alert from '../components/ui/Alert';
import Button from '../components/ui/Button';
import Menu from '../components/ui/Menu';
import {
  CardGrid, CollectionState, FilterRow, ItemCard, ListGroup, ListItem, PageHeader, SearchInput, SortPill, ViewToggle,
  useCollectionView,
} from '../components/collection';
import { projectResources, type CodeProject } from './api';
import { relativeTime } from './presentation';
import { projectActions } from './projectActions';

const SORT_OPTIONS = [
  { id: 'updated', label: 'Recently updated' },
  { id: 'name', label: 'Name' },
];

export function CodeProjectsView({
  projects,
  loading,
  error,
  onOpen,
  onCreate,
  onEdit,
  onDelete,
}: {
  projects: CodeProject[];
  loading: boolean;
  error: string;
  onOpen: (id: string) => void;
  onCreate: () => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('updated');
  // Same layouts and default as Cowork's Projects page.
  const { view, setView, effectiveView } = useCollectionView('anton:code-projects-view');
  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return projects
      .filter((project) => !normalized || project.name.toLowerCase().includes(normalized) || projectResources(project).some((resource) => resource.name.toLowerCase().includes(normalized)))
      .sort((left, right) => (sort === 'name'
        ? left.name.localeCompare(right.name)
        : Date.parse(right.updated_at) - Date.parse(left.updated_at)));
  }, [projects, query, sort]);

  // One set of slots for the card and the row.
  const slots = (project: CodeProject) => {
    const resources = projectResources(project);
    return {
      leading: Ico.folder(14),
      title: project.name,
      description: resources.map((resource) => resource.name).join(', ') || undefined,
      onActivate: () => onOpen(project.id),
      activateLabel: `View tasks in ${project.name}`,
      meta: <>
        <span>{resources.length} {resources.length === 1 ? 'resource' : 'resources'}</span>
        <time dateTime={project.updated_at}>{relativeTime(project.updated_at)}</time>
      </>,
      actions: <Menu
        trigger={<Button icon variant="subtle" size="sm" aria-label={`${project.name} actions`}>{Ico.moreVert(14)}</Button>}
        items={projectActions(project.id, onEdit, onDelete)}
      />,
    };
  };

  return (
    <main className="code-projects-view">
      <PageHeader
        title="Projects"
        subtitle="Repositories, folders, skills, and defaults shared by coding tasks."
        actions={<Button variant="primary" onClick={onCreate}>{Ico.plus(14)} New project</Button>}
      />
      {/* Nothing to search or sort until a project exists. */}
      {(loading || error || projects.length > 0) && <FilterRow
        search={<SearchInput value={query} onChange={setQuery} placeholder="Search projects" shortcut="" />}
        sort={<SortPill value={sort} onChange={setSort} options={SORT_OPTIONS} />}
        view={<ViewToggle value={view} onValueChange={setView} />}
      />}

      <div className="mx-8">
        {error ? <Alert variant="danger">{error}</Alert> : (
          <CollectionState
            loading={loading}
            skeleton={effectiveView === 'grid' ? 'cards' : 'group'}
            skeletonCount={4}
            total={projects.length}
            shown={visible.length}
            query={query}
            onClear={() => setQuery('')}
            empty={{
              icon: Ico.folder(20),
              title: 'No projects yet',
              description: 'Create a project to bring related repositories and folders together.',
              action: { label: 'Create your first project', onClick: onCreate },
            }}
          >
            {effectiveView === 'grid' ? (
              <CardGrid>
                {visible.map((project) => <ItemCard key={project.id} as="article" {...slots(project)} />)}
              </CardGrid>
            ) : (
              <ListGroup aria-label="Code Projects">
                {visible.map((project) => <ListItem key={project.id} as="article" {...slots(project)} />)}
              </ListGroup>
            )}
          </CollectionState>
        )}
      </div>
    </main>
  );
}
