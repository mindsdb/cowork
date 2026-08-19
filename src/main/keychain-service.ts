import { buildKind } from './cowork-home';
import { getFallbackPassword, setFallbackPassword, deleteFallbackPassword } from './keychain-fallback';

// keytar is a native module — an eager top-level import forces every consumer
// of this file (even one that never touches the keychain) to load that native
// binding at module-load time, which fails on Linux CI without libsecret.
// Load it lazily so importing this module (directly or transitively) stays
// safe everywhere; the native module only loads when a function below
// actually runs. `import()` is still intercepted by `vi.mock('keytar', ...)`
// the same way a static import would be, so keychain-service.test.ts is
// unaffected.
async function getKeytar() {
  return (await import('keytar')).default;
}

// Namespace the keychain service per channel so build kinds on one machine don't
// share OAuth refresh tokens. prod keeps the historical 'cowork-oauth' (existing
// users' entries live there); non-prod kinds get 'cowork-oauth-<kind>'.
const SERVICE_NAME = buildKind() === 'prod' ? 'cowork-oauth' : `cowork-oauth-${buildKind()}`;

function accountKey(engine: string, accountEmail: string): string {
  return `${engine}:${accountEmail}`;
}

// keytar needs a working OS secure-store backend - macOS Keychain, Windows
// Credential Manager, or on Linux a Secret Service provider (gnome-keyring,
// kwalletd) reachable over D-Bus. Any of these can be genuinely absent, most
// commonly on Linux (minimal window managers, headless boxes, containers),
// and keytar throws rather than returning null. These three helpers are the
// single seam every export below goes through, so falling back to an
// encrypted file here (see keychain-fallback.ts) covers refresh tokens and
// the ENG-1241 static credentials/generation marker alike.
async function getPassword(service: string, account: string): Promise<string | null> {
  let value: string | null;
  try {
    const keytar = await getKeytar();
    value = await keytar.getPassword(service, account);
  } catch (err) {
    console.warn(`[keychain-service] keytar.getPassword failed for ${service}, using file fallback:`, err);
    return getFallbackPassword(service, account);
  }
  // Not found in the real keychain - check the fallback in case this entry
  // was written there during a prior outage (keytar throwing at write time)
  // and the real keychain never received it.
  return value !== null ? value : getFallbackPassword(service, account);
}

async function setPassword(service: string, account: string, value: string): Promise<void> {
  try {
    const keytar = await getKeytar();
    await keytar.setPassword(service, account, value);
    // Real write succeeded - clear any stale fallback copy so a later
    // real-keychain deletion can never be shadowed by an old fallback value.
    deleteFallbackPassword(service, account);
  } catch (err) {
    console.warn(`[keychain-service] keytar.setPassword failed for ${service}, using file fallback:`, err);
    setFallbackPassword(service, account, value);
  }
}

async function deletePassword(service: string, account: string): Promise<void> {
  try {
    const keytar = await getKeytar();
    await keytar.deletePassword(service, account);
  } catch (err) {
    console.warn(`[keychain-service] keytar.deletePassword failed for ${service}:`, err);
  }
  // Always clear the fallback entry too - a prior setPassword may have
  // written there regardless of how this delete's own keytar call went.
  deleteFallbackPassword(service, account);
}

export async function getRefreshToken(engine: string, accountEmail: string): Promise<string | null> {
  return getPassword(SERVICE_NAME, accountKey(engine, accountEmail));
}

export async function setRefreshToken(engine: string, accountEmail: string, token: string): Promise<void> {
  await setPassword(SERVICE_NAME, accountKey(engine, accountEmail), token);
}

export async function deleteRefreshToken(engine: string, accountEmail: string): Promise<void> {
  await deletePassword(SERVICE_NAME, accountKey(engine, accountEmail));
}

// ENG-1241: the 15 static OAuth client id/secret values that used to ship in
// a world-readable server-credentials.json inside the app bundle now live
// here too, alongside per-connector refresh tokens — same service, disjoint
// account-key shape (the credential's own name, e.g. GITHUB_CLIENT_SECRET,
// vs. the `engine:accountEmail` shape above), so the two can never collide.
// See credential-provisioning.ts for the provisioning/rotation logic that
// calls these.
// deepcode ignore HardcodedNonCryptoSecret: '__generation__' is a public keychain account-key identifier (the keytar entry's *name*), not a secret value — the actual secrets live in the OS secure store, never in source. See credential-provisioning.ts.
const GENERATION_ACCOUNT_KEY = '__generation__'; // reserved — never a valid
// credential name (those are always uppercase env-var-style), so this can
// never collide with a real entry.

export async function getStaticCredential(name: string): Promise<string | null> {
  return getPassword(SERVICE_NAME, name);
}

export async function setStaticCredential(name: string, value: string): Promise<void> {
  await setPassword(SERVICE_NAME, name, value);
}

export async function getGenerationMarker(): Promise<string | null> {
  return getPassword(SERVICE_NAME, GENERATION_ACCOUNT_KEY);
}

export async function setGenerationMarker(generation: string): Promise<void> {
  await setPassword(SERVICE_NAME, GENERATION_ACCOUNT_KEY, generation);
}
