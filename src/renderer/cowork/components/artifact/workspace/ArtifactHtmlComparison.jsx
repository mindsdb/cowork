import { useMemo, useState } from 'react';
import { limitArtifactFrames } from '../artifactPreviewUtils';

function concise(text, limit = 180) {
  const value = String(text || '').trim();
  if (!value) return 'No text';
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
        <div className="artifact-visual-change-summary" aria-label="Changed content summary">
          <div>
            <span className="section-label">Before</span>
            <p>{concise(primaryChange.before)}</p>
          </div>
          <div>
            <span>After</span>
            <p>{concise(primaryChange.after)}</p>
          </div>
          {remainingChanges > 0 && (
            <span className="artifact-visual-more-changes">+{remainingChanges} more</span>
          )}
        </div>
      )}

      <div className="artifact-visual-pane-tabs" role="tablist" aria-label="Comparison side">
        <button
          type="button"
          role="tab"
          aria-selected={activePane === 'before'}
          onClick={() => setActivePane('before')}
        >
          Before
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activePane === 'after'}
          onClick={() => setActivePane('after')}
        >
          After
        </button>
      </div>

      <div className="artifact-visual-compare-grid" data-active-pane={activePane}>
        <section data-comparison-pane="before">
          <div className="artifact-compare-label section-label">Before · {beforeLabel}</div>
          {pending ? (
            <div className="artifact-compare-loading" role="status">Loading page…</div>
          ) : (
            <iframe
              title={`Artifact before ${beforeLabel}`}
              srcDoc={beforeSrcDoc}
              sandbox="allow-scripts"
            />
          )}
        </section>
        <section data-comparison-pane="after">
          <div className="artifact-compare-label section-label">After · {afterLabel}</div>
          {pending ? (
            <div className="artifact-compare-loading" role="status">Loading page…</div>
          ) : (
            <iframe
              title={`Artifact after ${afterLabel}`}
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
