/*
 * The Skills page's sharing inside the org: what the capabilities read says,
 * the caller's teams, and the decisions and saves the page's Share controls
 * make. SkillsView renders; this decides.
 *
 * Sharing in MindsHub mode groups the list by who each skill reaches and
 * replaces the "Who can use it" select with the Share dialog. Off on every
 * other build, where the page is as it was. In MindsHub mode the list waits for the
 * sharing settings (`status`): before they answer it would show the flat list
 * a build without sharing shows, and a failed read would pass for "sharing is
 * off". A desktop's failed read changes nothing, since there is no sharing to
 * miss.
 */

import { useOrgMode } from '../../lib/orgMode';
import { useMindsHubTeams, useSharingCapabilities, useSharingOrgName } from '../hooks/useOrgSharing';
import { setSkillAccessAndSync } from '../lib/skillsStore';
import {
  MINDSHUB_UNREACHABLE_EDIT,
  MINDSHUB_UNREACHABLE_PERMISSIONS,
  MINDSHUB_UNREACHABLE_TEAMS,
  alwaysOnHelp,
  canChangeSkillAudience,
  canEditSkill,
  isOrgSharingOn,
  isSkillAlwaysOn,
  permissionsUnknown,
  sameSkillAudience,
  skillAccess,
  skillAccessPayload,
  skillAlwaysOnLock,
  skillSection,
  skillShareState,
  teamsUnknown,
} from '../lib/orgSharing';
import { LOAD_STATUS, readAudienceRequest } from '../lib/sharingContract';

/* The detail note on an always-on skill someone else shares with a team or
   with everyone. */
export const ALWAYS_ON_DETAIL = "It's part of every task, and only its owner can change it.";
const READ_ONLY_ORG_NOTE = "You can use it but can't change it.";

/**
 * @param {{
 *   showToast: (message: string, type?: 'success' | 'error') => void,
 *   reloadSkills: (options?: { afterCurrent?: boolean }) => unknown,
 * }} args
 */
export function useSkillSharing({ showToast, reloadSkills }) {
  const orgMode = useOrgMode();
  const sharing = useSharingCapabilities();
  const capabilities = sharing.capabilities;
  const status = orgMode ? sharing.status : LOAD_STATUS.READY;
  const orgSharingOn = isOrgSharingOn(capabilities);
  const orgName = useSharingOrgName(orgSharingOn);
  const teamsState = useMindsHubTeams(orgSharingOn);

  /* Saves who a skill reaches, or only its "always on". Throws on a refusal,
     which the Share dropdown shows in place. */
  const saveAccess = async (skill, access) => {
    // What the skill had, and what this save leaves it with: the route keeps
    // a field the body leaves out.
    const before = skillAccessPayload(skillAccess(skill));
    const after = { ...before, ...access };
    await setSkillAccessAndSync(skill.slug || skill.label, access);
    // A save that changes only "always on" says what that does; who can use
    // the skill stays as it was.
    const alwaysOn = readAudienceRequest(after).alwaysOn;
    const alwaysOnOnly = sameSkillAudience(after, before) && alwaysOn !== readAudienceRequest(before).alwaysOn;
    showToast(alwaysOnOnly ? alwaysOnHelp(alwaysOn, skill.label) : `Updated who can use ${skill.label}.`, 'success');
  };

  /* Whether a skill offers Share, on an org: the caller's own, or one whose
     "always on" they may switch, such as a team skill they can edit. */
  const canOpenShare = (skill) => orgSharingOn && (canChangeSkillAudience(skill)
    || skillAlwaysOnLock(skill, capabilities).allowed);
  /* An org skill someone else owns keeps no Edit or Uninstall at all, and a
     built-in never does. */
  const hidesOwnerActions = (skill) => !!skill.isBuiltin || (orgSharingOn && !canEditSkill(skill));
  /* A skill someone else owns, shared with a team or with everyone. */
  const alwaysApplied = (skill) => orgSharingOn && !canEditSkill(skill)
    && (skillSection(skill) === 'team' || skillSection(skill) === 'org');
  /* The detail note on an org skill someone else owns: always on, or that
     the caller can't change it, unless that "can't" is MindsHub not
     answering for one shared with everyone. */
  const readOnlyOrgNote = (skill) => {
    if (alwaysApplied(skill) && isSkillAlwaysOn(skill)) return ALWAYS_ON_DETAIL;
    if (skillSection(skill) === 'org' && permissionsUnknown(capabilities)) return MINDSHUB_UNREACHABLE_EDIT;
    return READ_ONLY_ORG_NOTE;
  };
  /* "Share" or "Shared", with who in the tooltip. */
  const shareState = (skill) => skillShareState(skill, { teams: teamsState.teams, orgName });

  /* MindsHub couldn't give the caller's teams or permissions: the list may
     lack the skills shared with their teams, and what they may share is
     unknown. Null otherwise. Retry reads both the settings and the list
     again. */
  const unreachable = orgSharingOn && status === LOAD_STATUS.READY
    && (teamsUnknown(capabilities) || permissionsUnknown(capabilities));
  const unreachableMessage = !unreachable ? null
    : teamsUnknown(capabilities) ? MINDSHUB_UNREACHABLE_TEAMS : MINDSHUB_UNREACHABLE_PERMISSIONS;
  const retryMindsHub = () => {
    sharing.retry();
    reloadSkills({ afterCurrent: true });
  };

  return {
    status,
    retry: sharing.retry,
    capabilities,
    orgSharingOn,
    orgName,
    teamsState,
    saveAccess,
    canOpenShare,
    hidesOwnerActions,
    readOnlyOrgNote,
    shareState,
    unreachableMessage,
    retryMindsHub,
  };
}

export default useSkillSharing;
