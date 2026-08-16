// Coding mode (ENG-1656 follow-up): detect a locally-installed `claude` CLI.
// The actual launch (spawning it, authenticated against MindsHub Inference)
// lives in coding-terminal.ts, which embeds the session in the app via a
// real PTY instead of an external terminal window.
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

/** Reveal the persisted MindsHub API key from cowork-server's own settings
 * store (`GET /settings/reveal-key/minds`) — loopback-gated, which a
 * main-process fetch to 127.0.0.1 satisfies. This is the same long-lived
 * `mdb_*` credential cowork-server itself uses to call MindsHub Inference;
 * no separate mint step is needed for the embedded CLI process. */
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
