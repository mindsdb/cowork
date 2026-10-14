/* FigureMark — one figure (number) in a finished answer, marked with where it
   came from (lib/figureSources). MarkdownContent renders one for each figure
   remarkFigureSources placed.

   A sourced figure gets a quiet dotted underline; a figure no step returned
   gets an amber one. Hover or keyboard focus shows the tooltip, and the same
   words are the button's accessible name, so a screen reader hears
   "No source" as well. When a step of this turn holds the figure, a click (or
   Enter) opens that step in the scratchpad; otherwise a click keeps the
   tooltip open and nothing else happens. */

import { Tooltip } from '../ui';
import { figureSourceText } from '../../lib/figureSources';

export function FigureMark({ figure, onOpenStep = null, children }) {
  const description = figureSourceText(figure);
  const open = onOpenStep && figure.stepId ? () => onOpenStep(figure.stepId) : null;
  const className = [
    'anton-figure',
    figure.origin === 'none' ? 'anton-figure--unsourced' : '',
    open ? 'anton-figure--opens-step' : '',
  ].filter(Boolean).join(' ');
  return (
    <Tooltip content={description} side="top" sideOffset={6} closeOnClick={!!open}>
      <button
        type="button"
        className={className}
        aria-label={`${figure.text}, ${description}`}
        onClick={open || undefined}
      >
        {children}
      </button>
    </Tooltip>
  );
}
