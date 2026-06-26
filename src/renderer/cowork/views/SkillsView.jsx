import { useEffect, useRef, useState } from 'react';
import Ico from '../components/Icons';
import { PageHeader, FilterRow, SearchInput, SortPill } from '../components/collection';
import { Menu } from '../components/ui';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '../components/ui/Modal';
import { MarkdownContent } from '../components/markdown/MarkdownContent';
import OverflowMenu from '../components/OverflowMenu';
import { deleteSkill, fetchProjects, fetchSkills, saveSkill } from '../api';


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

const CARD_SHADOW = '0px 0px 0px 0.5px rgba(39,39,42,0.15), 0px 1px 2px rgba(0,0,0,0.05), 0px 0.5px 0px rgba(0,0,0,0.08)';

function SkillCard({ skill, onClick }) {
  const [hovered, setHovered] = useState(false);
  const age = relativeAge(skill.updatedAt);
  const project = skill.projects?.[0] || skill.project;
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
        background: hovered ? '#f9f9f9' : '#fff',
        boxShadow: CARD_SHADOW,
        borderRadius: 8,
        padding: '12px 0 0',
        display: 'flex', flexDirection: 'column', gap: 12,
        transition: 'background .15s ease',
        outline: 'none',
        font: 'inherit', color: 'inherit',
        overflow: 'hidden',
      }}
    >
      {/* Top content */}
      <div style={{ padding: '0 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          {/* Slash badge */}
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, width: 20, height: 20, borderRadius: 4,
            boxShadow: CARD_SHADOW,
            fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500,
            color: '#828285',
          }}>/</span>
          <span style={{
            flex: 1, minWidth: 0,
            fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 500,
            color: '#111115',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{skill.label}</span>
        </div>
        <span style={{
          fontFamily: 'var(--font-body)', fontSize: 14, lineHeight: '24px',
          color: '#69696B',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}>
          {skill.description || skill.declarative?.slice(0, 120) || '—'}
        </span>
      </div>

      {/* Footer */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 12px',
        background: '#FCFCFC',
        boxShadow: 'inset 0px 0.5px 0px rgba(39,39,42,0.06), inset 0px 1px 1px -0.5px rgba(39,39,42,0.06), inset 0px 2px 2px -1px rgba(39,39,42,0.06)',
        fontFamily: 'var(--font-body)', fontSize: 12,
        color: '#69696B',
      }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {Ico.folder(14)}
          <span>{project}</span>
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

function SkillModal({ open, onClose, onSaved, setStatus, initial = null, projects = [] }) {
  const isEdit = initial !== null;
  const defaultProject = (list) => list.some((p) => p.name === 'general') ? 'general' : (list[0]?.name || 'general');
  const [draft, setDraft] = useState({ label: '', description: '', declarative: '', project: 'general' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setDraft({ label: initial.label || '', description: initial.description || '', declarative: initial.declarative || '', project: initial.projects?.[0] || defaultProject(projects) });
    } else {
      setDraft({ label: '', description: '', declarative: '', project: defaultProject(projects) });
    }
  }, [open]);

  const setField = (key, value) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const handleClose = () => {
    onClose();
  };

  const submit = async () => {
    const label = isEdit ? initial.label : draft.label.trim();
    if (!label || !draft.declarative.trim()) return;
    setBusy(true);
    try {
      const saved = await saveSkill({ label, description: draft.description, declarative: draft.declarative, projects: [draft.project] }, isEdit);
      setStatus(`Saved ${label}.`);
      handleClose();
      await onSaved(saved);
    } catch (err) {
      setStatus(err.message || 'Could not save skill.');
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = draft.label.trim() && draft.declarative.trim() && !busy;

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
            <FieldLabel>Label</FieldLabel>
            <input
              aria-label="Label"
              value={draft.label}
              onChange={(e) => setField('label', e.target.value)}
              placeholder="weekly-status-report"
              readOnly={isEdit}
              style={{ ...fieldStyle, height: 34, resize: 'none', ...(isEdit && { opacity: 0.5, cursor: 'default' }) }}
              autoFocus={!isEdit}
            />
          </div>
          <div>
            <FieldLabel>Scope</FieldLabel>
            <select
              aria-label="Scope"
              value={draft.project}
              onChange={(e) => setField('project', e.target.value)}
              style={{ ...fieldStyle, height: 34, resize: 'none', cursor: 'pointer' }}
            >
              {projects.map((p) => (
                <option key={p.id ?? p.name} value={p.name}>{p.name}</option>
              ))}
            </select>
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
  const [skills, setSkills]           = useState(null);
  const [projects, setProjects]       = useState([]);
  const [selected, setSelected]       = useState(null);
  const [enabled, setEnabled]         = useState(true);
  const [modalSkill, setModalSkill]   = useState(null); // null = closed, undefined = new, skill = edit
  const [status, setStatus]           = useState('');
  const [search, setSearch]           = useState('');
  const [sortBy, setSortBy]           = useState('name');
  const [filterProject, setFilterProject] = useState('');
  const searchRef = useRef(null);

  useEffect(() => {
    fetchSkills()
      .then((data) => setSkills(data.skills || []))
      .catch((err) => setStatus(err.message || 'Could not load skills.'));
    fetchProjects().then(setProjects);
  }, []);

  const reload = () =>
    fetchSkills()
      .then((data) => setSkills(data.skills || []))
      .catch((err) => setStatus(err.message || 'Could not load skills.'));

  const onSkillSaved = (saved) => {
    setSelected((prev) => prev?.label === saved?.label ? saved : prev);
    reload();
  };

  const remove = async (skill) => {
    if (!window.confirm(`Remove skill "${skill.label}"?`)) return;
    try {
      await deleteSkill(skill.label);
      setSkills((prev) => prev.filter((s) => s.label !== skill.label));
      setSelected(null);
      setStatus(`Removed ${skill.label}.`);
    } catch (err) {
      setStatus(err.message || 'Could not remove skill.');
    }
  };

  const startNew  = () => setModalSkill(undefined);
  const startEdit = (skill) => setModalSkill(skill);
  const closeModal = () => setModalSkill(null);

  // ── Grid list ─────────────────────────────────────────────────────────────
  const filtered = (skills ?? []).filter((s) => {
    if (search) {
      const q = search.toLowerCase();
      if (!s.label?.toLowerCase().includes(q) && !s.description?.toLowerCase().includes(q)) return false;
    }
    if (filterProject) {
      const proj = s.projects?.[0];
      if (proj !== filterProject) return false;
    }
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'name') return (a.label || '').localeCompare(b.label || '');
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
              {selected.projects?.[0]}
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
          <div style={{ padding: '20px 0 0' }}>
            <FilterRow
              search={<SearchInput inputRef={searchRef} value={search} onChange={setSearch} placeholder="Search skills" shortcut={null} />}
              right={<>
                {projects.length > 0 && (
                  <SortPill
                    value={filterProject}
                    onChange={(v) => setFilterProject(v === filterProject ? '' : v)}
                    options={[{ id: '', label: 'All' }, ...projects.map((p) => ({ id: p.name, label: p.name }))]}
                    label="Filter by"
                  />
                )}
                <SortPill value={sortBy} onChange={setSortBy} options={SORT_OPTIONS} label="Sort by" />
              </>}
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
        onSaved={onSkillSaved}
        setStatus={setStatus}
        initial={modalSkill ?? null}
        projects={projects}
      />
    </div>
  );
}
