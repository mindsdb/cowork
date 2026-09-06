// Electron uses memory routing; web uses browser history. Route elements bridge URLs and AppCore
// state; project/schedule details resolve from the fetched lists.
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

// Skip API loads for conversations still being persisted. Clear optimistic IDs on turn completion;
// a full reload must hydrate from the server.
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

// AppCore route keys; schedule-detail maps to /scheduled/:id separately.
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

// Keep the legacy customize state key while exposing /connect in browser URLs.
const ROUTE_SLUGS = { customize: 'connect' };
const SLUG_ROUTES = Object.fromEntries(Object.entries(ROUTE_SLUGS).map(([r, s]) => [s, r]));

// Share AppCore shell, navigation state and URL-to-state handlers.
const CoworkContext = createContext(null);

export function CoworkProvider({ value, children }) {
  return <CoworkContext.Provider value={value}>{children}</CoworkContext.Provider>;
}

export function useCowork() {
  const ctx = useContext(CoworkContext);
  if (!ctx) throw new Error('useCowork must be used within a CoworkProvider');
  return ctx;
}

// Map AppCore state to a URL; missing detail IDs select the list view.
export function pathForRoute(route, activeTaskId, projectId, scheduleId) {
  if (route === 'task') {
    if (!activeTaskId) return '/';
    // Keep temporary IDs out of history: refresh cannot load them. Return null until the canonical
    // ID supplies one navigable entry.
    if (String(activeTaskId).startsWith('tmp-')) return null;
    return `/c/${activeTaskId}`;
  }
  if (route === 'projects') return projectId ? `/projects/${projectId}` : '/projects';
  // Nest detail under the list so `/scheduled` and `/scheduled/:id` share a prefix.
  if (route === 'schedule-detail') return scheduleId ? `/scheduled/${scheduleId}` : '/scheduled';
  if (!route || route === 'home') return '/';
  return `/${ROUTE_SLUGS[route] || route}`;
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

// Seed navigation from deep links to avoid flashing Home. Detail routes resolve seeded IDs against
// fetched lists.
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
  if (SLUG_ROUTES[key]) return { ...HOME, route: SLUG_ROUTES[key] };
  // Aliased routes exist only at their slug; accepting /customize here would disagree with the
  // router's fallback.
  if (VIEW_ROUTES.includes(key) && !ROUTE_SLUGS[key]) return { ...HOME, route: key };
  return HOME;
}

// Route elements

// Skip the first state-to-URL sync so child effects can honor an initial deep link.
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

// Mirror the route name into AppCore for views without loaders.
function ViewRoute({ name }) {
  const { enterRoute } = useCowork();
  useEffect(() => {
    enterRoute(name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);
  return null;
}

// Resolve the project from the fetched list. Replace missing-detail URLs with the grid so Back
// skips the dead entry.
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

// Operational failures keep the conversation URL for retry; only a missing conversation redirects
// Home.
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

// Wait for the requested conversation instead of briefly rendering an unrelated recent one.
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
  // RR7 loader redirects preserve the origin in Back history; replacing would discard it because
  // the missing conversation never committed. Initial deep-link redirects already replace
  // (CoworkRouter.behavior.test).
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
      // `path` is the user-facing slug (e.g. `connect`); `name` stays the
      // internal route key (e.g. `customize`) that ViewRoute feeds enterRoute.
      ...VIEW_ROUTES.map((name) => ({ path: ROUTE_SLUGS[name] || name, element: <ViewRoute name={name} /> })),
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
