// Hidden home orbs keep moving through their fade and pause once it is over;
// a shown orb resumes at once.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import HomeView from './HomeView';

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchSkills: vi.fn(async () => []) };
});

vi.mock('../components/ui', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    OrbitMorph: ({ size, state, paused }) => (
      <span data-testid={`orb-${size}-${state}`} data-paused={String(Boolean(paused))} />
    ),
  };
});

const baseProps = {
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
};

const paused = (testId) => screen.getByTestId(testId).dataset.paused === 'true';
const bootOrb = () => paused('orb-64-thinking');
const idleOrb = () => paused('orb-42-idle');
const thinkingOrb = () => paused('orb-42-thinking');
const advance = (ms) => act(() => { vi.advanceTimersByTime(ms); });

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('HomeView orb pausing', () => {
  it('runs only the idle orb on an idle page', () => {
    render(<HomeView {...baseProps} />);
    expect(idleOrb()).toBe(false);
    expect(thinkingOrb()).toBe(true);
    expect(bootOrb()).toBe(true);
  });

  it('crossfades to thinking: the thinking orb runs at once, the idle orb pauses after its fade', () => {
    const { rerender } = render(<HomeView {...baseProps} />);
    rerender(<HomeView {...baseProps} activeTasks={[{ id: 't1' }]} />);
    expect(thinkingOrb()).toBe(false);
    expect(idleOrb()).toBe(false);

    advance(799);
    expect(idleOrb()).toBe(false);
    advance(1);
    expect(idleOrb()).toBe(true);
    expect(thinkingOrb()).toBe(false);
  });

  it('crossfades back to idle: the idle orb runs at once, the thinking orb pauses after its fade', () => {
    const { rerender } = render(<HomeView {...baseProps} activeTasks={[{ id: 't1' }]} />);
    advance(800);
    rerender(<HomeView {...baseProps} activeTasks={[]} />);
    expect(idleOrb()).toBe(false);
    expect(thinkingOrb()).toBe(false);

    advance(799);
    expect(thinkingOrb()).toBe(false);
    advance(1);
    expect(thinkingOrb()).toBe(true);
    expect(idleOrb()).toBe(false);
  });

  it('keeps the boot orb running through its collapse and pauses it after', () => {
    const { rerender } = render(<HomeView {...baseProps} skipIntro={false} serverOnline={false} />);
    expect(bootOrb()).toBe(false);

    rerender(<HomeView {...baseProps} skipIntro={false} serverOnline />);
    expect(bootOrb()).toBe(false);
    advance(499);
    expect(bootOrb()).toBe(false);
    advance(1);
    expect(bootOrb()).toBe(true);
  });
});
