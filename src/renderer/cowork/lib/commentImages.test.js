import { describe, expect, it, vi } from 'vitest';
import {
  composeCommentText, parseCommentText, threadImageFiles, threadImages,
} from './commentImages';

const A = '0123456789abcdef0123456789abcdef.png';
const B = 'fedcba9876543210fedcba9876543210.jpg';

describe('comment image markers', () => {
  it('round-trips words and images through the comment text', () => {
    const text = composeCommentText('Make it like this', [{ id: A, name: 'shot.png' }]);
    expect(text).toBe(`Make it like this\n\n![shot.png](cowork-image:${A})`);
    expect(parseCommentText(text)).toEqual({ body: 'Make it like this', images: [{ id: A, name: 'shot.png' }] });
  });

  it('writes an image-only comment as its markers', () => {
    expect(composeCommentText('  ', [{ id: A, name: 'x.png' }])).toBe(`![x.png](cowork-image:${A})`);
  });

  it('keeps a name from closing the marker early, and drops ids that are not stored images', () => {
    const text = composeCommentText('hi', [{ id: A, name: 'a](evil)\n.png' }, { id: '../etc/passwd', name: 'x' }]);
    expect(text).toBe(`hi\n\n![a  evil  .png](cowork-image:${A})`);
  });

  it('leaves text with no markers exactly as written', () => {
    expect(parseCommentText('a\n\n\n\nb')).toEqual({ body: 'a\n\n\n\nb', images: [] });
  });

  it("lists a thread's images root first, then replies, once each", () => {
    const thread = { payload: {
      text: composeCommentText('root', [{ id: A, name: 'a' }]),
      replies: [{ text: composeCommentText('r', [{ id: B, name: 'b' }, { id: A, name: 'a' }]) }],
    } };
    expect(threadImages(thread).map((i) => i.id)).toEqual([A, B]);
  });

  it('reads the images as Files, leaving out any that fail', async () => {
    const thread = { payload: { text: composeCommentText('x', [{ id: A, name: 'a.png' }, { id: B, name: 'b.jpg' }]) } };
    const load = vi.fn(async (id) => {
      if (id === B) throw new Error('gone');
      return new Blob(['png'], { type: 'image/png' });
    });
    const files = await threadImageFiles(thread, load);
    expect(files).toHaveLength(1);
    expect(files[0]).toBeInstanceOf(File);
    expect(files[0].name).toBe('a.png');
    expect(files[0].type).toBe('image/png');
  });
});
