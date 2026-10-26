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

  it('redacts the credential in a quoted Authorization header, as a dict of headers prints it', () => {
    for (const line of [
      "{'Authorization': 'Basic dXNlcjpodW50ZXIyc2VjcmV0'}",
      '{"Authorization": "Basic dXNlcjpodW50ZXIyc2VjcmV0", "Accept": "*/*"}',
    ]) {
      const out = scrubLog(line);
      expect(out).not.toMatch(/dXNlcjpodW50ZXIyc2VjcmV0/);
      expect(out).toMatch(/Authorization["']: ["']Basic \[redacted\]["']/);
    }
  });

  it('redacts a quoted value that contains spaces', () => {
    expect(scrubLog('password="hunter two three"')).not.toMatch(/hunter two three/);
    expect(scrubLog("password='hunter two three'")).not.toMatch(/hunter two three/);
    expect(scrubLog('{"api_key": "AIza abc def"}')).not.toMatch(/AIza abc def/);
  });

  it('redacts a quoted value through the other quote and escaped quotes', () => {
    expect(scrubLog(`password="it's a secret"`)).toBe('password="[redacted]"');
    expect(scrubLog('{"password":"abc\\"SUPERSECRET"}')).toBe('{"password":"[redacted]"}');
    expect(scrubLog("{'password': 'it\\'s hidden'}")).toBe("{'password': '[redacted]'}");
  });

  it('redacts secrets in JSON that is itself stored as a JSON string', () => {
    expect(scrubLog('{"body": "{\\"password\\": \\"hunter2\\"}"}'))
      .toBe('{"body": "{\\"password\\": \\"[redacted]\\"}"}');
    expect(scrubLog('{"headers": "{\\"Authorization\\": \\"Basic dXNlcjpodW50ZXIy\\"}"}'))
      .toBe('{"headers": "{\\"Authorization\\": \\"Basic [redacted]\\"}"}');
  });

  it('keeps a known scheme word and redacts everything after it', () => {
    expect(scrubLog('Authorization: ApiKey hunter2secret')).toBe('Authorization: ApiKey [redacted]');
    expect(scrubLog('{"Authorization": "SSWS hunter2secret", "Accept": "*/*"}'))
      .toBe('{"Authorization": "SSWS [redacted]", "Accept": "*/*"}');
    expect(scrubLog('Authorization: Digest username="bob", response="6629fae4"'))
      .toBe('Authorization: Digest [redacted]');
  });

  it('redacts the whole value when its first word is not a known scheme', () => {
    expect(scrubLog('Authorization: sk_live_abc123 trailing')).toBe('Authorization: [redacted]');
    // A letters-only token followed by text must not pass for a scheme.
    expect(scrubLog('Authorization: abcdefghijklmnop more words')).toBe('Authorization: [redacted]');
    expect(scrubLog('Authorization:\nnext line stays')).toBe('Authorization:\nnext line stays');
  });

  it('reads a quoted Authorization value through an escaped quote', () => {
    expect(scrubLog("'authorization': 'Bearer abc\\'def123456'")).toBe("'authorization': 'Bearer [redacted]'");
  });

  it('redacts a quoted value whose closing quote never arrives, to the end of its line only', () => {
    expect(scrubLog('password="abc def ghi\nnext line')).toBe('password="[redacted]\nnext line');
    expect(scrubLog("{'password': 'cut off mid val")).toBe("{'password': '[redacted]");
    expect(scrubLog('token="ends in backslash\\')).toBe('token="[redacted]');
    expect(scrubLog('password="a" token="b" x=1')).toBe('password="[redacted]" token="[redacted]" x=1');
  });

  it('redacts a Google API key that appears on its own', () => {
    const key = 'AIzaSyA1234567890abcdefghijklmnopqrstuv';
    expect(scrubLog(`ValueError: invalid key ${key} rejected`)).toBe(
      'ValueError: invalid key [redacted] rejected',
    );
    expect(scrubLog(`x_${key}`)).toBe('x_[redacted]');
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

  it('explains a dashed backend version without claiming the server was down', () => {
    // One version missing from a /health that answered is the case that must
    // not read as an outage.
    const partial = [['App shell', '1.2.3'], ['UI', '1.2.3 (bundled)'], ['Server', '1.0'], ['Agent', '—']];
    const out = diagnosticsText({ rows: partial, requestId: 'r', code: 'anton_error', log: '' });
    expect(out).toContain('Note: — means the server did not report that version.');
    expect(out).not.toMatch(/unreachable/i);
  });

  it('adds no note when every backend version is known', () => {
    const known = [['App shell', '1.2.3'], ['UI', '1.2.3 (bundled)'], ['Server', '1.0'], ['Agent', '2.0']];
    expect(diagnosticsText({ rows: known, requestId: 'r', code: 'anton_error', log: '' })).not.toMatch(/Note:/);
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
