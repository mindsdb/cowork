/*
 * The sharing contract with cowork-server: the audience fields its sharing
 * routes take and answer, the capabilities it reports, and the MindsHub
 * bounds this app mirrors. Every request body is built here and every answer
 * is read here, so each field name is written once, in the frozen maps
 * below.
 *
 * Requests take snake_case: `PUT /skills/{slug}/sharing`,
 * `PUT /artifacts/workspace/{project}/{id}/access` (MindsHub mode) and
 * `POST /publish` (desktop). Answers come back camelCase only: a skill's
 * `access`, an artifact's access and its card, and
 * `GET /skills/sharing-capabilities`. A reader takes the camelCase name and
 * no other spelling.
 *
 * Shapes are typed in sharingContract.d.ts.
 */

/** The request fields of an audience. */
export const AUDIENCE_FIELD = Object.freeze({
  ORG_ALLOWED: 'org_allowed',
  ALLOWED_TEAM_IDS: 'allowed_team_ids',
  ALLOWED_USER_IDS: 'allowed_user_ids',
  /* People outside the org, on MindsHub mode's artifact access route. */
  ALLOWED_EMAILS: 'allowed_emails',
  /* Everyone named, on desktop's `POST /publish`. */
  EMAILS: 'emails',
  OWNER_ONLY: 'owner_only',
  ALWAYS_ON: 'always_on',
  NOTIFY: 'notify',
});

/** The fields of a request's `notify`: the individuals a save adds whom
    MindsHub emails. */
export const NOTIFY_FIELD = Object.freeze({
  USER_IDS: 'user_ids',
  EMAILS: 'emails',
});

/** The same audience as cowork-server answers it. Outside emails answer as
    `accessEmails`. */
export const AUDIENCE_VIEW_FIELD = Object.freeze({
  ORG_ALLOWED: 'orgAllowed',
  ALLOWED_TEAM_IDS: 'allowedTeamIds',
  ALLOWED_USER_IDS: 'allowedUserIds',
  ACCESS_EMAILS: 'accessEmails',
  OWNER_ONLY: 'ownerOnly',
  ALWAYS_ON: 'alwaysOn',
});

/** `GET /skills/sharing-capabilities`'s answer. It names no organization:
    the app takes the name from its own organization list (useSharingOrgName). */
export const CAPABILITY_FIELD = Object.freeze({
  ENABLED: 'enabled',
  CAN_SHARE_SKILLS_ORG: 'canShareSkillsOrg',
  CAN_WRITE_SKILLS_ORG: 'canWriteSkillsOrg',
  CAN_SHARE_ARTIFACTS_ORG: 'canShareArtifactsOrg',
  PERMISSIONS_KNOWN: 'permissionsKnown',
  TEAMS_KNOWN: 'teamsKnown',
});

/** Where a read that a sharing surface waits on stands: not asked, on its
    way, answered, or failed. */
export const LOAD_STATUS = Object.freeze({
  IDLE: 'idle',
  LOADING: 'loading',
  READY: 'ready',
  ERROR: 'error',
});

/* ── Bounds this app mirrors ────────────────────────────────────────────
   The MindsHub people lookup answers at most this many ids, or this many
   addresses, in one call, and cowork-server forwards each batch as one call.
   The app asks in batches of the same size. */

/** Ids one `GET /hub/people/?ids=` asks about; mirrors MindsHub's ids per lookup. */
export const MAX_IDS_PER_LOOKUP = 50;

/** Addresses one `GET /hub/people/?emails=` asks about; mirrors MindsHub's
    emails per lookup. */
export const MAX_EMAILS_PER_LOOKUP = 50;

/** The `code` cowork-server's people lookup answers with a 400 when an
    address in `?emails=` is malformed; the body's `emails` lists them. */
export const INVALID_EMAIL_CODE = 'invalid_email';

/** The `code` of the same 400 when an id in `?ids=` isn't a UUID; the body's
    `ids` lists them. */
export const INVALID_ID_CODE = 'invalid_id';

/** `GET /hub/people/`'s two lookups. `param` is the query parameter, and the
    field of a 400 `invalidCode` body that lists the values cowork-server
    refused before asking MindsHub; `batchSize` is how many one call asks. */
export const PEOPLE_LOOKUP = Object.freeze({
  IDS: Object.freeze({ param: 'ids', invalidCode: INVALID_ID_CODE, batchSize: MAX_IDS_PER_LOOKUP }),
  EMAILS: Object.freeze({ param: 'emails', invalidCode: INVALID_EMAIL_CODE, batchSize: MAX_EMAILS_PER_LOOKUP }),
});

/* ── Why MindsHub gave no answer ─────────────────────────────────────── */

/**
 * The `code` cowork-server answers when a read it makes of MindsHub for the
 * caller gets no answer: MindsHub couldn't be asked (503), it refused (403 or
 * 400; asking again gets the same answer), or it is limiting how often the
 * caller asks (429). The app tags a MindsHub read that got no answer with one
 * of these (readMindsHubFailure).
 */
export const MINDSHUB_ERROR_CODE = Object.freeze({
  UNREACHABLE: 'mindshub_unreachable',
  REFUSED: 'mindshub_refused',
  THROTTLED: 'mindshub_throttled',
});

/**
 * Why a request to one of cowork-server's MindsHub reads failed, from the
 * error api.js's responseError throws (its `code` is read from the body's
 * top level or its `detail`). A refusal or a throttle says so; anything else,
 * a network failure or a 5xx included, is UNREACHABLE.
 *
 * @param {unknown} error
 * @returns {import('./sharingContract').MindsHubFailure}
 */
export function readMindsHubFailure(error) {
  const code = error?.code;
  if (code === MINDSHUB_ERROR_CODE.REFUSED || code === MINDSHUB_ERROR_CODE.THROTTLED) return code;
  return MINDSHUB_ERROR_CODE.UNREACHABLE;
}

/* Asking again helps a throttle first, then an outage, and never a refusal. */
const FAILURE_RANK = [MINDSHUB_ERROR_CODE.THROTTLED, MINDSHUB_ERROR_CODE.UNREACHABLE, MINDSHUB_ERROR_CODE.REFUSED];

/**
 * The one failure to report for several reads that failed (a lookup's
 * batches, the ids a list couldn't name): a throttle, then an outage, then a
 * refusal, so a surface offers Retry whenever asking again can help one of
 * them. Null when none failed.
 *
 * @param {Iterable<import('./sharingContract').MindsHubFailure | null | undefined>} failures
 * @returns {import('./sharingContract').MindsHubFailure | null}
 */
export function firstMindsHubFailure(failures) {
  const seen = new Set(failures);
  return FAILURE_RANK.find((failure) => seen.has(failure)) ?? null;
}

/* ── Reading answers ─────────────────────────────────────────────────── */

const NO_IDS = Object.freeze([]);

function stringList(value) {
  return Array.isArray(value) ? value.filter((v) => typeof v === 'string' && v) : null;
}

function flag(value) {
  return typeof value === 'boolean' ? value : null;
}

/**
 * What an answer (a save's, the access route's, a card, a skill's `access`)
 * says about its audience. A field the answer leaves out is null, so a
 * caller decides what stands in for it.
 *
 * @param {unknown} answer
 * @returns {import('./sharingContract').AudienceAnswer}
 */
export function readAudienceAnswer(answer) {
  const view = answer && typeof answer === 'object' ? answer : {};
  return {
    orgAllowed: flag(view[AUDIENCE_VIEW_FIELD.ORG_ALLOWED]),
    teamIds: stringList(view[AUDIENCE_VIEW_FIELD.ALLOWED_TEAM_IDS]),
    userIds: stringList(view[AUDIENCE_VIEW_FIELD.ALLOWED_USER_IDS]),
    emails: stringList(view[AUDIENCE_VIEW_FIELD.ACCESS_EMAILS]),
    ownerOnly: flag(view[AUDIENCE_VIEW_FIELD.OWNER_ONLY]),
    alwaysOn: flag(view[AUDIENCE_VIEW_FIELD.ALWAYS_ON]),
  };
}

/**
 * An artifact's audience as an answer or a card reports it, a list it
 * leaves out read as empty. `ownerOnly` stays null when it doesn't say.
 *
 * @param {unknown} answer
 * @returns {import('./sharingContract').ArtifactAudience}
 */
export function readArtifactAudience(answer) {
  const said = readAudienceAnswer(answer);
  return {
    orgAllowed: said.orgAllowed === true,
    teamIds: said.teamIds ?? [...NO_IDS],
    userIds: said.userIds ?? [...NO_IDS],
    emails: said.emails ?? [...NO_IDS],
    ownerOnly: said.ownerOnly,
  };
}

/**
 * The audience a request body names, MindsHub mode's or desktop's.
 *
 * @param {unknown} payload
 * @returns {import('./sharingContract').RequestedAudience}
 */
export function readAudienceRequest(payload) {
  const body = payload && typeof payload === 'object' ? payload : {};
  return {
    orgAllowed: body[AUDIENCE_FIELD.ORG_ALLOWED] === true,
    teamIds: stringList(body[AUDIENCE_FIELD.ALLOWED_TEAM_IDS]) ?? [],
    userIds: stringList(body[AUDIENCE_FIELD.ALLOWED_USER_IDS]) ?? [],
    // One body carries one of the two: `allowed_emails` in MindsHub mode,
    // `emails` on desktop (buildAccessPayload).
    emails: stringList(body[AUDIENCE_FIELD.ALLOWED_EMAILS]) ?? stringList(body[AUDIENCE_FIELD.EMAILS]) ?? [],
    ownerOnly: body[AUDIENCE_FIELD.OWNER_ONLY] === true,
    alwaysOn: body[AUDIENCE_FIELD.ALWAYS_ON] === true,
  };
}

/** Whether a skill request body sets the audience, not only `always_on`. */
export function setsAudience(payload) {
  return !!payload && typeof payload === 'object' && Object.hasOwn(payload, AUDIENCE_FIELD.ORG_ALLOWED);
}

/**
 * `GET /skills/sharing-capabilities`'s answer. Only `permissionsKnown: false`
 * or `teamsKnown: false` says MindsHub couldn't be asked; a missing one reads
 * as known.
 *
 * @param {unknown} answer
 * @returns {import('./sharingContract').SharingCapabilities}
 */
export function readSharingCapabilities(answer) {
  const data = answer && typeof answer === 'object' ? answer : {};
  return {
    enabled: data[CAPABILITY_FIELD.ENABLED] === true,
    canShareSkillsOrg: data[CAPABILITY_FIELD.CAN_SHARE_SKILLS_ORG] === true,
    canWriteSkillsOrg: data[CAPABILITY_FIELD.CAN_WRITE_SKILLS_ORG] === true,
    canShareArtifactsOrg: data[CAPABILITY_FIELD.CAN_SHARE_ARTIFACTS_ORG] === true,
    permissionsKnown: data[CAPABILITY_FIELD.PERMISSIONS_KNOWN] !== false,
    teamsKnown: data[CAPABILITY_FIELD.TEAMS_KNOWN] !== false,
  };
}

/* ── Building requests ───────────────────────────────────────────────── */

function orgAudienceFields({ orgAllowed = false, teamIds = NO_IDS, userIds = NO_IDS }) {
  return {
    [AUDIENCE_FIELD.ORG_ALLOWED]: orgAllowed === true,
    [AUDIENCE_FIELD.ALLOWED_TEAM_IDS]: [...teamIds],
    [AUDIENCE_FIELD.ALLOWED_USER_IDS]: [...new Set(userIds)],
  };
}

/**
 * `PUT /skills/{slug}/sharing`'s body: who the skill reaches, and whether it
 * is part of every task for them.
 *
 * @param {Pick<import('./sharingContract').Audience, 'orgAllowed' | 'teamIds' | 'userIds'>} audience
 * @param {{ alwaysOn: boolean }} options
 * @returns {import('./sharingContract').SkillAccessPayload}
 */
export function skillAccessRequest(audience, { alwaysOn }) {
  return { ...orgAudienceFields(audience), [AUDIENCE_FIELD.ALWAYS_ON]: alwaysOn === true };
}

/**
 * The same route's body from someone who may switch only "always on": the
 * route keeps the audience it has.
 *
 * @returns {import('./sharingContract').SkillAlwaysOnPayload}
 */
export function skillAlwaysOnRequest(alwaysOn) {
  return { [AUDIENCE_FIELD.ALWAYS_ON]: alwaysOn === true };
}

/**
 * MindsHub mode's restricted artifact body.
 *
 * @param {import('./sharingContract').Audience & { ownerOnly: boolean }} audience
 * @returns {import('./sharingContract').OrgRestrictedAccessPayload}
 */
export function orgRestrictedAccessRequest({ emails = NO_IDS, ownerOnly, ...audience }) {
  return {
    mode: 'restricted',
    ...orgAudienceFields(audience),
    [AUDIENCE_FIELD.ALLOWED_EMAILS]: [...emails],
    [AUDIENCE_FIELD.OWNER_ONLY]: ownerOnly === true,
  };
}

/**
 * Desktop's restricted body: everyone named by email.
 *
 * @param {{ emails: string[], ownerOnly: boolean }} audience
 * @returns {import('./sharingContract').DesktopRestrictedAccessPayload}
 */
export function desktopRestrictedAccessRequest({ emails, ownerOnly }) {
  return {
    mode: 'restricted',
    [AUDIENCE_FIELD.EMAILS]: [...emails],
    [AUDIENCE_FIELD.ORG_ALLOWED]: false,
    [AUDIENCE_FIELD.OWNER_ONLY]: ownerOnly === true,
  };
}

/**
 * `payload` with `notify` naming the individuals to email, when there is
 * anyone to name. Only a restricted body carries it.
 *
 * @template {{ mode: string }} P
 * @param {P} payload
 * @param {{ userIds?: string[], emails?: string[] } | null | undefined} notify
 * @returns {P}
 */
export function withNotifyRequest(payload, notify) {
  if (!notify || payload.mode !== 'restricted') return payload;
  const userIds = [...new Set(notify.userIds || NO_IDS)];
  const emails = [...new Set(notify.emails || NO_IDS)];
  if (userIds.length + emails.length === 0) return payload;
  return {
    ...payload,
    [AUDIENCE_FIELD.NOTIFY]: { [NOTIFY_FIELD.USER_IDS]: userIds, [NOTIFY_FIELD.EMAILS]: emails },
  };
}
