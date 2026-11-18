import { describe, it, expect } from 'vitest';
import { GENERATE_IMAGE_TOOL, generatedImagesFromEvent, parseGeneratedImageResult, projectRelativeImagePath } from './generatedImage';

const RESULT = {
  path: 'images/cat.png',
  width: 1024,
  height: 1536,
  mime_type: 'image/png',
  model: 'gpt-image-2.6-flare',
  usage: { input_tokens: 16, output_tokens: 824 },
};

describe('parseGeneratedImageResult (ENG-4024)', () => {
  it('names the tool the way anton registers it', () => {
    expect(GENERATE_IMAGE_TOOL).toBe('generate_image');
  });

  it("reads the tool's JSON result", () => {
    expect(parseGeneratedImageResult(JSON.stringify(RESULT))).toEqual({
      path: 'images/cat.png',
      name: 'cat.png',
      width: 1024,
      height: 1536,
      mimeType: 'image/png',
      model: 'gpt-image-2.6-flare',
      prompt: '',
    });
  });

  it('reads an already-parsed result too', () => {
    expect(parseGeneratedImageResult(RESULT)?.path).toBe('images/cat.png');
  });

  it('keeps a result with no dimensions, reading them as unknown', () => {
    expect(parseGeneratedImageResult({ path: 'cat.webp', width: '1024', height: 0 }))
      .toMatchObject({ path: 'cat.webp', width: null, height: null });
  });

  it('describes no image for a refusal, an error, or a payload that is not the tool result', () => {
    expect(parseGeneratedImageResult('Image generation was refused: moderation_blocked')).toBeNull();
    expect(parseGeneratedImageResult({ error: 'rate limited', path: 'x.png' })).toBeNull();
    expect(parseGeneratedImageResult({ width: 10 })).toBeNull();
    expect(parseGeneratedImageResult({ path: '   ' })).toBeNull();
    expect(parseGeneratedImageResult({ path: 'notes.txt', mime_type: 'text/plain' })).toBeNull();
    expect(parseGeneratedImageResult(['cat.png'])).toBeNull();
    expect(parseGeneratedImageResult(null)).toBeNull();
  });
});

describe('generatedImagesFromEvent (ENG-4024)', () => {
  const event = (over = {}) => ({ content: JSON.stringify({ ...RESULT, path: 'cat.png' }), ...over });

  it("reads each image by the server's project-relative path, not the workspace one", () => {
    // On web the workspace is the conversation's folder, so the tool's own
    // `cat.png` is not a path the project's files route serves.
    const images = generatedImagesFromEvent(event({
      generated_images: [{ path: 'conversations/conv-a/cat.png' }],
    }));
    expect(images).toEqual([{
      path: 'conversations/conv-a/cat.png',
      name: 'cat.png',
      width: 1024,
      height: 1536,
      mimeType: 'image/png',
      model: 'gpt-image-2.6-flare',
      prompt: '',
    }]);
  });

  it('shows every image the server lists, in order, with their own size where given', () => {
    const images = generatedImagesFromEvent(event({
      generated_images: [
        { path: 'conversations/conv-a/cat-1.png' },
        { path: 'conversations/conv-a/cat-2.webp', width: 1536, height: 1024, mime_type: 'image/webp' },
      ],
    }));
    expect(images.map((i) => [i.path, i.width, i.height, i.mimeType])).toEqual([
      ['conversations/conv-a/cat-1.png', 1024, 1536, 'image/png'],
      ['conversations/conv-a/cat-2.webp', 1536, 1024, 'image/webp'],
    ]);
  });

  it("still lists the server's images when the tool result itself can't be read", () => {
    expect(generatedImagesFromEvent({ content: 'Saved 1 image.', generated_images: [{ path: 'a/cat.png' }] }))
      .toMatchObject([{ path: 'a/cat.png', name: 'cat.png', width: null, height: null, model: '' }]);
  });

  it("falls back to the tool result's path only when the server sends no list (an older server)", () => {
    expect(generatedImagesFromEvent(event()).map((i) => i.path)).toEqual(['cat.png']);
    // An empty list is the server's answer, not a missing one.
    expect(generatedImagesFromEvent(event({ generated_images: [] }))).toEqual([]);
  });

  it('skips entries with no usable path and shows nothing for a failed call', () => {
    expect(generatedImagesFromEvent(event({
      generated_images: [{ path: '' }, null, { path: 42 }, { path: 'notes.txt', mime_type: 'text/plain' }, { path: 'ok.png' }],
    })).map((i) => i.path)).toEqual(['ok.png']);
    expect(generatedImagesFromEvent(event({ ok: false, generated_images: [{ path: 'a/cat.png' }] }))).toEqual([]);
    expect(generatedImagesFromEvent(null)).toEqual([]);
  });
});

describe('projectRelativeImagePath (ENG-4024)', () => {
  it('keeps a workspace-relative path', () => {
    expect(projectRelativeImagePath('images/cat.png')).toBe('images/cat.png');
    expect(projectRelativeImagePath('./cat.png')).toBe('cat.png');
  });

  it('reads an absolute path inside the project as relative to it', () => {
    expect(projectRelativeImagePath('/home/u/proj/images/cat.png', '/home/u/proj')).toBe('images/cat.png');
    expect(projectRelativeImagePath('/home/u/proj/cat.png', '/home/u/proj/')).toBe('cat.png');
    expect(projectRelativeImagePath('C:\\Users\\u\\proj\\cat.png', 'C:\\Users\\u\\proj')).toBe('cat.png');
  });

  it('refuses an absolute path outside the project, or with no project to place it in', () => {
    expect(projectRelativeImagePath('/home/u/other/cat.png', '/home/u/proj')).toBeNull();
    // A sibling whose name merely starts with the project's.
    expect(projectRelativeImagePath('/home/u/proj-old/cat.png', '/home/u/proj')).toBeNull();
    expect(projectRelativeImagePath('/mnt/data/cat.png', '')).toBeNull();
  });

  it('never climbs out of the project', () => {
    expect(projectRelativeImagePath('../secret.png')).toBeNull();
    expect(projectRelativeImagePath('images/../../secret.png')).toBeNull();
    expect(projectRelativeImagePath('/home/u/proj/../secret.png', '/home/u/proj')).toBeNull();
  });

  it('refuses an empty or non-string path', () => {
    expect(projectRelativeImagePath('')).toBeNull();
    expect(projectRelativeImagePath('/')).toBeNull();
    expect(projectRelativeImagePath(undefined)).toBeNull();
  });
});
