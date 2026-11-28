/* Whether the proxy configuration sends a request to the local server through a proxy.
 *
 * The local server at `http://127.0.0.1:<port>` speaks plain HTTP, and main adds the bearer token
 * and the window proof to the window's requests to it, so a proxy that receives those requests
 * reads both. Chromium sends requests for loopback hosts directly, past a manual or PAC proxy
 * configuration, unless the configuration's bypass rules remove that exemption with `<-loopback>`.
 * The launch guard (launch-guard.ts) refuses a `--proxy-bypass-list` switch that does this, but the
 * same rule can arrive through an operating system setting that a program running as the user can
 * write, such as the per-user proxy settings on Windows or the proxy environment variables on
 * Linux.
 *
 * The check does not depend on how the rule arrived. It runs per request to the local server, as
 * the last gate before the token is added: a gate (requireDirectRoute in server-token-listener.ts)
 * asks the main window's session how it would route the request, and cancels the request unless
 * the answer is DIRECT. Because it asks for each request, after any wait on the gates before it, it
 * also covers a proxy setting changed while the app runs, including one changed while the request
 * waited. The window's file:// load never waits on it, since only requests to the local server do.
 * app.ts runs the gate in a packaged build, except when its Node inspector is active, the same
 * exception the launch guard makes. */

/** Whether a `session.resolveProxy` answer sends the request anywhere but directly. The answer
 *  lists the routes Chromium would try in order, separated by `;`, such as `PROXY host:port`,
 *  `SOCKS5 host:port` or `DIRECT`. Only an answer whose every route is DIRECT keeps the request
 *  away from a proxy: in `PROXY a:1;DIRECT` the proxy comes first. An empty answer names no
 *  direct route, so it counts as proxied too. */
export function routesThroughProxy(resolvedProxy: string): boolean {
  const routes = resolvedProxy.split(';').map((route) => route.trim()).filter((route) => route !== '');
  return routes.length === 0 || routes.some((route) => route.toUpperCase() !== 'DIRECT');
}
