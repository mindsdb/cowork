import { useEffect, useRef, useState } from 'react';
import { projectLabel, projectLabelByName } from '../lib/projectLabel';
import Ico from '../components/Icons';
import {
  PageHeader, FilterRow, SearchInput, SortPill, ViewToggle, CollectionState, useCollectionView,
  ListGroup, ListItem,
} from '../components/collection';
import { Menu, Badge, Button, Card, Field, Select, Input, Textarea } from '../components/ui';
import { ConfirmModal } from '../components/ConfirmModal';
import { Switch } from '../components/ui/Switch';
import { useToastManager } from '../components/ui/Toast';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '../components/ui/Modal';
import { MarkdownContent } from '../components/markdown/MarkdownContent';
import OverflowMenu from '../components/OverflowMenu';
import { fetchProjects, uploadSkillFile } from '../api';
import { useSkills, saveSkillAndSync, deleteSkillAndSync } from '../lib/skillsStore';
import { relativeAge } from '../lib/formatTime';
import SharedResourceAttribution from '../components/SharedResourceAttribution';
import {
  canUseSharedResource,
  sharedResourceAttribution,
} from '../lib/sharedResourceAccess';

// Sentinel for the "All projects" scope choice in the Scope <Select>. It must
// be a non-empty string: Base UI's <Select.Value> treats an empty-string value
// as "nothing selected" and shows the placeholder, so an option with value ''
// would render as the "Select…" placeholder on the closed control even though
// its item still carries a checkmark (ENG-1246). This value never reaches
// storage — `submit` maps it back to an empty `projects` array, and it can't
// collide with a real project name.
const ALL_PROJECTS = '__all_projects__';


function SkillGridCard({ skill, onClick, projects = [] }) {
  const age = relativeAge(skill.updatedAt);
  // `skill.projects` holds project *names*, not objects, so the slug has to be
  // resolved against the list before a person sees it (ENG-1676).
  const project = projectLabelByName(projects, skill.projects?.[0] || skill.project);
  return (
    <Card
      as="button"
      interactive
      padding="none"
      className="railed"
      onClick={() => onClick(skill)}
      style={{
        paddingTop: 12,
        display: 'flex', flexDirection: 'column', gap: 12,
      }}
    >
      {/* Top content */}
      <div className="flex-1 px-3 flex flex-col gap-1">
        <div className="flex items-center gap-[6px] min-w-0">
          {/* Slash badge */}
          <span className="inline-flex items-center justify-center shrink-0 w-5 h-5 rounded-[4px] shadow-sh-1 font-mono text-[12px] font-medium text-ink-3">/</span>
          <span className="flex-1 min-w-0 font-[family-name:var(--font-body)] text-base font-medium text-ink overflow-hidden text-ellipsis whitespace-nowrap">{skill.label}</span>
          {skill.enabled === false && (
            <span className="shrink-0 inline-flex items-center h-5 px-[6px] rounded-[4px] border border-solid border-line text-ink-3 font-[family-name:var(--font-body)] text-xs font-medium" style={{
              background: 'color-mix(in srgb, var(--ink) 6%, transparent)',
            }}>Disabled</span>
          )}
          {skill.isBuiltin && (
            <span className="shrink-0 inline-flex items-center h-5 px-[6px] rounded-[4px] border border-solid border-line text-ink-3 font-[family-name:var(--font-body)] text-xs font-medium">
              Built-in
            </span>
          )}
        </div>
        <span
          // Matches the page-header subtitle (13.5 / 1.5) so the card copy
          // reads as the same "muted body" voice, not a looser 14/24 block.
          className="font-[family-name:var(--font-body)] text-[13.5px] leading-[1.5] text-ink-3 line-clamp-2"
        >
          {skill.description || skill.declarative?.slice(0, 120) || '—'}
        </span>
        <SharedResourceAttribution resource={skill} className="mt-1" />
      </div>

      {/* Footer */}
      <div className="card__rail flex items-center justify-between px-3 py-2 font-[family-name:var(--font-body)] text-[12px] text-ink-3">
        <span className="inline-flex items-center gap-1">
          {Ico.folder(14)}
          <span>{project}</span>
        </span>
        {age && <span>Updated {age}</span>}
      </div>
    </Card>
  );
}

// The list view is a kit row: name, description, and inline meta (project,
// stable creator, last update). The grid keeps its railed SkillGridCard.
function SkillRow({ skill, onClick, projects = [] }) {
  const age = relativeAge(skill.updatedAt);
  // Project label, not slug (ENG-1676); unscoped skills apply everywhere.
  const project = projectLabelByName(projects, skill.projects?.[0] || skill.project);
  const author = sharedResourceAttribution(skill)?.createdBy;
  return (
    <ListItem
      as="article"
      aria-label={skill.label}
      leading={<span className="font-mono text-sm font-medium">/</span>}
      title={skill.label}
      badges={(skill.enabled === false || skill.isBuiltin) && (
        <>
          {skill.enabled === false && <Badge variant="muted" size="sm">Disabled</Badge>}
          {skill.isBuiltin && <Badge variant="muted" size="sm">Built-in</Badge>}
        </>
      )}
      description={skill.description || skill.declarative?.slice(0, 120) || '—'}
      onActivate={() => onClick(skill)}
      meta={(
        <>
          <span className="inline-flex min-w-0 items-center gap-1">
            {Ico.folder(12)}
            <span className="truncate">{project || 'All projects'}</span>
          </span>
          {author && <span className="max-w-[160px] truncate" title={author}>{author}</span>}
          {age && <span className="whitespace-nowrap">Updated {age}</span>}
        </>
      )}
    />
  );
}

// Page margin of the row group, shared with its loading skeleton so loading
// does not shift the layout.
const LIST_CLASS = 'mx-8 mb-[60px]';

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
    if (isEdit && !canUseSharedResource(initial, 'canEdit')) {
      onError?.('You do not have permission to edit this shared skill.');
      return;
    }
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
        <div className="flex flex-col gap-3">
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
                // value stays the slug -- it is what `submit` persists into
                // `skill.projects`. Only the label is for reading.
                ...projects.map((p) => ({ value: p.name, label: projectLabel(p) })),
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
        <div className="flex flex-col gap-4">

          {/* Drop zone */}
          <div
            onClick={() => !file && !busy && inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className="h-[160px] rounded-card flex flex-col items-center justify-center gap-3 py-6 [transition:border-color_var(--dur-hover)_ease,background_var(--dur-hover)_ease]"
            style={{
              border: `1px dashed ${dragging ? 'var(--accent)' : file ? 'var(--accent)' : 'var(--line-2)'}`,
              background: dragging ? 'var(--accent-bg)' : file ? 'var(--accent-bg)' : 'var(--surface-2)',
              cursor: file ? 'default' : 'pointer',
            }}
          >
            {file ? (
              <>
                <span className="text-accent">{Ico.upload(32)}</span>
                <span className="text-[13.5px] font-[family-name:var(--font-body)] text-ink-2 font-medium">
                  {file.name}
                </span>
                <span className="text-[12px] font-[family-name:var(--font-body)] text-ink-4">
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
                <span className="text-ink-4">{Ico.upload(32)}</span>
                <span className="text-[13.5px] font-[family-name:var(--font-body)] text-ink-3">
                  Drag and drop or click to upload
                </span>
              </>
            )}
            <input
              ref={inputRef}
              type="file"
              accept=".md,.skill,.zip"
              className="hidden"
              onChange={(e) => { pickFile(e.target.files[0]); e.target.value = ''; }}
            />
          </div>

          {/* File requirements */}
          <div className="text-[12px] leading-[16px] text-ink-3 font-[family-name:var(--font-body)]">
            <div className="font-medium mb-1">File requirements</div>
            <ul className="m-0 pl-[18px]">
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
      <span className="inline-flex text-inherit opacity-70">{Ico.chevDown(11)}</span>
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
  // Rows by default: skills are a catalogue you scan and manage. Phones get
  // rows too.
  const { view, setView, effectiveView } = useCollectionView('anton:skills-view', { defaultView: 'list' });
  // Skill awaiting the remove confirmation.
  const [removing, setRemoving]       = useState(null);
  const searchRef = useRef(null);

  // type: 'success' | 'error' (mapped to the shared Toast's 'danger').
  const showToast = (msg, type = 'error') => toastManager.add({ title: msg, type: type === 'error' ? 'danger' : type });

  useEffect(() => {
    fetchProjects().then(setProjects);
    reload();
  }, []);

  useEffect(() => {
    if (!selected || !Array.isArray(skills)) return;
    const fresh = skills.find((skill) => skill.label === selected.label);
    if (fresh) setSelected((current) => (current === fresh ? current : fresh));
  }, [skills]);

  /* The open skill always mirrors the shared catalogue. Mutation endpoints
     serialize a skill separately from the list, and a response that omits
     `capabilities` reads as a denial on hosted Cowork, so adopting one would
     lock the creator out of the skill they just saved. The effect above
     re-points `selected` at the reloaded entry; a save response only names
     the skill for the toast. */
  const onSkillSaved = (saved) => {
    showToast(`Saved ${saved?.label}.`, 'success');
  };

  const onSkillUploaded = async (saved) => {
    const refreshed = await reload({ afterCurrent: true });
    // An upload bypasses the store, so re-point the open skill from the list
    // this reload verified rather than from the upload response.
    const fresh = refreshed?.ok && Array.isArray(refreshed.skills)
      ? refreshed.skills.find((skill) => skill.label === saved?.label)
      : null;
    if (fresh) {
      setSelected((current) => (current?.label === fresh.label ? fresh : current));
    }
    onSkillSaved(saved);
  };

  const remove = (skill) => {
    if (canUseSharedResource(skill, 'canDelete')) setRemoving(skill);
  };

  // Runs after the dialog closes, so the page stays usable while it settles.
  const confirmRemove = async (skill) => {
    try {
      await deleteSkillAndSync(skill.label);
      setSelected((current) => (
        current?.label === skill.label ? null : current
      ));
      showToast(`Removed ${skill.label}.`, 'success');
    } catch (err) {
      showToast(err.message || 'Could not remove skill.');
    }
  };

  const startNew  = () => setModalSkill(undefined);
  const startEdit = (skill) => {
    if (canUseSharedResource(skill, 'canEdit')) setModalSkill(skill);
  };
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
    <div className="scroll-clean flex-1 overflow-y-auto pb-10">
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
                  disabled={!canUseSharedResource(selected, 'canDisable')}
                  title={!canUseSharedResource(selected, 'canDisable') ? 'You do not have permission to enable or disable this skill.' : undefined}
                  onCheckedChange={async (next) => {
                    if (!canUseSharedResource(selected, 'canDisable')) return;
                    const targetLabel = selected.label;
                    setSelected((current) => (
                      current?.label === targetLabel
                        ? { ...current, enabled: next }
                        : current
                    ));
                    try {
                      /* The reload inside the save re-points the open skill
                         through the effect above; adopting the response here
                         would trade the catalogue entry for a serializer that
                         need not carry capabilities. */
                      await saveSkillAndSync({ label: targetLabel, enabled: next }, true);
                    } catch (err) {
                      setSelected((current) => (
                        current?.label === targetLabel
                          ? { ...current, enabled: !next }
                          : current
                      ));
                      showToast(err.message || 'Could not update skill.');
                    }
                  }}
                />
                <OverflowMenu
                  items={[
                    { id: 'try',       label: 'Try in chat', icon: Ico.chats(14),  onClick: () => onTryInChat?.(`/${selected.label}`, selected.projects?.[0]) },
                    {
                      id: 'edit', label: 'Edit', icon: Ico.edit(14),
                      disabled: !canUseSharedResource(selected, 'canEdit'),
                      hint: !canUseSharedResource(selected, 'canEdit')
                        ? (selected.isBuiltin ? 'Built-in' : 'Admin or creator')
                        : undefined,
                      title: !canUseSharedResource(selected, 'canEdit') ? 'You do not have permission to edit this skill.' : undefined,
                      onClick: () => startEdit(selected),
                    },
                    { divider: true },
                    {
                      id: 'uninstall', label: 'Uninstall', icon: Ico.trash(14), danger: true,
                      disabled: !canUseSharedResource(selected, 'canDelete'),
                      hint: !canUseSharedResource(selected, 'canDelete')
                        ? (selected.isBuiltin ? 'Built-in' : 'Admin or creator')
                        : undefined,
                      title: !canUseSharedResource(selected, 'canDelete') ? 'You do not have permission to uninstall this skill.' : undefined,
                      onClick: () => remove(selected),
                    },
                  ]}
                />
              </>
            }
          />
          <div className="pt-6 px-8 pb-8">

          <SharedResourceAttribution
            resource={selected}
            className={canUseSharedResource(selected, 'canEdit') ? 'mb-4' : 'mb-2'}
          />
          {!canUseSharedResource(selected, 'canEdit') && (
            <p className="m-0 mb-4 text-[12px] text-ink-3" role="note">
              {selected.isBuiltin
                ? 'Built-in skills are read only.'
                : 'Read only — only the creator or an organization admin can change this skill.'}
            </p>
          )}

          {/* Scope */}
          <div className="mb-4">
            <h3 className="s-h3 mt-0 mb-1">Scope</h3>
            <p className="m-0 text-[13.5px] text-ink leading-[1.5] select-text">
              {projectLabelByName(projects, selected.projects?.[0]) || 'All projects'}
            </p>
          </div>

          {/* Description */}
          {selected.description && (
            <div className="mb-4">
              <h3 className="s-h3 mt-0 mb-1">Description</h3>
              <p className="m-0 text-[13.5px] text-ink leading-[1.5] select-text">
                {selected.description}
              </p>
            </div>
          )}

          {/* Content card */}
          <div className="rounded-[20px] border border-solid border-line p-6 flex flex-col gap-4 bg-surface select-text">
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
            view={<ViewToggle value={view} onValueChange={setView} />}
          />
          <CollectionState
            loading={skills === null}
            total={(skills ?? []).length}
            shown={sorted.length}
            query={search}
            onClear={() => setSearch('')}
            // Each skeleton takes its loaded layout's own wrapper classes.
            skeleton={effectiveView === 'grid' ? 'cards' : 'group'}
            skeletonClassName={effectiveView === 'grid' ? 'px-8 pb-[60px]' : LIST_CLASS}
            skeletonGridClassName="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4"
            empty={{
              icon: <span className="inline-flex text-ink-4">{Ico.cube(32)}</span>,
              title: 'No saved skills yet',
              style: { flex: 1 },
            }}
          >
            {effectiveView === 'list' ? (
              <ListGroup className={LIST_CLASS}>
                {sorted.map((skill) => (
                  <SkillRow key={skill.label} skill={skill} onClick={setSelected} projects={projects} />
                ))}
              </ListGroup>
            ) : (
              <div className="px-8 pb-[60px] grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
                {sorted.map((skill) => (
                  <SkillGridCard key={skill.label} skill={skill} onClick={setSelected} projects={projects} />
                ))}
              </div>
            )}
          </CollectionState>
        </>
      )}
      <UploadSkillModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onSaved={onSkillUploaded}
        onError={showToast}
      />
      <ConfirmModal
        open={!!removing}
        title={removing ? `Remove skill "${removing.label}"?` : ''}
        confirmLabel="Remove"
        destructive
        onClose={() => setRemoving(null)}
        onConfirm={() => { const skill = removing; setRemoving(null); if (skill) confirmRemove(skill); }}
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
