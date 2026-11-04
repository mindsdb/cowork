// Runs on a shared doc's published page (doc.html, inside the view.* frame).
// Everyone sees the plain page. If the visitor is the doc's owner, signed in,
// the page asks MindsHub for the live copy and becomes the editor. A signed-out
// visitor gets a quiet "Sign in to edit", since only signing in can tell.
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import SharedDocEditor from './SharedDocEditor';
import { createCloudTransport } from './cloudTransport';
import { DOC_SCHEMA } from '../cowork/components/doc/docModel';

const SCRIPT_SRC = document.currentScript?.src || '';
// The door's grant lasts ten minutes unless an answer renews it. The stream's
// reconnects do, but not while it backs off, so an open page in view reads
// now and then too.
const KEEP_GRANT_MS = 240_000;

// /content/{user_dir}/{report_id}/v/{md5}/index.html, optionally under one
// stage prefix (/Prod). Only a plain path segment: a prefix like //host would
// turn the sign-in link, which opens in the top window, into another site's.
export function pageAddress(pathname) {
  const m = /^(\/[\w-]+)?\/content\/([^/]+)\/([^/]+)\/v\/[^/]+\//.exec(pathname);
  if (!m) return null;
  const [, prefix = '', user, report] = m;
  return {
    prefix,
    api: `${prefix}/v1/viewer/artifact-docs/${encodeURIComponent(user)}/${encodeURIComponent(report)}`,
    signIn: `${prefix}/view/${encodeURIComponent(user)}/${encodeURIComponent(report)}?signin=1`,
  };
}

function loadStyles() {
  return new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = SCRIPT_SRC ? new URL('doc-editor.css', SCRIPT_SRC).href : 'doc-editor.css';
    link.onload = resolve;
    link.onerror = resolve; // unstyled beats stuck
    document.head.appendChild(link);
  });
}

function showSignIn(href) {
  const a = document.createElement('a');
  a.href = href;
  a.target = '_top';
  a.textContent = 'Your doc? Sign in to edit';
  a.setAttribute('style', [
    'position:fixed', 'right:16px', 'top:14px', 'z-index:10', 'padding:6px 12px', 'border-radius:999px',
    'font:500 12px/1.4 -apple-system,BlinkMacSystemFont,Inter,sans-serif', 'text-decoration:none',
    'background:var(--chip,#f1f1f4)', 'color:var(--ink-2,#3b3b45)', 'border:1px solid var(--line,#e4e4ea)',
  ].join(';'));
  document.body.appendChild(a);
}

function EditorRoot({ api, win }) {
  const [presence, setPresence] = useState(null);
  const [removed, setRemoved] = useState(false);
  const [lapsed, setLapsed] = useState(false);
  const [transport] = useState(() => createCloudTransport(api, {
    onPresence: setPresence, onRemoved: () => setRemoved(true), onLapsed: () => setLapsed(true),
  }));
  // Presence is a hint the desktop refreshes; reread it while the desktop is away.
  useEffect(() => {
    if (presence !== false || lapsed) return undefined;
    const t = setInterval(() => { transport.fetchDoc().catch(() => {}); }, 10_000);
    return () => clearInterval(t);
  }, [presence, lapsed, transport]);
  useEffect(() => {
    if (lapsed) return undefined;
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') transport.fetchDoc().catch(() => {});
    }, KEEP_GRANT_MS);
    return () => clearInterval(t);
  }, [lapsed, transport]);
  // The top window: the grant is minted only when the doc's /view/ page loads
  // there, and this page runs framed inside it, so reloading the frame alone
  // would come back read-only. A top window on another site (the view page
  // embedded elsewhere) can't be reloaded from here; this page's own reload
  // is the most there is then.
  const reload = () => {
    try { win.top.location.reload(); } catch { win.location.reload(); }
  };
  return <SharedDocEditor transport={transport} presence={presence} removed={removed} lapsed={lapsed} onReload={reload} />;
}

export async function boot(win = window) {
  const addr = pageAddress(win.location.pathname);
  if (!addr) return 'not-a-shared-page';
  let res;
  try {
    // Not followed: where the viewer does not serve this route yet, a catch-all
    // redirects it off-site, and following that broke the page's CSP (a console
    // error on every shared doc). Unfollowed, it is just "not editable here".
    res = await fetch(`${addr.api}/state`, { credentials: 'same-origin', redirect: 'manual' });
  } catch {
    return 'unreachable';
  }
  if (res.status === 401) {
    showSignIn(addr.signIn);
    return 'signed-out';
  }
  if (!res.ok) return 'view-only'; // not the owner, or not mirrored
  const state = await res.json().catch(() => null);
  if (!state?.capabilities?.canEdit) return 'view-only';
  // This editor ships with the app binary while the server, which writes the
  // doc, updates on its own: a doc in a format it predates stays the
  // published page rather than being edited by rules it doesn't know.
  if (state.doc?.schema !== DOC_SCHEMA) return 'view-only';
  await loadStyles();
  // The system's light or dark, followed rather than read once: a page left
  // open sees the system switch at dusk.
  const scheme = win.matchMedia?.('(prefers-color-scheme: dark)');
  const theme = () => { document.body.dataset.theme = scheme?.matches ? 'dark' : 'light'; };
  theme();
  scheme?.addEventListener?.('change', theme);
  for (const el of document.querySelectorAll('body > main.page')) el.hidden = true;
  const host = document.createElement('div');
  host.id = 'cowork-doc-editor';
  document.body.appendChild(host);
  createRoot(host).render(<EditorRoot api={addr.api} win={win} />);
  return 'editing';
}
