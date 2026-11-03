import { describe, expect, it } from 'vitest';
import { driveAccessIsLimited } from './googleDriveAccess';

const FILE = 'https://www.googleapis.com/auth/drive.file';
const READONLY = 'https://www.googleapis.com/auth/drive.readonly';

describe('driveAccessIsLimited', () => {
  it('is limited when the token only carries drive.file', () => {
    expect(driveAccessIsLimited(`openid ${FILE}`)).toBe(true);
  });

  it('is not limited once drive.readonly or full drive was granted', () => {
    expect(driveAccessIsLimited(`openid ${FILE} ${READONLY}`)).toBe(false);
    expect(driveAccessIsLimited('https://www.googleapis.com/auth/drive')).toBe(false);
  });

  it('does not judge a connection with no stored scope', () => {
    expect(driveAccessIsLimited(undefined)).toBe(false);
    expect(driveAccessIsLimited('')).toBe(false);
  });
});
