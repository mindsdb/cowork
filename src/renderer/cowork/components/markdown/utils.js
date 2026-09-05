export const CHART_TYPES = ['bar', 'line', 'pie', 'scatter'];

/** Parse chart intent JSON, returning { error } on failure. */
export function parseChartIntent(text) {
  try {
    const intent = JSON.parse(text);
    if (!intent.type) return { error: 'Missing chart type' };
    if (!CHART_TYPES.includes(intent.type)) {
      return { error: `Unsupported chart type: "${intent.type}". Supported: ${CHART_TYPES.join(', ')}.` };
    }
    return intent;
  } catch (e) {
    return { error: 'Invalid JSON in chart specification' };
  }
}
