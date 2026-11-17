/*
 * What the sharing events say about an artifact and who it reaches. Every
 * Share surface reports through here, so a first share, a change and a
 * pull-back mean the same thing wherever they happen.
 *
 * An audience is reported as categories and counts only. The fingerprint that
 * tells "the same access saved again" apart compares names and the password in
 * memory and never leaves this module.
 */

import { artifactIdentity } from './artifactIdentity';
import { readArtifactAudience } from './sharingContract';
import { isOwnerOnlyAccess, namesDefaultTeam, withoutDefaultTeam } from './orgSharing';
import {
  trackArtifactAccessChanged,
  trackArtifactAccessChangeFailed,
  trackArtifactDownloaded,
  trackArtifactLinkCopied,
  trackArtifactShareOpened,
} from './analytics';

/**
 * @typedef {object} ShareSnapshot
 * @property {boolean | null} shared Reaches anyone besides its owner; null when unknown.
 * @property {'unpublished'|'public'|'password'|'only_me'|'organization'|'specific'|'unknown'} audience
 * @property {boolean | null} orgWide
 * @property {number | null} teamCount Teams named, the organization's default team aside.
 * @property {number | null} peopleCount Members and outside emails named.
 * @property {string | null} fingerprint Null when unknown, so it never matches.
 */

const sorted = (list) => [...list].sort();

/** An audience this client didn't know when the save started. */
export const UNKNOWN_SHARE_SNAPSHOT = Object.freeze({
  shared: null, audience: 'unknown', orgWide: null, teamCount: null, peopleCount: null, fingerprint: null,
});

/**
 * Who an artifact (or a publish state shaped like one: `publishedUrl`,
 * `accessMode`, `accessPassword` and the audience view fields) reaches.
 *
 * @param {object | null | undefined} artifact
 * @param {{ teams?: object[] }} [options] The organization's teams, to tell its
 *   default team, which means everyone, from the others.
 * @returns {ShareSnapshot}
 */
export function shareSnapshot(artifact, { teams = [] } = {}) {
  if (!artifact?.publishedUrl) {
    return { shared: false, audience: 'unpublished', orgWide: false, teamCount: 0, peopleCount: 0, fingerprint: 'unpublished' };
  }
  const mode = artifact.accessMode || (artifact.accessProtected ? 'password' : 'public');
  if (mode === 'public') {
    return { shared: true, audience: 'public', orgWide: false, teamCount: 0, peopleCount: 0, fingerprint: 'public' };
  }
  if (mode === 'password') {
    return {
      shared: true, audience: 'password', orgWide: false, teamCount: 0, peopleCount: 0,
      fingerprint: JSON.stringify(['password', artifact.accessPassword || '']),
    };
  }
  const audience = readArtifactAudience(artifact);
  if (!audience) return UNKNOWN_SHARE_SNAPSHOT;
  const ownerOnly = isOwnerOnlyAccess(artifact) === true;
  const orgWide = audience.orgAllowed || namesDefaultTeam(audience.teamIds, teams);
  const fingerprint = JSON.stringify([
    'restricted', ownerOnly, audience.orgAllowed,
    sorted(audience.teamIds), sorted(audience.userIds),
    sorted(audience.emails.map((email) => email.toLowerCase())),
  ]);
  if (ownerOnly) {
    return { shared: false, audience: 'only_me', orgWide: false, teamCount: 0, peopleCount: 0, fingerprint };
  }
  return {
    shared: true,
    audience: orgWide ? 'organization' : 'specific',
    orgWide,
    teamCount: withoutDefaultTeam(audience.teamIds, teams).length,
    peopleCount: audience.userIds.length + audience.emails.length,
    fingerprint,
  };
}

/**
 * The page id a publish or access-change answer names: cowork-server puts it
 * only under `result`, the publisher's own answer. Nothing at the top level is
 * read, because artifact_published's id reads the top level first and has to
 * keep sending what it always has.
 */
export function publishedPageId(answer) {
  const id = answer?.result?.report_id;
  return typeof id === 'string' ? id : '';
}

/** Whether a save from `before` to `after` is worth an access-changed event. */
export function isReportableAccessChange(before, after) {
  if (before.fingerprint !== null && before.fingerprint === after.fingerprint) return false;
  return !(before.shared === false && after.shared === false);
}

/* Analytics never breaks the action it reports on. */
function safely(send) {
  try { send(); } catch { /* nothing to recover */ }
}

function ref(artifact, entry) {
  return {
    artifactId: artifactIdentity(artifact) || artifact?.id || '',
    artifactType: artifact?.type || 'unknown',
    entry,
    reportId: typeof artifact?.reportId === 'string' ? artifact.reportId : '',
  };
}

/* A snapshot without its fingerprint, which names people and holds the password. */
function publicView({ fingerprint: _private, ...snapshot }) {
  return snapshot;
}

function noticeCount(notify) {
  if (!notify || typeof notify !== 'object') return 0;
  const count = (list) => (Array.isArray(list) ? list.length : 0);
  return count(notify.user_ids) + count(notify.emails);
}

/** The Share panel or dialog opened. `isShared` is null while the audience is unknown. */
export function reportShareOpened(artifact, { entry, isShared = null }) {
  safely(() => trackArtifactShareOpened({ ...ref(artifact, entry), isShared }));
}

/**
 * A save that succeeded. Sends nothing when it saved the same access again, or
 * left the artifact reaching only its owner.
 *
 * @param {object} artifact
 * @param {{ entry: string, before: ShareSnapshot, after: ShareSnapshot, reportId?: string, access?: object }} change
 * @returns {boolean} Whether an event was sent.
 */
export function reportAccessChanged(artifact, { entry, before, after, reportId = '', access = null }) {
  if (!isReportableAccessChange(before, after)) return false;
  const card = ref(artifact, entry);
  safely(() => trackArtifactAccessChanged({
    ...card,
    // The save's answer names the page it just published; a withdrawal names
    // the page the card had.
    reportId: reportId || card.reportId,
    before: publicView(before),
    after: publicView(after),
    notified: noticeCount(access?.notify) > 0,
  }));
  return true;
}

/**
 * Stop sharing, or the unpublish before a delete, came back. `leftLive` is
 * whether the server answered that the page is still up (stopSharingNotice's
 * non-empty answer): then nobody lost access, so it is a failed attempt, not a
 * pull-back.
 */
export function reportWithdrawal(artifact, { entry, before, leftLive = false }) {
  if (leftLive) {
    reportAccessChangeFailed(artifact, { entry, reason: 'left_live' });
    return;
  }
  reportAccessChanged(artifact, { entry, before, after: shareSnapshot(null) });
}

/** A save that failed; `reason` from publishFailureReason. */
export function reportAccessChangeFailed(artifact, { entry, reason }) {
  safely(() => trackArtifactAccessChangeFailed({ ...ref(artifact, entry), reason }));
}

/** The copy button put the artifact's link on the clipboard. */
export function reportLinkCopied(artifact, { entry }) {
  safely(() => trackArtifactLinkCopied(ref(artifact, entry)));
}

/** A download or an export saved a file. */
export function reportDownloaded(artifact, { entry, kind = 'file', format = '' }) {
  safely(() => trackArtifactDownloaded({ ...ref(artifact, entry), kind, format }));
}
