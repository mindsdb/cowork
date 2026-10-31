// Hand-written types for api.js, same pattern as App.d.ts. Only the
// members imported from TypeScript are declared — extend as TS callers
// need more of the surface.

export const BASE: string;

/**
 * fetch() wrapper that attaches the Keycloak Bearer token in web mode (Electron
 * injects the loopback token in main). Use for any direct call to the server.
 */
export function authFetch(url: string, options?: RequestInit): Promise<Response>;

/** Per-provider recommended (planning, coding) model id pair. */
export interface RecommendedModels {
  /** Per-provider model-id lists for the picker (server-owned). */
  recommendedModels?: Record<string, string[]>;
  recommendedPair?: Record<string, [string, string] | string[]>;
  /** Per-model effort capability: id → { efforts, default }. */
  modelEfforts?: Record<string, { efforts: string[]; default: string }>;
  /** Per-model availability; a model mapped to false renders locked. */
  modelEnabled?: Record<string, boolean>;
  /**
   * Why a model mapped to false above is unavailable, from the MindsHub listing
   * only (never a custom endpoint). cowork-server relays any non-empty
   * `disabled_reason` string, so this is the raw relay: mergeRecommendedModels
   * narrows it with `knownModelDisabledReasons` before anything reads it.
   * `model_restricted` renders "Restricted" with no credits action; any other
   * known reason, an unknown one, or no entry renders "Needs credits".
   */
  modelDisabledReasons?: Record<string, string>;
  /** MindsHub's display label per model id. Absent ⇒ derive from the id. */
  modelLabels?: Record<string, string>;
  /** MindsHub's authoritative maker per model id, deciding the picker section. */
  modelProviders?: Record<string, string>;
  /**
   * The moving alias each model belongs to. `modelFamilies[id] === id` means the
   * version behind that alias moves (tagged "latest"); anything else names the
   * moving alias this entry is a frozen version of.
   */
  modelFamilies?: Record<string, string>;
  [key: string]: unknown;
}

/**
 * Fetch the backend's recommended-models map (MindsHub's live `/v1/models`
 * for minds-cloud). Returns null if the request fails.
 */
export function fetchRecommendedModels(): Promise<RecommendedModels | null>;

export interface ConnectorConnection {
  engine: string;
  name: string;
  display_name?: string | null;
  user_label?: string | null;
  label?: string | null;
  status?: string | null;
  updated_at?: string | null;
  updatedAt?: string | null;
  /**
   * True for a connection the caller can't change: one the operator provides,
   * or one someone else shares with the caller. The page shows it read-only,
   * with no Reconnect or Remove. With `shared` false, only the operator can
   * change it. Absent means false.
   */
  managed?: boolean;
  /**
   * True for a connection in the shared-connection registry, and also for
   * another person's connection in a deployment-wide vault (connections left
   * off COWORK_PERSONAL_RESOURCES). With `managed` true it is shared with the
   * caller, who can't change it. With `managed` false it is the caller's own
   * shared connection: the page shows a Shared badge and keeps every action.
   * Absent means false.
   */
  shared?: boolean;
}

export interface SavedConnectorConnection {
  method?: string | null;
  fields?: Record<string, unknown>;
  /** Same meaning as ConnectorConnection.managed. */
  managed?: boolean;
  /** Same meaning as ConnectorConnection.shared. */
  shared?: boolean;
}

export interface ConnectorFieldSpec {
  name: string;
  label: string;
  type: string;
  required?: boolean;
  secret?: boolean;
  [key: string]: unknown;
}

export interface ConnectorMethodSpec {
  id: string;
  label: string;
  fields?: ConnectorFieldSpec[];
  [key: string]: unknown;
}

export interface ConnectorSpec {
  id: string;
  logo_url?: string | null;
  form: {
    form_id: string;
    logo_url?: string | null;
    methods?: ConnectorMethodSpec[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface SavedConnectorResult {
  ok: boolean;
  name: string;
  label: string;
  user_label?: string | null;
}

export function fetchDatasources(): Promise<{ connections: ConnectorConnection[] }>;
export function fetchConnector(id: string): Promise<ConnectorSpec>;
export function fetchSavedConnection(engine: string, name: string): Promise<SavedConnectorConnection>;
export function deleteDatasource(engine: string, name: string): Promise<unknown>;
export function validateAndSaveConnector(
  connectorId: string,
  payload: { method: string; name?: string; replace_existing?: boolean; values: Record<string, unknown> },
): Promise<SavedConnectorResult>;

export const CONNECTIONS_VAULT_KEEP: string;
export const SHAREPOINT_UNAVAILABLE_MESSAGE: string;

export interface SharePointKey {
  userLabel?: string;
  tenantId: string;
  clientId: string;
  clientSecret: string;
  siteUrls: string;
}
export interface SharePointSaved { ok: boolean; name: string; user_label: string | null }
export interface SharePointLibrary { id: string; name: string }
export interface SharePointItem {
  id: string;
  name: string;
  size: number;
  kind: 'file' | 'folder' | 'other';
  modified: string | null;
}
export interface SharePointImportResult {
  imported: { path: string; size: number }[];
  skipped: { path: string; reason: string }[];
}
export function createSharePointConnection(key: SharePointKey & { name: string }): Promise<SharePointSaved>;
export function editSharePointConnection(name: string, key: SharePointKey): Promise<SharePointSaved>;
export function listSharePointLibraries(name: string, site: string): Promise<{ libraries: SharePointLibrary[] }>;
export function listSharePointChildren(
  name: string,
  page: { site: string; driveId: string; itemId?: string; cursor?: string | null },
): Promise<{ items: SharePointItem[]; cursor: string | null }>;
export function importSharePointFiles(
  projectName: string,
  pick: { connection: string; site: string; driveId: string; folder?: string; itemIds: string[] },
): Promise<SharePointImportResult>;

export interface LiveAppPreviewLease { id: string; intent: string }
export function createLiveAppPreview(launchId: string): Promise<LiveAppPreviewLease>;
export function keepLiveAppPreview(id: string): Promise<void>;
export function revokeLiveAppPreview(id: string): Promise<void>;
export function revokeLiveAppPreviews(): Promise<void>;

/** A team of the caller's MindsHub org, as the sharing pickers show it. */
export interface MindsHubTeam { id: string; display_name: string; is_default: boolean }
/** A person of the caller's MindsHub org: the id sharing stores, and what labels a row. */
export interface MindsHubPerson { id: string; name: string | null; email: string | null }
/** A MindsHub read's outcome: `reachable` false when it got no answer, and
 *  `failure` saying why (null when it answered). */
export interface MindsHubRead {
  reachable: boolean;
  failure: import('./lib/sharingContract').MindsHubFailure | null;
}
/** One `GET /hub/people/` lookup by ids or emails. `unanswered` could not be
 *  asked yet; `invalid` are values cowork-server refused as malformed (an id
 *  that isn't a UUID, an address MindsHub wouldn't take). */
export interface MindsHubPeopleLookup extends MindsHubRead {
  people: MindsHubPerson[];
  unanswered: string[];
  invalid: string[];
}
export function fetchSkillSharingCapabilities(): Promise<import('./lib/sharingContract').SharingCapabilities>;
export function setSkillAccess(
  slug: string,
  access: import('./lib/sharingContract').SkillAccessPayload | import('./lib/sharingContract').SkillAlwaysOnPayload,
): Promise<Record<string, unknown>>;
export function fetchMindsHubTeams(): Promise<MindsHubRead & { teams: MindsHubTeam[] }>;
export function fetchMindsHubDirectory(): Promise<MindsHubRead & { people: MindsHubPerson[]; truncated: boolean }>;
export function fetchMindsHubPeopleByIds(ids: string[]): Promise<MindsHubPeopleLookup>;
export function fetchMindsHubPeopleByEmails(emails: string[]): Promise<MindsHubPeopleLookup>;
export function publishArtifact(
  path: string,
  access?: import('./lib/sharingContract').ArtifactAccessPayload | null,
): Promise<Record<string, unknown>>;
