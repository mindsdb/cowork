import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import VoiceCallWindow from './VoiceCallWindow';

function call(over = {}) {
  return {
    phase: 'live', notice: '', captions: { user: '', agent: '', last: null }, agentSpeaking: false,
    working: false, micOn: true, start: vi.fn(), end: vi.fn(), toggleMic: vi.fn(), dismiss: vi.fn(),
    ...over,
  };
}

describe('the voice call card', () => {
  it('is not there without a call', () => {
    render(<VoiceCallWindow call={call({ phase: 'idle' })} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('says it is an AI voice, shows what Anton is doing and the captions, and hangs up', async () => {
    const c = call({ working: true, captions: { user: 'Book a hotel', agent: 'On it.', last: 'agent' } });
    render(<VoiceCallWindow call={c} agentLabel="Anton" open />);
    expect(screen.getByText('· AI voice')).toBeInTheDocument();
    expect(screen.getByText('Anton is working on it…')).toBeInTheDocument();
    expect(screen.getByText('On it.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Mute' }));
    expect(c.toggleMic).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Hang up' }));
    expect(c.end).toHaveBeenCalled();
  });

  it('says why a call ended and closes', async () => {
    const c = call({ phase: 'ended', notice: "Voice calls aren't available on this deployment." });
    render(<VoiceCallWindow call={c} />);
    expect(screen.getByText("Voice calls aren't available on this deployment.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(c.dismiss).toHaveBeenCalled();
  });

  it('opens with no call to offer one, or says why it cannot start', async () => {
    const onStart = vi.fn();
    const onClose = vi.fn();
    const { rerender } = render(<VoiceCallWindow call={call({ phase: 'idle' })} open onStart={onStart} onClose={onClose} invite="Line’s open. Say the word." />);
    expect(screen.getByText('Line’s open. Say the word.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Start call' }));
    expect(onStart).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();

    rerender(<VoiceCallWindow call={call({ phase: 'idle' })} open startBlocked="Another call is running." />);
    expect(screen.getByText('Another call is running.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start call' })).toBeDisabled();
  });

  it('hides while the call goes on: gone in a task, an orb elsewhere, and an ended call still says why', async () => {
    const onClose = vi.fn();
    const onShow = vi.fn();
    const { rerender } = render(<VoiceCallWindow call={call()} open onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Hide (the call goes on)' }));
    expect(onClose).toHaveBeenCalled();

    rerender(<VoiceCallWindow call={call()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();

    rerender(<VoiceCallWindow call={call()} bubble onShow={onShow} agentLabel="Anton" />);
    await userEvent.click(screen.getByRole('button', { name: 'Show the call with Anton' }));
    expect(onShow).toHaveBeenCalled();

    rerender(<VoiceCallWindow call={call({ phase: 'ended', notice: 'The call ended.' })} />);
    expect(screen.getByText('The call ended.')).toBeInTheDocument();
  });
});
