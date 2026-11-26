import type { BootHost } from './bootTarget';

export type ServiceReadiness =
  | { state: 'ready' | 'unconfigured'; orgMode: boolean; liveApps: boolean; draftLinks: boolean; docsEnabled?: boolean }
  | { state: 'unavailable'; orgMode: null; liveApps: false; draftLinks: false; docsEnabled?: undefined };

export async function checkServiceReady(
  checkConfigured: BootHost['checkConfigured'],
): Promise<ServiceReadiness> {
  try {
    const result = await checkConfigured();
    return {
      state: result.configured ? 'ready' : 'unconfigured',
      orgMode: Boolean(result.orgMode),
      liveApps: result.liveApps === true,
      draftLinks: result.draftLinks === true,
      // Passed as reported; App.tsx resolves a missing value after the orgMode fail-safe.
      docsEnabled: typeof result.docsEnabled === 'boolean' ? result.docsEnabled : undefined,
    };
  } catch {
    return { state: 'unavailable', orgMode: null, liveApps: false, draftLinks: false };
  }
}
