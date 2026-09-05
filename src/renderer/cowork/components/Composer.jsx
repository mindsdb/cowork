import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { projectLabel, projectMatches, projectNamed } from '../lib/projectLabel';
import { createPortal } from 'react-dom';
import Ico from './Icons';
import { Tooltip } from './ui';
import { ToggleGroup } from './ui/ToggleGroup';
import NewProjectModal from './project/NewProjectModal';
import {
  parseFences,
  fenceCtxAtParsed,
  stackEmptyBeforeLine,
  parseOpenerLine,
} from './composerFences';
import { HighlightOverlay } from './composerHighlight';
import {
  MODEL_ROUTER_ID, MODEL_ROUTER_LABEL,
} from '../lib/modelCatalog';
import { buildModelPickerOptions } from '../lib/modelPickerOptions';
import { MODEL_REFRESH_TTL_MS } from '../lib/modelRefresh';
import ModelSelect from './ModelSelect.jsx';
import ProviderIcon from './ProviderIcon.jsx';
import { useFileDrop, FileDropOverlay, extractClipboardFiles } from '../lib/useFileDrop';
import { renameClipboardImages } from '../lib/clipboardImageName';
import { AttachmentThumbnail } from './AttachmentThumbnail';
import { useSkills } from '../lib/skillsStore';
import { useDraft } from '../hooks/useDraft';
import { host } from '../../platform/host';

// Slash tokens begin at input start or after whitespace, never inside paths; return start/query or
// null.
function detectSlashToken(text, caret) {
  const before = text.slice(0, Math.max(0, caret));
  const m = before.match(/(^|\s)\/([\w-]*)$/);
  if (!m) return null;
  return { start: caret - m[2].length - 1, query: m[2].toLowerCase() };
}

// Keep Tailwind classes literal and gate hover to fine pointers to avoid sticky touch states.
// Touch shows the remove icon permanently; stacked icons cross-fade without moving layout.
function TaskModeChip({ mode, onClear }) {
  return (
    <button
      type="button"
      className="group inline-flex h-7 cursor-pointer items-center gap-[6px] rounded-full px-[11px] border border-solid border-[color-mix(in_srgb,var(--accent)_28%,transparent)] bg-[var(--primary-50)] text-[var(--primary-700)] [font-family:inherit] text-[13px] font-medium dark:border-[color-mix(in_srgb,var(--accent)_40%,transparent)] dark:text-accent [transition:background_140ms_ease,border-color_140ms_ease,transform_160ms_cubic-bezier(0.23,1,0.32,1)] animate-chip-in motion-reduce:animate-none active:scale-[0.96] motion-reduce:active:transform-none [@media(hover:hover)_and_(pointer:fine)]:hover:bg-[color-mix(in_srgb,var(--accent)_16%,var(--surface-0))] [@media(hover:hover)_and_(pointer:fine)]:hover:border-[color-mix(in_srgb,var(--accent)_45%,transparent)]"
      aria-label={`Remove ${mode.chipNoun || mode.chipLabel} mode`}
      onClick={onClear}
    >
      <span className="relative inline-flex h-3.5 w-3.5" aria-hidden>
        <span className="absolute inset-0 inline-flex [transition:opacity_150ms_cubic-bezier(0.2,0,0,1),transform_150ms_cubic-bezier(0.2,0,0,1)] group-focus-visible:scale-[0.25] group-focus-visible:opacity-0 [@media(hover:hover)_and_(pointer:fine)]:group-hover:scale-[0.25] [@media(hover:hover)_and_(pointer:fine)]:group-hover:opacity-0 [@media(hover:none)]:scale-[0.25] [@media(hover:none)]:opacity-0">
          {Ico[mode.icon](14)}
        </span>
        <span className="absolute inset-0 inline-flex [transition:opacity_150ms_cubic-bezier(0.2,0,0,1),transform_150ms_cubic-bezier(0.2,0,0,1)] scale-[0.25] opacity-0 group-focus-visible:scale-100 group-focus-visible:opacity-100 [@media(hover:hover)_and_(pointer:fine)]:group-hover:scale-100 [@media(hover:hover)_and_(pointer:fine)]:group-hover:opacity-100 [@media(hover:none)]:scale-100 [@media(hover:none)]:opacity-100">
          {Ico.close(14)}
        </span>
      </span>
      {mode.chipLabel}
    </button>
  );
}

function AttachmentChip({ attachment, onRemove }) {
  const src = attachment.source || attachment.kind || 'file';
  const isImage = attachment.mime && String(attachment.mime).startsWith('image/');
  const label = src === 'connector' ? 'Connector' : src === 'gdrive' ? 'Google Drive' : isImage ? 'Image' : 'File';
  const status = attachment.pendingFile
    ? 'Queued'
    : (attachment.extractionStatus && attachment.extractionStatus !== 'ready'
      ? attachment.extractionStatus.replace('_', ' ')
      : null);
  const showThumb = isImage && attachment.pendingFile;
  return (
    <div className="attachment-chip" title={attachment.note || attachment.textPreview || attachment.name}>
      <span className="attachment-chip-icon">
        {showThumb ? <AttachmentThumbnail file={attachment.pendingFile} cover size={30} alt={attachment.name || 'Image'} />
          : src === 'connector' ? Ico.link(13)
            : src === 'gdrive' ? Ico.googleDrive(13)
              : isImage ? Ico.image(13)
                : Ico.doc(13)}
      </span>
      <span className="attachment-chip-body">
        <span className="attachment-chip-name">{attachment.name || label}</span>
        <span className="attachment-chip-meta">{status || label}</span>
      </span>
      {onRemove && (
        <Tooltip content="Remove attachment">
          <button className="attachment-chip-remove" aria-label="Remove attachment" onClick={() => onRemove(attachment.id)}>
            x
          </button>
        </Tooltip>
      )}
    </div>
  );
}

export default function Composer({
  onSend,
  project,
  onProjectChange,
  model,
  onModelChange,
  // Model-specific effort; empty string uses the model default. Omit these props to disable the
  // effort footer.
  effort = '',
  onEffortChange,
  projects,
  models,
  /** Optional catalog metadata; BYOK ids and unmatched lists remain ungrouped. */
  modelMeta,
  attachments = [],
  connectors = [],
  onNavigateToConnectors,
  onAttachFiles,
  onAddGoogleDriveFiles,
  /** When set with `onUpdateConnectorMute`, Connectors submenu toggles mute (applied when you send). */
  conversationId = null,
  disabledConnections = [],
  onUpdateConnectorMute,
  onRemoveAttachment,
  placeholder = 'Hi Boss, how can I help you today?',
  disabled = false,
  metaReadOnly = false,
  // Defaults to metaReadOnly; ProjectsView overrides because only its project is locked.
  modelReadOnly = metaReadOnly,
  hideMeta = false,
  streaming = false,
  onStop,
  // Signals active typing, then inactivity after a short idle; HomeView uses it for the orbit
  // indicator.
  onTypingChange,
  // Changing prefill.bump resets text and focuses even when the supplied text repeats.
  prefill = null,
  // onCreateProject({ name, _alreadyCreated? }) must resolve to the created record, which becomes
  // selected.
  // Omit it to hide creation; _alreadyCreated identifies the modal path.
  onCreateProject = null,
  taskMode = null,
  onClearTaskMode,
  // Draft scope must survive route unmounts without leaking between conversation, home, and project
  // composers.
  draftKey = null,
  codingModeEnabled = false,
  // Opt into { harness, model } as send argument 2 only for Home/Projects. ChatView uses that slot
  // for queued attachments; passing metadata there silently corrupts the queue.
  sendsMeta = false,
  onOpenSettings,
  // Claude Code requires a concrete model; use the configured Coding model when switching with an
  // empty catalog.
  codingModelDefault,
  // Per-harness enable flags; Anton is always offered as the default.
  harnessHermesEnabled = true,
  harnessClaudeCodeEnabled = true,
}) {
  const [value, setValue] = useDraft(draftKey || conversationId || 'new');
  const [focused, setFocused] = useState(false);
  const [openMenu, setOpenMenu] = useState(null);
  const [codingHarness, setCodingHarness] = useState('anton');
  // CLI detection is a hint, not an eligibility gate; a missing command is reported at launch.
  const [claudeCodeInfo, setClaudeCodeInfo] = useState({ installed: false, path: null });

  useEffect(() => {
    if (!codingModeEnabled) return;
    let cancelled = false;
    host.detectClaudeCode().then((info) => {
      if (!cancelled) setClaudeCodeInfo(info || { installed: false, path: null });
    });
    return () => { cancelled = true; };
  }, [codingModeEnabled]);
  /** Project search also creates a missing name; flipUp handles a composer at the viewport bottom. */
  const [projectSearch, setProjectSearch] = useState('');
  const [projectMenuBusy, setProjectMenuBusy] = useState(false);
  const [projectMenuError, setProjectMenuError] = useState('');
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const projectSearchRef = useRef(null);
  const projectPillRef = useRef(null);
  const projectMenuRef = useRef(null);
  /** Attach menu opens above the composer by default; flip down when clipped (e.g. project view composer at scroll top). */
  const [attachMenuBelow, setAttachMenuBelow] = useState(false);
  const [connectorsOpen, setConnectorsOpen] = useState(false);
  const [gdrivePickerBusy, setGdrivePickerBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [listening, setListening] = useState(false);
  /** Track caret in a ref and only render when the derived fenced-block flag changes. */
  const [inFence, setInFence] = useState(false);
  /** Keep the slash start offset so accepting a skill replaces the entire /fragment. */
  const [slashMenuBelow, setSlashMenuBelow] = useState(false);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState('');
  const [slashIndex, setSlashIndex] = useState(0);
  const slashTokenStartRef = useRef(0);
  const { skills: allSkills } = useSkills();
  const taRef = useRef(null);
  /** Match textarea sizing and scrolling exactly so highlighted text stays aligned. */
  const overlayRef = useRef(null);
  const fileRef = useRef(null);
  const wrapRef = useRef(null);
  const caretPosRef = useRef(0);
  /** Apply pending caret only for setValue fallback; execCommand manages its own selection. */
  const pendingCaretRef = useRef(null);
  const attachAnchorRef = useRef(null);
  const attachMenuRef = useRef(null);

  const navigateToConnectors = useCallback(() => {
    setOpenMenu(null);
    setConnectorsOpen(false);
    onNavigateToConnectors?.();
  }, [onNavigateToConnectors]);

  const ATTACH_MENU_TOP_RESERVE_PX = 200;

  // Typing includes pasting; the ref-held timer survives renders.
  const typingTimerRef = useRef(null);
  const wasTypingRef = useRef(false);
  const notifyTyping = (active) => {
    if (typeof onTypingChange !== 'function') return;
    if (wasTypingRef.current === active) return;
    wasTypingRef.current = active;
    try { onTypingChange(active); } catch {}
  };
  const bumpTyping = () => {
    notifyTyping(true);
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => notifyTyping(false), 1000);
  };
  useEffect(() => () => {
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    // Restore idle on unmount so this composer cannot leave the orbit indicator thinking.
    if (wasTypingRef.current) {
      try { onTypingChange?.(false); } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const recognitionRef = useRef(null);

  // Reuse memoized parsedFences in caret/key handlers; parseFences walks the entire draft.
  const parsedFences = useMemo(() => parseFences(value), [value]);

  // Control popup state so the Model Router settings action can close it before opening the modal.
  const [modelMenuOpen, setModelMenuOpen] = useState(false);

  // Use -Infinity for never refreshed: 0 would look like a page-load refresh and suppress the first
  // open.
  const modelRefreshedAt = useRef(-Infinity);
  const openModelMenu = useCallback(() => {
    if (!modelMeta?.onRefresh) return;
    if (performance.now() - modelRefreshedAt.current < MODEL_REFRESH_TTL_MS) return;
    modelRefreshedAt.current = performance.now();
    // Open with cached options and reconcile asynchronously so the menu does not wait on the
    // network.
    Promise.resolve(modelMeta.onRefresh()).catch(() => {});
  }, [modelMeta]);

  const harnessPickerOptions = useMemo(() => {
    const opts = [{ value: 'anton', label: 'Anton' }];
    if (harnessHermesEnabled) opts.push({ value: 'hermes', label: 'Hermes' });
    if (harnessClaudeCodeEnabled) {
      opts.push({
        value: 'claude-code',
        label: 'Claude-Code',
        title: claudeCodeInfo.installed ? undefined : 'Claude-Code — not detected on this machine',
      });
    }
    return opts;
  }, [harnessHermesEnabled, harnessClaudeCodeEnabled, claudeCodeInfo.installed]);

  // Fall back when the selected harness becomes unavailable; never send a harness absent from the
  // picker.
  useEffect(() => {
    if (!codingModeEnabled || harnessPickerOptions.length === 0) return;
    if (harnessPickerOptions.some((o) => o.value === codingHarness)) return;
    setCodingHarness(harnessPickerOptions[0].value);
  }, [codingModeEnabled, harnessPickerOptions, codingHarness]);

  // Claude Code requires a concrete --model. Gate on current enablement as well as selection
  // so a stale disabled choice cannot hide Model Router.
  const isClaudeCode = codingModeEnabled && harnessClaudeCodeEnabled && codingHarness === 'claude-code';

  // Send only the effective harness; the reset effect may not have rendered after a harness is
  // disabled.
  const effectiveHarness = !codingModeEnabled
    ? 'anton'
    : (harnessPickerOptions.some((o) => o.value === codingHarness)
      ? codingHarness
      : (harnessPickerOptions[0]?.value || 'anton'));

  // Outside coding mode, effectiveHarness is always Anton; use account harness metadata for effort
  // support.
  const effortHarness = codingModeEnabled ? effectiveHarness : (modelMeta?.harness || 'anton');

  // An unconfigured provider leaves the Anton catalog empty; Claude Code still needs its own
  // concrete model.
  const noRealModels = !isClaudeCode && (models?.length || 0) === 0 && !!onOpenSettings;

  const modelPickerOptions = useMemo(() => {
    const catalogOptions = buildModelPickerOptions(models, modelMeta);
    // Place Model Router first within MindsHub by using its explicit maker and prepending the
    // option.
    return isClaudeCode ? catalogOptions : [
      {
        value: MODEL_ROUTER_ID,
        label: MODEL_ROUTER_LABEL,
        maker: 'mindshub',
        title: "Routes to this account's configured model automatically",
        // Stop propagation to avoid selecting Model Router while opening Settings; close the popup
        // first.
        ...(onOpenSettings ? {
          action: (
            <Tooltip content="Router Settings">
              <button
                type="button"
                aria-label="Router Settings"
                className="composer-icon shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  setModelMenuOpen(false);
                  onOpenSettings('agent');
                }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                {Ico.settings(13)}
              </button>
            </Tooltip>
          ),
        } : {}),
      },
      ...catalogOptions,
    ];
  }, [models, modelMeta, isClaudeCode, onOpenSettings]);

  const needsClaudeCodeModel = isClaudeCode && (!model?.id || model.id === MODEL_ROUTER_ID);

  // Use the Coding model fallback both for display and at send time; Send may precede the prop
  // round-trip.
  const effectiveModelId = (needsClaudeCodeModel && codingModelDefault) ? codingModelDefault : model?.id;

  useEffect(() => {
    if (!needsClaudeCodeModel || !codingModelDefault) return;
    const found = modelPickerOptions.find((o) => o.value === codingModelDefault);
    onModelChange({ id: codingModelDefault, name: found?.label || codingModelDefault });
    // onModelChange intentionally omitted: some callers (ChatView) pass a
    // fresh closure every render, which would refire this every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsClaudeCodeModel, codingModelDefault, modelPickerOptions]);

  useEffect(() => {
    if (!taRef.current) return;
    taRef.current.style.height = 'auto';
    taRef.current.style.height = Math.min(220, taRef.current.scrollHeight) + 'px';
  }, [value]);

  // Apply pending caret and fenced state before paint; render only when the derived flag changes.
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    if (pendingCaretRef.current != null) {
      const target = pendingCaretRef.current;
      // A tuple selects a range; a number collapses the caret.
      if (Array.isArray(target)) {
        try { ta.setSelectionRange(target[0], target[1]); } catch {  }
      } else {
        ta.selectionStart = ta.selectionEnd = target;
      }
      pendingCaretRef.current = null;
    }
    const pos = ta.selectionStart;
    caretPosRef.current = pos;
    const next = fenceCtxAtParsed(parsedFences.fences, pos) !== null;
    setInFence((prev) => (prev === next ? prev : next));
    if (overlayRef.current) {
      overlayRef.current.scrollTop = ta.scrollTop;
      overlayRef.current.scrollLeft = ta.scrollLeft;
    }
  });

  // Use the cached fence parse for selection events; only the derived boolean needs state.
  const syncCaret = useCallback(() => {
    const ta = taRef.current;
    if (!ta) return;
    const pos = ta.selectionStart;
    caretPosRef.current = pos;
    const next = fenceCtxAtParsed(parsedFences.fences, pos) !== null;
    setInFence((prev) => (prev === next ? prev : next));
  }, [parsedFences]);

  const handleScroll = (e) => {
    const ta = e.currentTarget;
    if (overlayRef.current) {
      overlayRef.current.scrollTop = ta.scrollTop;
      overlayRef.current.scrollLeft = ta.scrollLeft;
    }
  };

  // execCommand insertText preserves native undo for the inserted snippet.
  // If it fails, callers must set value and queue selection through pendingCaretRef.
  const insertTextWithUndo = (text, caretAfter) => {
    const ta = taRef.current;
    if (!ta) return false;
    if (document.activeElement !== ta) ta.focus();
    try {
      if (document.execCommand('insertText', false, text)) {
        ta.selectionStart = ta.selectionEnd = caretAfter;
        return true;
      }
    } catch {
      // Fall back if Chromium stops supporting the deprecated API.
    }
    return false;
  };

  const refreshSlash = useCallback((text, caret) => {
    const tok = detectSlashToken(text, caret);
    if (tok) {
      slashTokenStartRef.current = tok.start;
      setSlashQuery(tok.query);
      setSlashIndex(0);
      if (wrapRef.current) {
        const r = wrapRef.current.getBoundingClientRect();
        setSlashMenuBelow(r.top < 340);
      }
      setSlashOpen(true);
    } else {
      setSlashOpen((prev) => (prev ? false : prev));
    }
  }, []);

  // Use the shared skills store so saves/deletions update the slash menu live.
  const slashItems = useMemo(() => {
    if (!slashOpen) return [];
    const builtins = [
      { id: 'add-files', label: 'add-files', hint: 'Open file picker', kind: 'action',
        run: () => fileRef.current?.click() },
    ];
    const currentProject = project?.name;
    const skillRows = (allSkills || [])
      .filter((s) => {
        if (s.enabled === false) return false;
        const skillProject = s.projects?.[0] || s.project;
        if (!skillProject) return true;
        return skillProject === currentProject;
      })
      .map((s) => ({
        id: `skill:${s.label}`, label: s.label, hint: s.description || '', kind: 'skill', name: s.label,
      }));
    const all = [...builtins, ...skillRows];
    if (!slashQuery) return all;
    return all.filter(
      (i) => i.label.toLowerCase().includes(slashQuery) || (i.hint || '').toLowerCase().includes(slashQuery),
    );
  }, [slashOpen, slashQuery, allSkills, project]);

  const closeSlash = useCallback(() => setSlashOpen((prev) => (prev ? false : prev)), []);

  // Highlight only known skill slugs, not ordinary file paths.
  const mentionNames = useMemo(
    () => new Set((allSkills || []).map((s) => s.label).filter(Boolean)),
    [allSkills],
  );

  // Replace the slash token through insertTextWithUndo; skills become plain /slug mentions without
  // backticks.
  const acceptSlash = useCallback((item) => {
    if (!item) return;
    const ta = taRef.current;
    const caret = ta ? ta.selectionStart : caretPosRef.current;
    const start = slashTokenStartRef.current;
    setSlashOpen(false);
    if (item.kind === 'action') {
      const next = value.slice(0, start) + value.slice(caret);
      pendingCaretRef.current = start;
      setValue(next);
      requestAnimationFrame(() => { try { item.run?.(); } catch {  } });
      return;
    }
    const mention = '/' + item.name + ' ';
    const caretAfter = start + mention.length;
    if (ta) { ta.focus(); try { ta.setSelectionRange(start, caret); } catch {  } }
    if (!insertTextWithUndo(mention, caretAfter)) {
      pendingCaretRef.current = caretAfter;
      setValue(value.slice(0, start) + mention + value.slice(caret));
    }
  }, [value]);

  // Focus the textarea after a mode change so screen readers announce the new placeholder.
  const prevTaskModeRef = useRef(taskMode);
  useEffect(() => {
    if (prevTaskModeRef.current === taskMode) return;
    prevTaskModeRef.current = taskMode;
    taRef.current?.focus();
  }, [taskMode]);

  // Apply prefill only after bump > 0 to preserve a saved draft on mount.
  // select highlights a supplied range; append returns queued text to the draft without replacing
  // existing input.
  useEffect(() => {
    if (!prefill || !prefill.bump) return;
    const incoming = prefill.text || '';
    const ta = taRef.current;
    setError('');
    if (prefill.append) {
      // Use the updater to read the latest scoped draft; the effect's value closure can lag after a
      // surface-key change.
      setValue((prev) => {
        const next = prev ? `${prev}\n${incoming}` : incoming;
        // Queue selection after commit; requestAnimationFrame can race React's value update.
        pendingCaretRef.current = [next.length, next.length];
        return next;
      });
      ta?.focus();
      return;
    }
    const text = incoming;
    const sel = Array.isArray(prefill.select) ? prefill.select : [text.length, text.length];
    if (ta && ta.value === text) {
      // Repeated text does not trigger a render, so apply its selection directly.
      ta.focus();
      try { ta.setSelectionRange(sel[0], sel[1]); } catch {}
    } else {
      // Queue selection after commit to avoid clamping against the old textarea value.
      pendingCaretRef.current = sel;
      setValue(text);
      ta?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill?.bump]);

  // Treat only menu popups and trigger pills as inside; clicking the composer textarea must
  // dismiss.
  useEffect(() => {
    if (!openMenu) return undefined;
    const handler = (e) => {
      const t = e.target;
      if (t?.closest?.('.menu')) return;
      // Let trigger clicks toggle themselves or dismissal would race them open again.
      if (t?.closest?.('.meta-pill, .composer-icon')) return;
      setOpenMenu(null);
      setConnectorsOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openMenu]);

  // Reset closed-menu search and focus on open for immediate typing, including mobile.
  useEffect(() => {
    if (openMenu !== 'project') {
      setProjectSearch('');
      setProjectMenuBusy(false);
      setProjectMenuError('');
      return;
    }
    const id = requestAnimationFrame(() => {
      projectSearchRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [openMenu]);

  // The shared outside-click listener needs App.jsx’s main content excluded from Electron’s drag
  // region so mouse events reach it.

  const _projectSearchTrimmed = projectSearch.trim();
  const _filteredProjects = _projectSearchTrimmed
    ? projects.filter((p) => projectMatches(p, _projectSearchTrimmed))
    : projects;
  // An exact case-insensitive match selects the existing project instead of attempting a duplicate
  // create.
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
      if (created) onProjectChange?.(created);
      setOpenMenu(null);
    } catch (e) {
      setProjectMenuError(e?.message || 'Could not create project.');
    } finally {
      setProjectMenuBusy(false);
    }
  };

  const submitProjectSearch = () => {
    if (projectMenuBusy) return;
    // Prefer an exact project match over the first filtered result.
    if (_filteredProjects.length > 0) {
      const pick = _projectExactMatch || _filteredProjects[0];
      onProjectChange?.(pick);
      setOpenMenu(null);
      return;
    }
    if (_canCreateFromSearch) {
      createProjectFromSearch();
    }
  };

  const updateAttachPlacement = () => {
    const anchor = attachAnchorRef.current;
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const measured = attachMenuRef.current?.offsetHeight;
    const reserve = Math.max(measured ?? 0, ATTACH_MENU_TOP_RESERVE_PX) + 24;
    setAttachMenuBelow(r.top < reserve);
  };

  useLayoutEffect(() => {
    if (openMenu !== 'attach') return;
    updateAttachPlacement();
  }, [openMenu, connectorsOpen, busy, disabled]);

  async function handleAttachFiles(files) {
    if (!files?.length || !onAttachFiles) return;
    setError('');
    try {
      await Promise.resolve(onAttachFiles(files));
      setOpenMenu(null);
    } catch (err) {
      setError(err.message || 'Could not attach files.');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function handleAddGoogleDriveFiles() {
    if (!onAddGoogleDriveFiles || gdrivePickerBusy) return;
    setError('');
    setGdrivePickerBusy(true);
    setOpenMenu(null);
    try {
      await Promise.resolve(onAddGoogleDriveFiles(project?.name));
    } catch (err) {
      setError(err.message || 'Could not add Google Drive files.');
    } finally {
      setGdrivePickerBusy(false);
    }
  }

  const { isDragging: filesDragging, dropHandlers: fileDropHandlers } = useFileDrop({
    onFiles: handleAttachFiles,
    disabled: disabled || busy || !onAttachFiles,
  });

  // Attach binary clipboard items; leave plain-text paste to the textarea.
  const handlePaste = (event) => {
    if (disabled || busy || !onAttachFiles) return;
    // Consume the live clipboard event and rename files synchronously so an immediate Enter cannot
    // send before the attachment exists. ENG-1100.
    const files = extractClipboardFiles(event.clipboardData);
    if (!files.length) return;
    event.preventDefault();
    handleAttachFiles(renameClipboardImages(files));
  };

  function pairKey(engine, name) {
    return `${String(engine || '').trim().toLowerCase()}\t${String(name || '').trim()}`;
  }

  function isConnectionDisabled(connector) {
    const k = pairKey(connector.engine, connector.name);
    return (disabledConnections || []).some((d) => pairKey(d.engine, d.name) === k);
  }

  const canMuteConnectors = typeof onUpdateConnectorMute === 'function';

  async function setConnectorUseInChat(connector, useInChat) {
    if (!canMuteConnectors) return;
    setBusy(true);
    setError('');
    try {
      await Promise.resolve(onUpdateConnectorMute(connector, useInChat));
    } catch (err) {
      setError(err?.message || 'Could not update datasource setting.');
    } finally {
      setBusy(false);
    }
  }

  const handleSend = async () => {
    if (disabled || !value.trim()) return;
    setBusy(true);
    try {
      // Use effective selections so a same-tick send cannot include a disabled harness or invalid
      // model. Model applies to every harness;
      // harness defaults to Anton outside coding mode. Preserve onSend’s arity contract described
      // by sendsMeta.
      const result = sendsMeta
        ? onSend(value.trim(), { harness: effectiveHarness, model: effectiveModelId })
        : onSend(value.trim());
      await Promise.resolve(result);
      setValue('');
      // Keep the error visible across failed retries; clear it only after a successful send.
      setError('');
      if (taRef.current) taRef.current.style.height = 'auto';
    } catch (err) {
      setError(err?.message || 'Could not send.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => () => {
    const rec = recognitionRef.current;
    if (rec) { try { rec.abort(); } catch {} }
  }, []);

  return (
    <div ref={wrapRef} {...fileDropHandlers} className="relative w-full max-w-[var(--composer-max-width,_640px)]">
      <FileDropOverlay active={filesDragging} label="Drop files to attach" />
      <input
        ref={fileRef}
        type="file"
        multiple
        hidden
        onChange={(event) => handleAttachFiles(event.target.files)}
      />

      <div className="w-full">
        <div className={`composer-wrap relative${focused ? ' focused' : ''}${inFence ? ' in-fence' : ''}`}>

          {/* Anchor slash commands to the textarea area rather than the toolbar. */}
          {slashOpen && slashItems.length > 0 && (
            <div
              role="listbox"
              aria-label="Skills and actions"
              onMouseDown={(e) => e.preventDefault()}
              className="menu left-0 right-0 max-h-[min(50vh,320px)] overflow-y-auto"
              style={{
                ...(slashMenuBelow
                  ? { top: 'calc(100% + 8px)', bottom: 'auto' }
                  : { top: 'auto', bottom: 'calc(100% + 8px)' }),
                // Inline padding and z-index override legacy .menu rules loaded after Tailwind.
                padding: '4px 0', zIndex: 40,
              }}
            >
              {slashItems.map((item, i) => {
                const active = i === Math.min(slashIndex, slashItems.length - 1);
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={`menu-item${active ? ' !bg-surface-2' : ''}`}
                    onMouseEnter={() => setSlashIndex(i)}
                    onClick={() => acceptSlash(item)}
                  >
                    <span className="inline-flex text-ink-2">
                      {item.kind === 'action' ? Ico.upload(15) : Ico.cube(15)}
                    </span>
                    <span className="flex-1 min-w-0 truncate text-left">
                      {item.label}
                    </span>
                    {item.hint && (
                      <span className="text-ink-3 text-[11.5px] truncate max-w-[46%]">
                        {item.hint}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          {attachments.length > 0 && (
            <div className="attachment-strip">
              {attachments.map((attachment) => (
                <AttachmentChip key={attachment.id} attachment={attachment} onRemove={onRemoveAttachment} />
              ))}
            </div>
          )}

          <div className="composer-input-shell">
            <div
              ref={overlayRef}
              className="composer-textarea-overlay"
              aria-hidden="true"
            >
              <HighlightOverlay text={value} mentionNames={mentionNames} />
            </div>
            <textarea
            ref={taRef}
            className="composer-textarea"
            placeholder={placeholder}
            disabled={disabled}
            value={value}
            onChange={(e) => { setValue(e.target.value); bumpTyping(); refreshSlash(e.target.value, e.target.selectionStart); }}
            onPaste={handlePaste}
            onFocus={() => setFocused(true)}
            onBlur={() => { setFocused(false); setTimeout(() => closeSlash(), 120); }}
            onSelect={(e) => { syncCaret(); refreshSlash(e.target.value, e.target.selectionStart); }}
            onClick={(e) => { syncCaret(); refreshSlash(e.target.value, e.target.selectionStart); }}
            onScroll={handleScroll}
            onKeyDown={(e) => {
              if (disabled) return;

              // Handle slash-menu Enter before send/fence logic so it selects an item.
              if (slashOpen && slashItems.length > 0) {
                const n = slashItems.length;
                const idx = Math.min(slashIndex, n - 1);
                if (e.key === 'ArrowDown') { e.preventDefault(); setSlashIndex((idx + 1) % n); return; }
                if (e.key === 'ArrowUp')   { e.preventDefault(); setSlashIndex((idx - 1 + n) % n); return; }
                if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); acceptSlash(slashItems[idx]); return; }
                if (e.key === 'Escape')    { e.preventDefault(); closeSlash(); return; }
              }
              const ta = e.currentTarget;
              const pos = ta.selectionStart;
              const txt = value;
              const fences = parsedFences.fences;

              if (e.key === 'Enter') {
                // Cmd/Ctrl+Enter always sends, including inside fences or with Shift held.
                if (e.metaKey || e.ctrlKey) {
                  e.preventDefault();
                  handleSend();
                  return;
                }
                if (e.shiftKey) return;

                const ctx = fenceCtxAtParsed(fences, pos);
                if (ctx) {
                  e.preventDefault();
                  if (!insertTextWithUndo('\n', pos + 1)) {
                    pendingCaretRef.current = pos + 1;
                    setValue(txt.slice(0, pos) + '\n' + txt.slice(pos));
                  }
                  return;
                }

                // Enter on a paired closing fence inserts a content line above it and keeps the
                // caret inside the block.
                const lineStart = txt.lastIndexOf('\n', pos - 1) + 1;
                const onCloser = fences.find(
                  (f) => f.char === lineStart && !f.isOpening,
                );
                if (onCloser) {
                  e.preventDefault();
                  ta.selectionStart = ta.selectionEnd = lineStart;
                  if (!insertTextWithUndo('\n', lineStart)) {
                    pendingCaretRef.current = lineStart;
                    setValue(txt.slice(0, lineStart) + '\n' + txt.slice(lineStart));
                  }
                  return;
                }

                // Expand only a fresh opener outside prior unbalanced fences, and match the
                // closer’s backtick count to the opener.
                const lineEndIdx = txt.indexOf('\n', pos);
                const lineEnd = lineEndIdx === -1 ? txt.length : lineEndIdx;
                const currentLine = txt.slice(lineStart, lineEnd);
                const opener = parseOpenerLine(currentLine);
                if (opener && stackEmptyBeforeLine(txt, lineStart)) {
                  e.preventDefault();
                  const closer = '`'.repeat(opener.len);
                  const insertion = '\n\n' + closer;
                  const caretAfter = lineEnd + 1; // empty middle line
                  ta.selectionStart = ta.selectionEnd = lineEnd;
                  if (!insertTextWithUndo(insertion, caretAfter)) {
                    pendingCaretRef.current = caretAfter;
                    setValue(txt.slice(0, lineEnd) + insertion + txt.slice(lineEnd));
                  }
                  return;
                }

                e.preventDefault();
                handleSend();
                return;
              }

              // Escape moves past the paired closing fence, appending a trailing line if needed.
              if (e.key === 'Escape') {
                const ctx = fenceCtxAtParsed(fences, pos);
                if (!ctx) return;
                e.preventDefault();
                const afterClosingNL = txt.indexOf('\n', ctx.close.end);
                if (afterClosingNL === -1) {
                  ta.selectionStart = ta.selectionEnd = txt.length;
                  if (!insertTextWithUndo('\n', txt.length + 1)) {
                    pendingCaretRef.current = txt.length + 1;
                    setValue(txt + '\n');
                  }
                } else {
                  ta.selectionStart = ta.selectionEnd = afterClosingNL + 1;
                  syncCaret();
                }
                return;
              }

              if (e.key === 'ArrowDown') {
                const ctx = fenceCtxAtParsed(fences, pos);
                if (ctx) {
                  const lineEndIdx = txt.indexOf('\n', pos);
                  const lineEnd = lineEndIdx === -1 ? txt.length : lineEndIdx;
                  if (lineEnd >= ctx.contentEnd) {
                    e.preventDefault();
                    const afterClosingNL = txt.indexOf('\n', ctx.close.end);
                    const target = afterClosingNL === -1 ? txt.length : afterClosingNL + 1;
                    ta.selectionStart = ta.selectionEnd = target;
                    syncCaret();
                  }
                }
                return;
              }

              if (e.key === 'ArrowUp') {
                const lineStart = txt.lastIndexOf('\n', pos - 1) + 1;
                if (lineStart === 0) return;
                const prevLineEnd = lineStart - 1;
                const prevLineStart = txt.lastIndexOf('\n', prevLineEnd - 1) + 1;
                const prevLine = txt.slice(prevLineStart, prevLineEnd);
                if (/^`{3,}\s*$/.test(prevLine)) {
                  const idx = fences.findIndex((f) => f.char === prevLineStart);
                  if (idx >= 0 && !fences[idx].isOpening) {
                    e.preventDefault();
                    ta.selectionStart = ta.selectionEnd = prevLineStart - 1;
                    syncCaret();
                  }
                }
                return;
              }
            }}
            rows={1}
            spellCheck={false}
          />
          </div>

          <div className="composer-toolbar">
            <span
              ref={attachAnchorRef}
              className="relative inline-flex items-center"
            >
              <Tooltip content="Add context">
              {/* Native title only while disabled — a disabled button fires no
                  hover/focus events, so the styled Tooltip can't open. */}
              <button
                className="composer-icon"
                aria-label="Add context"
                title={(disabled || busy) ? 'Add context' : undefined}
                disabled={disabled || busy}
                onClick={() => {
                  if (openMenu === 'attach') {
                    setOpenMenu(null);
                    return;
                  }
                  const anchor = attachAnchorRef.current;
                  if (anchor) {
                    const r = anchor.getBoundingClientRect();
                    setAttachMenuBelow(r.top < ATTACH_MENU_TOP_RESERVE_PX + 24);
                  } else setAttachMenuBelow(false);
                  setOpenMenu('attach');
                }}
              >
                {Ico.plus(15)}
              </button>
              </Tooltip>
              {openMenu === 'attach' && (
                <div
                  ref={attachMenuRef}
                  className={`menu left-0${attachMenuBelow ? ' menu--drop-down' : ''}`}
                  style={{
                    // Inline min-width overrides legacy .menu rules loaded after Tailwind.
                    minWidth: 240,
                    ...(attachMenuBelow
                      ? { top: 'calc(100% + 6px)' }
                      : { bottom: 'calc(100% + 6px)' }),
                  }}
                >
                  <button className="menu-item" onClick={() => fileRef.current?.click()}>
                    {Ico.attach(14)} Attach files or photos
                  </button>
                  {onAddGoogleDriveFiles && (
                    <button
                      className="menu-item"
                      onClick={handleAddGoogleDriveFiles}
                      disabled={gdrivePickerBusy}
                    >
                      {Ico.googleDrive(14)} {gdrivePickerBusy ? 'Opening Google Drive…' : 'Add files from Google Drive'}
                    </button>
                  )}
                  <button
                    className="menu-item"
                    onClick={() => setConnectorsOpen((o) => !o)}
                    aria-expanded={connectorsOpen}
                  >
                    {Ico.link(14)}
                    <span className="flex-1">Connectors</span>
                    <span className="inline-flex text-ink-4">
                      {connectorsOpen ? Ico.chevDown(12) : Ico.chevRight(12)}
                    </span>
                  </button>
                  <div
                    className={`menu-connectors-accordion${connectorsOpen ? ' is-open' : ''}`}
                    aria-hidden={!connectorsOpen}
                  >
                    <div className="menu-connectors-accordion__inner">
                      <div
                        className="menu-connectors-accordion__scroll"
                        inert={!connectorsOpen || undefined}
                      >
                        {connectors.length === 0 ? (
                          <div className="py-2 px-[14px] text-sm text-ink-3">
                            No connectors yet. Add one in{' '}
                            {onNavigateToConnectors ? (
                              <button
                                type="button"
                                onClick={navigateToConnectors}
                                className="m-0 p-0 border-0 bg-transparent text-accent [font:inherit] cursor-pointer underline underline-offset-2"
                              >
                                Connect Apps and Data
                              </button>
                            ) : (
                              'Connect Apps and Data'
                            )}
                            .
                          </div>
                        ) : (
                          connectors.map((c) => {
                            const muted = isConnectionDisabled(c);
                            return (
                              <div
                                key={`${c.engine}:${c.name}`}
                                className="menu-item flex-nowrap"
                                style={{
                                  // Inline styles override legacy .menu-item padding/cursor rules
                                  // loaded after Tailwind.
                                  paddingLeft: 12,
                                  paddingRight: 12,
                                  cursor: 'default',
                                }}
                                onMouseDown={(e) => e.stopPropagation()}
                              >
                                <span className="inline-flex text-ink-2 shrink-0">{Ico.link(13)}</span>
                                <span className="flex-[1_1_120px] min-w-0 flex flex-col items-start gap-0.5">
                                  <span className="font-medium">{c.name}</span>
                                  <span className="text-xs text-ink-3">{c.displayName || c.engine}</span>
                                </span>
                                {canMuteConnectors ? (
                                  <button
                                    type="button"
                                    role="switch"
                                    aria-checked={!muted}
                                    aria-label={muted ? `Enable ${c.name} for this chat` : `Disable ${c.name} for this chat`}
                                    className={`toggle shrink-0${!muted ? ' on' : ''}`}
                                    disabled={busy}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setConnectorUseInChat(c, muted);
                                    }}
                                  >
                                    <span className="toggle-thumb" />
                                  </button>
                                ) : null}
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </div>
                  {error && (
                    <div className="py-[6px] px-[14px] text-[12px] text-[var(--danger-600,_#b3261e)]">{error}</div>
                  )}
                </div>
              )}
            </span>
            {taskMode && <TaskModeChip mode={taskMode} onClear={onClearTaskMode} />}
            <div className="flex-1" />
            {/*
 * Model selection has its own lock: modelReadOnly defaults to metaReadOnly to preserve the fixed
 * model on started tasks.
 */}
            {modelReadOnly ? (
              <span className="meta-pill" title="Model is fixed for this task">
                <span>{model?.name ?? 'Model'}</span>
              </span>
            ) : noRealModels ? (
              // Without a real model catalog, take users to provider settings instead of offering
              // only Model Router.
              <Tooltip content="Connect a provider in Settings to choose a model">
                <button
                  type="button"
                  className="meta-pill"
                  onClick={() => onOpenSettings('agent')}
                >
                  <span className="flex items-center gap-[8px] min-w-0">
                    <ProviderIcon maker="other" className="text-ink-2" />
                    <span className="truncate">{MODEL_ROUTER_LABEL}</span>
                  </span>
                  <span className="inline-flex shrink-0 text-ink-3">
                    {Ico.settings(13)}
                  </span>
                </button>
              </Tooltip>
            ) : (
              <ModelSelect
                // Leave invalid selections empty, such as Model Router after switching to Claude
                // Code.
                value={modelPickerOptions.some((o) => o.value === model?.id) ? model.id : ''}
                onValueChange={(id) => {
                  const found = modelPickerOptions.find((o) => o.value === id);
                  onModelChange({ id, name: found?.label || id });
                }}
                open={modelMenuOpen}
                onOpenChange={(open) => { setModelMenuOpen(open); if (open) openModelMenu(); }}
                options={modelPickerOptions}
                variant="unstyled"
                className="meta-pill"
                ariaLabel="Choose model"
                placeholder="Select model"
                modelEfforts={modelMeta?.modelEfforts}
                effort={effort}
                onEffortChange={onEffortChange}
                harness={effortHarness}
              />
            )}
            {/* Voice input is not wired through Anton yet. */}
            {streaming && onStop ? (
              <Tooltip content="Stop generation">
              <button
                className="send-btn stop"
                onClick={onStop}
                aria-label="Stop generation"
                style={{
                  // Inline styles and hover handlers override legacy .send-btn rules loaded after
                  // Tailwind.
                  background: 'var(--danger-bg)',
                  color: 'var(--danger)',
                  border: '1px solid color-mix(in srgb, var(--danger) 35%, transparent)',
                  boxShadow: 'none',
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.background = 'var(--danger)';
                  e.currentTarget.style.color = '#fff';
                  e.currentTarget.style.borderColor = 'var(--danger)';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.background = 'var(--danger-bg)';
                  e.currentTarget.style.color = 'var(--danger)';
                  e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--danger) 35%, transparent)';
                }}
              >
                {Ico.stop(14)}
              </button>
              </Tooltip>
            ) : (
              <Tooltip content="Send">
                <button
                  className="send-btn"
                  disabled={disabled || !value.trim() || busy}
                  onClick={handleSend}
                  aria-label="Send"
                  title={(disabled || !value.trim() || busy) ? 'Send' : undefined}
                >
                  {Ico.send(15)}
                </button>
              </Tooltip>
            )}
          </div>
        </div>
      </div>

      {!hideMeta && (
        <div className="meta-row">
          {metaReadOnly ? (
            <>
              <span className="meta-pill" title="Project is fixed for this task">
                {Ico.folder(14)}
                <span>{project ? projectLabel(project) : 'No project'}</span>
              </span>
            </>
          ) : (
            <>
              {/*
 * Anchor the absolute menu to the pill so it opens directly above the pill rather than above the
 * whole composer.
 */}
              <span
                className="relative inline-flex"
              >
                <Tooltip content="Choose project">
                  <button
                    ref={projectPillRef}
                    className="meta-pill"
                    aria-label="Choose project"
                    onClick={() => setOpenMenu(openMenu === 'project' ? null : 'project')}
                  >
                    {Ico.folder(14)}
                    <span>{project ? projectLabel(project) : 'Work in a project'}</span>
                    <span className="inline-flex text-ink-4">{Ico.chevDown(13)}</span>
                  </button>
                </Tooltip>

                {openMenu === 'project' && !metaReadOnly && (
                  <div
                    ref={projectMenuRef}
                    // This menu opens only on home/project composers; the bottom-docked chat
                    // composer hides it.
                    className="menu menu--drop-down left-0 top-[calc(100%_+_6px)] max-h-[min(60vh,360px)] flex flex-col overflow-hidden"
                    style={{
                      // Inline min-width must override legacy .menu CSS declared after Tailwind.
                      minWidth: 260,
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
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
                              else setOpenMenu(null);
                            }
                          }}
                          className="flex-1 min-w-0 bg-transparent border-0 outline-none text-ink text-[13px]"
                        />
                      </div>
                    </div>

                    <div
                      className="project-menu-list flex-1 min-h-0 overflow-y-auto py-0.5 px-0"
                    >
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
                          onClick={() => { onProjectChange(p); setOpenMenu(null); }}
                        >
                          <span className="inline-flex text-ink-2">{Ico.folder(14)}</span>
                          <span className="flex-1 truncate">{projectLabel(p)}</span>
                          {project?.name === p.name && <span className="text-[var(--primary-700)]">{Ico.check(14)}</span>}
                        </button>
                      ))}
                    </div>

                    {/* Keep creation discoverable with an empty query; hide exact matches to prevent duplicates. */}
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
                              setOpenMenu(null);
                              setNewProjectOpen(true);
                            }
                          }}
                          // Inline color must override legacy .menu-item CSS declared after
                          // Tailwind.
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
            </>
          )}

          {/*
 * Harness choice requires desktop capability as well as the account-wide coding setting.
 * Filter options by current per-harness enablement.
 */}
          {codingModeEnabled && !host.isWeb && harnessPickerOptions.length > 0 && (
            <ToggleGroup
              value={codingHarness}
              onValueChange={setCodingHarness}
              aria-label="Choose harness"
              size="sm"
              options={harnessPickerOptions}
            />
          )}
        </div>
      )}

      {/* Portal beyond boot-fadein: its persistent transform would anchor a fixed overlay to the composer. */}
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
              // The project exists; a list-refresh failure must not prevent selecting it by name.
            }
            onProjectChange?.(created);
          }}
        />,
        document.body,
      )}
    </div>
  );
}
