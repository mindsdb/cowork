import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { CodingEvent, CodingSession } from './api';
import { EventTimeline } from './EventTimeline';
import { indexLatestEvents } from './useCodingSession';


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


function timelineProps(events: CodingEvent[]) {
  return { events, latestEvents: indexLatestEvents(events) };
}


describe('EventTimeline', () => {
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
    expect(screen.getByText('Event 6000')).toBeInTheDocument();

    indexReads = 0;
    view.rerender(<EventTimeline {...props} recovering />);

    expect(indexReads).toBeLessThan(10);
  });

  it('collapses repeated connection failures and renders one terminal outcome', () => {
    const events = [1, 2, 3, 4, 5].map((seq) => event(seq, 'error', `Attempt ${seq} failed`));

    render(<EventTimeline {...timelineProps(events)} session={{ ...session('failed'), last_error: 'Connection unavailable' }} />);

    expect(screen.getByText('Connection retried 5 times')).toBeInTheDocument();
    expect(screen.getAllByText('Failed')).toHaveLength(1);
    expect(screen.getByText('Connection unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Attempt 1 failed')).toBeNull();
    fireEvent.click(screen.getByText('Connection retried 5 times'));
    expect(screen.getByText('Attempt 5 failed')).toBeInTheDocument();
  });

  it('offers one recovery action for a preserved remote run', () => {
    const onRecover = vi.fn(async () => {});
    render(
      <EventTimeline
        {...timelineProps([event(1, 'error', 'Computer disconnected')])}
        session={{
          ...session('interrupted'),
          run_status: 'interrupted',
          computer_status: 'offline',
          last_error: 'Computer disconnected',
        }}
        onRecover={onRecover}
      />,
    );

    expect(screen.getByText('Task paused')).toBeInTheDocument();
    expect(screen.getByText(/conversation is safe; resume there or choose another compatible computer/)).toBeInTheDocument();
    expect(screen.getAllByText('Computer disconnected')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Resume task' }));
    expect(onRecover).toHaveBeenCalledOnce();
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
    expect(screen.queryByRole('button', { name: 'Resume task' })).not.toBeInTheDocument();
  });

  it('turns a credit failure into concise recovery actions with technical detail on demand', () => {
    const onChooseModel = vi.fn();
    const onAddCredits = vi.fn();
    const creditError = {
      ...event(1, 'error', 'This model needs credits. Add credits or choose another model.'),
      data: {
        code: 'insufficient_credits',
        detail: 'server returned 402 Payment Required: You have 0 weighted tokens left',
        model: 'gpt-5.6-sol',
      },
    };

    render(
      <EventTimeline
        {...timelineProps([creditError])}
        session={{ ...session('failed'), model: 'gpt-5.6-sol', last_error: creditError.text }}
        modelName="GPT 5.6 Sol"
        onChooseModel={onChooseModel}
        onAddCredits={onAddCredits}
      />,
    );

    expect(screen.getByText('GPT 5.6 Sol needs credits')).toBeInTheDocument();
    expect(screen.getByText('Add credits or choose another model, then continue in this task.')).toBeInTheDocument();
    expect(screen.getByText(/server returned 402/)).not.toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Choose model' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add credits' }));
    expect(onChooseModel).toHaveBeenCalledOnce();
    expect(onAddCredits).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByText('Failure details'));
    expect(screen.getByText(/server returned 402 Payment Required/)).toBeVisible();
  });

  function failedTask(code: string, detail: string) {
    const failure = { ...event(1, 'error', 'The turn failed.'), data: { code, detail, model: 'gpt-5.6-sol' } };
    return {
      ...timelineProps([failure]),
      session: { ...session('failed'), run_status: 'failed' as const, model: 'gpt-5.6-sol', last_error: failure.text },
      modelName: 'GPT 5.6 Sol',
    };
  }

  it('reads the failure code from the terminal session event when the raw agent error carries none', () => {
    const onChooseModel = vi.fn();
    const onAddCredits = vi.fn();
    const events: CodingEvent[] = [
      event(1, 'error', 'Agent error: You have 0 weighted tokens left'),
      {
        ...event(2, 'session', 'The task failed.'),
        title: 'Task failed',
        phase: 'failed',
        data: { status: 'failed', code: 'insufficient_credits', detail: 'server returned 402 Payment Required', model: 'gpt' },
      },
    ];

    render(
      <EventTimeline
        {...timelineProps(events)}
        session={{ ...session('failed'), run_status: 'failed', model: 'gpt', last_error: events[0].text }}
        modelName="GPT 5.6 Sol"
        onChooseModel={onChooseModel}
        onAddCredits={onAddCredits}
      />,
    );

    expect(screen.getByText('GPT 5.6 Sol needs credits')).toBeInTheDocument();
    expect(screen.getByText('Add credits or choose another model, then continue in this task.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Choose model' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add credits' }));
    expect(onChooseModel).toHaveBeenCalledOnce();
    expect(onAddCredits).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByText('Failure details'));
    expect(screen.getByText('server returned 402 Payment Required')).toBeVisible();
  });

  it('asks for a fresh sign-in when the model credential is rejected, with no invented sign-in action', () => {
    const onChooseModel = vi.fn();
    const onAddCredits = vi.fn();
    render(
      <EventTimeline
        {...failedTask('model_authentication_failed', 'server returned 401 Unauthorized')}
        onChooseModel={onChooseModel}
        onAddCredits={onAddCredits}
      />,
    );

    expect(screen.getByText('Your sign-in does not match this server')).toBeInTheDocument();
    expect(screen.getByText('Sign in again, or switch back to the environment you signed into, then continue in this task.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add credits' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resume task' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Choose model' }));
    expect(onChooseModel).toHaveBeenCalledOnce();
    expect(onAddCredits).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Failure details'));
    expect(screen.getByText('server returned 401 Unauthorized')).toBeVisible();
  });

  it('offers a model change when the chosen model is not available', () => {
    const onChooseModel = vi.fn();
    render(
      <EventTimeline
        {...failedTask('model_unavailable', 'server returned 404 model not found')}
        onChooseModel={onChooseModel}
      />,
    );

    expect(screen.getByText('GPT 5.6 Sol is not available')).toBeInTheDocument();
    expect(screen.getByText('Choose another model, then continue in this task.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add credits' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resume task' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Choose model' }));
    expect(onChooseModel).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByText('Failure details'));
    expect(screen.getByText('server returned 404 model not found')).toBeVisible();
  });

  it('keeps the generic paused-task recovery for failure codes it does not know', () => {
    render(<EventTimeline {...failedTask('runtime_crashed', 'worker exited with code 137')} />);

    expect(screen.getByText('Task paused')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume task' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Choose model' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Failure details'));
    expect(screen.getByText('worker exited with code 137')).toBeVisible();
  });

  it('hides raw session events because status is represented once in the outcome', () => {
    render(
      <EventTimeline
        {...timelineProps([event(1, 'session', 'Raw completed notification')])}
        session={session('completed')}
      />,
    );

    expect(screen.queryByText('Raw completed notification')).toBeNull();
    expect(screen.getAllByText('Completed')).toHaveLength(1);
  });

  it('shows the answer to /status where the command was sent', () => {
    const status = {
      ...event(2, 'session', 'Status: ready\nModel: gpt\nPermissions: supervised'),
      title: 'Task status',
      data: { goal: {} },
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
      { ...event(3, 'command', ''), item_id: 'command-1', phase: 'completed' as const, title: 'Run tests' },
    ];

    render(<EventTimeline {...timelineProps(command)} session={session('completed')} />);

    expect(screen.getByText('Agent activity')).toBeInTheDocument();
    expect(screen.queryByText('Run tests', { selector: 'summary span' })).toBeNull();
  });

  it('does not leave progress-only telemetry looking active after the turn ends', () => {
    const usage = {
      ...event(1, 'usage', ''),
      title: 'Usage updated',
      phase: 'progress' as const,
    };

    render(<EventTimeline {...timelineProps([usage])} session={session('completed')} />);

    expect(screen.getByText('Agent activity')).toBeInTheDocument();
    expect(screen.queryByText('Usage updated', { selector: 'summary span' })).toBeNull();
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
    const command = { ...event(1, 'command', 'very large command output'), title: 'Run tests' };
    render(<EventTimeline {...timelineProps([command])} session={session('completed')} />);

    expect(screen.queryByText('very large command output')).toBeNull();
    fireEvent.click(screen.getByText('Agent activity'));
    expect(screen.getByText('very large command output')).toBeInTheDocument();
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
