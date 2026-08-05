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

describe('Composer — prefill selection (ENG-1137)', () => {
  it('selects the given range after a prefill with `select`', async () => {
    const text = "Plan my week. I'm working on [things]. Keep it easy.";
    const start = text.indexOf('[');
    const end = text.indexOf(']') + 1;
    const { rerender } = render(<Composer onSend={vi.fn()} projects={[]} models={[]} hideModel />);
    rerender(<Composer onSend={vi.fn()} projects={[]} models={[]} hideModel prefill={{ text, bump: 1, select: [start, end] }} />);
    const ta = await screen.findByDisplayValue(text);
    expect(ta.value.slice(ta.selectionStart, ta.selectionEnd)).toBe('[things]');
  });

  it('parks the caret at the end when prefill has no `select`', async () => {
    const text = 'Build me a habit tracker as a live artifact.';
    const { rerender } = render(<Composer onSend={vi.fn()} projects={[]} models={[]} hideModel />);
    rerender(<Composer onSend={vi.fn()} projects={[]} models={[]} hideModel prefill={{ text, bump: 1 }} />);
    const ta = await screen.findByDisplayValue(text);
    expect(ta.selectionStart).toBe(text.length);
    expect(ta.selectionEnd).toBe(text.length);
  });
});

// ─── Model menu sections (ENG-1287) ─────────────────────────────────
//
// The composer's menu was the one picker ENG-1096 left flat. It now groups by the
// same sections as Settings and tags the aliases whose version moves. The
// ungrouped case matters just as much: ChatView passes a one-item list, and an app
// newer than its server gets no metadata — both keep the flat menu.

const MODEL_META = {
  modelProviders: { mindshub_air: 'anthropic', sonnet: 'anthropic', kimi: 'moonshot' },
  modelFamilies: { mindshub_air: 'mindshub_air', sonnet: 'sonnet', kimi: 'kimi' },
};
const MODELS = [
  { id: 'mindshub_air', name: 'MindsHub Air' },
  { id: 'sonnet', name: 'Claude Sonnet 5' },
  { id: 'kimi', name: 'Kimi K3' },
];

const openModelMenu = (user) => user.click(screen.getByTitle('Choose model'));

describe('Composer — model menu sections', () => {
  it('renders a heading per section, MindsHub first', async () => {
    const user = userEvent.setup();
    renderComposer({ models: MODELS, modelMeta: MODEL_META, hideModel: false, model: MODELS[0] });
    await openModelMenu(user);

    for (const title of ['MindsHub', 'Anthropic', 'Open Weight']) {
      expect(screen.getByText(title)).toBeTruthy();
    }
    // The flat menu's single "Model" heading is replaced by the section headings.
    expect(screen.queryByText('Model')).toBeNull();
  });

  it('keeps MindsHub Air out of the vendor section serving it', async () => {
    // The fixture reports Air's provider as the same vendor as the Claude models
    // precisely so this proves the branding rule wins over the reported provider.
    const user = userEvent.setup();
    renderComposer({ models: MODELS, modelMeta: MODEL_META, hideModel: false, model: MODELS[0] });
    await openModelMenu(user);

    expect(MODEL_META.modelProviders.mindshub_air).toBe(MODEL_META.modelProviders.sonnet);
    expect(screen.getByText('MindsHub')).toBeTruthy();
  });

  it('keeps the single "Model" heading for a one-item list (ChatView)', async () => {
    const user = userEvent.setup();
    renderComposer({ models: [MODELS[1]], hideModel: false, model: MODELS[1] });
    await openModelMenu(user);

    expect(screen.getByText('Model')).toBeTruthy();
    expect(screen.queryByText('Anthropic')).toBeNull();
  });

  it('renders the flat menu when the server sends no section metadata', async () => {
    const user = userEvent.setup();
    renderComposer({ models: MODELS, hideModel: false, model: MODELS[0] });
    await openModelMenu(user);

    expect(screen.getByText('Model')).toBeTruthy();
    expect(screen.queryByText('Open Weight')).toBeNull();
    // getAllByText: the selected model's name also renders in the trigger pill.
    for (const m of MODELS) expect(screen.getAllByText(m.name).length).toBeGreaterThan(0);
  });

  it('tags every moving alias "latest" and a frozen version not at all', async () => {
    const user = userEvent.setup();
    renderComposer({
      models: [...MODELS, { id: 'sonnet-4-5', name: 'Claude Sonnet 4.5' }],
      modelMeta: {
        modelProviders: { ...MODEL_META.modelProviders, 'sonnet-4-5': 'anthropic' },
        modelFamilies: { ...MODEL_META.modelFamilies, 'sonnet-4-5': 'sonnet' },
      },
      hideModel: false,
      model: MODELS[1],
    });
    await openModelMenu(user);

    // Four models, one of which is a frozen version.
    expect(screen.getAllByText('latest')).toHaveLength(3);
    expect(screen.getByText('Claude Sonnet 4.5')).toBeTruthy();
  });

  it('disables a wallet-locked model with the add-credits wording', async () => {
    const user = userEvent.setup();
    const props = renderComposer({
      models: MODELS,
      modelMeta: { ...MODEL_META, modelEnabled: { sonnet: false } },
      hideModel: false,
      model: MODELS[0],
      onModelChange: vi.fn(),
    });
    await openModelMenu(user);

    expect(screen.getByText('Add credits to unlock')).toBeTruthy();
    // A turn that would fail at send time can't be started from here — matching
    // what the Settings picker already does.
    await user.click(screen.getByText('Claude Sonnet 5'));
    expect(props.onModelChange).not.toHaveBeenCalled();
  });

  it('selects by id and label', async () => {
    const user = userEvent.setup();
    const props = renderComposer({
      models: MODELS, modelMeta: MODEL_META, hideModel: false, model: MODELS[0], onModelChange: vi.fn(),
    });
    await openModelMenu(user);
    await user.click(screen.getByText('Kimi K3'));

    expect(props.onModelChange).toHaveBeenCalledWith({ id: 'kimi', name: 'Kimi K3' });
  });

  it('keeps the "Model" heading when the list is still empty (settings loading)', async () => {
    const user = userEvent.setup();
    renderComposer({ models: [], modelMeta: MODEL_META, hideModel: false, model: null });
    await openModelMenu(user);
    expect(screen.getByText('Model')).toBeTruthy();
  });
});
