import { useEffect, useRef, useState } from 'react';
import Ico from '../Icons';
import Button from '../ui/Button';
import { BrowserFrame } from './BrowserFrame';
import { typedUrl } from '../../lib/browserSession';
import { useTranslation } from '../../../lib/i18n';

/* The browser pane before a page is open in the task: an address bar, and a
   blank page with a line asking where to go. An address typed in either opens
   at once, in the task's own browser, with no agent (`onOpenUrl`); anything
   else goes to the agent as a search (`onSend`). The real pane takes over as
   soon as the browser opens. */

// The start page's lines, by their key in the chat catalog (browser.blank.lines.*).
export const BLANK_LINES = ['bigPlans', 'wholeInternet', 'freshTab', 'quiet'];

// One line per task, so it doesn't change every time the pane opens.
export function blankLineFor(key = '') {
  let hash = 0;
  for (const ch of String(key)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return BLANK_LINES[hash % BLANK_LINES.length];
}

// How long an address typed here may take to replace the start page.
export const OPEN_WAIT_MS = 20_000;

/** What the agent is asked for a search the person typed. */
export function browserRequestFor(text) {
  return `Search the web in the browser for: ${text.trim()}`;
}

/** Sends what the person typed: an address opens at once (`onOpenUrl`),
    anything else goes to the agent as a search (`onSend`). */
function useBlankGo({ agentLabel, browserOn, onSend, onOpenUrl }) {
  const { t } = useTranslation('chat');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  // Bumped by each address sent, so only the latest one's wait can give up.
  const openSeq = useRef(0);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  const usable = browserOn && (onSend || onOpenUrl);
  const go = async (text) => {
    const wanted = text.trim();
    if (!usable || !wanted || busy) return;
    setError('');
    const url = typedUrl(wanted);
    if (url && onOpenUrl) {
      setBusy(t('browser.blank.openingUrl', { url }));
      try {
        await onOpenUrl(url);
        // The page replaces this start page once it loads; if it never does,
        // the field comes back rather than waiting for good.
        const asked = ++openSeq.current;
        setTimeout(() => {
          if (asked !== openSeq.current || !mounted.current) return;
          setBusy('');
          setError(t('browser.blank.slow'));
        }, OPEN_WAIT_MS);
      } catch (err) {
        setError(err?.message || t('browser.blank.couldNotOpen'));
        setBusy('');
      }
      return;
    }
    if (!onSend) return;
    onSend(browserRequestFor(wanted));
    setBusy(t('browser.blank.agentOpening', { agent: agentLabel }));
  };
  return { busy, error, usable, go };
}

/** The start page's middle: a line, and a field for a search or a link. */
function BlankStart({ taskKey, agentLabel, browserOn, state, autoFocus = true }) {
  const { t } = useTranslation('chat');
  const [search, setSearch] = useState('');
  const line = blankLineFor(taskKey);
  const { busy, error, usable, go } = state;
  return (
    <div className="browser-panel__blank">
      <span className="browser-panel__blank-mark" aria-hidden="true">{Ico.globe(20)}</span>
      <h2 className="browser-panel__blank-title">{t(`browser.blank.lines.${line}.title`)}</h2>
      <p className="browser-panel__blank-subtitle">
        {browserOn ? t(`browser.blank.lines.${line}.subtitle`) : t('browser.blank.off', { agent: agentLabel })}
      </p>
      <form className="browser-panel__blank-form" onSubmit={(e) => { e.preventDefault(); void go(search); }}>
        <input
          type="text"
          className="browser-panel__blank-input"
          placeholder={t('browser.blank.searchPlaceholder')}
          aria-label={t('browser.blank.searchLabel')}
          value={search}
          disabled={!usable || !!busy}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus={autoFocus}
        />
        <Button type="submit" size="sm" variant="primary" disabled={!usable || !!busy || !search.trim()}>
          {busy ? t('browser.blank.onIt') : t('browser.blank.go')}
        </Button>
      </form>
      {error && <p className="browser-panel__blank-error" role="alert">{error}</p>}
    </div>
  );
}

/**
 * The start page over a live browser whose tab is blank: the same line and
 * field as the blank pane, so a fresh browser never shows an empty white page.
 * @param {{ taskKey?: string, agentLabel?: string, onSend?: (text: string) => void,
 *   onOpenUrl?: (url: string) => Promise<void> }} props
 */
export function BlankStartOver({ taskKey = '', agentLabel = 'Anton', onSend, onOpenUrl, inset = true, leaving = false }) {
  const state = useBlankGo({ agentLabel, browserOn: true, onSend, onOpenUrl });
  // `inset` leaves the web viewer's own toolbar showing above it; the desktop's is the pane's.
  // `leaving`: a page opened, and it fades out over it.
  return (
    <div
      className={`browser-panel__blank-over${inset ? '' : ' browser-panel__blank-over--full'}${leaving ? ' is-leaving' : ''}`}
      aria-hidden={leaving || undefined}
    >
      <BlankStart taskKey={taskKey} agentLabel={agentLabel} browserOn state={state} autoFocus={false} />
    </div>
  );
}

/**
 * @param {{ taskKey?: string, agentLabel?: string, browserOn?: boolean,
 *   onSend?: (text: string) => void, onOpenUrl?: (url: string) => Promise<void>,
 *   onClose: () => void, floating?: boolean, extraActions?: import('react').ReactNode }} props
 */
export default function BlankBrowserPanel({
  taskKey = '', agentLabel = 'Anton', browserOn = true, onSend, onOpenUrl, onClose, floating = false, extraActions = null, dock = null,
}) {
  const { t } = useTranslation('chat');
  const [address, setAddress] = useState('');
  const state = useBlankGo({ agentLabel, browserOn, onSend, onOpenUrl });
  const { busy, usable, go } = state;

  const addressBar = (
    <form
      className="browser-panel__address"
      onSubmit={(e) => { e.preventDefault(); void go(address); }}
    >
      <span className="browser-panel__address-icon" aria-hidden="true">{Ico.globe(14)}</span>
      <input
        type="text"
        className="browser-panel__address-input"
        placeholder={t('browser.blank.addressPlaceholder')}
        aria-label={t('browser.blank.address')}
        value={address}
        disabled={!usable || !!busy}
        onChange={(e) => setAddress(e.target.value)}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
      />
    </form>
  );

  return (
    <BrowserFrame hint={busy || t('browser.blank.nothingOpen')} below={addressBar} onClose={onClose} floating={floating} extraActions={extraActions} dock={dock}>
      <BlankStart taskKey={taskKey} agentLabel={agentLabel} browserOn={browserOn} state={state} />
    </BrowserFrame>
  );
}
