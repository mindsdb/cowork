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

function StatusBadge({ active, configured }) {
  const label = active ? 'Active' : configured ? 'Configured' : 'Not connected';
  const tone = active ? 'ok' : configured ? 'warn' : 'idle';
  return (
    <span className={`channels-badge channels-badge-${tone}`}>
      <span className="channels-led" aria-hidden="true" />
      {label}
    </span>
  );
}

function ChannelCard({ plugin, status, onChanged }) {
  const caps = plugin.capabilities || {};
  const [config, setConfig] = useState(null);     // { fields: { name: {is_set, value} } }
  const [draft, setDraft] = useState({});          // user-typed values, by field name
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function loadConfig() {
    try {
      setConfig(await fetchChannelConfig(plugin.channel_type));
    } catch {
      setConfig({ fields: {} });
    }
  }
  useEffect(() => { loadConfig(); }, [plugin.channel_type]);

  function setField(name, value) {
    setDraft((d) => ({ ...d, [name]: value }));
  }

  async function connect() {
    setBusy(true); setError(''); setNotice('');
    try {
      // Only send fields the operator actually typed — blank secret fields
      // keep their stored value (server merge semantics).
      const values = Object.fromEntries(
        Object.entries(draft).filter(([, v]) => v != null && v !== ''),
      );
      if (Object.keys(values).length) await saveChannelConfig(plugin.channel_type, values);

      if (caps.supports_webhook_setup) {
        const r = await setupChannel(plugin.channel_type);
        setNotice(r?.detail || (r?.active ? 'Connected.' : 'Setup ran.'));
      } else {
        const r = await reloadChannel(plugin.channel_type);
        setNotice(r?.active
          ? 'Credentials saved — adapter active. Register the webhook URL below on the platform.'
          : 'Credentials saved, but the channel is not active yet (missing required fields?).');
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
    setBusy(true); setError(''); setNotice('');
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

  const fields = config?.fields || {};
  const configured = status?.configured;
  const active = status?.status === 'active';
  const webhookPath = (plugin.webhook_paths || [])[0];

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
        <StatusBadge active={active} configured={configured} />
      </header>

      <div className="channels-fields">
        {(plugin.credentials || []).map((f) => {
          const isSet = fields[f.name]?.is_set;
          const stored = fields[f.name]?.value;  // non-null only for non-secret fields
          return (
            <label key={f.name} className="channels-field">
              <span className="channels-field-label">
                {f.label}{f.required ? <em className="channels-req"> *</em> : null}
                {isSet ? <span className="channels-set">set</span> : null}
              </span>
              <input
                type={f.secret ? 'password' : 'text'}
                className="channels-input"
                value={draft[f.name] ?? (f.secret ? '' : (stored ?? ''))}
                placeholder={f.secret && isSet ? '•••••••• (leave blank to keep)' : (f.description || '')}
                onChange={(e) => setField(f.name, e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
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

      {error ? <p className="channels-error">{error}</p> : null}
      {notice ? <p className="channels-notice">{notice}</p> : null}

      <div className="channels-actions">
        <button type="button" className="channels-btn channels-btn-primary" onClick={connect} disabled={busy}>
          {Ico.power(15)}<span>{configured ? 'Save & reconnect' : 'Connect'}</span>
        </button>
        {configured ? (
          <button type="button" className="channels-btn channels-btn-ghost" onClick={disconnect} disabled={busy}>
            Disconnect
          </button>
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
        <button type="button" className="channels-btn channels-btn-ghost" onClick={refresh} title="Refresh">
          {Ico.refresh(15)}
        </button>
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
        <p className="channels-muted channels-pad">No channels available. Is the server running?</p>
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
                  <StatusBadge active={st?.status === 'active'} configured={st?.configured} />
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
