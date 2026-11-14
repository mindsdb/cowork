import { describe, expect, it } from 'vitest';
import { BROWSER_ACTION_BADGE, browserActionLabel, groupBrowserSteps } from './browserSteps';
import { browserStep } from './browserSession';
import { answeredBrowserStep } from './browserStepPrompt';

describe('a browser call’s label', () => {
  it("is a run's goal, the site it opens, or what it does on the page", () => {
    expect(browserActionLabel({ action: 'run', goal: '  Find   flights to Boston ' })).toBe('Find flights to Boston');
    expect(browserActionLabel({ action: 'open', url: 'https://www.united.com/en/us' })).toBe('Opening united.com');
    expect(browserActionLabel({ action: 'act', step: { action: 'navigate', url: 'https://example.org/a' } })).toBe('Opening example.org');
    expect(browserActionLabel({ action: 'act', step: { action: 'type', element: 4, text: 'hunter2' } })).toBe('Working on the page');
    expect(browserActionLabel({ action: 'page' })).toBe('Reading the page');
    expect(browserActionLabel({ action: 'screenshot' })).toBe('Looking at the page');
    expect(browserActionLabel({ action: 'hand_to_user', reason: 'Sign in' })).toBe('Waiting for you in the browser');
    expect(browserActionLabel({ action: 'tabs' })).toBe('Using the browser');
    expect(browserActionLabel({ action: 'run', goal: 'x'.repeat(300) }).length).toBe(120);
  });
});

describe("a turn's browser steps as one row", () => {
  const call = (id, label, status = 'completed', at = 1) => ({ id, label, badge: BROWSER_ACTION_BADGE, status, startedAt: at, completedAt: status === 'completed' ? at + 1 : null });
  const other = (id) => ({ id, label: id, badge: 'Tool', status: 'completed', startedAt: 1, completedAt: 2 });

  it('takes the latest call’s label, where the last one was, and opens the turn’s browser', () => {
    const steps = [other('a'), browserStep({ session_id: 't-abc' }, 1), call('s1', 'Opening united.com'), other('b'), call('s2', 'Find flights', 'completed', 5)];
    const grouped = groupBrowserSteps(steps);
    expect(grouped.map((s) => s.label)).toEqual(['a', 'b', 'Find flights']);
    expect(grouped[2]).toMatchObject({ badge: 'Browser', status: 'completed', startedAt: 1, completedAt: 6, data: { sessionId: 't-abc' } });
  });

  it('runs while any call runs, and leaves a lone browser step as it is', () => {
    const grouped = groupBrowserSteps([call('s1', 'Opening a.com'), call('s2', 'Reading the page', 'in_progress')]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]).toMatchObject({ status: 'in_progress', completedAt: null, label: 'Reading the page' });
    const lone = [other('a'), call('s1', 'Opening a.com')];
    expect(groupBrowserSteps(lone)).toBe(lone);
  });

  it('moves an answered held step to right after the row, and leaves a waiting one where it is', () => {
    const OPTIONS = [{ value: 'approve', label: 'Approve', detail: 'Take this step once' }, { value: 'cancel', label: 'Cancel' }];
    const held = (id, answer) => ({ id, label: 'Question for you', badge: 'AskUser', status: 'completed', data: { question_id: `browser:approve:t-abc:${id}`, options: OPTIONS, answer } });
    const approved = held('p1', { status: 'answered', values: ['approve'] });
    const waiting = held('p2', null);
    const grouped = groupBrowserSteps([call('s1', 'Opening a.com'), approved, other('b'), call('s2', 'Booking'), waiting], { follows: answeredBrowserStep });
    expect(grouped.map((s) => s.id)).toEqual(['b', 'browser-group-s1', 'p1', 'p2']);
  });
});
