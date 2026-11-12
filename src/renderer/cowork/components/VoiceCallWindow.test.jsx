import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import VoiceCallWindow from './VoiceCallWindow';

function call(over = {}) {
  return {
    phase: 'live', notice: '', captions: { user: '', agent: '', last: null }, agentSpeaking: false,
    working: false, micOn: true, start: vi.fn(), end: vi.fn(), toggleMic: vi.fn(), signOff: vi.fn(), dismiss: vi.fn(),
    ...over,
  };
}

describe('the voice call card', () => {
  it('is not there without a call', () => {
    render(<VoiceCallWindow call={call({ phase: 'idle' })} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows what Anton is doing without the transcript, and mutes and ends like the composer', async () => {
    const c = call({ working: true, captions: { user: 'Book a hotel', agent: 'On it.', last: 'agent' } });
    render(<VoiceCallWindow call={c} agentLabel="Anton" />);
    expect(screen.getByText('Working on it…')).toBeInTheDocument();
    expect(screen.queryByText('On it.')).not.toBeInTheDocument();
    expect(screen.queryByText('Book a hotel')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Mute and end the call' }));
    expect(c.signOff).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'End call' })).toHaveClass('voice-call__x');
    expect(screen.queryByRole('button', { name: 'Hang up' })).not.toBeInTheDocument();
  });

  it('says why a call ended and closes', async () => {
    const c = call({ phase: 'ended', notice: "Voice calls aren't available on this deployment." });
    render(<VoiceCallWindow call={c} />);
    expect(screen.getByText("Voice calls aren't available on this deployment.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(c.dismiss).toHaveBeenCalled();
  });

  it('ends the call from its close button, and docks in the sidebar', async () => {
    const c = call();
    const { rerender } = render(<VoiceCallWindow call={c} />);
    await userEvent.click(screen.getByRole('button', { name: 'End call' }));
    expect(c.end).toHaveBeenCalled();

    rerender(<VoiceCallWindow call={c} docked />);
    expect(screen.getByRole('dialog')).toHaveClass('voice-call--docked');
  });
});

describe('the voice call card, signing off and voices', () => {
  it('fading out, it is out of reach of focus as well as hidden', () => {
    render(<VoiceCallWindow call={call({ lingering: true })} />);
    const card = document.querySelector('.voice-call');
    expect(card).toHaveClass('is-lingering');
    expect(card).toHaveAttribute('aria-hidden', 'true');
    expect(card).toHaveAttribute('inert');
  });

  it('folds away while it signs off', () => {
    render(<VoiceCallWindow call={call({ micOn: false, closing: true })} />);
    expect(screen.getByRole('dialog')).toHaveClass('is-closing');
    expect(screen.getByText('Talk soon')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mute and end the call' })).toBeDisabled();
  });

  it('names the voice by the chevron, and says which one a preview tries', () => {
    render(<VoiceCallWindow call={call({ previewing: true, micOn: false })} />);
    expect(screen.getByRole('button', { name: /^Voice: / })).toBeInTheDocument();
    expect(screen.getByText(/^Trying /)).toBeInTheDocument();
  });
});

describe('the voice call card while it connects', () => {
  it('is one line with no waves until the session is live', async () => {
    const c = call({ phase: 'starting', meters: { current: {} } });
    const { container } = render(<VoiceCallWindow call={c} />);
    expect(screen.getByText('Connecting voice…')).toBeInTheDocument();
    expect(container.querySelector('canvas')).toBeNull();
    expect(screen.queryByRole('button', { name: /Mute/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'End call' }));
    expect(c.end).toHaveBeenCalled();
  });
});
