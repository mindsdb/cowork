import { describe, it, expect } from 'vitest';
import { scrubLog, diagnosticsText, LOG_TAIL_LINES } from './diagnostics';

describe('scrubLog', () => {
  it('redacts bearer tokens, api keys and key=value secrets', () => {
    const out = scrubLog([
      'Authorization: Bearer sk-ant-api03-AAAABBBBCCCCDDDD',
      'using api_key=sk-proj-1234567890abcdef',
      'password=hunter2 for the pool',
      'token: ghp_AAAABBBBCCCCDDDDEEEEFFFF0000',
    ].join('\n'));
    expect(out).not.toMatch(/sk-ant-api03-AAAABBBBCCCCDDDD/);
    expect(out).not.toMatch(/sk-proj-1234567890abcdef/);
    expect(out).not.toMatch(/hunter2/);
    expect(out).not.toMatch(/ghp_AAAABBBBCCCCDDDDEEEEFFFF0000/);
    expect(out).toMatch(/\[redacted\]/);
  });

  it('redacts credentials inside a DSN but keeps the host readable', () => {
    const out = scrubLog('connecting to postgres://demo_user:s3cret@samples.mindsdb.com:5432/demo');
    expect(out).not.toMatch(/s3cret/);
    expect(out).toMatch(/samples\.mindsdb\.com:5432/);
  });

  it('keeps ordinary log lines intact', () => {
    const line = '[responses] direct turn failed for conversation 8f2c correlation_id=direct-abc';
    expect(scrubLog(line)).toBe(line);
  });

  it('keeps only the tail, so a 32KB buffer cannot paste unbounded', () => {
    const many = Array.from({ length: LOG_TAIL_LINES + 40 }, (_, i) => `line ${i}`).join('\n');
    const out = scrubLog(many);
    expect(out.split('\n')).toHaveLength(LOG_TAIL_LINES);
    expect(out).toContain(`line ${LOG_TAIL_LINES + 39}`);
    expect(out).not.toContain('line 0\n');
  });

  it('survives an absent or empty log', () => {
    expect(scrubLog(undefined)).toBe('');
    expect(scrubLog('')).toBe('');
  });
});

describe('diagnosticsText', () => {
  const rows = [['App shell', '1.2.3'], ['UI', '1.2.3 (bundled)'], ['Server', '4.5.6'], ['Agent', '7.8.9']];

  it('carries the versions, the reference and the code', () => {
    const out = diagnosticsText({
      rows, requestId: 'direct-abc', code: 'anton_error', log: 'boom',
    });
    expect(out).toContain('App shell: 1.2.3');
    expect(out).toContain('Server: 4.5.6');
    expect(out).toContain('Reference: direct-abc');
    expect(out).toContain('Error code: anton_error');
    expect(out).toContain('boom');
  });

  it('scrubs the log it embeds', () => {
    const out = diagnosticsText({
      rows, requestId: 'r', code: 'anton_error', log: 'api_key=sk-proj-1234567890abcdef',
    });
    expect(out).not.toMatch(/sk-proj-1234567890abcdef/);
  });

  it('says the server was unreachable rather than pasting a bare dash', () => {
    const offline = [['App shell', '1.2.3'], ['UI', '1.2.3 (bundled)'], ['Server', '—'], ['Agent', '—']];
    const out = diagnosticsText({ rows: offline, requestId: 'r', code: 'anton_error', log: '' });
    expect(out).toMatch(/server was unreachable/i);
  });

  it('omits the log section entirely when there is no log', () => {
    const out = diagnosticsText({ rows, requestId: 'r', code: 'anton_error', log: '' });
    expect(out).not.toMatch(/Recent server log/);
  });
});
