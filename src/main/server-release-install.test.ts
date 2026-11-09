import { describe, it, expect, vi, afterEach, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as tls from 'tls';

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-user-data-'));
afterAll(() => fs.rmSync(userData, { recursive: true, force: true }));
vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => process.cwd(), getPath: () => userData } }));
vi.mock('./uv-paths', () => ({ PYTHON_RANGE: '>=3.12,<3.14' }));
import { app } from 'electron';
import { lockedServerInstallArgs } from './server-release-install';

const resourcesPath = process.resourcesPath;
const platform = process.platform;
afterEach(() => {
  vi.unstubAllEnvs();
  Object.defineProperty(process, 'resourcesPath', { value: resourcesPath, configurable: true });
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  Object.defineProperty(app, 'isPackaged', { value: false, configurable: true });
});

describe('release contract command', () => {
  it('runs the real consumer with managed Python and preserves install and rollback arguments', () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    const install = ['tool', 'install', '--force', 'cowork-server==1.2.3', '--python', '>=3.12,<3.14'];
    const args = lockedServerInstallArgs('/tools/uv', install);
    const script = path.join(process.cwd(), 'scripts', 'install_release_server.py');
    expect(fs.existsSync(script)).toBe(true);
    expect(args).toEqual(['run', '--no-project', '--no-config', '--python', '>=3.12,<3.14', script, '--uv', '/tools/uv', '--', ...install]);
  });

  it('hands the consumer the runtime public roots on Windows only', () => {
    const install = ['tool', 'install', 'cowork-server==1.2.3'];
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    const args = lockedServerInstallArgs('uv', install);
    const flag = args.indexOf('--ca-file');
    expect(flag).toBeGreaterThan(-1);
    expect(flag).toBeLessThan(args.indexOf('--'));
    const file = args[flag + 1];
    expect(fs.readFileSync(file, 'utf8')).toBe(tls.rootCertificates.join('\n') + '\n');
    // One file in the app's own folder, reused by every install, never one per run in the temp folder.
    expect(file).toBe(path.join(userData, 'public-roots.pem'));
    expect(lockedServerInstallArgs('uv', install)[flag + 1]).toBe(file);
    for (const other of ['darwin', 'linux']) {
      Object.defineProperty(process, 'platform', { value: other, configurable: true });
      expect(lockedServerInstallArgs('uv', install)).not.toContain('--ca-file');
    }
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
