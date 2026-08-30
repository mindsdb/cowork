import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  skillLibrary,
  skillDocument,
  addSkillSource,
  refreshSkillSource,
  applySkillSource,
  removeSkillSource,
  setSkillSourceProjects,
  openExternal,
} = vi.hoisted(() => ({
  skillLibrary: vi.fn(),
  skillDocument: vi.fn(),
  addSkillSource: vi.fn(),
  refreshSkillSource: vi.fn(),
  applySkillSource: vi.fn(),
  removeSkillSource: vi.fn(),
  setSkillSourceProjects: vi.fn(),
  openExternal: vi.fn(),
}));

vi.mock('../../platform/host', () => ({
  host: { pickCodeFolder: vi.fn(), openExternal, openPath: vi.fn() },
}));

vi.mock('../components/markdown/MarkdownContent', () => ({
  MarkdownContent: ({ text }: { text: string }) => <div>{text}</div>,
}));

vi.mock('./api', () => ({
  codingApi: {
    skillLibrary,
    skillDocument,
    addSkillSource,
    refreshSkillSource,
    applySkillSource,
    removeSkillSource,
    setSkillSourceProjects,
  },
}));

import type { CodeProject, SkillLibraryPage } from './api';
import { CodeSkillsView } from './CodeSkillsView';

const projects: CodeProject[] = [
  {
    schema_version: 2,
    id: 'project-one',
    name: 'Product',
    resources: [{
      kind: 'repository',
      id: 'product',
      name: 'Product',
      local_path: '/work/product',
      computer_id: 'local',
      checkout_strategy: 'worktree',
      commands: [],
    }],
    folders: [{ id: 'product', name: 'Product', path: '/work/product', commands: [] }],
    skill_sources: [{ source_id: 'engineering', enabled_paths: ['skills/review/SKILL.md'] }],
    connections: [],
    environment: { variables: {}, port_names: [] },
    default_engine_id: 'codex',
    default_model: 'gpt',
    permission_mode: 'supervised',
    created_at: '2026-08-24T10:00:00Z',
    updated_at: '2026-08-24T10:00:00Z',
  },
  {
    schema_version: 2,
    id: 'project-two',
    name: 'Inference',
    resources: [{
      kind: 'repository',
      id: 'inference',
      name: 'Inference',
      local_path: '/work/inference',
      computer_id: 'local',
      checkout_strategy: 'worktree',
      commands: [],
    }],
    folders: [{ id: 'inference', name: 'Inference', path: '/work/inference', commands: [] }],
    skill_sources: [],
    connections: [],
    environment: { variables: {}, port_names: [] },
    default_engine_id: 'codex',
    default_model: 'gpt',
    permission_mode: 'supervised',
    created_at: '2026-08-24T10:00:00Z',
    updated_at: '2026-08-24T10:00:00Z',
  },
];

const library: SkillLibraryPage = {
  sources: [{
    id: 'engineering',
    name: 'Engineering standards',
    repository: 'https://github.com/mindsdb/engineering-skills',
    branch: 'main',
    current_revision: 'a1b2c3d4e5f6',
    available_revision: 'a1b2c3d4e5f6',
    update_available: false,
    last_checked_at: '2026-08-24T10:00:00Z',
    item_count: 2,
    enabled_project_count: 1,
    diff: '',
  }],
  items: [
    { id: 'engineering:skills/review/SKILL.md', kind: 'skill', name: 'Review', description: 'Review code against team standards.', origin: 'team', source_id: 'engineering', source_name: 'Engineering standards', path: 'skills/review/SKILL.md', version: 'a1b2c3d4e5f6', enabled: false, enabled_project_ids: ['project-one'] },
    { id: 'engineering:AGENTS.md', kind: 'instructions', name: 'AGENTS.md', description: '', origin: 'team', source_id: 'engineering', source_name: 'Engineering standards', path: 'AGENTS.md', version: 'a1b2c3d4e5f6', enabled: false, enabled_project_ids: [] },
    { id: 'personal:release', kind: 'skill', name: 'Release', description: 'Prepare a release.', origin: 'personal', source_name: 'Yours', path: 'release', enabled: true, enabled_project_ids: [] },
    { id: 'personal:thermo-nuclear-code-quality-review', kind: 'skill', name: 'Thermo-Nuclear Code Quality Review', description: 'Run an extremely strict maintainability review.', origin: 'built_in', source_name: 'MindsHub', path: 'thermo-nuclear-code-quality-review', enabled: true, enabled_project_ids: [] },
  ],
};

describe('CodeSkillsView', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    skillLibrary.mockResolvedValue(structuredClone(library));
    skillDocument.mockResolvedValue({
      item: structuredClone(library.items[0]),
      files: ['SKILL.md'],
      selected_path: 'SKILL.md',
      content: '---\nname: review\n---\n\n# Review\n\nInspect the complete diff before reporting findings.',
    });
    setSkillSourceProjects.mockResolvedValue(structuredClone(library));
  });

  it('presents team and personal guidance as a searchable first-class library', async () => {
    const user = userEvent.setup();
    render(<CodeSkillsView projects={projects} scopeKey="account-one" />);

    expect(await screen.findByRole('heading', { name: 'Skills' })).toBeInTheDocument();
    expect(screen.getByText('Engineering standards')).toBeInTheDocument();
    expect(screen.getByText('Review code against team standards.')).toBeInTheDocument();
    expect(screen.getByText('Personal skills available in Code Mode')).toBeInTheDocument();
    expect(screen.getByText('Engineering skills maintained by MindsHub')).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: 'Search skills' }), 'release');
    expect(screen.getByText('Prepare a release.')).toBeInTheDocument();
    expect(screen.queryByText('Review code against team standards.')).not.toBeInTheDocument();
  });

  it('opens a readable skill document from the library row', async () => {
    const user = userEvent.setup();
    render(<CodeSkillsView projects={projects} scopeKey="account-one" />);

    await user.click(await screen.findByRole('button', { name: 'View Review' }));

    expect(await screen.findByRole('dialog', { name: 'Review' })).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('.code-skill-detail')).toHaveTextContent('Inspect the complete diff before reporting findings.'));
    expect(skillDocument).toHaveBeenCalledWith('engineering:skills/review/SKILL.md', undefined);
  });

  it('assigns a team skill to projects without losing other selected items', async () => {
    const user = userEvent.setup();
    render(<CodeSkillsView projects={projects} scopeKey="account-one" />);
    await screen.findByText('Review code against team standards.');

    await user.click(screen.getByRole('button', { name: '1 project' }));
    await user.click(screen.getByRole('checkbox', { name: /Inference/ }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(setSkillSourceProjects).toHaveBeenCalledWith('engineering', [{
      project_id: 'project-two',
      enabled_paths: ['skills/review/SKILL.md'],
    }]));
  });

  it('shows source usage without presenting it as a destructive error', async () => {
    const user = userEvent.setup();
    render(<CodeSkillsView projects={projects} scopeKey="account-one" />);
    await user.click(await screen.findByRole('button', { name: /Engineering standards/ }));

    expect(screen.getByText('Used by 1 project')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove source' })).not.toBeInTheDocument();
    expect(removeSkillSource).not.toHaveBeenCalled();
  });

  it('opens the backing Git repository from source details', async () => {
    const user = userEvent.setup();
    render(<CodeSkillsView projects={projects} scopeKey="account-one" />);
    await user.click(await screen.findByRole('button', { name: /Engineering standards/ }));

    await user.click(screen.getByRole('button', { name: 'Open repository' }));

    expect(openExternal).toHaveBeenCalledWith('https://github.com/mindsdb/engineering-skills');
  });

  it('keeps project assignment failures inside the assignment dialog', async () => {
    setSkillSourceProjects.mockRejectedValueOnce(new Error('A review skill with that name is already selected.'));
    const user = userEvent.setup();
    render(<CodeSkillsView projects={projects} scopeKey="account-one" />);
    await user.click(await screen.findByRole('button', { name: '1 project' }));
    await user.click(screen.getByRole('checkbox', { name: /Inference/ }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('A review skill with that name is already selected.')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('keeps source refresh failures inside source details', async () => {
    refreshSkillSource.mockRejectedValueOnce(new Error('The repository could not be reached.'));
    const user = userEvent.setup();
    render(<CodeSkillsView projects={projects} scopeKey="account-one" />);
    await user.click(await screen.findByRole('button', { name: /Engineering standards/ }));
    await user.click(screen.getByRole('button', { name: 'Check for updates' }));

    expect(await screen.findByText('The repository could not be reached.')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('keeps an unavailable source visible and actionable', async () => {
    skillLibrary.mockResolvedValue({
      sources: [{ ...library.sources[0], item_count: 0, error: 'The managed cache is unavailable.' }],
      items: [],
    });
    const user = userEvent.setup();
    render(<CodeSkillsView projects={projects} scopeKey="account-one" />);

    await user.click(await screen.findByRole('button', { name: 'Needs attention' }));

    expect(screen.getByText('The managed cache is unavailable.')).toBeInTheDocument();
    expect(screen.queryByText('No skills match your search.')).not.toBeInTheDocument();
  });

  it('never reuses a previous account catalogue while the next account loads', async () => {
    const first = render(<CodeSkillsView projects={projects} scopeKey="account-alpha" />);
    expect(await screen.findByText('Review code against team standards.')).toBeInTheDocument();
    first.unmount();
    skillLibrary.mockResolvedValueOnce({
      sources: [],
      items: [{
        id: 'personal:beta', kind: 'skill', name: 'Beta account skill',
        description: 'Only this account can see it.', origin: 'personal', source_name: 'Yours',
        path: 'beta-account', enabled: true, enabled_project_ids: [],
      }],
    });

    render(<CodeSkillsView projects={projects} scopeKey="account-beta" />);

    expect(screen.queryByText('Review code against team standards.')).not.toBeInTheDocument();
    expect(await screen.findByText('Only this account can see it.')).toBeInTheDocument();
  });
});
