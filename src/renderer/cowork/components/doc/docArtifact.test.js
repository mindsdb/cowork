import { describe, expect, it } from 'vitest';
import { docPageTarget, isDocArtifact } from './docArtifact';

describe('isDocArtifact', () => {
  it('knows a doc by its format or its stored file', () => {
    expect(isDocArtifact({ format: 'doc' })).toBe(true);
    expect(isDocArtifact({ primary: 'Plan.CDOC.json' })).toBe(true);
    expect(isDocArtifact({ path: '/p/.anton/artifacts/plan/doc.cdoc.json' })).toBe(true);
    expect(isDocArtifact({ file_path: 'doc.cdoc.json' })).toBe(true);
  });

  it('takes anything else for a file', () => {
    expect(isDocArtifact({ format: 'html', path: '/p/report.html' })).toBe(false);
    expect(isDocArtifact({ path: '/p/data.json' })).toBe(false);
    expect(isDocArtifact({})).toBe(false);
    expect(isDocArtifact(null)).toBe(false);
  });
});

describe('docPageTarget', () => {
  const doc = {
    id: 'a1', format: 'doc', path: '/p/plan/doc.cdoc.json', file_path: '/p/plan/doc.cdoc.json',
    folder: '/p/plan', canonicalPath: '/p/plan/doc.cdoc.json', htmlPath: '/p/plan/doc.html',
  };

  it('addresses a doc by its page, not its JSON or its folder', () => {
    expect(docPageTarget(doc)).toEqual({
      id: 'a1', format: 'doc', htmlPath: '/p/plan/doc.html',
      path: '/p/plan/doc.html', file_path: '/p/plan/doc.html', folder: undefined, canonicalPath: undefined,
    });
  });

  it('has nothing for a doc with no known page, or for any other artifact', () => {
    expect(docPageTarget({ ...doc, htmlPath: undefined })).toBeNull();
    expect(docPageTarget({ path: '/p/report.html', htmlPath: '/p/report.html' })).toBeNull();
    expect(docPageTarget(null)).toBeNull();
  });
});
