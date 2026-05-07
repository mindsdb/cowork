import { useState } from 'react';
import Ico from '../components/Icons';
import { validateSettings } from '../api';

// Provider preset → underlying canonical fields. The backend only knows
// three providers (anthropic / openai / openai-compatible). Gemini and
// Minds Cloud are presets that translate to openai-compatible + a known
// base URL on save, and are recognized back from those values on load.
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
const MINDS_API_PATH_SUFFIX = '/api/v1';

const PROVIDER_PRESETS = [
  { value: 'anthropic',         label: 'Anthropic' },
  { value: 'openai',            label: 'OpenAI' },
  { value: 'gemini',            label: 'Gemini' },
  { value: 'openai-compatible', label: 'Compatible' },
  { value: 'minds-cloud',       label: 'Minds Cloud' },
];

function inferProviderPreset(s) {
  const provider = s.planningProvider || 'anthropic';
  const baseUrl = (s.openaiBaseUrl || '').trim();
  if (provider === 'anthropic') return 'anthropic';
  if (provider === 'openai') return 'openai';
  if (provider === 'openai-compatible') {
    if (baseUrl.startsWith('https://generativelanguage.googleapis.com')) return 'gemini';
    if (baseUrl.includes('mdb.ai') || baseUrl.endsWith(MINDS_API_PATH_SUFFIX) && (s.mindsApiKey || s.mindsUrl)) {
      return 'minds-cloud';
    }
    return 'openai-compatible';
  }
  return 'anthropic';
}

function applyProviderPreset(preset, settings, setSetting) {
  if (preset === 'anthropic') {
    setSetting('planningProvider', 'anthropic');
    setSetting('codingProvider', 'anthropic');
  } else if (preset === 'openai') {
    setSetting('planningProvider', 'openai');
    setSetting('codingProvider', 'openai');
    setSetting('openaiBaseUrl', '');
  } else if (preset === 'gemini') {
    setSetting('planningProvider', 'openai-compatible');
    setSetting('codingProvider', 'openai-compatible');
    setSetting('openaiBaseUrl', GEMINI_BASE_URL);
  } else if (preset === 'openai-compatible') {
    setSetting('planningProvider', 'openai-compatible');
    setSetting('codingProvider', 'openai-compatible');
    if ((settings.openaiBaseUrl || '').startsWith('https://generativelanguage.googleapis.com')) {
      setSetting('openaiBaseUrl', '');
    }
  } else if (preset === 'minds-cloud') {
    setSetting('planningProvider', 'openai-compatible');
    setSetting('codingProvider', 'openai-compatible');
    const mindsUrl = (settings.mindsUrl || 'https://mdb.ai').replace(/\/+$/, '');
    setSetting('mindsUrl', mindsUrl);
    setSetting('openaiBaseUrl', `${mindsUrl}${MINDS_API_PATH_SUFFIX}`);
    if (settings.mindsApiKey && !settings.openaiApiKey) {
      setSetting('openaiApiKey', settings.mindsApiKey);
    }
  }
}

function Section({ title, subtitle, children }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '1fr 320px', gap: 24,
      padding: '16px 0', borderBottom: '1px solid var(--border-subtle)',
      alignItems: 'flex-start',
    }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-strong)' }}>{title}</div>
        {subtitle && <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 4 }}>{subtitle}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}

// Collapsible group of sections. Defaults to open; click the header to
// toggle. Uses the theme tokens so it reads well in light + dark.
function CollapsibleGroup({ title, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{
      border: '1px solid var(--border-subtle)',
      borderRadius: 10,
      background: 'var(--surface-glass)',
      WebkitBackdropFilter: 'blur(var(--surface-glass-blur))',
      backdropFilter: 'blur(var(--surface-glass-blur))',
      marginBottom: 14,
      overflow: 'hidden',
    }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8,
          padding: '14px 18px', background: 'transparent', border: 0,
          fontFamily: 'var(--font-sans)', fontSize: 12.5, fontWeight: 600,
          letterSpacing: '0.04em', textTransform: 'uppercase',
          color: 'var(--text-muted)', cursor: 'pointer', textAlign: 'left',
        }}
      >
        <span style={{
          display: 'inline-flex', width: 14, height: 14,
          color: 'var(--text-muted)',
          transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
          transition: 'transform 180ms cubic-bezier(0.32, 0.72, 0, 1)',
        }}>{Ico.chevronRight ? Ico.chevronRight(12) : '›'}</span>
        <span style={{ flex: 1 }}>{title}</span>
      </button>
      {open && (
        <div style={{ padding: '0 18px 8px' }}>{children}</div>
      )}
    </div>
  );
}

function Segmented({ value, onChange, options, style }) {
  return (
    <div className="segmented" style={style}>
      {options.map((o) => (
        <button
          key={o.value}
          className={value === o.value ? 'active' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ value, onChange }) {
  return (
    <button
      role="switch"
      aria-checked={value}
      className={`toggle${value ? ' on' : ''}`}
      onClick={() => onChange(!value)}
    >
      <span className="toggle-thumb" />
    </button>
  );
}

function TextInput({ value, onChange, placeholder }) {
  return (
    <input
      className="field-input"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  );
}

function ApiKeyInput({ value, onChange, placeholder }) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <input
        className="field-input mono"
        type={show ? 'text' : 'password'}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || '********************'}
        style={{ paddingRight: 56 }}
      />
      <button
        type="button"
        onClick={() => setShow(!show)}
        style={{
          position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
          border: 0, background: 'transparent', cursor: 'pointer',
          fontSize: 11, color: 'var(--ink-3)', padding: '4px 8px',
          fontFamily: 'var(--font-mono)', letterSpacing: '0.04em',
          textTransform: 'uppercase',
        }}
      >
        {show ? 'hide' : 'show'}
      </button>
    </div>
  );
}

export default function SettingsView({ settings, setSetting, onSave, theme, onThemeChange }) {
  const [saved, setSaved] = useState(false);
  const [validation, setValidation] = useState(null);
  const configReady = validation?.configReady ?? settings.configReady;
  const configError = validation?.configError || settings.configError;

  const save = async () => {
    try {
      const result = await onSave(settings);
      setValidation(result);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setValidation({
        status: 'error',
        configReady: false,
        configError: err.message || 'Settings could not be saved.',
      });
      setSaved(false);
    }
  };

  const validate = async () => {
    try {
      const result = await validateSettings();
      setValidation(result);
    } catch (err) {
      setValidation({
        status: 'error',
        configReady: false,
        configError: err.message || 'Settings could not be validated.',
      });
    }
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        position: 'relative', minHeight: 0,
      }}>
        <div className="scroll-clean" style={{
          flex: 1, overflowY: 'auto',
          padding: '28px 28px 96px',
        }}>
          <div style={{ maxWidth: 820 }}>
            <h2 className="page-title" style={{ marginTop: 0, marginBottom: 6 }}>Settings</h2>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 22 }}>
              Anton configuration and local desktop preferences.
            </div>

            {/* Status banner — token-driven so it reads in dark + light. */}
            <div style={{
              padding: 14, marginBottom: 22,
              border: `1px solid ${configReady ? 'rgba(93,146,135,0.45)' : 'rgba(211,80,80,0.40)'}`,
              background: configReady ? 'rgba(93,146,135,0.10)' : 'rgba(211,80,80,0.08)',
              borderRadius: 10,
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <span style={{
                width: 30, height: 30, borderRadius: 8,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                color: configReady ? 'var(--sage-500)' : '#E07060',
                background: configReady ? 'rgba(93,146,135,0.16)' : 'rgba(211,80,80,0.14)',
              }}>{configReady ? Ico.check(15) : Ico.key(15)}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 650, color: 'var(--text-strong)' }}>
                  {configReady ? 'Anton is configured' : 'Anton needs configuration'}
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 2 }}>
                  {configError || 'Provider, model, and credentials are ready.'}
                </div>
              </div>
              <button className="btn-secondary" onClick={validate}>Test</button>
            </div>

            <CollapsibleGroup title="Appearance">
              <Section title="Theme" subtitle="Light or dark — also drives the animated background.">
                <Segmented
                  value={theme || 'dark'}
                  onChange={(v) => onThemeChange?.(v)}
                  options={[
                    { value: 'light', label: 'Light' },
                    { value: 'dark',  label: 'Dark' },
                  ]}
                />
              </Section>
              <Section title="Greeting" subtitle="The line shown when you start a new task.">
                <TextInput value={settings.greeting} onChange={(v) => setSetting('greeting', v)} />
              </Section>
              <Section title="Dot grid" subtitle="Decorative dot pattern on the home screen.">
                <Toggle value={settings.showDots} onChange={(v) => setSetting('showDots', v)} />
              </Section>
              <Section title="Tone" subtitle="How Anton phrases its responses.">
                <Segmented
                  value={settings.tone}
                  onChange={(v) => setSetting('tone', v)}
                  options={[
                    { value: 'concise', label: 'Concise' },
                    { value: 'balanced', label: 'Balanced' },
                    { value: 'detailed', label: 'Detailed' },
                  ]}
                />
              </Section>
              <Section title="Auto-pin recents" subtitle="Pin tasks you visit more than 3 times.">
                <Toggle value={settings.autoPin} onChange={(v) => setSetting('autoPin', v)} />
              </Section>
            </CollapsibleGroup>

            <CollapsibleGroup title="Models">
              {/* Provider section now 2-row: provider type Segmented on the
                  left, planning + coding models stacked on the right.
                  Gemini + Minds Cloud remain in the Segmented as presets
                  that auto-fill the openai-compatible base URL. */}
              <Section title="Provider" subtitle="Both planning + coding. Gemini and Minds Cloud are presets that map to OpenAI-compatible with the right base URL.">
                <Segmented
                  value={inferProviderPreset(settings)}
                  onChange={(v) => applyProviderPreset(v, settings, setSetting)}
                  options={PROVIDER_PRESETS}
                  style={{ display: 'flex', flexWrap: 'wrap', width: '100%' }}
                />
              </Section>
              <Section title="Planning model" subtitle="Used for reasoning, orchestration, and responses.">
                <TextInput
                  value={settings.planningModel ?? settings.defaultModel ?? ''}
                  onChange={(v) => {
                    setSetting('planningModel', v);
                    setSetting('defaultModel', v);
                  }}
                  placeholder="claude-sonnet-4-6"
                />
              </Section>
              <Section title="Coding model" subtitle="Used for scratchpad code generation.">
                <TextInput
                  value={settings.codingModel ?? 'claude-haiku-4-5-20251001'}
                  onChange={(v) => setSetting('codingModel', v)}
                  placeholder="claude-haiku-4-5-20251001"
                />
              </Section>
            </CollapsibleGroup>

            <CollapsibleGroup title="Credentials">
              <Section title="Anthropic API key" subtitle="Required for Claude models.">
                <ApiKeyInput
                  value={settings.anthropicApiKey ?? ''}
                  onChange={(v) => setSetting('anthropicApiKey', v)}
                  placeholder="sk-ant-********"
                />
              </Section>
              <Section title="OpenAI API key" subtitle="Required for GPT models when you use OpenAI directly.">
                <ApiKeyInput
                  value={settings.openaiApiKey ?? ''}
                  onChange={(v) => setSetting('openaiApiKey', v)}
                  placeholder="sk-********"
                />
              </Section>
              <Section title="OpenAI-compatible base URL" subtitle="Required for OpenAI-compatible providers unless Minds credentials derive it.">
                <TextInput
                  value={settings.openaiBaseUrl ?? ''}
                  onChange={(v) => setSetting('openaiBaseUrl', v)}
                  placeholder="https://example.com/v1"
                />
              </Section>
              <Section title="Minds API key" subtitle="Used for Minds-backed routing and publishing.">
                <ApiKeyInput
                  value={settings.mindsApiKey ?? ''}
                  onChange={(v) => setSetting('mindsApiKey', v)}
                  placeholder="mdb_********"
                />
              </Section>
              <Section title="Minds URL" subtitle="Base URL for Minds-backed Anton features.">
                <TextInput
                  value={settings.mindsUrl ?? 'https://mdb.ai'}
                  onChange={(v) => setSetting('mindsUrl', v)}
                  placeholder="https://mdb.ai"
                />
              </Section>
              <Section title="Minds mind" subtitle="Optional Mind name to use for data-aware tasks.">
                <TextInput
                  value={settings.mindsMindName ?? ''}
                  onChange={(v) => setSetting('mindsMindName', v)}
                  placeholder="sales_data_expert"
                />
              </Section>
              <Section title="Minds datasource" subtitle="Optional datasource name and engine.">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <TextInput
                    value={settings.mindsDatasource ?? ''}
                    onChange={(v) => setSetting('mindsDatasource', v)}
                    placeholder="datasource name"
                  />
                  <TextInput
                    value={settings.mindsDatasourceEngine ?? ''}
                    onChange={(v) => setSetting('mindsDatasourceEngine', v)}
                    placeholder="postgres"
                  />
                </div>
              </Section>
            </CollapsibleGroup>

            <CollapsibleGroup title="Memory" defaultOpen={false}>
              <Section title="Memory mode" subtitle="How Anton updates its long-term memory.">
                <Segmented
                  value={settings.memoryMode ?? 'autopilot'}
                  onChange={(v) => setSetting('memoryMode', v)}
                  options={[
                    { value: 'autopilot', label: 'Autopilot' },
                    { value: 'copilot', label: 'Copilot' },
                    { value: 'off', label: 'Off' },
                  ]}
                />
              </Section>
              <Section title="Episodic memory" subtitle="Save conversation history for future recall.">
                <Toggle value={settings.episodicMemory ?? true} onChange={(v) => setSetting('episodicMemory', v)} />
              </Section>
              <Section title="Proactive dashboards" subtitle="Auto-generate HTML reports from scratchpad output.">
                <Toggle value={settings.proactiveDashboards ?? false} onChange={(v) => setSetting('proactiveDashboards', v)} />
              </Section>
            </CollapsibleGroup>
          </div>
        </div>

        {/* Sticky save bar — sits at the bottom of the panel, glassy
            translucent backdrop so the gravity field hints through it.
            Primary button glows in dark mode (token-driven). */}
        <div style={{
          position: 'absolute', left: 0, right: 0, bottom: 0,
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '14px 28px',
          background: 'var(--surface-glass)',
          WebkitBackdropFilter: 'blur(var(--surface-glass-blur))',
          backdropFilter: 'blur(var(--surface-glass-blur))',
          borderTop: '1px solid var(--border-subtle)',
        }}>
          <div style={{ flex: 1, fontSize: 12.5, color: 'var(--text-muted)' }}>
            {saved ? 'Settings saved.' : configError ? configError : 'Changes apply on save.'}
          </div>
          <button className="btn-secondary" onClick={validate}>Test</button>
          <button
            className="btn-primary"
            onClick={save}
            style={{ minWidth: 132 }}
          >
            {saved ? <>{Ico.check(14)} Saved</> : 'Save settings'}
          </button>
        </div>
      </div>
    </div>
  );
}
