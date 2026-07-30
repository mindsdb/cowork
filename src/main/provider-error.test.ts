import { describe, it, expect } from 'vitest';
import { extractProviderError, classifyOpenAICompatibleResult } from './provider-error';

describe('extractProviderError', () => {
  it('reads a message from a bare object body', () => {
    expect(extractProviderError('{"error":{"message":"models/foo is not found."}}')).toBe(
      'models/foo is not found.',
    );
  });

  it("reads a message from Gemini's array-wrapped body (ENG-1145)", () => {
    expect(
      extractProviderError('[{"error":{"message":"no longer available to new users"}}]'),
    ).toBe('no longer available to new users');
  });

  it('falls back to a bare message field', () => {
    expect(extractProviderError('{"message":"bad"}')).toBe('bad');
  });

  it('returns null for non-JSON, empty array, or missing message', () => {
    expect(extractProviderError('<html>404 Not Found</html>')).toBeNull();
    expect(extractProviderError('[]')).toBeNull();
    expect(extractProviderError('{"error":{}}')).toBeNull();
  });
});

describe('classifyOpenAICompatibleResult', () => {
  it('is ok on 200/201', () => {
    expect(classifyOpenAICompatibleResult(200, '{}')).toEqual({ ok: true });
    expect(classifyOpenAICompatibleResult(201, '')).toEqual({ ok: true });
  });

  it("surfaces Gemini's array-shaped 404 message rather than a bare status", () => {
    const body =
      '[{"error":{"message":"This model models/gemini-2.5-flash is no longer available to new users."}}]';
    const r = classifyOpenAICompatibleResult(404, body);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('no longer available to new users');
  });

  it('maps a bad-key 400 to Invalid API key (Gemini returns 400, not 401)', () => {
    const body = '[{"error":{"message":"Please pass a valid API key"}}]';
    expect(classifyOpenAICompatibleResult(400, body)).toEqual({ ok: false, error: 'Invalid API key' });
  });

  it("catches Google's full bad-key string", () => {
    const body = '[{"error":{"message":"API key not valid. Please pass a valid API key."}}]';
    expect(classifyOpenAICompatibleResult(400, body)).toEqual({ ok: false, error: 'Invalid API key' });
  });

  it('does NOT call a permission 400 a bad key — surfaces it verbatim (ENG-1145 review)', () => {
    // Contains "API key" but the key is fine; a new key won't help.
    const body = '[{"error":{"message":"The API key does not have permission to use this model."}}]';
    const r = classifyOpenAICompatibleResult(400, body);
    expect(r.ok).toBe(false);
    expect(r.error).not.toBe('Invalid API key');
    expect(r.error).toContain('does not have permission');
  });

  it('does NOT call a quota 400 a bad key — surfaces it verbatim (ENG-1145 review)', () => {
    const body = '[{"error":{"message":"Quota exceeded for this API key. Upgrade your plan."}}]';
    const r = classifyOpenAICompatibleResult(400, body);
    expect(r.ok).toBe(false);
    expect(r.error).not.toBe('Invalid API key');
    expect(r.error).toContain('Quota exceeded');
  });

  it('maps 401/403 to Invalid API key', () => {
    expect(classifyOpenAICompatibleResult(401, '{}')).toEqual({ ok: false, error: 'Invalid API key' });
    expect(classifyOpenAICompatibleResult(403, '{}')).toEqual({ ok: false, error: 'Invalid API key' });
  });

  it('falls back to the HTTP status when no message is parseable', () => {
    expect(classifyOpenAICompatibleResult(500, '<html>')).toEqual({ ok: false, error: 'HTTP 500' });
  });
});
