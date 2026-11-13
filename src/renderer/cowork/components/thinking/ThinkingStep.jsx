// One row inside the expanded ThinkingBlock. Vertical-line "rail" on
// the left, icon, label, optional duration on the right.
//
// Adapted from mdb-ai's ThinkingStep.jsx — without jotai. We don't need
// the side-panel scratchpad navigation here either; click handling is
// delegated via onActivate, which the parent can wire up when ready.

import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { StepIcon } from './StepIcon';
import { useTypedText } from './FirstTake';
import { stepDisplayLabel } from '../../lib/responseStreamAdapter';
import i18n, { useTranslation } from '../../../lib/i18n';
import { MarkdownContent } from '../markdown/MarkdownContent';
import { BROWSER_APPROVAL_BADGE } from '../../lib/browserStepPrompt';
import BrowserStepPills from '../BrowserStepPills';

const DOT_FRAMES = ['.', '..', '...', '..', '.'];
function TextDots() {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setIdx((i) => (i + 1) % DOT_FRAMES.length), 400);
    return () => clearInterval(id);
  }, []);
  // Match the step label's 12.5px. Without an explicit size the dots
  // inherit the 16px body font-size, which makes an in-progress row's line
  // box ~5px taller than the same row once it settles (label 12.5px) — so
  // the block visibly jumps every time a step starts or finishes. Sizing
  // the dots to the label keeps the row height constant across states.
  return <span className="inline-block w-5 text-ink-4 text-[12.5px] leading-[1.5]">{DOT_FRAMES[idx]}</span>;
}

function formatStepDuration(startedAt, completedAt) {
  if (!startedAt || !completedAt) return null;
  const seconds = Math.floor((completedAt - startedAt) / 1000);
  if (seconds < 60) return i18n.t('duration.seconds', { ns: 'chat', seconds });
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return i18n.t('duration.minutesSeconds', { ns: 'chat', minutes: m, seconds: s });
}

// The opening Note's stand-in phrase types out like streamed text would.
function TypedStandIn({ text }) {
  return useTypedText(text);
}

/** A live Note's text with its half-written markers settled, so it never
 *  shows raw markdown mid-stream (ENG-4195). MarkdownContent's
 *  `complete={false}` only fades words in; a `**bold` whose closing `**`
 *  hasn't arrived would otherwise read as literal asterisks until it does.
 *  An open code fence or code span is closed, an open `**` is closed (or
 *  dropped when nothing follows it yet), and a lone trailing `*` (the first
 *  half of a `**`) is dropped. */
export function settleLiveNote(text) {
  const src = String(text || '').trimEnd();
  if (((src.match(/^[ \t]*```/gm) || []).length) % 2) return `${src}\n\`\`\``;
  // Code blocks and code spans hold their asterisks as code: leave them out.
  const prose = src.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  if (((prose.match(/`/g) || []).length) % 2) {
    return src.endsWith('`') ? src.slice(0, -1).trimEnd() : `${src}\``;
  }
  if (((prose.match(/\*\*/g) || []).length) % 2) {
    return src.endsWith('**') ? src.slice(0, -2).trimEnd() : `${src}**`;
  }
  if (/(^|[^*])\*$/.test(src)) return src.slice(0, -1).trimEnd();
  return src;
}

// A Note is Anton's own text between steps (ENG-3554), written in markdown:
// render it at the step rows' size, in the row's colour (ENG-4195). A live
// Note streams with `complete={false}` and its open markers settled.
function NoteText({ text, live }) {
  return (
    <div className={clsx('min-w-0', live ? 'text-ink' : 'text-ink-3')}>
      <MarkdownContent
        text={live ? settleLiveNote(text) : text}
        size="steps"
        complete={!live}
        isAssistant
        softBreaks
        enableForms={false}
        enableCharts={false}
      />
    </div>
  );
}

export function ThinkingStep({
  step,
  isFirst = false,
  isLast = false,
  onActivate,
}) {
  const { t } = useTranslation('chat');
  const isInProgress = step.status === 'in_progress';
  const isNote = step.badge === 'Note';
  const duration = formatStepDuration(step.startedAt, step.completedAt);
  const [errorDotFaded, setErrorDotFaded] = useState(false);

  return (
    <div
      className={clsx(
        'group flex gap-1.5',
        onActivate && 'cursor-pointer'
      )}
      onClick={onActivate ? () => onActivate(step) : undefined}
    >
      {/* Left rail — vertical line + circular marker. */}
      <div className="flex w-4 flex-col items-center">
        <div className={clsx('w-px flex-1', isFirst ? 'bg-transparent' : 'bg-line-2')} />
        <div
          className={clsx(
            'my-0.5 flex h-4 w-4 flex-none items-center justify-center rounded-full',
            isInProgress ? 'bg-surface-2' : 'bg-surface-2/60'
          )}
        >
          <StepIcon type={step.icon} size={12} />
        </div>
        <div className={clsx('w-px flex-1', isLast ? 'bg-transparent' : 'bg-line-2')} />
      </div>

      {/* Right column — label + meta */}
      <div
        className={clsx(
          'flex min-w-0 flex-1 items-center justify-between rounded-md py-1.5',
          'transition-colors duration-hover group-hover:bg-surface-2/60'
        )}
      >
        <div className="flex min-w-0 items-center gap-1.5 px-1">
          {isNote && !step.standIn ? (
            // A Note shows all of Anton's text rather than cutting it off
            // mid-thought; the colour is the row's, the size the steps'.
            <NoteText text={step.label} live={isInProgress} />
          ) : (
            <span
              className={clsx(
                isNote ? 'whitespace-pre-wrap break-words' : 'truncate',
                'text-[12.5px]',
                isInProgress ? 'text-ink' : 'text-ink-3'
              )}
              title={stepDisplayLabel(step)}
            >
              {step.standIn ? <TypedStandIn text={step.standIn} /> : step.label}
            </span>
          )}
          {isInProgress && <TextDots />}
          {/* A held browser step the person answered: its site and action. */}
          {step.badge === BROWSER_APPROVAL_BADGE && step.data?.pills ? (
            <BrowserStepPills pills={step.data.pills} size="xs" className="shrink" />
          ) : null}
        </div>
        <div className="ml-2 flex flex-none items-center gap-2 pr-1">
          {step.cellStatus === 'timeout' && (
            <span
              className="rounded-md border border-line bg-surface-2 px-1.5 py-px text-[10px] uppercase tracking-wider text-danger"
              title={t('thinking.cellTimedOutTitle')}
            >
              {t('thinking.cellTimedOut')}
            </span>
          )}
          {/* Gone from the layout once it has faded, so nothing is left
              holding the space next to the duration (ENG-4196). */}
          {step.cellStatus === 'error' && !errorDotFaded && (
            <span
              data-testid="step-error-dot"
              className="h-1.5 w-1.5 flex-none rounded-full bg-yellow-400"
              style={{ animation: 'step-error-dot-fade 4s ease-out forwards' }}
              onAnimationEnd={() => setErrorDotFaded(true)}
              title={t('thinking.cellErrorTitle')}
            />
          )}
          {step.badge === 'Artifact' && (
            <span className="rounded-md border border-line bg-surface-2 px-1.5 py-px text-[10px] uppercase tracking-wider text-ink-4">
              {t('thinking.artifactBadge')}
            </span>
          )}
          {/* The duration is always the last, fixed-width slot, empty when
              there is nothing to show, so every row's time sits on the same
              right edge whatever badges come before it (ENG-4196).
              No duration on a tool's step line: fullstack generation runs
              steps in parallel, so "time until the next line" is not how
              long the step took (ENG-2981). */}
          <span data-testid="step-duration" className="w-10 text-right text-[11px] text-ink-4">
            {!isInProgress && duration && step.badge !== 'ToolProgress' ? duration : null}
          </span>
        </div>
      </div>
    </div>
  );
}
