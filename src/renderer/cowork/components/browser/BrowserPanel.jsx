import { useCallback, useEffect, useRef, useState } from 'react';
import Ico from '../Icons';
import { BrowserNote } from './BrowserNote';
import Button from '../ui/Button';
import EmptyState from '../ui/EmptyState';
import Spinner from '../ui/Spinner';
import { embedBrowser } from '../../api';
import {
  RELINK_RETRY_MAX_MS, RELINK_RETRY_MS, RELINK_WAIT_MS,
  VIEWER_ASK, VIEWER_CLOSED, VIEWER_CONTROL, VIEWER_FOCUS, VIEWER_LIVE, VIEWER_PAUSE, VIEWER_READY, VIEWER_TICKET, VIEWER_URL,
  afterViewerClose, browserViewerTheme, linkMayComeLater, viewerLinkFrom,
} from '../../lib/browserSession';
import { host } from '../../../platform/host';
import { BrowserFrame, paneMayTakeFocus } from './BrowserFrame';
import { BlankStartOver, browserRequestFor } from './BlankBrowserPanel';
import { LocalBrowserStage } from './LocalBrowserStage';
import { controlHint } from './controlHint';
import i18n, { useTranslation } from '../../../lib/i18n';

/* The person's browser beside the chat. The agent drives it through its
   browser tool; the person watches, and can click and type in it (sign in,
   solve a CAPTCHA). The header's hint says who holds it and names Take over
   (controlHint).

   On the desktop it is the app's own browser, shown natively
   (LocalBrowserStage). On the web it is the browser router's viewer, framed
   below. There the browser service refuses the person's input while the
   agent's step sends input, and the viewer says so; Take over hands the
   person the browser and stops the step.

   The viewer is the browser router's page, framed through a link the pane
   fetches with POST /browse/embed. The router honors a link's ticket once.
   The pane keeps one frame per session. A viewer that takes tickets in place
   gives the pane a MessagePort with its ready message. When that viewer
   reports that its live connection closed, the pane fetches a fresh link
   and hands its ticket over the port, so the frame, its picture and the
   keyboard stay. A fetch that fails then and may succeed later
   (linkMayComeLater) keeps the frame and runs again on a back-off, and at
   once when the network comes back, until RELINK_WAIT_MS after the close; a
   refusal, such as a person signed out, shows at once. The pane reloads the frame with a fresh link only for a
   page that gave no port, for a ticket that never goes live, and when that
   wait runs out. It also loads a fresh frame when it opens and when the
   person asks, and, for a page with no port, when the tab becomes visible
   again and when the network comes back.

   renewAfterMs after each fetch, one ticket-life before that link's lease
   ends, a viewer with a port that is live in a visible tab gets a fresh
   ticket in place, so its new socket opens before the router closes the old
   one at the lease. A renewal that fails changes nothing: the live socket
   runs on to its lease, and that close starts a reconnect. While the tab is
   hidden, the pane pauses a viewer with a port and keeps its frame, and
   hands it a fresh ticket, as a reconnect, when the tab shows again; a
   frame with no port goes. Either way a browser nobody is watching can go
   to sleep. No other timer fetches a link unless a reconnect is under way.

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

/**
 * One link fetch's outcome: the link, or what the pane says instead. `again`
 * is true for a request that may succeed later (linkMayComeLater), which the
 * back-off may repeat, and false for a refusal or an answer the pane must
 * not use.
 *
 * @typedef {{ link: import('../../lib/browserSession').ViewerLink }
 *   | { link: null, failure: string, again: boolean }} LinkFetch
 */

const unreachable = () => i18n.t('browser.unreachable', { ns: 'chat' });

/* What the pane says when it stops asking for links after a close. A full
   browser is still reachable, so its two stops get titles of their own.
   Built when the pane stops, in the language of that moment. */
/** @type {Record<'keeps-closing' | 'no-browser-slot' | 'task-cap', () => PaneStop>} */
const STOPPED = {
  'keeps-closing': () => ({ title: unreachable(), description: i18n.t('browser.stopped.keepsClosing', { ns: 'chat' }) }),
  'no-browser-slot': () => ({ title: i18n.t('browser.stopped.noSlotTitle', { ns: 'chat' }), description: i18n.t('browser.stopped.noSlotDescription', { ns: 'chat' }) }),
  'task-cap': () => ({ title: i18n.t('browser.stopped.taskCapTitle', { ns: 'chat' }), description: i18n.t('browser.stopped.taskCapDescription', { ns: 'chat', count: 4 }) }),
};

/** @type {{ holder: 'human' | 'agent', reason: string }} */
const AGENT_HOLDS = Object.freeze({ holder: 'agent', reason: '' });

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

// How long the start page takes to fade out once a page opens (browser-panel.css).
export const START_FADE_MS = 250;

/** A tab with nothing in it yet, which the start page covers. */
export function isBlankPage(url) {
  return url === 'about:blank' || url === 'chrome://newtab/' || url === 'chrome://new-tab-page/';
}

/* The web pane's note on where things go and what stays. The view and every
   key typed in it cross Cloudflare and MindsDB's browser service. The
   agent's page reads go to the model provider and, with Jev on, to Jev. Sites
   the person signs in to stay signed in for later tasks. The Jev and sign-in
   lines are Settings' own, so the two surfaces can't drift. The sign-in line
   shows whoever holds the browser: the pane hears that from the viewer
   (browser-viewer-control) for its hint, and passes it to the chat. */
export function webPaneNote(agentLabel) {
  return `${i18n.t('browser.webPaneNote', { ns: 'chat', agent: agentLabel })} ${i18n.t('settingsTools:browser.webJevLine')} ${i18n.t('settingsTools:browser.webSignIns')}`;
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
function WebBrowserStage({
  sessionId, agentLabel = 'Anton', onClose, floating = false, extraActions = null, dock = null, onControl = null,
  taskKey = '', onSend, onOpenUrl, startBlank = false, onPageUrl = null, onDraft = null,
}) {
  const { t } = useTranslation('chat');
  const onControlRef = useRef(onControl);
  onControlRef.current = onControl;
  const onDraftRef = useRef(onDraft);
  onDraftRef.current = onDraft;
  const onPageUrlRef = useRef(onPageUrl);
  onPageUrlRef.current = onPageUrl;
  const [viewUrl, setViewUrl] = useState(null);
  const [error, setError] = useState(/** @type {PaneStop | null} */ (null));
  const [hidden, setHidden] = useState(tabHidden);
  const [generation, setGeneration] = useState(0);
  const [viewerReady, setViewerReady] = useState(false);
  const [slow, setSlow] = useState(false);
  // The page the viewer shows, as it reports it: a blank tab gets the start page.
  const [pageUrl, setPageUrl] = useState('');
  // Who holds the browser, as the viewer says, for the hint; each session starts with the agent.
  const [control, setControl] = useState(AGENT_HOLDS);
  useEffect(() => { setControl(AGENT_HOLDS); }, [sessionId]);
  /* Bumped when the starting clock starts over on a request from the
     person, the tab or the network, so the clock restarts even while the
     pane is still waiting. */
  const [waitRound, setWaitRound] = useState(0);
  const frameRef = useRef(null);
  /* The MessagePort the viewer gave with its ready, when it takes tickets
     in place; null for a viewer that doesn't. */
  const portRef = useRef(null);
  // Whether the current link's viewer said it is ready, for the close handler.
  const readyRef = useRef(false);
  /* A stable ref, so a re-render never detaches the frame: React passes null
     only when the frame goes, and its port goes with it. A new frame waits
     for its own first ready, the one that may give a port. */
  const setFrame = useCallback((node) => {
    frameRef.current = node;
    if (node) {
      readyRef.current = false;
      return;
    }
    portRef.current?.close();
    portRef.current = null;
  }, []);
  /* Bumped by every link fetch, by a stop and by hiding the tab, so an
     answer that arrives after a newer request, a stop or the tab hiding is
     dropped. */
  const mintSeq = useRef(0);
  /* When this connection began, for the close rule: the mint for a frame
     whose page gave no port, the viewer's last live for one that did. A
     renewal's live carries the connection on, so it keeps this time. */
  const sinceRef = useRef(0);
  // Whether the ticket last handed over the port is a renewal's.
  const renewingRef = useRef(false);
  const quickCloses = useRef(0);
  // Whether the viewer's current socket is live (VIEWER_LIVE), for a viewer with a port.
  const liveRef = useRef(false);
  /* A reconnect after a close: when the latest close came (null when none is
     under way), the back-off's count and its timer, and the watchdog that
     reloads the frame when no live comes within RELINK_WAIT_MS. */
  const downSinceRef = useRef(/** @type {number | null} */ (null));
  const retries = useRef(0);
  const retryTimer = useRef(/** @type {ReturnType<typeof setTimeout> | null} */ (null));
  const watchdog = useRef(/** @type {ReturnType<typeof setTimeout> | null} */ (null));
  /* The renewal the last fetched link asks for, and what it does when due
     (set below, once relink exists). */
  const renewTimer = useRef(/** @type {ReturnType<typeof setTimeout> | null} */ (null));
  const renewRef = useRef(() => {});
  const frameKey = `${viewUrl}:${generation}`;

  // The reconnect is over: the viewer is live or ready, or the pane stopped, hid or closed.
  const endReconnect = useCallback(() => {
    downSinceRef.current = null;
    retries.current = 0;
    clearTimeout(retryTimer.current);
    clearTimeout(watchdog.current);
    retryTimer.current = null;
    watchdog.current = null;
  }, []);

  const dropRenewal = useCallback(() => {
    clearTimeout(renewTimer.current);
    renewTimer.current = null;
  }, []);

  /* One renewal per fetched link, renewAfterMs after the fetch; a link with
     no renewAfterMs gets none. */
  const armRenewal = useCallback((afterMs) => {
    dropRenewal();
    if (afterMs === null) return;
    renewTimer.current = setTimeout(() => {
      renewTimer.current = null;
      renewRef.current();
    }, afterMs);
  }, [dropRenewal]);

  /* POST /browse/embed for this session's viewer. A fetch replaces any
     retry the back-off holds, and a link it gets replaces the renewal.
     Resolves to null when a newer fetch, a stop or the tab hiding overtook
     it. */
  const fetchLink = useCallback(async () => {
    clearTimeout(retryTimer.current);
    retryTimer.current = null;
    mintSeq.current += 1;
    const seq = mintSeq.current;
    /** @type {LinkFetch} */
    let got;
    try {
      const link = viewerLinkFrom(await embedBrowser(sessionId), sessionId);
      got = link ? { link } : { link: null, failure: i18n.t('browser.unexpectedAddress', { ns: 'chat' }), again: false };
    } catch (err) {
      got = { link: null, failure: err?.message || i18n.t('browser.couldNotOpen', { ns: 'chat' }), again: linkMayComeLater(err) };
    }
    if (seq !== mintSeq.current) return null;
    if (got.link) armRenewal(got.link.renewAfterMs);
    return got;
  }, [sessionId, armRenewal]);

  /* A fetch that failed during a reconnect runs again on the back-off, with
     no error and the frame kept, until RELINK_WAIT_MS after the close. Each
     delay falls at random in the later half of its step, so the panes that
     one router restart closed at once don't fetch again in step. Says
     whether it will. */
  const retryLater = useCallback((call) => {
    const since = downSinceRef.current;
    if (since === null || Date.now() - since >= RELINK_WAIT_MS) return false;
    const step = Math.min(RELINK_RETRY_MS * 2 ** retries.current, RELINK_RETRY_MAX_MS);
    const delay = step * (1 - Math.random() / 2);
    retries.current += 1;
    retryTimer.current = setTimeout(() => {
      retryTimer.current = null;
      void call();
    }, delay);
    return true;
  }, []);

  const showFailure = useCallback((description) => {
    endReconnect();
    setError({ title: unreachable(), description });
  }, [endReconnect]);

  // A new frame, with a fresh link.
  const mint = useCallback(async () => {
    // Still opening: the session comes, and with it the link.
    if (!sessionId) return;
    setError(null);
    setViewUrl(null);
    const got = await fetchLink();
    if (!got) return;
    if (!got.link) {
      if (got.again && retryLater(mint)) return;
      showFailure(got.failure);
      return;
    }
    sinceRef.current = Date.now();
    setViewUrl(got.link.viewUrl);
    setGeneration((g) => g + 1);
  }, [sessionId, fetchLink, retryLater, showFailure]);

  /* A fresh ticket for the open viewer, handed over its port: the frame, its
     picture and the keyboard stay. A renewal that fails changes nothing.
     After a close, past RELINK_WAIT_MS a failed fetch reloads the frame
     instead; an answer the pane must not use stops it at once. */
  const relink = useCallback(async () => {
    const got = await fetchLink();
    if (!got) return;
    if (got.link) {
      portRef.current?.postMessage({ type: VIEWER_TICKET, ticket: got.link.ticket });
      return;
    }
    if (renewingRef.current) {
      renewingRef.current = false;
      return;
    }
    if (got.again && retryLater(relink)) return;
    if (got.again) void mint();
    else showFailure(got.failure);
  }, [fetchLink, retryLater, mint, showFailure]);

  /* A renewal comes due: a viewer with a port that is live in a visible tab
     gets a fresh ticket in place. Any other viewer has nothing to renew. */
  renewRef.current = () => {
    if (!portRef.current || !liveRef.current || tabHidden()) return;
    renewingRef.current = true;
    void relink();
  };

  /* Reloads the frame when the viewer has a port and no live comes within
     RELINK_WAIT_MS of the latest close, so a frame reloaded after a close
     gets the whole wait. A viewer with no port never posts live; its ready
     ends the reconnect instead. */
  const armWatchdog = useCallback(() => {
    clearTimeout(watchdog.current);
    watchdog.current = setTimeout(() => {
      watchdog.current = null;
      if (portRef.current && !liveRef.current) void mint();
    }, RELINK_WAIT_MS);
  }, [mint]);

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
    return () => {
      mintSeq.current += 1;
      endReconnect();
      dropRenewal();
    };
  }, [retry, endReconnect, dropRenewal]);

  useEffect(() => {
    /* A viewer with a port pauses while the tab is hidden and keeps its
       frame, then gets a fresh ticket in place, with the reconnect's wait,
       when the tab shows again. A frame with no port goes, and a fresh one
       comes. */
    const onVisibility = () => {
      const port = portRef.current;
      if (tabHidden()) {
        mintSeq.current += 1;
        endReconnect();
        dropRenewal();
        setHidden(true);
        if (port) {
          port.postMessage({ type: VIEWER_PAUSE });
          liveRef.current = false;
          renewingRef.current = false;
          return;
        }
        setViewUrl(null);
        setError(null);
        return;
      }
      setHidden(false);
      if (!port) {
        retry();
        return;
      }
      quickCloses.current = 0;
      downSinceRef.current = Date.now();
      armWatchdog();
      void relink();
    };
    /* A viewer with a port gets a fresh ticket at once when it lost its
       connection, and nothing while it is live. A viewer with no port gets a
       fresh frame. */
    const onOnline = () => {
      if (tabHidden()) return;
      if (!portRef.current) {
        retry();
        return;
      }
      if (!liveRef.current && downSinceRef.current !== null) void relink();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
    };
  }, [retry, relink, armWatchdog, endReconnect, dropRenewal]);

  /* The viewer asks for the theme once loaded, and reports when its
     connection closes. The sandboxed frame's origin is 'null', so the message's
     source, this pane's own frame, is what identifies it. */
  useEffect(() => {
    const onMessage = (event) => {
      const frameWindow = frameRef.current?.contentWindow;
      if (!frameWindow || event.source !== frameWindow) return;
      const type = event.data?.type;
      if (type === VIEWER_READY) {
        /* Only the frame's first ready may give a port. A later one comes
           from another document in the frame: it draws no ticket, and its
           close reloads the frame. */
        const offered = event.ports?.[0] ?? null;
        const port = readyRef.current ? null : offered;
        if (offered && !port) offered.close();
        if (portRef.current && portRef.current !== port) portRef.current.close();
        portRef.current = port;
        readyRef.current = true;
        // A viewer with no port never posts live: its ready is all it says.
        if (!port) endReconnect();
        setViewerReady(true);
        setSlow(false);
        postTheme(frameRef.current);
        return;
      }
      /* The viewer's current socket got the pod's hello: this connection
         began now, unless the socket is a renewal's. While the tab is hidden
         the pane paused this viewer, and a live it posted before the pause
         reached it is stale: its socket is closed. */
      if (type === VIEWER_LIVE) {
        if (tabHidden()) return;
        liveRef.current = true;
        if (!renewingRef.current) sinceRef.current = Date.now();
        renewingRef.current = false;
        endReconnect();
        return;
      }
      // The page the viewer shows, for whoever opened the pane.
      if (type === VIEWER_URL) {
        const url = String(event.data?.url || '').slice(0, 2048);
        setPageUrl(url);
        onPageUrlRef.current?.(url);
        return;
      }
      // A question typed in the viewer's address bar. The viewer is served by
      // the remote browser, so its text never goes out as the person's own:
      // it lands in the composer (`onDraft`), for them to read and send.
      if (type === VIEWER_ASK) {
        const text = String(event.data?.text || '').trim().slice(0, 2000);
        if (text) onDraftRef.current?.(browserRequestFor(text));
        return;
      }
      // Who holds the browser: 'human' when the agent handed it to the person or they took over.
      if (type === VIEWER_CONTROL) {
        const holds = { holder: event.data?.holder === 'human' ? 'human' : 'agent', reason: String(event.data?.reason || '').slice(0, 300) };
        setControl(holds);
        onControlRef.current?.(holds.holder, holds.reason);
        return;
      }
      if (type !== VIEWER_CLOSED) return;
      /* While the tab is hidden the pane paused this viewer, and a close it
         posted before the pause reached it changes nothing: the viewer gets a
         fresh ticket when the tab shows again. */
      if (tabHidden()) return;
      /* A viewer with a port posts closed once no socket is left. It was
         ready when the socket it lost was live; a ticket handed in place
         that never went live is a failed open. */
      const wasLive = liveRef.current;
      liveRef.current = false;
      renewingRef.current = false;
      const next = afterViewerClose({
        mintedAtMs: sinceRef.current,
        nowMs: Date.now(),
        quickCloses: quickCloses.current,
        ready: portRef.current ? wasLive : readyRef.current,
        code: event.data?.code,
      });
      quickCloses.current = next.quickCloses;
      if (next.remint) {
        /* Each close starts the wait and the back-off over, as it does the
           watchdog; afterViewerClose's count of failed opens bounds them. */
        downSinceRef.current = Date.now();
        retries.current = 0;
        armWatchdog();
        void (portRef.current && wasLive ? relink() : mint());
        return;
      }
      mintSeq.current += 1;
      endReconnect();
      setViewUrl(null);
      setError(STOPPED[next.stop]?.() ?? null);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [mint, relink, armWatchdog, endReconnect]);

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
    liveRef.current = false;
    renewingRef.current = false;
    setViewerReady(false);
    setPageUrl('');
  }, [frameKey]);

  /* The starting clock runs while the pane waits. A new link that a close
     brings keeps waiting, so the clock runs on; a ready viewer ends the wait,
     and the next wait starts a new clock. */
  const waiting = !hidden && !viewerReady && !error;
  /* Opened blank by the person: the start page shows at once, over a stand-in
     for the viewer's toolbar, while the browser opens underneath, and stays
     on its blank tab. The viewer fades in when it is ready. */
  const startsHere = Boolean(onSend || onOpenUrl);
  const opening = startBlank && startsHere && waiting && !slow;
  const blankTab = isBlankPage(pageUrl) || (startBlank && !pageUrl);
  const startOver = startsHere && !error && (opening || (viewUrl && viewerReady && blankTab));
  /* The keyboard goes to a viewer whose ready carried a port, unless the
     start page covers it, the tab is hidden or the person's focus is
     elsewhere (paneMayTakeFocus): when it is ready, and again each time the
     start page leaves it. A viewer with no port gets no focus: it can't pass
     it to its picture. */
  const covered = Boolean(startOver);
  useEffect(() => {
    const frame = frameRef.current;
    const port = portRef.current;
    if (!viewerReady || covered || !frame || !port || tabHidden() || !paneMayTakeFocus(frame)) return;
    frame.focus({ preventScroll: true });
    port.postMessage({ type: VIEWER_FOCUS });
  }, [viewerReady, covered]);
  /* Once a page opens, the start page fades out rather than vanishing. It
     turns to leaving in the same render, so it never unmounts in between:
     the fade runs, and a field the person is typing in keeps their focus
     (paneMayTakeFocus). */
  const [leaving, setLeaving] = useState(false);
  const [wasOver, setWasOver] = useState(false);
  if (Boolean(startOver) !== wasOver) {
    setWasOver(Boolean(startOver));
    setLeaving(!startOver);
  }
  useEffect(() => {
    if (!leaving) return undefined;
    const timer = setTimeout(() => setLeaving(false), START_FADE_MS);
    return () => clearTimeout(timer);
  }, [leaving]);
  useEffect(() => {
    if (!waiting) return undefined;
    const timer = setTimeout(() => setSlow(true), STARTING_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [waiting, waitRound]);

  return (
    <BrowserFrame
      hint={controlHint(t, { ...control, url: pageUrl, agentLabel })}
      below={<BrowserNote agentLabel={agentLabel}>{webPaneNote(agentLabel)}</BrowserNote>}
      actions={<Button icon size="sm" variant="subtle" aria-label={t('browser.reload')} onClick={retry}>{Ico.reload(14)}</Button>}
      onClose={onClose}
      floating={floating}
      extraActions={extraActions}
      dock={dock}
    >
      {viewUrl && !error && (
        <iframe
          ref={setFrame}
          onLoad={() => postTheme(frameRef.current)}
          key={frameKey}
          className={startBlank && !viewerReady ? 'browser-panel__view--pending' : undefined}
          title={t('browser.shared')}
          src={viewUrl}
          /* The browser router also sandboxes its viewer with a CSP
             header; leaving out allow-same-origin keeps this frame an
             opaque origin even if a response lacks that header. */
          sandbox="allow-forms allow-scripts"
          referrerPolicy="no-referrer"
        />
      )}
      {opening && (
        <div className="browser-panel__ghostbar" role="status" aria-label={t('browser.opening')}>
          <span className="browser-panel__ghost-button" />
          <span className="browser-panel__ghost-button" />
          <span className="browser-panel__ghost-button" />
          <span className="browser-panel__ghost-address">{t('browser.askOrTypeUrl')}</span>
        </div>
      )}
      {(startOver || leaving) && (
        <BlankStartOver taskKey={taskKey} agentLabel={agentLabel} onSend={onSend} onOpenUrl={onOpenUrl} leaving={!startOver} />
      )}
      {error ? (
        <EmptyState
          size="sm"
          className="browser-panel__empty"
          icon={Ico.globe(20)}
          title={error.title}
          description={error.description}
          action={{ label: t('browser.tryAgain'), onClick: retry }}
        />
      ) : waiting && !opening && (
        <div className="browser-panel__starting" role="status">
          {slow ? (
            <EmptyState
              size="sm"
              className="browser-panel__empty"
              icon={Ico.globe(20)}
              title={t('browser.slowTitle')}
              description={t('browser.slowDescription')}
              action={{ label: t('browser.tryAgain'), onClick: retry }}
            />
          ) : (
            <div className="browser-panel__loading">
              <Spinner />
              <span>{t('browser.starting')}</span>
            </div>
          )}
        </div>
      )}
    </BrowserFrame>
  );
}

export default BrowserPanel;
