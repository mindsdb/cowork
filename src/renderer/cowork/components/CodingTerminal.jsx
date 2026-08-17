// Embedded Claude Code terminal (ENG-1656 follow-up) — replaces ChatView's
// message transcript + Composer for a claude-code-harness task. Runs the
// `claude` CLI in a real PTY in the Electron main process (coding-terminal.ts)
// and streams its output here via xterm.js, the same pattern this app used
// for Anton's CLI before it had a polished chat GUI.
//
// xterm.js + its fit addon are dynamically imported (desktop-only, heavy,
// and node-pty itself is an optional native dependency on the main-process
// side) so they never enter the web bundle. The PTY is intentionally NOT
// killed on unmount — leaving the task and coming back reconnects to the
// same running session instead of restarting the CLI and re-sending the
// opening prompt.
import { useEffect, useRef, useState } from 'react';
import { host } from '../../platform/host';

// xterm renders via canvas, which only accepts resolved color values —
// var(--bg) works fine as a plain CSS background but canvas fillStyle
// can't resolve custom properties, so the app's theme tokens have to be
// read as computed values off <body> (where globals.css scopes them,
// via body[data-theme]/[data-skin]) rather than passed through directly.
function readTerminalTheme() {
  const style = getComputedStyle(document.body);
  const get = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
  const bg = get('--bg', '#1e1e1e');
  const ink = get('--ink', '#e6e6e6');
  return {
    background: bg,
    foreground: ink,
    cursor: ink,
    cursorAccent: bg,
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
      });
      fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(containerRef.current);
      fitAddon.fit();
      termRef.current = term;

      // Follow live theme/8-bit-skin toggles — xterm's theme option can be
      // reassigned post-construction and it repaints immediately.
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
        host.resizeCodingTerminal(taskId, term.cols, term.rows);
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
      <div ref={containerRef} className="flex-1 min-h-0 min-w-0 px-3 py-2 bg-bg" />
    </div>
  );
}
