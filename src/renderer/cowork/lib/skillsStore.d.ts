/** An attribution actor. Hosted Cowork sends `{ userId, email }`; older
 *  loopback servers may send a bare string or a snake-cased id. */
export type SkillAttributionActor =
  | string
  | { userId?: string; user_id?: string; email?: string };

export type SkillAttribution = {
  createdBy?: SkillAttributionActor | null;
  lastModifiedBy?: SkillAttributionActor | null;
  lastModifiedAt?: string | null;
};

/** Server verdicts on one skill. A missing key is not a grant: hosted Cowork
 *  refuses the mutation, desktop keeps its historical local-owner behaviour
 *  (see lib/sharedResourceAccess.js). */
export type SkillCapabilities = {
  canEdit?: boolean;
  canDelete?: boolean;
  canDisable?: boolean;
  /** Whether the caller may share this, their own skill, with everyone or
   *  stop sharing it. Unlike the keys above, a missing key is false
   *  everywhere, desktop included (lib/skillSharing.js). */
  canShare?: boolean;
};

/** One catalogue entry as the API serializes it. Everything but `label` is
 *  optional because desktop still talks to servers that predate shared
 *  resources, and the index signature keeps pass-through fields readable. */
export type CoworkSkill = {
  id?: string;
  label: string;
  name?: string;
  description?: string | null;
  /** The instructions body; `declarative` is the API's wire name for it. */
  declarative?: string;
  enabled?: boolean;
  isBuiltin?: boolean;
  /**
   * True for a skill its creator shares with everyone. With a change
   * capability false it is someone else's skill and the page says so beside
   * the disabled action; with the capabilities granted it is the caller's own
   * and keeps every action. Absent means false.
   */
  shared?: boolean;
  projects?: string[];
  /** Single-project form still present in older payloads. */
  project?: string;
  createdAt?: string;
  updatedAt?: string;
  capabilities?: SkillCapabilities;
  attribution?: SkillAttribution;
  /** Who the skill reaches inside the org. MindsHub mode only. */
  access?: SkillAccess;
  /** Which Skills page section the caller sees it in. */
  section?: 'mine' | 'shared_with_me' | 'team' | 'org';
  /** Whether the caller may change the skill (sharing in MindsHub mode). */
  canEdit?: boolean;
  owner?: { id: string | null; email: string | null };
  [key: string]: unknown;
};

/** A skill's `access`: everyone in the org, teams, people in the org
 *  (MindsHub user ids), and whether it's part of every task for everyone it
 *  reaches (only for skills shared with everyone or a team). */
export type SkillAccess = {
  orgAllowed: boolean;
  allowedTeamIds: string[];
  allowedUserIds: string[];
  alwaysOn?: boolean;
};

export type { SkillAccessPayload, SkillAlwaysOnPayload } from './sharingContract';

/** `loaded` is the only status whose absence/presence decision came from a
 *  valid server response. A refresh moves the status to `loading` while the
 *  last settled list stays in place. */
export type SkillCatalogueStatus = 'idle' | 'loading' | 'loaded' | 'error';

export interface ReloadSkillsOptions {
  /** Let a request that started before this call settle, then fetch again, so
   *  a mutation's own reload can never observe a pre-mutation list. */
  afterCurrent?: boolean;
}

/** `ok: false` still carries the last settled list (`[]` when none loaded). */
export type SkillsReloadResult =
  | { ok: true; skills: CoworkSkill[] }
  | { ok: false; skills: CoworkSkill[]; error: unknown };

export type SkillSavePayload = {
  label: string;
  name?: string;
  description?: string;
  declarative?: string;
  enabled?: boolean;
  projects?: string[];
  /** Create only: the "Who can use it" answer, true for Everyone. Sent only
   *  when the skills list's `canShare` asked; omitted means Only me. */
  shared?: boolean;
};

export function reloadSkills(options?: ReloadSkillsOptions): Promise<SkillsReloadResult>;
export function useSkills(): {
  skills: CoworkSkill[] | null;
  catalogueStatus: SkillCatalogueStatus;
  reload: typeof reloadSkills;
  /** The list's own `canShare`: whether creating a skill asks who can use it.
   *  False until a load succeeds; a failed refresh keeps the last answer. */
  canShare: boolean;
};
export function useSkillNames(): Set<string>;
export function saveSkillAndSync(payload: SkillSavePayload, isEdit?: boolean): Promise<CoworkSkill>;
/** PUT /skills/{label}/sharing, then a reload that starts after it. */
export function setSkillSharingAndSync(label: string, shared: boolean): Promise<CoworkSkill>;
/** PUT /skills/{slug}/sharing with an org audience, then a reload after it. */
export function setSkillAccessAndSync(
  slug: string,
  access: import('./sharingContract').SkillAccessPayload | import('./sharingContract').SkillAlwaysOnPayload,
): Promise<CoworkSkill>;
/** The API answers a delete with 204, which the client surfaces as `{ ok: true }`. */
export function deleteSkillAndSync(label: string): Promise<{ ok: true }>;
