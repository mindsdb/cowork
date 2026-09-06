/**
 * Anonymous analytics over GET query parameters; never blocks or throws.
 * Mirrors anton/analytics.py. Do not include PII.
 */

import * as https from 'https';
import * as url from 'url';

const ANALYTICS_URL = 'https://x6nik28qi6.execute-api.us-east-2.amazonaws.com/default/zoomInfoCollector';
const TIMEOUT = 3000; // ms

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
      },
      (res) => { res.resume(); }
    );
    req.on('error', () => {});
    req.on('timeout', () => { req.destroy(); });
  } catch {
    // never throw
  }
}
