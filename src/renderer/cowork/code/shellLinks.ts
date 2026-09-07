import { host } from '../../platform/host';
import { safeCodeExternalUrl } from './developerTools';

// The only module under code/ that reaches the OS shell (enforced by
// shellLinks.invariant.test.ts).

export async function openCodeExternalUrl(value: string | null | undefined): Promise<boolean> {
  const url = safeCodeExternalUrl(value);
  if (!url) return false;
  await host.openExternal(url);
  return true;
}

/**
 * Web and scp-style remotes open in the browser. Anything else is revealed in
 * the file manager rather than handed to `openPath`, which would ask the OS to
 * execute an arbitrary user-entered path with its default application.
 */
export async function openCodeRepository(repository: string): Promise<void> {
  if (await openCodeExternalUrl(repository)) return;
  const scpRemote = repository.match(/^git@([^:]+):(.+)$/i);
  if (scpRemote) {
    const opened = await openCodeExternalUrl(`https://${scpRemote[1]}/${scpRemote[2].replace(/\.git$/i, '')}`);
    if (!opened) throw new Error('That repository address is not safe to open.');
    return;
  }
  const result = await host.showItemInFolder(repository);
  if (!result.ok) throw new Error(result.reason || 'Could not open that repository.');
}

/**
 * Only for locations the local sidecar manages itself (task workspaces, the
 * playbook cache, its own config file). User-entered strings go through
 * `openCodeRepository`.
 */
export function openCodePath(path: string): Promise<{ ok: boolean; reason?: string }> {
  return host.openPath(path);
}
