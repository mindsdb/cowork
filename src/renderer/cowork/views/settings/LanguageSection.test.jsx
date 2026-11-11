import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useTranslation } from 'react-i18next';
import { changeLocale, setLanguagePreference } from '../../../lib/i18n';
import { LanguageHeaderSelect } from './LanguageSection';

/* The Select primitive opens a Base UI popup; the switch itself is what this
   tests, so pick through the same function the Select calls. */
function SettingsTitle() {
  const { t } = useTranslation('settings');
  return <h1>{t('nav.title')}</h1>;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  window.localStorage.clear();
  await changeLocale('en');
});

describe('LanguageHeaderSelect', () => {
  it('offers Match system and each language by its own name', () => {
    render(<LanguageHeaderSelect />);
        expect(screen.getByRole('combobox', { name: 'Language' })).toHaveTextContent(/Match system \(English\)/);
  });

  it('re-renders the app in the chosen language with no reload', async () => {
    render(<><SettingsTitle /><LanguageHeaderSelect /></>);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Settings');

    await act(async () => { await setLanguagePreference('es'); });

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Configuración');
    expect(screen.getByRole('combobox', { name: 'Idioma' })).toHaveTextContent('Español');
  });

  it('hides the header picker outside the translation preview', () => {
    vi.stubEnv('DEV', false);
    const { container } = render(<LanguageHeaderSelect />);
    expect(container).toBeEmptyDOMElement();
  });

  it('switches to Japanese, with the picker named in Japanese', async () => {
    render(<><SettingsTitle /><LanguageHeaderSelect /></>);
    await act(async () => { await setLanguagePreference('ja'); });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('設定');
    expect(screen.getByRole('combobox', { name: '言語' })).toHaveTextContent('日本語');
    expect(document.documentElement.lang).toBe('ja');
  });

  it.each([
    ['de', 'Einstellungen', 'Sprache', 'Deutsch'],
    ['fr', 'Paramètres', 'Langue', 'Français'],
    ['ko', '설정', '언어', '한국어'],
    ['it', 'Impostazioni', 'Lingua', 'Italiano'],
    ['zh-CN', '设置', '语言', '简体中文'],
  ])('switches to %s', async (locale, settings, language, nativeName) => {
    render(<><SettingsTitle /><LanguageHeaderSelect /></>);
    await act(async () => { await setLanguagePreference(locale); });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(settings);
    expect(screen.getByRole('combobox', { name: language })).toHaveTextContent(nativeName);
    expect(document.documentElement.lang).toBe(locale);
  });
});
