export const DEFAULT_CODING_AGENT_ENGINE = 'codex';
// MindsHub Inference exposes GPT 5.6 Sol through the stable `gpt` catalog id.
// Older settings and projects may still contain the descriptive `gpt-5.6-sol`
// id, so all Code surfaces resolve their configured value against the runtime
// catalog and fall back to the id the catalog actually advertises.
export const DEFAULT_CODING_AGENT_MODEL = 'gpt';
const LEGACY_CODING_MODEL_IDS: Record<string, string> = { 'gpt-5.6-sol': DEFAULT_CODING_AGENT_MODEL };

function canonicalCodingModel(id: string): string {
  return LEGACY_CODING_MODEL_IDS[id] || id;
}

export function preferredCodingModel(
  current: string,
  available: string[],
  configured = DEFAULT_CODING_AGENT_MODEL,
): string {
  return [
    current,
    canonicalCodingModel(current),
    configured,
    canonicalCodingModel(configured),
    DEFAULT_CODING_AGENT_MODEL,
    'gpt-codex',
    'fable',
    available[0],
  ].find((candidate): candidate is string => !!candidate && available.includes(candidate)) || '';
}
