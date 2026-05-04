// Scratchpad viewer — input/output focused, with a toggle to reveal
// the underlying code + stderr per cell. Borrowed visual structure
// from mdb-ai's playground panel: tabs across the top group cells by
// `_scratchpadTabId` (anton's `name`); each cell shows description +
// timing + output prominently, with code/errors hidden behind a
// "Show code" toggle.
//
// Code is syntax-highlighted via prism (CodeBlock component) and uses
// JetBrains Mono for the editor font. Theme follows body[data-theme].

import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import Ico from '../Icons';
import { CodeBlock } from './CodeBlock';

function fmtMs(ms) {
  if (!Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}

function detectLanguage(data) {
  // Anton runs Python in the scratchpad sandbox by default. If the
  // future allows other languages, infer from data.action or similar.
  return 'python';
}

export function ScratchpadModal({ open, onClose, steps = [], focusStepId = null }) {
  // Group cells by tab id (anton's `name`). Cells without a tab id
  // stand alone with synthetic ids so they each get their own tab.
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
  useEffect(() => { if (focusTabId) setActiveTabId(focusTabId); }, [focusTabId]);

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];

  // Esc closes.
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
      <div className="flex h-[82vh] w-[min(1040px,94vw)] flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-2xl">

        {/* Modal header */}
        <div className="flex flex-none items-center justify-between border-b border-line px-5 py-3">
          <div className="flex items-center gap-2">
            <span className="inline-flex text-ink-3">{Ico.code(15)}</span>
            <span className="font-display text-[13px] font-semibold uppercase tracking-wider text-ink">
              Scratchpad
            </span>
            <span className="font-mono text-[11px] text-ink-4">
              {tabs.length} pad{tabs.length === 1 ? '' : 's'} · {activeTab?.cells.length || 0} step{activeTab?.cells.length === 1 ? '' : 's'}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Close"
            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-ink-3 hover:bg-surface-2 hover:text-ink"
          >
            ×
          </button>
        </div>

        {/* Tab strip — only when more than one pad */}
        {tabs.length > 1 && (
          <div className="flex flex-none gap-1 overflow-x-auto border-b border-line bg-surface-2 px-3 py-2">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTabId(t.id)}
                className={clsx(
                  'flex-none cursor-pointer rounded-md border px-3 py-1 font-mono text-[11px] tracking-wider',
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

        {/* Cells — vertical stack inside the active pad */}
        <div className="flex-1 overflow-y-auto" style={{ WebkitAppRegion: 'no-drag' }}>
          {activeTab?.cells.map((cell, i) => (
            <CellView
              key={cell.id}
              cell={cell}
              index={i + 1}
              total={activeTab.cells.length}
            />
          ))}
          {(!activeTab || activeTab.cells.length === 0) && (
            <p className="p-8 text-body text-ink-4">No steps in this turn.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function CellView({ cell, index, total }) {
  const [showCode, setShowCode] = useState(false);
  const data = cell.data || {};
  const code = data.code || '';
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
  const language = detectLanguage(data);
  const hasErr = !!stderr;
  // Auto-reveal code for the cell that has an error (likely what the
  // user wants to inspect right away).
  useEffect(() => { if (hasErr) setShowCode(true); }, [hasErr]);

  return (
    <div className="border-b border-line px-6 py-5 last:border-b-0">
      {/* Step header */}
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-3">
          <span className="font-mono text-[10.5px] tracking-wider text-ink-4">
            step {index}/{total}
          </span>
          <span className="truncate font-display text-[14px] font-semibold tracking-tight text-ink">
            {data.one_line_description || cell.label || 'Untitled'}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setShowCode((v) => !v)}
          className={clsx(
            'flex flex-none cursor-pointer items-center gap-1 rounded-md border border-line px-2 py-1',
            'font-mono text-[10.5px] tracking-wider',
            showCode ? 'bg-accent text-white border-accent' : 'bg-transparent text-ink-3 hover:bg-surface-2 hover:text-ink'
          )}
        >
          {showCode ? 'Hide code' : 'Show code'}
        </button>
      </div>

      {/* Meta strip — timing + packages only. No `action` chip; the
          one-line description above already says what the step does. */}
      <div className="mt-1 flex items-center gap-3 font-mono text-[10.5px] text-ink-4">
        {fmtMs(reasoningMs) && <span>reason: <span className="text-ink-3">{fmtMs(reasoningMs)}</span></span>}
        {fmtMs(executionMs) && <span>exec: <span className="text-ink-3">{fmtMs(executionMs)}</span></span>}
        {Array.isArray(data.packages) && data.packages.length > 0 && (
          <span>pkgs: <span className="text-ink-3">{data.packages.join(', ')}</span></span>
        )}
      </div>

      {/* Output — render as a bare block without a section label, and
          omit it entirely when the step produced no stdout. Steps that
          only manipulate state (no print) shouldn't surface a "no
          output" placeholder; the absence is the cleanest signal. */}
      {stdout && (
        <pre className="mt-4 overflow-x-auto rounded-md border border-line bg-surface-2 p-3 font-mono text-[12px] leading-snug text-ink">
{stdout}
        </pre>
      )}

      {/* Code + stderr — revealed by the toggle */}
      {showCode && (
        <>
          <Section label="Code">
            {code
              ? <div className="overflow-hidden rounded-md border border-line"><CodeBlock code={code} language={language} /></div>
              : <p className="font-body text-[12.5px] italic text-ink-4">No code captured for this cell.</p>}
          </Section>

          {hasErr && (
            <Section label="Stderr">
              <pre className="overflow-x-auto rounded-md border border-red-200 bg-red-50 p-3 font-mono text-[12px] leading-snug text-red-700">
{stderr}
              </pre>
            </Section>
          )}
        </>
      )}
    </div>
  );
}

function Section({ label, muted = false, children }) {
  return (
    <div className="mt-4 flex flex-col gap-1.5">
      <span className={clsx(
        'font-display text-[10.5px] font-semibold uppercase tracking-widest',
        muted ? 'text-ink-4 opacity-60' : 'text-ink-4'
      )}>
        {label}
      </span>
      {children}
    </div>
  );
}
