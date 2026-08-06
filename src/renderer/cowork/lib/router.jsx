import { createContext, useContext } from 'react';
import { host } from '../../platform/host';
import { ROUTES } from './routes';
import { buildSearch } from './urlState';

// Router shim (ENG-1233) — a rudimentary, react-router-data-router-shaped consumer
// API over our own nav reducer + routes table, so app code navigates through
// `useNavigate()` / `<Link>` and reads `useParams()` / `useLoaderData()` instead of
// prop-drilled setters. When a real router lands, its <RouterProvider> replaces
// <NavProvider> and these hooks re-export from the library — call sites don't change.
//
// The provider is GIVEN its value (the app owns the store); this module only shapes
// the consumer surface. The value:
//   route       current route id
//   params      the current route's entity id, keyed by its URL param, e.g. { c }
//   loaderData  the resolved entity for the route (open conversation / project)
//   navigate    ({ to, params }) => void — apply a target route + entity id

const NavContext = createContext(null);

export function NavProvider({ value, children }) {
  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

function useNav() {
  const ctx = useContext(NavContext);
  if (!ctx) throw new Error('useNavigate/useParams/useLoaderData must be used within <NavProvider>');
  return ctx;
}

export function useNavigate() { return useNav().navigate; }
export function useParams() { return useNav().params; }
export function useLoaderData() { return useNav().loaderData; }
export function useRoute() { return useNav().route; }

// The query-string href for a target, built through the canonical buildSearch so a
// Link's href matches exactly what navigating there produces. `params` is keyed by
// the route's URL param (c / p / s). Home is the clean root.
export function hrefFor({ to, params } = {}) {
  const def = ROUTES[to] || ROUTES.home;
  const state = { route: to };
  if (def.param && params) state[def.field] = params[def.param];
  return buildSearch(state) || '/';
}

// react-router-shaped <Link>. Renders a real <a> so the URL previews on hover and
// (on web) ⌘/ctrl/middle-click opens the deep link in a new tab; a plain click is
// intercepted and dispatched through navigate().
export function Link({ to, params, onClick, children, ...rest }) {
  const navigate = useNavigate();
  const handleClick = (e) => {
    onClick?.(e);
    if (e.defaultPrevented) return;
    // On web, leave modified / non-primary clicks to the browser (new tab, etc.).
    if (host.isWeb && (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) return;
    e.preventDefault();
    navigate({ to, params });
  };
  return <a href={hrefFor({ to, params })} onClick={handleClick} {...rest}>{children}</a>;
}
