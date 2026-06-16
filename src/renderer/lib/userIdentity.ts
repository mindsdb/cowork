// Seeds the signed-in user's name into agent memory so the agent can address
// them personally: their first name in conversation, their full name when a
// written/formal context needs it (e.g. drafting an email).
//
// The name comes from the Keycloak JWT (`host.getAccessToken()` works in both
// Electron and web). Nothing is sent to an external service: we only write to
// the local cowork-server memory store via the existing /memory endpoint.

import { host } from '../platform/host';
// api.js is the established (untyped) client; syncSettings.ts imports it the
// same way. We re-narrow the pieces we use through the dependency interface.
import { fetchMemory, saveMemory, fetchSettings } from '../cowork/api';

/**
 * A user's name, split so callers can address them appropriately:
 * `first` for conversation, `full` when a formal/written context needs it.
 */
export interface UserName {
  readonly first: string;
  readonly last: string;
  readonly full: string;
}

const asString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

/**
 * Decode a JWT payload in the renderer (base64url -> JSON). Returns null on any
 * malformed input; callers treat "no claims" as "nothing to seed".
 */
export function decodeJwtPayload(
  token: string | null,
): Record<string, unknown> | null {
  if (!token) return null;
  try {
    const segment = token.split('.')[1];
    if (!segment) return null;
    const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
    // utf-8 safe decode (handles non-ASCII names).
    const json = decodeURIComponent(
      Array.prototype.map
        .call(atob(base64), (c: string) =>
          '%' + c.charCodeAt(0).toString(16).padStart(2, '0'),
        )
        .join(''),
    );
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Build a UserName from OIDC/Keycloak claims, falling back to splitting the
 * display `name` when `given_name`/`family_name` are absent. Returns null when
 * no usable name is present.
 */
export function parseUserName(
  claims: Record<string, unknown> | null,
): UserName | null {
  if (!claims) return null;
  const given = asString(claims.given_name);
  const family = asString(claims.family_name);
  const display = asString(claims.name);

  const first = given || display.split(/\s+/)[0] || '';
  if (!first) return null;
  const last = family || display.split(/\s+/).slice(1).join(' ');
  const full = display || [first, last].filter(Boolean).join(' ');
  return { first, last, full };
}

// --- memory wiring -------------------------------------------------------

/**
 * Where a harness keeps user-facing memory. Writes route to the *active*
 * harness server-side, so the category must be one that harness supports. The
 * server's list/save shim is not perfectly symmetric, so the read and write
 * relative paths are stated explicitly.
 */
interface MemoryTarget {
  readonly scope: 'Global';
  readonly writePath: string;
  readonly readPath: string;
}

const MEMORY_TARGETS: Record<string, MemoryTarget> = {
  // Anton (default) has no dedicated user file; its free-form rules.md is
  // injected into context every turn, so user guidance lives there.
  anton: { scope: 'Global', writePath: 'rules.md', readPath: 'rules.md' },
  // Hermes has a purpose-built USER.md (category `user`). The save shim maps
  // "user" -> category `user`, but the list shim surfaces it as topics/user.md.
  hermes: { scope: 'Global', writePath: 'user', readPath: 'topics/user.md' },
};

// Fences the block we manage so re-seeding replaces it in place instead of
// appending duplicates, and never disturbs anything the user added.
const BLOCK_START = '<!-- cowork:user-identity -->';
const BLOCK_END = '<!-- /cowork:user-identity -->';

interface MemoryFile {
  relativePath: string;
  content: string;
}
interface MemorySection {
  scope: string;
  files?: MemoryFile[];
}

type TokenReader = () => Promise<string | null>;
type SettingsReader = () => Promise<{ harness?: string }>;
type MemoryReader = () => Promise<{ sections?: MemorySection[] }>;
type MemoryWriter = (payload: {
  scope: string;
  relativePath: string;
  content: string;
}) => Promise<unknown>;

interface SeederDeps {
  getToken?: TokenReader;
  getSettings?: SettingsReader;
  readMemory?: MemoryReader;
  writeMemory?: MemoryWriter;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
}

/**
 * Ensures the signed-in user's name is present in agent memory.
 *
 * Idempotent on two levels: a per-name localStorage guard short-circuits the
 * common case, and the marker-fenced block is merged (not appended) so even if
 * the guard is cleared the block is never duplicated. Safe to call on every
 * app mount; it no-ops when no authenticated name is available.
 */
export class UserMemorySeeder {
  private static readonly STORAGE_KEY = 'anton.userNameSeeded';

  private readonly getToken: TokenReader;
  private readonly getSettings: SettingsReader;
  private readonly readMemory: MemoryReader;
  private readonly writeMemory: MemoryWriter;
  private readonly storage?: Pick<Storage, 'getItem' | 'setItem'>;

  constructor(deps: SeederDeps = {}) {
    this.getToken = deps.getToken ?? (() => host.getAccessToken());
    this.getSettings = deps.getSettings ?? fetchSettings;
    this.readMemory = deps.readMemory ?? fetchMemory;
    this.writeMemory = deps.writeMemory ?? saveMemory;
    this.storage =
      deps.storage ??
      (typeof window !== 'undefined' ? window.localStorage : undefined);
  }

  /** Seed the name if needed. Never throws; failures are intentionally silent. */
  async ensure(): Promise<void> {
    try {
      const name = parseUserName(decodeJwtPayload(await this.getToken()));
      if (!name) return; // not signed in via Keycloak, or no name claim
      if (this.seenName() === name.full) return; // fast path: already seeded

      const target = await this.resolveTarget();
      const current = await this.readCurrent(target);
      const next = this.merge(current, this.renderBlock(name));
      if (next.trim() !== current.trim()) {
        await this.writeMemory({
          scope: target.scope,
          relativePath: target.writePath,
          content: next,
        });
      }
      this.rememberName(name.full);
    } catch {
      // Personalization is best-effort; never block the app on it.
    }
  }

  private async resolveTarget(): Promise<MemoryTarget> {
    let harness = 'anton';
    try {
      harness = (await this.getSettings())?.harness || 'anton';
    } catch {
      // settings unreachable -> assume the default harness
    }
    return MEMORY_TARGETS[harness] ?? MEMORY_TARGETS.anton;
  }

  private async readCurrent(target: MemoryTarget): Promise<string> {
    const memory = await this.readMemory();
    const file = (memory?.sections ?? [])
      .filter((s) => s.scope === 'Global')
      .flatMap((s) => s.files ?? [])
      .find((f) => f.relativePath === target.readPath);
    return file?.content ?? '';
  }

  private renderBlock(name: UserName): string {
    return [
      BLOCK_START,
      `The user's first name is ${name.first}.`,
      name.last ? `Their full name is ${name.full}.` : null,
      'Address them by their first name in conversation. Use their full name ' +
        'only when a formal or written context calls for it, such as drafting ' +
        'an email or a document.',
      BLOCK_END,
    ]
      .filter(Boolean)
      .join('\n');
  }

  /** Replace an existing managed block in place, else prepend a new one,
   *  leaving any user-authored content untouched. */
  private merge(current: string, block: string): string {
    const start = current.indexOf(BLOCK_START);
    const end = current.indexOf(BLOCK_END);
    if (start !== -1 && end > start) {
      const before = current.slice(0, start);
      const after = current.slice(end + BLOCK_END.length);
      return `${before}${block}${after}`.trim();
    }
    const rest = current.trim();
    return rest ? `${block}\n\n${rest}` : block;
  }

  private seenName(): string | null {
    try {
      return this.storage?.getItem(UserMemorySeeder.STORAGE_KEY) ?? null;
    } catch {
      return null;
    }
  }

  private rememberName(fullName: string): void {
    try {
      this.storage?.setItem(UserMemorySeeder.STORAGE_KEY, fullName);
    } catch {
      // private-mode / disabled storage: the merge step keeps us idempotent
    }
  }
}

/** Shared instance and convenience entry point used at app mount. */
export const userMemorySeeder = new UserMemorySeeder();
export const ensureUserNameMemory = (): Promise<void> => userMemorySeeder.ensure();
