import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 * `sendEvent` reaches the network through `https.get`, so the request options
 * are the only observable output. Mocked rather than stubbed at the socket
 * level: what matters is the host it targets and the headers it sets, both of
 * which are visible in the options object.
 */
const httpsGet = vi.fn();

vi.mock('https', () => {
  const get = (...args: unknown[]) => httpsGet(...args);
  return { get, default: { get } };
});

import { sendEvent } from './analytics';

type GetOptions = { hostname: string; path: string; headers?: Record<string, string> };

function lastOptions(): GetOptions {
  return httpsGet.mock.calls.at(-1)?.[0] as GetOptions;
}

function lastParams(): URLSearchParams {
  return new URL(`https://${lastOptions().hostname}${lastOptions().path}`).searchParams;
}

beforeEach(() => {
  httpsGet.mockReset();
  httpsGet.mockImplementation(() => ({
    on: () => undefined,
    destroy: () => undefined,
  }));
});

describe('sendEvent', () => {
  it('reports to a host we control rather than a raw API Gateway id', () => {
    // Regression guard: the previous endpoint was an
    // `*.execute-api.amazonaws.com` id in an AWS account nobody could deploy
    // to, so it could not be changed without shipping a new installer.
    sendEvent('ANTONAPP_TERMS_ACCEPTED');

    const options = lastOptions();
    expect(options.hostname).toBe('collect.mindshub.ai');
    expect(options.path.startsWith('/collect?')).toBe(true);
    expect(options.hostname).not.toContain('execute-api');
  });

  it('sends an identifying user agent', () => {
    // Cloudflare's bot rules answer script-shaped agents with 403 on this zone,
    // and this function discards its response, so a blocked event would leave
    // no trace anywhere.
    sendEvent('ANTONAPP_BYOK');

    const agent = lastOptions().headers?.['User-Agent'];
    expect(agent).toBe('cowork-analytics/1.0');
  });

  it('carries the action and merges extra properties', () => {
    sendEvent('ANTONAPP_INSTALLATION_SUCCESS', { step: 'verify', outcome: 'ok' });

    const params = lastParams();
    expect(params.get('action')).toBe('ANTONAPP_INSTALLATION_SUCCESS');
    expect(params.get('step')).toBe('verify');
    expect(params.get('outcome')).toBe('ok');
    expect(params.get('timestamp')).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it('never throws when the request cannot be made', () => {
    httpsGet.mockImplementation(() => {
      throw new Error('getaddrinfo ENOTFOUND');
    });

    expect(() => sendEvent('ANTONAPP_MINDSLLM')).not.toThrow();
  });
});
