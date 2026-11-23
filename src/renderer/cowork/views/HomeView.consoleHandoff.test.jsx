// A console link opens Home with an existing sample in the composer. It must
// land editable, never send on its own, and never overwrite the user's draft.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useState, StrictMode } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HomeView from './HomeView';
import { captureConsoleHandoff, findSample, sampleId } from '../lib/consoleHandoff';
import { TASK_MODES, OWN_WORK_MODE, composeOwnWorkMessage } from '../components/taskmodes/taskModes';
import { __resetDraftsForTests, setDraft } from '../lib/draftStore';
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
function Home({ onSend, configReady = true, ownWorkRequest = 0 }) {
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
      ownWorkRequest={ownWorkRequest}
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
  it('credits a link from the console Gallery to the Gallery', async () => {
    arriveFromConsole('?from=console&mode=games&sample=celestial-merge-2048&placement=gallery');
    render(<Home onSend={vi.fn(async () => true)} />);

    await screen.findByDisplayValue(findSample('games', 'celestial-merge-2048').sample.prompt);
    expect(trackComposerReady).toHaveBeenCalledWith('console', 'celestial-merge-2048', true, 'gallery');
    expect(setEntryAttribution).toHaveBeenCalledWith('console', 'celestial-merge-2048', 'gallery');
  });

  it('opens with the sample editable in the composer and does not send it', async () => {
    arriveFromConsole('?from=console&mode=games&sample=classic-snake-game');
    const onSend = vi.fn(async () => true);
    render(<Home onSend={onSend} />);

    const box = await screen.findByDisplayValue(snake.prompt);
    expect(screen.getByRole('button', { name: 'Remove Games mode' })).toBeInTheDocument();
    expect(screen.getByText("Edit this prompt, then send when you're ready.")).toBeInTheDocument();
    expect(trackComposerReady).toHaveBeenCalledWith('console', 'classic-snake-game', true, null);
    expect(setEntryAttribution).toHaveBeenCalledWith('console', 'classic-snake-game', null);

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

  it('counts a linked example as tried when it is edited inside its text, like one picked from the list', async () => {
    arriveFromConsole('?from=console&mode=games&sample=classic-snake-game');
    const onSend = vi.fn(async () => true);
    render(<Home onSend={onSend} />);
    const box = await screen.findByDisplayValue(snake.prompt);

    const user = userEvent.setup();
    await user.clear(box);
    await user.paste(snake.prompt.replace(/\b\w{4,}\b/, 'changed'));
    await user.keyboard('{Enter}');

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getSnapshot().completed.has('see-it-work')).toBe(true));
  });

  it('sends no mode line after the linked example is cleared, even if the new request shares its words', async () => {
    const slides = TASK_MODES.find((m) => m.id === 'slides');
    const weekly = slides.samples.find((s) => s.label === 'Automate weekly team status reporting');
    arriveFromConsole(`?from=console&mode=slides&sample=${sampleId(weekly.label)}`);
    const onSend = vi.fn(async () => true);
    render(<Home onSend={onSend} />);
    const box = await screen.findByDisplayValue(weekly.prompt);

    // Opens like the example and shares its topic words, but asks for an email.
    const email = 'Create a weekly email for my team covering milestones, completed tasks, blockers, '
      + 'and upcoming priorities. Keep it short. No slides.';
    const user = userEvent.setup();
    await user.clear(box);
    await user.type(box, email);
    await user.keyboard('{Enter}');

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend.mock.calls[0][0]).toBe(email);
  });

  it('sends no mode line after the linked example is selected and typed over', async () => {
    const slides = TASK_MODES.find((m) => m.id === 'slides');
    const weekly = slides.samples.find((s) => s.label === 'Automate weekly team status reporting');
    arriveFromConsole(`?from=console&mode=slides&sample=${sampleId(weekly.label)}`);
    const onSend = vi.fn(async () => true);
    render(<Home onSend={onSend} />);
    const box = await screen.findByDisplayValue(weekly.prompt);

    const email = 'Create a weekly email for my team covering milestones, completed tasks, blockers, '
      + 'and upcoming priorities. Keep it short. No slides.';
    const user = userEvent.setup();
    await user.tripleClick(box);
    await user.keyboard(email);
    await user.keyboard('{Enter}');

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend.mock.calls[0][0]).toBe(email);
  });

  it('sends no mode line after the linked example is selected and a different request pasted over it', async () => {
    const slides = TASK_MODES.find((m) => m.id === 'slides');
    const weekly = slides.samples.find((s) => s.label === 'Automate weekly team status reporting');
    arriveFromConsole(`?from=console&mode=slides&sample=${sampleId(weekly.label)}`);
    const onSend = vi.fn(async () => true);
    render(<Home onSend={onSend} />);
    const box = await screen.findByDisplayValue(weekly.prompt);

    const email = 'Create a weekly email for my team covering milestones, completed tasks, blockers, '
      + 'and upcoming priorities. Keep it short. No slides.';
    const user = userEvent.setup();
    await user.tripleClick(box);
    await user.paste(email);
    await user.keyboard('{Enter}');

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend.mock.calls[0][0]).toBe(email);
  });

  it('sends no mode line when an edit inside the linked example changes what it asks for', async () => {
    const slides = TASK_MODES.find((m) => m.id === 'slides');
    const weekly = slides.samples.find((s) => s.label === 'Automate weekly team status reporting');
    arriveFromConsole(`?from=console&mode=slides&sample=${sampleId(weekly.label)}`);
    const onSend = vi.fn(async () => true);
    render(<Home onSend={onSend} />);
    const box = await screen.findByDisplayValue(weekly.prompt);

    // Select "presentation template with slides" inside the example and type "email".
    const target = 'presentation template with slides';
    const start = weekly.prompt.indexOf(target);
    const user = userEvent.setup();
    await user.click(box);
    box.setSelectionRange(start, start + target.length);
    await user.keyboard('email');
    await user.keyboard('{Enter}');

    const edited = weekly.prompt.replace(target, 'email');
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend.mock.calls[0][0]).toBe(edited);
  });

  it('still adds the mode line to a linked example edited in place, without clearing it', async () => {
    const slides = TASK_MODES.find((m) => m.id === 'slides');
    const weekly = slides.samples.find((s) => s.label === 'Automate weekly team status reporting');
    arriveFromConsole(`?from=console&mode=slides&sample=${sampleId(weekly.label)}`);
    const onSend = vi.fn(async () => true);
    render(<Home onSend={onSend} />);
    const box = await screen.findByDisplayValue(weekly.prompt);

    const user = userEvent.setup();
    await user.click(box);
    await user.keyboard('{End} Ten slides.');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend.mock.calls[0][0]).toBe(`${weekly.prompt} Ten slides.\n\n${slides.instruction}`);
  });

  it('sends a linked plain example as written when it is edited inside its text', async () => {
    const mode = TASK_MODES.find((m) => m.instruction && m.samples.some((s) => s.plain));
    const plain = mode.samples.find((s) => s.plain);
    arriveFromConsole(`?from=console&mode=${mode.id}&sample=${sampleId(plain.label)}`);
    const onSend = vi.fn(async () => true);
    render(<Home onSend={onSend} />);
    const box = await screen.findByDisplayValue(plain.prompt);

    const edited = plain.prompt.replace(/\b\w{4,}\b/, 'changed');
    const user = userEvent.setup();
    await user.clear(box);
    await user.paste(edited);
    await user.keyboard('{Enter}');

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend.mock.calls[0][0]).toBe(edited);
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
    expect(trackComposerReady).toHaveBeenCalledWith('console', 'track-monthly-kpis-across-departments', true, null);
  });

  it('"Start a task" clears an earlier sample left unsent', async () => {
    setDraft('new', snake.prompt);
    arriveFromConsole('?from=console');
    render(<Home onSend={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue(''));
    expect(trackComposerReady).toHaveBeenCalledWith('console', null, false, null);
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
    expect(trackComposerReady).toHaveBeenCalledWith('console', 'track-monthly-kpis-across-departments', false, null);
  });

  it('keeps an unsent draft instead of replacing it with the sample', async () => {
    setDraft('new', 'my half-written idea');
    arriveFromConsole('?from=console&mode=games&sample=classic-snake-game');
    render(<Home onSend={vi.fn()} />);

    expect(await screen.findByDisplayValue('my half-written idea')).toBeInTheDocument();
    expect(screen.queryByDisplayValue(snake.prompt)).not.toBeInTheDocument();
    expect(trackComposerReady).toHaveBeenCalledWith('console', 'classic-snake-game', false, null);
    // The next task is the user's own draft, not the example's.
    expect(setEntryAttribution).toHaveBeenCalledWith('console', null, null);
  });

  it('"Start a task" opens an empty composer', async () => {
    arriveFromConsole('?from=console');
    render(<Home onSend={vi.fn()} />);

    await waitFor(() => expect(trackComposerReady).toHaveBeenCalledWith('console', null, false, null));
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

  it('opens the own-work mode with nothing placed, and sends only once the person gives it something', async () => {
    arriveFromConsole('?from=console&start=own-work');
    const onSend = vi.fn(async () => true);
    render(<Home onSend={onSend} />);

    expect(await screen.findByRole('button', { name: 'Remove Your work mode' })).toBeInTheDocument();
    expect(screen.getByText('What should Cowork work on?')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(trackComposerReady).toHaveBeenCalledWith('console', 'own-work', true, null);
    // The own-work credit rides with the send from the mode, not the arrival.
    expect(setEntryAttribution).toHaveBeenCalledWith('console', null, null);

    const user = userEvent.setup();
    await user.click(screen.getByRole('textbox'));
    await user.keyboard('{Enter}');
    await new Promise((r) => setTimeout(r, 50));
    expect(onSend).not.toHaveBeenCalled();
    expect(getSnapshot().completed.has('bring-your-work')).toBe(false);

    await user.type(screen.getByRole('textbox'), 'Weekly ops notes');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend.mock.calls[0][0]).toBe(composeOwnWorkMessage('Weekly ops notes'));
    expect(onSend.mock.calls[0][1]).toMatchObject({ entryExampleId: 'own-work' });
    await waitFor(() => expect(getSnapshot().completed.has('bring-your-work')).toBe(true));
  });

  it('credits the own-work link under StrictMode too, which runs mount effects twice', async () => {
    arriveFromConsole('?from=console&start=own-work');
    const onSend = vi.fn(async () => true);
    render(<StrictMode><Home onSend={onSend} /></StrictMode>);
    const user = userEvent.setup();
    await screen.findByText('What should Cowork work on?');

    await user.type(screen.getByRole('textbox'), 'Weekly ops notes');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend.mock.calls[0][1]).toMatchObject({ entryExampleId: 'own-work' });
  });

  it('does not credit the own-work link once the person left the mode, even if they open it again', async () => {
    arriveFromConsole('?from=console&start=own-work');
    const onSend = vi.fn(async () => true);
    const { rerender } = render(<Home onSend={onSend} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Remove Your work mode' }));
    rerender(<Home onSend={onSend} ownWorkRequest={1} />);
    await screen.findByText('What should Cowork work on?');

    await user.type(screen.getByRole('textbox'), 'Weekly ops notes');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend.mock.calls[0][0]).toBe(composeOwnWorkMessage('Weekly ops notes'));
    expect(onSend.mock.calls[0][1]?.entryExampleId).toBeUndefined();
  });

  it('does not credit the own-work link for a task sent after the person left the mode', async () => {
    arriveFromConsole('?from=console&start=own-work');
    const onSend = vi.fn(async () => true);
    render(<Home onSend={onSend} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Remove Your work mode' }));

    await user.type(screen.getByRole('textbox'), 'Plan my week');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend.mock.calls[0][0]).toBe('Plan my week');
    expect(onSend.mock.calls[0][1]?.entryExampleId).toBeUndefined();
  });

  it('keeps an unsent draft as the material when it opens the own-work mode', async () => {
    setDraft('new', 'my half-written idea');
    arriveFromConsole('?from=console&start=own-work');
    render(<Home onSend={vi.fn()} />);

    expect(await screen.findByDisplayValue('my half-written idea')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Your work mode' })).toBeInTheDocument();
    expect(trackComposerReady).toHaveBeenCalledWith('console', 'own-work', true, null);
    // The own-work credit rides with the send from the mode, not the arrival.
    expect(setEntryAttribution).toHaveBeenCalledWith('console', null, null);
  });

  it('replaces a job left unsent from an earlier visit', async () => {
    setDraft('new', OWN_WORK_MODE.samples[0].prompt);
    arriveFromConsole('?from=console');
    render(<Home onSend={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue(''));
  });

  it('opens an empty composer for a start it does not know', async () => {
    arriveFromConsole('?from=console&start=something-else');
    render(<Home onSend={vi.fn()} />);

    await waitFor(() => expect(trackComposerReady).toHaveBeenCalledWith('console', null, false, null));
    expect(screen.getByRole('textbox')).toHaveValue('');
  });

  it('records the console\'s sign-in landing as that landing, with an empty composer', async () => {
    arriveFromConsole('?from=console&placement=sign-in');
    render(<Home onSend={vi.fn()} />);

    await waitFor(() => expect(trackComposerReady).toHaveBeenCalledWith('console', null, false, 'sign-in'));
    expect(trackComposerReady).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('textbox')).toHaveValue('');
  });
});

// A console link that finds the connect-a-provider panel is still an arrival.
describe('HomeView console arrival behind the provider panel', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('records the arrival as blocked once the panel has held', async () => {
    vi.useFakeTimers();
    arriveFromConsole('?from=console&placement=sign-in');
    render(<Home onSend={vi.fn()} configReady={false} />);

    await act(async () => { vi.advanceTimersByTime(4900); });
    expect(trackComposerReady).not.toHaveBeenCalled();

    await act(async () => { vi.advanceTimersByTime(200); });
    expect(trackComposerReady).toHaveBeenCalledTimes(1);
    expect(trackComposerReady).toHaveBeenCalledWith('console', null, false, 'sign-in', { blocked: true });
    // The arrival is recorded, not applied: no attribution until a task can start.
    expect(setEntryAttribution).not.toHaveBeenCalled();
  });

  it('still places the sample when the composer becomes usable, without a second record', async () => {
    vi.useFakeTimers();
    arriveFromConsole('?from=console&mode=games&sample=classic-snake-game&placement=gallery');
    const { rerender } = render(<Home onSend={vi.fn()} configReady={false} />);
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(trackComposerReady).toHaveBeenCalledWith('console', 'classic-snake-game', false, 'gallery', { blocked: true });
    vi.useRealTimers();

    rerender(<Home onSend={vi.fn()} configReady />);
    expect(await screen.findByDisplayValue(snake.prompt)).toBeInTheDocument();
    expect(trackComposerReady).toHaveBeenCalledTimes(1);
    expect(setEntryAttribution).toHaveBeenCalledWith('console', 'classic-snake-game', 'gallery');
  });

  it('does not record a second blocked arrival when Home is opened again', async () => {
    vi.useFakeTimers();
    arriveFromConsole('?from=console&placement=sign-in');
    const first = render(<Home onSend={vi.fn()} configReady={false} />);
    await act(async () => { vi.advanceTimersByTime(5000); });
    first.unmount();

    render(<Home onSend={vi.fn()} configReady={false} />);
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(trackComposerReady).toHaveBeenCalledTimes(1);
  });

  it('records a usable arrival, not a blocked one, when the panel only flashes at boot', async () => {
    vi.useFakeTimers();
    arriveFromConsole('?from=console&placement=sign-in');
    const { rerender } = render(<Home onSend={vi.fn()} configReady={false} />);
    await act(async () => { vi.advanceTimersByTime(2000); });

    rerender(<Home onSend={vi.fn()} configReady />);
    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(trackComposerReady).toHaveBeenCalledTimes(1);
    expect(trackComposerReady).toHaveBeenCalledWith('console', null, false, 'sign-in');
  });

  it('records nothing behind the panel on an ordinary visit', async () => {
    vi.useFakeTimers();
    render(<Home onSend={vi.fn()} configReady={false} />);
    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(trackComposerReady).not.toHaveBeenCalled();
  });
});
