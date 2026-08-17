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
// `background: 'transparent'` (rather than a resolved --bg) lets the
// app's real background — gradient, gravity-field effect, whatever's
// actually behind ChatView — show through instead of a flat fill;
// cursorAccent still needs a real (non-transparent) color since it's the
// text color painted under the solid block cursor, not a fill itself.
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
        // xterm's default (1000) is easy to exhaust — Claude Code's TUI
        // repaints its live status/spinner frequently, each repaint
        // consuming scrollback lines, so a longer session can evict the
        // true beginning of the conversation well before the user tries
        // to scroll back to it.
        scrollback: 100_000,
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
        // Reconnecting to an already-running session: this xterm instance
        // is brand new and has no scrollback of whatever happened while
        // the task view was unmounted, so it starts fully blank. Claude
        // Code (like most TUIs) only repaints on an actual SIGWINCH size
        // change — resizing to the SAME cols/rows the terminal already
        // has is a no-op that never reaches the child, so the screen
        // would otherwise stay blank until something else (e.g. the user
        // manually resizing the window) happens to change the size for
        // real. Nudging down a column and immediately back forces two
        // real size changes, guaranteeing a redraw either way.
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
      {/* xterm.css hardcodes .xterm-viewport's background to #000, which
          would defeat theme.background: 'transparent' above — this is the
          one rule from a third-party stylesheet that genuinely needs
          !important to override cleanly. */}
      <style>{'.xterm-viewport { background-color: transparent !important; }'}</style>
      <div ref={containerRef} className="flex-1 min-h-0 min-w-0 px-3 py-2 bg-transparent" />
    </div>
  );
}
