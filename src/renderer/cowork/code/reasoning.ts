import i18n from '../../lib/i18n';
import type { ModelPickerMeta } from '../lib/modelPickerOptions';

// Reasoning effort levels are the model gateway's, not ours. MindsHub's model
// catalog advertises them per model (`modelEfforts`, the same map the Cowork
// composer reads): GPT 5.6 Sol offers none…max, Claude models low…max, Gemini
// low…high, and some models offer none. Every picker in Code Mode shows exactly
// that list for the model in hand, named the way the gateway names it.

/** Per-model effort levels as the catalog advertises them: id → { efforts, default }. */
export type ModelEffortCatalog = NonNullable<ModelPickerMeta['modelEfforts']>;

export interface EffortLevels {
  /** The levels the model offers, in the gateway's order. */
  levels: string[];
  /** The level the gateway uses when a task names none. */
  modelDefault: string | null;
}

/** Picker value meaning "no project default: each task uses its model's default". */
export const MODEL_DEFAULT_VALUE = '__model_default__';


/** The levels a model offers, or null when it offers none or the catalog has not loaded. */
export function effortLevelsFor(model: string, catalog: ModelEffortCatalog | null | undefined): EffortLevels | null {
  const entry = catalog?.[model];
  if (!entry || !Array.isArray(entry.efforts) || entry.efforts.length === 0) return null;
  const levels = entry.efforts.map(String);
  const modelDefault = entry.default && levels.includes(entry.default) ? entry.default : null;
  return { levels, modelDefault };
}


/** Display form of a gateway level, capitalised the way the Cowork composer shows it. */
export function effortLabel(level: string): string {
  if (!level) return level;
  const fallback = level.charAt(0).toUpperCase() + level.slice(1);
  // Known gateway levels are translated; an unknown one keeps its own name.
  return i18n.t(`reasoning.levels.${level}`, { ns: 'code', defaultValue: fallback });
}

function t(key: string, values?: Record<string, unknown>): string {
  return i18n.t(key, { ns: 'code', ...values });
}


/**
 * The level a task asks for explicitly: what was chosen if the model offers
 * it, else the project default if the model offers that. Null means the task
 * names no level and the gateway applies the model's own default.
 */
export function requestedEffort(
  chosen: string | null | undefined,
  projectDefault: string | null | undefined,
  levels: EffortLevels,
): string | null {
  if (chosen && levels.levels.includes(chosen)) return chosen;
  if (projectDefault && levels.levels.includes(projectDefault)) return projectDefault;
  return null;
}


/** The level a task runs at: the requested one, else the model's own default. */
export function resolveEffort(
  chosen: string | null | undefined,
  projectDefault: string | null | undefined,
  levels: EffortLevels,
): string | null {
  return requestedEffort(chosen, projectDefault, levels) ?? levels.modelDefault;
}


/** Composer pill options: one per advertised level, with the defaults marked. */
export function effortOptions(levels: EffortLevels, projectDefault?: string | null) {
  return levels.levels.map((level) => ({
    value: level,
    label: effortLabel(level),
    triggerLabel: t('reasoning.levelEffort', { level: effortLabel(level) }),
    description: level === projectDefault ? t('reasoning.projectDefault') : level === levels.modelDefault ? t('reasoning.modelDefault') : undefined,
  }));
}


/**
 * Composer pill options under an operator's picker (lib/modelPicker): "Default" first, which sends no
 * effort, so a user who never picks runs as the operator set it, then each level the operator allows.
 */
export function operatorEffortOptions(levels: string[]) {
  return [
    { value: MODEL_DEFAULT_VALUE, label: t('reasoning.default'), triggerLabel: t('reasoning.defaultEffort') },
    ...levels.map((level) => ({ value: level, label: effortLabel(level), triggerLabel: t('reasoning.levelEffort', { level: effortLabel(level) }) })),
  ];
}


/** Project settings options: "Model default" first, then the model's levels. */
export function projectEffortOptions(levels: EffortLevels) {
  return [
    {
      value: MODEL_DEFAULT_VALUE,
      label: t('reasoning.modelDefault'),
      description: levels.modelDefault ? effortLabel(levels.modelDefault) : undefined,
    },
    ...levels.levels.map((level) => ({ value: level, label: effortLabel(level) })),
  ];
}
