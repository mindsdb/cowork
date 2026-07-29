# UI component & styling conventions

Short rules for building UI in `src/renderer/cowork/`. Enforced by
`npm run check:design-system` (a ratchet — see below) and reviewed in PRs.
Part of the design-system effort (ENG-641).

## Use the primitives, not raw elements

Reach for `components/ui/` before hand-rolling. The primitive owns
accessibility, theming, and behaviour so it's fixed in one place.

| Instead of… | Use |
|---|---|
| `<button className="btn-*">` | `<Button variant="…">` |
| `<input>` / `<textarea>` (text) | `<Input>` / `<Textarea>` |
| `<select>` | `<Select>` (fully adopted — baseline is 0) |
| a hand-rolled dropdown / popover | `<Menu>` / `<Select>` |
| a bespoke `role="dialog"` overlay | `<Modal>` (+ `ModalHeader/Body/Footer`) |
| a native `title=` hover hint | `<Tooltip>` (or `aria-label` for a pure name) — ENG-1152 |

Genuinely-native controls (`<input type="file">`, `type="checkbox"` when
`ui/Checkbox` doesn't fit, `type="color"`) are fine — mark the line with a
trailing `// ds-ignore` so the guardrail skips it. SVG paint attributes
(`fill=`/`stroke=`/`stopColor=`) on icons and brand logos are exempt from the
color check automatically — their color is intrinsic art, not a token.

## Style with tokens, not hardcoded values

- Colors, radii, shadows, spacing, and type all come from tokens: CSS vars
  (`var(--accent)`, `var(--surface)`, …) or their Tailwind aliases
  (`bg-surface`, `text-ink`, `rounded-card`, `shadow-sh-2`). **No hardcoded
  hex / `rgb()`** in component code.
- Prefer Tailwind utilities (bound to tokens in `tailwind.config.js`) over
  new inline `style={{}}`. Inline styles are for genuinely dynamic values.
- Don't invent off-scale sizes (`text-[13px]`); use the type-scale tokens.

## Composing classes

- Use `cn()` (`lib/cn.ts` — clsx + tailwind-merge) for any conditional or
  merged class list. Don't hand-concatenate template strings.
- New primitives express their variants with `cva()` (see `Badge`,
  `Switch`, `Checkbox` for the pattern). Prefer TypeScript (`.tsx`).

## The guardrail is a ratchet

`check:design-system` counts anti-patterns — raw `<button>`/`<input>`/
`<textarea>`/`<select>`, hand-rolled `role="dialog"` overlays, hardcoded hex
colors, raw px spacing/radii and `boxShadow` in inline styles, and native
`title=` tooltips — and fails CI only when a count **rises** above
`scripts/design-system-baseline.json`. So:

- You can't add a new raw `<button>` / hardcoded color — but you're not
  blocked on the existing backlog either.
- After a sweep that removes violations, **lower the baseline**:
  `npm run check:design-system -- --update`, then commit the JSON.
- Never raise a baseline number to make CI pass (same rule as the vitest
  coverage floors).
