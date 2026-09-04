import { useState } from 'react';

function concise(text, limit = 180) {
  const value = String(text || '').trim();
  if (!value) return 'No text';
  return value.length > limit ? `${value.slice(0, limit - 1).trimEnd()}…` : value;
}

export function ArtifactHtmlComparison({ model, beforeLabel, afterLabel }) {
  const [activePane, setActivePane] = useState('after');
  const primaryChange = model.changes[0] || null;
  const remainingChanges = Math.max(0, model.changes.length - 1);

  return (
    <div className="artifact-visual-compare">
      {primaryChange && (
        <div className="artifact-visual-change-summary" aria-label="Changed content summary">
          <div>
            <span>Before</span>
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
          <div className="artifact-compare-label">Before · {beforeLabel}</div>
          <iframe
            title={`Artifact before ${beforeLabel}`}
            srcDoc={model.before}
            sandbox="allow-scripts"
          />
        </section>
        <section data-comparison-pane="after">
          <div className="artifact-compare-label">After · {afterLabel}</div>
          <iframe
            title={`Artifact after ${afterLabel}`}
            srcDoc={model.after}
            sandbox="allow-scripts"
          />
        </section>
      </div>
    </div>
  );
}

export default ArtifactHtmlComparison;
