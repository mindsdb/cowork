import { useState } from 'react';
import { Alert } from './cowork/components/ui/Alert';
import Ico from './cowork/components/Icons';
import { deriveShellOsCappedNotice, type ShellSupportVerdict } from '../shared/shell-support';

// The launch notice for a shell whose macOS the newest shell no longer runs on.
// No action: only a macOS update helps. The plain notice is dismissed for good
// (stored in this profile's localStorage); the below-floor one names a data
// risk and returns every launch.
export const OS_CAPPED_DISMISSED_KEY = 'anton.shellOsCappedDismissed';

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(OS_CAPPED_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

function storeDismissed(): void {
  try {
    window.localStorage.setItem(OS_CAPPED_DISMISSED_KEY, '1');
  } catch {
    // Storage blocked: the notice shows again next launch.
  }
}

export interface ShellOsCappedNoticeProps {
  verdict: ShellSupportVerdict;
  onDismiss: () => void;
  /** Push the notice below the macOS traffic lights on chromeless pages. */
  topOffset?: number;
}

export function ShellOsCappedNotice({ verdict, onDismiss, topOffset = 12 }: ShellOsCappedNoticeProps) {
  const [storedDismissal] = useState(readDismissed);
  const notice = deriveShellOsCappedNotice(verdict);
  if (!notice) return null;
  if (notice.dismissal === 'once' && storedDismissal) return null;

  const label = notice.dismissal === 'once' ? 'Dismiss' : 'Dismiss until the next launch';
  const handleDismiss = () => {
    if (notice.dismissal === 'once') storeDismissed();
    onDismiss();
  };

  return (
    <div
      className="fixed left-1/2 -translate-x-1/2 z-[300] w-[min(640px,calc(100%-32px))] [-webkit-app-region:no-drag]"
      style={{ top: topOffset }}
      data-testid="shell-os-capped-notice"
    >
      <Alert
        variant="warning"
        title={notice.title}
        icon={Ico.warning ? Ico.warning(16) : undefined}
        className="items-start shadow-lg"
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="flex-1 min-w-[200px]">{notice.body}</span>
          <button
            type="button"
            onClick={handleDismiss}
            aria-label={label}
            title={label}
            className="bg-transparent border-0 p-0.5 m-0 cursor-pointer text-inherit opacity-70 hover:opacity-100 leading-none"
          >
            {Ico.close ? Ico.close() : '×'}
          </button>
        </div>
      </Alert>
    </div>
  );
}

export default ShellOsCappedNotice;
