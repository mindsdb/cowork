// The chat's stand-in for an "Address with agent" handoff.
//
// The underlying message is a machine prompt — artifact id, base revision,
// repair id, raw thread JSON — and rendering it verbatim put a wall of
// identifiers in the transcript where the reviewer's own sentence should be.
// The card shows what was asked and where the work got to; the prompt text is
// untouched underneath, because the agent still reads it.
//
// Status comes from the repair record rather than from the turn: a turn can
// keep streaming after the repair is already `ready`, and it can end without
// the repair having changed anything, so "the turn finished" is not the same
// claim as "the artifact changed".

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
  // Undefined until the lookup answers; `repairCardState` falls back to the
  // streaming/neutral copy in the meantime rather than guessing an outcome.
  const [status, setStatus] = useState(undefined);

  useEffect(() => {
    if (!repair?.artifactId || !repair?.repairId) return undefined;
    let live = true;
    // Re-read when the turn stops streaming, which is when a queued repair has
    // most likely resolved. A card whose status is already terminal does not
    // need another read, but the cost is one request per completed turn and the
    // alternative is polling.
    loadAgentRepair({ id: repair.artifactId, projectId }, repair.repairId)
      .then((detail) => { if (live) setStatus(detail?.repair?.status || ''); })
      // A failed lookup is not worth surfacing: the card still says a handoff
      // was sent, which is the part the transcript is responsible for.
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
