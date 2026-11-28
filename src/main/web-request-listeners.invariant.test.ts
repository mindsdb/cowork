import { readdirSync, readFileSync } from 'fs';
import path from 'path';
import type { WebRequest } from 'electron';
import { describe, expect, it } from 'vitest';

/*
 * Electron keeps only the last listener registered for each webRequest event
 * (docs/api/web-request.md: "Only the last attached listener will be used").
 * A second registration of the same kind anywhere in the main process quietly
 * replaces the first, and with it the server token listener app.ts registers
 * (server-token-listener.ts) and the rules inside it. This counts the
 * registrations in the main-process sources and fails on a second one of any
 * kind.
 *
 * The lint runner (html-lint-runner.ts) is counted on its own. Its listeners
 * sit on a session only its window uses (LINT_PARTITION), in a process that
 * took index.ts's lint branch and so never loads app.ts. That holds while only
 * the lint host imports the runner and only index.ts loads the host, which
 * this checks too.
 */

const REPO = path.resolve(__dirname, '../..');
const SOURCE_DIRS = ['src/main', 'src/shared'];

/* Every webRequest event. Typed against Electron's WebRequest, so a missing or
   unknown event name fails the typecheck. */
const WEB_REQUEST_EVENTS = Object.keys({
  onBeforeRequest: true, onBeforeSendHeaders: true, onSendHeaders: true, onHeadersReceived: true,
  onResponseStarted: true, onBeforeRedirect: true, onCompleted: true, onErrorOccurred: true,
} satisfies Record<keyof WebRequest, true>);

function sourceFiles(dir: string): string[] {
  return readdirSync(path.join(REPO, dir), { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(relative);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [relative] : [];
  });
}

/* Every `<label>:<line>` in this text that names the event as a member or a
   quoted string: a call, a .call or .bind, a bracket key and a line split all
   do. The line is where the match starts. */
function registrationsIn(label: string, text: string, event: string): string[] {
  const named = new RegExp(`(?:\\.\\s*|\\[\\s*['"\`])${event}\\b|['"\`]${event}['"\`]`, 'g');
  return [...text.matchAll(named)].map((match) => `${label}:${text.slice(0, match.index).split('\n').length}`);
}

const LINT_RUNNER = 'src/main/html-lint-runner.ts';

function mainSources(): string[] {
  return SOURCE_DIRS.flatMap(sourceFiles).map((file) => file.split(path.sep).join('/'));
}

function appSources(): string[] {
  return mainSources().filter((file) => file !== LINT_RUNNER);
}

function registrations(event: string, files: string[]): string[] {
  return files.flatMap((file) => registrationsIn(file, readFileSync(path.join(REPO, file), 'utf-8'), event));
}

/* A quoted relative path to `<module>` from any folder, as an import, a
   require or a type import names it: './<module>', '../main/<module>' and the
   like, with or without a .ts or .js extension. `module` holds no regular
   expression characters. */
function importPattern(module: string): RegExp {
  return new RegExp(`['"\`]\\.{1,2}/(?:[^'"\`\\n]*/)?${module}(?:\\.[jt]s)?['"\`]`);
}

/* The sources that name `<module>` by a relative path. */
function importersOf(module: string): string[] {
  const named = importPattern(module);
  return mainSources().filter((file) => named.test(readFileSync(path.join(REPO, file), 'utf-8')));
}

describe('webRequest listeners', () => {
  it('finds the server token listener in app.ts', () => {
    expect(registrations('onBeforeSendHeaders', appSources())).toEqual([expect.stringMatching(/^src\/main\/app\.ts:\d+$/)]);
  });

  it('sees a second registration, however it is reached', () => {
    const second = 'session.webRequest.onBeforeSendHeaders(filter, a);\nconst { webRequest } = session;\nwebRequest\n  .onBeforeSendHeaders(b);';
    expect(registrationsIn('sample.ts', second, 'onBeforeSendHeaders')).toEqual(['sample.ts:1', 'sample.ts:4']);
  });

  it('sees a second registration in any call form', () => {
    const forms = "webRequest['onBeforeSendHeaders'](a);\nwebRequest.onBeforeSendHeaders.call(webRequest, a);\nconst register = webRequest.onBeforeSendHeaders.bind(webRequest);\nwebRequest.\n  onBeforeSendHeaders(a);";
    expect(registrationsIn('sample.ts', forms, 'onBeforeSendHeaders')).toEqual(['sample.ts:1', 'sample.ts:2', 'sample.ts:3', 'sample.ts:4']);
  });

  it.each(WEB_REQUEST_EVENTS)('registers at most one %s listener on the app\'s sessions', (event) => {
    expect(registrations(event, appSources()).slice(1)).toEqual([]);
  });

  it.each(WEB_REQUEST_EVENTS)('registers at most one %s listener in the lint runner', (event) => {
    expect(registrations(event, [LINT_RUNNER]).slice(1)).toEqual([]);
  });

  it('sees an import of a module by a relative path from any folder', () => {
    const named = importPattern('html-lint-runner');
    const imports = [
      "import { startHtmlLintRunner } from './html-lint-runner';",
      "const runner = require('../main/html-lint-runner');",
      'type Runner = typeof import(`../../src/main/html-lint-runner.js`);',
    ];
    const others = ["import './html-lint-runner-extra';", "require('../main/not-html-lint-runner');", "import 'html-lint-runner';"];

    expect(imports.filter((line) => !named.test(line))).toEqual([]);
    expect(others.filter((line) => named.test(line))).toEqual([]);
  });

  it('loads the lint runner only in lint mode, on a session of its own', () => {
    expect(importersOf('html-lint-runner')).toEqual(['src/main/html-lint-host.ts']);
    expect(importersOf('html-lint-host')).toEqual(['src/main/index.ts']);
    expect(readFileSync(path.join(REPO, LINT_RUNNER), 'utf-8')).toContain('partition: LINT_PARTITION');
  });
});
