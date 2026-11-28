import { describe, expect, it } from 'vitest';
import { notUploadedSentence } from './projectUploads';

describe('notUploadedSentence', () => {
  it('names each file the server answered ok: false for', () => {
    const response = {
      results: [
        { name: 'quarterly.csv', ok: true, size: 12 },
        { name: '.env', ok: false, error: 'invalid filename' },
        { name: 'notes.md', ok: false, error: 'File write failed' },
      ],
    };

    expect(notUploadedSentence(response)).toBe('Files not uploaded: .env, notes.md.');
  });

  it('says nothing when the server saved every file', () => {
    expect(notUploadedSentence({ results: [{ name: 'quarterly.csv', ok: true, size: 12 }] })).toBe('');
    expect(notUploadedSentence({ results: [] })).toBe('');
  });

  it('says nothing for an answer without a result list', () => {
    expect(notUploadedSentence(undefined)).toBe('');
    expect(notUploadedSentence({})).toBe('');
    expect(notUploadedSentence({ results: 'not a list' })).toBe('');
  });
});
