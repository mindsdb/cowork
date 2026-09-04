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

// Why a workspace is unavailable, in the user's words. Both land in the same
// `unsupported` status because the surfaces react identically — but "too old to
// edit" and "not shared with you" are different facts and reading the wrong one
// sends the user looking in the wrong place.
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
    // Source authorization is enforced by the workspace endpoint itself, so
    // owners can load it in parallel with the separate comments-access check.
    // Capture failures as values immediately: a reviewer response can finish
    // first and intentionally ignore the (expected 403) source result without
    // ever creating an unhandled rejection.
    const sourceRequest = loadArtifactSource(artifact).then(
      (value) => ({ value, error: null }),
      (requestError) => ({ value: null, error: requestError }),
    );

    // Cloud draft comments need an isolated auth rule before the inference
    // comments API can authorize collaborators. Desktop uses its local journal;
    // published links keep their independently configured access policy.
    if (host.isWeb) {
      // The read-only entry goes FIRST because the role is not known until the
      // server answers, and provisioning is owner-only: a reviewer asking for
      // it is refused, which used to read as an error banner with comments
      // switched off — the exact state draft review exists to avoid.
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
      if (loaded.repair?.status === 'ready') {
        // Its own try: a repair whose base revision aged out of history answers
        // 404, and the source catch below reads 404 as "this artifact predates
        // editing" - which would hide the whole workspace over a stale record.
        try {
          const detail = await loadAgentRepair(artifact, loaded.repair.id);
          if (!isCurrent()) return;
          if (detail.compare) {
            setComparison({ kind: 'agent', ...detail.compare, repair: detail.repair });
          }
        } catch (repairError) {
          if (!isCurrent()) return;
          // Soft: the artifact itself loaded. Same channel refreshRepair uses
          // for a repair that ended without a comparison to show.
          setError(repairError.message || 'Could not load the agent suggestion');
        }
      }
      // New servers bundle the initial history with the editable source so an
      // artifact open needs one stable-id lookup and one request. Keep the
      // fallback for staged rollouts where Desktop may briefly meet an older
      // cowork-server.
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
      // A legacy/incomplete artifact record has no full identity, so there
      // is no workspace request to wait for. Keep this state distinct from a
      // real in-flight load; otherwise the mode tabs say "Loading…" forever
      // even though no request was started.
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
      // Two different 409s land here. A stale revision carries the current one
      // in `detail`, and the conflict banner's Discard / Reload is the answer to
      // it. An artifact identity conflict — two folders on disk claiming the
      // same id, e.g. a copied folder or a sync tool's "conflicted copy" —
      // answers a bare string, and reloading cannot resolve that. Labelling it
      // "this draft changed elsewhere" sends the user to reload forever, so it
      // takes the error path and says what the server said.
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
      // Reachable when the source never loaded - a binary or oversized
      // artifact - where the button is live but has nothing to write into.
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

  const cancelRepair = useCallback(async (repairId = repair?.id) => {
    if (!repairId) return null;
    const generation = workspaceGeneration.current;
    const cancelled = await cancelAgentRepair(artifact, repairId);
    if (workspaceGeneration.current !== generation) return null;
    setRepair(cancelled);
    return cancelled;
  }, [artifact, repair?.id]);

  const decideRepair = useCallback(async (decision) => {
    if (!repair?.id) {
      // A user-initiated decision with no record behind it is a bug, not a
      // normal path: the comparison has outlived the repair that opened it.
      setError('This suggestion is no longer open');
      setComparison(null);
      return { decided: false, reason: 'missing-repair' };
    }
    const generation = workspaceGeneration.current;
    const decided = await decideAgentRepair(artifact, repair.id, decision, {
      expectedHeadRevisionId: currentRevision?.id || null,
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
    addressWithAgent,
    refreshRepair,
    cancelRepair,
    decideRepair,
  }), [
    addressWithAgent, cancelRepair, capabilities, changeMode, commentsReady, compareRevision, comparison,
    conflict, currentRevision, decideRepair, dirty, discard, draft, error, load,
    mode, refreshRepair, repair, restoreRevision, revisions, save, source, status,
    supported, unsupportedReason,
  ]);
}

export default useArtifactWorkspace;
