// Projects view — two modes:
//   Grid:   no project under view → list of all projects as cards.
//   Detail: a project is selected → composer for new task in that
//           project, list of all tasks/conversations under it (newest
//           first), and a right sidebar with Working folder + Context
//           + Scheduled (filtered to this project).
//
// Local detailProject state is seeded from `selectedProject` so the
// chat-header crumb (which sets selectedProject + routes here) lands
// directly in the detail view. The "← All projects" button clears the
// local state to surface the grid again — without disturbing the app's
// selectedProject (which the home composer reads independently).

import { useEffect, useState } from 'react';
import Ico from '../components/Icons';
import Composer from '../components/Composer';
import { WorkingFolderBox, ContextBox, ScheduledBox } from '../components/rail';
import { TaskList } from '../components/task';
import { ProjectCard } from '../components/project';

function PageHeader({ title, subtitle, action }) {
  return (
    <div className="page-header">
      <div style={{ flex: 1, minWidth: 0 }}>
        <h2 className="page-title">{title}</h2>
        {subtitle && <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 4 }}>{subtitle}</div>}
      </div>
      {action}
    </div>
  );
}

function relativeAge(iso) {
  if (!iso) return '';
  const d = typeof iso === 'string' ? new Date(iso) : new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const secs = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  if (secs < 604800) return `${Math.floor(secs / 86400)}d ago`;
  return `${Math.floor(secs / 604800)}w ago`;
}

function timestampOf(task) {
  // Best-effort sortable timestamp. The /conversations payload exposes
  // updated_at / created_at as ISO strings; older shapes use subtitle
  // ('5m ago') which we can't sort numerically — fall back to 0 so
  // those land at the end.
  const raw = task.updatedAt || task.updated_at || task.createdAt || task.created_at;
  if (!raw) return 0;
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? t : 0;
}

function ProjectGrid({ projects, selectedProject, tasks = [], scheduled = [], onOpenProject, onCreateProject, onDeleteProject }) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true); setError('');
    try {
      await onCreateProject?.({ name: name.trim() });
      setCreating(false); setName('');
    } catch (err) {
      setError(err?.message || 'Could not create project');
    } finally { setBusy(false); }
  };

  return (
    <div className="scroll-clean" style={{ flex: 1, overflowY: 'auto' }}>
      <PageHeader
        title="Projects"
        subtitle="Workspaces Anton uses to group conversations, memory, and outputs."
        action={
          <button className="btn-primary" onClick={() => setCreating(true)}>
            {Ico.plus(14)} New project
          </button>
        }
      />
      {creating && (
        <form onSubmit={submit} style={{
          margin: '20px 28px 0', padding: 16,
          border: '1px solid var(--line)', borderRadius: 10,
          background: 'var(--surface)',
          display: 'grid', gridTemplateColumns: '1fr auto auto',
          gap: 10, alignItems: 'center',
        }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Project name"
            autoFocus
            style={{ height: 34, border: '1px solid var(--line)', borderRadius: 7, padding: '0 10px', fontSize: 13 }}
          />
          <button className="btn-primary" disabled={busy}>{busy ? 'Creating' : 'Create'}</button>
          <button type="button" className="icon-btn" onClick={() => { setCreating(false); setError(''); }} title="Cancel">{Ico.chevLeft(14)}</button>
          {error && (
            <div style={{ gridColumn: '1 / -1', fontSize: 12, color: 'var(--danger)' }}>{error}</div>
          )}
        </form>
      )}
      <div style={{
        padding: 28,
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
        gap: 14,
      }}>
        {projects.map((p) => (
          <ProjectCard
            key={p.name}
            project={p}
            isSelected={selectedProject?.name === p.name}
            tasks={tasks}
            scheduled={scheduled}
            onOpen={onOpenProject}
            onDelete={onDeleteProject}
          />
        ))}
      </div>
    </div>
  );
}

// TaskCard / turnsCount lived here previously; both now live in
// components/task/ as the shared TaskCard + TaskList.

// MiniCard + ScheduledMini lived here previously. They've been
// replaced by the shared rail boxes (WorkingFolderBox, ContextBox,
// ScheduledBox) in components/rail/.

function ProjectDetail({
  project, projects, tasks, scheduled, models, onSend, onSelectTask,
  onDeleteTask, onShowAll, onCreateProject,
}) {
  const projectTasks = (tasks || [])
    .filter((t) => t.projectName === project.name || t.projectPath === project.path)
    .sort((a, b) => timestampOf(b) - timestampOf(a));
  const projectSchedules = (scheduled || [])
    .filter((s) => (s.project || s.projectName) === project.name);

  // Rail collapse mirror of ChatView's behavior — same in-rail
  // collapse button + floating expand button on the conv col.
  const [railOpen, setRailOpen] = useState(true);

  return (
    <div style={{
      flex: 1, minHeight: 0,
      display: 'grid',
      // Same minmax(0, 1fr) trick ChatView uses to prevent grid track
      // expansion when long unbreakable content lands in the conv col.
      gridTemplateColumns: railOpen ? 'minmax(0, 1fr) 320px' : 'minmax(0, 1fr) 0px',
      gridTemplateRows: '1fr',
      transition: 'grid-template-columns 220ms cubic-bezier(.2,.7,.3,1)',
      background: 'transparent',
      fontFamily: 'var(--font-body)',
      color: 'var(--ink-2)',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* ─── Conversation column ─── */}
      <div style={{
        position: 'relative', overflow: 'hidden',
        display: 'grid',
        gridTemplateRows: 'auto 1fr',
        minWidth: 0, minHeight: 0,
      }}>
        {/* Floating expand-rail button (mirrors ChatView). */}
        <button
          type="button"
          onClick={() => setRailOpen(true)}
          title="Expand panel"
          aria-label="Expand panel"
          style={{
            position: 'absolute', top: 14, right: 14, zIndex: 10,
            width: 28, height: 28, borderRadius: 6,
            display: 'inline-grid', placeItems: 'center',
            cursor: 'pointer', background: 'transparent', border: 0,
            color: 'var(--ink-3)',
            opacity: railOpen ? 0 : 1,
            transform: railOpen ? 'translateX(8px)' : 'translateX(0)',
            pointerEvents: railOpen ? 'none' : 'auto',
            transition:
              `opacity 280ms cubic-bezier(0.32,0.72,0,1) ${railOpen ? '0ms' : '120ms'}, ` +
              `transform 360ms cubic-bezier(0.32,0.72,0,1) ${railOpen ? '0ms' : '80ms'}`,
            WebkitAppRegion: 'no-drag',
          }}
          onMouseOver={(e) => { e.currentTarget.style.color = 'var(--ink)'; e.currentTarget.style.background = 'var(--surface-2)'; }}
          onMouseOut={(e) => { e.currentTarget.style.color = 'var(--ink-3)'; e.currentTarget.style.background = 'transparent'; }}
        >
          {Ico.panelExpandLeft(15)}
        </button>

        {/* Header — Projects › [project] crumb. Same layout/styling
            as ChatView so the project view reads as a sibling. */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 28px',
          borderBottom: '1px solid var(--line)',
          background: 'transparent',
          flexShrink: 0,
          minWidth: 0, overflow: 'hidden',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            minWidth: 0, flex: '1 1 0',
            overflow: 'hidden',
          }}>
            <Crumb
              label="Projects"
              onClick={onShowAll}
              title="All projects"
            />
            <CrumbSep />
            <span title={project.name} style={{
              fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 14,
              letterSpacing: '0.04em', color: 'var(--ink)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              minWidth: 0, flex: '1 1 0',
            }}>{project.name}</span>
          </div>
        </div>

        {/* Scrollable body — composer pinned at top, task list below */}
        <div data-scroll="true" style={{
          minHeight: 0, overflowY: 'auto', overflowX: 'hidden',
          padding: '32px 28px 60px',
          background: 'transparent',
          WebkitAppRegion: 'no-drag',
        }}>
          <div style={{
            maxWidth: 720, margin: '0 auto',
            display: 'flex', flexDirection: 'column', gap: 28,
          }}>
            <Composer
              onSend={onSend}
              project={project}
              onProjectChange={() => {}}
              model={null}
              onModelChange={() => {}}
              projects={projects || []}
              models={models || []}
              attachments={[]}
              connectors={[]}
              onAttachFiles={() => {}}
              onAttachConnector={() => {}}
              onRemoveAttachment={() => {}}
              hideModel
              metaReadOnly
              placeholder={`Start a new task in ${project.name}…`}
            />

            <TaskList
              tasks={projectTasks}
              projects={projects || []}
              emptyMessage={`No tasks in this project yet — type a prompt above to start one.`}
              onSelectTask={onSelectTask}
              onDeleteTask={onDeleteTask}
            />
          </div>
        </div>
      </div>

      {/* ─── Right rail — same shape as ChatView, no Progress card ─── */}
      <aside style={{
        background: 'transparent',
        padding: '14px 14px 22px',
        visibility: railOpen ? 'visible' : 'hidden',
        opacity: railOpen ? 1 : 0,
        transition: 'opacity 180ms ease',
        display: 'flex', flexDirection: 'column', gap: 10,
        overflowX: 'hidden', overflowY: 'auto',
        minWidth: 0,
        WebkitAppRegion: 'no-drag',
      }}>
        {/* Rail header — collapse-to-right button at top-right */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
          flexShrink: 0,
        }}>
          <button
            type="button"
            onClick={() => setRailOpen(false)}
            title="Collapse panel"
            aria-label="Collapse panel"
            style={{
              cursor: 'pointer', background: 'transparent', border: 0,
              width: 26, height: 26, borderRadius: 6,
              display: 'inline-grid', placeItems: 'center',
              color: 'var(--ink-3)',
              WebkitAppRegion: 'no-drag',
            }}
            onMouseOver={(e) => { e.currentTarget.style.color = 'var(--ink)'; e.currentTarget.style.background = 'var(--surface-2)'; }}
            onMouseOut={(e) => { e.currentTarget.style.color = 'var(--ink-3)'; e.currentTarget.style.background = 'transparent'; }}
          >
            {Ico.panelCollapseRight(15)}
          </button>
        </div>
        <WorkingFolderBox project={project} />
        <ContextBox project={project} />
        <ScheduledBox items={projectSchedules} />
      </aside>
    </div>
  );
}

// ── Header crumb helpers (mirror ChatView's CrumbButton/CrumbSep) ──
function Crumb({ label, onClick, title, maxWidth }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        cursor: 'pointer', background: 'transparent', border: 0,
        outline: 0, font: 'inherit',
        fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 13,
        letterSpacing: '0.04em', color: 'var(--ink-3)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        maxWidth, flexShrink: 1,
        padding: '2px 6px', borderRadius: 5,
        transition: 'color 120ms ease, background 120ms ease',
        WebkitAppRegion: 'no-drag',
      }}
      onMouseOver={(e) => { e.currentTarget.style.color = 'var(--ink)'; e.currentTarget.style.background = 'var(--surface-2)'; }}
      onMouseOut={(e) => { e.currentTarget.style.color = 'var(--ink-3)'; e.currentTarget.style.background = 'transparent'; }}
    >
      {label}
    </button>
  );
}

function CrumbSep() {
  return (
    <span aria-hidden="true" style={{
      color: 'var(--ink-4)', fontFamily: 'var(--font-display)',
      fontSize: 14, lineHeight: 1, padding: '0 2px', flexShrink: 0,
      userSelect: 'none',
    }}>›</span>
  );
}

export default function ProjectsView({
  projects = [],
  selectedProject,
  tasks = [],
  scheduled = [],
  models = [],
  onSelectProject,
  onCreateProject,
  onSendInProject,
  onSelectTask,
  onDeleteTask,
  onDeleteProject,
}) {
  // Detail mode is local — App's selectedProject seeds it but the user
  // can flip back to the grid without losing their global selection.
  const [detailProject, setDetailProject] = useState(selectedProject || null);
  useEffect(() => { setDetailProject(selectedProject || null); }, [selectedProject]);

  if (!detailProject) {
    return (
      <ProjectGrid
        projects={projects}
        selectedProject={selectedProject}
        tasks={tasks}
        scheduled={scheduled}
        onCreateProject={onCreateProject}
        onDeleteProject={onDeleteProject}
        onOpenProject={(p) => {
          setDetailProject(p);
          onSelectProject?.(p);
        }}
      />
    );
  }

  return (
    <ProjectDetail
      project={detailProject}
      projects={projects}
      tasks={tasks}
      scheduled={scheduled}
      models={models}
      onSend={onSendInProject}
      onSelectTask={onSelectTask}
      onDeleteTask={onDeleteTask}
      onShowAll={() => setDetailProject(null)}
      onCreateProject={onCreateProject}
    />
  );
}
