import { afterEach, describe, expect, it } from 'vitest';
import { withAcceptLanguage } from './api';
import { changeLocale } from '../lib/i18n';

/* ENG-4149: every server request names the UI language, so cowork-server can
   tell Anton which language to fall back to. */
afterEach(async () => { await changeLocale('en'); });

describe('withAcceptLanguage', () => {
  it('adds the UI language to a request with no headers', () => {
    expect(withAcceptLanguage({})).toEqual({ headers: { 'Accept-Language': 'en' } });
  });

  it('follows a live language switch', async () => {
    await changeLocale('pt-BR');
    expect(withAcceptLanguage({ method: 'POST', headers: { 'Content-Type': 'application/json' } })).toEqual({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept-Language': 'pt-BR' },
    });
  });

  it('sends en for the pseudo-locale', async () => {
    await changeLocale('en-XA');
    expect(withAcceptLanguage({}).headers['Accept-Language']).toBe('en');
  });

  it("keeps a caller's own Accept-Language, whatever its case", async () => {
    await changeLocale('es');
    const options = { headers: { 'accept-language': 'en' } };
    expect(withAcceptLanguage(options)).toBe(options);
  });

  it('works with a Headers instance', async () => {
    await changeLocale('es');
    const { headers } = withAcceptLanguage({ headers: new Headers({ Accept: 'text/event-stream' }) });
    expect(headers.get('Accept-Language')).toBe('es');
    expect(headers.get('Accept')).toBe('text/event-stream');
  });
});
