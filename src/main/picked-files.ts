// Persist Picker-granted files in the connection vault; inject_env also exposes them to the agent.

import { getServerPort } from './server-process';
import { authHeader } from './server-auth';

export interface PickedFile {
  id: string;
  name: string;
  mimeType?: string;
  iconUrl?: string;
  url?: string;
  // Required by Drive API alongside `id` for many files not owned by the
  // connecting account (link-shared docs especially) — see checkFileAccess.
  resourceKey?: string | null;
  // Project memberships scope the files rail; connection-details picks have no project context.
  projects?: string[];
}

export interface FailedPick {
  id: string;
  name: string;
  reason: string;
}

async function checkFileAccess(accessToken: string, fileId: string, resourceKey?: string | null): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}` };
    if (resourceKey) headers['X-Goog-Drive-Resource-Keys'] = `${fileId}/${resourceKey}`;
    // Shared Drive files require supportsAllDrives=true or files.get can return a misleading 404.
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id&supportsAllDrives=true`,
      { headers },
    );
    if (res.ok) return { ok: true };
    const body = await res.json().catch(() => null) as { error?: { errors?: { reason?: string }[]; status?: string } } | null;
    const reason = body?.error?.errors?.[0]?.reason || body?.error?.status || `HTTP ${res.status}`;
    return { ok: false, reason };
  } catch (err: any) {
    return { ok: false, reason: err?.message || 'network error' };
  }
}

// Picker grants can lag the PICKED callback; retry read checks before treating a 404 as final.
const VERIFY_RETRY_DELAYS_MS = [800, 1600, 3200];

// Confirm readability before persisting picks; the PICKED callback alone does not prove a grant
// succeeded.
export async function verifyPickedFiles(
  accessToken: string,
  files: PickedFile[],
): Promise<{ verified: PickedFile[]; failed: FailedPick[] }> {
  const verified: PickedFile[] = [];
  const failed: FailedPick[] = [];

  await Promise.all(files.map(async (file) => {
    let result = await checkFileAccess(accessToken, file.id, file.resourceKey);
    for (let attempt = 0; !result.ok && attempt < VERIFY_RETRY_DELAYS_MS.length; attempt++) {
      await new Promise((r) => setTimeout(r, VERIFY_RETRY_DELAYS_MS[attempt]));
      result = await checkFileAccess(accessToken, file.id, file.resourceKey);
    }
    if (result.ok) verified.push(file);
    else {
      // Distinguish a missing Picker resourceKey from a rejected request that already supplied one.
      const rk = file.resourceKey ? 'has resourceKey' : 'no resourceKey';
      failed.push({ id: file.id, name: file.name, reason: `${result.reason}, ${rk}` });
    }
  }));

  return { verified, failed };
}

export async function getPickedFiles(engine: string, name: string): Promise<PickedFile[]> {
  try {
    const res = await fetch(
      `http://127.0.0.1:${getServerPort()}/api/v1/connectors/connections/${engine}/${name}`,
      { headers: authHeader() },
    );
    if (!res.ok) return [];
    const data = await res.json() as { fields?: Record<string, string> };
    const raw = data.fields?._picked_files;
    if (!raw) return [];
    try { return JSON.parse(raw); } catch { return []; }
  } catch {
    return [];
  }
}

export type SavePickedFilesResult =
  | { ok: true; files: PickedFile[] }
  | { ok: false; reason: string };

// Return the server’s merged list. Callers must treat ok:false as not persisted, never as a
// successful grant.
export async function savePickedFiles(engine: string, name: string, newFiles: PickedFile[]): Promise<SavePickedFilesResult> {
  try {
    const res = await fetch(
      `http://127.0.0.1:${getServerPort()}/api/v1/connectors/connections/${engine}/${name}/picked-files`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ files: newFiles }),
      },
    );
    if (!res.ok) return { ok: false, reason: `Failed to save picked files (${res.status}).` };
    const data = await res.json() as { files?: PickedFile[] };
    return { ok: true, files: data.files || newFiles };
  } catch (err: any) {
    return { ok: false, reason: err?.message || 'Could not save picked files.' };
  }
}
