// A model pill and a reasoning-effort pill, for surfaces away from the
// composer that send a request on a model: the artifact viewer's chat bar
// (ENG-4227). Built from the composer's own parts so it looks and behaves the
// same: <ModelSelect> over buildModelPickerOptions, the Model Router (or
// operator default) row first, the operator's picker policy
// (lib/modelPicker) when platform UI is off, and the effort <Select> shown
// only for a model that advertises levels.
//
// The one difference from the composer is the default effort: a bar request
// runs at "medium" when the model offers it (`pickedEffort`), since a quick
// edit is a small, bounded change.

import { useMemo } from 'react';
import ModelSelect from './ModelSelect.jsx';
import Select from './ui/Select.jsx';
import {
  MODEL_ROUTER_ID, modelRouterLabel, operatorDefaultLabel,
} from '../lib/modelCatalog';
import { buildModelPickerOptions, offeredModels } from '../lib/modelPickerOptions';
import {
  MODEL_DEFAULT_VALUE, effortLevelsFor, effortOptions, operatorEffortOptions,
} from '../code/reasoning';
import { PLATFORM_UI } from '../../lib/deployment';
import { modelPickerMode, operatorEffortLevels } from '../../lib/modelPicker';
import { useTranslation } from '../../lib/i18n';

export const DEFAULT_EFFORT = 'medium';

const realModelId = (model) => (model?.id && model.id !== MODEL_ROUTER_ID ? model.id : null);

/**
 * The effort a request on `model` sends. `effort` is the user's pick: null
 * when they made none, '' for the operator picker's "Default" (send none).
 * Only a model in the catalog's `modelEfforts` (GET
 * /settings/recommended-models, the composer's own source) takes an effort.
 * With no pick, "medium" where the model offers it, else the model's own
 * `default`, as the server would apply; a model with no default sends none.
 * '' means no effort is sent.
 */
export function pickedEffort({ model, effort = null, modelMeta, operatorPicker = modelPickerMode() !== 'off' }) {
  if (operatorPicker) {
    const levels = operatorEffortLevels(realModelId(model));
    if (effort === '') return '';
    if (effort && levels.includes(effort)) return effort;
    return levels.includes(DEFAULT_EFFORT) ? DEFAULT_EFFORT : '';
  }
  const levels = effortLevelsFor(model?.id, modelMeta?.modelEfforts);
  if (!levels) return '';
  if (effort && levels.levels.includes(effort)) return effort;
  if (levels.levels.includes(DEFAULT_EFFORT)) return DEFAULT_EFFORT;
  return levels.modelDefault || '';
}

export function ModelEffortPicker({
  models,
  modelMeta,
  model,
  onModelChange,
  effort = null,
  onEffortChange,
  className = 'meta-pill',
}) {
  const { t } = useTranslation('chat');
  const operatorPicker = modelPickerMode() !== 'off';
  const operatorModels = useMemo(
    () => (operatorPicker ? offeredModels(models || [], modelMeta?.modelEnabled) : []),
    [operatorPicker, models, modelMeta?.modelEnabled],
  );
  const options = useMemo(() => {
    if (operatorPicker) {
      return [
        { value: MODEL_ROUTER_ID, label: operatorDefaultLabel(), title: t('composer.model.operatorDefaultTitle'), pin: 'top' },
        ...buildModelPickerOptions(operatorModels, modelMeta),
      ];
    }
    return [
      { value: MODEL_ROUTER_ID, label: modelRouterLabel(), maker: 'mindshub', title: t('composer.model.routerTitle') },
      ...buildModelPickerOptions(models || [], modelMeta),
    ];
  }, [operatorPicker, operatorModels, models, modelMeta, t]);

  // Same rule as the composer: platform UI, or an operator picker that
  // offers at least one model.
  if (!(PLATFORM_UI || operatorModels.length > 0)) return null;

  const value = options.some((o) => o.value === model?.id) ? model.id : MODEL_ROUTER_ID;
  const shown = pickedEffort({ model, effort, modelMeta, operatorPicker });
  const levels = operatorPicker ? null : effortLevelsFor(model?.id, modelMeta?.modelEfforts);
  const operatorLevels = operatorPicker ? operatorEffortLevels(realModelId(model)) : [];

  return (
    <>
      <ModelSelect
        value={value}
        onValueChange={(id) => {
          const found = options.find((o) => o.value === id);
          onModelChange?.({ id, name: found?.label || id });
        }}
        onOpenChange={(open) => { if (open) Promise.resolve(modelMeta?.onRefresh?.()).catch(() => {}); }}
        options={options}
        variant="unstyled"
        className={className}
        ariaLabel={t('composer.model.choose')}
        placeholder={t('composer.model.select')}
      />
      {PLATFORM_UI && !operatorPicker && levels && (
        <Select
          // A model with no default sends none and runs at the server's
          // choice; the pill then names the first level it offers.
          value={shown || levels.levels[0]}
          onValueChange={onEffortChange}
          options={effortOptions(levels)}
          variant="unstyled"
          className={className}
          ariaLabel={t('composer.model.effort')}
          menuLabel={t('composer.model.effort')}
        />
      )}
      {operatorPicker && operatorLevels.length > 0 && (
        <Select
          value={shown || MODEL_DEFAULT_VALUE}
          onValueChange={(v) => onEffortChange?.(v === MODEL_DEFAULT_VALUE ? '' : v)}
          options={operatorEffortOptions(operatorLevels)}
          variant="unstyled"
          className={className}
          ariaLabel={t('composer.model.effort')}
          menuLabel={t('composer.model.effort')}
        />
      )}
    </>
  );
}

export default ModelEffortPicker;
