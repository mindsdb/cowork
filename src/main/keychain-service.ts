import { buildKind } from './cowork-home';
import { getFallbackPassword, setFallbackPassword, deleteFallbackPassword } from './keychain-fallback';

// Load keytar lazily so importing helpers does not require native libsecret on Linux CI.
async function getKeytar() {
  return (await import('keytar')).default;
}

// Isolate OAuth tokens by channel; prod retains the existing cowork-oauth namespace.
const SERVICE_NAME = buildKind() === 'prod' ? 'cowork-oauth' : `cowork-oauth-${buildKind()}`;

function accountKey(engine: string, accountEmail: string): string {
  return `${engine}:${accountEmail}`;
}

// All keychain access falls back here when the OS secure store throws.
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

// ENG-1241: static credential names cannot collide with engine:accountEmail connector keys.
// See credential-provisioning.ts for rotation.
// deepcode ignore HardcodedNonCryptoSecret: '__generation__' is a public keychain account-key identifier (the keytar entry's *name*), not a secret value — the actual secrets live in the OS secure store, never in source. See credential-provisioning.ts.
const GENERATION_ACCOUNT_KEY = '__generation__'; // Reserved lowercase name cannot collide with uppercase static credential names.

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

// Store user-supplied MindsHub keys here and push them to the sidecar at runtime; see
// minds-credential.ts.
// This account name cannot collide with uppercase static names or engine:accountEmail connector
// keys.
const MINDS_ACCOUNT = '__minds__';

export async function getMindsApiKey(): Promise<string | null> {
  return getPassword(SERVICE_NAME, MINDS_ACCOUNT);
}

export async function setMindsApiKey(value: string): Promise<void> {
  await setPassword(SERVICE_NAME, MINDS_ACCOUNT, value);
}

export async function deleteMindsApiKey(): Promise<void> {
  await deletePassword(SERVICE_NAME, MINDS_ACCOUNT);
}
