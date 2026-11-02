// Recipient rows: who something is shared with, one full-width row each, the
// way a Google Docs share dialog lists people. A row is a leading tile (team
// icon, a person's initials, a mail icon for an outside email, a muted "?"
// for someone MindsHub doesn't know or couldn't name), a name and a
// second line ("Team", the person's email, "Outside ‹org›"), and, where the
// list is editable, a remove ×.
//
// The editable list lives in `<RecipientField>`. Read-only, the same rows say
// who a skill reaches on its detail page (`<AudienceList>`) and who a
// published artifact is shared with in its Share panel (`<SharedWithList>`),
// both cut to the first few with a "+N more".

import { useState } from 'react';
import Ico from './Icons';
import { Tooltip } from './ui';
import {
  EVERYONE_AT_DESC,
  ONLY_ME_DESC,
  ONLY_ME_TITLE,
  SHARED_KIND,
  UNKNOWN_PERSON,
  everyoneAtLabel,
  namesDefaultTeam,
  orgNameOrGeneric,
  personInitials,
  withoutDefaultTeam,
} from '../lib/orgSharing';
import { useKnownPeople, useMindsHubTeams } from '../hooks/useOrgSharing';
import { LOAD_STATUS } from '../lib/sharingContract';

export const UNKNOWN_TEAM = 'Unknown team';
export const PERSON_NOT_LOADED = "Couldn't load name";
const NONE = Object.freeze([]);

/**
 * The rows for a set of recipients, teams first, then people, then emails.
 *
 * @param {{ teamIds?: string[], userIds?: string[], emails?: string[] }} value
 * @param {{
 *   teamsState?: { status: string, teams: Array<{ id: string, display_name: string }> } | null,
 *   people?: Array<{ id: string, name?: string | null, email?: string | null, pending?: boolean, failed?: boolean }>,
 *   orgName?: string | null,
 *   emailsOnly?: boolean,
 * }} context
 * @returns {Array<{ key: string, kind: string, primary: string, secondary: string | null, removeLabel: string, person?: object, muted?: boolean }>}
 */
export function recipientItems({ teamIds = NONE, userIds = NONE, emails = NONE } = {}, {
  teamsState = null, people = NONE, orgName = null, emailsOnly = false,
} = {}) {
  const teams = teamsState?.teams || NONE;
  const peopleById = new Map(people.map((p) => [p.id, p]));
  const items = [];
  for (const id of teamIds) {
    const team = teams.find((t) => t.id === id);
    let primary;
    if (team) primary = team.display_name;
    else primary = teamsState?.status === LOAD_STATUS.READY ? UNKNOWN_TEAM : 'Loading…';
    items.push({
      key: `t:${id}`,
      kind: 'team',
      primary,
      secondary: 'Team',
      removeLabel: `Remove ${primary}`,
      muted: !team,
    });
  }
  for (const id of userIds) {
    const person = peopleById.get(id);
    if (person?.pending) {
      items.push({ key: `u:${id}`, kind: 'person', primary: 'Loading…', secondary: null, removeLabel: 'Remove person', person, muted: true });
      continue;
    }
    // MindsHub couldn't be asked: not known to be missing, so never "Unknown".
    if (person?.failed) {
      items.push({ key: `u:${id}`, kind: 'person', primary: PERSON_NOT_LOADED, secondary: null, removeLabel: 'Remove person', person, muted: true });
      continue;
    }
    const name = person?.name || person?.email || UNKNOWN_PERSON;
    items.push({
      key: `u:${id}`,
      kind: 'person',
      primary: name,
      secondary: person?.name && person?.email ? person.email : null,
      removeLabel: `Remove ${name}`,
      person,
      muted: !person?.name && !person?.email,
    });
  }
  for (const email of emails) {
    items.push({
      key: `e:${email}`,
      kind: emailsOnly ? 'email' : 'outside',
      primary: email,
      secondary: emailsOnly ? null : `Outside ${orgNameOrGeneric(orgName)}`,
      removeLabel: `Remove ${email}`,
    });
  }
  return items;
}

const TILE = 'inline-grid shrink-0 place-items-center w-[28px] h-[28px] rounded-full border border-solid';

/** A recipient's leading tile, by `item.kind` ('team', 'person', 'outside',
    'email', 'org', 'private'), in the rows here and the picker's dropdown. */
export function RecipientTile({ item }) {
  if (item.kind === 'person' && !item.muted) {
    return (
      <span aria-hidden="true" className={`${TILE} border-transparent bg-accent-bg text-accent font-body text-[11px] font-semibold`}>
        {personInitials(item.person)}
      </span>
    );
  }
  if (item.kind === 'person') {
    return <span aria-hidden="true" className={`${TILE} border-line bg-surface-2 font-body text-[12px] font-semibold text-ink-4`}>?</span>;
  }
  if (item.kind === 'outside') {
    return <span aria-hidden="true" className={`${TILE} border-warning-border bg-warning-bg text-warning-text`}>{Ico.mail(14)}</span>;
  }
  const icon = item.kind === 'team' ? Ico.people(14)
    : item.kind === 'email' ? Ico.mail(14)
      : item.kind === 'org' ? Ico.building(14)
        : Ico.lock(14);
  return (
    <span aria-hidden="true" className={`${TILE} border-line bg-surface-2 ${item.muted ? 'text-ink-4' : 'text-ink-3'}`}>{icon}</span>
  );
}

/** One recipient. With `onRemove` it ends in a remove ×. */
export function RecipientRow({ item, onRemove = null }) {
  return (
    <li
      data-recipient-row={item.kind}
      className="flex min-w-0 items-center gap-2.5 py-[6px] px-2"
    >
      <RecipientTile item={item} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className={`truncate font-body text-[13px] font-medium leading-[18px] ${item.muted ? 'text-ink-3' : 'text-ink'}`}
          title={item.primary}
        >{item.primary}</span>
        {item.secondary && (
          <span className="truncate font-body text-[11.5px] leading-[16px] text-ink-3" title={item.secondary}>{item.secondary}</span>
        )}
      </span>
      {onRemove && (
        <Tooltip content="Remove">
          <button
            type="button"
            aria-label={item.removeLabel}
            onClick={onRemove}
            className="inline-grid shrink-0 place-items-center w-[26px] h-[26px] rounded-[6px] bg-transparent border-0 cursor-pointer text-ink-4 hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
          >{Ico.close(14)}</button>
        </Tooltip>
      )}
    </li>
  );
}

/**
 * Read-only rows, cut to the first `limit` with a "+N more" that shows the
 * rest.
 */
export function ReadOnlyRecipientRows({ items, label, limit = 4, testId, className = '' }) {
  const [expanded, setExpanded] = useState(false);
  const cut = !expanded && items.length > limit + 1;
  const shown = cut ? items.slice(0, limit) : items;
  return (
    <div className={`flex min-w-0 flex-col ${className}`}>
      <ul
        aria-label={label}
        data-testid={testId}
        className={`m-0 flex min-w-0 list-none flex-col p-0 ${expanded ? 'max-h-[280px] overflow-y-auto' : ''}`}
      >
        {shown.map((item) => <RecipientRow key={item.key} item={item} />)}
      </ul>
      {cut && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="self-start bg-transparent border-0 cursor-pointer mt-0.5 py-1 px-2 font-body text-[12.5px] font-medium text-accent"
        >{`+${items.length - limit} more`}</button>
      )}
    </div>
  );
}

/**
 * The rows for stored recipients, named the way the field names them: teams
 * from `teamsState` (or the caller's own teams), people through
 * useKnownPeople.
 */
export function useRecipientItems({ teamIds = NONE, userIds = NONE, emails = NONE }, {
  teamsState: teamsProp = null, orgName = null, emailsOnly = false,
} = {}) {
  const ownTeams = useMindsHubTeams(!emailsOnly && !teamsProp && teamIds.length > 0);
  const teamsState = teamsProp || ownTeams;
  const known = useKnownPeople(emailsOnly ? NONE : userIds);
  return recipientItems({ teamIds, userIds, emails }, { teamsState, people: known.people, orgName, emailsOnly });
}

/**
 * Who a published artifact is shared with, read-only: the teams, people in
 * the org and outside emails its access lists.
 */
export function SharedWithList({ teamIds = NONE, userIds = NONE, emails = NONE, orgName = null, teamsState = null, emailsOnly = false, limit = 4 }) {
  const items = useRecipientItems({ teamIds, userIds, emails }, { teamsState, orgName, emailsOnly });
  if (items.length === 0) return null;
  return <ReadOnlyRecipientRows items={items} label="Shared with" limit={limit} testId="shared-with" />;
}

/**
 * Who a skill reaches, read-only: Everyone at ‹org› (shared with everyone,
 * or with the default team), then each team and person; "Only me" when it
 * names nobody.
 *
 * @param {{
 *   orgAllowed?: boolean,
 *   teamIds?: string[],
 *   userIds?: string[],
 *   orgName?: string | null,
 *   teamsState?: { status: string, teams: Array<{ id: string, display_name: string, is_default?: boolean }> } | null,
 *   label?: string,
 *   limit?: number,
 *   flush?: boolean,
 * }} props
 */
export function AudienceList({
  orgAllowed = false, teamIds = NONE, userIds = NONE,
  orgName = null, teamsState: teamsProp = null, label = 'Who can use it', limit = 6, flush = true,
}) {
  const ownTeams = useMindsHubTeams(!teamsProp);
  const teamsState = teamsProp || ownTeams;
  const teams = teamsState.teams || NONE;
  const everyone = orgAllowed || namesDefaultTeam(teamIds, teams);
  const listed = useRecipientItems(
    { teamIds: withoutDefaultTeam(teamIds, teams), userIds },
    { teamsState, orgName },
  );
  const items = [];
  if (everyone) {
    items.push({ key: 'org', kind: 'org', primary: everyoneAtLabel(orgName), secondary: EVERYONE_AT_DESC });
  }
  items.push(...listed);
  if (items.length === 0) {
    items.push({ key: 'me', kind: 'private', primary: ONLY_ME_TITLE, secondary: ONLY_ME_DESC[SHARED_KIND.SKILL] });
  }
  // `flush`: pulled out by the rows' own padding, so names line up with the
  // text around them.
  return <ReadOnlyRecipientRows items={items} label={label} limit={limit} testId="audience-list" className={flush ? '-mx-2 -my-[4px]' : ''} />;
}
