// Read-only scratchpad viewer. Opens when the user clicks a step row
// in the rail or the inline ThinkingBlock. Tabs across the top group
// scratchpad cells by their `_scratchpadTabId` (anton's `name` field
// — multiple cells with the same name share one tab, like mdb-ai).
// Sub-tabs inside switch between Code / Output / Result.

import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import Ico from '../Icons';

export function ScratchpadModal({ open, onClose, steps = [], focusStepId = null }) {
  // Group cells by tab id. Cells without a tab id stand alone.
  const tabs = useMemo(() => {
    const byTab = new Map();
    let standaloneCounter = 0;
    for (const s of steps) {
      if (!s._isScratchpad) continue;
      const id = s._scratchpadTabId || `standalone-${++standaloneCounter}`;
      if (!byTab.has(id)) byTab.set(id, { id, name: id, cells: [] });
      byTab.get(id).cells.push(s);
    }
    return [...byTab.values()];
  }, [steps]);

  const focusTabId = useMemo(() => {
    if (!focusStepId) return tabs[0]?.id;
    const focused = steps.find((s) => s.id === focusStepId);
    return focused?._scratchpadTabId || tabs[0]?.id;
  }, [focusStepId, steps, tabs]);

  const [activeTabId, setActiveTabId] = useState(focusTabId);
  // When the focus step changes (user clicked a different row), follow it.
  useEffect(() => {
    if (focusTabId) setActiveTabId(focusTabId);
  }, [focusTabId]);

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];

  // Esc to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      style={{ WebkitAppRegion: 'no-drag' }}
    >
      <div className="flex h-[80vh] w-[min(960px,92vw)] flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-2xl">

        {/* Header */}
        <div className="flex flex-none items-center justify-between border-b border-line px-5 py-3">
          <div className="flex items-center gap-2">
            <span className="text-ink-3 inline-flex">{Ico.code(15)}</span>
            <span className="font-display text-[13px] font-semibold uppercase tracking-wider text-ink">
              Scratchpad
            </span>
            <span className="font-mono text-[11px] text-ink-4">
              {tabs.length} cell{tabs.length === 1 ? '' : 's'}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Close"
            className="flex h-7 w-7 items-center justify-center rounded-md text-ink-3 hover:bg-surface-2 hover:text-ink"
          >
            ×
          </button>
        </div>

        {/* Tab strip */}
        {tabs.length > 1 && (
          <div className="flex flex-none gap-1 overflow-x-auto border-b border-line bg-surface-2 px-3 py-2">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTabId(t.id)}
                className={clsx(
                  'flex-none rounded-md border px-3 py-1 font-mono text-[11px] tracking-wider',
                  t.id === activeTabId
                    ? 'border-accent bg-accent text-white'
                    : 'border-line bg-surface text-ink-2 hover:bg-surface-3'
                )}
              >
                {t.name}
              </button>
            ))}
          </div>
        )}

        {/* Body — show every cell in the active tab vertically */}
        <div className="flex-1 overflow-y-auto px-5 py-4" style={{ WebkitAppRegion: 'no-drag' }}>
          {activeTab?.cells.map((cell, idx) => (
            <ScratchpadCellView
              key={cell.id}
              cell={cell}
              isOnly={activeTab.cells.length === 1}
              index={idx + 1}
              total={activeTab.cells.length}
            />
          ))}
          {(!activeTab || activeTab.cells.length === 0) && (
            <p className="text-body text-ink-4">No scratchpad cells in this turn.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function ScratchpadCellView({ cell, isOnly, index, total }) {
  const data = cell.data || {};
  const code = data.code || '(no code captured)';
  const stdout = cell.output || cell.result?.stdout || '';
  const stderr = cell.stderr || cell.result?.stderr || '';
  const reasoningMs =
    cell.executionStartedAt && cell.reasoningStartedAt
      ? cell.executionStartedAt - cell.reasoningStartedAt
      : null;
  const executionMs =
    cell.executionCompletedAt && cell.executionStartedAt
      ? cell.executionCompletedAt - cell.executionStartedAt
      : null;
  return (
    <div className={clsx('flex flex-col gap-3 pb-6', !isOnly && 'border-b border-line mb-6')}>
      {!isOnly && (
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[11px] text-ink-4">cell {index}/{total}</span>
          <span className="font-display text-[13px] font-semibold text-ink truncate">
            {data.one_line_description || cell.label}
          </span>
        </div>
      )}
      <div className="flex items-center gap-3 text-[11px] font-mono text-ink-4">
        {data.action && <span>action: <span className="text-ink-3">{data.action}</span></span>}
        {reasoningMs != null && <span>reason: <span className="text-ink-3">{Math.max(0, Math.round(reasoningMs))}ms</span></span>}
        {executionMs != null && <span>exec: <span className="text-ink-3">{Math.max(0, Math.round(executionMs))}ms</span></span>}
        {Array.isArray(data.packages) && data.packages.length > 0 && (
          <span>pkgs: <span className="text-ink-3">{data.packages.join(', ')}</span></span>
        )}
      </div>

      <Section title="Code">
        <pre className="overflow-x-auto rounded-md border border-line bg-surface-2 p-3 font-mono text-[12px] leading-snug text-ink">
{code}
        </pre>
      </Section>

      {stdout && (
        <Section title="Output">
          <pre className="overflow-x-auto rounded-md border border-line bg-surface-2 p-3 font-mono text-[12px] leading-snug text-ink-2">
{stdout}
          </pre>
        </Section>
      )}

      {stderr && (
        <Section title="Stderr">
          <pre className="overflow-x-auto rounded-md border border-red-200 bg-red-50 p-3 font-mono text-[12px] leading-snug text-red-700">
{stderr}
          </pre>
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-display text-[10.5px] font-semibold uppercase tracking-widest text-ink-4">
        {title}
      </span>
      {children}
    </div>
  );
}
