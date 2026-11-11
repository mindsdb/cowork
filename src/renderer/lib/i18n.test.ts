import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n, {
  changeLocale,
  currentLocale,
  currentServerLocale,
  getLanguagePreference,
  languagePickerEnabled,
  preferredLocale,
  setLanguagePreference,
  whenI18nReady,
} from './i18n';

function stubSystemLanguages(languages: string[]) {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(languages);
}

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  window.localStorage.clear();
  await changeLocale('en');
});

describe('i18n runtime', () => {
  it('has English ready at import time, with no async init', () => {
    expect(i18n.isInitialized).toBe(true);
    expect(i18n.t('settings:nav.title')).toBe('Settings');
  });

  it('formats ICU arguments', () => {
    expect(i18n.t('settings:language.matchSystem', { language: 'English' })).toBe('Match system (English)');
  });

  it('switches language in place and loads the catalog on demand', async () => {
    expect(i18n.hasResourceBundle('es', 'settings')).toBe(false);
    await changeLocale('es');
    expect(i18n.hasResourceBundle('es', 'settings')).toBe(true);
    expect(i18n.t('settings:nav.title')).toBe('Configuración');
    expect(document.documentElement.lang).toBe('es');
    expect(currentLocale()).toBe('es');

    await changeLocale('pt-BR');
    expect(i18n.t('settings:nav.title')).toBe('Configurações');
    expect(currentServerLocale()).toBe('pt-BR');
  });

  it('lets the newest switch win when an older catalog load finishes last', async () => {
    // A cold Spanish chunk, then English picked before it arrives: the late
    // Spanish load must not switch the app back.
    const spanish = changeLocale('es');
    const english = changeLocale('en');
    expect(await english).toBe('en');
    expect(await spanish).toBe('en');
    expect(i18n.language).toBe('en');
    expect(currentServerLocale()).toBe('en');
  });

  it('pseudo-localizes English for en-XA, but tells the server en', async () => {
    await changeLocale('en-XA');
    expect(i18n.t('settings:nav.title')).toMatch(/^\[Şḗŧŧīƞɠş ~+\]$/);
    expect(currentServerLocale()).toBe('en');
  });
});

describe('language preference', () => {
  it('defaults to following the system', () => {
    expect(getLanguagePreference()).toBe('system');
  });

  it('follows the system language when set to system', () => {
    stubSystemLanguages(['pt-PT', 'en']);
    expect(preferredLocale()).toBe('pt-BR');
  });

  it('saves an explicit choice and applies it at once', async () => {
    stubSystemLanguages(['en-US']);
    await setLanguagePreference('es');
    expect(window.localStorage.getItem('cowork.language')).toBe('es');
    expect(i18n.language).toBe('es');

    await setLanguagePreference('system');
    expect(window.localStorage.getItem('cowork.language')).toBeNull();
    expect(i18n.language).toBe('en');
  });

  it('keeps everyone in English outside the preview', () => {
    vi.stubEnv('DEV', false);
    stubSystemLanguages(['es-MX']);
    window.localStorage.setItem('cowork.language', 'pt-BR');
    expect(languagePickerEnabled()).toBe(false);
    expect(preferredLocale()).toBe('en');

    window.localStorage.setItem('cowork.i18nPreview', '1');
    expect(languagePickerEnabled()).toBe(true);
    expect(preferredLocale()).toBe('pt-BR');
  });

  it('ignores the pseudo-locale outside dev builds', () => {
    vi.stubEnv('DEV', false);
    window.localStorage.setItem('cowork.i18nPreview', '1');
    window.localStorage.setItem('cowork.language', 'en-XA');
    stubSystemLanguages(['es']);
    expect(preferredLocale()).toBe('es');
  });
});

describe('whenI18nReady', () => {
  it('resolves at once for English', async () => {
    stubSystemLanguages(['en-US']);
    await whenI18nReady();
    expect(i18n.language).toBe('en');
    expect(document.documentElement.lang).toBe('en');
  });

  it('loads the preferred language before resolving', async () => {
    window.localStorage.setItem('cowork.language', 'es');
    await whenI18nReady();
    expect(i18n.t('settings:nav.title')).toBe('Configuración');
  });
});
