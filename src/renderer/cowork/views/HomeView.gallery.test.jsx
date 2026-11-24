// An example started from the Use Case Gallery column lands in the composer
// like a picked example, its mode on and the send credited to the gallery. One
// that needs nothing is sent at once; one that can take the person's file
// waits, editable, for them to press Send.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
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
function Home({ onSend, onOpenGallery = null, ownWorkRequest = 0 }) {
  const [prefill, setPrefill] = useState(null);
  const [pick, setPick] = useState(null);
  pickFromGallery = (over = {}) => setPick({ entry: { ...entry, ...over }, bump: Date.now() });
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
    pickFromGallery({ needs: 'Nothing' });

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    const [message, meta] = onSend.mock.calls[0];
    expect(message).toContain(found.sample.prompt);
    expect(meta.startVia).toBe('gallery');
    expect(meta.taskMode).toMatchObject({ task_mode: 'wide-research', example_placed: true });
    expect(trackExamplePicked).toHaveBeenCalledWith('research-a-prospect-and-draft-outreach', 'gallery');
    expect(screen.queryByText(/Change anything, then press Send/)).not.toBeInTheDocument();
  });

  it('places but does not send an example that does not say what it needs', async () => {
    const onSend = vi.fn(async () => true);
    render(<Home onSend={onSend} />);
    pickFromGallery({ needs: undefined });
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
