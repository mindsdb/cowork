import { useEffect, useRef, useState } from 'react';
import Ico from '../components/Icons';
import { PageHeader, FilterRow, SearchInput, SortPill } from '../components/collection';
import { Menu } from '../components/ui';
import { deleteSkill, fetchSkills, saveSkill } from '../api';

const inputStyle = {
  width: '100%',
  height: 34,
  border: '1px solid var(--border-01)',
  borderRadius: 7,
  padding: '0 10px',
  fontSize: 13,
  outline: 'none',
  background: 'var(--surface-0)',
  color: 'var(--ink)',
};

function relativeAge(input) {
  if (!input) return null;
  const ts = typeof input === 'number' ? input : Date.parse(input);
  if (!Number.isFinite(ts)) return null;
  const diff = Date.now() - ts;
  if (diff < 60_000)         return 'just now';
  if (diff < 3_600_000)      return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000)     return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function EmptyState({ children }) {
  return <div style={{ padding: 32, color: 'var(--frost-600)', fontSize: 13 }}>{children}</div>;
}

function SkillCard({ skill, onClick }) {
  const [hovered, setHovered] = useState(false);
  const age = relativeAge(skill.updatedAt);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onClick(skill)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(skill); } }}
      style={{
        cursor: 'pointer',
        background: hovered ? 'var(--surface-2)' : 'var(--surface)',
        border: `1px solid ${hovered ? 'var(--line-2)' : 'var(--line)'}`,
        borderRadius: 10,
        padding: '14px 16px',
        display: 'flex', flexDirection: 'column', gap: 10,
        transition: 'background .15s ease, border-color .15s ease',
        outline: 'none',
        font: 'inherit', color: 'inherit',
        minHeight: 120,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <span style={{
          display: 'inline-flex', flexShrink: 0,
          fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 500,
          color: 'var(--ink-3)',
        }}>/</span>
        <span style={{
          flex: 1, minWidth: 0,
          fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 600,
          letterSpacing: '-0.005em', color: 'var(--ink)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{skill.name}</span>
      </div>
      <div style={{ flex: 1 }}>
        <span style={{
          fontFamily: 'var(--font-body)', fontSize: 13, lineHeight: 1.5,
          color: 'var(--ink-3)',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}>
          {skill.description || skill.declarative?.slice(0, 120) || '—'}
        </span>
      </div>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderTop: '1px solid var(--line)', paddingTop: 10,
        fontFamily: 'var(--font-mono)', fontSize: 11,
        color: 'var(--ink-4)', letterSpacing: '0.02em',
      }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          {Ico.folder(11)}
          <span>{skill.project || 'General'}</span>
        </span>
        {age && <span>Updated {age}</span>}
      </div>
    </div>
  );
}

function CreateSkillDropdown({ onWrite }) {
  const items = [
    { id: 'cowork', label: 'Create With Cowork',      icon: Ico.sparkle(13), onClick: () => {} },
    { id: 'upload', label: 'Upload a skill',           icon: Ico.upload(13),  onClick: () => {} },
    { id: 'write',  label: 'Write Skill Instructions', icon: Ico.edit(13),    onClick: onWrite },
  ];
  const trigger = (
    <button
      type="button"
      className="btn-primary"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 8, paddingRight: 10 }}
    >
      {Ico.plus(14)}
      <span>Create skill</span>
      <span style={{ display: 'inline-flex', color: 'inherit', opacity: 0.7 }}>{Ico.chevDown(11)}</span>
    </button>
  );
  return <Menu trigger={trigger} items={items} align="end" width={220} />;
}

const SORT_OPTIONS = [
  { id: 'name',   label: 'Name' },
  { id: 'recent', label: 'Recent' },
];

export default function SkillsView() {
  const [skills, setSkills]   = useState(null);
  const [selected, setSelected] = useState(null);
  const [editing, setEditing]  = useState(null);
  const [status, setStatus]    = useState('');
  const [search, setSearch]    = useState('');
  const [sortBy, setSortBy]    = useState('name');
  const searchRef = useRef(null);

  const emptyDraft = { label: '', name: '', description: '', declarative: '' };
  const [draft, setDraft] = useState(emptyDraft);

  useEffect(() => {
    fetchSkills()
      .then((data) => setSkills(data.skills || []))
      .catch((err) => setStatus(err.message || 'Could not load skills.'));
  }, []);

  const reload = () =>
    fetchSkills()
      .then((data) => setSkills(data.skills || []))
      .catch((err) => setStatus(err.message || 'Could not load skills.'));

  const remove = async (skill) => {
    if (!window.confirm(`Remove skill "${skill.name}"?`)) return;
    try {
      await deleteSkill(skill.label);
      setSkills((prev) => prev.filter((s) => s.label !== skill.label));
      setSelected(null);
      setStatus(`Removed ${skill.name}.`);
    } catch (err) {
      setStatus(err.message || 'Could not remove skill.');
    }
  };

  const startNew = () => {
    setEditing('new');
    setDraft(emptyDraft);
    setSelected(null);
  };

  const startEdit = (skill) => {
    setEditing('edit');
    setDraft({
      label: skill.label || '',
      name: skill.name || '',
      description: skill.description || '',
      declarative: skill.declarative || '',
    });
    setSelected(skill);
  };

  const save = async () => {
    try {
      await saveSkill(draft, editing === 'edit');
      setStatus(`Saved ${draft.name || draft.label}.`);
      setEditing(null);
      setSelected(draft);
      await reload();
    } catch (err) {
      setStatus(err.message || 'Could not save skill.');
    }
  };

  const cancelEditing = () => {
    setEditing(null);
    setSelected(null);
  };

  // ── Editing form ──────────────────────────────────────────────────────────
  if (editing) {
    return (
      <div className="scroll-clean" style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ padding: 32, maxWidth: 640 }}>
          {status && <div style={{ marginBottom: 12, color: '#8F321A', fontSize: 12.5 }}>{status}</div>}
          <button
            type="button"
            className="btn-secondary"
            onClick={cancelEditing}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 24 }}
          >
            {Ico.chevLeft(13)} Back
          </button>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 8 }}>
              <input aria-label="Skill identifier" value={draft.label} onChange={(e) => setDraft((p) => ({ ...p, label: e.target.value }))} placeholder="skill-label" style={inputStyle} disabled={editing === 'edit'} />
              <input aria-label="Skill name" value={draft.name} onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))} placeholder="Skill name" style={inputStyle} />
            </div>
            <input aria-label="Skill description" value={draft.description} onChange={(e) => setDraft((p) => ({ ...p, description: e.target.value }))} placeholder="Short description: when the agent should use this skill" style={inputStyle} />
            <textarea aria-label="Skill instructions" value={draft.declarative} onChange={(e) => setDraft((p) => ({ ...p, declarative: e.target.value }))} rows={16} placeholder="Skill instructions..." style={{ ...inputStyle, height: 'auto', padding: 10, fontFamily: 'var(--font-mono)', userSelect: 'text' }} />
            <div className="dialog-actions">
              <button className="secondary-btn" onClick={cancelEditing}>Cancel</button>
              <button className="primary-btn" disabled={!draft.label.trim() || !draft.name.trim() || !draft.declarative.trim()} onClick={save}>Save skill</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Detail view ───────────────────────────────────────────────────────────
  if (selected) {
    return (
      <div className="scroll-clean" style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ padding: 32, maxWidth: 720 }}>
          {status && <div style={{ marginBottom: 12, color: '#8F321A', fontSize: 12.5 }}>{status}</div>}
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setSelected(null)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 24 }}
          >
            {Ico.chevLeft(13)} Back
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 18, fontWeight: 650, color: 'var(--ink)' }}>{selected.name}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-4)', fontFamily: 'var(--font-mono)' }}>{selected.label}</div>
            </div>
            <button className="btn-secondary" onClick={() => startEdit(selected)}>Edit</button>
            <button className="btn-secondary" onClick={() => remove(selected)}>Remove</button>
          </div>
          {selected.description && <p style={{ margin: '0 0 16px', fontSize: 13.5, color: 'var(--ink-3)' }}>{selected.description}</p>}
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', userSelect: 'text', fontFamily: 'var(--font-mono)', fontSize: 12.5, lineHeight: 1.55 }}>{selected.declarative}</pre>
        </div>
      </div>
    );
  }

  // ── Grid list ─────────────────────────────────────────────────────────────
  const list = skills ?? [];

  const filtered = list.filter((s) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return s.name?.toLowerCase().includes(q) || s.description?.toLowerCase().includes(q);
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'name') return (a.name || '').localeCompare(b.name || '');
    if (sortBy === 'recent') {
      return (b.updatedAt ? Date.parse(b.updatedAt) : 0) - (a.updatedAt ? Date.parse(a.updatedAt) : 0);
    }
    return 0;
  });

  return (
    <div className="scroll-clean" style={{ flex: 1, overflowY: 'auto', paddingBottom: 40 }}>
      <PageHeader
        title="Skills"
        subtitle="Extend Cowork's capabilities with task-specific skills"
        actions={<CreateSkillDropdown onWrite={startNew} />}
      />
      {status && <div style={{ margin: '12px 32px 0', color: '#8F321A', fontSize: 12.5 }}>{status}</div>}
      <div style={{ padding: '20px 32px 0' }}>
        <FilterRow
          search={<SearchInput inputRef={searchRef} value={search} onChange={setSearch} placeholder="Search skills" shortcut={null} />}
          sort={<SortPill value={sortBy} onChange={setSortBy} options={SORT_OPTIONS} label="Sort by" />}
        />
      </div>
      {skills === null ? (
        <EmptyState>Loading…</EmptyState>
      ) : sorted.length > 0 ? (
        <div style={{ padding: '20px 32px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {sorted.map((skill) => (
            <SkillCard key={skill.label} skill={skill} onClick={setSelected} />
          ))}
        </div>
      ) : (
        <EmptyState>{search ? 'No skills match your search.' : 'No saved skills yet.'}</EmptyState>
      )}
    </div>
  );
}
