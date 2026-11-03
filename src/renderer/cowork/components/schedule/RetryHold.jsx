// `<RetryHold>` — explains a Run now that is disabled because a failed run is
// waiting for its retry. A disabled button gets no hover or focus, so the
// hint sits on a wrapper that does.

import { Tooltip } from '../ui';

export const RETRY_HOLD_HINT = 'A failed run is waiting to be tried again';

export default function RetryHold({ retrying, children }) {
  if (!retrying) return children;
  return (
    <Tooltip content={RETRY_HOLD_HINT}>
      <span className="inline-flex" tabIndex={0} aria-label={RETRY_HOLD_HINT}>{children}</span>
    </Tooltip>
  );
}
