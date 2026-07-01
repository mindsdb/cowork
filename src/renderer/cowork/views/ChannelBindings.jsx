// `<ChannelBindings>` — the routing rules that wire an external chat/thread
// to the agent. Most rows are auto-created on first inbound message, so this
// panel is mainly for editing them (label, trigger rule, pinned project) and
// removing stale ones; a manual "Add route" form is provided for pre-wiring a
// known chat id. When `channelType` is given the panel is scoped to that one
// channel: rows are filtered and new routes are created on it.

import { useEffect, useState } from 'react';
import Ico from '../components/Icons';
import {
  fetchChannelBindings,
  createChannelBinding,
  updateChannelBinding,
  deleteChannelBinding,
  fetchProjects,
} from '../api';

const TRIGGERS = ['always', 'mention_only', 'regex'];
const BLANK = { channel_type: '', external_group_id: '', display_name: '', trigger_rule: 'always', trigger_pattern: '', anton_project_id: '' };

export default function ChannelBindings({ plugins = [], channelType = null }) {
  const [bindings, setBindings] = useState([]);
  const [projects, setProjects] = useState([]);
  const [edits, setEdits] = useState({});   // id -> partial patch
  const [draft, setDraft] = useState(BLANK);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  async function refresh() {
    const [b, p] = await Promise.all([fetchChannelBindings(), fetchProjects()]);
    setBindings(b);
    setProjects(p);
    setEdits({});
    setLoading(false);
  }
  useEffect(() => { refresh(); }, []);

  function editField(id, name, value) {
    setEdits((e) => ({ ...e, [id]: { ...(e[id] || {}), [name]: value } }));
  }
  function rowValue(b, name) {
    const e = edits[b.id] || {};
    return name in e ? e[name] : (b[name] ?? '');
  }

  async function saveRow(b) {
    const patch = edits[b.id];
    if (!patch || !Object.keys(patch).length) return;
    setError('');
    try {
      await updateChannelBinding(b.id, patch);
      await refresh();
    } catch (err) {
      setError(err?.message || 'Save failed');
    }
  }

  async function removeRow(b) {
    setError('');
    try { await deleteChannelBinding(b.id); await refresh(); }
    catch (err) { setError(err?.message || 'Delete failed'); }
  }

  async function addRow() {
    setError('');
    const type = channelType || draft.channel_type;
    if (!type || !draft.external_group_id.trim()) {
      setError(channelType ? 'Enter the chat/group id.' : 'Pick a channel and enter the chat/group id.');
      return;
    }
    const payload = { channel_type: type, external_group_id: draft.external_group_id.trim(), trigger_rule: draft.trigger_rule };
    if (draft.display_name.trim()) payload.display_name = draft.display_name.trim();
    if (draft.trigger_rule === 'regex' && draft.trigger_pattern.trim()) payload.trigger_pattern = draft.trigger_pattern.trim();
    if (draft.anton_project_id) payload.anton_project_id = draft.anton_project_id;
    try {
      await createChannelBinding(payload);
      setDraft(BLANK);
      await refresh();
    } catch (err) {
      setError(err?.message || 'Add failed');
    }
  }

  const projectName = (id) => projects.find((p) => p.id === id)?.name || '';
  const rows = channelType ? bindings.filter((b) => b.channel_type === channelType) : bindings;

  return (
    <section className="channels-routes">
      <h2 className="channels-routes-title">Routes</h2>
      <p className="channels-intro">
        Which chats reach the agent. New chats are added automatically on first message; edit or remove them here.
      </p>

      {error ? <p className="channels-error">{error}</p> : null}

      <div className="channels-route-add">
        {channelType ? null : (
          <select className="channels-input" value={draft.channel_type}
            onChange={(e) => setDraft({ ...draft, channel_type: e.target.value })}>
            <option value="">Channel…</option>
            {plugins.map((p) => <option key={p.channel_type} value={p.channel_type}>{p.display_name}</option>)}
          </select>
        )}
        <input className="channels-input" placeholder="chat / group id"
          value={draft.external_group_id}
          onChange={(e) => setDraft({ ...draft, external_group_id: e.target.value })} />
        <select className="channels-input" value={draft.trigger_rule}
          onChange={(e) => setDraft({ ...draft, trigger_rule: e.target.value })}>
          {TRIGGERS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className="channels-input" value={draft.anton_project_id}
          onChange={(e) => setDraft({ ...draft, anton_project_id: e.target.value })}>
          <option value="">Project: default</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button type="button" className="channels-btn channels-btn-primary" onClick={addRow}>
          {Ico.plus(15)}<span>Add</span>
        </button>
      </div>

      {loading ? (
        <p className="channels-muted">Loading routes…</p>
      ) : rows.length === 0 ? (
        <p className="channels-muted">No routes yet — message the bot and one appears here.</p>
      ) : (
        <table className="channels-route-table">
          <thead>
            <tr>{channelType ? null : <th>Channel</th>}<th>Chat</th><th>Label</th><th>Trigger</th><th>Project</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map((b) => {
              const dirty = !!edits[b.id] && Object.keys(edits[b.id]).length > 0;
              const rule = rowValue(b, 'trigger_rule');
              return (
                <tr key={b.id}>
                  {channelType ? null : <td><span className="channels-badge channels-badge-idle">{b.channel_type}</span></td>}
                  <td className="channels-type">{b.external_group_id}{b.external_thread_id ? `/${b.external_thread_id}` : ''}</td>
                  <td>
                    <input className="channels-input channels-input-sm" value={rowValue(b, 'display_name')}
                      placeholder="—" onChange={(e) => editField(b.id, 'display_name', e.target.value)} />
                  </td>
                  <td>
                    <select className="channels-input channels-input-sm" value={rule}
                      onChange={(e) => editField(b.id, 'trigger_rule', e.target.value)}>
                      {TRIGGERS.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                    {rule === 'regex' ? (
                      <input className="channels-input channels-input-sm" placeholder="pattern"
                        value={rowValue(b, 'trigger_pattern')}
                        onChange={(e) => editField(b.id, 'trigger_pattern', e.target.value)} />
                    ) : null}
                  </td>
                  <td>
                    <select className="channels-input channels-input-sm"
                      value={rowValue(b, 'anton_project_id') || ''}
                      onChange={(e) => editField(b.id, 'anton_project_id', e.target.value || null)}>
                      <option value="">default</option>
                      {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </td>
                  <td className="channels-route-actions">
                    {dirty ? (
                      <button type="button" className="channels-btn channels-btn-primary channels-btn-sm" onClick={() => saveRow(b)}>Save</button>
                    ) : null}
                    <button type="button" className="channels-btn channels-btn-ghost channels-btn-sm" onClick={() => removeRow(b)} title="Remove route">
                      {Ico.power(14)}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
