# UI Polish — PR Breakout Plan

Source branch: `polish/soften-borders-shadows`

This branch accumulated several layers of changes. This document tracks
the breakout into focused PRs that can be reviewed and merged independently.

All branches are **stacked**: each builds on the previous one.
Base: commit `140c8e9` (staging tip — last reviewed commit before polish work).

---

## 0. Staging merge (already-reviewed PRs)

25 commits with PR numbers that were already reviewed and merged to staging.
Auth fixes, features (drag-and-drop, artifact cards, out-of-credits), infra
(rename to MindsHub Cowork), and foundational UI (ToggleGroup, cva/tailwind-merge,
tokens).

**Status:** TODO — merge staging → main first to get the base clean.

---

## A. CSS token / shadow / border cleanup

Low risk, CSS-only, no behavioral change.

- Shadow tokens aligned to brandbook (`--sh-1` through `--sh-modal`)
- `--ring` thinned (3px → 1px, lower opacity)
- Status color tokens (`--ok`, `--warn`) with backward-compat aliases
- `--line-soft` token added
- `font-feature-settings` on body (`'cv11', 'ss01', 'ss03'`)
- Base micro-interaction transition rule on interactive elements
- `focus-visible` changed from thick outline to subtle box-shadow (5 sites)
- Hardcoded border/bg colors → token references (~15 in customize section)
- Composer, artifact-card, schedule-form shadow softening
- Channels-input aligned to token system

**Files:** `globals.css` (token definitions, shadow/radius values)

**Branch:** `polish/a-tokens-shadows-borders`
**Status:** DONE ✓

---

## B. Button class system

Low risk. Overhaul of `.btn` class hierarchy.

- `.btn`: white surface with hairline border + subtle shadow (was transparent + glow)
- `.btn--primary`: filled accent (was transparent + accent border)
- `.btn--subtle`: borderless (was transparent + dim color)
- `.btn--tinted`, `.btn--danger` variants
- BEM size variants (`--xs`, `--sm`, `--lg`, `--xl`)
- Legacy aliases (`.btn-primary`, `.btn-secondary`, `.btn-ghost`) preserved
- `btn-new-task` redesigned to neutral surface style

**Files:** `globals.css`

**Branch:** `polish/b-button-classes`
**Status:** DONE ✓

---

## C. Card & icon-button class system

Low risk. Replaces inline JS hover handlers with pure CSS classes.

- `.cw-card` — unified interactive card hover (border + shadow, no translate)
- `.cw-card--static` — non-interactive variant
- `.icon-btn` / `.icon-btn--sm` / `.icon-btn--lg` — small toolbar buttons
- `.crumb-btn` — breadcrumb navigation buttons
- Removes ~15 `onMouseOver`/`onMouseOut` inline handlers
- Component migrations: TaskCard, ScheduleCard, ProjectCard, Sidebar,
  DataVaultFormPanel, ChatView, ArtifactsView, ProjectsView, ScheduleDetailView,
  NewProjectModal

**Files:** `globals.css` + 12 component files

**Branch:** `polish/c-card-icon-btn-classes`
**Status:** DONE ✓

---

## D. Input consistency

Low-medium risk. Unifies input styling on `.field-input` / `.field-textarea`.

- `.customize-input`: hardcoded → token system (font, radius, colors, hover)
- `.dialog-input` / `.schedule-form`: aligned to field-input tokens
- ScheduleTaskModal: removed stale `fieldInput`/`fieldSelect` constants
- MoveToProjectModal, DataVaultForm, UtilitiesView: migrated to className

**Files:** `globals.css` + ScheduleTaskModal, MoveToProjectModal,
DataVaultForm, UtilitiesView

**Branch:** `polish/d-input-consistency`
**Status:** DONE ✓

---

## E. Sidebar & nav active-state + ToggleGroup sizing

Needs visual review — changes look & feel noticeably.

- Removed font-weight toggling on active state (fixes content shift)
  - `.nav-item`: constant weight 500, removed from `.active`
  - `.app-sidebar .nav-item.active`: lighter bg (`--surface`), no accent bar
  - `.menu-item.checked`: removed weight bump
  - SettingsView nav tabs: constant `fontWeight: 500`
- ToggleGroup selected state: lighter bg (`--surface`) + shadow
- ToggleGroup `md` size bumped (padding 7px, font 13px)
- Section label: tighter letter-spacing

**Files:** `globals.css`, SettingsView, ToggleGroup.tsx

**Branch:** `polish/e-active-states-toggle`
**Status:** DONE ✓

---

## F. Typography & color palette

Biggest visual change — needs review.

- Display font → body font sweep (headings, labels, overlines, chat)
- Frost palette 500-900 → ink neutral scale alignment
- Stone palette → neutral (no warm tint)
- Light mode surfaces: brandbook-neutral scale
- Sidebar bg: lightened to `#F4F4F4`
- Dark mode borders: rgba for subtlety
- Letter-spacing normalization throughout
- Component migrations: ServerOfflineHelpModal, ConfirmModal, RecentsModal,
  CustomizeView, HomeView, ScheduledView, TasksView, + others

**Files:** `globals.css` + 22 files (broad sweep)

**Branch:** `polish/f-typography-palette`
**Status:** DONE ✓

---

## Verification

The stacked branches reconstruct the exact same final state as the original
`polish/soften-borders-shadows` branch. Verified with:
```
git diff polish/soften-borders-shadows polish/f-typography-palette -- src/renderer/
# → empty (0 diff lines)
```
