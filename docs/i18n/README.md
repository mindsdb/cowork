# Translations (i18n)

Cowork ships in English, Spanish (`es`), Brazilian Portuguese (`pt-BR`), German (`de`), French (`fr`), Italian (`it`), Japanese (`ja`), Korean (`ko`) and Simplified Chinese (`zh-CN`). Tracking ticket: ENG-4149.

**The rule:** every string a person reads goes through `t()`. When you add or change English, update every other locale in the same PR. CI (`npm run check:i18n`) fails otherwise. The `/i18n-sync` Claude Code skill does the translation work.

## Writing a string

```jsx
import { useTranslation } from '../../../lib/i18n';   // src/renderer/lib/i18n.ts

function DeleteButton({ count }) {
  const { t } = useTranslation('task');               // always name the namespace
  return <Button aria-label={t('delete.ariaLabel')}>{t('delete.label', { count })}</Button>;
}
```

```json
// src/shared/i18n/locales/en/task.json
{ "delete": { "label": "{count, plural, one {Delete # task} other {Delete # tasks}}", "ariaLabel": "Delete" } }
```

- **Namespaces** are files: `src/shared/i18n/locales/<locale>/<namespace>.json`, one per feature area (`settings`, `task`, `rail`, …). A new namespace is just a new file in `en/` plus its translations — no registration.
- **Keys** describe meaning, nested by screen and control: `appearance.theme.title`, `appearance.theme.lightAriaLabel`. Never use the English text as the key.
- **Messages are ICU MessageFormat.** Variables are `{name}`; plurals are `{count, plural, one {…} other {…}}` (never build plurals with `count === 1 ? … : …`); alternatives are `{kind, select, file {…} other {…}}`. Don't concatenate translated fragments — word order differs between languages; put the whole sentence in one message with arguments.
- **Outside React** (event handlers, pure modules), import the instance: `import i18n from '…/lib/i18n'` and call `i18n.t('task:delete.ariaLabel')`.
- **Dates, numbers, relative times** use `Intl` with `currentLocale()` from `lib/i18n`, not hand-built strings.
- **Product names** (Anton, MindsHub, Cowork, a deployment's brand) are arguments or stay as is — see the glossary.
- **Tests** run in English, so `getByText('Settings')` keeps working.

## How languages load and switch

- English is built into the main bundle and ready at import time.
- Each other locale is a separate chunk, loaded the first time someone picks it. In Electron the chunk is a local file (bundled, or the OTA UI cache); on the web cowork-server serves it as a static asset. Catalogs live with the UI, not in the server, because an OTA UI routinely runs ahead of the server — each UI version carries the text for its own keys.
- The entry points (`main.tsx`, `web-main.tsx`) wait for the user's language before the first render (bounded at 1.5 s, falls back to English), so there is no English flash.
- Settings → Appearance → Language switches in place with `i18n.changeLanguage()`: nothing reloads. The choice is stored on the device (`localStorage: cowork.language`); "Match system" follows the OS language.
- While the language picker is on, every server request carries `X-Cowork-UI-Locale` with the active locale (`withUiLocale` in `cowork/api.js`), which cowork-server hands to Anton so it replies in the user's language. Not `Accept-Language`: browsers send that on their own, so it can't tell an app setting from an OS default.

### Preview gate

Until every screen is translated, the Language picker and non-English locales are only on in dev builds, or when a tester sets `localStorage.setItem('cowork.i18nPreview', '1')` and reloads. Everyone else runs in English exactly as before.

### Pseudo-locale

Dev builds offer **Ƥşḗŭḓǿ (en-XA)** in the picker: English, accented and padded ~35%. Anything still plain English on screen skipped `t()`; anything clipped or wrapping badly will break in Spanish or Portuguese too.

## What CI checks

`npm run check:i18n` (rules in `scripts/i18n/check-lib.mjs`, tested by `npm run test:i18n-check`):

| Issue | Meaning | Fix |
|---|---|---|
| `missing` | English has a key the translation lacks | translate it |
| `extra` | the translation has a key English dropped | delete or move it |
| `invalid` | not valid ICU | fix the syntax |
| `mismatch` | `{arguments}` or select branches differ from English, or a plural lacks `other` | match English's structure |
| `unlocked` | a translation never recorded in the lock | review, then `--write-lock` |
| `stale` | English changed since the translation was made | retranslate, then `--write-lock`; or `--accept <key>` if it's still right |

**The lock** (`src/shared/i18n/i18n.lock.json`, generated — don't edit by hand) records, per key and locale, a hash of the English a translation was made from and a hash of the translation. That is what catches *edits*: change "Delete task" to "Delete task and its files" and both translations go stale until someone updates them. `--write-lock` only re-stamps translations whose text changed, so it can't paper over a stale one.

**Hard-coded English** in `src/renderer/**/*.{jsx,tsx}` is counted with a heuristic and held to a ratchet (`literalBaseline` in `src/shared/i18n/i18n.config.json`): adding new hard-coded text fails CI; moving strings into catalogs lowers the count — lock that in with `npm run check:i18n -- --update-baseline`. Brand and product names that are never translated go in `literalAllowlist`.

## Commands

```sh
npm run check:i18n                         # what CI runs
npm run check:i18n -- --json               # machine-readable (used by /i18n-sync)
npm run check:i18n -- --write-lock         # after translating
npm run check:i18n -- --accept <key>       # English changed, translation still right
npm run check:i18n -- --verbose            # list every hard-coded English string
npm run check:i18n -- --update-baseline    # after moving strings into catalogs
npm run test:i18n-check                    # the check's own tests
```
