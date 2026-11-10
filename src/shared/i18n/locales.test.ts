import { describe, expect, it } from 'vitest';
import {
  LOCALE_NATIVE_NAMES,
  PSEUDO_LOCALE,
  SUPPORTED_LOCALES,
  isLanguagePreference,
  normalizeLocale,
  resolveLocale,
  serverLocale,
} from './locales';
import { pseudoLocalize } from './pseudo';

describe('normalizeLocale', () => {
  it.each([
    ['en', 'en'],
    ['en-US', 'en'],
    ['EN_gb', 'en'],
    ['es', 'es'],
    ['es-MX', 'es'],
    ['es-419', 'es'],
    ['es-ES', 'es'],
    ['pt', 'pt-BR'],
    ['pt-BR', 'pt-BR'],
    ['pt-PT', 'pt-BR'],
    [' pt-br ', 'pt-BR'],
  ])('%s → %s', (tag, expected) => {
    expect(normalizeLocale(tag)).toBe(expected);
  });

  it.each([['fr-FR'], ['de'], [''], ['*'], [null], [undefined]])('%s → null', (tag) => {
    expect(normalizeLocale(tag as string | null | undefined)).toBeNull();
  });
});

describe('resolveLocale', () => {
  it('an explicit choice wins over the system languages', () => {
    expect(resolveLocale('pt-BR', ['es-MX', 'en-US'])).toBe('pt-BR');
  });

  it('"system" takes the first system language we have', () => {
    expect(resolveLocale('system', ['fr-FR', 'es-AR', 'en'])).toBe('es');
  });

  it('falls back to English when no system language matches', () => {
    expect(resolveLocale('system', ['fr-FR', 'de-DE'])).toBe('en');
    expect(resolveLocale('system', [])).toBe('en');
  });

  it('treats a missing or unknown stored value as "system"', () => {
    expect(resolveLocale(null, ['pt-PT'])).toBe('pt-BR');
    expect(resolveLocale('klingon', ['es'])).toBe('es');
  });

  it('honours the pseudo-locale only when allowed', () => {
    expect(resolveLocale(PSEUDO_LOCALE, ['es'], { allowPseudo: true })).toBe(PSEUDO_LOCALE);
    expect(resolveLocale(PSEUDO_LOCALE, ['es'])).toBe('es');
  });
});

describe('isLanguagePreference', () => {
  it('accepts every supported locale and "system"', () => {
    for (const locale of [...SUPPORTED_LOCALES, 'system']) expect(isLanguagePreference(locale)).toBe(true);
  });

  it('rejects the pseudo-locale unless allowed', () => {
    expect(isLanguagePreference(PSEUDO_LOCALE)).toBe(false);
    expect(isLanguagePreference(PSEUDO_LOCALE, { allowPseudo: true })).toBe(true);
  });
});

describe('serverLocale', () => {
  it('tells the server English for the pseudo-locale', () => {
    expect(serverLocale(PSEUDO_LOCALE)).toBe('en');
    expect(serverLocale('es')).toBe('es');
  });
});

it('names every locale in its own language', () => {
  expect(LOCALE_NATIVE_NAMES).toMatchObject({ en: 'English', es: 'Español', 'pt-BR': 'Português (Brasil)' });
});

describe('pseudoLocalize', () => {
  it('accents, pads and brackets the text', () => {
    const out = pseudoLocalize('Settings');
    expect(out).toMatch(/^\[Şḗŧŧīƞɠş ~+\]$/);
    expect(out.length).toBeGreaterThan('Settings'.length * 1.3);
  });

  it('leaves no plain ASCII letters behind', () => {
    expect(pseudoLocalize('Match system (English)')).not.toMatch(/[A-Za-z]/);
  });

  it('passes empty text through', () => {
    expect(pseudoLocalize('')).toBe('');
  });
});
