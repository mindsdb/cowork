import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveAppPreview } from './LiveAppPreview';
import { closeLiveAppPreviews } from '../../lib/liveAppPreview';

const api = vi.hoisted(() => ({ createLiveAppPreview: vi.fn(), keepLiveAppPreview: vi.fn(), revokeLiveAppPreview: vi.fn(), revokeLiveAppPreviews: vi.fn() }));
vi.mock('../../api', () => api);
vi.mock('../ui', () => ({ Button: ({ children, ...props }) => <button {...props}>{children}</button>, Spinner: () => <span>Loading</span> }));
const origin = 'http://app1.view.localhost:8080';
const launchId = '11111111-1111-4111-8111-111111111111';
const intent = 'a'.repeat(64);
const grant = 'b'.repeat(64);

beforeEach(() => {
  // Exercise postMessage in the DOM without asking the network for an app.
  const setAttribute = Element.prototype.setAttribute;
  vi.spyOn(Element.prototype, 'setAttribute').mockImplementation(function(name, value) {
    if (this.tagName === 'IFRAME' && name === 'src') setAttribute.call(this, 'srcdoc', '<!doctype html><p>Bootstrap fixture</p>');
    return setAttribute.call(this, name, value);
  });
  vi.clearAllMocks();
  api.createLiveAppPreview.mockResolvedValue({ id: 'lease', intent });
  api.keepLiveAppPreview.mockResolvedValue({});
  api.revokeLiveAppPreview.mockResolvedValue({});
  api.revokeLiveAppPreviews.mockResolvedValue({});
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

async function mount() {
  const onOpen = vi.fn();
  const result = render(<LiveAppPreview origin={origin} launchId={launchId} reloadKey={0} onOpen={onOpen} />);
  const iframe = await screen.findByTitle('Live app preview');
  const nonce = new URL(iframe.src).hash.slice(1).split('/')[0];
  const message = (event, overrides = {}) => act(() => {
    window.dispatchEvent(new MessageEvent('message', {
      origin, source: iframe.contentWindow,
      data: { type: 'live-app-preview', event, nonce, launchId }, ...overrides,
    }));
  });
  return { ...result, iframe, nonce, message, onOpen };
}

describe('launch-bound app preview', () => {
  it('passes the intent only to the matching origin, source, nonce and launch', async () => {
    const { iframe, nonce, message } = await mount();
    const send = vi.spyOn(iframe.contentWindow, 'postMessage').mockImplementation(() => {});
    message('ready', { origin: 'http://view.localhost:8080' });
    message('ready', { source: window });
    message('ready', { data: { type: 'live-app-preview', event: 'ready', nonce: 'wrong', launchId } });
    message('ready', { data: { type: 'live-app-preview', event: 'ready', nonce, launchId: 'other' } });
    expect(send).not.toHaveBeenCalled();
    message('ready');
    expect(send).toHaveBeenCalledWith({ type: 'live-app-preview', event: 'intent', nonce, launchId, token: intent }, origin);
    expect(iframe.src).not.toContain(intent);
    expect(iframe.sandbox.toString()).toBe('allow-scripts allow-same-origin allow-forms allow-modals');
  });

  it('opens sign-in only on a click and forwards the grant from that popup only', async () => {
    const popup = { postMessage: vi.fn(), close: vi.fn() };
    const open = vi.spyOn(window, 'open').mockReturnValue(popup);
    const { iframe, nonce, message } = await mount();
    message('sign-in');
    expect(open).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Sign in to preview'));
    expect(open.mock.calls[0][0]).toBe(`${origin}/_live_app/preview/authorize#${nonce}/${launchId}`);
    const send = vi.spyOn(iframe.contentWindow, 'postMessage').mockImplementation(() => {});
    const data = { type: 'live-app-preview', event: 'grant', nonce, launchId, grant };
    message('grant', { source: window, data });
    expect(send).not.toHaveBeenCalled();
    message('ready', { source: popup });
    expect(popup.postMessage).toHaveBeenCalledWith(expect.objectContaining({ token: intent }), origin);
    message('grant', { source: popup, data });
    expect(send).toHaveBeenCalledWith(data, origin);
    message('connected');
    expect(iframe.style.visibility).toBe('visible');
    message('storage-blocked'); // app code cannot change the established pane state
    expect(iframe.style.visibility).toBe('visible');
  });

  it.each(['storage-blocked', 'cookie-blocked'])('removes the frame and offers the browser on %s', async event => {
    const { message, onOpen } = await mount();
    message(event);
    expect(screen.queryByTitle('Live app preview')).toBeNull();
    expect(screen.getByText(/browser limits storage or cookies/)).toBeTruthy();
    fireEvent.click(screen.getByText('Open in browser'));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('does not use an iframe load event as proof of authorization', async () => {
    const { iframe } = await mount();
    fireEvent.load(iframe);
    expect(iframe.style.visibility).toBe('hidden');
    expect(screen.getByText('Connecting app preview…')).toBeTruthy();
  });

  it('removes an app when its next lease renewal is refused', async () => {
    const { iframe, message } = await mount();
    message('connected');
    api.keepLiveAppPreview.mockRejectedValue(new Error('revoked'));
    vi.useFakeTimers();
    // Re-render with a new launch to install the timer under the fake clock.
    const other = render(<LiveAppPreview origin={origin} launchId="22222222-2222-4222-8222-222222222222" onOpen={() => {}} />);
    await act(async () => {});
    const secondFrame = other.container.querySelector('iframe');
    const secondNonce = new URL(secondFrame.src).hash.slice(1).split('/')[0];
    act(() => window.dispatchEvent(new MessageEvent('message', { origin, source: secondFrame.contentWindow,
      data: { type: 'live-app-preview', event: 'connected', nonce: secondNonce, launchId: '22222222-2222-4222-8222-222222222222' },
    })));
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(api.keepLiveAppPreview).toHaveBeenCalledWith('lease');
    expect(other.container.querySelector('iframe')).toBeNull();
    expect(iframe.style.visibility).toBe('visible');
  });

  it('closes immediately on an account transition and revokes on unmount', async () => {
    const { message, unmount } = await mount();
    message('connected');
    await act(async () => { await closeLiveAppPreviews(); });
    expect(screen.queryByTitle('Live app preview')).toBeNull();
    unmount();
    await waitFor(() => expect(api.revokeLiveAppPreview).toHaveBeenCalledWith('lease'));
  });
});
