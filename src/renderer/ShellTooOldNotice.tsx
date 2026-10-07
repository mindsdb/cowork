import { useState } from 'react';
import { Alert } from './cowork/components/ui/Alert';
import Button from './cowork/components/ui/Button';
import Ico from './cowork/components/Icons';
import { host, type ShellAutoUpdateSnapshot } from './platform/host';
import {
  deriveShellTooOldNotice,
  SHELL_DOWNLOAD_PAGE,
  type ShellSupportVerdict,
  type ShellTooOldAction,
} from '../shared/shell-support';

// The launch notice for a shell below the supported desktop window (ENG-1047).
//
// Mounted by App.tsx, the shell renderer that draws every page, so it shows on
// the first screen after launch whether that is onboarding or the chat app. It
// carries one action, routed through the shell auto-updater when that can do
// the work and to the download page otherwise. Dismissal lives in App's state
// only, so a dismissed notice returns on the next launch until the shell
// updates.
export interface ShellTooOldNoticeProps {
  verdict: ShellSupportVerdict;
  shellAuto: ShellAutoUpdateSnapshot | null;
  onDismiss: () => void;
  /** Push the notice below the macOS traffic lights on chromeless pages. */
  topOffset?: number;
}

async function runAction(action: ShellTooOldAction): Promise<void> {
  switch (action) {
    case 'install':
      await host.installShellAutoUpdate();
      return;
    case 'download':
      await host.downloadShellAutoUpdate();
      return;
    case 'retry':
      await host.checkShellAutoUpdate();
      return;
    case 'open-download-page': {
      // Settings' manual card knows the per-platform installer URL when a new
      // shell supplied one; old shells never do, so the human page is the
      // fallback — the same link the ENG-849/ENG-1103 notice opens.
      const update = await host.getShellUpdate().catch(() => null);
      await host.openExternal(update?.downloadUrl || SHELL_DOWNLOAD_PAGE);
      return;
    }
    default:
      return;
  }
}

export function ShellTooOldNotice({ verdict, shellAuto, onDismiss, topOffset = 12 }: ShellTooOldNoticeProps) {
  const [busy, setBusy] = useState(false);
  const notice = deriveShellTooOldNotice(verdict, shellAuto);
  if (!notice) return null;

  const handleAction = async () => {
    if (!notice.action || busy) return;
    setBusy(true);
    try {
      await runAction(notice.action);
    } catch {
      // The updater reports its own failure through the snapshot, which
      // re-derives the label; nothing more to say here.
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed left-1/2 -translate-x-1/2 z-[300] w-[min(640px,calc(100%-32px))] [-webkit-app-region:no-drag]"
      style={{ top: topOffset }}
      data-testid="shell-too-old-notice"
    >
      <Alert
        variant="warning"
        title={notice.title}
        icon={Ico.warning ? Ico.warning(16) : undefined}
        className="items-start shadow-lg"
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="flex-1 min-w-[200px]">{notice.body}</span>
          <Button
            variant="primary"
            size="sm"
            onClick={handleAction}
            disabled={!notice.action || busy}
          >
            {notice.actionLabel}
          </Button>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss until the next launch"
            title="Dismiss until the next launch"
            className="bg-transparent border-0 p-0.5 m-0 cursor-pointer text-inherit opacity-70 hover:opacity-100 leading-none"
          >
            {Ico.close ? Ico.close() : '×'}
          </button>
        </div>
      </Alert>
    </div>
  );
}

export default ShellTooOldNotice;
