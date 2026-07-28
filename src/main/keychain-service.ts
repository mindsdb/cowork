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
