import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// localStorage survives the sidecar restart and the renderer reload, so this is
// the last place the previous account's data can still reach the screen after a
// switch. The cases that matter are: a real switch purges, a same-account boot
// does not, and unrelated keys are never touched.
import {
  legacyVerdictForSession,
  purgeOrganizationScopedState,
  purgeStaleAccountState,
  shouldReloadForAccountChange,
} from './accountLocalState';

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
  'mindshub-code-terminal:session-1': 'term-a',
  'mindshub-code-terminal:session-2': 'term-b',
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
  it('keeps an unmarked cache for the account that owns the default root', () => {
    // The default verdict. This account's own state from before per-account
    // roots existed, so purging it would destroy the history of the only person
    // who has ever used the install.
    seed();
    expect(purgeStaleAccountState(ACCOUNT_A, 'keep')).toBe(false);
    for (const key of Object.keys(ACCOUNT_KEYS)) {
      expect(localStorage.getItem(key)).not.toBeNull();
    }
  });

  it('purges every account-scoped key when the account changes', () => {
    purgeStaleAccountState(ACCOUNT_A, 'keep');
    seed();

    expect(purgeStaleAccountState(ACCOUNT_B, 'keep')).toBe(true);

    for (const key of Object.keys(ACCOUNT_KEYS)) {
      expect(localStorage.getItem(key)).toBeNull();
    }
  });

  it('leaves unrelated keys alone', () => {
    purgeStaleAccountState(ACCOUNT_A, 'keep');
    seed();
    purgeStaleAccountState(ACCOUNT_B, 'keep');

    for (const [key, value] of Object.entries(UNRELATED_KEYS)) {
      expect(localStorage.getItem(key)).toBe(value);
    }
  });

  it('does nothing when the same account boots again', () => {
    purgeStaleAccountState(ACCOUNT_A, 'keep');
    seed();
    expect(purgeStaleAccountState(ACCOUNT_A, 'keep')).toBe(false);
    expect(localStorage.getItem('anton:conv-turns:conv-1')).not.toBeNull();
  });

  it('leaves a signed-out boot untouched', () => {
    purgeStaleAccountState(ACCOUNT_A, 'keep');
    seed();
    // The same account usually signs back in, and sign-out already removed the
    // credentials this state is useless without.
    expect(purgeStaleAccountState(null, 'keep')).toBe(false);
    expect(localStorage.getItem('anton:conv-turns:conv-1')).not.toBeNull();
  });

  it('purges after a sign-out followed by a different account signing in', () => {
    purgeStaleAccountState(ACCOUNT_A, 'keep');
    seed();
    purgeStaleAccountState(null, 'keep');

    expect(purgeStaleAccountState(ACCOUNT_B, 'keep')).toBe(true);
    expect(localStorage.getItem('anton:conv-turns:conv-1')).toBeNull();
  });

  it('removes every conversation entry, not just the first', () => {
    purgeStaleAccountState(ACCOUNT_A, 'keep');
    for (let i = 0; i < 12; i += 1) {
      localStorage.setItem(`anton:conv-turns:conv-${i}`, '[]');
    }
    purgeStaleAccountState(ACCOUNT_B, 'keep');
    const left = Object.keys(localStorage).filter((k) => k.startsWith('anton:conv-turns:'));
    expect(left).toEqual([]);
  });
});

// An unmarked cache predates per-account roots, so it belongs to whoever owns
// the default data root. Only main can tell whether that is us, which is why
// the verdict is an argument rather than something decided here.
describe('an unmarked legacy cache', () => {
  it('is purged for an account resolved onto its own root', () => {
    // The upgrade path of the reported bug, in localStorage rather than the
    // database: B signs in first on an install whose history is A's. Without
    // this, B reads A's drafts and conversation payloads, and stamping B's name
    // on them would make them B's forever.
    seed();

    expect(purgeStaleAccountState(ACCOUNT_B, 'purge')).toBe(true);

    for (const key of Object.keys(ACCOUNT_KEYS)) {
      expect(localStorage.getItem(key)).toBeNull();
    }
    for (const key of Object.keys(UNRELATED_KEYS)) {
      expect(localStorage.getItem(key)).not.toBeNull();
    }
  });

  it('is left alone, and unstamped, while the ownership question is open', () => {
    seed();

    expect(purgeStaleAccountState(ACCOUNT_A, 'undecided')).toBe(false);

    // Nothing removed AND nothing recorded: stamping here is what would make
    // the answer unenforceable, because the reload after it would read the
    // cache as already belonging to this account.
    for (const key of Object.keys(ACCOUNT_KEYS)) {
      expect(localStorage.getItem(key)).not.toBeNull();
    }
    expect(localStorage.getItem('anton.lastAccount')).toBeNull();
  });

  it('is purged on the reload after the person answers "start fresh"', () => {
    // The two calls are two document loads: the one with the dialog up, then
    // the reload the answer triggers, by which time this account is resolved
    // onto its own root.
    seed();
    purgeStaleAccountState(ACCOUNT_A, 'undecided');

    expect(purgeStaleAccountState(ACCOUNT_A, 'purge')).toBe(true);

    for (const key of Object.keys(ACCOUNT_KEYS)) {
      expect(localStorage.getItem(key)).toBeNull();
    }
  });

  it('survives the reload after the person adopts the data', () => {
    seed();
    purgeStaleAccountState(ACCOUNT_A, 'undecided');

    expect(purgeStaleAccountState(ACCOUNT_A, 'keep')).toBe(false);

    for (const key of Object.keys(ACCOUNT_KEYS)) {
      expect(localStorage.getItem(key)).not.toBeNull();
    }
    expect(localStorage.getItem('anton.lastAccount')).toBe(ACCOUNT_A);
  });

  it('still purges a MARKED cache from another account, whatever the verdict', () => {
    // The verdict only governs unmarked state. A marked cache names its owner,
    // so a mismatch needs no ruling from main.
    purgeStaleAccountState(ACCOUNT_A, 'keep');
    seed();

    expect(purgeStaleAccountState(ACCOUNT_B, 'keep')).toBe(true);

    for (const key of Object.keys(ACCOUNT_KEYS)) {
      expect(localStorage.getItem(key)).toBeNull();
    }
  });
});

// One account works in several organizations, and a switch changes the working
// context as completely as a sign-in does. The sidecar moves to another
// database; without this, localStorage repaints the previous organization's
// drafts and caches over the new one's empty stores.
describe('purgeOrganizationScopedState', () => {
  beforeEach(() => localStorage.clear());

  it('drops the previous organization\'s state and records the new one', () => {
    localStorage.setItem('anton.lastOrganization', 'org-a');
    localStorage.setItem('anton:conv-turns:c1', '[]');
    localStorage.setItem('anton.composerDrafts', '{"new":"draft"}');

    expect(purgeOrganizationScopedState('org-b')).toBe(true);

    expect(localStorage.getItem('anton:conv-turns:c1')).toBeNull();
    expect(localStorage.getItem('anton.composerDrafts')).toBeNull();
    expect(localStorage.getItem('anton.lastOrganization')).toBe('org-b');
  });

  it('keeps state when the organization has not changed', () => {
    localStorage.setItem('anton.lastOrganization', 'org-a');
    localStorage.setItem('anton:conv-turns:c1', '[]');

    expect(purgeOrganizationScopedState('org-a')).toBe(false);

    expect(localStorage.getItem('anton:conv-turns:c1')).toBe('[]');
  });

  it('records an unmarked origin without purging it at boot', () => {
    // Nothing here has been attributed to an organization yet, so it belongs to
    // this one. Purging would throw away an existing install's own drafts on
    // the first launch after the upgrade.
    localStorage.setItem('anton:conv-turns:c1', '[]');

    expect(purgeOrganizationScopedState('org-a')).toBe(false);

    expect(localStorage.getItem('anton:conv-turns:c1')).toBe('[]');
    expect(localStorage.getItem('anton.lastOrganization')).toBe('org-a');
  });

  it('purges an unmarked origin on an explicit switch', () => {
    // Boot runs before the asynchronous refresh writes the organization
    // record, so it is handed null and stamps nothing. A switch in that same
    // launch would otherwise keep every cache and stamp it as the target's,
    // and the reload after it would read that marker as correct — the source
    // organization's chats and drafts surfacing under the target.
    localStorage.setItem('anton:conv-turns:c1', '[]');
    localStorage.setItem('anton.composerDrafts', '{"new":"draft"}');

    expect(purgeOrganizationScopedState('org-b', 'purge')).toBe(true);

    expect(localStorage.getItem('anton:conv-turns:c1')).toBeNull();
    expect(localStorage.getItem('anton.composerDrafts')).toBeNull();
    expect(localStorage.getItem('anton.lastOrganization')).toBe('org-b');
  });

  it('still does nothing on a switch back to the organization already marked', () => {
    localStorage.setItem('anton.lastOrganization', 'org-a');
    localStorage.setItem('anton:conv-turns:c1', '[]');

    expect(purgeOrganizationScopedState('org-a', 'purge')).toBe(false);

    expect(localStorage.getItem('anton:conv-turns:c1')).toBe('[]');
  });

  it('leaves everything alone when there is no organization to attribute to', () => {
    localStorage.setItem('anton.lastOrganization', 'org-a');
    localStorage.setItem('anton:conv-turns:c1', '[]');

    expect(purgeOrganizationScopedState(null)).toBe(false);

    expect(localStorage.getItem('anton:conv-turns:c1')).toBe('[]');
    expect(localStorage.getItem('anton.lastOrganization')).toBe('org-a');
  });

  it('leaves keys that belong to neither context', () => {
    localStorage.setItem('anton.lastOrganization', 'org-a');
    localStorage.setItem('anton.theme', 'dark');

    purgeOrganizationScopedState('org-b');

    expect(localStorage.getItem('anton.theme')).toBe('dark');
  });
});

// The chat app purges again once it knows the account, for a switch that
// happens without a document reload. Which verdict that call carries is not
// observable from a unit test of this module and not worth rendering the whole
// chat app for, so it is pinned mechanically, like the dialog's mount point in
// renderer/account-ownership-mount.test.ts.
describe('the chat app purge call', () => {
  it('resolves its verdict rather than passing one straight through', () => {
    // Neither a bare call nor the raw preload snapshot will do. Both end up
    // stamping an unmarked cache with this account's name for a session the
    // shell never ruled on, and a stamped cache reads as this account's own on
    // the reload after the ownership answer, so "start fresh" can never remove
    // the previous person's drafts.
    const source = fs.readFileSync(path.join(__dirname, '..', 'App.jsx'), 'utf-8');
    expect(source).toMatch(
      /purgeStaleAccountState\(\s*(\w+)\s*,\s*legacyVerdictForSession\(\s*\1\s*,/,
    );
  });

  it('reloads the document on an account change rather than only purging', () => {
    // Purging storage cannot finish the job: the composer can already hold the
    // previous account's draft before the identity resolves, and that draft
    // lives in draftStore's module map and in useDraft's state under a home key
    // every account spells the same way. Pinned mechanically for the same
    // reason as the call above: rendering the whole chat app to observe a
    // reload is not worth it, and a bare purge would look identical here.
    const source = fs.readFileSync(path.join(__dirname, '..', 'App.jsx'), 'utf-8');
    expect(source).toMatch(/shouldReloadForAccountChange\([^)]*\)/);
    expect(source).toMatch(/shouldReloadForAccountChange\([\s\S]{0,80}?location\?\.reload\(\)/);
  });

  it('feeds the reload rule the purge result, so a signed-out boot is covered', () => {
    // The account-to-account test cannot see a document that booted signed
    // out: it has rendered for nobody, so only the purge knows the composer
    // was holding someone else's draft. Pinned mechanically alongside the call
    // above, and for the same reason.
    const source = fs.readFileSync(path.join(__dirname, '..', 'App.jsx'), 'utf-8');
    expect(source).toMatch(/const\s+(\w+)\s*=\s*purgedStaleAccount\s*&&\s*!firstPass;/);
    expect(source).toMatch(/shouldReloadForAccountChange\(\s*previous\s*,\s*accountId\s*,\s*\w+\s*\)/);
  });
});

// The shell's snapshot is taken in preload, once per document. Which session it
// is ABOUT is therefore a separate question from what it says.
describe('legacyVerdictForSession', () => {
  const shell = (accountId: string | null, legacyState: 'keep' | 'purge' | 'undecided') =>
    ({ accountId, legacyState });

  it('uses the shell verdict when the snapshot is about this account', () => {
    expect(legacyVerdictForSession(ACCOUNT_A, shell(ACCOUNT_A, 'purge'))).toBe('purge');
    expect(legacyVerdictForSession(ACCOUNT_A, shell(ACCOUNT_A, 'keep'))).toBe('keep');
    expect(legacyVerdictForSession(ACCOUNT_A, shell(ACCOUNT_A, 'undecided'))).toBe('undecided');
  });

  it('defers when the document booted signed out and the account arrived after', () => {
    // The upgrade path the dialog exists for: nothing is marked, the pre-mount
    // purge was a no-op, and the shell's 'keep' is about the signed-out boot.
    // Taking it would stamp this account's name on the previous person's cache
    // before anyone has answered who owns the data.
    expect(legacyVerdictForSession(ACCOUNT_B, shell(null, 'keep'))).toBe('undecided');
  });

  it('defers when the snapshot is about the account being switched away from', () => {
    expect(legacyVerdictForSession(ACCOUNT_B, shell(ACCOUNT_A, 'keep'))).toBe('undecided');
  });

  it('keeps where there is no shell to rule', () => {
    // Web, and an Electron shell older than the bridge field, which a UI bundle
    // can be hot-swapped onto. Deferring there would leave every cache unmarked
    // on the one pairing that has no per-account roots behind it either.
    expect(legacyVerdictForSession(ACCOUNT_A, null)).toBe('keep');
  });
});

describe('an in-document sign-in', () => {
  it('leaves the unmarked cache for the reload to rule on, so the answer still bites', () => {
    // Boot signed out: nothing marked, nothing stamped.
    seed();
    expect(purgeStaleAccountState(null, 'keep')).toBe(false);

    // B signs in without a reload. The shell snapshot still describes the
    // signed-out boot, so this must not stamp.
    const verdict = legacyVerdictForSession(ACCOUNT_B, { accountId: null, legacyState: 'keep' });
    purgeStaleAccountState(ACCOUNT_B, verdict);
    expect(localStorage.getItem('anton.lastAccount')).toBeNull();

    // Reload, dialog, "start fresh": the purge lands because nothing claimed
    // the cache in between.
    expect(purgeStaleAccountState(ACCOUNT_B, 'purge')).toBe(true);
    for (const key of Object.keys(ACCOUNT_KEYS)) {
      expect(localStorage.getItem(key)).toBeNull();
    }
  });

  it('still purges a marked cache from the previous account', () => {
    purgeStaleAccountState(ACCOUNT_A, 'keep');
    seed();

    const verdict = legacyVerdictForSession(ACCOUNT_B, { accountId: ACCOUNT_A, legacyState: 'keep' });
    expect(purgeStaleAccountState(ACCOUNT_B, verdict)).toBe(true);
    expect(localStorage.getItem('anton.lastAccount')).toBe(ACCOUNT_B);
  });
});

describe('an unrecognised verdict', () => {
  it('defers instead of keeping, so a JS caller cannot stamp by omission', () => {
    seed();
    // @ts-expect-error the untyped JS call sites are exactly the risk here
    expect(purgeStaleAccountState(ACCOUNT_A, undefined)).toBe(false);
    expect(localStorage.getItem('anton.lastAccount')).toBeNull();
    expect(localStorage.getItem('anton.composerDrafts')).not.toBeNull();
  });
});

// A document that has rendered for another account reloads rather than trying
// to scrub itself: storage removal leaves draftStore's module map and
// useDraft's state, whose home key every account spells the same way.
describe('shouldReloadForAccountChange', () => {
  it('reloads when one account replaces another in the same document', () => {
    expect(shouldReloadForAccountChange('acct-a', 'acct-b')).toBe(true);
  });

  it('treats a sign-out and a sign-in as someone else as the one change it is', () => {
    // The document passes through null between them, and the caller tracks the
    // last account RENDERED for, not the last value seen, so the pair is not
    // two non-changes.
    let lastRendered: string | null = 'acct-a';
    expect(shouldReloadForAccountChange(lastRendered, null)).toBe(false);
    expect(shouldReloadForAccountChange(lastRendered, 'acct-b')).toBe(true);
  });

  it('does not reload on the first identity a document resolves', () => {
    // useAccountUser resolves asynchronously, so every boot goes null then
    // account. Reloading there would reload every launch.
    expect(shouldReloadForAccountChange(null, 'acct-a')).toBe(false);
  });

  it('does not reload when the account has not changed', () => {
    expect(shouldReloadForAccountChange('acct-a', 'acct-a')).toBe(false);
  });

  it('does not reload on a sign-out alone', () => {
    expect(shouldReloadForAccountChange('acct-a', null)).toBe(false);
  });

  // The signed-out window the account-to-account test cannot see: a document
  // boots with nobody signed in, the composer hydrates whatever cache was
  // lying there, and the identity then arrives as someone else. This document
  // has rendered for nobody, so `lastRendered` is null and the first rule is
  // silent — but another account's state was just taken out from under it.
  it('reloads when the purge displaced another account under a live document', () => {
    expect(shouldReloadForAccountChange(null, 'acct-b', true)).toBe(true);
  });

  it('still does not reload on a sign-out that displaced a cache', () => {
    expect(shouldReloadForAccountChange('acct-a', null, true)).toBe(false);
  });

  it('does not reload when nothing was displaced', () => {
    // The ordinary boot: storage already names this account, so the purge
    // removes nothing and there is nothing on screen that belongs elsewhere.
    expect(shouldReloadForAccountChange(null, 'acct-a', false)).toBe(false);
  });
});
