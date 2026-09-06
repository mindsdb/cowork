import { useState, useCallback } from 'react';
import { fetchDatasources, fetchSavedConnection, deletePickedFile } from '../api';
import { host } from '../../platform/host';

// Shared Drive picker/connect flow for composer and project files.
// The caller renders account/connect prompts and resolves them through the returned handlers.
export function useGoogleDrivePicker({
  selectedProject,
  currentTask,
  setComposerAttachments,
  setActiveTaskId,
  setRoute,
}) {
  // Non-null while prompting which Google Drive account to use (more than
  // one google_drive connection exists) — set by chooseGoogleDriveConnection
  // and consumed by the modal the caller renders.
  const [driveAccountChoice, setDriveAccountChoice] = useState(null);

  // Non-null while confirming whether to connect Google Drive at all (no
  // google_drive connection exists yet) — { resolve }, set by
  // connectGoogleDriveThenRun and consumed by the ConfirmModal the caller
  // renders.
  const [driveConnectPrompt, setDriveConnectPrompt] = useState(null);

  // Return the matched connections so downstream selection can reuse this fetch.
  const fetchGoogleDriveConnections = useCallback(async () => {
    try {
      const { connections } = await fetchDatasources();
      return (connections || []).filter((c) => c.engine === 'google_drive');
    } catch {
      return [];
    }
  }, []);

  // Resolve the chosen connection, or null when the account prompt is dismissed.
  const chooseGoogleDriveConnection = useCallback((connections) => (
    new Promise((resolve) => setDriveAccountChoice({ connections, resolve }))
  ), []);

  // Reuse preFetched connections or read fresh; stale connector state can address the wrong grants.
  // Prompt when multiple Google accounts are connected.
  const resolveGoogleDriveConnection = useCallback(async (preFetched) => {
    try {
      const matches = preFetched || (await fetchGoogleDriveConnections());
      if (matches.length === 0) return null;
      if (matches.length === 1) return matches[0];
      const sorted = [...matches].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
      return await chooseGoogleDriveConnection(sorted);
    } catch {
      return null;
    }
  }, [chooseGoogleDriveConnection, fetchGoogleDriveConnections]);

  // Open the connected account's native Picker; optional projectName tags the granted references.
  // The host persists grants; files remain in Drive. Reuse preFetchedConnections to avoid another
  // lookup.
  const openGoogleDrivePicker = useCallback(async (projectName, preFetchedConnections) => {
    const conn = await resolveGoogleDriveConnection(preFetchedConnections);
    // Treat a dismissed account prompt as cancellation so callers do not show an error.
    if (!conn) return { ok: false, cancelled: true };
    let accountEmail = '';
    try {
      const detail = await fetchSavedConnection('google_drive', conn.name);
      accountEmail = detail?.fields?.account_email || '';
    } catch {
      return { ok: false, reason: 'Could not load the Google Drive connection.' };
    }
    if (!accountEmail) {
      return { ok: false, reason: 'Google Drive connection is missing an account email.' };
    }
    const result = await host.pickDriveFiles('google_drive', conn.name, accountEmail, undefined, projectName);
    if (!result?.ok) return { ok: false, reason: result?.reason || 'Google Drive picker failed.' };
    // files is the accumulated grant; newFiles contains only this pick and must be used for
    // current-message attachments.
    return { ok: true, files: result.files || [], newFiles: result.newFiles || [] };
  }, [resolveGoogleDriveConnection]);

  const addGoogleDriveFiles = useCallback(async (projectName, preFetchedConnections) => {
    const picked = await openGoogleDrivePicker(projectName, preFetchedConnections);
    if (!picked.ok) return picked;
    const files = picked.newFiles;
    if (files.length === 0) return { ok: true, files: [] };
    setComposerAttachments((prev) => {
      const seen = new Set(prev.map((a) => a.id));
      const fresh = files
        .map((f) => ({
          id: `gdrive-${f.id}`,
          source: 'gdrive',
          name: f.name,
          mime: f.mimeType,
          driveFileId: f.id,
          url: f.url,
        }))
        .filter((c) => !seen.has(c.id));
      return fresh.length ? [...prev, ...fresh] : prev;
    });
    return { ok: true, files };
  }, [openGoogleDrivePicker, setComposerAttachments]);

  // The host already saved the grant; projectName scopes the reference without downloading a
  // project file.
  const addGoogleDriveFileReferences = useCallback(async (projectName, preFetchedConnections) => {
    const picked = await openGoogleDrivePicker(projectName, preFetchedConnections);
    if (!picked.ok) return picked;
    return { ok: true, files: picked.files };
  }, [openGoogleDrivePicker]);

  // Background reads merge all accounts' project-tagged references without prompting for account
  // choice.
  // Stamp _connectionName so each row can remove its own grant; untagged connection-detail picks
  // stay excluded.
  const fetchGoogleDriveReferenceFiles = useCallback(async (projectName) => {
    try {
      const { connections } = await fetchDatasources();
      const matches = (connections || []).filter((c) => c.engine === 'google_drive');
      const perConnection = await Promise.all(matches.map(async (conn) => {
        try {
          const detail = await fetchSavedConnection('google_drive', conn.name);
          const raw = detail?.fields?._picked_files;
          const files = raw ? JSON.parse(raw) : [];
          if (!Array.isArray(files)) return [];
          return files
            .filter((f) => Array.isArray(f?.projects) && f.projects.includes(projectName))
            .map((f) => ({ ...f, _connectionName: conn.name }));
        } catch {
          return [];
        }
      }));
      return { ok: true, files: perConnection.flat() };
    } catch {
      return { ok: true, files: [] };
    }
  }, []);

  // Remove only this project's tag from the identified connection grant; other projects retain
  // their references.
  const removeGoogleDriveFileReference = useCallback(async (fileId, connectionName, projectName) => {
    if (!connectionName) return { ok: false, reason: 'Google Drive is not connected.' };
    try {
      await deletePickedFile('google_drive', connectionName, fileId, projectName);
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err?.message || 'Could not remove file.' };
    }
  }, []);

  // Confirm before opening Google OAuth in the OS browser, then continue the pending pick.
  // host.oauthConnect bounds and reports failures, so no outer timeout is needed.
  const connectGoogleDriveThenRun = useCallback(async (onConnected) => {
    const confirmed = await new Promise((resolve) => setDriveConnectPrompt({ resolve }));
    if (!confirmed) return;
    const result = await host.oauthConnect({ engine: 'google_drive', name: '' });
    if (!result?.ok) {
      throw new Error(result?.reason || 'Could not connect Google Drive.');
    }
    await onConnected();
  }, []);

  // Tag composer picks with its project so they also appear in Project files.
  // Use the same selectedProject/general fallback as handleSendFromHome.
  const handleAddGoogleDriveFiles = useCallback(async (projectName) => {
    const effectiveProjectName = projectName || selectedProject?.name || 'general';
    const matches = await fetchGoogleDriveConnections();
    if (matches.length > 0) {
      const res = await addGoogleDriveFiles(effectiveProjectName, matches);
      // Dismissing the account-choice modal is not an error — don't
      // surface it as one.
      if (res.cancelled) return;
      if (!res.ok) throw new Error(res.reason || 'Could not add Google Drive files.');
      return;
    }
    await connectGoogleDriveThenRun(() => addGoogleDriveFiles(effectiveProjectName));
  }, [fetchGoogleDriveConnections, addGoogleDriveFiles, connectGoogleDriveThenRun, selectedProject]);

  // Project files "+" menu entry point (right-rail Context card).
  const handleAddGoogleDriveProjectFiles = useCallback(async (projectName) => {
    const matches = await fetchGoogleDriveConnections();
    if (matches.length > 0) {
      const res = await addGoogleDriveFileReferences(projectName, matches);
      // Dismissing the account-choice modal is not an error — don't
      // surface it as one.
      if (res.cancelled) return res;
      if (!res.ok) throw new Error(res.reason || 'Could not add Google Drive files.');
      return res;
    }
    // Connecting no longer navigates away (see connectGoogleDriveThenRun) —
    // this just re-affirms the current task's route once files are added,
    // in case something else changed it during the OAuth wait.
    const returnToTaskId = currentTask?.id || null;
    await connectGoogleDriveThenRun(async () => {
      await addGoogleDriveFileReferences(projectName);
      if (returnToTaskId) {
        setActiveTaskId(returnToTaskId);
        setRoute('task');
      }
    });
  }, [fetchGoogleDriveConnections, addGoogleDriveFileReferences, connectGoogleDriveThenRun, currentTask, setActiveTaskId, setRoute]);

  return {
    driveAccountChoice,
    driveConnectPrompt,
    resolveDriveAccountChoice: (connection) => {
      driveAccountChoice?.resolve(connection);
      setDriveAccountChoice(null);
    },
    cancelDriveAccountChoice: () => {
      driveAccountChoice?.resolve(null);
      setDriveAccountChoice(null);
    },
    confirmDriveConnect: () => {
      driveConnectPrompt?.resolve(true);
      setDriveConnectPrompt(null);
    },
    cancelDriveConnect: () => {
      driveConnectPrompt?.resolve(false);
      setDriveConnectPrompt(null);
    },
    handleAddGoogleDriveFiles,
    handleAddGoogleDriveProjectFiles,
    fetchGoogleDriveReferenceFiles,
    removeGoogleDriveFileReference,
  };
}
