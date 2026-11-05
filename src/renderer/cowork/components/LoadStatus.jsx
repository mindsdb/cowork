/*
 * `<LoadStatus>`: in place of a sharing surface until a read it needs has
 * answered, a spinner while it runs, or the failed read with its Retry. The
 * artifact Share panel shows it for the sharing settings and the current
 * access; the Skills page for the sharing settings. `<RetryAlert>` is the
 * same notice for an answer that came back incomplete (MindsHub couldn't be
 * asked), shown beside the surface rather than in place of it.
 *
 *   <LoadStatus status={status} what="sharing settings" onRetry={retry} />
 */

import { Alert, Spinner } from './ui';
import { LOAD_STATUS } from '../lib/sharingContract';

/** A notice with a Retry link at its end. `variant` is the Alert's. */
export function RetryAlert({ message, onRetry, variant = 'danger', className }) {
  return (
    <Alert variant={variant} className={className}>
      <span className="flex items-center justify-between gap-3">
        <span>{message}</span>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="shrink-0 bg-transparent border-0 cursor-pointer p-0 font-body text-sm font-medium text-accent"
          >Retry</button>
        )}
      </span>
    </Alert>
  );
}

/**
 * @param {{
 *   status: import('../lib/sharingContract').LoadStatus,
 *   what: string,
 *   onRetry?: () => void,
 * }} props
 */
export function LoadStatus({ status, what, onRetry }) {
  if (status === LOAD_STATUS.ERROR) {
    return <RetryAlert message={`Couldn't load the ${what}.`} onRetry={onRetry} />;
  }
  return (
    <div role="status" className="flex items-center gap-2 py-2 font-body text-sm text-ink-3">
      <Spinner style={{ color: 'currentColor' }} />
      {`Loading ${what}…`}
    </div>
  );
}

export default LoadStatus;
