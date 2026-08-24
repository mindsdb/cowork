# ENG-1233 — Web URL/route state via react-router

**Status (epic ENG-1233):** two phases.

- **v1 — URL state (MVP)** · ENG-1535 · PR #582 (`paul/eng-1233-web-url-route-state-rr`).
  Router skeleton + a state↔URL **bridge**: deep-link / refresh / Back-Forward
  for Home, Conversation (loader), all list views, and the project/schedule
  **detail** views (entity resolved client-side from the fetched list). **No
  `cowork-server` change, no `AppCore` decomposition.** Mostly done.
- **v2 — Loaders + decomposition** · ENG-1536. Per-route loaders, `AppCore`
  provider decomposition, settings overlay on the data router, delete the bridge
  + rewire nav to `<Link>`/`useNavigate`, `GET /projects/{id}` server prereq.

Path-based react-router, built incrementally. Supersedes the hand-rolled #561
(do not port its structure). This doc is the design **contract** — read the
Navigation and Loader contracts before adding a route. Most of the architecture
below is **v2**; v1 sidesteps it via the bridge.

## Constraints

- **Dual shell.** Electron desktop (no address bar) + web SPA, two entries
  (`main.tsx` / `web-main.tsx`). `createMemoryRouter` on Electron,
  `createBrowserRouter` on web (`createCoworkRouter`) — the idiomatic
  replacement for the old `host.isWeb` URL gating.
- **Purity.** Never touch `window.antontron` inside `src/renderer/cowork/` — go
  through `platform/host.ts`. CI enforces (`check:cowork-purity`).
- **CodeQL `js/unvalidated-dynamic-method-call`.** Any dispatch keyed on a
  URL/user value (`obj[key]()`) is a high-severity alert — guard with
  `Object.hasOwn`. RR matching avoids it; watch custom dispatch (e.g. the
  settings-section render map).
- **StrictMode** double-invokes mount effects in dev — every URL↔state sync must
  be idempotent.
- **Gates** before pushing: `typecheck:renderer` · `check:cowork-purity` ·
  `npm test` · `build:renderer` · `build:web`.

## Domain facts (don't re-derive)

- **Capped conversation list.** `fetchSessions()` → `/conversations/?limit=200`
  (eager messages for the first 50). A deep-link to an older conversation isn't
  in the list — the loader must fetch it by id.
- **`fetchSession(id)` swallows every failure to `null`** (404 / auth / 5xx /
  network indistinguishable). The loader uses **`fetchSessionResult(id)`** →
  `{status:'ok'|'not_found'|'unavailable'}`. `fetchProjects` / `fetchArtifacts`
  / `fetchSchedules` likewise catch to `[]` — they need `*Result` wrappers
  before backing a loader (v2).
- **Projects are name-keyed** (`fetchProjects`, nested `/projects/{name}/…`)
  though a stable `id` exists in the list. A real single-project loader needs
  `GET /projects/{id}` (v2); v1 resolves the id against the fetched list.
- **Stream reattach.** Opening a conversation hydrates messages + reattaches
  in-flight SSE (was `selectTask`, now `openConversation`). **Don't lose the
  reattach** when promoting routes.
- **Settings is a modal overlay orthogonal to the content route** (desktop modal
  over content; mobile full-page). Not in the URL yet (v2).

## Navigation contract (push / replace / preserve)

Every transition needs a defined history intent — the two-way bridge can't infer
it. "One Back press" from a leaf returns to where you came from.

| Transition | Intent |
|---|---|
| Sidebar / in-view nav | **push** |
| New chat, before the server mints an id | **preserve** — the `tmp-` id never enters the URL (`pathForRoute` → `null`); a `/c/tmp-*` push is a dead entry + unrecoverable refresh |
| Temp → canonical id adoption | **push once** — from Home: `/ → /c/:sid` (one Back to Home); from `/c/:A`: stays on `/c/:A`, then pushes `/c/:sid` (Back to `/c/:A`) |
| Deep link → 404 (deleted) | `redirect('/')` — see the Loader contract note; the dead URL never lands in history |
| Deep link → transient failure | **preserve** — keep the URL + retry (Loader contract) |
| Delete the open conversation | **replace → `/`** (or next recent) |
| Settings open / close | **push** on open; **`navigate(-1)`** / background on close (a cold `/settings/x` has no history — pick an explicit close target) |
| Optimistic canonicalization of any entity id | **replace** — never leave a placeholder id as its own entry |

**Promoting a route:** rewire *all* its entry points (Sidebar, in-view links,
crumbs) to `<Link>`/`useNavigate` in the same step and delete the `route`-state
writes. Don't half-migrate behind the bridge (two sources of truth).

## Loader contract (define every outcome)

| Outcome | Behavior |
|---|---|
| **found** | return the entity; the route hydrates |
| **not_found** (404) | `redirect('/')` (or parent list) — dead link. **`redirect`, not `replace`:** RR7 fires a loader redirect while still committed to the origin (the `/c/:id` entry never commits), so this pushes `[origin, /]` — Back returns to the origin and the dead URL is unreachable. `replace('/')` would replace the *origin* instead (→ `[/]`) and lose it; a cold deep-link's initial redirect is force-replaced by RR anyway. Verified in `CoworkRouter.behavior.test`. |
| **unavailable** (auth / 5xx / network) | **don't redirect** — return `{ unavailable: true }` (or throw to an `errorElement`); keep the URL + render a retryable error (`useRevalidator()`) |
| **optimistic / in-flight** | short-circuit the fetch, render from local state |
| **cancellation** | honor `request.signal`; a superseded nav aborts, doesn't race |

v1 implements the **failure-mode** contract for `/c/:id` (found / not_found→
redirect / unavailable→`ConversationUnavailable` retry, shown only when there's
no local copy / optimistic via the registry —
`mark`/`clearOptimisticConversation`, cleared on turn completion). **Not yet the
full contract: `request.signal` cancellation is deferred to v2**, so a superseded
`/c/:id` nav's fetch isn't aborted (the stale result is just ignored). Every list
route stays on the bridge (no loader) in v1.

## Architecture

**Route tree:**
```
/                      Home
/c/:conversationId     Conversation     loader → fetchSessionResult(id)
/projects              Projects grid
/projects/:projectId   Project detail   stable id (v2 loader; v1 client-side resolve)
/scheduled             Scheduled
/scheduled/:scheduleId Schedule detail
/artifacts /tasks /channels /connect /skills /memory   (/connect → `customize` route key)
/settings/:section?    Settings overlay (v2)
```

- **`CoworkLayout`** renders the shell (Sidebar / MobileShell / composer +
  `<Outlet/>`) and hosts the v1 state→URL bridge; the bridge shrinks to nothing
  as routes are fully migrated.
- **Route elements** wrap each view to read `useLoaderData()`/`useParams()`
  instead of props threaded from `AppCore`.
- **No god context.** Don't lift all ~50 `AppCore` fields into one
  `CoworkProvider` (re-renders every consumer on each streaming tick). Split by
  concern with selector-based consumption (see Code organization). v1 uses one
  temporary provider as scaffolding; the split is v2.

**Settings overlay (v2, the tricky bit):** the classic `backgroundLocation` +
two-`<Routes>` pattern does **not** compose with `createBrowserRouter` +
`RouterProvider`. Use a pathless layout route (content `<Outlet/>` + a
settings-modal sibling) or the modal as a child of the content route, so the
content stays mounted. Specify **direct-link / refresh** (cold `/settings/x` →
render Home underneath) and **close** (`navigate(-1)`, else background/Home);
mobile renders full-page.

## Code organization (v2)

Decomposition lands into a **three-layer** layout — the same motion as the
router migration (each route element is a feature slice's front door). Do it in
v2, not the v1 PR.

- **`app/`** — composition root + cross-cutting state no feature owns:
  `CoworkRouter`, `providers/` (Theme, Server, Updates, Composer), `stores/`
  (selector-based streaming store, in-flight, message queue), `shell/`
  (CoworkLayout, Sidebar, MobileShell).
- **`features/<route>/`** — one vertical slice: view + route element (+ loader) +
  store/hooks + components (conversation, home, projects, scheduled, artifacts,
  tasks, channels, customize, skills, memory, settings).
- **Shared** — `components/ui/` (design system), `lib/` + `hooks/`
  (feature-agnostic).

**Boundary:** a feature never deep-imports another; shared code goes to
`app/stores`, `components/ui`, or `lib`. **Order:** safe-leaf providers first
(Theme → Server → Updates → Composer) → a `features/projects/` demonstrator →
the rest, conversation + streaming store last. The repo already leans this way
(`components/{project,schedule,task,…}/`, colocated stores like
`datavault/formStore.js`).

## Phases

**v1 (ENG-1535) — mostly done.** Router skeleton + bridge, all in
`CoworkRouter.jsx`. It **wires AppCore to the router** (adds `enter*` URL→state
handlers, the `/c/:id` loader path, detail-resolution + loading state) but does
**not decompose** it — the ~4,200-line `AppCore` stays whole behind the bridge.

- [x] Router + `CoworkLayout` + temporary `CoworkProvider`.
- [x] Home + Conversation (`/c/:id`) with the `fetchSessionResult` loader
  (failure-mode contract; **`signal` cancellation deferred to v2**); new-chat
  history contract.
- [x] All list views via the bridge; detail views (`/projects/:id`,
  `/scheduled/:id`) resolved client-side (no server change), with a stale-request
  guard + missing-id → `/projects` and a loading state (no wrong-entity flash).
- [x] Behavior + unit tests (loader failure classification, 404 history, detail
  round-trip + missing-id replace, requested-id loading state).
- [ ] **Browser-level e2e (v1 acceptance criterion, not yet done):** the current
  detail tests drive the context handlers directly; a Playwright/web pass should
  exercise real list resolution, missing entities, stale responses, and the
  refresh/Back paths against the running SPA.
- [ ] `npm run dev:web` click-through (blocked on the auth-realm localhost fix,
  mindsdb/auth#276).

*Accepted debt (→ v2):* the two-way bridge (second source of truth); settings not
in the URL; list/detail can't distinguish `unavailable` from empty (no `*Result`
wrapper), so a projects-fetch outage resolves a detail id as "missing".

**v2 (ENG-1536) — idiomatic end-state.** Epic-scale; recommended shape = a
long-lived integration branch of small per-workstream PRs, web-e2e-gated before
merging to `staging`. **Before execution, break the workstreams below into child
issues with per-route acceptance criteria** (loader outcomes, nav intents, and
the e2e paths each route must pass) — the list here is a roadmap, not the
per-route contract.

1. **Server prereq (first, cross-repo):** `GET /projects/{id}` (+ `/scheduled/{id}`).
2. **Loaders:** every route per the Loader contract (+ `signal`); `*Result`
   wrappers; rewire that route's nav in the same step.
3. **Settings overlay:** the data-router design above.
4. **Decomposition + code org:** concern-scoped providers + selector-based
   streaming store (extract last); land the `app/` + `features/` layout.
5. **Delete:** the bridge, mirror routes, nav `useState`s, view-switch; final
   validation.

Highest-risk areas: stream reattach (`openConversation`) and the composer's
cross-route behavior — test conversation open/refresh/back + new-chat send.

## Notes

- **SPA hosting:** a `/c/:id` refresh needs the host to serve `index-web.html`
  for unknown paths — already present (nginx `try_files … /index-web.html`,
  `scripts/nginx-frontend.conf`; dev server has a history fallback; Electron
  unaffected). Verify in the deployed env; not a separate-repo blocker.
- **#561** (hand-rolled counterpart, `?view=&c=&p=&s=&settings=`) is a
  **behavior** reference only (deleted deep link → home, new-chat = one Back,
  capped-list fetch, settings CodeQL guard). Reproduce the behavior, not the
  structure.
- Linear: ENG-1233.
