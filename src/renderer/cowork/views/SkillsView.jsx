import { useEffect, useRef, useState } from 'react';
import Ico from '../components/Icons';
import { PageHeader, FilterRow, SearchInput, SortPill } from '../components/collection';
import { Menu, Button, Card, Field, Select, Input, Textarea } from '../components/ui';
import { ToggleGroup } from '../components/ui/ToggleGroup';
import { Switch } from '../components/ui/Switch';
import { useToastManager } from '../components/ui/Toast';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '../components/ui/Modal';
import { MarkdownContent } from '../components/markdown/MarkdownContent';
import OverflowMenu from '../components/OverflowMenu';
import { fetchProjects, uploadSkillFile } from '../api';
import { useSkills, saveSkillAndSync, deleteSkillAndSync } from '../lib/skillsStore';
import { relativeAge } from '../lib/formatTime';

// Sentinel for the "All projects" scope choice in the Scope <Select>. It must
// be a non-empty string: Base UI's <Select.Value> treats an empty-string value
// as "nothing selected" and shows the placeholder, so an option with value ''
// would render as the "Select…" placeholder on the closed control even though
// its item still carries a checkmark (ENG-1246). This value never reaches
// storage — `submit` maps it back to an empty `projects` array, and it can't
// collide with a real project name.
const ALL_PROJECTS = '__all_projects__';

function EmptyState({ children }) {
  return <div style={{ padding: 32, color: 'var(--frost-600)', fontSize: 13 }}>{children}</div>;
}


function SkillGridCard({ skill, onClick }) {
  const age = relativeAge(skill.updatedAt);
  const project = skill.projects?.[0] || skill.project;
  return (
    <Card
      as="button"
      interactive
      padding="none"
      onClick={() => onClick(skill)}
      style={{
        padding: '12px 0 0',
        display: 'flex', flexDirection: 'column', gap: 12,
        overflow: 'hidden',
      }}
    >
      {/* Top content */}
      <div style={{ flex: 1, padding: '0 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          {/* Slash badge */}
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, width: 20, height: 20, borderRadius: 4,
            boxShadow: 'var(--sh-1)',
            fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500,
            color: 'var(--ink-3)',
          }}>/</span>
          <span style={{
            flex: 1, minWidth: 0,
            fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 500,
            color: 'var(--ink)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{skill.label}</span>
          {skill.enabled === false && (
            <span style={{
              flexShrink: 0,
              display: 'inline-flex', alignItems: 'center',
              height: 20, padding: '0 6px', borderRadius: 4,
              background: 'color-mix(in srgb, var(--ink) 6%, transparent)',
              border: '1px solid var(--line)',
              color: 'var(--ink-3)',
              fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 500,
            }}>Disabled</span>
          )}
        </div>
        <span style={{
          // Matches the page-header subtitle (13.5 / 1.5) so the card copy
          // reads as the same "muted body" voice, not a looser 14/24 block.
          fontFamily: 'var(--font-body)', fontSize: 13.5, lineHeight: 1.5,
          color: 'var(--ink-3)',
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
        background: 'var(--bg)',
        boxShadow: 'inset 0px 0.5px 0px rgba(39,39,42,0.06), inset 0px 1px 1px -0.5px rgba(39,39,42,0.06), inset 0px 2px 2px -1px rgba(39,39,42,0.06)',
        fontFamily: 'var(--font-body)', fontSize: 12,
        color: 'var(--ink-3)',
      }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {Ico.folder(14)}
          <span>{project}</span>
        </span>
        {age && <span>Updated {age}</span>}
      </div>
    </Card>
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

function SkillModal({ open, onClose, onSaved, onError, initial = null, projects = [] }) {
  const isEdit = initial !== null;
  const [draft, setDraft] = useState({ label: '', description: '', declarative: '', project: ALL_PROJECTS });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setDraft({ label: initial.label || '', description: initial.description || '', declarative: initial.declarative || '', project: initial.projects?.[0] || ALL_PROJECTS });
    } else {
      setDraft({ label: '', description: '', declarative: '', project: ALL_PROJECTS });
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
      const scopedProject = draft.project && draft.project !== ALL_PROJECTS ? [draft.project] : [];
      const saved = await saveSkillAndSync({ label, description: draft.description, declarative: draft.declarative, projects: scopedProject }, isEdit);
      handleClose();
      await onSaved(saved);
    } catch (err) {
      onError?.(`Error: ${err.message}.`);
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
          <Field label="Label">
            <Input
              aria-label="Label"
              value={draft.label}
              onChange={(v) => setField('label', v)}
              placeholder="weekly-status-report"
              readOnly={isEdit}
              style={{ ...fieldStyle, height: 34, resize: 'none', ...(isEdit && { opacity: 0.5, cursor: 'default' }) }}
              autoFocus={!isEdit}
            />
          </Field>
          <Field label="Scope">
            <Select
              ariaLabel="Scope"
              value={draft.project}
              onValueChange={(v) => setField('project', v)}
              style={{ ...fieldStyle, height: 34 }}
              options={[
                // The global scope is a mode, not a project — set it apart from
                // the real projects (which map 1:1 to the projects page) with a
                // leading icon and a divider.
                { value: ALL_PROJECTS, label: 'All projects', icon: Ico.globe(14) },
                { separator: true },
                ...projects.map((p) => ({ value: p.name, label: p.name })),
              ]}
            />
          </Field>
          <Field label="Description">
            <Textarea
              aria-label="Description"
              value={draft.description}
              onChange={(v) => setField('description', v)}
              placeholder="Generate weekly status reports from recent work. Use when asked for updates or progress summaries."
              style={{ ...fieldStyle, height: 80 }}
            />
          </Field>
          <Field label="Instructions">
            <Textarea
              aria-label="Instructions"
              value={draft.declarative}
              onChange={(v) => setField('declarative', v)}
              placeholder="Summarize my recent work in three sections: wins, blockers, and next steps. Keep the tone professional but not stiff..."
              style={{ ...fieldStyle, height: 198, fontFamily: 'var(--font-mono)', fontSize: 12.5 }}
            />
          </Field>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="subtle" onClick={handleClose}>Cancel</Button>
        <Button variant="primary" disabled={!canSubmit} onClick={submit}>
          {!isEdit && !busy && Ico.plus(14)}
          {busy ? 'Saving…' : isEdit ? 'Save' : 'Create'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

function UploadSkillModal({ open, onClose, onSaved, onError }) {
  const [dragging, setDragging] = useState(false);
  const [file, setFile]         = useState(null);
  const [busy, setBusy]         = useState(false);
  const inputRef                = useRef(null);

  useEffect(() => { if (!open) { setFile(null); setBusy(false); } }, [open]);

  const pickFile = (f) => { if (f) setFile(f); };

  const upload = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const saved = await uploadSkillFile(file);
      onClose();
      await onSaved(saved);
    } catch (err) {
      onError?.(err.message || 'Could not upload skill.');
    } finally {
      setBusy(false);
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    pickFile(e.dataTransfer.files[0]);
  };

  return (
    <Modal open={open} onClose={onClose} width="549px" labelledBy="upload-skill-title">
      <ModalHeader id="upload-skill-title" title="Upload Skill Files" subtitle="Upload a .md or .skill file to import a skill." onClose={onClose} />
      <ModalBody padding="20px">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Drop zone */}
          <div
            onClick={() => !file && !busy && inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            style={{
              height: 160, borderRadius: 12,
              border: `1px dashed ${dragging ? 'var(--accent)' : file ? 'var(--accent)' : 'var(--line-2)'}`,
              background: dragging ? 'var(--accent-bg)' : file ? 'var(--accent-bg)' : 'var(--surface-2)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: 12, padding: '24px 0',
              cursor: file ? 'default' : 'pointer',
              transition: 'border-color .15s ease, background .15s ease',
            }}
          >
            {file ? (
              <>
                <span style={{ color: 'var(--accent)' }}>{Ico.upload(32)}</span>
                <span style={{ fontSize: 13.5, fontFamily: 'var(--font-body)', color: 'var(--ink-2)', fontWeight: 500 }}>
                  {file.name}
                </span>
                <span style={{ fontSize: 12, fontFamily: 'var(--font-body)', color: 'var(--ink-4)' }}>
                  {(file.size / 1024).toFixed(1)} KB
                </span>
                <Button
                  variant="subtle"
                  onClick={(e) => { e.stopPropagation(); setFile(null); }}
                >
                  Remove
                </Button>
              </>
            ) : (
              <>
                <span style={{ color: 'var(--ink-4)' }}>{Ico.upload(32)}</span>
                <span style={{ fontSize: 13.5, fontFamily: 'var(--font-body)', color: 'var(--ink-3)' }}>
                  Drag and drop or click to upload
                </span>
              </>
            )}
            <input
              ref={inputRef}
              type="file"
              accept=".md,.skill,.zip"
              style={{ display: 'none' }}
              onChange={(e) => { pickFile(e.target.files[0]); e.target.value = ''; }}
            />
          </div>

          {/* File requirements */}
          <div style={{ fontSize: 12, lineHeight: '16px', color: 'var(--ink-3)', fontFamily: 'var(--font-body)' }}>
            <div style={{ fontWeight: 500, marginBottom: 4 }}>File requirements</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              <li>.md or .skill file must contain skill name and description formatted in YAML</li>
              <li>.zip file must include a SKILL.md file</li>
            </ul>
          </div>

        </div>
      </ModalBody>
      <ModalFooter align="space-between">
        <Button variant="subtle" onClick={onClose}>Cancel</Button>
        {file && (
          <Button variant="primary" disabled={busy} onClick={upload}>
            {!busy && Ico.upload(14)}
            {busy ? 'Uploading…' : 'Upload'}
          </Button>
        )}
      </ModalFooter>
    </Modal>
  );
}

const COWORK_PREFILL = "Let's create a skill together using your /skill-creator skill. First ask me what the skill should do.";

function CreateSkillDropdown({ onWrite, onUpload, onCowork }) {
  const items = [
    { id: 'cowork', label: 'Create With Cowork',      icon: Ico.sparkle(14), onClick: () => onCowork?.(COWORK_PREFILL) },
    { id: 'upload', label: 'Upload a skill',           icon: Ico.upload(14),  onClick: onUpload },
    { id: 'write',  label: 'Write Skill Instructions', icon: Ico.edit(14),    onClick: onWrite },
  ];
  const trigger = (
    <Button
      variant="primary"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 8, paddingRight: 10 }}
    >
      {Ico.plus(14)}
      <span>Create skill</span>
      <span style={{ display: 'inline-flex', color: 'inherit', opacity: 0.7 }}>{Ico.chevDown(11)}</span>
    </Button>
  );
  return <Menu trigger={trigger} items={items} align="end" width={220} />;
}

const SORT_OPTIONS = [
  { id: 'name',   label: 'Name' },
  { id: 'recent', label: 'Recent' },
];

export default function SkillsView({ onCreateWithCowork, onTryInChat }) {
  // Skills come from the shared store so saves/deletes here sync the composer
  // "/" menu (and skill-card saves sync back to this page) with no reload.
  const { skills, reload }            = useSkills();
  const [projects, setProjects]       = useState([]);
  const [selected, setSelected]       = useState(null);
  const [modalSkill, setModalSkill]   = useState(null); // null = closed, undefined = new, skill = edit
  const [uploadOpen, setUploadOpen]   = useState(false);
  const toastManager = useToastManager();
  const [search, setSearch]           = useState('');
  const [sortBy, setSortBy]           = useState('name');
  const [view, setView]               = useState(() => localStorage.getItem('anton:skills-view') === 'list' ? 'list' : 'grid');
  const searchRef = useRef(null);

  const handleViewChange = (v) => { setView(v); localStorage.setItem('anton:skills-view', v); };

  // type: 'success' | 'error' (mapped to the shared Toast's 'danger').
  const showToast = (msg, type = 'error') => toastManager.add({ title: msg, type: type === 'error' ? 'danger' : type });

  useEffect(() => {
    fetchProjects().then(setProjects);
    reload();
  }, []);

  const onSkillSaved = (saved) => {
    setSelected((prev) => prev?.label === saved?.label ? saved : prev);
    showToast(`Saved ${saved?.label}.`, 'success');
  };

  const remove = async (skill) => {
    if (!window.confirm(`Remove skill "${skill.label}"?`)) return;
    try {
      await deleteSkillAndSync(skill.label);
      setSelected(null);
      showToast(`Removed ${skill.label}.`, 'success');
    } catch (err) {
      showToast(err.message || 'Could not remove skill.');
    }
  };

  const startNew  = () => setModalSkill(undefined);
  const startEdit = (skill) => setModalSkill(skill);
  const closeModal = () => setModalSkill(null);

  // ── Grid list ─────────────────────────────────────────────────────────────
  const filtered = (skills ?? []).filter((s) => {
    if (search) {
      const q = search.toLowerCase();
      const project = (s.projects?.[0] || s.project || '').toLowerCase();
      if (!s.label?.toLowerCase().includes(q) && !s.description?.toLowerCase().includes(q) && !project.includes(q)) return false;
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
        <>
          <PageHeader
            crumbs={[{ label: 'Skills', onClick: () => setSelected(null) }]}
            current={selected.label}
            actions={
              <>
                <Switch
                  checked={selected.enabled ?? true}
                  aria-label="Skill enabled"
                  onCheckedChange={async (next) => {
                    setSelected((prev) => ({ ...prev, enabled: next }));
                    try {
                      const saved = await saveSkillAndSync({ label: selected.label, enabled: next }, true);
                      setSelected(saved);
                    } catch (err) {
                      setSelected((prev) => ({ ...prev, enabled: !next }));
                      showToast(err.message || 'Could not update skill.');
                    }
                  }}
                />
                <OverflowMenu
                  items={[
                    { id: 'try',       label: 'Try in chat', icon: Ico.chats(14),  onClick: () => onTryInChat?.(`/${selected.label}`, selected.projects?.[0]) },
                    { id: 'edit',      label: 'Edit',        icon: Ico.edit(14),   onClick: () => startEdit(selected) },
                    { divider: true },
                    { id: 'uninstall', label: 'Uninstall',   icon: Ico.trash(14),  danger: true, onClick: () => remove(selected) },
                  ]}
                />
              </>
            }
          />
          <div style={{ padding: '24px 32px 32px' }}>

          {/* Scope */}
          <div style={{ marginBottom: 16 }}>
            <h3 className="s-h3" style={{ margin: '0 0 4px' }}>Scope</h3>
            <p style={{ margin: 0, fontSize: 13.5, color: 'var(--ink)', lineHeight: 1.5, userSelect: 'text' }}>
              {selected.projects?.[0] || 'All projects'}
            </p>
          </div>

          {/* Description */}
          {selected.description && (
            <div style={{ marginBottom: 16 }}>
              <h3 className="s-h3" style={{ margin: '0 0 4px' }}>Description</h3>
              <p style={{ margin: 0, fontSize: 13.5, color: 'var(--ink)', lineHeight: 1.5, userSelect: 'text' }}>
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
        </>
      ) : (
        // ── Grid ───────────────────────────────────────────────────────────
        <>
          <PageHeader
            title="Skills"
            subtitle="Extend Cowork's capabilities with task-specific skills"
            actions={<CreateSkillDropdown onWrite={startNew} onUpload={() => setUploadOpen(true)} onCowork={onCreateWithCowork} />}
          />

          <FilterRow
            search={<SearchInput inputRef={searchRef} value={search} onChange={setSearch} placeholder="Search skills" shortcut={null} />}
            sort={<SortPill value={sortBy} onChange={setSortBy} options={SORT_OPTIONS} />}
            view={<span className="proj-view-toggle"><ToggleGroup value={view} onValueChange={handleViewChange} size="md" aria-label="View" options={[{ value: 'grid', label: 'Grid', icon: Ico.grid(13) }, { value: 'list', label: 'List', icon: Ico.list(13) }]} /></span>}
          />
          {skills === null ? (
            <EmptyState>Loading…</EmptyState>
          ) : sorted.length === 0 ? (
            <EmptyState>{search ? 'No skills match your search.' : 'No saved skills yet.'}</EmptyState>
          ) : view === 'list' ? (
            <div style={{ padding: '16px 32px 60px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr auto auto', gap: '0 16px', borderBottom: '1px solid var(--line)', padding: '0 8px 8px', marginBottom: 4 }}>
                {['Name', 'Description', 'Project', 'Updated'].map((h) => (
                  <span key={h} style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--ink-4)', letterSpacing: '0.10em', textTransform: 'uppercase' }}>{h}</span>
                ))}
              </div>
              {sorted.map((skill) => {
                const project = skill.projects?.[0] || skill.project;
                const age = relativeAge(skill.updatedAt);
                return (
                  <div
                    key={skill.label}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelected(skill)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(skill); } }}
                    style={{ display: 'grid', gridTemplateColumns: '1fr 2fr auto auto', gap: '0 16px', padding: '10px 8px', borderBottom: '1px solid var(--line)', cursor: 'pointer', borderRadius: 6, outline: 'none' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-2)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
                  >
                    <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 500, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{skill.label}</span>
                    <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{skill.description || '—'}</span>
                    <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>{project || '—'}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--ink-4)', whiteSpace: 'nowrap' }}>{age || '—'}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ padding: '20px 32px 60px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
              {sorted.map((skill) => (
                <SkillGridCard key={skill.label} skill={skill} onClick={setSelected} />
              ))}
            </div>
          )}
        </>
      )}
      <UploadSkillModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onSaved={onSkillSaved}
        onError={showToast}
      />
      <SkillModal
        open={modalSkill !== null}
        onClose={closeModal}
        onSaved={onSkillSaved}
        onError={showToast}
        initial={modalSkill ?? null}
        projects={projects}
      />
    </div>
  );
}
