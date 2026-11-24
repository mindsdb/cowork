import { describe, it, expect } from 'vitest';
import { UPLOAD_TOO_LARGE_MESSAGE, readRefusalBody, readRetryAfter, refusalMessage } from './httpRefusal';

const BUSY = 'Cowork is busy. Try again in about 5 seconds.';
const json = (body) => JSON.stringify(body);

describe('readRefusalBody', () => {
  it('reads a string detail and the code beside it', () => {
    expect(readRefusalBody(json({ detail: BUSY, code: 'server_busy' })))
      .toEqual({ message: BUSY, code: 'server_busy' });
  });

  it("reads an object detail's message and code instead of showing [object Object]", () => {
    /* cowork-server's permission refusals put both inside detail. */
    const body = { detail: { code: 'permission_denied', message: 'Your current role does not allow this action.' } };
    expect(readRefusalBody(json(body))).toEqual({
      message: 'Your current role does not allow this action.',
      code: 'permission_denied',
    });
  });

  it("joins FastAPI's validation list the way req() does", () => {
    const body = { detail: [{ msg: 'Field required' }, { loc: ['body', 'input'] }] };
    expect(readRefusalBody(json(body)).message)
      .toBe('Field required, {"loc":["body","input"]}');
  });

  it('reads RFC 9457 problem details: detail first, then title', () => {
    const problem = { type: 'about:blank', title: 'Service Unavailable', status: 503 };
    expect(readRefusalBody(json({ ...problem, detail: BUSY })).message).toBe(BUSY);
    expect(readRefusalBody(json(problem)).message).toBe('Service Unavailable');
  });

  it('falls back to a top-level message, then an OpenAI-style error.message', () => {
    expect(readRefusalBody(json({ message: 'Slow down' })).message).toBe('Slow down');
    expect(readRefusalBody(json({ error: { message: 'Rate limit exceeded', type: 'requests' } })).message)
      .toBe('Rate limit exceeded');
  });

  it('shows a plain-text body as it is', () => {
    expect(readRefusalBody('Internal Server Error\n')).toEqual({ message: 'Internal Server Error', code: null });
  });

  it('names nothing for markup or a JSON body without a sentence, so refusalMessage picks what shows', () => {
    expect(readRefusalBody('<html><body><h1>502 Bad Gateway</h1></body></html>').message).toBe('');
    expect(readRefusalBody(json({ status: 'error' }))).toEqual({ message: '', code: null });
    expect(readRefusalBody(json(['a', 'b'])).message).toBe('');
    expect(readRefusalBody('').message).toBe('');
  });
});

describe('refusalMessage', () => {
  const TOO_LARGE = 'This upload is over the size limit. Pick a smaller file, or fewer files at once.';
  const FALLBACK = 'Upload failed (413)';

  it('says the upload is over the size limit for a 413 that names no sentence', () => {
    expect(UPLOAD_TOO_LARGE_MESSAGE).toBe(TOO_LARGE);
    const edgePage = '<html><head><title>413 Payload Too Large</title></head><body><center>cloudflare</center></body></html>';
    const { message } = readRefusalBody(edgePage);

    expect(refusalMessage({ status: 413, message, fallback: FALLBACK })).toBe(TOO_LARGE);
    expect(refusalMessage({ status: 413, message: '', fallback: FALLBACK })).toBe(TOO_LARGE);
  });

  it("shows a 413's own sentence over the size sentence", () => {
    const sentence = 'This upload is larger than the 500 MB limit.';
    const { message } = readRefusalBody(json({ detail: sentence }));

    expect(refusalMessage({ status: 413, message, fallback: FALLBACK })).toBe(sentence);
  });

  it("keeps the caller's fallback for any other status that names no sentence", () => {
    for (const status of [400, 403, 500, 502, 503]) {
      expect(refusalMessage({ status, message: '', fallback: `Upload failed (${status})` })).toBe(`Upload failed (${status})`);
    }
  });
});

describe('readRetryAfter', () => {
  const NOW = Date.parse('2026-10-06T12:00:00.000Z');

  it('reads delay-seconds as the wait and the instant it ends', () => {
    expect(readRetryAfter('5', NOW)).toEqual({ retry_after: 5, retry_at: '2026-10-06T12:00:05.000Z' });
    expect(readRetryAfter(' 0 ', NOW)).toEqual({ retry_after: 0, retry_at: '2026-10-06T12:00:00.000Z' });
  });

  it('reads an HTTP-date as the instant itself and the seconds left', () => {
    expect(readRetryAfter('Tue, 06 Oct 2026 12:00:07 GMT', NOW))
      .toEqual({ retry_after: 7, retry_at: '2026-10-06T12:00:07.000Z' });
  });

  it("reads the obsolete RFC 850 and asctime forms as GMT, whatever the viewer's time zone", () => {
    /* asctime names no zone, and Date.parse alone reads it in local time:
       7 h late in Los Angeles, 9 h early (so no wait at all) in Tokyo. */
    const wait = { retry_after: 7, retry_at: '2026-10-06T12:00:07.000Z' };
    const savedTz = process.env.TZ;
    try {
      for (const tz of ['America/Los_Angeles', 'Asia/Tokyo']) {
        process.env.TZ = tz;
        expect(readRetryAfter('Tue Oct  6 12:00:07 2026', NOW)).toEqual(wait);
        expect(readRetryAfter('Tuesday, 06-Oct-26 12:00:07 GMT', NOW)).toEqual(wait);
      }
    } finally {
      process.env.TZ = savedTz;
    }
  });

  it('waits no time for a date already past', () => {
    expect(readRetryAfter('Tue, 06 Oct 2026 11:59:00 GMT', NOW))
      .toEqual({ retry_after: 0, retry_at: '2026-10-06T11:59:00.000Z' });
  });

  it('gives no hint for a missing or unreadable header', () => {
    const none = { retry_after: null, retry_at: null };
    expect(readRetryAfter(null, NOW)).toEqual(none);
    expect(readRetryAfter(undefined, NOW)).toEqual(none);
    expect(readRetryAfter('', NOW)).toEqual(none);
    expect(readRetryAfter('soon', NOW)).toEqual(none);
    /* Date.parse reads this as the year 3000, which would hold Retry at the
       card's 10-minute cap. */
    expect(readRetryAfter('soon 3000', NOW)).toEqual(none);
    /* Date.parse reads both of these as a day in 2001. */
    expect(readRetryAfter('-1', NOW)).toEqual(none);
    expect(readRetryAfter('1.5', NOW)).toEqual(none);
    /* Past the largest instant a Date can hold. */
    expect(readRetryAfter('99999999999999999', NOW)).toEqual(none);
  });

  it('ends the wait as an offset-bearing instant, the only form the Retry gate accepts', () => {
    expect(readRetryAfter('5', NOW).retry_at).toMatch(/(?:Z|[+-]\d{2}:?\d{2})$/);
  });
});
