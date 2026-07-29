// Google Picker, run the same way oauth-service.ts runs the OAuth
// handshake: a one-off loopback server serves the picker page, the OS
// default browser opens it, and we wait for the page to post back the
// user's selection. Embedding the Picker inside Electron's own webContents
// doesn't work — Google's sign-in step (needed the first time the widget
// has no session cookie for the account) is blocked by the same
// disallowed-embedded-user-agent policy that already makes the OAuth PKCE
// flow above use a real browser instead of a BrowserWindow. Running the
// Picker in the OS browser sidesteps that entirely, and the user's normal
// browser usually already has an active Google session, so there's often
// no sign-in prompt at all.

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

// Real Drive file ids only ever match this shape. `fileIds` comes from the
// renderer bridge (IPC.OAUTH_PICK_DRIVE_FILES) and ends up interpolated
// into an inline <script> on the picker page (see pickerPage below) — the
// IPC handler validates against this before calling openDrivePickerFlow,
// rather than trusting the caller.
const DRIVE_FILE_ID_RE = /^[A-Za-z0-9_-]+$/;

export function isValidDriveFileIds(fileIds: unknown): fileIds is string[] | undefined {
  if (fileIds === undefined) return true;
  return Array.isArray(fileIds) && fileIds.every((id) => typeof id === 'string' && DRIVE_FILE_ID_RE.test(id));
}

let _activeAttempt: { cancel: () => void } | null = null;

export function cancelCurrentDrivePicker(): void {
  _activeAttempt?.cancel();
}

/**
 * Opens the Google Picker in the OS default browser and resolves with the
 * files the user selected there. `fileIds`, when provided, pre-navigates
 * the picker to those specific files (Picker's `setFileIds`, GA Jan 2025)
 * for faster consent — e.g. when the user pasted a Drive link and we
 * already know which file they mean.
 */
export async function openDrivePickerFlow(
  accessToken: string,
  apiKey: string,
  appId: string | undefined,
  accountEmail: string,
  fileIds?: string[],
): Promise<DrivePickerResult> {
  // A second picker session (e.g. the composer's picker still open when
  // the user separately opens connection-details' "Select files") would
  // otherwise silently overwrite _activeAttempt, orphaning the first
  // session's server/browser tab with no way to cancel it. Only one
  // picker session can usefully be in flight at a time, so cancel
  // whichever one is already running before starting a new one.
  _activeAttempt?.cancel();

  let port: number;
  try {
    port = await findFreePort();
  } catch (e: any) {
    return { ok: false, reason: `Could not bind a loopback port: ${e?.message || e}` };
  }

  const state = base64UrlEncode(crypto.randomBytes(16));
  // The page served below embeds `accessToken` in plain text. The state
  // check alone isn't enough to keep it single-serve — it stays valid for
  // the whole PICKER_TIMEOUT_MS window, so without this flag the token-
  // bearing HTML could be re-fetched (e.g. from browser history, since
  // state rides in the URL) any number of times before the server closes.
  let stateConsumed = false;

  // Set by the picker page's load-timeout signal (see pickerPage below) when
  // the widget hasn't reached a terminal action within a few seconds — most
  // often because the browser's active Google account doesn't match
  // accountEmail. That alone isn't proof of failure (a slow-but-successful
  // load looks identical from the page's point of view), so it must never
  // resolve/reject the flow by itself — it only upgrades the message if the
  // flow *later* genuinely times out, via buildPickerFailureReason below.
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
          // The loopback port is reachable by any local process, and a
          // page open in the user's browser can POST here too (a
          // no-cors fetch still sends the request — it just can't read
          // the response). Until `state` below has been checked, we
          // have no idea whether a given request came from the tab we
          // opened, so nothing in this handler may reject()/resolve()
          // the flow before that check passes — only respond with a
          // plain HTTP error and keep waiting. Attaching this listener
          // (regardless of what it does) is what keeps an aborted
          // request's 'error' event from throwing and crashing the
          // Electron main process — it doesn't need to reject the flow
          // to do that.
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
            // A non-terminal signal — the widget hasn't settled yet, this
            // only records a suspicion for later. Must return before the
            // resolve/reject calls below: the flow stays open so a user who
            // was just slow, or whose widget was fine all along, can still
            // finish normally.
            if (payload.signal === 'suspected-account-mismatch') {
              suspectedAccountMismatch = true;
              return;
            }
            // The picker page reports `error` when Google's own widget hit an
            // error (google.picker.Action.ERROR) — most commonly the browser's
            // active Google account not matching the connected account. Reject
            // rather than resolve so the caller gets a reason instead of an
            // empty (indistinguishable-from-cancelled) file list.
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

  // Unlike oauthConnect's auth URL, this URL has no meaning to paste into
  // an already-open browser manually — it's only useful if openExternal
  // actually launches something, so a launch failure should surface
  // immediately rather than silently waiting out the full PICKER_TIMEOUT_MS.
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

// Only upgrades a genuine timeout (never a cancellation or an in-widget
// Action.ERROR, which already carry their own specific reason) — matching on
// the timeout's own wording rather than a separate error code keeps this a
// pure, directly testable function instead of threading a reason-kind enum
// through raceWithTimeout for one caller.
export function buildPickerFailureReason(rawReason: string, suspectedAccountMismatch: boolean, accountEmail: string): string {
  if (!suspectedAccountMismatch || !/timed out/i.test(rawReason)) return rawReason;
  return `${rawReason} This is usually caused by ${accountEmail} not being the active Google account in this browser — switch to that account, close the tab, and try again.`;
}

// JSON.stringify doesn't escape `<`, so a value containing `</script>`
// would close the inline <script> below early and let whatever follows
// execute on this page (which holds the access token). Replacing every `<`
// with its unicode escape is a no-op for JSON parsing but makes that
// impossible.
function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

// accountEmail is interpolated directly into the static HTML markup below
// (not just the inline <script>), so it needs HTML escaping on top of the
// script-breakout escaping jsonForScript does for the values embedded there.
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
