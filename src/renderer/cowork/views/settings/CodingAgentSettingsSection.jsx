import { useEffect, useMemo, useState } from 'react';
import ModelSelect from '../../components/ModelSelect';
import { Select } from '../../components/ui';
import { host } from '../../../platform/host';
import { codingApi } from '../../code/api';
import { DEFAULT_CODING_AGENT_ENGINE, DEFAULT_CODING_AGENT_MODEL } from '../../code/defaults';
import { buildModelPickerOptions, withModelPickerFallback } from '../../lib/modelPickerOptions';
import { displayModelLabel, recommendedModelOptions } from '../../lib/settingsTransform';
import { Section, SettingsGroup, SettingsSectionPanel } from './settingsLayout';

export default function CodingAgentSettingsSection({ settings, setSetting, footer }) {
  const [engines, setEngines] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const engineId = settings.codingAgentEngine || DEFAULT_CODING_AGENT_ENGINE;
  const modelId = settings.codingAgentModel || DEFAULT_CODING_AGENT_MODEL;
  const modelOptions = useMemo(() => {
    const sources = recommendedModelOptions(
      settings.recommendedModels,
      'minds-cloud',
      settings.modelLabels,
    ).map((option) => ({ id: option.id, name: option.label }));
    return buildModelPickerOptions(withModelPickerFallback(
      sources,
      modelId,
      displayModelLabel(modelId, settings.modelLabels),
    ), {
      modelProviders: settings.modelProviders,
      modelFamilies: settings.modelFamilies,
      modelEnabled: settings.modelEnabled,
    });
  }, [modelId, settings.modelEnabled, settings.modelFamilies, settings.modelLabels, settings.modelProviders, settings.recommendedModels]);

  useEffect(() => {
    if (host.isWeb) return undefined;
    let active = true;
    setLoading(true);
    setError('');
    codingApi.engines()
      .then((nextEngines) => {
        if (!active) return;
        setEngines(nextEngines);
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Could not load coding agent options.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const engineOptions = engines.map((engine) => ({
    value: engine.id,
    label: engine.label,
    disabled: !engine.available,
    title: engine.available ? undefined : engine.reason || 'Unavailable',
  }));
  return (
    <SettingsSectionPanel footer={footer}>
      <SettingsGroup title="Coding agent">
        <Section title="Agent" subtitle="The default coding agent for new projects and tasks. You can change it when starting a task.">
          <Select
            value={engineId}
            onValueChange={(value) => setSetting('codingAgentEngine', value)}
            options={engineOptions}
            disabled={loading || !engineOptions.some((engine) => !engine.disabled)}
            loading={loading}
            ariaLabel="Coding agent engine"
          />
        </Section>
        <Section title="Model" subtitle="The default model for new coding tasks. You can change it before a task starts.">
          <ModelSelect
            value={modelId}
            onValueChange={(value) => setSetting('codingAgentModel', value)}
            options={modelOptions}
            variant="field"
            disabled={modelOptions.length === 0}
            loading={loading}
            ariaLabel="Coding agent model"
          />
        </Section>
        {error && (
          <Section title="Connection status">
            <div className="text-[12px] text-danger">{error}</div>
          </Section>
        )}
      </SettingsGroup>
    </SettingsSectionPanel>
  );
}
