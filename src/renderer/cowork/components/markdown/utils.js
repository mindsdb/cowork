// Shared markdown helpers. Currently just chart-intent parsing.
// Ported from mdb-ai/src/components/Message/utils.js.

import i18n from '../../../lib/i18n';

export const CHART_TYPES = ['bar', 'line', 'pie', 'scatter'];

/**
 * Parse a chart intent JSON from a code block body.
 * Returns the parsed intent, or { error } if parsing fails.
 */
export function parseChartIntent(text) {
  try {
    const intent = JSON.parse(text);
    if (!intent.type) return { error: i18n.t('markdown.chart.missingType', { ns: 'chat' }) };
    if (!CHART_TYPES.includes(intent.type)) {
      return { error: i18n.t('markdown.chart.unsupportedType', { ns: 'chat', type: intent.type, supported: CHART_TYPES.join(', ') }) };
    }
    return intent;
  } catch (e) {
    return { error: i18n.t('markdown.chart.invalidJson', { ns: 'chat' }) };
  }
}
