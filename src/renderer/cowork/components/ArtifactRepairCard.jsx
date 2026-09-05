// Display the user's repair request while leaving the machine prompt available to the agent.
// Status follows the repair record: a completed turn does not prove the artifact changed.

import { useEffect, useState } from 'react';
import Ico from './Icons';
import { Spinner } from './ui';
import { loadAgentRepair } from '../lib/artifactWorkspaceApi';
import { repairCardState } from '../lib/artifactRepairPrompt';

const TONE_CLASS = {
  busy: 'text-accent',
  done: 'text-accent',
  warn: 'text-danger',
  idle: 'text-ink-3',
};

export default function ArtifactRepairCard({ repair, projectId, streaming = false }) {
  // Keep status unknown until lookup completes; do not guess the repair outcome.
  const [status, setStatus] = useState(undefined);

  useEffect(() => {
    if (!repair?.artifactId || !repair?.repairId) return undefined;
    let live = true;
    // Refresh after each completed turn, when a queued repair may have resolved, instead of
    // polling.
    loadAgentRepair({ id: repair.artifactId, projectId }, repair.repairId)
      .then((detail) => { if (live) setStatus(detail?.repair?.status || ''); })
      // A failed lookup leaves the transcript’s handoff confirmation visible.
      .catch(() => { if (live) setStatus(''); });
    return () => { live = false; };
  }, [repair?.artifactId, repair?.repairId, projectId, streaming]);

  const { label, tone } = repairCardState(status, { streaming });
  const busy = tone === 'busy';
  const file = repair?.sourcePath || '';

  return (
    <div className="artifact-repair-card">
      <div className="artifact-repair-card-head">
        <span className={`artifact-repair-card-icon ${TONE_CLASS[tone] || TONE_CLASS.idle}`}>
          {busy ? <Spinner /> : Ico.sparkle(15)}
        </span>
        <span className="artifact-repair-card-title">
          {label}
          {file && <span className="artifact-repair-card-file">{file}</span>}
        </span>
      </div>
      {repair?.selector && (
        <div className="artifact-repair-card-selector" title={repair.selector}>
          {repair.selector}
        </div>
      )}
      {repair?.thread?.length > 0 && (
        <ul className="artifact-repair-card-thread">
          {repair.thread.map((entry, i) => (
            // Index keys: the thread is a frozen snapshot taken when the handoff
            // was minted, so it never reorders or grows.
            <li key={i}>
              {entry.author && (
                <span className="artifact-repair-card-author">{entry.author}</span>
              )}
              <span className="artifact-repair-card-comment">{entry.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
