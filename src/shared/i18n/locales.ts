/* The app's languages, and how a language preference becomes the one locale
   the app runs in. Pure functions: shared by the renderer (and later the main
   process), and tested directly.

   English is the source language. Every other locale is a translation of it,
   kept in step by `npm run check:i18n` (see docs/i18n/README.md). */

export const SOURCE_LOCALE = 'en' as const;

/* Order is the order the Language picker shows them in. */
export const SUPPORTED_LOCALES = ['en', 'es', 'pt-BR', 'de', 'fr', 'ja', 'ko'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/* Dev-only pseudo-locale: English text, accented and padded, so a string
   that skipped t() stands out as plain English and long-text layout bugs
   show up before a real translation exists. Never offered in production. */
export const PSEUDO_LOCALE = 'en-XA' as const;
export type AppLocale = SupportedLocale | typeof PSEUDO_LOCALE;

/* Each language names itself in its own language, so a person who can't
   read the current UI language can still find theirs. */
export const LOCALE_NATIVE_NAMES: Record<AppLocale, string> = {
  en: 'English',
  es: 'Español',
  'pt-BR': 'Português (Brasil)',
  de: 'Deutsch',
  fr: 'Français',
  ja: '日本語',
  ko: '한국어',
  [PSEUDO_LOCALE]: 'Ƥşḗŭḓǿ (en-XA)',
};

/* The stored preference: a locale, or follow the operating system. */
export const SYSTEM_PREFERENCE = 'system' as const;
export type LanguagePreference = AppLocale | typeof SYSTEM_PREFERENCE;

/* Map any BCP-47 tag onto a supported locale, or null when we don't have
   that language. Region matters only where we ship a regional variant:
   every Portuguese maps to pt-BR, every Spanish to es (neutral Latin
   American), every English to en; German, French, Japanese and Korean
   map to de, fr, ja and ko whatever the region. */
export function normalizeLocale(tag: string | null | undefined): SupportedLocale | null {
  if (typeof tag !== 'string') return null;
  const lang = tag.trim().toLowerCase().replace(/_/g, '-').split('-')[0];
  if (lang === 'en') return 'en';
  if (lang === 'es') return 'es';
  if (lang === 'pt') return 'pt-BR';
  if (lang === 'de') return 'de';
  if (lang === 'fr') return 'fr';
  if (lang === 'ja') return 'ja';
  if (lang === 'ko') return 'ko';
  return null;
}

export function isLanguagePreference(value: unknown, { allowPseudo = false } = {}): value is LanguagePreference {
  if (value === SYSTEM_PREFERENCE) return true;
  if (value === PSEUDO_LOCALE) return allowPseudo;
  return (SUPPORTED_LOCALES as readonly unknown[]).includes(value);
}

/* The locale to run in: an explicit choice wins; "system" (or nothing, or a
   value we no longer support) takes the first system language we have;
   English when none match. */
export function resolveLocale(
  preference: unknown,
  systemLanguages: readonly string[] = [],
  { allowPseudo = false } = {},
): AppLocale {
  if (preference === PSEUDO_LOCALE && allowPseudo) return PSEUDO_LOCALE;
  if (isLanguagePreference(preference) && preference !== SYSTEM_PREFERENCE && preference !== PSEUDO_LOCALE) {
    return preference;
  }
  for (const tag of systemLanguages) {
    const locale = normalizeLocale(tag);
    if (locale) return locale;
  }
  return SOURCE_LOCALE;
}

/* What the server is told (Accept-Language). The pseudo-locale is English
   to everything outside the UI. */
export function serverLocale(locale: AppLocale): SupportedLocale {
  return locale === PSEUDO_LOCALE ? SOURCE_LOCALE : locale;
}
