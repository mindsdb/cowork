// AccessChooser — the "Who can access your app" picker.
//
// One controlled component shared by every publish surface (the viewer's
// inline publish popover and the Artifacts grid dialog) so the access logic,
// and its validation, lives in exactly one place. Built on Base UI's
// RadioGroup/Radio for real radiogroup semantics + arrow-key navigation;
// skinned with the app's `--accent` / `--surface` / `--line` tokens.
//
// The choices, private → public (AUDIENCE_CHOICE, the same values a skill's
// audience uses): Only me, Everyone at ‹org› (sharing in MindsHub mode
// only), Specific teams and people (or, without it, Specific people by
// email), Password protected, Public. "Specific …" unfolds its recipient field right
// under its own card.
//
// Controlled via a single `value` draft + `onChange`:
//   const [draft, setDraft] = useState(accessDraftFromArtifact(artifact));
//   <AccessChooser value={draft} onChange={setDraft} />
//   // on confirm: publish(buildAccessPayload(draft))

import { useRef } from 'react';
import Ico from '../../Icons';
import { Tooltip } from '../../ui';
import { isEmailShaped } from '../../../lib/emailAddress';
import { PLATFORM_UI } from '../../../../lib/deployment';
import { hasSharedPublishToken } from '../../../../lib/sharedPublishToken';
import AudiencePanel, { everyoneOption, onlyMeOption, specificOption } from '../../AudiencePanel';
import {
  AUDIENCE_CHOICE,
  EVERYONE_AT_DESC,
  ONLY_ME_DESC,
  ONLY_ME_TITLE,
  SHARED_KIND,
  SPECIFIC_DESC,
  SPECIFIC_TITLE,
  everyoneAtLabel,
  isOrgSharingOn,
  isOwnerOnlyAccess,
  namesDefaultTeam,
  orgShareLockReason,
  withoutDefaultTeam,
} from '../../../lib/orgSharing';
import {
  desktopRestrictedAccessRequest,
  orgRestrictedAccessRequest,
  readArtifactAudience,
  withNotifyRequest,
} from '../../../lib/sharingContract';

// Shared class strings for the bare-input shell (a bordered row wrapping an
// unstyled <input>), so the password field and any future inputs stay in sync.
const INPUT_SHELL = 'flex items-center gap-[6px] bg-surface-2 border border-solid border-line rounded-card-row pt-0 pr-2 pb-0 pl-[10px]';
const BARE_INPUT = 'flex-1 min-w-0 bg-transparent border-0 [outline:none] text-ink font-[family-name:var(--font-mono)] text-[13px] py-[9px] px-0';

// ── Access-draft helpers (the contract between UI and the publish API) ──

// The draft a first share starts from. With MindsHub UI on it starts on
// Public, as it always has. With it off nothing is picked, so the person
// chooses who can open the link first: `isAccessDraftValid` refuses a draft
// with no mode, which keeps Share disabled until then.
export function newAccessDraft() {
  return { mode: PLATFORM_UI ? AUDIENCE_CHOICE.PUBLIC : '', password: '', emailsText: '', teamIds: [], userIds: [] };
}

// Seed a draft from an artifact's current (owner-side) access state, so
// re-opening the chooser pre-selects what's already live.
//
// The wire format has three modes; the chooser has more. "Only me" is
// `restricted` with nothing selected, and with sharing on (`orgSharing`)
// "Everyone at ‹org›" is `restricted` with `org_allowed`, or naming the
// org's default team, which the server maps to everyone (`teams` is what
// `useMindsHubTeams` returns, to know which team that is). Any other list is
// "Specific teams and people".
//
// An access that has `org_allowed` AND lists reads as Everyone: that is who
// can open it. The lists stay on the draft, so switching to "Specific teams
// and people" shows them, but Everyone sends `org_allowed` alone, so updating
// as Everyone drops them.
export function accessDraftFromArtifact(artifact, { orgSharing = false, teams = [] } = {}) {
  // Nothing is live on an unpublished artifact, so with MindsHub UI off it
  // starts from a new draft, whatever access an earlier publish left on it.
  if (!PLATFORM_UI && !artifact?.publishedUrl) return newAccessDraft();
  const serverMode = artifact?.accessMode || (artifact?.accessProtected ? 'password' : 'public');
  const audience = readArtifactAudience(artifact);
  let mode = serverMode;
  if (serverMode === 'restricted') {
    if (isOwnerOnlyAccess(artifact)) mode = AUDIENCE_CHOICE.PRIVATE;
    else if (orgSharing && (audience.orgAllowed || namesDefaultTeam(audience.teamIds, teams))) mode = AUDIENCE_CHOICE.ORG;
    else mode = AUDIENCE_CHOICE.SPECIFIC;
  }
  return {
    mode,
    password: artifact?.accessPassword || '',
    // People outside the org (or, without sharing in MindsHub mode, everyone
    // listed).
    emailsText: audience.emails.join(', '),
    // The default team stands for "Everyone at ‹org›", never a team row.
    teamIds: withoutDefaultTeam(audience.teamIds, teams),
    // People in the org, by MindsHub user id.
    userIds: audience.userIds,
  };
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

// Whether the draft can be submitted: public, Only me and Everyone always;
// password needs a non-empty secret; "Specific …" needs at least one
// recipient (teams and people count only with sharing in MindsHub mode,
// where the field can show them) and no malformed address.
export function isAccessDraftValid(draft, { orgSharing = false } = {}) {
  if (!draft) return false;
  if (draft.mode === AUDIENCE_CHOICE.PUBLIC) return true;
  // Nothing to fill in: each is a complete selection on its own.
  if (draft.mode === AUDIENCE_CHOICE.PRIVATE || draft.mode === AUDIENCE_CHOICE.ORG) return true;
  if (draft.mode === AUDIENCE_CHOICE.PASSWORD) return (draft.password || '').trim().length > 0;
  if (draft.mode === AUDIENCE_CHOICE.SPECIFIC) {
    const { valid, invalid } = parseEmailList(draft.emailsText);
    if (invalid.length) return false;
    // An empty list is an unfinished selection rather than a silent private
    // publish: "Only me" is its own option.
    return valid.length > 0 || (orgSharing
      && ((draft.teamIds || []).length > 0 || (draft.userIds || []).length > 0));
  }
  return false;
}

// Turn a draft into the `access` payload a save sends (lib/sharingContract's
// ArtifactAccessPayload). `owner_only` is derived, never stored on the draft.
//
// In MindsHub mode (`orgMode`) the access route reads a restricted audience
// the way skills name it, and only so: `org_allowed`, `allowed_team_ids`,
// `allowed_user_ids` (people in the org) and `allowed_emails` (people outside
// it). It refuses `emails` with a 400, so every MindsHub mode save sends these
// names, whatever sharing allows. Everyone at ‹org› sends `org_allowed`
// and empty lists. Desktop's `/publish` reads outside emails as `emails`.
//
// `notify` (`{ userIds, emails }`, when given) becomes `notify: { user_ids,
// emails }` on a restricted payload: exactly the individuals this save adds,
// whom the person chose to tell by email. Absent when they chose not to, or
// were never asked; the server forwards it to MindsHub, which emails those
// listed.
//
// A mode this chooser doesn't know saves as Only me, never as Public: an
// unexpected value must not widen who can open the link.
export function buildAccessPayload(draft, { orgMode = false, notify } = {}) {
  return withNotifyRequest(orgMode ? buildOrgAccessPayload(draft) : buildBaseAccessPayload(draft), notify);
}

/**
 * The individuals a draft lists that the saved access doesn't: people in the
 * org (`userIds`, sharing in MindsHub mode only) and emails. Teams,
 * everyone at the org, a password and public never count. Only a "Specific …" draft adds anyone.
 */
export function addedIndividuals(draft, saved, { orgSharing = false } = {}) {
  if (draft?.mode !== AUDIENCE_CHOICE.SPECIFIC) return { userIds: [], emails: [] };
  const savedEmails = new Set(parseEmailList(saved?.emailsText).valid);
  const savedUsers = new Set(saved?.userIds || []);
  return {
    userIds: orgSharing ? [...new Set(draft.userIds || [])].filter((id) => !savedUsers.has(id)) : [],
    emails: parseEmailList(draft.emailsText).valid.filter((e) => !savedEmails.has(e)),
  };
}

function passwordPayload(draft) {
  return { mode: 'password', password: (draft.password || '').trim() };
}

const NOBODY = Object.freeze({ orgAllowed: false, teamIds: [], userIds: [], emails: [] });

function buildOrgAccessPayload(draft) {
  switch (draft?.mode) {
    case AUDIENCE_CHOICE.PUBLIC:
      return { mode: 'public' };
    case AUDIENCE_CHOICE.PASSWORD:
      return passwordPayload(draft);
    case AUDIENCE_CHOICE.ORG:
      return orgRestrictedAccessRequest({ ...NOBODY, orgAllowed: true, ownerOnly: false });
    case AUDIENCE_CHOICE.SPECIFIC: {
      const { valid } = parseEmailList(draft.emailsText);
      const teamIds = [...(draft.teamIds || [])];
      const userIds = [...new Set(draft.userIds || [])];
      return orgRestrictedAccessRequest({
        orgAllowed: false,
        teamIds,
        userIds,
        emails: valid,
        ownerOnly: valid.length + teamIds.length + userIds.length === 0,
      });
    }
    // Only me, and any mode this chooser doesn't know.
    default:
      return orgRestrictedAccessRequest({ ...NOBODY, ownerOnly: true });
  }
}

function buildBaseAccessPayload(draft) {
  switch (draft?.mode) {
    case AUDIENCE_CHOICE.PUBLIC:
      return { mode: 'public' };
    case AUDIENCE_CHOICE.PASSWORD:
      return passwordPayload(draft);
    case AUDIENCE_CHOICE.SPECIFIC: {
      const { valid } = parseEmailList(draft.emailsText);
      return desktopRestrictedAccessRequest({ emails: valid, ownerOnly: valid.length === 0 });
    }
    // Only me, and any mode this chooser doesn't know (Everyone at ‹org›
    // included, which desktop never offers). `owner_only` is load-bearing:
    // `restricted` with neither emails nor an org would otherwise be read as
    // an empty selection and degrade to public.
    default:
      return desktopRestrictedAccessRequest({ emails: [], ownerOnly: true });
  }
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
  // Without sharing in MindsHub mode: people by email.
  specificPeople: {
    icon: Ico.people,
    title: 'Specific people',
    desc: 'Only the people you list',
  },
  // With sharing in MindsHub mode.
  specific: { icon: Ico.people, title: SPECIFIC_TITLE, desc: SPECIFIC_DESC[SHARED_KIND.ARTIFACT] },
  org: { icon: Ico.building, title: everyoneAtLabel(null), desc: EVERYONE_AT_DESC },
  private: { icon: Ico.lock, title: ONLY_ME_TITLE, desc: ONLY_ME_DESC[SHARED_KIND.ARTIFACT] },
};

/** The label for an artifact's access as the summary card shows it. */
export function accessSummaryLabel(artifact, { orgSharing = false, orgName = null } = {}) {
  const mode = artifact?.accessMode;
  if (mode !== 'restricted') return ACCESS_LABELS[mode] || ACCESS_LABELS.public;
  // A restricted publish with no recipients and no org grants access to the
  // owner alone; saying "people you list" there would be a lie.
  if (artifact.ownerOnly) return ACCESS_LABELS.private;
  if (!orgSharing) return ACCESS_LABELS.specificPeople;
  const audience = readArtifactAudience(artifact);
  const lists = audience.teamIds.length + audience.userIds.length + audience.emails.length;
  if (audience.orgAllowed && lists === 0) return { ...ACCESS_LABELS.org, title: everyoneAtLabel(orgName) };
  return ACCESS_LABELS.specific;
}

// Order runs private → public, so the least exposing choice is the one the
// eye lands on first. A shared-token deployment offers no "Only me": a
// publisher reached with one shared publish token (cowork-server's
// COWORK_PUBLISH_TOKEN) has no owner to let in, so it answers an owner-only
// upload with a 400. Everyone at ‹org› shows only with sharing on.
const DEFAULT_MODES = SHARED_TOKEN_PUBLISH
  ? [AUDIENCE_CHOICE.ORG, AUDIENCE_CHOICE.SPECIFIC, AUDIENCE_CHOICE.PASSWORD, AUDIENCE_CHOICE.PUBLIC]
  : [AUDIENCE_CHOICE.PRIVATE, AUDIENCE_CHOICE.ORG, AUDIENCE_CHOICE.SPECIFIC, AUDIENCE_CHOICE.PASSWORD, AUDIENCE_CHOICE.PUBLIC];

// `modes` lets a caller restrict the offered set (e.g. [PASSWORD, PUBLIC]);
// defaults to every mode this build offers. `value`/`onChange` are the
// controlled draft.
// `sharing` turns on sharing in MindsHub mode when its capabilities say so:
// `{ capabilities, teams, orgName }`, where `capabilities` is what
// `useSharingCapabilities` reads, `teams` is what `useMindsHubTeams`
// returns and `orgName` is what `useSharingOrgName` returns. Off, there is
// no "Everyone", and "Specific people" takes emails only. Without
// `canShareArtifactsOrg` "Everyone" is grayed with the admin hint, or with
// "Couldn't reach MindsHub" while MindsHub couldn't be asked.
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
  const capabilities = sharing?.capabilities ?? null;
  const orgSharing = isOrgSharingOn(capabilities);
  const orgName = orgSharing ? sharing.orgName ?? null : null;

  const recipients = {
    value: {
      teamIds: orgSharing ? draft.teamIds || [] : [],
      userIds: orgSharing ? draft.userIds || [] : [],
      emails: parseEmailList(draft.emailsText).valid,
    },
    onChange: (next) => set(orgSharing
      ? { teamIds: next.teamIds, userIds: next.userIds, emailsText: next.emails.join(', ') }
      : { emailsText: next.emails.join(', ') }),
    allowExternal: true,
    emailsOnly: !orgSharing,
    orgName,
    teamsState: orgSharing ? sharing.teams || null : null,
  };

  const specificPeople = ACCESS_LABELS.specificPeople;
  // "Only me" is its own option rather than an empty "Specific people", so
  // the choice a person made is the choice they see selected.
  const options = [
    modes.includes(AUDIENCE_CHOICE.PRIVATE) && onlyMeOption(SHARED_KIND.ARTIFACT),
    orgSharing && modes.includes(AUDIENCE_CHOICE.ORG)
      && everyoneOption({ orgName, lockReason: orgShareLockReason(capabilities, SHARED_KIND.ARTIFACT) }),
    modes.includes(AUDIENCE_CHOICE.SPECIFIC) && (orgSharing
      ? specificOption(SHARED_KIND.ARTIFACT)
      : { value: AUDIENCE_CHOICE.SPECIFIC, icon: specificPeople.icon(16), title: specificPeople.title, desc: specificPeople.desc }),
    modes.includes(AUDIENCE_CHOICE.PASSWORD) && { value: AUDIENCE_CHOICE.PASSWORD, icon: Ico.lock(16), title: ACCESS_LABELS.password.title, desc: ACCESS_LABELS.password.desc },
    modes.includes(AUDIENCE_CHOICE.PUBLIC) && { value: AUDIENCE_CHOICE.PUBLIC, icon: Ico.globe(16), title: ACCESS_LABELS.public.title, desc: ACCESS_LABELS.public.desc },
  ].filter(Boolean);

  return (
    <AudiencePanel
      ariaLabel="Who can access your app"
      value={draft.mode}
      onValueChange={(m) => set({ mode: m })}
      options={options}
      specificValue={AUDIENCE_CHOICE.SPECIFIC}
      recipients={recipients}
    >
      {draft.mode === AUDIENCE_CHOICE.PASSWORD && (
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
      )}
    </AudiencePanel>
  );
}

export default AccessChooser;
