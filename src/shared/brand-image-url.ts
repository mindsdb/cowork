/**
 * The one check every org brand image (ENG-4020) passes before it is shown or
 * downloaded, in the renderer and in the desktop main process alike: the URL
 * when it is https on the configured auth host, else null. Credentials,
 * another port or a look-alike host are refused.
 */
export function trustedAuthImageUrl(value: unknown, authHost: string | null): string | null {
  if (typeof value !== 'string' || !authHost) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  return url.host.toLowerCase() === authHost.toLowerCase() ? url.toString() : null;
}
