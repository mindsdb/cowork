import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const serverDiagnostics = vi.fn();
const getVersionInfo = vi.fn();
vi.mock('../../platform/host', () => ({
  host: { serverDiagnostics: (...a) => serverDiagnostics(...a) },
  getVersionInfo: (...a) => getVersionInfo(...a),
}));
const copyText = vi.fn();
vi.mock('../lib/clipboard', () => ({ copyText: (...a) => copyText(...a) }));

import CopyDiagnosticsButton from './CopyDiagnosticsButton';

beforeEach(() => {
  vi.clearAllMocks();
  getVersionInfo.mockResolvedValue({ app: '1.2.3', ui: null, source: 'bundled', buildKind: null });
  serverDiagnostics.mockResolvedValue({ recentLog: 'boom happened' });
  copyText.mockResolvedValue(true);
});

const health = { server_version: '4.5.6', anton_version: '7.8.9' };

describe('CopyDiagnosticsButton', () => {
  it('copies the versions, the reference, the code and the log', async () => {
    render(<CopyDiagnosticsButton requestId="direct-abc" code="anton_error" health={health} />);
    await userEvent.click(screen.getByRole('button', { name: 'Copy diagnostics' }));

    const text = copyText.mock.calls[0][0];
    expect(text).toContain('App shell: 1.2.3');
    expect(text).toContain('Server: 4.5.6');
    expect(text).toContain('Agent: 7.8.9');
    expect(text).toContain('Reference: direct-abc');
    expect(text).toContain('Error code: anton_error');
    expect(text).toContain('boom happened');
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy();
  });

  it('scrubs a secret out of the log before it reaches the clipboard', async () => {
    serverDiagnostics.mockResolvedValue({ recentLog: 'api_key=sk-proj-1234567890abcdef' });
    render(<CopyDiagnosticsButton requestId="r" code="anton_error" health={health} />);
    await userEvent.click(screen.getByRole('button', { name: 'Copy diagnostics' }));

    expect(copyText.mock.calls[0][0]).not.toMatch(/sk-proj-1234567890abcdef/);
  });

  it('still copies what it has when the diagnostics call rejects', async () => {
    serverDiagnostics.mockRejectedValue(new Error('bridge gone'));
    render(<CopyDiagnosticsButton requestId="r" code="anton_error" health={undefined} />);
    await userEvent.click(screen.getByRole('button', { name: 'Copy diagnostics' }));

    const text = copyText.mock.calls[0][0];
    expect(text).toContain('Reference: r');
    expect(text).toMatch(/server was unreachable/i);
  });

  it('omits the log section in web mode, where the stub answers with none', async () => {
    // platform/host.ts resolves a web shape rather than rejecting, so this is
    // the path a browser user actually takes.
    serverDiagnostics.mockResolvedValue({ running: true, recentLog: '' });
    render(<CopyDiagnosticsButton requestId="r" code="anton_error" health={health} />);
    await userEvent.click(screen.getByRole('button', { name: 'Copy diagnostics' }));

    const text = copyText.mock.calls[0][0];
    expect(text).toContain('Reference: r');
    expect(text).toContain('Server: 4.5.6');
    expect(text).not.toContain('Recent server log:');
  });

  it('gathers once for a double click', async () => {
    let release;
    serverDiagnostics.mockReturnValue(new Promise((r) => { release = () => r({ recentLog: 'x' }); }));
    render(<CopyDiagnosticsButton requestId="r" code="anton_error" health={health} />);
    const button = screen.getByRole('button', { name: 'Copy diagnostics' });

    await userEvent.click(button);
    await userEvent.click(button);
    release();

    await screen.findByRole('button', { name: 'Copied' });
    expect(copyText).toHaveBeenCalledTimes(1);
  });

  it('settles back to the idle label rather than sitting on Copied', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<CopyDiagnosticsButton requestId="r" code="anton_error" health={health} />);
      await userEvent.click(screen.getByRole('button', { name: 'Copy diagnostics' }));
      await screen.findByRole('button', { name: 'Copied' });

      await act(async () => { vi.advanceTimersByTime(1600); });
      expect(screen.getByRole('button', { name: 'Copy diagnostics' })).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('says so when the clipboard write fails rather than looking inert', async () => {
    copyText.mockResolvedValue(false);
    render(<CopyDiagnosticsButton requestId="r" code="anton_error" health={health} />);
    await userEvent.click(screen.getByRole('button', { name: 'Copy diagnostics' }));

    expect(await screen.findByRole('button', { name: "Couldn't copy" })).toBeTruthy();
  });
});
