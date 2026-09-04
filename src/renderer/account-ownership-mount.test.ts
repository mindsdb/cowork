import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Where the ownership dialog is MOUNTED is the whole of its correctness, and it
// is not something a render test catches: an account resolved onto its own empty
// data root has no credentials there, so `config_ready` is false and boot routes
// to 'auth'. Mounted inside CoworkApp — which renders only on 'terminal' — the
// dialog is unreachable in exactly the state that raises it, and the person is
// stuck on the sign-in screen with their history apparently gone.
//
// A mechanical source check, in the same spirit as check:cowork-purity: it pins
// a placement invariant that no unit test can express.
const read = (relative: string) =>
  fs.readFileSync(path.join(__dirname, relative), 'utf-8');

describe('the account ownership dialog', () => {
  it('is mounted by the shell, which renders on every page', () => {
    expect(read('App.tsx')).toContain('AccountOwnershipModal');
  });

  it('is NOT mounted by the chat app, which renders only on the terminal page', () => {
    expect(read('cowork/App.jsx')).not.toContain('AccountOwnershipModal');
  });

  // Deliberately not asserted here: that the mount sits outside every
  // `page === ...` branch. Any textual test of that is a heuristic dressed up as
  // a guarantee. The paired manual check covers it directly, by upgrading a
  // signed-in install and confirming the person is asked rather than left on
  // the sign-in screen.
});
