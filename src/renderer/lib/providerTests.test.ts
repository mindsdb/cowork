import { afterEach, describe, expect, it } from 'vitest';
import { providerTestsEnabled } from './providerTests';

afterEach(() => {
  document.head.querySelectorAll('meta[name="cowork-provider-tests-enabled"]').forEach((node) => node.remove());
});

describe('runtime provider testing', () => {
  it('keeps existing web and desktop behavior when the server supplies no setting', () => {
    expect(providerTestsEnabled(true)).toBe(true);
    expect(providerTestsEnabled(false)).toBe(true);
  });

  it.each(['true', '', 'FALSE', '0', 'invalid'])('keeps testing enabled for metadata %j', (value) => {
    const meta = document.createElement('meta');
    meta.name = 'cowork-provider-tests-enabled';
    meta.content = value;
    document.head.append(meta);
    expect(providerTestsEnabled(true)).toBe(true);
  });

  it('disables web testing only when the server explicitly sets false', () => {
    const meta = document.createElement('meta');
    meta.name = 'cowork-provider-tests-enabled';
    meta.content = 'false';
    document.head.append(meta);
    expect(providerTestsEnabled(true)).toBe(false);
    expect(providerTestsEnabled(false)).toBe(true);
  });
});
