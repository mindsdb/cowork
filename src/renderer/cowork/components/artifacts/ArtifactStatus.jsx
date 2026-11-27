// ArtifactStatus — the status-pill cluster shown on every card / list row.
//
// ONE component for both views so they can never disagree. It derives the
// whole row PURELY from props (the artifact's published/access/modified
// flags + a transient `phase` the parent owns) — no internal state, so the
// status can't get "stuck": whatever the parent passes is exactly what shows.
//
//   <ArtifactStatus artifact={a} phase={statusByPath[a.path]} publishable orgMode={orgMode} />
//
// phase: 'updating' | 'unpublishing' | 'deleting' | undefined(idle). Sharing
// happens in the viewer's Share menu, which shows its own progress and errors.

import { createContext, useContext } from 'react';
import Ico from '../Icons';
import { Badge, Tooltip } from '../ui';
import {
  AUDIENCE_CHOICE, artifactAudienceChoice, everyoneAtDesc, everyoneAtLabel, isOwnerOnlyAccess,
} from '../../lib/orgSharing';
import { readArtifactAudience } from '../../lib/sharingContract';
import { useRecipientItems } from '../RecipientRows';
import i18n, { useTranslation } from '../../../lib/i18n';
import { ArtifactAuthorshipBadge } from './ArtifactAuthorshipBadge';

// One badge per artifact for who can open it (ENG-1212, ENG-4647), from its
// audience (artifactAudienceChoice, the Share panel's AUDIENCE_CHOICE): the same rule in every group and for
// every kind of file. ONLY a genuinely public artifact (a link or a website) gets the green
// "success" treatment, so a protected one can never read as available to all.
// A shared artifact's badge carries a `dot` (the "this is live" affordance);
// one only its owner can open has none until it is shared. Public and
// password-protected differ by their icon (a globe, a lock) and their label.
// The pill is inline-flex + nowrap and sizes to its content, so the label is
// always shown (ENG-1475); when a tight cell also holds the "Unshared
// changes" badge the two wrap to a second line.
const AUDIENCE_BADGE = {
  [AUDIENCE_CHOICE.PRIVATE]: { variant: 'default', icon: Ico.user(12), labelKey: 'status.badge.onlyYou' },
  [AUDIENCE_CHOICE.SPECIFIC]: { variant: 'default', icon: Ico.people(12), labelKey: 'status.badge.restricted' },
  [AUDIENCE_CHOICE.ORG]: { variant: 'default', icon: Ico.building(12), labelKey: null },
  [AUDIENCE_CHOICE.PASSWORD]: { variant: 'default', icon: Ico.lock(12), labelKey: 'status.badge.publicPassword' },
  [AUDIENCE_CHOICE.PUBLIC]: { variant: 'success', icon: Ico.globe(12), labelKey: 'status.badge.public' },
  [AUDIENCE_CHOICE.WEBSITE]: { variant: 'success', icon: Ico.globe(12), labelKey: 'status.badge.website' },
};

/** The label of an audience, for its badge and the Access filter. */
export function audienceChoiceLabel(choice, orgName = null) {
  const badge = AUDIENCE_BADGE[choice] || AUDIENCE_BADGE[AUDIENCE_CHOICE.SPECIFIC];
  return badge.labelKey ? i18n.t(badge.labelKey, { ns: 'artifacts' }) : everyoneAtLabel(orgName);
}

function accessMode(artifact) {
  const mode = artifact.accessMode || (artifact.accessProtected ? 'password' : null);
  return mode && ['public', 'website', 'password', 'restricted'].includes(mode) ? mode : null;
}

/** The org's name for "Everyone at ‹org›", from the page around the badges:
    one lookup for a whole list, not one per row. */
export const ArtifactStatusOrgName = createContext(null);
/** The org's teams, from the page around the badges: an artifact shared with
    the default team reaches everyone at the org. */
export const ArtifactStatusTeams = createContext([]);
// Names a hover lists before "and N more".
const HINT_NAMES = 5;

/* Who a restricted artifact reaches, named, for its badge's hover once its
   card knows (MindsHub mode reads it: useArtifactAudiences). Mounted only
   while the hover is open, so a list of rows asks nothing until then. */
function AudienceHint({ audience, orgName }) {
  const { t } = useTranslation('artifacts');
  const items = useRecipientItems(
    { teamIds: audience.teamIds, userIds: audience.userIds, emails: audience.emails },
    { orgName },
  );
  if (audience.orgAllowed) return everyoneAtDesc();
  if (items.length === 0) return hint('ownerOnly');
  const names = items.slice(0, HINT_NAMES).map((item) => item.primary).join(', ');
  const more = items.length - HINT_NAMES;
  return more > 0
    ? t('status.hint.sharedWithMore', { names, count: more })
    : t('status.hint.sharedWith', { names });
}

/** A restricted artifact's line when its card doesn't say who it reaches. */
export const ORG_RESTRICTED_HINT = 'Restricted. Open Share to see who can open the link.';

const hint = (key) => i18n.t(`status.hint.${key}`, { ns: 'artifacts' });

/*
 * One line under each idle label saying what it means for who can open the
 * artifact (ENG-2177). "Draft" and "Restricted" were shown bare, and nothing
 * said which state can be shared. Public and Password name their own meaning,
 * so they get none. The unknown fallback says so rather than naming an
 * audience it cannot see, for the same fail-closed reason as its badge.
 *
 * In MindsHub mode (`orgMode`) a card doesn't say who a restricted artifact
 * reaches (its audience fields are null): only the owner's access route does.
 * Its line then names nobody and points at Share, which reads that route
 * (ORG_RESTRICTED_HINT). So does any card whose audience is unknown
 * (isOwnerOnlyAccess's null).
 */
export function artifactStatusHint(artifact, publishable = true, { orgMode = false } = {}) {
  if (!artifact?.publishedUrl) {
    return publishable
      ? hint('notSharedYet')
      : hint('notShareable');
  }
  const mode = accessMode(artifact);
  if (mode === 'restricted') {
    const ownerOnly = isOwnerOnlyAccess(artifact);
    if (orgMode || ownerOnly === null) return hint('orgRestricted');
    return ownerOnly
      ? hint('ownerOnly')
      : hint('chosenPeople');
  }
  if (!mode) return hint('unknown');
  if (mode === 'password') return hint('password');
  return '';
}

// `inlineChanges` — list view flows the "Unpublished changes" pill inline
// right after the access chip; the card (default) pushes it to the right edge.
//
// `authorship` — the artifactAuthorship() result, rendered as the "Another
// member" / "Unknown owner" tag right after the primary badge (ENG-2979).
// Pass null, not an element that renders nothing, when there is none: without
// it the DOM is exactly what it was.
//
// `pageBadge` — false drops the idle "Not shared" / "Draft" badge of an
// unpublished artifact that can't become a page (a live app shares through
// "Share with…" instead). Phases and the authorship tag still show.
//
// `orgMode`: MindsHub mode, whose cards don't say who an artifact reaches
// (artifactStatusHint).
export function ArtifactStatus({ artifact, phase, publishable = true, inlineChanges = false, authorship = null, pageBadge = true, orgMode = false }) {
  const { t } = useTranslation('artifacts');
  const orgName = useContext(ArtifactStatusOrgName);
  const teams = useContext(ArtifactStatusTeams);
  const tag = authorship ? <ArtifactAuthorshipBadge authorship={authorship} /> : null;
  const withExtra = (primary) => (tag
    ? <span className="inline-flex items-center gap-[10px] min-w-0 flex-wrap">{primary}{tag}</span>
    : primary);

  // Transient phases win over the persisted state.
  if (phase === 'updating') return withExtra(<Badge variant="accent" size="sm">{t('status.updating')}</Badge>);
  if (phase === 'unpublishing') return withExtra(<Badge variant="default" size="sm">{t('status.stoppingSharing')}</Badge>);
  if (phase === 'deleting') return withExtra(<Badge variant="default" size="sm">{t('status.deleting')}</Badge>);

  // Idle: who can open it. An artifact not shared yet is its owner's alone
  // ("Only you"), whatever its kind: there is no separate "Draft" or "Not
  // shared" badge (ENG-4647); its hover says whether it can be shared.
  const audience = artifactAudienceChoice(artifact, { orgMode, teams });
  const badge = AUDIENCE_BADGE[audience];
  const label = audienceChoiceLabel(audience, orgName);
  if (!artifact?.publishedUrl) {
    if (!pageBadge) return tag;
    // Not live yet: no dot, and no "Unshared changes" beside it.
    return withExtra(
      <Tooltip content={artifactStatusHint(artifact, publishable, { orgMode })}>
        <Badge variant={badge.variant} size="sm" icon={badge.icon}>{label}</Badge>
      </Tooltip>,
    );
  }
  // A restricted artifact whose audience the page read names who it reaches
  // on hover. In MindsHub mode only an audience read from the access route
  // counts (useArtifactAudiences' `audienceRead`): a card's own fields there
  // could be stale or planted, so they name nobody.
  const read = accessMode(artifact) === 'restricted' ? readArtifactAudience(artifact) : null;
  const known = read && (!orgMode || artifact.audienceRead === true) ? read : null;
  let hover;
  if (known && orgMode && audience !== AUDIENCE_CHOICE.PRIVATE) hover = <AudienceHint audience={known} orgName={orgName} />;
  else if (audience === AUDIENCE_CHOICE.ORG) hover = everyoneAtDesc();
  else hover = artifactStatusHint(artifact, publishable, { orgMode: orgMode && !known });
  return (
    // Fills the status area: access badge on the left, the "Unshared changes"
    // warning pushed to the right (margin-left:auto). On a tight card it wraps
    // to its own line, still right-aligned there. `tag` sits between them, in
    // the same row.
    <span className="flex items-center gap-[10px] w-full min-w-0 flex-wrap">
      <Tooltip content={hover}>
        <Badge variant={badge.variant} size="sm" dot icon={badge.icon}>
          {label}
        </Badge>
      </Tooltip>
      {tag}
      {artifact.modified && (
        inlineChanges
          ? <Badge variant="warning" size="sm" dot>{t('status.unsharedChanges')}</Badge>
          : <span className="ml-auto inline-flex"><Badge variant="warning" size="sm" dot>{t('status.unsharedChanges')}</Badge></span>
      )}
    </span>
  );
}

export default ArtifactStatus;
