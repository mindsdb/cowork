// Live working-folder card body.
//
// - Orphans resolve active project name → full { name, path } via projects list.
// - Loads files from GET /v1/projects/{name}/files (excludes `.context/` + `.anton/`).
// - Polls every 3s while streaming, plus once when streaming ends.
// - Poll-driven refresh only; row icons stay static (no streaming pulse).
// - Click → HTML opens in-app viewer; other types → OS openPath.

import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import Ico from '../Icons';
import {
  fetchActiveProject,
  fetchProjects,
  isUnderAntonDir,
  isUnderContextDir,
  listProjectFiles,
} from '../../api';
import { ArtifactViewer } from '../artifact';
import { host } from '../../../platform/host';

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

// Map a file extension to a glyph from `Icons.jsx`. Buckets group
// extensions that read the same at glance — code files all get the
// brackets icon, tabular data files all get the database icon, etc.
// Unknown / unmapped extensions fall through to a generic doc.
const EXT_ICON = {
  // Web / published
  html: 'globe', htm: 'globe',
  // Images
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image',
  svg: 'image', webp: 'image', bmp: 'image', ico: 'image',
  // Code
  py: 'code', js: 'code', mjs: 'code', cjs: 'code',
  ts: 'code', tsx: 'code', jsx: 'code',
  css: 'code', scss: 'code', less: 'code',
  sh: 'code', bash: 'code', zsh: 'code',
  rb: 'code', go: 'code', rs: 'code', java: 'code',
  c: 'code', h: 'code', cpp: 'code', hpp: 'code',
  yaml: 'code', yml: 'code', toml: 'code',
  // Tabular / data
  csv: 'database', tsv: 'database', parquet: 'database',
  xlsx: 'database', xls: 'database', xlsm: 'database',
  db: 'database', sqlite: 'database',
  json: 'database', jsonl: 'database', ndjson: 'database',
  sql: 'database',
  // Documents — md/pdf/txt fall through to doc, listed for clarity
  md: 'doc', mdx: 'doc', txt: 'doc', pdf: 'doc',
  rtf: 'doc', log: 'doc',
};

function iconForRow(row) {
  const ext = String(row?.ext || '').replace(/^\./, '').toLowerCase();
  return EXT_ICON[ext] || 'doc';
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
  return {
    path: abs,
    title,
    ext,
    updated: updatedMs,
    size: Number.isFinite(f.size) ? f.size : 0,
    publishedUrl: '',
  };
}

export function WorkingFolderLive({ project, isStreaming }) {
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
  // Bumped on every project switch / streaming-tick load. The async
  // load checks the version against the latest before applying its
  // result, so a request that finishes after a project switch can't
  // overwrite the new project's rows. (Earlier the component used a
  // single `inFlight` ref, which dropped the new project's request
  // and let the prior project's response paint into the wrong view.)
  const loadVersion = useRef(0);

  // Skip files that start with a dot (`.DS_Store`, `.gitignore`,
  // `.env`, etc.) — they're noise in the working-folder card and
  // never something Anton produced as an artifact.
  const isHidden = (entry) => {
    const name = entry?.name || String(entry?.path || '').split('/').pop();
    return !!name && name.startsWith('.');
  };

  const applyListing = (proj, data, ticket) => {
    if (ticket !== loadVersion.current) return;
    const list = Array.isArray(data?.files) ? data.files : [];
    const next = list
      .filter((f) => !f.is_dir
        && !isUnderContextDir(f.path)
        && !isUnderAntonDir(f.path)
        && !isHidden(f))
      .map((f) => fileEntryToRow(proj.path, f))
      .sort((a, b) => (b.updated || 0) - (a.updated || 0))
      .slice(0, 12);
    setRows(next);
  };

  // Project switch — clear immediately, then load. The clear is
  // important: without it, the rail keeps painting the previous
  // project's files until the new request returns, which reads as
  // "the wrong files until I refresh."
  useEffect(() => {
    const proj = effectiveProject;
    const ticket = ++loadVersion.current;
    if (!proj?.name || !proj?.path) {
      setRows([]);
      return;
    }
    setRows([]);
    listProjectFiles(proj.name)
      .then((data) => applyListing(proj, data, ticket))
      .catch(() => { if (ticket === loadVersion.current) setRows([]); });
  }, [effectiveProject?.name, effectiveProject?.path]);

  // Streaming poll — every 3s while live, plus once shortly after
  // streaming ends (catches files written near the very end of the
  // turn). Each tick allocates a fresh ticket so its response is
  // discarded if a project switch lands between the request and its
  // resolution.
  const wasStreaming = useRef(isStreaming);
  useEffect(() => {
    const tick = () => {
      const proj = effectiveProject;
      if (!proj?.name || !proj?.path) return;
      const ticket = ++loadVersion.current;
      listProjectFiles(proj.name)
        .then((data) => applyListing(proj, data, ticket))
        .catch(() => { /* swallow — keep current rows */ });
    };
    if (isStreaming) {
      const id = setInterval(tick, 3000);
      wasStreaming.current = true;
      return () => clearInterval(id);
    }
    if (wasStreaming.current) {
      const id = setTimeout(tick, 1000);
      wasStreaming.current = false;
      return () => clearTimeout(id);
    }
  }, [isStreaming, effectiveProject?.name, effectiveProject?.path]);

  const [previewArt, setPreviewArt] = useState(null);
  const onOpen = async (path) => {
    try { await host.openPath(path); } catch {}
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
            className={
              host.isWeb
                ? 'text-[10.5px] text-ink-4 truncate'
                : 'text-[10.5px] text-ink-4 truncate cursor-pointer hover:text-ink-3'
            }
            title={!host.isWeb && antonFolder ? `Open ${antonFolder}` : effectiveProject.path}
            onClick={host.isWeb ? undefined : () => antonFolder && onOpen(antonFolder)}
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
          {rows.map((f) => (
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
                <span className="text-ink-4 inline-flex">
                  {(Ico[iconForRow(f)] || Ico.doc)(13)}
                </span>
                <span className="text-[12.5px] text-ink truncate">{f.title || (f.path?.split('/').pop() || '')}</span>
                <span className="text-[10.5px] text-ink-4">
                  {timeAgo(f.updated) || formatBytes(f.size)}
                </span>
              </button>
          ))}
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
