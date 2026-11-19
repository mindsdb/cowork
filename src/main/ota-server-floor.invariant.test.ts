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

// A route the renderer depends on, turn deletes keyed by message id, first
// released in this cowork-server version. The floor may sit higher, never lower.
const TURN_DELETE_BY_ID_SERVER = '0.26.9.27.1';
const JUST_BELOW_IT = '0.26.9.27.0';

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

  it(`is at least ${TURN_DELETE_BY_ID_SERVER}, so a server without turn deletes by message id never gets the bundle`, () => {
    expect(uiServerCompatSkipReason({
      minServerVersion: publishedFloor(),
      serverVersion: JUST_BELOW_IT,
    })).not.toBeNull();
  });
});
