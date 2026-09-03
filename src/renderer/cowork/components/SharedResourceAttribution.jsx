import { sharedResourceAttribution } from '../lib/sharedResourceAccess';

export default function SharedResourceAttribution({ resource, className = '' }) {
  const attribution = sharedResourceAttribution(resource);
  if (!attribution) return null;

  const { createdBy, lastModifiedBy, lastModifiedAt } = attribution;
  const modifiedDate = lastModifiedAt ? new Date(lastModifiedAt) : null;
  const modifiedLabel = modifiedDate && !Number.isNaN(modifiedDate.getTime())
    ? modifiedDate.toLocaleString()
    : null;

  /* A resource can carry any subset of these three parts, so each separator
     belongs to the part that follows it and only renders once something
     precedes it. It stays inside that part so a wrap never strands it. */
  const hasCreated = Boolean(createdBy);
  const hasModifiedBy = Boolean(lastModifiedBy);

  return (
    <div
      /* --ink-4 is a placeholder tone and clears only 2.7:1 on the light
         surface, so secondary metadata uses --ink-3 at 12px to hold the
         4.5:1 floor in both themes while staying quieter than body copy. */
      className={`min-w-0 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 font-mono text-[12px] leading-[1.45] text-ink-3 ${className}`}
    >
      {hasCreated && <span className="min-w-0 break-all">Created by {createdBy}</span>}
      {hasModifiedBy && (
        <span className="min-w-0 break-all">
          {hasCreated && <span aria-hidden="true">· </span>}
          Last modified by {lastModifiedBy}
        </span>
      )}
      {modifiedLabel && (
        <time dateTime={lastModifiedAt} className="whitespace-nowrap">
          {(hasCreated || hasModifiedBy) && <span aria-hidden="true">· </span>}
          {modifiedLabel}
        </time>
      )}
    </div>
  );
}
