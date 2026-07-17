# ENG-794 — Add `<Select>` component & replace native selects

**Ticket:** https://linear.app/mindsdb/issue/ENG-794/add-select-component
**Branch:** `paul/eng-794-add-select-component` (repo currently on `staging` — create/checkout first)
**Parent:** ENG-641 · **Project:** MindsHub Cowork

> Goal: add a token-skinned `Select` primitive built on Base UI (mirroring the
> existing `ui/Menu.jsx` integration) and replace the app's native `<select>`
> elements with it, so forms and sort-selectors share one accessible,
> consistently-styled control.

---

## Locked decisions (from planning)

1. **API shape:** options-array driven (not pure compound). Matches `ui/Menu.jsx`'s
   `items` precedent; most call sites already `.map()` an array; the hard
   SettingsView case becomes cleaner as data. Base UI's compound parts stay
   available under the hood, so thin `Select.Item`/`Select.Trigger` wrappers
   can be re-exported later as an escape hatch *if* a rich-content item ever
   appears — do **not** build them speculatively (YAGNI).
2. **Arcade excluded:** `src/renderer/pages/arcade/OnboardingScreen.tsx`
   (`arc-select`, CRT/gameboy skin) is out of scope. Ticket = "cowork app" =
   `src/renderer/cowork/`.
3. **Model picker included, with care:** the ENG-739-sensitive SettingsView
   model/provider/effort selects are migrated as the final, carefully-verified
   step (preserve `resolveModelPickerValue`, sentinels, disabled/locked, and
   `aria-invalid`).

Out of scope also: `src/renderer/cowork/lib/settingsTransform.js` — its
`<select>` mentions are comments, not elements.

---

## The primitive: `src/renderer/cowork/components/ui/Select.jsx`

Model the file on `ui/Menu.jsx`: a leading header comment explaining *why the
library* and the two-mode design; an injected, one-time stylesheet
(`_ensureSelectCss()`) using the same design tokens (`--surface`, `--line`,
`--ink-*`, `--accent`, `--danger`, `--r`, radius/shadow) so it's visually
identical to the fields it replaces; export via the `ui/index.js` barrel.

### Base UI parts (v1.5.0, `@base-ui/react/select`)

Available parts: `Root, Trigger, Value, Icon, Portal, Positioner, Popup, List,
Item, ItemText, ItemIndicator, Group, GroupLabel, Backdrop, Arrow`.

### Proposed public API

```jsx
<Select
  value={string}                       // controlled; '' = empty/placeholder
  onValueChange={(value) => void}      // Base UI passes the value directly (NOT an event)
  options={Option[] | (Separator|Option|Group)[]}
  placeholder="Select…"                // rendered by Select.Value when no match
  variant="field" | "pill"             // default "field"
  size="md" | "sm"                     // default "md"
  disabled={boolean}
  invalid={boolean}                    // → aria-invalid + danger ring (SettingsView provider)
  ariaLabel={string}
  title={string}                       // native tooltip passthrough on trigger
  id / name                            // optional form association
  width / minWidth                     // px; field variant usually width:'100%'
  className / style                    // trigger escape hatch
/>

// Option    = { value: string, label: ReactNode, disabled?: boolean, title?: string }
// Separator = { separator: true }
// Group     = { group: string, options: Option[] }   // optional; only if a site needs it
```

Notes:
- **Keep values as strings** to match existing handlers/server payloads. Do not
  enable clearing (Base UI can emit `null`); guard `onValueChange` if needed.
- **`variant="field"`** → full-width bordered trigger with chevron on the right
  (looks like today's `settings-select` / `channels-input` / inline `fieldSelect`).
- **`variant="pill"`** → compact trigger showing `label:` + current value + chevron
  (replaces the `SelectPill` overlay trick and `customize-select` sort/filter pills).
- **Popup** reuses the `.cw-menu` look (surface, `--line` border, radius 10,
  soft shadow, 130ms open anim). Items: `.cw-select-item` with
  `[data-highlighted]` (hover + keyboard), `[data-disabled]` (0.55 opacity), and
  a check via `Select.ItemIndicator` on `[data-selected]`.
- **Positioner:** set `alignItemWithTrigger={false}` so it renders as a normal
  dropdown *below* the trigger, not Base UI's default macOS-style
  selected-item-over-trigger behavior. `sideOffset≈6`, `zIndex≈95` (matches Menu,
  sits above default-layer modals so a Select inside a modal stacks correctly).
- **Popup width:** match the trigger via Base UI's `--anchor-width` positioner
  var (`minWidth: 'var(--anchor-width)'`) for the field variant; pill variant can
  size to content.

### Electron gotcha — outside-press dismiss

The whole window is `-webkit-app-region: drag`; Electron swallows mouse events
over drag regions (see the long note in `Menu.jsx`). Menu found **trigger-mode**
dismiss works because Base UI owns it — Select is trigger-mode too, so it should
be fine. To be safe, render `Select.Backdrop` with `style={{ WebkitAppRegion:
'no-drag' }}` so a click on the empty canvas still dismisses. **Verify in the
packaged app**, not just dev.

### Other styling gotchas

- **8-bit skin focus rule** (`styles/globals.css:119`) excludes `select` from the
  focus-visible ring, but our trigger is a `<button>`, so it *will* get the
  8bit ring. Check `skin-8bit`; add `.cw-select-trigger` to that exclusion if it
  looks wrong.
- The Windows native-`<select>` dark-popup workarounds (`globals.css:~114,~250`)
  become irrelevant for migrated selects (popup is now our DOM). Harmless to
  leave; can note for a later sweep.

---

## Tests

Add `src/renderer/cowork/components/ui/Select.test.jsx` (happy-dom project).
Use `components/artifact/publish/PublishMenu.test.jsx` as the reference for
testing a Base UI popup in this repo (portal/open handling).

Cover:
- renders options; opens on trigger click.
- selecting an item fires `onValueChange` with the item **value** (not an event).
- a `disabled` item does not fire `onValueChange`.
- `placeholder` shows when `value` matches no option.
- `invalid` sets `aria-invalid` on the trigger.
- separator renders and is not selectable.

Per CLAUDE.md, coverage floors are ratcheted — this new file must carry tests;
don't lower floors.

---

## Call-site migration inventory (17 elements / 8 files)

Migration = swap `<select>/<option>` for `<Select options>`, and change
`onChange={(e) => fn(e.target.value)}` → `onValueChange={fn}` (or
`onValueChange={(v) => fn(v)}`). Preserve `aria-label`, `title`, `disabled`,
and empty-value/placeholder semantics exactly.

### Order it by risk (low → high):

**Step A — pill / sort-selectors (variant="pill"):**
- `components/connector/ConnectorPicker.jsx` — `SelectPill` (def ~L134; used L354,
  L371). Replace its internals with `<Select variant="pill">`. It already models
  `{ id, label }` + `{ separator: true }` — map `id→value`. Base UI groups/
  separators are first-class, so drop the em-dash `<option disabled>` hack.
- `views/ConnectWorkflowView.jsx` — filter (L774) + sort (L795), currently the
  same transparent-overlay trick with `customize-select`. Replace both with
  `<Select variant="pill">` fed by `DIRECTORY_CATEGORIES` / `DIRECTORY_SORT_OPTIONS`.

**Step B — simple field selects (variant="field"):**
- `views/ChannelBindings.jsx` — 5 (`channels-input`): `channel_type` (L98,
  placeholder `Channel…`), `trigger_rule` (L107, L143), project (L111 default,
  L154). Keep the empty-value entries (`value=""`) as options **or** use
  `placeholder` consistently — pick one and preserve current behavior. Note
  `channels-input` is shared with text inputs — **don't delete the class**, just
  stop applying it to selects.
- `components/schedule/ScheduleTaskModal.jsx` — 2: cadence (L200), projectPath
  (L224). Remove the `fieldSelect` inline const (chevron padding) once migrated.
- `components/datavault/DataVaultForm.jsx` — 1 (L109). Has `displayValue` +
  `disabled`; the controlled value may not match an option — handle via
  `placeholder`/fallback.
- `views/SkillsView.jsx` — 1 (L204, `aria-label="Scope"`).
- `views/UtilitiesView.jsx` — 2: Engine (L443), Authentication method (L447),
  inline `inputStyle`. Remove the select-specific chevron-padding note (~L561).

**Step C — SettingsView model picker (highest care):**
- `views/SettingsView.jsx` — 3 (`settings-select`): Provider (L1608), Model
  (L1641), Reasoning effort (L1698).
  - **Preserve the ENG-739 invariant:** keep using `resolveModelPickerValue`; the
    controlled value must always match a rendered option. Build the model
    `options` array in JS: `showStalePin` sentinel (`__stale__`, disabled) →
    `modelList` (each with `disabled: isLocked(m)` and the "— Upgrade to unlock"
    suffix) → `allowOther` (`__custom__` "Other…"). Keep the `__custom__` branch
    that flips `modelInputMode`.
  - Provider select: carry `aria-invalid`/`aria-describedby` and the danger ring
    (`invalid` prop) for `providerUnusable`.
  - Effort select: replicate `textTransform: 'capitalize'` on item labels.
  - Add/extend tests around the model-picker option-array builder.

---

## CSS / dead-code cleanup (after migration; grep before deleting)

- Remove `.settings-select` (`globals.css:~1838` area) once SettingsView is off it.
- `.customize-select` / `.customize-select-row` — `customize-select` is used by the
  ConnectWorkflowView pills; `customize-select-row` may be a layout container
  elsewhere. **Grep for other consumers**; remove only what's now unused.
- `ScheduleTaskModal.fieldSelect` const — remove.
- `SelectPill` — folded into `<Select variant="pill">` (keep a thin wrapper only if
  call sites benefit; otherwise inline).
- Leave `channels-input`, `arc-select`, and the Windows/8bit native-select CSS
  in place (still used / out of scope).

---

## Verification

1. `npm run typecheck` (main + renderer + tests).
2. `npm test` + `npm run test:coverage` (floors must still pass).
3. `npm run check:cowork-purity` (no direct `window.antontron`).
4. Build & smoke: `PATH="/opt/homebrew/opt/node@20/bin:$PATH" npm run pack`
   (or the `dev` renderer), then **manually exercise each migrated surface**:
   Settings (provider/model/effort incl. locked + Other…), Schedule modal,
   DataVault form, Channel bindings, Skills scope, Utilities engine/auth,
   Connector directory filter+sort, Connect-workflow filter+sort. Confirm:
   keyboard nav (↑/↓, typeahead, Enter, Esc), outside-click dismiss in the
   **packaged** app (drag-region), light/dark + 8bit skin, and that no
   selection silently no-ops (ENG-739 regression check on the model picker).
5. `/code-review` the diff before PR.

---

## Suggested commits

1. `feat(ui): add Select primitive on Base UI` — Select.jsx + test + barrel + README.
2. `refactor(connector,directory): use Select for sort/filter pills` — Step A.
3. `refactor: replace native selects with Select` — Step B.
4. `refactor(settings): migrate model picker to Select` — Step C + tests.
5. `chore(styles): drop now-dead select CSS` — cleanup.

Do not commit/push unless asked (global rule). PR title should reference ENG-794.
