import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { uiServerCompatSkipReason } from './update-logic';

// The OTA manifest's server floor comes only from package.json: publish-ui.yml
// reads it with the exact `node -p` expression below, and no caller passes the
// dispatch override. An empty floor lets a UI bundle activate on a server that
// predates the routes it calls; turn deletes then answer 422.

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// The newest server route this renderer depends on: turn deletes keyed by
// message id, first released in this cowork-server version.
const TURN_DELETE_BY_ID_SERVER = '0.26.9.27.1';
const LAST_SERVER_WITHOUT_IT = '0.26.9.25.1';

/** The floor exactly as the publish workflow reads it. */
function publishedFloor(): string {
  return execFileSync(
    process.execPath,
    ['-p', "require('./package.json').minServerVersion || ''"],
    { cwd: REPO, encoding: 'utf8' },
  ).trim();
}

describe('the OTA server floor published with the UI bundle', () => {
  it('is declared and interpretable', () => {
    const floor = publishedFloor();
    expect(floor).not.toBe('');
    expect(uiServerCompatSkipReason({ minServerVersion: floor, serverVersion: floor })).toBeNull();
  });

  it('withholds the bundle from a server without turn deletes by message id', () => {
    expect(uiServerCompatSkipReason({
      minServerVersion: publishedFloor(),
      serverVersion: LAST_SERVER_WITHOUT_IT,
    })).not.toBeNull();
  });

  it('lets the first server with turn deletes by message id take the bundle', () => {
    expect(uiServerCompatSkipReason({
      minServerVersion: publishedFloor(),
      serverVersion: TURN_DELETE_BY_ID_SERVER,
    })).toBeNull();
  });
});
