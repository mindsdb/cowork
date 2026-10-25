import { useEffect } from 'react';
import { diagnostic } from '../../../shared/diagnostics';
import { useLiveApps } from '../../lib/liveApps';
import { acknowledgeLiveAppAvailability, fetchLiveAppAvailability } from '../api';
import { useToastManager } from '../components/ui/Toast';

const POLL_MS = 15_000;
// Consecutive failed reads double the delay up to this cap. A successful read
// returns to POLL_MS, and focus or a visible tab still reads at once.
const MAX_POLL_MS = 60_000;
const visible = () => document.visibilityState !== 'hidden';

// This effect runs after the toast's text is in the DOM. A response received
// while hidden is never enough to acknowledge a notice: it must be displayed
// in a visible document first. The server keeps it until that acknowledgement.
function AvailabilityMessage({ message, onShown }) {
  useEffect(() => {
    const show = () => { if (visible()) onShown(); };
    show();
    document.addEventListener('visibilitychange', show);
    return () => document.removeEventListener('visibilitychange', show);
  }, [onShown]);
  return message;
}

/** One watcher for the app, independent of the current chat or artifact view. */
export function useLiveAppAvailability(accountScope) {
  const enabled = useLiveApps();
  const { add, close } = useToastManager();

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    let reading = false;
    let readFailed = false;
    let scope = null;
    let current = null;
    let delay = POLL_MS;
    let timer = null;

    const clearNotice = () => {
      if (current) close(current.toastId);
      current = null;
    };

    const acknowledge = async (notice) => {
      if (cancelled || current !== notice || !notice.shown || notice.acknowledged
        || notice.acknowledging || !visible()) return;
      notice.acknowledging = true;
      try {
        await acknowledgeLiveAppAvailability(notice.id);
        notice.acknowledged = true;
      } catch (error) {
        if (!cancelled && !notice.ackFailed) {
          diagnostic('live-app-availability', 'WARNING', 'acknowledgement_failed', error);
          notice.ackFailed = true;
        }
        // The notice stays visible and the next poll retries. In particular,
        // a lost acknowledgement reply must not create another toast.
      } finally {
        notice.acknowledging = false;
      }
    };

    const load = async () => {
      if (cancelled || reading || !visible()) return;
      reading = true;
      try {
        const next = await fetchLiveAppAvailability();
        if (cancelled) return;
        readFailed = false;
        delay = POLL_MS;
        // Proxy-authenticated deployments may have no browser access token.
        // /live-apps/availability supplies the authoritative identity scope.
        if (scope !== next.scope) {
          clearNotice();
          scope = next.scope;
        }
        // Waiting with no notice means a later refusal replaced the one this
        // toast announced. Close it so the next notice is visibly new. An
        // unacknowledged notice stays until its acknowledgement succeeds.
        if (next.waiting && !next.notice && current?.acknowledged) clearNotice();
        if (!visible()) return;
        if (next.notice && current?.id !== next.notice.id) {
          clearNotice();
          const notice = {
            id: next.notice.id,
            toastId: `live-app-availability:${scope}:${next.notice.id}`,
            shown: false,
            acknowledging: false,
            acknowledged: false,
            ackFailed: false,
          };
          current = notice;
          add({
            id: notice.toastId,
            title: <AvailabilityMessage message={next.notice.message} onShown={() => {
              if (cancelled || current !== notice) return;
              notice.shown = true;
              void acknowledge(notice);
            }} />,
            timeout: 0,
          });
        }
        if (current) await acknowledge(current);
      } catch (error) {
        delay = Math.min(delay * 2, MAX_POLL_MS);
        if (!cancelled && !readFailed && error?.status !== 401 && error?.status !== 404) {
          diagnostic('live-app-availability', 'WARNING', 'availability_read_failed', error);
          readFailed = true;
        }
        // An unavailable read is no evidence that a pending notice disappeared.
        // A signed-out response does invalidate the previous person's toast.
        if (!cancelled && error?.status === 401) {
          clearNotice();
          scope = null;
        }
      } finally {
        reading = false;
      }
    };

    // One pending timer at a time: each read schedules the next with the
    // current delay, replacing any timer an overlapping read left.
    const poll = async () => {
      await load();
      if (cancelled) return;
      clearTimeout(timer);
      timer = setTimeout(poll, delay);
    };
    const refresh = () => {
      clearTimeout(timer);
      void poll();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    refresh();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
      clearNotice();
    };
  }, [enabled, accountScope, add, close]);
}
