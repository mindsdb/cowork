// The Code Mode transcript's workhorse behaviour, pinned before it moves onto
// the shared components/chat primitives: the user's message, and how the
// timeline follows new events for a reader at the bottom or scrolled up.
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeScrollBox, type FakeScrollBox } from '../../../../tests/helpers/scrollBox';
import type { CodingEvent, CodingSession } from './api';
import { EventTimeline } from './EventTimeline';
import { indexLatestEvents } from './useCodingSession';

vi.mock('../lib/clipboard', () => ({ copyText: vi.fn(async () => true) }));

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

function event(seq: number, type: CodingEvent['type'], text: string, extra: Partial<CodingEvent> = {}): CodingEvent {
  return { schema_version: 1, seq, timestamp: `2026-08-21T09:00:0${seq}Z`, type, title: '', text, phase: 'completed', data: {}, ...extra };
}

const props = (events: CodingEvent[]) => ({ events, latestEvents: indexLatestEvents(events) });
const timeline = (container: HTMLElement) => container.querySelector('.code-timeline') as HTMLElement;

describe('the user message', () => {
  it('shows what the user sent', () => {
    render(<EventTimeline {...props([event(1, 'user_message', 'Fix the parser')])} session={session('running')} />);
    expect(screen.getByText('Fix the parser')).toBeInTheDocument();
  });
});

describe('following new events', () => {
  let box: FakeScrollBox;
  beforeEach(() => {
    box = fakeScrollBox((el) => el.classList.contains('code-timeline'));
    box.height = 2000;
    box.client = 600;
  });
  afterEach(() => box.restore());

  const live = [
    event(1, 'user_message', 'Fix the parser'),
    event(2, 'agent_message', 'Looking', { item_id: 'm', phase: 'progress' }),
  ];

  it('keeps a reader at the bottom pinned as the agent writes', () => {
    const { container, rerender } = render(<EventTimeline {...props(live)} session={session('running')} />);
    expect(timeline(container).scrollTop).toBe(1400);
    box.height = 2600;
    rerender(<EventTimeline {...props([...live, event(3, 'agent_message', ' closer', { item_id: 'm', phase: 'progress' })])} session={session('running')} />);
    expect(timeline(container).scrollTop).toBe(2000);
  });

  it('leaves a reader who scrolled up where they are', () => {
    const { container, rerender } = render(<EventTimeline {...props(live)} session={session('running')} />);
    box.scrollReaderTo(timeline(container), 300);
    box.height = 2600;
    rerender(<EventTimeline {...props([...live, event(3, 'agent_message', ' closer', { item_id: 'm', phase: 'progress' })])} session={session('running')} />);
    expect(timeline(container).scrollTop).toBe(300);
  });
});
