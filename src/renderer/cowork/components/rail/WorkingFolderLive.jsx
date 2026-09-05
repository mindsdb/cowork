// Use the canonical artifact registry, filtered by project. Loose project files have no
// preview-mount record.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import Ico from '../Icons';
import {
  fetchActiveProject,
  fetchArtifacts,
  fetchProjects,
  unpublishArtifact,
} from '../../api';
import { ArtifactViewer } from '../artifact';
import { Tooltip } from '../ui';
import { ConfirmModal } from '../ConfirmModal';
import { host } from '../../../platform/host';
import { useOrgMode } from '../../../lib/orgMode';
import { artifactOpenTarget, needsClientUnpublishBeforeDelete } from '../../lib/artifactActions';
import { canDownloadOrgDraft, canPreviewOrgDraft, isBackendArtifact, isInlinePreviewable } from '../../lib/artifactKinds';
import { downloadArtifactFile } from '../../lib/artifactDownload';
import { deleteArtifactAndSync } from '../../lib/artifactsStore';

const EXT_ICON = {
  html: 'globe', htm: 'globe',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image',
  svg: 'image', webp: 'image', bmp: 'image', ico: 'image',
  py: 'code', js: 'code', mjs: 'code', cjs: 'code',
  ts: 'code', tsx: 'code', jsx: 'code',
  css: 'code', scss: 'code', less: 'code',
  sh: 'code', bash: 'code', zsh: 'code',
  rb: 'code', go: 'code', rs: 'code', java: 'code',
  c: 'code', h: 'code', cpp: 'code', hpp: 'code',
  yaml: 'code', yml: 'code', toml: 'code',
  csv: 'database', tsv: 'database', parquet: 'database',
  xlsx: 'database', xls: 'database', xlsm: 'database',
  db: 'database', sqlite: 'database',
  json: 'database', jsonl: 'database', ndjson: 'database',
  sql: 'database',
  md: 'doc', mdx: 'doc', txt: 'doc', pdf: 'doc',
  rtf: 'doc', log: 'doc',
};

function iconForRow(row) {
  const ext = String(row?.ext || '').replace(/^\./, '').toLowerCase();
  return EXT_ICON[ext] || 'doc';
}


export function WorkingFolderLive({ project, isStreaming, conversationId = null, onAddressWithAgent }) {
  const orgMode = useOrgMode();
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
  // Version each load so responses started before a project switch cannot replace the new project’s
  // rows.
  const loadVersion = useRef(0);

  // The server already scopes artifacts to this project; limit the rail to its newest entries.
  const applyArtifacts = (proj, list, ticket) => {
    if (ticket !== loadVersion.current) return;
    const all = Array.isArray(list) ? list : [];
    setRows(all.slice(0, 12));
  };

  // Clear immediately on project switch so the previous project’s artifacts cannot appear under the
  // new one.
  useEffect(() => {
    const proj = effectiveProject;
    const ticket = ++loadVersion.current;
    if (!proj?.name || !(proj?.id || proj?.path)) {
      setRows([]);
      return;
    }
    setRows([]);
    fetchArtifacts({ projectId: proj.id, projectPath: proj.path })
      .then((list) => applyArtifacts(proj, list, ticket))
      .catch(() => { if (ticket === loadVersion.current) setRows([]); });
  }, [effectiveProject?.name, effectiveProject?.id, effectiveProject?.path]);

  // Poll while streaming and once after completion to catch final writes. Each request gets a
  // ticket against project switches.
  const wasStreaming = useRef(isStreaming);
  useEffect(() => {
    const tick = () => {
      const proj = effectiveProject;
      if (!proj?.name || !(proj?.id || proj?.path)) return;
      const ticket = ++loadVersion.current;
      fetchArtifacts({ projectId: proj.id, projectPath: proj.path })
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
  // Propagate changed mtime into the open preview to reload rebuilt content; retain identity when
  // unchanged.
  useEffect(() => {
    setPreviewArt((cur) => {
      if (!cur) return cur;
      const fresh = rows.find((r) => r.path === cur.path);
      return fresh && fresh.mtime !== cur.mtime ? { ...cur, ...fresh } : cur;
    });
  }, [rows]);
  // Portal the menu outside the rail’s overflow. Use viewport coordinates and close on
  // scroll/resize so its anchor cannot drift.
  const [openMenuPath, setOpenMenuPath] = useState(null);
  const [menuPos, setMenuPos] = useState(null);
  const [busyPath, setBusyPath] = useState(null);
  const [rowError, setRowError] = useState('');
  const [pendingDeleteArtifact, setPendingDeleteArtifact] = useState(null);
  const menuRef = useRef(null);
  const kebabRefs = useRef(new Map());
  const setKebabRef = (path) => (el) => {
    if (el) kebabRefs.current.set(path, el);
    else kebabRefs.current.delete(path);
  };

  const openMenuFor = (path) => {
    const btn = kebabRefs.current.get(path);
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    // Place the fixed menu below its trigger in viewport coordinates.
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
    // Close on scroll or resize so the menu cannot detach from its trigger.
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
  // Use OS paths only with local Electron; remote/web servers need an HTTP serve or published URL.
  const canOpenLocalFile = host.isElectron && host.isLocalApiOrigin();
  const openArtifactExternal = async (a) => {
    if (!canOpenLocalFile) {
      // Resolve serveUrl against the API origin; Electron’s file/app origin would otherwise address
      // the wrong host.
      const rel = a?.serveUrl || '';
      const url = rel
        ? (rel.startsWith('http') ? rel : `${host.getApiOrigin()}${rel}`)
        : (a?.publishedUrl || '');
      if (url) {
        try { await host.openExternal(url); } catch {}
        return;
      }
      // Download unshared org files through authenticated draft fetching. Exclude fullstack shells:
      // their entry HTML is not the whole app.
      if (canDownloadOrgDraft(a) && await downloadArtifactFile(a)) return;
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

  const onDeleteArtifact = async (a) => {
    if (!a?.path || a?.capabilities?.canEdit === false) return;
    setBusyPath(a.path);
    setRowError('');
    const previous = a;
    setRows((prev) => prev.filter((r) => r.path !== a.path));
    try {
      // Unpublish before desktop deletion to avoid leaving a public copy; organization mode handles
      // this atomically on the server.
      if (needsClientUnpublishBeforeDelete({ orgMode, published: a.publishedUrl })) {
        await unpublishArtifact(a.path);
      }
      // Use server deletion so its unpublish guard runs in every shell.
      await deleteArtifactAndSync(a);
    } catch (e) {
      setRowError(e?.message || 'Delete failed.');
      setRows((prev) => prev.find((r) => r.path === previous.path) ? prev : [previous, ...prev]);
    } finally {
      setBusyPath(null);
    }
  };
  const onOpenArtifact = async (artifact) => {
    /*
     * Org previews use authenticated drafts or published URLs; local OS handoff remains
     * desktop-only.
     */
    const target = artifactOpenTarget({
      orgMode,
      published: !!artifact.publishedUrl,
      canPreviewInline: isInlinePreviewable(artifact),
      canPreviewDraft: canPreviewOrgDraft(artifact),
      hasBridge: host.isElectron,
      hasDraft: canDownloadOrgDraft(artifact),
    });
    if (target === 'published') {
      /* Await the bridge promise so rejection reaches the browser fallback. */
      try { await host.openExternal(artifact.publishedUrl); }
      catch { window.open(artifact.publishedUrl, '_blank', 'noopener,noreferrer'); }
    } else if (target === 'preview') {
      setPreviewArt(artifact);
    } else if (target === 'download') {
      // An unshared draft can still be downloaded through authenticated fetch. ENG-2044.
      if (!(await downloadArtifactFile(artifact))) setRowError('This artifact has no servable file yet.');
    } else if (target === 'os') {
      onOpen(artifact.path);
    }
  };


  return (
    <div className="pt-2">
      {rowError && (
        <p className="text-xs px-1 pb-0.5 text-danger">
          {rowError}
        </p>
      )}
      {rows.length === 0 ? (
        <p className="text-sm text-ink-4 px-1 pb-1">
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
                  'outline-none focus-visible:ring-2 focus-visible:ring-offset-0 focus-visible:ring-accent grid-cols-[14px_minmax(0,1fr)_auto] [font:inherit]'
                )}
              >
                <span
                  className="inline-flex"
                  style={{ color: isPublished ? 'var(--accent)' : 'var(--ink-4)' }}
                >
                  {(Ico[iconForRow(a)] || Ico.doc)(13)}
                </span>
                <span className="text-sm text-ink truncate">
                  {a.title || (a.path?.split('/').pop() || '')}
                </span>
                {/* Share timestamp/menu space to keep row width stable. */}
                <span className="relative inline-flex items-center justify-end flex-none min-w-[22px]">
                  <span className={clsx(
                    'text-[10.5px] text-ink-4 transition-opacity',
                    'group-hover:opacity-0',
                    menuOpen && 'opacity-0',
                  )}>
                    {String(a.updated || '').replace(/^updated\s+/i, '')}
                  </span>
                  <Tooltip content="More actions">
                    <button
                      ref={setKebabRef(a.path)}
                      type="button"
                      aria-label="More actions"
                      aria-haspopup="menu"
                      aria-expanded={menuOpen}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (menuOpen) setOpenMenuPath(null);
                        else openMenuFor(a.path);
                      }}
                      className={clsx(
                        // Align kebabs to the slot’s right edge so differing timestamp widths
                        // cannot shift them.
                        'absolute inset-0 inline-flex items-center justify-end',
                        menuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
                        'transition-opacity rounded',
                        'text-ink-4 hover:text-ink',
                        'bg-transparent border-0 cursor-pointer p-0',
                      )}
                    >
                      {Ico.moreVert(13)}
                    </button>
                  </Tooltip>
                </span>
              </div>
            );
          })}
        </div>
      )}

      {openMenuPath != null && menuPos != null && createPortal(
        (() => {
          const a = rows.find((r) => r.path === openMenuPath);
          if (!a) return null;
          // Offer a separate Download only when Open has another destination; otherwise Open itself
          // downloads the file.
          const canOpenRemote = !!(a.serveUrl || a.publishedUrl);
          // Exclude fullstack apps even when serveUrl exists, or download would save only the shell
          // index.html.
          const canDownload = !canOpenLocalFile && !isBackendArtifact(a)
            && !!(a.serveUrl || canDownloadOrgDraft(a));
          const openLabel = canOpenLocalFile
            ? 'Open in OS'
            // Label Download only when a file can actually be saved; missing primaries and unshared
            // fullstack apps cannot.
            : (canOpenRemote || !canDownload ? 'Open in new tab' : 'Download');
          const canDelete = a.capabilities?.canEdit !== false;
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
                <span className="inline-flex text-[var(--frost-700)]">
                  {(openLabel === 'Download' ? Ico.download : (Ico.externalLink || Ico.upload))(13)}
                </span>
                <span>{openLabel}</span>
              </button>
              {canDownload && canOpenRemote && (
                <button
                  type="button"
                  className="menu-item"
                  disabled={busyPath === a.path}
                  onClick={async (e) => {
                    e.stopPropagation();
                    setOpenMenuPath(null);
                    if (!(await downloadArtifactFile(a))) setRowError('This artifact has no servable file yet.');
                  }}
                >
                  <span className="inline-flex text-[var(--frost-700)]">{Ico.download(13)}</span>
                  <span>Download</span>
                </button>
              )}
              {canDelete && (
                <>
                  <div className="h-px bg-[var(--border-0)] my-1" />
                  <button
                    type="button"
                    className="menu-item"
                    disabled={busyPath === a.path}
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenMenuPath(null);
                      setPendingDeleteArtifact(a);
                    }}
                    style={{ color: 'var(--danger)' }}
                  >
                    <span className="inline-flex text-danger">{Ico.trash(13)}</span>
                    <span>Delete</span>
                  </button>
                </>
              )}
            </div>
          );
        })(),
        document.body,
      )}

      <ConfirmModal
        open={!!pendingDeleteArtifact}
        title={`Delete "${pendingDeleteArtifact?.title || pendingDeleteArtifact?.path?.split('/').pop() || 'artifact'}"?`}
        message="The artifact will be permanently deleted, and sharing will stop first if it's currently shared. This can't be undone."
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
        conversationId={conversationId}
        onAddressWithAgent={onAddressWithAgent}
      />
    </div>
  );
}
