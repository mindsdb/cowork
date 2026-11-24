import { getServerPort } from './server-process';
import { authHeader } from './server-auth';
import { appSecretHeader, serverMayReceiveTokens, serverTrust } from './app-secret';

/*
 * A POST to a local server route that requires the app secret, which only
 * main holds; the renderer reaches such routes through main.
 */

export type AppSecretPostResult =
  | { ok: true; data: unknown }
  // The server's own refusal, passed through so the renderer reads it as it
  // reads a direct request's.
  | { ok: false; status: number; text: string; retryAfter: string | null }
  | { ok: false; reason: string };

// No timeout: a full-stack publish can take minutes on the server, and the
// renderer's direct requests to these routes wait for it too.
export async function postWithAppSecret(route: string, body: unknown): Promise<AppSecretPostResult> {
  if (!serverMayReceiveTokens()) {
    return {
      ok: false,
      reason: serverTrust() === 'untrusted'
        ? 'The backend could not be verified. Restart Cowork and try again.'
        : 'The backend is not running.',
    };
  }
  let res: Response;
  try {
    res = await fetch(`http://127.0.0.1:${getServerPort()}${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(), ...appSecretHeader() },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, reason: 'The backend is not running.' };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { ok: false, status: res.status, text, retryAfter: res.headers.get('Retry-After') };
  }
  return { ok: true, data: await res.json().catch(() => null) };
}
