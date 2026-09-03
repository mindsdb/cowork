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
  projects?: string[];
  /** Single-project form still present in older payloads. */
  project?: string;
  createdAt?: string;
  updatedAt?: string;
  capabilities?: SkillCapabilities;
  attribution?: SkillAttribution;
  [key: string]: unknown;
};

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
};

export function reloadSkills(options?: ReloadSkillsOptions): Promise<SkillsReloadResult>;
export function useSkills(): {
  skills: CoworkSkill[] | null;
  catalogueStatus: SkillCatalogueStatus;
  reload: typeof reloadSkills;
};
export function useSkillNames(): Set<string>;
export function saveSkillAndSync(payload: SkillSavePayload, isEdit?: boolean): Promise<CoworkSkill>;
/** The API answers a delete with 204, which the client surfaces as `{ ok: true }`. */
export function deleteSkillAndSync(label: string): Promise<{ ok: true }>;
