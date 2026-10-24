import { fetchConnector, startConnectorOAuth, pollConnectorOAuth } from '../api';
import { host } from '../../platform/host';

// Web has no Electron main process to run the loopback PKCE flow, so
// host.oauthConnect() is a stub there (see platform/host.ts) — this drives
// the same server-side redirect flow DataVaultFormPanel's browser_oauth_builtin
// branch uses for the Connect button, trimmed to the "+" menu hooks' simpler
// "connect, then run a callback" shape (no form/patchForm involved here).
// Poll budget kept identical to DataVaultFormPanel's BROWSER_OAUTH_POLL_MS/
// BROWSER_OAUTH_TIMEOUT_MS (not just similar) so the two never silently drift.
const OAUTH_POLL_MS = 3000;
const OAUTH_MAX_POLLS = 40; // 40 * 3000ms = 2 min

export async function connectViaWebRedirect(connectorId, label) {
  // Opened synchronously, inside the click gesture, BEFORE any await —
  // otherwise two chained network round-trips (fetchConnector,
  // startConnectorOAuth) can lose the click's transient user-activation
  // and the popup gets silently blocked (seen on Safari), leaving the user
  // staring at nothing for the full poll timeout with no clue why. Mirrors
  // DataVaultFormPanel's oauth_launch branch. Redirected to the real auth
  // URL once it's known; falls back to host.openExternal if blocked.
  let popup = null;
  try { popup = window.open('', '_blank'); } catch { popup = null; }

  const spec = await fetchConnector(connectorId);
  // Methods live under spec.form.methods on this endpoint's real response
  // shape (ConnectorSpecResponse, cowork-server/cowork/schemas/connectors.py)
  // — same as app.ts's desktop OAUTH_CONNECT handler reads from the identical
  // /connectors/specs/{id} endpoint. NOT spec.methods directly, which is only
  // the shape of DataVaultFormPanel's separately-flattened chat-embedded
  // form spec, a different object entirely.
  const serviceId = spec?.form?.methods?.find((m) => m.id === 'browser_oauth_builtin' || m.id === 'mcp')?.oauth?.service_id;
  if (!serviceId) {
    if (popup) { try { popup.close(); } catch { /* best effort */ } }
    throw new Error(`No OAuth configuration for ${label}.`);
  }
  const started = await startConnectorOAuth(serviceId, {});
  if (!started?.authUrl || !started?.state) {
    if (popup) { try { popup.close(); } catch { /* best effort */ } }
    throw new Error(`Could not start ${label} sign-in. Is the server running?`);
  }
  if (popup) {
    try { popup.location.href = started.authUrl; }
    catch { await host.openExternal(started.authUrl); }
  } else {
    await host.openExternal(started.authUrl);
  }
  for (let i = 0; i < OAUTH_MAX_POLLS; i++) {
    await new Promise((resolve) => setTimeout(resolve, OAUTH_POLL_MS));
    let status;
    try {
      status = await pollConnectorOAuth(started.state);
    } catch {
      continue; // transient — keep polling
    }
    if (status?.status === 'success') {
      if (popup) { try { popup.close(); } catch { /* best effort */ } }
      try { window.focus(); } catch { /* best effort */ }
      return;
    }
    if (status?.status === 'error') throw new Error(status.error || `Could not connect ${label}.`);
    if (status?.status === 'expired') throw new Error('The sign-in expired before it completed. Try again.');
    // 'pending' → keep waiting.
  }
  throw new Error(`Timed out waiting for the ${label} sign-in to complete.`);
}
