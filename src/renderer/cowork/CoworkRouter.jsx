// ENG-1233 — react-router for the cowork app.
//
// Dual shell: Electron desktop (no address bar) uses createMemoryRouter, the
// web SPA uses createBrowserRouter — the idiomatic replacement for the old
// `host.isWeb` URL gating.
//
// v1 (URL state): Home, Conversation (`/c/:id`, with a loader), and the two
// detail views (`/projects/:id`, `/scheduled/:id`) are path-based routes; every
// other view maps its `route` string to `/<route>`. Detail routes resolve their
// entity client-side from the fetched list (no per-route loader — that's v2).
// Route elements only mirror the URL ↔ AppCore state via the bridge in
// CoworkLayout, so AppCore stays intact until the v2 decomposition.
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
import { EmptyState, Button, Spinner } from './components/ui';

// Ids that aren't yet loadable via the API (a new-chat send + the canonical id
// the server later mints). The loader renders these from local state instead of
// fetching (which would 404 and bounce home). Marked on adopt, cleared on turn
// completion so a later revisit hydrates fresh. Module-level so the loader
// (outside the tree) can read it; it also empties on a full reload, when a
// `/c/:id` refresh SHOULD hit the server.
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

// Non-migrated route keys (mirror AppCore's `route` strings). `schedule-detail`
// is absent by design — it maps to the nested `/scheduled/:id` URL.
const VIEW_ROUTES = [
  'projects',
  'scheduled',
  'artifacts',
  'tasks',
  'channels',
  'customize',
  'skills',
  'memory',
  'publish',
];

// Context — AppCore hands the shell + nav state + URL→state handlers down to
// the route elements.
const CoworkContext = createContext(null);

export function CoworkProvider({ value, children }) {
  return <CoworkContext.Provider value={value}>{children}</CoworkContext.Provider>;
}

export function useCowork() {
  const ctx = useContext(CoworkContext);
  if (!ctx) throw new Error('useCowork must be used within a CoworkProvider');
  return ctx;
}

// AppCore state → URL path. Detail views carry their entity id; `projectId` /
// `scheduleId` are the current selection (falsy = list/grid form).
export function pathForRoute(route, activeTaskId, projectId, scheduleId) {
  if (route === 'task') {
    if (!activeTaskId) return '/';
    // Keep a client-only `tmp-` id out of the URL: pushing `/c/tmp-*` leaves a
    // dead entry Back returns to, and a refresh can't resolve it (never sent to
    // the server). `null` = leave the URL alone; the canonical id drives the
    // single push, so a new chat is one Back press from Home.
    if (String(activeTaskId).startsWith('tmp-')) return null;
    return `/c/${activeTaskId}`;
  }
  if (route === 'projects') return projectId ? `/projects/${projectId}` : '/projects';
  // Nest detail under the list so `/scheduled` and `/scheduled/:id` share a prefix.
  if (route === 'schedule-detail') return scheduleId ? `/scheduled/${scheduleId}` : '/scheduled';
  if (!route || route === 'home') return '/';
  return `/${route}`;
}

// Decode one path segment, returning null on a malformed %-escape (a bad deep
// link must never throw out of first render and white-screen the app).
function safeDecodeSegment(seg) {
  try {
    return decodeURIComponent(seg);
  } catch {
    return null;
  }
}

// URL → initial AppCore nav state, so a web deep-link / refresh paints the right
// view instead of flashing Home. `selectedProjectId` is seeded but not held as
// state — the project route resolves it to the object from the fetched list.
export function initialNavState() {
  const HOME = { route: 'home', activeTaskId: null, selectedProjectId: null, selectedScheduleId: null };
  if (!host.isWeb || typeof window === 'undefined') return HOME;
  const path = window.location.pathname;

  const convo = path.match(/^\/c\/(.+)$/);
  if (convo) {
    const id = safeDecodeSegment(convo[1]);
    if (id == null) return HOME; // malformed → fail safe to Home
    return { ...HOME, route: 'task', activeTaskId: id };
  }
  const proj = path.match(/^\/projects\/(.+)$/);
  if (proj) {
    const id = safeDecodeSegment(proj[1]);
    if (id == null) return { ...HOME, route: 'projects' }; // bad id → grid
    return { ...HOME, route: 'projects', selectedProjectId: id };
  }
  const sched = path.match(/^\/scheduled\/(.+)$/);
  if (sched) {
    const id = safeDecodeSegment(sched[1]);
    if (id == null) return { ...HOME, route: 'scheduled' }; // bad id → list
    return { ...HOME, route: 'schedule-detail', selectedScheduleId: id };
  }
  const key = path.replace(/^\/+/, '');
  if (VIEW_ROUTES.includes(key)) return { ...HOME, route: key };
  return HOME;
}

// ---------------------------------------------------------------------------
// Route elements
// ---------------------------------------------------------------------------

// Renders AppCore's shell (which embeds the <Outlet/> + the route-keyed view
// switch) and hosts the state→URL bridge. The first run is skipped so a
// deep-link / refresh (URL→state, via the child effects) wins on mount.
function CoworkLayout() {
  const { shell, route, activeTaskId, selectedProjectId, selectedScheduleId } = useCowork();
  const navigate = useNavigate();
  const location = useLocation();
  const firstRun = useRef(true);
  const target = pathForRoute(route, activeTaskId, selectedProjectId, selectedScheduleId);

  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    // null = optimistic/tmp conversation: leave the URL until the canonical id adopts.
    if (target == null) return;
    if (location.pathname !== target) navigate(target);
    // Depend only on `target`: reacting to `location.pathname` too would fight
    // the URL→state sync.
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

// `/c/:conversationId` — the loader has already fetched (or flagged optimistic);
// openConversation merges it into state + reattaches the live stream.
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

// Non-migrated views: sync AppCore's `route` state to the URL so the switch
// renders. v2 promotes these to real loader-backed routes.
function ViewRoute({ name }) {
  const { enterRoute } = useCowork();
  useEffect(() => {
    enterRoute(name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);
  return null;
}

// `/projects/:projectId` — resolves the project object from the id client-side
// (from the fetched list; no single-project endpoint in v1). enterProjectDetail
// resolves to `false` when the id isn't in the list; replace the dead detail
// URL with the grid (replace, not push, so Back skips the missing entry).
function ProjectDetailRoute() {
  const { projectId } = useParams();
  const { enterProjectDetail } = useCowork();
  const navigate = useNavigate();
  useEffect(() => {
    let active = true;
    Promise.resolve(enterProjectDetail(projectId)).then((found) => {
      if (active && found === false) navigate('/projects', { replace: true });
    });
    return () => { active = false; };
    // enterProjectDetail (AppCore useCallback) and navigate are stable — depend
    // only on the id, matching the other route elements.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);
  return null;
}

// `/scheduled/:scheduleId` — sets the detail route + id; the view resolves the
// schedule from the fetched list.
function ScheduleDetailRoute() {
  const { scheduleId } = useParams();
  const { enterScheduleDetail } = useCowork();
  useEffect(() => {
    enterScheduleDetail(scheduleId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleId]);
  return null;
}

// Shown (via the view switch) when the `/c/:id` loader hit an operational
// failure. Unlike a 404 (redirect Home), the URL is kept and retry re-runs the
// loader via the revalidator.
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

// Shown while a requested conversation id hasn't resolved into local state yet
// (deep link / scheduled-run open). Avoids briefly rendering an unrelated recent
// conversation, which the old `tasks[0]` fallback did.
export function ConversationLoading() {
  return (
    <div className="flex-1 min-h-0 grid place-items-center text-ink-3" data-testid="conversation-loading">
      <Spinner style={{ fontSize: 22 }} />
    </div>
  );
}

// `/c/:id` loader. Distinguishes the failure modes so the route can react: a
// 404 drops the dead link Home; a transient failure keeps the URL + retries.
async function conversationLoader({ params }) {
  const id = params.conversationId;
  // Not-yet-persisted conversation (mid-send): render from local state.
  if (isOptimisticConversation(id)) return { optimistic: true, id };
  const result = await fetchSessionResult(id);
  // 404 → `redirect('/')`, NOT `replace('/')`. In RR7's data router a loader
  // redirect fires while still committed to the origin — the `/c/:id` entry
  // never commits — so this pushes `[origin, /]`: Back returns to the origin and
  // the dead URL is unreachable (verified in CoworkRouter.behavior.test). A
  // `replace` here would instead replace the *origin* (→ `[/]`) and lose it; on
  // a cold deep-link RR already forces the initial redirect to replace.
  if (result.status === 'not_found') return redirect('/');
  if (result.status === 'unavailable') return { unavailable: true, id };
  return { task: result.task, id };
}

// Exported for behavior tests; production goes through createCoworkRouter.
export const routes = [
  {
    element: <CoworkLayout />,
    children: [
      { index: true, element: <HomeRoute /> },
      { path: 'c/:conversationId', element: <ConversationRoute />, loader: conversationLoader },
      { path: 'projects/:projectId', element: <ProjectDetailRoute /> },
      { path: 'scheduled/:scheduleId', element: <ScheduleDetailRoute /> },
      ...VIEW_ROUTES.map((name) => ({ path: name, element: <ViewRoute name={name} /> })),
      { path: '*', element: <Navigate to="/" replace /> }, // unknown → home
    ],
  },
];

export function createCoworkRouter() {
  return host.isWeb ? createBrowserRouter(routes) : createMemoryRouter(routes);
}

export function CoworkRouterProvider({ router }) {
  return <RouterProvider router={router} />;
}
