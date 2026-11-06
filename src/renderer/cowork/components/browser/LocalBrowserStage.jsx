import { useEffect, useRef, useState } from 'react';
import { diagnostic } from '../../../../shared/diagnostics';
import Ico from '../Icons';
import Button from '../ui/Button';
import EmptyState from '../ui/EmptyState';
import { Input } from '../ui/Input';
import Spinner from '../ui/Spinner';
import { host } from '../../../platform/host';
import { useNativeOverlayOpen } from '../../lib/nativeOverlay';
import { BrowserFrame } from './BrowserFrame';

/* The desktop pane: the app's own browser, a native view the app's main
   process places over this stage. The stage mounts no frame. It reports its
   bounds as they change, and hides the view whenever something must draw over
   it (an open modal or popover, the sign-in form below), when the pane closes
   and when the task changes. The view draws above the page, so hiding it is
   the only way anything shows on top.

   The person can click and type in the view at any time. Take over tells the
   agent to stop; only Done hands the browser back, and the agent waits for it. */

/**
 * @typedef {import('../../../../shared/browser-contract').BrowserViewState} BrowserViewState
 * @typedef {import('../../../../shared/browser-contract').StageBounds} StageBounds
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

function hostOf(url) {
  try {
    const { protocol, host: name } = new URL(url);
    return protocol === 'http:' || protocol === 'https:' ? name : '';
  } catch {
    return '';
  }
}

function SignInForm({ site, onAnswer }) {
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
      <div className="browser-panel__login-title">{site} asks you to sign in</div>
      <div className="browser-panel__login-hint">Your username and password go only to this site.</div>
      <Input aria-label="Username" autoComplete="off" value={username} onChange={(next) => setUsername(next)} />
      <Input aria-label="Password" type="password" autoComplete="off" value={password} onChange={(next) => setPassword(next)} />
      <div className="browser-panel__login-actions">
        <Button variant="subtle" size="sm" type="button" onClick={() => onAnswer(null)}>Cancel</Button>
        <Button variant="primary" size="sm" type="submit">Sign in</Button>
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
  const where = `Downloads, in ${download.folder}`;
  switch (download.state) {
    case 'waiting': return `This page wants to download ${download.name} to ${where}.`;
    case 'progressing': return `Downloading ${download.name}…`;
    case 'completed': return `${download.name} is in ${where}.`;
    case 'cancelled': return `${download.name} wasn't saved.`;
    default: return `${download.name} didn't download.`;
  }
}

export function LocalBrowserStage({ sessionId, agentLabel = 'Anton', onClose }) {
  const browser = host.inAppBrowser;
  const stageRef = useRef(null);
  /** @type {[BrowserViewState | null, (s: BrowserViewState | null) => void]} */
  const [state, setState] = useState(null);
  const [exists, setExists] = useState(true);
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
  const showView = !overlayOpen && !closed && !signIn;

  useEffect(() => {
    const stage = stageRef.current;
    if (!showView || !stage) return undefined;
    let cancelled = false;
    let placed = stageBounds(stage);
    report(browser.show(sessionId, placed).then((answer) => {
      if (!cancelled && !answer.exists) setExists(false);
    }));
    const place = () => {
      const next = stageBounds(stage);
      if (next.x === placed.x && next.y === placed.y && next.width === placed.width && next.height === placed.height) return;
      placed = next;
      report(browser.setBounds(next));
    };
    const observer = new ResizeObserver(place);
    observer.observe(stage);
    window.addEventListener('resize', place);
    return () => {
      cancelled = true;
      observer.disconnect();
      window.removeEventListener('resize', place);
      report(browser.hide());
    };
  }, [browser, sessionId, showView]);

  const personHolds = state?.control.holder === 'human';
  const site = hostOf(state?.url ?? '');
  const reason = state?.control.reason ?? '';
  // The page's own host leads the agent's reason, so a lookalike page can't
  // pass its words off as the app's.
  const hint = personHolds
    ? `Your turn${site ? ` on ${site}` : ''}${reason ? `: ${reason}` : ''}. Click Done to hand it back to ${agentLabel}.`
    : `${agentLabel} is using it. Take over to use it yourself.`;
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

  const actions = state && !closed && (
    <>
      <Button icon size="sm" variant="subtle" aria-label="Back" disabled={!state.canGoBack} onClick={() => report(browser.back(sessionId))}>{Ico.chevLeft(14)}</Button>
      <Button icon size="sm" variant="subtle" aria-label="Forward" disabled={!state.canGoForward} onClick={() => report(browser.forward(sessionId))}>{Ico.chevRight(14)}</Button>
      <Button icon size="sm" variant="subtle" aria-label="Reload page" onClick={() => report(browser.reload(sessionId))}>{Ico.reload(14)}</Button>
      {personHolds ? (
        <Button size="sm" variant="primary" onClick={() => report(browser.handBack(sessionId))}>Done</Button>
      ) : (
        <Button size="sm" variant="subtle" onClick={() => report(browser.takeOver(sessionId))}>Take over</Button>
      )}
    </>
  );

  const below = state && !closed && (
    <>
    <p className="browser-panel__note">{`${agentLabel}'s page reads and screenshots go to the model provider that serves your turn.`}</p>
    <div className="browser-panel__status" role="status">
      {state.loading && <Spinner />}
      <span className="browser-panel__site">{site || state.title || 'New tab'}</span>
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
              {tab.title || hostOf(tab.url) || 'New tab'}
            </button>
          ))}
        </span>
      )}
      {latestDownload && (
        <span className="browser-panel__download">
          {Ico.download(12)}
          {downloadLine(latestDownload)}
          {latestDownload.state === 'waiting' && (
            <>
              <Button size="sm" variant="primary" disabled={!downloadArmed} onClick={() => report(browser.answerDownload(sessionId, latestDownload.id, true))}>Save</Button>
              <Button size="sm" variant="subtle" disabled={!downloadArmed} onClick={() => report(browser.answerDownload(sessionId, latestDownload.id, false))}>Don't save</Button>
            </>
          )}
        </span>
      )}
    </div>
    </>
  );

  return (
    <BrowserFrame hint={hint} actions={actions} below={below} stageRef={stageRef} onClose={onClose}>
      {closed ? (
        <EmptyState
          size="sm"
          className="browser-panel__empty"
          icon={Ico.globe(20)}
          title="This task's browser is closed"
          description={`${agentLabel} opens it again when it needs it.`}
        />
      ) : signIn ? (
        <SignInForm
          key={signIn.host}
          site={signIn.host}
          onAnswer={(answer) => report(browser.answerLogin(sessionId, answer))}
        />
      ) : null}
    </BrowserFrame>
  );
}

export default LocalBrowserStage;
