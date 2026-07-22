# Anton Cowork — UI Cohesion Plan

*A shared, living plan for tightening the app's look & feel toward the calm, modern feel of
apps like Claude and Codex — surface by surface, using one consistent method.*

**Status:** draft for team review · **Owners:** _(add names)_ · **Last updated:** 2026-07-14

> How to use this doc: it is the source of truth for the cohesion effort. Each UI surface gets
> explored with the **same prompt** (below) so every area gets the same treatment, and each
> exploration produces an **artifact + optional PR** tracked in the **Coverage Map**. Comment
> inline; propose reprioritization; claim a surface by putting your name in the Owner column.

---

## 1. The thesis

The cleanup work already landed the right **foundation** — one teal accent (`#1F9CB0`), a neutral
ink scale, and design tokens (color, radius, shadow, type) enforced across the stylesheet. The
palette is not the problem.

What still dates the app is **chrome and density**: bordered chat bubbles, ~69 hard `1px` dividers,
tight spacing, and small inconsistencies (three different "active" fills, cards that carry a border
*and* a shadow). Modern AI chat isn't more colorful than Anton — it's **quieter**. The whole effort
is about spending that same system with more restraint.

## 2. Design principles (the north star)

Every surface exploration is judged against these. When in doubt, choose the quieter option.

1. **Fewer edges.** Prefer whitespace and a faint surface shift over a drawn `1px` border. Keep
   borders only where they carry meaning (text inputs, selectable rows).
2. **Softer fills.** A tinted surface (`--surface-2`, `--accent-bg`) reads more modern than an
   outlined box.
3. **One meaningful accent.** Teal signals action and state — never decoration. "Where you are"
   and "what's primary" earn the accent; nothing else does.
4. **Generous rhythm.** Space between things; comfortable line-height. Density is not efficiency.
5. **One system, everywhere.** Same radius / shadow / spacing / type / interaction tokens in every
   corner. No bespoke values, no per-view reinvention.
6. **Quiet motion.** Subtle, consistent easing; motion serves orientation, not spectacle.
7. **Same universe as Claude & Codex.** Calm, airy, confident. Modern = quieter, not louder.

**Hard constraints:** do **not** change the palette. Stay on the existing token scale. Prefer
removing chrome over adding it. Every proposed value must already exist as a token (or be a
principled new token, called out explicitly).

## 3. Reusable surface-exploration prompt

Paste this at the start of each surface's exploration so every area gets an identical treatment.
Replace `{{SURFACE}}` with the target (e.g. "Settings view", "Connect / Customize", "Forms & controls").

```
You are doing a design-eye cohesion audit of ONE surface of the Anton Cowork desktop app:
{{SURFACE}}. This is part of an app-wide effort tracked in docs/ui-cohesion-plan.md — treat
every surface the same way and align to that plan's principles.

North star (from the plan): fewer edges · softer fills · one meaningful teal accent ·
generous rhythm · one system everywhere · quiet motion · "modern = quieter, not louder."

Method:
1. Find the REAL implementation. Identify the view/component files and the CSS classes/tokens
   this surface actually uses. Read the code — do not guess. Confirm which classes are live vs
   dead (grep the components).
2. Reconstruct the CURRENT look from the real values (colors, borders, radii, shadows, spacing,
   type, hover/active states). Note where it diverges from the token system or the principles.
3. Propose specific, prioritized MOVES toward the north star. Each move states: what · why ·
   current → proposed (real CSS on the existing token scale) · impact (High/Med/Low) · effort.
4. Constraints: never change the palette; stay on existing tokens (flag any genuinely-new token);
   prefer removing chrome over adding it; cite real file:line; keep every change revertible; if
   you build, verify `npm run build:web` compiles clean.
5. Output: a short current-state read + a ranked list of moves + a before/after reconstruction
   built from the real token values (label it "reconstructed from CSS," not a live screenshot).

Deliverable: match the format of the design-direction artifact (numbered move cards with
current/proposed CSS diffs and impact tags). Then update the Coverage Map row for this surface
with the artifact/PR link and status.
```

## 4. Coverage map

Legend: ✅ assessed (moves proposed) · 🟡 partial · ⬜ not started

### Core chrome
| Surface | Status | Artifact / PR | Owner | Notes |
|---|---|---|---|---|
| Chat conversation (turns) | ✅ | Design Direction artifact (moves 01–02, 05) | — | de-bubble user turn; rhythm; assistant mark |
| Composer | ✅ | Design Direction (move 03) | — | calmer focus, larger radius, token shadow |
| Sidebar / nav / recents | ✅ | Design Direction (move 06) | — | roomier rows, accent-aware active |
| Cards (generic) | ✅ | Design Direction (move 07) | — | one elevation language, one radius |
| Menus / popovers | ✅ | Design Direction (move 08) | — | float on shadow, drop the border |
| Interaction states (hover/active) | ✅ | Design Direction (move 09) | — | one hover token, one active token |

### Views — not yet assessed
| Surface | Status | Artifact / PR | Owner | Notes |
|---|---|---|---|---|
| Home (boot / greeting / orb) | ⬜ | — | — | only the composer is covered; the boot moment isn't |
| Connect / Customize | ⬜ | — | — | **largest surface (191 classes)**; colors/radii tokenized, design not |
| Settings | ⬜ | — | — | forms-heavy; density + hierarchy |
| Channels (multi-agent) | ⬜ | — | — | 65 classes; tables, badges, agent tabs |
| Projects (view + cards) | ⬜ | — | — | ProjectCard, New/Move modals |
| Skills (view + cards) | ⬜ | — | — | SkillCard, skill detail |
| Tasks (list + rows) | ⬜ | — | — | data density; row hover/active |
| Scheduled / Schedule detail | ⬜ | — | — | schedule form, rail |
| Artifacts (view + cards) | ⬜ | — | — | artifact card, status pills |
| Dispatch (pairing / QR) | ⬜ | — | — | colors tokenized; layout not |
| Utilities | ⬜ | — | — | — |
| Mobile shell (`mshell`) | ⬜ | — | — | **entire responsive layout (59 classes), untouched** |

### Cross-cutting systems / dimensions — not yet assessed
| Dimension | Status | Artifact / PR | Owner | Notes |
|---|---|---|---|---|
| Forms & controls | ⬜ | — | — | Input, Checkbox, Switch, ToggleGroup, selects — one family? |
| Feedback | ⬜ | — | — | Toast, Tooltip, Spinner, status pills, banners, errors |
| Empty & loading states | ⬜ | — | — | zero-data + skeletons; where "considered" shows |
| Iconography | ⬜ | — | — | weight/size/consistency (Icons.jsx) |
| Data viz | ⬜ | — | — | charts in messages (MessageChart) |
| Motion | ⬜ | — | — | transition/easing consistency; boot choreography |
| Density & information hierarchy | ⬜ | — | — | channels tables, tasks, settings |
| Dark mode (holistic) | ⬜ | — | — | accent hue divergence flagged; needs a full pass |
| Onboarding (first impression) | ⬜ | — | — | Terms/Setup/Onboarding — still on legacy stylesheet |

## 4a. Linear tickets

All under epic **ENG-641 — UI Design System** (team Engineering · project MindsHub Cowork).

| Surface / workstream | Ticket | Notes |
|---|---|---|
| Design token audit & cleanup | ENG-637 | ✅ Done — grays/palette/radius/shadow/type (PRs #400/#402/#403/#404/#405) |
| Chat: de-bubble, calmer composer, rhythm | ENG-787 | moves 01–03, 05 · highest-impact visible change |
| Connect / Customize view | ENG-792 | largest surface; preserve connector brand colors |
| Surfaces, cards & interaction states (app-wide) | ENG-791 | cross-cutting moves 04/07/08/09 · highest leverage |
| Holistic dark-mode pass | ENG-793 | dark accent decision + newly-theme-aware views + WCAG |
| Skills page | ENG-788 | run §3 prompt first |
| Scheduled tasks pages | ENG-790 | ⚠️ may need deeper product/UX review, not just design |
| Empty & loading states | ENG-794 | cross-cutting |
| Feedback (toasts/tooltips/status/banners) | ENG-795 | cross-cutting; "status is quiet" rule |
| Sidebar redesign | ENG-640 | pre-existing; fold in move 06 (roomier rows + accent active) |
| Base UI primitives (Button/Input/Dialog) | ENG-639 | pre-existing; complements the "surfaces & states" ticket |
| Icons · fonts · markdown | ENG-634 / 635 / 636 / 638 | pre-existing design-system tickets |

Not yet ticketed (create when prioritized): Channels, Home (boot/greeting), Projects, Tasks, Artifacts, Utilities, Onboarding, motion, data viz, and the **mobile shell** (`mshell`) — the last needs a product call on whether mobile/responsive is in scope for the desktop app.

## 5. Moves proposed so far

From the Design Direction artifact (chat + core chrome). Sequenced by impact-per-effort.

| # | Move | Surface | Impact |
|---|---|---|---|
| 01 | De-bubble the user message (drop border/shadow → soft tint) | Chat | High |
| 02 | Give the conversation room (turn gap 16→28, line-height 1.6→1.7) | Chat | High |
| 03 | Calm the composer (r-12→r-xl, token shadow, quiet focus) | Composer | High |
| 04 | Retire hairline dividers (start: chat header bottom border) | App-wide | Medium |
| 05 | Anchor the assistant with a quiet mark | Chat | Medium |
| 06 | Sidebar: roomier rows + accent-aware active state | Sidebar | High |
| 07 | Cards: one elevation language (border OR shadow), one radius | Cards | High |
| 08 | Let menus/popovers float (drop border, keep shadow) | Menus | Medium |
| 09 | Unify interaction states (one hover token, one active token) | App-wide | Medium |

**Suggested first build batch:** 01–03 + 06 (small, high-visibility, no new components), then the
border/card/state sweep (04, 07, 08, 09), then the assistant mark (05).

## 6. How we'll work

- One surface at a time, using the prompt in §3. Keep this the single source of truth.
- Each exploration → an artifact (visual) and, when we build, a **draft PR against `staging`**,
  scoped and verified (`npm run build:web`), consistent with the cleanup PRs already merged
  (#400 gray, #402 palette, #403 radius, #404 shadow, #405 type).
- Log every artifact/PR in the Coverage Map so we always know the state of the board.
- Palette is frozen. Everything rides the existing token scale. Restraint over addition.

---

*Companion artifact (interactive, with before/after reconstructions): the "Anton — Look & Feel
Direction" artifact. This doc is the plan of record; the artifact is the visual reference.*
