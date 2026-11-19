import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/* The real execFileSync, recorded, so the macOS case can read the mark back
   and the platform cases can see what would have run. */
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, execFileSync: vi.fn(actual.execFileSync) };
});

import { markDownloaded, quarantineValue } from './download-quarantine';

const hostPlatform = process.platform;
function setPlatform(value: string): void {
  Object.defineProperty(process, 'platform', { value, configurable: true });
}

afterEach(() => {
  setPlatform(hostPlatform);
  vi.mocked(cp.execFileSync).mockClear();
});

describe('quarantineValue', () => {
  it('carries the web-download flags, the time in hex seconds and the app as agent', () => {
    expect(quarantineValue(new Date(1_700_000_000_000))).toBe('0081;6553f100;MindsHub Cowork;');
  });
});

describe('markDownloaded', () => {
  it('runs xattr on macOS with the file as its own argument and no shell', () => {
    setPlatform('darwin');
    vi.mocked(cp.execFileSync).mockImplementationOnce(() => Buffer.alloc(0));
    const file = '/Users/someone/Downloads/Cowork browser/report; rm -rf ~.zip';

    markDownloaded(file);

    expect(cp.execFileSync).toHaveBeenCalledTimes(1);
    const [command, args, options] = vi.mocked(cp.execFileSync).mock.calls[0];
    expect(command).toBe('/usr/bin/xattr');
    expect(args).toEqual(['-w', 'com.apple.quarantine', expect.stringMatching(/^0081;[0-9a-f]+;MindsHub Cowork;$/), file]);
    expect(options).not.toHaveProperty('shell');
  });

  it.each(['win32', 'linux'])('does nothing on %s', (platform) => {
    setPlatform(platform);
    markDownloaded('/tmp/report.zip');
    expect(cp.execFileSync).not.toHaveBeenCalled();
  });

  it('throws when the mark cannot be written, so the caller can withhold the file', () => {
    setPlatform('darwin');
    vi.mocked(cp.execFileSync).mockImplementationOnce(() => { throw new Error('xattr: No such file'); });
    expect(() => markDownloaded('/tmp/gone.zip')).toThrow('xattr: No such file');
  });

  describe.runIf(hostPlatform === 'darwin')('on a real macOS file', () => {
    let dir: string;
    beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quarantine-')); });
    afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

    it('leaves the mark Gatekeeper reads', () => {
      const file = path.join(dir, 'report.zip');
      fs.writeFileSync(file, 'zip');

      markDownloaded(file);

      const mark = cp.execFileSync('/usr/bin/xattr', ['-p', 'com.apple.quarantine', file], { encoding: 'utf-8' });
      expect(mark.trim()).toMatch(/^0081;[0-9a-f]+;MindsHub Cowork;$/);
    });
  });
});
