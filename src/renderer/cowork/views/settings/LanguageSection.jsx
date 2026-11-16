import { Select } from '../../components/ui';
import {
  setLanguagePreference,
  systemLanguages,
  useLanguagePreference,
  useTranslation,
} from '../../../lib/i18n';
import {
  LOCALE_NATIVE_NAMES,
  PSEUDO_LOCALE,
  SUPPORTED_LOCALES,
  SYSTEM_PREFERENCE,
  resolveLocale,
} from '../../../../shared/i18n/locales';

/* The language picker (ENG-4149), in the Settings modal's header so it is
   reachable from every section. The choice is stored on this device and
   applies at once: the app re-renders in the new language with no reload.
   Each language is listed by its own name, so a
   person who can't read the current UI language can still find theirs. */
function useLanguagePicker() {
  const { t } = useTranslation('settings');
  const preference = useLanguagePreference();
  const systemLocale = resolveLocale(SYSTEM_PREFERENCE, systemLanguages());
  const options = [
    {
      value: SYSTEM_PREFERENCE,
      label: t('language.matchSystem', { language: LOCALE_NATIVE_NAMES[systemLocale] }),
    },
    ...SUPPORTED_LOCALES.map((locale) => ({ value: locale, label: LOCALE_NATIVE_NAMES[locale] })),
    ...(import.meta.env.DEV ? [{ value: PSEUDO_LOCALE, label: LOCALE_NATIVE_NAMES[PSEUDO_LOCALE] }] : []),
  ];
  return {
    t,
    preference,
    options,
    choose: (value) => { void setLanguagePreference(value); },
  };
}

/* "Language: Español ⌄" */
export function LanguageHeaderSelect() {
  const { t, preference, options, choose } = useLanguagePicker();
  return (
    <Select
      variant="pill"
      label={t('language.title')}
      value={preference}
      options={options}
      ariaLabel={t('language.ariaLabel')}
      menuMinWidth={200}
      onValueChange={choose}
    />
  );
}
