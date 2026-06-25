import { useEffect, useRef, useState } from 'react';
import Ico from '../components/Icons';
import { PageHeader, FilterRow, SearchInput, SortPill } from '../components/collection';
import { Menu } from '../components/ui';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '../components/ui/Modal';
import { MarkdownContent } from '../components/markdown/MarkdownContent';
import OverflowMenu from '../components/OverflowMenu';
import { deleteSkill, fetchSkills, saveSkill } from '../api';


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

function Toggle({ checked, onChange }) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
      <input type="checkbox" checked={checked} onChange={onChange} style={{ display: 'none' }} />
      <div style={{
        width: 36, height: 20, borderRadius: 10,
        background: checked ? 'var(--accent)' : 'var(--line-2)',
        position: 'relative',
        transition: 'background .2s ease',
        flexShrink: 0,
      }}>
        <div style={{
          position: 'absolute',
          top: 2, left: checked ? 18 : 2,
          width: 16, height: 16, borderRadius: '50%',
          background: 'white',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          transition: 'left .2s ease',
        }} />
      </div>
    </label>
  );
}

function toLabel(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const fieldStyle = {
  width: '100%',
  border: '1px solid var(--border-01)',
  borderRadius: 8,
  padding: 8,
  fontSize: 13,
  outline: 'none',
  background: 'var(--surface-0)',
  color: 'var(--ink)',
  fontFamily: 'var(--font-body)',
  resize: 'vertical',
  boxSizing: 'border-box',
};

function FieldLabel({ children }) {
  return (
    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 4 }}>
      {children}
    </div>
  );
}

// initial — передаётся при редактировании существующего скила, null при создании
function SkillModal({ open, onClose, onSaved, setStatus, initial = null }) {
  const isEdit = initial !== null;
  const empty = { name: '', description: '', declarative: '' };
  const [draft, setDraft] = useState(empty);
  const [busy, setBusy] = useState(false);

  // Когда модал открывается с initial — заполняем поля
  useEffect(() => {
    if (open) setDraft(initial ? { name: initial.name || '', description: initial.description || '', declarative: initial.declarative || '' } : empty);
  }, [open]);

  const setField = (key, value) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const handleClose = () => {
    onClose();
  };

  const submit = async () => {
    const label = isEdit ? initial.label : toLabel(draft.name);
    if (!label || !draft.name.trim() || !draft.declarative.trim()) return;
    setBusy(true);
    try {
      await saveSkill({ label, ...draft }, isEdit);
      setStatus(`Saved ${draft.name}.`);
      handleClose();
      await onSaved();
    } catch (err) {
      setStatus(err.message || 'Could not save skill.');
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = draft.name.trim() && draft.declarative.trim() && !busy;

  return (
    <Modal open={open} onClose={handleClose} width="549px" labelledBy="skill-modal-title">
      <ModalHeader
        id="skill-modal-title"
        title={isEdit ? 'Edit Skill' : 'Add a Skill'}
        subtitle="Write a name, description, and instructions for the skill."
        onClose={handleClose}
      />
      <ModalBody padding="20px">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <FieldLabel>Skill name</FieldLabel>
            <input
              aria-label="Skill name"
              value={draft.name}
              onChange={(e) => setField('name', e.target.value)}
              placeholder="weekly-status-report"
              style={{ ...fieldStyle, height: 34, resize: 'none' }}
              autoFocus
            />
          </div>
          <div>
            <FieldLabel>Description</FieldLabel>
            <textarea
              aria-label="Description"
              value={draft.description}
              onChange={(e) => setField('description', e.target.value)}
              placeholder="Generate weekly status reports from recent work. Use when asked for updates or progress summaries."
              style={{ ...fieldStyle, height: 80 }}
            />
          </div>
          <div>
            <FieldLabel>Instructions</FieldLabel>
            <textarea
              aria-label="Instructions"
              value={draft.declarative}
              onChange={(e) => setField('declarative', e.target.value)}
              placeholder="Summarize my recent work in three sections: wins, blockers, and next steps. Keep the tone professional but not stiff..."
              style={{ ...fieldStyle, height: 198, fontFamily: 'var(--font-mono)', fontSize: 12.5 }}
            />
          </div>
        </div>
      </ModalBody>
      <ModalFooter>
        <button type="button" className="btn-secondary" onClick={handleClose}>Cancel</button>
        <button type="button" className="btn-primary" disabled={!canSubmit} onClick={submit}>
          {busy ? 'Saving…' : isEdit ? 'Save' : 'Create'}
        </button>
      </ModalFooter>
    </Modal>
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
  const [skills, setSkills]         = useState(null);
  const [selected, setSelected]     = useState(null);
  const [enabled, setEnabled]       = useState(true);
  const [modalSkill, setModalSkill] = useState(null); // null = closed, undefined = new, skill = edit
  const [status, setStatus]         = useState('');
  const [search, setSearch]         = useState('');
  const [sortBy, setSortBy]         = useState('name');
  const searchRef = useRef(null);

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

  const startNew  = () => setModalSkill(undefined);
  const startEdit = (skill) => setModalSkill(skill);
  const closeModal = () => setModalSkill(null);

  // ── Grid list ─────────────────────────────────────────────────────────────
  const filtered = (skills ?? []).filter((s) => {
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
      {selected ? (
        // ── Detail view ────────────────────────────────────────────────────
        <div style={{ padding: 32 }}>
          {status && <div style={{ marginBottom: 12, color: '#8F321A', fontSize: 12.5 }}>{status}</div>}

          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
            <button
              type="button"
              onClick={() => setSelected(null)}
              style={{
                display: 'inline-flex', alignItems: 'center',
                background: 'transparent', border: 0, padding: 0,
                color: 'var(--ink-3)', cursor: 'pointer',
                flexShrink: 0,
              }}
              aria-label="Back"
            >
              {Ico.chevLeft(16)}
            </button>
            <span style={{
              fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600,
              color: 'var(--ink)', letterSpacing: '-0.005em',
            }}>
              {selected.label}
            </span>
            <div style={{ flex: 1 }} />
            <Toggle checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            <OverflowMenu
              items={[
                { id: 'try',       label: 'Try in chat', onClick: () => {} },
                { id: 'edit',      label: 'Edit',        onClick: () => startEdit(selected) },
                { divider: true },
                { id: 'uninstall', label: 'Uninstall',   danger: true, onClick: () => remove(selected) },
              ]}
            />
          </div>

          {/* Scope */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11.5, fontWeight: 500, color: '#828285', marginBottom: 4, fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' }}>
              Scope
            </div>
            <p style={{ margin: 0, fontSize: 13.5, color: '#111115', lineHeight: 1.5, userSelect: 'text' }}>
              {selected.projects?.[0] || 'general'}
            </p>
          </div>

          {/* Description */}
          {selected.description && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11.5, fontWeight: 500, color: '#828285', marginBottom: 4, fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' }}>
                Description
              </div>
              <p style={{ margin: 0, fontSize: 13.5, color: '#111115', lineHeight: 1.5, userSelect: 'text' }}>
                {selected.description}
              </p>
            </div>
          )}

          {/* Content card */}
          <div style={{
            borderRadius: 20,
            border: '1px solid var(--line)',
            padding: 24,
            display: 'flex', flexDirection: 'column', gap: 16,
            background: 'var(--surface)',
            userSelect: 'text',
          }}>
            <MarkdownContent
              text={selected.declarative || ''}
              id={`skill-${selected.label}`}
              complete
              dense
            />
          </div>
        </div>
      ) : (
        // ── Grid ───────────────────────────────────────────────────────────
        <>
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
        </>
      )}
      <SkillModal
        open={modalSkill !== null}
        onClose={closeModal}
        onSaved={reload}
        setStatus={setStatus}
        initial={modalSkill ?? null}
      />
    </div>
  );
}
