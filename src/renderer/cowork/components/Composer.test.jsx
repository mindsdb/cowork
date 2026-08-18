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

// The coding-mode harness pill only renders on desktop (`!host.isWeb`) —
// jsdom's default host reads as web, which would hide it from every test
// in this file. Only the "Model Router" harness-switch test below
// exercises it; everything else (api.js's getApiOrigin() at import time,
// etc.) keeps the real host.
vi.mock('../../platform/host', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    host: {
      ...actual.host,
      isWeb: false,
      detectClaudeCode: vi.fn(async () => ({ installed: true, path: '/usr/local/bin/claude' })),
    },
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
    ...overrides,
  };
  render(<Composer {...props} />);
  return props;
};

const openNewProjectModal = async (user) => {
  // Query by the stable aria-label rather than DOM position/order — the
  // model picker moved into the composer toolbar (ENG-1656), ahead of the
  // project pill in document order, so "first .meta-pill" no longer means
  // "the project pill".
  await user.click(screen.getByRole('button', { name: 'Choose project' }));
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
    const { rerender } = render(<Composer onSend={vi.fn()} projects={[]} models={[]} />);
    rerender(<Composer onSend={vi.fn()} projects={[]} models={[]} prefill={{ text, bump: 1, select: [start, end] }} />);
    const ta = await screen.findByDisplayValue(text);
    expect(ta.value.slice(ta.selectionStart, ta.selectionEnd)).toBe('[things]');
  });

  it('parks the caret at the end when prefill has no `select`', async () => {
    const text = 'Build me a habit tracker as a live artifact.';
    const { rerender } = render(<Composer onSend={vi.fn()} projects={[]} models={[]} />);
    rerender(<Composer onSend={vi.fn()} projects={[]} models={[]} prefill={{ text, bump: 1 }} />);
    const ta = await screen.findByDisplayValue(text);
    expect(ta.selectionStart).toBe(text.length);
    expect(ta.selectionEnd).toBe(text.length);
  });
});

// ─── Model picker (ENG-1656) ─────────────────────────────────────────
//
// Section/tag/icon grouping logic itself is <ModelSelect>'s job now (see
// ModelSelect.test.jsx and lib/modelCatalog.test.js) — the composer just
// wires its own model state to it. These tests cover that wiring: the
// picker is reachable by its stable aria-label regardless of layout, a
// pick round-trips through onModelChange in the {id, name} shape callers
// expect, and modelReadOnly falls back to a fixed label (ChatView's
// "model is fixed once a task starts" behavior).

const MODEL_META = {
  modelProviders: { mindshub_air: 'anthropic', sonnet: 'anthropic', kimi: 'moonshot' },
  modelFamilies: { mindshub_air: 'mindshub_air', sonnet: 'sonnet', kimi: 'kimi' },
};
const MODELS = [
  { id: 'mindshub_air', name: 'MindsHub Air' },
  { id: 'sonnet', name: 'Claude Sonnet 5' },
  { id: 'kimi', name: 'Kimi K3' },
];

describe('Composer — model picker (ENG-1656)', () => {
  it('shows the current model on a combobox reachable by aria-label', () => {
    renderComposer({ models: MODELS, modelMeta: MODEL_META, model: MODELS[1] });
    expect(screen.getByRole('combobox', { name: 'Choose model' })).toHaveTextContent('Claude Sonnet 5');
  });

  it('selects a model and calls onModelChange with {id, name}', async () => {
    const user = userEvent.setup();
    const props = renderComposer({
      models: MODELS, modelMeta: MODEL_META, model: MODELS[0], onModelChange: vi.fn(),
    });

    await user.click(screen.getByRole('combobox', { name: 'Choose model' }));
    await user.click(screen.getByRole('option', { name: 'Kimi K3' }));

    expect(props.onModelChange).toHaveBeenCalledWith({ id: 'kimi', name: 'Kimi K3' });
  });

  it('re-checks wallet availability when the picker opens, once per window', async () => {
    // Parity with the Settings picker: without this, a user who hits "Add
    // credits" (external browser), tops up and returns finds the model
    // still greyed until they visit Settings or restart.
    const user = userEvent.setup();
    const onRefresh = vi.fn(async () => {});
    renderComposer({
      models: MODELS,
      modelMeta: { ...MODEL_META, onRefresh },
      model: MODELS[0],
    });

    const trigger = screen.getByRole('combobox', { name: 'Choose model' });
    await user.click(trigger); // open
    expect(onRefresh).toHaveBeenCalledTimes(1);
    await user.click(trigger); // close
    await user.click(trigger); // reopen inside the freshness window
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('renders a fixed label instead of a picker when modelReadOnly', async () => {
    const user = userEvent.setup();
    renderComposer({ models: MODELS, modelMeta: MODEL_META, model: MODELS[0], modelReadOnly: true });

    expect(screen.queryByRole('combobox', { name: 'Choose model' })).toBeNull();
    expect(screen.getByTitle('Model is fixed for this task')).toHaveTextContent('MindsHub Air');
  });
});

// ─── "Model Router" default option (ENG-1656 follow-up) ──────────────
//
// The picker's first, pinned entry defers to whichever model this
// account's Settings has configured, instead of forcing a task to pin one
// specific model up front. It's hidden for Claude Code specifically — the
// CLI's `--model` flag needs a real, concrete model id.

describe('Composer — "Model Router" default option (ENG-1656 follow-up)', () => {
  it('lists Model Router first, ahead of the maker groups', async () => {
    const user = userEvent.setup();
    renderComposer({ models: MODELS, modelMeta: MODEL_META, model: MODELS[0] });

    await user.click(screen.getByRole('combobox', { name: 'Choose model' }));
    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveTextContent('Model Router');
  });

  it('selecting Model Router calls onModelChange with the sentinel id', async () => {
    const user = userEvent.setup();
    const props = renderComposer({
      models: MODELS, modelMeta: MODEL_META, model: MODELS[0], onModelChange: vi.fn(),
    });

    await user.click(screen.getByRole('combobox', { name: 'Choose model' }));
    await user.click(screen.getByRole('option', { name: 'Model Router' }));

    expect(props.onModelChange).toHaveBeenCalledWith({ id: 'model-router', name: 'Model Router' });
  });

  it('hides Model Router once Claude Code is the harness about to send', async () => {
    const user = userEvent.setup();
    renderComposer({
      models: MODELS, modelMeta: MODEL_META, model: MODELS[0], codingModeEnabled: true,
    });

    // Coding mode defaults to the Anton harness pill until switched —
    // Model Router is still offered until Claude Code is actually picked.
    // The harness pill is a ToggleGroup (radiogroup semantics), not a combobox.
    await user.click(screen.getByRole('combobox', { name: 'Choose model' }));
    expect(screen.queryByRole('option', { name: 'Model Router' })).not.toBeNull();
    await user.keyboard('{Escape}');

    await user.click(await screen.findByRole('button', { name: 'Claude-Code' }));

    await user.click(screen.getByRole('combobox', { name: 'Choose model' }));
    expect(screen.queryByRole('option', { name: 'Model Router' })).toBeNull();
  });
});
