// Load xterm dynamically for desktop PTYs. Do not kill the PTY on unmount:
// returning to a task must reconnect without restarting the CLI or resending its opening prompt.
import { useEffect, useRef, useState } from 'react';
import { host } from '../../platform/host';

// Resolve body-scoped theme variables before passing them to xterm’s canvas. Transparent background
// reveals the app surface;
// cursorAccent must remain opaque because it colors text beneath the block cursor.
function readTerminalTheme() {
  const style = getComputedStyle(document.body);
  const get = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
  const ink = get('--ink', '#e6e6e6');
  return {
    background: 'transparent',
    foreground: ink,
    cursor: ink,
    cursorAccent: get('--bg', '#1e1e1e'),
    selectionBackground: get('--line', '#3a3d40'),
  };
}

export default function CodingTerminal({ taskId, projectPath, message, model }) {
  const containerRef = useRef(null);
  const termRef = useRef(null);
  const [error, setError] = useState(null);
  const [exited, setExited] = useState(null);

  useEffect(() => {
    let disposed = false;
    let term = null;
    let fitAddon = null;
    let resizeObserver = null;
    let themeObserver = null;
    let unsubData = () => {};
    let unsubExit = () => {};

    (async () => {
      let Terminal, FitAddon;
      try {
        [{ Terminal }, { FitAddon }] = await Promise.all([
          import('@xterm/xterm'),
          import('@xterm/addon-fit'),
        ]);
        await import('@xterm/xterm/css/xterm.css');
      } catch {
        if (!disposed) setError('Embedded terminal is not available on this build.');
        return;
      }
      if (disposed || !containerRef.current) return;

      term = new Terminal({
        fontFamily: 'var(--font-mono, ui-monospace, monospace)',
        fontSize: 12.5,
        cursorBlink: true,
        theme: readTerminalTheme(),
        allowProposedApi: true,
        // Frequent Claude Code TUI repaints consume scrollback; retain enough lines to keep the
        // start of longer sessions.
        scrollback: 100_000,
      });
      fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(containerRef.current);
      fitAddon.fit();
      termRef.current = term;

      // Repaint xterm when theme or skin changes.
      themeObserver = new MutationObserver(() => {
        term.options.theme = readTerminalTheme();
      });
      themeObserver.observe(document.body, { attributes: true, attributeFilter: ['data-theme', 'data-skin'] });

      unsubData = host.onCodingTerminalData((id, data) => {
        if (id === taskId) term.write(data);
      });
      unsubExit = host.onCodingTerminalExit((id, exitCode) => {
        if (id === taskId) setExited(exitCode);
      });
      term.onData((data) => host.sendCodingTerminalInput(taskId, data));

      const alreadyRunning = await host.isCodingTerminalRunning(taskId);
      if (!alreadyRunning) {
        const result = await host.startCodingTerminal(
          taskId,
          { projectPath, message, model },
          term.cols,
          term.rows,
        );
        if (!result?.ok) {
          if (!disposed) setError(result?.reason || 'Could not start Claude Code.');
          return;
        }
      } else {
        // A reconnected terminal has no prior screen content. Nudge the size to trigger the TUI’s
        // SIGWINCH redraw; an unchanged size is a no-op.
        host.resizeCodingTerminal(taskId, Math.max(1, term.cols - 1), term.rows);
        setTimeout(() => {
          if (!disposed) host.resizeCodingTerminal(taskId, term.cols, term.rows);
        }, 50);
      }

      resizeObserver = new ResizeObserver(() => {
        if (!fitAddon || !term) return;
        fitAddon.fit();
        host.resizeCodingTerminal(taskId, term.cols, term.rows);
      });
      resizeObserver.observe(containerRef.current);
    })();

    return () => {
      disposed = true;
      unsubData();
      unsubExit();
      resizeObserver?.disconnect();
      themeObserver?.disconnect();
      term?.dispose();
      termRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  return (
    <div className="relative flex-1 min-h-0 min-w-0 flex flex-col">
      {error && (
        <div className="flex-shrink-0 px-4 py-2 text-sm text-danger bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] border-b border-solid border-line">
          {error}
        </div>
      )}
      {exited != null && (
        <div className="flex-shrink-0 px-4 py-2 text-sm text-ink-3 bg-surface-2 border-b border-solid border-line">
          Claude Code exited (code {exited}).
        </div>
      )}
      {/* Override xterm.css’s black viewport background so the transparent terminal theme takes effect. */}
      <style>{'.xterm-viewport { background-color: transparent !important; }'}</style>
      <div ref={containerRef} className="flex-1 min-h-0 min-w-0 px-3 py-2 bg-transparent" />
    </div>
  );
}
