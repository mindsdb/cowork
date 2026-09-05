// Detect the installed Claude CLI; coding-terminal.ts launches its embedded PTY.
import { authHeader } from './server-auth';
import { getServerPort } from './server-process';
import { findOnPath } from './uv-paths';

const REQUEST_TIMEOUT_MS = 10_000;

export interface ClaudeCodeDetection {
  installed: boolean;
  path: string | null;
}

/** Is the `claude` CLI on this machine's PATH? Reuses the same probe the
 * installer uses for `uv` — `where`/`which` on an augmented PATH. */
export async function detectClaudeCode(): Promise<ClaudeCodeDetection> {
  const resolved = await findOnPath('claude');
  return { installed: resolved !== null, path: resolved };
}

/** Read the sidecar’s existing MindsHub key through its loopback-only reveal endpoint. */
export async function revealMindsApiKey(): Promise<string | null> {
  const port = getServerPort();
  if (!port) return null;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/settings/reveal-key/minds`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { ...authHeader() },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { value?: unknown };
    const value = typeof data?.value === 'string' ? data.value : null;
    return value && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

/** Read the host saved with the key: non-prod keys fail against a hardcoded production host. */
export async function revealMindsBaseUrl(): Promise<string | null> {
  const port = getServerPort();
  if (!port) return null;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/settings/`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { ...authHeader() },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as unknown;
    if (!Array.isArray(data)) return null;
    const entry = data.find((item) => item && typeof item === 'object' && (item as any).key === 'minds_url');
    const value = entry && typeof (entry as any).value === 'string' ? (entry as any).value : null;
    return value && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}
