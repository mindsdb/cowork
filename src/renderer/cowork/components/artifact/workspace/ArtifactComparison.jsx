import { useEffect, useMemo, useRef, useState } from 'react';
import Ico from '../../Icons';
import { Button } from '../../ui';
import { ArtifactHtmlComparison } from './ArtifactHtmlComparison';
import { createHtmlVisualComparisonDocuments } from './htmlVisualEditorDocument';
import { absoluteDraftUrl, useInlinedFrameDocument } from './inlineArtifactFrame';
import i18n, { useTranslation } from '../../../../lib/i18n';

function labelOf(revision, fallback) {
  if (!revision) return fallback;
  return i18n.t('comparison.revision', { ns: 'artifacts', number: revision.number });
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
  const { t } = useTranslation('artifacts');
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
  const documentUrl = absoluteDraftUrl(baseUrl);
  const visualModel = useMemo(
    () => (htmlComparison
      ? createHtmlVisualComparisonDocuments(beforeContent, afterContent, { baseUrl: documentUrl })
      : null),
    [afterContent, documentUrl, beforeContent, htmlComparison],
  );
  // Only an open HTML comparison has documents to inline; the component stays
  // mounted while no comparison is open.
  const frameUrl = comparison && visualModel ? documentUrl : '';
  const inlinedBefore = useInlinedFrameDocument(visualModel?.before ?? '', frameUrl);
  const inlinedAfter = useInlinedFrameDocument(visualModel?.after ?? '', frameUrl);

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
  const changeLabel = visualModel
    ? t('comparison.textChanges', { count: changeCount })
    : t('comparison.changedLines', { count: changeCount });
  const beforeLabel = labelOf(before, t('comparison.earlier'));
  const afterLabel = labelOf(after, t('comparison.current'));

  return (
    <div className="artifact-compare" role="dialog" aria-modal="true" aria-labelledby="artifact-compare-title">
      <header className="artifact-compare-header">
        <div>
          <div className="artifact-compare-kicker">
            <span className="section-label">{isAgent ? t('comparison.agentSuggestion') : t('comparison.revisionHistory')}</span>
            {changeCount > 0 && <span className="artifact-compare-change-count">{changeLabel}</span>}
          </div>
          <h3 id="artifact-compare-title">
            {isAgent ? t('comparison.reviewChange') : t('comparison.compareWith', { label: labelOf(before, t('comparison.earlierDraft')) })}
          </h3>
        </div>
        <div className="artifact-compare-header-actions">
          {htmlComparison && (
            <button
              type="button"
              className="artifact-compare-advanced"
              onClick={() => setShowSource((current) => !current)}
            >
              {showSource ? t('comparison.visual') : t('comparison.advanced')}
            </button>
          )}
          <button type="button" aria-label={t('comparison.close')} onClick={onClose}>
            {Ico.close(16)}
          </button>
        </div>
      </header>
      {visualModel && !showSource ? (
        <ArtifactHtmlComparison
          key={`${before?.id || 'before'}:${after?.id || 'after'}`}
          model={visualModel}
          beforeDocument={inlinedBefore.content}
          afterDocument={inlinedAfter.content}
          pending={inlinedBefore.pending || inlinedAfter.pending}
          beforeLabel={beforeLabel}
          afterLabel={afterLabel}
        />
      ) : (
        <div className="artifact-compare-grid">
          <section>
            <div className="artifact-compare-label section-label">{t('comparison.beforeLabel', { label: beforeLabel })}</div>
            <DiffSource
              lines={changes.before}
              start={changes.beforeStart}
              end={changes.beforeEnd}
              sourceRef={beforeRef}
            />
          </section>
          <section>
            <div className="artifact-compare-label section-label">{t('comparison.afterLabel', { label: afterLabel })}</div>
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
            <Button variant="subtle" disabled={busy} onClick={onReject}>{t('comparison.reject')}</Button>
            <Button disabled={busy} onClick={onAccept}>{Ico.check(14)} {t('comparison.accept')}</Button>
          </>
        ) : (
          <Button disabled={busy} onClick={() => onRestore?.(before?.id)}>
            {t('comparison.restore')}
          </Button>
        )}
      </footer>
    </div>
  );
}

export default ArtifactComparison;
