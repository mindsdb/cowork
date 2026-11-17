import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import VoiceOrb from './VoiceOrb';

describe('the phone voice orb', () => {
  it('says what the call is doing and shows the card on a tap', async () => {
    const onClick = vi.fn();
    const meters = { current: { agent: { getByteFrequencyData: (b) => b.fill(200) }, user: null } };
    render(<VoiceOrb call={{ phase: 'live', working: true, meters }} onClick={onClick} />);
    const orb = screen.getByRole('button', { name: 'Working on it. Show the call' });
    expect(orb).toHaveClass('is-working');
    await userEvent.click(orb);
    expect(onClick).toHaveBeenCalled();
  });
});
