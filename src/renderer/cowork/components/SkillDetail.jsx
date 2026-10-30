// `<SkillDetail>` — one skill, opened from a row on the Skills page, laid out
// like a document: the name as the title with the description under it and
// the actions at the right; one quiet line of properties (Project, Shared
// with, Always on, Owner, Updated), small muted labels before their values,
// wrapping on narrow widths; then the instructions as markdown at a readable
// width, the way chat renders it, with no card around them.
//
// The audience is said once, in the properties line: "Everyone at ‹org›",
// "Only you", or for a list a compact "Platform, Ana López +2" that
// opens the full list.
//
// SkillsView owns every action and permission: it passes the actions, the
// notes and the non-org sharing control in as slots, so this file only lays
// them out.

import { Popover } from '@base-ui/react/popover';
import Ico from './Icons';
import { Badge, Button, Tooltip } from './ui';
import { MarkdownContent } from './markdown/MarkdownContent';
import { AudienceList, PERSON_NOT_LOADED, useRecipientItems } from './RecipientRows';
import { projectLabelByName } from '../lib/projectLabel';
import { relativeAge } from '../lib/formatTime';
import {
  ALWAYS_ON_BADGE,
  ALWAYS_ON_BADGE_HINT,
  canEditSkill,
  everyoneAtLabel,
  isSkillAlwaysOn,
  namesDefaultTeam,
  skillAccess,
  skillOwnerEmail,
  withoutDefaultTeam,
} from '../lib/orgSharing';
import { useHubTeams, useKnownPeople } from '../hooks/useOrgSharing';
import { isSharedSkill } from '../lib/skillSharing';

const NO_IDS = [];
export const SHARED_WITH_LABEL = 'Shared with';
// How many names the compact audience spells out before "+N".
const NAMES_SHOWN = 2;

/* One property: a small muted label and its value, kept together on a line. */
function Property({ label, children, testId }) {
  return (
    <div className="flex min-w-0 max-w-full items-baseline gap-2" data-testid={testId}>
      {label && <dt className="shrink-0 font-body text-[12px] leading-[20px] text-ink-4">{label}</dt>}
      <dd className="m-0 flex min-w-0 items-center font-body text-[13px] leading-[20px] text-ink-2">{children}</dd>
    </div>
  );
}

/* Who owns an org skill: "You" for the caller's own (the server names only
   their address), else the owner named from their id. */
function OwnerValue({ skill }) {
  const email = skillOwnerEmail(skill);
  const ownerId = typeof skill?.owner?.id === 'string' && skill.owner.id ? skill.owner.id : null;
  const known = useKnownPeople(!email && ownerId ? [ownerId] : NO_IDS);
  if (email && canEditSkill(skill)) return <span title={email}>You</span>;
  if (email) return <span className="truncate" title={email}>{email}</span>;
  const person = known.people[0];
  if (!person) return <span className="text-ink-3">Unknown</span>;
  if (person.pending) return <span className="text-ink-3">Loading…</span>;
  if (person.failed) return <span className="text-ink-3">{PERSON_NOT_LOADED}</span>;
  const name = person.name || person.email;
  if (!name) return <span className="text-ink-3">Unknown</span>;
  return <span className="truncate" title={person.email || name}>{name}</span>;
}

/**
 * Who a skill reaches, said once and briefly: "Everyone at ‹org›", "Only
 * you", or the first names of a list with "+N", which opens the whole list.
 */
function AudienceValue({ skill, orgName, teamsState: teamsProp }) {
  const access = skillAccess(skill);
  const ownTeams = useHubTeams(!teamsProp);
  const teamsState = teamsProp || ownTeams;
  const teams = teamsState.teams || NO_IDS;
  const everyone = access.orgAllowed || namesDefaultTeam(access.allowedTeamIds, teams);
  const teamIds = withoutDefaultTeam(access.allowedTeamIds, teams);
  // Named exactly as the full list's rows name them.
  const listed = useRecipientItems(
    { teamIds: everyone ? NO_IDS : teamIds, userIds: everyone ? NO_IDS : access.allowedUserIds },
    { teamsState, orgName },
  );

  if (everyone) return <span className="truncate">{everyoneAtLabel(orgName)}</span>;
  if (teamIds.length === 0 && access.allowedUserIds.length === 0) return <span>Only you</span>;

  const names = listed.map((item) => item.primary);
  const rest = names.length - NAMES_SHOWN;
  const compact = `${names.slice(0, NAMES_SHOWN).join(', ')}${rest > 0 ? ` +${rest}` : ''}`;

  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label={`${SHARED_WITH_LABEL}: ${compact}. Show everyone`}
        className="inline-flex min-w-0 max-w-full cursor-pointer items-center gap-1 rounded-[6px] border-0 bg-transparent p-0 font-body text-[13px] leading-[20px] text-ink-2 hover:text-ink hover:underline hover:decoration-line hover:underline-offset-[3px] focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
        data-testid="skill-audience-summary"
      >
        <span className="truncate">{compact}</span>
        <span aria-hidden="true" className="inline-flex shrink-0 text-ink-4">{Ico.chevDown(12)}</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={6} style={{ zIndex: 90 }}>
          <Popover.Popup
            aria-label={SHARED_WITH_LABEL}
            className="flex max-h-[min(360px,70vh)] flex-col overflow-hidden rounded-[12px] bg-surface font-body outline-none"
            style={{ width: 'min(320px, 92vw)', boxShadow: 'var(--sh-popup)' }}
          >
            <div className="section-label px-4 pt-3 pb-1">{SHARED_WITH_LABEL}</div>
            <div className="min-h-0 overflow-y-auto px-2 pb-2">
              <AudienceList
                orgAllowed={access.orgAllowed}
                teamIds={access.allowedTeamIds}
                userIds={access.allowedUserIds}
                orgName={orgName}
                teamsState={teamsState}
                label={SHARED_WITH_LABEL}
                limit={50}
                flush={false}
              />
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function formatDate(iso) {
  const ms = Date.parse(iso || '');
  if (!Number.isFinite(ms)) return null;
  try {
    return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return null;
  }
}

/**
 * @param {{
 *   skill: object,
 *   projects?: Array<object>,
 *   capabilities?: { enabled: boolean, org_name?: string | null } | null,
 *   teamsState?: object | null,
 *   enabled: boolean,
 *   disabledForEveryone?: boolean,
 *   actions?: import('react').ReactNode,
 *   notes?: import('react').ReactNode,
 *   sharingControl?: import('react').ReactNode,
 *   canEdit?: boolean,
 *   onEdit?: () => void,
 * }} props
 */
export default function SkillDetail({
  skill, projects = [], capabilities = null, teamsState = null, enabled = true, disabledForEveryone = false,
  actions = null, notes = null, sharingControl = null, canEdit = false, onEdit,
}) {
  const project = projectLabelByName(projects, skill.projects?.[0] || skill.project) || 'All projects';
  // Org sharing is on where `capabilities` (useSharingCapabilities' answer)
  // says so.
  const orgSharingOn = capabilities?.enabled === true;
  const alwaysOn = orgSharingOn && isSkillAlwaysOn(skill);
  const age = relativeAge(skill.updatedAt);
  const updated = formatDate(skill.updatedAt);
  const showAudience = orgSharingOn && !skill.isBuiltin;
  // Without org sharing a skill is shared with everyone or nobody; one that
  // offers no control (someone else's) still says so.
  const sharedWithEveryone = !orgSharingOn && !sharingControl && isSharedSkill(skill);
  const showOwner = orgSharingOn && !skill.isBuiltin && (skillOwnerEmail(skill) || skill.owner?.id);
  const instructions = (skill.declarative || '').trim();

  return (
    <article aria-labelledby="skill-detail-title" className="flex w-full min-w-0 flex-col px-8 pb-12 pt-2">
      {/* ── Header ── */}
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3" data-testid="skill-detail-header">
        <div className="flex min-w-0 flex-[1_1_20rem] flex-col gap-1.5">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
            <h1 id="skill-detail-title" className="s-h1 m-0 min-w-0 break-words">{skill.label}</h1>
            {/* Off for everyone, by an editor, is said to every viewer; else
                the caller's own off. */}
            {disabledForEveryone
              ? <Badge variant="muted" size="md">Disabled for everyone</Badge>
              : !enabled && <Badge variant="muted" size="md">Disabled</Badge>}
          </div>
          {skill.description && (
            <p className="m-0 max-w-[72ch] text-[14px] leading-[1.55] text-ink-3 select-text">
              {skill.description}
            </p>
          )}
        </div>
        {actions && (
          <div role="group" aria-label="Skill actions" className="flex shrink-0 flex-wrap items-center gap-2 pt-1" data-testid="skill-detail-actions">
            {actions}
          </div>
        )}
      </header>

      {/* ── Properties ── */}
      <dl aria-label="Details" className="m-0 mt-4 flex min-w-0 flex-wrap items-center gap-x-7 gap-y-2" data-testid="skill-properties">
        <Property label="Project" testId="skill-meta-project">
          <span className="truncate select-text">{project}</span>
        </Property>
        {showAudience && (
          <Property label={SHARED_WITH_LABEL} testId="skill-meta-audience">
            <AudienceValue skill={skill} orgName={capabilities.org_name} teamsState={teamsState} />
          </Property>
        )}
        {sharingControl && (
          <Property label={SHARED_WITH_LABEL} testId="skill-meta-sharing">{sharingControl}</Property>
        )}
        {sharedWithEveryone && (
          <Property label={SHARED_WITH_LABEL} testId="skill-meta-sharing">Everyone</Property>
        )}
        {alwaysOn && (
          <Property testId="skill-meta-always-on">
            <Tooltip content={ALWAYS_ON_BADGE_HINT}>
              <span tabIndex={0} className="inline-flex items-center gap-1.5 rounded-[4px] text-accent focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2">
                <span aria-hidden="true" className="inline-block h-[6px] w-[6px] rounded-full bg-accent" />
                {ALWAYS_ON_BADGE}
              </span>
            </Tooltip>
          </Property>
        )}
        {skill.isBuiltin && <Property testId="skill-meta-builtin">Built-in</Property>}
        {showOwner && (
          <Property label="Owner" testId="skill-meta-owner"><OwnerValue skill={skill} /></Property>
        )}
        {age && (
          <Property label="Updated" testId="skill-meta-updated">
            <span title={updated || undefined}>{age}</span>
          </Property>
        )}
      </dl>

      {notes && <div className="mt-3 empty:hidden">{notes}</div>}

      {/* ── Instructions ── */}
      <section
        aria-labelledby="skill-instructions-title"
        className="mt-7 flex flex-col gap-3 border-t border-b-0 border-x-0 border-solid border-line pt-6"
      >
        <h2 id="skill-instructions-title" className="m-0 font-body text-base font-semibold leading-[1.3] text-ink">Instructions</h2>
        {instructions ? (
          <div className="max-w-[760px] select-text" data-testid="skill-instructions">
            <MarkdownContent
              text={skill.declarative || ''}
              id={`skill-${skill.label}`}
              complete
            />
          </div>
        ) : (
          <div className="flex max-w-[760px] flex-col items-start gap-3 py-2" data-testid="skill-instructions-empty">
            <p className="m-0 text-[13.5px] text-ink-3">This skill has no instructions yet.</p>
            {canEdit && onEdit && (
              <Button variant="default" size="sm" onClick={onEdit}>
                {Ico.edit(14)}
                Add instructions
              </Button>
            )}
          </div>
        )}
      </section>
    </article>
  );
}
