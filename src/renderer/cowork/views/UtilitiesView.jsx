import { useEffect, useState } from 'react';
import Ico from '../components/Icons';
import { PageHeader as CollectionPageHeader } from '../components/collection';
import { MarkdownContent } from '../components/markdown/MarkdownContent';
import {
  deleteDatasource,
  deleteMemory,
  deleteSkill,
  fetchDatasources,
  fetchMemory,
  fetchPublishable,
  fetchSkills,
  publishArtifact,
  saveDatasource,
  saveMemory,
  saveSkill,
  validateDatasource,
} from '../api';

const TITLES = {
  memory: ['Memory', 'Rules, lessons, identity notes, and saved episodes Anton can reuse.'],
  skills: ['Skill Library', 'Saved Anton skills and recall guidance.'],
  // 'connect' (legacy datasources page) is gone — Connect Apps and
  // Data is the canonical surface. Kept the import paths for
  // fetchDatasources / validateDatasource because they're still
  // used by other call sites (the agent etc.).
  publish: ['Publish', 'HTML artifacts Anton can publish with Minds credentials.'],
};

function PageHeader({ title, subtitle }) {
  return (
    <div className="page-header">
      <div style={{ flex: 1 }}>
        <h2 className="page-title">{title}</h2>
        {subtitle && <div style={{ fontSize: 13, color: 'var(--frost-600)', marginTop: 4 }}>{subtitle}</div>}
      </div>
    </div>
  );
}

function EmptyState({ children }) {
  return <div style={{ padding: 32, color: 'var(--frost-600)', fontSize: 13 }}>{children}</div>;
}

function credentialTemplate(engineDef) {
  return Object.fromEntries(activeCredentialFields(engineDef).map((field) => [field.name, field.default || '']));
}

function activeAuthMethod(engineDef, authMethod) {
  const methods = engineDef?.authMethods || [];
  if (!methods.length) return null;
  return methods.find((method) => method.name === authMethod) || methods[0];
}

function activeCredentialFields(engineDef, authMethod) {
  const method = activeAuthMethod(engineDef, authMethod);
  return method?.fields || engineDef?.fields || [];
}

function fieldLabel(name) {
  return String(name || '').replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isLongField(field) {
  return /json|private_key|certificate|token_secret|session_configuration/i.test(field.name || '');
}

function shouldUseTextarea(field) {
  return isLongField(field) && !field.secret;
}

export default function UtilitiesView({ kind, project, onRefreshArtifacts }) {
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(null);
  const [status, setStatus] = useState('');

  useEffect(() => {
    setData(null);
    setSelected(null);
    setStatus('');
    // Memory listing is universal: Global plus every project on disk,
    // grouped in the sidebar. We don't pass project?.path here so the
    // page shows the full picture regardless of which project is
    // active in the rail.
    if (kind === 'memory') fetchMemory().then(setData).catch((err) => setStatus(err.message));
    if (kind === 'skills') fetchSkills().then(setData).catch((err) => setStatus(err.message));
    if (kind === 'publish') fetchPublishable().then(setData).catch((err) => setStatus(err.message));
  }, [kind, project?.path]);

  const [title, subtitle] = TITLES[kind] || ['Anton utility', ''];

  // Memory kind owns its own scrolling: the sidebar list and the
  // viewer pane each scroll independently so flipping through a long
  // file doesn't push the file list around. The legacy kinds keep
  // the original "page scrolls" behaviour.
  const isMemoryKind = kind === 'memory';
  const wrapperStyle = isMemoryKind
    ? { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }
    : { flex: 1, overflowY: 'auto' };

  return (
    <div className="scroll-clean" style={wrapperStyle}>
      {/* MemoryView renders its own canonical header (with the
          + New memory action). For the legacy kinds we keep the
          plain header here. */}
      {!isMemoryKind && <PageHeader title={title} subtitle={subtitle} />}
      {status && <div style={{ margin: '16px 28px 0', color: '#8F321A', fontSize: 12.5 }}>{status}</div>}
      {!data ? <EmptyState>Loading…</EmptyState> : null}
      {data && kind === 'memory' && (
        <MemoryView
          data={data}
          selected={selected}
          onSelect={setSelected}
          project={project}
          setData={setData}
          setStatus={setStatus}
        />
      )}
      {data && kind === 'skills' && (
        <SkillsView
          data={data}
          selected={selected}
          onSelect={setSelected}
          onSaved={() => fetchSkills().then(setData)}
          onDeleted={(label) => setData((prev) => ({ ...prev, skills: (prev.skills || []).filter((s) => s.label !== label) }))}
          setStatus={setStatus}
        />
      )}
      {/* The legacy 'connect' kind has been retired in favour of the
          Connect Apps and Data page. ConnectView is no longer
          rendered from here. */}
      {data && kind === 'publish' && <PublishView data={data} setData={setData} setStatus={setStatus} onRefreshArtifacts={onRefreshArtifacts} />}
    </div>
  );
}

function MemoryView({ data, selected, onSelect, project, setData, setStatus }) {
  const sections = Array.isArray(data?.sections) ? data.sections : [];
  const projectSections = sections.filter((s) => s.scope === 'Project' && (s.files || []).length > 0);
  const globalSection = sections.find((s) => s.scope === 'Global');
  const totalFiles = sections.reduce((acc, s) => acc + (s.files?.length || 0), 0);

  const [editing, setEditing] = useState(null);
  // `projectName` / `projectPath` carry the project context for project-scoped
  // edits — needed because the universal listing means a memory's project
  // may not match the rail's currently active project.
  //
  // `kind` is the new-memory type picker: 'lessons' | 'rules' | 'topic'.
  // Lessons + Rules are well-known paths (`lessons.md`, `rules.md`) and
  // hydrate `draft.content` from the existing file if there's one in the
  // chosen scope. Topic is a free-form name → `topics/<slug>.md`; we
  // validate the resulting path isn't already taken before saving.
  const [draft, setDraft] = useState({
    scope: 'Global', relativePath: '', content: '',
    projectName: null, projectPath: null,
    kind: 'lessons', topicName: '',
  });

  const refresh = async () => {
    const latest = await fetchMemory();
    setData(latest);
  };

  const startNew = () => {
    setEditing('new');
    setDraft({
      scope: 'Global', relativePath: 'lessons.md', content: '',
      projectName: null, projectPath: null,
      kind: 'lessons', topicName: '',
    });
    onSelect(null);
  };

  // Files in scope for the new-memory form's hydration / availability
  // check. Returns the array of file payloads from `data.sections`
  // matching the current draft scope.
  const filesForCurrentScope = () => {
    if (draft.scope === 'Global') return globalSection?.files || [];
    if (draft.scope === 'Project' && draft.projectName) {
      const section = sections.find(
        (s) => s.scope === 'Project' && s.projectName === draft.projectName,
      );
      return section?.files || [];
    }
    return [];
  };

  // Slugify a topic name → safe `topics/<slug>.md` path. Lowercases,
  // collapses whitespace + non-alphanumerics to `-`, trims dashes.
  const topicSlug = (raw) => String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  const relativePathForKind = (kind, topicName) => {
    if (kind === 'lessons') return 'lessons.md';
    if (kind === 'rules')   return 'rules.md';
    const slug = topicSlug(topicName);
    return slug ? `topics/${slug}.md` : '';
  };

  // Pull existing content for a given relativePath in the current
  // scope, or '' when no file is there yet. Used to pre-populate the
  // body when the user picks Lessons / Rules so they edit instead of
  // accidentally overwriting.
  const existingContentForPath = (relPath) => {
    if (!relPath) return '';
    const file = filesForCurrentScope().find((f) => f.relativePath === relPath);
    return file?.content || file?.preview || '';
  };

  // When the user changes the kind (or the scope, which changes which
  // files we check against), recompute the implied path and hydrate
  // body content for lessons/rules. Topic mode keeps the user-typed
  // body in place — they'll only see content from a colliding file via
  // the inline error on the topic name field.
  const onKindChange = (nextKind) => {
    setDraft((prev) => {
      const relPath = relativePathForKind(nextKind, prev.topicName);
      const next = { ...prev, kind: nextKind, relativePath: relPath };
      if (nextKind === 'lessons' || nextKind === 'rules') {
        next.content = existingContentForPath(relPath);
      }
      return next;
    });
  };

  const onTopicNameChange = (value) => {
    setDraft((prev) => ({
      ...prev,
      topicName: value,
      relativePath: relativePathForKind('topic', value),
    }));
  };

  // Topic-mode duplicate check, surfaced inline so the Save button
  // can communicate the conflict before the user clicks. Computed
  // each render — cheap, since `filesForCurrentScope()` is small.
  const topicConflict = (() => {
    if (draft.kind !== 'topic') return null;
    const slug = topicSlug(draft.topicName);
    if (!slug) return null;
    const candidate = `topics/${slug}.md`;
    const exists = filesForCurrentScope().some((f) => f.relativePath === candidate);
    return exists ? candidate : null;
  })();

  const startEdit = (file) => {
    setEditing('edit');
    setDraft({
      scope: file.scope || 'Global',
      relativePath: file.relativePath,
      content: file.content || file.preview || '',
      projectName: file.projectName || null,
      projectPath: file.projectPath || null,
    });
    onSelect(file);
  };

  // Lookup table so the new-memory dropdown can offer "Project · <name>"
  // for any project on disk, not just the active one.
  const projectChoices = sections
    .filter((s) => s.scope === 'Project')
    .map((s) => ({ name: s.projectName, path: s.projectPath }));

  const onScopeChange = (value) => {
    // The hydration helper reads from the *new* scope, but we can't
    // call `existingContentForPath` mid-state-update because it
    // closes over the previous draft. Compute the next scope tuple
    // first, then re-derive content directly from `sections`.
    let nextScope = 'Global';
    let nextProjectName = null;
    let nextProjectPath = null;
    if (value !== 'Global') {
      const projectName = value.startsWith('Project::') ? value.slice('Project::'.length) : null;
      const match = projectChoices.find((p) => p.name === projectName);
      nextScope = 'Project';
      nextProjectName = match?.name || null;
      nextProjectPath = match?.path || null;
    }
    const filesNext = (() => {
      if (nextScope === 'Global') return globalSection?.files || [];
      const section = sections.find(
        (s) => s.scope === 'Project' && s.projectName === nextProjectName,
      );
      return section?.files || [];
    })();
    setDraft((prev) => {
      const next = {
        ...prev,
        scope: nextScope,
        projectName: nextProjectName,
        projectPath: nextProjectPath,
      };
      if (prev.kind === 'lessons' || prev.kind === 'rules') {
        const file = filesNext.find((f) => f.relativePath === prev.relativePath);
        next.content = file?.content || file?.preview || '';
      }
      return next;
    });
  };

  const save = async () => {
    // Topic mode: derive the path from the typed name and refuse to
    // overwrite an existing topic. Lessons/rules intentionally allow
    // overwriting — they're the canonical files Anton reads, so the
    // form pre-populates them and saving means "edit", not "create".
    if (editing === 'new' && draft.kind === 'topic') {
      const slug = topicSlug(draft.topicName);
      if (!slug) {
        setStatus('Enter a topic name.');
        return;
      }
      const candidate = `topics/${slug}.md`;
      const conflict = filesForCurrentScope().some((f) => f.relativePath === candidate);
      if (conflict) {
        setStatus(`A memory at ${candidate} already exists. Choose a different topic name.`);
        return;
      }
    }
    if (!draft.relativePath.trim()) {
      setStatus('Choose a Markdown path for this memory file.');
      return;
    }
    if (draft.scope === 'Project' && !draft.projectPath) {
      setStatus('Pick a project for this memory file.');
      return;
    }
    try {
      await saveMemory({
        scope: draft.scope,
        relativePath: draft.relativePath,
        content: draft.content,
        projectPath: draft.scope === 'Project' ? draft.projectPath : null,
      });
      setStatus(`Saved memory file ${draft.relativePath}.`);
      setEditing(null);
      await refresh();
    } catch (err) {
      setStatus(err.message || 'Could not save memory file.');
    }
  };

  const remove = async (file) => {
    if (!window.confirm(`Delete memory file "${file.relativePath}"? A backup will be kept.`)) return;
    try {
      await deleteMemory({
        scope: file.scope || 'Global',
        relativePath: file.relativePath,
        projectPath: file.scope === 'Project' ? file.projectPath : null,
      });
      setStatus(`Deleted memory file ${file.relativePath}.`);
      onSelect(null);
      await refresh();
    } catch (err) {
      setStatus(err.message || 'Could not delete memory file.');
    }
  };

  const scopeValue = draft.scope === 'Project'
    ? `Project::${draft.projectName || ''}`
    : 'Global';

  return (
    <>
      <CollectionPageHeader
        title="Memory"
        subtitle="Rules, lessons, identity notes, and saved episodes Anton can reuse."
        actions={
          <button type="button" className="btn-primary" onClick={startNew}>
            {Ico.plus(14)} New memory
          </button>
        }
      />
      <div style={{ height: 14 }} />
      {/* Grid fills the rest of the viewport. Both columns get their
          own `overflowY: auto` so the file list and the viewer pane
          scroll independently — picking through a long memory file
          no longer drags the sidebar with it. */}
      <div style={{
        flex: 1, minHeight: 0,
        display: 'grid', gridTemplateColumns: '300px 1fr',
        padding: '0 32px 24px', gap: 24,
      }}>
        <div className="scroll-clean" style={{
          borderRight: '1px solid var(--border-0)',
          paddingRight: 12,
          display: 'flex', flexDirection: 'column', gap: 14,
          overflowY: 'auto', minHeight: 0,
        }}>
          {/* Skip the Global section entirely when it has no entries
              — the empty placeholder reads as broken-list noise. The
              "+ New memory" form keeps Global as a scope option, so
              the user can still create one from scratch. */}
          {(globalSection?.files?.length || 0) > 0 && (
            <MemorySectionList
              heading="Global"
              files={globalSection?.files || []}
              selected={selected}
              onSelect={onSelect}
            />
          )}
          {projectSections.map((section) => (
            <MemorySectionList
              key={section.projectName}
              heading={`Project · ${section.projectName}`}
              files={section.files}
              selected={selected}
              onSelect={onSelect}
              isActive={section.projectName === project?.name}
            />
          ))}
          {totalFiles === 0 && <EmptyState>No Anton memory files found.</EmptyState>}
        </div>
        <div className="scroll-clean" style={{
          overflowY: 'auto', minHeight: 0,
        }}>
          {editing === 'new' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* Row 1: Scope (Global / Project) + Type
                  (Lessons / Rules / Topic). Both <select>s use the
                  chevron-aware `selectStyle`. */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <select
                  value={scopeValue}
                  onChange={(e) => onScopeChange(e.target.value)}
                  style={selectStyle}
                >
                  <option value="Global">Global</option>
                  {projectChoices.map((p) => (
                    <option key={p.name} value={`Project::${p.name}`}>Project · {p.name}</option>
                  ))}
                </select>
                <select
                  value={draft.kind}
                  onChange={(e) => onKindChange(e.target.value)}
                  style={selectStyle}
                >
                  <option value="lessons">Lessons</option>
                  <option value="rules">Rules</option>
                  <option value="topic">Topic</option>
                </select>
              </div>

              {/* Row 2: file/topic identification.
                  - Lessons/Rules show the resolved path read-only —
                    the user can see what they're editing without
                    being able to type something else by accident.
                    A small note flags whether the file already
                    exists (so saving is "edit", not "create").
                  - Topic shows a name input → `topics/<slug>.md`
                    underneath, and an inline conflict message when
                    the slug collides with an existing file. */}
              {draft.kind === 'topic' ? (
                <div>
                  <input
                    value={draft.topicName}
                    onChange={(e) => onTopicNameChange(e.target.value)}
                    placeholder="customer-notes"
                    style={inputStyle}
                  />
                  <div style={{
                    marginTop: 4, fontSize: 11.5,
                    color: topicConflict ? 'var(--danger)' : 'var(--frost-600)',
                  }}>
                    {topicConflict
                      ? `A memory at ${topicConflict} already exists — pick a different name.`
                      : (draft.relativePath
                          ? `Will save as ${draft.relativePath}`
                          : 'Type a topic name (no extension needed).')
                    }
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{
                    ...inputStyle,
                    display: 'flex', alignItems: 'center',
                    background: 'var(--surface-2)',
                    color: 'var(--ink-3)', cursor: 'default',
                    userSelect: 'text',
                  }}>{draft.relativePath}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--frost-600)' }}>
                    {existingContentForPath(draft.relativePath)
                      ? `Editing existing ${draft.relativePath}.`
                      : `${draft.relativePath} doesn't exist yet — saving creates it.`}
                  </div>
                </div>
              )}

              <textarea
                value={draft.content}
                onChange={(e) => setDraft((prev) => ({ ...prev, content: e.target.value }))}
                style={memoryEditorStyle}
              />
              <div className="dialog-actions">
                <button className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
                <button className="btn-primary" onClick={save} disabled={!!topicConflict}>Save memory</button>
              </div>
            </div>
          ) : editing === 'edit' && selected ? (
            // Edit mode mirrors the viewer's header tile so swapping
            // between read and edit doesn't shift the layout — only
            // the actions on the right and the body change.
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 650, color: 'var(--text-strong)' }}>{selected.relativePath}</div>
                  <div style={{ fontSize: 12, color: 'var(--frost-600)' }}>
                    {selected.scope === 'Project' && selected.projectName
                      ? `Project · ${selected.projectName}`
                      : selected.scope}
                  </div>
                </div>
                <button className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
                <button className="btn-primary" onClick={save}>Save</button>
              </div>
              <textarea
                value={draft.content}
                onChange={(e) => setDraft((prev) => ({ ...prev, content: e.target.value }))}
                style={memoryEditorStyle}
              />
            </>
          ) : selected ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 650, color: 'var(--text-strong)' }}>{selected.relativePath}</div>
                  <div style={{ fontSize: 12, color: 'var(--frost-600)' }}>
                    {selected.scope === 'Project' && selected.projectName
                      ? `Project · ${selected.projectName}`
                      : selected.scope}
                  </div>
                </div>
                <button className="btn-secondary" onClick={() => startEdit(selected)}>Edit</button>
                <button className="btn-secondary" onClick={() => remove(selected)}>Delete</button>
              </div>
              {/* Memory files are always `.md` — render via the same
                  MarkdownContent the chat column uses so headings,
                  lists, code, tables, and links look the way they do
                  everywhere else in the app. */}
              <div style={memoryViewerStyle}>
                <MarkdownContent
                  text={selected.content || selected.preview || ''}
                  id={`mem-${selected.path || selected.relativePath || 'doc'}`}
                  complete
                  dense
                />
              </div>
            </>
          ) : (
            <EmptyState>Select a memory file to inspect it.</EmptyState>
          )}
        </div>
      </div>
    </>
  );
}

function MemorySectionList({ heading, files, selected, onSelect, isActive }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '0.14em',
        textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 600,
        padding: '0 4px 4px', display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <span>{heading}</span>
        {isActive && <span style={{ color: 'var(--accent)', letterSpacing: 0, textTransform: 'none', fontFamily: 'var(--font-body)', fontSize: 10.5 }}>· active</span>}
        <span style={{ marginLeft: 'auto', color: 'var(--ink-4)', letterSpacing: 0, textTransform: 'none', fontFamily: 'var(--font-body)' }}>{files.length}</span>
      </div>
      {files.length === 0 ? (
        <div style={{ padding: '2px 6px 2px', color: 'var(--ink-4)', fontSize: 12 }}>—</div>
      ) : files.map((file) => (
        <button
          key={file.path}
          className={`recent-item${selected?.path === file.path ? ' active' : ''}`}
          onClick={() => onSelect(file)}
          style={{ height: 'auto', minHeight: 26, padding: '4px 10px', fontSize: 12.5 }}
        >
          <span style={{ color: 'var(--primary-700)', display: 'inline-flex' }}>{Ico.doc(13)}</span>
          <span style={{ flex: 1, whiteSpace: 'normal' }}>{file.relativePath}</span>
        </button>
      ))}
    </div>
  );
}

function SkillsView({ data, selected, onSelect, onSaved, onDeleted, setStatus }) {
  const skills = data.skills || [];
  const emptyDraft = { label: '', name: '', description: '', whenToUse: '', declarative: '' };
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState(emptyDraft);

  const remove = async (skill) => {
    if (!window.confirm(`Remove skill "${skill.name}"?`)) return;
    try {
      await deleteSkill(skill.label);
      onDeleted(skill.label);
      onSelect(null);
      setStatus(`Removed ${skill.name}.`);
    } catch (err) {
      setStatus(err.message || 'Could not remove skill.');
    }
  };

  const startNew = () => {
    setEditing('new');
    setDraft(emptyDraft);
    onSelect(null);
  };

  const startEdit = (skill) => {
    setEditing('edit');
    setDraft({
      label: skill.label || '',
      name: skill.name || '',
      description: skill.description || '',
      whenToUse: skill.whenToUse || '',
      declarative: skill.declarative || '',
    });
    onSelect(skill);
  };

  const save = async () => {
    try {
      await saveSkill(draft);
      setStatus(`Saved skill ${draft.name || draft.label}.`);
      setEditing(null);
      await onSaved?.();
    } catch (err) {
      setStatus(err.message || 'Could not save skill.');
    }
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', minHeight: 0 }}>
      <div style={{ padding: 20, borderRight: '1px solid var(--border-0)', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <button className="btn-primary" onClick={startNew} style={{ marginBottom: 8 }}>{Ico.plus(14)} New skill</button>
        {skills.map((skill) => (
          <button key={skill.label} className={`recent-item${selected?.label === skill.label ? ' active' : ''}`} onClick={() => onSelect(skill)} style={{ height: 'auto', minHeight: 38, padding: '8px 10px' }}>
            <span style={{ color: 'var(--primary-700)', display: 'inline-flex' }}>{Ico.brain(14)}</span>
            <span style={{ flex: 1, whiteSpace: 'normal' }}>{skill.name}</span>
          </button>
        ))}
        {!skills.length && <EmptyState>No saved Anton skills found.</EmptyState>}
      </div>
      <div style={{ padding: 24 }}>
        {editing ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 8 }}>
              <input value={draft.label} onChange={(e) => setDraft((prev) => ({ ...prev, label: e.target.value }))} placeholder="skill_label" style={inputStyle} disabled={editing === 'edit'} />
              <input value={draft.name} onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))} placeholder="Skill name" style={inputStyle} />
            </div>
            <input value={draft.description} onChange={(e) => setDraft((prev) => ({ ...prev, description: e.target.value }))} placeholder="Short description" style={inputStyle} />
            <input value={draft.whenToUse} onChange={(e) => setDraft((prev) => ({ ...prev, whenToUse: e.target.value }))} placeholder="When Anton should use this skill" style={inputStyle} />
            <textarea value={draft.declarative} onChange={(e) => setDraft((prev) => ({ ...prev, declarative: e.target.value }))} rows={16} placeholder="Skill instructions..." style={{ ...inputStyle, height: 'auto', padding: 10, fontFamily: 'var(--font-mono)', userSelect: 'text' }} />
            <div className="dialog-actions">
              <button className="secondary-btn" onClick={() => setEditing(null)}>Cancel</button>
              <button className="primary-btn" disabled={!draft.label.trim() || !draft.name.trim() || !draft.declarative.trim()} onClick={save}>Save skill</button>
            </div>
          </div>
        ) : selected ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 650, color: 'var(--text-strong)' }}>{selected.name}</div>
                <div style={{ fontSize: 12, color: 'var(--frost-600)' }}>{selected.label}</div>
              </div>
              <button className="btn-secondary" onClick={() => startEdit(selected)}>Edit</button>
              <button className="btn-secondary" onClick={() => remove(selected)}>Remove</button>
            </div>
            {selected.description && <p style={{ margin: '0 0 12px', fontSize: 13.5, color: 'var(--frost-700)' }}>{selected.description}</p>}
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', userSelect: 'text', fontFamily: 'var(--font-mono)', fontSize: 12.5, lineHeight: 1.55 }}>{selected.declarative}</pre>
          </>
        ) : (
          <EmptyState>Select a skill to inspect it.</EmptyState>
        )}
      </div>
    </div>
  );
}

function ConnectView({ data, setData, setStatus }) {
  const firstEngine = data.engines?.[0]?.engine || '';
  const initialEngine = (data.engines || []).find((item) => item.engine === firstEngine);
  const [engine, setEngine] = useState(firstEngine);
  const [authMethod, setAuthMethod] = useState(activeAuthMethod(initialEngine)?.name || '');
  const [name, setName] = useState('');
  const [credentialValues, setCredentialValues] = useState(credentialTemplate(initialEngine));
  const [validation, setValidation] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyAction, setBusyAction] = useState('');

  const engineDef = (data.engines || []).find((item) => item.engine === engine);
  const fields = activeCredentialFields(engineDef, authMethod);
  const selectedAuth = activeAuthMethod(engineDef, authMethod);

  const setEngineAndTemplate = (value) => {
    setEngine(value);
    const selected = (data.engines || []).find((item) => item.engine === value);
    const nextAuth = activeAuthMethod(selected)?.name || '';
    setAuthMethod(nextAuth);
    setCredentialValues(credentialTemplate(selected));
    setValidation('');
    setStatus('');
  };

  const setAuthAndTemplate = (value) => {
    setAuthMethod(value);
    const method = activeAuthMethod(engineDef, value);
    setCredentialValues(Object.fromEntries((method?.fields || []).map((field) => [field.name, field.default || ''])));
    setValidation('');
    setStatus('');
  };

  const credentialsForSubmit = () => {
    const known = Object.fromEntries(fields.map((field) => [field.name, credentialValues[field.name] ?? '']));
    return known;
  };

  const updateCredential = (field, value) => {
    setCredentialValues((prev) => ({ ...prev, [field.name]: value }));
    setValidation('');
  };

  const validate = async () => {
    const credentials = credentialsForSubmit();
    try {
      setBusy(true);
      setBusyAction('check');
      const result = await validateDatasource({ engine, name, authMethod: authMethod || null, credentials });
      setValidation(result.message || 'Credential shape checked.');
      if (result.missingFields?.length) {
        setStatus(`Missing required fields: ${result.missingFields.join(', ')}`);
      } else {
        setStatus('Required fields are present. Save this connection to make it available to Anton tasks.');
      }
    } catch (err) {
      setValidation('');
      setStatus(err.message || 'Could not validate datasource credentials.');
    } finally {
      setBusy(false);
      setBusyAction('');
    }
  };

  const save = async (e) => {
    e.preventDefault();
    setStatus('');
    const credentials = credentialsForSubmit();
    try {
      setBusy(true);
      setBusyAction('save');
      await validateDatasource({ engine, name, authMethod: authMethod || null, credentials });
      const saved = await saveDatasource({ engine, name, authMethod: authMethod || null, credentials });
      const latest = await fetchDatasources();
      setData(latest);
      setStatus(`Saved ${saved.slug || `${engine}-${saved.name || name}`} to Anton's data vault.`);
      if (!name.trim() && saved.name) setName(saved.name);
    } catch (err) {
      setStatus(err.message || 'Could not save datasource connection.');
    } finally {
      setBusy(false);
      setBusyAction('');
    }
  };

  const remove = async (conn) => {
    if (!window.confirm(`Remove datasource "${conn.engine}/${conn.name}"?`)) return;
    try {
      await deleteDatasource(conn.engine, conn.name);
      const latest = await fetchDatasources();
      setData(latest);
      setStatus(`Removed ${conn.engine}/${conn.name}.`);
    } catch (err) {
      setStatus(err.message || 'Could not remove datasource connection.');
    }
  };

  return (
    <div style={{ padding: 28, display: 'grid', gridTemplateColumns: '1fr 360px', gap: 24 }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 650, color: 'var(--text-strong)', marginBottom: 10 }}>Saved connections</div>
        {(data.connections || []).length ? (data.connections || []).map((conn) => (
          <div key={`${conn.engine}-${conn.name}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border-0)', fontSize: 13 }}>
            <div style={{ flex: 1 }}>
              <strong style={{ color: 'var(--text-strong)' }}>{conn.displayName || conn.engine}</strong> / {conn.name}
              <div style={{ fontSize: 11.5, color: 'var(--frost-600)' }}>{conn.testAvailable ? 'Ready for Anton datasource tools' : 'Saved in Anton data vault'}</div>
            </div>
            <button className="btn-secondary" onClick={() => remove(conn)}>Remove</button>
          </div>
        )) : <EmptyState>No data vault connections found.</EmptyState>}
      </div>
      <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <select value={engine} onChange={(e) => setEngineAndTemplate(e.target.value)} style={inputStyle}>
          {(data.engines || []).map((item) => <option key={item.engine} value={item.engine}>{item.displayName}</option>)}
        </select>
        {(engineDef?.authMethods || []).length > 0 && (
          <select value={selectedAuth?.name || ''} onChange={(e) => setAuthAndTemplate(e.target.value)} style={inputStyle}>
            {(engineDef.authMethods || []).map((method) => <option key={method.name} value={method.name}>{method.display}</option>)}
          </select>
        )}
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="connection name (optional)" style={inputStyle} />
        {fields.length > 0 && (
          <div style={{ fontSize: 11.5, color: 'var(--frost-600)' }}>
            Required: {fields.filter((field) => field.required).map((field) => field.name).join(', ') || 'none'}
          </div>
        )}
        {fields.length ? fields.map((field) => (
          <label key={field.name} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-strong)' }}>
              {fieldLabel(field.name)}{field.required ? ' *' : ''}
            </span>
            {shouldUseTextarea(field) ? (
              <textarea
                value={credentialValues[field.name] ?? ''}
                onChange={(event) => updateCredential(field, event.target.value)}
                rows={4}
                placeholder={field.description || field.default || ''}
                spellCheck={false}
                style={{ ...inputStyle, height: 'auto', padding: 10, fontFamily: 'var(--font-mono)', userSelect: 'text' }}
              />
            ) : (
              <input
                value={credentialValues[field.name] ?? ''}
                onChange={(event) => updateCredential(field, event.target.value)}
                type={field.secret ? 'password' : 'text'}
                placeholder={field.description || field.default || ''}
                style={inputStyle}
              />
            )}
            {field.description && <small style={{ fontSize: 11.5, color: 'var(--frost-600)' }}>{field.description}</small>}
          </label>
        )) : (
          <div style={{ padding: 12, border: '1px solid var(--border-01)', borderRadius: 8, color: 'var(--frost-600)', fontSize: 12.5 }}>
            This engine does not expose editable credential fields in the installed Anton registry.
          </div>
        )}
        {validation && <div style={{ fontSize: 12, color: 'var(--frost-700)' }}>{validation}</div>}
        <button type="button" className="btn-secondary" disabled={!engine.trim() || busy} onClick={validate}>
          {busyAction === 'check' ? 'Checking' : 'Check fields'}
        </button>
        <button className="btn-primary" disabled={!engine.trim() || busy}>
          {busyAction === 'save' ? 'Saving' : 'Save connection'}
        </button>
      </form>
    </div>
  );
}

function PublishView({ data, setData, setStatus, onRefreshArtifacts }) {
  const publish = async (artifact) => {
    try {
      setStatus('Publishing…');
      const result = await publishArtifact(artifact.path);
      setStatus(result.url ? `Published: ${result.url}` : 'Published.');
      const latest = await fetchPublishable();
      setData(latest);
      onRefreshArtifacts?.();
    } catch (err) {
      setStatus(err.message || 'Publishing failed.');
    }
  };

  return (
    <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {!data.publishReady && (
        <div style={{ padding: 12, border: '1px solid #F0C2B5', borderRadius: 9, background: '#FFF7F4', color: '#8F321A', fontSize: 13 }}>
          Configure a Minds API key in Settings before publishing.
        </div>
      )}
      {(data.artifacts || []).length ? (data.artifacts || []).map((artifact) => (
        <div key={artifact.path} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, border: '1px solid var(--border-01)', borderRadius: 9 }}>
          <span style={{ color: 'var(--primary-700)', display: 'inline-flex' }}>{Ico.upload(15)}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 650, color: 'var(--text-strong)' }}>{artifact.title}</div>
            <div style={{ fontSize: 11.5, color: 'var(--frost-600)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{artifact.path}</div>
            {artifact.publishedUrl && <div style={{ fontSize: 12, color: 'var(--sage-700)', marginTop: 4, userSelect: 'text' }}>{artifact.publishedUrl}</div>}
          </div>
          {artifact.publishedUrl && <button className="btn-secondary" onClick={() => navigator.clipboard?.writeText(artifact.publishedUrl)}>Copy URL</button>}
          {artifact.publishedUrl && <button className="btn-secondary" onClick={() => window.open(artifact.publishedUrl, '_blank', 'noopener,noreferrer')}>Open</button>}
          <button className="btn-secondary" disabled={!data.publishReady} onClick={() => publish(artifact)}>Publish</button>
        </div>
      )) : <EmptyState>No HTML artifacts found in Anton output folders.</EmptyState>}
      {(data.history || []).length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontSize: 13, fontWeight: 650, color: 'var(--text-strong)', marginBottom: 8 }}>Publish history</div>
          {(data.history || []).slice(0, 10).map((item) => (
            <div key={`${item.artifact}-${item.publishedAt}`} style={{ padding: '8px 0', borderTop: '1px solid var(--border-0)', fontSize: 12.5 }}>
              <strong>{item.artifactName}</strong>
              {item.url && <span style={{ marginLeft: 8, color: 'var(--sage-700)', userSelect: 'text' }}>{item.url}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

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

// Native <select> paints its own chevron in the right padding area;
// the chevron looked flush with the right border at `padding: 10px`.
// Bumping right padding gives the indicator some air.
const selectStyle = { ...inputStyle, paddingRight: 28 };

// Editor and viewer share the same fixed min-height + typography so
// flipping between read and edit doesn't shift the layout. `--ink`
// keeps the text readable in both light and dark themes (the bug
// before this change was relying on the browser default text color,
// which rendered black-on-dark in dark mode).
const memoryEditorStyle = {
  width: '100%',
  minHeight: 520,
  border: '1px solid var(--border-01)',
  borderRadius: 7,
  padding: 12,
  fontFamily: 'var(--font-mono)',
  fontSize: 12.5,
  lineHeight: 1.55,
  outline: 'none',
  background: 'var(--surface-0)',
  color: 'var(--ink)',
  resize: 'vertical',
  userSelect: 'text',
};

// Container for the MarkdownContent renderer in view mode. Keeps the
// minHeight matched to the editor textarea so flipping between read
// and edit doesn't shift the layout. Body styling (font, line-height,
// colours) is left to MarkdownContent itself so headings, lists, and
// code fences render with the same chat-column rhythm.
const memoryViewerStyle = {
  minHeight: 520,
  padding: '12px 14px',
  border: '1px solid var(--border-01)',
  borderRadius: 7,
  background: 'var(--surface-0)',
  userSelect: 'text',
  overflowY: 'auto',
};
