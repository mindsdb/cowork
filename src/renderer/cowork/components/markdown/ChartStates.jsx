// Loading + error placeholders for chart blocks, and the frame every
// ```chartjs / ```mermaid block sits in. Ported from
// mdb-ai/src/components/Message/ChartLoadingState.jsx + ChartErrorState.jsx
// with our tokens and a small inline spinner so we don't pull lucide.

import { useState } from 'react';
import Ico from '../Icons';
import { useTranslation } from '../../../lib/i18n';

/* The drawn chart's height. The loading state takes the same height so a
   block that finishes streaming swaps in without the message jumping. */
export const CHART_HEIGHT = 280;

export function ChartLoadingState({ height = CHART_HEIGHT }) {
  const { t } = useTranslation('chat');
  return (
    <div
      className="flex items-center justify-center rounded-md bg-surface-2"
      style={{ height }}
      role="status"
      aria-busy="true"
      data-testid="chart-loading"
    >
      <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-ink-4 border-t-transparent" />
      <span className="sr-only">{t('markdown.chart.loading')}</span>
    </div>
  );
}

export function ChartErrorState({ error }) {
  const { t } = useTranslation('chat');
  return (
    <div
      role="alert"
      className="min-h-[120px] max-h-[280px] overflow-y-auto rounded-md border border-danger-border bg-danger-bg p-6"
    >
      <p className="text-center font-body text-body text-danger-text">
        {t('markdown.chart.error', { error })}
      </p>
    </div>
  );
}

/* One chart/diagram action in the block header. Same button and feedback
   markup as the code block's Copy: the delegated listener in
   MarkdownContent reads `data-chart-action` and flips the label the same
   way it does for `data-copy-code`. */
function ChartActionButton({ action, icon, label }) {
  return (
    <button
      type="button"
      className="anton-code-block-copy anton-chart-block-export"
      data-chart-action={action}
      aria-label={label}
      title={label}
    >
      <span className="anton-code-block-copy-icon anton-code-block-copy-icon--idle" aria-hidden="true">{icon}</span>
      <span className="anton-code-block-copy-icon anton-code-block-copy-icon--done" aria-hidden="true">{Ico.check(12)}</span>
      <span className="anton-code-block-copy-label" aria-live="polite">{label}</span>
    </button>
  );
}

/* The code-block card a chart or diagram renders in: the language label and
   actions in the code block's header, the drawing below, and the fence's
   source (MarkdownCode's ordinary code block, passed as `source`) under it
   on demand. Copy-as-image / Download PNG only show once something has
   drawn (CSS keys them on the drawn canvas or SVG). */
export function ChartBlock({ kind, label, source, children }) {
  const { t } = useTranslation('chat');
  const [showSource, setShowSource] = useState(false);
  return (
    <div className="anton-code-block anton-chart-block" data-chart-block={kind}>
      <div className="anton-code-block-header">
        <span className="anton-code-block-lang">{label}</span>
        <span className="anton-chart-block-actions">
          <ChartActionButton action="copy-image" icon={Ico.copy(12)} label={t('markdown.chart.copyImage')} />
          <ChartActionButton action="download-png" icon={Ico.download(12)} label={t('markdown.chart.downloadPng')} />
          <button
            type="button"
            className="anton-code-block-copy"
            aria-expanded={showSource}
            aria-label={showSource ? t('markdown.chart.hideSource') : t('markdown.chart.showSource')}
            title={showSource ? t('markdown.chart.hideSource') : t('markdown.chart.showSource')}
            onClick={() => setShowSource((v) => !v)}
          >
            <span className="anton-code-block-copy-icon" aria-hidden="true">{Ico.code(12)}</span>
          </button>
        </span>
      </div>
      <div className="anton-chart-block-body">{children}</div>
      {showSource ? <div className="anton-chart-block-source">{source}</div> : null}
    </div>
  );
}
