// Regression for ENG-992: the project menu's "+ New project" row (empty
// search) used to only focus the search input — visually nothing happened.
// It must open the "Start a new project" modal, and a create from that
// modal must select the new project on the composer.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Composer from './Composer';

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fetchSkills: vi.fn(async () => []),
    createProject: vi.fn(async (name) => ({ name })),
    writeProjectFile: vi.fn(async () => ({})),
    uploadProjectFiles: vi.fn(async () => ({})),
  };
});

const renderComposer = (overrides = {}) => {
  const props = {
    onSend: vi.fn(),
    project: { name: 'general' },
    projects: [{ name: 'general' }],
    onProjectChange: vi.fn(),
    onCreateProject: vi.fn(async ({ name }) => ({ name })),
    models: [],
    hideModel: true,
    ...overrides,
  };
  render(<Composer {...props} />);
  return props;
};

const openNewProjectModal = async (user) => {
  await user.click(screen.getByTitle('Choose project'));
  await user.click(screen.getByRole('button', { name: /new project/i }));
  return screen.findByText('Start a new project');
};

describe('Composer — "+ New project" (ENG-992)', () => {
  it('opens the Start a new project modal on click with an empty search', async () => {
    const user = userEvent.setup();
    renderComposer();
    expect(await openNewProjectModal(user)).toBeInTheDocument();
  });

  it('routes a modal create through onCreateProject and selects the new project', async () => {
    const user = userEvent.setup();
    const props = renderComposer();
    await openNewProjectModal(user);

    await user.type(screen.getByLabelText(/project name/i), 'acme');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(props.onCreateProject).toHaveBeenCalledWith({ name: 'acme', _alreadyCreated: true });
    expect(props.onProjectChange).toHaveBeenCalledWith({ name: 'acme' });
  });
});
