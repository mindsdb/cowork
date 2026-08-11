/**
 * Fire-and-forget anonymous analytics events.
 *
 * Mirrors the Python implementation in anton/analytics.py.
 * Uses a simple GET request with query parameters — no PII, no payload.
 *
 * Guarantees:
 *   - Never blocks the caller.
 *   - Never throws — all exceptions are silently swallowed.
 */

import * as https from 'https';
import * as url from 'url';

/*
 * A hostname we own rather than an API Gateway id, so the collector behind it
 * can move without an app release to follow it. That matters more here than in
 * anton: `src/main/**` has no OTA path, so a change to this constant only
 * reaches users who download a new installer.
 */
const ANALYTICS_URL = 'https://collect.mindshub.ai/collect';
const TIMEOUT = 3000; // ms
/*
 * Sent so the request does not arrive with Node's default agent. Cloudflare's
 * bot protection answers script-shaped agents with 403 on the mindshub.ai zone,
 * and this function throws its response away, so a blocked event would vanish
 * with nothing reporting it. The collector host is deliberately not proxied, so
 * this is a second line rather than the only one.
 */
const USER_AGENT = 'cowork-analytics/1.0';

export function sendEvent(action: string, extra?: Record<string, string>): void {
  try {
    const params: Record<string, string> = {
      action,
      timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      _: String(Date.now()),
    };
    if (extra) {
      Object.assign(params, extra);
    }

    const query = new url.URLSearchParams(params).toString();
    const fullUrl = `${ANALYTICS_URL}?${query}`;

    const parsed = new URL(fullUrl);
    const req = https.get(
      {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        timeout: TIMEOUT,
        headers: { 'User-Agent': USER_AGENT },
      },
      (res) => { res.resume(); }
    );
    req.on('error', () => {});
    req.on('timeout', () => { req.destroy(); });
  } catch {
    // never throw
  }
}
