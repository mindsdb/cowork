import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../platform/host', () => ({
  host: {
    isElectron: false,
    isMac: () => false,
    getApiOrigin: () => 'http://localhost:1',
    openPath: vi.fn(),
    openExternal: vi.fn(),
  },
  getAccessToken: vi.fn(async () => null),
  isElectron: false,
}));

import ChatView from './ChatView';

const askStep = (qid, answer = null) => ({
  id: `question-${qid}`,
  label: `Prompt ${qid}`,
  badge: 'AskUser',
  icon: 'question',
  status: answer ? 'completed' : 'in_progress',
  startedAt: 1,
  completedAt: answer ? 2 : null,
  data: {
    question_id: qid,
    prompt: `Prompt ${qid}`,
    options: [{ value: 'pg', label: `pg-${qid}`, detail: '' }],
    select: 'one',
    allow_custom: true,
    timeout_s: 300,
    answer,
  },
  output: null,
  result: null,
  _questionKey: qid,
  _isScratchpad: false,
  _scratchpadTabId: null,
});

const taskWith = (messages) => ({
  id: 'conv-a',
  title: 'Alpha task',
  status: 'active',
  messages,
});

const option = (qid) => screen.getByRole('button', { name: new RegExp(`pg-${qid}`) });

describe('ask_user card expiry is per question, not per conversation', () => {
  it('leaves an earlier turn\'s unanswered card dead while a new turn runs', () => {
    // A live conversation must not revive a question from an earlier turn.
    render(
      <ChatView
        task={taskWith([
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'earlier turn', steps: [askStep('ask:old')], startedAt: 1 },
          { role: '_streaming', content: '', steps: [askStep('ask:new')], streamStatus: 'in_progress' },
        ])}
        onSend={vi.fn()}
      />,
    );

    expect(option('ask:old')).toBeDisabled();
    expect(option('ask:new')).toBeEnabled();
  });

  it('does not label an answered card "no longer active"', () => {
    // `expired` is also what renders that line, so a blanket true would make
    // every historical card claim it expired — including answered ones.
    render(
      <ChatView
        task={taskWith([
          { role: 'user', content: 'hi' },
          {
            role: 'assistant',
            content: 'earlier turn',
            steps: [askStep('ask:old', { status: 'answered', values: ['pg'], text: '' })],
            startedAt: 1,
          },
        ])}
        onSend={vi.fn()}
      />,
    );

    expect(option('ask:old')).toBeDisabled();
    expect(screen.queryByText(/no longer active/i)).toBeNull();
  });

  it('kills every unanswered card once nothing is in flight', () => {
    render(
      <ChatView
        task={taskWith([
          { role: 'user', content: 'hi' },
          { role: '_streaming', content: '', steps: [askStep('ask:new')], streamStatus: 'in_progress' },
        ])}
        onSend={vi.fn()}
        // No `_streaming`-driven liveness for this conversation: another client
        // owns the run, and this one has not been told it is in flight.
        inFlightSet={new Set()}
      />,
    );
    // The newest unanswered question stays active during its streaming turn.
    expect(option('ask:new')).toBeEnabled();
  });

  it('only the last unanswered question of a live turn is answerable', () => {
    // Retire the earlier question if two arrive in one turn.
    render(
      <ChatView
        task={taskWith([
          { role: 'user', content: 'hi' },
          {
            role: '_streaming',
            content: '',
            steps: [askStep('ask:1'), askStep('ask:2')],
            streamStatus: 'in_progress',
          },
        ])}
        onSend={vi.fn()}
      />,
    );

    expect(option('ask:1')).toBeDisabled();
    expect(option('ask:2')).toBeEnabled();
  });
});
