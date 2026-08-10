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

// `hideModel: true` matches every production call site: the home and projects
// composers pass it bare and ChatView passes `hideMeta`, so no shipped surface
// renders the model pill. The model-menu tests below override it to false because
// that is the only way to exercise the menu at all — read them as coverage of the
// menu's logic, not of a surface a user can currently reach.
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

/**
 * The open menu's sections in document order: heading text → its rows' text.
 * Headings are the menu's only <div> children; every row is a <button>.
 */
const menuSections = () => {
  const sections = new Map();
  let heading = null;
  for (const el of document.querySelector('.menu').children) {
    if (el.tagName === 'DIV') sections.set((heading = el.textContent), []);
    else if (heading !== null) sections.get(heading).push(el.textContent);
  }
  return sections;
};

describe('Composer — model menu sections', () => {
  it('renders the section headings in order, MindsHub first', async () => {
    const user = userEvent.setup();
    renderComposer({ models: MODELS, modelMeta: MODEL_META, hideModel: false, model: MODELS[0] });
    await openModelMenu(user);

    // Read out of the DOM in document order: the order is the design, and three
    // presence checks pass whatever order the sections come out in. The flat menu's
    // single "Model" heading is replaced by these, so it must not be among them.
    expect([...menuSections().keys()]).toEqual(['MindsHub', 'Anthropic', 'Open Weight']);
  });

  it('keeps MindsHub Air out of the vendor section serving it', async () => {
    // The whole point rests on the fixture reporting Air under the same vendor as
    // the Claude models, so assert that rather than trusting it: edit the fixture
    // and this test would otherwise still pass while proving nothing.
    expect(MODEL_META.modelProviders.mindshub_air).toBe(MODEL_META.modelProviders.sonnet);

    const user = userEvent.setup();
    renderComposer({ models: MODELS, modelMeta: MODEL_META, hideModel: false, model: MODELS[0] });
    await openModelMenu(user);

    const sections = menuSections();
    expect(sections.get('MindsHub')).toEqual(['MindsHub Air']);
    expect(sections.get('Anthropic')).toEqual(['Claude Sonnet 5']);
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

  it('renders a provider icon on every row, in every section', async () => {
    // The Open Weight and Other sections were the concern: collapsing several
    // makers under one heading must not cost a model its mark, because the icon
    // comes from the per-model maker and not from the section. `glm` still shows
    // the neutral placeholder — Z.ai has no svg yet (ENG-1112) — but a placeholder
    // is a rendered mark, not a missing one.
    const user = userEvent.setup();
    renderComposer({
      models: [
        { id: 'sonnet', name: 'Claude Sonnet 5' },     // Anthropic → has a mark
        { id: 'kimi', name: 'Kimi K3' },               // Open Weight → Moonshot mark
        { id: 'glm', name: 'GLM 5.2' },                // Open Weight → placeholder
        { id: 'muse-spark', name: 'Muse Spark 1.1' },  // Other → Meta mark
        { id: 'grok', name: 'Grok 4.5' },              // Other → xAI mark
      ],
      modelMeta: {
        modelProviders: {
          sonnet: 'anthropic', kimi: 'moonshot', glm: 'fireworks',
          'muse-spark': 'meta', grok: 'xai',
        },
        modelFamilies: {
          sonnet: 'sonnet', kimi: 'kimi', glm: 'glm', 'muse-spark': 'muse-spark', grok: 'grok',
        },
      },
      hideModel: false,
      model: { id: 'sonnet', name: 'Claude Sonnet 5' },
    });
    await openModelMenu(user);

    // Both collapsed sections are present, and every row carries an icon.
    expect(screen.getByText('Open Weight')).toBeTruthy();
    expect(screen.getByText('Other')).toBeTruthy();
    const rows = [...document.querySelectorAll('.menu .menu-item')];
    expect(rows).toHaveLength(5);
    // The mark itself, not just "an svg": ProviderIcon always returns the <svg>
    // wrapper and only switches its children on the maker, so a constant maker for
    // every row would pass a presence check. Four distinct makers plus Z.ai's
    // placeholder means five distinct mark bodies.
    const markOf = (name) => rows.find((row) => row.textContent.includes(name)).querySelector('svg').innerHTML;
    const marks = ['Claude Sonnet 5', 'Kimi K3', 'GLM 5.2', 'Muse Spark 1.1', 'Grok 4.5'].map(markOf);
    expect(new Set(marks).size).toBe(rows.length);
    // And the one without an svg yet is the placeholder, not a wrong company's mark.
    expect(markOf('GLM 5.2')).toContain('<circle');
    expect(markOf('Kimi K3')).toContain('<path');
  });

  it('tags no BYOK model when the metadata covers only MindsHub ids', async () => {
    // The shape every call site produces: modelFamilies is global to the settings
    // blob while `models` is the selected provider's list. A user with a MindsHub
    // key who points a role at Anthropic previously saw every row tagged "latest",
    // including a dated snapshot that provably never moves.
    const user = userEvent.setup();
    renderComposer({
      models: [
        { id: 'claude-opus-4-8', name: 'Claude Opus 4.8' },
        { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5' },
      ],
      modelMeta: {
        modelProviders: { sonnet: 'anthropic' },
        modelFamilies: { sonnet: 'sonnet' },
      },
      hideModel: false,
      model: { id: 'claude-opus-4-8', name: 'Claude Opus 4.8' },
    });
    await openModelMenu(user);

    expect(screen.queryByText('latest')).toBeNull();
    // And it stays flat: the metadata mentions none of these ids, so there is nothing
    // authoritative to section them by. Grouping on a non-empty map alone filed them
    // under sections decided by alias inference, which is the guess the backend field
    // exists to replace.
    expect([...menuSections().keys()]).toEqual(['Model']);
  });

  it('tags nothing until a frozen version is listed', async () => {
    const user = userEvent.setup();
    renderComposer({ models: MODELS, modelMeta: MODEL_META, hideModel: false, model: MODELS[0] });
    await openModelMenu(user);
    expect(screen.queryByText('latest')).toBeNull();
  });

  it('never drops a row on a family chain or a cycle', async () => {
    // Options must stay a permutation of the input; a dropped id is a model the
    // user can no longer select and, for a persisted selection, a desync.
    const user = userEvent.setup();
    const chain = [
      { id: 'sonnet', name: 'Claude Sonnet 5' },
      { id: 'sonnet-4-5', name: 'Claude Sonnet 4.5' },
      { id: 'sonnet-4-1', name: 'Claude Sonnet 4.1' },
    ];
    renderComposer({
      models: chain,
      modelMeta: {
        modelProviders: { sonnet: 'anthropic', 'sonnet-4-5': 'anthropic', 'sonnet-4-1': 'anthropic' },
        modelFamilies: { sonnet: 'sonnet', 'sonnet-4-5': 'sonnet', 'sonnet-4-1': 'sonnet-4-5' },
      },
      hideModel: false,
      model: chain[0],
    });
    await openModelMenu(user);

    expect([...document.querySelectorAll('.menu .menu-item')]).toHaveLength(3);
    for (const m of chain) expect(screen.getAllByText(m.name).length).toBeGreaterThan(0);
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

  it('re-checks wallet availability when the menu opens, once per window', async () => {
    // Parity with the Settings picker. Without it, a user who hits "Add credits"
    // (external browser), tops up and returns finds the row still greyed until they
    // visit Settings or restart — which would make disabling locked models here
    // worse than not disabling them at all.
    const user = userEvent.setup();
    const onRefresh = vi.fn(async () => {});
    renderComposer({
      models: MODELS,
      modelMeta: { ...MODEL_META, onRefresh },
      hideModel: false,
      model: MODELS[0],
    });

    await openModelMenu(user);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    await openModelMenu(user); // close
    await openModelMenu(user); // reopen inside the freshness window
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('opens normally when no refresh callback is supplied', async () => {
    const user = userEvent.setup();
    renderComposer({ models: MODELS, modelMeta: MODEL_META, hideModel: false, model: MODELS[0] });
    await openModelMenu(user);
    expect(screen.getByText('Anthropic')).toBeTruthy();
  });

  it('keeps the "Model" heading when the list is still empty (settings loading)', async () => {
    const user = userEvent.setup();
    renderComposer({ models: [], modelMeta: MODEL_META, hideModel: false, model: null });
    await openModelMenu(user);
    expect(screen.getByText('Model')).toBeTruthy();
  });
});
