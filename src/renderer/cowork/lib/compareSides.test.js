import { describe, expect, it } from 'vitest';
import {
  composerBlock,
  firstUserText,
  withoutFirstPrompt,
  sideNames,
  verdictLabel,
  divergedAt,
  formatDuration,
  judgeableTurn,
  messagesUpToTurn,
  sendTargets,
  sideStatus,
  titleFromPrompt,
  totalDurationMs,
  turnDurationMs,
  turnsOf,
} from './compareSides';

const user = (content, created_at = null) => ({ role: 'user', content, created_at });
const reply = (created_at = null) => ({ role: 'assistant', content: 'ok', created_at });

describe('turnsOf', () => {
  it('pairs each user message with how its reply ended', () => {
    const turns = turnsOf([
      user('one'), reply(),
      user('two'), { role: 'error', content: 'boom' },
      user('three'), { role: '_streaming', content: '' },
      user('four'),
    ]);
    expect(turns.map((t) => [t.text, t.reply])).toEqual([
      ['one', 'done'], ['two', 'failed'], ['three', 'running'], ['four', 'none'],
    ]);
  });

  it('ignores anything before the first user message', () => {
    expect(turnsOf([{ role: 'connect_intro' }, reply(), user('q')])).toHaveLength(1);
  });
});

describe('divergedAt', () => {
  it('is null while every turn went to both', () => {
    expect(divergedAt(turnsOf([user('a'), reply()]), turnsOf([user('a'), reply()]))).toBeNull();
  });

  it('is the first turn only one side was asked', () => {
    const a = turnsOf([user('p'), reply(), user('only A'), reply()]);
    const b = turnsOf([user('p'), reply()]);
    expect(divergedAt(a, b)).toBe(1);
  });

  it('stays at the first difference after the sides are asked the same again', () => {
    const a = turnsOf([user('p'), reply(), user('only A'), reply(), user('both'), reply()]);
    const b = turnsOf([user('p'), reply(), user('both'), reply()]);
    expect(divergedAt(a, b)).toBe(1);
  });
});

describe('judgeableTurn', () => {
  it('waits until both sides have finished the turn', () => {
    const a = turnsOf([user('p'), reply()]);
    expect(judgeableTurn(a, turnsOf([user('p'), { role: '_streaming' }]))).toBeNull();
    expect(judgeableTurn(a, turnsOf([user('p'), reply()]))).toBe(0);
  });

  it('counts a failed reply as finished', () => {
    expect(judgeableTurn(turnsOf([user('p'), reply()]), turnsOf([user('p'), { role: 'error' }]))).toBe(0);
  });

  it('is the latest shared finished turn', () => {
    const both = [user('p'), reply(), user('q'), reply()];
    expect(judgeableTurn(turnsOf(both), turnsOf(both))).toBe(1);
  });

  it('never reaches past the point the sides diverged', () => {
    const a = turnsOf([user('p'), reply(), user('only A'), reply()]);
    const b = turnsOf([user('p'), reply(), user('only B'), reply()]);
    expect(judgeableTurn(a, b)).toBe(0);
  });
});

describe('durations', () => {
  it('measures a turn from its message to its reply', () => {
    const [turn] = turnsOf([user('p', '2026-09-23T10:00:00Z'), reply('2026-09-23T10:01:05Z')]);
    expect(turnDurationMs(turn)).toBe(65_000);
  });

  it('is unknown while a reply is missing or out of order', () => {
    expect(turnDurationMs(turnsOf([user('p', '2026-09-23T10:00:00Z')])[0])).toBeNull();
    expect(turnDurationMs(turnsOf([user('p', '2026-09-23T10:00:05Z'), reply('2026-09-23T10:00:00Z')])[0])).toBeNull();
  });

  it('totals only the turns it could measure', () => {
    const turns = turnsOf([
      user('p', '2026-09-23T10:00:00Z'), reply('2026-09-23T10:00:10Z'),
      user('q', '2026-09-23T10:01:00Z'),
    ]);
    expect(totalDurationMs(turns)).toEqual({ total: 10_000, counted: 1 });
  });

  it('formats for a pane header', () => {
    expect(formatDuration(12_400)).toBe('12s');
    expect(formatDuration(184_000)).toBe('3m 04s');
    expect(formatDuration(3_720_000)).toBe('1h 02m');
    expect(formatDuration(null)).toBe('—');
  });
});

describe('messagesUpToTurn', () => {
  const messages = [user('p'), reply(), user('q'), reply(), user('later'), reply()];

  it('keeps a continued side to the turns that were compared', () => {
    expect(messagesUpToTurn(messages, 2).map((m) => m.content)).toEqual(['p', 'ok', 'q', 'ok']);
  });

  it('keeps everything for a side that was not continued', () => {
    expect(messagesUpToTurn(messages, null)).toBe(messages);
  });
});

describe('sendTargets', () => {
  const free = { continued: false, busy: false };

  it('sends to both, or to the one side asked for', () => {
    expect(sendTargets('both', { a: free, b: free })).toEqual(['a', 'b']);
    expect(sendTargets('b', { a: free, b: free })).toEqual(['b']);
  });

  it('leaves out a side that is answering or was continued', () => {
    expect(sendTargets('both', { a: { ...free, busy: true }, b: free })).toEqual(['b']);
    expect(sendTargets('both', { a: free, b: { ...free, continued: true } })).toEqual(['a']);
  });
});

describe('titleFromPrompt', () => {
  it('takes the first line and shortens it', () => {
    expect(titleFromPrompt('  Build a dashboard\nwith sales data')).toBe('Build a dashboard');
    expect(titleFromPrompt('x'.repeat(100), 10)).toBe(`${'x'.repeat(9)}…`);
  });
});

describe('sideStatus', () => {
  const done = turnsOf([user('p'), reply()]);
  it('reads the side from its latest turn', () => {
    expect(sideStatus(done).label).toBe('Done');
    expect(sideStatus(turnsOf([user('p'), { role: 'error' }])).tone).toBe('failed');
    expect(sideStatus(turnsOf([user('p')])).label).toBe('Stopped');
    expect(sideStatus([]).label).toBe('Waiting');
  });

  it('puts working and continued ahead of the transcript', () => {
    expect(sideStatus(done, { busy: true }).tone).toBe('working');
    expect(sideStatus(done, { busy: true, continued: true }).label).toBe('Continued as a task');
  });
});

describe('composerBlock', () => {
  const free = { continued: false, busy: false };
  const busy = { continued: false, busy: true };

  it('lets a message through when every target can take it', () => {
    expect(composerBlock('both', { a: free, b: free })).toBeNull();
    expect(composerBlock('a', { a: free, b: busy })).toBeNull();
  });

  it('closes the composer while both models work', () => {
    expect(composerBlock('both', { a: busy, b: busy })).toEqual({
      message: 'You can follow up when both models finish.', canSwitch: false,
    });
    expect(composerBlock('a', { a: busy, b: busy }).canSwitch).toBe(false);
  });

  it('names the busy side and offers the free one', () => {
    expect(composerBlock('both', { a: free, b: busy })).toEqual({
      message: 'B is still working. Send to A only, or wait.', canSwitch: true,
    });
  });

  it('explains a continued side', () => {
    expect(composerBlock('both', { a: { ...free, continued: true }, b: free }).message)
      .toBe('A was continued as a task. Send to B only.');
    expect(composerBlock('b', { a: { ...free, continued: true }, b: busy }).message)
      .toBe('You can follow up when B finishes.');
  });
});

describe('sideNames', () => {
  it('uses the model names', () => {
    expect(sideNames({ name: 'Kimi' }, { name: 'Qwen' })).toEqual({ a: 'Kimi', b: 'Qwen' });
  });

  it('tells the same model apart by effort, then by letter', () => {
    expect(sideNames({ name: 'Kimi', effort: 'low' }, { name: 'Kimi', effort: 'high' }))
      .toEqual({ a: 'Kimi · low', b: 'Kimi · high' });
    expect(sideNames({ name: 'Kimi' }, { name: 'Kimi' })).toEqual({ a: 'Kimi (A)', b: 'Kimi (B)' });
  });
});

describe('verdictLabel', () => {
  it('names the winning model', () => {
    const names = { a: 'Kimi', b: 'Qwen' };
    expect(verdictLabel('b', names)).toBe('Qwen was better');
    expect(verdictLabel('tie', names)).toBe('About the same');
    expect(verdictLabel(null, names)).toBe('No verdict');
  });
});

describe('composerBlock with model names', () => {
  it('says which model is working', () => {
    const names = { a: 'Kimi', b: 'Qwen' };
    const free = { continued: false, busy: false };
    expect(composerBlock('both', { a: free, b: { ...free, busy: true } }, names).message)
      .toBe('Qwen is still working. Send to Kimi only, or wait.');
  });
});

describe('the first prompt, shown once', () => {
  const messages = [user('the task'), reply(), user('a follow-up'), reply()];

  it('is read from the first user message', () => {
    expect(firstUserText(messages)).toBe('the task');
    expect(firstUserText([])).toBe('');
    expect(firstUserText([{ role: 'connect_intro', content: 'hi' }, ...messages])).toBe('the task');
  });

  it('leaves the panes starting on the answer, follow-ups kept', () => {
    expect(withoutFirstPrompt(messages).map((m) => m.content)).toEqual(['ok', 'a follow-up', 'ok']);
    expect(withoutFirstPrompt([reply()])).toHaveLength(1);
  });
});
