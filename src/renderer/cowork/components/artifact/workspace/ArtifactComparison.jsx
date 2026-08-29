import { useEffect, useMemo, useRef, useState } from 'react';
import Ico from '../../Icons';
import { Button } from '../../ui';
import { ArtifactHtmlComparison } from './ArtifactHtmlComparison';
import { createHtmlVisualComparisonDocuments } from './htmlVisualEditorDocument';

function labelOf(revision, fallback) {
  if (!revision) return fallback;
  return `Revision ${revision.number}`;
}

function changedLines(beforeContent, afterContent) {
  const before = String(beforeContent || '').split('\n');
  const after = String(afterContent || '').split('\n');
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
  if (start === before.length && start === after.length) {
    return { before, after, beforeStart: -1, beforeEnd: -1, afterStart: -1, afterEnd: -1, count: 0 };
  }
  let beforeEnd = before.length - 1;
  let afterEnd = after.length - 1;
  while (beforeEnd >= start && afterEnd >= start && before[beforeEnd] === after[afterEnd]) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }
  return {
    before,
    after,
    beforeStart: start,
    beforeEnd,
    afterStart: start,
    afterEnd,
    count: Math.max(beforeEnd - start + 1, afterEnd - start + 1),
  };
}

function DiffSource({ lines, start, end, sourceRef }) {
  return (
    <pre ref={sourceRef}>
      {lines.map((line, index) => (
        <span
          // Line index is stable within one immutable revision.
          // eslint-disable-next-line react/no-array-index-key
          key={index}
          className={index >= start && index <= end ? 'is-changed' : undefined}
        >
          {line || '\u200b'}
        </span>
      ))}
    </pre>
  );
}

function isHtmlComparison(contentType, before, after) {
  const declared = String(contentType || '').toLowerCase().replace(/^\./, '');
  if (declared === 'html' || declared === 'htm') return true;
  return [before?.path, after?.path].some((path) => /\.html?$/i.test(path || ''));
}

export function ArtifactComparison({
  comparison,
  busy,
  contentType,
  baseUrl,
  onClose,
  onRestore,
  onAccept,
  onReject,
}) {
  const beforeRef = useRef(null);
  const afterRef = useRef(null);
  const [showSource, setShowSource] = useState(false);
  const beforeContent = comparison?.before?.content || '';
  const afterContent = comparison?.afterContent ?? comparison?.after?.content ?? '';
  const changes = useMemo(
    () => changedLines(beforeContent, afterContent),
    [afterContent, beforeContent],
  );
  const htmlComparison = isHtmlComparison(contentType, comparison?.before, comparison?.after);
  const visualModel = useMemo(
    () => (htmlComparison
      ? createHtmlVisualComparisonDocuments(beforeContent, afterContent, { baseUrl })
      : null),
    [afterContent, baseUrl, beforeContent, htmlComparison],
  );

  useEffect(() => {
    for (const node of [beforeRef.current, afterRef.current]) {
      const changed = node?.querySelector('.is-changed');
      if (node && changed) node.scrollTop = Math.max(0, changed.offsetTop - node.clientHeight / 2);
    }
  }, [comparison, changes.afterStart, changes.beforeStart]);

  useEffect(() => setShowSource(false), [comparison]);

  if (!comparison) return null;
  const isAgent = comparison.kind === 'agent';
  const before = comparison.before;
  const after = comparison.after;
  const changeCount = visualModel ? visualModel.changes.length : changes.count;
  const changeUnit = visualModel ? 'text change' : 'changed line';
  const changeLabel = `${changeCount} ${changeUnit}${changeCount === 1 ? '' : 's'}`;
  const beforeLabel = labelOf(before, 'Earlier');
  const afterLabel = labelOf(after, 'Current');

  return (
    <div className="artifact-compare" role="dialog" aria-modal="true" aria-labelledby="artifact-compare-title">
      <header className="artifact-compare-header">
        <div>
          <div className="artifact-compare-kicker">
            <span className="artifact-compare-eyebrow">{isAgent ? 'Agent suggestion' : 'Revision history'}</span>
            {changeCount > 0 && <span className="artifact-compare-change-count">{changeLabel}</span>}
          </div>
          <h3 id="artifact-compare-title">
            {isAgent ? 'Review the change before resolving' : `Compare ${labelOf(before, 'earlier draft')}`}
          </h3>
        </div>
        <div className="artifact-compare-header-actions">
          {htmlComparison && (
            <button
              type="button"
              className="artifact-compare-advanced"
              onClick={() => setShowSource((current) => !current)}
            >
              {showSource ? 'Visual comparison' : 'Advanced'}
            </button>
          )}
          <button type="button" aria-label="Close comparison" onClick={onClose}>
            {Ico.close(16)}
          </button>
        </div>
      </header>
      {visualModel && !showSource ? (
        <ArtifactHtmlComparison
          key={`${before?.id || 'before'}:${after?.id || 'after'}`}
          model={visualModel}
          beforeLabel={beforeLabel}
          afterLabel={afterLabel}
        />
      ) : (
        <div className="artifact-compare-grid">
          <section>
            <div className="artifact-compare-label">Before · {beforeLabel}</div>
            <DiffSource
              lines={changes.before}
              start={changes.beforeStart}
              end={changes.beforeEnd}
              sourceRef={beforeRef}
            />
          </section>
          <section>
            <div className="artifact-compare-label">After · {afterLabel}</div>
            <DiffSource
              lines={changes.after}
              start={changes.afterStart}
              end={changes.afterEnd}
              sourceRef={afterRef}
            />
          </section>
        </div>
      )}
      <footer className="artifact-compare-footer">
        {isAgent ? (
          <>
            <Button variant="ghost" disabled={busy} onClick={onReject}>Reject & restore</Button>
            <Button disabled={busy} onClick={onAccept}>{Ico.check(14)} Accept & resolve</Button>
          </>
        ) : (
          <Button disabled={busy} onClick={() => onRestore?.(before?.id)}>
            Restore as new revision
          </Button>
        )}
      </footer>
    </div>
  );
}

export default ArtifactComparison;
