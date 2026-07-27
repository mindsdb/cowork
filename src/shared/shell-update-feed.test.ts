import { describe, expect, it } from 'vitest';
import { resolveShellUpdateFeed } from './shell-update-feed';

describe('resolveShellUpdateFeed', () => {
  it('keeps prod and stable on separate platform feeds', () => {
    expect(resolveShellUpdateFeed('prod', 'darwin')).toEqual({
      channel: 'prod',
      platform: 'darwin',
      url: 'https://downloads.mindshub.ai/mindshub-cowork/updates/prod/mac',
    });
    expect(resolveShellUpdateFeed('stable', 'win32')).toEqual({
      channel: 'stable',
      platform: 'win32',
      url: 'https://downloads.mindshub.ai/mindshub-cowork/updates/stable/windows',
    });
  });

  it('fails closed for preview, dev, unknown and unsupported platforms', () => {
    expect(resolveShellUpdateFeed('preview', 'darwin')).toBeNull();
    expect(resolveShellUpdateFeed('dev', 'darwin')).toBeNull();
    expect(resolveShellUpdateFeed(null, 'win32')).toBeNull();
    expect(resolveShellUpdateFeed('prod', 'linux')).toBeNull();
  });
});
