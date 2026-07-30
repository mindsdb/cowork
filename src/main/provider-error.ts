// Pure helpers for interpreting provider validation responses. Deliberately
// free of electron imports so they're unit-testable directly (the
// update-logic.ts / server-source.ts pattern).

/**
 * Extract a human message from a provider error body, or null.
 *
 * Google's Gemini OpenAI-compat *chat* endpoint returns a single-element ARRAY
 * (`[{"error":{"message":...}}]`) while OpenAI and others use a bare object; the
 * old `.error?.message` read on the parsed top level silently missed the array,
 * which is why ENG-1145 surfaced as a contentless "HTTP 404" with the real
 * reason ("no longer available to new users") thrown away.
 */
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

/**
 * Map an OpenAI-compatible validation response to an ok/error result.
 *
 * Handles the two Gemini footguns behind ENG-1145: array-shaped error bodies
 * (via extractProviderError) and a bad key returning 400 rather than 401/403 —
 * an auth-shaped message at any status reads as an invalid key so the user gets
 * an actionable label instead of a bare "HTTP 400".
 */
export function classifyOpenAICompatibleResult(
  status: number,
  body: string,
): { ok: boolean; error?: string } {
  if (status === 200 || status === 201) return { ok: true };
  const message = extractProviderError(body);
  if (status === 401 || status === 403 || (message !== null && /api key/i.test(message))) {
    return { ok: false, error: 'Invalid API key' };
  }
  return { ok: false, error: message || `HTTP ${status}` };
}
