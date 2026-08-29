import { sharedResourceAttribution } from '../lib/sharedResourceAccess';

export default function SharedResourceAttribution({ resource, className = '' }) {
  const attribution = sharedResourceAttribution(resource);
  if (!attribution) return null;

  const { createdBy, lastModifiedBy, lastModifiedAt } = attribution;
  const modifiedDate = lastModifiedAt ? new Date(lastModifiedAt) : null;
  const modifiedLabel = modifiedDate && !Number.isNaN(modifiedDate.getTime())
    ? modifiedDate.toLocaleString()
    : null;

  return (
    <div
      className={`min-w-0 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 font-mono text-[10.5px] text-ink-4 ${className}`}
    >
      {createdBy && <span className="min-w-0 break-all">Created by {createdBy}</span>}
      {lastModifiedBy && (
        <span className="min-w-0 break-all">
          <span aria-hidden="true">· </span>
          Last modified by {lastModifiedBy}
        </span>
      )}
      {modifiedLabel && (
        <time dateTime={lastModifiedAt} className="whitespace-nowrap">
          <span aria-hidden="true">· </span>
          {modifiedLabel}
        </time>
      )}
    </div>
  );
}
