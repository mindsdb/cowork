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

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import Ico from '../Icons';
import {
  fetchActiveProject,
  fetchArtifacts,
  fetchProjects,
  publishArtifact,
  unpublishArtifact,
  publishTargetPath,
  deleteArtifact,
} from '../../api';
import { ArtifactViewer } from '../artifact';
import { ConfirmModal } from '../ConfirmModal';
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
  // Per-row kebab menu state (single-open) + portal coords.
  //
  // Why a portal: the rail-card body wraps this component with
  // `overflow-y: auto` (RailCard.jsx). A `position: absolute`
  // dropdown child of an artifact row gets visually clipped by that
  // ancestor's overflow — so the menu appeared to "hide behind" the
  // card. createPortal escapes to document.body, where no ancestor
  // overflow can touch it. We compute viewport-fixed coords from the
  // clicked kebab's getBoundingClientRect() and close on scroll +
  // resize since the kebab might move under a stale menu.
  const [openMenuPath, setOpenMenuPath] = useState(null);
  const [menuPos, setMenuPos] = useState(null);
  const [busyPath, setBusyPath] = useState(null);
  const [rowError, setRowError] = useState('');
  // Pending artifact-delete payload — drives the ConfirmModal, same
  // lifted-state pattern as the project-files / task-uploads deletes
  // in ContextCard and the task / project deletes in App.jsx.
  const [pendingDeleteArtifact, setPendingDeleteArtifact] = useState(null);
  const menuRef = useRef(null);
  // Map of artifact.path → kebab button DOM node. Stored in a ref
  // so renders don't replace the map; cleaned up implicitly when
  // rows unmount via the ref callback's null branch.
  const kebabRefs = useRef(new Map());
  const setKebabRef = (path) => (el) => {
    if (el) kebabRefs.current.set(path, el);
    else kebabRefs.current.delete(path);
  };

  const openMenuFor = (path) => {
    const btn = kebabRefs.current.get(path);
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    // Menu opens just below the kebab, right-anchored so it can't
    // extend past the right edge of the viewport. `position: fixed`
    // applies these directly to viewport coordinates.
    setMenuPos({
      top: r.bottom + 4,
      right: Math.max(8, window.innerWidth - r.right),
    });
    setOpenMenuPath(path);
  };

  useEffect(() => {
    if (openMenuPath == null) return undefined;
    const onClick = (e) => {
      if (menuRef.current && menuRef.current.contains(e.target)) return;
      setOpenMenuPath(null);
    };
    // The kebab that's anchoring the menu might scroll out from
    // under it (rail-card body has overflow-y:auto) or the window
    // may resize — close in either case so the menu doesn't dangle.
    const onClose = () => setOpenMenuPath(null);
    // Defer one tick so the click that OPENED the menu doesn't
    // propagate up and immediately close it.
    const id = setTimeout(() => document.addEventListener('click', onClick), 0);
    window.addEventListener('resize', onClose);
    document.addEventListener('scroll', onClose, true); // capture catches all scrollers
    return () => {
      clearTimeout(id);
      document.removeEventListener('click', onClick);
      window.removeEventListener('resize', onClose);
      document.removeEventListener('scroll', onClose, true);
    };
  }, [openMenuPath]);

  const onOpen = async (path) => {
    try { await host.openPath(path); } catch {}
  };
  // Used by the kebab menu's "Open" action. The deciding factor is
  // whether the artifact file is on THIS machine:
  //   - Electron + local (loopback) server → host.openPath, the file
  //     is on disk here so the OS default app can open it.
  //   - Electron pointed at a REMOTE server, or web → the path is on
  //     the server box, not here. Open the stateless `serveUrl` over
  //     HTTP (origin-relative → hits whatever server we're talking to).
  //     Falls back to publishedUrl, then a clear error.
  const canOpenLocalFile = host.isElectron && host.isLocalApiOrigin();
  const openArtifactExternal = async (a) => {
    if (!canOpenLocalFile) {
      // `serveUrl` is origin-relative (`/v1/...`). In a web tab a
      // relative URL resolves against the page origin (the server) —
      // fine. But an Electron renderer is loaded from file://app://,
      // so a relative URL would resolve there, not at the remote
      // server. Make it absolute via the configured API origin.
      const rel = a?.serveUrl || '';
      const url = rel
        ? (rel.startsWith('http') ? rel : `${host.getApiOrigin()}${rel}`)
        : (a?.publishedUrl || '');
      if (url) {
        try { await host.openExternal(url); } catch {}
        return;
      }
      setRowError('This artifact has no servable file yet.');
      return;
    }
    try {
      const result = await host.openPath(a.path);
      if (result && result.ok === false) {
        setRowError(result.reason || 'Could not open file.');
      }
    } catch (e) {
      setRowError(e?.message || 'Could not open file.');
    }
  };

  const onTogglePublish = async (a) => {
    if (!a?.path) return;
    setBusyPath(a.path);
    setRowError('');
    try {
      if (a.publishedUrl) {
        await unpublishArtifact(publishTargetPath(a));
        setRows((prev) => prev.map((r) => r.path === a.path ? { ...r, publishedUrl: '' } : r));
      } else {
        const r = await publishArtifact(publishTargetPath(a));
        const url = r?.url || r?.publishedUrl || '';
        setRows((prev) => prev.map((row) => row.path === a.path ? { ...row, publishedUrl: url } : row));
      }
    } catch (e) {
      setRowError(e?.message || 'Publish toggle failed.');
    } finally {
      setBusyPath(null);
    }
  };

  const onDeleteArtifact = async (a) => {
    if (!a?.path) return;
    setBusyPath(a.path);
    setRowError('');
    // Optimistic remove — mirrors the Project Files / Task Uploads
    // deletes so the row vanishes the same frame the user confirms.
    // Reached only after the ConfirmModal is accepted (see the
    // menu's Delete item, which sets `pendingDeleteArtifact`).
    const previous = a;
    setRows((prev) => prev.filter((r) => r.path !== a.path));
    try {
      // Unpublish first so deletion never leaves an orphaned public copy.
      // The server enforces the same rule as a backstop.
      if (a.publishedUrl) {
        await unpublishArtifact(a.path);
      }
      // Deletion is centralized through cowork-server (not shell.trashItem),
      // so it works in every shell and the server's unpublish-before-delete
      // guard always runs.
      await deleteArtifact(a.folder || a.path);
    } catch (e) {
      setRowError(e?.message || 'Delete failed.');
      // Restore the row on failure.
      setRows((prev) => prev.find((r) => r.path === previous.path) ? prev : [previous, ...prev]);
    } finally {
      setBusyPath(null);
    }
  };
  // Inline-previewable artifacts open the ArtifactViewer modal; the
  // viewer handles HTML via sandboxed iframe and .md/.txt/.csv via
  // the inline text path. Anything else falls through to the OS
  // handler so the user's default app picks it up.
  const _INLINE_PREVIEW_EXTS = ['.html', '.md', '.txt', '.csv'];
  const onOpenArtifact = (artifact) => {
    const ext = (artifact.ext || '').toLowerCase();
    const path = (artifact.path || '').toLowerCase();
    const canPreview = _INLINE_PREVIEW_EXTS.includes(ext)
      || _INLINE_PREVIEW_EXTS.some((e) => path.endsWith(e));
    if (canPreview) {
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
      {rowError && (
        <p className="text-[11px] px-1 pb-0.5" style={{ color: 'var(--danger)' }}>
          {rowError}
        </p>
      )}
      {rows.length === 0 ? (
        <p className="text-[12.5px] text-ink-4 px-1 pb-1">
          No artifacts yet — the agent will save dashboards, reports, and
          datasets here as it produces them.
        </p>
      ) : (
        <div className="flex flex-col gap-0.5">
          {rows.map((a) => {
            const isPublished = !!a.publishedUrl;
            const menuOpen = openMenuPath === a.path;
            return (
              <div
                key={a.path}
                role="button"
                tabIndex={0}
                onClick={() => onOpenArtifact(a)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpenArtifact(a);
                  }
                }}
                title={`${a.path}${isPublished ? ` · published` : ''}`}
                className={clsx(
                  'group relative grid items-center gap-2 rounded-md px-1 py-1 text-left',
                  'cursor-pointer transition-colors hover:bg-surface-2',
                  'outline-none focus-visible:ring-2 focus-visible:ring-offset-0 focus-visible:ring-accent'
                )}
                style={{ gridTemplateColumns: '14px minmax(0,1fr) auto', font: 'inherit' }}
              >
                {/* Icon — picks up the accent color when the artifact
                    has a publishedUrl so the user can spot what's
                    published at a glance without opening each row. */}
                <span
                  className="inline-flex"
                  style={{ color: isPublished ? 'var(--accent)' : 'var(--ink-4)' }}
                >
                  {(Ico[iconForRow(a)] || Ico.doc)(13)}
                </span>
                <span className="text-[12.5px] text-ink truncate">
                  {a.title || (a.path?.split('/').pop() || '')}
                </span>
                {/* Trailing slot: timestamp normally, kebab on hover
                    or while THIS row's menu is open. Shared-slot
                    trick keeps row width stable. */}
                <span className="relative inline-flex items-center justify-end flex-none" style={{ minWidth: 22 }}>
                  <span className={clsx(
                    'text-[10.5px] text-ink-4 transition-opacity',
                    'group-hover:opacity-0',
                    menuOpen && 'opacity-0',
                  )}>
                    {/* Server pre-formats `updated` as a phrase like
                        "updated 3h ago" — strip the redundant leading
                        "updated " so the column reads as a timestamp
                        rather than a sentence. */}
                    {String(a.updated || '').replace(/^updated\s+/i, '')}
                  </span>
                  <button
                    ref={setKebabRef(a.path)}
                    type="button"
                    aria-label="More actions"
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    title="More actions"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (menuOpen) setOpenMenuPath(null);
                      else openMenuFor(a.path);
                    }}
                    className={clsx(
                      // `justify-end` (not center) pins the kebab to
                      // the right edge of the trailing slot so it sits
                      // flush against the row's right margin — matching
                      // where the project-files trash icon lands. The
                      // artifact timestamp ("3h ago") is wider than the
                      // project-file one ("3h"), so a centered kebab
                      // floated noticeably left of the edge.
                      'absolute inset-0 inline-flex items-center justify-end',
                      menuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
                      'transition-opacity rounded',
                      'text-ink-4 hover:text-ink',
                      'bg-transparent border-0 cursor-pointer p-0',
                    )}
                  >
                    {Ico.moreVert(13)}
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Portaled menu for the currently-open kebab. Lives at
          document.body so the rail-card body's overflow:auto can't
          clip it. `position: fixed` uses viewport coords computed
          from the kebab's getBoundingClientRect() in openMenuFor. */}
      {openMenuPath != null && menuPos != null && createPortal(
        (() => {
          const a = rows.find((r) => r.path === openMenuPath);
          if (!a) return null;
          const isPublished = !!a.publishedUrl;
          const openLabel = canOpenLocalFile ? 'Open in OS' : 'Open in new tab';
          return (
            <div
              ref={menuRef}
              role="menu"
              onClick={(e) => e.stopPropagation()}
              className="menu"
              style={{
                position: 'fixed',
                top: menuPos.top,
                right: menuPos.right,
                minWidth: 180,
                zIndex: 100,
              }}
            >
              <button
                type="button"
                className="menu-item"
                disabled={busyPath === a.path}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenMenuPath(null);
                  openArtifactExternal(a);
                }}
              >
                <span style={{ display: 'inline-flex', color: 'var(--frost-700)' }}>
                  {(Ico.externalLink || Ico.upload)(13)}
                </span>
                <span>{openLabel}</span>
              </button>
              <button
                type="button"
                className="menu-item"
                disabled={busyPath === a.path}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenMenuPath(null);
                  onTogglePublish(a);
                }}
              >
                <span style={{
                  display: 'inline-flex',
                  color: isPublished ? 'var(--accent)' : 'var(--frost-700)',
                }}>
                  {Ico.globe ? Ico.globe(13) : Ico.upload(13)}
                </span>
                <span>{isPublished ? 'Unpublish' : 'Publish'}</span>
              </button>
              <div style={{ height: 1, background: 'var(--border-0)', margin: '4px 0' }} />
              <button
                type="button"
                className="menu-item"
                disabled={busyPath === a.path}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenMenuPath(null);
                  // Open the confirm modal rather than deleting
                  // immediately — matches the project files / task
                  // uploads / task / project delete flows.
                  setPendingDeleteArtifact(a);
                }}
                style={{ color: 'var(--danger)' }}
              >
                <span style={{ display: 'inline-flex', color: 'var(--danger)' }}>{Ico.trash(13)}</span>
                <span>Delete</span>
              </button>
            </div>
          );
        })(),
        document.body,
      )}

      <ConfirmModal
        open={!!pendingDeleteArtifact}
        title={`Delete "${pendingDeleteArtifact?.title || pendingDeleteArtifact?.path?.split('/').pop() || 'artifact'}"?`}
        message="The artifact will be permanently deleted, and unpublished first if it's currently published. This can't be undone."
        confirmLabel="Delete"
        cancelLabel="Keep"
        destructive
        onClose={() => setPendingDeleteArtifact(null)}
        onConfirm={() => {
          const target = pendingDeleteArtifact;
          setPendingDeleteArtifact(null);
          if (target) onDeleteArtifact(target);
        }}
      />

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
