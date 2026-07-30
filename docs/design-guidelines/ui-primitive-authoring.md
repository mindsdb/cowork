# Authoring `components/ui/` primitives

One way to build a primitive, so accessibility, theming, and behaviour are
fixed in one place. Part of the design-system effort (ENG-641 / ENG-1018).
The reference implementations are **`Badge.tsx`** (variant-bearing) and
**`Spinner.tsx` / `Crumb.tsx`** (variant-free).

## The pattern

1. **TypeScript.** New and retrofitted primitives are `.tsx` with a `Props`
   interface. Extend the native element props
   (`React.HTMLAttributes<HTMLSpanElement>`, `ComponentPropsWithoutRef<'…'>`)
   so callers keep every standard attribute.
2. **`cn()` for classes.** Compose/merge classes with `cn` (`lib/cn.ts` —
   clsx + tailwind-merge). Never hand-concatenate template strings or
   `.filter(Boolean).join(' ')`.
3. **`cva()` for variants — only when there are variants.** A primitive with
   a `variant`/`size`/tone axis defines them with `class-variance-authority`
   (see `Badge.tsx`). A primitive with **no** variants (Spinner, Crumb) just
   uses `cn()` — don't add cva for its own sake.
4. **Tailwind tokens, not inline styles.** Style with token-backed utilities
   (`bg-surface-2`, `text-ink`, `gap-2`, `rounded-card`). Inline `style={{}}`
   is only for genuinely dynamic values (e.g. a `maxWidth` prop).
5. **`className` is a layout-only escape hatch.** It appends via `cn`; it must
   never select a style *treatment* (that's what `variant` is for).
6. **`forwardRef`** when the primitive wraps a focusable/measured element
   (`Button`, `Input`, `Card`), so it can be composed and focused.
7. **Interaction via CSS, not JS.** Hover/active/disabled are `hover:` /
   `disabled:` / data-attribute utilities — not `onMouseEnter`/`onMouseOver`
   handlers that mutate `style`.

### Gotcha: token colors + Tailwind modifiers

Our color tokens are `var(--…)` references in `tailwind.config.js`, so the
opacity modifier (`bg-danger/10`, `border-accent/30`) silently emits **no
CSS**. Use the dedicated pre-mixed tokens (`bg-danger-bg`,
`border-danger-border`) or an arbitrary `color-mix(...)` value. See the long
note in `Badge.tsx` for the full explanation.

## Retrofit checklist

- [ ] Rename `.jsx` → `.tsx`; add a `Props` interface.
- [ ] Replace class concatenation with `cn()`; extract variants to `cva()` if any.
- [ ] Replace static inline styles with token utilities; keep only dynamic styles.
- [ ] Replace JS hover/active handlers with `hover:`/`data-*` utilities.
- [ ] Update the barrel (`index.js`) if the extension changed; update any
      path imports that pin `.jsx`.
- [ ] `npm run typecheck && npm run build:web`; run the component's test if it has one.

## Status

| Primitive | cva | cn | TS | Notes |
|---|---|---|---|---|
| Badge, Switch, Checkbox | ✅ | ✅ | ✅ | reference (variant-bearing) |
| Menu, Select | ✅ | ✅ | — (.jsx) | cva + cn, but still `.jsx` |
| Spinner, Crumb | n/a | ✅ | ✅ | retrofitted (ENG-1018); variant-free |
| Button, Input | n/a | — | ✅ | `.tsx`, forwardRef; hand-join legacy `.btn`/`.field-*` classes by design |
| Card | ✅ | ✅ | ✅ | retrofitted (ENG-1018) — cva variants incl. a `selected`+`tinted` compound; exact-string test kept green |
| Message | ✅ | ✅ | ✅ | retrofitted (ENG-1018) — variants → cva |
| Kbd, Eyebrow | n/a | ✅ | ✅ | retrofitted (ENG-1018); variant-free |
| Toast | n/a | ✅ | ✅ | retrofitted (ENG-1018) — type variants via Base UI `data-[type]`; no cva needed |
| Modal, EmptyState | ⬜ | partial | ⬜ | remaining (Modal = the ENG-1014 shell work; EmptyState's debt is ENG-1017 inline styles) |
| Alert | ✅ | ✅ | ✅ | new (ENG-1146) — cva variants danger/warning/info/success, icon + title slots |
| Field | n/a | ✅ | ✅ | new (ENG-1147) — clones the control to wire id / aria-describedby / aria-invalid |
