import { useEffect, useMemo, useState } from 'react';
import { allocateConversationId } from '../../api';

export function useArtifactRepair(artifact, {
  open,
  workspace,
  comments,
  diagnostics,
  conversationId,
  resolveRepairConversation,
  onAddressWithAgent,
  setError: setErr,
}) {
  const [repairBusy, setRepairBusy] = useState(false);
  // Dismissed per repair, not per open: a suggestion the artifact has moved
  // past is worth mentioning once, not on every visit to the artifact.
  const [dismissedRepairId, setDismissedRepairId] = useState('');
  // Rendered twice: inline in the repair notice, and as the discard dialog's
  // error, so a failure is visible whether or not that dialog is open.
  const [repairNoticeError, setRepairNoticeError] = useState('');
  // The repair the create guard named, so the refusal can offer a way out
  // instead of stating a fact the user cannot act on.
  const [blockedBy, setBlockedBy] = useState(null);
  const [pendingDiscard, setPendingDiscard] = useState(null);

  // Fallback target for a repair: a brand-new chat. Used when the viewer has no
  // host chat (opened from the artifacts list) and the host either offers no
  // resolver or can't reach the chat that created the artifact.
  const repairConversationId = useMemo(
    () => conversationId || (open && workspace.supported ? allocateConversationId() : ''),
    // `artifact?.id` stays in the deps because switching artifacts has to mint a
    // fresh repair conversation instead of reusing the previous artifact's.
    [artifact?.id, workspace.supported, conversationId, open],
  );
  // Both are per repair, and this component outlives an artifact switch.
  useEffect(() => {
    setRepairNoticeError('');
    setBlockedBy(null);
  }, [workspace.repair?.id, artifact?.id]);

  // A short quote of the blocking thread, so the refusal names the comment the
  // user has to deal with rather than the artifact as a whole.
  const blockedComment = useMemo(() => {
    if (!blockedBy?.commentThreadId) return '';
    const thread = (comments.threads || [])
      .find((item) => item.id === blockedBy.commentThreadId);
    const text = (thread?.payload?.text || '').trim();
    return text.length > 60 ? `${text.slice(0, 60)}…` : text;
  }, [blockedBy?.commentThreadId, comments.threads]);

  useEffect(() => {
    if (!open || workspace.repair?.status !== 'queued') return undefined;
    let cancelled = false;
    const poll = async () => {
      try {
        const detail = await workspace.refreshRepair();
        if (!cancelled && detail?.repair?.status === 'queued') {
          timer = window.setTimeout(poll, 2500);
        }
      } catch {
        if (!cancelled) timer = window.setTimeout(poll, 5000);
      }
    };
    let timer = window.setTimeout(poll, 1200);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [open, workspace.repair?.id, workspace.repair?.status, workspace.refreshRepair]);

  const addressCommentWithAgent = async (thread) => {
    if (!onAddressWithAgent || repairBusy) return;
    setRepairBusy(true);
    setErr('');
    try {
      // Settle the target chat BEFORE the repair record exists. cowork-server
      // finishes a queued handoff only in a turn whose conversation matches the
      // id stored on it, so a repair minted against one chat and run in another
      // would stay queued forever. Inside a chat that's this chat; from the
      // artifacts list the host resolves the chat that created the artifact and
      // falls back to a fresh one.
      const targetConversationId = conversationId
        || (resolveRepairConversation ? await resolveRepairConversation(artifact) : '')
        || repairConversationId;
      const requested = await workspace.addressWithAgent({
        thread,
        conversationId: targetConversationId,
        // Normalized, folded and capped by the hook; the server reads
        // message, file and line, caps again and owns the prompt's size.
        previewErrors: diagnostics.errors,
      });
      if (requested) {
        let started;
        try {
          started = await onAddressWithAgent({
            artifact,
            prompt: requested.prompt,
            repair: requested.repair,
            conversationId: targetConversationId,
          });
        } catch (startError) {
          try { await workspace.cancelRepair(requested.repair.id); } catch { /* keep original error */ }
          throw startError;
        }
        if (started === false) {
          await workspace.cancelRepair(requested.repair.id);
          setErr('Connect an agent provider, then try addressing this comment again.');
        }
      }
    } catch (requestError) {
      if (requestError?.status === 422 && requestError?.detail?.repairId) {
        setBlockedBy(requestError.detail);
      } else {
        setErr(requestError?.message || 'Could not send this comment to the agent');
      }
    } finally {
      setRepairBusy(false);
    }
  };

  const viewRepairChange = async () => {
    setRepairNoticeError('');
    setRepairBusy(true);
    try {
      await workspace.refreshRepair();
    } catch (noticeError) {
      setRepairNoticeError(noticeError?.message || 'Could not open that suggestion.');
    } finally {
      setRepairBusy(false);
    }
  };

  const confirmDiscardRepair = async () => {
    setRepairNoticeError('');
    setRepairBusy(true);
    try {
      await workspace.cancelRepair(pendingDiscard.repairId, { discardReady: true });
      if (pendingDiscard.clearBlocker) setBlockedBy(null);
      setPendingDiscard(null);
    } catch (discardError) {
      setRepairNoticeError(discardError?.message || 'Could not discard that suggestion.');
    } finally {
      setRepairBusy(false);
    }
  };

  return {
    repairBusy,
    setRepairBusy,
    dismissedRepairId,
    setDismissedRepairId,
    repairNoticeError,
    blockedBy,
    setBlockedBy,
    blockedComment,
    pendingDiscard,
    setPendingDiscard,
    addressCommentWithAgent,
    viewRepairChange,
    confirmDiscardRepair,
  };
}
