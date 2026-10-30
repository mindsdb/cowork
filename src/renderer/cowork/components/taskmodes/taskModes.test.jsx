// Task-mode pills / samples / chip (ENG-1594): data integrity, pill
// selection, sample picking, and the removable chip in the composer toolbar.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Ico from '../Icons';
import { TASK_MODES, FEATURED_EXAMPLES_MODE, composeModeMessage, resemblesSample } from './taskModes';
import { sampleId } from '../../lib/consoleHandoff';
import { HABIT_TRACKER_PROMPT } from '../onboarding/steps';
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

  // A console link names a sample by an id derived from its label, so two
  // samples with the same id would make a link open the wrong one.
  it('every sample has its own id across all modes', () => {
    const ids = TASK_MODES.flatMap((m) => m.samples.map((s) => `${m.id}/${sampleId(s.label)}`));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps the habit tracker as an Apps example, with the prompt the onboarding step recognizes', () => {
    const apps = TASK_MODES.find((m) => m.id === 'apps');
    expect(apps.samples.find((s) => s.label === 'Build a habit tracker')?.prompt).toBe(HABIT_TRACKER_PROMPT);
  });

  it('features the cheap, reliable games first', () => {
    const games = TASK_MODES.find((m) => m.id === 'games');
    expect(games.samples.slice(0, 2).map((s) => s.label)).toEqual(['Classic snake game', 'Neon falling blocks']);
  });

  it('offers examples that start from the person\'s own file, notes or inbox', () => {
    const labels = TASK_MODES.flatMap((m) => m.samples.map((s) => s.label));
    expect(labels).toEqual(expect.arrayContaining([
      "Draft this week's update from last week's",
      'Summarize a document and draft my reply',
      'Clean up my spreadsheet and chart it',
      'Review what is on my plate this week',
    ]));
  });

  it('featured examples are existing samples, so their ids and prompts are the ones everywhere else', () => {
    const all = TASK_MODES.flatMap((m) => m.samples);
    expect(FEATURED_EXAMPLES_MODE.samples).toHaveLength(7);
    for (const sample of FEATURED_EXAMPLES_MODE.samples) expect(all).toContain(sample);
    expect(TASK_MODES.map((m) => m.id)).not.toContain(FEATURED_EXAMPLES_MODE.id);
    expect(typeof Ico[FEATURED_EXAMPLES_MODE.icon]).toBe('function');
  });

  it('adds nothing to what is sent from the featured examples, edited or not', () => {
    const [first] = FEATURED_EXAMPLES_MODE.samples;
    expect(composeModeMessage(FEATURED_EXAMPLES_MODE, first.prompt)).toBe(first.prompt);
    expect(composeModeMessage(FEATURED_EXAMPLES_MODE, 'my own task')).toBe('my own task');
  });

  it('sends a picked plain example as written, wherever the person edited it', () => {
    const mode = TASK_MODES.find((m) => m.instruction && m.samples.some((x) => x.plain));
    const sample = mode.samples.find((x) => x.plain);
    const middle = sample.prompt.replace(/\b\w{4,}\b/, 'changed');
    expect(middle).not.toBe(sample.prompt);
    expect(composeModeMessage(mode, middle, sample)).toBe(middle);
    // Without the pick, or for another mode's example, the instruction is still added.
    expect(composeModeMessage(mode, middle)).toBe(`${middle}\n\n${mode.instruction}`);
    const other = TASK_MODES.find((m) => m !== mode && m.samples.some((x) => x.plain)).samples.find((x) => x.plain);
    expect(composeModeMessage(mode, middle, other)).toBe(`${middle}\n\n${mode.instruction}`);
  });

  it('stops treating a picked plain example as one once the text is something else', () => {
    const mode = TASK_MODES.find((m) => m.instruction && m.samples.some((x) => x.plain));
    const sample = mode.samples.find((x) => x.plain);
    expect(resemblesSample(sample, sample.prompt.replace(/\b\w{4,}\b/, 'changed'))).toBe(true);
    expect(resemblesSample(sample, 'AI in 2026')).toBe(false);
    expect(resemblesSample(sample, '')).toBe(false);
    expect(composeModeMessage(mode, 'AI in 2026', sample)).toBe(`AI in 2026\n\n${mode.instruction}`);
  });

  it('composeModeMessage APPENDS the instruction (titles derive from the message head)', () => {
    const slides = TASK_MODES[0];
    expect(composeModeMessage(slides, 'AI in 2026')).toBe('AI in 2026\n\nCreate a slide presentation.');
    expect(composeModeMessage(null, 'hello')).toBe('hello');
  });

  it('keeps a plain sample as written when the person adds a paste or details', () => {
    const slides = TASK_MODES.find((m) => m.id === 'slides');
    const update = slides.samples.find((s) => s.label === "Draft this week's update from last week's");
    expect(update.plain).toBe(true);
    const sent = `${update.prompt}\n\nWeek 42: shipped the export.`;
    // A weekly update is not a slide deck, so the mode's line must not be added.
    expect(composeModeMessage(slides, sent)).toBe(sent);
  });

  it('still adds the instruction to text typed from scratch in a mode, and to an edited ordinary sample', () => {
    const slides = TASK_MODES.find((m) => m.id === 'slides');
    expect(composeModeMessage(slides, 'my own deck')).toBe(`my own deck\n\n${slides.instruction}`);
    const ordinary = slides.samples[0];
    expect(ordinary.plain).toBeUndefined();
    expect(composeModeMessage(slides, `${ordinary.prompt} More.`)).toBe(`${ordinary.prompt} More.\n\n${slides.instruction}`);
  });

  it('marks exactly the examples that sit in a mode their instruction does not fit', () => {
    const plain = TASK_MODES.flatMap((m) => m.samples.filter((s) => s.plain).map((s) => s.label));
    expect(plain.sort()).toEqual([
      "Draft this week's update from last week's",
      'Choose a local model that fits my computer',
      'Explain an error and suggest a fix',
      'Review what is on my plate this week',
      'Summarize a document and draft my reply',
    ].sort());
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
