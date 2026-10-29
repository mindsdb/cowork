// A console link opens Home with an existing sample in the composer. It must
// land editable, never send on its own, and never overwrite the user's draft.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HomeView from './HomeView';
import { captureConsoleHandoff, findSample } from '../lib/consoleHandoff';
import { __resetDraftsForTests, setDraft } from '../lib/draftStore';
import { OWN_WORK_PROMPT } from '../components/onboarding/steps';
import { getSnapshot, reset as resetOnboarding } from '../components/onboarding/onboardingStore';

const { trackComposerReady, setEntryAttribution } = vi.hoisted(() => ({
  trackComposerReady: vi.fn(),
  setEntryAttribution: vi.fn(),
}));
vi.mock('../lib/analytics', async (importOriginal) => ({
  ...(await importOriginal()),
  trackComposerReady,
  setEntryAttribution,
}));
vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchSkills: vi.fn(async () => []) };
});

const snake = findSample('games', 'classic-snake-game').sample;

// Holds the prefill the way App does, so the sample actually reaches the composer.
function Home({ onSend, configReady = true }) {
  const [prefill, setPrefill] = useState(null);
  return (
    <HomeView
      onSend={onSend}
      activeTasks={[]}
      onSelectTask={vi.fn()}
      onClearActive={vi.fn()}
      project={{ name: 'general' }}
      projects={[{ name: 'general' }]}
      models={[]}
      onProjectChange={vi.fn()}
      onModelChange={vi.fn()}
      configReady={configReady}
      serverOnline
      skipIntro
      prefill={prefill}
      onPrefill={(text, select) => setPrefill({ text, bump: Date.now(), select })}
      onPrefillConsumed={() => setPrefill(null)}
    />
  );
}

/* App keeps the prefill above Home and unmounts Home for other views, so this
   holds the prefill outside a Home that can come and go. */
let showHome;
function HomeThatComesAndGoes() {
  const [prefill, setPrefill] = useState(null);
  const [show, setShow] = useState(true);
  showHome = setShow;
  return show ? (
    <HomeView
      onSend={vi.fn()}
      activeTasks={[]}
      onSelectTask={vi.fn()}
      onClearActive={vi.fn()}
      project={{ name: 'general' }}
      projects={[{ name: 'general' }]}
      models={[]}
      onProjectChange={vi.fn()}
      onModelChange={vi.fn()}
      configReady
      serverOnline
      skipIntro
      prefill={prefill}
      onPrefill={(text, select) => setPrefill({ text, bump: Date.now(), select })}
      onPrefillConsumed={() => setPrefill(null)}
    />
  ) : (
    <div>another view</div>
  );
}

const arriveFromConsole = (search) =>
  captureConsoleHandoff({ search, pathname: '/', hash: '' });

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  __resetDraftsForTests();
  trackComposerReady.mockClear();
  setEntryAttribution.mockClear();
  resetOnboarding();
});

describe('HomeView console handoff', () => {
  it('opens with the sample editable in the composer and does not send it', async () => {
    arriveFromConsole('?from=console&mode=games&sample=classic-snake-game');
    const onSend = vi.fn(async () => true);
    render(<Home onSend={onSend} />);

    const box = await screen.findByDisplayValue(snake.prompt);
    expect(screen.getByRole('button', { name: 'Remove Games mode' })).toBeInTheDocument();
    expect(screen.getByText("Edit this prompt, then send when you're ready.")).toBeInTheDocument();
    expect(trackComposerReady).toHaveBeenCalledWith('console', 'classic-snake-game', true);
    expect(setEntryAttribution).toHaveBeenCalledWith('console', 'classic-snake-game');

    // Give any stray auto-send a chance to happen.
    await new Promise((r) => setTimeout(r, 50));
    expect(onSend).not.toHaveBeenCalled();

    const user = userEvent.setup();
    await user.type(box, ' Make it two-player.');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend.mock.calls[0][0]).toContain('Make it two-player.');
    await waitFor(() =>
      expect(screen.queryByText("Edit this prompt, then send when you're ready.")).not.toBeInTheDocument());
  });

  it('retires the hint once the user leaves the sample\'s mode', async () => {
    arriveFromConsole('?from=console&mode=games&sample=classic-snake-game');
    render(<Home onSend={vi.fn()} />);
    await screen.findByDisplayValue(snake.prompt);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Remove Games mode' }));
    await user.click(screen.getByRole('button', { name: 'Create slides' }));
    expect(screen.queryByText("Edit this prompt, then send when you're ready.")).not.toBeInTheDocument();
  });

  it('replaces an earlier sample left unsent with the newly chosen one', async () => {
    const kpi = findSample('visualization', 'track-monthly-kpis-across-departments').sample;
    setDraft('new', snake.prompt);
    arriveFromConsole('?from=console&mode=visualization&sample=track-monthly-kpis-across-departments');
    render(<Home onSend={vi.fn()} />);

    expect(await screen.findByDisplayValue(kpi.prompt)).toBeInTheDocument();
    expect(screen.getByText("Edit this prompt, then send when you're ready.")).toBeInTheDocument();
    expect(trackComposerReady).toHaveBeenCalledWith('console', 'track-monthly-kpis-across-departments', true);
  });

  it('"Start a task" clears an earlier sample left unsent', async () => {
    setDraft('new', snake.prompt);
    arriveFromConsole('?from=console');
    render(<Home onSend={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue(''));
    expect(trackComposerReady).toHaveBeenCalledWith('console', null, false);
  });

  it('"Start a task" keeps a draft the user wrote', async () => {
    setDraft('new', 'my half-written idea');
    arriveFromConsole('?from=console');
    render(<Home onSend={vi.fn()} />);

    expect(await screen.findByDisplayValue('my half-written idea')).toBeInTheDocument();
  });

  it('keeps the user\'s edits to a sample after leaving Home and coming back', async () => {
    arriveFromConsole('?from=console&mode=games&sample=classic-snake-game');
    render(<HomeThatComesAndGoes />);
    const box = await screen.findByDisplayValue(snake.prompt);
    await userEvent.setup().type(box, ' EDITED');

    act(() => showHome(false));
    act(() => showHome(true));

    expect(screen.getByRole('textbox')).toHaveValue(`${snake.prompt} EDITED`);
  });

  it('keeps a draft written after "Start a task" when Home is revisited', async () => {
    setDraft('new', snake.prompt);
    arriveFromConsole('?from=console');
    render(<HomeThatComesAndGoes />);
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue(''));
    await userEvent.setup().type(screen.getByRole('textbox'), 'my own idea');

    act(() => showHome(false));
    act(() => showHome(true));

    expect(screen.getByRole('textbox')).toHaveValue('my own idea');
  });

  it('keeps a prefill the composer never showed when Home is left', () => {
    /* No provider yet: Home shows the connect-a-provider panel instead of the
       composer, so a prefill sent now has not been applied and must wait. */
    const onPrefillConsumed = vi.fn();
    const { unmount } = render(
      <HomeView
        onSend={vi.fn()}
        activeTasks={[]}
        onSelectTask={vi.fn()}
        onClearActive={vi.fn()}
        project={{ name: 'general' }}
        projects={[{ name: 'general' }]}
        models={[]}
        onProjectChange={vi.fn()}
        onModelChange={vi.fn()}
        configReady={false}
        serverOnline
        skipIntro
        prefill={{ text: 'waiting text', bump: 1 }}
        onPrefill={vi.fn()}
        onPrefillConsumed={onPrefillConsumed}
      />
    );

    unmount();

    expect(onPrefillConsumed).not.toHaveBeenCalled();
  });

  it('keeps an earlier sample the user edited', async () => {
    setDraft('new', `${snake.prompt} Make it two-player.`);
    arriveFromConsole('?from=console&mode=visualization&sample=track-monthly-kpis-across-departments');
    render(<Home onSend={vi.fn()} />);

    expect(await screen.findByDisplayValue(`${snake.prompt} Make it two-player.`)).toBeInTheDocument();
    expect(trackComposerReady).toHaveBeenCalledWith('console', 'track-monthly-kpis-across-departments', false);
  });

  it('keeps an unsent draft instead of replacing it with the sample', async () => {
    setDraft('new', 'my half-written idea');
    arriveFromConsole('?from=console&mode=games&sample=classic-snake-game');
    render(<Home onSend={vi.fn()} />);

    expect(await screen.findByDisplayValue('my half-written idea')).toBeInTheDocument();
    expect(screen.queryByDisplayValue(snake.prompt)).not.toBeInTheDocument();
    expect(trackComposerReady).toHaveBeenCalledWith('console', 'classic-snake-game', false);
    // The next task is the user's own draft, not the example's.
    expect(setEntryAttribution).toHaveBeenCalledWith('console', null);
  });

  it('"Start a task" opens an empty composer', async () => {
    arriveFromConsole('?from=console');
    render(<Home onSend={vi.fn()} />);

    await waitFor(() => expect(trackComposerReady).toHaveBeenCalledWith('console', null, false));
    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Create games' })).toBeInTheDocument();
  });

  it('waits until the composer is usable before applying the handoff', async () => {
    arriveFromConsole('?from=console&mode=games&sample=classic-snake-game');
    const { rerender } = render(<Home onSend={vi.fn()} configReady={false} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(trackComposerReady).not.toHaveBeenCalled();

    rerender(<Home onSend={vi.fn()} configReady />);
    expect(await screen.findByDisplayValue(snake.prompt)).toBeInTheDocument();
    expect(trackComposerReady).toHaveBeenCalledTimes(1);
  });

  it('does nothing on an ordinary visit', async () => {
    render(<Home onSend={vi.fn()} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(trackComposerReady).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toHaveValue('');
  });

  it('opens with the own-work prompt in the composer and does not send it', async () => {
    arriveFromConsole('?from=console&start=own-work');
    const onSend = vi.fn(async () => true);
    render(<Home onSend={onSend} />);

    await screen.findByDisplayValue(OWN_WORK_PROMPT);
    expect(trackComposerReady).toHaveBeenCalledWith('console', 'own-work', true);
    expect(setEntryAttribution).toHaveBeenCalledWith('console', 'own-work');
    // It is the first onboarding step, not an example from a mode.
    expect(screen.queryByRole('button', { name: /^Remove .* mode$/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Edit this prompt, then send when you're ready.")).not.toBeInTheDocument();

    await new Promise((r) => setTimeout(r, 50));
    expect(onSend).not.toHaveBeenCalled();
    expect(getSnapshot().completed.has('bring-your-work')).toBe(false);

    await userEvent.setup().keyboard('{Enter}');
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend.mock.calls[0][0]).toBe(OWN_WORK_PROMPT);
    await waitFor(() => expect(getSnapshot().completed.has('bring-your-work')).toBe(true));
  });

  it('keeps an unsent draft instead of replacing it with the own-work prompt', async () => {
    setDraft('new', 'my half-written idea');
    arriveFromConsole('?from=console&start=own-work');
    render(<Home onSend={vi.fn()} />);

    expect(await screen.findByDisplayValue('my half-written idea')).toBeInTheDocument();
    expect(screen.queryByDisplayValue(OWN_WORK_PROMPT)).not.toBeInTheDocument();
    expect(trackComposerReady).toHaveBeenCalledWith('console', 'own-work', false);
    expect(setEntryAttribution).toHaveBeenCalledWith('console', null);
  });

  it('replaces an own-work prompt left unsent from an earlier visit', async () => {
    setDraft('new', OWN_WORK_PROMPT);
    arriveFromConsole('?from=console');
    render(<Home onSend={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue(''));
  });

  it('opens an empty composer for a start it does not know', async () => {
    arriveFromConsole('?from=console&start=something-else');
    render(<Home onSend={vi.fn()} />);

    await waitFor(() => expect(trackComposerReady).toHaveBeenCalledWith('console', null, false));
    expect(screen.getByRole('textbox')).toHaveValue('');
  });
});
