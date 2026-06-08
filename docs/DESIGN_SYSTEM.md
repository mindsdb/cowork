# Cowork Design System

> The single source of truth for UI patterns, tokens, and component usage in the cowork app.
> When in doubt, follow this document. If you find code that contradicts it, the code needs updating.

---

## Architecture

**Stack:** React + Tailwind CSS + CSS custom properties (light/dark theming)

**Styling approach:** Tailwind utility classes. All new code should use Tailwind. Legacy CSS classes (`.btn`, `.field-input`, `.card`, etc. in `globals.css`) still exist and work, but should be migrated to Tailwind over time.

**Headless primitives:** [Radix Primitives](https://www.radix-ui.com/primitives) for interactive patterns (Dialog, DropdownMenu, Tabs, Tooltip, Toggle). Use Radix for behavior + accessibility; style with Tailwind.

**No inline `style={{}}` objects.** Use Tailwind classes. The only exception is truly dynamic values computed at runtime (e.g., positioning a menu at a calculated pixel offset).

---

## Tokens

All design tokens are CSS custom properties defined in `styles/globals.css` and mapped to Tailwind in `tailwind.config.js`. They switch automatically between light and dark themes via `body[data-theme]`.

### Colors

Use these Tailwind classes. Never hardcode hex/rgb values in components.

| Token | Tailwind class | Purpose |
|-------|---------------|---------|
| `--bg` | `bg-bg` | Page background |
| `--surface` | `bg-surface` | Primary surface (cards, panels) |
| `--surface-2` | `bg-surface-2` | Secondary surface (hover states, nested containers) |
| `--surface-3` | `bg-surface-3` | Tertiary surface (active states, wells) |
| `--ink` | `text-ink` | Primary text (headings, strong emphasis) |
| `--ink-2` | `text-ink-2` | Body text (default readable text) |
| `--ink-3` | `text-ink-3` | Secondary text (labels, captions) |
| `--ink-4` | `text-ink-4` | Placeholder text, tertiary labels |
| `--ink-5` | `text-ink-5` | Disabled text |
| `--line` | `border-line` | Primary borders |
| `--line-2` | `border-line-2` | Strong borders (dividers, active outlines) |
| `--accent` | `text-accent`, `bg-accent` | Brand accent (teal/cyan) |
| `--accent-bg` | `bg-accent-bg` | Accent wash (tinted backgrounds) |
| `--danger` | `text-danger` | Error/destructive actions |
| `--danger-bg` | `bg-[var(--danger-bg)]` | Error background wash |
| `--success` | `text-success` | Active/online indicators |

**Never use `#fff`, `#000`, or raw hex in components.** Use `text-ink` / `bg-surface` / etc. Raw values break theming.

### Typography

Three font families, three jobs:

| Family | Tailwind | Use for |
|--------|----------|---------|
| Inter | `font-body` | Everything: headings, body, buttons, labels, UI chrome |
| Josefin Sans | `font-display` | Display only: hero text, app name moments, marketing |
| JetBrains Mono | `font-mono` | Strings: code, file paths, IDs, keyboard shortcuts, timestamps |

#### Font size scale

Use only these sizes. Add them to `tailwind.config.js` `theme.extend.fontSize` as named utilities:

| Name | Size | Line height | Tailwind | Use for |
|------|------|-------------|----------|---------|
| `2xs` | 10.5px | 1.4 | `text-2xs` | Keyboard shortcuts, fine print |
| `xs` | 12px | 1.4 | `text-xs` | Timestamps, metadata, badges |
| `sm` | 13px | 1.45 | `text-sm` | Navigation items, secondary labels, small buttons |
| `base` | 14.5px | 1.55 | `text-base` | Body text (default) |
| `lg` | 16px | 1.5 | `text-lg` | Section headings, modal titles |
| `xl` | 18px | 1.4 | `text-xl` | Page headings |
| `2xl` | 28px | 1.15 | `text-2xl` | Hero / display headings |
| `3xl` | 44px | 1.05 | `text-3xl` | Display-only (Josefin Sans) |

**Do not use arbitrary font sizes** like `text-[12.5px]` or `fontSize: 11`. Pick the nearest scale stop.

#### Font weight scale

| Weight | Tailwind | Use for |
|--------|----------|---------|
| 400 | `font-normal` | Body text, descriptions |
| 500 | `font-medium` | Labels, nav items, input values |
| 600 | `font-semibold` | Buttons, headings, section titles |

### Spacing

Use Tailwind's default spacing scale (multiples of 4px). These are the most common stops:

| Value | Tailwind | Common uses |
|-------|----------|-------------|
| 4px | `p-1`, `gap-1` | Tight icon gaps, inline spacing |
| 8px | `p-2`, `gap-2` | Button icon gaps, compact padding |
| 12px | `p-3`, `gap-3` | Small card padding, form field padding |
| 16px | `p-4`, `gap-4` | Standard card padding, section gaps |
| 20px | `p-5`, `gap-5` | Modal padding, generous spacing |
| 24px | `p-6`, `gap-6` | Large card padding, page margins |

**Do not use arbitrary spacing** like `p-[14px]` or `padding: '9px 11px'`. Pick the nearest scale stop.

### Border radius

| Token | Value | Tailwind | Use for |
|-------|-------|----------|---------|
| `--r-sm` | 4px | `rounded-sm` or `rounded` | Small chips, tags |
| `--r` | 6px | `rounded-md` | Buttons, inputs, cards, menus (default) |
| `--r-lg` | 10px | `rounded-lg` | Modals, large cards |
| `--r-xl` | 16px | `rounded-xl` | Hero cards, onboarding surfaces |
| pill | 9999px | `rounded-full` | Pills, avatar badges |

**Default radius is 6px (`rounded-md`).** Use this unless you have a specific reason for another value. Never use 7px or 8px.

### Shadows

| Token | Tailwind | Use for |
|-------|----------|---------|
| `--sh-1` | `shadow-[var(--sh-1)]` | Cards, subtle elevation |
| `--sh-2` | `shadow-[var(--sh-2)]` | Floating menus, popovers |
| `--sh-3` | `shadow-[var(--sh-3)]` | Modals, overlays |
| `--ring` | `ring-[3px] ring-accent/30` | Focus indicators |

Do not create custom box-shadow values inline. Use the token.

---

## Components

### Existing UI primitives

Import from `components/ui`:

```jsx
import { Button, Input, Textarea, Card, Bubble, Eyebrow, Pill, Spinner } from '../components/ui';
```

These are thin wrappers around CSS classes from `globals.css`. They are the correct way to render these elements today. **Do not reimplement buttons/inputs/cards with inline styles.**

### Button

```jsx
<Button variant="primary">Save</Button>        // accent fill + glow
<Button>Cancel</Button>                          // neutral (default)
<Button variant="subtle">Skip</Button>          // borderless, muted
<Button variant="tinted">Compose</Button>        // accent border + light fill
<Button variant="danger" size="sm">Delete</Button>
<Button icon size="sm" aria-label="Search"><SearchIcon /></Button>
```

**Variants:** `default` | `primary` | `subtle` | `tinted` | `danger`
**Sizes:** `xs` (24px) | `sm` (28px) | `md` (32px, default) | `lg` (36px) | `xl` (44px)
**Modifiers:** `icon` (square), `block` (full-width)

Do not create ad-hoc button styles with inline padding/borderRadius. Use `<Button>`.

### Input / Textarea

```jsx
<Input value={v} onChange={setV} placeholder="Name..." />
<Input variant="mono" size="sm" />
<Textarea value={v} onChange={setV} rows={4} />
```

### Card / Bubble

```jsx
<Card>Default (24px padding)</Card>
<Card padding="compact">16px padding</Card>
<Card padding="snug">12px padding</Card>
<Card flat>No shadow</Card>
<Bubble>Floating glassy surface</Bubble>
```

### Modal

```jsx
import Modal, { ModalHeader, ModalBody, ModalFooter } from '../components/ui/Modal';

<Modal open={open} onClose={close} size="md">
  <ModalHeader title="Confirm" onClose={close} />
  <ModalBody>Are you sure?</ModalBody>
  <ModalFooter>
    <Button variant="subtle" onClick={close}>Cancel</Button>
    <Button variant="primary" onClick={confirm}>Confirm</Button>
  </ModalFooter>
</Modal>
```

**Sizes:** `sm` (420px) | `md` (540px) | `lg` (720px)

All dialogs must use `<Modal>`. Do not build custom overlay/backdrop implementations.

### Eyebrow

```jsx
<Eyebrow>Section label</Eyebrow>  // small uppercase mono label
```

### Pill

```jsx
<Pill>Beta</Pill>
<Pill variant="muted">Optional</Pill>
<Pill variant="danger">Failed</Pill>
```

---

## Interactive Primitives (Radix)

All interactive patterns below are pre-built in `components/ui`, styled with Tailwind, and powered by Radix for accessibility. **Import them from the barrel — don't use raw Radix imports.**

```jsx
import { Dialog, DialogHeader, DialogBody, DialogFooter, DialogClose } from '../components/ui';
import { Menu, MenuTrigger, MenuContent, MenuItem, MenuSeparator } from '../components/ui';
import { Tooltip, TooltipProvider } from '../components/ui';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui';
import { Switch } from '../components/ui';
import { Popover, PopoverTrigger, PopoverContent } from '../components/ui';
import { cn } from '../components/ui';
```

### Dialog

Replaces custom modal implementations. Focus trap, scroll lock, Esc to close — all handled.

```jsx
<Dialog open={open} onOpenChange={setOpen} size="md">
  <DialogHeader title="Confirm action" onClose={() => setOpen(false)} />
  <DialogBody>Are you sure you want to continue?</DialogBody>
  <DialogFooter>
    <DialogClose asChild><Button variant="subtle">Cancel</Button></DialogClose>
    <Button variant="primary" onClick={save}>Save</Button>
  </DialogFooter>
</Dialog>
```

**Sizes:** `sm` (420px) | `md` (540px, default) | `lg` (720px)
**Layers:** `default` (z-80) | `system` (z-1200, overlays title bar)

### Menu

Replaces hand-rolled dropdown menus. Full keyboard navigation, submenus, ARIA roles.

```jsx
<Menu>
  <MenuTrigger asChild>
    <Button icon size="sm" aria-label="Options"><MoreIcon /></Button>
  </MenuTrigger>
  <MenuContent>
    <MenuItem onSelect={edit}>Edit</MenuItem>
    <MenuItem onSelect={duplicate}>Duplicate</MenuItem>
    <MenuSeparator />
    <MenuItem variant="danger" onSelect={remove}>Delete</MenuItem>
  </MenuContent>
</Menu>
```

With submenus:

```jsx
<MenuSub>
  <MenuSubTrigger>Move to...</MenuSubTrigger>
  <MenuSubContent>
    <MenuItem onSelect={() => move('a')}>Project A</MenuItem>
    <MenuItem onSelect={() => move('b')}>Project B</MenuItem>
  </MenuSubContent>
</MenuSub>
```

### Tooltip

Replaces native `title` attributes. Accessible, animated, themed.

```jsx
<Tooltip content="Search projects">
  <Button icon size="sm"><SearchIcon /></Button>
</Tooltip>
```

Wrap the app root with `<TooltipProvider>` once.

### Tabs

Full arrow-key navigation, active indicator, accessible.

```jsx
<Tabs defaultValue="general">
  <TabsList>
    <TabsTrigger value="general">General</TabsTrigger>
    <TabsTrigger value="advanced">Advanced</TabsTrigger>
  </TabsList>
  <TabsContent value="general">General settings here</TabsContent>
  <TabsContent value="advanced">Advanced settings here</TabsContent>
</Tabs>
```

### Switch

Accessible toggle with keyboard support.

```jsx
<label className="flex items-center gap-2 text-sm text-ink-2">
  <Switch checked={on} onCheckedChange={setOn} />
  Enable notifications
</label>
```

**Sizes:** `sm` (28x16) | `md` (36x20, default)

### Popover

Floating content anchored to a trigger (filters, mini-forms, etc.).

```jsx
<Popover>
  <PopoverTrigger asChild>
    <Button icon size="sm"><FilterIcon /></Button>
  </PopoverTrigger>
  <PopoverContent>
    Filter options here
  </PopoverContent>
</Popover>
```

### `cn()` utility

Use `cn()` (clsx + tailwind-merge) to compose class names with conflict resolution:

```jsx
import { cn } from '../components/ui';

<div className={cn('p-4 text-ink-2', isActive && 'bg-accent-bg text-accent', className)}>
```

---

## Patterns and Rules

### Do

- Use Tailwind utility classes for all styling
- Use design tokens (CSS variables via Tailwind mappings) for colors, shadows, radii
- Use `<Button>`, `<Input>`, `<Card>`, `<Modal>` from `components/ui` for standard elements
- Use Radix Primitives for interactive patterns (dialogs, menus, tooltips, tabs)
- Use the font size scale (`text-2xs` through `text-3xl`) -- do not invent sizes
- Use Tailwind's spacing scale (multiples of 4px) -- do not invent spacing
- Use `rounded-md` (6px) as the default border radius
- Use `font-body` for all UI text, `font-mono` for code/paths/IDs, `font-display` for hero text only
- Ensure all interactive elements are keyboard navigable and have ARIA attributes
- Support both light and dark themes via tokens (never hardcode colors)

### Don't

- Don't use `style={{}}` inline style objects (except for truly dynamic computed values)
- Don't hardcode colors (`#fff`, `#000`, `rgb(...)`) -- use token classes
- Don't create custom button/input/card implementations -- use the existing components
- Don't use arbitrary Tailwind values (`text-[12.5px]`, `p-[14px]`) -- use the scale
- Don't mix CSS class approaches (`.btn` classes and Tailwind on the same element)
- Don't use `font-weight: 700` or `font-bold` -- the weight scale stops at 600 (`font-semibold`)
- Don't add new CSS classes to `globals.css` -- use Tailwind utilities or component composition
- Don't build custom focus/hover/active states -- use Tailwind's `hover:`, `focus-visible:`, `active:` modifiers

### Accessibility

- All interactive elements must be keyboard accessible (Tab, Enter, Escape, Arrow keys where appropriate)
- Modals must trap focus and restore it on close
- Use `focus-visible:ring` for focus indicators (not `focus:`)
- Menus must support arrow-key navigation (use Radix)
- Images and icon-only buttons need `aria-label`
- Respect `prefers-reduced-motion` -- avoid infinite animations or provide `motion-reduce:` variants
- Use semantic HTML (`<button>`, `<nav>`, `<main>`, `<dialog>`) over generic `<div>`

### Dark mode

All theming happens through CSS variables. You don't need to write `dark:` Tailwind variants for token-based colors -- they switch automatically. Only use `dark:` for overrides that genuinely differ in logic (e.g., a different opacity or blend mode).

---

## Migration Guide

### Legacy patterns to update

These patterns exist in the codebase and should be migrated when you touch the relevant files:

1. **Inline `style={{}}` objects** -> Tailwind classes
2. **Hardcoded `#fff` / `color: 'white'`** -> `text-ink` or `bg-surface`
3. **Arbitrary font sizes** (`fontSize: 11`, `text-[12.5px]`) -> nearest scale stop
4. **Arbitrary padding** (`padding: '9px 11px'`) -> nearest Tailwind spacing
5. **Custom border radius** (`borderRadius: 7`, `borderRadius: 8`) -> `rounded-md` (6px)
6. **Custom box-shadow** -> `shadow-[var(--sh-1)]` / `--sh-2` / `--sh-3`
7. **Custom modal implementations** -> `<Modal>` from `components/ui` (and eventually Radix Dialog)
8. **Custom menu implementations** -> Radix DropdownMenu
9. **Legacy CSS class aliases** (`--surface-01`, `--border-0`, `--text-primary`) -> canonical tokens (`--surface-2`, `--line`, `--ink-2`)

### Incremental approach

Don't rewrite everything at once. When you modify a file:
1. Convert any inline styles in the code you're touching to Tailwind
2. Replace any hardcoded colors with tokens
3. Normalize font sizes and spacing to the scale
4. If the file has a custom modal/menu, consider migrating to Radix

---

## File Reference

| File | Purpose |
|------|---------|
| `styles/globals.css` | CSS custom properties (tokens), font-face declarations, legacy CSS classes |
| `styles/tailwind.css` | Tailwind entry point (`@tailwind` directives) |
| `tailwind.config.js` | Tailwind theme: maps CSS vars to utility classes, font size scale, radii, shadows |
| `components/ui/index.js` | Barrel export for all UI primitives |
| `components/ui/cn.js` | `cn()` utility (clsx + tailwind-merge) |
| **Core components** | |
| `components/ui/Button.jsx` | Button component (wraps `.btn` classes) |
| `components/ui/Input.jsx` | Input + Textarea components |
| `components/ui/Card.jsx` | Card + Bubble surface components |
| `components/ui/Eyebrow.jsx` | Small uppercase section label |
| `components/ui/Pill.jsx` | Compact rounded badge |
| `components/ui/Spinner.jsx` | Braille-dot CLI-style spinner |
| **Radix primitives** | |
| `components/ui/Dialog.jsx` | Dialog + DialogHeader/Body/Footer/Close (replaces Modal.jsx) |
| `components/ui/Menu.jsx` | Dropdown menu with items, separators, submenus |
| `components/ui/Tooltip.jsx` | Tooltip + TooltipProvider |
| `components/ui/Tabs.jsx` | Tabs + TabsList/Trigger/Content |
| `components/ui/Switch.jsx` | Toggle switch (sm/md) |
| `components/ui/Popover.jsx` | Floating anchored popover |
| **Legacy (migrate away)** | |
| `components/ui/Modal.jsx` | Original modal — use Dialog.jsx for new code |
