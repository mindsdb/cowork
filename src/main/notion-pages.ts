import { postWithAppSecret, type AppSecretPostResult } from './app-secret-post';

/*
 * The chat's Notion page search and fetch read pages with the connection's
 * app-held token, so in protected mode the server requires the app secret for
 * them and the renderer goes through here.
 */

export type NotionPagesResult = AppSecretPostResult;

// The server's own limits, so a bad request never leaves this process.
const MAX_QUERY_LENGTH = 200;
const MAX_PAGE_LENGTH = 2000;

function isText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= max;
}

function post(path: 'search' | 'fetch', body: Record<string, string>): Promise<NotionPagesResult> {
  return postWithAppSecret(`/api/v1/connectors/notion/${path}`, body);
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
