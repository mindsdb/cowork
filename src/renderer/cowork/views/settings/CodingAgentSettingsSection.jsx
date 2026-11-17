import { useEffect, useMemo, useState } from 'react';
import ModelSelect from '../../components/ModelSelect';
import { Select } from '../../components/ui';
import { Switch } from '../../components/ui/Switch';
import { host } from '../../../platform/host';
import { codingApi } from '../../code/api';
import { DEFAULT_CODING_AGENT_ENGINE, DEFAULT_CODING_AGENT_MODEL } from '../../code/defaults';
import { getTerminalShellPreference, setTerminalShellPreference } from '../../code/terminalPreferences';
import { buildModelPickerOptions, withModelPickerFallback } from '../../lib/modelPickerOptions';
import { displayModelLabel, recommendedModelOptions } from '../../lib/settingsTransform';
import { Section, SettingsGroup, SettingsSectionPanel } from './settingsLayout';
import i18n, { useTranslation } from '../../../lib/i18n';

export default function CodingAgentSettingsSection({
  settings,
  setSetting,
  footer,
  available,
  enabled,
  onEnabledChange,
  onModelMenuOpenChange,
  modelRefreshing = false,
}) {
  const { t } = useTranslation('settingsTools');
  const [engines, setEngines] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [shells, setShells] = useState([]);
  const [shellLoading, setShellLoading] = useState(false);
  const [shellError, setShellError] = useState('');
  const [shellPreference, setShellPreference] = useState(getTerminalShellPreference);
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
      modelDisabledReasons: settings.modelDisabledReasons,
    });
  }, [modelId, settings.modelEnabled, settings.modelDisabledReasons, settings.modelFamilies, settings.modelLabels, settings.modelProviders, settings.recommendedModels]);

  useEffect(() => {
    if (host.isWeb || !enabled) return undefined;
    let active = true;
    setLoading(true);
    setError('');
    codingApi.engines()
      .then((nextEngines) => {
        if (!active) return;
        setEngines(nextEngines);
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : i18n.t('settingsTools:codingAgent.loadFailed'));
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [enabled]);

  useEffect(() => {
    if (host.isWeb || !enabled) return undefined;
    let active = true;
    setShellLoading(true);
    setShellError('');
    codingApi.terminalShells()
      .then((inventory) => {
        if (!active) return;
        setShells(inventory.items);
        const stored = getTerminalShellPreference();
        if (!inventory.items.some((item) => item.id === stored)) {
          setShellPreference('auto');
          setTerminalShellPreference('auto');
        }
      })
      .catch(() => {
        if (!active) return;
        setShells([]);
        setShellError(i18n.t('settingsTools:codingAgent.shellLoadFailed'));
      })
      .finally(() => { if (active) setShellLoading(false); });
    return () => { active = false; };
  }, [enabled]);

  const engineOptions = engines.map((engine) => ({
    value: engine.id,
    label: engine.label,
    disabled: !engine.available,
    title: engine.available ? undefined : engine.reason || t('codingAgent.unavailable'),
  }));
  if (!available) return null;

  const accessControl = (
    <SettingsGroup title={t('codingAgent.codeModeTitle')}>
      <Section
        title={t('codingAgent.enableCodeMode')}
        subtitle={enabled
          ? t('codingAgent.enabledSubtitle')
          : t('codingAgent.disabledSubtitle')}
      >
        <Switch
          checked={enabled}
          onCheckedChange={onEnabledChange}
          aria-label={t('codingAgent.enableCodeMode')}
        />
      </Section>
    </SettingsGroup>
  );

  if (!enabled) {
    return (
      <SettingsSectionPanel autoSaved>
        {accessControl}
      </SettingsSectionPanel>
    );
  }

  return (
    <SettingsSectionPanel footer={footer}>
      {accessControl}
      <SettingsGroup title={t('codingAgent.groupTitle')}>
        <Section title={t('codingAgent.agentTitle')} subtitle={t('codingAgent.agentSubtitle')}>
          <Select
            value={engineId}
            onValueChange={(value) => setSetting('codingAgentEngine', value)}
            options={engineOptions}
            disabled={loading || !engineOptions.some((engine) => !engine.disabled)}
            loading={loading}
            ariaLabel={t('codingAgent.engineAriaLabel')}
          />
        </Section>
        <Section title={t('codingAgent.modelTitle')} subtitle={t('codingAgent.modelSubtitle')}>
          <ModelSelect
            value={modelId}
            onValueChange={(value) => setSetting('codingAgentModel', value)}
            options={modelOptions}
            variant="field"
            disabled={modelOptions.length === 0}
            loading={loading || modelRefreshing}
            onOpenChange={onModelMenuOpenChange}
            ariaLabel={t('codingAgent.modelAriaLabel')}
          />
        </Section>
        {error && (
          <Section title={t('codingAgent.connectionStatus')}>
            <div className="text-[12px] text-danger">{error}</div>
          </Section>
        )}
      </SettingsGroup>
      <SettingsGroup title={t('codingAgent.terminalTitle')}>
        <Section
          title={t('codingAgent.defaultShell')}
          subtitle={t('codingAgent.defaultShellSubtitle')}
        >
          <Select
            value={shellPreference}
            onValueChange={(value) => {
              setShellPreference(value);
              setTerminalShellPreference(value);
            }}
            options={shells.map((shell) => ({ value: shell.id, label: shell.label }))}
            disabled={shellLoading || shells.length === 0}
            loading={shellLoading}
            menuLabel={t('codingAgent.shellMenuLabel')}
            ariaLabel={t('codingAgent.shellAriaLabel')}
          />
          {shellError && <div className="mt-2 text-[12px] text-danger">{shellError}</div>}
        </Section>
      </SettingsGroup>
    </SettingsSectionPanel>
  );
}
