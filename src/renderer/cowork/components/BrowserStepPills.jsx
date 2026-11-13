import Badge from './ui/Badge';
import Ico from './Icons';
import { cn } from '../lib/cn';

/**
 * A held browser step's site and action as two pills (lib/browserStepPrompt.js):
 * the site without its www, its full address on hover, and the action. Each
 * pill truncates rather than widening the card or the step row. With no site
 * (a hand-over on a page with no web address), only the action shows.
 *
 * @param {{ pills: { url: string, site: string, action: string }, size?: 'xs' | 'sm' | 'md', className?: string }} props
 */
export default function BrowserStepPills({ pills, size = 'md', className }) {
  return (
    <span className={cn('inline-flex min-w-0 max-w-full items-center gap-1', className)}>
      {pills.site ? (
        <Badge size={size} icon={Ico.globe(12)} title={pills.url} className="min-w-0 max-w-[45%]">
          <span className="truncate">{pills.site}</span>
        </Badge>
      ) : null}
      <Badge size={size} variant="muted" title={pills.action} className="min-w-0">
        <span className="truncate">{pills.action}</span>
      </Badge>
    </span>
  );
}
