import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  isMovingAlias, isFrozenAlias, hasFrozenVersions, isModelLocked, orderByFamily,
  MODEL_ROUTER_ID, MODEL_ROUTER_LABEL,
} from '../lib/modelCatalog';
import { MODEL_REFRESH_TTL_MS } from '../lib/modelRefresh';
import ModelSelect from './ModelSelect.jsx';
import ProviderIcon from './ProviderIcon.jsx';
import { useFileDrop, FileDropOverlay, extractClipboardFiles } from '../lib/useFileDrop';
import { AttachmentThumbnail } from './AttachmentThumbnail';
import { useSkills } from '../lib/skillsStore';
import { useDraft } from '../hooks/useDraft';
import { host } from '../../platform/host';

// Detect a "/" slash-command token immediately before the caret. Returns the
// token's start index (the "/") and the lowercased query fragment, or null when
// the caret isn't in a slash token. A token starts at the input start or after
// whitespace, so "/" only triggers at a word boundary (not inside a word/path).
function detectSlashToken(text, caret) {
  const before = text.slice(0, Math.max(0, caret));
  const m = before.match(/(^|\s)\/([\w-]*)$/);
  if (!m) return null;
  return { start: caret - m[2].length - 1, query: m[2].toLowerCase() };
}

// Selected task-mode chip in the composer toolbar (ENG-1594). One button —
// the whole chip removes the mode. Both glyphs (mode icon + X) stay in the
// DOM, absolutely stacked, and cross-fade on hover/focus-visible (touch
// pointers show the X permanently — no hover to reveal it), so the swap is
// interruptible and needs no state. Hover styles are gated behind
// (hover:hover) and (pointer:fine) via arbitrary variants; Tailwind's bare
// hover: compiles to plain :hover here, which sticks on touch.
// (Class strings stay whole literals — Tailwind's scanner can't see through
// template interpolation, and a missed candidate fails silently.)
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
  // Pending image uploads carry the original File, so preview it straight
  // from a local object URL (no fetch). Other attachments keep the glyph.
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
  projects,
  models,
  /**
   * Picker metadata: `{modelProviders, modelFamilies, modelEnabled}` from
   * settings. Optional — without it, or when it describes none of the models
   * listed, the menu renders the flat, ungrouped list it always has. That is what
   * a one-item list (ChatView's read-only picker) gets, and what a role pointed at
   * a BYOK provider gets: `modelProviders` is keyed by model id and only ever
   * covers MindsHub's own catalog, so it says nothing about the ids a BYOK role
   * lists even when a MindsHub key is configured.
   */
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
  // Whether the model pill is a fixed label rather than a picker. Defaults
  // to metaReadOnly (ChatView's prior behavior: "model is fixed once a task
  // starts") — ProjectsView overrides this to false since its metaReadOnly
  // is only about locking the project, not the model.
  modelReadOnly = metaReadOnly,
  hideMeta = false,
  // When true, the send button is replaced with a stop button that
  // calls onStop (cancel the in-flight stream + scratchpad).
  streaming = false,
  onStop,
  // Optional — invoked with `true` while the user is actively typing
  // and `false` after a short idle window. The home view uses this
  // to wake up the OrbitMorph from idle while the user is typing.
  onTypingChange,
  // Optional `{ text, bump }`. When `bump` changes, the composer's
  // value resets to `text` and the textarea focuses. Used by Edit-
  // and-resend on prior user messages; bump-based so repeated edits
  // of the same text still re-fill the input.
  prefill = null,
  // Optional — when supplied, the project menu shows a "+ New project"
  // row (opens the "Start a new project" modal; with search text and
  // no match it creates inline). Receives `{ name }` (plus
  // `_alreadyCreated` from the modal path) and is expected to resolve
  // to the created project record; we then call `onProjectChange`
  // with it so the new project is pre-selected for the task being
  // composed. When omitted, the row is hidden.
  onCreateProject = null,
  // Selected task mode (ENG-1594) — when set, a removable chip renders in
  // the toolbar next to the + button. The caller owns the selection state
  // (and the matching placeholder); `onClearTaskMode` removes it.
  taskMode = null,
  onClearTaskMode,
  // Names the surface this composer's unsent text belongs to, so a draft
  // survives navigation (every composer unmounts on route change) and doesn't
  // leak between surfaces. Defaults to the conversation for in-chat replies
  // and to the shared "new task" surface otherwise; the project view passes
  // its own so a per-project draft is separate from the home one.
  draftKey = null,
  // Coding mode (MVP, ENG-1656 follow-up): when true, show a harness pill
  // (Anton / Claude Code) independent of `metaReadOnly` (which only locks
  // the project pill). Model selection is a separate, always-on capability
  // below — it applies to whichever harness is picked, Anton included.
  codingModeEnabled = false,
  // Whether onSend's 2nd argument carries {harness, model}. Must default to
  // false: ChatView's onSend is handleSendInTask(text, queuedAttachments,
  // opts), where position 2 is a real, differently-shaped parameter — an
  // in-flight-turn message queues by storing whatever lands there as the
  // message's `attachments`, so sending a {harness, model} object there
  // silently corrupts the queue (non-array `.attachments`) instead of
  // failing loudly. Only HomeView/ProjectsView's handleSendFromHome uses
  // this position for meta, so only they opt in.
  sendsMeta = false,
  // Opens the Settings modal to a given section (e.g. 'agent') — same
  // callback App.jsx hands every other "Open Settings" affordance. Used by
  // the Model Router row's settings shortcut below.
  onOpenSettings,
  // The account's configured Coding model (Settings → Model Router →
  // Coding model), a raw model id or undefined/empty if never set.
  // Claude Code needs a real, concrete model and can't use Model Router —
  // when the harness pill switches to Claude Code with nothing picked
  // (e.g. no MindsHub session, so the catalog is empty and there's
  // nothing to choose from), this is what gets auto-selected instead of
  // leaving the picker empty and blocking send.
  codingModelDefault,
  // Which harnesses the pill below offers, per Settings → Coding Mode
  // (default true — an account that never visits that setting sees every
  // harness it's otherwise eligible for). Anton has no enable flag — it's
  // the default agent and always offered.
  harnessHermesEnabled = true,
  harnessClaudeCodeEnabled = true,
}) {
  const [value, setValue] = useDraft(draftKey || conversationId || 'new');
  const [focused, setFocused] = useState(false);
  const [openMenu, setOpenMenu] = useState(null);
  const [codingHarness, setCodingHarness] = useState('anton');
  // Detected but not gating: shown as a non-blocking hint on the Claude Code
  // option rather than hiding the picker. A user should be able to configure
  // coding mode (and see what it'd send) regardless of whether detection
  // succeeded on this machine — the actual launch still surfaces a clear
  // "command not found" in the opened terminal if the CLI truly isn't there.
  const [claudeCodeInfo, setClaudeCodeInfo] = useState({ installed: false, path: null });

  useEffect(() => {
    if (!codingModeEnabled) return;
    let cancelled = false;
    host.detectClaudeCode().then((info) => {
      if (!cancelled) setClaudeCodeInfo(info || { installed: false, path: null });
    });
    return () => { cancelled = true; };
  }, [codingModeEnabled]);
  /** Project-picker menu state. The menu is a search-first picker:
      one input at the top filters the project list AND doubles as
      the "+ Create '<typed>'" entry when no results match — same
      pattern as Linear/Notion's command palette, so the user goes
      from "I can't find it" to "make it" without changing surfaces.
      `flipUp` anchors the menu above the pill when there's no room
      below (chat composer glued to the viewport bottom). */
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
  /** True when the caret is currently inside a fenced block. The boolean
      changes much less often than the caret itself, so we track caret
      position in a ref and only set state on the derived flag. */
  const [inFence, setInFence] = useState(false);
  /** "/" slash-command menu: a filterable skill picker above the input.
      `slashTokenStartRef` records the index of the "/" so accept can replace
      the whole "/<frag>" token. Mirrors the project-menu pattern but the
      filter is the composer text itself (no separate search input). */
  const [slashMenuBelow, setSlashMenuBelow] = useState(false);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState('');
  const [slashIndex, setSlashIndex] = useState(0);
  const slashTokenStartRef = useRef(0);
  const { skills: allSkills } = useSkills();
  const taRef = useRef(null);
  /** Mirror element for the source-mode highlight overlay. Sized and
      styled to match the textarea exactly so the overlay aligns with
      the underlying chars; scrollTop is synced from the textarea's
      onScroll so long content scrolls in lockstep. */
  const overlayRef = useRef(null);
  const fileRef = useRef(null);
  const wrapRef = useRef(null);
  /** Caret position the textarea last reported. Updated on input and
      selection events; consumed by handlers that need the live caret
      without a render cycle. */
  const caretPosRef = useRef(0);
  /** Caret position to apply on the NEXT layout-effect pass — used by
      the setValue fallback path when execCommand('insertText') isn't
      available. Gated on that path only so the execCommand branch
      (which manages its own caret) doesn't collide. */
  const pendingCaretRef = useRef(null);
  /** Positioning context for the attach (+) menu — tight box around the + control so the menu aligns with the activator. */
  const attachAnchorRef = useRef(null);
  const attachMenuRef = useRef(null);

  const navigateToConnectors = useCallback(() => {
    setOpenMenu(null);
    setConnectorsOpen(false);
    onNavigateToConnectors?.();
  }, [onNavigateToConnectors]);

  /** Space we want cleared above the + control before opening the menu upward (~menu height + margin). */
  const ATTACH_MENU_TOP_RESERVE_PX = 200;

  // Typing notifier — fires `onTypingChange(true)` on input and
  // `onTypingChange(false)` after ~1s of inactivity. The home view
  // uses this to wake the OrbitMorph from idle while the user is
  // composing. We hold the timer in a ref so re-renders don't reset
  // it. Deliberately not gated on focus — pasting also counts.
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
    // 1-second debounce — once the user pauses for ~1s, signal the
    // host to start the fade-out animation. Resuming typing inside
    // the fade reverses it (the host's CSS transitions handle the
    // mid-flight reversal automatically).
    typingTimerRef.current = setTimeout(() => notifyTyping(false), 1000);
  };
  useEffect(() => () => {
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    // On unmount, bring the orb back to idle if we were the ones who
    // turned it on — otherwise a snapshot stuck in 'thinking' would
    // outlive the component.
    if (wasTypingRef.current) {
      try { onTypingChange?.(false); } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const recognitionRef = useRef(null);

  // All fence-context lookups in this component MUST consume this memoized result.
  // Never call parseFences(value) directly — it walks the full string on every call.
  // Caret and key handlers branch off `parsedFences.fences` instead of reparsing
  // on every keystroke / selection event.
  const parsedFences = useMemo(() => parseFences(value), [value]);

  // Controlled so the Model Router row's settings shortcut can force the
  // popup closed itself — otherwise it lingers open behind the Settings
  // modal the shortcut opens, which reads as a stuck/broken dropdown.
  const [modelMenuOpen, setModelMenuOpen] = useState(false);

  // Don't re-pay the round trip for a menu reopened moments later. -Infinity, not
  // 0: performance.now() is already well past 0 by first render, so a 0 sentinel
  // would read as "refreshed at page load" and skip the first open of the session.
  const modelRefreshedAt = useRef(-Infinity);
  const openModelMenu = useCallback(() => {
    if (!modelMeta?.onRefresh) return;
    if (performance.now() - modelRefreshedAt.current < MODEL_REFRESH_TTL_MS) return;
    modelRefreshedAt.current = performance.now();
    // Fire and forget: the menu opens on the list we already hold and reconciles
    // when the response lands. A click that produces nothing for the length of a
    // network round trip reads as a broken control.
    Promise.resolve(modelMeta.onRefresh()).catch(() => {});
  }, [modelMeta]);

  // Which harnesses the pill offers — Settings → Coding Mode's per-harness
  // enable flags, filtered live. Claude Code's detection hint (installed?)
  // stays a non-blocking title tooltip, not a gate — see claudeCodeInfo above.
  const harnessPickerOptions = useMemo(() => {
    // Anton is always offered — the default agent, with no enable flag.
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

  // If the currently-picked harness gets disabled out from under it (an
  // admin turned it off between page loads, or Coding mode just turned on
  // for the first time), fall back to whatever's still offered rather than
  // silently sending a harness the pill no longer shows as selected.
  useEffect(() => {
    if (!codingModeEnabled || harnessPickerOptions.length === 0) return;
    if (harnessPickerOptions.some((o) => o.value === codingHarness)) return;
    setCodingHarness(harnessPickerOptions[0].value);
  }, [codingModeEnabled, harnessPickerOptions, codingHarness]);

  // Claude Code needs a real, concrete model for its `--model` flag — no
  // auto-routing concept in the CLI — so Model Router is hidden whenever
  // that harness is the one about to send. Computed once, reused by both
  // modelPickerOptions below and the no-real-models render branch further
  // down (which needs it outside the memo).
  // Requires harnessClaudeCodeEnabled too, not just a stale codingHarness
  // value — e.g. an admin disabling it after it was already selected must
  // not leave the composer still routing to it.
  const isClaudeCode = codingModeEnabled && harnessClaudeCodeEnabled && codingHarness === 'claude-code';

  // What actually gets sent (handleSend below) — never the raw codingHarness
  // state directly, so a value that just got disabled (the reset effect
  // above hasn't re-rendered yet, or every harness is disabled) can't slip
  // through as e.g. a stale "claude-code" that would launch the external
  // CLI despite the toggle being off.
  const effectiveHarness = !codingModeEnabled
    ? 'anton'
    : (harnessPickerOptions.some((o) => o.value === codingHarness)
      ? codingHarness
      : (harnessPickerOptions[0]?.value || 'anton'));

  // No provider configured (MindsHub or BYOK) leaves `models` (the real
  // catalog — recommendedModelOptions returns [] for an unconfigured
  // provider) empty. Claude Code still needs its own real model regardless,
  // so this only applies to the Anton-routed picker.
  const noRealModels = !isClaudeCode && (models?.length || 0) === 0 && !!onOpenSettings;

  // Flat options for <ModelSelect> — the same searchable, bounded-height,
  // provider-grouped picker the Settings model rows use (ui/Combobox).
  // ModelSelect groups internally (lib/modelCatalog), so this only builds the
  // per-row tag/provider metadata, mirroring settingsTransform's
  // buildModelOptions so the two pickers can't drift apart again.
  const modelPickerOptions = useMemo(() => {
    const { modelProviders = {}, modelFamilies = {}, modelEnabled = {} } = modelMeta || {};
    const list = models || [];
    const ids = list.map((m) => m.id);
    const byId = new Map(list.map((m) => [m.id, m]));
    const ordered = orderByFamily(ids, modelFamilies).map((id) => byId.get(id));
    // Only tag once something listed is NOT the latest; on an all-moving catalog the
    // tag would sit on every row and distinguish nothing.
    const tagMoving = hasFrozenVersions(ids, modelFamilies);
    const catalogOptions = ordered.map((m) => {
      /*
       * The wallet can't pay for this one, so it can't be picked here either,
       * and `locked` is what puts the "Add credits" button on the row — this
       * menu has no other route to billing, so without it the row names an
       * action it does not offer.
       *
       * The availability map is re-read whenever this menu opens (App.jsx passes
       * the refresh in), so a top-up made in the browser unlocks the row on the
       * next open rather than on a restart. That refresh is what makes disabling
       * safe: without it a user who topped up would find the row still greyed.
       */
      const locked = isModelLocked(modelEnabled, m.id);
      const tag = [
        tagMoving && isMovingAlias(m.id, modelFamilies) ? 'Latest' : '',
        // A frozen version whose head is also listed. An orphan carries no
        // tag: "older version" is a claim relative to a newer one, and with
        // no head present there is nothing for the user to read it against.
        (isFrozenAlias(m.id, modelFamilies) && byId.has(modelFamilies[m.id])) ? 'Older version' : '',
        locked ? 'Needs credits' : '',
      ].filter(Boolean).join(' · ');
      return {
        value: m.id,
        label: m.name,
        disabled: locked,
        ...(locked ? { locked: true } : {}),
        ...(tag ? { tag } : {}),
        ...(modelProviders[m.id] ? { provider: modelProviders[m.id] } : {}),
      };
    });
    // "Model Router" (defer to this account's Settings) leads the list,
    // inside the MindsHub group rather than pinned above every section —
    // `maker: 'mindshub'` is the same escape hatch modelSection() gives an
    // explicit maker over inference, and prepending it here (before any
    // catalog option) keeps it first within that group without needing
    // per-group sorting.
    return isClaudeCode ? catalogOptions : [
      {
        value: MODEL_ROUTER_ID,
        label: MODEL_ROUTER_LABEL,
        maker: 'mindshub',
        title: "Routes to this account's configured model automatically",
        // stopPropagation: a plain click on this row would otherwise also
        // fire Base UI's Combobox.Item select handler (it listens on the
        // row itself), selecting Model Router as a side effect of opening
        // Settings. Closing the popup first (setModelMenuOpen(false))
        // avoids it lingering open behind the Settings modal this opens.
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

  // True once the picked model isn't valid for Claude Code — nothing
  // picked yet, or still Model Router (hidden from the picker once this
  // harness is selected, but the underlying value doesn't change itself).
  const needsClaudeCodeModel = isClaudeCode && (!model?.id || model.id === MODEL_ROUTER_ID);

  // Falls back to the account's configured Coding model (Settings → Model
  // Router → Coding model) so switching to Claude Code with no MindsHub
  // session (empty catalog, nothing to pick) doesn't leave the task
  // unlaunchable — used both to keep the pill in sync (effect below) and
  // as a same-tick safety net in handleSend, in case Send fires before
  // that effect's onModelChange round-trips back down as a prop.
  const effectiveModelId = (needsClaudeCodeModel && codingModelDefault) ? codingModelDefault : model?.id;

  // Sync the visible pill: without this, the picker would show blank (or
  // a stale Model Router label) even though handleSend is about to send
  // the Coding model default underneath it.
  useEffect(() => {
    if (!needsClaudeCodeModel || !codingModelDefault) return;
    const found = modelPickerOptions.find((o) => o.value === codingModelDefault);
    onModelChange({ id: codingModelDefault, name: found?.label || codingModelDefault });
    // onModelChange intentionally omitted: some callers (ChatView) pass a
    // fresh closure every render, which would refire this every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsClaudeCodeModel, codingModelDefault, modelPickerOptions]);

  // Auto-resize the textarea up to a max height; past that it scrolls.
  // The overlay is absolutely positioned with `inset: 0`, so it follows
  // the shell (which sizes to the textarea) automatically — no separate
  // height bookkeeping needed here.
  useEffect(() => {
    if (!taRef.current) return;
    taRef.current.style.height = 'auto';
    taRef.current.style.height = Math.min(220, taRef.current.scrollHeight) + 'px';
  }, [value]);

  // After every commit: apply any pending caret position from the
  // setValue fallback path, then re-derive `inFence` from the current
  // textarea state. Runs before paint (useLayoutEffect) so the visual
  // indicator can't lag a frame behind the caret. Only sets state when
  // the boolean actually flips — flat int updates stay on the ref.
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    if (pendingCaretRef.current != null) {
      const target = pendingCaretRef.current;
      // A [start, end] tuple selects a range (prefill placeholder
      // highlighting); a bare number parks a collapsed caret.
      if (Array.isArray(target)) {
        try { ta.setSelectionRange(target[0], target[1]); } catch { /* out-of-range: skip */ }
      } else {
        ta.selectionStart = ta.selectionEnd = target;
      }
      pendingCaretRef.current = null;
    }
    const pos = ta.selectionStart;
    caretPosRef.current = pos;
    const next = fenceCtxAtParsed(parsedFences.fences, pos) !== null;
    setInFence((prev) => (prev === next ? prev : next));
    // Re-sync overlay scroll after any value change so the freshly
    // re-laid-out overlay matches the textarea's current scrollTop.
    if (overlayRef.current) {
      overlayRef.current.scrollTop = ta.scrollTop;
      overlayRef.current.scrollLeft = ta.scrollLeft;
    }
  });

  // Refresh the caret-position ref + derived inFence flag on selection
  // events. Cheap: an int write to a ref plus a setState that no-ops
  // unless the boolean actually changes. Memoized on `parsedFences` so
  // every invocation closes over the latest cached parse result without
  // forcing a re-parse of `value`.
  const syncCaret = useCallback(() => {
    const ta = taRef.current;
    if (!ta) return;
    const pos = ta.selectionStart;
    caretPosRef.current = pos;
    const next = fenceCtxAtParsed(parsedFences.fences, pos) !== null;
    setInFence((prev) => (prev === next ? prev : next));
  }, [parsedFences]);

  // Mirror the textarea's scroll position onto the overlay so long
  // content stays char-for-char aligned through wheel/keyboard scroll.
  const handleScroll = (e) => {
    const ta = e.currentTarget;
    if (overlayRef.current) {
      overlayRef.current.scrollTop = ta.scrollTop;
      overlayRef.current.scrollLeft = ta.scrollLeft;
    }
  };

  // execCommand('insertText') routes the mutation through the
  // browser's native undo stack, so Cmd+Z reverses just the inserted
  // snippet rather than the whole controlled-textarea state. Falls
  // back to a setValue path (handled by the caller via
  // `pendingCaretRef`) when execCommand returns false — Firefox can be
  // spotty here, especially inside React-controlled textareas, but
  // Chromium/Electron handles it cleanly.
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
      // Future Chromium may throw on the deprecated API. Fall through
      // to the caller's setValue fallback.
    }
    return false;
  };

  // ── "/" slash-command menu ─────────────────────────────────────────
  // Recompute the active slash token from the text + caret. Called on every
  // input/caret change; opens the menu when the caret sits in a "/<frag>"
  // token and closes it otherwise.
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

  // The menu items: a small built-in action row (matching the reference) plus
  // the live skills filtered by the typed fragment. Reads the shared store, so
  // saving/deleting a skill anywhere updates this list with no reload.
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

  // Known skill names — the overlay colours only "/<known-skill>" tokens (not
  // arbitrary slashes like a file path), matching how the sent message tints
  // mentions. Kept as a Set for O(1) membership in the highlighter.
  const mentionNames = useMemo(
    () => new Set((allSkills || []).map((s) => s.label).filter(Boolean)),
    [allSkills],
  );

  // Accept an item: actions run after stripping the "/frag" token; skills are
  // inserted as a plain "/slug " mention (no backticks). The overlay + the sent
  // message colour any "/<known-skill>" token in the brand accent, so the
  // mention reads distinctly without literal backtick characters. Replacement
  // goes through insertTextWithUndo so Cmd+Z reverses it.
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
      requestAnimationFrame(() => { try { item.run?.(); } catch { /* noop */ } });
      return;
    }
    const mention = '/' + item.name + ' ';
    const caretAfter = start + mention.length;
    if (ta) { ta.focus(); try { ta.setSelectionRange(start, caret); } catch { /* noop */ } }
    if (!insertTextWithUndo(mention, caretAfter)) {
      pendingCaretRef.current = caretAfter;
      setValue(value.slice(0, start) + mention + value.slice(caret));
    }
  }, [value]);

  // Task-mode change (select from the pill row or clear via the chip) moves
  // focus into the textarea: the user's next act is typing, and for a screen
  // reader the focus event reads out the freshly-swapped placeholder — the
  // otherwise-silent mode switch gets announced (ENG-1594 review finding).
  const prevTaskModeRef = useRef(taskMode);
  useEffect(() => {
    if (prevTaskModeRef.current === taskMode) return;
    prevTaskModeRef.current = taskMode;
    taRef.current?.focus();
  }, [taskMode]);

  // Edit-and-resend: when ChatView bumps `prefill`, drop the supplied
  // text into the composer and focus the textarea so the user can
  // immediately tweak + send. Guarded on `bump > 0` so the initial
  // `{text: '', bump: 0}` doesn't clobber a draft on mount.
  //
  // Optional `prefill.select = [start, end]` pre-selects that range
  // instead of parking the caret at the end — the home suggestion chips
  // use it to highlight their [type here] placeholder so the first
  // keystroke replaces it.
  //
  // `prefill.append` is the queue-drain case (a question appeared while
  // messages were queued): that text is handed BACK to the user, so it joins
  // the current draft instead of destroying it. Edit-and-resend and the home
  // chips leave `append` unset and keep the replace semantics.
  useEffect(() => {
    if (!prefill || !prefill.bump) return;
    const incoming = prefill.text || '';
    const ta = taRef.current;
    setError('');
    if (prefill.append) {
      // The updater form rather than this effect's `value` closure (deps are
      // only `prefill?.bump`, so it can be a render behind) or `ta.value`:
      // `useDraft` documents the updater as reading `getDraft(key)`, which is
      // current even on the render where the surface key just changed.
      setValue((prev) => {
        const next = prev ? `${prev}\n${incoming}` : incoming;
        // Caret at the end, queued for the post-commit layout effect — setting
        // it via rAF raced React's value commit.
        pendingCaretRef.current = [next.length, next.length];
        return next;
      });
      ta?.focus();
      return;
    }
    const text = incoming;
    const sel = Array.isArray(prefill.select) ? prefill.select : [text.length, text.length];
    if (ta && ta.value === text) {
      // Same text re-prefilled — no re-render coming, so the layout
      // effect won't fire; apply the selection directly.
      ta.focus();
      try { ta.setSelectionRange(sel[0], sel[1]); } catch {}
    } else {
      // Queue the selection for the post-commit layout effect. Setting
      // it via rAF raced React's value commit (the range clamped to the
      // still-empty textarea and collapsed to 0).
      pendingCaretRef.current = sel;
      setValue(text);
      ta?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill?.bump]);

  // Close the open meta-pill menu on any press that isn't on the menu
  // popup itself or a trigger pill. The previous version only closed on
  // presses OUTSIDE the whole composer (`!wrapRef.contains`), which
  // wrongly treated the chat input (also inside the composer) as "inside
  // the menu" — so clicking the textarea left the menu open. Scoping to
  // `.menu` (any popup) + the trigger pills closes it for everything
  // else, the textarea included.
  useEffect(() => {
    if (!openMenu) return undefined;
    const handler = (e) => {
      const t = e.target;
      // Inside the open popup → keep open (items close themselves onClick).
      if (t?.closest?.('.menu')) return;
      // On a trigger pill → let its own onClick toggle it (closing here
      // would race it straight back open).
      if (t?.closest?.('.meta-pill, .composer-icon')) return;
      setOpenMenu(null);
      setConnectorsOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openMenu]);

  // Reset the project menu's transient state every time it closes, and
  // autofocus the search input on open so the user can start filtering
  // immediately (also doubles as "tap-to-type" on mobile where there's
  // no keyboard shortcut to open the menu).
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

  // Outside-click dismissal for every meta-pill menu (project / attach /
  // model) is handled in one place: the wrapRef `mousedown` listener
  // above. It closes whichever menu is open (they share `openMenu`) on a
  // press outside the composer. This works on desktop because the
  // content column (`<main>` in App.jsx) opts out of the window drag
  // region — otherwise Electron would swallow mouse events over the
  // canvas and the press would never reach the listener.

  // Filter + create logic shared by Enter-on-search-input and the
  // explicit create footer. Defined inside the component body so the
  // menu render can call into them without prop-drilling.
  const _projectSearchTrimmed = projectSearch.trim();
  const _filteredProjects = _projectSearchTrimmed
    ? projects.filter((p) => p.name.toLowerCase().includes(_projectSearchTrimmed.toLowerCase()))
    : projects;
  // Case-insensitive exact match short-circuits "create" so Enter on
  // a search term that already names a project selects it rather than
  // POSTing a duplicate (the server would reject anyway, but failing
  // fast on the client keeps the UX snappy).
  const _projectExactMatch = _projectSearchTrimmed
    ? projects.find((p) => p.name.toLowerCase() === _projectSearchTrimmed.toLowerCase())
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
    // Any results → Enter selects the top match (or the exact match
    // when it's not at the top, e.g. an alphabetised list where the
    // exact "acme" sits below "acme-engineering" / "acme-marketing").
    if (_filteredProjects.length > 0) {
      const pick = _projectExactMatch || _filteredProjects[0];
      onProjectChange?.(pick);
      setOpenMenu(null);
      return;
    }
    // Zero results with text → create. Empty search is a no-op
    // (Enter on an empty filter shouldn't do anything surprising).
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

  // Drag OS files onto the composer to attach them to the message.
  const { isDragging: filesDragging, dropHandlers: fileDropHandlers } = useFileDrop({
    onFiles: handleAttachFiles,
    disabled: disabled || busy || !onAttachFiles,
  });

  // Paste (⌘V) an image/gif/file straight into the composer. A <textarea>
  // can't hold binary clipboard data, so without this the paste is a silent
  // no-op. Route any file items to the same attach path as drag-drop and the
  // file picker; a plain-text paste carries no file items and falls through
  // to the textarea's default handling.
  const handlePaste = (event) => {
    if (disabled || busy || !onAttachFiles) return;
    const files = extractClipboardFiles(event.clipboardData);
    if (!files.length) return;
    event.preventDefault();
    handleAttachFiles(files);
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
      // Model selection always rides along (it applies to Anton too, not
      // just coding mode); harness only matters once coding mode is on —
      // otherwise every task is implicitly Anton regardless of local state.
      // See `sendsMeta` above for why this can't unconditionally be onSend's
      // 2nd argument. `effectiveHarness`/`effectiveModelId` (not the raw
      // `codingHarness`/`model?.id`) so a same-tick send can't slip through
      // with a disabled harness or nothing pickable for Claude Code.
      const result = sendsMeta
        ? onSend(value.trim(), { harness: effectiveHarness, model: effectiveModelId })
        : onSend(value.trim());
      await Promise.resolve(result);
      setValue('');
      // Clear the error only AFTER a successful send. Clearing it up
      // front meant a user hammering Send/Enter on a failing send wiped
      // the error before they could read it — the failure looked like a
      // silent no-op.
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

          {/* "/" slash-command menu — anchored to composer-wrap so it appears
              just above/below the textarea, not below the toolbar. */}
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
                // cascade-forced: legacy .menu sets padding:6px + z-index:50;
                // this menu needs 4px/0 padding and z-40, and a same-property
                // Tailwind utility would lose to .menu (loads after Tailwind).
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

              // (S) Slash-command menu: intercept navigation/accept BEFORE the
              // send / fence logic so Enter picks an item instead of sending.
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
                // (A) Cmd/Ctrl+Enter sends from anywhere — including
                // inside a fence and even with Shift held.
                if (e.metaKey || e.ctrlKey) {
                  e.preventDefault();
                  handleSend();
                  return;
                }
                // Shift+Enter: default browser newline.
                if (e.shiftKey) return;

                // Inside a fenced block — Enter inserts a newline, never sends.
                const ctx = fenceCtxAtParsed(fences, pos);
                if (ctx) {
                  e.preventDefault();
                  if (!insertTextWithUndo('\n', pos + 1)) {
                    pendingCaretRef.current = pos + 1;
                    setValue(txt.slice(0, pos) + '\n' + txt.slice(pos));
                  }
                  return;
                }

                // (F) Closing-fence line ergonomics — if the caret is on
                // a paired closing fence line, insert a content line
                // ABOVE the closer and land on it, staying inside the
                // (now-extended) block.
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

                // Auto-expand on a clean opener line, only when the
                // parser's stack would be empty BEFORE this line —
                // i.e. the user is starting a fresh block, not closing
                // or interrupting a prior unbalanced one. Closer
                // length matches the opener's run length so
                // 4-backtick fences pair with 4-backtick closers.
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

                // Default: send.
                e.preventDefault();
                handleSend();
                return;
              }

              // (B) Escape inside a fence — caret jumps to the line
              // right after the closing ```. If there's no line after,
              // append one. No content inserted inside the fence.
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
                    // cascade-forced: legacy .menu sets min-width:200px; a
                    // Tailwind min-w-[240px] utility would lose to it (loads
                    // after Tailwind). top/bottom is state-dependent.
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
                                  // cascade-forced: legacy .menu-item sets
                                  // padding:8px 10px + cursor:pointer; same-
                                  // property Tailwind utilities would lose
                                  // to it (loads after Tailwind).
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
            {/* Model selection lives in the toolbar, next to send — a
                standing composer capability independent of metaReadOnly
                (which only locks the project pill) and of coding mode: it
                applies to whichever harness the task runs with, Anton
                included. Reuses <ModelSelect> — the same searchable,
                bounded-height, provider-grouped picker (ui/Combobox) the
                Settings model rows use — so height/scroll/search behavior
                lives in one place. `modelReadOnly` (defaults to
                `metaReadOnly`) keeps ChatView's existing "model is fixed
                once a task starts" behavior. */}
            {modelReadOnly ? (
              <span className="meta-pill" title="Model is fixed for this task">
                <span>{model?.name ?? 'Model'}</span>
              </span>
            ) : noRealModels ? (
              // No provider connected (MindsHub or BYOK) — `models` (the
              // real catalog, before Model Router gets pinned on) is empty,
              // so Model Router would be the only pickable row anyway. A
              // dropdown with one unpickable-in-practice option reads as
              // broken; show a plain button instead — no caret, since there
              // is nothing to open — that goes straight to where a model
              // actually gets connected.
              <Tooltip content="Connect a provider in Settings to choose a model">
                <button
                  type="button"
                  className="meta-pill"
                  onClick={() => onOpenSettings('agent')}
                >
                  {/* Same left icon + label layout as the closed
                      ModelSelect pill (see ModelSelect.jsx's renderValue) —
                      only the trailing glyph differs (gear, not a caret),
                      so this reads as "the model pill" that happens to open
                      Settings, not as an unrelated control. */}
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
                // Falls back to unselected (rather than a synthesized
                // "model-router" row) if the current pick isn't a valid
                // option right now — e.g. Model Router was picked, then the
                // harness pill switched to Claude Code, which hides it.
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
              />
            )}
            {/* Mic / voice input intentionally hidden — voice flow isn't
                wired through anton yet. We keep speechSupported state
                around so we can reinstate later by re-rendering the
                button (e.g. behind a `showMic` prop). */}
            {streaming && onStop ? (
              <Tooltip content="Stop generation">
              <button
                className="send-btn stop"
                onClick={onStop}
                aria-label="Stop generation"
                style={{
                  // cascade-forced: .send-btn sets background/color/border/
                  // box-shadow at rest AND background on :hover — a same-
                  // property Tailwind utility (or hover: variant) would lose
                  // to it (loads after Tailwind), so this whole block
                  // (incl. the JS hover handlers below) stays inline rather
                  // than becoming hover: classes.
                  //
                  // Theme-aware "stop" treatment — uses the danger token
                  // on a soft tinted surface, with an outline that
                  // intensifies on hover. Matches the chat header
                  // unpublish button so the destructive vocabulary is
                  // consistent across surfaces.
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
                <span>{project ? project.name : 'No project'}</span>
              </span>
            </>
          ) : (
            <>
              {/* Wrap the pill in its own relative anchor so the
                  menu (position: absolute) measures against the pill,
                  not against the composer wrap. Earlier the menu's
                  containing block was the wrap (~the whole composer),
                  so `bottom: calc(100% + 6px)` placed the menu above
                  the ENTIRE composer rather than just above the pill.
                  An inline-block span hugs the pill's box exactly. */}
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
                    <span>{project ? project.name : 'Work in a project'}</span>
                    <span className="inline-flex text-ink-4">{Ico.chevDown(13)}</span>
                  </button>
                </Tooltip>

                {openMenu === 'project' && !metaReadOnly && (
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
                              else setOpenMenu(null);
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
                          <span className="flex-1 truncate">{p.name}</span>
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
                              setOpenMenu(null);
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
            </>
          )}

          {/* Coding mode (MVP): the harness choice itself still gates on the
              setting — offering it at all only makes sense once it's turned
              on. Options come from Settings → Coding Mode's per-harness
              enable flags (harnessPickerOptions above), not a fixed list —
              e.g. Claude Code disappears entirely once its toggle is off,
              same as Hermes when the server doesn't have it installed.
              Model selection above applies regardless of which harness is
              picked. Desktop-only regardless of the setting's value: it's
              an account-wide setting, so a web session for the same account
              would otherwise still see the option — launching a terminal
              is an Electron capability the web build has no equivalent
              for. Same ToggleGroup as the Settings Anton/Hermes control,
              not a dropdown — a segmented toggle reads better for a small,
              always-visible choice. */}
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
            onProjectChange?.(created);
          }}
        />,
        document.body,
      )}
    </div>
  );
}
