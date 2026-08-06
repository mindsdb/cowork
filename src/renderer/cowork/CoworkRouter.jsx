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
} from 'react-router-dom';
import { host } from '../platform/host';
import { fetchSession } from './api';

// ---------------------------------------------------------------------------
// Optimistic conversation registry
// ---------------------------------------------------------------------------
// A new-chat send creates an optimistic task and routes to `/c/<id>` before
// the server has persisted the conversation — and the server later mints its
// canonical id, which we also route to. Hitting the `fetchSession` loader for
// either would 404 and bounce home. AppCore marks these ids so the loader
// skips the fetch and lets the streaming task render from local state.
//
// Module-level (not React state): the loader runs outside the component tree.
// It naturally empties on a full page reload (module re-evaluates), which is
// exactly when a `/c/:id` refresh SHOULD hit the server.
const optimisticIds = new Set();

export function markOptimisticConversation(id) {
  if (id) optimisticIds.add(id);
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
  if (route === 'task') return activeTaskId ? `/c/${activeTaskId}` : '/';
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
  if (convo) return { route: 'task', activeTaskId: decodeURIComponent(convo[1]) };
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
  const task = await fetchSession(id);
  if (!task) return redirect('/');
  return { task, id };
}

const routes = [
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
