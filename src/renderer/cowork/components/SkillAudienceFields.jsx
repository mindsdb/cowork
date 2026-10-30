// `<SkillAudienceFields>` — who can use a skill inside a hosted org
// (ENG-3787), picked from three cards: Only me, Everyone at ‹org›, or
// Specific teams and people. The last unfolds a `<RecipientField>` under
// itself; a skill reaches only people in the org, so it takes no outside
// emails (the server refuses them). "Always include in every task" shows once
// the org or a team is picked.
// Shared by the Share dialog and the Add a Skill dialog.
//
// Controlled: `value` is the skill's access, `{ orgAllowed, allowedTeamIds,
// allowedUserIds, alwaysOn }`, and `onChange` gets the next one. Which card
// is picked, and the teams and people picked under "Specific", are kept here,
// seeded from `value` on mount, so a parent that loads a different skill
// remounts it with a `key`. Everyone at ‹org› sends `orgAllowed` with no
// lists; the lists stay here, so switching back to "Specific" shows them.

import { useEffect, useRef, useState } from 'react';
import Ico from './Icons';
import { Tooltip } from './ui';
import { Switch } from './ui/Switch';
import { useHubTeams } from '../hooks/useOrgSharing';
import AudiencePanel from './AudiencePanel';
import {
  ALWAYS_ON_HELP,
  ALWAYS_ON_LABEL,
  ORG_ADMIN_ONLY_HINT,
  PRIVATE_ACCESS,
  SHARING_NOTE,
  alwaysOnLockReason,
  canBeAlwaysOn,
  everyoneAtLabel,
  namesDefaultTeam,
  withoutDefaultTeam,
} from '../lib/orgSharing';

export { PRIVATE_ACCESS };

function AlwaysOnRow({ checked, onCheckedChange, lockReason }) {
  const control = (
    <div className="flex items-center justify-between gap-3">
      <span className="font-body text-[13px] font-semibold text-ink">{ALWAYS_ON_LABEL}</span>
      <Switch
        size="sm"
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={!!lockReason}
        aria-label={ALWAYS_ON_LABEL}
      />
    </div>
  );
  return (
    <div className="flex flex-col gap-1 rounded-card border border-solid border-line bg-surface-2 py-[10px] px-3">
      {lockReason ? (
        // A disabled switch fires no hover of its own, so the hint hangs off
        // a wrapper.
        <Tooltip content={lockReason}>
          <div data-testid="always-on-locked">{control}</div>
        </Tooltip>
      ) : control}
      <span className="font-body text-[11.5px] text-ink-3">{ALWAYS_ON_HELP}</span>
    </div>
  );
}

/** Which card an access reads as. The org's default team is everyone. */
export function skillAudienceMode(access, teams = []) {
  if (access.orgAllowed || namesDefaultTeam(access.allowedTeamIds, teams)) return 'org';
  if (access.allowedTeamIds.length > 0 || access.allowedUserIds.length > 0) return 'specific';
  return 'private';
}

/**
 * @param {{
 *   value: { orgAllowed: boolean, allowedTeamIds: string[], allowedUserIds: string[], alwaysOn: boolean },
 *   onChange: (next: { orgAllowed: boolean, allowedTeamIds: string[], allowedUserIds: string[], alwaysOn: boolean }) => void,
 *   capabilities: { can_share_org?: boolean, org_name?: string | null } | null,
 *   canEdit: boolean,
 *   onPendingChange?: (pending: boolean) => void,
 * }} props
 */
export function SkillAudienceFields({ value, onChange, capabilities, canEdit, onPendingChange = () => {} }) {
  const access = value;
  // Teams load only while the fields are shown.
  const teamsState = useHubTeams(true);
  const teams = teamsState.teams;
  const [mode, setMode] = useState(() => skillAudienceMode(access, teams));
  // The teams and people under "Specific", the default team left out.
  const [lists, setLists] = useState(() => ({
    teamIds: withoutDefaultTeam(access.allowedTeamIds, teams),
    userIds: [...access.allowedUserIds],
  }));
  // Until the person picks, a skill shared only with the default team reads
  // as Everyone once the teams are known.
  const touched = useRef(false);
  const settled = useRef(false);
  useEffect(() => {
    if (settled.current || teamsState.status !== 'ready') return;
    settled.current = true;
    if (touched.current) return;
    setMode(skillAudienceMode(access, teams));
    setLists((current) => ({ ...current, teamIds: withoutDefaultTeam(current.teamIds, teams) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamsState.status]);

  const orgName = capabilities?.org_name ?? null;
  const canShareOrg = capabilities?.can_share_org === true;

  // The audience each card stands for.
  const audienceFor = (nextMode, nextLists, alwaysOn) => {
    const next = nextMode === 'org'
      ? { orgAllowed: true, allowedTeamIds: [], allowedUserIds: [] }
      : nextMode === 'specific'
        ? { orgAllowed: false, allowedTeamIds: [...nextLists.teamIds], allowedUserIds: [...nextLists.userIds] }
        : { orgAllowed: false, allowedTeamIds: [], allowedUserIds: [] };
    // Always on resets to off once neither the org nor a team is picked.
    return { ...next, alwaysOn: canBeAlwaysOn(next) ? !!alwaysOn : false };
  };
  // What is shown: the card picked, and its audience. Until the person picks,
  // the value as given (the default team included) is what a save sends.
  const shown = audienceFor(mode, lists, access.alwaysOn);

  const emit = (nextMode, nextLists, alwaysOn = access.alwaysOn) => {
    touched.current = true;
    onChange(audienceFor(nextMode, nextLists, alwaysOn));
  };

  // "Specific" with nobody in it is unfinished; Save waits for a pick.
  const empty = mode === 'specific' && lists.teamIds.length === 0 && lists.userIds.length === 0;
  useEffect(() => {
    onPendingChange(empty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empty]);

  const showAlwaysOn = mode === 'org' || (mode === 'specific' && lists.teamIds.length > 0);

  const options = [
    { value: 'private', icon: Ico.lock(16), title: 'Only me', desc: 'Nobody else can use it' },
    {
      value: 'org',
      icon: Ico.building(16),
      title: everyoneAtLabel(orgName),
      desc: 'Anyone in your organization',
      disabled: !canShareOrg,
      disabledHint: ORG_ADMIN_ONLY_HINT,
      disabledTestId: 'org-option-locked',
    },
    { value: 'specific', icon: Ico.people(16), title: 'Specific teams and people', desc: 'Pick teams or colleagues' },
  ];

  return (
    <AudiencePanel
      ariaLabel="Who can use this skill"
      value={mode}
      onValueChange={(next) => {
        setMode(next);
        emit(next, lists);
      }}
      options={options}
      specificValue="specific"
      recipients={{
        value: { teamIds: lists.teamIds, userIds: lists.userIds, emails: [] },
        onChange: (next) => {
          const nextLists = { teamIds: next.teamIds, userIds: next.userIds };
          setLists(nextLists);
          emit('specific', nextLists);
        },
        orgName,
        teamsState,
      }}
    >
      {showAlwaysOn && (
        <AlwaysOnRow
          checked={shown.alwaysOn}
          onCheckedChange={(next) => emit(mode, lists, next)}
          lockReason={alwaysOnLockReason(shown, { canShareOrg, canEdit })}
        />
      )}
      <p className="m-0 mt-1 font-body text-xs text-ink-3" role="note">{SHARING_NOTE}</p>
    </AudiencePanel>
  );
}

export default SkillAudienceFields;
