// Regression for ENG-992: the project menu's "+ New project" row (empty
// search) used to only focus the search input — visually nothing happened.
// It must open the "Start a new project" modal, and a create from that
// modal must select the new project on the composer.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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

// The coding-mode harness pill only renders on desktop (`!host.isWeb`) —
// jsdom's default host reads as web, which would hide it from every test
// in this file. Only the "Model Router" harness-switch test below
// exercises it; everything else (api.js's getApiOrigin() at import time,
// etc.) keeps the real host.
// Spread the real modules and override only what these tests assert on, so a
// new export never has to be added here to keep the file importable.
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

  // The bug this closes: a free user could pick a model the wallet can't pay
  // for, and the turn then ran a different, affordable model, because
  // resolution substitutes a pin it knows the gateway will deny. So the answer
  // came from one model while the picker named another.
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
    // The row is closed off, so this button is the only thing left on it that
    // answers "how do I unlock this". Settings' top-up hint does not cover the
    // case: it renders for the CURRENT model, and the current model here is one
    // the wallet can pay for.
    expect(within(locked).getByRole('button', { name: 'Add credits' })).toBeInTheDocument();

    await user.click(locked);
    expect(props.onModelChange).not.toHaveBeenCalled();
  });

  // The mirror to settingsTransform's own assertion — the two option builders
  // are meant to produce the same row, and the only thing keeping them honest
  // is asserting the same facts on both.
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
    // The row is disabled, so Base UI never reaches its select handler. This
    // pins that the button did not somehow route around that, not the
    // button's own stopPropagation, which no test here can distinguish.
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

// ─── "Model Router" default option (ENG-1656 follow-up) ──────────────
//
// The picker's first entry defers to whichever model this account's
// Settings has configured, instead of forcing a task to pin one specific
// model up front. It lives inside the MindsHub group (leading it) rather
// than pinned above every section. It's hidden for Claude Code
// specifically — the CLI's `--model` flag needs a real, concrete model id.

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

// ─── Claude Code falls back to the account's Coding model ────────────
//
// Model Router can't drive Claude Code (no auto-routing concept in the
// CLI), so switching harness to Claude Code with nothing pickable — e.g.
// no MindsHub session, so `models` (the catalog) is empty — must not
// leave the task unlaunchable. It falls back to Settings' configured
// Coding model instead.

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
      // onModelChange deliberately a no-op mock — this Composer instance's
      // `model` prop never actually updates, simulating a Send that races
      // ahead of the parent's state round-trip.
      onModelChange: vi.fn(),
      codingModelDefault: 'claude-sonnet-4-6',
      // Draft text persists (useDraft) keyed by conversationId — a fresh
      // key keeps this test isolated from any draft another test in this
      // file left behind under the shared default 'new' key.
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

// ─── No provider configured: a plain button, not a dropdown ──────────
//
// With no MindsHub/BYOK provider connected, `models` (the real catalog)
// is empty, so Model Router would be the only pickable row anyway — a
// dropdown that opens to one unpickable-in-practice option reads as
// broken. Composer shows a plain button styled like the closed picker
// pill (so it doesn't look like an unrelated control) with a settings
// gear instead of the dropdown caret, going straight to Settings.

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

// ─── Harness picker reflects Settings → Coding Mode (ENG-1656 follow-up) ──
//
// The pill's options come from the harnessHermesEnabled / harnessClaudeCodeEnabled
// props (default true), not a fixed Anton/Claude-Code list — Hermes is now
// offerable too. Anton has no enable prop: it's the default agent and is
// always offered, so the pill can never be hidden entirely.

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

    // The reset effect corrects the pill itself...
    expect(screen.queryByRole('button', { name: 'Hermes' })).toBeNull();
    expect(await screen.findByRole('button', { name: 'Anton', pressed: true })).toBeInTheDocument();

    // ...and a send reflects the corrected value, never the disabled one.
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
