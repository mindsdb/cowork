// Composer attachment lifecycle — files, URLs, snippets, project files,
// connectors.
//
// Ported from anton-cowork's useAttachments hook, extended with antontron's
// connector (datasource) attachment support.

import { useState, useCallback } from 'react';
import {
  uploadAttachments,
  createSnippetAttachment,
  createUrlAttachment,
  fetchProjectFiles,
  attachProjectFile,
  deleteAttachment,
} from '../api';

export default function useAttachments(getProjectPath, getSessionId) {
  const [composerAttachments, setComposerAttachments] = useState([]);

  const handleAttachFiles = useCallback(async (files) => {
    const data = await uploadAttachments(files, {
      projectPath: getProjectPath(),
      sessionId: getSessionId(),
    });
    setComposerAttachments((prev) => [...prev, ...(data.attachments || [])]);
  }, [getProjectPath, getSessionId]);

  const handleAttachUrl = useCallback(async (url) => {
    const data = await createUrlAttachment({
      url,
      project_path: getProjectPath(),
      session_id: getSessionId(),
    });
    setComposerAttachments((prev) => [...prev, data.attachment]);
  }, [getProjectPath, getSessionId]);

  const handleAttachSnippet = useCallback(async ({ title, content }) => {
    const data = await createSnippetAttachment({
      title,
      content,
      project_path: getProjectPath(),
      session_id: getSessionId(),
    });
    setComposerAttachments((prev) => [...prev, data.attachment]);
  }, [getProjectPath, getSessionId]);

  const handleBrowseProjectFiles = useCallback(async (query) => {
    const projectPath = getProjectPath();
    if (!projectPath) return { files: [] };
    return fetchProjectFiles(projectPath, query);
  }, [getProjectPath]);

  const handleAttachProjectFile = useCallback(async (path) => {
    const data = await attachProjectFile({
      project_path: getProjectPath(),
      path,
      session_id: getSessionId(),
    });
    setComposerAttachments((prev) => [...prev, data.attachment]);
  }, [getProjectPath, getSessionId]);

  const handleAttachConnector = useCallback(async (connector) => {
    const label = connector.displayName || connector.engine;
    const title = `Connector \u00b7 ${connector.name}`;
    const content = `Use the "${connector.name}" datasource (${label}) for this task. Connection metadata is loaded from the local data vault.`;
    const data = await createSnippetAttachment({
      title,
      content,
      project_path: getProjectPath(),
      session_id: getSessionId(),
    });
    const attachment = data?.attachment
      ? { ...data.attachment, kind: 'connector', name: connector.name }
      : null;
    if (attachment) setComposerAttachments((prev) => [...prev, attachment]);
  }, [getProjectPath, getSessionId]);

  const handleRemoveAttachment = useCallback(async (id) => {
    setComposerAttachments((prev) => prev.filter((a) => a.id !== id));
    try {
      await deleteAttachment(id);
    } catch {
      // UI already removed it; stale server cleanup is harmless.
    }
  }, []);

  const clearAttachments = useCallback(() => {
    setComposerAttachments([]);
  }, []);

  return {
    composerAttachments,
    clearAttachments,
    handleAttachFiles,
    handleAttachUrl,
    handleAttachSnippet,
    handleBrowseProjectFiles,
    handleAttachProjectFile,
    handleAttachConnector,
    handleRemoveAttachment,
  };
}
