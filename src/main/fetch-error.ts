// Node fetch reports network failures generically; err.cause carries the DNS/TLS/connection reason.
export function describeFetchError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = (err as { cause?: unknown }).cause;
  if (!cause) return err.message;
  const causeMessage = cause instanceof Error ? cause.message : String(cause);
  const causeCode = (cause as NodeJS.ErrnoException)?.code;
  return causeCode ? `${err.message} (${causeCode}: ${causeMessage})` : `${err.message} (${causeMessage})`;
}
