/* FigureMark — one figure (number) in a finished answer, marked with where it
   came from (lib/figureSources). MarkdownContent renders one for each figure
   remarkFigureSources placed.

   A sourced figure gets a quiet dotted underline; a figure no step returned
   gets an amber one. Hover or keyboard focus shows a one-line tooltip, and the
   same words are the button's accessible name, so a screen reader hears
   "No source" as well. A click or Enter opens a popover listing every source:
   what kind it was, the SQL it ran and the requests it made (each with a Copy
   button), and the ways to check it: the project file in the file viewer, the
   web page, or the step in the scratchpad. Escape closes the popover and puts
   focus back on the figure. */

import { useEffect, useState } from 'react';
import { Popover } from '@base-ui/react/popover';
import Ico from '../Icons';
import { Button, OutsidePressLayer, Tooltip } from '../ui';
import { CodeBlock } from '../thinking/CodeBlock';
import { host } from '../../../platform/host';
import { copyText } from '../../lib/clipboard';
import { NO_SOURCE_TEXT, figureSourceText } from '../../lib/figureSources';
import { isArtifactLocalPath, isSafeExternalHref, openMarkdownHref } from './markdownLinks';

const KIND_LABELS = { query: 'Query', file: 'File', web: 'Web page', memory: 'Memory', step: 'Step' };

/* Its own click handler, because MarkdownContent's delegated copy listener
   sits on the answer's root and this popover renders in a portal outside it. */
function CopyButton({ text, label }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <Button
      size="xs"
      variant="subtle"
      aria-label={copied ? 'Copied' : label}
      onClick={() => { copyText(text).then((ok) => { if (ok) setCopied(true); }); }}
    >
      {copied ? Ico.check(12) : Ico.copy(12)}
      {copied ? 'Copied' : 'Copy'}
    </Button>
  );
}

function Snippet({ caption, code, language, copyLabel }) {
  return (
    <div className="mt-2">
      <div className="flex items-center justify-between mb-1">
        <span className="section-label">{caption}</span>
        <CopyButton text={code} label={copyLabel} />
      </div>
      <div className="overflow-hidden rounded-md border border-solid border-line">
        <CodeBlock code={code} language={language} maxHeight={160} />
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

function SourceItem({ source, onViewFile, onOpenStep }) {
  const kindLabel = KIND_LABELS[source.kind] || KIND_LABELS.step;
  // A memory source's label is "memory", which the kind already says.
  const label = source.label && source.label.toLowerCase() !== kindLabel.toLowerCase() ? source.label : '';
  const viewFile = source.path && onViewFile ? () => onViewFile(source.path) : null;
  const openStep = source.stepId && onOpenStep ? () => onOpenStep(source.stepId) : null;
  return (
    <li className="py-3 border-b border-t-0 border-x-0 border-solid border-line last:border-b-0">
      <div className="flex items-baseline gap-2 min-w-0">
        <span className="section-label shrink-0">{kindLabel}</span>
        {label && <span className="text-[13px] font-medium text-ink [overflow-wrap:anywhere]">{label}</span>}
        {source.page != null && <span className="text-[12px] text-ink-3 shrink-0">{`page ${source.page}`}</span>}
      </div>
      {source.url && <SourceLink url={source.url} />}
      {source.queries.map((query, i) => (
        <Snippet key={`query-${i}`} caption="SQL" code={query} language="sql" copyLabel="Copy SQL" />
      ))}
      {source.requests.map((request, i) => (
        <Snippet key={`request-${i}`} caption="Request" code={request} language="text" copyLabel="Copy request" />
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

export function FigureMark({ figure, onOpenStep = null, onViewFile = null, children }) {
  const [open, setOpen] = useState(false);
  const description = figureSourceText(figure);
  const className = figure.origin === 'none' ? 'anton-figure anton-figure--unsourced' : 'anton-figure';
  // Each action leaves the popover first, so the viewer it opens is on top.
  const closeThen = (action) => (action ? (arg) => { setOpen(false); action(arg); } : null);
  return (
    <>
      {/* Clicks inside an artifact preview's iframe never reach Base UI's
          parent-document listener. See OutsidePressLayer. */}
      {open && (
        <OutsidePressLayer
          data-testid="figure-sources-outside-dismiss"
          onPress={() => setOpen(false)}
          zIndex={89}
        />
      )}
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Tooltip content={description} side="top" sideOffset={6}>
          <Popover.Trigger
            render={(
              <button type="button" className={className} aria-label={`${figure.text}, ${description}`}>
                {children}
              </button>
            )}
          />
        </Tooltip>
        <Popover.Portal>
          <Popover.Positioner side="bottom" align="start" sideOffset={6} collisionPadding={12} style={{ zIndex: 90 }}>
            <Popover.Popup
              className="bg-surface rounded-[14px] shadow-sh-popup overflow-hidden outline-none font-body flex flex-col"
              style={{ width: 'min(440px, 92vw)', maxHeight: 'min(520px, 70vh)' }}
            >
              <Popover.Title className="s-h3 m-0 py-3 px-4 border-b border-t-0 border-x-0 border-solid border-line">
                {`Where ${figure.text} came from`}
              </Popover.Title>
              {figure.origin === 'none' ? (
                <p className="m-0 py-3 px-4 text-[13px] leading-[1.5] text-ink-2">{NO_SOURCE_TEXT}</p>
              ) : (
                <ul className="list-none m-0 px-4 overflow-y-auto">
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
    </>
  );
}
