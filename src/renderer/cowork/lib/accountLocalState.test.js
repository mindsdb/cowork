import { describe, it, expect, beforeEach } from 'vitest';

// localStorage survives the sidecar restart and the renderer reload, so this is
// the last place the previous account's data can still reach the screen after a
// switch. The cases that matter are: a real switch purges, a same-account boot
// does not, and unrelated keys are never touched.
import { purgeStaleAccountState } from './accountLocalState';

const ACCOUNT_A = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_B = '22222222-2222-4222-8222-222222222222';

// One key per prefix the module claims to own, including the epoch-suffixed
// forms the draft and settings caches actually write.
const ACCOUNT_KEYS = {
  'anton:conv-turns:conv-1': '[{"step":"one"}]',
  'anton:conv-turns:conv-2': '[{"step":"two"}]',
  'anton:conv-artifacts:conv-1': '[]',
  'anton.composerDrafts': '{"v":1}',
  'anton.composerDrafts:organization:abc': '{"v":1}',
  'anton.settingsCache:organization:abc': '{"v":1}',
  'anton:pinned-projects': '["p1"]',
  'mindshub-code:last-project': 'proj-9',
};

const UNRELATED_KEYS = {
  'anton.theme': 'dark',
  'anton.organizationTransition': '{"version":1}',
  'some.other.app': 'keep me',
};

function seed() {
  for (const [k, v] of Object.entries({ ...ACCOUNT_KEYS, ...UNRELATED_KEYS })) {
    localStorage.setItem(k, v);
  }
}

beforeEach(() => {
  localStorage.clear();
});

describe('purgeStaleAccountState', () => {
  it('purges nothing on the first boot, because nothing is stale yet', () => {
    seed();
    expect(purgeStaleAccountState(ACCOUNT_A)).toBe(false);
    for (const key of Object.keys(ACCOUNT_KEYS)) {
      expect(localStorage.getItem(key)).not.toBeNull();
    }
  });

  it('purges every account-scoped key when the account changes', () => {
    purgeStaleAccountState(ACCOUNT_A);
    seed();

    expect(purgeStaleAccountState(ACCOUNT_B)).toBe(true);

    for (const key of Object.keys(ACCOUNT_KEYS)) {
      expect(localStorage.getItem(key)).toBeNull();
    }
  });

  it('leaves unrelated keys alone', () => {
    purgeStaleAccountState(ACCOUNT_A);
    seed();
    purgeStaleAccountState(ACCOUNT_B);

    for (const [key, value] of Object.entries(UNRELATED_KEYS)) {
      expect(localStorage.getItem(key)).toBe(value);
    }
  });

  it('does nothing when the same account boots again', () => {
    purgeStaleAccountState(ACCOUNT_A);
    seed();
    expect(purgeStaleAccountState(ACCOUNT_A)).toBe(false);
    expect(localStorage.getItem('anton:conv-turns:conv-1')).not.toBeNull();
  });

  it('leaves a signed-out boot untouched', () => {
    purgeStaleAccountState(ACCOUNT_A);
    seed();
    // The same account usually signs back in, and sign-out already removed the
    // credentials this state is useless without.
    expect(purgeStaleAccountState(null)).toBe(false);
    expect(localStorage.getItem('anton:conv-turns:conv-1')).not.toBeNull();
  });

  it('purges after a sign-out followed by a different account signing in', () => {
    purgeStaleAccountState(ACCOUNT_A);
    seed();
    purgeStaleAccountState(null);

    expect(purgeStaleAccountState(ACCOUNT_B)).toBe(true);
    expect(localStorage.getItem('anton:conv-turns:conv-1')).toBeNull();
  });

  it('removes every conversation entry, not just the first', () => {
    purgeStaleAccountState(ACCOUNT_A);
    for (let i = 0; i < 12; i += 1) {
      localStorage.setItem(`anton:conv-turns:conv-${i}`, '[]');
    }
    purgeStaleAccountState(ACCOUNT_B);
    const left = Object.keys(localStorage).filter((k) => k.startsWith('anton:conv-turns:'));
    expect(left).toEqual([]);
  });
});
