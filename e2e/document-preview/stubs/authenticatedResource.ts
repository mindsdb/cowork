/*
 * The file viewer page's stand-in for src/renderer/cowork/lib/authenticatedResource.js.
 * The harness has no API and no sign-in, so a file is a plain same-origin
 * fetch of a fixture. A download saves nothing; the page records its URL on
 * window.coworkFileViewerDownloads.
 */
declare global {
  interface Window { coworkFileViewerDownloads?: string[] }
}

export async function fetchAuthenticatedResponse(url: string, { signal }: { signal?: AbortSignal } = {}): Promise<Response> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw Object.assign(new Error(`Could not load file (${response.status})`), { status: response.status });
  return response;
}

export async function fetchAuthenticatedBlob(url: string): Promise<Blob> {
  return (await fetchAuthenticatedResponse(url)).blob();
}

export async function downloadAuthenticatedResource(url: string): Promise<boolean> {
  (window.coworkFileViewerDownloads ??= []).push(url);
  return true;
}
