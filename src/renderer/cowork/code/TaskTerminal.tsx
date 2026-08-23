import { useEffect, useRef, useState } from 'react';
import Ico from '../components/Icons';
import Button from '../components/ui/Button';
import {
  codingApi,
  openCodingTerminalStream,
  type TerminalChunk,
  type TerminalPage,
} from './api';


function terminalTheme() {
  const style = getComputedStyle(document.body);
  const token = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  const ink = token('--ink', '#e6e6e6');
  return {
    background: token('--surface-0', '#0b1220'),
    foreground: ink,
    cursor: ink,
    cursorAccent: token('--surface-0', '#0b1220'),
    selectionBackground: token('--line-2', '#334155'),
  };
}


function decodeBase64(value: string): Uint8Array {
  const binary = window.atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}


function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return window.btoa(binary);
}


function writeChunk(terminal: { write: (data: Uint8Array) => void }, chunk: TerminalChunk) {
  try { terminal.write(decodeBase64(chunk.data_base64)); } catch { /* Ignore an invalid transport chunk. */ }
}


export function TaskTerminal({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const restartRequested = useRef(false);
  const stopRequested = useRef(false);
  const statusRef = useRef<TerminalPage['status']>('stopped');
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const [height, setHeight] = useState(250);
  const [generation, setGeneration] = useState(0);
  const [state, setState] = useState<TerminalPage | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let disposed = false;
    let closeStream = () => {};
    let terminal: import('@xterm/xterm').Terminal | null = null;
    let fitAddon: import('@xterm/addon-fit').FitAddon | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let themeObserver: MutationObserver | null = null;
    let resizeTimer: number | undefined;
    let lastSize = '';

    const connect = async () => {
      try {
        const [{ Terminal }, { FitAddon }] = await Promise.all([
          import('@xterm/xterm'),
          import('@xterm/addon-fit'),
          import('@xterm/xterm/css/xterm.css'),
        ]);
        if (disposed || !containerRef.current) return;
        terminal = new Terminal({
          allowProposedApi: true,
          cursorBlink: true,
          fontFamily: 'var(--font-mono, ui-monospace, monospace)',
          fontSize: 12.5,
          scrollback: 100_000,
          theme: terminalTheme(),
        });
        fitAddon = new FitAddon();
        terminal.loadAddon(fitAddon);
        terminal.open(containerRef.current);
        fitAddon.fit();
        terminal.focus();
        terminal.attachCustomKeyEventHandler((event) => {
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c' && terminal?.hasSelection()) {
            void navigator.clipboard.writeText(terminal.getSelection());
            return false;
          }
          return true;
        });
        terminal.onData((data) => {
          codingApi.terminalInput(sessionId, encodeBase64(data)).catch((reason) => {
            if (!disposed) setError(reason instanceof Error ? reason.message : 'Could not write to terminal.');
          });
        });

        let page = await codingApi.terminal(sessionId);
        if (disposed) return;
        page.items.forEach((chunk) => writeChunk(terminal!, chunk));
        if (page.status === 'stopped' || restartRequested.current) {
          restartRequested.current = false;
          page = await codingApi.startTerminal(sessionId, terminal.cols, terminal.rows);
          if (disposed) return;
          page.items.forEach((chunk) => writeChunk(terminal!, chunk));
        }
        stopRequested.current = false;
        statusRef.current = page.status;
        setState(page);
        closeStream = openCodingTerminalStream(
          sessionId,
          page.next_seq,
          (chunk) => {
            if (!disposed && terminal) writeChunk(terminal, chunk);
          },
          (nextState) => {
            statusRef.current = nextState.status;
            if (!disposed) setState(nextState);
          },
          () => {
            if (!disposed && !stopRequested.current && statusRef.current === 'running') {
              setError('Terminal connection interrupted. Reopen it to reconnect.');
            }
          },
        );

        themeObserver = new MutationObserver(() => {
          if (terminal) terminal.options.theme = terminalTheme();
        });
        themeObserver.observe(document.body, { attributes: true, attributeFilter: ['data-theme', 'data-skin'] });
        resizeObserver = new ResizeObserver(() => {
          if (!terminal || !fitAddon) return;
          fitAddon.fit();
          const size = `${terminal.cols}x${terminal.rows}`;
          if (size === lastSize) return;
          lastSize = size;
          window.clearTimeout(resizeTimer);
          resizeTimer = window.setTimeout(() => {
            codingApi.resizeTerminal(sessionId, terminal!.cols, terminal!.rows).catch(() => {});
          }, 80);
        });
        resizeObserver.observe(containerRef.current);
      } catch (reason) {
        if (!disposed) setError(reason instanceof Error ? reason.message : 'Terminal is unavailable.');
      }
    };
    void connect();
    return () => {
      disposed = true;
      closeStream();
      window.clearTimeout(resizeTimer);
      resizeObserver?.disconnect();
      themeObserver?.disconnect();
      terminal?.dispose();
    };
  }, [generation, sessionId]);

  useEffect(() => () => dragCleanupRef.current?.(), []);

  const restart = async () => {
    setBusy(true);
    setError('');
    try {
      setState(null);
      restartRequested.current = true;
      stopRequested.current = false;
      setGeneration((value) => value + 1);
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    setError('');
    // The server closes the stream before the stop response can reach the
    // renderer. Mark the intentional shutdown first so that close is not
    // misreported as a dropped connection.
    stopRequested.current = true;
    statusRef.current = 'stopped';
    try {
      const nextState = await codingApi.stopTerminal(sessionId);
      statusRef.current = nextState.status;
      setState(nextState);
    } catch (reason) {
      stopRequested.current = false;
      statusRef.current = 'running';
      setError(reason instanceof Error ? reason.message : 'Could not stop the terminal.');
    } finally {
      setBusy(false);
    }
  };

  const statusLabel = !state ? 'Connecting' : state.status === 'running'
    ? 'Running'
    : state.status === 'failed'
      ? 'Disconnected'
      : `Exited${state.exit_code == null ? '' : ` · ${state.exit_code}`}`;

  return (
    <section className="code-terminal" style={{ height }} aria-label="Task terminal">
      <div
        className="code-terminal__resize"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize terminal"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'ArrowUp') setHeight((value) => Math.min(520, value + 20));
          if (event.key === 'ArrowDown') setHeight((value) => Math.max(160, value - 20));
        }}
        onPointerDown={(event) => {
          dragCleanupRef.current?.();
          const startY = event.clientY;
          const startHeight = height;
          const move = (next: PointerEvent) => setHeight(Math.max(160, Math.min(520, startHeight + startY - next.clientY)));
          const cleanup = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', cleanup);
            window.removeEventListener('pointercancel', cleanup);
            dragCleanupRef.current = null;
          };
          dragCleanupRef.current = cleanup;
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', cleanup);
          window.addEventListener('pointercancel', cleanup);
        }}
      />
      <header className="code-terminal__header">
        <div className="code-terminal__title">
          <span>{Ico.code(13)}</span>
          <strong>Terminal</strong>
          <span className={`code-status-dot is-${state?.status === 'running' ? 'success' : 'neutral'}`} aria-hidden="true" />
          <small>{statusLabel}</small>
        </div>
        <div className="code-terminal__actions">
          {state?.status === 'running' ? (
            <Button
              size="sm"
              variant="subtle"
              disabled={busy}
              onClick={() => void stop()}
            >
              Stop
            </Button>
          ) : state && (
            <Button size="sm" variant="subtle" disabled={busy} onClick={() => void restart()}>
              {Ico.refresh(12)} Restart
            </Button>
          )}
          <Button icon size="sm" variant="subtle" onClick={onClose} aria-label="Close terminal panel">
            {Ico.close(13)}
          </Button>
        </div>
      </header>
      {error && <div className="code-terminal__error" role="alert">{error}</div>}
      <div ref={containerRef} className="code-terminal__screen" />
    </section>
  );
}
