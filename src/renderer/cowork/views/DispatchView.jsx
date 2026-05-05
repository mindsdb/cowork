import { useCallback, useEffect, useState } from 'react';
import Ico from '../components/Icons';
import {
  createAgentGroup,
  createWiring,
  deleteAgentGroup,
  deleteWiring,
  fetchAgentGroups,
  fetchDispatchChannels,
  fetchDispatchStatus,
  fetchSlackConfig,
  fetchWirings,
  saveSlackConfig,
  startSlackOAuth,
} from '../api';

const CHANNEL_LIBRARY = {
  slack: {
    id: 'slack',
    name: 'Slack',
    description: 'Receive messages from a Slack workspace and reply via the bot user. App mentions and DMs are routed; threads stay sticky.',
    style: 'slack',
    connectable: true,
  },
  whatsapp: {
    id: 'whatsapp',
    name: 'WhatsApp',
    description: 'Receive messages from your WhatsApp Cloud business number. Requires Meta business verification.',
    style: 'whatsapp',
    connectable: false,
    chip: 'Coming soon',
  },
};

const SESSION_MODES = [
  { value: 'agent-shared', label: 'Agent shared (one session per agent)' },
  { value: 'per-messaging-group', label: 'Per channel (default)' },
  { value: 'per-thread', label: 'Per thread (Slack threads only)' },
];

const TRIGGER_RULES = [
  { value: 'always', label: 'Every message' },
  { value: 'mention-only', label: 'Mentions only' },
  { value: 'regex', label: 'Custom regex' },
];

function StatusBadge({ active, registered }) {
  if (active) return <span className="dispatch-status dispatch-status-active">Connected</span>;
  if (registered) return <span className="dispatch-status dispatch-status-pending">Configure credentials</span>;
  return <span className="dispatch-status dispatch-status-idle">Not connected</span>;
}

function SlackConfigPanel({ initialStatus, onSaved }) {
  const [status, setStatus] = useState(initialStatus);
  const [editing, setEditing] = useState(!initialStatus.install_ready);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [signingSecret, setSigningSecret] = useState('');
  const [appToken, setAppToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [savedAt, setSavedAt] = useState(null);

  useEffect(() => { setStatus(initialStatus); }, [initialStatus]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const next = await saveSlackConfig({
        clientId:      clientId      || undefined,
        clientSecret:  clientSecret  || undefined,
        signingSecret: signingSecret || undefined,
        appToken:      appToken      || undefined,
      });
      setStatus(next);
      setClientId(''); setClientSecret(''); setSigningSecret(''); setAppToken('');
      setSavedAt(Date.now());
      setEditing(!next.install_ready);
      onSaved?.(next);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const Indicator = ({ set, label }) => (
    <span className={`dispatch-config-flag ${set ? 'dispatch-config-flag-set' : 'dispatch-config-flag-unset'}`}>
      {set ? Ico.check(12) : null}
      <span>{label} · {set ? 'Set' : 'Not set'}</span>
    </span>
  );

  // Mode indicator — Socket Mode is preferred for local dev (no public URL
  // needed); webhook mode requires an externally reachable callback URL.
  const ModeBadge = () => {
    if (status.socket_mode_ready) {
      return (
        <span className="dispatch-config-flag dispatch-config-flag-set" title="Slack pushes events down a WebSocket — no public URL needed.">
          {Ico.check(12)}
          <span>Mode · Socket</span>
        </span>
      );
    }
    return (
      <span className="dispatch-config-flag dispatch-config-flag-unset" title="Webhook mode — Slack POSTs to /v1/dispatch/slack/events. Requires a public Request URL.">
        <span>Mode · Webhook</span>
      </span>
    );
  };

  if (!editing) {
    return (
      <div className="dispatch-config-summary">
        <div className="dispatch-config-flags">
          <ModeBadge />
          <Indicator set={status.client_id_set}      label="Client ID" />
          <Indicator set={status.client_secret_set}  label="Client Secret" />
          <Indicator set={status.signing_secret_set} label="Signing Secret" />
          <Indicator set={status.app_token_set}      label="App Token (Socket)" />
        </div>
        <button type="button" className="dispatch-btn dispatch-btn-ghost dispatch-btn-link" onClick={() => setEditing(true)}>
          Edit credentials
        </button>
      </div>
    );
  }

  return (
    <form className="dispatch-config-form" onSubmit={submit}>
      <input
        className="dispatch-input"
        type="text"
        placeholder={status.client_id_set ? 'Client ID (set — leave blank to keep)' : 'Slack Client ID'}
        value={clientId}
        onChange={(e) => setClientId(e.target.value)}
        autoComplete="off"
      />
      <input
        className="dispatch-input"
        type="password"
        placeholder={status.client_secret_set ? 'Client Secret (set — leave blank to keep)' : 'Slack Client Secret'}
        value={clientSecret}
        onChange={(e) => setClientSecret(e.target.value)}
        autoComplete="off"
      />
      <input
        className="dispatch-input"
        type="password"
        placeholder={status.signing_secret_set ? 'Signing Secret (set — leave blank to keep)' : 'Slack Signing Secret'}
        value={signingSecret}
        onChange={(e) => setSigningSecret(e.target.value)}
        autoComplete="off"
      />
      <input
        className="dispatch-input"
        type="password"
        placeholder={status.app_token_set ? 'App-Level Token / xapp-… (set — leave blank to keep)' : 'Slack App-Level Token (xapp-…) — enables Socket Mode'}
        value={appToken}
        onChange={(e) => setAppToken(e.target.value)}
        autoComplete="off"
      />
      <div className="dispatch-config-actions">
        <button type="submit" className="dispatch-btn dispatch-btn-secondary" disabled={busy}>
          {busy ? 'Saving…' : 'Save credentials'}
        </button>
        {status.install_ready ? (
          <button type="button" className="dispatch-btn dispatch-btn-ghost dispatch-btn-link" onClick={() => setEditing(false)}>
            Cancel
          </button>
        ) : null}
      </div>
      {error ? <p className="dispatch-error">{error}</p> : null}
      {savedAt ? (
        <p className="dispatch-config-hint">
          Saved to ~/.anton/.env. Restart cowork-gateway so the bridge picks
          up the new values
          {status.socket_mode_ready
            ? ' — Socket Mode will reconnect automatically.'
            : '.'}
        </p>
      ) : null}
    </form>
  );
}

function ChannelCard({ entry, onConnect, busy, error, slackStatus, onSlackStatus }) {
  const info = CHANNEL_LIBRARY[entry.type] || { id: entry.type, name: entry.type, description: '' };
  const isSlack = entry.type === 'slack';
  const installReady = !isSlack || (slackStatus?.install_ready ?? false);
  return (
    <div className={`dispatch-channel-card dispatch-channel-${info.style || entry.type}`}>
      <header className="dispatch-channel-head">
        <div>
          <h3>{info.name}</h3>
          <StatusBadge active={entry.active} registered={entry.registered} />
        </div>
        {info.chip ? <span className="dispatch-channel-chip">{info.chip}</span> : null}
      </header>
      <p className="dispatch-channel-desc">{info.description}</p>

      {isSlack && slackStatus ? (
        <SlackConfigPanel initialStatus={slackStatus} onSaved={onSlackStatus} />
      ) : null}

      {info.connectable && !entry.active ? (
        <button
          type="button"
          className="dispatch-btn dispatch-btn-primary"
          onClick={() => onConnect(entry.type)}
          disabled={busy || (isSlack && !installReady)}
          title={isSlack && !installReady ? 'Save the Slack credentials first' : undefined}
        >
          {Ico.plus(14)}
          <span>{busy ? 'Opening sign-in…' : `Connect ${info.name}`}</span>
        </button>
      ) : null}
      {error ? <p className="dispatch-error">{error}</p> : null}
    </div>
  );
}

function AgentGroupForm({ onCreated, busy, setBusy }) {
  const [name, setName] = useState('');
  const [workspace, setWorkspace] = useState('');
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim() || !workspace.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createAgentGroup({ name: name.trim(), workspace: workspace.trim() });
      setName('');
      setWorkspace('');
      onCreated(created.agent_group);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="dispatch-form" onSubmit={submit}>
      <input
        className="dispatch-input"
        placeholder="Agent name (e.g. Anton)"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        className="dispatch-input"
        placeholder="Workspace path (e.g. ~/Projects/anton)"
        value={workspace}
        onChange={(e) => setWorkspace(e.target.value)}
      />
      <button
        type="submit"
        className="dispatch-btn dispatch-btn-secondary"
        disabled={busy || !name.trim() || !workspace.trim()}
      >
        Add agent
      </button>
      {error ? <span className="dispatch-error">{error}</span> : null}
    </form>
  );
}

function WiringForm({ agentGroups, channels, onCreated, busy, setBusy }) {
  const connectableTypes = channels.filter((c) => c.active).map((c) => c.type);
  const [agentGroupId, setAgentGroupId] = useState('');
  const [channelType, setChannelType] = useState(connectableTypes[0] || 'slack');
  const [platformId, setPlatformId] = useState('');
  const [sessionMode, setSessionMode] = useState('per-messaging-group');
  const [triggerRule, setTriggerRule] = useState('always');
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!agentGroupId && agentGroups[0]) setAgentGroupId(agentGroups[0].id);
  }, [agentGroups, agentGroupId]);
  useEffect(() => {
    if (!connectableTypes.includes(channelType) && connectableTypes[0]) {
      setChannelType(connectableTypes[0]);
    }
  }, [connectableTypes, channelType]);

  const submit = async (e) => {
    e.preventDefault();
    if (!agentGroupId || !channelType || !platformId.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createWiring({
        agent_group_id: agentGroupId,
        channel_type: channelType,
        platform_id: platformId.trim(),
        session_mode: sessionMode,
        trigger_rule: triggerRule,
      });
      setPlatformId('');
      onCreated(created.wiring);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!agentGroups.length) {
    return <p className="dispatch-empty">Add an agent group first.</p>;
  }
  if (!connectableTypes.length) {
    return <p className="dispatch-empty">Connect a channel first to wire it.</p>;
  }

  return (
    <form className="dispatch-form dispatch-form-wide" onSubmit={submit}>
      <select className="dispatch-input" value={agentGroupId} onChange={(e) => setAgentGroupId(e.target.value)}>
        {agentGroups.map((g) => (<option key={g.id} value={g.id}>{g.name}</option>))}
      </select>
      <select className="dispatch-input" value={channelType} onChange={(e) => setChannelType(e.target.value)}>
        {connectableTypes.map((t) => (<option key={t} value={t}>{CHANNEL_LIBRARY[t]?.name || t}</option>))}
      </select>
      <input
        className="dispatch-input"
        placeholder="Platform id (e.g. C0123ABC)"
        value={platformId}
        onChange={(e) => setPlatformId(e.target.value)}
      />
      <select className="dispatch-input" value={sessionMode} onChange={(e) => setSessionMode(e.target.value)}>
        {SESSION_MODES.map((m) => (<option key={m.value} value={m.value}>{m.label}</option>))}
      </select>
      <select className="dispatch-input" value={triggerRule} onChange={(e) => setTriggerRule(e.target.value)}>
        {TRIGGER_RULES.map((m) => (<option key={m.value} value={m.value}>{m.label}</option>))}
      </select>
      <button
        type="submit"
        className="dispatch-btn dispatch-btn-secondary"
        disabled={busy || !platformId.trim()}
      >
        Wire
      </button>
      {error ? <span className="dispatch-error">{error}</span> : null}
    </form>
  );
}

export default function DispatchView() {
  const [status, setStatus] = useState(null);
  const [channels, setChannels] = useState([]);
  const [agentGroups, setAgentGroups] = useState([]);
  const [wirings, setWirings] = useState([]);
  const [slackStatus, setSlackStatus] = useState(null);
  const [connectError, setConnectError] = useState({});
  const [connectBusy, setConnectBusy] = useState({});
  const [formBusy, setFormBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [s, c, ag, w, sc] = await Promise.all([
        fetchDispatchStatus(),
        fetchDispatchChannels(),
        fetchAgentGroups(),
        fetchWirings(),
        fetchSlackConfig(),
      ]);
      if (cancelled) return;
      setStatus(s);
      // CLI is built-in plumbing — hide it from the UI.
      const visible = c.filter((entry) => entry.type !== 'cli');
      const types = new Set(visible.map((x) => x.type));
      if (!types.has('whatsapp')) visible.push({ type: 'whatsapp', registered: false, active: false });
      // Surface Slack even before adapter registration so config can be entered first.
      if (!types.has('slack')) visible.unshift({ type: 'slack', registered: false, active: false });
      setChannels(visible);
      setAgentGroups(ag);
      setWirings(w);
      setSlackStatus(sc);
    })();
    return () => { cancelled = true; };
  }, [refreshKey]);

  const handleConnect = async (channelType) => {
    if (channelType !== 'slack') return;
    setConnectBusy((s) => ({ ...s, [channelType]: true }));
    setConnectError((s) => ({ ...s, [channelType]: null }));
    try {
      // The redirect URL must match one configured under "Redirect URLs"
      // in the Slack app, AND must reach the FastAPI server's
      // /v1/dispatch/slack/oauth/callback route. Use the renderer's own
      // origin — works across all three deployment modes:
      //   - Local docker (traefik):   https://cw-<hash>.localhost/v1/...
      //   - Web dev (vite proxy):     http://localhost:5173/v1/...
      //   - Direct curl/dev server:   http://localhost:26866/v1/...
      // The Electron `app://` scheme does not satisfy Slack's HTTPS
      // requirement, so for Electron a fallback to a fixed localhost
      // origin would be needed — but in practice the Electron renderer
      // is also hosted by traefik in the local stack.
      const redirectUri = `${window.location.origin}/v1/dispatch/slack/oauth/callback`;
      const { install_url } = await startSlackOAuth(redirectUri);
      window.open(install_url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setConnectError((s) => ({ ...s, [channelType]: err.message }));
    } finally {
      setConnectBusy((s) => ({ ...s, [channelType]: false }));
    }
  };

  const removeAgent = async (id) => {
    if (!window.confirm(`Delete agent group "${id}"? Existing wirings must be removed first.`)) return;
    try {
      await deleteAgentGroup(id);
      refresh();
    } catch (err) {
      window.alert(err.message);
    }
  };

  const removeWiring = async (mgId, agId) => {
    try {
      await deleteWiring(mgId, agId);
      refresh();
    } catch (err) {
      window.alert(err.message);
    }
  };

  return (
    <div className="dispatch-view">
      <header className="dispatch-top">Dispatch</header>
      <main className="dispatch-content dispatch-content-wide">
        <section className="dispatch-section">
          <header className="dispatch-section-head">
            <h2>Status</h2>
          </header>
          {status ? (
            <p className="dispatch-status-line">
              {status.ready ? 'Dispatch ready · ' : 'Dispatch unavailable · '}
              {status.agent_group_count} agent{status.agent_group_count === 1 ? '' : 's'} · {status.wiring_count} wiring{status.wiring_count === 1 ? '' : 's'} · {status.active_channels.length} active channel{status.active_channels.length === 1 ? '' : 's'}
            </p>
          ) : (
            <p className="dispatch-status-line">Loading…</p>
          )}
        </section>

        <section className="dispatch-section">
          <header className="dispatch-section-head">
            <h2>Channels</h2>
            <button type="button" className="dispatch-btn dispatch-btn-ghost" onClick={refresh}>
              Refresh
            </button>
          </header>
          <div className="dispatch-channel-grid">
            {channels.map((entry) => (
              <ChannelCard
                key={entry.type}
                entry={entry}
                onConnect={handleConnect}
                busy={connectBusy[entry.type]}
                error={connectError[entry.type]}
                slackStatus={entry.type === 'slack' ? slackStatus : null}
                onSlackStatus={setSlackStatus}
              />
            ))}
          </div>
        </section>

        <section className="dispatch-section">
          <header className="dispatch-section-head">
            <h2>Agent groups</h2>
          </header>
          <ul className="dispatch-list">
            {agentGroups.map((g) => (
              <li key={g.id} className="dispatch-list-row">
                <span className="dispatch-list-name">{g.name}</span>
                <span className="dispatch-list-meta">{g.workspace}</span>
                <button type="button" className="dispatch-btn dispatch-btn-icon" onClick={() => removeAgent(g.id)}>
                  {Ico.trash(14)}
                </button>
              </li>
            ))}
            {agentGroups.length === 0 ? <li className="dispatch-empty">No agent groups yet.</li> : null}
          </ul>
          <AgentGroupForm
            onCreated={(g) => { setAgentGroups((prev) => [...prev, g]); refresh(); }}
            busy={formBusy}
            setBusy={setFormBusy}
          />
        </section>

        <section className="dispatch-section">
          <header className="dispatch-section-head">
            <h2>Wirings</h2>
          </header>
          <ul className="dispatch-list">
            {wirings.map((w) => (
              <li key={`${w.messaging_group_id}-${w.agent_group_id}`} className="dispatch-list-row">
                <span className="dispatch-list-name">{w.messaging_group_id.slice(0, 8)}… → {w.agent_group_id.slice(0, 8)}…</span>
                <span className="dispatch-list-meta">{w.session_mode} · {w.trigger_rule} · prio {w.priority}</span>
                <button type="button" className="dispatch-btn dispatch-btn-icon" onClick={() => removeWiring(w.messaging_group_id, w.agent_group_id)}>
                  {Ico.trash(14)}
                </button>
              </li>
            ))}
            {wirings.length === 0 ? <li className="dispatch-empty">No wirings yet.</li> : null}
          </ul>
          <WiringForm
            agentGroups={agentGroups}
            channels={channels}
            onCreated={(w) => { setWirings((prev) => [...prev, w]); refresh(); }}
            busy={formBusy}
            setBusy={setFormBusy}
          />
        </section>
      </main>
    </div>
  );
}
