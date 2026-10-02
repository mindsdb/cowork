// The project pill and its menu: search, pick, and (when the caller can
// create projects) create one. Home's composer and the Compare start screen
// both use it, so there is one project picker in the app.
//
// Two modes. Controlled (`open` + `onOpenChange`) lets a host coordinate it
// with other menus that share one "which menu is open" slot and one
// outside-click handler, as the composer does. Uncontrolled, it owns its open
// state and closes on a press outside itself.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Ico from './Icons';
import { Tooltip } from './ui';
import NewProjectModal from './project/NewProjectModal';
import { projectLabel, projectMatches, projectNamed } from '../lib/projectLabel';

export default function ProjectPicker({
  projects = [],
  project = null,
  onChange,
  onCreateProject = null,
  // Offered first in the menu when set, for callers where "no project" is a
  // real choice. Picking it calls onChange(null).
  noneLabel = null,
  open: openProp,
  onOpenChange,
}) {
  const [openState, setOpenState] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : openState;
  const setOpen = (next) => {
    if (!controlled) setOpenState(next);
    onOpenChange?.(next);
  };
  const [projectSearch, setProjectSearch] = useState('');
  const [projectMenuBusy, setProjectMenuBusy] = useState(false);
  const [projectMenuError, setProjectMenuError] = useState('');
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const projectSearchRef = useRef(null);
  const projectPillRef = useRef(null);
  const projectMenuRef = useRef(null);
  const wrapRef = useRef(null);

  // Uncontrolled only: a controlled host runs its own outside-click handler.
  useEffect(() => {
    if (controlled || !open) return undefined;
    const handler = (e) => {
      if (wrapRef.current?.contains(e.target)) return;
      setOpenState(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [controlled, open]);

  // Reset the project menu's transient state every time it closes, and
  // autofocus the search input on open so the user can start filtering
  // immediately (also doubles as "tap-to-type" on mobile where there's
  // no keyboard shortcut to open the menu).
  useEffect(() => {
    if (!open) {
      setProjectSearch('');
      setProjectMenuBusy(false);
      setProjectMenuError('');
      return;
    }
    const id = requestAnimationFrame(() => {
      projectSearchRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  // Filter + create logic shared by Enter-on-search-input and the
  // explicit create footer. Defined inside the component body so the
  // menu render can call into them without prop-drilling.
  const _projectSearchTrimmed = projectSearch.trim();
  const _filteredProjects = _projectSearchTrimmed
    ? projects.filter((p) => projectMatches(p, _projectSearchTrimmed))
    : projects;
  // Case-insensitive exact match short-circuits "create" so Enter on
  // a search term that already names a project selects it rather than
  // POSTing a duplicate (the server would reject anyway, but failing
  // fast on the client keeps the UX snappy).
  const _projectExactMatch = _projectSearchTrimmed
    ? projects.find((p) => projectNamed(p, _projectSearchTrimmed))
    : null;
  const _canCreateFromSearch = !!onCreateProject && !!_projectSearchTrimmed && !_projectExactMatch;

  const createProjectFromSearch = async () => {
    if (!_canCreateFromSearch || projectMenuBusy) return;
    setProjectMenuBusy(true);
    setProjectMenuError('');
    try {
      const created = await onCreateProject({ name: _projectSearchTrimmed });
      if (created) onChange?.(created);
      setOpen(false);
    } catch (e) {
      setProjectMenuError(e?.message || 'Could not create project.');
    } finally {
      setProjectMenuBusy(false);
    }
  };

  const submitProjectSearch = () => {
    if (projectMenuBusy) return;
    // Any results → Enter selects the top match (or the exact match
    // when it's not at the top, e.g. an alphabetised list where the
    // exact "acme" sits below "acme-engineering" / "acme-marketing").
    if (_filteredProjects.length > 0) {
      const pick = _projectExactMatch || _filteredProjects[0];
      onChange?.(pick);
      setOpen(false);
      return;
    }
    // Zero results with text → create. Empty search is a no-op
    // (Enter on an empty filter shouldn't do anything surprising).
    if (_canCreateFromSearch) {
      createProjectFromSearch();
    }
  };
  return (
    <>
    <span
      ref={wrapRef}
      className="relative inline-flex"
    >
      <Tooltip content="Choose project">
        <button
          ref={projectPillRef}
          className="meta-pill"
          aria-label="Choose project"
          onClick={() => setOpen(!open)}
        >
          {Ico.folder(14)}
          <span>{project ? projectLabel(project) : 'Work in a project'}</span>
          <span className="inline-flex text-ink-4">{Ico.chevDown(13)}</span>
        </button>
      </Tooltip>

      {open && (
        <div
          ref={projectMenuRef}
          // Always drop downward from the pill. The earlier
          // flip-up was over-engineering: the chat-view composer
          // (which is glued to the viewport bottom) sets
          // `metaReadOnly` and hides this menu entirely, so by
          // construction every surface that opens the menu (home
          // view, projects view) has plenty of room below. The
          // menu's max-height + internal scroll caps it if the
          // viewport is unusually short.
          className="menu menu--drop-down left-0 top-[calc(100%_+_6px)] max-h-[min(60vh,360px)] flex flex-col overflow-hidden"
          style={{
            // cascade-forced: legacy .menu sets min-width:200px;
            // a same-property Tailwind utility would lose to it
            // (loads after Tailwind).
            minWidth: 260,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Search input — sticky header (first flex
              child of a non-scrolling container). */}
          <div className="pt-1 px-[6px] pb-[6px]">
            <div className="flex items-center gap-[6px] bg-surface-2 border border-solid border-line rounded-md py-1 px-2">
              <span className="inline-flex text-ink-3">{Ico.folder(13)}</span>
              <input
                ref={projectSearchRef}
                type="text"
                value={projectSearch}
                onChange={(e) => {
                  setProjectSearch(e.target.value);
                  setProjectMenuError('');
                }}
                placeholder={onCreateProject ? 'Search or create…' : 'Search projects…'}
                disabled={projectMenuBusy}
                spellCheck={false}
                autoCapitalize="none"
                autoCorrect="off"
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    submitProjectSearch();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    if (_projectSearchTrimmed) setProjectSearch('');
                    else setOpen(false);
                  }
                }}
                className="flex-1 min-w-0 bg-transparent border-0 outline-none text-ink text-[13px]"
              />
            </div>
          </div>

          {/* Filtered project list — only scrollable region. */}
          <div
            className="project-menu-list flex-1 min-h-0 overflow-y-auto py-0.5 px-0"
          >
            {noneLabel && !_projectSearchTrimmed && (
              <button
                className={`menu-item${!project ? ' checked' : ''}`}
                onClick={() => { onChange?.(null); setOpen(false); }}
              >
                <span className="inline-flex text-ink-4">{Ico.folder(14)}</span>
                <span className="flex-1 truncate">{noneLabel}</span>
                {!project && <span className="text-[var(--primary-700)]">{Ico.check(14)}</span>}
              </button>
            )}
            {_filteredProjects.length === 0 ? (
              <div className="py-[10px] px-3 text-[12px] text-ink-3">
                {_projectSearchTrimmed
                  ? `No project matches “${_projectSearchTrimmed}”.`
                  : 'No projects yet.'}
              </div>
            ) : _filteredProjects.map((p) => (
              <button
                key={p.name}
                className={`menu-item${project?.name === p.name ? ' checked' : ''}`}
                onClick={() => { onChange?.(p); setOpen(false); }}
              >
                <span className="inline-flex text-ink-2">{Ico.folder(14)}</span>
                <span className="flex-1 truncate">{projectLabel(p)}</span>
                {project?.name === p.name && <span className="text-[var(--primary-700)]">{Ico.check(14)}</span>}
              </button>
            ))}
          </div>

          {/* "+ New project" footer — always present when
              `onCreateProject` is wired, so the create
              affordance is discoverable without first
              typing something into the search box (which
              the previous "footer only when no match"
              rule hid). Label adapts to the search state:
                - empty            → "New project"
                                      (opens the full
                                       "Start a new project"
                                       modal).
                - typed, no match  → "Create '<text>'"
                                      (calls create).
                - typed, exact     → hidden (no duplicates).
          */}
          {onCreateProject && !_projectExactMatch && (
            <>
              <div className="h-px bg-line my-0.5" />
              <button
                className="menu-item"
                disabled={projectMenuBusy}
                onClick={() => {
                  if (_canCreateFromSearch) {
                    createProjectFromSearch();
                  } else {
                    setOpen(false);
                    setNewProjectOpen(true);
                  }
                }}
                // cascade-forced: legacy .menu-item sets color at
                // rest; a same-property Tailwind utility would
                // lose to it (loads after Tailwind).
                style={{ color: 'var(--primary-700)' }}
              >
                <span className="inline-flex text-[var(--primary-700)]">{Ico.plus(14)}</span>
                <span className="flex-1 truncate">
                  {projectMenuBusy
                    ? 'Creating…'
                    : (_canCreateFromSearch
                        ? <>Create <strong className="font-semibold">“{_projectSearchTrimmed}”</strong></>
                        : 'New project')}
                </span>
              </button>
            </>
          )}

          {projectMenuError && (
            <div className="py-[6px] px-[10px] text-[11.5px] text-danger border-t border-x-0 border-b-0 border-solid border-line">
              {projectMenuError}
            </div>
          )}
        </div>
      )}
    </span>

    {/* Portaled to <body>: the composer sits inside the boot-fadein
        wrapper whose persistent transform would otherwise make this
        fixed-position overlay anchor to the card, not the viewport. */}
    {newProjectOpen && createPortal(
      <NewProjectModal
        open={newProjectOpen}
        onClose={() => setNewProjectOpen(false)}
        onCreated={async (result) => {
          const name = result?.name;
          if (!name) return;
          let created = { name };
          try {
            created = (await onCreateProject?.({ name, _alreadyCreated: true })) || created;
          } catch {
            // Project exists on the server; only the list refresh
            // failed — still select it by name.
          }
          onChange?.(created);
        }}
      />,
      document.body,
    )}
    </>
  );
}
