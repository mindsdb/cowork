// AccessChooser — the "Who can access your app" picker.
//
// One controlled component shared by every publish surface (the viewer's
// inline publish popover and the Artifacts grid dialog) so the access logic —
// and its validation — lives in exactly one place. Built on Base UI's
// RadioGroup/Radio for real radiogroup semantics + arrow-key navigation;
// skinned with the app's `--accent` / `--surface` / `--line` tokens.
//
// The choices, private → public: Only you, Everyone at ‹org› (org sharing
// only), Specific teams and people (or, without org sharing, Specific people
// by email), Password protected, Public. "Specific …" unfolds its recipient
// field right under its own card (ENG-3787).
//
// Controlled via a single `value` draft + `onChange`:
//   const [draft, setDraft] = useState(accessDraftFromArtifact(artifact));
//   <AccessChooser value={draft} onChange={setDraft} />
//   // on confirm: publish(buildAccessPayload(draft))

import { useRef } from 'react';
import { RadioGroup } from '@base-ui/react/radio-group';
import Ico from '../../Icons';
import { Tooltip } from '../../ui';
import { isEmailShaped } from '../../../lib/emailAddress';
import { PLATFORM_UI } from '../../../../lib/deployment';
import { hasSharedPublishToken } from '../../../../lib/sharedPublishToken';
import { AudienceOption } from '../../AudienceOption';
import RecipientField from '../../RecipientField';
import { everyoneAtLabel, namesDefaultTeam, withoutDefaultTeam } from '../../../lib/orgSharing';

// Shared class strings for the bare-input shell (a bordered row wrapping an
// unstyled <input>), so the password field and any future inputs stay in sync.
const INPUT_SHELL = 'flex items-center gap-[6px] bg-surface-2 border border-solid border-line rounded-card-row pt-0 pr-2 pb-0 pl-[10px]';
const BARE_INPUT = 'flex-1 min-w-0 bg-transparent border-0 [outline:none] text-ink font-[family-name:var(--font-mono)] text-[13px] py-[9px] px-0';

// ── Access-draft helpers (the contract between UI and the publish API) ──

// The draft a first share starts from. With the platform UI on it starts on
// Public, as it always has. With it off nothing is picked, so the person
// chooses who can open the link first: `isAccessDraftValid` refuses a draft
// with no mode, which keeps Share disabled until then.
export function newAccessDraft() {
  return { mode: PLATFORM_UI ? 'public' : '', password: '', emailsText: '', teamIds: [], userIds: [] };
}

// Seed a draft from an artifact's current (owner-side) access state, so
// re-opening the chooser pre-selects what's already live.
//
// The wire format has three modes; the chooser has more. "Only you" is
// `restricted` with nothing selected, and with org sharing on (`orgSharing`)
// "Everyone at ‹org›" (`org`) is `restricted` with `org_allowed` — or naming
// the org's default team, which the server maps to org-wide (`teams` is what
// `useHubTeams` returns, to know which team that is). Any other list is
// "Specific teams and people" (`restricted`).
//
// An access that has `org_allowed` AND lists reads as Everyone: that is who
// can open it. The lists stay on the draft, so switching to "Specific teams
// and people" shows them, but Everyone sends `org_allowed` alone, so updating
// as Everyone drops them.
export function accessDraftFromArtifact(artifact, { orgSharing = false, teams = [] } = {}) {
  // Nothing is live on an unpublished artifact, so with the platform UI off it
  // starts from a new draft, whatever access an earlier publish left on it.
  if (!PLATFORM_UI && !artifact?.publishedUrl) return newAccessDraft();
  const serverMode = artifact?.accessMode || (artifact?.accessProtected ? 'password' : 'public');
  const storedTeamIds = [...(artifact?.allowedTeamIds || [])];
  let mode = serverMode;
  if (serverMode === 'restricted') {
    if (isOwnerOnlySelection(artifact)) mode = 'ownerOnly';
    else if (orgSharing && (artifact?.orgAllowed || namesDefaultTeam(storedTeamIds, teams))) mode = 'org';
  }
  return {
    mode,
    password: artifact?.accessPassword || '',
    // People outside the org (or, without org sharing, everyone listed).
    emailsText: (artifact?.accessEmails || []).join(', '),
    // The default team stands for "Everyone at ‹org›", never a team pill.
    teamIds: withoutDefaultTeam(storedTeamIds, teams),
    // People in the org, by hub user id (ENG-3787).
    userIds: [...(artifact?.allowedUserIds || [])],
  };
}

// "Only me" on the wire is `restricted` with no recipients and no org. The
// server also sends an explicit `ownerOnly`; prefer it, and fall back to the
// derivation for a record written before that flag existed.
export function isOwnerOnlySelection(artifact) {
  if (artifact?.ownerOnly != null) return !!artifact.ownerOnly;
  return (artifact?.accessEmails || []).length === 0 && !artifact?.orgAllowed
    && (artifact?.allowedTeamIds || []).length === 0
    && (artifact?.allowedUserIds || []).length === 0;
}

// Loose-but-practical email shape check. Splits on whitespace, commas and
// semicolons; trims, lowercases, de-dupes; partitions valid vs invalid.
export function parseEmailList(raw) {
  const parts = (raw || '').split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  const seen = new Set();
  const valid = [];
  const invalid = [];
  for (const p of parts) {
    if (seen.has(p)) continue;
    seen.add(p);
    (isEmailShaped(p) ? valid : invalid).push(p);
  }
  return { valid, invalid };
}

// Whether the draft can be submitted: public, Only you and Everyone always;
// password needs a non-empty secret; "Specific …" needs at least one
// recipient (teams and people count only with org sharing, where the field
// can show them) and no malformed address.
export function isAccessDraftValid(draft, { orgSharing = false } = {}) {
  if (!draft) return false;
  if (draft.mode === 'public') return true;
  // Nothing to fill in — each is a complete selection on its own.
  if (draft.mode === 'ownerOnly' || draft.mode === 'org') return true;
  if (draft.mode === 'password') return (draft.password || '').trim().length > 0;
  if (draft.mode === 'restricted') {
    const { valid, invalid } = parseEmailList(draft.emailsText);
    if (invalid.length) return false;
    // An empty list used to be how you said "only me". It is a separate
    // option now, so an empty list here is an unfinished selection rather
    // than a silent private publish.
    return valid.length > 0 || (orgSharing
      && ((draft.teamIds || []).length > 0 || (draft.userIds || []).length > 0));
  }
  return false;
}

// Turn a draft into the `access` payload `publishArtifact` expects. `owner_only`
// is derived, never stored on the draft.
// With org sharing on (ENG-3787) a restricted payload names its audience the
// way skills do: `org_allowed`, `allowed_team_ids`, `allowed_user_ids` (people
// in the org) and `allowed_emails` (people outside it). `emails` and
// `team_ids` repeat the outside emails and the teams under the names
// cowork-server's publish still reads. Everyone at ‹org› sends `org_allowed`
// and empty lists.
export function buildAccessPayload(draft, { orgSharing = false } = {}) {
  const payload = buildBaseAccessPayload(draft, { orgSharing });
  if (!orgSharing || payload.mode !== 'restricted') return payload;
  const restricted = draft?.mode === 'restricted';
  const teamIds = restricted ? [...(draft.teamIds || [])] : [];
  const userIds = restricted ? [...new Set(draft.userIds || [])] : [];
  return {
    ...payload,
    allowed_emails: [...payload.emails],
    allowed_team_ids: teamIds,
    allowed_user_ids: userIds,
    team_ids: teamIds,
    owner_only: payload.owner_only && teamIds.length === 0 && userIds.length === 0,
  };
}

function buildBaseAccessPayload(draft, { orgSharing }) {
  if (draft?.mode === 'password') return { mode: 'password', password: (draft.password || '').trim() };
  // Collapse the UI mode back to the wire shape. `owner_only` is load-bearing:
  // `restricted` with neither emails nor an org would otherwise be read as an
  // empty selection and degrade to public — the exact opposite of the choice.
  if (draft?.mode === 'ownerOnly') {
    return { mode: 'restricted', emails: [], org_allowed: false, owner_only: true };
  }
  if (draft?.mode === 'org' && orgSharing) {
    return { mode: 'restricted', emails: [], org_allowed: true, owner_only: false };
  }
  if (draft?.mode === 'restricted') {
    const { valid } = parseEmailList(draft.emailsText);
    return {
      mode: 'restricted',
      emails: valid,
      org_allowed: false,
      owner_only: valid.length === 0,
    };
  }
  return { mode: 'public' };
}

// ── Presentation ───────────────────────────────────────────────────────

// Single source of truth for the access option copy. PublishMenu imports this
// for its summary card, so the wording can't drift between the picker and the
// "currently published as" view.
// A deployment that publishes with one shared token (`hasSharedPublishToken`)
// sends links to its own publisher, which may put a sign-in in front of them,
// so Public and Password say only what a visitor needs. Every other build
// publishes to MindsHub with the person's own key, where links reach the
// internet.
const SHARED_TOKEN_PUBLISH = !PLATFORM_UI && hasSharedPublishToken();

export const ACCESS_LABELS = {
  public: {
    icon: Ico.globe,
    title: 'Public',
    desc: SHARED_TOKEN_PUBLISH ? 'Anyone with the URL' : 'Anyone on the internet with the URL',
  },
  password: {
    icon: Ico.lock,
    title: 'Password protected',
    desc: SHARED_TOKEN_PUBLISH ? 'Anyone with the URL and the password' : 'Anyone on the internet with the password',
  },
  // Without org sharing: people by email.
  restricted: {
    icon: Ico.people,
    title: 'Specific people',
    desc: 'Only the people you list',
  },
  // With org sharing (ENG-3787).
  specific: {
    icon: Ico.people,
    title: 'Specific teams and people',
    desc: 'Pick teams, colleagues or outside emails',
  },
  org: { icon: Ico.building, title: everyoneAtLabel(null), desc: 'Anyone in your organization' },
  ownerOnly: { icon: Ico.lock, title: 'Only you', desc: 'Nobody else can open this' },
};

/** The label for an access as the summary card shows it. */
export function accessSummaryLabel({ mode, ownerOnly, orgAllowed, allowedTeamIds, allowedUserIds, accessEmails } = {}, { orgSharing = false, orgName = null } = {}) {
  if (mode !== 'restricted') return ACCESS_LABELS[mode] || ACCESS_LABELS.public;
  // A restricted publish with no recipients and no org grants access to the
  // owner alone — saying "people you list" there would be a lie (ENG-1769).
  if (ownerOnly) return ACCESS_LABELS.ownerOnly;
  if (!orgSharing) return ACCESS_LABELS.restricted;
  const lists = (allowedTeamIds || []).length + (allowedUserIds || []).length + (accessEmails || []).length;
  if (orgAllowed && lists === 0) return { ...ACCESS_LABELS.org, title: everyoneAtLabel(orgName) };
  return ACCESS_LABELS.specific;
}

// Order runs private → public, so the least exposing choice is the one the
// eye lands on first. A shared-token deployment offers no "Only you": a
// publisher reached with one shared publish token (cowork-server's
// COWORK_PUBLISH_TOKEN) has no owner to let in, so it answers an owner-only
// upload with a 400. `org` shows only with org sharing on.
const DEFAULT_MODES = SHARED_TOKEN_PUBLISH
  ? ['org', 'restricted', 'password', 'public']
  : ['ownerOnly', 'org', 'restricted', 'password', 'public'];

// `modes` lets a caller restrict the offered set (e.g. ['public','password']);
// defaults to every mode this build offers. `value`/`onChange` are the
// controlled draft.
// `sharing` turns on org sharing (ENG-3787): `{ enabled, orgName, teams }`,
// where `teams` is what `useHubTeams` returns. Off, there is no "Everyone",
// and "Specific people" takes emails only.
export function AccessChooser({
  value,
  onChange,
  modes = DEFAULT_MODES,
  onSubmit,
  sharing = null,
}) {
  const draft = value;
  // Several patches can land in one event, so each builds on the last rather
  // than on this render's draft.
  const latest = useRef(draft);
  latest.current = draft;
  const set = (patch) => {
    latest.current = { ...latest.current, ...patch };
    onChange?.(latest.current);
  };
  const orgSharing = sharing?.enabled === true;
  const orgName = orgSharing ? sharing.orgName || null : null;
  const specific = orgSharing ? ACCESS_LABELS.specific : ACCESS_LABELS.restricted;

  const recipients = {
    teamIds: orgSharing ? draft.teamIds || [] : [],
    userIds: orgSharing ? draft.userIds || [] : [],
    emails: parseEmailList(draft.emailsText).valid,
  };
  const editor = (
    <RecipientField
      value={recipients}
      onChange={(next) => set(orgSharing
        ? { teamIds: next.teamIds, userIds: next.userIds, emailsText: next.emails.join(', ') }
        : { emailsText: next.emails.join(', ') })}
      allowExternal
      emailsOnly={!orgSharing}
      orgName={orgName}
      teamsState={orgSharing ? sharing.teams || null : null}
    />
  );

  return (
    <div>
      <RadioGroup
        value={draft.mode}
        onValueChange={(m) => set({ mode: m })}
        className="flex flex-col gap-2"
        aria-label="Who can access your app"
      >
        {/* "Only you" is its own option rather than an empty "Specific people".
            The two used to be the same radio, distinguished only by whether the
            textarea below it happened to be blank — so the choice a person had
            made was not visible in the choice they had selected. */}
        {modes.includes('ownerOnly') && (
          <AudienceOption value="ownerOnly" active={draft.mode === 'ownerOnly'} icon={Ico.lock(16)}
            title={ACCESS_LABELS.ownerOnly.title} desc={ACCESS_LABELS.ownerOnly.desc} />
        )}
        {orgSharing && modes.includes('org') && (
          <AudienceOption value="org" active={draft.mode === 'org'} icon={Ico.building(16)}
            title={everyoneAtLabel(orgName)} desc={ACCESS_LABELS.org.desc} />
        )}
        {modes.includes('restricted') && (
          <AudienceOption value="restricted" active={draft.mode === 'restricted'} icon={Ico.people(16)}
            title={specific.title} desc={specific.desc}
            editor={editor} editorTestId="specific-recipients" />
        )}
        {modes.includes('password') && (
          <AudienceOption value="password" active={draft.mode === 'password'} icon={Ico.lock(16)}
            title={ACCESS_LABELS.password.title} desc={ACCESS_LABELS.password.desc} />
        )}
        {modes.includes('public') && (
          <AudienceOption value="public" active={draft.mode === 'public'} icon={Ico.globe(16)}
            title={ACCESS_LABELS.public.title} desc={ACCESS_LABELS.public.desc} />
        )}
      </RadioGroup>

      {draft.mode === 'password' && (
        <div className="mt-2">
          <div className={INPUT_SHELL}>
            <input
              type={draft._reveal ? 'text' : 'password'}
              value={draft.password}
              onChange={(e) => set({ password: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter' && isAccessDraftValid(draft)) onSubmit?.(); }}
              autoFocus
              placeholder="Add a password"
              className={BARE_INPUT}
            />
            <Tooltip content={draft._reveal ? 'Hide' : 'Show'}>
              <button type="button" onClick={() => set({ _reveal: !draft._reveal })}
                aria-label={draft._reveal ? 'Hide password' : 'Show password'}
                className="bg-transparent border-0 cursor-pointer text-ink-4 inline-flex p-1">
                {draft._reveal ? Ico.eyeOff(16) : Ico.eye(16)}
              </button>
            </Tooltip>
          </div>
        </div>
      )}
    </div>
  );
}

export default AccessChooser;
