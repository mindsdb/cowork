import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { host } from '../../../../platform/host';
import {
  cancelAgentRepair,
  canUseArtifactWorkspace,
  decideAgentRepair,
  enableDraftComments,
  loadAgentRepair,
  loadArtifactRevision,
  loadArtifactRevisions,
  loadArtifactReview,
  loadArtifactSource,
  releaseAgentRepairs,
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

// Distinguish unsupported server versions from denied access in copy, even though both use
// unsupported UI state.
const AUTO_OPENED_KEY = 'cowork.artifact.repair.autoOpened';

// Remember auto-open across workspace resets. Unavailable session storage only causes another
// auto-open.
function hasAutoOpened(repairId) {
  try {
    return (window.sessionStorage.getItem(AUTO_OPENED_KEY) || '').split(',').includes(repairId);
  } catch {
    return false;
  }
}

function markAutoOpened(repairId) {
  try {
    const seen = (window.sessionStorage.getItem(AUTO_OPENED_KEY) || '')
      .split(',').filter(Boolean);
    if (seen.includes(repairId)) return;
    // Bounded: only the recent ones matter, and this is per session anyway.
    window.sessionStorage.setItem(AUTO_OPENED_KEY, [...seen.slice(-19), repairId].join(','));
  } catch { /* storage unavailable: auto-open again next time */ }
}

const NO_WORKSPACE = 'This artifact was created before editing was available';
const NO_DRAFT_ACCESS = 'The owner has not shared this draft for review';

export function useArtifactWorkspace(artifact, { open, onChange } = {}) {
  const supported = canUseArtifactWorkspace(artifact);
  const workspaceGeneration = useRef(0);
  const [mode, setMode] = useState('preview');
  const [source, setSource] = useState(null);
  const [reviewRevision, setReviewRevision] = useState(null);
  const [draft, setDraft] = useState('');
  const [revisions, setRevisions] = useState([]);
  const [capabilities, setCapabilities] = useState(null);
  const [commentsReady, setCommentsReady] = useState(false);
  const [unsupportedReason, setUnsupportedReason] = useState('');
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(null);
  const [comparison, setComparison] = useState(null);
  const [repair, setRepair] = useState(null);

  const dirty = !!source && draft !== source.content;
  const currentRevision = source?.revision || reviewRevision;
  // Derive pending from status because repair-detail responses and older servers omit the computed
  // flag.
  const repairPending = repair?.status === 'ready';
  // Trust only server-computed superseded: a local revision mismatch may mean our head is stale,
  // not that the repair is obsolete.
  const repairSuperseded = repairPending && repair.superseded === true;

  const refreshHistory = useCallback(async (
    path = source?.path,
    generation = workspaceGeneration.current,
  ) => {
    if (!supported) return [];
    const data = await loadArtifactRevisions(artifact, path || null);
    const next = data?.revisions || [];
    if (workspaceGeneration.current === generation) setRevisions(next);
    return next;
  }, [artifact, source?.path, supported]);

  const load = useCallback(async () => {
    if (!supported) return;
    const generation = workspaceGeneration.current + 1;
    workspaceGeneration.current = generation;
    const isCurrent = () => workspaceGeneration.current === generation;
    setStatus('loading');
    setError('');
    setConflict(null);
    setUnsupportedReason('');
    let nextCapabilities = null;
    // The source endpoint enforces authorization independently. Capture parallel failures as values
    // so reviewers
    // can ignore expected source 403s without unhandled rejections.
    const sourceRequest = loadArtifactSource(artifact).then(
      (value) => ({ value, error: null }),
      (requestError) => ({ value: null, error: requestError }),
    );

    // Cloud draft comments need an isolated auth rule before the inference
    // comments API can authorize collaborators. Desktop uses its local journal;
    // published links keep their independently configured access policy.
    if (host.isWeb) {
      // Read review access first while role is unknown; provisioning is owner-only and would reject
      // legitimate reviewers.
      let review = null;
      try {
        review = await loadArtifactReview(artifact);
      } catch (reviewError) {
        if (!isCurrent()) return;
        setCommentsReady(false);
        if (reviewError?.status === 404) {
          // A draft nobody granted us is indistinguishable from one that never
          // existed, deliberately (ENG-1910). Nothing more to try: the source
          // request in flight is answering 404 for the same reason.
          setCapabilities(null);
          setUnsupportedReason(NO_DRAFT_ACCESS);
          setStatus('unsupported');
        } else {
          setError(reviewError.message || 'Could not open this artifact for review');
          setStatus('error');
        }
        return;
      }
      if (!isCurrent()) return;
      nextCapabilities = review?.capabilities || null;
      setReviewRevision(review?.currentRevision || null);
      // Absent capabilities mean an older server that only speaks the POST, so
      // fall through to it: assuming reviewer there would silently drop the
      // owner's own comments.
      const canProvision = nextCapabilities ? nextCapabilities.canEdit !== false : true;
      if (canProvision) {
        try {
          const access = await enableDraftComments(artifact);
          if (!isCurrent()) return;
          nextCapabilities = access?.capabilities || nextCapabilities;
          setCommentsReady(!!access?.enabled);
          if (access?.currentRevision) setReviewRevision(access.currentRevision);
        } catch (accessError) {
          if (!isCurrent()) return;
          setCommentsReady(false);
          if (accessError?.status !== 503) setError(accessError.message);
        }
      } else {
        // The GET having succeeded IS the grant — the owner minted the auth
        // rule when they turned draft review on, so the comments API already
        // authorizes this reviewer and there is nothing to provision.
        setCommentsReady(true);
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
      const sourceResult = await sourceRequest;
      if (sourceResult.error) throw sourceResult.error;
      const loaded = sourceResult.value;
      if (!isCurrent()) return;
      setSource(loaded);
      setDraft(loaded.content);
      setCapabilities(loaded.capabilities || nextCapabilities || OWNER_CAPABILITIES);
      setRepair(loaded.repair || null);
      const bundledRevisions = Array.isArray(loaded.revisions) ? loaded.revisions : null;
      if (bundledRevisions) setRevisions(bundledRevisions);
      setComparison(null);
      // Auto-open only actionable repairs for this file whose revision is still head; superseded
      // repairs get a notice.
      const decidable = loaded.repair?.status === 'ready'
        && loaded.repair.path === loaded.path
        && loaded.repair.revisionId === loaded.revision?.id;
      // Interrupt once per repair per viewer/session, not on every reopen. Losing this local
      // preference is harmless.
      if (decidable && !hasAutoOpened(loaded.repair.id)) {
        // Handle repair-history 404s separately so an expired base revision cannot mark the entire
        // artifact unsupported.
        try {
          const detail = await loadAgentRepair(artifact, loaded.repair.id);
          if (!isCurrent()) return;
          if (detail.compare) {
            setComparison({ kind: 'agent', ...detail.compare, repair: detail.repair });
            // Only once it actually opened: marking before the fetch burns the
            // one auto-open on a request that failed.
            markAutoOpened(loaded.repair.id);
          }
        } catch (repairError) {
          if (!isCurrent()) return;
          setError(repairError.message || 'Could not load the agent suggestion');
        }
      }
      // Use bundled history when available; retain the separate fetch for older server rollouts.
      if (!bundledRevisions) {
        await refreshHistory(loaded.path, generation);
        if (!isCurrent()) return;
      }
      setStatus('ready');
    } catch (loadError) {
      if (!isCurrent()) return;
      if (loadError?.status === 403) {
        setCapabilities(nextCapabilities || { role: 'reviewer', canPreview: true, canComment: true });
        setStatus('ready');
      } else if (loadError?.status === 404 || loadError?.status === 422) {
        // Unsupported artifacts can still preview, publish and review.
        setCapabilities(nextCapabilities);
        setUnsupportedReason(NO_WORKSPACE);
        setStatus('unsupported');
      } else {
        setError(loadError.message || 'Could not load editable source');
        setStatus('error');
      }
    }
  }, [artifact, refreshHistory, supported]);

  useEffect(() => {
    // Invalidate every in-flight request from the workspace being replaced or
    // closed. Network responses are not cancellable on every transport, so the
    // generation is the final guard against stale state crossing artifacts.
    workspaceGeneration.current += 1;
    setMode('preview');
    setSource(null);
    setReviewRevision(null);
    setDraft('');
    setRevisions([]);
    setCapabilities(null);
    setCommentsReady(false);
    setUnsupportedReason('');
    setError('');
    setConflict(null);
    setComparison(null);
    setRepair(null);
    if (open && supported) {
      load();
    } else if (open) {
      // Incomplete identities start no request; show unsupported instead of an endless loading
      // state.
      setUnsupportedReason(NO_WORKSPACE);
      setStatus('unsupported');
    } else {
      setStatus('idle');
    }
    return () => { workspaceGeneration.current += 1; };
  // The artifact identity, not a mutable object reference, names this workspace.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, artifact?.id, artifact?.projectId]);

  const save = useCallback(async (summary = 'Edited artifact', contentOverride = null) => {
    const content = contentOverride ?? draft;
    if (!source || content === source.content || status === 'saving') return source;
    setStatus('saving');
    setError('');
    setConflict(null);
    const generation = workspaceGeneration.current;
    try {
      const saved = await saveArtifactSource(artifact, {
        content,
        expectedRevisionId: source.revision.id,
        path: source.path,
        summary,
      });
      if (workspaceGeneration.current !== generation) return null;
      const next = { ...source, ...saved, capabilities };
      setSource(next);
      setDraft(saved.content);
      setStatus('saved');
      await refreshHistory(saved.path, generation);
      if (workspaceGeneration.current !== generation) return null;
      onChange?.({ ...artifact, mtime: Date.now() / 1000 });
      return next;
    } catch (saveError) {
      if (workspaceGeneration.current !== generation) return null;
      // Only revision conflicts carry detail.currentRevision and can be solved by reloading. Other
      // 409s, such
      // as duplicate artifact IDs, must retain the server error instead of offering an ineffective
      // reload.
      const staleRevision = saveError?.detail?.currentRevision;
      if (saveError?.status === 409 && staleRevision) {
        setConflict(staleRevision);
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
    const generation = workspaceGeneration.current;
    try {
      const before = await loadArtifactRevision(artifact, revisionId);
      if (workspaceGeneration.current !== generation) return;
      setComparison({ kind: 'revision', before, after: source.revision, afterContent: source.content });
      setStatus('ready');
    } catch (compareError) {
      if (workspaceGeneration.current !== generation) return;
      setError(compareError.message || 'Could not load revision');
      setStatus('error');
    }
  }, [artifact, source]);

  const restoreRevision = useCallback(async (revisionId) => {
    if (!source) {
      setError('This artifact has no editable source to restore into');
      return null;
    }
    setStatus('saving');
    const generation = workspaceGeneration.current;
    try {
      const restored = await restoreArtifactRevision(artifact, revisionId, source.revision.id);
      if (workspaceGeneration.current !== generation) return null;
      const next = { ...source, ...restored };
      setSource(next);
      setDraft(restored.content);
      setComparison(null);
      await refreshHistory(restored.path, generation);
      if (workspaceGeneration.current !== generation) return null;
      setStatus('saved');
      onChange?.({ ...artifact, mtime: Date.now() / 1000 });
      return next;
    } catch (restoreError) {
      if (workspaceGeneration.current !== generation) return null;
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
    const generation = workspaceGeneration.current;
    const requested = await requestAgentRepair(artifact, {
      expectedRevisionId: source.revision.id,
      commentThreadId: thread.id,
      selector: thread.selector || null,
      thread: payloadThread,
      conversationId,
    });
    if (workspaceGeneration.current !== generation) return null;
    setRepair(requested.repair);
    return requested;
  }, [artifact, source]);

  const refreshRepair = useCallback(async () => {
    if (!repair?.id) return null;
    const generation = workspaceGeneration.current;
    const detail = await loadAgentRepair(artifact, repair.id);
    if (workspaceGeneration.current !== generation) return null;
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

  const cancelRepair = useCallback(async (
    repairId = repair?.id,
    { discardReady = false } = {},
  ) => {
    if (!repairId) return null;
    const generation = workspaceGeneration.current;
    const cancelled = await cancelAgentRepair(artifact, repairId, { discardReady });
    if (workspaceGeneration.current !== generation) return cancelled;
    setRepair(cancelled);
    if (discardReady) setComparison(null);
    return cancelled;
  }, [artifact, repair?.id]);

  const releaseRepairsForComment = useCallback(async (commentThreadId) => {
    // Resolving the comment is the explicit decision the accept-or-reject rule
    // was protecting. The route is owner-only, and no editable source means no
    // repair to release, so a reviewer is never sent into a 403 for resolving.
    if (!commentThreadId || !source) return null;
    const generation = workspaceGeneration.current;
    let result = null;
    try {
      result = await releaseAgentRepairs(artifact, commentThreadId);
    } catch (releaseError) {
      if (workspaceGeneration.current !== generation) return null;
      // A server from before this route exists answers 404/405. The resolve
      // itself succeeded, so that is not something to report to the user.
      if (releaseError?.status !== 404 && releaseError?.status !== 405) {
        setError('The comment was resolved, but its agent suggestion is still open.');
      }
      return null;
    }
    if (workspaceGeneration.current === generation) {
      const mine = (result?.released || []).find((item) => item.id === repair?.id);
      if (mine) {
        setRepair(mine);
        setComparison(null);
      }
    }
    return result;
  }, [artifact, repair?.id, source]);

  const decideRepair = useCallback(async (decision, { confirmedHeadRevisionId = null } = {}) => {
    if (!repair?.id) {
      setError('That suggestion is no longer open, so there was nothing to decide.');
      setComparison(null);
      return { decided: false, reason: 'missing-repair' };
    }
    const generation = workspaceGeneration.current;
    const decided = await decideAgentRepair(artifact, repair.id, decision, {
      // Accept writes no content, so the head the user was shown is enough.
      // Reject restores over head and would discard anything written since, so
      // it travels only with a head the user was actually warned about.
      expectedHeadRevisionId: decision === 'accepted'
        ? (currentRevision?.id || null)
        : confirmedHeadRevisionId,
    });
    // The write has landed. A workspace replaced since must not turn a
    // completed decision into a silent no-op, so only the state update is
    // guarded; the result always reports what actually happened.
    if (workspaceGeneration.current === generation) {
      setRepair(decided);
      setComparison(null);
      if (decision === 'rejected') await load();
    }
    return { decided: true, repair: decided };
  }, [artifact, currentRevision?.id, load, repair?.id]);

  const changeMode = useCallback((nextMode) => {
    setMode(nextMode);
    // Leave comparison when selecting Edit or Preview so it does not obscure that mode.
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
    unsupportedReason,
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
    repairPending,
    repairSuperseded,
    addressWithAgent,
    refreshRepair,
    cancelRepair,
    decideRepair,
    releaseRepairsForComment,
  }), [
    addressWithAgent, cancelRepair, capabilities, changeMode, commentsReady, compareRevision, comparison,
    conflict, currentRevision, decideRepair, dirty, discard, draft, error, load,
    mode, refreshRepair, releaseRepairsForComment, repair, repairPending,
    repairSuperseded, restoreRevision, revisions, save, source, status,
    supported, unsupportedReason,
  ]);
}

export default useArtifactWorkspace;
