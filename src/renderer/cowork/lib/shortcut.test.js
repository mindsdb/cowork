import { describe, expect, it, vi } from 'vitest';

describe('shortcutLabel', () => {
  it('uses the command glyph on a Mac and Ctrl+ elsewhere', async () => {
    for (const [mac, expected] of [[true, '⌘K'], [false, 'Ctrl+K']]) {
      vi.resetModules();
      vi.doMock('../../platform/host', () => ({ host: { isMac: () => mac } }));
      vi.stubGlobal('navigator', { userAgent: mac ? 'Macintosh' : 'Windows NT' });
      const { shortcutLabel } = await import('./shortcut');
      expect(shortcutLabel('K')).toBe(expected);
    }
    vi.unstubAllGlobals();
    vi.doUnmock('../../platform/host');
  });
});
