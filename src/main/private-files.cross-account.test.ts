/* Another account on the computer cannot read a tightened home, checked as that
 * account: `nobody`, through sudo. Runs on Linux when sudo needs no password,
 * as on CI's ubuntu-latest, and skips everywhere else.
 *
 * The fixture sits under a 0755 folder in the shared /tmp, so `nobody` can
 * reach each home and only the home's own modes decide what it can read. An
 * untightened sibling home must stay readable, which proves the check can fire.
 * `test -r` asks for read access without reading anything. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { pinPrivateDir, tightenHomeOnce } from './private-files';

const canActAsAnotherAccount =
  process.platform === 'linux' && spawnSync('sudo', ['-n', 'true'], { stdio: 'ignore' }).status === 0;

/** The exit code of `test -r <file>` as `nobody`: 0 readable, 1 not. */
function nobodyTestRead(file: string): number | null {
  return spawnSync('sudo', ['-n', '-u', 'nobody', 'test', '-r', file], { stdio: 'ignore' }).status;
}

interface SeededHome {
  home: string;
  files: { database: string; streamBuffer: string; codingCopy: string };
}

function seedHome(parent: string, name: string): SeededHome {
  const home = path.join(parent, name);
  const write = (relative: string) => {
    const file = path.join(home, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'x');
    fs.chmodSync(file, 0o644);
    return file;
  };
  const files = {
    database: write('cowork.db'),
    streamBuffer: write(path.join('streams', 'turn-1.jsonl')),
    codingCopy: write(path.join('coding', 'task-1', 'repo', 'main.py')),
  };
  // Every folder at 0755, as an install from before the pin left it.
  for (const dir of ['', 'streams', 'coding', 'coding/task-1', 'coding/task-1/repo']) {
    fs.chmodSync(path.join(home, dir), 0o755);
  }
  return { home, files };
}

describe.skipIf(!canActAsAnotherAccount)('another account and a tightened home (Linux, as nobody)', () => {
  let fixture: string;

  beforeEach(() => {
    fixture = fs.mkdtempSync('/tmp/cowork-xacct-');
    fs.chmodSync(fixture, 0o755);
  });

  afterEach(() => {
    fs.rmSync(fixture, { recursive: true, force: true });
  });

  it('cannot read the database, a stream buffer or a Code mode copy after the pin and the pass', async () => {
    const tightened = seedHome(fixture, '.cowork');
    const untouched = seedHome(fixture, '.cowork-untouched');

    pinPrivateDir(tightened.home, { platform: 'linux' });
    expect(await tightenHomeOnce(tightened.home, { platform: 'linux' })).toMatchObject({ kind: 'tightened' });

    for (const file of Object.values(untouched.files)) expect({ file, status: nobodyTestRead(file) }).toEqual({ file, status: 0 });
    for (const file of Object.values(tightened.files)) expect({ file, status: nobodyTestRead(file) }).toEqual({ file, status: 1 });
  });

  it('cannot read them through the pass alone, with the home still 0755', async () => {
    const tightened = seedHome(fixture, '.cowork');

    expect(await tightenHomeOnce(tightened.home, { platform: 'linux' })).toMatchObject({ kind: 'tightened' });

    // The Code mode copy keeps 0644 and is closed off by its pinned coding/.
    expect(fs.statSync(tightened.files.codingCopy).mode & 0o777).toBe(0o644);
    for (const file of Object.values(tightened.files)) expect({ file, status: nobodyTestRead(file) }).toEqual({ file, status: 1 });
  });
});
