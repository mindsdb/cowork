import { describe, it, expect } from 'vitest';
import { GENERATE_IMAGE_TOOL, parseGeneratedImageResult, projectRelativeImagePath } from './generatedImage';

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
