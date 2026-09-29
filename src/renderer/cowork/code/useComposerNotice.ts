import { useEffect, useState } from 'react';
import { pickNotice, type ComposerNotice } from './composerNotices';


/**
 * Chooses the one notice the composer lip shows. Candidates arrive in
 * priority order; the first one the user has not dismissed wins, and "+N"
 * steps through the rest.
 *
 * A dismissal lasts only while its notice is present. Once an error clears,
 * the same message failing again is a new occurrence and shows again.
 * Switching task (`scope`) clears dismissals and the stepped-to notice.
 */
export function useComposerNotice(candidates: Array<ComposerNotice | null | undefined>, scope: string | null) {
  const present = candidates.filter((notice): notice is ComposerNotice => !!notice);
  const presentKeys = present.map((notice) => notice.key).join('\n');
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  const [steppedTo, setSteppedTo] = useState<string | null>(null);
  useEffect(() => {
    setDismissed(new Set());
    setSteppedTo(null);
  }, [scope]);
  useEffect(() => {
    const keys = new Set(presentKeys.split('\n'));
    setDismissed((current) => {
      const kept = [...current].filter((key) => keys.has(key));
      return kept.length === current.size ? current : new Set(kept);
    });
    // A new or resolved notice changes the order, so the top one leads again.
    setSteppedTo(null);
  }, [presentKeys]);

  const visible = present.filter((notice) => !dismissed.has(notice.key));
  const notice = visible.find((candidate) => candidate.key === steppedTo) || pickNotice(present, dismissed);
  const index = notice ? visible.indexOf(notice) : -1;
  return {
    notice,
    /** How many other notices wait behind the one shown. */
    more: Math.max(0, visible.length - 1),
    showNext: () => { if (visible.length > 1) setSteppedTo(visible[(index + 1) % visible.length].key); },
    dismiss: (key: string) => setDismissed((current) => new Set(current).add(key)),
  };
}
