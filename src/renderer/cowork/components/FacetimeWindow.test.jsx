import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FacetimeWindow from './FacetimeWindow';

function call(over = {}) {
  return {
    phase: 'live', notice: '', captions: { user: '', avatar: '', last: null }, speaking: { user: false, avatar: false },
    working: false, micOn: true, cameraOn: true, secondsLeft: null,
    avatarVideoRef: { current: null }, avatarAudioRef: { current: null }, selfVideoRef: { current: null },
    start: vi.fn(), end: vi.fn(), toggleMic: vi.fn(), toggleCamera: vi.fn(), attach: vi.fn(), dismiss: vi.fn(),
    ...over,
  };
}

describe('the video call window', () => {
  it('is not there without a call', () => {
    render(<FacetimeWindow call={call({ phase: 'idle' })} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('says the avatar is getting ready', () => {
    render(<FacetimeWindow call={call({ phase: 'preparing' })} />);
    expect(screen.getByText(/getting ready/)).toBeInTheDocument();
  });

  it('shows captions, the AI label and what Anton is doing, and hangs up', async () => {
    const c = call({ working: true, captions: { user: 'Book a hotel', avatar: 'Let me look into that.', last: 'avatar' } });
    render(<FacetimeWindow call={c} agentLabel="Anton" />);
    expect(screen.getByText('AI')).toBeInTheDocument();
    expect(screen.getByText('Anton is working on it…')).toBeInTheDocument();
    expect(screen.getByText('Let me look into that.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Hang up' }));
    expect(c.end).toHaveBeenCalled();
  });

  it('says why a call ended and closes', async () => {
    const c = call({ phase: 'ended', notice: 'The call reached its time limit.' });
    render(<FacetimeWindow call={c} />);
    expect(screen.getByText('The call reached its time limit.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(c.dismiss).toHaveBeenCalled();
  });
});
