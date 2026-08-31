import { useCallback, useEffect, useRef, useState } from 'react';
import Ico from '../components/Icons';
import Button from '../components/ui/Button';
import { codingApi, type TerminalPage, type TerminalTabState } from './api';
import { TerminalScreen } from './TerminalScreen';
import { getTerminalShellPreference } from './terminalPreferences';


const MAX_TERMINALS = 12;
const initializationRequests = new Map<string, Promise<TerminalTabState[]>>();


function savedTerminalId(sessionId: string): string | null {
  try { return window.localStorage.getItem(`mindshub-code-terminal:${sessionId}`); } catch { return null; }
}


function saveTerminalId(sessionId: string, terminalId: string | null) {
  try {
    const key = `mindshub-code-terminal:${sessionId}`;
    if (terminalId) window.localStorage.setItem(key, terminalId);
    else window.localStorage.removeItem(key);
  } catch { /* Storage can be unavailable in locked-down desktop environments. */ }
}


function ensureTerminalTabs(sessionId: string): Promise<TerminalTabState[]> {
  const pending = initializationRequests.get(sessionId);
  if (pending) return pending;
  const request = codingApi.terminals(sessionId)
    .then(async ({ items }) => items.length ? items : [await codingApi.createTerminal(sessionId)])
    .finally(() => initializationRequests.delete(sessionId));
  initializationRequests.set(sessionId, request);
  return request;
}


function statusLabel(state: Pick<TerminalTabState, 'status' | 'exit_code'>): string {
  if (state.status === 'running') return 'Running';
  if (state.status === 'failed') return 'Disconnected';
  if (state.status === 'stopped') return 'Ready';
  return `Exited${state.exit_code == null ? '' : ` with code ${state.exit_code}`}`;
}


export function TaskTerminal({ sessionId, focusTerminalId = null, onClose }: { sessionId: string; focusTerminalId?: string | null; onClose: () => void }) {
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const expectedDisconnectsRef = useRef(new Set<string>());
  const loadedSessionRef = useRef<string | null>(null);
  const renameSavingRef = useRef(false);
  const renameCancelledRef = useRef(false);
  const [height, setHeight] = useState(250);
  const [tabs, setTabs] = useState<TerminalTabState[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [screenGeneration, setScreenGeneration] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let disposed = false;
    loadedSessionRef.current = null;
    setLoading(true);
    setError('');
    void ensureTerminalTabs(sessionId).then((items) => {
      if (disposed) return;
      const preferred = savedTerminalId(sessionId);
      const nextSelected = items.some((item) => item.id === preferred) ? preferred! : items[0]?.id || null;
      setTabs(items);
      setSelectedId(nextSelected);
      loadedSessionRef.current = sessionId;
      setLoading(false);
    }).catch((reason) => {
      if (disposed) return;
      setError(reason instanceof Error ? reason.message : 'Could not open the terminal.');
      setLoading(false);
    });
    return () => { disposed = true; };
  }, [sessionId]);

  useEffect(() => {
    if (loadedSessionRef.current === sessionId) saveTerminalId(sessionId, selectedId);
  }, [selectedId, sessionId]);

  useEffect(() => {
    if (focusTerminalId && tabs.some((tab) => tab.id === focusTerminalId)) {
      setSelectedId(focusTerminalId);
    }
  }, [focusTerminalId, tabs]);

  useEffect(() => () => dragCleanupRef.current?.(), []);

  const selected = tabs.find((tab) => tab.id === selectedId) || null;

  const updateState = useCallback((terminalId: string, state: TerminalPage) => {
    setTabs((current) => current.map((tab) => tab.id === terminalId ? {
      ...tab,
      status: state.status,
      exit_code: state.exit_code,
      error: state.error,
    } : tab));
  }, []);

  const handleSelectedState = useCallback((state: TerminalPage) => {
    if (selectedId) updateState(selectedId, state);
  }, [selectedId, updateState]);

  const isDisconnectExpected = useCallback(
    (terminalId: string) => expectedDisconnectsRef.current.has(terminalId),
    [],
  );

  const addTerminal = async () => {
    if (busy || tabs.length >= MAX_TERMINALS) return;
    setBusy(true);
    setError('');
    try {
      const tab = await codingApi.createTerminal(sessionId);
      setTabs((current) => [...current, tab]);
      setSelectedId(tab.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not create a terminal.');
    } finally {
      setBusy(false);
    }
  };

  const beginRename = (tab: TerminalTabState) => {
    renameCancelledRef.current = false;
    setRenamingId(tab.id);
    setRenameValue(tab.label);
  };

  const commitRename = async () => {
    const terminalId = renamingId;
    const label = renameValue.trim();
    if (!terminalId || renameSavingRef.current) return;
    renameSavingRef.current = true;
    setRenamingId(null);
    if (!label) {
      renameSavingRef.current = false;
      return;
    }
    setError('');
    try {
      const updated = await codingApi.renameTerminal(sessionId, terminalId, label);
      setTabs((current) => current.map((tab) => tab.id === terminalId ? updated : tab));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not rename the terminal.');
    } finally {
      renameSavingRef.current = false;
    }
  };

  const deleteTerminal = async (terminalId: string) => {
    if (busy) return;
    setBusy(true);
    setError('');
    expectedDisconnectsRef.current.add(terminalId);
    try {
      await codingApi.deleteTerminal(sessionId, terminalId);
      setTabs((current) => {
        const index = current.findIndex((tab) => tab.id === terminalId);
        const remaining = current.filter((tab) => tab.id !== terminalId);
        if (selectedId === terminalId) {
          setSelectedId(remaining[Math.min(index, remaining.length - 1)]?.id || null);
        }
        return remaining;
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not close the terminal.');
    } finally {
      setBusy(false);
      window.setTimeout(() => expectedDisconnectsRef.current.delete(terminalId), 1_000);
    }
  };

  const stop = async () => {
    if (!selected || busy) return;
    setBusy(true);
    setError('');
    expectedDisconnectsRef.current.add(selected.id);
    try {
      const nextState = await codingApi.stopTerminal(sessionId, selected.id);
      updateState(selected.id, nextState);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not stop the terminal.');
    } finally {
      setBusy(false);
      window.setTimeout(() => expectedDisconnectsRef.current.delete(selected.id), 1_000);
    }
  };

  const restart = async () => {
    if (!selected || busy) return;
    setBusy(true);
    setError('');
    try {
      const nextState = await codingApi.startTerminal(
        sessionId,
        selected.id,
        100,
        30,
        getTerminalShellPreference(),
      );
      updateState(selected.id, nextState);
      setScreenGeneration((value) => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not restart the terminal.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="code-terminal" style={{ height }} aria-label="Task terminals">
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
        <div className="code-terminal__tabs" role="tablist" aria-label="Terminal tabs">
          <span className="code-terminal__mark" aria-hidden="true">{Ico.code(13)}</span>
          {tabs.map((tab) => (
            <div key={tab.id} className={`code-terminal__tab${tab.id === selectedId ? ' is-active' : ''}`}>
              {renamingId === tab.id ? (
                <input
                  autoFocus
                  aria-label={`Rename ${tab.label}`}
                  value={renameValue}
                  maxLength={48}
                  onChange={(event) => setRenameValue(event.target.value)}
                  onFocus={(event) => event.currentTarget.select()}
                  onBlur={() => {
                    if (renameCancelledRef.current) renameCancelledRef.current = false;
                    else void commitRename();
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void commitRename();
                    if (event.key === 'Escape') {
                      renameCancelledRef.current = true;
                      setRenamingId(null);
                    }
                  }}
                />
              ) : (
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab.id === selectedId}
                  aria-label={`${tab.label}, ${statusLabel(tab)}`}
                  title="Double-click to rename"
                  onClick={() => setSelectedId(tab.id)}
                  onDoubleClick={() => beginRename(tab)}
                  onContextMenu={(event) => { event.preventDefault(); beginRename(tab); }}
                  onKeyDown={(event) => { if (event.key === 'F2') beginRename(tab); }}
                >
                  <span className={`code-status-dot is-${tab.status === 'running' ? 'success' : tab.status === 'failed' ? 'danger' : 'neutral'}`} aria-hidden="true" />
                  <span>{tab.label}</span>
                </button>
              )}
              <button
                type="button"
                className="code-terminal__tab-close"
                aria-label={`Close ${tab.label}`}
                disabled={busy}
                onClick={() => void deleteTerminal(tab.id)}
              >
                {Ico.close(10)}
              </button>
            </div>
          ))}
          <button
            type="button"
            className="code-terminal__new"
            aria-label="New terminal"
            title={tabs.length >= MAX_TERMINALS ? `Up to ${MAX_TERMINALS} terminals per task` : 'New terminal'}
            disabled={busy || tabs.length >= MAX_TERMINALS}
            onClick={() => void addTerminal()}
          >
            {Ico.plus(12)}
          </button>
        </div>
        <div className="code-terminal__actions">
          {selected?.status === 'running' ? (
            <Button size="sm" variant="subtle" disabled={busy} onClick={() => void stop()} title="Stop this terminal without closing its tab">
              {Ico.stop(11)} Stop terminal
            </Button>
          ) : selected && selected.status !== 'stopped' && (
            <Button size="sm" variant="subtle" disabled={busy} onClick={() => void restart()}>
              {Ico.refresh(12)} Restart
            </Button>
          )}
          <Button icon size="sm" variant="subtle" onClick={onClose} aria-label="Hide terminal panel" title="Hide terminal panel">
            {Ico.close(13)}
          </Button>
        </div>
      </header>
      {error && <div className="code-terminal__error" role="alert">{error}</div>}
      {selectedId ? (
        <TerminalScreen
          key={`${selectedId}:${screenGeneration}`}
          sessionId={sessionId}
          terminalId={selectedId}
          onState={handleSelectedState}
          onError={setError}
          isDisconnectExpected={isDisconnectExpected}
        />
      ) : (
        <div className="code-terminal__empty">
          <span>{loading ? 'Opening terminal…' : 'No terminals open'}</span>
          {!loading && <Button size="sm" variant="subtle" onClick={() => void addTerminal()}>{Ico.plus(12)} New terminal</Button>}
        </div>
      )}
    </section>
  );
}
