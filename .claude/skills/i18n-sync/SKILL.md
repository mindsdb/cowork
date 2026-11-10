---
name: i18n-sync
description: bring Spanish and Brazilian Portuguese up to date with English. use after adding or changing any user-visible UI text, when npm run check:i18n reports missing / stale / unlocked / mismatch issues, or when asked to translate the UI or add a language.
---

# Keep every language in step with English

English (`src/shared/i18n/locales/en/`) is the source. Every other locale folder must have the same keys, the same ICU arguments, and translations made from the **current** English. `npm run check:i18n` enforces this in CI; this skill is how you satisfy it.

Read `docs/i18n/README.md` (how strings work) and `docs/i18n/glossary.md` (fixed terms and tone) before translating. The glossary is not optional: a term it fixes is always translated that way.

## Steps

1. **See what needs doing.**
   ```sh
   npm run -s check:i18n -- --json > /tmp/i18n.json; echo $?
   ```
   Each entry in `issues` has `kind`, `locale`, `key` (`<namespace>:<dotted.path>`) and `detail`:
   - `missing` — translate the English (shown in `detail`) and add the key to that locale's file.
   - `stale` — English changed. Re-read the new English and the old translation; rewrite the translation. If the old one is still exactly right (e.g. English fixed a typo), leave it and accept it in step 4.
   - `unlocked` — a translation exists but was never recorded; check it reads well, then step 4.
   - `mismatch` / `invalid` — fix the translation's ICU so its `{arguments}` and `select` branches match English. Never rename an argument.
   - `extra` — English dropped or renamed the key; delete it from the locale file (or move the translation to the new key).
2. **Translate** in `src/shared/i18n/locales/<locale>/<namespace>.json`, keeping the same nesting as English.
   - Keep ICU structure exactly: `{name}`, `{count, plural, one {…} other {…}}`, `{kind, select, …}`. Spanish and Portuguese may add a `many` plural branch; `other` is always required.
   - Read the neighbouring keys for context: a `title`, its `subtitle` and its `ariaLabel` describe the same control and must agree.
   - Follow the glossary's tone (Spanish `tú`, neutral Latin American; Portuguese `você`, Brazilian). Keep product names (Anton, MindsHub, Cowork) and file types (PNG, KB) as is.
   - Match length roughly. If a translation is much longer than English and the English is a button or tab label, prefer a shorter wording.
3. **Add new glossary terms** to `docs/i18n/glossary.md` when you fix a translation for a product concept that will recur.
4. **Record the translations.**
   ```sh
   npm run check:i18n -- --write-lock                 # re-stamps every translation whose text you changed
   npm run check:i18n -- --accept settings:nav.title  # English changed, translation still right (key, prefix, or "ns:")
   ```
   `--write-lock` never clears a `stale` key whose translation text you didn't touch — that is the point.
5. **Verify**: `npm run check:i18n` exits 0, then run the tests for any component you changed.

## Adding a language

1. Add the code to `SUPPORTED_LOCALES` and `LOCALE_NATIVE_NAMES` in `src/shared/i18n/locales.ts`, and its mapping in `normalizeLocale` (with tests in `locales.test.ts`).
2. Create `src/shared/i18n/locales/<code>/` and add a glossary column.
3. Run this skill: every key will be `missing`; translate them all, then `--write-lock`.
4. Tell cowork-server and anton about the new code (they normalize `Accept-Language` to the supported set).
