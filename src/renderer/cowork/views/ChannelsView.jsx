// `<ChannelsView>` — connect messaging channels (Telegram/Slack/Discord/
// WhatsApp) to the agent. Master–detail layout: a left rail lists the
// channels with their status, the right pane shows the selected channel's
// credentials plus its routes. Capability flags from the server decide which
// fields/buttons render. Secrets are masked on read (is_set / value:null) and
// only sent when the operator types a new value.
//
// Connect flow: save credentials, then `setup` when the channel supports
// webhook registration (Telegram), otherwise `reload` to bring the live
// adapter online — channels without setup must have their webhook URL
// registered on the platform side (we surface the path for that).

import { useEffect, useState } from 'react';
import Ico from '../components/Icons';
import { Badge, Button, Field, Tooltip } from '../components/ui';
import ChannelBindings from './ChannelBindings';
import {
  fetchChannelPlugins,
  fetchChannelStatus,
  fetchChannelConfig,
  saveChannelConfig,
  deleteChannelConfig,
  reloadChannel,
  setupChannel,
  teardownChannel,
  testChannelConnection,
  fetchChannelAgent,
  setChannelAgent,
} from '../api';

// Which harness answers in channels — distinct from the desktop harness
// toggle. Changing it applies to NEW conversations; existing chats stay pinned
// to the agent that first served them.
function ChannelAgentSelect() {
  const [agent, setAgent] = useState(null);   // { harness, options }
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => { fetchChannelAgent().then(setAgent); }, []);

  async function change(harness) {
    setSaving(true); setNote('');
    try {
      const r = await setChannelAgent(harness);
      setAgent(r);
      const n = r?.reset_conversations || 0;
      setNote(n > 0
        ? `Saved — ${n} active chat${n === 1 ? '' : 's'} will continue with ${harness} on the next message.`
        : `Saved — channels now use ${harness}.`);
    } catch (err) {
      setNote(err?.message || 'Could not change the channel agent');
    } finally {
      setSaving(false);
    }
  }

  if (!agent || !(agent.options || []).length) return null;
  return (
    <div className="channels-agent">
      <span className="channels-agent-label">Channel agent</span>
      <div className="channels-agent-tabs" role="tablist" aria-label="Channel agent">
        {agent.options.map((o) => (
          <button
            key={o}
            type="button"
            role="tab"
            aria-selected={o === agent.harness}
            className={`channels-agent-tab${o === agent.harness ? ' is-active' : ''}`}
            disabled={saving}
            onClick={() => { if (o !== agent.harness) change(o); }}
          >
            {o}
          </button>
        ))}
      </div>
      <span className="channels-agent-hint">
        Switching restarts active chats with the new agent on their next message.
      </span>
      {note ? <span className="channels-notice">{note}</span> : null}
    </div>
  );
}

// Brand thumb served from the static `logos/` dir (vite public assets). The
// filename is derived from channel_type, which matches the logo set; if the
// image is missing the generic chats glyph keeps the row aligned. The white
// chip behind the mark keeps dark brand colours legible in dark themes.
function ChannelLogo({ type, size = 26 }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="channels-logo" style={{ width: size, height: size }} aria-hidden="true">
      {failed ? Ico.chats(Math.round(size * 0.6)) : (
        <img
          src={`logos/${type}.svg`}
          alt=""
          width={Math.round(size * 0.62)}
          height={Math.round(size * 0.62)}
          draggable={false}
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}

function StatusBadge({ active, configured, orgReady = true }) {
  if (!orgReady) return <Badge variant="muted" size="xs">Coming soon</Badge>;
  const label = active ? 'Active' : configured ? 'Configured' : 'Not connected';
  // Active and Configured are both "healthy" states (green) — Configured
  // just means set-but-not-necessarily-live, not a warning.
  const variant = (active || configured) ? 'success' : 'muted';
  return (
    <Badge variant={variant} dot size="xs">{label}</Badge>
  );
}

function ChannelCard({ plugin, status, onChanged }) {
  const caps = plugin.capabilities || {};
  const [config, setConfig] = useState(null);     // { fields: { name: {is_set, value} } }
  const [draft, setDraft] = useState({});          // user-typed values, by field name
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [warning, setWarning] = useState('');    // did some of what was asked
  const [fieldErrors, setFieldErrors] = useState({});  // validation, by field name
  // A failed read gives `{ fields: {} }`, which is shape-identical to a
  // channel with nothing stored — the flag is the only way to tell them apart.
  const [configUnreadable, setConfigUnreadable] = useState(false);

  const fields = config?.fields || {};
  const configured = status?.configured;

  async function loadConfig() {
    try {
      setConfig(await fetchChannelConfig(plugin.channel_type));
      setConfigUnreadable(false);
    } catch {
      setConfig({ fields: {} });
      setConfigUnreadable(true);
    }
  }
  useEffect(() => { loadConfig(); }, [plugin.channel_type]);

  function setField(name, value) {
    setDraft((d) => ({ ...d, [name]: value }));
    setFieldErrors((e) => (e[name] ? { ...e, [name]: '' } : e));
  }

  // Required fields with nothing behind them: nothing typed and nothing
  // stored. Returns nothing while the card cannot see what is stored (read
  // failed, or not back yet) or once the server calls the channel configured
  // — the server is the authority, and a stale local view must never block
  // reconnecting a channel that works.
  function missingRequired(values) {
    if (!config || configUnreadable || configured) return [];
    return (plugin.credentials || []).filter(
      (f) => f.required && !values[f.name] && !fields[f.name]?.is_set,
    );
  }

  async function connect() {
    // Only send fields the operator actually typed — blank secret fields
    // keep their stored value (server merge semantics).
    const values = Object.fromEntries(
      Object.entries(draft).filter(([, v]) => v != null && v !== ''),
    );
    const missing = missingRequired(values);
    if (missing.length) {
      setError(''); setNotice(''); setWarning('');
      setFieldErrors(Object.fromEntries(missing.map((f) => [f.name, `${f.label} is required.`])));
      return;
    }

    setBusy(true); setError(''); setNotice(''); setWarning(''); setFieldErrors({});
    try {
      // Blank inputs on a configured channel send nothing, so only a real PUT
      // may be reported as a save.
      const saved = Object.keys(values).length > 0;
      if (saved) await saveChannelConfig(plugin.channel_type, values);

      if (caps.supports_webhook_setup) {
        const r = await setupChannel(plugin.channel_type);
        setNotice(r?.detail || (r?.active ? 'Connected.' : 'Setup ran.'));
      } else {
        const r = await reloadChannel(plugin.channel_type);
        // An adapter can need more than the fields marked required (Slack also
        // wants an app-level token or a signing secret), so a channel that
        // stays down here is a real outcome, not something validation missed.
        if (r?.active) {
          setNotice(saved
            ? 'Credentials saved — adapter active. Register the webhook URL below on the platform.'
            : 'Adapter active. Register the webhook URL below on the platform.');
        } else if (saved) {
          setWarning('Credentials saved, but the channel is not active yet. Check the remaining fields above and the server log.');
        } else {
          setError('The channel is not active. Check the stored credentials and the server log.');
        }
      }
      setDraft({});
      await loadConfig();
      onChanged?.();
    } catch (err) {
      setError(err?.message || 'Connect failed');
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true); setError(''); setNotice(''); setWarning('');
    try {
      if (caps.supports_teardown) {
        try { await teardownChannel(plugin.channel_type); } catch { /* non-fatal */ }
      }
      await deleteChannelConfig(plugin.channel_type);
      setDraft({});
      await loadConfig();
      onChanged?.();
    } catch (err) {
      setError(err?.message || 'Disconnect failed');
    } finally {
      setBusy(false);
    }
  }

  // Calls the platform with the stored credentials — "configured" only means
  // every required field has some value, not that the platform accepts it.
  async function testConnection() {
    setBusy(true); setError(''); setNotice(''); setWarning('');
    try {
      const r = await testChannelConnection(plugin.channel_type);
      if (r?.ok) setNotice(r.detail || 'Connection verified.');
      else setError(r?.detail || 'The platform rejected these credentials.');
    } catch (err) {
      setError(err?.message || 'Could not test the connection');
    } finally {
      setBusy(false);
    }
  }

  const active = status?.status === 'active';
  const webhookPath = (plugin.webhook_paths || [])[0];
  const orgReady = plugin.org_ready !== false;

  return (
    <section className="channels-card">
      <header className="channels-card-head">
        <div className="channels-card-id">
          <ChannelLogo type={plugin.channel_type} size={32} />
          <div>
            <h2>{plugin.display_name}</h2>
            <code className="channels-type">{plugin.channel_type}</code>
          </div>
        </div>
        <StatusBadge active={active} configured={configured} orgReady={orgReady} />
      </header>

      <div className="channels-fields">
        {(plugin.credentials || []).map((f) => {
          const isSet = fields[f.name]?.is_set;
          const stored = fields[f.name]?.value;  // non-null only for non-secret fields
          return (
            <Field
              key={f.name}
              label={<>{f.label}{isSet ? <Badge variant="muted" size="xs">set</Badge> : null}</>}
              required={f.required}
              error={fieldErrors[f.name]}
            >
              <input
                type={f.secret ? 'password' : 'text'}
                className="channels-input"
                value={draft[f.name] ?? (f.secret ? '' : (stored ?? ''))}
                placeholder={f.secret && isSet ? '•••••••• (leave blank to keep)' : (f.description || '')}
                onChange={(e) => setField(f.name, e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
          );
        })}
      </div>

      {webhookPath && !caps.supports_webhook_setup ? (
        <p className="channels-hook">
          Register this webhook on {plugin.display_name}:{' '}
          <code>{`<server public URL>/api/v1/channels/${plugin.channel_type}${webhookPath}`}</code>
        </p>
      ) : null}

      {caps.supports_oauth ? (
        <p className="channels-note">OAuth install isn’t wired yet — enter credentials directly above.</p>
      ) : null}

      {!orgReady ? (
        <p className="channels-note">
          Coming soon for team/cloud workspaces — {plugin.display_name} works today on desktop.
        </p>
      ) : null}

      {error ? <p className="channels-error">{error}</p> : null}
      {warning ? <p className="channels-warn">{warning}</p> : null}
      {notice ? <p className="channels-notice">{notice}</p> : null}

      <div className="channels-actions">
        <Button variant="primary" onClick={connect} disabled={busy || !orgReady}>
          {Ico.power(15)}<span>{configured ? 'Save & reconnect' : 'Connect'}</span>
        </Button>
        {configured && caps.supports_verify ? (
          <Button variant="subtle" onClick={testConnection} disabled={busy || !orgReady}>
            Test connection
          </Button>
        ) : null}
        {configured ? (
          <Button variant="danger" onClick={disconnect} disabled={busy || !orgReady}>
            Disconnect
          </Button>
        ) : null}
      </div>
    </section>
  );
}

export default function ChannelsView() {
  const [plugins, setPlugins] = useState([]);
  const [statusByType, setStatusByType] = useState({});
  const [loading, setLoading] = useState(true);
  const [selectedType, setSelectedType] = useState(null);

  async function refresh() {
    const [pl, st] = await Promise.all([fetchChannelPlugins(), fetchChannelStatus()]);
    setPlugins(pl);
    setStatusByType(Object.fromEntries((st.channels || []).map((c) => [c.channel_type, c])));
    setLoading(false);
  }
  useEffect(() => { refresh(); }, []);

  // Fall back to the first plugin so the detail pane is never empty once the
  // list loads; an explicit click overrides it.
  const selected = plugins.find((p) => p.channel_type === selectedType) || plugins[0] || null;

  return (
    <div className="channels-view">
      <header className="channels-top">
        <span>Channels</span>
        <Tooltip content="Refresh">
          <Button variant="subtle" icon onClick={refresh} aria-label="Refresh">
            {Ico.refresh(15)}
          </Button>
        </Tooltip>
      </header>
      <div className="channels-lede">
        <p className="channels-intro">
          Connect a messaging app so people can talk to the agent from their chats.
        </p>
        <ChannelAgentSelect />
      </div>
      {loading ? (
        <p className="channels-muted channels-pad">Loading channels…</p>
      ) : plugins.length === 0 ? (
        <p className="channels-muted channels-pad">
          No channels available. Is the server running?
        </p>
      ) : (
        <main className="channels-body">
          <nav className="channels-list scroll-clean" aria-label="Channels">
            {plugins.map((p) => {
              const st = statusByType[p.channel_type];
              const isSelected = p.channel_type === selected?.channel_type;
              return (
                <button
                  key={p.channel_type}
                  type="button"
                  className={`channels-list-item${isSelected ? ' is-active' : ''}`}
                  aria-current={isSelected || undefined}
                  onClick={() => setSelectedType(p.channel_type)}
                >
                  <ChannelLogo type={p.channel_type} />
                  <span className="channels-list-name">
                    {p.display_name}
                    <code className="channels-type">{p.channel_type}</code>
                  </span>
                  <StatusBadge
                    active={st?.status === 'active'}
                    configured={st?.configured}
                    orgReady={p.org_ready !== false}
                  />
                </button>
              );
            })}
          </nav>
          <section className="channels-detail scroll-clean">
            {selected ? (
              <>
                <ChannelCard
                  key={selected.channel_type}
                  plugin={selected}
                  status={statusByType[selected.channel_type]}
                  onChanged={refresh}
                />
                <ChannelBindings
                  key={`routes-${selected.channel_type}`}
                  plugins={plugins}
                  channelType={selected.channel_type}
                />
              </>
            ) : null}
          </section>
        </main>
      )}
    </div>
  );
}
