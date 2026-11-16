import { getServerPort } from './server-process';
import { authHeader } from './server-auth';
import { appSecretHeader, serverMayReceiveTokens, serverTrust } from './app-secret';

/*
 * The chat's Notion page search and fetch read pages with the connection's
 * app-held token, so in protected mode the server requires the app secret for
 * them and the renderer goes through here.
 */

export type NotionPagesResult =
  | { ok: true; data: unknown }
  // The server's own refusal, passed through so the renderer shows the same
  // message it shows for a direct request.
  | { ok: false; status: number; text: string; retryAfter: string | null }
  | { ok: false; reason: string };

// The server's own limits, so a bad request never leaves this process.
const MAX_QUERY_LENGTH = 200;
const MAX_PAGE_LENGTH = 2000;

function isText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= max;
}

async function post(path: 'search' | 'fetch', body: Record<string, string>): Promise<NotionPagesResult> {
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
    res = await fetch(`http://127.0.0.1:${getServerPort()}/api/v1/connectors/notion/${path}`, {
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

export async function searchNotionPages(name: unknown, query: unknown): Promise<NotionPagesResult> {
  if (!isText(name, Number.MAX_SAFE_INTEGER)) return { ok: false, reason: 'A Notion connection name is required.' };
  if (!isText(query, MAX_QUERY_LENGTH)) return { ok: false, reason: `The search must be 1 to ${MAX_QUERY_LENGTH} characters.` };
  return post('search', { name, query });
}

export async function fetchNotionPage(name: unknown, page: unknown): Promise<NotionPagesResult> {
  if (!isText(name, Number.MAX_SAFE_INTEGER)) return { ok: false, reason: 'A Notion connection name is required.' };
  if (!isText(page, MAX_PAGE_LENGTH)) return { ok: false, reason: `The page must be 1 to ${MAX_PAGE_LENGTH} characters.` };
  return post('fetch', { name, page });
}
