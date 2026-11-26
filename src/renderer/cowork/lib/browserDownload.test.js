import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { contentDispositionFilename, downloadBlob, downloadFilename, downloadUrl } from './browserDownload';

const platform = vi.hoisted(() => ({ isMobileShell: false }));
vi.mock('../../platform/host', () => ({ host: platform }));

let createObjectURL;
let revokeObjectURL;
let clicked;

beforeEach(() => {
  platform.isMobileShell = false;
  vi.useFakeTimers();
  clicked = [];
  createObjectURL = vi.fn(() => 'blob:object-url');
  revokeObjectURL = vi.fn();
  vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function record() {
    clicked.push({ href: this.href, download: this.download, attached: this.isConnected });
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('downloadFilename', () => {
  /*
   * A blob carries no Content-Disposition, so once bytes are fetched rather
   * than navigated to, this value is the only thing naming the saved file.
   */
  it.each([
    ['.anton/anton.md', 'anton.md'],
    ['reports/2026/q1.csv', 'q1.csv'],
    ['docs\\windows\\notes.txt', 'notes.txt'],
    ['report.csv', 'report.csv'],
    ['trailing/slash/', 'slash'],
  ])('takes the basename of %s', (path, expected) => {
    expect(downloadFilename(path)).toBe(expected);
  });

  it.each([[''], [null], [undefined], ['/'], ['\\']])('falls back for %s', (path) => {
    expect(downloadFilename(path)).toBe('download');
    expect(downloadFilename(path, 'artifact')).toBe('artifact');
  });
});

describe('contentDispositionFilename', () => {
  it('prefers the UTF-8 name over the lossy ASCII one', () => {
    const header = `attachment; filename="-123.md"; filename*=UTF-8''${encodeURIComponent('Привет-123.md')}`;
    expect(contentDispositionFilename(header, 'doc.md')).toBe('Привет-123.md');
  });

  it('reads the extended name in any letter case and order', () => {
    const header = `attachment; FILENAME*=utf-8'en'caf%C3%A9.pdf; filename="cafe.pdf"`;
    expect(contentDispositionFilename(header)).toBe('café.pdf');
  });

  it('falls back to the ASCII name when the extended one is malformed', () => {
    expect(contentDispositionFilename(`attachment; filename="report.md"; filename*=UTF-8''%E0%A4%A`)).toBe('report.md');
    expect(contentDispositionFilename(`attachment; filename="report.md"; filename*=UTF-8''`)).toBe('report.md');
    expect(contentDispositionFilename(`attachment; filename="report.md"; filename*=ISO-8859-1''r%E9port.md`)).toBe('report.md');
  });

  it('unescapes a quoted name and accepts a bare token', () => {
    expect(contentDispositionFilename('attachment; filename="say \\"hi\\".md"')).toBe('say "hi".md');
    expect(contentDispositionFilename('attachment; filename=plain.csv')).toBe('plain.csv');
  });

  it('keeps only the last path segment', () => {
    expect(contentDispositionFilename(`attachment; filename*=UTF-8''..%2F..%2Fevil.sh`)).toBe('evil.sh');
  });

  it('uses the fallback when the header names no file', () => {
    expect(contentDispositionFilename(null, 'doc.docx')).toBe('doc.docx');
    expect(contentDispositionFilename('attachment', 'doc.docx')).toBe('doc.docx');
    expect(contentDispositionFilename('')).toBe('download');
  });
});

describe('downloadUrl', () => {
  it('clicks an attached anchor carrying the filename, then removes it', () => {
    expect(downloadUrl('https://example.test/report.csv', 'report.csv')).toBe(true);

    expect(clicked).toEqual([{
      href: 'https://example.test/report.csv',
      download: 'report.csv',
      attached: true,
    }]);
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it('names the file when the caller has no name to give', () => {
    downloadUrl('https://example.test/bytes', '');

    expect(clicked[0].download).toBe('download');
  });

  it('does nothing without a URL', () => {
    expect(downloadUrl('', 'report.csv')).toBe(false);
    expect(clicked).toEqual([]);
  });
});

describe('downloadBlob', () => {
  /*
   * The delay is the whole point of this helper. Firefox and Safari can
   * truncate or cancel a save that has not started reading the blob by the
   * time its object URL is revoked, so revoking on the next macrotask is a
   * silently corrupt download rather than a style choice.
   */
  it('keeps the object URL alive well past the click', () => {
    const blob = new Blob(['a,b\n1,2\n'], { type: 'text/csv' });

    downloadBlob(blob, 'report.csv');

    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(clicked[0]).toMatchObject({ href: 'blob:object-url', download: 'report.csv' });

    vi.advanceTimersByTime(999);
    expect(revokeObjectURL).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:object-url');
  });

  it('still revokes when the click throws', () => {
    HTMLAnchorElement.prototype.click.mockImplementation(() => {
      throw new Error('navigation blocked');
    });

    expect(() => downloadBlob(new Blob(['x']), 'x.txt')).toThrow('navigation blocked');

    vi.advanceTimersByTime(1_000);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:object-url');
  });
});

it('does not create blobs or click download anchors in the mobile shell', () => {
  platform.isMobileShell = true;
  expect(downloadBlob(new Blob(['private']), 'private.txt')).toBe(false);
  expect(downloadUrl('https://example.test/file', 'file')).toBe(false);
  expect(createObjectURL).not.toHaveBeenCalled();
  expect(clicked).toEqual([]);
});
