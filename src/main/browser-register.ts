/*
 * Telling the local server where the in-app browser listens.
 *
 * Main sends PUT /api/v1/runtime-credential/browser {url, token} with the
 * server's own key (authHeader). That route is write-only and loopback-only,
 * refused in org mode, and the server keeps the pair in memory only, so the
 * key never reaches an environment file or a code cell's environment. An
 * empty pair clears it, which turns the browser tool off for later turns.
 *
 * Pushes run one at a time, in order, so a clear never overtakes the set that
 * follows it. A server that predates the route answers 404: the browser stays
 * off, and the next server start pushes again.
 */

import { diagnostic } from '../shared/diagnostics';

export const BROWSER_REGISTRATION_PATH = '/api/v1/runtime-credential/browser';
const PUSH_TIMEOUT_MS = 10_000;

export interface BrowserHostAddress {
  url: string;
  token: string;
}

export interface RegistrationDeps {
  /** The local server's port once the app has started or adopted it, else
   *  null, during a start too. Nothing is sent while it is null. */
  serverPort(): number | null;
  authHeader(): Record<string, string>;
  fetch: typeof fetch;
}

export class BrowserRegistration {
  private queue: Promise<boolean> = Promise.resolve(true);
  private reportedMissingRoute = false;

  constructor(private readonly deps: RegistrationDeps) {}

  /** Registers `address`, or clears the registration when it is null. Resolves whether the server took it. */
  push(address: BrowserHostAddress | null): Promise<boolean> {
    const next = this.queue.then(() => this.send(address));
    this.queue = next;
    return next;
  }

  private async send(address: BrowserHostAddress | null): Promise<boolean> {
    const port = this.deps.serverPort();
    if (!port) return false;
    try {
      const res = await this.deps.fetch(`http://127.0.0.1:${port}${BROWSER_REGISTRATION_PATH}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...this.deps.authHeader() },
        body: JSON.stringify(address ?? { url: '', token: '' }),
        signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
      });
      if (res.ok) return true;
      if (res.status === 404) {
        if (!this.reportedMissingRoute) {
          this.reportedMissingRoute = true;
          diagnostic('main.browser-register', 'WARNING', 'browser_register_the_running_server_has_no_browser_route_it_predates_this_build');
        }
      } else {
        diagnostic('main.browser-register', 'WARNING', 'browser_register_the_server_refused_the_browser', { status: res.status });
      }
      return false;
    } catch (error) {
      diagnostic('main.browser-register', 'WARNING', 'browser_register_could_not_reach_the_server', error);
      return false;
    }
  }
}

/**
 * One started hook that runs each step in order. The server-start slot holds a
 * single function, and a step that fails must not stop the ones after it.
 */
export function composeStartedHook(...steps: Array<() => Promise<unknown>>): () => Promise<void> {
  return async () => {
    for (const step of steps) {
      try {
        await step();
      } catch (error) {
        diagnostic('main.browser-register', 'WARNING', 'server_started_hook_step_failed', error);
      }
    }
  };
}
