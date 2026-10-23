import { app } from 'electron';
import * as path from 'path';
import { PYTHON_RANGE } from './uv-paths';

/** The same release-contract consumer wraps fresh installs, repairs and rollback. */
export function lockedServerInstallArgs(uv: string, installArgs: string[]): string[] {
  // A developer's explicit custom source remains an opt-out from release installs.
  if (process.env.COWORK_SERVER_PACKAGE) return installArgs;
  const script = app.isPackaged
    ? path.join(process.resourcesPath, 'install_release_server.py')
    : path.join(app.getAppPath(), 'scripts', 'install_release_server.py');
  return [
    'run', '--no-project', '--no-config', '--python', PYTHON_RANGE,
    script, '--uv', uv, '--', ...installArgs,
  ];
}
