// The shape of one journaled UI/server update outcome, shared by the main
// journal (src/main/update-journal.ts) and the renderer that reports it to
// PostHog as `update_phase`. The phase set is documented on the journal.

export type UpdateJournalChannel = 'ui' | 'server';
export type UpdateJournalPhase = 'applied' | 'rolled-back' | 'failed' | 'repaired' | 'skipped';
export type UpdateJournalTrigger = 'boot' | 'periodic' | 'manual';

export interface UpdatePhaseRecord {
  channel: UpdateJournalChannel;
  phase: UpdateJournalPhase;
  trigger: UpdateJournalTrigger;
  from?: string | null;
  to?: string | null;
  errorCode?: string | null;
  durationMs?: number | null;
  /** Server channel: which backend component the versions name. Absent
   *  means cowork-server. */
  component?: 'cowork-server' | 'anton-agent' | null;
  /** Server channel: the move was the stream repair, whatever its outcome. */
  repair?: boolean;
}

export interface UpdatePhaseEntry extends UpdatePhaseRecord {
  id: string;
  /** ISO timestamp of the outcome. */
  at: string;
  buildKind: string | null;
}
