import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { CodingEvent, CodingSession } from './api';
import { EventTimeline } from './EventTimeline';


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


describe('EventTimeline', () => {
  it('collapses repeated connection failures and renders one terminal outcome', () => {
    const events = [1, 2, 3, 4, 5].map((seq) => event(seq, 'error', `Attempt ${seq} failed`));

    render(<EventTimeline events={events} session={{ ...session('failed'), last_error: 'Connection unavailable' }} />);

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
        events={[event(1, 'error', 'Computer disconnected')]}
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
        events={[event(1, 'error', 'Tests failed')]}
        session={{ ...session('failed'), last_error: 'Tests failed' }}
      />,
    );

    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('Tests failed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resume task' })).not.toBeInTheDocument();
  });

  it('hides raw session events because status is represented once in the outcome', () => {
    render(
      <EventTimeline
        events={[event(1, 'session', 'Raw completed notification')]}
        session={session('completed')}
      />,
    );

    expect(screen.queryByText('Raw completed notification')).toBeNull();
    expect(screen.getAllByText('Completed')).toHaveLength(1);
  });

  it('leaves pending queued instructions in the actionable composer queue', () => {
    const queued = {
      ...event(1, 'user_message', 'Run Windows tests next'),
      title: 'Queued next',
      phase: 'pending' as const,
      data: { queueId: 'queued-1' },
    };

    render(<EventTimeline events={[queued]} session={session('running')} />);

    expect(screen.queryByText('Run Windows tests next')).not.toBeInTheDocument();
  });

  it('uses the terminal phase when streamed activity fragments are merged', () => {
    const command = [
      { ...event(1, 'command', ''), item_id: 'command-1', phase: 'started' as const, title: 'Run tests' },
      { ...event(2, 'command', 'tests passed'), item_id: 'command-1', phase: 'progress' as const },
      { ...event(3, 'command', ''), item_id: 'command-1', phase: 'completed' as const, title: 'Run tests' },
    ];

    render(<EventTimeline events={command} session={session('completed')} />);

    expect(screen.getByText('Agent activity')).toBeInTheDocument();
    expect(screen.queryByText('Run tests', { selector: 'summary span' })).toBeNull();
  });

  it('does not leave progress-only telemetry looking active after the turn ends', () => {
    const usage = {
      ...event(1, 'usage', ''),
      title: 'Usage updated',
      phase: 'progress' as const,
    };

    render(<EventTimeline events={[usage]} session={session('completed')} />);

    expect(screen.getByText('Agent activity')).toBeInTheDocument();
    expect(screen.queryByText('Usage updated', { selector: 'summary span' })).toBeNull();
  });

  it('keeps a pinned timeline at the bottom when a streamed item grows in place', () => {
    const scrollTo = vi.mocked(HTMLElement.prototype.scrollTo);
    scrollTo.mockClear();
    const first = { ...event(1, 'agent_message', 'Hello'), item_id: 'message-1', phase: 'progress' as const };
    const view = render(<EventTimeline events={[first]} session={session('running')} />);
    const callsAfterFirstChunk = scrollTo.mock.calls.length;

    view.rerender(
      <EventTimeline
        events={[first, { ...event(2, 'agent_message', ' world'), item_id: 'message-1', phase: 'progress' }]}
        session={session('running')}
      />,
    );

    expect(scrollTo.mock.calls.length).toBeGreaterThan(callsAfterFirstChunk);
    expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: 'auto' }));
  });

  it('does not mount large activity details until the user opens them', () => {
    const command = { ...event(1, 'command', 'very large command output'), title: 'Run tests' };
    render(<EventTimeline events={[command]} session={session('completed')} />);

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

    render(<EventTimeline events={childWork} session={session('running')} />);

    expect(screen.getByText('Parallel work')).toBeInTheDocument();
    expect(screen.getByText('Audit the UI')).toBeInTheDocument();
    expect(screen.getByText('Done')).toBeInTheDocument();
    expect(screen.queryByText('Inspecting the renderer')).toBeNull();
  });

  it('windows long transcripts while keeping earlier updates available', () => {
    const events = Array.from({ length: 325 }, (_, index) => event(index + 1, 'user_message', `Message ${index + 1}`));
    render(<EventTimeline events={events} session={session('completed')} />);

    expect(screen.queryByText('Message 1')).toBeNull();
    expect(screen.getByText('Message 325')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show 25 earlier updates' }));
    expect(screen.getByText('Message 1')).toBeInTheDocument();
  });
});
