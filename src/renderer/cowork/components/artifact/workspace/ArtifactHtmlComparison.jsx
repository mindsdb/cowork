import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { limitArtifactFrames } from '../artifactPreviewUtils';
import { HTML_COMPARISON_PARENT_SOURCE, HTML_COMPARISON_SOURCE } from './htmlComparisonRuntime';
import i18n, { useTranslation } from '../../../../lib/i18n';

function concise(text, limit = 180) {
  const value = String(text || '').trim();
  if (!value) return i18n.t('comparison.noText', { ns: 'artifacts' });
  return value.length > limit ? `${value.slice(0, limit - 1).trimEnd()}…` : value;
}

export function ArtifactHtmlComparison({
  model,
  beforeDocument,
  afterDocument,
  pending,
  beforeLabel,
  afterLabel,
  changeIndex = 0,
  jumpSeq = 0,
  onStep,
}) {
  const { t } = useTranslation('artifacts');
  const [activePane, setActivePane] = useState('after');
  const beforeFrameRef = useRef(null);
  const afterFrameRef = useRef(null);
  // Inlined documents can be tens of megabytes: scan them once, not on every
  // switch between the Before and After tabs.
  const beforeSrcDoc = useMemo(
    () => (beforeDocument == null ? '' : limitArtifactFrames(beforeDocument)),
    [beforeDocument],
  );
  const afterSrcDoc = useMemo(
    () => (afterDocument == null ? '' : limitArtifactFrames(afterDocument)),
    [afterDocument],
  );
  // The summary follows the change the user has stepped to.
  const currentChange = model.changes[changeIndex] || null;

  // Each frame scrolls itself to the numbered change and flashes it. A change
  // that exists on one side only (an addition or removal) moves that side.
  const showChange = useCallback((index, frames = [beforeFrameRef.current, afterFrameRef.current]) => {
    const change = model.changes[index];
    if (!change) return;
    for (const frame of frames) {
      const present = frame === beforeFrameRef.current ? change.inBefore : change.inAfter;
      if (!present) continue;
      frame?.contentWindow?.postMessage({
        source: HTML_COMPARISON_PARENT_SOURCE,
        token: model.token,
        type: 'goto',
        index,
      }, '*');
    }
  }, [model]);

  useEffect(() => {
    if (jumpSeq > 0) showChange(changeIndex);
  }, [changeIndex, jumpSeq, showChange]);

  // On a narrow window only one pane shows, and a hidden frame cannot scroll;
  // the pane being revealed catches up with the current change.
  const selectPane = (pane) => {
    setActivePane(pane);
    if (pane === activePane) return;
    requestAnimationFrame(() => {
      showChange(changeIndex, [pane === 'before' ? beforeFrameRef.current : afterFrameRef.current]);
    });
  };

  useEffect(() => {
    const onMessage = (event) => {
      const message = event.data;
      // Same channel identity as the visual editor: the token injected before
      // artifact scripts run, not the WindowProxy, which Electron may swap.
      if (message?.source !== HTML_COMPARISON_SOURCE || message.token !== model.token) return;
      if (message.type === 'step' && (message.direction === 1 || message.direction === -1)) {
        onStep?.(message.direction);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [model.token, onStep]);

  return (
    <div className="artifact-visual-compare">
      {currentChange && (
        <div className="artifact-visual-change-summary" aria-label={t('comparison.summary')}>
          <div>
            <span className="section-label">{t('comparison.before')}</span>
            <p>{concise(currentChange.before)}</p>
          </div>
          <div>
            <span>{t('comparison.after')}</span>
            <p>{concise(currentChange.after)}</p>
          </div>
        </div>
      )}

      <div className="artifact-visual-pane-tabs" role="tablist" aria-label={t('comparison.side')}>
        <button
          type="button"
          role="tab"
          aria-selected={activePane === 'before'}
          onClick={() => selectPane('before')}
        >
          {t('comparison.before')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activePane === 'after'}
          onClick={() => selectPane('after')}
        >
          {t('comparison.after')}
        </button>
      </div>

      <div className="artifact-visual-compare-grid" data-active-pane={activePane}>
        <section data-comparison-pane="before">
          <div className="artifact-compare-label section-label">{t('comparison.beforeLabel', { label: beforeLabel })}</div>
          {pending ? (
            <div className="artifact-compare-loading" role="status">{t('comparison.loadingPage')}</div>
          ) : (
            <iframe
              ref={beforeFrameRef}
              title={t('comparison.beforeFrame', { label: beforeLabel })}
              srcDoc={beforeSrcDoc}
              sandbox="allow-scripts"
              onLoad={(event) => showChange(changeIndex, [event.currentTarget])}
            />
          )}
        </section>
        <section data-comparison-pane="after">
          <div className="artifact-compare-label section-label">{t('comparison.afterLabel', { label: afterLabel })}</div>
          {pending ? (
            <div className="artifact-compare-loading" role="status">{t('comparison.loadingPage')}</div>
          ) : (
            <iframe
              ref={afterFrameRef}
              title={t('comparison.afterFrame', { label: afterLabel })}
              srcDoc={afterSrcDoc}
              sandbox="allow-scripts"
              onLoad={(event) => showChange(changeIndex, [event.currentTarget])}
            />
          )}
        </section>
      </div>
    </div>
  );
}

export default ArtifactHtmlComparison;
