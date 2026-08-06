// The web shell's routes as data (ENG-1233) — one declarative registry that the
// URL mapping (lib/urlState) reads from, so a route's shape lives in one place
// instead of hard-coded per-route branches. A shim toward a real router: these
// entries map onto route objects / loaders when one drops in.
//
//   view       the `?view=` value; null for home (home is the ABSENCE of view)
//   param      query key carrying the route's entity id, if any (c / p / s)
//   field      parseUrlState output field for that id (taskId / projectName / scheduleId)
//   ephemeral  predicate whose matching values are never written to the URL
//              (a `tmp-` conversation id is an ephemeral client id)

export const ROUTES = {
  home:              { view: null,              param: null, field: null },
  task:              { view: 'task',            param: 'c',  field: 'taskId',
                       ephemeral: (v) => String(v).startsWith('tmp-') },
  projects:          { view: 'projects',        param: 'p',  field: 'projectName' },
  scheduled:         { view: 'scheduled',       param: null, field: null },
  'schedule-detail': { view: 'schedule-detail', param: 's',  field: 'scheduleId' },
  artifacts:         { view: 'artifacts',       param: null, field: null },
  tasks:             { view: 'tasks',           param: null, field: null },
  channels:          { view: 'channels',        param: null, field: null },
  customize:         { view: 'customize',       param: null, field: null },
  skills:            { view: 'skills',          param: null, field: null },
  memory:            { view: 'memory',          param: null, field: null },
  publish:           { view: 'publish',         param: null, field: null },
};

// Non-home routes (those with a `view=` value). Home is the absence of view.
export const KNOWN_ROUTES = new Set(Object.keys(ROUTES).filter((id) => ROUTES[id].view));

// Query keys the routes own — buildSearch clears these before rewriting.
export const MANAGED_PARAMS = Object.values(ROUTES).map((r) => r.param).filter(Boolean);

const ROUTE_BY_VIEW = new Map(
  Object.entries(ROUTES).filter(([, r]) => r.view).map(([id, r]) => [r.view, id]),
);

// Map a `?view=` value to a route id; unknown / absent -> home.
export function routeForView(view) {
  return (view && ROUTE_BY_VIEW.get(view)) || 'home';
}
