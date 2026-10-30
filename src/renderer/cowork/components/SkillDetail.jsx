// `<SkillDetail>` — one skill, opened from a row on the Skills page.
//
// A header (icon tile, name, one line of description, badges, and the
// actions grouped at the right), a metadata block (Project, Who can use it,
// owner, last update) and the instructions as markdown in a readable column.
// SkillsView owns every action and permission: it passes the actions, the
// notes and the non-org sharing control in as slots, so this file only lays
// them out.

import Ico from './Icons';
import { Badge, Button, Tooltip } from './ui';
import { MarkdownContent } from './markdown/MarkdownContent';
import { AudienceList } from './RecipientRows';
import { projectLabelByName } from '../lib/projectLabel';
import { relativeAge } from '../lib/formatTime';
import {
  ALWAYS_ON_BADGE,
  ALWAYS_ON_BADGE_HINT,
  canEditSkill,
  isSkillAlwaysOn,
  skillAccess,
  skillAudienceBadge,
  skillOwnerEmail,
} from '../lib/orgSharing';
import { useKnownPeople } from '../hooks/useOrgSharing';
import { SKILL_SHARING_LABEL, isSharedSkill } from '../lib/skillSharing';

const NO_IDS = [];

function DetailTile({ skill }) {
  return (
    <span
      aria-hidden="true"
      className="inline-grid h-11 w-11 shrink-0 place-items-center rounded-[10px] border border-solid border-line bg-surface-2 font-mono text-[18px] font-semibold text-ink-3"
    >{skill.isBuiltin ? Ico.cube(20) : '/'}</span>
  );
}

/* One label/value line of the metadata block. The label is a heading so a
   screen reader can jump between them. */
function MetaRow({ label, children, testId }) {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-1 py-3 min-[640px]:grid-cols-[160px_minmax(0,1fr)] min-[640px]:items-start min-[640px]:gap-4" data-testid={testId}>
      <h3 className="section-label m-0 min-[640px]:pt-[3px]">{label}</h3>
      <div className="min-w-0 text-[13.5px] leading-[1.5] text-ink">{children}</div>
    </div>
  );
}

/* Who owns an org skill: "You" for the caller's own (the server names only
   their address), else the owner named from their id. */
function OwnerValue({ skill }) {
  const email = skillOwnerEmail(skill);
  const ownerId = typeof skill?.owner?.id === 'string' && skill.owner.id ? skill.owner.id : null;
  const known = useKnownPeople(!email && ownerId ? [ownerId] : NO_IDS);
  if (email && canEditSkill(skill)) {
    return <span>You <span className="text-ink-3">· {email}</span></span>;
  }
  if (email) return <span>{email}</span>;
  const person = known.people[0];
  if (!person) return <span className="text-ink-3">Unknown</span>;
  if (person.pending) return <span className="text-ink-3">Loading…</span>;
  const name = person.name || person.email;
  if (!name) return <span className="text-ink-3">Unknown</span>;
  return <span title={person.email || name}>{name}{person.name && person.email ? <span className="text-ink-3"> · {person.email}</span> : null}</span>;
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
 *   orgSharing?: { teams: Array<object>, orgName?: string | null } | null,
 *   teamsState?: object | null,
 *   enabled: boolean,
 *   actions?: import('react').ReactNode,
 *   notes?: import('react').ReactNode,
 *   sharingControl?: import('react').ReactNode,
 *   canEdit?: boolean,
 *   onEdit?: () => void,
 * }} props
 */
export default function SkillDetail({
  skill, projects = [], orgSharing = null, teamsState = null, enabled = true,
  actions = null, notes = null, sharingControl = null, canEdit = false, onEdit,
}) {
  const project = projectLabelByName(projects, skill.projects?.[0] || skill.project) || 'All projects';
  const access = skillAccess(skill);
  const audience = orgSharing ? skillAudienceBadge(skill, orgSharing) : null;
  const alwaysOn = !!orgSharing && isSkillAlwaysOn(skill);
  const sharedBy = orgSharing && !canEditSkill(skill) && !skill.isBuiltin ? skillOwnerEmail(skill) : null;
  const shared = !orgSharing && isSharedSkill(skill);
  const age = relativeAge(skill.updatedAt);
  const updated = formatDate(skill.updatedAt);
  const showAudience = !!orgSharing && !skill.isBuiltin;
  const showOwner = !!orgSharing && !skill.isBuiltin && (skillOwnerEmail(skill) || skill.owner?.id);
  const instructions = (skill.declarative || '').trim();
  const hasBadges = !enabled || skill.isBuiltin || shared || audience || alwaysOn || sharedBy;

  return (
    <article aria-labelledby="skill-detail-title" className="mx-auto flex w-full max-w-[920px] flex-col gap-6 px-8 pb-10 pt-2">
      {/* ── Header ── */}
      <header className="flex flex-wrap items-start gap-x-4 gap-y-3" data-testid="skill-detail-header">
        <DetailTile skill={skill} />
        <div className="flex min-w-0 flex-[1_1_18rem] flex-col gap-1.5">
          <h1 id="skill-detail-title" className="s-h2 m-0 break-words">{skill.label}</h1>
          {skill.description && (
            <p className="m-0 line-clamp-2 max-w-[72ch] text-[13.5px] leading-[1.5] text-ink-3 select-text" title={skill.description}>
              {skill.description}
            </p>
          )}
          {hasBadges && (
            <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1.5" data-testid="skill-detail-badges">
              {!enabled && <Badge variant="muted" size="md">Disabled</Badge>}
              {skill.isBuiltin && <Badge variant="muted" size="md">Built-in</Badge>}
              {shared && <Badge variant="muted" size="md">Shared</Badge>}
              {audience && <Badge variant="default" size="md">{audience}</Badge>}
              {alwaysOn && (
                <Tooltip content={ALWAYS_ON_BADGE_HINT}>
                  <span className="inline-flex" tabIndex={0}><Badge variant="accent" size="md">{ALWAYS_ON_BADGE}</Badge></span>
                </Tooltip>
              )}
              {sharedBy && (
                <span className="max-w-[260px] truncate font-body text-xs text-ink-4" title={sharedBy}>Shared by {sharedBy}</span>
              )}
            </div>
          )}
        </div>
        {actions && (
          <div role="group" aria-label="Skill actions" className="flex shrink-0 flex-wrap items-center gap-2" data-testid="skill-detail-actions">
            {actions}
          </div>
        )}
      </header>

      {notes}

      {/* ── Metadata ── */}
      <section aria-label="Details" className="divide-y divide-solid divide-line rounded-[12px] border border-solid border-line bg-surface px-4">
        <MetaRow label="Project" testId="skill-meta-project">
          <span className="inline-flex min-w-0 items-center gap-1.5 select-text">
            <span className="inline-flex text-ink-4" aria-hidden="true">{Ico.folder(14)}</span>
            <span className="truncate">{project}</span>
          </span>
        </MetaRow>
        {showAudience && (
          <MetaRow label={SKILL_SHARING_LABEL} testId="skill-meta-audience">
            <AudienceList
              orgAllowed={access.orgAllowed}
              teamIds={access.allowedTeamIds}
              userIds={access.allowedUserIds}
              orgName={orgSharing.orgName}
              teamsState={teamsState}
            />
          </MetaRow>
        )}
        {sharingControl && (
          <MetaRow label={SKILL_SHARING_LABEL} testId="skill-meta-sharing">{sharingControl}</MetaRow>
        )}
        {showOwner && (
          <MetaRow label="Owner" testId="skill-meta-owner"><OwnerValue skill={skill} /></MetaRow>
        )}
        {age && (
          <MetaRow label="Last updated" testId="skill-meta-updated">
            <span title={updated || undefined}>{age}</span>
          </MetaRow>
        )}
      </section>

      {/* ── Instructions ── */}
      <section aria-labelledby="skill-instructions-title" className="flex flex-col gap-2">
        <h2 id="skill-instructions-title" className="section-label m-0">Instructions</h2>
        {instructions ? (
          <div
            className="rounded-[12px] border border-solid border-line bg-surface px-6 py-5 select-text"
            data-testid="skill-instructions"
          >
            <div className="max-w-[72ch]">
              <MarkdownContent
                text={skill.declarative || ''}
                id={`skill-${skill.label}`}
                complete
              />
            </div>
          </div>
        ) : (
          <div
            className="flex flex-col items-center gap-3 rounded-[12px] border border-dashed border-line px-6 py-10 text-center"
            data-testid="skill-instructions-empty"
          >
            <span className="inline-flex text-ink-4" aria-hidden="true">{Ico.edit(20)}</span>
            <p className="m-0 text-[13.5px] text-ink-3">This skill has no instructions yet.</p>
            {canEdit && onEdit && (
              <Button variant="default" size="sm" onClick={onEdit}>Add instructions</Button>
            )}
          </div>
        )}
      </section>
    </article>
  );
}
