import { useCallback, useEffect, useState } from 'react';
import Ico from '../Icons';
import Button from '../ui/Button';
import EmptyState from '../ui/EmptyState';
import Spinner from '../ui/Spinner';
import { embedBrowser } from '../../api';
import { openExternal } from '../../../platform/host';
import { isFramableViewUrl, needsFreshViewUrl } from '../../lib/browserSession';
import './browser-panel.css';

// The live view of the user's MindsHub browser, beside the chat (ENG-3299).
// The agent drives it through its browser tool; the user watches, and can
// click and type in it at any time (sign in, solve a CAPTCHA, take over).
//
// `session.viewUrl` is an embed URL the edge honours for an hour. A stale one
// (a reopened conversation, a long session) is swapped for a fresh one from
// POST /browse/embed before the frame loads.
export function BrowserPanel({ session, agentLabel = 'Anton', onClose }) {
  const [viewUrl, setViewUrl] = useState(() => (needsFreshViewUrl(session) ? null : session.viewUrl));
  const [error, setError] = useState('');
  const [generation, setGeneration] = useState(0);

  const refresh = useCallback(async () => {
    setError('');
    setViewUrl(null);
    try {
      const fresh = await embedBrowser(session.sessionId);
      if (!isFramableViewUrl(fresh?.view_url)) throw new Error('The browser returned an unexpected address.');
      setViewUrl(fresh.view_url);
      setGeneration((g) => g + 1);
    } catch (err) {
      setError(err?.message || 'Could not open the browser.');
    }
  }, [session.sessionId]);

  useEffect(() => {
    if (needsFreshViewUrl(session)) {
      refresh();
    } else {
      setViewUrl(session.viewUrl);
      setError('');
    }
  }, [session.key, session.viewUrl, session.expiresAt]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && event.target === document.body) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <>
      <button type="button" className="browser-panel-scrim" aria-label="Close browser" onClick={onClose} />
      <aside className="browser-panel" aria-label="Shared browser">
        <header className="browser-panel__header">
          <div className="browser-panel__heading">
            <span className="browser-panel__icon">{Ico.globe(14)}</span>
            <div>
              <div className="browser-panel__title">Browser</div>
              <div className="browser-panel__hint">You and {agentLabel} share this. Click in it to take over.</div>
            </div>
          </div>
          <div className="browser-panel__actions">
            <Button icon size="sm" variant="subtle" aria-label="Reload browser view" onClick={refresh}>{Ico.reload(14)}</Button>
            <Button icon size="sm" variant="subtle" aria-label="Open browser in a window" disabled={!viewUrl} onClick={() => viewUrl && void openExternal(viewUrl)}>{Ico.arrowUpRight(14)}</Button>
            <Button icon size="sm" variant="subtle" aria-label="Close browser" onClick={onClose}>{Ico.close(14)}</Button>
          </div>
        </header>
        <div className="browser-panel__stage">
          {viewUrl ? (
            <iframe
              key={`${viewUrl}:${generation}`}
              title="Shared browser"
              src={viewUrl}
              // allow-same-origin: the viewer opens a WebSocket back to its own
              // origin, which an opaque origin cannot. The origin is the user's
              // br- instance, never this app's (isFramableViewUrl).
              sandbox="allow-forms allow-same-origin allow-scripts"
              allow="clipboard-read; clipboard-write"
              referrerPolicy="no-referrer"
            />
          ) : error ? (
            <EmptyState
              size="sm"
              className="browser-panel__empty"
              icon={Ico.globe(20)}
              title="The browser isn't reachable"
              description={error}
              action={<Button size="sm" onClick={refresh}>Try again</Button>}
            />
          ) : (
            <div className="browser-panel__loading"><Spinner /></div>
          )}
        </div>
      </aside>
    </>
  );
}

export default BrowserPanel;
