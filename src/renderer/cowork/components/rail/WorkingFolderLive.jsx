// Live working-folder card body.
//
// - Orphans resolve active project name → full { name, path } via projects list.
// - Loads files from GET /v1/projects/{name}/files (excludes `.context/`).
// - Polls every 3s while streaming, plus once when streaming ends.
// - Highlights rows using mtime vs stream start and “live” (recent write).
// - Click → HTML opens in-app viewer; other types → OS openPath.

import { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import Ico from '../Icons';
import { fetchActiveProject, fetchProjects, listProjectFiles } from '../../api';
import { ArtifactViewer } from '../artifact';

function timeAgo(ts) {
  if (ts == null || ts === '') return '';
  const d = typeof ts === 'number' ? new Date(ts) : new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const secs = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
  return `${Math.floor(secs / 86400)}d`;
}

function formatBytes(n) {
  if (!Number.isFinite(n)) return '';
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

/** Project-relative path — true if under `.context/` (instructions + uploads). */
function isUnderContextDir(relPath) {
  const r = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  return r === '.context' || r.startsWith('.context/');
}

/** Project-file listing row → artifact-shaped row for previews / OS open. */
function fileEntryToRow(projectRoot, f) {
  const rel = String(f.path || '').replace(/\\/g, '/');
  const abs = `${String(projectRoot).replace(/\/+$/, '')}/${rel}`;
  const baseName = f.name || rel.split('/').pop() || '';
  const lower = baseName.toLowerCase();
  const ext = lower.includes('.') ? `.${lower.split('.').pop()}` : '';
  const stem = baseName.includes('.') ? baseName.slice(0, baseName.lastIndexOf('.')) : baseName;
  const title = stem
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
  const mtimeSec = typeof f.modified === 'number' ? f.modified : null;
  const updatedMs = mtimeSec != null ? Math.round(mtimeSec * 1000) : 0;
  const live = mtimeSec != null && Date.now() / 1000 - mtimeSec < 300;
  return {
    path: abs,
    title,
    ext,
    updated: updatedMs,
    live,
    size: Number.isFinite(f.size) ? f.size : 0,
    publishedUrl: '',
  };
}

export function WorkingFolderLive({ project, isStreaming, streamStartedAt }) {
  const [resolvedProject, setResolvedProject] = useState(null);
  useEffect(() => {
    if (project) return;
    let cancelled = false;
    (async () => {
      try {
        const name = await fetchActiveProject();
        if (cancelled || !name) {
          if (!cancelled) setResolvedProject(null);
          return;
        }
        const projects = await fetchProjects();
        if (cancelled) return;
        setResolvedProject(projects.find((p) => p.name === name) || null);
      } catch {
        if (!cancelled) setResolvedProject(null);
      }
    })();
    return () => { cancelled = true; };
  }, [project]);

  const effectiveProject = project || resolvedProject;

  const [rows, setRows] = useState([]);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    const proj = effectiveProject;
    if (!proj?.name || !proj?.path) {
      setRows([]);
      return;
    }
    inFlight.current = true;
    try {
      const data = await listProjectFiles(proj.name);
      const list = Array.isArray(data?.files) ? data.files : [];
      const next = list
        .filter((f) => !f.is_dir && !isUnderContextDir(f.path))
        .map((f) => fileEntryToRow(proj.path, f))
        .sort((a, b) => (b.updated || 0) - (a.updated || 0))
        .slice(0, 12);
      setRows(next);
    } catch {
      setRows([]);
    } finally {
      inFlight.current = false;
    }
  }, [effectiveProject]);

  useEffect(() => { refresh(); }, [refresh]);

  const wasStreaming = useRef(isStreaming);
  useEffect(() => {
    if (isStreaming) {
      const id = setInterval(() => { refresh(); }, 3000);
      wasStreaming.current = true;
      return () => clearInterval(id);
    }
    if (wasStreaming.current) {
      const id = setTimeout(() => { refresh(); }, 1000);
      wasStreaming.current = false;
      return () => clearTimeout(id);
    }
  }, [isStreaming, refresh]);

  const [previewArt, setPreviewArt] = useState(null);
  const onOpen = async (path) => {
    try { await window.antontron?.openPath?.(path); } catch {}
  };
  const onOpenArtifact = (artifact) => {
    const isHtml = (artifact.ext || '').toLowerCase() === '.html'
      || (artifact.path || '').toLowerCase().endsWith('.html');
    if (isHtml) {
      setPreviewArt(artifact);
    } else {
      onOpen(artifact.path);
    }
  };

  const antonFolder = effectiveProject?.path
    ? `${effectiveProject.path.replace(/\/+$/, '')}/.anton`
    : null;

  return (
    <div className="pt-2">
      {effectiveProject ? (
        <div className="flex flex-col gap-0.5 pb-2 mb-1.5 border-b border-line">
          <span className="text-[12.5px] font-medium text-ink truncate" title={effectiveProject.name}>
            {effectiveProject.name}
          </span>
          <span
            className="text-[10.5px] text-ink-4 truncate cursor-pointer hover:text-ink-3"
            title={antonFolder ? `Open ${antonFolder}` : effectiveProject.path}
            onClick={() => antonFolder && onOpen(antonFolder)}
          >{effectiveProject.path}</span>
        </div>
      ) : (
        <p className="text-[12.5px] text-ink-4 pb-2">No active workspace.</p>
      )}

      {rows.length === 0 ? (
        <p className="text-[12.5px] text-ink-4 px-1 pb-1">
          No files yet — Anton will store new artifacts here.
        </p>
      ) : (
        <div className="flex flex-col gap-0.5">
          {rows.map((f) => {
            const live = !!f.live;
            const um = typeof f.updated === 'number' ? f.updated : null;
            const recent = streamStartedAt && um != null ? um >= streamStartedAt : false;
            const isNew = recent || (live && isStreaming);
            return (
              <button
                key={f.path}
                type="button"
                onClick={() => onOpenArtifact(f)}
                title={f.path}
                className={clsx(
                  'group grid items-center gap-2 rounded-md px-1 py-1 text-left',
                  'cursor-pointer transition-colors hover:bg-surface-2',
                  'border-0 bg-transparent'
                )}
                style={{ gridTemplateColumns: '14px minmax(0,1fr) auto', font: 'inherit' }}
              >
                {isNew ? (
                  <span
                    className="inline-block h-2 w-2 rounded-full bg-accent"
                    style={{
                      boxShadow: '0 0 8px rgba(34,211,238,0.55)',
                      animation: isStreaming ? 'pulse-dot 1.6s ease-in-out infinite' : 'none',
                    }}
                  />
                ) : (
                  <span className="text-ink-4 inline-flex">{Ico.doc(13)}</span>
                )}
                <span className="text-[12.5px] text-ink truncate">{f.title || (f.path?.split('/').pop() || '')}</span>
                <span className="text-[10.5px] text-ink-4">
                  {timeAgo(f.updated) || formatBytes(f.size)}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <ArtifactViewer
        open={!!previewArt}
        artifact={previewArt}
        onClose={() => setPreviewArt(null)}
        onChange={(updated) => {
          setPreviewArt(updated);
          setRows((prev) => prev.map((a) => a.path === updated.path ? { ...a, publishedUrl: updated.publishedUrl } : a));
        }}
        onDelete={(path) => {
          setRows((prev) => prev.filter((a) => a.path !== path));
        }}
      />
    </div>
  );
}
