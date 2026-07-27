export type ShellUpdateBuildKind = 'prod' | 'stable' | 'preview';
export type ShellUpdatePlatform = 'darwin' | 'win32';

export interface ShellUpdateFeed {
  channel: 'prod' | 'stable';
  platform: ShellUpdatePlatform;
  url: string;
}

const CDN_ROOT = 'https://downloads.mindshub.ai/mindshub-cowork/updates';

/**
 * One feed matrix shared by packaging and runtime. Preview/dev/unknown builds
 * fail closed until they have a durable, isolated update channel.
 */
export function resolveShellUpdateFeed(
  buildKind: string | null | undefined,
  platform: string,
): ShellUpdateFeed | null {
  if (buildKind !== 'prod' && buildKind !== 'stable') return null;
  if (platform !== 'darwin' && platform !== 'win32') return null;
  const platformPath = platform === 'darwin' ? 'mac' : 'windows';
  return {
    channel: buildKind,
    platform,
    url: `${CDN_ROOT}/${buildKind}/${platformPath}`,
  };
}
