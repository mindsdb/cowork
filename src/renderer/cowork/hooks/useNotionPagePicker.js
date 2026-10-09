import { useState, useCallback } from 'react';
import { deletePickedFile, fetchDatasources, fetchSavedConnection, savePickedFiles } from '../api';
import { host } from '../../platform/host';
import { connectViaWebRedirect } from '../lib/connectViaWebRedirect';

// "Add pages from Notion", from the composer "+" menu and the Project files
// "+" menu. Unlike Google Drive there is nothing to grant: a Notion
// connection already reaches every page the user can, so this lets them
// choose pages (NotionPagePickerModal) and records them on the connection's
// `_picked_files`, tagged with the project, the same list Drive uses. That
// list feeds the Project files rail and the agent's per-turn prompt, which
// reads the pages with notion-fetch. Owns the picker and connect-confirmation
// prompts as state; the caller renders the modals and wires them to the
// resolvers returned below.
export function useNotionPagePicker({ selectedProject, setComposerAttachments }) {
  // { connections, resolve } while the page picker is open.
  const [notionPicker, setNotionPicker] = useState(null);
  // { resolve } while asking whether to connect Notion first.
  const [notionConnectPrompt, setNotionConnectPrompt] = useState(null);

  const fetchNotionConnections = useCallback(async () => {
    try {
      const { connections } = await fetchDatasources();
      return (connections || []).filter((c) => c.engine === 'notion');
    } catch {
      return [];
    }
  }, []);

  // A failure means nothing was recorded for at least one workspace, so the
  // caller must not report the pages as added to the project.
  const savePagesToProject = useCallback(async (pages, projectName) => {
    const byConnection = new Map();
    for (const p of pages) {
      const entries = byConnection.get(p.connectionName) || [];
      entries.push({ id: p.id, name: p.title || 'Untitled', url: p.url, projects: [projectName] });
      byConnection.set(p.connectionName, entries);
    }
    await Promise.all([...byConnection].map(([name, entries]) => savePickedFiles('notion', name, entries)));
  }, []);

  const pickPages = useCallback(
    (connections) => new Promise((resolve) => setNotionPicker({ connections, resolve })),
    [],
  );

  const addPagesToComposer = useCallback((pages) => {
    setComposerAttachments((prev) => {
      const seen = new Set(prev.map((a) => a.id));
      const fresh = pages
        .map((p) => ({
          id: `notion-${p.id}`,
          source: 'notion',
          name: p.title,
          notionPageId: p.id,
          url: p.url,
          workspace: p.workspace,
        }))
        .filter((c) => !seen.has(c.id));
      return fresh.length ? [...prev, ...fresh] : prev;
    });
  }, [setComposerAttachments]);

  // Runs `run(connections)` with the Notion connections, connecting Notion
  // first (after a confirmation) when there are none.
  const withNotionConnections = useCallback(async (run) => {
    const matches = await fetchNotionConnections();
    if (matches.length > 0) return run(matches);
    const confirmed = await new Promise((resolve) => setNotionConnectPrompt({ resolve }));
    if (!confirmed) return undefined;
    if (host.isWeb) {
      await connectViaWebRedirect('notion', 'Notion');
    } else {
      const result = await host.oauthConnect({ engine: 'notion', name: '' });
      if (!result?.ok) throw new Error(result?.reason || 'Could not connect Notion.');
    }
    return run(await fetchNotionConnections());
  }, [fetchNotionConnections]);

  // Composer entry point. Like Drive, the pages also join the project's
  // files; same project fallback as handleAddGoogleDriveFiles.
  const handleAddNotionPages = useCallback(async (projectName) => {
    const effectiveProjectName = projectName || selectedProject?.name || 'general';
    await withNotionConnections(async (connections) => {
      const pages = await pickPages(connections);
      if (!pages?.length) return;
      // The chips work without the project record, so they go on first.
      addPagesToComposer(pages);
      try {
        await savePagesToProject(pages, effectiveProjectName);
      } catch {
        throw new Error('The pages were added to this message, but could not be saved to the project files.');
      }
    });
  }, [selectedProject, withNotionConnections, pickPages, addPagesToComposer, savePagesToProject]);

  // Project files "+" menu entry point.
  const handleAddNotionProjectPages = useCallback(async (projectName) => {
    await withNotionConnections(async (connections) => {
      const pages = await pickPages(connections);
      if (!pages?.length) return;
      await savePagesToProject(pages, projectName);
    });
  }, [withNotionConnections, pickPages, savePagesToProject]);

  // The project's pages across every Notion connection, for the rail. Each
  // carries `_connectionName` so removal knows which connection to untag.
  const fetchNotionProjectPages = useCallback(async (projectName) => {
    const connections = await fetchNotionConnections();
    const perConnection = await Promise.all(connections.map(async (conn) => {
      try {
        const detail = await fetchSavedConnection('notion', conn.name);
        const raw = detail?.fields?._picked_files;
        const pages = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(pages)) return [];
        return pages
          .filter((p) => Array.isArray(p?.projects) && p.projects.includes(projectName))
          .map((p) => ({ ...p, _connectionName: conn.name }));
      } catch {
        return [];
      }
    }));
    return { ok: true, files: perConnection.flat() };
  }, [fetchNotionConnections]);

  const removeNotionProjectPage = useCallback(async (pageId, connectionName, projectName) => {
    if (!connectionName) return { ok: false, reason: 'Notion is not connected.' };
    try {
      await deletePickedFile('notion', connectionName, pageId, projectName);
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err?.message || 'Could not remove the page.' };
    }
  }, []);

  return {
    notionPicker,
    notionConnectPrompt,
    resolveNotionPicker: (pages) => {
      notionPicker?.resolve(pages);
      setNotionPicker(null);
    },
    cancelNotionPicker: () => {
      notionPicker?.resolve(null);
      setNotionPicker(null);
    },
    confirmNotionConnect: () => {
      notionConnectPrompt?.resolve(true);
      setNotionConnectPrompt(null);
    },
    cancelNotionConnect: () => {
      notionConnectPrompt?.resolve(false);
      setNotionConnectPrompt(null);
    },
    handleAddNotionPages,
    handleAddNotionProjectPages,
    fetchNotionProjectPages,
    removeNotionProjectPage,
  };
}
