import type { BootHost } from './bootTarget';

export type ServiceReadiness =
  | { state: 'ready' | 'unconfigured'; orgMode: boolean; liveApps: boolean; draftLinks: boolean }
  | { state: 'unavailable'; orgMode: null; liveApps: false; draftLinks: false };

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
    };
  } catch {
    return { state: 'unavailable', orgMode: null, liveApps: false, draftLinks: false };
  }
}
