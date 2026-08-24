import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({ app: { isPackaged: false } }));

import {
  validateAnthropic,
  validateMinds,
  validateOpenAICompatible,
  type HttpRequestOptions,
} from './provider-validation';

/*
 * These assert what goes on the wire, which is the whole defect: MindsHub bills
 * per model, so probing a model the wallet has to pay for is denied for an
 * account with no balance, and the denial is indistinguishable from a bad key.
 * A packaged desktop build runs THIS copy of the validators, not the sidecar's,
 * so without these the desktop half of the fix was covered by nothing.
 */
function recorder(status = 200, body = '{}') {
  const calls: Array<{ url: string; payload: any }> = [];
  const request = async (url: string, options: HttpRequestOptions) => {
    calls.push({ url, payload: options.body ? JSON.parse(options.body) : undefined });
    return { status, body };
  };
  return { calls, request };
}

describe('validateMinds', () => {
  it('probes the model the included allowance covers, never a wallet-billed one', async () => {
    const { calls, request } = recorder();
    const result = await validateMinds('mdb_x', 'https://api.mindshub.ai', request);
    expect(result).toEqual({ ok: true });
    expect(calls[0].payload.model).toBe('mindshub_air');
  });

  it('derives the chat path per host, matching the sidecar', async () => {
    const { calls, request } = recorder();
    await validateMinds('mdb_x', 'https://api.mindshub.ai', request);
    await validateMinds('mdb_x', 'https://mdb.ai', request);
    await validateMinds('mdb_x', 'https://api.mindshub.ai/v1', request);
    expect(calls.map((c) => c.url)).toEqual([
      'https://api.mindshub.ai/v1/chat/completions',
      'https://mdb.ai/api/v1/chat/completions',
      'https://api.mindshub.ai/v1/chat/completions',
    ]);
  });

  it('reports a rejected key as a bad key, not as an opaque status', async () => {
    const { request } = recorder(401, '{}');
    expect(await validateMinds('mdb_bad', 'https://api.mindshub.ai', request)).toEqual({
      ok: false,
      error: 'Invalid API key',
    });
  });

  it('surfaces the gateway message on any other refusal', async () => {
    // A drained wallet still fails, and the operator-readable reason is the
    // gateway's, not "HTTP 402".
    const { request } = recorder(402, '{"error":{"message":"Wallet balance is empty."}}');
    expect(await validateMinds('mdb_x', 'https://api.mindshub.ai', request)).toEqual({
      ok: false,
      error: 'Wallet balance is empty.',
    });
  });

  it('reports an unreachable host rather than throwing', async () => {
    const request = async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    };
    const result = await validateMinds('mdb_x', 'https://api.mindshub.ai', request);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Cannot connect');
  });
});

describe('validateOpenAICompatible', () => {
  it('falls back to the free MindsHub model on a MindsHub host', async () => {
    const { calls, request } = recorder();
    await validateOpenAICompatible('mdb_x', 'https://api.mindshub.ai/v1', undefined, request);
    expect(calls[0].payload.model).toBe('mindshub_air');
  });

  it('keeps the generic default off a MindsHub host', async () => {
    const { calls, request } = recorder();
    await validateOpenAICompatible('sk_x', 'https://api.openai.com/v1', undefined, request);
    expect(calls[0].payload.model).toBe('gpt-5.5');
  });

  it('sends an explicit model as asked, MindsHub host or not', async () => {
    // The negative case: validating one model must never report a pass earned
    // by a different one.
    const { calls, request } = recorder();
    await validateOpenAICompatible('mdb_x', 'https://api.mindshub.ai/v1', 'sonnet', request);
    await validateOpenAICompatible('sk_x', 'https://api.openai.com/v1', 'gpt-4.1', request);
    expect(calls.map((c) => c.payload.model)).toEqual(['sonnet', 'gpt-4.1']);
  });

  it('appends /v1 only when the base carries no version segment', async () => {
    const { calls, request } = recorder();
    await validateOpenAICompatible('k', 'http://localhost:11434', 'llama', request);
    await validateOpenAICompatible('k', 'https://generativelanguage.googleapis.com/v1beta/openai', 'gemini-3.6-flash', request);
    expect(calls.map((c) => c.url)).toEqual([
      'http://localhost:11434/v1/chat/completions',
      'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    ]);
  });
});

describe('validateAnthropic', () => {
  it('sends the model the caller asked for to the messages endpoint', async () => {
    const { calls, request } = recorder();
    await validateAnthropic('sk-ant-x', 'claude-sonnet-4-6', request);
    expect(calls[0].url).toBe('https://api.anthropic.com/v1/messages');
    expect(calls[0].payload.model).toBe('claude-sonnet-4-6');
  });
});
