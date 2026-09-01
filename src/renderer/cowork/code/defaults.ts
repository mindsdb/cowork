export const DEFAULT_CODING_AGENT_ENGINE = 'codex';
// MindsHub Inference exposes GPT 5.6 Sol through the stable `gpt` catalog id.
// Older settings may still contain the descriptive `gpt-5.6-sol` id, so all
// Code surfaces resolve their configured value against the runtime catalog.
export const DEFAULT_CODING_AGENT_MODEL = 'gpt';

export function preferredCodingModel(
  current: string,
  available: string[],
  configured = DEFAULT_CODING_AGENT_MODEL,
): string {
  return [
    current,
    configured,
    DEFAULT_CODING_AGENT_MODEL,
    'gpt-codex',
    'fable',
    available[0],
  ].find((candidate): candidate is string => !!candidate && available.includes(candidate)) || '';
}
