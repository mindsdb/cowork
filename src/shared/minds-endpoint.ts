// Routing follows the endpoint. A MindsHub credential can coexist with a local model URL and does
// not identify where prompts go.

/**
 * Accept hand-entered endpoints without a scheme; URL parsing would otherwise interpret some
 * host:port strings as protocols. Callers read only host and port.
 */
function parseEndpoint(raw: string): URL | null {
  const s = (raw || '').trim();
  if (!s) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `http://${s}`;
  try {
    const url = new URL(withScheme);
    return url.hostname ? url : null;
  } catch {
    return null;
  }
}

/** MindsHub's own hosts. Suffixes are dot-anchored so `notmindshub.ai` misses. */
function isMindsPublicHost(host: string): boolean {
  return host === 'mindshub.ai' || host === 'mdb.ai'
    || host.endsWith('.mindshub.ai') || host.endsWith('.mdb.ai');
}

/**
 * Match self-hosted MindsHub on host AND port: a local model can share its hostname. Empty or
 * unparseable bases are not identified as MindsHub.
 */
export function isMindsBaseUrl(base: string, mindsUrl = ''): boolean {
  const url = parseEndpoint(base);
  if (!url) return false;
  const minds = parseEndpoint(mindsUrl);
  if (minds && url.hostname === minds.hostname && url.port === minds.port) return true;
  return isMindsPublicHost(url.hostname);
}

/**
 * With no base URL, the server derives a MindsHub endpoint only when no OpenAI key is set. Routing
 * callers must pass openAiApiKey so unknown endpoints remain openai-compatible and fail at the
 * server base-URL gate. Presentation-only callers may omit it to show the MindsHub fallback.
 */
export function mindsServesOpenAiCompatible(
  opts: { baseUrl?: string; mindsUrl?: string; openAiApiKey?: string },
): boolean {
  const base = (opts.baseUrl || '').trim();
  if (!base) return !opts.openAiApiKey;
  return isMindsBaseUrl(base, opts.mindsUrl || '');
}

/**
 * Return host[:port] for a reconstructed provider-card label, or an empty string for an invalid
 * endpoint.
 */
export function endpointHost(base: string): string {
  const url = parseEndpoint(base);
  if (!url) return '';
  return url.port ? `${url.hostname}:${url.port}` : url.hostname;
}
