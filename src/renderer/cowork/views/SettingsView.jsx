import { useState } from 'react';
import Ico from '../components/Icons';
import { validateSettings, revealSettingKey } from '../api';

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

// Default models we drop into the planning/coding fields when the user
// switches providers. Empty strings mean "user must fill in" (true for
// generic openai-compatible and minds-cloud where the model name depends
// on the deployment).
const PROVIDER_DEFAULTS = {
  anthropic:           { planning: 'claude-sonnet-4-6', coding: 'claude-haiku-4-5-20251001' },
  openai:              { planning: 'gpt-5.4',           coding: 'gpt-5.4-mini' },
  gemini:              { planning: 'gemini-2.5-pro',    coding: 'gemini-2.5-flash' },
  'openai-compatible': { planning: '',                  coding: '' },
  // Minds Cloud uses sentinel model names that its OpenAI-compatible
  // router resolves to the right backing model. `_reasoning_` for
  // planning, `_code_` for scratchpad coding — these are the only pair
  // the mdb.ai router currently accepts. (Earlier codebase comments
  // referenced `_reason_`; that name 4xx's against the live router.)
  'minds-cloud':       { planning: '_reasoning_',       coding: '_code_' },
};

// Known model lists per provider — surfaced as quick-pick chips below
// the text input so users can swap models without typing.
const PROVIDER_MODELS = {
  anthropic:     ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5-20251001'],
  openai:        ['gpt-5.4', 'gpt-5.4-mini', 'o3', 'o4-mini'],
  gemini:        ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-3-flash-preview'],
  // Minds Cloud intentionally has no quick-picks: the planning/coding
  // pair is fixed (`_reasoning_` / `_code_`) and gets auto-filled by
  // applyProviderPreset, so a chip row would just be noise.
};

// Per-provider credential relevance map. Drives the Required / Optional /
// Unused badges and the dimming of unrelated rows in the Credentials card.
const CREDENTIAL_RELEVANCE = {
  anthropic: {
    anthropicApiKey: 'required',
    openaiApiKey:    'unused',
    openaiBaseUrl:   'unused',
    mindsApiKey:     'optional',
    mindsUrl:        'unused',
    mindsMindName:   'unused',
    mindsDatasource: 'unused',
  },
  openai: {
    anthropicApiKey: 'unused',
    openaiApiKey:    'required',
    openaiBaseUrl:   'unused',
    mindsApiKey:     'optional',
    mindsUrl:        'unused',
    mindsMindName:   'unused',
    mindsDatasource: 'unused',
  },
  gemini: {
    anthropicApiKey: 'unused',
    openaiApiKey:    'required',
    openaiBaseUrl:   'auto',
    mindsApiKey:     'optional',
    mindsUrl:        'unused',
    mindsMindName:   'unused',
    mindsDatasource: 'unused',
  },
  'openai-compatible': {
    anthropicApiKey: 'unused',
    openaiApiKey:    'required',
    openaiBaseUrl:   'required',
    mindsApiKey:     'optional',
    mindsUrl:        'unused',
    mindsMindName:   'unused',
    mindsDatasource: 'unused',
  },
  'minds-cloud': {
    // OpenAI key + base URL are populated as a side-effect of the Minds
    // preset (the backend reuses the openai-compatible pipeline). They
    // aren't something the user maintains — keep them dimmed so attention
    // stays on the Minds credentials.
    anthropicApiKey: 'unused',
    openaiApiKey:    'unused',
    openaiBaseUrl:   'unused',
    mindsApiKey:     'required',
    mindsUrl:        'required',
    mindsMindName:   'optional',
    mindsDatasource: 'optional',
  },
};

function inferProviderPreset(s) {
  const provider = s.planningProvider || 'anthropic';
  const baseUrl = (s.openaiBaseUrl || '').trim();
  if (provider === 'anthropic') return 'anthropic';
  if (provider === 'openai') return 'openai';
  if (provider === 'openai-compatible') {
    if (baseUrl.startsWith('https://generativelanguage.googleapis.com/')) return 'gemini';
    if (baseUrl.includes('mdb.ai') || baseUrl.endsWith(MINDS_API_PATH_SUFFIX) && (s.mindsApiKey || s.mindsUrl)) {
      return 'minds-cloud';
    }
    return 'openai-compatible';
  }
  return 'anthropic';
}

// True iff the credentials needed for `preset` are present in `s`.
function isProviderConfigured(preset, s) {
  const trim = (v) => (typeof v === 'string' ? v.trim() : '');
  if (preset === 'anthropic') return Boolean(trim(s.anthropicApiKey));
  if (preset === 'openai') return Boolean(trim(s.openaiApiKey));
  if (preset === 'gemini') return Boolean(trim(s.openaiApiKey));
  if (preset === 'openai-compatible') return Boolean(trim(s.openaiApiKey) && trim(s.openaiBaseUrl));
  if (preset === 'minds-cloud') return Boolean(trim(s.mindsApiKey) && trim(s.mindsUrl));
  return false;
}

function applyProviderPreset(preset, settings, setSetting) {
  // 1. Wire the canonical provider field(s) to the underlying backend
  //    representation. Gemini + Minds Cloud are openai-compatible presets.
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
    if ((settings.openaiBaseUrl || '').startsWith('https://generativelanguage.googleapis.com/')) {
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

  // 2. Reset planning + coding models to the new provider's defaults so
  //    the user never lands on a "claude-sonnet-4-6 on OpenAI" mismatch.
  //    For providers without sensible defaults (compatible, minds-cloud)
  //    we clear the fields rather than leaving stale Claude/GPT names.
  const defaults = PROVIDER_DEFAULTS[preset] || { planning: '', coding: '' };
  setSetting('planningModel', defaults.planning);
  setSetting('defaultModel', defaults.planning);
  setSetting('codingModel', defaults.coding);
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

// Masked credential input. The backend returns "***" as a sentinel for
// stored keys (the real value never leaves disk on a plain GET), so the
// eye icon does two things:
//   (a) toggles the input type between password and text, and
//   (b) when revealing a sentinel and `revealName` is set, asks the
//       server for the real stored value via /settings/reveal-key.
// The fetched value is held in local component state — we never push it
// into the parent settings object, so saving an untouched revealed value
// still sends "***" and the server skips overwriting the stored key.
function ApiKeyInput({ value, onChange, placeholder, disabled, revealName }) {
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);
  const [revealedValue, setRevealedValue] = useState(null); // null = no fetched override
  const [revealing, setRevealing] = useState(false);

  const stored = value ?? '';
  const isSentinel = stored === '***';
  // What the input renders. While the user hasn't toggled reveal we show
  // `stored` (typically "***" if the server has a key, or "" if not).
  // After a successful reveal we show the fetched value.
  const v = revealedValue ?? stored;
  const hasValue = v.length > 0;

  const onCopy = async () => {
    if (!hasValue) return;
    try {
      await navigator.clipboard.writeText(v);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be unavailable in some browser sandboxes */
    }
  };

  const onToggleShow = async () => {
    if (!show && revealName && isSentinel && revealedValue === null) {
      // Reveal the real stored key from the loopback server.
      setRevealing(true);
      try {
        const real = await revealSettingKey(revealName);
        if (real) setRevealedValue(real);
      } finally {
        setRevealing(false);
      }
    }
    if (show) {
      // Going back to hidden — drop any fetched value so the next
      // reveal re-fetches (and we don't keep a plaintext key around).
      setRevealedValue(null);
    }
    setShow((s) => !s);
  };

  // If the user types, treat that as a fresh local edit. Clear any
  // revealed-from-server value and forward straight to the parent.
  const onInput = (next) => {
    if (revealedValue !== null) setRevealedValue(null);
    onChange(next);
  };

  const btnStyle = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: 28, height: 26, borderRadius: 6,
    border: 0, background: 'transparent', cursor: 'pointer',
    color: 'var(--ink-3)', padding: 0,
  };
  const btnStyleActive = { ...btnStyle, color: 'var(--text-strong)', background: 'var(--surface-2, rgba(255,255,255,0.04))' };

  return (
    <div style={{ position: 'relative' }}>
      <input
        className="field-input mono"
        type={show ? 'text' : 'password'}
        value={v}
        onChange={(e) => onInput(e.target.value)}
        placeholder={placeholder || '••••••••••••••••••'}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        style={{ paddingRight: 76 }}
      />
      <div style={{
        position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)',
        display: 'inline-flex', alignItems: 'center', gap: 2,
      }}>
        <button
          type="button"
          onClick={onCopy}
          disabled={!hasValue || isSentinel}
          title={
            isSentinel ? 'Reveal the key first to copy it'
            : copied  ? 'Copied'
            : 'Copy to clipboard'
          }
          aria-label={copied ? 'Copied to clipboard' : 'Copy key to clipboard'}
          style={(hasValue && !isSentinel) ? btnStyle : { ...btnStyle, opacity: 0.35, cursor: 'not-allowed' }}
        >
          {copied ? Ico.check(13) : Ico.copy(13)}
        </button>
        <button
          type="button"
          onClick={onToggleShow}
          disabled={revealing}
          title={show ? 'Hide key' : (revealing ? 'Revealing…' : 'Reveal key')}
          aria-label={show ? 'Hide key' : 'Reveal key'}
          aria-pressed={show}
          style={show ? btnStyleActive : btnStyle}
        >
          {show ? Ico.eyeOff(13) : Ico.eye(13)}
        </button>
      </div>
    </div>
  );
}

// Pill that hangs off a credential row's title to show whether the field
// is required, optional, auto-managed, or unused for the active provider.
// Drives the eye flow toward what matters for the current selection.
function RelevanceBadge({ status }) {
  if (!status || status === 'unused') return null;
  const palette = {
    required: { fg: '#E5B57A', bg: 'rgba(229,181,122,0.12)', bd: 'rgba(229,181,122,0.30)', label: 'Required' },
    optional: { fg: 'var(--text-muted)', bg: 'rgba(127,127,127,0.10)', bd: 'var(--border-subtle)', label: 'Optional' },
    auto:     { fg: 'var(--sage-500, #5d9287)', bg: 'rgba(93,146,135,0.12)', bd: 'rgba(93,146,135,0.30)', label: 'Auto' },
  }[status];
  if (!palette) return null;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      marginLeft: 8, padding: '1px 7px',
      fontSize: 10.5, fontWeight: 600, letterSpacing: '0.04em',
      textTransform: 'uppercase',
      color: palette.fg, background: palette.bg,
      border: `1px solid ${palette.bd}`, borderRadius: 999,
      verticalAlign: 'middle',
    }}>{palette.label}</span>
  );
}

// Small green pill that confirms a credential is stored. Pairs with the
// Required / Optional relevance badge so users can answer two questions
// at a glance: "do I need this?" and "is it filled in?". Independent of
// reveal — driven purely by whether the field has a non-empty value
// (which for API keys means either the "***" sentinel from the server
// or a freshly typed key not yet saved).
//
// `active` lifts the badge visually when the credential is on the
// active provider's hot path (required / optional / auto-managed for
// this preset). Idle rows that just happen to still hold a value keep
// the muted look so the eye is drawn to what's currently in use.
function SetBadge({ hasValue, active }) {
  if (!hasValue) return null;
  return (
    <span
      title={active
        ? 'Stored and used by the active provider'
        : 'A value is stored, but the active provider does not use it'}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        marginLeft: 8, padding: '1px 8px 1px 7px',
        fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em',
        textTransform: 'uppercase',
        color: active ? '#7CC4B6' : 'var(--sage-500, #5d9287)',
        background: active ? 'rgba(124,196,182,0.18)' : 'rgba(93,146,135,0.10)',
        border: `1px solid ${active ? 'rgba(124,196,182,0.55)' : 'rgba(93,146,135,0.28)'}`,
        borderRadius: 999, verticalAlign: 'middle',
        boxShadow: active
          ? '0 0 0 1px rgba(124,196,182,0.20), 0 0 14px rgba(124,196,182,0.45), 0 0 28px rgba(93,146,135,0.25)'
          : 'none',
        animation: active ? 'set-badge-pulse 2.4s ease-in-out infinite' : 'none',
        transition: 'box-shadow .2s ease, background .2s ease, color .2s ease',
      }}
    >
      <span style={{
        width: 6, height: 6, borderRadius: 999,
        background: active ? '#7CC4B6' : 'var(--sage-500, #5d9287)',
        boxShadow: active
          ? '0 0 8px #7CC4B6, 0 0 14px rgba(124,196,182,0.6)'
          : '0 0 4px rgba(93,146,135,0.45)',
      }} />
      Set
    </span>
  );
}

// Wrapper that dims a Section row when the credential is unused for the
// active provider. Built on the existing Section grid so layout stays
// consistent.
function CredentialRow({ title, subtitle, status, hasValue, children }) {
  const dimmed = status === 'unused';
  // The Set badge only glows when this credential is on the active
  // provider's actual auth path — i.e. the active preset *requires* it
  // (or auto-manages it). `optional` credentials (e.g. Minds API key
  // while on Anthropic) and `unused` ones show Set in a muted style so
  // the glow stays meaningful: "this is what's authenticating you now."
  const setActive = hasValue && (status === 'required' || status === 'auto');
  const titleNode = (
    <span style={{ display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', rowGap: 4 }}>
      {title}
      <RelevanceBadge status={status} />
      <SetBadge hasValue={hasValue} active={setActive} />
    </span>
  );
  return (
    <div style={{ opacity: dimmed ? 0.5 : 1, transition: 'opacity .15s ease' }}>
      <Section title={titleNode} subtitle={subtitle}>{children}</Section>
    </div>
  );
}

export default function SettingsView({ settings, setSetting, onSave, theme, onThemeChange }) {
  const [saved, setSaved] = useState(false);
  const [validation, setValidation] = useState(null);
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState(false);
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

  // Re-validate config against the server. Without explicit progress +
  // success states the button looks dead when the config was already
  // green (the banner has nothing to flip to), so we drive a brief
  // "Testing…" → "Tested" sequence on the button itself.
  const validate = async () => {
    if (testing) return;
    setTesting(true);
    setTested(false);
    try {
      const result = await validateSettings();
      setValidation(result);
      setTested(true);
      setTimeout(() => setTested(false), 2400);
    } catch (err) {
      setValidation({
        status: 'error',
        configReady: false,
        configError: err.message || 'Settings could not be validated.',
      });
    } finally {
      setTesting(false);
    }
  };

  const testButtonLabel = testing
    ? 'Testing…'
    : tested
      ? (<><span style={{ display: 'inline-flex', marginRight: 6, verticalAlign: 'middle' }}>{Ico.check(13)}</span>Tested</>)
      : 'Test';

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
              <button
                className="btn-secondary"
                onClick={validate}
                disabled={testing}
                aria-busy={testing}
                style={testing ? { opacity: 0.7, cursor: 'progress' } : undefined}
              >{testButtonLabel}</button>
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

            {(() => {
              // Computed once per render — these drive Models + Credentials
              // visuals (active provider chip, credential badges, quick-picks).
              const activePreset = inferProviderPreset(settings);
              const activeLabel = PROVIDER_PRESETS.find((p) => p.value === activePreset)?.label || activePreset;
              const configuredForActive = isProviderConfigured(activePreset, settings);
              const relevance = CREDENTIAL_RELEVANCE[activePreset] || {};
              const quickPicks = PROVIDER_MODELS[activePreset] || [];
              // Drives the green "Set" badge on each credential row.
              const has = (field) => Boolean(String(settings[field] ?? '').trim());

              const ChipRow = ({ items, current, onPick }) => items.length === 0 ? null : (
                <div style={{
                  display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8,
                }}>
                  {items.map((m) => {
                    const active = m === current;
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => onPick(m)}
                        style={{
                          fontFamily: 'var(--font-mono)', fontSize: 11.5,
                          padding: '3px 8px', borderRadius: 999,
                          background: active ? 'var(--surface-0)' : 'transparent',
                          color: active ? 'var(--text-strong)' : 'var(--text-muted)',
                          border: `1px solid ${active ? 'var(--line-2, var(--border-subtle))' : 'var(--border-subtle)'}`,
                          cursor: 'pointer',
                        }}
                      >{m}</button>
                    );
                  })}
                </div>
              );

              return (
                <>
                  <CollapsibleGroup title="Models">
                    {/* Provider row + active-state summary. The segmented
                        control spans the full row so the 5 presets fit on
                        one line instead of wrapping. */}
                    <div style={{ padding: '16px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-strong)' }}>Provider</div>
                          <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 4, maxWidth: 480 }}>
                            Drives planning + coding. Gemini and Minds Cloud are presets that map to OpenAI-compatible with the right base URL.
                          </div>
                        </div>
                        {/* Active-provider status pill */}
                        <div
                          title={configuredForActive ? 'Credentials present for this provider' : 'This provider is missing credentials'}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 8,
                            padding: '4px 10px', borderRadius: 999,
                            fontSize: 12, fontWeight: 600,
                            color: configuredForActive ? 'var(--sage-500, #5d9287)' : '#E07060',
                            background: configuredForActive ? 'rgba(93,146,135,0.10)' : 'rgba(211,80,80,0.08)',
                            border: `1px solid ${configuredForActive ? 'rgba(93,146,135,0.30)' : 'rgba(211,80,80,0.30)'}`,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          <span style={{
                            width: 7, height: 7, borderRadius: 999,
                            background: configuredForActive ? 'var(--sage-500, #5d9287)' : '#E07060',
                            boxShadow: configuredForActive ? '0 0 6px rgba(93,146,135,0.6)' : 'none',
                          }} />
                          {activeLabel}
                          <span style={{ fontWeight: 500, color: 'inherit', opacity: 0.85 }}>
                            · {configuredForActive ? 'Active' : 'Needs key'}
                          </span>
                        </div>
                      </div>
                      <div style={{ marginTop: 12 }}>
                        <Segmented
                          value={activePreset}
                          onChange={(v) => applyProviderPreset(v, settings, setSetting)}
                          options={PROVIDER_PRESETS}
                          style={{ display: 'inline-flex', flexWrap: 'wrap' }}
                        />
                      </div>
                    </div>

                    <Section title="Planning model" subtitle="Used for reasoning, orchestration, and responses.">
                      <TextInput
                        value={settings.planningModel ?? settings.defaultModel ?? ''}
                        onChange={(v) => {
                          setSetting('planningModel', v);
                          setSetting('defaultModel', v);
                        }}
                        placeholder={PROVIDER_DEFAULTS[activePreset]?.planning || 'model-id'}
                      />
                      <ChipRow
                        items={quickPicks}
                        current={settings.planningModel ?? settings.defaultModel ?? ''}
                        onPick={(m) => { setSetting('planningModel', m); setSetting('defaultModel', m); }}
                      />
                    </Section>
                    <Section title="Coding model" subtitle="Used for scratchpad code generation.">
                      <TextInput
                        value={settings.codingModel ?? ''}
                        onChange={(v) => setSetting('codingModel', v)}
                        placeholder={PROVIDER_DEFAULTS[activePreset]?.coding || 'model-id'}
                      />
                      <ChipRow
                        items={quickPicks}
                        current={settings.codingModel ?? ''}
                        onPick={(m) => setSetting('codingModel', m)}
                      />
                    </Section>
                  </CollapsibleGroup>

                  <CollapsibleGroup title="Credentials">
                    <CredentialRow
                      title="Anthropic API key"
                      subtitle="Required for Claude models."
                      status={relevance.anthropicApiKey}
                      hasValue={has('anthropicApiKey')}
                    >
                      <ApiKeyInput
                        value={settings.anthropicApiKey ?? ''}
                        onChange={(v) => setSetting('anthropicApiKey', v)}
                        placeholder="sk-ant-••••••••"
                        revealName="anthropic"
                      />
                    </CredentialRow>
                    <CredentialRow
                      title="OpenAI API key"
                      subtitle="Required for GPT, Gemini, and OpenAI-compatible providers."
                      status={relevance.openaiApiKey}
                      hasValue={has('openaiApiKey')}
                    >
                      <ApiKeyInput
                        value={settings.openaiApiKey ?? ''}
                        onChange={(v) => setSetting('openaiApiKey', v)}
                        placeholder="sk-••••••••"
                        revealName="openai"
                      />
                    </CredentialRow>
                    <CredentialRow
                      title="OpenAI-compatible base URL"
                      subtitle={relevance.openaiBaseUrl === 'auto'
                        ? 'Auto-managed by the selected preset.'
                        : 'Required for OpenAI-compatible providers unless Minds credentials derive it.'}
                      status={relevance.openaiBaseUrl}
                      hasValue={has('openaiBaseUrl')}
                    >
                      <TextInput
                        value={settings.openaiBaseUrl ?? ''}
                        onChange={(v) => setSetting('openaiBaseUrl', v)}
                        placeholder="https://example.com/v1"
                      />
                    </CredentialRow>
                    <CredentialRow
                      title="Minds API key"
                      subtitle="Used for Minds-backed routing and publishing."
                      status={relevance.mindsApiKey}
                      hasValue={has('mindsApiKey')}
                    >
                      <ApiKeyInput
                        value={settings.mindsApiKey ?? ''}
                        onChange={(v) => setSetting('mindsApiKey', v)}
                        placeholder="mdb_••••••••"
                        revealName="minds"
                      />
                    </CredentialRow>
                    <CredentialRow
                      title="Minds URL"
                      subtitle="Base URL for Minds-backed Anton features."
                      status={relevance.mindsUrl}
                      hasValue={has('mindsUrl')}
                    >
                      <TextInput
                        value={settings.mindsUrl ?? 'https://mdb.ai'}
                        onChange={(v) => setSetting('mindsUrl', v)}
                        placeholder="https://mdb.ai"
                      />
                    </CredentialRow>
                    <CredentialRow
                      title="Minds mind"
                      subtitle="Optional Mind name to use for data-aware tasks."
                      status={relevance.mindsMindName}
                      hasValue={has('mindsMindName')}
                    >
                      <TextInput
                        value={settings.mindsMindName ?? ''}
                        onChange={(v) => setSetting('mindsMindName', v)}
                        placeholder="sales_data_expert"
                      />
                    </CredentialRow>
                    <CredentialRow
                      title="Minds datasource"
                      subtitle="Optional datasource name and engine."
                      status={relevance.mindsDatasource}
                      hasValue={has('mindsDatasource') || has('mindsDatasourceEngine')}
                    >
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
                    </CredentialRow>
                  </CollapsibleGroup>
                </>
              );
            })()}

            <CollapsibleGroup title="Updates" defaultOpen={false}>
              <Section
                title="UI updates"
                subtitle="How over-the-air UI updates are applied when a new version is published."
              >
                <Segmented
                  value={settings.uiUpdateMode ?? 'manual'}
                  onChange={(v) => setSetting('uiUpdateMode', v)}
                  options={[
                    { value: 'auto', label: 'Auto' },
                    { value: 'manual', label: 'Manual' },
                  ]}
                />
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
            {testing
              ? 'Testing configuration…'
              : tested
                ? (configReady ? 'Test passed — provider, model, and credentials look good.' : (configError || 'Test reported a problem.'))
                : saved
                  ? 'Settings saved.'
                  : configError
                    ? configError
                    : 'Changes apply on save.'}
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
