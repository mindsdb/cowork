import { describe, it, expect } from 'vitest';
import { versionRows, BUILD_KIND_LABELS } from './versionRows';

const info = (over = {}) => ({ app: '1.2.3', ui: null, source: 'bundled', buildKind: null, ...over });

describe('versionRows', () => {
  it('reports the four components in the settings panel order', () => {
    expect(versionRows({
      versionInfo: info(),
      bakedVersion: '1.2.3',
      serverVersion: '4.5.6',
      antonVersion: '7.8.9',
    })).toEqual([
      ['App shell', '1.2.3'],
      ['UI', '1.2.3 (bundled)'],
      ['Server', '4.5.6'],
      ['Agent', '7.8.9'],
    ]);
  });

  it('carries the Build row only when the build kind is known', () => {
    const rows = versionRows({
      versionInfo: info({ buildKind: 'preview' }),
      bakedVersion: '1.2.3',
      serverVersion: '4.5.6',
      antonVersion: '7.8.9',
    });
    expect(rows[1]).toEqual(['Build', BUILD_KIND_LABELS.preview]);
    expect(versionRows({
      versionInfo: info(),
      bakedVersion: '1.2.3',
      serverVersion: '',
      antonVersion: '',
    }).map(([k]) => k)).not.toContain('Build');
  });

  it('prefers the running renderer bundle over main-process cache metadata', () => {
    // The baked version is compiled into whichever bundle actually loaded;
    // versionInfo.ui can lag it after a rollback or with OTA off.
    const [, ui] = versionRows({
      versionInfo: info({ ui: '0.9.0', source: 'ota' }),
      bakedVersion: '1.2.3',
      serverVersion: '4.5.6',
      antonVersion: '7.8.9',
    });
    expect(ui).toEqual(['UI', '1.2.3 (OTA)']);
  });

  it('falls back to an em dash per row rather than dropping the row', () => {
    expect(versionRows({
      versionInfo: { app: '', ui: null, source: 'web', buildKind: null },
      bakedVersion: '',
      serverVersion: '',
      antonVersion: '',
    })).toEqual([
      ['App shell', '—'],
      ['UI', '—'],
      ['Server', '—'],
      ['Agent', '—'],
    ]);
  });
});
