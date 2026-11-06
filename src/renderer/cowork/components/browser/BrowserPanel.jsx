import { useCallback, useEffect, useRef, useState } from 'react';
import Ico from '../Icons';
import Button from '../ui/Button';
import EmptyState from '../ui/EmptyState';
import Spinner from '../ui/Spinner';
import { embedBrowser } from '../../api';
import { afterViewerClose, browserViewerTheme, viewerLinkFrom } from '../../lib/browserSession';
import { host } from '../../../platform/host';
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

   The browser may still be starting: until the viewer frame has loaded, the
   pane says so. The router's own starting page reloads itself once the
   browser is up, so the frame's first load is enough. After
   STARTING_TIMEOUT_MS without one, the pane offers to try again. */
export const STARTING_TIMEOUT_MS = 90_000;

const KEEPS_CLOSING = 'The browser view keeps closing. Try again in a moment.';

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

/**
 * @param {{ sessionId: string, agentLabel?: string, onClose: () => void }} props
 */
/* The web pane's line on where the person's input and the page go: the view
   and every key typed in it cross Cloudflare and MindsDB's browser service,
   and the agent's page reads go to the model provider. */
export function webPaneNote(agentLabel) {
  return `What you type here, passwords included, passes through Cloudflare and MindsDB's browser service on its way to the site. ${agentLabel}'s page reads and screenshots go to the model provider that serves your turn.`;
}

export function BrowserPanel(props) {
  return host.supportsInAppBrowser ? <LocalBrowserStage {...props} /> : <WebBrowserStage {...props} />;
}

/**
 * @param {{ sessionId: string, agentLabel?: string, onClose: () => void }} props
 */
function WebBrowserStage({ sessionId, agentLabel = 'Anton', onClose }) {
  const [viewUrl, setViewUrl] = useState(null);
  const [error, setError] = useState('');
  const [hidden, setHidden] = useState(tabHidden);
  const [generation, setGeneration] = useState(0);
  const [frameLoaded, setFrameLoaded] = useState(false);
  const [slow, setSlow] = useState(false);
  const frameRef = useRef(null);
  /* Bumped by every mint and by hiding the tab, so an answer that arrives
     after a newer request, or after the tab hid, is dropped. */
  const mintSeq = useRef(0);
  const mintedAt = useRef(0);
  const quickCloses = useRef(0);
  const frameKey = `${viewUrl}:${generation}`;

  const mint = useCallback(async () => {
    mintSeq.current += 1;
    const seq = mintSeq.current;
    setError('');
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
      setError(failure);
      return;
    }
    mintedAt.current = Date.now();
    setViewUrl(link);
    setGeneration((g) => g + 1);
  }, [sessionId]);

  // A person's own request starts the quick-close count over.
  const retry = useCallback(() => {
    quickCloses.current = 0;
    void mint();
  }, [mint]);

  useEffect(() => {
    quickCloses.current = 0;
    if (!tabHidden()) void mint();
    return () => { mintSeq.current += 1; };
  }, [mint]);

  useEffect(() => {
    const onVisibility = () => {
      if (tabHidden()) {
        mintSeq.current += 1;
        setHidden(true);
        setViewUrl(null);
        setError('');
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
      if (type === 'browser-viewer-ready') {
        postTheme(frameRef.current);
        return;
      }
      if (type !== 'browser-viewer-closed') return;
      const next = afterViewerClose({ mintedAtMs: mintedAt.current, nowMs: Date.now(), quickCloses: quickCloses.current });
      quickCloses.current = next.quickCloses;
      if (next.remint) {
        void mint();
        return;
      }
      mintSeq.current += 1;
      setViewUrl(null);
      setError(KEEPS_CLOSING);
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

  // A new frame (or a fresh link in flight) starts the wait over.
  useEffect(() => {
    setFrameLoaded(false);
    setSlow(false);
  }, [frameKey]);

  const waiting = !hidden && !frameLoaded && !error;
  useEffect(() => {
    if (!waiting) return undefined;
    const timer = setTimeout(() => setSlow(true), STARTING_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [waiting, frameKey]);

  return (
    <BrowserFrame
      hint={`You and ${agentLabel} share this. Click in it to take over.`}
      below={<p className="browser-panel__note">{webPaneNote(agentLabel)}</p>}
      actions={<Button icon size="sm" variant="subtle" aria-label="Reload browser view" onClick={retry}>{Ico.reload(14)}</Button>}
      onClose={onClose}
    >
      {viewUrl && !error && (
        <iframe
          ref={frameRef}
          onLoad={() => {
            setFrameLoaded(true);
            postTheme(frameRef.current);
          }}
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
          title="The browser isn't reachable"
          description={error}
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
