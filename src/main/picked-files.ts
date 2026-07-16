// Persists which Drive files the user granted access to via the Google
// Picker (drive.file scope only covers files the app created itself, so
// this is the durable record of what else the user has explicitly
// picked). Stored server-side as a vault field on the connection, which
// also means it flows into the agent's DS_<ENGINE>_<NAME>__PICKED_FILES
// env var for free via the existing inject_env plumbing.

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
  // Project(s) this file was explicitly added to (composer or a
  // project's Project files rail) — empty when only ever picked from
  // connection-details, which has no project context. Drives per-
  // project scoping of the Project files display.
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
    // supportsAllDrives=true is required for files.get() to see files that
    // live in a Shared Drive at all — without it Drive API returns a plain
    // 404 notFound, indistinguishable from a real missing-grant failure,
    // regardless of the caller's actual permissions.
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

// Google's per-file grant from a Picker selection isn't necessarily
// visible to files.get() the instant the PICKED callback fires — an
// immediate check can 404 (`notFound`) purely from replication lag, not
// because the grant actually failed. Retry with backoff before treating
// a failure as final.
const VERIFY_RETRY_DELAYS_MS = [800, 1600, 3200];

// The Picker's PICKED callback firing doesn't always mean Google actually
// completed the per-file grant — we've seen files come back from a picker
// session that still 403 with `appNotAuthorizedToFile` when the agent
// later tries to read them. Confirm each newly picked file is actually
// readable with the token we just minted before persisting it as picked,
// so a broken grant surfaces immediately (with a clear reason) instead of
// silently sitting in the list until someone asks Anton to use it.
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
      // Surface whether Picker actually gave us a resourceKey for this
      // file — distinguishes "we have one and Google still rejects it"
      // (a deeper permission/trust issue) from "Picker never returned one"
      // (nothing for us to send in the first place).
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

// Merges newly picked files into the connection's persisted list and
// returns the authoritative merged list from the server. Callers must
// treat `ok: false` as "nothing was actually persisted" — the caller
// (IPC handler) must not report success to the renderer when this fails,
// since the UI would otherwise show the files as granted even though the
// server never recorded them.
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
