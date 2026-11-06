// `<SkillAudienceFields>`: who can use a skill inside the org in MindsHub
// mode, picked from three cards: Only me, Everyone at ‹org›, or Specific
// teams and people. The last unfolds a `<RecipientField>` under
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
import { Tooltip } from './ui';
import { Switch } from './ui/Switch';
import { useMindsHubTeams } from '../hooks/useOrgSharing';
import AudiencePanel, { everyoneOption, onlyMeOption, specificOption } from './AudiencePanel';
import {
  AUDIENCE_CHOICE,
  SHARED_KIND,
  alwaysOnHelp,
  ALWAYS_ON_LABEL,
  alwaysOnLockReason,
  canBeAlwaysOn,
  namesDefaultTeam,
  orgShareLockReason,
  withoutDefaultTeam,
} from '../lib/orgSharing';
import { LOAD_STATUS } from '../lib/sharingContract';

/** The "Always include in every task" switch with its help line; disabled,
    with `lockReason` on hover, when the caller may not change it. */
export function AlwaysOnRow({ checked, onCheckedChange, lockReason }) {
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
      <span className="font-body text-[11.5px] text-ink-3">{alwaysOnHelp(checked)}</span>
    </div>
  );
}

/** Which card an access reads as (an AUDIENCE_CHOICE). The org's default
    team is everyone. */
export function skillAudienceMode(access, teams = []) {
  if (access.orgAllowed || namesDefaultTeam(access.allowedTeamIds, teams)) return AUDIENCE_CHOICE.ORG;
  if (access.allowedTeamIds.length > 0 || access.allowedUserIds.length > 0) return AUDIENCE_CHOICE.SPECIFIC;
  return AUDIENCE_CHOICE.PRIVATE;
}

/**
 * @param {{
 *   value: { orgAllowed: boolean, allowedTeamIds: string[], allowedUserIds: string[], alwaysOn: boolean },
 *   onChange: (next: { orgAllowed: boolean, allowedTeamIds: string[], allowedUserIds: string[], alwaysOn: boolean }) => void,
 *   capabilities: import('../lib/sharingContract').SharingCapabilities | null,
 *   orgName?: string | null,
 *   canEdit: boolean,
 *   onPendingChange?: (pending: boolean) => void,
 * }} props
 */
export function SkillAudienceFields({ value, onChange, capabilities, orgName = null, canEdit, onPendingChange = () => {} }) {
  const access = value;
  // Teams load only while the fields are shown.
  const teamsState = useMindsHubTeams(true);
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
    if (settled.current || teamsState.status !== LOAD_STATUS.READY) return;
    settled.current = true;
    if (touched.current) return;
    setMode(skillAudienceMode(access, teams));
    setLists((current) => ({ ...current, teamIds: withoutDefaultTeam(current.teamIds, teams) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamsState.status]);

  // The audience each card stands for.
  const audienceFor = (nextMode, nextLists, alwaysOn) => {
    const next = nextMode === AUDIENCE_CHOICE.ORG
      ? { orgAllowed: true, allowedTeamIds: [], allowedUserIds: [] }
      : nextMode === AUDIENCE_CHOICE.SPECIFIC
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
  const empty = mode === AUDIENCE_CHOICE.SPECIFIC && lists.teamIds.length === 0 && lists.userIds.length === 0;
  useEffect(() => {
    onPendingChange(empty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empty]);

  const showAlwaysOn = mode === AUDIENCE_CHOICE.ORG
    || (mode === AUDIENCE_CHOICE.SPECIFIC && lists.teamIds.length > 0);

  const options = [
    onlyMeOption(SHARED_KIND.SKILL),
    everyoneOption({ orgName, lockReason: orgShareLockReason(capabilities, SHARED_KIND.SKILL) }),
    specificOption(SHARED_KIND.SKILL),
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
      specificValue={AUDIENCE_CHOICE.SPECIFIC}
      recipients={{
        value: { teamIds: lists.teamIds, userIds: lists.userIds, emails: [] },
        onChange: (next) => {
          const nextLists = { teamIds: next.teamIds, userIds: next.userIds };
          setLists(nextLists);
          emit(AUDIENCE_CHOICE.SPECIFIC, nextLists);
        },
        orgName,
        teamsState,
      }}
    >
      {showAlwaysOn && (
        <AlwaysOnRow
          checked={shown.alwaysOn}
          onCheckedChange={(next) => emit(mode, lists, next)}
          lockReason={alwaysOnLockReason(shown, { capabilities, canEdit })}
        />
      )}
    </AudiencePanel>
  );
}

export default SkillAudienceFields;
