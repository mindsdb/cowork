import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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

  it('still copies what it has when diagnostics are unavailable', async () => {
    // Web mode, or a sidecar that died: the bridge call rejects.
    serverDiagnostics.mockRejectedValue(new Error('unsupported'));
    render(<CopyDiagnosticsButton requestId="r" code="anton_error" health={undefined} />);
    await userEvent.click(screen.getByRole('button', { name: 'Copy diagnostics' }));

    const text = copyText.mock.calls[0][0];
    expect(text).toContain('Reference: r');
    expect(text).toMatch(/server was unreachable/i);
  });

  it('says so when the clipboard write fails rather than looking inert', async () => {
    copyText.mockResolvedValue(false);
    render(<CopyDiagnosticsButton requestId="r" code="anton_error" health={health} />);
    await userEvent.click(screen.getByRole('button', { name: 'Copy diagnostics' }));

    expect(await screen.findByRole('button', { name: "Couldn't copy" })).toBeTruthy();
  });
});
