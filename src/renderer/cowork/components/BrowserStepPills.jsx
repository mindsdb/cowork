import Badge from './ui/Badge';
import Ico from './Icons';
import { cn } from '../lib/cn';

/* A pill that wraps its text instead of cutting it: a card the person
   answers shows the whole address and action, since a phone can't hover for
   the title. Its height follows its lines. */
const WRAPS = 'h-auto min-h-[22px] whitespace-normal rounded-lg py-0.5 text-left leading-snug';
const WRAPPED_TEXT = '[overflow-wrap:anywhere]';

/**
 * A browser site as a pill: the site without its www, its full address on
 * hover. One line that truncates by default; with `wrap`, its whole text on
 * as many lines as it needs.
 *
 * @param {{ site: string, url?: string, size?: 'xs' | 'sm' | 'md', wrap?: boolean }} props
 */
export function BrowserSitePill({ site, url = site, size = 'md', wrap = false }) {
  return (
    <Badge size={size} icon={Ico.globe(12)} title={url} className={wrap ? cn('min-w-0 max-w-full', WRAPS) : 'min-w-0 max-w-[45%]'}>
      <span className={wrap ? WRAPPED_TEXT : 'truncate'}>{site}</span>
    </Badge>
  );
}

/**
 * A held browser step's site and action as two pills (lib/browserStepPrompt.js):
 * the site without its www, its full address on hover, and the action. Each
 * pill truncates rather than widening the step row; a card the person
 * answers passes `wrap`, so both show whole on as many lines as they need.
 * With no site (a hand-over on a page with no web address), only the action
 * shows.
 *
 * @param {{ pills: { url: string, site: string, action: string }, size?: 'xs' | 'sm' | 'md', className?: string, wrap?: boolean }} props
 */
export default function BrowserStepPills({ pills, size = 'md', className, wrap = false }) {
  return (
    <span className={cn(wrap ? 'flex min-w-0 max-w-full flex-wrap items-center gap-1' : 'inline-flex min-w-0 max-w-full items-center gap-1', className)}>
      {pills.site ? <BrowserSitePill site={pills.site} url={pills.url} size={size} wrap={wrap} /> : null}
      <Badge size={size} variant="muted" title={pills.action} className={wrap ? cn('min-w-0 max-w-full', WRAPS) : 'min-w-0'}>
        <span className={wrap ? WRAPPED_TEXT : 'truncate'}>{pills.action}</span>
      </Badge>
    </span>
  );
}
