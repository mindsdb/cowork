import { diagnostic } from '../../../../shared/diagnostics';
// A ```mermaid fence drawn as an inline SVG. Mermaid is loaded on first use
// (it is large) and runs at securityLevel 'strict': no click handlers, no
// HTML in labels, its own DOMPurify pass over the SVG. Labels render as SVG
// text (htmlLabels off) rather than <foreignObject>, which also keeps the
// SVG drawable onto a canvas for Copy as image / Download PNG.
//
// MarkdownCode caps the source (validateMermaidSource in ./utils) before it
// gets here.

import { useEffect, useId, useState } from 'react';
import { ChartErrorState, ChartLoadingState } from './ChartStates';
import { useThemeVersion } from './MessageChart';
import { MERMAID_LIMITS, mermaidThemeVariables, readChartTheme } from './utils';

let renderSeq = 0;

export function MessageMermaid({ source }) {
  const reactId = useId();
  const themeVersion = useThemeVersion();
  const [state, setState] = useState({ svg: null, error: null });

  useEffect(() => {
    let cancelled = false;
    renderSeq += 1;
    // Mermaid looks its render target up by id: keep it selector-safe.
    const id = `anton-mermaid-${reactId.replace(/[^\w-]/g, '')}-${renderSeq}`;
    (async () => {
      try {
        const { default: mermaid } = await import('mermaid');
        const theme = readChartTheme();
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'base',
          themeVariables: mermaidThemeVariables(theme),
          fontFamily: theme.fontBody,
          htmlLabels: false,
          flowchart: { htmlLabels: false },
          maxTextSize: MERMAID_LIMITS.maxBytes,
        });
        const { svg } = await mermaid.render(id, source);
        if (!cancelled) setState({ svg, error: null });
      } catch (e) {
        diagnostic('renderer.cowork.components.markdown.MessageMermaid', 'ERROR', 'messagemermaid_render_error', '[MessageMermaid] render error', e);
        if (!cancelled) setState({ svg: null, error: e instanceof Error ? e.message : String(e) });
      } finally {
        // A failed render can leave its scratch node in <body>.
        document.getElementById(`d${id}`)?.remove();
      }
    })();
    return () => { cancelled = true; };
  }, [source, themeVersion, reactId]);

  if (state.error) return <ChartErrorState error={state.error} />;
  if (!state.svg) return <ChartLoadingState />;
  return (
    <div
      className="anton-mermaid-svg"
      // Mermaid's own output, sanitized by it at securityLevel 'strict'.
      dangerouslySetInnerHTML={{ __html: state.svg }}
    />
  );
}
