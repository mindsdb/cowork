import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./server-process', () => ({
  startServer: vi.fn(), stopServer: vi.fn(), isServerRunning: () => false, withServerMaintenance: (fn: () => unknown) => fn(),
}));
vi.mock('./cowork-home', () => ({ buildKind: vi.fn(() => 'prod') }));

import { keepCodeExtra } from './server-updater';

describe('keepCodeExtra', () => {
  const dirs: string[] = [];
  afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

  function toolsDirWith(distInfos: string[]): string {
    const tools = fs.mkdtempSync(path.join(os.tmpdir(), 'uv-tools-'));
    dirs.push(tools);
    const sp = path.join(tools, 'cowork-server', 'lib', 'python3.12', 'site-packages');
    fs.mkdirSync(sp, { recursive: true });
    for (const name of distInfos) fs.mkdirSync(path.join(sp, name));
    return tools;
  }

  it('restates the code extra on a reinstall when the Codex runtime is installed today', () => {
    const tools = toolsDirWith(['cowork_server-0.26.9.3.1.dist-info', 'openai_codex-0.147.0.dist-info']);
    expect(keepCodeExtra('cowork-server==0.26.9.3.2', tools)).toBe('cowork-server[code]==0.26.9.3.2');
    expect(keepCodeExtra('cowork-server @ git+https://github.com/mindsdb/cowork-server.git@staging', tools))
      .toBe('cowork-server[code] @ git+https://github.com/mindsdb/cowork-server.git@staging');
  });

  it('leaves the spec alone when Code Mode was never set up on this computer', () => {
    const tools = toolsDirWith(['cowork_server-0.26.9.3.1.dist-info']);
    expect(keepCodeExtra('cowork-server==0.26.9.3.2', tools)).toBe('cowork-server==0.26.9.3.2');
    expect(keepCodeExtra('cowork-server==0.26.9.3.2', path.join(tools, 'missing'))).toBe('cowork-server==0.26.9.3.2');
  });
});
