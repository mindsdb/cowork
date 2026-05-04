// Project card — bubble surface, accent stripe colored deterministically
// per project name, prominent Josefin title, stats row, hover kebab
// for delete. Inter throughout.

import { useEffect, useRef, useState } from 'react';
import Ico from '../Icons';
import { fetchMemory, fetchArtifacts } from '../../api';

const FONT_BODY    = "var(--font-body)";
const FONT_DISPLAY = "var(--font-display)";

// Deterministic tint per project — picks one of the theme's CSS-var
// project tints (defined in globals.css :root + dark mode override),
// so dark mode gets the neon family and light mode gets the deeper
// saturated palette automatically. Same project always gets the same
// slot regardless of theme.
function stripeVar(name) {
  let h = 5381;
  for (let i = 0; i < (name || '').length; i++) {
    h = ((h << 5) + h + name.charCodeAt(i)) | 0;
  }
  const idx = (Math.abs(h) % 6) + 1;
  return `var(--tint-${idx})`;
}

function StatTile({ label, value }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 3,
      minWidth: 0, alignItems: 'flex-start',
    }}>
      <span style={{
        fontFamily: FONT_DISPLAY, fontWeight: 600,
        fontSize: 22, color: 'var(--ink)', lineHeight: 1,
        fontVariantNumeric: 'tabular-nums',
      }}>
        {value}
      </span>
      <span style={{
        fontFamily: FONT_BODY,
        fontSize: 10.5, color: 'var(--ink-4)',
        textTransform: 'uppercase', letterSpacing: '0.08em',
        fontWeight: 500,
      }}>
        {label}
      </span>
    </div>
  );
}

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
  const stripe = stripeVar(project?.name);

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
          borderRadius: 14,
          padding: '20px 22px 18px',
          width: '100%',
          textAlign: 'left',
          display: 'flex', flexDirection: 'column', gap: 18,
          minHeight: 180, minWidth: 0,
          overflow: 'hidden',
          position: 'relative',
          transition: 'border-color 160ms ease, box-shadow 200ms ease, transform 160ms ease',
          boxShadow: hover
            ? '0 1px 0 rgba(15,16,17,0.02), 0 12px 28px rgba(15,16,17,0.08)'
            : '0 1px 0 rgba(15,16,17,0.02)',
          transform: hover ? 'translateY(-2px)' : 'translateY(0)',
          font: 'inherit', color: 'inherit',
        }}
      >
        {/* Accent stripe — left edge, deterministic per project name */}
        <span style={{
          position: 'absolute', left: 0, top: 0, bottom: 0,
          width: 4, background: stripe,
          opacity: isSelected || hover ? 1 : 0.7,
          transition: 'opacity 160ms ease',
        }} />

        {/* Header row */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, minWidth: 0, width: '100%' }}>
          <span style={{
            width: 40, height: 40, borderRadius: 10, flexShrink: 0,
            background: `color-mix(in srgb, ${stripe} 18%, var(--surface-2))`,
            color: stripe,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            border: `1px solid color-mix(in srgb, ${stripe} 30%, transparent)`,
          }}>
            {Ico.folder(20)}
          </span>
          <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{
              fontFamily: FONT_DISPLAY, fontSize: 17, fontWeight: 600,
              color: 'var(--ink)', letterSpacing: '0.005em',
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

        {/* Stats — tabular-nums on the numbers, very faint hairline above */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          gap: 16,
          marginTop: 'auto',
          paddingTop: 14,
          borderTop: '1px solid var(--line)',
        }}>
          <StatTile label="Tasks" value={stats.tasks} />
          <StatTile label="Memories" value={stats.memories} />
          <StatTile label="Schedules" value={stats.scheduled} />
          <StatTile label="Artifacts" value={stats.artifacts} />
        </div>
      </button>

      {/* Hover kebab — top-right, only on user-deletable projects */}
      {!isReserved && (
        <>
          <button
            ref={triggerRef}
            type="button"
            onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
            title="Project menu"
            aria-label="Project menu"
            style={{
              position: 'absolute', top: 10, right: 10,
              width: 28, height: 28, borderRadius: 6,
              cursor: 'pointer', background: 'var(--surface)',
              border: '1px solid var(--line)',
              color: 'var(--ink-3)',
              display: 'inline-grid', placeItems: 'center',
              opacity: showKebab ? 1 : 0,
              pointerEvents: showKebab ? 'auto' : 'none',
              transition: 'opacity 140ms ease, color 140ms ease, background 140ms ease',
              zIndex: 5, font: 'inherit',
            }}
            onMouseOver={(e) => { e.currentTarget.style.color = 'var(--ink)'; e.currentTarget.style.background = 'var(--surface-2)'; }}
            onMouseOut={(e) => { e.currentTarget.style.color = 'var(--ink-3)'; e.currentTarget.style.background = 'var(--surface)'; }}
          >
            {Ico.moreVert(15)}
          </button>
          {menuOpen && (
            <div
              ref={menuRef}
              style={{
                position: 'absolute', top: 42, right: 10, zIndex: 10,
                width: 200,
                background: 'var(--surface)',
                border: '1px solid var(--line)',
                borderRadius: 10,
                boxShadow: '0 12px 32px rgba(15,16,17,0.18)',
                padding: '4px 0',
                fontFamily: FONT_BODY,
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
                  padding: '9px 10px', borderRadius: 6,
                  fontFamily: FONT_BODY, fontSize: 13,
                  color: 'var(--danger)', textAlign: 'left',
                  font: 'inherit',
                }}
                onMouseOver={(e) => { e.currentTarget.style.background = 'color-mix(in srgb, var(--danger) 12%, transparent)'; }}
                onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                <span style={{ display: 'inline-flex', flexShrink: 0, color: 'var(--danger)' }}>{Ico.trash(14)}</span>
                <span style={{ color: 'var(--danger)' }}>Delete project</span>
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
