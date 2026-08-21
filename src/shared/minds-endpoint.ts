// Where inference actually goes, decided from the endpoint alone.
//
// A MindsHub API key proves nothing about routing: signing in mints one, so a
// user who then points Cowork at a local model has both a MindsHub key and
// their own endpoint. Only the base URL says where the prompt is sent.

/**
 * Parse an endpoint into a URL, tolerating a missing scheme.
 *
 * Base URLs are typed by hand ("192.168.1.100:1234"), and a schemeless string
 * parses as `protocol: "192.168.1.100:"` with no hostname at all — which would
 * silently reclassify the endpoint. Only host and port are ever read, so the
 * assumed scheme cannot affect the answer.
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
 * Whether `base` points at MindsHub rather than an endpoint of the user's own.
 *
 * `mindsUrl` covers self-hosted deployments on a private host. It is matched on
 * host AND port: a self-hosted gateway and a local model server commonly share
 * a machine and differ only by port, and comparing hostnames alone would hand
 * the model server's traffic to the gateway.
 *
 * An empty or unparseable `base` is not MindsHub — the caller decides what an
 * unidentifiable endpoint means, since only it knows what else is configured.
 */
export function isMindsBaseUrl(base: string, mindsUrl = ''): boolean {
  const url = parseEndpoint(base);
  if (!url) return false;
  const minds = parseEndpoint(mindsUrl);
  if (minds && url.hostname === minds.hostname && url.port === minds.port) return true;
  return isMindsPublicHost(url.hostname);
}

/**
 * Whether an `openai-compatible` provider selection denotes MindsHub.
 *
 * The base URL decides. With none, two cases remain and `openAiApiKey`
 * separates them: anton serves MindsHub through the openai-compatible provider
 * and derives the base from the MindsHub URL when only a MindsHub key is set,
 * so that shape really is MindsHub — but once an OpenAI key is set it stops
 * deriving and nothing identifies the endpoint.
 *
 * Pass `openAiApiKey` wherever the answer decides ROUTING, so an
 * unidentifiable endpoint stays openai-compatible and the server's base-URL
 * gate stops the turn rather than the prompt reaching the hosted gateway. Omit
 * it where the answer only decides what the UI shows: there an endpoint that
 * routes nowhere is better drawn as MindsHub than as an empty custom row.
 */
export function mindsServesOpenAiCompatible(
  opts: { baseUrl?: string; mindsUrl?: string; openAiApiKey?: string },
): boolean {
  const base = (opts.baseUrl || '').trim();
  if (!base) return !opts.openAiApiKey;
  return isMindsBaseUrl(base, opts.mindsUrl || '');
}

/**
 * `host` or `host:port` for an endpoint, or '' when it names none.
 *
 * Used to label a provider card reconstructed from a bare base URL, so it
 * carries the endpoint the user typed rather than a generic placeholder.
 */
export function endpointHost(base: string): string {
  const url = parseEndpoint(base);
  if (!url) return '';
  return url.port ? `${url.hostname}:${url.port}` : url.hostname;
}
