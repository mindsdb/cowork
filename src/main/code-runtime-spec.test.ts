import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { codeRuntimeInstalledIn, codeSetupSteps, gitInstallRoute, withCodeExtra } from './code-runtime-spec';


describe('withCodeExtra', () => {
  it.each([
    ['cowork-server==0.26.9.3.1', 'cowork-server[code]==0.26.9.3.1'],
    ['cowork-server>=0.1.10', 'cowork-server[code]>=0.1.10'],
    ['cowork-server', 'cowork-server[code]'],
    ['cowork-server @ git+https://github.com/mindsdb/cowork-server.git@staging', 'cowork-server[code] @ git+https://github.com/mindsdb/cowork-server.git@staging'],
    ['git+https://github.com/mindsdb/cowork-server.git@abc123', 'cowork-server[code] @ git+https://github.com/mindsdb/cowork-server.git@abc123'],
    ['/tmp/build/cowork_server-1.0-py3-none-any.whl', 'cowork-server[code] @ file:///tmp/build/cowork_server-1.0-py3-none-any.whl'],
    ['/tmp/build/with space/cowork_server-1.0-py3-none-any.whl', 'cowork-server[code] @ file:///tmp/build/with%20space/cowork_server-1.0-py3-none-any.whl'],
    ['file:///tmp/src/cowork-server', 'cowork-server[code] @ file:///tmp/src/cowork-server'],
  ])('%s → %s', (spec, expected) => {
    expect(withCodeExtra(spec)).toBe(expected);
  });

  it('turns a Windows path into the file URL uv expects', () => {
    // Exercised through path.win32-style input; on POSIX resolve() keeps the
    // drive letter as a path segment, so assert the shape rather than the OS.
    const spec = withCodeExtra('C:\\CodeModeQA\\cowork_server-1.0-py3-none-any.whl');
    expect(spec.startsWith('cowork-server[code] @ file://')).toBe(true);
    expect(spec).toContain('cowork_server-1.0-py3-none-any.whl');
    expect(spec).not.toContain('\\');
  });

  it('leaves a spec that already names extras alone', () => {
    expect(withCodeExtra('cowork-server[code]==1.0')).toBe('cowork-server[code]==1.0');
    expect(withCodeExtra('cowork-server[channels,code] @ git+https://x/y.git')).toBe('cowork-server[channels,code] @ git+https://x/y.git');
  });
});


describe('codeRuntimeInstalledIn', () => {
  const dirs: string[] = [];
  afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

  it('sees the Codex dist-info and nothing else', () => {
    const sp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-'));
    dirs.push(sp);
    fs.mkdirSync(path.join(sp, 'cowork_server-0.26.9.dist-info'));
    expect(codeRuntimeInstalledIn(sp)).toBe(false);
    fs.mkdirSync(path.join(sp, 'openai_codex-0.147.0.dist-info'));
    expect(codeRuntimeInstalledIn(sp)).toBe(true);
    expect(codeRuntimeInstalledIn(null)).toBe(false);
    expect(codeRuntimeInstalledIn(path.join(sp, 'missing'))).toBe(false);
  });
});


describe('setup plan', () => {
  it('shows a Git step only when Git is missing, then components, restart and check', () => {
    expect(codeSetupSteps(false).map((step) => step.id)).toEqual(['components', 'restart', 'verify']);
    expect(codeSetupSteps(true).map((step) => step.id)).toEqual(['git', 'components', 'restart', 'verify']);
  });

  it('routes a missing Git to the platform installer', () => {
    expect(gitInstallRoute('darwin')).toBe('xcode');
    expect(gitInstallRoute('win32')).toBe('winget');
    expect(gitInstallRoute('linux')).toBe('manual');
  });
});
