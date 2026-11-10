import { useCallback, useEffect, useRef, useState } from 'react';
import Ico from '../Icons';
import Button from '../ui/Button';
import EmptyState from '../ui/EmptyState';
import Spinner from '../ui/Spinner';
import { embedBrowser } from '../../api';
import { VIEWER_CLOSED, VIEWER_READY, afterViewerClose, browserViewerTheme, viewerLinkFrom } from '../../lib/browserSession';
import { host } from '../../../platform/host';
import { WEB_JEV_LINE, WEB_SIGN_INS } from '../../views/settings/BrowserSettingsSection';
import { BrowserFrame } from './BrowserFrame';
import { LocalBrowserStage } from './LocalBrowserStage';

/* The person's browser beside the chat. The agent drives it through its
   browser tool; the person watches, and can click and type in it at any time
   (sign in, solve a CAPTCHA, take over).

   On the desktop it is the app's own browser, shown natively
   (LocalBrowserStage). On the web it is the browser router's viewer, framed
   below.

   The viewer is the browser router's page, framed through a link the pane
   mints with POST /browse/embed. The router honors a link once, so the pane
   mints a new one every time it shows the viewer: when it opens, when the tab
   becomes visible again, when the network comes back, when the person asks,
   and when the viewer reports that its connection closed. Never on a timer.
   While the tab is hidden the pane drops the frame, so a browser nobody is
   watching can go to sleep.

   The browser may still be starting: until the viewer itself says it is
   ready (a VIEWER_READY postMessage), the pane says so. A frame load alone
   is not enough: the router's starting page, while it reloads, and an edge
   error page load the frame without the viewer and never post. Every router
   refusal of the view (a spent or expired link, a browser that is
   unreachable or full) is a page that posts VIEWER_CLOSED, and so does the
   starting page's last load before its link lapses; afterViewerClose decides
   what the pane does then. After STARTING_TIMEOUT_MS of waiting, the pane
   offers to try again. That clock runs on across the new links a close
   brings, and starts over only when a viewer gets ready or the person, the
   tab or the network asks again, so a router that keeps closing still
   reaches it. */
export const STARTING_TIMEOUT_MS = 90_000;

/**
 * What the pane says in place of the view when it stops: a title, and the
 * sentence under it.
 *
 * @typedef {{ title: string, description: string }} PaneStop
 */

const UNREACHABLE = "The browser isn't reachable";

/* What the pane says when it stops asking for links after a close. A full
   browser is still reachable, so its two stops get titles of their own. */
/** @type {Record<'keeps-closing' | 'no-browser-slot' | 'task-cap', PaneStop>} */
const STOPPED = {
  'keeps-closing': { title: UNREACHABLE, description: 'The browser view keeps closing. Try again in a moment.' },
  'no-browser-slot': { title: 'No browser is free', description: 'Every browser is busy right now. Try again in a few minutes.' },
  'task-cap': { title: 'Your browser is full', description: 'Your browser already has 4 tasks open.' },
};

function tabHidden() {
  return document.visibilityState === 'hidden';
}

/* Sends the app's theme to the viewer. The target is '*' because the viewer
   runs sandboxed as an opaque origin, which no origin string matches; the
   message is only colors and fonts, sent to this frame's window alone. */
function postTheme(frame) {
  frame?.contentWindow?.postMessage(
    browserViewerTheme(getComputedStyle(document.body), document.body.dataset.theme),
    '*',
  );
}

/* The web pane's note on where things go and what stays. The view and every
   key typed in it cross Cloudflare and MindsDB's browser service. The
   agent's page reads go to the model provider and, with Jev on, to Jev. Sites
   the person signs in to stay signed in for later tasks. The Jev and sign-in
   lines are Settings' own, so the two surfaces can't drift. The pane can't
   tell who holds the browser (the viewer posts only that it is ready or
   closed), so the sign-in line always shows. */
export function webPaneNote(agentLabel) {
  return `What this pane shows and what you type here, passwords included, pass through Cloudflare and MindsDB's browser service on their way to and from the site. ${agentLabel}'s page reads and screenshots go to the model provider that serves your turn. ${WEB_JEV_LINE} ${WEB_SIGN_INS}`;
}

/**
 * @param {{ sessionId: string, agentLabel?: string, onClose: () => void,
 *   floating?: boolean, extraActions?: import('react').ReactNode }} props
 */
export function BrowserPanel(props) {
  return host.supportsInAppBrowser ? <LocalBrowserStage {...props} /> : <WebBrowserStage {...props} />;
}

/**
 * @param {{ sessionId: string, agentLabel?: string, onClose: () => void }} props
 */
function WebBrowserStage({ sessionId, agentLabel = 'Anton', onClose, floating = false, extraActions = null }) {
  const [viewUrl, setViewUrl] = useState(null);
  const [error, setError] = useState(/** @type {PaneStop | null} */ (null));
  const [hidden, setHidden] = useState(tabHidden);
  const [generation, setGeneration] = useState(0);
  const [viewerReady, setViewerReady] = useState(false);
  const [slow, setSlow] = useState(false);
  /* Bumped when the starting clock starts over on a request from the
     person, the tab or the network, so the clock restarts even while the
     pane is still waiting. */
  const [waitRound, setWaitRound] = useState(0);
  const frameRef = useRef(null);
  /* Bumped by every mint and by hiding the tab, so an answer that arrives
     after a newer request, or after the tab hid, is dropped. */
  const mintSeq = useRef(0);
  const mintedAt = useRef(0);
  const quickCloses = useRef(0);
  // Whether the current link's viewer said it is ready, for the close handler.
  const readyRef = useRef(false);
  const frameKey = `${viewUrl}:${generation}`;

  const mint = useCallback(async () => {
    mintSeq.current += 1;
    const seq = mintSeq.current;
    setError(null);
    setViewUrl(null);
    let link = null;
    let failure = '';
    try {
      link = viewerLinkFrom(await embedBrowser(sessionId), sessionId);
      if (!link) failure = 'The browser returned an unexpected address.';
    } catch (err) {
      failure = err?.message || 'Could not open the browser.';
    }
    if (seq !== mintSeq.current) return;
    if (failure) {
      setError({ title: UNREACHABLE, description: failure });
      return;
    }
    mintedAt.current = Date.now();
    setViewUrl(link);
    setGeneration((g) => g + 1);
  }, [sessionId]);

  /* A request from the person, the tab or the network, and a new session,
     start the count of failed opens and the starting clock over. */
  const retry = useCallback(() => {
    quickCloses.current = 0;
    setSlow(false);
    setWaitRound((round) => round + 1);
    void mint();
  }, [mint]);

  // A tab that opens the pane hidden mints once it is visible (below).
  useEffect(() => {
    if (!tabHidden()) retry();
    return () => { mintSeq.current += 1; };
  }, [retry]);

  useEffect(() => {
    const onVisibility = () => {
      if (tabHidden()) {
        mintSeq.current += 1;
        setHidden(true);
        setViewUrl(null);
        setError(null);
        return;
      }
      setHidden(false);
      retry();
    };
    const onOnline = () => {
      if (!tabHidden()) retry();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
    };
  }, [retry]);

  /* The viewer asks for the theme once loaded, and reports when its
     connection closes. The sandboxed frame's origin is 'null', so the message's
     source, this pane's own frame, is what identifies it. */
  useEffect(() => {
    const onMessage = (event) => {
      const frameWindow = frameRef.current?.contentWindow;
      if (!frameWindow || event.source !== frameWindow) return;
      const type = event.data?.type;
      if (type === VIEWER_READY) {
        readyRef.current = true;
        setViewerReady(true);
        setSlow(false);
        postTheme(frameRef.current);
        return;
      }
      if (type !== VIEWER_CLOSED) return;
      const next = afterViewerClose({
        mintedAtMs: mintedAt.current,
        nowMs: Date.now(),
        quickCloses: quickCloses.current,
        ready: readyRef.current,
        code: event.data?.code,
      });
      quickCloses.current = next.quickCloses;
      if (next.remint) {
        void mint();
        return;
      }
      mintSeq.current += 1;
      setViewUrl(null);
      setError(STOPPED[next.stop]);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [mint]);

  /* Keep the viewer's toolbar in the app's theme as the theme, skin or
     custom accent changes. */
  useEffect(() => {
    if (!viewUrl) return undefined;
    const observer = new MutationObserver(() => postTheme(frameRef.current));
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-theme', 'data-skin', 'style'] });
    return () => observer.disconnect();
  }, [viewUrl, generation]);

  // A new frame (or a fresh link in flight) waits for its own viewer's ready.
  useEffect(() => {
    readyRef.current = false;
    setViewerReady(false);
  }, [frameKey]);

  /* The starting clock runs while the pane waits. A new link that a close
     brings keeps waiting, so the clock runs on; a ready viewer ends the wait,
     and the next wait starts a new clock. */
  const waiting = !hidden && !viewerReady && !error;
  useEffect(() => {
    if (!waiting) return undefined;
    const timer = setTimeout(() => setSlow(true), STARTING_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [waiting, waitRound]);

  return (
    <BrowserFrame
      hint={`You and ${agentLabel} share this. Click in it to take over.`}
      below={<p className="browser-panel__note">{webPaneNote(agentLabel)}</p>}
      actions={<Button icon size="sm" variant="subtle" aria-label="Reload browser view" onClick={retry}>{Ico.reload(14)}</Button>}
      onClose={onClose}
      floating={floating}
      extraActions={extraActions}
    >
      {viewUrl && !error && (
        <iframe
          ref={frameRef}
          onLoad={() => postTheme(frameRef.current)}
          key={frameKey}
          title="Shared browser"
          src={viewUrl}
          /* The browser router also sandboxes its viewer with a CSP
             header; leaving out allow-same-origin keeps this frame an
             opaque origin even if a response lacks that header. */
          sandbox="allow-forms allow-scripts"
          referrerPolicy="no-referrer"
        />
      )}
      {error ? (
        <EmptyState
          size="sm"
          className="browser-panel__empty"
          icon={Ico.globe(20)}
          title={error.title}
          description={error.description}
          action={{ label: 'Try again', onClick: retry }}
        />
      ) : waiting && (
        <div className="browser-panel__starting" role="status">
          {slow ? (
            <EmptyState
              size="sm"
              className="browser-panel__empty"
              icon={Ico.globe(20)}
              title="Your browser is taking longer than usual"
              description="It may still be starting. Try again, or close the pane and come back in a minute."
              action={{ label: 'Try again', onClick: retry }}
            />
          ) : (
            <div className="browser-panel__loading">
              <Spinner />
              <span>Starting your browser…</span>
            </div>
          )}
        </div>
      )}
    </BrowserFrame>
  );
}

export default BrowserPanel;
