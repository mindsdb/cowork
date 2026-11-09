import { fetchBrowseStatus } from '../api';

/* GET /browse/status, read one way for Settings and the composer's + menu
   (hooks/useBrowseAvailable.js), so the two never disagree. */

/**
 * @typedef {import('../api').BrowseStatus} BrowseStatus
 */

/* A read with no answer after this long has failed, and api.js aborts its
   request. cowork-server's browser client (services/browser.py) waits up to
   15 s on the browser router, so a slow router reaches the app as the
   server's own refusal, not a time-out. */
export const READ_TIMEOUT_MS = 20_000;

/**
 * What a server with no such route (a 404) means: it predates the browser,
 * so it offers none. This is the answer a server without the browser gives,
 * so Settings shows no group and the + menu offers no switch.
 * @type {BrowseStatus}
 */
const NO_STATUS_ROUTE = Object.freeze({ enabled: true, available: false, status: 'unavailable' });

/**
 * GET /browse/status. A 404 answers as a server without the browser does.
 * Any other failure rejects, and so does a read with no answer in
 * READ_TIMEOUT_MS.
 *
 * @returns {Promise<BrowseStatus>}
 */
export async function readBrowseStatus() {
  try {
    return await fetchBrowseStatus({ timeoutMs: READ_TIMEOUT_MS });
  } catch (error) {
    if (error?.status === 404) return NO_STATUS_ROUTE;
    throw error;
  }
}
