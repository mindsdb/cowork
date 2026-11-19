import { afterEach, describe, expect, it } from 'vitest';
import { hasSharedPublishToken } from './sharedPublishToken';

function setMeta(content: string) {
  const meta = document.createElement('meta');
  meta.name = 'cowork-shared-publish-token';
  meta.content = content;
  document.head.append(meta);
}

afterEach(() => {
  document.head.querySelectorAll('meta[name="cowork-shared-publish-token"]').forEach((node) => node.remove());
});

describe('shared publish token', () => {
  it('keeps the shared-token behavior when the server supplies no setting', () => {
    expect(hasSharedPublishToken()).toBe(true);
  });

  it.each(['true', '', 'FALSE', '0', 'invalid'])('keeps the shared-token behavior for metadata %j', (value) => {
    setMeta(value);
    expect(hasSharedPublishToken()).toBe(true);
  });

  it('reports the person\'s own key only when the server explicitly sets false', () => {
    setMeta('false');
    expect(hasSharedPublishToken()).toBe(false);
  });
});
