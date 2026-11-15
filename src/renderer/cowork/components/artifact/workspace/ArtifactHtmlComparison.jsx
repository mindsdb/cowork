import { useMemo, useState } from 'react';
import { limitArtifactFrames } from '../artifactPreviewUtils';
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
}) {
  const { t } = useTranslation('artifacts');
  const [activePane, setActivePane] = useState('after');
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
  const primaryChange = model.changes[0] || null;
  const remainingChanges = Math.max(0, model.changes.length - 1);

  return (
    <div className="artifact-visual-compare">
      {primaryChange && (
        <div className="artifact-visual-change-summary" aria-label={t('comparison.summary')}>
          <div>
            <span className="section-label">{t('comparison.before')}</span>
            <p>{concise(primaryChange.before)}</p>
          </div>
          <div>
            <span>{t('comparison.after')}</span>
            <p>{concise(primaryChange.after)}</p>
          </div>
          {remainingChanges > 0 && (
            <span className="artifact-visual-more-changes">{t('comparison.more', { count: remainingChanges })}</span>
          )}
        </div>
      )}

      <div className="artifact-visual-pane-tabs" role="tablist" aria-label={t('comparison.side')}>
        <button
          type="button"
          role="tab"
          aria-selected={activePane === 'before'}
          onClick={() => setActivePane('before')}
        >
          {t('comparison.before')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activePane === 'after'}
          onClick={() => setActivePane('after')}
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
              title={t('comparison.beforeFrame', { label: beforeLabel })}
              srcDoc={beforeSrcDoc}
              sandbox="allow-scripts"
            />
          )}
        </section>
        <section data-comparison-pane="after">
          <div className="artifact-compare-label section-label">{t('comparison.afterLabel', { label: afterLabel })}</div>
          {pending ? (
            <div className="artifact-compare-loading" role="status">{t('comparison.loadingPage')}</div>
          ) : (
            <iframe
              title={t('comparison.afterFrame', { label: afterLabel })}
              srcDoc={afterSrcDoc}
              sandbox="allow-scripts"
            />
          )}
        </section>
      </div>
    </div>
  );
}

export default ArtifactHtmlComparison;
