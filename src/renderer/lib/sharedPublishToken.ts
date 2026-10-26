/**
 * Whether this deployment publishes with one shared publish token (cowork-server's
 * COWORK_PUBLISH_TOKEN) rather than the person's own key. The Docker SPA wrapper supplies
 * the answer before the renderer starts; a page without its tag keeps the shared-token
 * behavior, the one every web build without the platform UI had before the tag existed.
 */
export function hasSharedPublishToken(): boolean {
  return document.head.querySelector<HTMLMetaElement>(
    'meta[name="cowork-shared-publish-token"]',
  )?.content !== 'false';
}
