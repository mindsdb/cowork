import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import VoiceLauncher from './VoiceLauncher';

describe('VoiceLauncher', () => {
  it('starts a call from a round button where the card shows', () => {
    const onClick = vi.fn();
    render(<VoiceLauncher call={{ label: 'Call Anton', onClick }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Call Anton' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Call Anton' }).closest('.voice-launcher')).not.toHaveClass('voice-launcher--docked');
  });

  it("hides while a call's card shows, and brings back a call that is fading out", () => {
    const { rerender, container } = render(<VoiceLauncher call={{ label: 'On a call with Anton', live: true }} />);
    expect(container).toBeEmptyDOMElement();
    const resume = vi.fn();
    rerender(<VoiceLauncher docked call={{ label: 'Back to the call with Anton', live: true, onClick: resume }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Back to the call with Anton' }));
    expect(resume).toHaveBeenCalled();
  });

  it('shows nothing when voice calls are off, and does nothing while disabled', () => {
    const { container, rerender } = render(<VoiceLauncher call={null} />);
    expect(container).toBeEmptyDOMElement();
    const onClick = vi.fn();
    rerender(<VoiceLauncher call={{ label: 'Another call is running', disabled: true, onClick }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Another call is running' }));
    expect(onClick).not.toHaveBeenCalled();
  });
});
