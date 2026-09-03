import type { ReasoningEffort } from './api';

// One list for every place that offers reasoning effort (New Task panel,
// Project settings, Task controls), so labels and order never drift.
export const REASONING_EFFORTS: { value: ReasoningEffort; label: string; description: string }[] = [
  { value: 'minimal', label: 'Minimal', description: 'Quickest answers, least deliberation' },
  { value: 'low', label: 'Low', description: 'Light deliberation for small changes' },
  { value: 'medium', label: 'Medium', description: 'Balanced speed and care' },
  { value: 'high', label: 'High', description: 'Thorough; a good default for code' },
  { value: 'xhigh', label: 'Extra high', description: 'Maximum deliberation, slowest' },
];

/** Value used in pickers for "let the model decide". */
export const DEFAULT_EFFORT_VALUE = 'default';

export function reasoningEffortLabel(effort: ReasoningEffort | null | undefined): string {
  return REASONING_EFFORTS.find((item) => item.value === effort)?.label || 'Default';
}

export function isReasoningEffort(value: string): value is ReasoningEffort {
  return REASONING_EFFORTS.some((item) => item.value === value);
}

/**
 * Picker options with a leading "Default" entry meaning "model default". The
 * collapsed trigger reads "High effort" so the value is unambiguous next to
 * the model and permission pills.
 */
export function reasoningEffortOptions(defaultDescription = 'Let the model decide') {
  return [
    { value: DEFAULT_EFFORT_VALUE, label: 'Default', triggerLabel: 'Default effort', description: defaultDescription },
    ...REASONING_EFFORTS.map((item) => ({ ...item, triggerLabel: `${item.label} effort` })),
  ];
}
