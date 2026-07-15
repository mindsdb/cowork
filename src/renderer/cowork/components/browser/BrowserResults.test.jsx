import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const openExternal = vi.fn();
vi.mock('../../../platform/host', () => {
  const host = { openExternal: (...a) => openExternal(...a) };
  return { host, default: host };
});

import StepBrowserResults, {
  BROWSER_FAILURE_COPY,
  parseBrowserEnvelope,
  hasActiveBrowserAction,
  activeBrowserDomain,
} from './BrowserResults';

// Build a finished browser step with the given envelope object serialized into
// `output` (mirrors the WS3 shape that arrives over the wire).
function step(id, env, overrides = {}) {
  return { id, badge: 'Browser', output: JSON.stringify(env), ...overrides };
}

describe('parseBrowserEnvelope', () => {
  it('returns the envelope for a valid browser step', () => {
    const env = { status: 'ok', citations: [] };
    expect(parseBrowserEnvelope(step('a', env))).toEqual(env);
  });

  it('returns null for a non-browser step', () => {
    expect(parseBrowserEnvelope({ id: 'a', badge: 'Tool', output: '{"status":"ok"}' })).toBeNull();
  });

  it('returns null for truncated / non-JSON output', () => {
    expect(parseBrowserEnvelope({ id: 'a', badge: 'Browser', output: '{"status":"o' })).toBeNull();
  });

  it('returns null for empty or missing output', () => {
    expect(parseBrowserEnvelope({ id: 'a', badge: 'Browser', output: '' })).toBeNull();
    expect(parseBrowserEnvelope({ id: 'a', badge: 'Browser' })).toBeNull();
    expect(parseBrowserEnvelope(null)).toBeNull();
  });

  it('returns null when status is not a string', () => {
    expect(parseBrowserEnvelope(step('a', { citations: [] }))).toBeNull();
  });

  it('prefers the adapter-extracted browserEnvelope over (truncated) output', () => {
    // A large envelope truncated at 2048 chars in step.output would parse to
    // null — the compact envelope the stream adapter stored pre-truncation
    // must win so the terminal card survives.
    const compact = { status: 'ok', citations: [{ label: 'x', href: 'https://x.example/y' }] };
    const s = {
      id: 'a',
      badge: 'Browser',
      output: '{"status":"ok","observed":{"text":"trunca', // cut mid-JSON
      browserEnvelope: compact,
    };
    expect(parseBrowserEnvelope(s)).toEqual(compact);
  });

  it('falls back to parsing output when browserEnvelope is absent (replay)', () => {
    const env = { status: 'ok', citations: [] };
    expect(parseBrowserEnvelope(step('a', env))).toEqual(env);
  });
});

describe('hasActiveBrowserAction / activeBrowserDomain', () => {
  it('detects an in-progress browser step', () => {
    const steps = [
      { id: '1', badge: 'Browser', status: 'done' },
      { id: '2', badge: 'Browser', status: 'in_progress' },
    ];
    expect(hasActiveBrowserAction(steps)).toBe(true);
  });

  it('returns false when no browser step is in flight', () => {
    expect(hasActiveBrowserAction([{ id: '1', badge: 'Browser', status: 'done' }])).toBe(false);
    expect(hasActiveBrowserAction([])).toBe(false);
    expect(hasActiveBrowserAction()).toBe(false);
  });

  it('returns the most recent in-progress domain', () => {
    const steps = [
      { id: '1', badge: 'Browser', status: 'in_progress', data: { domain: 'old.com' } },
      { id: '2', badge: 'Browser', status: 'in_progress', data: { domain: 'new.com' } },
    ];
    expect(activeBrowserDomain(steps)).toBe('new.com');
  });

  it('returns null when there is no active domain', () => {
    expect(activeBrowserDomain([{ id: '1', badge: 'Browser', status: 'done' }])).toBeNull();
    expect(activeBrowserDomain([])).toBeNull();
  });
});

describe('StepBrowserResults', () => {
  beforeEach(() => {
    openExternal.mockReset();
  });

  it('renders nothing when there are no browser steps', () => {
    const { container } = render(<StepBrowserResults steps={[{ id: '1', badge: 'Tool' }]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders citations for an ok status and opens them externally', () => {
    const env = {
      status: 'ok',
      citations: [{ title: 'Docs', href: 'https://example.com/docs' }],
    };
    render(<StepBrowserResults steps={[step('a', env)]} />);
    const list = screen.getByRole('list', { name: 'Page references' });
    expect(list).toBeInTheDocument();
    const link = screen.getByText('Docs');
    fireEvent.click(link);
    expect(openExternal).toHaveBeenCalledWith('https://example.com/docs');
  });

  it('renders each failure-kind copy in a danger note', () => {
    Object.entries(BROWSER_FAILURE_COPY).forEach(([kind, copy], i) => {
      const { unmount } = render(<StepBrowserResults steps={[step(`k${i}`, { status: kind })]} />);
      expect(screen.getByText(copy)).toBeInTheDocument();
      unmount();
    });
  });

  it('renders a generic failure line for an unknown error status', () => {
    render(<StepBrowserResults steps={[step('a', { status: 'weird_kind' })]} />);
    expect(screen.getByText('The browser action could not be completed.')).toBeInTheDocument();
  });

  it('renders the stopped note', () => {
    render(<StepBrowserResults steps={[step('a', { status: 'stopped' })]} />);
    expect(screen.getByText(/You stopped the browser action/)).toBeInTheDocument();
  });

  it('renders the taken_over note', () => {
    render(<StepBrowserResults steps={[step('a', { status: 'taken_over' })]} />);
    expect(screen.getByText(/You took over the browser/)).toBeInTheDocument();
  });

  it('reads control_state=stopped separately from the status error kind', () => {
    // Server now carries the control terminal state on `control_state`, not by
    // collapsing it into a permission_denied error. The stopped note wins over
    // the generic failure line for that error kind.
    render(
      <StepBrowserResults
        steps={[step('a', { status: 'permission_denied', control_state: 'stopped' })]}
      />,
    );
    expect(screen.getByText(/You stopped the browser action/)).toBeInTheDocument();
    expect(
      screen.queryByText(BROWSER_FAILURE_COPY.permission_denied),
    ).not.toBeInTheDocument();
  });

  it('reads control_state=taken_over separately from the status error kind', () => {
    render(
      <StepBrowserResults
        steps={[step('a', { status: 'permission_denied', control_state: 'taken_over' })]}
      />,
    );
    expect(screen.getByText(/You took over the browser/)).toBeInTheDocument();
    expect(
      screen.queryByText(BROWSER_FAILURE_COPY.permission_denied),
    ).not.toBeInTheDocument();
  });

  it('renders nothing for an ok status with no citations', () => {
    const { container } = render(<StepBrowserResults steps={[step('a', { status: 'ok' })]} />);
    expect(container.firstChild).toBeNull();
  });
});
