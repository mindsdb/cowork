import { describe, expect, it } from 'vitest';
import { normalizeArtifactPath } from './artifactPaths';

const UUID = 'd4b2c4ec-2cd0-441c-a94c-e201781d9a7e';

// ENG-2171: the chat card showed `conversations/<uuid>/.anton/artifacts/…`,
// a storage path the user cannot act on. `displayPath` is the only thing the
// card shows; `canonicalPath` is what every action targets, so it must not move.
describe('normalizeArtifactPath display path', () => {
  it('drops the conversation folder and .anton/artifacts from a relative path', () => {
    const raw = `conversations/${UUID}/.anton/artifacts/q3-deck/index.html`;
    const result = normalizeArtifactPath(raw, '/proj');
    expect(result.displayPath).toBe('q3-deck/index.html');
    expect(result.canonicalPath).toBe(`/proj/conversations/${UUID}/.anton/artifacts/q3-deck/index.html`);
    expect(result.actionDisabledReason).toBe('');
  });

  it('drops .anton/output from a relative path', () => {
    const result = normalizeArtifactPath('.anton/output/report.md', '/proj');
    expect(result.displayPath).toBe('report.md');
    expect(result.canonicalPath).toBe('/proj/.anton/output/report.md');
  });

  it('drops the dotless anton/output shim prefix too', () => {
    const result = normalizeArtifactPath('anton/output/report.md', '/proj');
    expect(result.displayPath).toBe('report.md');
    expect(result.canonicalPath).toBe('/proj/.anton/output/report.md');
  });

  it('applies the same rule to an absolute path inside the project', () => {
    const raw = `/proj/conversations/${UUID}/.anton/artifacts/clock/index.html`;
    const result = normalizeArtifactPath(raw, '/proj');
    expect(result.displayPath).toBe('clock/index.html');
    expect(result.canonicalPath).toBe(raw);
  });

  it('applies the same rule to an absolute path outside the project', () => {
    const raw = '/Users/me/.cowork/projects/general/.anton/artifacts/x/Scorecard.xlsx';
    const result = normalizeArtifactPath(raw, '/proj');
    expect(result.displayPath).toBe('x/Scorecard.xlsx');
    expect(result.canonicalPath).toBe(raw);
  });

  it('falls back to the file name for any other .anton internal', () => {
    const result = normalizeArtifactPath(`conversations/${UUID}/.anton/scratch/notes.md`, '/proj');
    expect(result.displayPath).toBe('notes.md');
  });

  it('handles Windows separators', () => {
    const raw = 'C:\\proj\\.anton\\artifacts\\deck\\index.html';
    const result = normalizeArtifactPath(raw, 'C:\\proj');
    expect(result.displayPath).toBe('deck/index.html');
    expect(result.canonicalPath).toBe(raw);
  });

  it('leaves an ordinary project path alone', () => {
    const result = normalizeArtifactPath('reports/summary.md', '/proj');
    expect(result.displayPath).toBe('reports/summary.md');
    expect(result.canonicalPath).toBe('/proj/reports/summary.md');
  });

  it('keeps the disabled reasons for paths it cannot act on', () => {
    expect(normalizeArtifactPath('.anton/artifacts/a/index.html', '').actionDisabledReason)
      .toBe('This artifact path is relative, but the task has no project folder.');
    expect(normalizeArtifactPath('../escape.html', '/proj').actionDisabledReason)
      .toBe('This artifact path points outside the project folder.');
  });
});
