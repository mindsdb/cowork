import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../../platform/host', () => ({
  host: { isElectron: false, isMac: () => false, getApiOrigin: () => 'http://localhost:1' },
  openExternal: vi.fn(),
  getAccessToken: vi.fn(async () => null),
  isElectron: false,
}));

const embedBrowser = vi.fn();
vi.mock('../../api', () => ({ embedBrowser: (...args) => embedBrowser(...args) }));

import { BrowserPanel, STARTING_TIMEOUT_MS } from './BrowserPanel';

const VIEW = 'https://cowork.mindshub.ai/browser/sessions/t-abc/view?et=tok';
const session = (over = {}) => ({ key: 'm0:t-abc', sessionId: 't-abc', viewUrl: VIEW, expiresAt: 0, ...over });

describe('BrowserPanel starting state', () => {
  // The frames point at a live host: keep happy-dom from loading them, so
  // the tests decide when a frame has loaded.
  let iframeLoading;
  beforeEach(() => {
    vi.useFakeTimers();
    embedBrowser.mockReset();
    iframeLoading = window.happyDOM.settings.disableIframePageLoading;
    window.happyDOM.settings.disableIframePageLoading = true;
  });
  afterEach(() => {
    vi.useRealTimers();
    window.happyDOM.settings.disableIframePageLoading = iframeLoading;
  });

  it('says the browser is starting until the viewer frame loads', () => {
    render(<BrowserPanel session={session()} onClose={() => {}} />);
    expect(screen.getByRole('status')).toHaveTextContent('Starting your browser…');
    fireEvent.load(screen.getByTitle('Shared browser'));
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText('Starting your browser…')).toBeNull();
  });

  it('says it is starting while a fresh viewer address is fetched', async () => {
    let resolve;
    embedBrowser.mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<BrowserPanel session={session({ viewUrl: '' })} onClose={() => {}} />);
    expect(screen.getByText('Starting your browser…')).toBeInTheDocument();
    expect(screen.queryByTitle('Shared browser')).toBeNull();
    await act(async () => { resolve({ view_url: VIEW }); });
    expect(screen.getByTitle('Shared browser')).toHaveAttribute('src', VIEW);
    expect(screen.getByText('Starting your browser…')).toBeInTheDocument();
  });

  it('offers to try again when the browser takes too long, and retrying starts over', async () => {
    embedBrowser.mockResolvedValue({ view_url: `${VIEW}2` });
    render(<BrowserPanel session={session()} onClose={() => {}} />);
    act(() => { vi.advanceTimersByTime(STARTING_TIMEOUT_MS - 1); });
    expect(screen.queryByText(/taking longer than usual/)).toBeNull();
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.getByText('Your browser is taking longer than usual')).toBeInTheDocument();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })); });
    expect(embedBrowser).toHaveBeenCalledWith('t-abc');
    expect(screen.getByTitle('Shared browser')).toHaveAttribute('src', `${VIEW}2`);
    expect(screen.getByText('Starting your browser…')).toBeInTheDocument();
  });

  it('does not time out once the frame has loaded', () => {
    render(<BrowserPanel session={session()} onClose={() => {}} />);
    fireEvent.load(screen.getByTitle('Shared browser'));
    act(() => { vi.advanceTimersByTime(STARTING_TIMEOUT_MS * 2); });
    expect(screen.queryByText(/taking longer than usual/)).toBeNull();
  });

  it('shows the error, not the starting state, when the embed call fails', async () => {
    embedBrowser.mockRejectedValue(new Error('No capacity right now.'));
    render(<BrowserPanel session={session({ viewUrl: '' })} onClose={() => {}} />);
    await act(async () => {});
    expect(screen.getByText('No capacity right now.')).toBeInTheDocument();
    expect(screen.queryByText('Starting your browser…')).toBeNull();
  });
});
