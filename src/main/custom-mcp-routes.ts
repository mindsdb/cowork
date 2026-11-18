/*
 * cowork-server's custom MCP routes, called with the app secret. Only main
 * can send that secret, so only main can create a custom connection, hand it
 * its settings or switch its tools.
 */

import { getServerPort } from './server-process';
import { authHeader } from './server-auth';
import { appSecretHeader } from './app-secret';

export const CUSTOM_MCP_ENGINE = 'custom_mcp';
export const CONNECTION_MISSING = 'custom_connection_missing';

/** A route's refusal: its status and the `error` code it named, if any. */
export class CustomMcpRouteError extends Error {
  constructor(readonly status: number, readonly error: string | null, message: string) {
    super(message);
    this.name = 'CustomMcpRouteError';
  }
}

/** Held settings and token as the server's held entry stores them. */
export interface HeldSettings {
  server_url?: string;
  label?: string;
  resource?: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
  revocation_endpoint?: string;
  client_id?: string;
  allowed_tools?: string[];
  access_token?: string;
  expires_at?: string;
}

export interface ServerTool {
  name: string;
  description: string;
  read_only: boolean;
  allowed: boolean;
}

/** An error's class name only, for logs: messages of fetch errors can carry a URL. */
export function errorName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

// A stuck call would hold the connection's lock; the tool listing waits on
// the remote server too, so this is generous.
const LOOPBACK_TIMEOUT_MS = 60_000;

function routeUrl(suffix: string): string {
  return `http://127.0.0.1:${getServerPort()}/api/v1/connectors/connections/${CUSTOM_MCP_ENGINE}${suffix}`;
}

async function send(method: string, suffix: string, body?: unknown): Promise<unknown> {
  const res = await fetch(routeUrl(suffix), {
    method,
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...authHeader(), ...appSecretHeader() },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(LOOPBACK_TIMEOUT_MS),
  });
  const data = await res.json().catch(() => null) as { detail?: unknown } | null;
  if (!res.ok) {
    const detail = data?.detail;
    const error = detail && typeof detail === 'object' && typeof (detail as { error?: unknown }).error === 'string'
      ? (detail as { error: string }).error
      : typeof detail === 'string' ? detail : null;
    const message = detail && typeof detail === 'object' && typeof (detail as { message?: unknown }).message === 'string'
      ? (detail as { message: string }).message
      : `the server answered ${res.status}`;
    throw new CustomMcpRouteError(res.status, error, message);
  }
  return data;
}

/** The canonical form of a server URL, or a `CustomMcpRouteError` (422) for one the server refuses. */
export async function checkServerUrl(url: string): Promise<string> {
  const data = await send('POST', '/check-url', { url }) as { url?: unknown } | null;
  if (typeof data?.url !== 'string') throw new CustomMcpRouteError(502, null, 'the server gave no URL');
  return data.url;
}

export async function createConnection(id: string, settings: HeldSettings & { label: string; server_url: string }): Promise<void> {
  await send('POST', '', { id, ...settings });
}

/** Hands settings and token over; a missing connection is a 404 naming `CONNECTION_MISSING`. */
export async function putHeld(id: string, settings: HeldSettings): Promise<void> {
  await send('PUT', `/${encodeURIComponent(id)}/held`, settings);
}

export async function putAllowedTools(id: string, tools: string[]): Promise<void> {
  await send('PUT', `/${encodeURIComponent(id)}/allowed-tools`, { tools });
}

export async function listTools(id: string): Promise<ServerTool[]> {
  const data = await send('GET', `/${encodeURIComponent(id)}/tools`) as { tools?: unknown } | null;
  return Array.isArray(data?.tools) ? data.tools as ServerTool[] : [];
}

export async function heldSummary(id: string): Promise<{ label: string; server_url: string }> {
  return await send('GET', `/${encodeURIComponent(id)}/held-summary`) as { label: string; server_url: string };
}

/** Deletes the connection's record through the generic route, which drops its held entry too. */
export async function deleteRecord(id: string): Promise<void> {
  const res = await fetch(
    `http://127.0.0.1:${getServerPort()}/api/v1/connectors/connections/${CUSTOM_MCP_ENGINE}/${encodeURIComponent(id)}`,
    { method: 'DELETE', headers: authHeader(), signal: AbortSignal.timeout(LOOPBACK_TIMEOUT_MS) },
  );
  if (!res.ok && res.status !== 404) throw new CustomMcpRouteError(res.status, null, `the server answered ${res.status}`);
}

/** The custom connections the server has records for. */
export async function listRecordIds(): Promise<string[]> {
  const res = await fetch(`http://127.0.0.1:${getServerPort()}/api/v1/connectors/connections/`, {
    headers: authHeader(),
    signal: AbortSignal.timeout(LOOPBACK_TIMEOUT_MS),
  });
  if (!res.ok) throw new CustomMcpRouteError(res.status, null, `the server answered ${res.status}`);
  const rows = await res.json() as Array<{ engine?: unknown; name?: unknown }>;
  return rows.filter((row) => row.engine === CUSTOM_MCP_ENGINE && typeof row.name === 'string').map((row) => row.name as string);
}
