import { afterEach, describe, expect, it, vi } from 'vitest';
import { withUiLocale } from './api';
import { changeLocale } from '../lib/i18n';

/* ENG-4149: while the language picker is on, every server request names the
   UI language in the app's own header, so cowork-server can tell Anton which
   language to fall back to. Never Accept-Language: browsers send that on
   their own from the OS language. */
afterEach(async () => {
  vi.unstubAllEnvs();
  window.localStorage.clear();
  await changeLocale('en');
});

describe('withUiLocale', () => {
  it('adds the UI language to a request with no headers', () => {
    expect(withUiLocale({})).toEqual({ headers: { 'X-Cowork-UI-Locale': 'en' } });
  });

  it('follows a live language switch', async () => {
    await changeLocale('pt-BR');
    expect(withUiLocale({ method: 'POST', headers: { 'Content-Type': 'application/json' } })).toEqual({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Cowork-UI-Locale': 'pt-BR' },
    });
  });

  it('sends en for the pseudo-locale', async () => {
    await changeLocale('en-XA');
    expect(withUiLocale({}).headers['X-Cowork-UI-Locale']).toBe('en');
  });

  it("keeps a caller's own header, whatever its case", async () => {
    await changeLocale('es');
    const options = { headers: { 'x-cowork-ui-locale': 'en' } };
    expect(withUiLocale(options)).toBe(options);
  });

  it('never touches Accept-Language', async () => {
    await changeLocale('es');
    const { headers } = withUiLocale({ headers: { 'Accept-Language': 'de-DE' } });
    expect(headers['Accept-Language']).toBe('de-DE');
    expect(headers['X-Cowork-UI-Locale']).toBe('es');
  });

  it('works with a Headers instance', async () => {
    await changeLocale('es');
    const { headers } = withUiLocale({ headers: new Headers({ Accept: 'text/event-stream' }) });
    expect(headers.get('X-Cowork-UI-Locale')).toBe('es');
    expect(headers.get('Accept')).toBe('text/event-stream');
  });

  it('sends nothing while the language picker is off', () => {
    vi.stubEnv('DEV', false);
    const options = { headers: { 'Content-Type': 'application/json' } };
    expect(withUiLocale(options)).toBe(options);
  });

  it('sends the language once the preview is turned on', () => {
    vi.stubEnv('DEV', false);
    window.localStorage.setItem('cowork.i18nPreview', '1');
    expect(withUiLocale({})).toEqual({ headers: { 'X-Cowork-UI-Locale': 'en' } });
  });
});
