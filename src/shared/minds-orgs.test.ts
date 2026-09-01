import { describe, it, expect } from 'vitest';
import {
  type MindsOrg,
  PERSONAL_ORG_LABEL,
  chooseMindsOrg,
  needsOrgPick,
  organizationLabel,
  personalOrgName,
  rankMindsOrgs,
  readOrgPreference,
  toMindsOrg,
  writeOrgPreference,
} from './minds-orgs';

const USER = 'user-1';

const org = (id: string, name: string): MindsOrg => ({
  id,
  name,
  displayName: name,
  isPersonal: name === personalOrgName(USER),
});

const PERSONAL = org('org-personal', personalOrgName(USER));
const ACME = org('org-acme', 'acme.example');
const BETA = org('org-beta', 'beta.example');

describe('toMindsOrg', () => {
  it('reads the raw Keycloak name off `slug` and the label off `name`', () => {
    // `listOrgCandidates` keeps them apart on OrgRef for exactly this: `name`
    // has already collapsed displayName over the raw one.
    const result = toMindsOrg({ id: 'o1', name: "dana@acme.example's organization", slug: personalOrgName(USER) }, USER);
    expect(result.name).toBe(personalOrgName(USER));
    expect(result.displayName).toBe("dana@acme.example's organization");
    expect(result.isPersonal).toBe(true);
  });

  it('spots a personal organization only when the id in the name is this user', () => {
    // Another person's personal organization is still a company to us in the
    // sense that matters: it is not the one we rank last for this account.
    expect(toMindsOrg({ id: 'o1', slug: 'personal_someone-else' }, USER).isPersonal).toBe(false);
    expect(toMindsOrg({ id: 'o1', slug: personalOrgName(USER) }, USER).isPersonal).toBe(true);
  });

  it('names itself by its id when Keycloak sent neither name', () => {
    // `normalizeOrgRef` will take an id off a bare string entry, so an
    // organization can reach here with an id and nothing else. Rendering
    // `undefined` in the picker is the outcome worth ruling out.
    const result = toMindsOrg({ id: 'org-only-an-id' }, USER);
    expect(result.name).toBe('org-only-an-id');
    expect(result.displayName).toBe('org-only-an-id');
    expect(result.isPersonal).toBe(false);
  });

  it('falls back to the raw name rather than inventing a label', () => {
    // Auth generates `<email>'s organization` and Keycloak holds it. Rebuilding
    // that string here would be a third copy of the rule, so a missing display
    // name stays missing and the caller decides what to show.
    expect(toMindsOrg({ id: 'o1', slug: 'acme.example' }, USER).displayName).toBe('acme.example');
  });
});

describe('rankMindsOrgs', () => {
  it('puts company organizations ahead of the personal one', () => {
    // The reported bug in one line: Personal happened to be active, so the key
    // went there and the company could neither pay for it nor revoke it.
    expect(rankMindsOrgs([PERSONAL, ACME]).map((o) => o.id)).toEqual(['org-acme', 'org-personal']);
  });

  it('keeps the order Keycloak gave inside each group', () => {
    // "The first company organization" has to mean the same thing on every
    // sign-in, or a new membership silently moves where keys are minted.
    expect(rankMindsOrgs([ACME, PERSONAL, BETA]).map((o) => o.id))
      .toEqual(['org-acme', 'org-beta', 'org-personal']);
  });

  it('leaves a personal-only account exactly as it was', () => {
    expect(rankMindsOrgs([PERSONAL])).toEqual([PERSONAL]);
    expect(rankMindsOrgs([])).toEqual([]);
  });
});

describe('chooseMindsOrg', () => {
  it('takes the top-ranked organization when nothing was picked', () => {
    expect(chooseMindsOrg([PERSONAL, ACME], null)?.id).toBe('org-acme');
  });

  it('lets a deliberate pick beat the ranking', () => {
    // Otherwise the ranking would drag someone back to the company org on
    // every relaunch after they deliberately moved to Personal.
    expect(chooseMindsOrg([PERSONAL, ACME], 'org-personal')?.id).toBe('org-personal');
  });

  it('ignores a pick the person is no longer a member of', () => {
    // A revoked membership would otherwise pin the app to an organization it
    // cannot reach, with the ranking unable to recover it.
    expect(chooseMindsOrg([PERSONAL, ACME], 'org-gone')?.id).toBe('org-acme');
  });

  it('has no answer for an account with no organizations', () => {
    expect(chooseMindsOrg([], 'org-acme')).toBeNull();
  });
});

describe('needsOrgPick', () => {
  it('asks only when there is more than one company organization', () => {
    expect(needsOrgPick([PERSONAL, ACME, BETA])).toBe(true);
    expect(needsOrgPick([PERSONAL, ACME])).toBe(false);
    expect(needsOrgPick([PERSONAL])).toBe(false);
    expect(needsOrgPick([])).toBe(false);
  });
});

describe('the stored pick', () => {
  it('round-trips through the state file shape', () => {
    const state = writeOrgPreference(null, USER, 'org-acme');
    expect(readOrgPreference(state, USER)).toBe('org-acme');
  });

  it('belongs to one account, so the next person to sign in does not inherit it', () => {
    // One machine, two accounts: inheriting would move where the second
    // person's keys are minted with nothing on screen saying so.
    const state = writeOrgPreference(null, USER, 'org-acme');
    expect(readOrgPreference(state, 'someone-else')).toBeNull();
  });

  it('leaves every other preference alone', () => {
    const existing = { preferences: { providers: [{ type: 'minds-cloud' }] }, other: 1 };
    const next = writeOrgPreference(existing, USER, 'org-acme') as any;
    expect(next.preferences.providers).toEqual([{ type: 'minds-cloud' }]);
    expect(next.other).toBe(1);
  });

  it('reads nothing out of a missing, empty or malformed state file', () => {
    expect(readOrgPreference(null, USER)).toBeNull();
    expect(readOrgPreference({}, USER)).toBeNull();
    expect(readOrgPreference({ preferences: 'nope' }, USER)).toBeNull();
    expect(readOrgPreference({ preferences: { mindsOrganization: 'nope' } }, USER)).toBeNull();
    expect(readOrgPreference({ preferences: { mindsOrganization: { sub: USER } } }, USER)).toBeNull();
  });
});

/*
 * ENG-2109. Two readers name an organization: the token claim, which already
 * substituted PERSONAL_ORG_LABEL, and the membership listing, whose
 * `displayName` for a personal organization is auth's generated
 * `<email>'s organization`. Every call site read `displayName` inline and the
 * listing won, so the label changed under the user a beat after first paint.
 * This function is what makes the two agree.
 */
describe('organizationLabel', () => {
  it('calls a personal organization Personal, not auth\'s generated label', () => {
    const generated: MindsOrg = {
      ...PERSONAL,
      displayName: "someone@example.com's organization",
    };
    expect(organizationLabel(generated)).toBe(PERSONAL_ORG_LABEL);
  });

  it('agrees with the label the token claim already used, so nothing changes on resolve', () => {
    // The claim path produces PERSONAL_ORG_LABEL for a personal organization
    // (accountUser.js). Same value from the listing path means no flash.
    expect(organizationLabel({ ...PERSONAL, displayName: "a@b.com's organization" }))
      .toBe(PERSONAL_ORG_LABEL);
  });

  it('keeps a company organization on its Keycloak display name', () => {
    expect(organizationLabel({ ...ACME, displayName: 'Acme Corporation' }))
      .toBe('Acme Corporation');
  });

  it('falls back to the raw name when a company organization has no display name', () => {
    expect(organizationLabel({ ...ACME, displayName: '' })).toBe('acme.example');
  });

  it('is null for no organization, so a caller can chain its own fallback', () => {
    expect(organizationLabel(null)).toBeNull();
    expect(organizationLabel(undefined)).toBeNull();
  });
});
