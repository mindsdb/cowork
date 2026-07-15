import { useState, useCallback } from 'react';
import { fetchDatasources, fetchSavedConnection, deletePickedFile } from '../api';
import { subscribe as subscribeDataVaultForm } from '../components/datavault/formStore';
import { host } from '../../platform/host';

// All Google Drive picker/connect orchestration used by the composer's "+"
// menu and the Project files (Context card) "+" menu. Owns the two modal
// prompts (account choice, connect confirmation) as state; the caller
// renders the actual modals and wires them to the resolver functions
// returned below.
//
// `selectedProject`/`currentTask` are read-only context this hook needs to
// pick a sensible project to tag files with and to return the user to their
// task after an inline connect; `setComposerAttachments`/`setActiveTaskId`/
// `setRoute` are the app-level state setters those flows drive;
// `handleConnectorPicked` is the shared (non-Drive-specific) connector-picker
// entry point reused here for the "not connected yet" path.
export function useGoogleDrivePicker({
  selectedProject,
  currentTask,
  setComposerAttachments,
  setActiveTaskId,
  setRoute,
  handleConnectorPicked,
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

  // Used to decide whether a "+" menu should route through the "connect"
  // flow or straight to the (possibly account-picking) action. Returns the
  // matched connections (not just a boolean) so the "already connected"
  // branch can pass them straight through to resolveGoogleDriveConnection
  // below instead of it doing a second, redundant fetchDatasources() round
  // trip right after this one.
  const fetchGoogleDriveConnections = useCallback(async () => {
    try {
      const { connections } = await fetchDatasources();
      return (connections || []).filter((c) => c.engine === 'google_drive');
    } catch {
      return [];
    }
  }, []);

  // Prompts the user to pick which Google Drive account to use when more
  // than one is connected. Resolves to the chosen connection, or null if
  // they dismiss the modal — resolveGoogleDriveConnection below returns
  // null in that case, same as a genuine race where the connection
  // disappeared mid-flow, and callers already handle that.
  const chooseGoogleDriveConnection = useCallback((connections) => (
    new Promise((resolve) => setDriveAccountChoice({ connections, resolve }))
  ), []);

  // Resolves the google_drive connection every Drive helper below targets.
  // `preFetched`, when passed (by the "already connected" branch in the
  // handlers below, which just called fetchGoogleDriveConnections() for its
  // own check), is reused instead of fetching again — otherwise fetches
  // fresh via fetchDatasources() rather than trusting the (possibly stale)
  // `connectors` state, since a stale/defunct connection name would
  // silently persist grants/reads against the wrong record. If more than
  // one google_drive connection exists (e.g. two Google accounts), prompts
  // the user to choose.
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

  // Opens the Google Picker for an already-connected google_drive
  // connection and adds the chosen files as reference-only chips to
  // whichever composer is currently visible (composerAttachments is shared
  // across Home/Task/Projects — see resolveComposerAttachmentsForSend).
  //
  // Shared by both entry points below (composer chips + project files):
  // resolves the google_drive connection's account email and opens the
  // native Picker. Neither caller downloads/persists anything here.
  // `projectName`, when passed, tags any newly-picked files as belonging to
  // that project (see picked-files.ts / merge_picked_files) — omit it for
  // flows with no project context (there are none among the callers below,
  // but connection-details' own "Pick files" button calls
  // host.pickDriveFiles directly and correctly omits it).
  // `preFetchedConnections`, when passed, skips resolveGoogleDriveConnection's
  // own fetchDatasources() call — see fetchGoogleDriveConnections above.
  const openGoogleDrivePicker = useCallback(async (projectName, preFetchedConnections) => {
    const conn = await resolveGoogleDriveConnection(preFetchedConnections);
    // Callers only reach here once fetchGoogleDriveConnections() has
    // already confirmed a connection exists, so a null result here means
    // the user dismissed the account-choice modal — not a real failure.
    // `cancelled` lets handleAddGoogleDriveFiles/ProjectFiles treat this as
    // a silent no-op instead of surfacing an error.
    if (!conn) return { ok: false, cancelled: true };
    let accountEmail = '';
    try {
      const detail = await fetchSavedConnection('google_drive', conn.name);
      accountEmail = detail?.fields?.account_email || '';
    } catch {
      return { ok: false, reason: 'Could not load the Google Drive connection.' };
    }
    if (!accountEmail) return { ok: false, reason: 'Google Drive connection is missing an account email.' };
    const result = await host.pickDriveFiles('google_drive', conn.name, accountEmail, undefined, projectName);
    if (!result?.ok) return { ok: false, reason: result?.reason || 'Google Drive picker failed.' };
    // `files` is the connection's full accumulated grant (every file ever
    // picked, for callers like Project files that want to show the whole
    // list); `newFiles` is only what the user selected just now — use that
    // one for anything scoped to "this" action (e.g. attaching to the
    // current message), not the merged history.
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

  // Project files entry point: no download, no export — the picked file
  // stays in Drive. `openGoogleDrivePicker` already persists the grant
  // server-side (savePickedFiles, inside host.pickDriveFiles's IPC
  // handler), so there's nothing else to do here; the file just becomes
  // visible as a reference row (see ContextCard). `projectName` is required
  // here — this is what scopes the file to the project it was actually
  // added from.
  const addGoogleDriveFileReferences = useCallback(async (projectName, preFetchedConnections) => {
    const picked = await openGoogleDrivePicker(projectName, preFetchedConnections);
    if (!picked.ok) return picked;
    return { ok: true, files: picked.files };
  }, [openGoogleDrivePicker]);

  // Lets ContextCard show the *current* picked-files list on mount/refresh,
  // not just right after a fresh pick — scoped to just the files tagged
  // with this project (see merge_picked_files). Files picked from
  // connection-details (no project tag) never show here, by design. This is
  // a passive/background read (fires on mount, not a user click), so it
  // deliberately does NOT use the prompting resolveGoogleDriveConnection —
  // it merges every connected account's tagged files instead of
  // interrupting the user with a modal just for opening a task. Each
  // returned file carries `_connectionName` so removeGoogleDriveFileReference
  // knows which connection to delete from.
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

  // "Delete" for a Drive reference row — same user-facing action as
  // deleteProjectFile for a real project file, just against the
  // connection's _picked_files grant instead of the project folder.
  // `connectionName` comes from the row's `_connectionName` (stamped by
  // fetchGoogleDriveReferenceFiles above) — no account-choice prompt needed
  // here since the row already identifies its own connection. Only untags
  // `projectName` from the file (server-side) — a file also tagged to
  // another project stays visible there; see deletePickedFile/remove_picked_file.
  const removeGoogleDriveFileReference = useCallback(async (fileId, connectionName, projectName) => {
    if (!connectionName) return { ok: false, reason: 'Google Drive is not connected.' };
    try {
      await deletePickedFile('google_drive', connectionName, fileId, projectName);
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err?.message || 'Could not remove file.' };
    }
  }, []);

  // Shared by both "+" menu entry points below: not connected yet →
  // confirm the user actually wants to leave the app for Google's connect
  // flow (it opens the OS browser, not an in-app screen), then open the
  // same imperative connect flow the connector picker uses, then
  // auto-resume `onConnected` once that form reports success, so the user
  // doesn't have to click "Add files" a second time.
  const connectGoogleDriveThenRun = useCallback(async (onConnected) => {
    const confirmed = await new Promise((resolve) => setDriveConnectPrompt({ resolve }));
    if (!confirmed) return;
    const tempId = await handleConnectorPicked({ id: 'google_drive' });
    if (!tempId) return;
    const CONNECT_RESUME_TIMEOUT_MS = 5 * 60 * 1000;
    // Callers `await` this whole function expecting it to cover the full
    // connect-then-pick flow (e.g. so they can reload the file list right
    // after) — resolving as soon as the connect tab merely OPENS, before
    // OAuth/picking actually finish, made callers reload against a
    // stale/empty list. Wrap the subscription in a promise so this only
    // resolves once onConnected() has actually run (or the timeout gives up).
    await new Promise((resolve, reject) => {
      let unsubscribe = () => {};
      const timeoutId = setTimeout(() => { unsubscribe(); resolve(); }, CONNECT_RESUME_TIMEOUT_MS);
      unsubscribe = subscribeDataVaultForm(tempId, async (spec) => {
        const engine = spec?.engine || spec?._connector_id;
        if (!spec?._is_success || engine !== 'google_drive') return;
        clearTimeout(timeoutId);
        unsubscribe();
        // Both the timeout and cancel paths above always resolve — if
        // onConnected() throws (e.g. an unguarded IPC rejection deep in
        // openGoogleDrivePicker) this must reject rather than leave the
        // promise settled by nothing, which would hang the caller's busy
        // state forever instead of surfacing the error like every other
        // failure path in this flow does.
        try {
          await onConnected();
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });
  }, [handleConnectorPicked]);

  // Composer "+" menu entry point. `projectName` comes from the Composer's
  // own `project` prop (Home/Task/Projects all pass one) — tags the picked
  // file(s) so they also show under that project's Project files, matching
  // the composer/project-files parity the user expects. Falls back to
  // `selectedProject`/'general' the same way handleSendFromHome does, since
  // Home's `project` can be null before the user has explicitly picked one.
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
    // Connecting routes away to a temporary task — remember where to come
    // back to so the user isn't left staring at "Connect Google Drive"
    // once their file references are added.
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
