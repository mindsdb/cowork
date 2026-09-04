import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// The claim is written whole and then linked into place, which is what stops a
// torn write leaving a state that can never be repaired. Some filesystems
// cannot hard-link at all (exFAT, certain Windows policies), and there the
// atomic path has to degrade rather than lock the install out: without a
// fallback, every claim AND every adopt fails forever and the install can never
// reach its own history.
//
// fs exports are non-configurable ESM bindings, so this needs a module mock and
// therefore its own file.
const control = { failLink: false };
vi.mock('fs', async (importActual) => {
  const actual = await importActual<typeof import('fs')>();
  return {
    ...actual,
    default: actual,
    linkSync: (from: string, to: string) => {
      if (control.failLink) {
        const err = new Error('EPERM: hard links unsupported') as NodeJS.ErrnoException;
        err.code = 'EPERM';
        throw err;
      }
      return actual.linkSync(from, to);
    },
  };
});

import { claimDefaultRoot, observePreExistingData, readAccountClaim } from './account-data';

const A = '11111111-1111-4111-8111-111111111111';
let home: string;

beforeEach(() => {
  control.failLink = false;
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-link-'));
  observePreExistingData(home);
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

describe('claiming where hard links are unavailable', () => {
  it('still claims the root', () => {
    control.failLink = true;
    expect(claimDefaultRoot(home, A)).toEqual({ kind: 'claimed', accountId: A });
    expect(readAccountClaim(home)).toEqual({ kind: 'claimed', accountId: A });
  });

  it('still refuses to overwrite an existing claim', () => {
    // The fallback keeps exclusive-create semantics, so the race guarantee
    // survives losing the atomic path.
    claimDefaultRoot(home, A);
    control.failLink = true;
    const other = '22222222-2222-4222-8222-222222222222';
    expect(claimDefaultRoot(home, other)).toEqual({ kind: 'claimed', accountId: A });
  });

  it('leaves no temp file behind', () => {
    control.failLink = true;
    claimDefaultRoot(home, A);
    expect(fs.readdirSync(home).filter((n) => n.startsWith('.account.tmp-'))).toEqual([]);
  });
});
