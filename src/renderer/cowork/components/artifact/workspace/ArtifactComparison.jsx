import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Ico from '../../Icons';
import { Button } from '../../ui';
import { ArtifactHtmlComparison } from './ArtifactHtmlComparison';
import { ComparisonChangeNav } from './ComparisonChangeNav';
import { createFrameToken } from './frameToken';
import { HTML_COMPARISON_HIGHLIGHT_MS } from './htmlComparisonRuntime';
import { createHtmlVisualComparisonDocuments } from './htmlVisualEditorDocument';
import { compareSourceLines } from './sourceComparison';
import { absoluteDraftUrl, useInlinedFrameDocument } from './inlineArtifactFrame';
import i18n, { useTranslation } from '../../../../lib/i18n';

function labelOf(revision, fallback) {
  if (!revision) return fallback;
  return i18n.t('comparison.revision', { ns: 'artifacts', number: revision.number });
}

function changeIndexByLine(length, hunks, side) {
  const indexes = new Array(length).fill(-1);
  hunks.forEach((change, index) => {
    for (let line = change[`${side}Start`]; line <= change[`${side}End`]; line += 1) indexes[line] = index;
  });
  return indexes;
}

function DiffSource({ lines, changeIndexes, flashIndex, sourceRef }) {
  return (
    <pre ref={sourceRef}>
      {lines.map((line, index) => {
        const change = changeIndexes[index];
        const className = change < 0 ? undefined : change === flashIndex ? 'is-changed is-flashing' : 'is-changed';
        return (
          <span
            // Line index is stable within one immutable revision.
            // eslint-disable-next-line react/no-array-index-key
            key={index}
            className={className}
            data-change-index={change < 0 ? undefined : change}
          >
            {line || '\u200b'}
          </span>
        );
      })}
    </pre>
  );
}

// Centres a line in its pane. A change with no lines on this side (an
// addition or removal) still scrolls it to where those lines would be, so
// both panes stay aligned.
function scrollSourceTo(node, index, anchorLine) {
  if (!node) return;
  const target = node.querySelector(`[data-change-index="${index}"]`)
    || node.children[Math.min(anchorLine, node.children.length - 1)];
  if (!target) return;
  const offset = target.getBoundingClientRect().top - node.getBoundingClientRect().top + node.scrollTop;
  node.scrollTop = Math.max(0, offset - node.clientHeight / 2);
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
  // A change to a published artifact (comparison.kind 'publish', ENG-4409):
  // `{ busy, error, onPublish, onKeepDraft, onUndo }`, onUndo absent when the
  // change has no undo.
  publishReview = null,
}) {
  const { t } = useTranslation('artifacts');
  const beforeRef = useRef(null);
  const afterRef = useRef(null);
  const [showSource, setShowSource] = useState(false);
  const beforeContent = comparison?.before?.content || '';
  const afterContent = comparison?.afterContent ?? comparison?.after?.content ?? '';
  const changes = useMemo(
    () => compareSourceLines(beforeContent, afterContent),
    [afterContent, beforeContent],
  );
  const beforeChangeIndexes = useMemo(
    () => changeIndexByLine(changes.before.length, changes.hunks, 'before'),
    [changes],
  );
  const afterChangeIndexes = useMemo(
    () => changeIndexByLine(changes.after.length, changes.hunks, 'after'),
    [changes],
  );
  const htmlComparison = isHtmlComparison(contentType, comparison?.before, comparison?.after);
  const documentUrl = absoluteDraftUrl(baseUrl);
  const visualModel = useMemo(
    () => {
      if (!htmlComparison) return null;
      const token = createFrameToken();
      return {
        token,
        ...createHtmlVisualComparisonDocuments(beforeContent, afterContent, { baseUrl: documentUrl, token }),
      };
    },
    [afterContent, documentUrl, beforeContent, htmlComparison],
  );
  // Only an open HTML comparison has documents to inline; the component stays
  // mounted while no comparison is open.
  const frameUrl = comparison && visualModel ? documentUrl : '';
  const inlinedBefore = useInlinedFrameDocument(visualModel?.before ?? '', frameUrl);
  const inlinedAfter = useInlinedFrameDocument(visualModel?.after ?? '', frameUrl);

  const showVisual = !!visualModel && !showSource;
  const navCount = showVisual ? visualModel.changes.length : changes.hunks.length;
  // `seq` counts jumps, so stepping onto the same change (the only one, or a
  // full lap) still scrolls to and flashes it again.
  const [jump, setJump] = useState({ index: 0, seq: 0 });
  const [flashIndex, setFlashIndex] = useState(-1);
  const step = useCallback((direction) => {
    if (navCount < 1) return;
    setJump((current) => ({
      index: (((current.index + direction) % navCount) + navCount) % navCount,
      seq: current.seq + 1,
    }));
  }, [navCount]);

  useEffect(() => setShowSource(false), [comparison]);
  useEffect(() => setJump({ index: 0, seq: 0 }), [comparison, showVisual]);

  // Opening the source view centres the first change; each later jump centres
  // the current one in both panes and flashes it.
  useEffect(() => {
    if (showVisual) return undefined;
    const change = changes.hunks[jump.index];
    if (!change) return undefined;
    scrollSourceTo(beforeRef.current, jump.index, change.beforeStart);
    scrollSourceTo(afterRef.current, jump.index, change.afterStart);
    if (jump.seq === 0) return undefined;
    setFlashIndex(jump.index);
    const timer = setTimeout(() => setFlashIndex(-1), HTML_COMPARISON_HIGHLIGHT_MS);
    return () => {
      clearTimeout(timer);
      setFlashIndex(-1);
    };
  }, [changes, jump, showVisual]);

  if (!comparison) return null;
  const isAgent = comparison.kind === 'agent';
  const isPublish = comparison.kind === 'publish';
  // Changes not shared yet, opened with the artifact (ENG-4595): the live
  // page against the draft, which may hold several changes.
  const isUnshared = isPublish && comparison.review?.unshared === true;
  // Closing a publish review keeps the change as a draft, as the button says.
  const close = isPublish && publishReview?.onKeepDraft ? publishReview.onKeepDraft : onClose;
  const before = comparison.before;
  const after = comparison.after;
  const changeCount = visualModel ? visualModel.changes.length : changes.count;
  const changeLabel = visualModel
    ? t('comparison.textChanges', { count: changeCount })
    : t('comparison.changedLines', { count: changeCount });
  const beforeLabel = isUnshared ? t('comparison.sharedVersion') : labelOf(before, t('comparison.earlier'));
  const afterLabel = isUnshared ? t('comparison.draftVersion') : labelOf(after, t('comparison.current'));

  return (
    <div className="artifact-compare" role="dialog" aria-modal="true" aria-labelledby="artifact-compare-title">
      <header className="artifact-compare-header">
        <div>
          <div className="artifact-compare-kicker">
            <span className="section-label">
              {isAgent ? t('comparison.agentSuggestion') : isPublish ? t('comparison.publishedArtifact') : t('comparison.revisionHistory')}
            </span>
            {changeCount > 0 && <span className="artifact-compare-change-count">{changeLabel}</span>}
          </div>
          <h3 id="artifact-compare-title">
            {isAgent
              ? t('comparison.reviewChange')
              : isUnshared
                ? t('comparison.reviewUnshared')
                : isPublish
                ? t('comparison.reviewBeforePublishing')
                : t('comparison.compareWith', { label: labelOf(before, t('comparison.earlierDraft')) })}
          </h3>
        </div>
        <div className="artifact-compare-header-actions">
          <ComparisonChangeNav index={jump.index} count={navCount} onStep={step} />
          {htmlComparison && (
            <button
              type="button"
              className="artifact-compare-advanced"
              onClick={() => setShowSource((current) => !current)}
            >
              {showSource ? t('comparison.visual') : t('comparison.advanced')}
            </button>
          )}
          <button type="button" aria-label={t('comparison.close')} onClick={close}>
            {Ico.close(16)}
          </button>
        </div>
      </header>
      {showVisual ? (
        <ArtifactHtmlComparison
          key={`${before?.id || 'before'}:${after?.id || 'after'}`}
          model={visualModel}
          beforeDocument={inlinedBefore.content}
          afterDocument={inlinedAfter.content}
          pending={inlinedBefore.pending || inlinedAfter.pending}
          beforeLabel={beforeLabel}
          afterLabel={afterLabel}
          changeIndex={jump.index}
          jumpSeq={jump.seq}
          onStep={step}
        />
      ) : (
        <div className="artifact-compare-grid">
          <section>
            <div className="artifact-compare-label section-label">{t('comparison.beforeLabel', { label: beforeLabel })}</div>
            <DiffSource
              lines={changes.before}
              changeIndexes={beforeChangeIndexes}
              flashIndex={flashIndex}
              sourceRef={beforeRef}
            />
          </section>
          <section>
            <div className="artifact-compare-label section-label">{t('comparison.afterLabel', { label: afterLabel })}</div>
            <DiffSource
              lines={changes.after}
              changeIndexes={afterChangeIndexes}
              flashIndex={flashIndex}
              sourceRef={afterRef}
            />
          </section>
        </div>
      )}
      <footer className="artifact-compare-footer">
        {isPublish ? (
          <>
            {publishReview?.error && (
              <span className="artifact-compare-footer-error" role="alert">{publishReview.error}</span>
            )}
            {publishReview?.onUndo && (
              <Button variant="subtle" disabled={busy || publishReview.busy} onClick={publishReview.onUndo}>
                {Ico.undo(14)} {t('quickEdit.undo')}
              </Button>
            )}
            <Button disabled={busy || publishReview?.busy} onClick={close}>
              {t('comparison.keepDraft')}
            </Button>
            <Button
              variant="primary"
              disabled={busy || publishReview?.busy}
              aria-busy={publishReview?.busy || undefined}
              onClick={publishReview?.onPublish}
            >
              {publishReview?.busy
                ? t('comparison.publishing')
                : isUnshared ? t('comparison.publishChanges') : t('comparison.publishChange')}
            </Button>
          </>
        ) : isAgent ? (
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
