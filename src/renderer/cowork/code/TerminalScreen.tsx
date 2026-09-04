import { useEffect, useRef } from 'react';
import {
  codingApi,
  openCodingTerminalStream,
  type TerminalChunk,
  type TerminalPage,
} from './api';
import { getTerminalShellPreference } from './terminalPreferences';


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


export function TerminalScreen({
  sessionId,
  terminalId,
  onState,
  onError,
  isDisconnectExpected,
}: {
  sessionId: string;
  terminalId: string;
  onState: (state: TerminalPage) => void;
  onError: (message: string) => void;
  isDisconnectExpected: (terminalId: string) => boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stopRequested = useRef(false);
  const statusRef = useRef<TerminalPage['status']>('stopped');

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
        let pendingInput = '';
        let inputInFlight = false;
        const flushInput = () => {
          if (inputInFlight || !pendingInput) return;
          const data = pendingInput;
          pendingInput = '';
          inputInFlight = true;
          codingApi.terminalInput(sessionId, terminalId, encodeBase64(data))
            .catch((reason) => {
              if (!disposed) onError(reason instanceof Error ? reason.message : 'Could not write to terminal.');
            })
            .finally(() => {
              inputInFlight = false;
              flushInput();
            });
        };
        terminal.onData((data) => {
          pendingInput += data;
          flushInput();
        });

        let page = await codingApi.terminal(sessionId, terminalId);
        if (disposed) return;
        page.items.forEach((chunk) => writeChunk(terminal!, chunk));
        if (page.status === 'stopped') {
          page = await codingApi.startTerminal(
            sessionId,
            terminalId,
            terminal.cols,
            terminal.rows,
            getTerminalShellPreference(),
          );
          if (disposed) return;
          page.items.forEach((chunk) => writeChunk(terminal!, chunk));
        }
        stopRequested.current = false;
        statusRef.current = page.status;
        onState(page);
        closeStream = openCodingTerminalStream(
          sessionId,
          terminalId,
          page.next_seq,
          (chunk) => {
            if (!disposed && terminal) writeChunk(terminal, chunk);
          },
          (nextState) => {
            statusRef.current = nextState.status;
            if (!disposed) onState(nextState);
          },
          () => {
            if (!disposed && !stopRequested.current && !isDisconnectExpected(terminalId) && statusRef.current === 'running') {
              onError('Terminal connection interrupted. Switch tabs or reopen the panel to reconnect.');
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
            codingApi.resizeTerminal(sessionId, terminalId, terminal!.cols, terminal!.rows).catch(() => {});
          }, 80);
        });
        resizeObserver.observe(containerRef.current);
      } catch (reason) {
        if (!disposed) onError(reason instanceof Error ? reason.message : 'Terminal is unavailable.');
      }
    };
    void connect();
    return () => {
      disposed = true;
      stopRequested.current = true;
      closeStream();
      window.clearTimeout(resizeTimer);
      resizeObserver?.disconnect();
      themeObserver?.disconnect();
      terminal?.dispose();
    };
  }, [isDisconnectExpected, onError, onState, sessionId, terminalId]);

  return <div ref={containerRef} className="code-terminal__screen" aria-label="Terminal output" />;
}
