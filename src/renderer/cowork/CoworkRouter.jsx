// ENG-1233 — react-router skeleton for the cowork app.
//
// The dual shell ships as an Electron desktop app (no address bar) and a
// headless web SPA. We use `createMemoryRouter` on Electron and
// `createBrowserRouter` on web — RR's memory router is the idiomatic
// replacement for the old `host.isWeb` URL gating.
//
// Increment 1 (skeleton): Home (`/`) and Conversation (`/c/:conversationId`)
// are real path-based routes; the conversation route has a `fetchSession`
// loader so deep-link / refresh / Back-Forward resolve the conversation.
// Every other view still renders from AppCore's `route`-state view switch;
// the routes below only mirror the URL into that state (and back), so the
// giant AppCore component can be decomposed incrementally in later
// increments without regressing anything now.
//
// How it fits together:
//   - AppCore renders <RouterProvider> and hands its shell (the sidebar +
//     content column + modals, which still contains the `route`-keyed view
//     switch and an <Outlet/>) plus a few URL→state handlers down via
//     context.
//   - CoworkLayout renders that shell. Its <Outlet/> mounts the matched
//     child route element below, which runs a small effect to sync AppCore
//     state to the URL and otherwise renders nothing.
//   - The state→URL direction is a single mount-guarded effect in
//     CoworkLayout.
import { createContext, useContext, useEffect, useRef } from 'react';
import {
  createBrowserRouter,
  createMemoryRouter,
  RouterProvider,
  Navigate,
  redirect,
  useNavigate,
  useLocation,
  useParams,
  useLoaderData,
  useRevalidator,
} from 'react-router-dom';
import { host } from '../platform/host';
import { fetchSessionResult } from './api';
import { EmptyState, Button } from './components/ui';

// ---------------------------------------------------------------------------
// Optimistic conversation registry
// ---------------------------------------------------------------------------
// A new-chat send creates an optimistic task; the server later mints its
// canonical id, which we route to before it is loadable via the API. Hitting
// the loader for it would 404 and bounce home, so AppCore marks these ids and
// the loader renders the streaming task from local state instead of fetching.
//
// Lifecycle: marked when the id is minted/adopted, cleared once the turn
// completes (the conversation is then server-persisted, so a revisit should
// hydrate fresh — see clearOptimisticConversation). Without the clear, every
// conversation created this session would stay "optimistic" and future visits
// would skip loader hydration and show stale local state.
//
// Module-level (not React state): the loader runs outside the component tree.
// It also empties on a full page reload (module re-evaluates), which is
// exactly when a `/c/:id` refresh SHOULD hit the server.
//
// Note: this registry is a *loader* concern only. Whether a temporary id
// reaches the URL is decided separately by pathForRoute (the `tmp-` prefix),
// so clearing an id here never affects history behavior.
const optimisticIds = new Set();

export function markOptimisticConversation(id) {
  if (id) optimisticIds.add(id);
}

export function clearOptimisticConversation(id) {
  if (id) optimisticIds.delete(id);
}

export function isOptimisticConversation(id) {
  return typeof id === 'string' && (id.startsWith('tmp-') || optimisticIds.has(id));
}

// Known non-migrated route keys (mirror AppCore's `route` state strings).
const VIEW_ROUTES = [
  'projects',
  'scheduled',
  'schedule-detail',
  'artifacts',
  'tasks',
  'channels',
  'customize',
  'skills',
  'memory',
  'publish',
];

// ---------------------------------------------------------------------------
// Context — AppCore hands the shell + current nav state + URL→state sync
// handlers down to the route elements below.
// ---------------------------------------------------------------------------
const CoworkContext = createContext(null);

export function CoworkProvider({ value, children }) {
  return <CoworkContext.Provider value={value}>{children}</CoworkContext.Provider>;
}

export function useCowork() {
  const ctx = useContext(CoworkContext);
  if (!ctx) throw new Error('useCowork must be used within a CoworkProvider');
  return ctx;
}

// route (AppCore state) → URL path. Home and Conversation are the migrated
// routes; every other route mirrors its state string as `/<route>` so the
// shell chrome, refresh, and Back/Forward stay coherent this increment.
export function pathForRoute(route, activeTaskId) {
  if (route === 'task') {
    if (!activeTaskId) return '/';
    // A `tmp-` id is a client-only placeholder for a brand-new chat whose
    // server id hasn't been minted yet. Never drive the URL to it: pushing
    // `/c/tmp-*` leaves a dead history entry that Back returns to, and a
    // refresh can't resolve it (the id was never sent to the server). Return
    // `null` = "leave the address bar where it is"; the canonical-id adoption
    // drives the single push to `/c/:sid`, so a new chat is exactly one Back
    // press from where it started. (ENG-1233 — Major 1)
    if (String(activeTaskId).startsWith('tmp-')) return null;
    return `/c/${activeTaskId}`;
  }
  if (!route || route === 'home') return '/';
  return `/${route}`;
}

// URL path → initial AppCore nav state. Lets AppCore seed `route` /
// `activeTaskId` from the address bar on first render (web deep-link /
// refresh), so the correct view paints immediately instead of flashing Home.
// Electron always boots the memory router at `/`.
export function initialNavState() {
  if (!host.isWeb || typeof window === 'undefined') {
    return { route: 'home', activeTaskId: null };
  }
  const path = window.location.pathname;
  const convo = path.match(/^\/c\/(.+)$/);
  if (convo) {
    let id;
    try {
      id = decodeURIComponent(convo[1]);
    } catch {
      // Malformed percent-encoding (e.g. `/c/%`): a bad deep link must not
      // throw out of first render and white-screen the app. Seed Home; the
      // route loader still runs against the raw param and resolves it safely.
      // (ENG-1233 — Minor 2)
      return { route: 'home', activeTaskId: null };
    }
    return { route: 'task', activeTaskId: id };
  }
  const key = path.replace(/^\/+/, '');
  if (VIEW_ROUTES.includes(key)) return { route: key, activeTaskId: null };
  return { route: 'home', activeTaskId: null };
}

// ---------------------------------------------------------------------------
// Route elements
// ---------------------------------------------------------------------------

// Layout: renders the app chrome (sidebar + AppShell + modals + the current
// view switch, all built in AppCore) which embeds `<Outlet/>` for the child
// route elements below. Also hosts the thin state→URL bridge: when AppCore's
// internal navigation changes `route` / `activeTaskId`, push the matching
// URL. The first run is skipped so a deep-link / refresh (URL → state, driven
// by the child route elements' effects) wins on mount instead of being
// clobbered back to `/`.
function CoworkLayout() {
  const { shell, route, activeTaskId } = useCowork();
  const navigate = useNavigate();
  const location = useLocation();
  const firstRun = useRef(true);
  const target = pathForRoute(route, activeTaskId);

  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    // `null` target = an optimistic/temporary conversation that must stay out
    // of the URL (see pathForRoute): leave the address bar untouched until the
    // canonical id adopts and drives the push. (ENG-1233 — Major 1)
    if (target == null) return;
    if (location.pathname !== target) navigate(target);
    // Depend only on `target`: reacting to `location.pathname` too would fight
    // the URL→state sync (both would try to drive the other).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  return shell;
}

function HomeRoute() {
  const { enterHome } = useCowork();
  useEffect(() => {
    enterHome();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

// `/c/:conversationId` — the migrated deep-linkable route. The loader has
// already fetched the conversation (or flagged it optimistic);
// `openConversation` merges it into app state + reattaches the live stream.
function ConversationRoute() {
  const { conversationId } = useParams();
  const loaded = useLoaderData();
  const { openConversation } = useCowork();
  useEffect(() => {
    openConversation(conversationId, loaded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, loaded]);
  return null;
}

// Non-migrated views: drive AppCore's `route` state to match the URL so the
// view switch renders and the shell chrome stays in sync. Later increments
// promote these to real loader-backed routes.
function ViewRoute({ name }) {
  const { enterRoute } = useCowork();
  useEffect(() => {
    enterRoute(name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);
  return null;
}

// Rendered by the shell's view switch when the `/c/:id` loader hit an
// operational failure (auth / 5xx / network — see conversationLoader). Unlike
// a 404 (which redirects Home), the URL is preserved so the deep link isn't
// lost during an outage; the retry re-runs the loader through the data
// router's revalidator. (ENG-1233 — Major 2)
export function ConversationUnavailable() {
  const revalidator = useRevalidator();
  const retrying = revalidator.state !== 'idle';
  return (
    <EmptyState
      title="This conversation didn’t load"
      description="We couldn’t reach the server. Your link is still valid — try again once you’re back online."
      action={
        <Button variant="primary" onClick={() => revalidator.revalidate()} disabled={retrying}>
          {retrying ? 'Retrying…' : 'Try again'}
        </Button>
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Loader — the natural `/c/:id` data dependency. Returns the conversation for
// the route element to hydrate; a missing/deleted conversation redirects home
// (matches the hand-rolled branch's "unresolvable deep link → home").
// ---------------------------------------------------------------------------
async function conversationLoader({ params }) {
  const id = params.conversationId;
  // Optimistic / not-yet-persisted conversation: don't hit the server (it
  // would 404 and redirect home mid-send). The streaming task renders from
  // local state.
  if (isOptimisticConversation(id)) return { optimistic: true, id };
  const result = await fetchSessionResult(id);
  // Genuinely gone (404): drop the dead deep link to Home.
  if (result.status === 'not_found') return redirect('/');
  // Operational failure (auth / 5xx / network): the conversation may well
  // still exist. Keep the URL and let the route render a retryable error
  // rather than silently discarding a valid link during a transient outage.
  // (ENG-1233 — Major 2)
  if (result.status === 'unavailable') return { unavailable: true, id };
  return { task: result.task, id };
}

// Exported for behavior tests (loader failure modes, the state↔URL bridge,
// and new-chat history) — build a `createMemoryRouter(routes)` and wrap it in
// a test `CoworkProvider`. Production code goes through `createCoworkRouter`.
export const routes = [
  {
    element: <CoworkLayout />,
    children: [
      { index: true, element: <HomeRoute /> },
      { path: 'c/:conversationId', element: <ConversationRoute />, loader: conversationLoader },
      ...VIEW_ROUTES.map((name) => ({ path: name, element: <ViewRoute name={name} /> })),
      // Unknown path → home (deleted/typo'd deep link).
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
];

export function createCoworkRouter() {
  return host.isWeb ? createBrowserRouter(routes) : createMemoryRouter(routes);
}

export function CoworkRouterProvider({ router }) {
  return <RouterProvider router={router} />;
}
