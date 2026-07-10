import keytar from 'keytar';

const SERVICE_NAME = 'cowork-oauth';

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
