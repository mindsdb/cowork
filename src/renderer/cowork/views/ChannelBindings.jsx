// `<ChannelBindings>` — the routing rules that wire an external chat/thread
// to the agent. Most rows are auto-created on first inbound message, so this
// panel is mainly for editing them (label, trigger rule, pinned project) and
// removing stale ones; a manual "Add route" form is provided for pre-wiring a
// known chat id. When `channelType` is given the panel is scoped to that one
// channel: rows are filtered and new routes are created on it. Each route also
// carries what an allowed person's turns may use; all off by default.

import { useEffect, useRef, useState } from 'react';
import { projectLabel } from '../lib/projectLabel';
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
import { useTranslation } from '../../lib/i18n';

const TRIGGERS = ['always', 'mention_only', 'regex'];
const SWITCHES = ['allow_scratchpad', 'allow_connectors', 'allow_memory_writes', 'allow_file_replies'];
const BLANK = { channel_type: '', external_group_id: '', display_name: '', trigger_rule: 'always', trigger_pattern: '', anton_project_id: '' };

export default function ChannelBindings({ plugins = [], channelType = null, refreshToken = 0, switchesReadOnly = false }) {
  const { t } = useTranslation('settingsTools');
  const [bindings, setBindings] = useState([]);
  const [projects, setProjects] = useState([]);
  const [edits, setEdits] = useState({});   // id -> partial patch
  const [draft, setDraft] = useState(BLANK);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  // Refreshes can overlap (mount, Refresh, save/delete); only the latest may set state.
  const refreshAttemptRef = useRef(0);

  async function refresh() {
    const attemptId = ++refreshAttemptRef.current;
    const [b, p] = await Promise.all([fetchChannelBindings(), fetchProjects()]);
    if (refreshAttemptRef.current !== attemptId) return;
    setBindings(b);
    setProjects(p);
    setEdits({});
    setLoading(false);
  }
  // A new refreshToken refetches in place, so a half-typed manual route survives.
  useEffect(() => { refresh(); }, [refreshToken]);

  function editField(id, name, value) {
    setEdits((e) => ({ ...e, [id]: { ...(e[id] || {}), [name]: value } }));
  }
  function rowValue(b, name) {
    const e = edits[b.id] || {};
    return name in e ? e[name] : (b[name] ?? '');
  }
  // Connectors count only with the scratchpad on (the server does the same) and
  // show off without it, so any scratchpad change saves connectors as shown: off.
  function toggleSwitch(b, name, on) {
    const connectorsShownOff = name === 'allow_scratchpad' && (!on || !rowValue(b, 'allow_scratchpad'));
    editField(b.id, name, on);
    if (connectorsShownOff && rowValue(b, 'allow_connectors') !== false) editField(b.id, 'allow_connectors', false);
  }

  async function saveRow(b) {
    const patch = edits[b.id];
    if (!patch || !Object.keys(patch).length) return;
    setError('');
    try {
      await updateChannelBinding(b.id, patch);
      await refresh();
    } catch (err) {
      setError(err?.message || t('channelBindings.saveFailed'));
    }
  }

  async function removeRow(b) {
    setError('');
    try { await deleteChannelBinding(b.id); await refresh(); }
    catch (err) { setError(err?.message || t('channelBindings.deleteFailed')); }
  }

  async function addRow() {
    setError('');
    const type = channelType || draft.channel_type;
    if (!type || !draft.external_group_id.trim()) {
      setError(channelType ? t('channelBindings.enterChatId') : t('channelBindings.pickChannel'));
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
      setError(err?.message || t('channelBindings.addFailed'));
    }
  }

  const rows = channelType ? bindings.filter((b) => b.channel_type === channelType) : bindings;

  return (
    <section className="channels-routes">
      <h2 className="channels-routes-title">{t('channelBindings.title')}</h2>
      <p className="channels-intro">
        {t('channelBindings.intro')}
      </p>

      {error ? <p className="channels-error">{error}</p> : null}

      <div className="channels-route-add">
        {channelType ? null : (
          <Select
            style={{ flex: '1 1 140px', minWidth: 120 }}
            value={draft.channel_type}
            onValueChange={(v) => setDraft({ ...draft, channel_type: v })}
            ariaLabel={t('channelBindings.channelAriaLabel')}
            options={[
              { value: '', label: t('channelBindings.channelPlaceholder') },
              ...plugins.map((p) => ({ value: p.channel_type, label: p.display_name })),
            ]}
          />
        )}
        <input className="channels-input" placeholder={t('channelBindings.chatIdPlaceholder')}
          value={draft.external_group_id}
          onChange={(e) => setDraft({ ...draft, external_group_id: e.target.value })} />
        <Select
          style={{ flex: '1 1 140px', minWidth: 120 }}
          value={draft.trigger_rule}
          onValueChange={(v) => setDraft({ ...draft, trigger_rule: v })}
          ariaLabel={t('channelBindings.triggerAriaLabel')}
          options={TRIGGERS.map((rule) => ({ value: rule, label: t(`channelBindings.trigger.${rule}`) }))}
        />
        <Select
          style={{ flex: '1 1 140px', minWidth: 120 }}
          value={draft.anton_project_id}
          onValueChange={(v) => setDraft({ ...draft, anton_project_id: v })}
          ariaLabel={t('channelBindings.projectAriaLabel')}
          options={[
            { value: '', label: t('channelBindings.projectDefaultOption') },
            ...projects.map((p) => ({ value: p.id, label: projectLabel(p) })),
          ]}
        />
        <Button variant="primary" onClick={addRow}>
          {Ico.plus(14)}<span>{t('channelBindings.add')}</span>
        </Button>
      </div>

      {loading ? (
        <p className="channels-muted">{t('channelBindings.loading')}</p>
      ) : rows.length === 0 ? (
        <p className="channels-muted">{t('channelBindings.empty')}</p>
      ) : (
        <table className="channels-route-table">
          <thead>
            <tr>{channelType ? null : <th>{t('channelBindings.columns.channel')}</th>}<th>{t('channelBindings.columns.chat')}</th><th>{t('channelBindings.columns.label')}</th><th>{t('channelBindings.columns.trigger')}</th><th>{t('channelBindings.columns.project')}</th><th>{t('channelBindings.columns.instructions')}</th><th>{t('channelBindings.columns.capabilities')}</th><th></th></tr>
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
                      ariaLabel={t('channelBindings.triggerAriaLabel')}
                      options={TRIGGERS.map((rule) => ({ value: rule, label: t(`channelBindings.trigger.${rule}`) }))}
                    />
                    {rule === 'regex' ? (
                      <input className="channels-input channels-input-sm" placeholder={t('channelBindings.patternPlaceholder')}
                        value={rowValue(b, 'trigger_pattern')}
                        onChange={(e) => editField(b.id, 'trigger_pattern', e.target.value)} />
                    ) : null}
                  </td>
                  <td>
                    <Select
                      size="sm"
                      value={rowValue(b, 'anton_project_id') || ''}
                      onValueChange={(v) => editField(b.id, 'anton_project_id', v || null)}
                      ariaLabel={t('channelBindings.projectAriaLabel')}
                      options={[
                        { value: '', label: t('channelBindings.defaultOption') },
                        ...projects.map((p) => ({ value: p.id, label: projectLabel(p) })),
                      ]}
                    />
                  </td>
                  <td>
                    <textarea className="channels-input channels-input-sm" rows={1}
                      placeholder={t('channelBindings.instructionsPlaceholder')}
                      value={rowValue(b, 'instructions')}
                      onChange={(e) => editField(b.id, 'instructions', e.target.value)} />
                  </td>
                  <td>
                    {SWITCHES.map((name) => {
                      const scratchpadOn = !!rowValue(b, 'allow_scratchpad');
                      const needsScratchpad = name === 'allow_connectors' && !scratchpadOn;
                      return (
                        <label key={name} className="channels-switch">
                          <input
                            type="checkbox"
                            aria-label={t(`channelBindings.switch.${name}`)}
                            checked={!!rowValue(b, name) && !needsScratchpad}
                            disabled={switchesReadOnly || needsScratchpad}
                            onChange={(e) => toggleSwitch(b, name, e.target.checked)}
                          />
                          <span>{t(`channelBindings.switch.${name}`)}</span>
                          {name === 'allow_scratchpad' ? (
                            <small className="channels-muted">{t('channelBindings.scratchpadWarning')}</small>
                          ) : null}
                          {needsScratchpad ? (
                            <small className="channels-muted">{t('channelBindings.connectorsNeedScratchpad')}</small>
                          ) : null}
                        </label>
                      );
                    })}
                    {switchesReadOnly ? <small className="channels-muted">{t('channelBindings.switchesAdminOnly')}</small> : null}
                  </td>
                  <td className="channels-route-actions">
                    {dirty ? (
                      <Button variant="primary" size="sm" onClick={() => saveRow(b)}>{t('channelBindings.save')}</Button>
                    ) : null}
                    <Tooltip content={t('channelBindings.removeRoute')}>
                      <Button variant="danger" size="sm" icon onClick={() => removeRow(b)} aria-label={t('channelBindings.removeRoute')}>
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
