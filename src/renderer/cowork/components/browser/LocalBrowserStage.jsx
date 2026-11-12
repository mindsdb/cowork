import { useEffect, useRef, useState } from 'react';
import { diagnostic } from '../../../../shared/diagnostics';
import { BrowserNote } from './BrowserNote';
import Ico from '../Icons';
import Button from '../ui/Button';
import EmptyState from '../ui/EmptyState';
import { Input } from '../ui/Input';
import Spinner from '../ui/Spinner';
import { host } from '../../../platform/host';
import { useNativeOverlayOpen } from '../../lib/nativeOverlay';
import { BrowserFrame } from './BrowserFrame';
import { BlankStartOver } from './BlankBrowserPanel';
import i18n, { useTranslation } from '../../../lib/i18n';

/* The desktop pane: the app's own browser, a native view the app's main
   process places over this stage. The stage mounts no frame. It shows the
   task once when the pane opens on it, and hides it only when the pane
   closes, the task changes or the task's browser closes. Main keeps the task
   it shows from idle close and from the live-task cap.

   While it shows the task, the stage reports what the view may draw on: the
   stage's bounds as measured, or NOWHERE while something must draw over it
   (an open modal or popover, a toast, the sign-in form below). The view draws
   above the page, so parking it is the only way anything shows on top. Main
   parks it for any stage under its floor too, a stage with no area included
   (an ancestor hid it, as Code mode hides the Cowork panel).

   Main answers each placement with whether it draws, since only main knows
   the UI zoom its floor applies after. When it doesn't draw at the latest
   bounds the stage measured, the stage says to make the window bigger, so a
   short window or a zoomed UI never leaves it empty with no reason, during a
   take over too. Only the latest placement's answer counts, and NOWHERE
   clears the line, since an overlay or the sign-in form is the reason then.
   Hiding the task clears it too, so a task that opens again, or the next
   task, waits for main's answer to its own show.

   The person can click and type in the view at any time. Take over tells the
   agent to stop; only Done hands the browser back, and the agent waits for it. */

/**
 * @typedef {import('../../../../shared/browser-contract').BrowserViewState} BrowserViewState
 * @typedef {import('../../../../shared/browser-contract').StageBounds} StageBounds
 * @typedef {import('../../../../shared/browser-contract').PaneShowAnswer} PaneShowAnswer
 * @typedef {import('../../../../shared/browser-contract').PaneDrawAnswer} PaneDrawAnswer
 */

/* A pane call the main process refused or couldn't answer: logged, since the
   pane has nothing better to show for it. */
function report(work) {
  return work.catch((error) => {
    diagnostic('renderer.browser-pane', 'WARNING', 'browser_pane_call_failed', error);
  });
}

/** @returns {StageBounds} */
export function stageBounds(stage) {
  const rect = stage.getBoundingClientRect();
  return {
    x: Math.max(0, Math.round(rect.left)),
    y: Math.max(0, Math.round(rect.top)),
    width: Math.max(0, Math.round(rect.width)),
    height: Math.max(0, Math.round(rect.height)),
  };
}

/**
 * The view may draw nowhere. Main parks the view off screen for it and keeps
 * the task the one the pane shows.
 * @type {StageBounds}
 */
export const NOWHERE = Object.freeze({ x: 0, y: 0, width: 0, height: 0 });

/** @param {StageBounds} a @param {StageBounds} b */
function sameBounds(a, b) {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function hostOf(url) {
  try {
    const { protocol, host: name } = new URL(url);
    return protocol === 'http:' || protocol === 'https:' ? name : '';
  } catch {
    return '';
  }
}

/* Where the page is, as the browser reads it: an http(s) page's host, else
   its scheme and path (about:blank). Never text the page chooses, such as
   its title or an address's query or fragment: a fragment changes in place,
   with no navigation the app checks. */
function siteOf(url) {
  try {
    const { protocol, host: name, pathname } = new URL(url);
    return protocol === 'http:' || protocol === 'https:' ? name : `${protocol}${pathname}`;
  } catch {
    return '';
  }
}

function SignInForm({ site, onAnswer }) {
  const { t } = useTranslation('chat');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  return (
    <form
      className="browser-panel__login"
      onSubmit={(event) => {
        event.preventDefault();
        onAnswer({ username, password });
      }}
    >
      <div className="browser-panel__login-title">{t('browser.signIn.title', { site })}</div>
      <div className="browser-panel__login-hint">{t('browser.signIn.hint')}</div>
      <Input aria-label={t('browser.signIn.username')} autoComplete="off" value={username} onChange={(next) => setUsername(next)} />
      <Input aria-label={t('browser.signIn.password')} type="password" autoComplete="off" value={password} onChange={(next) => setPassword(next)} />
      <div className="browser-panel__login-actions">
        <Button variant="subtle" size="sm" type="button" onClick={() => onAnswer(null)}>{t('browser.signIn.cancel')}</Button>
        <Button variant="primary" size="sm" type="submit">{t('browser.signIn.submit')}</Button>
      </div>
    </form>
  );
}

/**
 * @param {{ sessionId: string, agentLabel?: string, onClose: () => void }} props
 */
/* How long Save waits after a download starts waiting before it takes a click. */
export const DOWNLOAD_ARM_MS = 700;

/* The pane's line for the task's newest download. One that started while the
   agent held the browser waits for the person's Save. */
export function downloadLine(download) {
  const t = (key, vars) => i18n.t(`browser.download.${key}`, { ns: 'chat', name: download.name, ...vars });
  const where = t('where', { folder: download.folder });
  switch (download.state) {
    case 'waiting': return t('waiting', { where });
    case 'progressing': return t('progressing');
    case 'completed': return t('completed', { where });
    case 'cancelled': return t('cancelled');
    default: return t('failed');
  }
}

export function LocalBrowserStage({
  sessionId, agentLabel = 'Anton', onClose, floating = false, extraActions = null, dock = null,
  taskKey = '', onSend, onOpenUrl, onPageUrl = null,
}) {
  const { t } = useTranslation('chat');
  const browser = host.inAppBrowser;
  const stageRef = useRef(null);
  /** @type {[BrowserViewState | null, (s: BrowserViewState | null) => void]} */
  const [state, setState] = useState(null);
  const [exists, setExists] = useState(true);
  // Main doesn't draw at the latest bounds the stage measured and sent for the task it shows now.
  const [squeezed, setSqueezed] = useState(false);
  const overlayOpen = useNativeOverlayOpen();

  useEffect(() => {
    setState(null);
    setExists(true);
    return browser.onState((next) => {
      if (next.sessionId !== sessionId) return;
      setState(next);
      if (next.open) setExists(true);
    });
  }, [browser, sessionId]);

  const closed = !exists || state?.open === false;
  const signIn = state?.login ?? null;
  /* A blank tab (no address, nothing loading) gets the start page in the
     view's place, as on the web, so the view stays parked while it shows. */
  // The page it shows, for whoever opened it (the off-task browser's carry-over).
  const onPageUrlRef = useRef(onPageUrl);
  onPageUrlRef.current = onPageUrl;
  const shownUrl = state?.url ?? '';
  useEffect(() => { onPageUrlRef.current?.(shownUrl); }, [shownUrl]);
  const startPage = Boolean(state) && !closed && !signIn && !state.url && !state.loading && Boolean(onSend || onOpenUrl);
  const mayDraw = !overlayOpen && !signIn && !startPage;
  // Whether the view may draw now, for the pane's effect below to read.
  const mayDrawRef = useRef(mayDraw);
  // Sends main what the view may draw on now, or null while the pane shows no task.
  const placeRef = useRef(/** @type {(() => void) | null} */ (null));

  useEffect(() => {
    mayDrawRef.current = mayDraw;
    placeRef.current?.();
  }, [mayDraw]);

  useEffect(() => {
    const stage = stageRef.current;
    if (closed || !stage) return undefined;
    let cancelled = false;
    const target = () => (mayDrawRef.current ? stageBounds(stage) : NOWHERE);
    /* How many placements the stage sent. Each one's answer from main counts
       only while it is the latest. */
    let sent = 0;
    /**
     * Numbers a placement and returns what to do with main's answer to it.
     * NOWHERE clears squeezed at once and its answer is not read, since an
     * overlay or the sign-in form is why nothing draws then. A measured
     * placement's answer sets squeezed only while it is the latest and this
     * effect runs, so a late answer for older bounds never sets or clears it.
     * @param {StageBounds} bounds
     * @returns {(drawn: boolean) => void}
     */
    const placement = (bounds) => {
      sent += 1;
      const mine = sent;
      if (sameBounds(bounds, NOWHERE)) {
        setSqueezed(false);
        return () => {};
      }
      return (drawn) => {
        if (!cancelled && mine === sent) setSqueezed(!drawn);
      };
    };
    const first = target();
    // What main last got for the view.
    let placed = first;
    const shown = placement(first);
    report(browser.show(sessionId, first).then(/** @param {PaneShowAnswer} answer */ (answer) => {
      if (cancelled) return;
      // A task main doesn't have is closed, not squeezed: the pane says so.
      if (!answer.exists) setExists(false);
      else shown(answer.drawn);
    }));
    const place = () => {
      const next = target();
      if (sameBounds(next, placed)) return;
      placed = next;
      const answered = placement(next);
      report(browser.setBounds(next).then(/** @param {PaneDrawAnswer} answer */ (answer) => answered(answer.drawn)));
    };
    placeRef.current = place;
    const observer = new ResizeObserver(place);
    observer.observe(stage);
    window.addEventListener('resize', place);
    return () => {
      cancelled = true;
      /* The answers belong to this showing. Nothing measures the stage until
         the next one, so the line waits for main's answer to it. */
      setSqueezed(false);
      placeRef.current = null;
      observer.disconnect();
      window.removeEventListener('resize', place);
      report(browser.hide());
    };
  }, [browser, sessionId, closed]);

  const personHolds = state?.control.holder === 'human';
  const site = siteOf(state?.url ?? '');
  const reason = state?.control.reason ?? '';
  // The page's own host leads the agent's reason, so a lookalike page can't
  // pass its words off as the app's.
  const turnSite = site || t('browser.aNewTab');
  const hint = personHolds
    ? (reason
      ? t('browser.yourTurnReason', { site: turnSite, reason, agent: agentLabel })
      : t('browser.yourTurn', { site: turnSite, agent: agentLabel }))
    : t('browser.agentUsing', { agent: agentLabel });
  /* The oldest download still waiting keeps the line until the person
     answers it, so a page can't slip a newer one under their click; with
     none waiting, the newest. Save and Don't save arm a moment after a
     waiting download appears, for the same reason. */
  const downloads = state?.downloads ?? [];
  const latestDownload = downloads.filter((d) => d.state === 'waiting').at(-1) ?? downloads[0] ?? null;
  const waitingId = latestDownload?.state === 'waiting' ? latestDownload.id : null;
  const [armedId, setArmedId] = useState(null);
  useEffect(() => {
    if (!waitingId) return undefined;
    const timer = setTimeout(() => setArmedId(waitingId), DOWNLOAD_ARM_MS);
    return () => clearTimeout(timer);
  }, [waitingId]);
  const downloadArmed = waitingId !== null && armedId === waitingId;
  const tabs = state?.tabs ?? [];
  /* While the person holds the browser they may sign in to a site, so the
     note says, in Settings' own words, that sign-ins stay. */
  const note = `${t('browser.pageReadsNote', { agent: agentLabel })}${personHolds ? ` ${i18n.t('settingsTools:browser.desktopSignIns')}` : ''}`;

  const actions = state && !closed && (
    <>
      <Button icon size="sm" variant="subtle" aria-label={t('browser.back')} disabled={!state.canGoBack} onClick={() => report(browser.back(sessionId))}>{Ico.chevLeft(14)}</Button>
      <Button icon size="sm" variant="subtle" aria-label={t('browser.forward')} disabled={!state.canGoForward} onClick={() => report(browser.forward(sessionId))}>{Ico.chevRight(14)}</Button>
      <Button icon size="sm" variant="subtle" aria-label={t('browser.reloadPage')} onClick={() => report(browser.reload(sessionId))}>{Ico.reload(14)}</Button>
      {personHolds ? (
        <Button size="sm" variant="primary" onClick={() => report(browser.handBack(sessionId))}>{t('browser.done')}</Button>
      ) : (
        <Button size="sm" variant="subtle" onClick={() => report(browser.takeOver(sessionId))}>{t('browser.takeOver')}</Button>
      )}
    </>
  );

  /* A download that waits for the person's answer gets its own row below
     the status line, where its text wraps and Save and Don't save stay in the
     pane at its narrowest. */
  const below = state && !closed && (
    <>
    <BrowserNote agentLabel={agentLabel}>{note}</BrowserNote>
    <div className="browser-panel__status" role="status">
      {state.loading && <Spinner />}
      <span className="browser-panel__site">{site || t('browser.newTab')}</span>
      {tabs.length > 1 && (
        <span className="browser-panel__tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`browser-panel__tab${tab.active ? ' is-active' : ''}`}
              aria-pressed={tab.active}
              title={tab.url}
              onClick={() => report(browser.activateTab(sessionId, tab.id))}
            >
              {tab.title || hostOf(tab.url) || t('browser.newTab')}
            </button>
          ))}
        </span>
      )}
      {latestDownload && !waitingId && (
        <span className="browser-panel__download">
          {Ico.download(12)}
          {downloadLine(latestDownload)}
        </span>
      )}
    </div>
    {waitingId && (
      <div className="browser-panel__download-prompt" role="status">
        {Ico.download(12)}
        <span className="browser-panel__download-text">{downloadLine(latestDownload)}</span>
        <Button size="sm" variant="primary" disabled={!downloadArmed} onClick={() => report(browser.answerDownload(sessionId, waitingId, true))}>{t('browser.download.save')}</Button>
        <Button size="sm" variant="subtle" disabled={!downloadArmed} onClick={() => report(browser.answerDownload(sessionId, waitingId, false))}>{t('browser.download.dontSave')}</Button>
      </div>
    )}
    </>
  );

  return (
    <BrowserFrame hint={hint} actions={actions} below={below} stageRef={stageRef} onClose={onClose} floating={floating} extraActions={extraActions} dock={dock}>
      {closed ? (
        <EmptyState
          size="sm"
          className="browser-panel__empty"
          icon={Ico.globe(20)}
          title={t('browser.closedTitle')}
          description={t('browser.closedDescription', { agent: agentLabel })}
        />
      ) : signIn ? (
        <SignInForm
          key={signIn.host}
          site={signIn.host}
          onAnswer={(answer) => report(browser.answerLogin(sessionId, answer))}
        />
      ) : startPage ? (
        <BlankStartOver taskKey={taskKey} agentLabel={agentLabel} onSend={onSend} onOpenUrl={onOpenUrl} inset={false} />
      ) : squeezed ? (
        <EmptyState size="sm" className="browser-panel__empty" title={t('browser.squeezed')} />
      ) : null}
    </BrowserFrame>
  );
}

export default LocalBrowserStage;
