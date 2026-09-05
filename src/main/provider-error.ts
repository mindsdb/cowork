/** Extract provider messages from either object bodies or Gemini’s single-element error array. */
export function extractProviderError(body: string): string | null {
  try {
    const parsed = JSON.parse(body);
    const obj = Array.isArray(parsed) ? parsed[0] : parsed;
    const msg = obj?.error?.message ?? obj?.message;
    return typeof msg === 'string' && msg.trim() ? msg.trim() : null;
  } catch {
    return null;
  }
}

// Match invalid-key messages narrowly: permission/quota errors also mention API keys but need
// different remedies.
// Keep aligned with cowork-server’s _AUTH_SHAPED_RE.
const AUTH_SHAPED =
  /api[_ ]?key (is )?(not valid|invalid)|invalid api[_ ]?key|pass a valid api[_ ]?key/i;

/**
 * Classify OpenAI-compatible errors, including Gemini’s array body and auth failures reported as
 * HTTP 400.
 */
export function classifyOpenAICompatibleResult(
  status: number,
  body: string,
): { ok: boolean; error?: string } {
  if (status === 200 || status === 201) return { ok: true };
  const message = extractProviderError(body);
  if (status === 401 || status === 403 || (message !== null && AUTH_SHAPED.test(message))) {
    return { ok: false, error: 'Invalid API key' };
  }
  return { ok: false, error: message || `HTTP ${status}` };
}
