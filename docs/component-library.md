# Component Library Strategy

## Where we are

Cowork's UI is built from a mix of inline styles, global CSS classes, and a small set of shared primitives (`Button`, `Card`, `Pill`, `Input`, `Modal`, `Menu`, `Spinner`, `Eyebrow`). Many UI patterns — badges, status indicators, form layouts, section headers — are implemented ad-hoc in individual views, often with slight variations in spacing, color, and behavior.

This has been fine for moving fast, but as the surface area grows it introduces friction: similar-looking elements behave differently, visual tweaks require hunting through multiple files, and new pages tend to copy-paste from existing ones rather than compose from shared parts.

## Where we're headed

A more intentional component library, following conventions popularized by [shadcn/ui](https://ui.shadcn.com/):

- **Variant-driven components** using `cva` (class-variance-authority) to declare the full matrix of visual states a component supports
- **Safe class merging** via `tailwind-merge` + `clsx` (`cn()` utility) so consumers can override styles without class conflicts
- **Tailwind utilities** as the styling language, mapped to our existing CSS variable tokens (`--ink`, `--surface`, `--accent`, etc.)

## Why this matters

### Visual consistency

When every badge, card, or button is a one-off, small inconsistencies accumulate — a 10px radius here, 12px there; `--ink-2` in one place, `--ink-3` in another. Shared components with explicit variant APIs make the set of allowed visual states intentional rather than accidental.

### Rebranding and theming

Our colors and typography are already driven by CSS variables, which is good. The next step is making sure components reference those tokens through Tailwind utilities (`text-ink-2`, `bg-surface`, `border-line`) rather than hardcoded hex values or inline `var()` calls. This keeps the theming surface area in two places — `globals.css` token definitions and `tailwind.config.js` mappings — instead of scattered across dozens of files.

### Less code over time

Ad-hoc implementations tend to grow: each view adds its own hover states, focus rings, disabled styles, responsive adjustments. A shared component absorbs that complexity once. As views adopt shared primitives, the per-view code shrinks and the interesting logic (data fetching, user interactions) becomes easier to read.

### Faster development

New pages and features compose from a known set of building blocks rather than starting from scratch. The variant API serves as documentation — a developer can see at a glance what a `Badge` supports (`variant="success" size="sm"`) without reading the implementation.

### Incremental migration

This is not a rewrite. Existing components continue to work as-is. The approach is additive:

1. New components follow the `cva` + `cn()` convention (starting with `Badge`)
2. Existing components can migrate when they're next touched — not before
3. Views adopt shared primitives as they're built or refactored

## Conventions

### File structure

```
src/renderer/cowork/
  lib/
    cn.ts                  # twMerge(clsx(...)) utility
  components/
    ui/
      Badge.tsx            # cva-driven, Tailwind-styled
      Button.jsx           # existing (migrate later)
      Card.jsx             # existing (migrate later)
      ...
```

### Anatomy of a component

```tsx
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';

const buttonVariants = cva(
  // base classes shared by all variants
  'inline-flex items-center justify-center rounded-lg font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'bg-surface-2 text-ink border border-line',
        primary: 'bg-accent text-white',
        danger:  'bg-danger/10 text-danger border border-danger/30',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        md: 'h-9 px-4 text-sm',
        lg: 'h-10 px-5 text-base',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  }
);

interface Props
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: Props) {
  return (
    <button className={cn(buttonVariants({ variant, size }), className)} {...props} />
  );
}
```

Key properties:

- **All visual states are enumerated** in the `variants` object — no guessing
- **`cn()` wraps the output** so consumer `className` overrides merge correctly
- **TypeScript infers the prop types** from the variant definition via `VariantProps`
- **The component is a thin wrapper** — no internal state, no side effects, just class mapping

### When to create a shared component

A good candidate for the `ui/` directory:

- Appears (or would appear) in 2+ views with the same visual intent
- Has a clear, small variant surface (2–5 variants, 2–3 sizes)
- Is purely presentational — no data fetching, no app-specific logic

If something is only used in one view and is unlikely to be reused, an inline implementation is fine.
