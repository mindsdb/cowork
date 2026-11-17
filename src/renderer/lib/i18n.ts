/* The renderer's i18n runtime (ENG-4149).

   - English ships inside the main bundle and is ready at import time, so
     nothing (tests included) ever renders a raw key.
   - Every other locale is one lazily loaded chunk per catalog file. In
     Electron that chunk is a local file (bundled or the OTA ui-cache); on
     web, cowork-server serves it as a static asset like the rest of the SPA.
     The catalogs live with the UI that uses their keys, never in the server,
     because an OTA renderer routinely runs ahead of the server.
   - Switching language re-renders in place: no reload.

   How to write strings, and the rules that keep every locale in step with
   English, are in docs/i18n/README.md. */

import i18next, { type i18n as I18n } from 'i18next';
import ICU from 'i18next-icu';
import { useSyncExternalStore } from 'react';
import { initReactI18next, useTranslation } from 'react-i18next';
import {
  PSEUDO_LOCALE,
  SOURCE_LOCALE,
  SUPPORTED_LOCALES,
  SYSTEM_PREFERENCE,
  isLanguagePreference,
  resolveLocale,
  serverLocale,
  type AppLocale,
  type LanguagePreference,
  type SupportedLocale,
} from '../../shared/i18n/locales';
import { pseudoLocalize } from '../../shared/i18n/pseudo';

export { useTranslation };
export type { AppLocale, LanguagePreference, SupportedLocale };

const PREFERENCE_KEY = 'cowork.language';

type Catalog = Record<string, unknown>;

const sourceCatalogs = import.meta.glob<Catalog>('../../shared/i18n/locales/en/*.json', {
  eager: true,
  import: 'default',
});
const lazyCatalogs = import.meta.glob<Catalog>([
  '../../shared/i18n/locales/*/*.json',
  '!../../shared/i18n/locales/en/*.json',
], { import: 'default' });

function namespaceOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1, -'.json'.length);
}
function localeOf(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 2];
}

export const NAMESPACES = Object.keys(sourceCatalogs).map(namespaceOf).sort();

function readStorage(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch { /* private window or blocked storage: the choice lasts this session */ }
}

/* Read per call (not at import) so tests can switch it with vi.stubEnv. */
function isDev(): boolean {
  return Boolean(import.meta.env?.DEV);
}

export function systemLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return [];
  if (Array.isArray(navigator.languages) && navigator.languages.length) return navigator.languages;
  return navigator.language ? [navigator.language] : [];
}

export function getLanguagePreference(): LanguagePreference {
  const saved = readStorage(PREFERENCE_KEY);
  return isLanguagePreference(saved, { allowPseudo: isDev() }) ? saved : SYSTEM_PREFERENCE;
}

/* The locale this session runs in: the saved choice, else the OS language
   when it is one the app ships, else English. */
export function preferredLocale(): AppLocale {
  return resolveLocale(getLanguagePreference(), systemLanguages(), { allowPseudo: isDev() });
}

const i18n: I18n = i18next.createInstance();

i18n
  .use(ICU)
  .use(initReactI18next)
  .use({
    type: 'postProcessor',
    name: 'pseudo',
    process: (value: string, _key: unknown, _options: unknown, translator: { language?: string }) =>
      (translator?.language === PSEUDO_LOCALE ? pseudoLocalize(value) : value),
  })
  .init({
    lng: SOURCE_LOCALE,
    fallbackLng: SOURCE_LOCALE,
    supportedLngs: [...SUPPORTED_LOCALES, PSEUDO_LOCALE],
    ns: NAMESPACES,
    // Callers always name their namespace: useTranslation('settings').
    defaultNS: false,
    resources: {
      [SOURCE_LOCALE]: Object.fromEntries(
        Object.entries(sourceCatalogs).map(([path, catalog]) => [namespaceOf(path), catalog]),
      ),
    },
    partialBundledLanguages: true,
    postProcess: ['pseudo'],
    // Synchronous init: English is in memory, so t() works on the first render.
    initAsync: false,
    returnNull: false,
    returnEmptyString: false,
    interpolation: { escapeValue: false }, // React escapes.
    react: { useSuspense: false },
  });

async function loadLocale(locale: AppLocale): Promise<void> {
  // The pseudo-locale is English, transformed on the way out.
  const source = locale === PSEUDO_LOCALE ? SOURCE_LOCALE : locale;
  if (source === SOURCE_LOCALE) {
    if (locale === PSEUDO_LOCALE) {
      for (const ns of NAMESPACES) {
        i18n.addResourceBundle(PSEUDO_LOCALE, ns, i18n.getResourceBundle(SOURCE_LOCALE, ns) ?? {}, true, true);
      }
    }
    return;
  }
  const loads = Object.entries(lazyCatalogs)
    .filter(([path]) => localeOf(path) === source)
    .map(async ([path, load]) => {
      const ns = namespaceOf(path);
      if (i18n.hasResourceBundle(source, ns)) return;
      i18n.addResourceBundle(source, ns, await load(), true, true);
    });
  await Promise.all(loads);
}

function applyDocumentLanguage(locale: string): void {
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
}
i18n.on('languageChanged', applyDocumentLanguage);

/* Each switch takes a ticket; only the newest one may apply. A catalog load
   is async, so without this a slow earlier switch (a cold chunk, or the boot
   switch after whenI18nReady gave up waiting) could land after a newer one
   and leave the app in a language the pickers no longer show. */
let latestSwitch = 0;

/* Switch the running app to `locale`. A catalog that fails to load leaves
   the app in English rather than half-switched. Resolves to the locale the
   app is in once this call is done, which is a newer call's when one
   overtook it. */
export async function changeLocale(locale: AppLocale): Promise<AppLocale> {
  const ticket = ++latestSwitch;
  let target: AppLocale = locale;
  try {
    await loadLocale(locale);
  } catch {
    target = SOURCE_LOCALE;
  }
  if (ticket !== latestSwitch) return currentLocale();
  await i18n.changeLanguage(target);
  return target;
}

/* Save the user's choice and apply it now. */
/* Every language picker on screen (Settings header, Appearance) reads the
   stored choice through useLanguagePreference, so changing it in one updates
   the others, including "Match system", which may not change the locale. */
const preferenceListeners = new Set<() => void>();

function subscribeLanguagePreference(listener: () => void): () => void {
  preferenceListeners.add(listener);
  return () => { preferenceListeners.delete(listener); };
}

export function useLanguagePreference(): LanguagePreference {
  return useSyncExternalStore(subscribeLanguagePreference, getLanguagePreference, getLanguagePreference);
}

export function setLanguagePreference(preference: LanguagePreference): Promise<AppLocale> {
  writeStorage(PREFERENCE_KEY, preference === SYSTEM_PREFERENCE ? null : preference);
  for (const listener of preferenceListeners) listener();
  return changeLocale(preferredLocale());
}

const READY_TIMEOUT_MS = 1500;

/* Entry points await this before the first render, so a Spanish user never
   sees an English flash. It never rejects and never waits long: a slow or
   failed catalog load boots in English. */
export function whenI18nReady(): Promise<void> {
  const locale = preferredLocale();
  if (locale === SOURCE_LOCALE) {
    applyDocumentLanguage(SOURCE_LOCALE);
    return Promise.resolve();
  }
  const timeout = new Promise<void>((resolve) => { setTimeout(resolve, READY_TIMEOUT_MS); });
  return Promise.race([changeLocale(locale).then(() => undefined), timeout]);
}

/* The locale to tell the server (X-Cowork-UI-Locale), so Anton knows the
   user's language: one of SUPPORTED_LOCALES (the pseudo-locale sends en). */
export function currentServerLocale(): SupportedLocale | null {
  const lng = i18n.resolvedLanguage ?? i18n.language;
  return serverLocale(isLanguagePreference(lng, { allowPseudo: true }) && lng !== SYSTEM_PREFERENCE ? lng : SOURCE_LOCALE);
}

export function currentLocale(): AppLocale {
  const lng = i18n.language;
  return isLanguagePreference(lng, { allowPseudo: true }) && lng !== SYSTEM_PREFERENCE ? lng : SOURCE_LOCALE;
}

export default i18n;

/* A translator for copy built in src/shared (see shared/i18n/translate.ts),
   bound to the namespace the shared function documents. It reads the current
   language on every call. */
export function sharedTranslator(ns: string): (key: string, vars?: Record<string, unknown>) => string {
  return (key, vars) => i18n.t(key, { ns, ...vars });
}

/* A list of names or addresses in the current language: "a, b, c" in
   English, "a, b y c" in Spanish. */
export function formatList(items: readonly string[]): string {
  return new Intl.ListFormat(currentLocale(), { type: 'unit', style: 'short' }).format(items);
}
