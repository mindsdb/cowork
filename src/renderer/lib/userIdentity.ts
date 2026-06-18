// Seeds the signed-in user's name into agent memory so the agent can address
// them personally: their first name in conversation, their full name when a
// written/formal context needs it (e.g. drafting an email).
//
// The name comes from the Keycloak JWT (`host.getAccessToken()` works in both
// Electron and web). Nothing is sent to an external service: we only write to
// the local cowork-server shared memory store via the /memory endpoint.

import { host } from '../platform/host';
import {
  fetchMemory,
  saveMemory,
  findMemoryEntry,
  type MemorySection,
} from '../cowork/api';

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

/** Stable key for the global profile slot in normalised memory listings. */
const GLOBAL_PROFILE_PATH = 'Global:global:profile';

// Fences the block we manage so re-seeding replaces it in place instead of
// appending duplicates, and never disturbs anything the user added.
const BLOCK_START = '<!-- cowork:user-identity -->';
const BLOCK_END = '<!-- /cowork:user-identity -->';

const TOKEN_RETRY_ATTEMPTS = 12;
const TOKEN_RETRY_DELAY_MS = 500;

/** Wait for the Keycloak access token to become available after boot. */
async function resolveAccessToken(): Promise<string | null> {
  for (let attempt = 0; attempt < TOKEN_RETRY_ATTEMPTS; attempt += 1) {
    const token = await host.getAccessToken();
    if (token) return token;
    if (attempt < TOKEN_RETRY_ATTEMPTS - 1) {
      await new Promise((resolve) => setTimeout(resolve, TOKEN_RETRY_DELAY_MS));
    }
  }
  // Electron boot path: silent refresh may still be running in main.
  if (host.isElectron) {
    try {
      const refreshed = await host.mindshubRefresh();
      if (refreshed.ok && refreshed.access_token) return refreshed.access_token;
    } catch {
      // fall through
    }
  }
  return null;
}

type TokenReader = () => Promise<string | null>;
type MemoryReader = () => Promise<{ sections?: MemorySection[] }>;
type MemoryWriter = (payload: {
  scope: string;
  category: string;
  content: string;
}) => Promise<unknown>;

interface SeederDeps {
  getToken?: TokenReader;
  readMemory?: MemoryReader;
  writeMemory?: MemoryWriter;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
}

/**
 * Ensures the signed-in user's name is present in shared global profile memory.
 *
 * Idempotent via the marker-fenced block in profile memory (localStorage is
 * a secondary hint only). Safe to call on every app mount; it no-ops when no
 * authenticated name is available (e.g. BYOK-only users with no Keycloak JWT).
 */
export class UserMemorySeeder {
  private static readonly STORAGE_KEY = 'cowork.memory.profile.userName';

  private readonly getToken: TokenReader;
  private readonly readMemory: MemoryReader;
  private readonly writeMemory: MemoryWriter;
  private readonly storage?: Pick<Storage, 'getItem' | 'setItem'>;

  constructor(deps: SeederDeps = {}) {
    this.getToken = deps.getToken ?? resolveAccessToken;
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

      const current = await this.readCurrent();
      if (this.isIdentitySeeded(current, name)) {
        this.rememberName(name.full);
        return;
      }

      const next = this.merge(current, this.renderBlock(name));
      if (next.trim() !== current.trim()) {
        await this.writeMemory({
          scope: 'Global',
          category: 'profile',
          content: next,
        });
      }
      this.rememberName(name.full);
    } catch {
      // Personalization is best-effort; never block the app on it.
    }
  }

  /** True when profile already contains our managed block for this name. */
  private isIdentitySeeded(current: string, name: UserName): boolean {
    const start = current.indexOf(BLOCK_START);
    const end = current.indexOf(BLOCK_END);
    if (start === -1 || end <= start) return false;
    const block = current.slice(start, end + BLOCK_END.length);
    return block.includes(`The user's first name is ${name.first}.`);
  }

  private async readCurrent(): Promise<string> {
    const memory = await this.readMemory();
    const file = findMemoryEntry(memory?.sections ?? [], GLOBAL_PROFILE_PATH);
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
