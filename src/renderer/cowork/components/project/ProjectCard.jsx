// Project bubble card for the projects grid. Shows name + path,
// four stats (tasks / memories / scheduled / artifacts), and a
// hover kebab → Delete menu. Same Inter + Josefin styling family
// as the rest of the rail.

import { useEffect, useRef, useState } from 'react';
import Ico from '../Icons';
import { fetchMemory, fetchArtifacts } from '../../api';

const FONT_BODY = "'Inter', system-ui, sans-serif";
const FONT_DISPLAY = "'Josefin Sans', sans-serif";

function StatTile({ label, value }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      <span style={{
        fontFamily: FONT_DISPLAY, fontWeight: 600,
        fontSize: 18, color: 'var(--ink)', lineHeight: 1,
      }}>
        {value}
      </span>
      <span style={{
        fontFamily: FONT_BODY,
        fontSize: 10.5, color: 'var(--ink-4)',
        textTransform: 'uppercase', letterSpacing: '0.06em',
      }}>
        {label}
      </span>
    </div>
  );
}

// Per-project stats. Tasks + scheduled come from the parent's
// already-loaded state (passed in to avoid duplicate fetching).
// Memories + artifacts get their own fetch per card.
function useProjectStats(project, { tasks = [], scheduled = [] }) {
  const [memCount, setMemCount] = useState(null);
  const [artCount, setArtCount] = useState(null);

  useEffect(() => {
    if (!project?.path) return;
    let cancelled = false;
    fetchMemory(project.path).then((data) => {
      if (cancelled) return;
      const total = (data?.sections || []).reduce(
        (n, s) => n + (s.files?.length || 0),
        0
      );
      setMemCount(total);
    }).catch(() => setMemCount(0));
    return () => { cancelled = true; };
  }, [project?.path]);

  useEffect(() => {
    if (!project?.path) return;
    let cancelled = false;
    fetchArtifacts().then((data) => {
      if (cancelled || !Array.isArray(data)) return;
      const prefix = project.path.replace(/\/+$/, '') + '/';
      setArtCount(data.filter((a) => a.path?.startsWith(prefix)).length);
    }).catch(() => setArtCount(0));
    return () => { cancelled = true; };
  }, [project?.path]);

  const taskCount = (tasks || []).filter((t) =>
    t.projectName === project?.name || t.projectPath === project?.path
  ).length;

  const schedCount = (scheduled || []).filter((s) =>
    (s.project || s.projectName) === project?.name
  ).length;

  return {
    tasks: taskCount,
    scheduled: schedCount,
    memories: memCount ?? '–',
    artifacts: artCount ?? '–',
  };
}

export function ProjectCard({
  project,
  isSelected,
  tasks = [],
  scheduled = [],
  onOpen,
  onDelete,
}) {
  const stats = useProjectStats(project, { tasks, scheduled });
  const [hover, setHover] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  // Close menu on click-outside or Esc.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false); };
    const onClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target) && !triggerRef.current?.contains(e.target)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, [menuOpen]);

  const isReserved = project.name === 'general' || project.name === 'default';
  const showKebab = hover || menuOpen;

  return (
    <div
      style={{ position: 'relative' }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <button
        type="button"
        onClick={() => onOpen?.(project)}
        style={{
          cursor: 'pointer',
          background: 'var(--surface)',
          border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--line)'}`,
          borderRadius: 12,
          padding: 16,
          width: '100%',
          textAlign: 'left',
          display: 'flex', flexDirection: 'column', gap: 16,
          minHeight: 160, minWidth: 0,
          overflow: 'hidden',
          transition: 'border-color 120ms ease, box-shadow 120ms ease, transform 120ms ease',
          boxShadow: '0 1px 0 rgba(15,16,17,0.02)',
          font: 'inherit',
          color: 'inherit',
        }}
        onMouseOver={(e) => {
          e.currentTarget.style.borderColor = 'var(--accent)';
          e.currentTarget.style.boxShadow = '0 1px 0 rgba(15,16,17,0.02), 0 8px 22px rgba(15,16,17,0.06)';
          e.currentTarget.style.transform = 'translateY(-1px)';
        }}
        onMouseOut={(e) => {
          e.currentTarget.style.borderColor = isSelected ? 'var(--accent)' : 'var(--line)';
          e.currentTarget.style.boxShadow = '0 1px 0 rgba(15,16,17,0.02)';
          e.currentTarget.style.transform = 'translateY(0)';
        }}
      >
        {/* Header — folder glyph + name + path */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, minWidth: 0, width: '100%' }}>
          <span style={{
            width: 36, height: 36, borderRadius: 10, flexShrink: 0,
            background: 'var(--surface-2)', color: 'var(--accent)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {Ico.folder(18)}
          </span>
          <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{
              fontFamily: FONT_BODY, fontSize: 14, fontWeight: 600,
              color: 'var(--ink)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {project.name}
            </div>
            <div title={project.path} style={{
              fontFamily: FONT_BODY, fontSize: 11.5, color: 'var(--ink-4)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              maxWidth: '100%',
            }}>
              {project.path}
            </div>
          </div>
        </div>

        {/* Stats row */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          gap: 12, marginTop: 'auto',
        }}>
          <StatTile label="Tasks" value={stats.tasks} />
          <StatTile label="Memories" value={stats.memories} />
          <StatTile label="Schedules" value={stats.scheduled} />
          <StatTile label="Artifacts" value={stats.artifacts} />
        </div>
      </button>

      {/* Hover kebab + menu */}
      {!isReserved && (
        <>
          <button
            ref={triggerRef}
            type="button"
            onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
            title="Project menu"
            aria-label="Project menu"
            style={{
              position: 'absolute', top: 8, right: 8,
              width: 28, height: 28, borderRadius: 6,
              cursor: 'pointer', background: 'transparent', border: 0,
              color: 'var(--ink-3)',
              display: 'inline-grid', placeItems: 'center',
              opacity: showKebab ? 1 : 0,
              pointerEvents: showKebab ? 'auto' : 'none',
              transition: 'opacity 120ms ease, color 120ms ease, background 120ms ease',
              zIndex: 5,
            }}
            onMouseOver={(e) => { e.currentTarget.style.color = 'var(--ink)'; e.currentTarget.style.background = 'var(--surface-2)'; }}
            onMouseOut={(e) => { e.currentTarget.style.color = 'var(--ink-3)'; e.currentTarget.style.background = 'transparent'; }}
          >
            {Ico.moreVert(15)}
          </button>
          {menuOpen && (
            <div
              ref={menuRef}
              style={{
                position: 'absolute', top: 36, right: 8, zIndex: 10,
                width: 180,
                background: 'var(--surface)',
                border: '1px solid var(--line)',
                borderRadius: 10,
                boxShadow: '0 12px 32px rgba(15,16,17,0.18)',
                padding: '4px 0',
              }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onDelete?.(project); }}
                style={{
                  cursor: 'pointer',
                  background: 'transparent', border: 0,
                  width: 'calc(100% - 8px)', margin: '0 4px',
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 10px', borderRadius: 6,
                  fontFamily: FONT_BODY, fontSize: 13,
                  color: 'var(--danger)', textAlign: 'left',
                }}
                onMouseOver={(e) => { e.currentTarget.style.background = 'color-mix(in srgb, var(--danger) 12%, transparent)'; }}
                onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                <span style={{ display: 'inline-flex', flexShrink: 0 }}>{Ico.trash(14)}</span>
                <span>Delete project</span>
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
