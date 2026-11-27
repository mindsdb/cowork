/* Entry point: the app itself (`app.ts`), or a one-shot headless HTML lint.
 *
 * First, a packaged build deletes SSLKEYLOGFILE from its environment, before
 * Chromium starts the network service, and refuses a launch whose switches
 * would hand the app or its traffic to whoever started it (launch-guard.ts).
 * Both run before `ready`, before any window exists, and before either branch
 * below loads a module.
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
import { deniedLaunchSwitch, isPackagedRun, scrubLaunchEnv } from './launch-guard';

const packaged = isPackagedRun({ isPackaged: app.isPackaged, defaultApp: process.defaultApp });
scrubLaunchEnv(process.env, packaged);
const deniedSwitch = deniedLaunchSwitch({
  packaged,
  hasSwitch: (name) => app.commandLine.hasSwitch(name),
  inspectorActive: inspector.url() !== undefined,
});

if (deniedSwitch) {
  process.stderr.write(`launch-guard: a packaged build does not start with --${deniedSwitch}\n`);
  app.exit(1);
} else if (process.env.ANTON_HTML_LINT_TARGET) {
  (require('./html-lint-host') as typeof import('./html-lint-host')).runHtmlLint({ packaged });
} else {
  require('./app');
}
