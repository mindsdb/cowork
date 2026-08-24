import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isGenericImageName, clipboardImageName, renameClipboardImages } from './clipboardImageName';

// Date.now() feeds the timestamp segment — pin the clock so the expected name
// is a pure function of the input. TZ=UTC comes from tests/setup-env.ts.
const NOW = new Date('2026-08-17T12:00:00Z');
const TS = Math.floor(NOW.getTime() / 1000);

const file = (name, type, bytes = [1, 2, 3]) =>
  new File([new Uint8Array(bytes)], name, { type });

const nameRe = (ext) => new RegExp(`^clipboard_${TS}_[0-9a-f]{8}\\${ext}$`);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('isGenericImageName', () => {
  it('treats a bare image.<ext> and an empty name as generic', () => {
    expect(isGenericImageName('image.png')).toBe(true);
    expect(isGenericImageName('IMAGE.PNG')).toBe(true);
    expect(isGenericImageName('image.bmp')).toBe(true);
    expect(isGenericImageName('image.tiff')).toBe(true);
    expect(isGenericImageName('image.avif')).toBe(true);
    expect(isGenericImageName('')).toBe(true);
    expect(isGenericImageName(undefined)).toBe(true);
  });

  it('leaves anything a human would recognise alone', () => {
    expect(isGenericImageName('Screenshot 2026-08-17 at 14.30.12.png')).toBe(false);
    expect(isGenericImageName('chart.png')).toBe(false);
    expect(isGenericImageName('my image.png')).toBe(false);
    expect(isGenericImageName('image.jpeg2000')).toBe(false);
  });
});

describe('clipboardImageName', () => {
  it('builds clipboard_<ts>_<8hex> with the extension from the mime type', () => {
    expect(clipboardImageName(file('image.png', 'image/png'))).toMatch(nameRe('.png'));
    expect(clipboardImageName(file('image.png', 'image/jpeg'))).toMatch(nameRe('.jpg'));
  });
});

describe('renameClipboardImages', () => {
  it('renames a generic pasted screenshot', () => {
    const [out] = renameClipboardImages([file('image.png', 'image/png')]);
    expect(out.name).toMatch(nameRe('.png'));
    expect(out.type).toBe('image/png');
    expect(out.size).toBe(3);
  });

  it('renames the platform variants too', () => {
    const out = renameClipboardImages([
      file('image.bmp', 'image/bmp'),
      file('image.tiff', 'image/tiff'),
      file('image.avif', 'image/avif'),
    ]);
    expect(out[0].name).toMatch(nameRe('.bmp'));
    expect(out[1].name).toMatch(nameRe('.tiff'));
    expect(out[2].name).toMatch(nameRe('.avif'));
  });

  it('keeps a meaningful filename untouched (same File instance)', () => {
    const original = file('chart.png', 'image/png');
    const [out] = renameClipboardImages([original]);
    expect(out).toBe(original);
  });

  it('ignores non-images even when named like a generic one', () => {
    const original = file('image.pdf', 'application/pdf');
    const [out] = renameClipboardImages([original]);
    expect(out).toBe(original);
  });

  it('falls back to the original extension for an unknown image mime', () => {
    const [out] = renameClipboardImages([file('image.heic', 'image/heic')]);
    expect(out.name).toMatch(nameRe('.heic'));
  });

  it('gives the same bytes two different names — there is no content dedup', () => {
    const [a] = renameClipboardImages([file('image.png', 'image/png')]);
    const [b] = renameClipboardImages([file('image.png', 'image/png')]);
    expect(a.name).not.toBe(b.name);
  });

  it('is synchronous — the paste handler must not have to await it (ENG-1100)', () => {
    const out = renameClipboardImages([file('image.png', 'image/png')]);
    expect(Array.isArray(out)).toBe(true);
    expect(out).not.toBeInstanceOf(Promise);
  });

  it('accepts a FileList-like object and an empty input', () => {
    expect(renameClipboardImages(null)).toEqual([]);
    expect(renameClipboardImages({ length: 0 })).toEqual([]);
  });
});
