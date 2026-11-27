/* Entry point: the app itself (`app.ts`), or a one-shot headless HTML lint.
 *
 * First, a packaged build deletes SSLKEYLOGFILE and NODE_TLS_REJECT_UNAUTHORIZED
 * from its environment, before Chromium starts the network service, and
 * refuses a launch whose switches, `--enable-features` value or
 * NODE_USE_ENV_PROXY would hand the app or its traffic to whoever started it
 * (launch-guard.ts). Both run before `ready`, before any window
 * exists, and before either branch below loads a module. A refused launch
 * writes a line that names the reason to stderr and a diagnostic event. A
 * launch from the Finder, the Dock or a desktop shortcut sends stderr nowhere
 * a user can find it, so the refusal also appends the diagnostic's fields as
 * one JSON line to launch-guard.log in the app's logs folder. Then it exits
 * with status 1. It shows no dialog, because a dialog waits for a click and
 * would leave a scripted launch hanging instead of exiting.
 *
 * A packaged binary always loads its own resources/app.asar and ignores a
 * script passed as an argument, so anton's artifact checker cannot
 * re-invoke this binary with its own runner the way a bare `electron` allows.
 * It asks for lint mode through the environment instead, and the branch has to
 * happen here, before a single one of the app's modules is loaded:
 * - `require`, not `import`: an `import` would load `app.ts` in lint mode too;
 * - a separate file, because a top-level `return` isn't allowed in a module. */
import { app } from 'electron';
import * as inspector from 'node:inspector';
import { diagnostic } from '../shared/diagnostics';
import {
  appendLaunchRefusalLog,
  isPackagedRun,
  LAUNCH_GUARD_LOGGER,
  launchRefusal,
  launchRefusalReport,
  scrubLaunchEnv,
} from './launch-guard';

const packaged = isPackagedRun({ isPackaged: app.isPackaged, defaultApp: process.defaultApp });
scrubLaunchEnv(process.env, packaged);
const refusal = launchRefusal({
  packaged,
  hasSwitch: (name) => app.commandLine.hasSwitch(name),
  getSwitchValue: (name) => app.commandLine.getSwitchValue(name),
  inspectorActive: inspector.url() !== undefined,
  nodeUseEnvProxy: process.env.NODE_USE_ENV_PROXY,
});

if (refusal) {
  const report = launchRefusalReport(refusal);
  process.stderr.write(report.stderrLine);
  diagnostic(LAUNCH_GUARD_LOGGER, 'ERROR', report.event);
  appendLaunchRefusalLog(() => app.getPath('logs'), report.event);
  app.exit(1);
} else if (process.env.ANTON_HTML_LINT_TARGET) {
  (require('./html-lint-host') as typeof import('./html-lint-host')).runHtmlLint({ packaged });
} else {
  require('./app');
}
