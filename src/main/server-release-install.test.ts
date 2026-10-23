import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => process.cwd() } }));
vi.mock('./uv-paths', () => ({ PYTHON_RANGE: '>=3.12,<3.14' }));
import { app } from 'electron';
import { lockedServerInstallArgs } from './server-release-install';

const resourcesPath = process.resourcesPath;
afterEach(() => {
  vi.unstubAllEnvs();
  Object.defineProperty(process, 'resourcesPath', { value: resourcesPath, configurable: true });
  Object.defineProperty(app, 'isPackaged', { value: false, configurable: true });
});

describe('release contract command', () => {
  it('runs the real consumer with managed Python and preserves install and rollback arguments', () => {
    const install = ['tool', 'install', '--force', 'cowork-server==1.2.3', '--python', '>=3.12,<3.14'];
    const args = lockedServerInstallArgs('/tools/uv', install);
    const script = path.join(process.cwd(), 'scripts', 'install_release_server.py');
    expect(fs.existsSync(script)).toBe(true);
    expect(args).toEqual(['run', '--no-project', '--no-config', '--python', '>=3.12,<3.14', script, '--uv', '/tools/uv', '--', ...install]);
  });

  it('preserves an explicit custom development source', () => {
    vi.stubEnv('COWORK_SERVER_PACKAGE', '/development/cowork-server');
    const args = ['tool', 'install', '/development/cowork-server'];
    expect(lockedServerInstallArgs('uv', args)).toBe(args);
  });

  it('uses the consumer bundled in the signed application resources', () => {
    Object.defineProperty(process, 'resourcesPath', { value: '/packaged/resources', configurable: true });
    Object.defineProperty(app, 'isPackaged', { value: true, configurable: true });
    expect(lockedServerInstallArgs('uv', ['tool', 'install', 'cowork-server==1.2.3'])).toContain(path.join('/packaged/resources', 'install_release_server.py'));
    const config = fs.readFileSync('electron-builder.yml', 'utf8');
    expect(config).toContain('from: scripts/install_release_server.py\n    to: install_release_server.py');
  });
});
