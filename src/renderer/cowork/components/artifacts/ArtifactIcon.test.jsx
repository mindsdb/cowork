import { describe, it, expect } from 'vitest';
import { displayTitle, fileNameOf, splitArtifactName } from './ArtifactIcon';

describe('displayTitle', () => {
  it('uses the title for a file artifact when title and filename differ', () => {
    const a = { type: 'document', title: '2026 Forecast', path: '/x/MindsHub_2026_Forecast.xlsx' };
    expect(displayTitle(a)).toBe('2026 Forecast');
  });

  it('falls back to the filename when title is empty', () => {
    const a = { type: 'document', title: '', path: '/x/report.csv' };
    expect(displayTitle(a)).toBe('report.csv');
  });

  it('falls back to "file" when there is neither a title nor a path', () => {
    expect(displayTitle({ type: 'document' })).toBe('file');
  });

  it('uses the title for a web-app artifact', () => {
    const a = { type: 'html-app', title: 'Weather Dashboard', path: '/x/index.html' };
    expect(displayTitle(a)).toBe('Weather Dashboard');
  });

  it('falls back to "Untitled" for a web-app artifact with neither title nor path', () => {
    expect(displayTitle({ type: 'html-app' })).toBe('Untitled');
  });
});

describe('fileNameOf', () => {
  it('extracts the last path segment', () => {
    expect(fileNameOf({ path: '/a/b/report.csv' })).toBe('report.csv');
  });

  it('returns "" when there is no path', () => {
    expect(fileNameOf({})).toBe('');
  });
});

describe('splitArtifactName', () => {
  it('splits a file artifact into a title base and a {name, ext} secondary', () => {
    const a = { type: 'document', title: '2026 Forecast', path: '/x/MindsHub_2026_Forecast.xlsx' };
    expect(splitArtifactName(a)).toEqual({
      base: '2026 Forecast',
      secondary: { name: 'MindsHub_2026_Forecast', ext: '.xlsx' },
    });
  });

  it('keeps the full filename as secondary.name when the extension is unrecognized', () => {
    const a = { type: 'document', title: 'My Notes', path: '/x/README' };
    expect(splitArtifactName(a)).toEqual({
      base: 'My Notes',
      secondary: { name: 'README', ext: '' },
    });
  });

  it('has no secondary line for a web-app artifact', () => {
    const a = { type: 'html-app', title: 'Weather Dashboard', path: '/x/index.html' };
    expect(splitArtifactName(a)).toEqual({ base: 'Weather Dashboard', secondary: null });
  });

  it('has no secondary line when a file has no path', () => {
    const a = { type: 'document', title: 'Untitled note' };
    expect(splitArtifactName(a)).toEqual({ base: 'Untitled note', secondary: null });
  });
});
