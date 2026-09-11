// Backend state modal — opened by clicking the sidebar's status pill.
// Reflects the live server state in its header (running / starting /
// stopping / offline) and shows the diagnostics block (port, last
// start time, log tail). Exit code + offline-specific causes / hints
// only surface when the backend isn't currently up.

import { useEffect, useState } from 'react';
import Ico from './Icons';
import { Alert, Button, Tooltip } from './ui';
import { Modal } from './ui/Modal';
import { host } from '../../platform/host';
import { backendFailureCopy, exitCodeLabel } from '../../../shared/server-status';
import { scrubLog } from '../lib/diagnostics';

export default function ServerOfflineHelpModal({
  open,
  onClose,
  // Atomic server actions wired from App.jsx. The modal composes
  // "Restart" locally from `onStop` + `onStart` so the parent only
  // needs to expose the two primitives. Older callers passed a
  // single `onRetry` that did stop+start; that hid the "I just want
  // to stop, not restart" intent and made it impossible to give the
  // user a Stop button. Kept here for backwards-compat — when neither
  // `onStop` nor `onStart` is provided, `onRetry` runs the legacy
  // stop+start cycle.
  onStart,
  onStop,
  onRetry,
  serverOnline = false,
  serverBusy = false,
  serverBusyKind = 'starting',
  agentLabel,
}) {
  const [diag, setDiag] = useState(null);
  const [busy, setBusy] = useState(false);

  // Pull diagnostics fresh on each open — the recentLog only grows
  // while the python process is running, so we want the latest tail
  // every time the user clicks the icon.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await host.serverDiagnostics();
        if (!cancelled) setDiag(data || null);
      } catch {
        if (!cancelled) setDiag(null);
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  // Esc + backdrop dismissal are handled by <Modal>.

  const error = diag?.lastError;
  // Scrubbed: this is raw sidecar output and it is about to be on screen.
  const log = scrubLog(diag?.recentLog).trim();
  const port = diag?.port;
  const errorKind = diag?.lastErrorKind ?? null;
  const startedAt = diag?.lastStartAt
    ? new Date(diag.lastStartAt).toLocaleTimeString()
    : null;
  // "never started" is wrong for a backend that was still importing when we
  // stopped waiting for it (the most common failure on a slow machine's first
  // launch), and equally wrong for one the user deliberately stopped — a
  // signal kill leaves no exit code, so both used to land on that string.
  const exitLabel = exitCodeLabel({
    kind: errorKind,
    exitCode: diag?.lastExitCode ?? null,
    stopIntentional: diag?.lastStopIntentional ?? null,
  });
  const failureCopy = backendFailureCopy({
    kind: errorKind,
    hasLog: log.length > 0,
    port: port ?? null,
    portHolderPid: diag?.portHolderPid ?? null,
  });

  // Live state → title + header colour + subtitle. The same modal is
  // used in every state — clicking the status pill while the backend
  // is up should read as "Backend status" not "Backend isn't running".
  //
  // The offline branch splits further. Three signals are involved:
  //   - `lastError`: present when a start attempt failed (timeout,
  //     spawn error, deps missing, …). Absent after a successful
  //     start, even if the python later crashed.
  //   - `lastStopIntentional`: TRUE when the death was caused by a
  //     user/app stopServer() call; FALSE on crash; NULL pre-first-
  //     stop. This is the load-bearing signal — `lastError` alone
  //     can't distinguish a clean stop from a post-start crash since
  //     both leave it null.
  // Decision: stopped panel iff there's no start-time error AND the
  // last transition was intentional. Everything else (including the
  // initial "never tried" state and post-start crashes) gets the
  // failure panel.
  const state = serverBusy
    ? (serverBusyKind === 'stopping' ? 'stopping' : 'starting')
    : serverOnline ? 'online' : 'offline';
  const offlineKind = state === 'offline'
    && !error
    && diag?.lastStopIntentional === true
    ? 'stopped'
    : 'failed';
  const HEADER = {
    online:   {
      title:    `${agentLabel || 'Anton'} backend is running`,
      subtitle: `Live on port ${port ?? '—'}. The local Python server is responding to /health.`,
      iconColor:  'var(--success, #1F8F5F)',
      iconBgMix:  'var(--success, #1F8F5F)',
    },
    starting: {
      title:    `${agentLabel || 'Anton'} backend is starting…`,
      subtitle: 'Spawning the local Python server. This usually takes a few seconds — the modal will reflect the result automatically.',
      iconColor:  'var(--accent)',
      iconBgMix:  'var(--accent)',
    },
    stopping: {
      title:    `${agentLabel || 'Anton'} backend is stopping…`,
      subtitle: 'Waiting for the local Python server to terminate.',
      iconColor:  'var(--ink-3)',
      iconBgMix:  'var(--ink-3)',
    },
    offline: offlineKind === 'stopped'
      ? {
          title:    `${agentLabel || 'Anton'} backend is stopped`,
          subtitle: 'You stopped the local Python server. Click "Start backend" below to bring it back up.',
          iconColor:  'var(--ink-3)',
          iconBgMix:  'var(--ink-3)',
        }
      : {
          title:    `${agentLabel || 'Anton'} backend isn't running`,
          subtitle: "The local Python server didn't start. Below is the most recent error and log tail captured from the process.",
          iconColor:  'var(--danger)',
          iconBgMix:  'var(--danger)',
        },
  }[state];

  const refreshDiag = async () => {
    try {
      const data = await host.serverDiagnostics();
      setDiag(data || null);
    } catch {}
  };

  const handleStart = async () => {
    if (!onStart) return;
    setBusy(true);
    try {
      await onStart();
      await refreshDiag();
    } finally {
      setBusy(false);
    }
  };

  const handleStop = async () => {
    if (!onStop) return;
    setBusy(true);
    try {
      await onStop();
      await refreshDiag();
    } finally {
      setBusy(false);
    }
  };

  const handleRestart = async () => {
    setBusy(true);
    try {
      // Prefer atomic actions when wired; fall back to the legacy
      // single onRetry handler so older callers still work.
      if (onStop && onStart) {
        await onStop();
        await onStart();
      } else if (onRetry) {
        await onRetry();
      }
      await refreshDiag();
    } finally {
      setBusy(false);
    }
  };

  // Legacy single-button click target — only used when atomic
  // handlers aren't provided. Kept as a thin wrapper so the existing
  // disabled-while-busy + diagnostics-refresh logic is unchanged for
  // any caller that still ships the old API.
  const handleRetry = async () => {
    setBusy(true);
    try {
      await onRetry?.();
      // Pull fresh diagnostics after the retry attempt — gives the
      // user immediate feedback on whether the new attempt worked.
      const data = await host.serverDiagnostics();
      setDiag(data || null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      width="min(640px, 92vw)"
      maxHeight="min(640px, 88vh)"
      ariaLabel={HEADER.title}
    >
        <div className="flex items-start gap-3 py-4 px-[18px] border-b border-t-0 border-x-0 border-solid border-line">
          <span
            className="inline-grid place-items-center w-9 h-9 rounded-card-row shrink-0 border border-solid"
            style={{
              // Icon tint tracks the live server state (success/accent/ink/danger).
              background: `color-mix(in srgb, ${HEADER.iconBgMix} 14%, var(--surface))`,
              color: HEADER.iconColor,
              borderColor: `color-mix(in srgb, ${HEADER.iconBgMix} 35%, transparent)`,
            }}
          >
            {Ico.power(18)}
          </span>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-[14.5px] text-ink">{HEADER.title}</div>
            <div className="text-sm text-ink-3 mt-[2px] leading-[1.5]">
              {HEADER.subtitle}
            </div>
          </div>
          <Tooltip content="Close">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="cursor-pointer bg-transparent border-0 text-ink-3 w-[28px] h-[28px] rounded-[6px] inline-grid place-items-center text-[18px] leading-none shrink-0"
            >×</button>
          </Tooltip>
        </div>

        <div className="flex-1 overflow-y-auto py-[14px] px-[18px] flex flex-col gap-[14px]">
          {/* Quick facts row — exit code only renders when the
              backend isn't running, otherwise it's irrelevant noise.
              The grid auto-fits whichever tiles are present. */}
          <div
            className="grid gap-[10px] font-[family-name:var(--font-mono)] text-xs"
            style={{ gridTemplateColumns: `repeat(${state === 'offline' ? 3 : 2}, minmax(0, 1fr))` }}
          >
            <div className="py-2 px-[10px] rounded-[7px] bg-surface-2 border border-solid border-line">
              <div className="text-ink-4 uppercase tracking-[0.06em] text-2xs">Port</div>
              <div className="text-ink mt-[2px]">{port ?? '—'}</div>
            </div>
            {state === 'offline' && (
              <div className="py-2 px-[10px] rounded-[7px] bg-surface-2 border border-solid border-line">
                <div className="text-ink-4 uppercase tracking-[0.06em] text-2xs">Exit code</div>
                <div className="text-ink mt-[2px]">{exitLabel}</div>
              </div>
            )}
            <div className="py-2 px-[10px] rounded-[7px] bg-surface-2 border border-solid border-line">
              <div className="text-ink-4 uppercase tracking-[0.06em] text-2xs">Last attempt</div>
              <div className="text-ink mt-[2px]">{startedAt ?? '—'}</div>
            </div>
          </div>

          {/* Headline error — offline + start-failure only. A
              user-initiated stop has no failure to surface, so we
              skip the error block entirely; the header subtitle
              already explains why the backend is down. */}
          {state === 'offline' && offlineKind === 'failed' && (error ? (
            <Alert variant="danger" className="font-[family-name:var(--font-mono)] break-words">{error}</Alert>
          ) : (
            <div className="py-[10px] px-3 rounded-card-row bg-surface-2 border border-solid border-line text-ink-3 text-[13px] leading-[1.5]">
              No specific start error was captured. Check the log tail below — the python process may have died after a successful start.
            </div>
          ))}

          {/* Recent log */}
          <div>
            <div className="font-[family-name:var(--font-mono)] text-[10.5px] text-ink-4 tracking-[0.1em] uppercase mb-[6px]">Recent log</div>
            <pre className="m-0 py-[10px] px-3 bg-surface-2 border border-solid border-line rounded-card-row font-[family-name:var(--font-mono)] text-[11.5px] leading-[1.55] text-ink-2 max-h-[280px] overflow-auto whitespace-pre-wrap break-words select-text">{log || '(no log captured yet)'}</pre>
          </div>

          {/* What actually happened + what to do about it. Driven by the
              failure kind, so the panel never asks for a log in the state
              where no log can exist. */}
          {state === 'offline' && offlineKind === 'failed' && (
            <div className="text-[12px] text-ink-3 leading-[1.5]">
              <div className="text-ink-2 font-semibold mb-1">{failureCopy.headline}</div>
              <ul className="m-0 pl-[18px] flex flex-col gap-[3px]">
                {failureCopy.hints.map((hint) => <li key={hint}>{hint}</li>)}
              </ul>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 py-3 px-[18px] border-t border-b-0 border-x-0 border-solid border-line bg-surface">
          <Button
            variant="subtle"
            onClick={onClose}
          >Close</Button>
          {/* Action buttons — split by intent so the user can stop
              the backend without it immediately restarting:
                * online   → [Stop] [Restart]   (Restart = stop + start)
                * offline  → [Start]
              All disabled while a transition is in flight so we
              don't fire concurrent toggles into the main process.
              Falls back to a single legacy button when only the
              old `onRetry` API was provided. */}
          {(onStart || onStop) ? (
            <>
              {state !== 'offline' && (
                <Button
                  onClick={handleStop}
                  disabled={busy || serverBusy || !onStop}
                >
                  {(busy && serverBusyKind === 'stopping') ? 'Stopping…' : 'Stop backend'}
                </Button>
              )}
              <Button
                variant="primary"
                onClick={state === 'offline' ? handleStart : handleRestart}
                disabled={busy || serverBusy || (state === 'offline' ? !onStart : !(onStart && onStop))}
              >
                {busy
                  ? (state === 'offline' ? 'Starting…' : 'Restarting…')
                  : (state === 'offline' ? 'Start backend' : 'Restart backend')}
              </Button>
            </>
          ) : (
            <Button
              variant="primary"
              onClick={handleRetry}
              disabled={busy || serverBusy}
            >
              {busy
                ? (state === 'offline' ? 'Starting…' : 'Restarting…')
                : (state === 'offline' ? 'Start backend' : 'Restart backend')}
            </Button>
          )}
        </div>
    </Modal>
  );
}
