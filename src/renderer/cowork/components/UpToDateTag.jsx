// Calm, non-interactive "synced" status shown in a Share footer when there is
// nothing to save, deliberately not styled as a control, so status reads as
// status and the action button only appears when there is something to do.
// Shared by the artifact and skill Share panels.

import Ico from './Icons';

export function UpToDateTag() {
  return (
    <span className="inline-flex items-center gap-[6px] py-[7px] px-1 font-body font-semibold text-sm text-ink-3">
      {/* var(--ok) has no config utility (distinct from the --success hex), so it stays inline. */}
      <span className="inline-flex" style={{ color: 'var(--ok)' }}>{Ico.check(14)}</span>
      Up to date
    </span>
  );
}

export default UpToDateTag;
