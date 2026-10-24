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

  it('redacts a secret whose name carries a prefix, which is how env vars read', () => {
    // These are real names: credential-provisioning.ts spreads them into the
    // sidecar's environment, so anything echoing its config lands in the tail.
    const out = scrubLog([
      'GITHUB_CLIENT_SECRET=1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b',
      'GOOGLE_PICKER_API_KEY=AIzaSyD-1234567890abcdefghij',
      'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCY',
      'COWORK_AUTH_TOKEN=abcdef0123456789',
    ].join('\n'));
    expect(out).not.toMatch(/1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b/);
    expect(out).not.toMatch(/AIzaSyD-1234567890abcdefghij/);
    expect(out).not.toMatch(/wJalrXUtnFEMI/);
    expect(out).not.toMatch(/abcdef0123456789/);
    // The name survives, so the line still says what was present.
    expect(out).toMatch(/GITHUB_CLIENT_SECRET=\[redacted\]/);
  });

  it('redacts single-quoted values, which is how Python renders a dict', () => {
    const out = scrubLog("password='hunter2' {'api_key': 'AIzaSyD-1234567890abcdefghij'}");
    expect(out).not.toMatch(/hunter2/);
    expect(out).not.toMatch(/AIzaSyD-1234567890abcdefghij/);
  });

  it('redacts a DSN password when the username is empty', () => {
    const out = scrubLog('redis://:justapassword@localhost:6379/0');
    expect(out).not.toMatch(/justapassword/);
    expect(out).toMatch(/localhost:6379/);
  });

  it('redacts the credential in an Authorization header, not the scheme word', () => {
    // Stamping [redacted] on the scheme and leaving the credential is worse
    // than doing nothing: the line reads as handled.
    for (const line of [
      'Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b',
      'Authorization: Basic dXNlcjpodW50ZXIyc2VjcmV0',
      'authorization: bearer abcdef0123456789abcdef',
    ]) {
      const out = scrubLog(line);
      expect(out).not.toMatch(/9944b09199c62bcf|dXNlcjpodW50ZXIyc2VjcmV0|abcdef0123456789/);
      expect(out).toMatch(/^[Aa]uthorization: /);
    }
  });

  it('redacts a quoted value that contains spaces', () => {
    expect(scrubLog('password="hunter two three"')).not.toMatch(/hunter two three/);
    expect(scrubLog("password='hunter two three'")).not.toMatch(/hunter two three/);
    expect(scrubLog('{"api_key": "AIza abc def"}')).not.toMatch(/AIza abc def/);
  });

  it('leaves the identifiers a diagnostics log exists to carry', () => {
    // The reason to keep the whole tail is that these lines explain failures.
    // Blanking every *_key would take the explanation with the secret.
    for (const line of [
      'POST /api/v1/messages idempotency_key=9f86d081 202 in 31ms',
      'index scan on sort_key=ts partition_key=org rows=412',
      'IntegrityError: FOREIGN KEY constraint failed; foreign_key=tasks.id',
      'Column(id, String(), primary_key=True, nullable=False)',
    ]) {
      expect(scrubLog(line)).toBe(line);
    }
  });

  it('still redacts the secret-bearing *_key names', () => {
    const out = scrubLog([
      'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI',
      'privateKey=MIIEvQIBADANBgkqhkiG9w0B',
      'signingKey=s3cr3tsigningmaterial',
    ].join('\n'));
    expect(out).not.toMatch(/wJalrXUtnFEMI|MIIEvQIBADAN|s3cr3tsigningmaterial/);
  });

  it('never reaches across a line break for its value', () => {
    const out = scrubLog('ERROR missing password:\nINFO listening on 127.0.0.1:26866');
    expect(out).toContain('INFO listening on 127.0.0.1:26866');
    expect(scrubLog('GET /api/v1/secret: 200 OK in 13ms')).toContain('200 OK');
  });

  it('does not redact a counter that merely contains a secret word', () => {
    const line = 'token_count=512 and auth_mode=local';
    expect(scrubLog(line)).toBe(line);
  });

  it('keeps ordinary log lines intact', () => {
    const line = '[responses] direct turn failed for conversation 8f2c correlation_id=direct-abc';
    expect(scrubLog(line)).toBe(line);
  });

  it('redacts without truncating — the panels render the whole tail', () => {
    const many = Array.from({ length: LOG_TAIL_LINES + 40 }, (_, i) => `line ${i}`).join('\n');
    expect(scrubLog(many).split('\n')).toHaveLength(LOG_TAIL_LINES + 40);
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

  it('caps the log it embeds so a paste cannot run away', () => {
    const many = Array.from({ length: LOG_TAIL_LINES + 40 }, (_, i) => `line ${i}`).join('\n');
    const out = diagnosticsText({ rows, requestId: 'r', code: 'anton_error', log: many });
    expect(out).toContain(`line ${LOG_TAIL_LINES + 39}`);
    expect(out).not.toContain('line 0\n');
  });

  it('prints a dash rather than the word null when the failure carries no code', () => {
    const out = diagnosticsText({ rows, requestId: 'r', code: null, log: '' });
    expect(out).toContain('Error code: —');
    expect(out).not.toMatch(/null|undefined/);
  });

  it('omits the log section entirely when there is no log', () => {
    const out = diagnosticsText({ rows, requestId: 'r', code: 'anton_error', log: '' });
    expect(out).not.toMatch(/Recent server log/);
  });
});
