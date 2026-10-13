import type { BootHost } from './bootTarget';

export type ServiceReadiness =
  | { state: 'ready' | 'unconfigured'; orgMode: boolean }
  | { state: 'unavailable'; orgMode: null };

export async function checkServiceReady(
  checkConfigured: BootHost['checkConfigured'],
): Promise<ServiceReadiness> {
  try {
    const result = await checkConfigured();
    return {
      state: result.configured ? 'ready' : 'unconfigured',
      orgMode: Boolean(result.orgMode),
    };
  } catch {
    return { state: 'unavailable', orgMode: null };
  }
}
