# ENG-1233 — Web URL/route state via react-router

**Status:** In progress, delivered in two phases (Linear epic ENG-1233):

- **v1 — URL state (MVP)** — ENG-1535, on `paul/eng-1233-web-url-route-state-rr`
  (PR #582). The router skeleton + a state↔URL **bridge** give deep-link /
  refresh / Back-Forward for Home, Conversation (with a loader), every list
  view, and the two **detail** views (project, schedule) — the latter resolving
  their entity client-side from the fetched list, so **no `cowork-server`
  change** and **no `AppCore` decomposition**. This is the shippable MVP.
- **v2 — Loaders + decomposition** — ENG-1536. Per-route loaders, the `AppCore`
  provider decomposition, the settings overlay on the data router, deleting the
  bridge + rewiring all nav to `<Link>`/`useNavigate`, and the
  `GET /projects/{id}` server prereq.

This doc is the design **contract** for both phases — read the Navigation and
Loader contracts before adding a route. Most of the architecture below (full
loaders, provider split, settings overlay) is **v2 scope**; v1 deliberately
sidesteps it via the bridge.

## Purpose

Implement ENG-1233 (web nav state ↔ URL so refresh / deep-links / Back-Forward
work on the web shell) **idiomatically with react-router, from first
principles** — path-based routes, route components, and loaders — decomposing
the ~4,000-line `AppCore` god component into a provider + layout + route
elements.

This is the **alternative** to PR #561 (`paul/eng-1233-web-url-route-state`),
which solves the same problem hand-rolled (manual `pushState`/`popstate`, a
`navState` reducer, a `urlState` query-mapping layer, and a `router.jsx`
shim). Only one of the two PRs should land. **Do not port #561's structure** —
that was the rejected approach. Build what you'd build if react-router were the
starting point.

## Non-negotiable constraints (read first)

- **Dual shell.** The app ships as an Electron desktop app **and** a headless
  web SPA. Electron has **no address bar**. Two entry points:
  `src/renderer/main.tsx` (Electron) and `src/renderer/web-main.tsx` (web). Use
  `createMemoryRouter` on Electron, `createBrowserRouter` on web (see
  `createCoworkRouter`). Everything URL-facing is gated on `host.isWeb` today;
  RR's memory router is the idiomatic replacement for that gating.
- **Never touch `window.antontron` directly** inside `src/renderer/cowork/` —
  go through `src/renderer/platform/host.ts` (`host.isWeb = !isElectron`). CI
  enforces this (`npm run check:cowork-purity`).
- **CodeQL `js/unvalidated-dynamic-method-call`.** Any dispatch keyed on a
  URL/user-controlled value (`obj[key]()`, `map.get(key)()`) trips a
  **high-severity** alert. Guard with `Object.hasOwn(obj, key) ? obj[key]() :
  …`. This bit the hand-rolled branch twice. RR's own matching avoids it, but
  watch any custom dispatch you add.
  - Verify via the alerts API, and wait for CodeQL to **settle** — a first-poll
    `neutral` can be premature:
    `gh api "repos/mindsdb/cowork/code-scanning/alerts?ref=refs/pull/582/head&state=open"`
- **StrictMode** wraps both entries — effects run twice on mount in dev. Any
  mount-time sync must be idempotent.
- **Validate every increment** with the CI gates before pushing:
  ```sh
  PATH="/opt/homebrew/opt/node@20/bin:$PATH" npm run typecheck:renderer   # tsc --noEmit
  PATH="/opt/homebrew/opt/node@20/bin:$PATH" npm run check:cowork-purity
  PATH="/opt/homebrew/opt/node@20/bin:$PATH" npm test                     # vitest
  PATH="/opt/homebrew/opt/node@20/bin:$PATH" npm run build:renderer       # electron renderer
  PATH="/opt/homebrew/opt/node@20/bin:$PATH" npm run build:web            # web SPA
  ```
- **Branch/PR:** commit to `paul/eng-1233-web-url-route-state-rr`; PR #582 is a
  **draft** based on `staging`. Push normally (no force unless resetting).
  Verify the remote head before pushing; report CI (esp. the bare `CodeQL`
  check, which hides under the passing `CodeQL · Analyze` checks).

## Domain facts (learned; don't re-derive)

- **Boot gates.** `src/renderer/App.tsx` runs the pre-cowork screen sequence
  (Loading → Terms → Setup → Onboarding → Intro) and renders `<CoworkApp />`
  only when `page === 'terminal'`. `CoworkApp.tsx` → `<CoworkRoot />` →
  `AppCore` (in `src/renderer/cowork/App.jsx`). **The router wraps the cowork
  app, not the gates** — onboarding stays non-routed.
- **The view inventory** = `AppCore`'s render switch (`src/renderer/cowork/App.jsx`).
  Each `route === 'x' && <View/>`:
  | route | component | entity |
  |---|---|---|
  | home | home/composer | — |
  | task | `ChatView` (`currentTask`) | conversation id |
  | projects | `ProjectsView` | project name (detail) |
  | scheduled | scheduled list | — |
  | schedule-detail | `ScheduleDetailView` | schedule id |
  | artifacts | artifacts | — |
  | tasks | tasks | — |
  | channels | channels | — |
  | customize | `CustomizeView` | — |
  | skills | `SkillsView` | — |
  | memory | present in routing — check render | — |
  (Line numbers drift — re-grep `route === '` in App.jsx.)
- **Nav state today** = `route` (string) + `activeTaskId` + `selectedProject`
  (object) + `selectedScheduleId` + settings overlay
  (`settingsOpen`/`settingsSection`), all `useState` in `AppCore`. ~90
  `setRoute`/`setActiveTaskId`/… call sites; the `Sidebar`
  (`src/renderer/cowork/components/Sidebar.jsx`) navigates via an
  `onNavigate(key)` prop + `onSelectTask(id)`.
- **Conversations / loaders:**
  - `fetchSessions()` (`api.js`) returns a **capped list** —
    `/conversations/?project=all&limit=200`, eager messages for the first 50.
    So a deep-link/refresh to an **older** conversation is NOT in the list.
  - `fetchSession(id)` (`api.js`) fetches any conversation by id → a full task
    object or `null`, but **collapses every failure to `null`** (404, auth,
    5xx, network are indistinguishable). For the loader use
    **`fetchSessionResult(id)`** instead (added in v1): it returns
    `{status:'ok'|'not_found'|'unavailable'}` so the route can tell a deleted
    conversation from a transient outage. See the Loader contract below.
  - `selectTask(id)` used to hydrate messages, reattach in-flight SSE streams,
    and record visits. In v1 this moved to `openConversation()` (the
    conversation route's job): the loader fetches; the route element hydrates +
    reattaches the stream. `selectTask` is now a thin nav trigger. **Don't lose
    the stream reattach** when you promote later routes.
- **Settings** is a **modal overlay orthogonal to the content route**
  (`?settings=<section>` today; null=closed, ''=open-no-section, section name).
  On mobile it's a full master-detail; on desktop a modal over the content.

## Navigation contract (push / replace / preserve)

Every transition must have a defined history intent. A generic two-way
state↔URL bridge cannot infer this, so it is stated here and enforced per
route as routes are promoted (see the increment plan). "One Back press" from
a leaf view must return to where the user came from.

| Transition | Intent | Notes |
|---|---|---|
| Sidebar / in-view navigation between views | **push** | normal navigation |
| Home → new chat, **before** the server mints an id | **preserve** | The temporary `tmp-` id must **never** enter the URL. `pathForRoute` returns `null` for a `tmp-` task, and the bridge leaves the address bar alone. A `/c/tmp-*` push would be a dead entry (Back returns to it) and an unrecoverable refresh (the id was never sent to the server). |
| Temporary → canonical id adoption | **push (once)** | When the server id is adopted, `pathForRoute` yields `/c/:sid` and the bridge performs the *single* push for the new chat. Net history for a chat started from Home: `/ → /c/:sid`, so one Back press returns Home. |
| New chat started from **inside** another conversation `/c/:A` | **preserve**, then push `/c/:sid` | The address bar stays on `/c/:A` through the temp window (no intermediate entry — `pathForRoute` returns `null`), then the canonical id pushes once. Back returns to the originating conversation `/c/:A`. |
| Conversation deep link → 404 (deleted) | **replace → `/`** | `redirect('/')` from the loader. |
| Conversation deep link → transient failure | **preserve** | Keep the URL; render a retryable error (see Loader contract). |
| Deleting the open conversation | **replace → `/`** (or the next recent) | Deletion redirect; decide push vs replace when this route is promoted. |
| Settings open / close | **push on open, `navigate(-1)` / back-location on close** | See Settings overlay. A direct `/settings/:section` link with no history has no background — define its close target explicitly. |
| Optimistic canonicalization of *any* entity id | **replace** | Same principle as temp→canonical: never leave a placeholder id as a distinct history entry. |

**Rule for promoting a route:** when a view becomes a real route, rewire *all*
of its entry points (`Sidebar`, in-view links, header crumbs) to
`<Link>`/`useNavigate` **in the same increment**, and delete the corresponding
`route`-state writes. Do **not** leave a route half-migrated behind the generic
bridge — that is two sources of truth and loses the push/replace intent above.

## Loader contract (every loader defines all outcomes)

A loader must not collapse distinct failures. For every loader define:

| Outcome | Behavior |
|---|---|
| **found** | return the entity; the route element hydrates from it |
| **not_found** (404) | `redirect('/')` (or the parent list) — the link is dead |
| **unavailable** (auth / 5xx / network) | **do not redirect.** Return an `{ unavailable: true }` marker (or throw a `Response` to a route `errorElement`); keep the URL and render a **retryable** error. Retry re-runs the loader via `useRevalidator()`. |
| **optimistic / in-flight local data** | short-circuit the fetch and render from local state (a just-sent conversation isn't server-loadable yet) |
| **cancellation** | honor the loader `request.signal`; a superseded navigation must abort its fetch, not race the new one |

Increment 1 implements this for `/c/:conversationId`:
`fetchSessionResult` distinguishes not_found from unavailable; the loader
redirects Home only on not_found, returns `{ unavailable: true }` on transient
failure (the shell renders `ConversationUnavailable`, a retry that revalidates,
**only when there is no local copy** — a sidebar click on an already-loaded
conversation keeps rendering during a blip); and the optimistic registry
(`markOptimisticConversation` / `clearOptimisticConversation`) lets a
mid-send conversation render from local state. The registry is **cleared on
turn completion** so a later visit hydrates fresh instead of replaying a stale
local snapshot. Loader `signal` cancellation is not yet wired — add it when
loaders start doing real per-navigation fetches (v2).

## Target architecture

**Route tree (path-based):**
```
/                        Home
/c/:conversationId       Conversation      loader → fetchSessionResult(id)  (see Loader contract)
/projects                Projects grid     loader → fetchProjects()
/projects/:projectId     Project detail    stable id, NOT the mutable name (see below)
/scheduled               Scheduled         loader → fetchSchedules()
/scheduled/:scheduleId   Schedule detail
/artifacts               Artifacts         loader → fetchArtifacts()
/tasks  /channels  /customize  /skills  /memory
/settings/:section?      Settings overlay  (see below)
```

**Pieces:**
- **Context/provider (decomposed — do NOT build one god context).** Lifting all
  ~50 `AppCore` fields into a single `CoworkProvider` value just relocates the
  god component into a god context, and a single context object re-renders
  every consumer on any streaming tick. Instead split by concern, each its own
  provider/hook, and prefer **selector-based** consumption so a consumer
  subscribes only to what it reads:
  - **conversation/streaming** — tasks, active stream, reattach, in-flight refs
  - **composer** — draft text, attachments, disabled connections, model
  - **settings/overlay** — section, open/close
  - **shell** — sidebar collapse, mobile shell, toasts, theme
  URL-driven data (which conversation/project) comes from loaders/params, not
  context. Increment 1 uses a single temporary `CoworkProvider` as scaffolding
  (`shell` + nav state + a few handlers) — that is deliberate and short-lived;
  the split lands as `AppCore` is decomposed in v2, not at the end.
- **`CoworkLayout`** — the shell: `Sidebar` / `MobileShell` / composer chrome +
  `<Outlet />`. It hosts the state→URL bridge in v1; the bridge
  shrinks to nothing as each route is fully migrated per the Navigation
  contract.
- **Route elements** — wrap each existing view so it reads `useLoaderData()` +
  `useParams()` + the relevant hook instead of props threaded from `AppCore`.
- **Router** — `createBrowserRouter` (web) / `createMemoryRouter` (Electron)
  via `<RouterProvider>` around the cowork screen. `routes` is exported for
  behavior tests.
- **Navigation** — `<Link>` / `useNavigate()` / loader `redirect()` replace
  every `setRoute`/`onNavigate`; `useParams()`/`useLoaderData()` replace the
  entity-id state.

**Deleted at the end:** the `route`/`activeTaskId`/`selectedProject`/
`selectedScheduleId` nav `useState`s and their setters; the render view-switch;
and — do **not** bring these from #561 — `lib/navState.js`, `lib/urlState.js`,
`lib/router.jsx`, `hooks/useWebNavUrlSync.js`.

**Settings overlay** — the genuinely tricky bit, and it needs a **data-router**
design (not the classic `backgroundLocation` + two-`<Routes>` modal pattern,
which is written for `<BrowserRouter>`/`useRoutes` and does **not** compose with
`createBrowserRouter` + `RouterProvider` loaders). Options that do compose:
- a **layout/pathless route** that renders the current content route's
  `<Outlet/>` plus the settings modal when the URL matches `/settings/:section`
  (the content route stays mounted because settings is a sibling under the same
  layout, not a replacement), or
- the modal as a **child of the content route** so opening settings doesn't
  unmount the conversation beneath it.
Specify all three behaviors explicitly: **direct link** (`/settings/x` opened
cold — no background location; pick a concrete content route to render
underneath, e.g. Home), **refresh** (same), and **close** (`navigate(-1)` when
there is history, else navigate to the resolved background/Home). On mobile,
`/settings/:section` renders full-page instead of a modal.

**Use stable IDs in URLs, not mutable names.** `/projects/:projectId`, not
`/projects/:name` — a rename must not rot deep links. Caveat: the projects API
is name-keyed today (`fetchProjects`, and the server's `project` field is a
name), so a real single-project loader needs a stable-id lookup server-side
(v2). v1 sidesteps this by resolving the id against the already-fetched list
client-side.

## Code organization (v2)

The decomposition lands into a **three-layer** layout. This is the *same
motion* as the router migration — each route element is a feature slice's front
door, so a route's state, view, and components move into its slice as it's
carved out of `AppCore`. Do this in **v2**, not the v1 PR (a broad file move
would bloat the MVP diff).

- **`app/`** — composition root + cross-cutting state that no single feature
  owns: `app/CoworkRouter.jsx` (route table), `app/providers/` (Theme, Server,
  Updates, Composer), `app/stores/` (the selector-based streaming store,
  in-flight, message queue), `app/shell/` (CoworkLayout, Sidebar, MobileShell,
  AppShell).
- **`features/<name>/`** — one vertical slice per route: its view, route element
  (+ loader), store/hooks, and components. Slices: conversation, home, projects,
  scheduled, artifacts, tasks, channels, customize, skills, memory, settings.
- **Shared, feature-agnostic** — `components/ui/` (design-system primitives,
  unchanged), `lib/` and `hooks/` (truly-shared; feature-specific utilities move
  into their feature).

**Boundary rule:** a feature never deep-imports another feature — anything two
features share moves down to `app/stores`, `components/ui`, or `lib`. Worth an
eslint import-boundary rule once the layout settles.

**Order** (folded into the v2 workstreams below):
1. Establish `app/` with the safe-leaf providers first (Theme → Server →
   Updates → Composer) — mechanical, isolated, shrinks `AppCore` immediately.
2. One demonstrator slice end-to-end (`features/projects/`) to set the template.
3. The rest one route at a time; **conversation + the streaming store last**
   (highest coupling — the shared stream refs move as one selector store).

The repo already leans this way: `components/{project,schedule,task,artifact,
connector,datavault}/` plus colocated stores like `datavault/formStore.js` and
`onboarding/onboardingStore.js` are proto-slices — this formalizes and completes
the pattern.

## Phases

### v1 — URL state via the bridge (ENG-1535, MVP) — mostly DONE

Ships URL state for the whole app **without** touching `AppCore` or
`cowork-server`, via the state↔URL bridge in `CoworkRouter.jsx`
(`pathForRoute` / `initialNavState` / the `CoworkLayout` push effect + the
mirror route elements).

- [x] `react-router-dom` added; router around the cowork screen (Memory on
  Electron / Browser on web via `createCoworkRouter`); `CoworkLayout` with the
  shell + `<Outlet/>`; the temporary single `CoworkProvider`.
- [x] Real **Home** and **Conversation `/c/:id`** routes; the conversation
  loader (`fetchSessionResult`) implements the full Loader contract (found /
  not_found→redirect / unavailable→retry / optimistic incl. the capped-list
  case). New-chat history follows the Navigation contract (temp id never in the
  URL; one Back press to Home).
- [x] All list views (`/projects`, `/scheduled`, `/artifacts`, `/tasks`,
  `/channels`, `/customize`, `/skills`, `/memory`) deep-link / refresh /
  Back-Forward through the bridge (mirror `ViewRoute`s → `enterRoute`).
- [x] **Detail views carry their id**: `/projects/:projectId` and
  `/scheduled/:scheduleId`, resolved client-side from the fetched list
  (`enterProjectDetail` / `enterScheduleDetail`) — no single-resource loader,
  no server change. Uses the stable project `id` (name fallback) so it survives
  most renames.
- [x] Behavior + unit tests: loader failure modes, new-chat history, and the
  detail-route deep-link/round-trip (`CoworkRouter.behavior.test.jsx`,
  `CoworkRouter.test.jsx`).
- [ ] Author pass in `npm run dev:web` (needs the auth-realm localhost fix,
  mindsdb/auth PR #276) — deep-link / refresh / Back-Forward + new-chat send.

**Accepted v1 debt** (paid down in v2): the two-way bridge is a deliberate
second source of truth; settings is not in the URL (refresh with settings open
closes it); list/detail loaders don't distinguish `unavailable` from empty.

### v2 — Loaders + decomposition (ENG-1536)

The idiomatic end-state. Everything below is v2 scope. Epic-scale — split into
sub-issues; the recommended shape is a long-lived integration branch stacking
small per-workstream PRs, gated by a web-e2e suite before it merges to
`staging`.

1. **Server prereq (cross-repo, first):** `GET /projects/{id}` (and
   `/scheduled/{id}`) in `cowork-server`, so detail deep links use a stable id
   via a real loader and survive rename cleanly.
2. **Loaders:** promote every route to a loader per the Loader contract
   (found / not_found / unavailable / cancellation via `signal`); replace the
   error-swallowing `fetch*` with `*Result`-style wrappers. Rewire each route's
   nav entry points to `<Link>`/`useNavigate` in the same increment (Navigation
   contract rule).
3. **Settings overlay:** the data-router design above (open / direct-link /
   refresh / close; desktop modal vs mobile full-page; CodeQL dynamic-dispatch
   guard). Sequence in lockstep with whether content is painted by the shell or
   the `<Outlet/>`.
4. **`AppCore` decomposition:** split into concern-scoped providers (theme,
   updates, server, composer) + a **selector-based streaming store** (the ~6
   shared stream refs + queue/in-flight machinery — must not re-render on every
   token). Extract streaming last.
5. **Delete the bridge + dead code:** remove `pathForRoute`/`initialNavState`
   seeding, the mirror routes, the `route`/entity-id `useState`s, and the
   view-switch. Final validation (typecheck/purity/tests/both builds/CodeQL);
   refresh the PR body.

Stream reattach (`openConversation`'s SSE logic) and the composer's cross-route
behavior are the highest-risk areas — test conversation open/refresh/back and
new-chat send carefully throughout.

## Production web hosting (SPA fallback)

A web refresh of `/c/:id` needs the server that hosts the SPA to serve
`index-web.html` for unknown paths. **This already exists** — the frontend
nginx config (`cowork/scripts/nginx-frontend.conf`) has
`try_files $uri $uri/ /index-web.html`, a standard SPA fallback. So deep-route
refresh is **not** a separate-repository prerequisite; it should be **verified
in the deployed environment**, not assumed missing. (The dev server handles it
locally via a history-API fallback; Electron's memory router is unaffected.)

## Reference: the hand-rolled counterpart (#561)

PR #561 (`paul/eng-1233-web-url-route-state`) is the hand-rolled implementation
to compare against — same feature, `?view=&c=&p=&s=&settings=` query scheme, no
dep. Useful for the **behavior spec** (edge cases it hardened): unresolvable/
deleted deep link → home; new-chat = one Back press; capped-list conversation
fetch; the settings-section CodeQL guard. Reproduce the *behavior*, not the
*structure*.

Linear: https://linear.app/mindsdb/issue/ENG-1233/web-add-urlroute-state-history-api-so-refresh-deep-links-and
