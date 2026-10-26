import { app } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as tls from 'tls';
import { PYTHON_RANGE } from './uv-paths';

/** Python on Windows trusts only the roots Windows has already downloaded, and
 *  Windows downloads a missing one only when a program verifies through
 *  Windows, so a fresh machine can't verify PyPI. The installer adds these
 *  public roots, bundled with Electron's Node, beside the Windows stores. */
function publicRootsFile(): string {
  const file = path.join(os.tmpdir(), `cowork-public-roots-${process.pid}.pem`);
  fs.writeFileSync(file, tls.rootCertificates.join('\n') + '\n', 'utf8');
  return file;
}

/** The same release-contract consumer wraps fresh installs, repairs and rollback. */
export function lockedServerInstallArgs(uv: string, installArgs: string[]): string[] {
  // A developer's explicit custom source remains an opt-out from release installs.
  if (process.env.COWORK_SERVER_PACKAGE) return installArgs;
  const script = app.isPackaged
    ? path.join(process.resourcesPath, 'install_release_server.py')
    : path.join(app.getAppPath(), 'scripts', 'install_release_server.py');
  const trust = process.platform === 'win32' ? ['--ca-file', publicRootsFile()] : [];
  return [
    'run', '--no-project', '--no-config', '--python', PYTHON_RANGE,
    script, '--uv', uv, ...trust, '--', ...installArgs,
  ];
}
