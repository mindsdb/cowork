/** Where a read that a sharing surface waits on stands. */
export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

export declare const LOAD_STATUS: Readonly<{
  IDLE: 'idle';
  LOADING: 'loading';
  READY: 'ready';
  ERROR: 'error';
}>;

export declare const AUDIENCE_FIELD: Readonly<{
  ORG_ALLOWED: 'org_allowed';
  ALLOWED_TEAM_IDS: 'allowed_team_ids';
  ALLOWED_USER_IDS: 'allowed_user_ids';
  ALLOWED_EMAILS: 'allowed_emails';
  EMAILS: 'emails';
  OWNER_ONLY: 'owner_only';
  ALWAYS_ON: 'always_on';
  NOTIFY: 'notify';
}>;

export declare const NOTIFY_FIELD: Readonly<{
  USER_IDS: 'user_ids';
  EMAILS: 'emails';
}>;

export declare const AUDIENCE_VIEW_FIELD: Readonly<{
  ORG_ALLOWED: 'orgAllowed';
  ALLOWED_TEAM_IDS: 'allowedTeamIds';
  ALLOWED_USER_IDS: 'allowedUserIds';
  ACCESS_EMAILS: 'accessEmails';
  OWNER_ONLY: 'ownerOnly';
  ALWAYS_ON: 'alwaysOn';
}>;

export declare const CAPABILITY_FIELD: Readonly<{
  ENABLED: 'enabled';
  CAN_SHARE_SKILLS_ORG: 'canShareSkillsOrg';
  CAN_WRITE_SKILLS_ORG: 'canWriteSkillsOrg';
  CAN_SHARE_ARTIFACTS_ORG: 'canShareArtifactsOrg';
  PERMISSIONS_KNOWN: 'permissionsKnown';
  TEAMS_KNOWN: 'teamsKnown';
}>;

export declare const MAX_IDS_PER_LOOKUP: 50;
export declare const MAX_EMAILS_PER_LOOKUP: 50;
export declare const INVALID_EMAIL_CODE: 'invalid_email';
export declare const INVALID_ID_CODE: 'invalid_id';

/** One of `GET /hub/people/`'s two lookups. */
export interface PeopleLookup {
  param: 'ids' | 'emails';
  invalidCode: 'invalid_id' | 'invalid_email';
  batchSize: number;
}

export declare const PEOPLE_LOOKUP: Readonly<{
  IDS: Readonly<PeopleLookup & { param: 'ids'; invalidCode: 'invalid_id' }>;
  EMAILS: Readonly<PeopleLookup & { param: 'emails'; invalidCode: 'invalid_email' }>;
}>;

export declare const MINDSHUB_ERROR_CODE: Readonly<{
  UNREACHABLE: 'mindshub_unreachable';
  REFUSED: 'mindshub_refused';
  THROTTLED: 'mindshub_throttled';
}>;

/** Why a MindsHub read through cowork-server got no answer. */
export type MindsHubFailure = 'mindshub_unreachable' | 'mindshub_refused' | 'mindshub_throttled';

/**
 * Who something is shared with inside an org: everyone at it, teams by id,
 * people in it by MindsHub user id, and people outside it by email (artifacts
 * only).
 */
export interface Audience {
  orgAllowed: boolean;
  teamIds: string[];
  userIds: string[];
  emails: string[];
}

/** An artifact's audience, with whether only its owner may open it (null
 *  when the answer doesn't say). */
export interface ArtifactAudience extends Audience {
  ownerOnly: boolean | null;
}

/** What an answer says about an audience; null where it leaves a field out. */
export interface AudienceAnswer {
  orgAllowed: boolean | null;
  teamIds: string[] | null;
  userIds: string[] | null;
  emails: string[] | null;
  ownerOnly: boolean | null;
  alwaysOn: boolean | null;
}

/** The audience a request body names. */
export interface RequestedAudience extends Audience {
  ownerOnly: boolean;
  alwaysOn: boolean;
}

/** `GET /skills/sharing-capabilities`, as the app keeps it. */
export interface SharingCapabilities {
  /** MindsHub mode with sharing on; every other build reads false. */
  enabled: boolean;
  /** `skills.share_org`: share a skill with everyone at the org. */
  canShareSkillsOrg: boolean;
  /** `skills.write_org`: change a skill shared with everyone that someone
   *  else owns. */
  canWriteSkillsOrg: boolean;
  /** `artifacts.share_org`: share an artifact with everyone at the org. */
  canShareArtifactsOrg: boolean;
  /** False when cowork-server couldn't ask MindsHub for the caller's
   *  permissions: the three `can…` flags then say nothing. */
  permissionsKnown: boolean;
  /** False when cowork-server couldn't ask MindsHub for the caller's teams:
   *  skills shared with their teams are then left out. */
  teamsKnown: boolean;
}

/** The body of `PUT /skills/{slug}/sharing` from the owner or an admin. */
export interface SkillAccessPayload {
  org_allowed: boolean;
  allowed_team_ids: string[];
  allowed_user_ids: string[];
  always_on: boolean;
}

/** The same route's body from someone who may switch only "always on" (a
 *  member of a team the skill is shared with): the route keeps the audience. */
export interface SkillAlwaysOnPayload {
  always_on: boolean;
}

/** Whom a save tells by email: exactly the individuals it adds. */
export interface NotifyPayload {
  user_ids: string[];
  emails: string[];
}

/** MindsHub mode's restricted artifact body. */
export interface OrgRestrictedAccessPayload {
  mode: 'restricted';
  org_allowed: boolean;
  allowed_team_ids: string[];
  allowed_user_ids: string[];
  allowed_emails: string[];
  owner_only: boolean;
  notify?: NotifyPayload;
}

/** Desktop's restricted body. */
export interface DesktopRestrictedAccessPayload {
  mode: 'restricted';
  emails: string[];
  org_allowed: false;
  owner_only: boolean;
  notify?: NotifyPayload;
}

/** The `access` an artifact save sends. */
export type ArtifactAccessPayload =
  | { mode: 'public' }
  | { mode: 'password'; password: string }
  | OrgRestrictedAccessPayload
  | DesktopRestrictedAccessPayload;

export function readAudienceAnswer(answer: unknown): AudienceAnswer;
export function readArtifactAudience(answer: unknown): ArtifactAudience;
export function readAudienceRequest(payload: unknown): RequestedAudience;
export function setsAudience(payload: unknown): boolean;
export function readSharingCapabilities(answer: unknown): SharingCapabilities;
export function readMindsHubFailure(error: unknown): MindsHubFailure;
export function firstMindsHubFailure(failures: Iterable<MindsHubFailure | null | undefined>): MindsHubFailure | null;
export function skillAccessRequest(
  audience: Pick<Audience, 'orgAllowed' | 'teamIds' | 'userIds'>,
  options: { alwaysOn: boolean },
): SkillAccessPayload;
export function skillAlwaysOnRequest(alwaysOn: boolean): SkillAlwaysOnPayload;
export function orgRestrictedAccessRequest(audience: Audience & { ownerOnly: boolean }): OrgRestrictedAccessPayload;
export function desktopRestrictedAccessRequest(audience: { emails: string[]; ownerOnly: boolean }): DesktopRestrictedAccessPayload;
export function withNotifyRequest<P extends { mode: string }>(
  payload: P,
  notify: { userIds?: string[]; emails?: string[] } | null | undefined,
): P;
