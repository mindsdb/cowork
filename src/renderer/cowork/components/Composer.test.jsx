// The empty-search New project row must open the creation modal and select its result.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Composer from './Composer';
import { MINDS_BILLING_URL } from '../../lib/mindsUrls';

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

// Override only desktop detection for harness tests; spread the real modules so unrelated mount
// dependencies remain available.
const hostSpies = vi.hoisted(() => ({ openExternal: vi.fn() }));
vi.mock('../../platform/host', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    host: {
      ...actual.host,
      isWeb: false,
      openExternal: hostSpies.openExternal,
      detectClaudeCode: vi.fn(async () => ({ installed: true, path: '/usr/local/bin/claude' })),
    },
  };
});

const analyticsSpies = vi.hoisted(() => ({ trackBillingOpened: vi.fn() }));
vi.mock('../lib/analytics', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, trackBillingOpened: analyticsSpies.trackBillingOpened };
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
  // Query the stable aria-label; toolbar reordering changes which meta-pill appears first.
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

// Test Composer-to-ModelSelect wiring and its {id,name} callback contract; grouping belongs to
// ModelSelect/modelCatalog tests.

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
    // Reopening after top-up must refresh affordability without a Settings visit or restart.
    const user = userEvent.setup();
    const onRefresh = vi.fn(async () => {});
    renderComposer({
      models: MODELS,
      modelMeta: { ...MODEL_META, onRefresh },
      model: MODELS[0],
    });

    const trigger = screen.getByRole('combobox', { name: 'Choose model' });
    await user.click(trigger);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    await user.click(trigger);
    await user.click(trigger);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  // Reject unaffordable picks so the selected label cannot misrepresent a different model
  // substituted at execution.
  it('offers a needs-credits model as a disabled row that cannot be chosen', async () => {
    const user = userEvent.setup();
    const props = renderComposer({
      models: MODELS,
      modelMeta: { ...MODEL_META, modelEnabled: { mindshub_air: true, sonnet: false } },
      model: MODELS[0],
      onModelChange: vi.fn(),
    });

    await user.click(screen.getByRole('combobox', { name: 'Choose model' }));
    const locked = screen.getByRole('option', { name: /Claude Sonnet 5/ });
    expect(locked).toHaveAttribute('data-disabled');
    expect(locked).toHaveTextContent('Needs credits');
    // Use an affordable current model so its Settings top-up hint cannot account for the locked
    // row's Add credits action.
    expect(within(locked).getByRole('button', { name: 'Add credits' })).toBeInTheDocument();

    await user.click(locked);
    expect(props.onModelChange).not.toHaveBeenCalled();
  });

  // Keep both option builders' model metadata contracts covered.
  it('opens billing from a needs-credits row without selecting it', async () => {
    const user = userEvent.setup();
    const props = renderComposer({
      models: MODELS,
      modelMeta: { ...MODEL_META, modelEnabled: { mindshub_air: true, sonnet: false } },
      model: MODELS[0],
      onModelChange: vi.fn(),
    });

    await user.click(screen.getByRole('combobox', { name: 'Choose model' }));
    const locked = screen.getByRole('option', { name: /Claude Sonnet 5/ });
    await user.click(within(locked).getByRole('button', { name: 'Add credits' }));

    expect(hostSpies.openExternal).toHaveBeenCalledWith(MINDS_BILLING_URL);
    expect(analyticsSpies.trackBillingOpened).toHaveBeenCalledWith('locked_model_row');
    // This proves the credits action does not select a disabled row; it does not isolate
    // stopPropagation.
    expect(props.onModelChange).not.toHaveBeenCalled();
  });

  it('leaves a model the wallet can pay for selectable', async () => {
    const user = userEvent.setup();
    const props = renderComposer({
      models: MODELS,
      modelMeta: { ...MODEL_META, modelEnabled: { mindshub_air: true, sonnet: false } },
      model: MODELS[0],
      onModelChange: vi.fn(),
    });

    await user.click(screen.getByRole('combobox', { name: 'Choose model' }));
    // Absent from the map, so available. Locking one row must not lock the list.
    await user.click(screen.getByRole('option', { name: 'Kimi K3' }));

    expect(props.onModelChange).toHaveBeenCalledWith({ id: 'kimi', name: 'Kimi K3' });
  });

  it('renders a fixed label instead of a picker when modelReadOnly', async () => {
    const user = userEvent.setup();
    renderComposer({ models: MODELS, modelMeta: MODEL_META, model: MODELS[0], modelReadOnly: true });

    expect(screen.queryByRole('combobox', { name: 'Choose model' })).toBeNull();
    expect(screen.getByTitle('Model is fixed for this task')).toHaveTextContent('MindsHub Air');
  });
});

// Test effort metadata/value/callback wiring through the existing model picker; ModelSelect tests
// cover footer interactions.

const MODEL_EFFORTS = { sonnet: { efforts: ['low', 'medium', 'high'], default: 'medium' } };

describe('Composer — reasoning effort sub-picker (ENG-1940)', () => {
  it('shows the resolved effort, muted, on the model picker trigger for a model with effort options', () => {
    renderComposer({
      models: MODELS,
      modelMeta: { ...MODEL_META, modelEfforts: MODEL_EFFORTS },
      model: MODELS[1], // sonnet
      effort: 'high', // not sonnet's default ("medium") — the trigger suffix only shows then
    });
    expect(screen.getByRole('combobox', { name: 'Choose model' })).toHaveTextContent('Claude Sonnet 5 · High');
  });

  it('shows an "Effort" footer row in the model popup for a model with effort options', async () => {
    const user = userEvent.setup();
    renderComposer({
      models: MODELS,
      modelMeta: { ...MODEL_META, modelEfforts: MODEL_EFFORTS },
      model: MODELS[1], // sonnet
      effort: 'medium',
    });

    await user.click(screen.getByRole('combobox', { name: 'Choose model' }));

    const footerRow = screen.getByText('Effort').parentElement;
    expect(within(footerRow).getByText('Medium')).toBeInTheDocument();
  });

  it('shows no Effort footer at all for a model with no modelEfforts entry', async () => {
    const user = userEvent.setup();
    renderComposer({
      models: MODELS,
      modelMeta: { ...MODEL_META, modelEfforts: MODEL_EFFORTS },
      model: MODELS[0], // mindshub_air — not in MODEL_EFFORTS
      effort: '',
    });

    await user.click(screen.getByRole('combobox', { name: 'Choose model' }));

    expect(screen.queryByText('Effort')).toBeNull();
  });

  it('fires onEffortChange with the picked level, from the footer flyout', async () => {
    const user = userEvent.setup();
    const props = renderComposer({
      models: MODELS,
      modelMeta: { ...MODEL_META, modelEfforts: MODEL_EFFORTS },
      model: MODELS[1], // sonnet
      effort: 'medium',
      onEffortChange: vi.fn(),
    });

    await user.click(screen.getByRole('combobox', { name: 'Choose model' }));
    fireEvent.mouseEnter(screen.getByText('Effort').closest('button'));
    const panel = screen.getByText(/Higher effort means more thorough responses/).parentElement;
    await user.click(within(panel).getByText('High').closest('button'));

    expect(props.onEffortChange).toHaveBeenCalledWith('high');
  });

  it('is suppressed under modelReadOnly, same as the model picker', () => {
    renderComposer({
      models: MODELS,
      modelMeta: { ...MODEL_META, modelEfforts: MODEL_EFFORTS },
      model: MODELS[1],
      effort: 'medium',
      modelReadOnly: true,
    });
    expect(screen.queryByRole('combobox', { name: 'Choose model' })).toBeNull();
    expect(screen.queryByText('Effort')).toBeNull();
  });
});

// Model Router leads MindsHub and defers to account settings; Claude Code must hide it because
// --model needs a concrete id.

describe('Composer — "Model Router" default option (ENG-1656 follow-up)', () => {
  it('lists Model Router first overall, leading the MindsHub group', async () => {
    const user = userEvent.setup();
    renderComposer({ models: MODELS, modelMeta: MODEL_META, model: MODELS[0] });

    await user.click(screen.getByRole('combobox', { name: 'Choose model' }));
    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveTextContent('Model Router');
  });

  it('groups Model Router under the MindsHub heading, ahead of MindsHub Air', async () => {
    const user = userEvent.setup();
    renderComposer({ models: MODELS, modelMeta: MODEL_META, model: MODELS[0] });

    await user.click(screen.getByRole('combobox', { name: 'Choose model' }));
    const listbox = screen.getByRole('listbox');
    const rows = within(listbox).getAllByText(/^(MindsHub|Model Router|MindsHub Air)$/);
    expect(rows.map((r) => r.textContent)).toEqual(['MindsHub', 'Model Router', 'MindsHub Air']);
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

    // Coding mode starts on Anton; select Claude Code before asserting Model Router disappears.
    await user.click(screen.getByRole('combobox', { name: 'Choose model' }));
    expect(screen.queryByRole('option', { name: 'Model Router' })).not.toBeNull();
    await user.keyboard('{Escape}');

    await user.click(await screen.findByRole('button', { name: 'Claude-Code' }));

    await user.click(screen.getByRole('combobox', { name: 'Choose model' }));
    expect(screen.queryByRole('option', { name: 'Model Router' })).toBeNull();
  });

  it('the Model Router row has a settings shortcut that opens Settings without selecting it', async () => {
    const user = userEvent.setup();
    const props = renderComposer({
      models: MODELS, modelMeta: MODEL_META, model: MODELS[0],
      onModelChange: vi.fn(), onOpenSettings: vi.fn(),
    });

    await user.click(screen.getByRole('combobox', { name: 'Choose model' }));
    await user.click(screen.getByRole('button', { name: 'Router Settings' }));

    expect(props.onOpenSettings).toHaveBeenCalledWith('agent');
    expect(props.onModelChange).not.toHaveBeenCalled();
  });

  it('closes the dropdown itself before Settings opens, rather than leaving it stuck open behind the modal', async () => {
    const user = userEvent.setup();
    renderComposer({
      models: MODELS, modelMeta: MODEL_META, model: MODELS[0], onOpenSettings: vi.fn(),
    });

    await user.click(screen.getByRole('combobox', { name: 'Choose model' }));
    expect(screen.getByRole('option', { name: 'Model Router' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Router Settings' }));

    expect(screen.queryByRole('option', { name: 'Model Router' })).toBeNull();
  });

  it('hides the settings shortcut when onOpenSettings is not provided', async () => {
    const user = userEvent.setup();
    renderComposer({ models: MODELS, modelMeta: MODEL_META, model: MODELS[0] });

    await user.click(screen.getByRole('combobox', { name: 'Choose model' }));
    expect(screen.queryByRole('button', { name: 'Router Settings' })).toBeNull();
  });
});

// With an empty catalog, Claude Code must fall back to the account's Coding model rather than
// become unlaunchable.

describe('Composer — Claude Code falls back to the Coding model default (ENG-1656 follow-up)', () => {
  it('auto-selects the Coding model default once Claude Code is picked with nothing selected', async () => {
    const user = userEvent.setup();
    const props = renderComposer({
      models: [], codingModeEnabled: true, onModelChange: vi.fn(),
      codingModelDefault: 'claude-sonnet-4-6',
    });

    await user.click(await screen.findByRole('button', { name: 'Claude-Code' }));

    expect(props.onModelChange).toHaveBeenCalledWith({ id: 'claude-sonnet-4-6', name: 'claude-sonnet-4-6' });
  });

  it('uses the catalog label when the Coding model default is also a listed model', async () => {
    const user = userEvent.setup();
    const props = renderComposer({
      models: MODELS, modelMeta: MODEL_META, codingModeEnabled: true, onModelChange: vi.fn(),
      codingModelDefault: 'kimi',
    });

    await user.click(await screen.findByRole('button', { name: 'Claude-Code' }));

    expect(props.onModelChange).toHaveBeenCalledWith({ id: 'kimi', name: 'Kimi K3' });
  });

  it('does not touch model selection when a real model is already picked', async () => {
    const user = userEvent.setup();
    const props = renderComposer({
      models: MODELS, modelMeta: MODEL_META, model: MODELS[1], codingModeEnabled: true,
      onModelChange: vi.fn(), codingModelDefault: 'claude-sonnet-4-6',
    });

    await user.click(await screen.findByRole('button', { name: 'Claude-Code' }));

    expect(props.onModelChange).not.toHaveBeenCalled();
  });

  it('leaves nothing selected when no Coding model default is configured either', async () => {
    const user = userEvent.setup();
    const props = renderComposer({
      models: [], codingModeEnabled: true, onModelChange: vi.fn(),
    });

    await user.click(await screen.findByRole('button', { name: 'Claude-Code' }));

    expect(props.onModelChange).not.toHaveBeenCalled();
  });

  it('sends the Coding model default even if the sync round-trip has not landed yet (same-tick safety net)', async () => {
    const user = userEvent.setup();
    const props = renderComposer({
      models: [], codingModeEnabled: true, sendsMeta: true,
      // Keep onModelChange a no-op to simulate Send outrunning the parent's model-prop round trip.
      onModelChange: vi.fn(),
      codingModelDefault: 'claude-sonnet-4-6',
      // Use a fresh conversation key to avoid drafts persisted by other tests under the shared
      // new-task key.
      draftKey: 'claude-code-safety-net-test',
    });

    await user.click(await screen.findByRole('button', { name: 'Claude-Code' }));
    await user.type(screen.getByRole('textbox'), 'fix the bug');
    await user.keyboard('{Enter}');

    expect(props.onSend).toHaveBeenCalledWith(
      'fix the bug',
      { harness: 'claude-code', model: 'claude-sonnet-4-6' },
    );
  });
});

// With no provider, open Settings directly instead of offering a Model Router-only menu.

describe('Composer — no provider configured (ENG-1656 follow-up)', () => {
  it('shows a plain Model Router button, not a combobox, when models is empty', () => {
    renderComposer({ models: [], modelMeta: MODEL_META, model: null, onOpenSettings: vi.fn() });

    expect(screen.queryByRole('combobox', { name: 'Choose model' })).toBeNull();
    const button = screen.getByRole('button', { name: 'Model Router' });
    expect(button).toHaveTextContent('Model Router');
  });

  it('clicking the button opens Settings directly, with no dropdown to open first', async () => {
    const user = userEvent.setup();
    const props = renderComposer({
      models: [], modelMeta: MODEL_META, model: null, onOpenSettings: vi.fn(),
    });

    await user.click(screen.getByRole('button', { name: 'Model Router' }));

    expect(props.onOpenSettings).toHaveBeenCalledWith('agent');
  });

  it('falls back to the normal dropdown when onOpenSettings is not provided', () => {
    renderComposer({ models: [], modelMeta: MODEL_META, model: null });

    expect(screen.getByRole('combobox', { name: 'Choose model' })).toBeInTheDocument();
  });

  it('keeps the normal dropdown once real models are available', () => {
    renderComposer({
      models: MODELS, modelMeta: MODEL_META, model: MODELS[0], onOpenSettings: vi.fn(),
    });

    expect(screen.getByRole('combobox', { name: 'Choose model' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Model Router' })).toBeNull();
  });
});

// Harness settings control Hermes/Claude Code availability; Anton remains offered without an enable
// prop.

describe('Composer — harness picker honors the per-harness enable flags', () => {
  it('offers all three harnesses by default', async () => {
    const user = userEvent.setup();
    renderComposer({ models: MODELS, modelMeta: MODEL_META, model: MODELS[0], codingModeEnabled: true });

    expect(await screen.findByRole('button', { name: 'Anton' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hermes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Claude-Code' })).toBeInTheDocument();
  });

  it('hides Hermes when harnessHermesEnabled is false', async () => {
    renderComposer({
      models: MODELS, modelMeta: MODEL_META, model: MODELS[0], codingModeEnabled: true,
      harnessHermesEnabled: false,
    });

    expect(await screen.findByRole('button', { name: 'Anton' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hermes' })).toBeNull();
  });

  it('hides Claude-Code when harnessClaudeCodeEnabled is false', async () => {
    renderComposer({
      models: MODELS, modelMeta: MODEL_META, model: MODELS[0], codingModeEnabled: true,
      harnessClaudeCodeEnabled: false,
    });

    expect(await screen.findByRole('button', { name: 'Anton' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Claude-Code' })).toBeNull();
  });

  it('still offers Anton when Hermes and Claude-Code are both disabled', async () => {
    renderComposer({
      models: MODELS, modelMeta: MODEL_META, model: MODELS[0], codingModeEnabled: true,
      harnessHermesEnabled: false, harnessClaudeCodeEnabled: false,
    });

    expect(await screen.findByRole('button', { name: 'Anton' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hermes' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Claude-Code' })).toBeNull();
  });

  it('falls back to a still-enabled harness if the picked one gets disabled underneath it (e.g. Settings changed elsewhere)', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const baseProps = {
      onSend, project: { name: 'general' }, projects: [{ name: 'general' }],
      onProjectChange: vi.fn(), onCreateProject: vi.fn(async ({ name }) => ({ name })),
      models: MODELS, modelMeta: MODEL_META, model: MODELS[0], codingModeEnabled: true,
      sendsMeta: true, draftKey: 'harness-fallback-test',
    };
    const { rerender } = render(<Composer {...baseProps} />);

    await user.click(await screen.findByRole('button', { name: 'Hermes' }));
    // Hermes gets disabled from underneath the already-open composer.
    rerender(<Composer {...baseProps} harnessHermesEnabled={false} />);

    expect(screen.queryByRole('button', { name: 'Hermes' })).toBeNull();
    expect(await screen.findByRole('button', { name: 'Anton', pressed: true })).toBeInTheDocument();

    await user.type(screen.getByRole('textbox'), 'hello');
    await user.keyboard('{Enter}');
    expect(onSend).toHaveBeenCalledWith('hello', expect.objectContaining({ harness: 'anton' }));
  });
});

describe('Composer — task-mode chip (ENG-1594)', () => {
  const MODE = {
    id: 'slides', pillLabel: 'Create slides', chipLabel: 'Slides',
    icon: 'presentation', placeholder: 'Describe your presentation topic',
    instruction: 'Create a slide presentation.', samplesVariant: 'cards', samples: [],
  };

  it('renders no chip without a taskMode', () => {
    renderComposer();
    expect(screen.queryByRole('button', { name: /remove .* mode/i })).not.toBeInTheDocument();
  });

  it('renders the chip and clears the mode on click', async () => {
    const user = userEvent.setup();
    const onClearTaskMode = vi.fn();
    renderComposer({ taskMode: MODE, onClearTaskMode, placeholder: MODE.placeholder });
    const chip = screen.getByRole('button', { name: 'Remove Slides mode' });
    expect(chip).toHaveTextContent('Slides');
    expect(screen.getByPlaceholderText(MODE.placeholder)).toBeInTheDocument();
    await user.click(chip);
    expect(onClearTaskMode).toHaveBeenCalledTimes(1);
  });
});

// Rename generic clipboard images synchronously so immediate Send cannot outrun attachment
// creation.
describe('Composer — pasted image names (ENG-1100)', () => {
  const CLIPBOARD_NAME = /^clipboard_\d+_[0-9a-f]{8}\.png$/;

  const textarea = () => document.querySelector('textarea.composer-textarea');

  const pasteFiles = (files) => fireEvent.paste(textarea(), {
    clipboardData: {
      items: files.map((f) => ({ kind: 'file', getAsFile: () => f })),
      files,
    },
  });

  const pastedImage = (bytes) =>
    new File([new Uint8Array(bytes)], 'image.png', { type: 'image/png' });

  it('gives two pasted screenshots distinct clipboard_* names', () => {
    const onAttachFiles = vi.fn();
    renderComposer({ onAttachFiles });

    // Different byte lengths: extractClipboardFiles dedupes on name+size, and
    // both files are still called "image.png" at that point.
    pasteFiles([pastedImage([1, 2, 3]), pastedImage([1, 2, 3, 4])]);

    expect(onAttachFiles).toHaveBeenCalledTimes(1);
    const attached = onAttachFiles.mock.calls[0][0];
    expect(attached).toHaveLength(2);
    expect(attached[0].name).toMatch(CLIPBOARD_NAME);
    expect(attached[1].name).toMatch(CLIPBOARD_NAME);
    expect(attached[0].name).not.toBe(attached[1].name);
  });

  it('attaches synchronously and swallows the paste', () => {
    const onAttachFiles = vi.fn();
    renderComposer({ onAttachFiles });

    // No await anywhere: onAttachFiles must have run inside the paste handler.
    const notPrevented = pasteFiles([pastedImage([1, 2, 3])]);

    expect(onAttachFiles).toHaveBeenCalledTimes(1);
    expect(notPrevented).toBe(false);
  });

  it('leaves a text paste alone', () => {
    const onAttachFiles = vi.fn();
    renderComposer({ onAttachFiles });

    const notPrevented = pasteFiles([]);

    expect(onAttachFiles).not.toHaveBeenCalled();
    expect(notPrevented).toBe(true);
  });

  it('keeps a real filename when a named image is pasted', () => {
    const onAttachFiles = vi.fn();
    renderComposer({ onAttachFiles });

    pasteFiles([new File([new Uint8Array([1])], 'chart.png', { type: 'image/png' })]);

    expect(onAttachFiles.mock.calls[0][0][0].name).toBe('chart.png');
  });
});
