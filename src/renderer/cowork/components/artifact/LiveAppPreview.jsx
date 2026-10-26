import { useEffect, useRef, useState } from 'react';
import { createLiveAppPreview, keepLiveAppPreview, revokeLiveAppPreview } from '../../api';
import { registerLiveAppPreview } from '../../lib/liveAppPreview';
import { Button, Spinner } from '../ui';

const FAILURE = "Couldn't connect to this app. Reload to try again, or open it in your browser.";
const PRIVACY = 'Your browser limits storage or cookies in embedded apps. Open this app in your browser to use it.';
// The server keeps a lease 60 s past its last renewal. A refusal ends the pane
// at once; a network blip or a server error is retried while time remains.
const RENEW_MS = 15000;
const RETRY_MS = 3000;
const GIVE_UP_MS = 45000;
const FINAL = new Set([401, 403, 404]);
// A refusal sentence from the server or its trusted bridge page, never a long one.
const sentence = (message) => (typeof message === 'string' && message && message.length <= 200 ? message : FAILURE);

/** The trusted bootstrap receives the intent; app code receives no credential. */
export function LiveAppPreview({ origin, launchId, reloadKey, onOpen }) {
  const frame = useRef(null);
  const popup = useRef(null);
  const cancel = useRef(null);
  const [lease, setLease] = useState(null);
  const [view, setView] = useState({ phase: 'loading', message: '' });
  const [connection, setConnection] = useState(null);
  const [failure, setFailure] = useState('');

  useEffect(() => {
    let closed = false;
    let current;
    let timer;
    let renewedAt = 0;
    setLease(null);
    setFailure('');
    const stop = (failed = true) => {
      closed = true;
      clearTimeout(timer);
      popup.current?.close();
      setLease(null);
      if (failed) setFailure(FAILURE);
    };
    cancel.current = () => stop(false);
    const unregister = registerLiveAppPreview(() => stop());
    const renew = async () => {
      try {
        await keepLiveAppPreview(current.id);
        renewedAt = Date.now();
        if (!closed) timer = setTimeout(renew, RENEW_MS);
      } catch (error) {
        if (closed) return;
        if (FINAL.has(error?.status) || Date.now() - renewedAt > GIVE_UP_MS) stop();
        else timer = setTimeout(renew, RETRY_MS);
      }
    };
    const start = async () => {
      try {
        current = await createLiveAppPreview(launchId);
        if (closed) {
          await revokeLiveAppPreview(current.id);
          return;
        }
        renewedAt = Date.now();
        setLease(current);
        timer = setTimeout(renew, RENEW_MS);
      } catch (error) {
        if (!closed) setFailure(error?.status ? sentence(error.message) : FAILURE);
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
        } else if (data.event === 'failed') settle('failed', sentence(data.message));
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
    setConnection({ nonce, src: `${origin}/_live_app/preview/bootstrap#${nonce}/${launchId}/${encodeURIComponent(window.location.origin)}` });
    return () => {
      clearTimeout(timeout);
      window.removeEventListener('message', receive);
      popup.current?.close();
      popup.current = null;
    };
  }, [lease, origin, launchId, reloadKey]);

  // Optional chaining, not a guard alone: the compiled build memoizes this
  // handler on connection?.nonce and reads it during render, before any
  // connection exists.
  const nonce = connection?.nonce;
  const signIn = () => {
    if (!nonce) return;
    popup.current?.close();
    popup.current = window.open(`${origin}/_live_app/preview/authorize#${nonce}/${launchId}/${encodeURIComponent(window.location.origin)}`,
      '_blank', 'popup,width=600,height=720');
    if (!popup.current) {
      cancel.current?.();
      setView({ phase: 'failed', message: 'Allow the sign-in window, or open this app in your browser.' });
    }
  };
  const failed = Boolean(failure) || view.phase === 'failed';
  const connected = !failed && view.phase === 'connected';
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      {lease && connection && !failed && <iframe
        key={connection.nonce}
        ref={frame}
        title="Live app preview"
        src={connection.src}
        sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-downloads"
        allow="clipboard-write"
        referrerPolicy="no-referrer"
        style={{ width: '100%', height: '100%', border: 0, visibility: connected ? 'visible' : 'hidden' }}
      />}
      {!connected && <div role="status" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: 28 }}>
        <div style={{ display: 'grid', justifyItems: 'center', gap: 12, maxWidth: 460, textAlign: 'center', fontSize: 13, color: 'var(--ink-2)' }}>
          {!failed && view.phase === 'loading' && <><Spinner /><span>Connecting app preview…</span></>}
          {!failed && view.phase === 'sign-in' && <><span>Show this running app here. A small window opens to connect it, and asks you to sign in if needed.</span><Button onClick={signIn}>Show the app here</Button></>}
          {failed && <span>{failure || view.message}</span>}
          <Button onClick={onOpen}>Open in browser</Button>
        </div>
      </div>}
    </div>
  );
}
