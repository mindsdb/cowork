import { readdirSync, readFileSync } from 'fs';
import path from 'path';
import type { WebRequest } from 'electron';
import { describe, expect, it } from 'vitest';

/*
 * Electron keeps only the last listener registered for each webRequest event
 * (docs/api/web-request.md: "Only the last attached listener will be used").
 * A second registration of the same kind anywhere in the main process quietly
 * replaces the first, and with it the server token listener in app.ts and the
 * rules inside it. This counts the registrations in the main-process sources
 * and fails on a second one of any kind.
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

/* Every `<label>:<line>` in this text that registers a listener for the event. */
function registrationsIn(label: string, text: string, event: string): string[] {
  const call = new RegExp(`\\.${event}\\s*\\(`);
  return text.split('\n').flatMap((line, index) => (call.test(line) ? [`${label}:${index + 1}`] : []));
}

function registrations(event: string): string[] {
  return SOURCE_DIRS.flatMap(sourceFiles).flatMap((file) =>
    registrationsIn(file.split(path.sep).join('/'), readFileSync(path.join(REPO, file), 'utf-8'), event));
}

describe('webRequest listeners', () => {
  it('finds the server token listener in app.ts', () => {
    expect(registrations('onBeforeSendHeaders')).toEqual([expect.stringMatching(/^src\/main\/app\.ts:\d+$/)]);
  });

  it('sees a second registration, however it is reached', () => {
    const second = 'session.webRequest.onBeforeSendHeaders(filter, a);\nconst { webRequest } = session;\nwebRequest\n  .onBeforeSendHeaders(b);';
    expect(registrationsIn('sample.ts', second, 'onBeforeSendHeaders')).toEqual(['sample.ts:1', 'sample.ts:4']);
  });

  it.each(WEB_REQUEST_EVENTS)('registers at most one %s listener', (event) => {
    expect(registrations(event).slice(1)).toEqual([]);
  });
});
