import { revokeLiveAppPreviews } from '../api';

const closers = new Set<() => void>();

/** Stop renewal before an account transition can replace its bearer token. */
export function registerLiveAppPreview(close: () => void): () => void {
  closers.add(close);
  const channel = new BroadcastChannel('cowork.live-app-preview');
  channel.onmessage = event => { if (event.data === 'close') close(); };
  return () => { closers.delete(close); channel.close(); };
}

export async function closeLiveAppPreviews(): Promise<void> {
  for (const close of closers) close();
  const channel = new BroadcastChannel('cowork.live-app-preview');
  channel.postMessage('close');
  channel.close();
  // The API exists only on deployments with live app previews. Always revoke
  // there, including when another tab owns the only open preview.
  if (window.location.origin !== 'http://cowork.localhost:8080') return;
  await revokeLiveAppPreviews();
}

/** Only the server-selected slot address may receive a preview intent. */
export function liveAppPreviewOrigin(state: { state?: string; slot?: number; launchId?: string; address?: string } | undefined): string {
  const slot = state?.slot;
  if (state?.state !== 'running' || typeof slot !== 'number' || !Number.isInteger(slot) || slot < 1 || slot > 16
      || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(state.launchId ?? '')) return '';
  const origin = `http://app${state.slot}.view.localhost:8080`;
  return state.address === `${origin}/` ? origin : '';
}
