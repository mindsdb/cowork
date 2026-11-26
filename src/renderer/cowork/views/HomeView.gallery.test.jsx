// An example started from the Use Case Gallery column lands in the composer
// like a picked example, its mode on and the send credited to the gallery. One
// the list says to send runs at once; one that can take the person's file
// waits, editable, for them to press Send.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HomeView from './HomeView';
import { findSample } from '../lib/consoleHandoff';
import { __resetDraftsForTests } from '../lib/draftStore';
import { reset as resetOnboarding } from '../components/onboarding/onboardingStore';

const { trackExamplePicked } = vi.hoisted(() => ({ trackExamplePicked: vi.fn() }));
vi.mock('../lib/analytics', async (importOriginal) => ({
  ...(await importOriginal()),
  trackExamplePicked,
}));
vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchSkills: vi.fn(async () => []) };
});

const found = findSample('wide-research', 'research-a-prospect-and-draft-outreach');
const entry = { id: 'research-a-prospect-and-draft-outreach', mode: found.mode, sample: found.sample, title: 'Research a prospect and draft outreach', needs: 'Nothing, or your notes' };

let pickFromGallery;
let setPickDirectly;
function Home({ onSend, onOpenGallery = null, ownWorkRequest = 0, attachments = [] }) {
  const [prefill, setPrefill] = useState(null);
  const [pick, setPick] = useState(null);
  setPickDirectly = setPick;
  pickFromGallery = (over = {}) => setPick({ entry: { ...entry, ...over }, send: over.start === 'send', bump: Date.now() });
  return (
    <HomeView
      onSend={onSend}
      attachments={attachments}
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
      onPrefill={(text, select, send) => setPrefill({ text, bump: Date.now(), select, send })}
      onPrefillConsumed={() => setPrefill(null)}
      galleryPick={pick}
      onGalleryPickConsumed={() => setPick(null)}
      onOpenGallery={onOpenGallery}
      ownWorkRequest={ownWorkRequest}
      onOwnWorkRequestConsumed={vi.fn()}
    />
  );
}

// App's side of a pick: it outlives Home, which can be left and come back.
let setHost;
function Host({ onSend }) {
  const [state, setState] = useState({ pick: null, home: true, active: true, configReady: true, serverOnline: true, skipIntro: true });
  const [prefill, setPrefill] = useState(null);
  setHost = (over) => setState((s) => ({ ...s, ...over }));
  if (!state.home) return null;
  return (
    <HomeView
      onSend={onSend}
      attachments={[]}
      activeTasks={[]}
      onSelectTask={vi.fn()}
      onClearActive={vi.fn()}
      project={{ name: 'general' }}
      projects={[{ name: 'general' }]}
      models={[]}
      onProjectChange={vi.fn()}
      onModelChange={vi.fn()}
      configReady={state.configReady}
      onOpenSettings={vi.fn()}
      serverOnline={state.serverOnline}
      skipIntro={state.skipIntro}
      active={state.active}
      prefill={prefill}
      onPrefill={(text, select, send) => setPrefill({ text, bump: Date.now(), select, send })}
      onPrefillConsumed={() => setPrefill(null)}
      galleryPick={state.pick}
      onGalleryPickConsumed={() => setState((s) => ({ ...s, pick: null }))}
      onGalleryPickHeld={() => setState((s) => ({ ...s, pick: s.pick && { ...s.pick, send: false } }))}
    />
  );
}
const tryPick = () => ({ entry: { ...entry, start: 'send' }, send: true, bump: Date.now() });

beforeEach(() => {
  window.localStorage.clear();
  __resetDraftsForTests();
  trackExamplePicked.mockClear();
  resetOnboarding();
});

describe('HomeView gallery start', () => {
  it('places the example with its mode, says where it came from, and sends nothing', async () => {
    const onSend = vi.fn(async () => true);
    render(<Home onSend={onSend} />);
    pickFromGallery();

    await screen.findByDisplayValue(found.sample.prompt);
    expect(screen.getByRole('button', { name: 'Remove Wide Research mode' })).toBeInTheDocument();
    expect(screen.getByText('From the example Research a prospect and draft outreach. Change anything, then press Send.')).toBeInTheDocument();
    expect(trackExamplePicked).toHaveBeenCalledWith('research-a-prospect-and-draft-outreach', 'gallery');

    await new Promise((r) => setTimeout(r, 50));
    expect(onSend).not.toHaveBeenCalled();
  });

  it('sends an example that needs nothing at once, in its mode, credited to the gallery', async () => {
    const onSend = vi.fn(async () => true);
    render(<Home onSend={onSend} />);
    pickFromGallery({ start: 'send' });

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    const [message, meta] = onSend.mock.calls[0];
    expect(message).toContain(found.sample.prompt);
    expect(meta.startVia).toBe('gallery');
    expect(meta.taskMode).toMatchObject({ task_mode: 'wide-research', example_placed: true });
    expect(trackExamplePicked).toHaveBeenCalledWith('research-a-prospect-and-draft-outreach', 'gallery');
    expect(screen.queryByText(/Change anything, then press Send/)).not.toBeInTheDocument();
  });

  it('waits for Send instead when files are already attached on Home, so they never ride along unseen', async () => {
    const onSend = vi.fn(async () => true);
    render(<Home onSend={onSend} attachments={[{ id: 'a1', name: 'notes.pdf' }]} />);
    pickFromGallery({ start: 'send' });
    await screen.findByDisplayValue(found.sample.prompt);
    await new Promise((r) => setTimeout(r, 50));
    expect(onSend).not.toHaveBeenCalled();
  });

  it('sends a Try on its own, without the page open in the browser beside Home', async () => {
    const onSend = vi.fn(async () => true);
    render(<Home onSend={onSend} />);
    pickFromGallery({ start: 'send' });
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend.mock.calls[0][1].leaveBrowserPage).toBe(true);
  });

  it('lets a send the person makes carry the browser page as usual', async () => {
    const onSend = vi.fn(async () => true);
    render(<Home onSend={onSend} />);
    pickFromGallery();
    await screen.findByDisplayValue(found.sample.prompt);
    await userEvent.setup().keyboard('{Enter}');
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend.mock.calls[0][1].leaveBrowserPage).toBeUndefined();
  });

  it('places but does not send an example the click did not send, whatever its list says', async () => {
    const onSend = vi.fn(async () => true);
    render(<Home onSend={onSend} />);
    setPickDirectly({ entry: { ...entry, needs: 'Nothing', start: 'send' }, send: false, bump: Date.now() });
    await screen.findByDisplayValue(found.sample.prompt);
    await new Promise((r) => setTimeout(r, 50));
    expect(onSend).not.toHaveBeenCalled();
  });

  it('only fills the box when the person left Home before a queued Try could send', async () => {
    const onSend = vi.fn(async () => true);
    render(<Host onSend={onSend} />);
    // Clicked while Home is still starting up, so it cannot take it yet.
    act(() => setHost({ home: false }));
    act(() => setHost({ home: true, skipIntro: false, serverOnline: false }));
    act(() => setHost({ pick: tryPick() }));
    act(() => setHost({ home: false }));
    act(() => setHost({ home: true, skipIntro: true, serverOnline: true }));
    await screen.findByDisplayValue(found.sample.prompt);
    await new Promise((r) => setTimeout(r, 50));
    expect(onSend).not.toHaveBeenCalled();
  });

  it('still sends a queued Try for a person who stays on Home until it can', async () => {
    const onSend = vi.fn(async () => true);
    render(<Host onSend={onSend} />);
    act(() => setHost({ home: false }));
    act(() => setHost({ home: true, skipIntro: false, serverOnline: false }));
    act(() => setHost({ pick: tryPick() }));
    await new Promise((r) => setTimeout(r, 50));
    expect(onSend).not.toHaveBeenCalled();
    act(() => setHost({ serverOnline: true }));
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1), { timeout: 8000 });
  }, 10000);

  it('only fills the box, back on Home, when the person switched to Code Mode before a queued Try could send', async () => {
    const onSend = vi.fn(async () => true);
    render(<Host onSend={onSend} />);
    // Clicked while Home is still starting up; Code Mode hides Home, which
    // stays mounted, and Home finishes starting behind it.
    act(() => setHost({ home: false }));
    act(() => setHost({ home: true, skipIntro: false, serverOnline: false }));
    act(() => setHost({ pick: tryPick() }));
    act(() => setHost({ active: false }));
    act(() => setHost({ serverOnline: true }));
    await new Promise((r) => setTimeout(r, 3000));
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.queryByDisplayValue(found.sample.prompt)).toBeNull();
    act(() => setHost({ active: true }));
    await screen.findByDisplayValue(found.sample.prompt, {}, { timeout: 5000 });
    await new Promise((r) => setTimeout(r, 50));
    expect(onSend).not.toHaveBeenCalled();
  }, 15000);

  it('only fills the box when setup turned out to be needed after the click, once setup is done', async () => {
    const onSend = vi.fn(async () => true);
    render(<Host onSend={onSend} />);
    // Clicked while Home is still loading and readiness is not known, then
    // reported missing; the person sets a provider up and Home finishes.
    act(() => setHost({ home: false }));
    act(() => setHost({ home: true, skipIntro: false, serverOnline: false, configReady: undefined }));
    act(() => setHost({ pick: tryPick() }));
    act(() => setHost({ configReady: false }));
    act(() => setHost({ configReady: true, serverOnline: true }));
    await screen.findByDisplayValue(found.sample.prompt, {}, { timeout: 8000 });
    await new Promise((r) => setTimeout(r, 50));
    expect(onSend).not.toHaveBeenCalled();
  }, 10000);

  it('does not send by itself while provider readiness is still unknown', async () => {
    const onSend = vi.fn(async () => true);
    render(<Host onSend={onSend} />);
    act(() => setHost({ configReady: undefined, pick: tryPick() }));
    await screen.findByDisplayValue(found.sample.prompt);
    await new Promise((r) => setTimeout(r, 50));
    expect(onSend).not.toHaveBeenCalled();
  });

  it('credits the send to the gallery, with the edit the person made', async () => {
    const onSend = vi.fn(async () => true);
    render(<Home onSend={onSend} />);
    pickFromGallery();
    const box = await screen.findByDisplayValue(found.sample.prompt);

    const user = userEvent.setup();
    await user.type(box, ' Keep it short.');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    const [message, meta] = onSend.mock.calls[0];
    expect(message).toContain('Keep it short.');
    expect(meta.startVia).toBe('gallery');
  });

  it('does not credit a later, unrelated task to the gallery', async () => {
    const onSend = vi.fn(async () => true);
    render(<Home onSend={onSend} />);
    pickFromGallery();
    const box = await screen.findByDisplayValue(found.sample.prompt);
    const user = userEvent.setup();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));

    await user.type(box, 'Something of my own');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(2));
    expect(onSend.mock.calls[1][1].startVia).toBeUndefined();
  });

  it('replaces the own-work mode with the example instead of clearing it', async () => {
    render(<Home onSend={vi.fn(async () => true)} ownWorkRequest={1} />);
    await screen.findByText(/What should .* work on\?/);
    // A job placed with nothing after it is cleared when the mode is left;
    // the example that replaces it must survive that.
    const job = 'Turn these bank statements or invoices into one spreadsheet.';
    await userEvent.setup().click(await screen.findByRole('button', { name: new RegExp(job.replace(/[.]/g, '\\.')) }));
    await screen.findByDisplayValue(new RegExp(job.replace(/[.]/g, '\\.')));
    pickFromGallery();

    await screen.findByDisplayValue(found.sample.prompt);
    expect(screen.getByRole('button', { name: 'Remove Wide Research mode' })).toBeInTheDocument();
  });

  it('shows the Use Case Gallery button only when it can open the column', async () => {
    const onOpenGallery = vi.fn();
    const { unmount } = render(<Home onSend={vi.fn()} onOpenGallery={onOpenGallery} />);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Use Case Gallery' }));
    expect(onOpenGallery).toHaveBeenCalledTimes(1);
    unmount();

    render(<Home onSend={vi.fn()} />);
    await screen.findByRole('textbox');
    expect(screen.queryByRole('button', { name: 'Use Case Gallery' })).not.toBeInTheDocument();
  });
});
