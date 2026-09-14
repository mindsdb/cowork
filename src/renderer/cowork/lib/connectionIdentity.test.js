import { describe, it, expect } from 'vitest';
import { connectionIdentity, humanLabel } from './connectionIdentity';

// Fixtures mirror real records observed in ~/.cowork/data-vault — the shapes
// the summary endpoint actually returns, not invented ones.
describe('connectionIdentity — title', () => {
  it('leads with the app and preserves the user label beside the account', () => {
    // The gmail record whose legacy `_label` the server maps to user_label.
    const { title, subtitle } = connectionIdentity({
      engine: 'gmail', name: 'gmail-3ce87a', label: 'Gmail',
      user_label: 'Work', display_name: 'alejandro.cantu@mindsdb.com',
    });
    expect(title).toBe('Gmail');
    expect(subtitle).toBe('Work · alejandro.cantu@mindsdb.com');
  });

  it('falls back to the connector registry label when no user label is set', () => {
    // The ENG-1705 regression: this rendered '—' from v2.26.8.17.1 onward.
    // `label` is spec.label, already on ConnectionSummaryResponse.
    const { title } = connectionIdentity({
      engine: 'github', name: 'github-46461b', label: 'GitHub', user_label: null,
    });
    expect(title).toBe('GitHub');
  });

  it('prefers the registry label over the derived identity', () => {
    // The title says what the service is; the account belongs on the subtitle.
    const { title, subtitle } = connectionIdentity({
      engine: 'google_calendar', name: 'google_calendar-alecantu7-gmail-com',
      label: 'Google Calendar', user_label: null, display_name: 'alecantu7@gmail.com',
    });
    expect(title).toBe('Google Calendar');
    expect(subtitle).toBe('alecantu7@gmail.com');
  });

  it("uses the registry's casing rather than the humanized engine id", () => {
    // The reason `label` sits ahead of humanLabel(engine) in the chain: the
    // engine id humanizes to the wrong casing for a lot of real connectors.
    for (const [engine, label] of [['posthog', 'PostHog'], ['hasdata', 'HasData'], ['github', 'GitHub']]) {
      const { title } = connectionIdentity({ engine, name: `${engine}-abc123`, label });
      expect(title).toBe(label);
      expect(title).not.toBe(humanLabel(engine));
    }
  });

  it('humanizes the engine id when the engine has no registry spec', () => {
    // The fm_<uuid> records from ENG-1706: registry lookup misses, so `label`
    // is null. Nothing in the payload identifies these as LinkedIn.
    const { title } = connectionIdentity({
      engine: 'fm_ec163d25cf', name: 'fm_ec163d25cf-2cf3a6', label: null, user_label: null,
    });
    expect(title).toBe('Fm Ec163d25cf');
  });

  it('is never empty, even for a connection with nothing on it', () => {
    expect(connectionIdentity({}).title).toBe('Unknown');
    expect(connectionIdentity(undefined).title).toBe('Unknown');
  });

  it('never renders the em-dash the regression produced', () => {
    for (const c of [
      { engine: 'github', name: 'github-46461b', label: 'GitHub' },
      { engine: 'fm_ec163d25cf', name: 'fm_ec163d25cf-2cf3a6' },
      {},
    ]) {
      expect(connectionIdentity(c).title).not.toBe('—');
      expect(connectionIdentity(c).title).not.toBe('');
    }
  });
});

describe('connectionIdentity — subtitle', () => {
  it('shows the derived identity when there is one', () => {
    const { subtitle } = connectionIdentity({
      engine: 'posthog', name: 'posthog-https-us-posthog-com',
      label: 'PostHog', display_name: 'https://us.posthog.com',
    });
    expect(subtitle).toBe('https://us.posthog.com');
  });

  it('falls back to the slug so same-engine connections stay distinguishable', () => {
    // Three ENG-1706 records share one engine and have no identity; only the
    // slug tells them apart. Without this the cards are byte-identical.
    const slugs = ['fm_ec163d25cf-2cf3a6', 'fm_ec163d25cf-724e63', 'fm_ec163d25cf-f48405']
      .map((name) => connectionIdentity({ engine: 'fm_ec163d25cf', name }).subtitle);
    expect(slugs).toEqual(['fm_ec163d25cf-2cf3a6', 'fm_ec163d25cf-724e63', 'fm_ec163d25cf-f48405']);
    expect(new Set(slugs).size).toBe(3);
  });

  it('accepts the camelCase displayName the client sometimes carries', () => {
    const { subtitle } = connectionIdentity({
      engine: 'gmail', name: 'gmail-3ce87a', displayName: 'a@b.com',
    });
    expect(subtitle).toBe('a@b.com');
  });

  it('does not repeat the title when the user labelled it with the identity', () => {
    const { title, subtitle } = connectionIdentity({
      engine: 'gmail', name: 'gmail-3ce87a',
      user_label: 'a@b.com', display_name: 'a@b.com',
    });
    expect(title).toBe('Gmail');
    expect(subtitle).toBe('a@b.com');
  });

  it('shows a Linear organization once instead of falling back to its internal ID', () => {
    expect(connectionIdentity({
      engine: 'linear', name: 'ian-mindsdb-com-ce246b94-2592-437e-a848-c9e25936b4db',
      label: 'Linear', user_label: 'MindsDB', display_name: 'MindsDB',
    })).toEqual({ title: 'Linear', subtitle: 'MindsDB' });
  });

  it('does not repeat an app name used as a custom label', () => {
    expect(connectionIdentity({
      engine: 'github', name: 'ianu82', label: 'GitHub', user_label: 'github', display_name: 'ianu82',
    })).toEqual({ title: 'GitHub', subtitle: 'ianu82' });
  });

  it('does not repeat the title when user_label is the raw engine id, punctuation and all', () => {
    // cowork-server defaults a fresh connection's user_label to the bare
    // engine id (default_user_label()) whenever it has no account name to
    // use instead — seen live connecting Google Drive: title correctly read
    // "Google Drive", but the subtitle showed "google_drive · <email>"
    // because a plain lowercase compare doesn't equate an underscore with
    // the space in the humanized title.
    expect(connectionIdentity({
      engine: 'google_drive', name: 'google_drive-abc123', label: 'Google Drive',
      user_label: 'google_drive', display_name: 'martyna@mindsdb.com',
    })).toEqual({ title: 'Google Drive', subtitle: 'martyna@mindsdb.com' });
  });

  it('falls back to the slug when the raw-engine-id user_label is the only thing on the record', () => {
    const a = connectionIdentity({ engine: 'google_drive', name: 'google_drive-aaa', label: 'Google Drive', user_label: 'google_drive' });
    const b = connectionIdentity({ engine: 'google_drive', name: 'google_drive-bbb', label: 'Google Drive', user_label: 'google_drive' });
    expect(a.subtitle).toBe('google_drive-aaa');
    expect(b.subtitle).toBe('google_drive-bbb');
  });

  it('is never empty', () => {
    expect(connectionIdentity({}).subtitle).toBe('unnamed');
  });

  it('appends the slug when two same-engine connections share only a user label', () => {
    // No display_name on either — a shared, freely-editable user_label alone
    // isn't unique, unlike identity, so the slug has to carry the difference.
    const a = connectionIdentity({ engine: 'github', name: 'github-aaa111', label: 'GitHub', user_label: 'Work' });
    const b = connectionIdentity({ engine: 'github', name: 'github-bbb222', label: 'GitHub', user_label: 'Work' });
    expect(a).not.toEqual(b);
    expect(a.subtitle).toBe('Work · github-aaa111');
    expect(b.subtitle).toBe('Work · github-bbb222');
  });

  it('does not repeat the identity when its own global-uniqueness counter is the only difference', () => {
    // ensure_unique_user_label() (anton/utils/datasources.py) enforces
    // user_label uniqueness GLOBALLY, across every engine — not scoped to
    // one. Connecting the same Google account to both Gmail and Drive gives
    // both connections the same email as their default label; the second
    // one collides and gets " 2" appended purely to stay globally unique.
    // Seen live: Drive's tile showed "martyna@mindsdb.com 2 ·
    // martyna@mindsdb.com" instead of just the email.
    expect(connectionIdentity({
      engine: 'google_drive', name: 'google_drive-abc123', label: 'Google Drive',
      user_label: 'martyna@mindsdb.com 2', display_name: 'martyna@mindsdb.com',
    })).toEqual({ title: 'Google Drive', subtitle: 'martyna@mindsdb.com' });
  });

  it('does not repeat an org name when a same-named org on a different connector took the plain label first', () => {
    // Same mechanism as above, but for org-based connectors: a Linear
    // workspace named "MindsDB" and a PostHog organization also named
    // "MindsDB" collide on the global label, so PostHog (connected second)
    // gets "MindsDB 2" as its stored user_label.
    expect(connectionIdentity({
      engine: 'posthog', name: 'posthog-abc123', label: 'PostHog',
      user_label: 'MindsDB 2', display_name: 'MindsDB',
    })).toEqual({ title: 'PostHog', subtitle: 'MindsDB' });
  });

  it('keeps a genuinely distinct user_label that merely ends in a number', () => {
    // Guards against over-stripping: a real, human-chosen label ending in a
    // digit that is NOT a disambiguation counter (i.e. it doesn't match the
    // identity once stripped) must still show alongside the identity.
    expect(connectionIdentity({
      engine: 'github', name: 'github-abc123', label: 'GitHub',
      user_label: 'Team 2', display_name: 'octocat',
    })).toEqual({ title: 'GitHub', subtitle: 'Team 2 · octocat' });
  });

  it('does not repeat the title when a bare-engine-id label picked up a global-uniqueness counter', () => {
    // Same mechanism as the identity-again cases above, but for the
    // title-again path: a connection with no identity at all (the account
    // lookup returned nothing) whose user_label is the bare engine id plus
    // a counter — e.g. a second Google Drive connection whose account_name
    // AND account_email both failed to resolve — must still read as "the
    // title, again," not a meaningful second value.
    expect(connectionIdentity({
      engine: 'google_drive', name: 'google_drive-abc123', label: 'Google Drive',
      user_label: 'google_drive 2',
    })).toEqual({ title: 'Google Drive', subtitle: 'google_drive-abc123' });
  });

  it('does not throw when user_label or display_name is a non-string truthy value', () => {
    expect(() => connectionIdentity({
      engine: 'github', name: 'github-46461b', label: 'GitHub', user_label: 42, display_name: true,
    })).not.toThrow();
  });
});

describe('humanLabel', () => {
  it('titlecases snake_case', () => {
    expect(humanLabel('google_calendar')).toBe('Google Calendar');
  });

  it('titlecases across hyphens without collapsing them', () => {
    expect(humanLabel('kinaxis-maestro-connect')).toBe('Kinaxis-Maestro-Connect');
  });

  it('tolerates empty input', () => {
    expect(humanLabel('')).toBe('');
    expect(humanLabel(null)).toBe('');
    expect(humanLabel(undefined)).toBe('');
  });
});
