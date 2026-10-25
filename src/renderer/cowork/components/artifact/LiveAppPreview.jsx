import { useEffect, useRef, useState } from 'react';
import { createLiveAppPreview, keepLiveAppPreview, revokeLiveAppPreview } from '../../api';
import { registerLiveAppPreview } from '../../lib/liveAppPreview';
import { Button, Spinner } from '../ui';

const FAILURE = "Couldn't connect to this app. Reload to try again, or open it in your browser.";
const PRIVACY = 'Your browser limits storage or cookies in embedded apps. Open this app in your browser to use it.';

/** The trusted bootstrap receives the intent; app code receives no credential. */
export function LiveAppPreview({ origin, launchId, reloadKey, onOpen }) {
  const frame = useRef(null);
  const popup = useRef(null);
  const cancel = useRef(null);
  const [lease, setLease] = useState(null);
  const [view, setView] = useState({ phase: 'loading', message: '' });
  const [connection, setConnection] = useState(null);
  const [renewalFailed, setRenewalFailed] = useState(false);

  useEffect(() => {
    let closed = false;
    let current;
    let timer;
    setLease(null);
    setRenewalFailed(false);
    const stop = (failure = true) => {
      closed = true;
      clearTimeout(timer);
      popup.current?.close();
      setLease(null);
      if (failure) setRenewalFailed(true);
    };
    cancel.current = () => stop(false);
    const unregister = registerLiveAppPreview(() => stop());
    const renew = async () => {
      try {
        await keepLiveAppPreview(current.id);
        if (!closed) timer = setTimeout(renew, 15000);
      } catch {
        if (!closed) stop();
      }
    };
    const start = async () => {
      try {
        current = await createLiveAppPreview(launchId);
        if (closed) {
          await revokeLiveAppPreview(current.id);
          return;
        }
        setLease(current);
        timer = setTimeout(renew, 15000);
      } catch {
        if (!closed) setRenewalFailed(true);
      }
    };
    void start();
    // A hidden/bfcached page must not keep a lease alive.
    const hide = () => stop();
    window.addEventListener('pagehide', hide);
    return () => {
      stop();
      unregister();
      window.removeEventListener('pagehide', hide);
      if (current) {
        // A closed page may not deliver this request. The server's 60-second
        // lease expiry is the backstop; no client timer can extend it alone.
        void revokeLiveAppPreview(current.id).catch(() => {
          console.warn('App preview close could not be confirmed; its lease will expire.');
        });
      }
    };
  }, [launchId]);

  useEffect(() => {
    if (!lease) return undefined;
    const nonce = crypto.randomUUID();
    let phase = 'loading';
    let timeout;
    const settle = (next, message = '') => {
      phase = next;
      clearTimeout(timeout);
      setView({ phase: next, message });
      if (next === 'failed') cancel.current?.();
    };
    const deadline = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => settle('failed', FAILURE), 10000);
    };
    const send = (target, event, extra = {}) => target?.postMessage({
      type: 'live-app-preview', event, nonce, launchId, ...extra,
    }, origin);
    const receive = (event) => {
      const data = event.data;
      if (event.origin !== origin || !data || data.type !== 'live-app-preview'
          || data.nonce !== nonce || data.launchId !== launchId) return;
      if (event.source === popup.current && popup.current && phase === 'sign-in') {
        if (data.event === 'ready') send(popup.current, 'intent', { token: lease.intent });
        else if (data.event === 'grant' && /^[a-f0-9]{64}$/.test(data.grant ?? '')) {
          send(frame.current?.contentWindow, 'grant', { grant: data.grant });
          settle('loading');
          deadline();
        } else if (data.event === 'failed') settle('failed', FAILURE);
        return;
      }
      if (event.source !== frame.current?.contentWindow || phase === 'connected' || phase === 'failed') return;
      if (data.event === 'ready' && phase === 'loading') send(event.source, 'intent', { token: lease.intent });
      else if (data.event === 'sign-in' && phase === 'loading') settle('sign-in');
      else if (data.event === 'connected' && phase === 'loading') settle('connected');
      else if (data.event === 'storage-blocked' || data.event === 'cookie-blocked') settle('failed', PRIVACY);
      else if (data.event === 'failed') settle('failed', FAILURE);
    };
    window.addEventListener('message', receive);
    settle('loading');
    deadline();
    setConnection({ nonce, src: `${origin}/_live_app/preview/bootstrap#${nonce}/${launchId}` });
    return () => {
      clearTimeout(timeout);
      window.removeEventListener('message', receive);
      popup.current?.close();
      popup.current = null;
    };
  }, [lease, origin, launchId, reloadKey]);

  const signIn = () => {
    popup.current?.close();
    popup.current = window.open(`${origin}/_live_app/preview/authorize#${connection.nonce}/${launchId}`,
      '_blank', 'popup,width=600,height=720');
    if (!popup.current) {
      cancel.current?.();
      setView({ phase: 'failed', message: 'Allow the sign-in window, or open this app in your browser.' });
    }
  };
  const failed = renewalFailed || view.phase === 'failed';
  const connected = !failed && view.phase === 'connected';
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      {lease && connection && !failed && <iframe
        key={connection.nonce}
        ref={frame}
        title="Live app preview"
        src={connection.src}
        sandbox="allow-scripts allow-same-origin allow-forms allow-modals"
        referrerPolicy="no-referrer"
        style={{ width: '100%', height: '100%', border: 0, visibility: connected ? 'visible' : 'hidden' }}
      />}
      {!connected && <div role="status" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: 28 }}>
        <div style={{ display: 'grid', justifyItems: 'center', gap: 12, maxWidth: 460, textAlign: 'center', fontSize: 13, color: 'var(--ink-2)' }}>
          {!failed && view.phase === 'loading' && <><Spinner /><span>Connecting app preview…</span></>}
          {!failed && view.phase === 'sign-in' && <><span>Sign in to the app viewer to show this app here.</span><Button onClick={signIn}>Sign in to preview</Button></>}
          {failed && <span>{renewalFailed ? FAILURE : view.message}</span>}
          <Button onClick={onOpen}>Open in browser</Button>
        </div>
      </div>}
    </div>
  );
}
