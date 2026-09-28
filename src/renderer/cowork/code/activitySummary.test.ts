import { describe, expect, it } from 'vitest';

import type { CodingEvent } from './api';
import { activityHeadline, approvalOutcome, displayCommand, isIgnoredActivity, liveStatusLabel } from './activitySummary';


function event(overrides: Partial<CodingEvent>): CodingEvent {
  return {
    schema_version: 1,
    seq: 1,
    timestamp: '2026-09-28T10:00:00Z',
    type: 'command',
    title: '',
    text: '',
    phase: 'completed',
    data: {},
    ...overrides,
  };
}


function command(itemId: string, actions: Array<Record<string, string>>, phase: CodingEvent['phase'] = 'completed'): CodingEvent {
  return event({ item_id: itemId, phase, data: { command: `/bin/zsh -lc '${actions[0]?.command || ''}'`, commandActions: actions } });
}


describe('displayCommand', () => {
  it('shows what the agent ran, not the login-shell wrapper', () => {
    expect(displayCommand(event({ data: { command: `/bin/zsh -lc 'ls src; echo done'` } }))).toBe('ls src; echo done');
    expect(displayCommand(event({ data: { command: '/bin/zsh -lc "curl -sL \\"https://example.com\\""' } }))).toBe('curl -sL "https://example.com"');
    expect(displayCommand(event({ data: { command: 'npm test' } }))).toBe('npm test');
  });

  it('prefers the command Codex parsed out of the shell call', () => {
    expect(displayCommand(command('c1', [{ type: 'read', command: 'cat README.md', name: 'README.md' }]))).toBe('cat README.md');
  });
});


describe('activityHeadline', () => {
  it('summarises the work as one sentence, counting each item once', () => {
    const events = [
      command('c1', [{ type: 'read', command: 'cat a.ts', name: 'a.ts' }], 'started'),
      event({ type: 'reasoning', item_id: 'r1' }),
      command('c1', [{ type: 'read', command: 'cat a.ts', name: 'a.ts' }]),
      command('c2', [{ type: 'search', command: 'rg foo', query: 'foo' }]),
      command('c3', [{ type: 'unknown', command: 'npm test' }]),
      command('c4', [{ type: 'unknown', command: 'npm run build' }]),
      event({ type: 'file_change', item_id: 'f1', data: { changes: [{ path: 'a.ts' }, { path: 'b.ts' }] } }),
    ];
    expect(activityHeadline(events)).toBe('Edited 2 files, ran 2 commands, read 1 file, and searched 1 time');
  });

  it('leaves the action in progress to the live status line', () => {
    const events = [
      command('c1', [{ type: 'read', command: 'cat a.ts', name: 'a.ts' }]),
      command('c2', [{ type: 'search', command: 'rg foo', query: 'foo' }], 'started'),
    ];
    expect(activityHeadline(events)).toBe('Read 1 file');
  });

  it('counts a mixed shell pipeline as a command rather than a read', () => {
    expect(activityHeadline([command('c1', [{ type: 'read', command: 'cat a' }, { type: 'unknown', command: 'wc -l' }])])).toBe('Ran 1 command');
  });

  it('describes groups that hold no countable actions', () => {
    expect(activityHeadline([event({ type: 'reasoning' })])).toBe('Thought it through');
    expect(activityHeadline([event({ type: 'approval', phase: 'pending' })])).toBe('Asked for approval');
    expect(activityHeadline([event({ type: 'usage', phase: 'progress' })])).toBe('Agent activity');
  });
});


describe('liveStatusLabel', () => {
  it('names the action in progress in the present tense', () => {
    expect(liveStatusLabel([command('c1', [{ type: 'read', command: 'cat a.ts', name: 'a.ts' }], 'started')])).toBe('Reading a.ts');
    expect(liveStatusLabel([command('c1', [{ type: 'search', command: 'rg foo', query: 'foo' }], 'started')])).toBe('Searching for foo');
    expect(liveStatusLabel([command('c1', [{ type: 'unknown', command: 'npm test' }], 'progress')])).toBe('Running npm test');
  });

  it('falls back to the latest reasoning heading, then to thinking', () => {
    const done = command('c1', [{ type: 'unknown', command: 'npm test' }]);
    expect(liveStatusLabel([done, event({ type: 'reasoning', text: '**Checking the docs**\n\nLooking for…' })])).toBe('Checking the docs');
    expect(liveStatusLabel([done])).toBe('Thinking…');
  });
});


describe('approvals and ignored items', () => {
  it('states the decision in plain words', () => {
    expect(approvalOutcome(event({ type: 'approval', text: 'Approve once', data: { decision: 'approve_once' } }))).toBe('Approve once');
    expect(approvalOutcome(event({ type: 'approval', data: { decision: 'approve_session' } }))).toBe('Approved for this task');
  });

  it('ignores the echo of the user message and context housekeeping', () => {
    expect(isIgnoredActivity(event({ type: 'tool', data: { type: 'userMessage' } }))).toBe(true);
    expect(isIgnoredActivity(event({ type: 'tool', data: { type: 'mcpToolCall' } }))).toBe(false);
  });
});
