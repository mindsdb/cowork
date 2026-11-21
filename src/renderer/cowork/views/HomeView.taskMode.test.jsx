// Task-mode wiring in HomeView (ENG-1594): pill selection swaps the surface
// (placeholder, chip, samples), sending routes through composeModeMessage
// (instruction APPENDED so titles/search stay on the user's words), the mode
// clears only on a successful send, and sample picks flow through onPrefill.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HomeView from './HomeView';
import { TASK_MODES } from '../components/taskmodes/taskModes';

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchSkills: vi.fn(async () => []) };
});


const renderHome = (overrides = {}) => {
  const props = {
    onSend: vi.fn(async () => {}),
    activeTasks: [],
    onSelectTask: vi.fn(),
    onClearActive: vi.fn(),
    project: { name: 'general' },
    projects: [{ name: 'general' }],
    models: [],
    onProjectChange: vi.fn(),
    onModelChange: vi.fn(),
    configReady: true,
    serverOnline: true,
    skipIntro: true,
    onPrefill: vi.fn(),
    ...overrides,
  };
  render(<HomeView {...props} />);
  return props;
};

const slides = TASK_MODES.find((m) => m.id === 'slides');

beforeEach(() => {
  window.localStorage.clear();
});

describe('HomeView task modes (ENG-1594)', () => {
  it('picking a pill shows the chip, swaps the placeholder, and swaps pills for samples', async () => {
    const user = userEvent.setup();
    renderHome();
    await user.click(screen.getByRole('button', { name: 'Create slides' }));
    expect(screen.getByRole('button', { name: 'Remove Slides mode' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(slides.placeholder)).toBeInTheDocument();
    expect(screen.getByText('Sample prompts')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create games' })).not.toBeInTheDocument();
  });

  it('sending with a mode appends the instruction line and clears the mode', async () => {
    const user = userEvent.setup();
    const props = renderHome();
    await user.click(screen.getByRole('button', { name: 'Create slides' }));
    await user.type(screen.getByPlaceholderText(slides.placeholder), 'Make a deck about Q3');
    await user.keyboard('{Enter}');
    // Composer's sendsMeta (ENG-1656) always passes a {harness, model} 2nd
    // arg alongside the composed text.
    await waitFor(() => expect(props.onSend).toHaveBeenCalledWith(
      `Make a deck about Q3\n\n${slides.instruction}`,
      { harness: 'anton', model: undefined, taskMode: { task_mode: 'slides', mode_line: 'appended', example_placed: false } },
    ));
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Remove Slides mode' })).not.toBeInTheDocument();
    });
    // Default view restored: pill row is back.
    expect(screen.getByRole('button', { name: 'Create slides' })).toBeInTheDocument();
  });

  it('sends a request typed over a picked example without the mode\'s instruction', async () => {
    const user = userEvent.setup();
    const props = renderHome();
    const viz = TASK_MODES.find((m) => m.id === 'visualization');
    await user.click(screen.getByRole('button', { name: viz.pillLabel }));
    await user.click(screen.getByRole('button', { name: viz.samples[0].label }));
    // onPrefill is the app's; here the person clears the box and types instead.
    await user.type(screen.getByPlaceholderText(viz.placeholder), 'plan a birthday party');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(props.onSend).toHaveBeenCalledWith(
      'plan a birthday party',
      { harness: 'anton', model: undefined, taskMode: { task_mode: 'visualization', mode_line: 'replaced_example', example_placed: true } },
    ));
  });

  it('sends what became of the mode line with the message it describes', async () => {
    const user = userEvent.setup();
    const props = renderHome();
    await user.click(screen.getByRole('button', { name: 'Create slides' }));
    await user.type(screen.getByPlaceholderText(slides.placeholder), 'Make a deck');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(props.onSend).toHaveBeenCalledWith(
      `Make a deck\n\n${slides.instruction}`,
      expect.objectContaining({ taskMode: { task_mode: 'slides', mode_line: 'appended', example_placed: false } }),
    ));
  });

  it('keeps the mode note on a send still in flight when a second Enter is refused', async () => {
    // The app refuses a second Home send while the first is still loading
    // (attachments can take seconds), so the note must belong to each send,
    // not to state the refused one can clear.
    const user = userEvent.setup();
    let release;
    const onSend = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }))
      .mockImplementation(async () => false);
    renderHome({ onSend });
    await user.click(screen.getByRole('button', { name: 'Create slides' }));
    await user.type(screen.getByPlaceholderText(slides.placeholder), 'Make a deck');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    await user.keyboard('{Enter}');
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(2));
    release(true);
    expect(onSend.mock.calls[0][1].taskMode).toEqual({ task_mode: 'slides', mode_line: 'appended', example_placed: false });
  });

  it('sends no mode note when no mode is selected', async () => {
    const user = userEvent.setup();
    const props = renderHome();
    await user.type(screen.getByRole('textbox'), 'hello');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(props.onSend).toHaveBeenCalled());
    expect(props.onSend.mock.calls[0][1]).not.toHaveProperty('taskMode');
  });

  it('keeps the mode when the send fails', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn(async () => { throw new Error('offline'); });
    renderHome({ onSend });
    await user.click(screen.getByRole('button', { name: 'Create slides' }));
    await user.type(screen.getByPlaceholderText(slides.placeholder), 'Make a deck');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(onSend).toHaveBeenCalled());
    // The rejected send must not clear the selection.
    expect(screen.getByRole('button', { name: 'Remove Slides mode' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(slides.placeholder)).toBeInTheDocument();
  });

  it('clearing the chip restores the default placeholder and pill row', async () => {
    const user = userEvent.setup();
    renderHome();
    await user.click(screen.getByRole('button', { name: 'Create games' }));
    // Verb-phrase chip labels expose a noun in the remove label (chipNoun).
    await user.click(screen.getByRole('button', { name: 'Remove Games mode' }));
    expect(screen.queryByRole('button', { name: /remove .* mode/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create games' })).toBeInTheDocument();
  });

  it('picking a sample routes its full prompt through onPrefill without sending', async () => {
    const user = userEvent.setup();
    const props = renderHome();
    await user.click(screen.getByRole('button', { name: 'Create games' }));
    const games = TASK_MODES.find((m) => m.id === 'games');
    const snake = games.samples.find((s) => s.label === 'Classic snake game');
    await user.click(screen.getByRole('button', { name: snake.label }));
    expect(props.onPrefill).toHaveBeenCalledWith(snake.prompt);
    expect(props.onSend).not.toHaveBeenCalled();
  });
});

// ─── Hidden in Coding Mode ─────────────────────────────────────────
//
// The slides/website/app-style prompt scaffolding these pills offer
// doesn't apply to a Claude Code task, so the whole surface (pills,
// samples, any mode already selected) is hidden while Coding Mode is on.

describe('HomeView task modes — hidden in Coding Mode', () => {
  it('does not render the pill row when Coding Mode is enabled', () => {
    renderHome({ codingModeEnabled: true });
    expect(screen.queryByRole('button', { name: 'Create slides' })).not.toBeInTheDocument();
  });

  it('clears an already-selected mode (chip, samples, placeholder) once Coding Mode turns on', async () => {
    const user = userEvent.setup();
    const props = {
      onSend: vi.fn(async () => {}),
      activeTasks: [],
      onSelectTask: vi.fn(),
      onClearActive: vi.fn(),
      project: { name: 'general' },
      projects: [{ name: 'general' }],
      models: [],
      onProjectChange: vi.fn(),
      onModelChange: vi.fn(),
      configReady: true,
      serverOnline: true,
      skipIntro: true,
      onPrefill: vi.fn(),
      codingModeEnabled: false,
    };
    const { rerender } = render(<HomeView {...props} />);
    await user.click(screen.getByRole('button', { name: 'Create slides' }));
    expect(screen.getByRole('button', { name: 'Remove Slides mode' })).toBeInTheDocument();

    rerender(<HomeView {...props} codingModeEnabled />);

    expect(screen.queryByRole('button', { name: 'Remove Slides mode' })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(slides.placeholder)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create slides' })).not.toBeInTheDocument();
  });
});
