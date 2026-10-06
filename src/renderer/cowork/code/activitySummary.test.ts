import { describe, expect, it } from 'vitest';

import type { CodingEvent } from './api';
import { activityHeadline, displayCommand, fileChanges, isCompaction, isIgnoredActivity, liveStatusLabel, planPosition, stepFailed, stepLabel, turnDiffFiles } from './activitySummary';


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
    expect(activityHeadline(events)).toBe('Read a.ts');
  });

  it('names a single action instead of counting it', () => {
    expect(activityHeadline([command('c1', [{ type: 'unknown', command: 'npm test' }])])).toBe('Ran npm test');
    expect(activityHeadline([command('c1', [{ type: 'read', command: 'cat a.ts', name: 'a.ts' }]), command('c2', [{ type: 'unknown', command: 'ls' }])])).toBe('Ran 1 command and read 1 file');
  });

  it('counts a mixed shell pipeline as a command rather than a read', () => {
    const pipeline = event({ data: { command: `/bin/zsh -lc 'cat a | wc -l'`, commandActions: [{ type: 'read', command: 'cat a' }, { type: 'unknown', command: 'wc -l' }] } });
    expect(activityHeadline([pipeline])).toBe('Ran cat a | wc -l');
    expect(activityHeadline([pipeline, { ...pipeline, seq: 2 }])).toBe('Ran 2 commands');
  });

  it('counts retries after the work', () => {
    expect(activityHeadline([command('c1', [{ type: 'unknown', command: 'ls' }]), event({ type: 'error', phase: 'failed', seq: 2 })])).toBe('Ran 1 command and retried once');
    expect(activityHeadline([event({ type: 'error', phase: 'failed', seq: 1 }), event({ type: 'error', phase: 'failed', seq: 2 })])).toBe('Retried 2 times');
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

  it('reads a summary that arrives on the finished reasoning item', () => {
    const summarized = (summary: unknown) => event({ type: 'reasoning', data: { summary } });
    expect(liveStatusLabel([summarized(['**Tracing the error path**\n\nFollowing the handler.'])])).toBe('Tracing the error path');
    expect(liveStatusLabel([summarized([{ type: 'summary_text', text: 'I need to check the API client. Then the tests.' }])])).toBe('I need to check the API client.');
    expect(liveStatusLabel([summarized([`Looking at ${'the checkout form '.repeat(8)}`])])).toHaveLength(80);
  });

  it('falls back to the latest reasoning heading, then to thinking', () => {
    const done = command('c1', [{ type: 'unknown', command: 'npm test' }]);
    expect(liveStatusLabel([done, event({ type: 'reasoning', text: '**Checking the docs**\n\nLooking for…' })])).toBe('Checking the docs');
    expect(liveStatusLabel([done])).toBe('Thinking…');
  });
});


describe('stepLabel', () => {
  it('names each finished step in the past tense', () => {
    expect(stepLabel(command('c1', [{ type: 'read', command: 'cat src/a.ts', name: 'a.ts' }]))).toEqual({ icon: 'read', verb: 'Read', target: 'a.ts' });
    expect(stepLabel(command('c1', [{ type: 'search', command: 'rg foo', query: 'foo' }]))).toEqual({ icon: 'search', verb: 'Searched for', target: 'foo' });
    expect(stepLabel(command('c1', [{ type: 'listFiles', command: 'ls src', path: 'src' }]))).toEqual({ icon: 'list', verb: 'Listed', target: 'src' });
    expect(stepLabel(command('c1', [{ type: 'unknown', command: 'npm test' }]))).toEqual({ icon: 'command', verb: 'Ran', target: 'npm test' });
    expect(stepLabel(event({ type: 'tool', data: { type: 'mcpToolCall', server: 'linear', tool: 'get_issue' } }))).toEqual({ icon: 'tool', verb: 'Called', target: 'linear · get_issue' });
    expect(stepLabel(event({ type: 'tool', title: '/tmp/shot.png', data: { type: 'imageView' } }))).toEqual({ icon: 'image', verb: 'Viewed', target: 'shot.png' });
    expect(stepLabel(event({ type: 'error', phase: 'failed', text: 'Reconnecting... 1/2' })).target).toBe('after the connection dropped (1/2)');
  });

  it('treats a non-zero exit as a failure but not a retry', () => {
    expect(stepFailed(event({ data: { exitCode: 1 } }))).toBe(true);
    expect(stepFailed(event({ data: { exitCode: 0 } }))).toBe(false);
    expect(stepFailed(event({ type: 'error', phase: 'failed' }))).toBe(false);
  });
});


describe('plan updates', () => {
  const plan = (statuses: string[]) => event({
    type: 'plan',
    phase: 'progress',
    data: { plan: statuses.map((status, index) => ({ step: `Step ${index + 1}`, status })) },
  });

  it('counts a checklist update as finished work', () => {
    expect(stepLabel(plan(['completed', 'inProgress', 'pending']))).toEqual({ icon: 'plan', verb: 'Updated the plan', target: '· 1 of 3 done' });
    expect(activityHeadline([command('c1', [{ type: 'read', command: 'cat a.ts', name: 'a.ts' }]), { ...plan(['pending']), seq: 2 }])).toBe('Read 1 file and updated the plan');
  });

  it('names the step in progress, or the next one', () => {
    expect(planPosition(plan(['completed', 'inProgress', 'pending']))).toBe('Step 2 of 3');
    expect(planPosition(plan(['completed', 'pending']))).toBe('Step 2 of 2');
    expect(planPosition(plan(['completed', 'completed']))).toBe('');
    expect(planPosition(undefined)).toBe('');
  });
});


describe('file changes', () => {
  it('turns an added file into a patch of additions', () => {
    const [change] = fileChanges(event({ type: 'file_change', data: { changes: [{ path: '/w/README.md', kind: { type: 'add' }, diff: '# Title\n\nBody\n' }] } }));
    expect(change).toMatchObject({ path: '/w/README.md', kind: 'add', additions: 3, deletions: 0 });
    expect(change.patch).toBe('@@ -0,0 +1,3 @@\n+# Title\n+\n+Body');
  });

  it('keeps an update as its unified diff', () => {
    const diff = '@@ -1,2 +1,2 @@\n-old\n+new\n same';
    expect(fileChanges(event({ type: 'file_change', data: { changes: [{ path: 'a.ts', kind: { type: 'update' }, diff }] } }))[0]).toMatchObject({ patch: diff, additions: 1, deletions: 1 });
  });

  it('counts changed lines that begin like diff headers', () => {
    const diff = '@@ -1,2 +1,2 @@\n---flag\n+++counter;\n same';
    expect(fileChanges(event({ type: 'file_change', data: { changes: [{ path: 'a.ts', kind: { type: 'update' }, diff }] } }))[0]).toMatchObject({ additions: 1, deletions: 1 });
    expect(fileChanges(event({ type: 'file_change', data: { changes: [{ path: 'b.md', kind: { type: 'add' }, diff: '---\n++x\n' }] } }))[0]).toMatchObject({ additions: 2, deletions: 0 });
    const turn = ['diff --git a/a.ts b/a.ts', '--- a/a.ts', '+++ b/a.ts', '@@ -1 +1 @@', '---flag', '+++counter;'].join('\n');
    expect(turnDiffFiles(turn)).toEqual([{ path: 'a.ts', additions: 1, deletions: 1 }]);
  });

  it('lists every file in the turn diff with its line counts', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts', '--- a/src/a.ts', '+++ b/src/a.ts', '@@ -1 +1,2 @@', '-x', '+y', '+z',
      'diff --git a//tmp/new.md b//tmp/new.md', 'new file mode 100644', '--- /dev/null', '+++ b//tmp/new.md', '@@ -0,0 +1 @@', '+hi',
    ].join('\n');
    expect(turnDiffFiles(diff)).toEqual([
      { path: 'src/a.ts', additions: 2, deletions: 1 },
      { path: '/tmp/new.md', additions: 1, deletions: 0 },
    ]);
  });
});


describe('ignored items', () => {
  it('ignores the echo of the user message and flags compaction for its own line', () => {
    expect(isIgnoredActivity(event({ type: 'tool', data: { type: 'userMessage' } }))).toBe(true);
    expect(isIgnoredActivity(event({ type: 'tool', data: { type: 'mcpToolCall' } }))).toBe(false);
    expect(isCompaction(event({ type: 'tool', data: { type: 'contextCompaction' } }))).toBe(true);
  });
});
