import { revokeLiveAppPreviews } from '../api';

const closers = new Set<() => void>();
// Sign-out waits this long for the server to revoke open previews. A lease the
// revoke misses lapses on its own: the closers below stop every renewal.
const REVOKE_WAIT_MS = 3000;

/** Stop renewal before an account transition can replace its bearer token. */
export function registerLiveAppPreview(close: () => void): () => void {
  closers.add(close);
  const channel = new BroadcastChannel('cowork.live-app-preview');
  channel.onmessage = event => { if (event.data === 'close') close(); };
  return () => { closers.delete(close); channel.close(); };
}

/** Whether this web UI runs on a deployment whose live apps can show in the pane. */
function previewsHere(): boolean {
  return window.location.protocol === 'http:' && window.location.hostname === 'cowork.localhost';
}

function stopLocalPreviews(): void {
  for (const close of closers) close();
  const channel = new BroadcastChannel('cowork.live-app-preview');
  channel.postMessage('close');
  channel.close();
}

/** Stop and revoke every preview before an organization switch, which refuses to go on without it. */
export async function closeLiveAppPreviews(): Promise<void> {
  stopLocalPreviews();
  // The API exists only on deployments with live app previews. Always revoke
  // there, including when another tab owns the only open preview.
  if (!previewsHere()) return;
  await revokeLiveAppPreviews();
}

/** Sign-out's version: it never waits on, or fails because of, the revoke. */
export async function closeLiveAppPreviewsForSignOut(): Promise<void> {
  stopLocalPreviews();
  if (!previewsHere()) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      revokeLiveAppPreviews(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timed out')), REVOKE_WAIT_MS); }),
    ]);
  } catch {
    console.warn('App previews could not be revoked before sign-out; their leases will expire.');
  } finally {
    clearTimeout(timer);
  }
}

/** Only the server-selected slot address may receive a preview intent. */
export function liveAppPreviewOrigin(state: { state?: string; slot?: number; launchId?: string; address?: string } | undefined): string {
  const slot = state?.slot;
  if (!previewsHere() || state?.state !== 'running' || typeof slot !== 'number' || !Number.isInteger(slot) || slot < 1 || slot > 16
      || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(state.launchId ?? '')) return '';
  // An app slot lives on the viewer sign-in's site at the web UI's own port.
  const port = window.location.port ? `:${window.location.port}` : '';
  const origin = `http://app${slot}.view.localhost${port}`;
  return state.address === `${origin}/` ? origin : '';
}
