/** The Docker SPA wrapper supplies this setting before the renderer starts. */
export function providerTestsEnabled(isWeb: boolean): boolean {
  return !isWeb || document.head.querySelector<HTMLMetaElement>(
    'meta[name="cowork-provider-tests-enabled"]',
  )?.content !== 'false';
}
