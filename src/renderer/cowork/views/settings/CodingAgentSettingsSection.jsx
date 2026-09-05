import { useEffect, useMemo, useState } from 'react';
import ModelSelect from '../../components/ModelSelect';
import { Select } from '../../components/ui';
import { Switch } from '../../components/ui/Switch';
import Button from '../../components/ui/Button';
import { CodeSetupModal } from '../../code/CodeSetupModal';
import { host } from '../../../platform/host';
import { codingApi } from '../../code/api';
import { DEFAULT_CODING_AGENT_ENGINE, DEFAULT_CODING_AGENT_MODEL } from '../../code/defaults';
import { getTerminalShellPreference, setTerminalShellPreference } from '../../code/terminalPreferences';
import { buildModelPickerOptions, withModelPickerFallback } from '../../lib/modelPickerOptions';
import { displayModelLabel, recommendedModelOptions } from '../../lib/settingsTransform';
import { Section, SettingsGroup, SettingsSectionPanel } from './settingsLayout';

export default function CodingAgentSettingsSection({
  settings,
  setSetting,
  footer,
  available,
  enabled,
  onEnabledChange,
}) {
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
    });
  }, [modelId, settings.modelEnabled, settings.modelFamilies, settings.modelLabels, settings.modelProviders, settings.recommendedModels]);

  // Bumped when the setup modal finishes so the agent list is read again from
  // the restarted sidecar: an existing user's `enabled` is already true, so
  // that alone would not refetch, and the old list still marks Codex unavailable.
  const [catalogReload, setCatalogReload] = useState(0);
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
        if (active) setError(reason instanceof Error ? reason.message : 'Could not load coding agent options.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [enabled, catalogReload]);

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
        setShellError('Shell options could not be loaded. New tabs will use Automatic.');
      })
      .finally(() => { if (active) setShellLoading(false); });
    return () => { active = false; };
  }, [enabled]);

  const engineOptions = engines.map((engine) => ({
    value: engine.id,
    label: engine.label,
    disabled: !engine.available,
    title: engine.available ? undefined : engine.reason || 'Unavailable',
  }));
  // The coding agent's components are installed the first time Code Mode is
  // switched on (they are large, so the first install leaves them out), and so
  // is Git where the computer has none. Either one missing means setup is
  // needed: after a partial run where the components landed but Git did not,
  // Code Mode still cannot clone, branch or commit. Unknown readiness must
  // never enable Code Mode before that setup has had a chance to run.
  const [setupStatus, setSetupStatus] = useState(null);
  const [setupError, setSetupError] = useState('');
  const [setupCheck, setSetupCheck] = useState(0);
  const [setupOpen, setSetupOpen] = useState(false);
  useEffect(() => {
    if (!available) return undefined;
    let cancelled = false;
    setSetupStatus(null);
    setSetupError('');
    // The host owns compatibility with older bridges. A failed or malformed
    // response from a current bridge needs a retry, not a successful fallback.
    Promise.resolve().then(() => host.codeSetupStatus())
      .then((result) => {
        if (typeof result?.installed !== 'boolean' || typeof result?.gitWorks !== 'boolean') {
          throw new Error('Invalid Code Mode readiness response');
        }
        if (!cancelled) setSetupStatus(result);
      })
      .catch(() => { if (!cancelled) setSetupError('Could not check this computer. Try again before enabling Code Mode.'); });
    return () => { cancelled = true; };
  }, [available, setupOpen, setupCheck]);
  const componentsMissing = setupStatus?.installed === false;
  const gitMissing = setupStatus?.gitWorks === false;
  const needsSetup = componentsMissing || gitMissing;
  const handleEnabledChange = (next) => {
    if (next && !setupStatus) return;
    if (next && needsSetup) {
      setSetupOpen(true);
      return;
    }
    onEnabledChange(next);
  };
  const completeSetup = () => {
    setSetupStatus({ installed: true, gitWorks: true });
    setSetupOpen(false);
    setCatalogReload((count) => count + 1);
    onEnabledChange(true);
  };
  const missingPiece = componentsMissing ? 'its components are not installed' : 'Git is not installed';

  if (!available) return null;

  const accessControl = (
    <SettingsGroup title="Code Mode">
      <Section
        title="Enable Code Mode"
        subtitle={setupError ? <span role="alert">{setupError}</span> : !setupStatus
          ? 'Checking this computer…'
          : enabled
          ? (needsSetup ? `Code Mode is on, but ${missingPiece} on this computer yet.` : 'Code is available on this computer.')
          : (needsSetup
            ? `Build, test, and review code with an agent on this computer. Switching this on ${componentsMissing ? 'downloads the coding agent, about 110 MB' : 'installs Git'}.`
            : 'Build, test, and review code with an agent on this computer.')}
      >
        <div className="flex items-center gap-3">
          {setupError && <Button size="sm" variant="tinted" onClick={() => setSetupCheck((count) => count + 1)}>Try again</Button>}
          {enabled && needsSetup && (
            <Button size="sm" variant="tinted" onClick={() => setSetupOpen(true)}>Set up now</Button>
          )}
          <Switch
            checked={enabled}
            disabled={!enabled && !setupStatus}
            onCheckedChange={handleEnabledChange}
            aria-label="Enable Code Mode"
          />
        </div>
      </Section>
      <CodeSetupModal open={setupOpen} onClose={() => setSetupOpen(false)} onComplete={completeSetup} />
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
      <SettingsGroup title="Terminal">
        <Section
          title="Default shell"
          subtitle="Used for new terminal tabs on this device. Running terminals are unchanged."
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
            menuLabel="Terminal shell"
            ariaLabel="Default terminal shell"
          />
          {shellError && <div className="mt-2 text-[12px] text-danger">{shellError}</div>}
        </Section>
      </SettingsGroup>
    </SettingsSectionPanel>
  );
}
