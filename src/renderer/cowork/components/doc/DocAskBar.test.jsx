// The doc preview's "Ask for a change" bar sends every message to the doc's
// chat, the way "Edit with agent" does.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import DocAskBar from './DocAskBar';

const artifact = { id: 'a1', slug: 'q3-plan', title: 'Q3 plan' };

function send(text) {
  const input = screen.getByRole('textbox', { name: 'Ask for a change' });
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

describe('DocAskBar', () => {
  it("sends the person's words with the tab on screen, without the artifact suffix", async () => {
    const onAskAgent = vi.fn(async () => true);
    render(<DocAskBar artifact={artifact} tabId="t2" onAskAgent={onAskAgent} />);
    send('Shorten the summary');
    await waitFor(() => expect(onAskAgent).toHaveBeenCalledTimes(1));
    expect(onAskAgent).toHaveBeenCalledWith({ blockIds: [], request: 'Shorten the summary', tabId: 't2', attachments: [] });
  });

  it('says so when no turn started', async () => {
    const onAskAgent = vi.fn(async () => false);
    render(<DocAskBar artifact={artifact} onAskAgent={onAskAgent} />);
    send('Add a risks section');
    await waitFor(() => expect(onAskAgent).toHaveBeenCalled());
    expect(await screen.findByText(/couldn.t|could not|failed/i)).toBeInTheDocument();
  });
});
