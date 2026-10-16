/* FigureMark — one figure (number) in a finished answer, marked with where it
   came from (lib/figureSources). MarkdownContent renders one for each figure
   remarkFigureSources placed.

   A sourced figure gets a quiet dotted underline; a figure no step returned
   gets a solid amber one (globals.css). The button's accessible name is the
   figure and a short state ("250, from a file", "$30, no source"), and its
   accessible description is the one-line sentence the tooltip shows on hover
   or keyboard focus. A click or Enter opens a popover listing every source:
   what kind it was, the SQL it ran and the requests it made (each with a Copy
   button), and the ways to check it: the file in the file viewer, the web
   page, or the step in the scratchpad. Escape closes the popover and puts
   focus back on the figure.

   An answer can hold hundreds of figures, so each mark is a plain button, and
   it mounts its Base UI tooltip and popover, anchored to that button, only
   while they are open. Inside a table, the table's figures share one tab stop
   and the arrow keys move between them. */

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Popover } from '@base-ui/react/popover';
import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip';
import Ico from '../Icons';
import { Button, OutsidePressLayer } from '../ui';
import { TooltipBubble, tokenDelay } from '../ui/Tooltip';
import { CodeBlock } from '../thinking/CodeBlock';
import { host } from '../../../platform/host';
import { copyText } from '../../lib/clipboard';
import { NO_SOURCE_TEXT, figureSourceText } from '../../lib/figureSources';
import { isArtifactLocalPath, isSafeExternalHref, openMarkdownHref } from './markdownLinks';

/** @typedef {import('../../lib/figureSources').LinkedFigure} LinkedFigure */
/** @typedef {import('../../lib/figureSources').LinkedFigureSource} LinkedFigureSource */

const KIND_LABELS = { query: 'Query', file: 'File', web: 'Web page', memory: 'Memory', step: 'Step' };

/* The short state after the figure in a mark's accessible name. */
const KIND_STATES = { query: 'from a query', file: 'from a file', web: 'from the web', memory: 'from memory', step: 'from a step' };

const TABLE_HINT = 'Arrow keys move between the figures in this table.';

/* How long the tooltip stays after the pointer leaves the figure, so the
   pointer can cross onto the tooltip without it closing. */
const TOOLTIP_CLOSE_GRACE_MS = 120;

/** @param {LinkedFigure} figure */
function shortState(figure) {
  if (figure.origin === 'none') return 'no source';
  return KIND_STATES[figure.sources[0]?.kind] || KIND_STATES.step;
}

/* Its own click handler, because MarkdownContent's delegated copy listener
   sits on the answer's root and this popover renders in a portal outside it.
   The button says Copied, or Could not copy, for a moment after a press. */
function CopyButton({ text, label }) {
  const [status, setStatus] = useState(/** @type {'idle' | 'copied' | 'failed'} */ ('idle'));
  useEffect(() => {
    if (status === 'idle') return undefined;
    const timer = setTimeout(() => setStatus('idle'), 1200);
    return () => clearTimeout(timer);
  }, [status]);
  const said = { idle: label, copied: 'Copied', failed: 'Could not copy' }[status];
  return (
    <Button
      size="xs"
      variant="subtle"
      aria-label={said}
      onClick={() => { copyText(text).then((ok) => setStatus(ok ? 'copied' : 'failed')); }}
    >
      {status === 'copied' ? Ico.check(12) : Ico.copy(12)}
      {status === 'idle' ? 'Copy' : said}
    </Button>
  );
}

/* A request is one line of text, so it wraps; SQL keeps its own lines. */
function Snippet({ caption, code, language, copyLabel, wrap = false }) {
  return (
    <div className="mt-2">
      <div className="flex items-center justify-between mb-1">
        <span className="section-label">{caption}</span>
        <CopyButton text={code} label={copyLabel} />
      </div>
      <div className="overflow-hidden rounded-md border border-solid border-line">
        <CodeBlock code={code} language={language} maxHeight={160} wrap={wrap} />
      </div>
    </div>
  );
}

/* A web source's address, under the rules an answer's own links follow
   (markdownLinks): only a safe scheme opens, through the host's external
   opener, and on web a loopback address names the agent's machine rather than
   the reader's, so it stays text. */
function SourceLink({ url }) {
  const textClass = 'block mt-1 font-[family-name:var(--font-mono)] text-[11.5px] [overflow-wrap:anywhere]';
  if (!isSafeExternalHref(url) || isArtifactLocalPath(url, { web: host.isWeb })) {
    return <span className={`${textClass} text-ink-3`}>{url}</span>;
  }
  return (
    <a
      className={`${textClass} text-accent underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent rounded-sm`}
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => {
        e.preventDefault();
        openMarkdownHref(url);
      }}
    >
      {url}
      <span className="sr-only"> (opens in new window)</span>
    </a>
  );
}

/* View file opens a project file by its path, or a file attached to the
   chat by its files-store id; the caller decides which it can read. */
function SourceItem({ source, onViewFile, onOpenStep }) {
  const kindLabel = KIND_LABELS[source.kind] || KIND_LABELS.step;
  // A memory source's label is "memory", which the kind already says.
  const label = source.label && source.label.toLowerCase() !== kindLabel.toLowerCase() ? source.label : '';
  const viewFile = (source.path || source.attachment_id) && onViewFile ? () => onViewFile(source) : null;
  const openStep = source.stepId && onOpenStep ? () => onOpenStep(source.stepId) : null;
  return (
    <li className="py-3 border-b border-t-0 border-x-0 border-solid border-line last:border-b-0">
      <div className="flex items-baseline gap-2 min-w-0">
        <span className="section-label shrink-0">{kindLabel}</span>
        {label && <span className="min-w-0 truncate text-[13px] font-medium text-ink" title={label}>{label}</span>}
        {source.page != null && <span className="text-[12px] text-ink-3 shrink-0">{`page ${source.page}`}</span>}
      </div>
      {source.url && <SourceLink url={source.url} />}
      {source.queries.map((query, i) => (
        <Snippet key={`query-${i}`} caption="SQL" code={query} language="sql" copyLabel="Copy SQL" />
      ))}
      {source.requests.map((request, i) => (
        <Snippet key={`request-${i}`} caption="Request" code={request} language="text" copyLabel="Copy request" wrap />
      ))}
      {(viewFile || openStep) && (
        <div className="flex flex-wrap gap-2 mt-2">
          {viewFile && <Button size="sm" onClick={viewFile}>{Ico.eye(14)} View file</Button>}
          {openStep && <Button size="sm" variant="subtle" onClick={openStep}>Open step</Button>}
        </div>
      )}
    </li>
  );
}

const STOP_RELEASE_EVENT = 'anton-figure-stop-release';

/* Inside a table, the table's figures share one tab stop: Tab reaches the
   table once, and the arrow keys, Home and End move between its figures in
   reading order. A table answer would otherwise add one tab stop per figure.
   The stop starts on the table's first figure and follows focus. Outside a
   table a mark keeps its own tab stop. */
function useTableTabStop(buttonRef) {
  const [place, setPlace] = useState(/** @type {null | 'stop' | 'rest'} */ (null));
  /* Whether this figure tells the reader about the arrow keys: the first of
     a table's figures, when the table holds another to move to. */
  const [hintsArrowKeys, setHintsArrowKeys] = useState(false);
  useLayoutEffect(() => {
    const table = buttonRef.current?.closest('table');
    if (!table) return;
    const marks = table.querySelectorAll('.anton-figure');
    const first = marks[0] === buttonRef.current;
    setHintsArrowKeys(first && marks.length > 1);
    setPlace(first ? 'stop' : 'rest');
  }, [buttonRef]);
  // The stop hears when another figure of its table takes it.
  useEffect(() => {
    const button = buttonRef.current;
    if (place !== 'stop' || !button) return undefined;
    const release = () => setPlace('rest');
    button.addEventListener(STOP_RELEASE_EVENT, release);
    return () => button.removeEventListener(STOP_RELEASE_EVENT, release);
  }, [buttonRef, place]);

  const tableMarks = (button) => [...(button.closest('table')?.querySelectorAll('.anton-figure') ?? [])];
  const onFocus = (event) => {
    if (place !== 'rest') return;
    for (const other of tableMarks(event.currentTarget)) {
      if (other !== event.currentTarget) other.dispatchEvent(new Event(STOP_RELEASE_EVENT));
    }
    setPlace('stop');
  };
  const onKeyDown = (event) => {
    if (place == null || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const marks = tableMarks(event.currentTarget);
    const at = marks.indexOf(event.currentTarget);
    const to = { ArrowRight: at + 1, ArrowDown: at + 1, ArrowLeft: at - 1, ArrowUp: at - 1, Home: 0, End: marks.length - 1 }[event.key];
    if (to === undefined || to === at || !marks[to]) return;
    event.preventDefault();
    marks[to].focus();
  };
  const tabIndex = place === 'rest' ? -1 : place === 'stop' ? 0 : undefined;
  return { tabIndex, hintsArrowKeys, onFocus, onKeyDown };
}

/* The tooltip opens after the pointer rests on the figure (the app's tooltip
   delay) or on keyboard focus, and closes on leave, blur, a press or Escape.
   The pointer can cross onto the tooltip without closing it. `openedBy` says
   which opened it: 'pointer' or 'keyboard', or null while it is closed. */
function useFigureTooltip() {
  const [openedBy, setOpenedBy] = useState(/** @type {null | 'pointer' | 'keyboard'} */ (null));
  const timer = useRef(/** @type {ReturnType<typeof setTimeout> | null} */ (null));
  const clear = () => {
    if (timer.current != null) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clear, []);
  const after = (ms, next) => {
    clear();
    if (ms <= 0) setOpenedBy(next);
    else timer.current = setTimeout(() => setOpenedBy(next), ms);
  };
  const show = (by) => after(tokenDelay(), by);
  const hide = () => { clear(); setOpenedBy(null); };
  const hideSoon = () => after(TOOLTIP_CLOSE_GRACE_MS, null);
  return {
    open: openedBy != null,
    openedBy,
    hide,
    triggerProps: {
      onPointerEnter: (event) => { if (event.pointerType === 'mouse') show('pointer'); },
      onPointerLeave: (event) => { if (event.pointerType === 'mouse') hideSoon(); },
      onFocus: (event) => {
        let keyboard = true;
        try { keyboard = event.currentTarget.matches(':focus-visible'); } catch { /* no :focus-visible support */ }
        if (keyboard) show('keyboard');
      },
      onBlur: hide,
    },
    bubbleProps: { onPointerEnter: clear, onPointerLeave: hideSoon },
  };
}

/**
 * @param {{
 *   figure: LinkedFigure,
 *   onOpenStep?: ((stepId: string) => void) | null,
 *   onViewFile?: ((source: LinkedFigureSource) => void) | null,
 *   children?: import('react').ReactNode,
 * }} props
 */
export function FigureMark({ figure, onOpenStep = null, onViewFile = null, children }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef(/** @type {HTMLButtonElement | null} */ (null));
  const popupId = useId();
  const tooltip = useFigureTooltip();
  const tableStop = useTableTabStop(buttonRef);

  const sentence = figureSourceText(figure);
  /* The arrow-key hint is for a keyboard user: a screen reader hears it in
     the description, and a sighted one reads it in the tooltip focus opens.
     The tooltip a mouse opens shows the sentence alone. */
  const description = tableStop.hintsArrowKeys
    ? `${sentence}${/[.!?]$/.test(sentence) ? '' : '.'} ${TABLE_HINT}`
    : sentence;
  const className = figure.origin === 'none' ? 'anton-figure anton-figure--unsourced' : 'anton-figure';
  const setPopover = (next) => {
    tooltip.hide();
    setOpen(next);
  };
  // Each action leaves the popover first, so the viewer it opens is on top.
  const closeThen = (action) => (action ? (arg) => { setOpen(false); action(arg); } : null);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={className}
        aria-label={`${figure.text}, ${shortState(figure)}`}
        aria-description={description}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popupId : undefined}
        data-popup-open={open ? '' : undefined}
        tabIndex={tableStop.tabIndex}
        onClick={() => setPopover(!open)}
        onPointerEnter={tooltip.triggerProps.onPointerEnter}
        onPointerLeave={tooltip.triggerProps.onPointerLeave}
        onFocus={(event) => {
          tableStop.onFocus(event);
          tooltip.triggerProps.onFocus(event);
        }}
        onBlur={tooltip.triggerProps.onBlur}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && tooltip.open) tooltip.hide();
          tableStop.onKeyDown(event);
        }}
      >
        {children}
      </button>
      {tooltip.open && !open && (
        <BaseTooltip.Root open onOpenChange={(next) => { if (!next) tooltip.hide(); }}>
          <TooltipBubble anchor={buttonRef} side="top" sideOffset={6} {...tooltip.bubbleProps}>
            {tooltip.openedBy === 'keyboard' ? description : sentence}
          </TooltipBubble>
        </BaseTooltip.Root>
      )}
      {/* Clicks inside an artifact preview's iframe never reach Base UI's
          parent-document listener. See OutsidePressLayer. */}
      {open && (
        <OutsidePressLayer
          data-testid="figure-sources-outside-dismiss"
          onPress={() => setOpen(false)}
          zIndex={89}
        />
      )}
      {open && (
        <Popover.Root open onOpenChange={(next) => { if (!next) setOpen(false); }}>
          <Popover.Portal>
            <Popover.Positioner
              anchor={buttonRef}
              side="bottom"
              align="start"
              sideOffset={6}
              collisionPadding={12}
              style={{ zIndex: 90 }}
            >
              {/* The popup is as wide as its content, from 240px up to 440px,
                  and a label past that ends in an ellipsis with the whole name
                  on hover. Base UI measures the room beside the figure as
                  --available-height, so on a phone or at 200% zoom the popup
                  shrinks to fit and its list scrolls (the app's page never
                  does). */}
              <Popover.Popup
                id={popupId}
                finalFocus={buttonRef}
                className="bg-surface rounded-[14px] shadow-sh-popup overflow-hidden outline-none font-body flex flex-col"
                style={{
                  width: 'max-content',
                  minWidth: 'min(240px, 92vw)',
                  maxWidth: 'min(440px, 92vw)',
                  maxHeight: 'min(520px, 70vh, var(--available-height, 520px))',
                }}
              >
                <Popover.Title className="m-0 py-3 px-4 shrink-0 text-[13px] font-semibold leading-[1.4] text-ink border-b border-t-0 border-x-0 border-solid border-line">
                  {`Where ${figure.text} came from`}
                </Popover.Title>
                {figure.origin === 'none' ? (
                  <p className="m-0 py-3 px-4 min-h-0 overflow-y-auto overscroll-contain text-[13px] leading-[1.5] text-ink-2">{NO_SOURCE_TEXT}</p>
                ) : (
                  <ul className="list-none m-0 px-4 min-h-0 overflow-y-auto overscroll-contain">
                    {figure.sources.map((source, i) => (
                      <SourceItem
                        key={`${source.tool_use_id}-${i}`}
                        source={source}
                        onViewFile={closeThen(onViewFile)}
                        onOpenStep={closeThen(onOpenStep)}
                      />
                    ))}
                  </ul>
                )}
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
      )}
    </>
  );
}
