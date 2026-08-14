import keytar from 'keytar';
import { buildKind } from './cowork-home';

// Namespace the keychain service per channel so build kinds on one machine don't
// share OAuth refresh tokens. prod keeps the historical 'cowork-oauth' (existing
// users' entries live there); non-prod kinds get 'cowork-oauth-<kind>'.
const SERVICE_NAME = buildKind() === 'prod' ? 'cowork-oauth' : `cowork-oauth-${buildKind()}`;

function accountKey(engine: string, accountEmail: string): string {
  return `${engine}:${accountEmail}`;
}

export async function getRefreshToken(engine: string, accountEmail: string): Promise<string | null> {
  return keytar.getPassword(SERVICE_NAME, accountKey(engine, accountEmail));
}

export async function setRefreshToken(engine: string, accountEmail: string, token: string): Promise<void> {
  await keytar.setPassword(SERVICE_NAME, accountKey(engine, accountEmail), token);
}

export async function deleteRefreshToken(engine: string, accountEmail: string): Promise<void> {
  await keytar.deletePassword(SERVICE_NAME, accountKey(engine, accountEmail));
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
  return keytar.getPassword(SERVICE_NAME, name);
}

export async function setStaticCredential(name: string, value: string): Promise<void> {
  await keytar.setPassword(SERVICE_NAME, name, value);
}

export async function getGenerationMarker(): Promise<string | null> {
  return keytar.getPassword(SERVICE_NAME, GENERATION_ACCOUNT_KEY);
}

export async function setGenerationMarker(generation: string): Promise<void> {
  await keytar.setPassword(SERVICE_NAME, GENERATION_ACCOUNT_KEY, generation);
}
