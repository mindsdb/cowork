// Pure helper for describing a failed `fetch()` call. Free of electron
// imports so it's unit-testable directly (the provider-error.ts pattern).

// Node's fetch (undici) throws a bare `TypeError: fetch failed` for every
// network-level failure — DNS, TLS, connection refused, timeout all read
// identically. The actual reason lives one level down in `err.cause`, which
// plain `${err}` / `err.message` interpolation silently drops, so a report
// like "Token exchange request failed: fetch failed" carries no way to tell
// a corporate TLS-intercepting proxy from a DNS failure from a blocked port
// (Windows corporate networks are the most common source of exactly this).
export function describeFetchError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = (err as { cause?: unknown }).cause;
  if (!cause) return err.message;
  const causeMessage = cause instanceof Error ? cause.message : String(cause);
  const causeCode = (cause as NodeJS.ErrnoException)?.code;
  return causeCode ? `${err.message} (${causeCode}: ${causeMessage})` : `${err.message} (${causeMessage})`;
}
