// Task-mode pills / samples / chip (ENG-1594): data integrity, pill
// selection, sample picking, and the removable chip in the composer toolbar.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Ico from '../Icons';
import { TASK_MODES, composeModeMessage } from './taskModes';
import TaskModePills from './TaskModePills';
import TaskModeSamples from './TaskModeSamples';

describe('TASK_MODES data', () => {
  it('ships exactly the 7 agreed modes', () => {
    expect(TASK_MODES.map((m) => m.id)).toEqual([
      'slides', 'website', 'apps', 'spreadsheet', 'visualization', 'wide-research', 'games',
    ]);
  });

  it('every mode is complete and its icon key exists', () => {
    for (const m of TASK_MODES) {
      expect(m.pillLabel).toBeTruthy();
      expect(m.chipLabel).toBeTruthy();
      expect(m.placeholder).toBeTruthy();
      expect(m.instruction).toBeTruthy();
      expect(['cards', 'rows']).toContain(m.samplesVariant);
      expect(m.samples.length).toBeGreaterThanOrEqual(4);
      for (const s of m.samples) {
        expect(s.label).toBeTruthy();
        // The inserted prompt is the full detailed text, not the row label.
        expect(s.prompt.length).toBeGreaterThan(s.label.length);
      }
      expect(typeof Ico[m.icon]).toBe('function');
    }
  });

  it('composeModeMessage APPENDS the instruction (titles derive from the message head)', () => {
    const slides = TASK_MODES[0];
    expect(composeModeMessage(slides, 'AI in 2026')).toBe('AI in 2026\n\nCreate a slide presentation.');
    expect(composeModeMessage(null, 'hello')).toBe('hello');
  });

  it('composeModeMessage skips the instruction for an untouched sample prompt (no doubled signal)', () => {
    const games = TASK_MODES.find((m) => m.id === 'games');
    const snake = games.samples.find((s) => s.label === 'Classic snake game');
    expect(composeModeMessage(games, snake.prompt)).toBe(snake.prompt);
    // An edited sample is user text again — the instruction comes back.
    expect(composeModeMessage(games, `${snake.prompt} Make it two-player.`))
      .toBe(`${snake.prompt} Make it two-player.\n\n${games.instruction}`);
  });
});

describe('TaskModePills', () => {
  it('renders all 7 pills and hands the picked mode to onPick', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<TaskModePills onPick={onPick} />);
    for (const m of TASK_MODES) {
      expect(screen.getByRole('button', { name: m.pillLabel })).toBeInTheDocument();
    }
    await user.click(screen.getByRole('button', { name: 'Create slides' }));
    expect(onPick).toHaveBeenCalledWith(TASK_MODES[0]);
  });
});

describe('TaskModeSamples', () => {
  it('cards variant shows the heading and one card per sample', () => {
    const slides = TASK_MODES.find((m) => m.id === 'slides');
    render(<TaskModeSamples mode={slides} onPick={vi.fn()} />);
    expect(screen.getByText('Sample prompts')).toBeInTheDocument();
    for (const s of slides.samples) expect(screen.getByRole('button', { name: s.label })).toBeInTheDocument();
  });

  it('rows variant shows no heading and picks the clicked sample FULL prompt', async () => {
    const user = userEvent.setup();
    const games = TASK_MODES.find((m) => m.id === 'games');
    const onPick = vi.fn();
    render(<TaskModeSamples mode={games} onPick={onPick} />);
    expect(screen.queryByText('Sample prompts')).not.toBeInTheDocument();
    const snake = games.samples.find((s) => s.label === 'Classic snake game');
    await user.click(screen.getByRole('button', { name: snake.label }));
    expect(onPick).toHaveBeenCalledWith(snake.prompt);
  });
});
