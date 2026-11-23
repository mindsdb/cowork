// The rail's Open chat (ENG-4599): hidden in the origin chat, enabled for a
// chat that can be opened, disabled with the reason otherwise, and settled
// when the preview opens rather than on click.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useOriginChatAction } from './useOriginChatAction';
import { OriginChatContext } from '../../lib/originChat';
import { setOrgMode } from '../../../lib/orgMode';

const ORIGIN = '3f6a1c8e-6b1d-4a2f-9a1e-2c7d5b0e4a11';
const artifact = (over = {}) => ({ id: 'a1', originConversationId: ORIGIN, ...over });

function setup({ chats, ...props }) {
  const close = vi.fn((then) => then());
  const wrapper = chats === null
    ? undefined
    : ({ children }) => <OriginChatContext.Provider value={chats}>{children}</OriginChatContext.Provider>;
  const view = renderHook((p) => useOriginChatAction({ open: true, close, ...p }), { initialProps: props, wrapper });
  return { ...view, close };
}

const host = (status = 'ok') => ({ open: vi.fn(), check: vi.fn().mockResolvedValue(status) });

afterEach(() => setOrgMode(false));

describe('useOriginChatAction', () => {
  it('is hidden inside the origin chat, and without a host to open chats', () => {
    const chats = host();
    expect(setup({ chats, artifact: artifact(), conversationId: ORIGIN }).result.current).toBeNull();
    expect(chats.check).not.toHaveBeenCalled();
    expect(setup({ chats: null, artifact: artifact() }).result.current).toBeNull();
  });

  it('is hidden while the preview is closed, and asks nothing then', () => {
    const chats = host();
    const { result } = setup({ chats, artifact: artifact(), open: false });
    expect(result.current).toBeNull();
    expect(chats.check).not.toHaveBeenCalled();
  });

  it('is disabled with no reason while the check runs, then enabled for a reachable chat', async () => {
    let answer;
    const chats = { open: vi.fn(), check: vi.fn(() => new Promise((resolve) => { answer = resolve; })) };
    const { result } = setup({ chats, artifact: artifact() });
    expect(result.current).toMatchObject({ id: 'open-chat', label: 'Open chat', disabled: true, description: '' });
    await waitFor(() => expect(chats.check).toHaveBeenCalledWith(ORIGIN));

    await act(async () => answer('ok'));
    expect(result.current).toMatchObject({
      disabled: false,
      description: 'Close the preview and go to the chat this was made in',
    });
  });

  it('closes the preview, then opens the origin chat, on click', async () => {
    const chats = host();
    const { result, close } = setup({ chats, artifact: artifact() });
    await waitFor(() => expect(result.current.disabled).toBe(false));

    act(() => result.current.onSelect());
    expect(close).toHaveBeenCalledTimes(1);
    expect(chats.open).toHaveBeenCalledWith(ORIGIN);
    expect(close.mock.invocationCallOrder[0]).toBeLessThan(chats.open.mock.invocationCallOrder[0]);
  });

  it('opens nothing from a disabled button', async () => {
    const chats = host('not_found');
    const { result, close } = setup({ chats, artifact: artifact() });
    await waitFor(() => expect(result.current.description).not.toBe(''));
    act(() => result.current.onSelect());
    expect(close).not.toHaveBeenCalled();
    expect(chats.open).not.toHaveBeenCalled();
  });

  it('is disabled with a reason when there is no origin chat, without a check', () => {
    const chats = host();
    const { result } = setup({ chats, artifact: artifact({ originConversationId: '' }) });
    expect(result.current).toMatchObject({
      disabled: true,
      description: 'Not made in a chat, or made before chats were recorded',
    });
    expect(chats.check).not.toHaveBeenCalled();
  });

  it('is disabled when the chat was deleted', async () => {
    const { result } = setup({ chats: host('not_found'), artifact: artifact() });
    await waitFor(() => expect(result.current.description).toBe('The chat this was made in has been deleted'));
    expect(result.current.disabled).toBe(true);
  });

  it("is disabled for a colleague's artifact in org mode, without a check", () => {
    setOrgMode(true);
    const chats = host();
    const { result } = setup({ chats, artifact: artifact({ capabilities: { role: 'reviewer', ownerUserId: 'u2' } }) });
    expect(result.current).toMatchObject({
      disabled: true,
      description: "Made in a colleague's chat, which only they can open",
    });
    expect(chats.check).not.toHaveBeenCalled();
  });

  it('is disabled when the server refuses the chat, or cannot be reached', async () => {
    const forbidden = setup({ chats: host('forbidden'), artifact: artifact() });
    await waitFor(() => expect(forbidden.result.current.description)
      .toBe("Made in a colleague's chat, which only they can open"));

    const failing = { open: vi.fn(), check: vi.fn().mockRejectedValue(new Error('offline')) };
    const { result } = setup({ chats: failing, artifact: artifact() });
    await waitFor(() => expect(result.current.description)
      .toBe("The chat this was made in can't be reached right now"));
    expect(result.current.disabled).toBe(true);
  });

  it('asks again each time the preview opens', async () => {
    const chats = host();
    const { result, rerender } = setup({ chats, artifact: artifact() });
    await waitFor(() => expect(result.current.disabled).toBe(false));
    rerender({ artifact: artifact(), open: false });
    chats.check.mockResolvedValue('not_found');
    rerender({ artifact: artifact(), open: true });
    // No stale "enabled" from the last open while the new check runs.
    expect(result.current.disabled).toBe(true);
    await waitFor(() => expect(result.current.description).toBe('The chat this was made in has been deleted'));
    expect(chats.check).toHaveBeenCalledTimes(2);
  });
});
