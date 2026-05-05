// Live working-folder card body.
//
// - Resolves orphan tasks via /v1/projects/active.
// - Polls /v1/artifacts every 3s while streaming, plus once when the
//   stream resolves, so newly-generated files surface promptly.
// - Highlights files modified after the current stream started with a
//   pulsing accent dot for ~30s.
// - Click any row → shell.openPath via main.

import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import Ico from '../Icons';
import { fetchArtifacts, fetchActiveProject } from '../../api';
import { ArtifactViewer } from '../artifact';

function timeAgo(iso) {
  if (!iso) return '';
  const d = typeof iso === 'string' ? new Date(iso) : new Date(iso);
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

export function WorkingFolderLive({ project, isStreaming, streamStartedAt }) {
  // Resolve the project — explicit task project wins; orphans fall
  // back to the user's active project.
  const [activeProject, setActiveProject] = useState(null);
  useEffect(() => {
    if (project) return;
    let cancelled = false;
    fetchActiveProject()
      .then((p) => { if (!cancelled) setActiveProject(p); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [project]);
  const effectiveProject = project || activeProject;

  const [artifacts, setArtifacts] = useState([]);
  const inFlight = useRef(false);

  const refresh = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const data = await fetchArtifacts();
      if (Array.isArray(data)) setArtifacts(data);
    } catch {} finally {
      inFlight.current = false;
    }
  };

  // Initial fetch on project change.
  useEffect(() => { refresh(); }, [effectiveProject?.path]);

  // Poll every 3s while streaming. Refresh once more 1s after streaming
  // ends so the final write lands.
  const wasStreaming = useRef(isStreaming);
  useEffect(() => {
    if (isStreaming) {
      const id = setInterval(refresh, 3000);
      wasStreaming.current = true;
      return () => clearInterval(id);
    }
    if (wasStreaming.current) {
      const id = setTimeout(refresh, 1000);
      wasStreaming.current = false;
      return () => clearTimeout(id);
    }
  }, [isStreaming]);

  // Filter artifacts to the effective project. Match by path prefix
  // since artifact.path is absolute and project.path is the project
  // root — anton stores outputs at <project>/.anton/output/...
  const projectArtifacts = useMemo(() => {
    if (!effectiveProject?.path) return artifacts.slice(0, 10);
    const prefix = effectiveProject.path.replace(/\/+$/, '') + '/';
    return artifacts.filter((a) => a.path && a.path.startsWith(prefix)).slice(0, 12);
  }, [artifacts, effectiveProject]);

  // HTML artifacts open in our in-app preview modal so users can
  // see them without leaving Anton (and so they can publish/unpublish).
  // Other types open in the OS default app.
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

  // The project root often looks empty — anton's working files all
  // live under `.anton/` (output, episodes, memory, etc.). Opening
  // that folder makes "Open in OS" actually useful. `.anton` always
  // exists once a project is created (ensureDefaultProject), so this
  // path is safe even before the first artifact lands.
  const antonFolder = effectiveProject?.path
    ? `${effectiveProject.path.replace(/\/+$/, '')}/.anton`
    : null;

  return (
    <div className="pt-2">
      {/* Project header — name + path. Clicking the path opens the
          .anton/output folder, where the actual artifacts live. */}
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

      {/* File list */}
      {projectArtifacts.length === 0 ? (
        <p className="text-[12.5px] text-ink-4 px-1 pb-1">
          No files yet — Anton will store new artifacts here.
        </p>
      ) : (
        <div className="flex flex-col gap-0.5">
          {projectArtifacts.map((f) => {
            // "NEW" if file modified after this stream started, OR
            // marked live by the server (modified in last 5 min) and
            // we're currently streaming.
            const live = !!f.live;
            const recent = streamStartedAt && f.updated
              ? new Date(f.updated).getTime() >= streamStartedAt
              : false;
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
                // font: inherit defeats the user-agent button default
                // (-webkit-control / Helvetica) so the button text
                // actually renders in Inter from the parent surface.
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
          // Reflect publish state into the local artifact list so the
          // pill (and any future indicator on the row) updates.
          setArtifacts((prev) => prev.map((a) => a.path === updated.path ? { ...a, publishedUrl: updated.publishedUrl } : a));
        }}
        onDelete={(path) => {
          // File is in Trash now — drop it from the live list so the
          // working folder reflects reality without waiting for a
          // refresh stream tick.
          setArtifacts((prev) => prev.filter((a) => a.path !== path));
        }}
      />
    </div>
  );
}
