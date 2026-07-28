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

// The composer's model pill is the shared ModelSelect picker (ENG-1096) —
// same component as the Settings Agent Models rows, wearing the meta-pill
// skin. These cover the composer-specific contract: options come from the
// {id, name} model list and a pick hands back the full model object.
describe('Composer — model picker (ENG-1096)', () => {
  const MODELS = [
    { id: 'sonnet', name: 'Claude Sonnet 5', desc: '' },
    { id: 'gpt-codex', name: 'GPT 5.3 Codex', desc: '' },
  ];

  it('shows the current model on the pill and lists models grouped by maker', async () => {
    const user = userEvent.setup();
    renderComposer({ hideModel: false, models: MODELS, model: MODELS[0], onModelChange: vi.fn() });

    const pill = screen.getByTitle('Choose model');
    expect(pill).toHaveTextContent('Claude Sonnet 5');

    await user.click(pill);
    expect(screen.getByText('Anthropic')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'GPT 5.3 Codex' })).toBeInTheDocument();
  });

  it('hands the full model object back to onModelChange on pick', async () => {
    const user = userEvent.setup();
    const onModelChange = vi.fn();
    renderComposer({ hideModel: false, models: MODELS, model: MODELS[0], onModelChange });

    await user.click(screen.getByTitle('Choose model'));
    await user.click(screen.getByRole('option', { name: 'GPT 5.3 Codex' }));

    expect(onModelChange).toHaveBeenCalledTimes(1);
    expect(onModelChange).toHaveBeenCalledWith(MODELS[1]);
  });
});
