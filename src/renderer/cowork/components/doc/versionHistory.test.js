// The version history's words and grouping, against a fixed clock (TZ=UTC in tests).
import { describe, it, expect } from 'vitest';
import {
  WHO, ago, changedSince, dayLabel, groupByDay, stepFrom, timeLabel, whatChanged, whenPhrase, whenShort, whenTitle,
} from './versionHistory';

const NOW = new Date('2026-10-23T16:05:00Z'); // a Friday

describe('when, in words', () => {
  it.each([
    ['2026-10-23T09:00:00Z', 'Today'],
    ['2026-10-22T23:59:00Z', 'Yesterday'],
    ['2026-10-19T12:00:00Z', 'Monday'],
    ['2026-10-12T12:00:00Z', 'Oct 12'],
    ['2025-12-30T12:00:00Z', 'Dec 30, 2025'],
  ])('%s is %s', (iso, day) => {
    expect(dayLabel(iso, NOW)).toBe(day);
  });

  it('a clock time, a heading, a phrase and a short form', () => {
    expect(timeLabel('2026-10-23T14:58:00Z')).toBe('2:58 PM');
    expect(whenTitle('2026-10-23T14:58:00Z', NOW)).toBe('Today, 2:58 PM');
    expect(whenPhrase('2026-10-23T14:58:00Z', NOW)).toBe('today at 2:58 PM');
    expect(whenPhrase('2026-10-22T17:12:00Z', NOW)).toBe('yesterday at 5:12 PM');
    expect(whenPhrase('2026-10-19T09:04:00Z', NOW)).toBe('Monday at 9:04 AM');
    expect(whenShort('2026-10-23T14:58:00Z', NOW)).toBe('2:58 PM');
    expect(whenShort('2026-10-22T17:12:00Z', NOW)).toBe('yesterday at 5:12 PM');
  });

  it.each([
    ['2026-10-23T16:04:30Z', 'just now'],
    ['2026-10-23T15:53:00Z', '12 min ago'],
    ['2026-10-23T13:00:00Z', '3 hr ago'],
    ['2026-10-23T08:00:00Z', 'today at 8:00 AM'],
  ])('the doc now, edited %s, was edited %s', (iso, said) => {
    expect(ago(iso, NOW)).toBe(said);
  });
});

describe('what a row says', () => {
  it('names who made a version', () => {
    expect(WHO).toEqual({ agent: 'Agent', user: 'You' });
  });

  it('is the summary, a restore said as one, or earlier changes when there is nothing to compare', () => {
    expect(whatChanged({ summary: 'Budget: Paid search 72 → 80' }, NOW)).toBe('Budget: Paid search 72 → 80');
    expect(whatChanged({ summary: 'x', restoredFrom: { rev: 3, at: '2026-10-23T14:58:00Z' } }, NOW))
      .toBe('Restored the version from 2:58 PM');
    expect(whatChanged({ summary: null }, NOW)).toBe('Earlier changes');
  });
});

describe('the list', () => {
  const versions = [
    { rev: 9, at: '2026-10-23T15:48:00Z' },
    { rev: 7, at: '2026-10-23T14:58:00Z' },
    { rev: 4, at: '2026-10-22T17:12:00Z' },
    { rev: 2, at: '2026-10-12T11:04:00Z' },
  ];

  it('groups the versions under their day, newest first', () => {
    expect(groupByDay(versions, NOW).map((g) => [g.day, g.versions.map((v) => v.rev)])).toEqual([
      ['Today', [9, 7]], ['Yesterday', [4]], ['Oct 12', [2]],
    ]);
  });

  it('steps to the next older or newer version, and nowhere past either end', () => {
    expect(stepFrom(versions, 7, 'older').rev).toBe(4);
    expect(stepFrom(versions, 7, 'newer').rev).toBe(9);
    expect(stepFrom(versions, 9, 'newer')).toBeNull();
    expect(stepFrom(versions, 2, 'older')).toBeNull();
    expect(stepFrom(versions, 5, 'older')).toBeNull();
  });
});

describe('what restoring would change back', () => {
  const doc = (blocks) => ({ tabs: [{ id: 't_1', blocks }] });

  it('marks the version\'s blocks that read differently now, or are gone', () => {
    const version = doc([
      { id: 'b_same', type: 'paragraph', text: 'Same.', v: 1, by: 'agent' },
      { id: 'b_edit', type: 'paragraph', text: 'Before.', v: 1 },
      { id: 'b_gone', type: 'paragraph', text: 'Gone.', v: 1 },
    ]);
    const now = doc([
      { by: 'user', text: 'Same.', type: 'paragraph', id: 'b_same', v: 7 }, // its rev and author moved on, its words didn't
      { id: 'b_edit', type: 'paragraph', text: 'After.', v: 6 },
      { id: 'b_new', type: 'paragraph', text: 'New.', v: 6 },
    ]);
    expect([...changedSince(version, now)]).toEqual(['b_edit', 'b_gone']);
  });

  it('compares nested content whatever order its keys came in', () => {
    const table = (cells) => doc([{ id: 'b_t', type: 'table', columns: [{ id: 'c', name: 'A' }], rows: [{ id: 'r', cells }] }]);
    expect(changedSince(table({ c: '1' }), table({ c: '1' })).size).toBe(0);
    expect([...changedSince(table({ c: '1' }), table({ c: '2' }))]).toEqual(['b_t']);
  });

  it('marks nothing without both docs', () => {
    expect(changedSince(null, doc([])).size).toBe(0);
    expect([...changedSince(doc([{ id: 'b', type: 'divider' }]), null)]).toEqual(['b']);
  });
});
