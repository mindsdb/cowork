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
  return level ? level.charAt(0).toUpperCase() + level.slice(1) : level;
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
    triggerLabel: `${effortLabel(level)} effort`,
    description: level === projectDefault ? 'Project default' : level === levels.modelDefault ? 'Model default' : undefined,
  }));
}


/** Project settings options: "Model default" first, then the model's levels. */
export function projectEffortOptions(levels: EffortLevels) {
  return [
    {
      value: MODEL_DEFAULT_VALUE,
      label: 'Model default',
      description: levels.modelDefault ? effortLabel(levels.modelDefault) : undefined,
    },
    ...levels.levels.map((level) => ({ value: level, label: effortLabel(level) })),
  ];
}
