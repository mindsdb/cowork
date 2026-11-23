import { describe, expect, it } from 'vitest';
import { acceptImages, fileToBase64, MAX_IMAGE_BYTES } from './imageAttachments';

const image = (name, type = 'image/png', size = 10) => {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
};

describe('acceptImages', () => {
  it('takes raster images and names the first refusal', () => {
    const { accepted, error } = acceptImages([
      image('a.png'), image('b.svg', 'image/svg+xml'), image('c.pdf', 'application/pdf'),
    ]);
    expect(accepted.map((f) => f.name)).toEqual(['a.png']);
    expect(error).toBe('Only PNG, JPEG, GIF and WebP images can be attached.');
  });

  it('refuses an image over 5 MB', () => {
    const { accepted, error } = acceptImages([image('big.png', 'image/png', MAX_IMAGE_BYTES + 1)]);
    expect(accepted).toEqual([]);
    expect(error).toBe('big.png is larger than 5 MB.');
  });

  it('stops at the cap, counting what is already attached', () => {
    const { accepted, error } = acceptImages([image('a.png'), image('b.png')], 3);
    expect(accepted.map((f) => f.name)).toEqual(['a.png']);
    expect(error).toBe('Up to 4 images per message.');
  });
});

describe('fileToBase64', () => {
  it('encodes the bytes', async () => {
    expect(await fileToBase64(new File(['hello'], 'h.png', { type: 'image/png' }))).toBe('aGVsbG8=');
  });
});
