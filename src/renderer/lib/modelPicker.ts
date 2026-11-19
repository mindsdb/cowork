import { PLATFORM_UI } from './deployment';

/**
 * Whether users pick a conversation's model in a build without the platform UI.
 *
 * - `off`: no picker, and every question runs on the operator's role models.
 * - `default`: the composer's picker, and each new conversation starts on the operator's model.
 * - `open`: the same picker, and a new conversation starts on the user's last pick.
 */
export type ModelPickerMode = 'off' | 'default' | 'open';

/**
 * The operator's picker mode. The Docker SPA wrapper writes it before the renderer starts, and
 * writes no tag for `off`, as desktop never has one. With the platform UI on this is always `off`:
 * that build shows its own picker, settings gear and effort control.
 */
export function modelPickerMode(): ModelPickerMode {
  if (PLATFORM_UI) return 'off';
  const content = document.head.querySelector<HTMLMetaElement>('meta[name="cowork-model-picker"]')?.content;
  return content === 'default' || content === 'open' ? content : 'off';
}

/**
 * The reasoning efforts the operator lets users pick under its picker: on each model, and with no
 * model, "Operator default", the ones both the planning and the coding model list, since the server
 * gives a question's effort to both.
 */
export interface OperatorEfforts {
  models: Record<string, string[]>;
  operatorDefault: string[];
}

const NO_EFFORTS: OperatorEfforts = { models: {}, operatorDefault: [] };

function efforts(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((effort) => typeof effort === 'string' && /^[a-z]+$/.test(effort));
}

/**
 * The operator's efforts, from the tag the Docker SPA wrapper writes beside the picker's mode. With
 * no tag, with the picker off, or with a tag this build can't read, users pick no effort.
 */
export function operatorEfforts(): OperatorEfforts {
  if (modelPickerMode() === 'off') return NO_EFFORTS;
  const content = document.head.querySelector<HTMLMetaElement>('meta[name="cowork-model-efforts"]')?.content;
  if (!content) return NO_EFFORTS;
  try {
    const parsed: unknown = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object') return NO_EFFORTS;
    const { models, operatorDefault } = parsed as Record<string, unknown>;
    if (!models || typeof models !== 'object' || Array.isArray(models)
      || !Object.values(models).every(efforts) || !efforts(operatorDefault)) {
      return NO_EFFORTS;
    }
    return { models: models as Record<string, string[]>, operatorDefault };
  } catch {
    return NO_EFFORTS;
  }
}

/**
 * The efforts a question may carry under the operator's picker: those of the model it sends, or with
 * no model, null, "Operator default"'s. Empty when the operator lets users pick none there.
 */
export function operatorEffortLevels(model: string | null): string[] {
  const { models, operatorDefault } = operatorEfforts();
  if (model === null) return operatorDefault;
  return Object.hasOwn(models, model) ? models[model] : [];
}
