// The checklist's "Try an example" row asks Home for the examples. They show
// as soon as the composer is usable, are asked for once, and picking one
// fills the composer without sending.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HomeView from './HomeView';
import { FEATURED_EXAMPLES_MODE } from '../components/taskmodes/taskModes';

const { trackExamplePicked } = vi.hoisted(() => ({ trackExamplePicked: vi.fn() }));
vi.mock('../lib/analytics', async (importOriginal) => ({ ...(await importOriginal()), trackExamplePicked }));
vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchSkills: vi.fn(async () => []) };
});

const renderHome = (props = {}) =>
  render(
    <HomeView
      onSend={vi.fn(async () => true)}
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
      onPrefill={vi.fn()}
      {...props}
    />
  );

beforeEach(() => {
  window.localStorage.clear();
  trackExamplePicked.mockClear();
});

describe('HomeView examples request', () => {
  it('shows the featured examples when asked, and reports the request consumed once', async () => {
    const consumed = vi.fn();
    renderHome({ examplesRequest: 123, onExamplesRequestConsumed: consumed });

    for (const sample of FEATURED_EXAMPLES_MODE.samples) {
      expect(await screen.findByRole('button', { name: sample.label })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Remove Examples mode' })).toBeInTheDocument();
    await waitFor(() => expect(consumed).toHaveBeenCalledTimes(1));
  });

  it('fills the composer with the picked example and does not send it', async () => {
    const onPrefill = vi.fn();
    const onSend = vi.fn(async () => true);
    renderHome({ examplesRequest: 1, onPrefill, onSend });

    const snake = FEATURED_EXAMPLES_MODE.samples.find((s) => s.label === 'Classic snake game');
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Classic snake game' }));

    expect(onPrefill).toHaveBeenCalledWith(snake.prompt);
    expect(onSend).not.toHaveBeenCalled();
    expect(trackExamplePicked).toHaveBeenCalledWith('classic-snake-game', 'examples');
  });

  it('records a pick from a mode\'s own list under that mode', async () => {
    renderHome();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Create games' }));
    await user.click(await screen.findByRole('button', { name: 'Neon falling blocks' }));

    expect(trackExamplePicked).toHaveBeenCalledWith('neon-falling-blocks', 'games');
  });

  it('shows the usual pills, and no examples, without a request', async () => {
    renderHome();

    expect(await screen.findByRole('button', { name: 'Create slides' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove Examples mode' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Classic snake game' })).not.toBeInTheDocument();
  });

  it('waits for a usable composer before showing the examples', async () => {
    const consumed = vi.fn();
    const { rerender } = renderHome({ examplesRequest: 1, onExamplesRequestConsumed: consumed, configReady: false });
    await new Promise((r) => setTimeout(r, 30));
    expect(consumed).not.toHaveBeenCalled();

    rerender(
      <HomeView
        onSend={vi.fn()} activeTasks={[]} onSelectTask={vi.fn()} onClearActive={vi.fn()}
        project={{ name: 'general' }} projects={[{ name: 'general' }]} models={[]}
        onProjectChange={vi.fn()} onModelChange={vi.fn()} configReady serverOnline skipIntro
        onPrefill={vi.fn()} examplesRequest={1} onExamplesRequestConsumed={consumed}
      />
    );
    expect(await screen.findByRole('button', { name: 'Classic snake game' })).toBeInTheDocument();
    expect(consumed).toHaveBeenCalledTimes(1);
  });
});
