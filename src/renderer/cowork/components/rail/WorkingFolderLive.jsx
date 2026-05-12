// Artifacts rail card body.
//
// Strictly an "artifacts" surface: data source is `GET /v1/artifacts`
// (the canonical artifact registry the global Artifacts page uses),
// filtered to the active project. Loose project-tree files don't
// appear here — they're outside the artifact model and trying to
// preview one would 404 on `/v1/artifacts/preview-mount`.
//
// - Orphans resolve the active project name → { name, path } via the
//   projects list, so the path-prefix filter works.
// - Polls every 3s while streaming, plus once when streaming ends.
// - Click → HTML opens in-app viewer; other types → OS openPath.

import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import Ico from '../Icons';
import {
  fetchActiveProject,
  fetchArtifacts,
  fetchProjects,
} from '../../api';
import { ArtifactViewer } from '../artifact';
import { host } from '../../../platform/host';

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

  // Apply a fetched artifacts list. We now scope the request
  // server-side via `?project_path=...`, so the response is already
  // narrowed to this project — no client-side prefix filter needed.
  // Still slice to the top 12 newest for the rail.
  const applyArtifacts = (proj, list, ticket) => {
    if (ticket !== loadVersion.current) return;
    const all = Array.isArray(list) ? list : [];
    setRows(all.slice(0, 12));
  };

  // Project switch — clear immediately, then load. The clear is
  // important: without it, the rail keeps painting the previous
  // project's artifacts until the new request returns, which reads
  // as "the wrong artifacts until I refresh."
  useEffect(() => {
    const proj = effectiveProject;
    const ticket = ++loadVersion.current;
    if (!proj?.name || !proj?.path) {
      setRows([]);
      return;
    }
    setRows([]);
    fetchArtifacts({ projectPath: proj.path })
      .then((list) => applyArtifacts(proj, list, ticket))
      .catch(() => { if (ticket === loadVersion.current) setRows([]); });
  }, [effectiveProject?.name, effectiveProject?.path]);

  // Streaming poll — every 3s while live, plus once shortly after
  // streaming ends (catches artifacts written near the very end of
  // the turn). Each tick allocates a fresh ticket so its response
  // is discarded if a project switch lands between request and
  // resolution.
  const wasStreaming = useRef(isStreaming);
  useEffect(() => {
    const tick = () => {
      const proj = effectiveProject;
      if (!proj?.name || !proj?.path) return;
      const ticket = ++loadVersion.current;
      fetchArtifacts({ projectPath: proj.path })
        .then((list) => applyArtifacts(proj, list, ticket))
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

  // The card header used to print the project name + path here, but
  // both are already obvious from the page chrome (the project breadcrumb
  // / project-detail header). Keeping them in the rail double-printed
  // information and crowded the file list. The empty-state text below
  // covers the "no active workspace" case implicitly.

  return (
    <div className="pt-2">
      {rows.length === 0 ? (
        <p className="text-[12.5px] text-ink-4 px-1 pb-1">
          No artifacts yet — Anton will save dashboards, reports, and
          datasets here as it produces them.
        </p>
      ) : (
        <div className="flex flex-col gap-0.5">
          {rows.map((a) => (
              <button
                key={a.path}
                type="button"
                onClick={() => onOpenArtifact(a)}
                title={a.path}
                className={clsx(
                  'group grid items-center gap-2 rounded-md px-1 py-1 text-left',
                  'cursor-pointer transition-colors hover:bg-surface-2',
                  'border-0 bg-transparent'
                )}
                style={{ gridTemplateColumns: '14px minmax(0,1fr) auto', font: 'inherit' }}
              >
                <span className="text-ink-4 inline-flex">
                  {(Ico[iconForRow(a)] || Ico.doc)(13)}
                </span>
                <span className="text-[12.5px] text-ink truncate">
                  {a.title || (a.path?.split('/').pop() || '')}
                </span>
                {/* Server pre-formats `updated` as a phrase like
                    "updated 3h ago" — surface it verbatim. Strip
                    the redundant leading "updated " so the right
                    column reads as a timestamp instead of a
                    sentence. */}
                <span className="text-[10.5px] text-ink-4">
                  {String(a.updated || '').replace(/^updated\s+/i, '')}
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
