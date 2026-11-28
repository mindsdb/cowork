// The finish page posts the sign-in's completion once per page load, and then
// nudges the tab that started the sign-in to read its own status.

import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const customMcpFinish = vi.hoisted(() => vi.fn());
vi.mock('../../../platform/host', () => ({ host: { customMcpFinish } }));
const takeCustomMcpCompletion = vi.hoisted(() => vi.fn());
vi.mock('../../lib/customMcpFinish', () => ({ takeCustomMcpCompletion }));

import CustomMcpFinishPage, { resetCustomMcpFinishForTests } from './CustomMcpFinishPage';
import { CUSTOM_MCP_SIGN_IN_CHANNEL } from '../../lib/customMcpWebConnect';

function listen() {
  const heard = [];
  const channel = new BroadcastChannel(CUSTOM_MCP_SIGN_IN_CHANNEL);
  channel.onmessage = (event) => heard.push(event.data);
  return { heard, close: () => channel.close() };
}

afterEach(() => {
  resetCustomMcpFinishForTests();
  customMcpFinish.mockReset();
  takeCustomMcpCompletion.mockReset();
});

describe('CustomMcpFinishPage', () => {
  it("shows auth's refusal and nudges the waiting tab once, across a remount", async () => {
    const reason = "This server's tokens expire and it gives no refresh token, so it cannot be used on cloud.";
    takeCustomMcpCompletion.mockReturnValue('A'.repeat(43));
    customMcpFinish.mockResolvedValue({ ok: false, code: 'no_refresh_token', reason });
    const tab = listen();

    const first = render(<CustomMcpFinishPage />);
    first.unmount();
    render(<CustomMcpFinishPage />);

    expect(await screen.findByText(new RegExp(reason.slice(0, 30)))).toBeTruthy();
    await vi.waitFor(() => expect(tab.heard).toEqual(['finished']));
    expect(customMcpFinish).toHaveBeenCalledTimes(1);
    tab.close();
  });

  it('closes itself after a success, having nudged the waiting tab', async () => {
    takeCustomMcpCompletion.mockReturnValue('A'.repeat(43));
    customMcpFinish.mockResolvedValue({ ok: true, name: `cm-${'a'.repeat(32)}` });
    const close = vi.spyOn(window, 'close').mockImplementation(() => {});
    const tab = listen();

    render(<CustomMcpFinishPage />);

    await vi.waitFor(() => expect(tab.heard).toEqual(['finished']));
    expect(close).toHaveBeenCalled();
    tab.close();
  });

  it('nudges no one when this page load took no completion', async () => {
    takeCustomMcpCompletion.mockReturnValue(null);
    const tab = listen();

    render(<CustomMcpFinishPage />);

    expect(await screen.findByText(/expired/i)).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(tab.heard).toEqual([]);
    expect(customMcpFinish).not.toHaveBeenCalled();
    tab.close();
  });
});
