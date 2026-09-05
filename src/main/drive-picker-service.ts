// Serve Google Picker through a temporary loopback server in the OS browser.
// Google blocks its sign-in flow inside Electron webContents.

import * as http from 'http';
import * as crypto from 'crypto';
import { shell } from 'electron';
import { findFreePort, closeServer, base64UrlEncode, startLoopbackServer, raceWithTimeout } from './oauth-service';

export interface DrivePickerFile {
  id: string;
  name: string;
  mimeType?: string;
  iconUrl?: string;
  url?: string;
}

export interface DrivePickerResult {
  ok: boolean;
  reason?: string;
  files?: DrivePickerFile[];
}

// Longer than the OAuth callback timeout — browsing and picking files
// takes longer than typing credentials on a login form.
const PICKER_TIMEOUT_MS = 5 * 60 * 1000;

// Validate IPC file IDs before embedding them in the picker page’s inline script.
const DRIVE_FILE_ID_RE = /^[A-Za-z0-9_-]+$/;

export function isValidDriveFileIds(fileIds: unknown): fileIds is string[] | undefined {
  if (fileIds === undefined) return true;
  return Array.isArray(fileIds) && fileIds.every((id) => typeof id === 'string' && DRIVE_FILE_ID_RE.test(id));
}

let _activeAttempt: { cancel: () => void } | null = null;

export function cancelCurrentDrivePicker(): void {
  _activeAttempt?.cancel();
}

/** Open Picker in the OS browser; optional fileIds preselect files for consent. */
export async function openDrivePickerFlow(
  accessToken: string,
  apiKey: string,
  appId: string | undefined,
  accountEmail: string,
  fileIds?: string[],
): Promise<DrivePickerResult> {
  // Cancel any prior attempt before replacing it so its loopback server is not orphaned.
  _activeAttempt?.cancel();

  let port: number;
  try {
    port = await findFreePort();
  } catch (e: any) {
    return { ok: false, reason: `Could not bind a loopback port: ${e?.message || e}` };
  }

  const state = base64UrlEncode(crypto.randomBytes(16));
  // Serve token-bearing HTML only once; the URL state remains valid for the entire picker timeout.
  let stateConsumed = false;

  // A slow load only changes the eventual timeout message; it must not fail a picker that may still
  // succeed.
  let suspectedAccountMismatch = false;

  let rejectResult: ((err: Error) => void) | null = null;
  const { server, resultPromise } = startLoopbackServer<DrivePickerFile[]>(port, (resolve, reject) => {
    rejectResult = reject;
    return http.createServer((req, res) => {
      try {
        const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);

        if (url.pathname === '/' && req.method === 'GET') {
          if (url.searchParams.get('state') !== state || stateConsumed) {
            res.statusCode = 403;
            res.end('Invalid state.');
            return;
          }
          stateConsumed = true;
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/html');
          // The token in this page must never survive in a disk/back-forward
          // cache once served.
          res.setHeader('Cache-Control', 'no-store');
          res.end(pickerPage({ accessToken, apiKey, appId: appId || '', accountEmail, state, fileIds: fileIds || [] }));
          return;
        }

        if (url.pathname === '/result' && req.method === 'POST') {
          let body = '';
          // Before validating state, return HTTP errors without settling the flow: any local
          // process or page can POST here.
          // Keep an error listener attached so aborted requests cannot crash the main process.
          req.on('error', () => {
            try { res.statusCode = 400; res.end('Bad request.'); } catch {}
          });
          req.on('data', (chunk) => { body += chunk; });
          req.on('end', () => {
            let payload: { state?: string; files?: DrivePickerFile[]; cancelled?: boolean; error?: string; signal?: string };
            try {
              payload = JSON.parse(body || '{}');
            } catch {
              res.statusCode = 400;
              res.end('Bad request.');
              return;
            }
            if (payload.state !== state) {
              res.statusCode = 403;
              res.end('Invalid state.');
              return;
            }
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end('{"ok":true}');
            // Record the load warning without settling; a slow picker can still succeed.
            if (payload.signal === 'suspected-account-mismatch') {
              suspectedAccountMismatch = true;
              return;
            }
            // Reject widget errors with a reason; an empty successful list would look like
            // cancellation.
            if (payload.error) {
              reject(new Error(payload.error));
              return;
            }
            resolve(payload.cancelled ? [] : (Array.isArray(payload.files) ? payload.files : []));
          });
          return;
        }

        res.statusCode = 404;
        res.end('Not found.');
      } catch (e: any) {
        try { res.statusCode = 500; res.end('Internal error'); } catch {}
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  });

  _activeAttempt = {
    cancel: () => {
      try { rejectResult?.(new Error('Picker cancelled.')); } catch {}
      closeServer(server);
    },
  };

  // Surface browser-launch failures immediately; otherwise this local URL would wait out the picker
  // timeout.
  try {
    await shell.openExternal(`http://127.0.0.1:${port}/?state=${state}`);
  } catch (e: any) {
    closeServer(server);
    _activeAttempt = null;
    return { ok: false, reason: `Could not open a browser for the Drive picker: ${e?.message || e}` };
  }

  try {
    const files = await raceWithTimeout(
      resultPromise,
      PICKER_TIMEOUT_MS,
      `Picker timed out — no selection received within ${Math.round(PICKER_TIMEOUT_MS / 60000)} minutes.`,
    );
    return { ok: true, files };
  } catch (e: any) {
    const reason = buildPickerFailureReason(e?.message || 'Drive picker failed.', suspectedAccountMismatch, accountEmail);
    return { ok: false, reason };
  } finally {
    // Tiny delay so the confirmation state actually paints in the
    // user's browser tab before we tear the server down.
    setTimeout(() => closeServer(server), 300);
    _activeAttempt = null;
  }
}

// Upgrade only timeout messages, leaving cancellation and widget errors unchanged.
export function buildPickerFailureReason(rawReason: string, suspectedAccountMismatch: boolean, accountEmail: string): string {
  if (!suspectedAccountMismatch || !/timed out/i.test(rawReason)) return rawReason;
  return `${rawReason} This is usually caused by ${accountEmail} not being the active Google account in this browser — switch to that account, close the tab, and try again.`;
}

// Escape < as Unicode so interpolated JSON cannot break out of the token-bearing script via
// </script>.
function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

// Values embedded in static markup also need HTML escaping, separately from script-safe JSON.
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

function pickerPage(opts: { accessToken: string; apiKey: string; appId: string; accountEmail: string; state: string; fileIds: string[] }): string {
  const { accessToken, apiKey, appId, accountEmail, state, fileIds } = opts;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Pick Google Drive files</title>
<style>
  :root { color-scheme: light dark; }
  html, body { margin: 0; padding: 0; height: 100%; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    display: grid; place-items: center; padding: 40px;
    background: #FAFAFA; color: #0E0F10;
  }
  @media (prefers-color-scheme: dark) {
    body { background: #080d18; color: #E8EDF7; }
    p { color: #8A97AE; }
  }
  .card { max-width: 420px; text-align: center; }
  h1 { font-size: 20px; font-weight: 600; margin: 0 0 10px; letter-spacing: -0.01em; }
  p { font-size: 14px; line-height: 1.5; margin: 0; color: #6B6F73; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%;
         background: #1F9CB0; margin-right: 8px; vertical-align: middle; }
  .err .dot { background: #d64545; }
  .err p { color: #d64545; }
</style></head>
<body>
  <div class="card" id="status">
    <h1><span class="dot"></span>Opening Google Drive picker…</h1>
    <p>A Google file picker will open in a moment, using your ${escapeHtml(accountEmail)} connection.</p>
  </div>
<script src="https://apis.google.com/js/api.js"></script>
<script>
(function () {
  var STATE = ${jsonForScript(state)};
  var ACCESS_TOKEN = ${jsonForScript(accessToken)};
  var API_KEY = ${jsonForScript(apiKey)};
  var APP_ID = ${jsonForScript(appId)};
  var ACCOUNT_EMAIL = ${jsonForScript(accountEmail)};
  var FILE_IDS = ${jsonForScript(fileIds)};

  // ACCOUNT_EMAIL ends up in innerHTML below (not just a JS string literal),
  // so it needs HTML escaping too, on top of the <script>-breakout escaping
  // jsonForScript already did when embedding it above.
  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function setStatus(title, body, isError) {
    var card = document.getElementById('status');
    card.className = isError ? 'card err' : 'card';
    card.innerHTML = '<h1><span class="dot"></span>' + title + '</h1><p>' + body + '</p>';
  }

  function reportResult(payload) {
    fetch('/result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ state: STATE }, payload)),
    }).catch(function () {});
  }

  // Most common cause of the in-widget ERROR action: the browser's active
  // Google account differs from the connected account (ACCOUNT_EMAIL) —
  // Google's picker widget renders under whichever account is ambient in
  // this browser session, not the one the access token above is scoped to,
  // and 403s instead of showing the file browser. This is a genuine,
  // widget-confirmed error (the widget loaded and then reported one), so
  // it's fine to end the flow here — unlike the load-timeout signal below,
  // which is only a guess.
  function reportPickerLoadFailure() {
    setStatus(
      'Could not open Google Drive',
      'This is usually caused by ' + escapeHtml(ACCOUNT_EMAIL) + ' not being the active Google account in this browser. '
        + 'Switch to that account (check the avatar menu on a Google page), close this tab, and try again from Cowork.',
      true
    );
    // Sent as 'reason' to the renderer, which displays it as plain React
    // text (not innerHTML) — intentionally NOT escapeHtml(ACCOUNT_EMAIL)
    // here, since escaping would show literal HTML entities in that text.
    reportResult({ error: 'Google Picker could not open — the browser’s active Google account may not match ' + ACCOUNT_EMAIL + '.' });
  }

  // A static Google 403 error page rendered inside the picker's iframe (the
  // ENG-1102 failure mode) has no picker JS running in it, so it can never
  // emit PICKED/CANCEL/ERROR over the postMessage relay — Action.ERROR only
  // fires once the widget itself has loaded and then hit a problem, so it
  // can't catch this case.
  //
  // This can't be told apart, from here, from a widget that loaded fine and
  // is just sitting there while the user browses — the iframe is
  // cross-origin, onload fires identically for both, and there is no
  // Action.LOADED. So on timeout this only signals a suspicion to the
  // main process (see /result's 'signal' handling in openDrivePickerFlow) —
  // it must never close the picker or end the flow itself, or a user who
  // simply takes longer than this to pick a file loses their in-progress
  // selection.
  var PICKER_LOAD_TIMEOUT_MS = 9000;

  function buildAndShowPicker() {
    var google = window.google;
    var views = [];

    // Deliberately NOT calling setIncludeFolders(true)/setSelectFolderEnabled(false)
    // here — folder *navigation* (double-clicking into a folder) already works
    // by default without it. That pair is only for making folders themselves
    // selectable results, and combining it with MULTISELECT_ENABLED is a known
    // Picker bug: the Select button gets stuck disabled in whichever view loads
    // it, while views without it behave normally.
    if (FILE_IDS.length > 0) {
      views.push(new google.picker.DocsView(google.picker.ViewId.DOCS).setFileIds(FILE_IDS));
    }
    views.push(new google.picker.DocsView(google.picker.ViewId.DOCS));
    views.push(new google.picker.DocsView(google.picker.ViewId.DOCS).setOwnedByMe(false));
    views.push(new google.picker.DocsView(google.picker.ViewId.DOCS).setEnableDrives(true));

    // Tracks whether the user reached a terminal action (picked, cancelled,
    // or the widget reported a genuine error) — NOT whether the widget
    // loaded, since nothing here can observe that directly (see
    // PICKER_LOAD_TIMEOUT_MS above).
    var userActed = false;
    var loadTimeoutId = null;
    function markUserActed() {
      userActed = true;
      if (loadTimeoutId !== null) { clearTimeout(loadTimeoutId); loadTimeoutId = null; }
    }

    var builder = new google.picker.PickerBuilder()
      .setOAuthToken(ACCESS_TOKEN)
      .setDeveloperKey(API_KEY)
      .setAppId(APP_ID)
      .setTitle('Choose files from ' + ACCOUNT_EMAIL)
      .enableFeature(google.picker.Feature.MULTISELECT_ENABLED)
      .enableFeature(google.picker.Feature.SUPPORT_DRIVES)
      .setCallback(function (data) {
        if (data.action === google.picker.Action.PICKED) {
          markUserActed();
          var files = (data.docs || []).map(function (doc) {
            // resourceKey: required by Drive API alongside the file id for
            // many files that aren't owned by the connecting account (link-
            // shared docs especially) — omitting it makes files.get() return
            // 404 notFound even with a valid, correctly-granted token.
            return { id: doc.id, name: doc.name, mimeType: doc.mimeType, iconUrl: doc.iconUrl, url: doc.url, resourceKey: doc.resourceKey || null };
          });
          setStatus(
            files.length + ' file' + (files.length === 1 ? '' : 's') + ' selected',
            'You can close this tab and return to MindsHub Cowork.'
          );
          reportResult({ files: files });
        } else if (data.action === google.picker.Action.CANCEL) {
          markUserActed();
          setStatus('Picker closed', 'You can close this tab and return to MindsHub Cowork.');
          reportResult({ files: [] });
        } else if (data.action === google.picker.Action.ERROR) {
          // The widget itself loaded and then hit an internal error — a
          // genuine in-widget failure, distinct from the silent load
          // failure the timeout below only suspects.
          markUserActed();
          reportPickerLoadFailure();
        }
      });
    views.forEach(function (v) { builder.addView(v); });
    var picker = builder.build();
    picker.setVisible(true);

    loadTimeoutId = setTimeout(function () {
      if (userActed) return;
      loadTimeoutId = null;
      // Non-destructive: the picker stays open and the flow stays alive. A
      // user who was just slow keeps their in-progress picker and finishes
      // normally; a user genuinely stuck on a silent 403 gets the
      // account-mismatch guidance once the flow eventually times out (see
      // buildPickerFailureReason in drive-picker-service.ts).
      reportResult({ signal: 'suspected-account-mismatch' });
    }, PICKER_LOAD_TIMEOUT_MS);
  }

  window.onload = function () {
    if (!window.gapi) {
      setStatus('Could not load Google Picker', 'Your connection to Google may be blocked. Close this tab and try again.', true);
      reportResult({ cancelled: true });
      return;
    }
    window.gapi.load('picker', {
      callback: buildAndShowPicker,
      onerror: function () {
        setStatus('Could not load Google Picker', 'Close this tab and try again.', true);
        reportResult({ cancelled: true });
      },
    });
  };
})();
</script>
</body></html>`;
}
