// `<ChannelBindings>` — the routing rules that wire an external chat/thread
// to the agent. Most rows are auto-created on first inbound message, so this
// panel is mainly for editing them (label, trigger rule, pinned project) and
// removing stale ones; a manual "Add route" form is provided for pre-wiring a
// known chat id. When `channelType` is given the panel is scoped to that one
// channel: rows are filtered and new routes are created on it.

import { useEffect, useState } from 'react';
import Ico from '../components/Icons';
import { Badge, Button, Tooltip } from '../components/ui';
import {
  fetchChannelBindings,
  createChannelBinding,
  updateChannelBinding,
  deleteChannelBinding,
  fetchProjects,
} from '../api';
import { Select } from '../components/ui';

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
          <Select
            style={{ flex: '1 1 140px', minWidth: 120 }}
            value={draft.channel_type}
            onValueChange={(v) => setDraft({ ...draft, channel_type: v })}
            ariaLabel="Channel"
            options={[
              { value: '', label: 'Channel…' },
              ...plugins.map((p) => ({ value: p.channel_type, label: p.display_name })),
            ]}
          />
        )}
        <input className="channels-input" placeholder="chat / group id"
          value={draft.external_group_id}
          onChange={(e) => setDraft({ ...draft, external_group_id: e.target.value })} />
        <Select
          style={{ flex: '1 1 140px', minWidth: 120 }}
          value={draft.trigger_rule}
          onValueChange={(v) => setDraft({ ...draft, trigger_rule: v })}
          ariaLabel="Trigger rule"
          options={TRIGGERS.map((t) => ({ value: t, label: t }))}
        />
        <Select
          style={{ flex: '1 1 140px', minWidth: 120 }}
          value={draft.anton_project_id}
          onValueChange={(v) => setDraft({ ...draft, anton_project_id: v })}
          ariaLabel="Project"
          options={[
            { value: '', label: 'Project: default' },
            ...projects.map((p) => ({ value: p.id, label: p.name })),
          ]}
        />
        <Button variant="primary" onClick={addRow}>
          {Ico.plus(15)}<span>Add</span>
        </Button>
      </div>

      {loading ? (
        <p className="channels-muted">Loading routes…</p>
      ) : rows.length === 0 ? (
        <p className="channels-muted">No routes yet — message the bot and one appears here.</p>
      ) : (
        <table className="channels-route-table">
          <thead>
            <tr>{channelType ? null : <th>Channel</th>}<th>Chat</th><th>Label</th><th>Trigger</th><th>Project</th><th>Instructions</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map((b) => {
              const dirty = !!edits[b.id] && Object.keys(edits[b.id]).length > 0;
              const rule = rowValue(b, 'trigger_rule');
              return (
                <tr key={b.id}>
                  {channelType ? null : <td><Badge variant="muted" size="xs">{b.channel_type}</Badge></td>}
                  <td className="channels-type">{b.external_group_id}{b.external_thread_id ? `/${b.external_thread_id}` : ''}</td>
                  <td>
                    <input className="channels-input channels-input-sm" value={rowValue(b, 'display_name')}
                      placeholder="—" onChange={(e) => editField(b.id, 'display_name', e.target.value)} />
                  </td>
                  <td>
                    <Select
                      size="sm"
                      value={rule}
                      onValueChange={(v) => editField(b.id, 'trigger_rule', v)}
                      ariaLabel="Trigger rule"
                      options={TRIGGERS.map((t) => ({ value: t, label: t }))}
                    />
                    {rule === 'regex' ? (
                      <input className="channels-input channels-input-sm" placeholder="pattern"
                        value={rowValue(b, 'trigger_pattern')}
                        onChange={(e) => editField(b.id, 'trigger_pattern', e.target.value)} />
                    ) : null}
                  </td>
                  <td>
                    <Select
                      size="sm"
                      value={rowValue(b, 'anton_project_id') || ''}
                      onValueChange={(v) => editField(b.id, 'anton_project_id', v || null)}
                      ariaLabel="Project"
                      options={[
                        { value: '', label: 'default' },
                        ...projects.map((p) => ({ value: p.id, label: p.name })),
                      ]}
                    />
                  </td>
                  <td>
                    <textarea className="channels-input channels-input-sm" rows={1}
                      placeholder="persona / tone for this chat"
                      value={rowValue(b, 'instructions')}
                      onChange={(e) => editField(b.id, 'instructions', e.target.value)} />
                  </td>
                  <td className="channels-route-actions">
                    {dirty ? (
                      <Button variant="primary" size="sm" onClick={() => saveRow(b)}>Save</Button>
                    ) : null}
                    <Tooltip content="Remove route">
                      <Button variant="danger" size="sm" icon onClick={() => removeRow(b)} aria-label="Remove route">
                        {Ico.power(14)}
                      </Button>
                    </Tooltip>
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
