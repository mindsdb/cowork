import { useState, useEffect, useRef } from 'react';
import Ico from '../components/Icons';
import { validateSettings, revealSettingKey, testProviders } from '../api';

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
  // Minds-related credentials live in their own card but are only on
  // the auth path for the `minds-cloud` preset. Marking them `unused`
  // for everything else dims the rows (and drops the Optional badge) so
  // attention sticks to the credentials the active provider actually
  // touches. The fields stay editable for users who keep a Minds key
  // around for routing/publishing.
  anthropic: {
    anthropicApiKey: 'required',
    openaiApiKey:    'unused',
    openaiBaseUrl:   'unused',
    mindsApiKey:     'unused',
    mindsUrl:        'unused',
    mindsMindName:   'unused',
    mindsDatasource: 'unused',
  },
  openai: {
    anthropicApiKey: 'unused',
    openaiApiKey:    'required',
    openaiBaseUrl:   'unused',
    mindsApiKey:     'unused',
    mindsUrl:        'unused',
    mindsMindName:   'unused',
    mindsDatasource: 'unused',
  },
  gemini: {
    anthropicApiKey: 'unused',
    openaiApiKey:    'required',
    openaiBaseUrl:   'auto',
    mindsApiKey:     'unused',
    mindsUrl:        'unused',
    mindsMindName:   'unused',
    mindsDatasource: 'unused',
  },
  'openai-compatible': {
    anthropicApiKey: 'unused',
    openaiApiKey:    'required',
    openaiBaseUrl:   'required',
    mindsApiKey:     'unused',
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
    <div className="settings-section" style={{
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
          title={o.title}
          aria-label={o.ariaLabel || o.title}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ value, onChange, title, ariaLabel }) {
  return (
    <button
      role="switch"
      aria-checked={value}
      aria-label={ariaLabel}
      title={title}
      className={`toggle${value ? ' on' : ''}`}
      onClick={() => onChange(!value)}
    >
      <span className="toggle-thumb" />
    </button>
  );
}

function TextInput({ value, onChange, placeholder, title }) {
  return (
    <input
      className="field-input"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      title={title}
    />
  );
}

// Drop-in for TextInput in Credentials rows. Adds a × button inside the
// field that empties the value — pairs with the trash icon on the API
// key fields so the whole Credentials card uses one clear gesture.
// Save settings still has to be clicked to commit the deletion to env.
function ClearableTextInput({ value, onChange, placeholder }) {
  const v = value ?? '';
  const hasValue = v.length > 0;
  return (
    <div style={{ position: 'relative' }}>
      <input
        className="field-input"
        value={v}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={hasValue ? { paddingRight: 36 } : undefined}
      />
      {hasValue && (
        <button
          type="button"
          onClick={() => onChange('')}
          title="Clear (commits on Save settings)"
          aria-label="Clear value"
          style={{
            position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 28, height: 26, borderRadius: 6,
            border: 0, background: 'transparent', cursor: 'pointer',
            color: 'var(--ink-3)', padding: 0,
          }}
        >
          {Ico.close(13)}
        </button>
      )}
    </div>
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
  // Copy is gated on what the input is *displaying* — not the prop. After
  // a reveal, `v` is the real key (held locally; we never push it up to
  // the parent) so `stored` still equals "***" but the user can copy the
  // resolved value. Using `v === '***'` here keeps the "reveal first"
  // hint while the field still shows the masked sentinel.
  const isDisplayingSentinel = v === '***';
  const canCopy = hasValue && !isDisplayingSentinel;

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

  // Trash → empty the field locally. The change only hits the server
  // on Save settings, where update_settings sees an empty string and
  // routes the key to its delete branch (`_stage_string_env` / the API
  // key block). Also resets reveal state so we don't keep a fetched
  // plaintext copy around.
  const onClearField = () => {
    setRevealedValue(null);
    setShow(false);
    onChange('');
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
        style={{ paddingRight: 108 }}
      />
      <div style={{
        position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)',
        display: 'inline-flex', alignItems: 'center', gap: 2,
      }}>
        <span style={{ position: 'relative', display: 'inline-flex' }}>
          <button
            type="button"
            onClick={onCopy}
            disabled={!canCopy}
            title={
              isDisplayingSentinel ? 'Reveal the key first to copy it'
              : copied              ? 'Copied'
              :                       'Copy to clipboard'
            }
            aria-label={copied ? 'Copied to clipboard' : 'Copy key to clipboard'}
            style={canCopy ? btnStyle : { ...btnStyle, opacity: 0.35, cursor: 'not-allowed' }}
          >
            {copied ? Ico.check(13) : Ico.copy(13)}
          </button>
          {copied && (
            <span
              role="status"
              aria-live="polite"
              style={{
                position: 'absolute',
                bottom: 'calc(100% + 6px)',
                left: '50%',
                padding: '3px 8px',
                fontSize: 10.5, fontWeight: 600, letterSpacing: '0.04em',
                textTransform: 'uppercase',
                color: '#7CC4B6',
                background: 'rgba(20,28,28,0.92)',
                border: '1px solid rgba(124,196,182,0.45)',
                borderRadius: 6,
                whiteSpace: 'nowrap',
                pointerEvents: 'none',
                boxShadow: '0 4px 14px rgba(0,0,0,0.35)',
                animation: 'copied-pop 1.5s ease forwards',
                zIndex: 5,
              }}
            >Copied</span>
          )}
        </span>
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
        <button
          type="button"
          onClick={onClearField}
          disabled={!hasValue}
          title="Clear this key (commits on Save settings)"
          aria-label="Clear key"
          style={hasValue ? btnStyle : { ...btnStyle, opacity: 0.35, cursor: 'not-allowed' }}
        >
          {Ico.trash(13)}
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
        // When active, the box-shadow comes from the set-badge-pulse
        // keyframes; the static value would never paint. When inactive
        // we explicitly clear any inherited shadow.
        boxShadow: active ? undefined : 'none',
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

// ───────────────────────── Multi-provider helpers ─────────────────────────

const PROVIDER_TYPE_ORDER = ['minds-cloud', 'anthropic', 'openai', 'gemini', 'openai-compatible'];

const PROVIDER_TYPE_DESC = {
  'minds-cloud': 'Routes via mdb.ai with smart model selection.',
  anthropic: 'Use Claude models with your Anthropic API key.',
  openai: 'Use GPT models with your OpenAI API key.',
  gemini: 'Use Gemini models through Google\'s OpenAI-compatible endpoint.',
  'openai-compatible': 'Any OpenAI-compatible server (Ollama, vLLM, Together, Groq, etc).',
};

const GET_KEY_URL = {
  'minds-cloud': 'https://mdb.ai/apiKeys',
  anthropic: 'https://console.anthropic.com/settings/keys',
  openai: 'https://platform.openai.com/api-keys',
  gemini: 'https://aistudio.google.com/apikey',
  'openai-compatible': null,
};

const PROTECTED_PROVIDER_TYPES = new Set(['minds-cloud']);

function makeEmptyProvider(type) {
  const base = { type, apiKey: '', isDefault: false };
  if (type === 'openai-compatible') base.baseUrl = '';
  if (type === 'minds-cloud') {
    base.mindsUrl = 'https://mdb.ai';
    base.mindsMindName = '';
    base.mindsDatasource = '';
    base.mindsDatasourceEngine = '';
    base.mindsSslVerify = true;
  }
  return base;
}

function dedupeByType(arr) {
  const map = {};
  for (const p of arr) map[p.type] = p;
  return Object.values(map);
}

function setOneDefault(arr, type) {
  return arr.map((p) => ({ ...p, isDefault: p.type === type }));
}

function ensureDefaultInvariant(arr) {
  if (!arr.length) return arr;
  if (arr.some((p) => p.isDefault)) {
    let found = false;
    return arr.map((p) => {
      if (p.isDefault && !found) { found = true; return p; }
      if (p.isDefault) return { ...p, isDefault: false };
      return p;
    });
  }
  return arr.map((p, i) => ({ ...p, isDefault: i === 0 }));
}

const PROVIDER_LABELS_LOCAL = {
  'minds-cloud': 'MindsHub',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  gemini: 'Gemini',
  'openai-compatible': 'OpenAI-compatible',
};

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
  const [addPickerOpen, setAddPickerOpen] = useState(false);
  const [bannerVisible, setBannerVisible] = useState(false);
  // Per-role "use a typed model id" flag. Sticky so picking Other…
  // keeps the text input visible even when the typed value is empty.
  const [modelInputMode, setModelInputMode] = useState({ planning: false, coding: false });
  // Tracks whether any LLM-affecting setting changed since the last
  // successful Save. Used to skip provider tests on a no-op Save so a
  // user just toggling appearance doesn't pay the network round-trip.
  const [llmDirty, setLlmDirty] = useState(false);
  // Snapshot of the last-saved settings JSON. While `settings` matches
  // this snapshot the Save button reads "Saved" — flips back to "Save
  // settings" the moment the user changes anything.
  const [lastSavedJson, setLastSavedJson] = useState(null);
  const currentJson = JSON.stringify(settings);
  const settingsDirty = lastSavedJson !== null && currentJson !== lastSavedJson;
  // Ref-mirror of `settings` so the post-Save snapshot can read the
  // freshly-refetched value (the closure's `settings` is stale after
  // the await but the ref tracks every render).
  const settingsRef = useRef(settings);
  useEffect(() => { settingsRef.current = settings; });

  // First load: snapshot once `settings` is populated so the resting
  // state is "Saved" until the user touches anything.
  useEffect(() => {
    if (lastSavedJson === null && settings && Object.keys(settings).length > 0) {
      setLastSavedJson(currentJson);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentJson]);
  const configReady = validation?.configReady ?? settings.configReady;
  const configError = validation?.configError || settings.configError;

  // Providers state — surfaced from the server, edited inline, committed
  // on Save settings. The save handler routes through the providers path
  // when `providers` is included on the patch.
  const providers = Array.isArray(settings.providers) ? settings.providers : [];
  const modelMode = settings.modelMode === 'custom' ? 'custom' : 'default';
  const overrides = settings.modelOverrides || {};
  const recommendedModels = settings.recommendedModels || {};
  const recommendedPair = settings.recommendedPair || {};
  const typeLabels = settings.providerTypeLabels || PROVIDER_LABELS_LOCAL;

  const updateProviders = (next) => setSetting('providers', dedupeByType(next));
  const availableTypesForAdd = PROVIDER_TYPE_ORDER.filter(
    (t) => !providers.some((p) => p.type === t),
  );

  // Which provider types actually drive planning + coding right now.
  // Planning and coding can pick *different* providers, so the active
  // set is the union of both roles. A role with no explicit override
  // implicitly falls back to MindsHub (matches the server's
  // _resolve_role logic) — include that in the set so the test still
  // pings it. Used by the per-row dot, runProviderTests, and the
  // banner's effective-ready calculation.
  const activeProviderTypes = (() => {
    const types = new Set();
    if (modelMode === 'custom') {
      types.add(overrides.planning?.providerType || 'minds-cloud');
      types.add(overrides.coding?.providerType   || 'minds-cloud');
    } else {
      types.add('minds-cloud');
    }
    return types;
  })();

  // Custom providers must carry a non-empty name. Pre-compute so the
  // Models dropdown can show the name and the Save button knows to
  // block when any custom row is missing one.
  const providerDisplayName = (p) => {
    if (p.type === 'openai-compatible') return (p.name || '').trim() || 'OpenAI-compatible';
    return typeLabels[p.type] || p.type;
  };
  const missingCustomNames = providers.some(
    (p) => p.type === 'openai-compatible' && !(p.name || '').trim(),
  );

  // MindsHub is the permanent baseline — always show its row so the
  // user has a path to a working provider without having to add one.
  useEffect(() => {
    if (!providers.some((p) => p.type === 'minds-cloud')) {
      updateProviders([makeEmptyProvider('minds-cloud'), ...providers]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providers.length, providers.some((p) => p.type === 'minds-cloud')]);

  const updateProviderField = (type, key, value) => {
    setLlmDirty(true);
    updateProviders(providers.map((p) => (p.type === type ? { ...p, [key]: value } : p)));
  };
  const addProviderOfType = (type) => {
    if (providers.some((p) => p.type === type)) return;
    setLlmDirty(true);
    updateProviders(providers.concat([makeEmptyProvider(type)]));
    setAddPickerOpen(false);
  };
  const removeProvider = (type) => {
    // MindsHub stays as a permanent option even when unconfigured —
    // it's the recommended path and users shouldn't be able to lose it.
    if (PROTECTED_PROVIDER_TYPES.has(type)) return;
    setLlmDirty(true);
    const next = providers.filter((p) => p.type !== type);

    // Role overrides referencing the removed provider get re-pointed
    // at MindsHub (the implicit fallback) with its recommended pair
    // for the role.
    const adjustedOverrides = {};
    for (const role of ['planning', 'coding']) {
      const o = overrides[role];
      if (!o) continue;
      if (o.providerType === type) {
        const pair = recommendedPair['minds-cloud'] || ['', ''];
        const fallback = pair[role === 'planning' ? 0 : 1] || (recommendedModels['minds-cloud']?.[0] || '');
        adjustedOverrides[role] = { providerType: 'minds-cloud', model: fallback };
      } else {
        adjustedOverrides[role] = o;
      }
    }
    setSetting('modelOverrides', adjustedOverrides);
    updateProviders(next);
  };

  // Tests only the providers currently driving the planning + coding
  // roles. Each role contributes its driver (its override, or MindsHub
  // when there's no override), so if planning picks Anthropic and
  // coding picks OpenAI, both get pinged. Inactive registered
  // providers keep their previous status (no point hammering OpenAI
  // when the user isn't using it). Sends the active providers' live
  // state so Test works on un-committed edits; the server merges
  // results into the persisted status map so dots survive a reload.
  const runProviderTests = async () => {
    const activeProviders = providers.filter((p) => activeProviderTypes.has(p.type));
    if (activeProviders.length === 0) return null;

    // Flip only the active providers' dots to the transient
    // "testing" state — preserve everyone else's persisted color.
    const pendingStatuses = { ...(settings.providerStatus || {}) };
    const pendingDetails  = { ...(settings.providerStatusDetails || {}) };
    for (const p of activeProviders) {
      pendingStatuses[p.type] = 'testing';
      delete pendingDetails[p.type];
    }
    setSetting('providerStatus', pendingStatuses);
    setSetting('providerStatusDetails', pendingDetails);

    const result = await testProviders(activeProviders);
    if (result && result.providerStatus) {
      setSetting('providerStatus', { ...pendingStatuses, ...result.providerStatus });
    }
    if (result && result.providerStatusDetails) {
      setSetting('providerStatusDetails', { ...pendingDetails, ...result.providerStatusDetails });
    }
    return result;
  };

  const save = async () => {
    // Save runs a validation pass so the banner reflects whether the
    // new config is usable. Provider tests only fire when the LLM
    // settings actually changed since the last Save — no point hitting
    // the network when the user just toggled the dot grid.
    const shouldTestLlm = llmDirty;
    setBannerVisible(true);
    setTesting(true);
    setTested(false);
    try {
      await onSave(settings);
      const tasks = [validateSettings()];
      if (shouldTestLlm) tasks.push(runProviderTests());
      const [result] = await Promise.all(tasks);
      setValidation(result);
      setTested(true);
      if (shouldTestLlm) setLlmDirty(false);
      // Snapshot the now-current settings so the Save button flips to
      // "Saved" until the user makes another edit. settingsRef tracks
      // the latest re-rendered value (the closure's `settings` is the
      // pre-save copy and stale by now).
      setLastSavedJson(JSON.stringify(settingsRef.current));
      setSaved(true);
      setTimeout(() => setTested(false), 2400);
    } catch (err) {
      setValidation({
        status: 'error',
        configReady: false,
        configError: err.message || 'Settings could not be saved.',
      });
      setSaved(false);
    } finally {
      setTesting(false);
    }
  };

  // Re-validate config against the server. Without explicit progress +
  // success states the button looks dead when the config was already
  // green (the banner has nothing to flip to), so we drive a brief
  // "Testing…" → "Tested" sequence on the button itself.
  const validate = async () => {
    if (testing) return;
    setBannerVisible(true);
    setTesting(true);
    setTested(false);
    try {
      const [result] = await Promise.all([
        validateSettings(),
        runProviderTests(),
      ]);
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
        <div className="scroll-clean settings-scroll" style={{
          flex: 1, overflowY: 'auto',
          padding: '28px 28px 96px',
        }}>
          <div style={{ maxWidth: 820 }}>
            <h2 className="page-title" style={{ marginTop: 0, marginBottom: 6 }}>Settings</h2>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 22 }}>
              Anton configuration and local desktop preferences.
            </div>

            {/* Status banner — only shown after Save or Test. While
                `testing` is true the banner enters a neutral "checking"
                state with a spinner; on success/failure it flips to the
                configured/needs-config palette and briefly pulses. The
                X button on the right dismisses the banner; the next
                Save or Test will re-open it. */}
            {bannerVisible && (() => {
              // Banner reflects only the providers actually driving
              // planning + coding (computed once at the component level).
              const activeTypes = Array.from(activeProviderTypes);
              const activeStatuses = activeTypes.map((t) => (settings.providerStatus || {})[t] || 'untested');
              const anyActiveFail = activeStatuses.some((s) => s === 'fail');
              const allActiveOk  = activeStatuses.length > 0 && activeStatuses.every((s) => s === 'ok');

              const effectiveReady = configReady && !anyActiveFail;

              const tone = testing
                ? { border: 'rgba(127,127,127,0.40)', bg: 'rgba(127,127,127,0.10)',
                    icoFg: 'var(--text-muted)', icoBg: 'rgba(127,127,127,0.16)' }
                : effectiveReady
                  ? { border: 'rgba(93,146,135,0.45)', bg: 'rgba(93,146,135,0.10)',
                      icoFg: 'var(--sage-500)', icoBg: 'rgba(93,146,135,0.16)' }
                  : { border: 'rgba(211,80,80,0.40)', bg: 'rgba(211,80,80,0.08)',
                      icoFg: '#E07060', icoBg: 'rgba(211,80,80,0.14)' };
              const title = testing
                ? 'Testing configuration…'
                : anyActiveFail
                  ? 'Anton needs a valid LLM provider and API key to work'
                  : tested
                    ? (effectiveReady ? 'Anton setup correctly' : 'Test failed')
                    : effectiveReady ? 'Anton setup correctly' : 'Anton needs configuration';
              const subtitle = testing
                ? 'Talking to the active provider — hold on.'
                : anyActiveFail
                  ? 'The provider driving your planning or coding role failed its last test. Check the red row below.'
                  : (allActiveOk ? 'Active provider passed the test.' : (configError || 'Provider, model, and credentials are ready.'));
              const icon = testing
                ? (<span className="spinner" style={{ width: 15, height: 15 }} />)
                : effectiveReady ? Ico.check(15) : Ico.key(15);
              return (
                <div style={{
                  padding: 14, marginBottom: 22,
                  border: `1px solid ${tone.border}`,
                  background: tone.bg,
                  borderRadius: 10,
                  display: 'flex', alignItems: 'center', gap: 12,
                  animation: tested && !testing ? 'set-badge-pulse 1.6s ease-out 1' : 'none',
                  transition: 'background .2s ease, border-color .2s ease',
                }}>
                  <span style={{
                    width: 30, height: 30, borderRadius: 8,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    color: tone.icoFg, background: tone.icoBg,
                    transition: 'background .2s ease, color .2s ease',
                  }}>{icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 650, color: 'var(--text-strong)' }}>{title}</div>
                    <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 2 }}>{subtitle}</div>
                  </div>
                  <button
                    className="btn-secondary"
                    onClick={validate}
                    disabled={testing}
                    aria-busy={testing}
                    title="Re-run the configuration and active-provider tests."
                    style={testing ? { opacity: 0.7, cursor: 'progress' } : undefined}
                  >{testButtonLabel}</button>
                  <button
                    type="button"
                    onClick={() => setBannerVisible(false)}
                    disabled={testing}
                    title="Dismiss"
                    aria-label="Dismiss banner"
                    style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      width: 28, height: 28, borderRadius: 8,
                      border: 0, background: 'transparent',
                      color: 'var(--text-muted)',
                      cursor: testing ? 'not-allowed' : 'pointer',
                      opacity: testing ? 0.4 : 1,
                    }}
                  >{Ico.close(13)}</button>
                </div>
              );
            })()}

            <CollapsibleGroup title="Providers">
              {providers.map((p) => {
                const isActive = activeProviderTypes.has(p.type);
                const label = typeLabels[p.type] || p.type;
                const reveal = p.type === 'anthropic' ? 'anthropic'
                  : p.type === 'minds-cloud' ? 'minds'
                  : (p.type === 'openai' || p.type === 'gemini' || p.type === 'openai-compatible') ? 'openai'
                  : null;
                const rawStatus = (settings.providerStatus || {})[p.type] || 'untested';
                const status = isActive ? rawStatus : 'untested';
                const detail = isActive ? ((settings.providerStatusDetails || {})[p.type] || '') : '';
                const friendlyError = (() => {
                  if (!detail) return '';
                  if (detail === 'missing API key') return 'Add an API key on the right.';
                  if (detail === 'missing base URL') return 'Add a base URL on the right.';
                  const m = detail.match(/HTTP (\d{3})/);
                  if (m) {
                    const code = parseInt(m[1], 10);
                    if (code === 401) return 'Unauthorized — the API key was rejected.';
                    if (code === 403) return 'Forbidden — the API key does not have access.';
                    if (code === 404) return 'Endpoint not found — check the base URL.';
                    if (code === 429) return 'Rate limited — try again in a moment.';
                    if (code >= 500) return `Provider is currently unreachable (HTTP ${code}).`;
                    return `Provider rejected the request (HTTP ${code}).`;
                  }
                  if (detail.startsWith('ConnectError') || detail.startsWith('ConnectTimeout')) {
                    return 'Could not reach the provider — network or DNS problem.';
                  }
                  if (detail.startsWith('ReadTimeout') || detail.startsWith('TimeoutException')) {
                    return 'Provider did not respond in time.';
                  }
                  if (detail.startsWith('SSLError') || detail.includes('certificate')) {
                    return 'TLS / certificate problem reaching the provider.';
                  }
                  return detail;
                })();
                const dotColor = status === 'ok' ? '#7CC4B6'
                  : status === 'fail' ? '#E07060'
                  : status === 'testing' ? '#E5B57A'
                  : 'rgba(127,127,127,0.6)';
                const dotGlow = status === 'ok' ? '0 0 6px rgba(124,196,182,0.7)'
                  : status === 'fail' ? '0 0 6px rgba(224,112,96,0.6)'
                  : status === 'testing' ? '0 0 6px rgba(229,181,122,0.7)'
                  : 'none';
                const dotTitle = status === 'ok' ? `Last test passed${detail ? ` (${detail})` : ''}`
                  : status === 'fail' ? `Last test failed${detail ? `: ${detail}` : ''}`
                  : status === 'testing' ? 'Testing…'
                  : 'Not tested yet';
                const dot = (
                  <span
                    title={dotTitle}
                    aria-label={dotTitle}
                    style={{
                      display: 'inline-block',
                      width: 9, height: 9, borderRadius: 999,
                      background: dotColor,
                      boxShadow: dotGlow,
                      flexShrink: 0,
                      animation: status === 'testing' ? 'set-badge-pulse 1.4s ease-in-out infinite' : 'none',
                    }}
                  />
                );
                const titleNode = (
                  <span style={{ display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                    {dot}
                    {p.type === 'openai-compatible' ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <input
                          className="field-input"
                          value={p.name ?? ''}
                          onChange={(e) => updateProviderField('openai-compatible', 'name', e.target.value)}
                          placeholder="Custom provider name"
                          title="Display name for this custom provider — shown in the model dropdowns below."
                          style={{
                            width: 220, fontSize: 13.5, fontWeight: 600,
                            borderColor: !(p.name || '').trim() ? 'rgba(224,112,96,0.55)' : undefined,
                          }}
                        />
                        {!(p.name || '').trim() && (
                          <span style={{ fontSize: 10.5, color: '#E07060' }}>Name required</span>
                        )}
                      </div>
                    ) : (
                      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-strong)' }}>{label}</span>
                    )}
                  </span>
                );
                return (
                  <div key={p.type} className="settings-provider-row" style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 380px auto',
                    gap: 24,
                    padding: '16px 0',
                    borderBottom: '1px solid var(--border-subtle)',
                    alignItems: 'flex-start',
                  }}>
                    <div>
                      {titleNode}
                      {p.type === 'minds-cloud' && (
                        <div style={{
                          fontSize: 12, color: 'var(--text-muted)',
                          marginTop: 6, maxWidth: 380, lineHeight: 1.45,
                        }}>
                          <div>Router to all major LLMs.</div>
                          <div>Required to publish artifacts to the web.</div>
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'grid', gap: 6 }}>
                      <ApiKeyInput
                        value={p.apiKey ?? ''}
                        onChange={(v) => updateProviderField(p.type, 'apiKey', v)}
                        placeholder={
                          p.type === 'anthropic' ? 'sk-ant-••••••••' :
                          p.type === 'minds-cloud' ? 'mdb_••••••••' :
                          p.type === 'gemini' ? 'AIza••••••••' :
                          'sk-••••••••'
                        }
                        revealName={reveal}
                      />
                      {p.type === 'openai-compatible' && (
                        <ClearableTextInput
                          value={p.baseUrl ?? ''}
                          onChange={(v) => updateProviderField('openai-compatible', 'baseUrl', v)}
                          placeholder="https://example.com/v1"
                        />
                      )}
                      {GET_KEY_URL[p.type] && (
                        <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                          Get your API key at{' '}
                          <a
                            href={GET_KEY_URL[p.type]}
                            target="_blank"
                            rel="noreferrer noopener"
                            title={`Open ${GET_KEY_URL[p.type].replace(/^https?:\/\//, '')} in your browser.`}
                            style={{ color: 'var(--accent-500, #7CC4B6)' }}
                          >{GET_KEY_URL[p.type].replace(/^https?:\/\//, '')} →</a>
                        </div>
                      )}
                      {p.type === 'minds-cloud' && (
                        <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                          Don't have an account?{' '}
                          <a
                            href="https://mindshub.ai"
                            target="_blank"
                            rel="noreferrer noopener"
                            title="Open mindshub.ai sign-up in your browser."
                            style={{ color: 'var(--accent-500, #7CC4B6)' }}
                          >Sign up at mindshub.ai →</a>
                        </div>
                      )}
                      {status === 'fail' && friendlyError && (
                        <div style={{
                          fontSize: 11.5,
                          color: '#E07060',
                          display: 'flex', alignItems: 'flex-start', gap: 6,
                        }}>
                          <span style={{ flexShrink: 0, marginTop: 1 }}>{Ico.key ? Ico.key(11) : '!'}</span>
                          <span>{friendlyError}</span>
                        </div>
                      )}
                    </div>
                    <div style={{ width: 30, height: 30 }}>
                      {!PROTECTED_PROVIDER_TYPES.has(p.type) && (
                        <button
                          type="button"
                          onClick={() => removeProvider(p.type)}
                          title="Remove this provider"
                          style={{
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            width: 30, height: 30, borderRadius: 8,
                            background: 'transparent',
                            border: '1px solid var(--border-subtle)',
                            color: '#E07060',
                            cursor: 'pointer',
                          }}
                        >{Ico.trash(13)}</button>
                      )}
                    </div>
                  </div>
                );
              })}
              <div style={{
                position: 'relative',
                padding: '14px 0 4px',
                minHeight: 50,
              }}>
                {/* Idle: + Add provider button. Fades + slides down when
                    the picker opens. */}
                <button
                  className="btn-secondary"
                  onClick={() => setAddPickerOpen(true)}
                  disabled={availableTypesForAdd.length === 0}
                  title={availableTypesForAdd.length === 0 ? 'All provider types are already configured' : 'Add another provider'}
                  style={{
                    position: 'absolute', top: 14, left: 0,
                    opacity: addPickerOpen ? 0 : (availableTypesForAdd.length === 0 ? 0.45 : 1),
                    transform: addPickerOpen ? 'translateY(6px)' : 'translateY(0)',
                    transition: 'opacity 200ms ease, transform 200ms ease',
                    pointerEvents: addPickerOpen ? 'none' : (availableTypesForAdd.length === 0 ? 'none' : 'auto'),
                    cursor: availableTypesForAdd.length === 0 ? 'not-allowed' : 'pointer',
                  }}
                >+ Add provider</button>

                {/* Open: Choose Provider: <chip> <chip> · Cancel.
                    Fades + slides up from below as it appears. */}
                <div style={{
                  display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center',
                  opacity: addPickerOpen ? 1 : 0,
                  transform: addPickerOpen ? 'translateY(0)' : 'translateY(-6px)',
                  transition: 'opacity 220ms ease, transform 220ms ease',
                  pointerEvents: addPickerOpen ? 'auto' : 'none',
                  position: 'absolute', top: 14, left: 0, right: 0,
                }}>
                  <strong style={{
                    fontSize: 12.5, color: 'var(--text-strong)', marginRight: 4,
                  }}>Choose Provider:</strong>
                  {availableTypesForAdd.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => addProviderOfType(t)}
                      className="btn-secondary"
                      title={PROVIDER_TYPE_DESC[t]}
                      style={{ fontSize: 12.5, padding: '4px 10px', fontWeight: 400 }}
                    >{typeLabels[t] || t}</button>
                  ))}
                  <span style={{ color: 'var(--text-muted)', padding: '0 4px' }}>·</span>
                  <button
                    type="button"
                    onClick={() => setAddPickerOpen(false)}
                    title="Hide the provider picker."
                    style={{
                      fontSize: 12.5, padding: '4px 8px',
                      background: 'transparent', border: 0,
                      color: 'var(--text-muted)', cursor: 'pointer',
                      fontWeight: 400,
                    }}
                  >Cancel</button>
                </div>
              </div>
            </CollapsibleGroup>

            <CollapsibleGroup title="Agent Models">
              {(() => {
                // MindsHub is the implicit fallback for any role that
                // hasn't been explicitly assigned an override.
                const defaultProvider = providers.find((p) => p.type === 'minds-cloud') || providers[0];
                const multipleProviders = providers.length > 1;

                // For each role: render provider selector (when N>1) +
                // model field. When the user picks a new provider, auto-
                // fill the role with that provider's recommended default
                // for the role. Empty overrides fall back to the default
                // provider's recommended pair.
                const RoleRow = ({ role, label }) => {
                  const cur = overrides[role] || {};
                  const curType = cur.providerType || (defaultProvider?.type || '');
                  const fallbackPair = recommendedPair[curType] || ['', ''];
                  const fallbackModel = fallbackPair[role === 'planning' ? 0 : 1] || '';
                  const curModel = cur.model || fallbackModel;
                  const provider = providers.find((p) => p.type === curType);
                  const modelList = recommendedModels[curType] || [];

                  const writeOverride = (next) => {
                    setLlmDirty(true);
                    setSetting('modelOverrides', { ...overrides, [role]: next });
                    setSetting('modelMode', 'custom');
                  };

                  return (
                    <Section title={label} subtitle={`Used for ${role === 'planning' ? 'reasoning, orchestration, and responses' : 'scratchpad code generation'}.`}>
                      <div style={{ display: 'grid', gap: 6 }}>
                        {multipleProviders && (
                          <select
                            className="settings-select"
                            value={curType}
                            onChange={(e) => {
                              const t = e.target.value;
                              const pair = recommendedPair[t] || ['', ''];
                              const newModel = pair[role === 'planning' ? 0 : 1] || (recommendedModels[t]?.[0] || '');
                              setModelInputMode((m) => ({ ...m, [role]: false }));
                              writeOverride({ providerType: t, model: newModel });
                            }}
                            title={`Choose which provider powers the ${role} role.`}
                            style={{ width: '100%' }}
                          >
                            {providers.map((p) => (
                              <option key={p.type} value={p.type}>{providerDisplayName(p)}</option>
                            ))}
                          </select>
                        )}
                        {modelList.length > 0 ? (
                          (() => {
                            // The "Other…" option lets the user type a
                            // free-form model id. MindsHub's list is
                            // comprehensive enough that we hide the
                            // Other escape hatch there. Sticky flag
                            // keeps the text input visible after
                            // selecting Other even when the value is
                            // still empty.
                            const allowOther = curType !== 'minds-cloud';
                            const savedIsCustom = !!curModel && !modelList.includes(curModel);
                            const inputMode = modelInputMode[role] || savedIsCustom;
                            const selectValue = inputMode ? '__custom__' : curModel;
                            return (
                              <>
                                <select
                                  className="settings-select"
                                  value={selectValue || (modelList[0] || '')}
                                  onChange={(e) => {
                                    if (e.target.value === '__custom__') {
                                      setModelInputMode((m) => ({ ...m, [role]: true }));
                                      // Keep whatever curModel already
                                      // had so the user can refine it,
                                      // instead of blanking it.
                                      writeOverride({ providerType: curType, model: curModel || '' });
                                    } else {
                                      setModelInputMode((m) => ({ ...m, [role]: false }));
                                      writeOverride({ providerType: curType, model: e.target.value });
                                    }
                                  }}
                                  title={`Pick the model used for ${role}. Choose Other… to type a custom model id.`}
                                  style={{ width: '100%' }}
                                >
                                  {modelList.map((m) => <option key={m} value={m}>{m}</option>)}
                                  {allowOther && <option value="__custom__">Other…</option>}
                                </select>
                                {inputMode && allowOther && (
                                  <TextInput
                                    value={curModel}
                                    onChange={(v) => writeOverride({ providerType: curType, model: v })}
                                    placeholder="Type a model id"
                                    title="Free-form model id sent verbatim to the provider."
                                  />
                                )}
                              </>
                            );
                          })()
                        ) : (
                          <TextInput
                            value={curModel}
                            onChange={(v) => writeOverride({ providerType: curType, model: v })}
                            placeholder="model-id"
                            title="Model id sent verbatim to this provider."
                          />
                        )}
                        {!provider && curType && (
                          <div style={{ fontSize: 11.5, color: '#E07060' }}>This provider is not configured. Add it under Providers above.</div>
                        )}
                      </div>
                    </Section>
                  );
                };
                return (
                  <>
                    <RoleRow role="planning" label="Planning model" />
                    <RoleRow role="coding"   label="Coding model" />
                  </>
                );
              })()}
            </CollapsibleGroup>

            <CollapsibleGroup title="Appearance">
              <Section title="Theme" subtitle="Light or dark — also drives the animated background.">
                <Segmented
                  value={theme || 'dark'}
                  onChange={(v) => onThemeChange?.(v)}
                  options={[
                    { value: 'light', label: 'Light', title: 'Use the light theme.' },
                    { value: 'dark',  label: 'Dark',  title: 'Use the dark theme.' },
                  ]}
                />
              </Section>
              <Section title="Greeting" subtitle="The line shown when you start a new task.">
                <TextInput
                  value={settings.greeting}
                  onChange={(v) => setSetting('greeting', v)}
                  title="Shown above the task input when you start a new task."
                />
              </Section>
              <div className="settings-hide-mobile">
                <Section title="Animated background" subtitle="Toggle off if you prefer a flat surface instead of an animated grid.">
                  <Toggle
                    value={settings.showDots}
                    onChange={(v) => setSetting('showDots', v)}
                    title="Toggle the animated grid background."
                    ariaLabel="Animated background"
                  />
                </Section>
                <Section title="Show nav-panel counters" subtitle="Badge counts on Projects / Scheduled / Artifacts / Connected apps, plus the time-since label on each Recent row.">
                  <Toggle
                    value={settings.showCounters !== false}
                    onChange={(v) => setSetting('showCounters', v)}
                    title="Show badge counts on Projects, Scheduled, Artifacts and Connected apps."
                    ariaLabel="Nav-panel counters"
                  />
                </Section>
              </div>
            </CollapsibleGroup>

            {/* Legacy single-provider Models + Credentials block kept
                here for the transition window while old installs migrate. */}
            {false && (() => {
              const activePreset = inferProviderPreset(settings);
              const activeLabel = PROVIDER_PRESETS.find((p) => p.value === activePreset)?.label || activePreset;
              const configuredForActive = isProviderConfigured(activePreset, settings);
              const relevance = CREDENTIAL_RELEVANCE[activePreset] || {};
              const quickPicks = PROVIDER_MODELS[activePreset] || [];
              const has = (field) => Boolean(String(settings[field] ?? '').trim());
              const ChipRow = ({ items, current, onPick }) => items.length === 0 ? null : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                  {items.map((m) => (
                    <button key={m} type="button" onClick={() => onPick(m)}
                      style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, padding: '3px 8px', borderRadius: 999, background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border-subtle)', cursor: 'pointer' }}>{m}</button>
                  ))}
                </div>
              );
              return (
                <>
                  <CollapsibleGroup title="Models (legacy)">
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
                      <ClearableTextInput
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
                      <ClearableTextInput
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
                      <ClearableTextInput
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
                        <ClearableTextInput
                          value={settings.mindsDatasource ?? ''}
                          onChange={(v) => setSetting('mindsDatasource', v)}
                          placeholder="datasource name"
                        />
                        <ClearableTextInput
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

            <CollapsibleGroup title="Memory" defaultOpen={false}>
              <Section title="Memory mode" subtitle="How Anton updates its long-term memory.">
                <Segmented
                  value={settings.memoryMode ?? 'autopilot'}
                  onChange={(v) => setSetting('memoryMode', v)}
                  options={[
                    { value: 'autopilot', label: 'Autopilot', title: 'Anton updates long-term memory automatically.' },
                    { value: 'copilot',   label: 'Copilot',   title: 'Anton suggests memory updates for you to confirm.' },
                    { value: 'off',       label: 'Off',       title: 'Disable long-term memory updates.' },
                  ]}
                />
              </Section>
              <Section title="Episodic memory" subtitle="Save conversation history for future recall.">
                <Toggle
                  value={settings.episodicMemory ?? true}
                  onChange={(v) => setSetting('episodicMemory', v)}
                  title="Save conversation history so Anton can recall past tasks."
                  ariaLabel="Episodic memory"
                />
              </Section>
              <Section title="Proactive dashboards" subtitle="Auto-generate HTML reports from scratchpad output.">
                <Toggle
                  value={settings.proactiveDashboards ?? false}
                  onChange={(v) => setSetting('proactiveDashboards', v)}
                  title="Auto-generate HTML reports from scratchpad output."
                  ariaLabel="Proactive dashboards"
                />
              </Section>
            </CollapsibleGroup>

            <CollapsibleGroup title="Updates" defaultOpen={false}>
              <Section
                title="UI updates"
                subtitle="How over-the-air UI updates are applied when a new version is published."
              >
                <Segmented
                  value={settings.uiUpdateMode ?? 'manual'}
                  onChange={(v) => setSetting('uiUpdateMode', v)}
                  options={[
                    { value: 'auto',   label: 'Auto',   title: 'Download and apply UI updates automatically.' },
                    { value: 'manual', label: 'Manual', title: 'Only apply UI updates when triggered manually.' },
                  ]}
                />
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
          <button
            className="btn-secondary"
            onClick={validate}
            title="Re-run the configuration and active-provider tests."
          >Test</button>
          <button
            className="btn-primary"
            onClick={save}
            disabled={!settingsDirty || testing || missingCustomNames}
            title={
              missingCustomNames ? 'Each custom provider needs a name'
              : testing ? 'Saving…'
              : !settingsDirty ? 'No unsaved changes'
              : 'Save changes and re-run provider tests.'
            }
            style={{
              minWidth: 132,
              opacity: (!settingsDirty || testing || missingCustomNames) ? 0.55 : 1,
              cursor: (!settingsDirty || testing || missingCustomNames) ? 'default' : 'pointer',
            }}
          >
            {testing
              ? 'Saving…'
              : settingsDirty
                ? 'Save settings'
                : (<>{Ico.check(14)} Saved</>)}
          </button>
        </div>
      </div>
    </div>
  );
}
