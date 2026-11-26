// The finish page posts the sign-in's completion once per page load and tells
// the tab that started the sign-in how it ended.

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
  it("shows auth's refusal and tells the waiting tab its code and message, once for a remount", async () => {
    const reason = "This server's tokens expire and it gives no refresh token, so it cannot be used on cloud.";
    takeCustomMcpCompletion.mockReturnValue('A'.repeat(43));
    customMcpFinish.mockResolvedValue({ ok: false, code: 'no_refresh_token', reason });
    const tab = listen();

    const first = render(<CustomMcpFinishPage />);
    first.unmount();
    render(<CustomMcpFinishPage />);

    expect(await screen.findByText(new RegExp(reason.slice(0, 30)))).toBeTruthy();
    await vi.waitFor(() => expect(tab.heard).toHaveLength(1));
    expect(tab.heard).toEqual([{ ok: false, code: 'no_refresh_token', reason }]);
    expect(customMcpFinish).toHaveBeenCalledTimes(1);
    tab.close();
  });

  it('tells the waiting tab of a success and closes itself', async () => {
    takeCustomMcpCompletion.mockReturnValue('A'.repeat(43));
    customMcpFinish.mockResolvedValue({ ok: true, name: `cm-${'a'.repeat(32)}` });
    const close = vi.spyOn(window, 'close').mockImplementation(() => {});
    const tab = listen();

    render(<CustomMcpFinishPage />);

    await vi.waitFor(() => expect(tab.heard).toEqual([{ ok: true }]));
    expect(close).toHaveBeenCalled();
    tab.close();
  });
});
