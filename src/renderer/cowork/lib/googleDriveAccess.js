const DRIVE_READ_SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive',
];

/* Google lets the user untick each scope on its consent screen, and
   connections made before drive.readonly was requested only carry
   drive.file. No stored scope reads as not limited: nothing to judge by. */
export function driveAccessIsLimited(scope) {
  const granted = String(scope || '').split(/\s+/).filter(Boolean);
  return granted.length > 0 && !granted.some((s) => DRIVE_READ_SCOPES.includes(s));
}
