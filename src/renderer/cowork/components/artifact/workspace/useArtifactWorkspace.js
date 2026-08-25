import { useCallback, useEffect, useMemo, useState } from 'react';
import { host } from '../../../../platform/host';
import {
  cancelAgentRepair,
  canUseArtifactWorkspace,
  decideAgentRepair,
  enableDraftComments,
  loadAgentRepair,
  loadArtifactRevision,
  loadArtifactRevisions,
  loadArtifactSource,
  requestAgentRepair,
  restoreArtifactRevision,
  saveArtifactSource,
} from '../../../lib/artifactWorkspaceApi';

const OWNER_CAPABILITIES = {
  role: 'owner',
  canPreview: true,
  canComment: true,
  canEdit: true,
  canAddressWithAgent: true,
  canResolveComments: true,
};

export function useArtifactWorkspace(artifact, { open, onChange } = {}) {
  const supported = canUseArtifactWorkspace(artifact);
  const [mode, setMode] = useState('preview');
  const [source, setSource] = useState(null);
  const [reviewRevision, setReviewRevision] = useState(null);
  const [draft, setDraft] = useState('');
  const [revisions, setRevisions] = useState([]);
  const [capabilities, setCapabilities] = useState(null);
  const [commentsReady, setCommentsReady] = useState(false);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(null);
  const [comparison, setComparison] = useState(null);
  const [repair, setRepair] = useState(null);

  const dirty = !!source && draft !== source.content;
  const currentRevision = source?.revision || reviewRevision;

  const refreshHistory = useCallback(async (path = source?.path) => {
    if (!supported) return [];
    const data = await loadArtifactRevisions(artifact, path || null);
    const next = data?.revisions || [];
    setRevisions(next);
    return next;
  }, [artifact, source?.path, supported]);

  const load = useCallback(async () => {
    if (!supported) return;
    setStatus('loading');
    setError('');
    setConflict(null);
    let nextCapabilities = null;

    // Cloud draft comments need an isolated auth rule before the inference
    // comments API can authorize collaborators. Desktop uses its local journal;
    // published links keep their independently configured access policy.
    if (host.isWeb) {
      try {
        const access = await enableDraftComments(artifact);
        nextCapabilities = access?.capabilities || null;
        setCommentsReady(!!access?.enabled);
        setReviewRevision(access?.currentRevision || null);
      } catch (accessError) {
        setCommentsReady(false);
        if (accessError?.status !== 503) setError(accessError.message);
      }
    } else {
      // Desktop uses the local atomic comment journal keyed by the same stable
      // artifact id, so drafts can be reviewed before they are published.
      setCommentsReady(true);
    }

    if (nextCapabilities && !nextCapabilities.canEdit) {
      setCapabilities(nextCapabilities);
      setSource(null);
      setDraft('');
      setStatus('ready');
      return;
    }

    try {
      const loaded = await loadArtifactSource(artifact);
      setSource(loaded);
      setDraft(loaded.content);
      setCapabilities(loaded.capabilities || nextCapabilities || OWNER_CAPABILITIES);
      setRepair(loaded.repair || null);
      if (loaded.repair?.status === 'ready') {
        const detail = await loadAgentRepair(artifact, loaded.repair.id);
        if (detail.compare) {
          setComparison({ kind: 'agent', ...detail.compare, repair: detail.repair });
        }
      } else {
        setComparison(null);
      }
      await refreshHistory(loaded.path);
      setStatus('ready');
    } catch (loadError) {
      if (loadError?.status === 403) {
        setCapabilities(nextCapabilities || { role: 'reviewer', canPreview: true, canComment: true });
        setStatus('ready');
      } else if (loadError?.status === 404 || loadError?.status === 422) {
        // Unsupported artifacts can still preview, publish and review.
        setCapabilities(nextCapabilities);
        setStatus('unsupported');
      } else {
        setError(loadError.message || 'Could not load editable source');
        setStatus('error');
      }
    }
  }, [artifact, refreshHistory, supported]);

  useEffect(() => {
    setMode('preview');
    setSource(null);
    setReviewRevision(null);
    setDraft('');
    setRevisions([]);
    setCapabilities(null);
    setCommentsReady(false);
    setError('');
    setConflict(null);
    setComparison(null);
    setRepair(null);
    if (open && supported) load();
  // The stable identity, not a mutable object reference, names this workspace.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, artifact?.stableId, artifact?.projectId]);

  const save = useCallback(async (summary = 'Edited artifact', contentOverride = null) => {
    const content = contentOverride ?? draft;
    if (!source || content === source.content || status === 'saving') return source;
    setStatus('saving');
    setError('');
    setConflict(null);
    try {
      const saved = await saveArtifactSource(artifact, {
        content,
        expectedRevisionId: source.revision.id,
        path: source.path,
        summary,
      });
      const next = { ...source, ...saved, capabilities };
      setSource(next);
      setDraft(saved.content);
      setStatus('saved');
      await refreshHistory(saved.path);
      onChange?.({ ...artifact, mtime: Date.now() / 1000 });
      return next;
    } catch (saveError) {
      if (saveError?.status === 409) {
        setConflict(saveError.detail?.currentRevision || saveError.detail || true);
        setStatus('conflict');
      } else {
        setError(saveError.message || 'Could not save changes');
        setStatus('error');
      }
      return null;
    }
  }, [artifact, capabilities, draft, onChange, refreshHistory, source, status]);

  const discard = useCallback(() => {
    setDraft(source?.content || '');
    setConflict(null);
    setError('');
    setStatus('ready');
  }, [source]);

  const compareRevision = useCallback(async (revisionId) => {
    if (!source || !revisionId) return;
    setStatus('loading-compare');
    try {
      const before = await loadArtifactRevision(artifact, revisionId);
      setComparison({ kind: 'revision', before, after: source.revision, afterContent: source.content });
      setStatus('ready');
    } catch (compareError) {
      setError(compareError.message || 'Could not load revision');
      setStatus('error');
    }
  }, [artifact, source]);

  const restoreRevision = useCallback(async (revisionId) => {
    if (!source) return null;
    setStatus('saving');
    try {
      const restored = await restoreArtifactRevision(artifact, revisionId, source.revision.id);
      const next = { ...source, ...restored };
      setSource(next);
      setDraft(restored.content);
      setComparison(null);
      await refreshHistory(restored.path);
      setStatus('saved');
      onChange?.({ ...artifact, mtime: Date.now() / 1000 });
      return next;
    } catch (restoreError) {
      setError(restoreError.message || 'Could not restore revision');
      setStatus(restoreError?.status === 409 ? 'conflict' : 'error');
      return null;
    }
  }, [artifact, onChange, refreshHistory, source]);

  const addressWithAgent = useCallback(async ({ thread, conversationId = null }) => {
    if (!source || !thread) return null;
    const payloadThread = [
      {
        author: thread.payload?.author || null,
        text: thread.payload?.text || '',
        createdAt: thread.created_at || null,
      },
      ...(thread.payload?.replies || []).map((reply) => ({
        author: reply.author || null,
        text: reply.text || '',
        createdAt: reply.created_at || null,
      })),
    ];
    const requested = await requestAgentRepair(artifact, {
      expectedRevisionId: source.revision.id,
      commentThreadId: thread.id,
      selector: thread.selector || null,
      thread: payloadThread,
      conversationId,
    });
    setRepair(requested.repair);
    return requested;
  }, [artifact, source]);

  const refreshRepair = useCallback(async () => {
    if (!repair?.id) return null;
    const detail = await loadAgentRepair(artifact, repair.id);
    setRepair(detail.repair);
    if (detail.compare) {
      setError('');
      setComparison({ kind: 'agent', ...detail.compare, repair: detail.repair });
    } else if (detail.repair?.status === 'no_change') {
      setError('The agent finished without changing this artifact. The comment remains open.');
    } else if (detail.repair?.status === 'conflict') {
      setError('The artifact changed while the agent was working. Review the latest revision before trying again.');
      await load();
    }
    return detail;
  }, [artifact, load, repair?.id]);

  const cancelRepair = useCallback(async (repairId = repair?.id) => {
    if (!repairId) return null;
    const cancelled = await cancelAgentRepair(artifact, repairId);
    setRepair(cancelled);
    return cancelled;
  }, [artifact, repair?.id]);

  const decideRepair = useCallback(async (decision) => {
    if (!repair?.id) return null;
    const decided = await decideAgentRepair(artifact, repair.id, decision);
    setRepair(decided);
    setComparison(null);
    if (decision === 'rejected') await load();
    return decided;
  }, [artifact, load, repair?.id]);

  const changeMode = useCallback((nextMode) => {
    setMode(nextMode);
    // A comparison is a focused review task, not persistent chrome. Keeping
    // it open after someone explicitly chooses Edit or Preview obscures the
    // canvas and makes the mode switch appear broken.
    setComparison(null);
  }, []);

  return useMemo(() => ({
    supported,
    mode,
    setMode: changeMode,
    source,
    draft,
    setDraft,
    dirty,
    currentRevision,
    revisions,
    capabilities,
    commentsReady,
    status,
    error,
    conflict,
    load,
    save,
    discard,
    comparison,
    setComparison,
    compareRevision,
    restoreRevision,
    repair,
    addressWithAgent,
    refreshRepair,
    cancelRepair,
    decideRepair,
  }), [
    addressWithAgent, cancelRepair, capabilities, changeMode, commentsReady, compareRevision, comparison,
    conflict, currentRevision, decideRepair, dirty, discard, draft, error, load,
    mode, refreshRepair, repair, restoreRevision, revisions, save, source, status,
    supported,
  ]);
}

export default useArtifactWorkspace;
