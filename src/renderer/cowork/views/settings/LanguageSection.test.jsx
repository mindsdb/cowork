import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useTranslation } from 'react-i18next';
import { changeLocale, setLanguagePreference } from '../../../lib/i18n';
import LanguageSection from './LanguageSection';

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

describe('LanguageSection', () => {
  it('is hidden outside the translation preview', () => {
    vi.stubEnv('DEV', false);
    const { container } = render(<LanguageSection />);
    expect(container).toBeEmptyDOMElement();
  });

  it('offers Match system and each language by its own name', () => {
    render(<LanguageSection />);
    expect(screen.getByText('Language')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Language' })).toHaveTextContent(/Match system \(English\)/);
  });

  it('re-renders the app in the chosen language with no reload', async () => {
    render(<><SettingsTitle /><LanguageSection /></>);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Settings');

    await act(async () => { await setLanguagePreference('es'); });

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Configuración');
    expect(screen.getByText('Idioma')).toBeInTheDocument();
  });
});
