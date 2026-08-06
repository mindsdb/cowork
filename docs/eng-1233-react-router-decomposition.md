# ENG-1233 — Web URL/route state via react-router (full decomposition)

**Status:** plan / not yet implemented. This branch (`paul/eng-1233-web-url-route-state-rr`, PR #582) is currently equal to `staging`. This doc seeds a **fresh, dedicated session** to build it.

## Purpose

Implement ENG-1233 (web nav state ↔ URL so refresh / deep-links / Back-Forward work on the web shell) **idiomatically with react-router, from first principles** — path-based routes, route components, and loaders — decomposing the ~4,000-line `AppCore` god component into a provider + layout + route elements.

This is the **alternative** to PR #561 (`paul/eng-1233-web-url-route-state`), which solves the same problem hand-rolled (manual `pushState`/`popstate`, a `navState` reducer, a `urlState` query-mapping layer, and a `router.jsx` shim). Only one of the two PRs should land. **Do not port #561's structure** — that was the rejected approach. Build what you'd build if react-router were the starting point.

## Non-negotiable constraints (read first)

- **Dual shell.** The app ships as an Electron desktop app **and** a headless web SPA. Electron has **no address bar**. Two entry points: `src/renderer/main.tsx` (Electron) and `src/renderer/web-main.tsx` (web). Use `createMemoryRouter` on Electron, `createBrowserRouter` on web. Everything URL-facing is gated on `host.isWeb` today; RR's memory router is the idiomatic replacement for that gating.
- **Never touch `window.antontron` directly** inside `src/renderer/cowork/` — go through `src/renderer/platform/host.ts` (`host.isWeb = !isElectron`). CI enforces this (`npm run check:cowork-purity`).
- **CodeQL `js/unvalidated-dynamic-method-call`.** Any dispatch keyed on a URL/user-controlled value (`obj[key]()`, `map.get(key)()`) trips a **high-severity** alert. Guard with `Object.hasOwn(obj, key) ? obj[key]() : …`. This bit the hand-rolled branch twice. RR's own matching avoids it, but watch any custom dispatch you add.
  - Verify via the alerts API, and wait for CodeQL to **settle** — a first-poll `neutral` can be premature:
    `gh api "repos/mindsdb/cowork/code-scanning/alerts?ref=refs/pull/582/head&state=open"`
- **StrictMode** wraps both entries — effects run twice on mount in dev. Any mount-time sync must be idempotent.
- **Validate every increment** with the CI gates before pushing:
  ```sh
  PATH="/opt/homebrew/opt/node@20/bin:$PATH" npm run typecheck:renderer   # tsc --noEmit
  PATH="/opt/homebrew/opt/node@20/bin:$PATH" npm run check:cowork-purity
  PATH="/opt/homebrew/opt/node@20/bin:$PATH" npm test                     # vitest (staging: ~9xx tests)
  PATH="/opt/homebrew/opt/node@20/bin:$PATH" npm run build:renderer       # electron renderer
  PATH="/opt/homebrew/opt/node@20/bin:$PATH" npm run build:web            # web SPA
  ```
- **Branch/PR:** commit to `paul/eng-1233-web-url-route-state-rr`; PR #582 is a **draft** based on `staging`. Push normally (no force unless resetting). Verify the remote head before pushing; report CI (esp. the bare `CodeQL` check, which hides under the passing `CodeQL · Analyze` checks).

## Domain facts (learned; don't re-derive)

- **Boot gates.** `src/renderer/App.tsx` runs the pre-cowork screen sequence (Loading → Terms → Setup → Onboarding → Intro) and renders `<CoworkApp />` only when `page === 'terminal'` (App.tsx:275). `CoworkApp.tsx` → `<CoworkRoot />` → `AppCore` (in `src/renderer/cowork/App.jsx`). **The router must wrap the cowork app, not the gates** — put `<RouterProvider>` around the cowork screen (inside App.tsx's terminal branch or inside CoworkApp), leaving onboarding non-routed.
- **The view inventory** = `AppCore`'s render switch (`src/renderer/cowork/App.jsx`, the `return (` at ~3740). Each `route === 'x' && <View/>`:
  | route | ~line | component | entity |
  |---|---|---|---|
  | home | 3914 | home/composer | — |
  | task | 3951 | `ChatView` (`currentTask`) | conversation id |
  | projects | 4003 | `ProjectsView` | project name (detail) |
  | scheduled | 4044 | scheduled list | — |
  | schedule-detail | 4069 | `ScheduleDetailView` | schedule id |
  | artifacts | 4108 | artifacts | — |
  | tasks | 4123 | tasks | — |
  | channels | 4144 | channels | — |
  | customize | 4148 | `CustomizeView` | — |
  | skills | 4250 | `SkillsView` | — |
  | (memory) | — | present in routing but check render | — |
  (Line numbers drift — re-grep `route === '` in App.jsx.)
- **Nav state today** = `route` (string) + `activeTaskId` + `selectedProject` (object) + `selectedScheduleId` + settings overlay (`settingsOpen`/`settingsSection`), all `useState` in `AppCore` (~line 766+). ~90 `setRoute`/`setActiveTaskId`/… call sites; the `Sidebar` (`src/renderer/cowork/components/Sidebar.jsx`, ~1065 lines) navigates via an `onNavigate(key)` prop (~15 sites) + `onSelectTask(id)`.
- **Conversations / loaders:**
  - `fetchSessions()` (`src/renderer/cowork/api.js:255`) returns a **capped list** — `/conversations/?project=all&limit=200`, eager messages for the first 50. So a deep-link/refresh to an **older** conversation is NOT in the list.
  - `fetchSession(id)` (`api.js:279`) fetches **any** conversation by id → a full task object (`_conversationToTask`) or `null`. **This is the natural `/c/:id` loader**: return it; 404/`null` → redirect home. (`fetchProjects()` `api.js:553` is uncapped.)
  - `selectTask(id)` does more than set state — hydrates messages, reattaches in-flight SSE streams, records visits. In RR this is the conversation route's job (loader fetches; an effect/route action reattaches the stream). Don't lose the stream reattach.
- **Settings** is a **modal overlay orthogonal to the content route** (`?settings=<section>` today; null=closed, ''=open-no-section, section name). On mobile it's a full master-detail; on desktop a modal over the current content.

## Target architecture

**Route tree (path-based):**
```
/                        Home
/c/:conversationId       Conversation      loader → fetchSession(id) | redirect('/') on null
/projects                Projects grid     loader → fetchProjects()
/projects/:name          Project detail
/scheduled               Scheduled         loader → fetchSchedules()
/scheduled/:scheduleId   Schedule detail
/artifacts               Artifacts         loader → fetchArtifacts()
/tasks  /channels  /customize  /skills  /memory
/settings/:section?      Settings overlay  (see below)
```

**Pieces:**
- **`CoworkProvider`** (new) — everything in `AppCore` *above* its `return` (the ~50 state pieces, streaming, composer, connectors, settings, handlers) lifted into a context (`useCowork()`). This is the crux and the bulk of the work. Cross-cutting app state (streaming, composer, toasts) stays here; URL-driven data (which conversation/project) comes from loaders/params, not this.
- **`CoworkLayout`** (new) — the shell: `Sidebar` / `MobileShell` / composer chrome + `<Outlet />`. Replaces the giant view-switch. The layout route reads `useCowork()`.
- **Route elements** — wrap each existing view (`ChatView`, `ProjectsView`, `ScheduleDetailView`, …) so it reads `useLoaderData()` + `useParams()` + `useCowork()` instead of props threaded from `AppCore`.
- **Router** — `createBrowserRouter(routes)` (web) / `createMemoryRouter(routes)` (Electron), rendered via `<RouterProvider>` around the cowork screen (App.tsx terminal branch). Routes = a single `CoworkLayout` route with the views as children.
- **Navigation** — `<Link to="/c/…">` / `useNavigate()` / loader `redirect()` replace every `setRoute`/`onNavigate`/`navigate`. `useParams()`/`useLoaderData()` replace the entity-id state.

**Deleted at the end:** the `route`/`activeTaskId`/`selectedProject`/`selectedScheduleId` nav `useState`s and all their setters; the render view-switch; and — do **not** bring these from #561 — `lib/navState.js`, `lib/urlState.js`, `lib/router.jsx`, `hooks/useWebNavUrlSync.js`. RR replaces all of it. (The `SettingsView` `Object.hasOwn` CodeQL guard from #561 is still worth keeping if you touch that code.)

**Settings overlay** — the one genuinely tricky bit. Use the standard RR modal pattern: on open, navigate to `/settings/:section` with `state={{ backgroundLocation: location }}`; render two `<Routes>` — the main one keyed on `backgroundLocation` (keeps the content route mounted underneath) and a second that renders the settings modal when `backgroundLocation` is set. On mobile, `/settings/:section` renders full-page instead. Closing = `navigate(-1)` or to the background location.

## Migration increments (each shippable + validated + pushed)

1. **Skeleton.** Add `react-router-dom`. Router around the cowork screen (Memory/Browser per shell). `CoworkProvider` scaffold (start by wrapping AppCore's existing state — you can extract incrementally). `CoworkLayout` with the shell + `<Outlet/>`. Real routes for **Home** and **Conversation `/c/:id`** with the `fetchSession` loader (incl. the capped-list case + null→redirect). Prove deep-link + refresh + Back/Forward on `/c/:id`. Everything else can 404 or render a placeholder this increment.
2. **Projects** (`/projects`, `/projects/:name`) with `fetchProjects` loader.
3. **The rest** — scheduled (+detail), artifacts, tasks, channels, customize, skills, memory — with loaders.
4. **Settings overlay** (backgroundLocation pattern; mobile full-page).
5. **Rewire all navigation** — `Sidebar` `onNavigate`/`onSelectTask` and every in-view nav → `<Link>`/`useNavigate`. Delete `route` state + setters.
6. **Delete** the dead view-switch + nav state; final validation (typecheck/purity/tests/both builds/CodeQL), refresh PR #582 body to describe the real implementation.

Keep each increment green on all gates before pushing. Stream reattach (`selectTask`'s SSE logic) and the composer's cross-route behavior are the highest-risk areas — test conversation open/refresh/back and new-chat send carefully.

## Reference: the hand-rolled counterpart (#561)

PR #561 (`paul/eng-1233-web-url-route-state`) is the hand-rolled implementation to compare against — same feature, `?view=&c=&p=&s=&settings=` query scheme, no dep. Useful to read for the **behavior spec** (edge cases it hardened): unresolvable/deleted deep link → home; new-chat = one Back press; capped-list conversation fetch; the settings-section CodeQL guard. Reproduce the *behavior*, not the *structure*.

Linear: https://linear.app/mindsdb/issue/ENG-1233/web-add-urlroute-state-history-api-so-refresh-deep-links-and
