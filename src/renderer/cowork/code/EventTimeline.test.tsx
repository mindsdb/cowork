import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { CodingEvent, CodingSession } from './api';
import { EventTimeline } from './EventTimeline';
import { indexLatestEvents } from './useCodingSession';
import { copyText } from '../lib/clipboard';

vi.mock('../lib/clipboard', () => ({ copyText: vi.fn(async () => true) }));


beforeAll(() => {
  HTMLElement.prototype.scrollTo = vi.fn();
});


function session(status: CodingSession['status']): CodingSession {
  return {
    schema_version: 1,
    id: 'task-1',
    title: 'Polish the checkout flow',
    engine_id: 'codex',
    engine_adapter_version: '1',
    model: 'fable',
    permission_mode: 'supervised',
    status,
    source_path: '/work/shop',
    workspace_path: '/work/shop-cowork',
    workspace_kind: 'git_worktree',
    source_dirty: false,
    event_count: 0,
    created_at: '2026-08-21T09:00:00Z',
    updated_at: '2026-08-21T09:05:00Z',
  };
}


function event(seq: number, type: CodingEvent['type'], text: string): CodingEvent {
  return {
    schema_version: 1,
    seq,
    timestamp: `2026-08-21T09:00:0${seq}Z`,
    type,
    title: type === 'error' ? 'Connection failed' : '',
    text,
    phase: type === 'error' ? 'failed' : 'completed',
    data: {},
  };
}


// A single step's headline styles its verb and target apart.
function headline(text: string) {
  return (_: string, element: Element | null) => !!element?.classList.contains('code-activity-group__copy') && element.textContent === text;
}


function timelineProps(events: CodingEvent[]) {
  return { events, latestEvents: indexLatestEvents(events) };
}


describe('EventTimeline', () => {
  it('copies a complete streamed answer, not the prompt or activity around it', async () => {
    const events = [
      event(1, 'user_message', 'Please change the code'),
      event(2, 'command', 'npm test'),
      { ...event(3, 'agent_message', '**Done.**\n\n'), item_id: 'answer', turn_id: 'turn', phase: 'started' as const },
      { ...event(4, 'agent_message', '```js\nconst a = 1;\n```'), item_id: 'answer', turn_id: 'turn' },
    ];
    render(<EventTimeline {...timelineProps(events)} session={session('completed')} />);
    expect(screen.getAllByRole('button', { name: 'Copy response' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Copy response' }));
    expect(await screen.findByText('Copied')).toBeInTheDocument();
    expect(copyText).toHaveBeenLastCalledWith('**Done.**\n\n```js\nconst a = 1;\n```');
    expect(screen.getByRole('button', { name: 'Copy js code' })).toBeInTheDocument();
  });

  it('offers copy only on the answer, not on progress notes or a live turn', () => {
    const events = [
      event(1, 'user_message', 'Find the bug'),
      { ...event(2, 'agent_message', 'Checking the parser first.'), item_id: 'note-1' },
      event(3, 'command', 'rg parse src'),
      { ...event(4, 'agent_message', 'The parser drops trailing commas.'), item_id: 'answer-1' },
      event(5, 'user_message', 'Fix it'),
      { ...event(6, 'agent_message', 'Editing the parser now.'), item_id: 'note-2' },
    ];
    const view = render(<EventTimeline {...timelineProps(events)} session={session('running')} />);
    expect(screen.getAllByRole('button', { name: 'Copy response' })).toHaveLength(1);
    expect(screen.getByText('The parser drops trailing commas.').closest('article')).toContainElement(screen.getByRole('button', { name: 'Copy response' }));

    view.rerender(<EventTimeline {...timelineProps(events)} session={session('completed')} />);
    expect(screen.getAllByRole('button', { name: 'Copy response' })).toHaveLength(2);
    // Finished turns fold their progress notes away with the work.
    expect(screen.queryByText('Checking the parser first.')).toBeNull();
    fireEvent.click(screen.getAllByText(/^Worked for/)[0]);
    expect(screen.getByText('Checking the parser first.').closest('article')?.querySelector('button')).toBeNull();
  });

  it('reads the terminal error from the index instead of scanning the transcript on each render', () => {
    const events = Array.from({ length: 6_000 }, (_, index) => event(index + 1, index % 2 ? 'error' : 'agent_message', `Event ${index + 1}`));
    let indexReads = 0;
    const counted = new Proxy(events, {
      get(target, property, receiver) {
        if (typeof property === 'string' && /^\d+$/.test(property)) indexReads += 1;
        return Reflect.get(target, property, receiver);
      },
    });
    const props = { events: counted, latestEvents: indexLatestEvents(events), session: { ...session('failed'), run_status: 'failed' as const } };
    const view = render(<EventTimeline {...props} />);
    expect(screen.getByText('Event 5999')).toBeInTheDocument();

    indexReads = 0;
    view.rerender(<EventTimeline {...props} recovering />);

    expect(indexReads).toBeLessThan(10);
  });

  it('collapses repeated connection failures and renders one terminal outcome', () => {
    const events = [1, 2, 3, 4, 5].map((seq) => event(seq, 'error', `Attempt ${seq} failed`));

    render(<EventTimeline {...timelineProps(events)} session={{ ...session('failed'), last_error: 'Connection unavailable' }} />);

    expect(screen.getByText('Retried 5 times')).toBeInTheDocument();
    expect(screen.getAllByText('Failed')).toHaveLength(1);
    expect(screen.getByText('Connection unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Attempt 1 failed')).toBeNull();
    fireEvent.click(screen.getByText('Retried 5 times'));
    expect(screen.getAllByText('after the connection dropped')).toHaveLength(5);
  });

  it('folds a recovered retry into the work around it', () => {
    const events = [
      { ...event(1, 'command', ''), item_id: 'c1', data: { command: 'git fetch' } },
      event(2, 'error', 'Reconnecting... 1/2'),
      { ...event(3, 'command', ''), item_id: 'c2', data: { command: 'git status' } },
    ];
    const { container } = render(<EventTimeline {...timelineProps(events)} session={session('completed')} />);

    expect(container.querySelectorAll('.code-activity-group')).toHaveLength(1);
    expect(screen.getByText('Ran 2 commands and retried once')).toBeInTheDocument();
    expect(container.querySelector('.code-activity-group.is-failed')).toBeNull();
    expect(container.querySelector('.code-activity-group[open]')).toBeNull();
  });

  it('says a new task is preparing its workspace before the agent starts', () => {
    const events = [event(1, 'user_message', 'Go')];
    render(<EventTimeline {...timelineProps(events)} session={{ ...session('running'), run_status: 'preparing', workspace_path: '' }} />);

    expect(screen.getByRole('status')).toHaveTextContent('Preparing the task workspace…');
  });

  it('names a reconnect in progress on the live status line', () => {
    const events = [event(1, 'user_message', 'Go'), event(2, 'error', 'Reconnecting... 1/2')];
    render(<EventTimeline {...timelineProps(events)} session={session('running')} />);

    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting… 1/2');
  });

  it('leaves a paused remote run and its last error to the composer lip', () => {
    const { container } = render(
      <EventTimeline
        {...timelineProps([event(1, 'user_message', 'Go'), event(2, 'error', 'Computer disconnected')])}
        session={{
          ...session('interrupted'),
          run_status: 'interrupted',
          computer_status: 'offline',
          last_error: 'Computer disconnected',
        }}
      />,
    );

    expect(container.querySelector('.code-task-outcome')).toBeNull();
    expect(screen.queryByText('Task paused')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reopen task' })).toBeNull();
    expect(screen.queryByText('Computer disconnected')).toBeNull();
  });

  it('keeps local failures recoverable through the composer instead of a remote-run action', () => {
    render(
      <EventTimeline
        {...timelineProps([event(1, 'error', 'Tests failed')])}
        session={{ ...session('failed'), last_error: 'Tests failed' }}
      />,
    );

    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('Tests failed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reopen task' })).not.toBeInTheDocument();
  });

  function failedTask(code: string, detail: string) {
    const failure = { ...event(1, 'error', 'The turn failed.'), data: { code, detail, model: 'gpt-5.6-sol' } };
    return {
      ...timelineProps([failure]),
      session: { ...session('failed'), run_status: 'failed' as const, model: 'gpt-5.6-sol', last_error: failure.text },
    };
  }

  it('leaves account and model limits to the composer lip instead of a transcript card', () => {
    const { container } = render(<EventTimeline {...failedTask('insufficient_credits', 'server returned 402')} />);
    expect(container.querySelector('.code-task-outcome')).toBeNull();
    expect(screen.queryByText(/needs credits/)).toBeNull();
  });

  it('shows an unconfirmed follow-up and the note that it was delivered late', () => {
    const unconfirmed: CodingEvent = { ...event(1, 'user_message', 'Focus on tests'), title: 'Follow-up (unconfirmed)', phase: 'pending', data: { delivery: 'unconfirmed' } };
    const delivered: CodingEvent = { ...event(2, 'command_result', 'Codex accepted the instruction after the deadline; it is now guiding the turn.'), title: 'Follow-up delivered', phase: 'completed', data: { delivery: 'confirmed' } };
    const plainResult: CodingEvent = { ...event(3, 'command_result', 'internal'), title: 'Internal', phase: 'completed', data: {} };
    render(<EventTimeline {...timelineProps([unconfirmed, delivered, plainResult])} session={session('running')} />);

    expect(screen.getByText('Focus on tests')).toBeInTheDocument();
    expect(screen.getByText('Follow-up delivered')).toBeInTheDocument();
    expect(screen.getByText(/after the deadline/)).toBeInTheDocument();
    expect(screen.queryByText('Internal')).toBeNull();
  });

  it('hides raw session events because status is represented once in the outcome', () => {
    render(
      <EventTimeline
        {...timelineProps([event(1, 'session', 'Raw completed notification')])}
        session={session('completed')}
      />,
    );

    expect(screen.queryByText('Raw completed notification')).toBeNull();
    // A finished turn needs no card; the header already says so.
    expect(screen.queryByText('Completed')).toBeNull();
  });

  it('shows the answer to /status where the command was sent', () => {
    const status = {
      ...event(2, 'session', 'Status: ready\nModel: gpt\nPermissions: supervised'),
      title: 'Task status',
      data: { command: 'status' },
    };

    render(<EventTimeline {...timelineProps([event(1, 'user_message', '/status'), status])} session={session('ready')} />);

    expect(screen.getByText('Task status')).toBeInTheDocument();
    expect(screen.getByText(/Model: gpt/)).toBeInTheDocument();
  });

  it('shows a rejected command where it happened and hides acknowledged ones', () => {
    const acknowledged = { ...event(1, 'command_result', ''), title: 'Cancel acknowledged', data: { command: 'cancel', commandId: 'cmd-1' } };
    const rejected = {
      ...event(2, 'command_result', 'The agent is between turns; queue this instruction instead.'),
      title: 'Steer rejected',
      phase: 'failed' as const,
      data: { command: 'steer', commandId: 'cmd-2' },
    };

    render(<EventTimeline {...timelineProps([acknowledged, rejected])} session={session('running')} />);

    expect(screen.getByText('Steer rejected')).toBeInTheDocument();
    expect(screen.getByText('The agent is between turns; queue this instruction instead.')).toBeInTheDocument();
    expect(screen.queryByText('Cancel acknowledged')).toBeNull();
  });

  it('leaves pending queued instructions in the actionable composer queue', () => {
    const queued = {
      ...event(1, 'user_message', 'Run Windows tests next'),
      title: 'Queued next',
      phase: 'pending' as const,
      data: { queueId: 'queued-1' },
    };

    render(<EventTimeline {...timelineProps([queued])} session={session('running')} />);

    expect(screen.queryByText('Run Windows tests next')).not.toBeInTheDocument();
  });

  it('uses the terminal phase when streamed activity fragments are merged', () => {
    const command = [
      { ...event(1, 'command', ''), item_id: 'command-1', phase: 'started' as const, title: 'Run tests' },
      { ...event(2, 'command', 'tests passed'), item_id: 'command-1', phase: 'progress' as const },
      { ...event(3, 'command', ''), item_id: 'command-1', phase: 'completed' as const, title: 'Run tests', data: { command: 'npm test' } },
    ];

    render(<EventTimeline {...timelineProps(command)} session={session('completed')} />);

    expect(screen.getByText(headline('Ran npm test'))).toBeInTheDocument();
  });

  it('does not leave progress-only telemetry looking active after the turn ends', () => {
    const usage = {
      ...event(1, 'usage', ''),
      title: 'Usage updated',
      phase: 'progress' as const,
    };

    const { container } = render(<EventTimeline {...timelineProps([usage])} session={session('completed')} />);

    expect(container.querySelector('.code-activity-group')).toBeNull();
    expect(screen.queryByText('Usage updated')).toBeNull();
  });

  it('shows no group for telemetry between two messages', () => {
    const events = [
      { ...event(1, 'agent_message', 'Checking the docs.'), item_id: 'note-1' },
      { ...event(2, 'usage', ''), phase: 'progress' as const },
      { ...event(3, 'reasoning', ''), item_id: 'r1', data: { summary: [] } },
      { ...event(4, 'agent_message', 'Found it.'), item_id: 'answer' },
    ];
    const { container } = render(<EventTimeline {...timelineProps(events)} session={session('completed')} />);

    expect(container.querySelector('.code-activity-group')).toBeNull();
  });

  it('opens a reasoning group onto the summary from the finished item', () => {
    const reasoning = { ...event(1, 'reasoning', ''), item_id: 'r1', data: { summary: ['**Tracing the error path**\n\nThe handler clears the draft.'] } };
    render(<EventTimeline {...timelineProps([reasoning])} session={session('completed')} />);

    fireEvent.click(screen.getByText('Thought it through'));
    fireEvent.click(screen.getByRole('button', { name: /Tracing the error path/ }));
    expect(screen.getByText('The handler clears the draft.')).toBeInTheDocument();
  });

  it('keeps a pinned timeline at the bottom when a streamed item grows in place', () => {
    const scrollTo = vi.mocked(HTMLElement.prototype.scrollTo);
    scrollTo.mockClear();
    const first = { ...event(1, 'agent_message', 'Hello'), item_id: 'message-1', phase: 'progress' as const };
    const view = render(<EventTimeline {...timelineProps([first])} session={session('running')} />);
    const callsAfterFirstChunk = scrollTo.mock.calls.length;

    view.rerender(
      <EventTimeline
        {...timelineProps([first, { ...event(2, 'agent_message', ' world'), item_id: 'message-1', phase: 'progress' }])}
        session={session('running')}
      />,
    );

    expect(scrollTo.mock.calls.length).toBeGreaterThan(callsAfterFirstChunk);
    expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: 'auto' }));
  });

  it('does not mount large activity details until the user opens them', () => {
    const command = { ...event(1, 'command', 'very large command output'), data: { command: 'npm test' } };
    render(<EventTimeline {...timelineProps([command])} session={session('completed')} />);

    expect(screen.queryByText('very large command output')).toBeNull();
    fireEvent.click(screen.getByText(headline('Ran npm test')));
    expect(screen.getByText('very large command output')).toBeInTheDocument();
  });

  it('keeps granted approvals inside the work they unblocked', () => {
    const approvalId = { approvalId: 'approval-1' };
    const events = [
      { ...event(1, 'command', ''), item_id: 'c1', data: { command: `/bin/zsh -lc 'ls'` } },
      { ...event(2, 'approval', `/bin/zsh -lc 'curl https://example.com'`), title: 'Run command', phase: 'pending' as const, data: approvalId },
      { ...event(3, 'approval', 'Approve once'), title: 'Approval resolved', data: { ...approvalId, decision: 'approve_once' } },
      { ...event(4, 'command', ''), item_id: 'c2', data: { command: `/bin/zsh -lc 'curl https://example.com'` } },
    ];
    render(<EventTimeline {...timelineProps(events)} session={session('completed')} />);

    expect(screen.getByText('Ran 2 commands')).toBeInTheDocument();
    expect(screen.queryByText('Approval resolved')).toBeNull();
    fireEvent.click(screen.getByText('Ran 2 commands'));
    // The command it unblocked already shows; the grant adds nothing.
    expect(screen.queryByText('Approve once')).toBeNull();
    expect(screen.getAllByText('curl https://example.com')).toHaveLength(1);
  });

  it('keeps a failed command closed until the user opens it onto its exit code and output', () => {
    const failed = {
      ...event(1, 'command', ''),
      item_id: 'c1',
      data: { command: `/bin/zsh -lc 'ls /missing'`, exitCode: 1, aggregatedOutput: 'ls: /missing: No such file or directory\n' },
    };
    const { container } = render(<EventTimeline {...timelineProps([failed])} session={session('completed')} />);

    expect(screen.getByText('1 failed')).toBeInTheDocument();
    expect(container.querySelector('.code-activity-group.is-failed')).not.toHaveAttribute('open');
    expect(screen.queryByText('Exit code 1')).toBeNull();

    fireEvent.click(screen.getByText('1 failed'));
    expect(screen.getByText('Exit code 1')).toBeInTheDocument();
    expect(screen.getByText('ls: /missing: No such file or directory')).toBeInTheDocument();
  });

  it('marks a failed step inside a larger group', () => {
    const events = [
      { ...event(1, 'command', ''), item_id: 'c1', data: { command: 'npm test', exitCode: 1, aggregatedOutput: 'boom' } },
      { ...event(2, 'command', ''), item_id: 'c2', data: { command: 'npm run lint', exitCode: 0 } },
    ];
    const { container } = render(<EventTimeline {...timelineProps(events)} session={session('completed')} />);

    fireEvent.click(screen.getByText('1 failed'));
    expect(container.querySelector('.code-step.is-failed')).toHaveTextContent('Ran npm test');
    expect(screen.queryByText('boom')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /npm test/ }));
    expect(screen.getByText('boom')).toBeInTheDocument();
    expect(screen.queryByText('Exit code 0')).toBeNull();
  });

  it('opens a file change onto its diff', () => {
    const change = {
      ...event(1, 'file_change', ''),
      item_id: 'f1',
      data: { changes: [{ path: '/work/shop/notes.md', kind: { type: 'add' }, diff: 'first\nsecond\n' }] },
    };
    render(<EventTimeline {...timelineProps([change])} session={session('completed')} />);

    // A lone step opens straight onto its detail.
    fireEvent.click(screen.getByText(headline('Created notes.md')));
    expect(screen.queryByRole('button', { name: /Created notes\.md/ })).toBeNull();
    expect(screen.getByText('/work/shop/notes.md')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'File diff' })).toHaveTextContent('+second');
  });

  it('names context compaction in the headline without splitting the work', () => {
    const compaction = (seq: number, phase: CodingEvent['phase']) => ({ ...event(seq, 'tool', ''), item_id: 'k1', phase, data: { type: 'contextCompaction' } });
    const events = [
      { ...event(1, 'command', ''), item_id: 'c1', data: { command: 'npm test' } },
      compaction(2, 'started'),
      compaction(3, 'completed'),
      { ...event(4, 'command', ''), item_id: 'c2', data: { command: 'npm run lint' } },
    ];
    const { container } = render(<EventTimeline {...timelineProps(events)} session={session('completed')} />);

    expect(container.querySelectorAll('.code-activity-group')).toHaveLength(1);
    fireEvent.click(screen.getByText('Ran 2 commands and compacted context'));
    expect(screen.getAllByText('Compacted context')).toHaveLength(1);
  });

  it('names compaction on the live status line while it runs', () => {
    const compaction = { ...event(2, 'tool', ''), item_id: 'k1', phase: 'started' as const, data: { type: 'contextCompaction' } };
    render(<EventTimeline {...timelineProps([event(1, 'user_message', 'Go'), compaction])} session={session('running')} />);

    expect(screen.getByRole('status')).toHaveTextContent('Compacting context');
  });

  it('shows a lone step with nothing to open as a plain line', () => {
    const tool = { ...event(1, 'tool', ''), item_id: 't1', data: { type: 'mcpToolCall', server: 'linear', tool: 'get_issue' } };
    const { container } = render(<EventTimeline {...timelineProps([tool])} session={session('completed')} />);

    expect(container.querySelector('.code-activity-group summary')).toBeNull();
    expect(container.querySelector('.code-activity-group__line')).toHaveTextContent('Called linear · get_issue');
  });

  it('folds a finished turn under how long it worked, and lists the files it changed', () => {
    const onOpenReview = vi.fn();
    const diff = ['diff --git a/src/a.ts b/src/a.ts', '--- a/src/a.ts', '+++ b/src/a.ts', '@@ -1 +1,2 @@', '-x', '+y', '+z'].join('\n');
    const events: CodingEvent[] = [
      { ...event(1, 'user_message', 'Fix a'), timestamp: '2026-08-21T09:00:00Z' },
      { ...event(2, 'command', ''), item_id: 'c1', data: { command: 'npm test' } },
      { ...event(3, 'agent_message', 'Tests fail; fixing a.ts.'), item_id: 'note' },
      { ...event(4, 'diff', diff), phase: 'progress' },
      { ...event(5, 'agent_message', 'Fixed a.ts.'), item_id: 'answer', timestamp: '2026-08-21T09:04:36Z' },
    ];
    const view = render(<EventTimeline {...timelineProps(events)} session={session('running')} onOpenReview={onOpenReview} />);
    expect(screen.getByText(headline('Ran npm test'))).toBeInTheDocument();
    expect(screen.queryByText(/^Worked for/)).toBeNull();

    view.rerender(<EventTimeline {...timelineProps(events)} session={session('completed')} onOpenReview={onOpenReview} />);
    expect(screen.getByText('Worked for 4m 36s')).toBeInTheDocument();
    expect(screen.queryByText(headline('Ran npm test'))).toBeNull();
    expect(screen.queryByText('Tests fail; fixing a.ts.')).toBeNull();
    expect(screen.getByText('Fixed a.ts.')).toBeInTheDocument();
    expect(screen.getByText('Edited 1 file')).toBeInTheDocument();
    expect(screen.getByText('src/a.ts')).toBeInTheDocument();
    // The changed files stay with the answer, and its actions close the turn.
    const answer = screen.getByRole('article', { name: 'Coding agent message' });
    expect(answer.querySelector('.code-turn-changes + .code-response-actions')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(onOpenReview).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByText('Worked for 4m 36s'));
    expect(screen.getByText(headline('Ran npm test'))).toBeInTheDocument();
    expect(screen.getByText('Tests fail; fixing a.ts.')).toBeInTheDocument();
  });

  it('folds a thought that arrives after the answer into the finished turn', () => {
    const thought = (seq: number, id: string, heading: string): CodingEvent => ({ ...event(seq, 'reasoning', ''), item_id: id, data: { summary: [`**${heading}**`] } });
    const events: CodingEvent[] = [
      { ...event(1, 'user_message', 'What version is the server?'), timestamp: '2026-08-21T09:00:00Z' },
      thought(2, 'r1', 'Checking version'),
      { ...event(3, 'command', ''), item_id: 'c1', data: { command: 'git describe --tags' } },
      { ...event(4, 'agent_message', 'It is version 1.2.3.'), item_id: 'answer', timestamp: '2026-08-21T09:00:19Z' },
      thought(5, 'r2', 'Identifying version from git tag'),
      { ...event(6, 'usage', ''), phase: 'progress' },
    ];
    render(<EventTimeline {...timelineProps(events)} session={session('completed')} />);

    expect(screen.getByText('Worked for 19s')).toBeInTheDocument();
    expect(screen.queryByText('Thought it through')).toBeNull();

    fireEvent.click(screen.getByText('Worked for 19s'));
    expect(screen.getByText('Thought it through')).toBeInTheDocument();
  });

  it('keeps a failure closed while the turn is live and inside its finished fold', () => {
    const events: CodingEvent[] = [
      { ...event(1, 'user_message', 'Fix a'), timestamp: '2026-08-21T09:00:00Z' },
      { ...event(2, 'command', ''), item_id: 'c1', data: { command: 'npm test', exitCode: 1, aggregatedOutput: 'FAIL a.test.ts\n' } },
      { ...event(3, 'command', ''), item_id: 'c2', data: { command: 'npm run lint', exitCode: 0 } },
      { ...event(4, 'agent_message', 'Fixed a.ts.'), item_id: 'answer', timestamp: '2026-08-21T09:01:00Z' },
    ];
    const view = render(<EventTimeline {...timelineProps(events.slice(0, 3))} session={session('running')} />);
    expect(view.container.querySelector('.code-activity-group.is-failed')).not.toHaveAttribute('open');
    expect(screen.getByText('1 failed')).toBeInTheDocument();
    expect(screen.queryByText('Exit code 1')).toBeNull();

    view.rerender(<EventTimeline {...timelineProps(events)} session={session('completed')} />);
    fireEvent.click(screen.getByText('Worked for 1m 0s'));
    const group = view.container.querySelector('.code-activity-group.is-failed');
    expect(group).not.toBeNull();
    expect(group).not.toHaveAttribute('open');
    expect(screen.getByText('1 failed')).toBeInTheDocument();
    expect(screen.queryByText('Exit code 1')).toBeNull();

    fireEvent.click(screen.getByText('1 failed'));
    expect(group).toHaveAttribute('open');
    const step = screen.getByRole('button', { name: /npm test/ });
    expect(step).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(step);
    expect(screen.getByText('Exit code 1')).toBeInTheDocument();
  });

  it('keeps the work of a turn that ended without an answer in view', () => {
    const events = [event(1, 'user_message', 'Fix a'), { ...event(2, 'command', ''), item_id: 'c1', data: { command: 'npm test' } }];
    render(<EventTimeline {...timelineProps(events)} session={session('cancelled')} />);

    expect(screen.getByText(headline('Ran npm test'))).toBeInTheDocument();
    expect(screen.queryByText(/^Worked/)).toBeNull();
  });

  function planUpdate(seq: number, statuses: string[], explanation = ''): CodingEvent {
    return {
      ...event(seq, 'plan', ''),
      title: 'Plan updated',
      phase: 'progress',
      data: { explanation, plan: statuses.map((status, index) => ({ step: `Step ${index + 1}`, status })) },
    };
  }

  it('folds checklist updates into the work, keeping only the latest', () => {
    const events = [
      event(1, 'user_message', 'Fix a'),
      planUpdate(2, ['inProgress', 'pending', 'pending']),
      { ...event(3, 'command', ''), item_id: 'c1', data: { command: 'npm test' } },
      planUpdate(4, ['completed', 'inProgress', 'pending'], 'Tests fail on the parser.'),
    ];
    const { container } = render(<EventTimeline {...timelineProps(events)} session={session('cancelled')} />);

    expect(container.querySelector('.code-plan')).toBeNull();
    expect(container.querySelectorAll('.code-activity-group')).toHaveLength(1);
    fireEvent.click(screen.getByText('Ran 1 command and updated the plan'));
    const plan = screen.getByRole('button', { name: /Updated the plan · 1 of 3 done/ });
    expect(screen.getAllByText('Updated the plan')).toHaveLength(1);
    fireEvent.click(plan);
    expect(screen.getByText('Tests fail on the parser.')).toBeInTheDocument();
    expect(screen.getByText('Step 3')).toBeInTheDocument();
  });

  it('keeps a proposed plan as its own card', () => {
    const proposed = { ...event(1, 'plan', '1. Split the parser\n2. Add tests'), title: 'Proposed plan', item_id: 'p1', phase: 'progress' as const };
    const { container } = render(<EventTimeline {...timelineProps([proposed])} session={session('completed')} />);

    expect(container.querySelector('.code-plan')).not.toBeNull();
    expect(screen.getByText('Proposed plan')).toBeInTheDocument();
  });

  it('names the plan step on the live status line', () => {
    const events = [
      event(1, 'user_message', 'Fix a'),
      planUpdate(2, ['completed', 'inProgress', 'pending']),
      { ...event(3, 'agent_message', 'Parser next.'), item_id: 'note' },
      { ...event(4, 'command', ''), item_id: 'c1', phase: 'started' as const, data: { command: 'npm test' } },
    ];
    render(<EventTimeline {...timelineProps(events)} session={session('running')} />);

    expect(screen.getByRole('status')).toHaveTextContent('Running npm test');
    expect(screen.getByRole('status')).toHaveTextContent('Step 2 of 3');
  });

  it('keeps a denial visible in the transcript', () => {
    const denial = { ...event(1, 'approval', 'Deny'), title: 'Approval resolved', data: { approvalId: 'a1', decision: 'deny' } };
    render(<EventTimeline {...timelineProps([denial])} session={session('cancelled')} />);

    expect(screen.getByText('Approval denied')).toBeInTheDocument();
  });

  it('shows one live status line naming what the agent is doing', () => {
    const events = [
      event(1, 'user_message', 'Run the tests'),
      { ...event(2, 'command', ''), item_id: 'c1', phase: 'started' as const, data: { command: `/bin/zsh -lc 'npm test'` } },
    ];
    render(<EventTimeline {...timelineProps(events)} session={session('running')} />);

    expect(screen.getByRole('status')).toHaveTextContent('Running npm test');
    expect(screen.queryByText('The coding agent is working…')).toBeNull();
    expect(screen.queryByText('npm test', { selector: '.code-step__target' })).toBeNull();
  });

  it('shows parallel Codex work as one compact, live status card', () => {
    const childWork = [
      {
        ...event(1, 'child_work', 'Inspecting the renderer'),
        item_id: 'child-1',
        title: 'Audit the UI',
        phase: 'started' as const,
      },
      {
        ...event(2, 'child_work', 'Found two layout issues'),
        item_id: 'child-1',
        title: 'Audit the UI',
        phase: 'completed' as const,
      },
    ];

    render(<EventTimeline {...timelineProps(childWork)} session={session('running')} />);

    expect(screen.getByText('Parallel work')).toBeInTheDocument();
    expect(screen.getByText('Audit the UI')).toBeInTheDocument();
    expect(screen.getByText('Done')).toBeInTheDocument();
    expect(screen.queryByText('Inspecting the renderer')).toBeNull();
  });

  it('windows long transcripts while keeping earlier updates available', () => {
    const events = Array.from({ length: 325 }, (_, index) => event(index + 1, 'user_message', `Message ${index + 1}`));
    render(<EventTimeline {...timelineProps(events)} session={session('completed')} />);

    expect(screen.queryByText('Message 1')).toBeNull();
    expect(screen.getByText('Message 325')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show 25 earlier updates' }));
    expect(screen.getByText('Message 1')).toBeInTheDocument();
  });
});
