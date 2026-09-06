// Group cells by _scratchpadTabId (Anton's name); reveal code and stderr on demand.

import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import Ico from '../Icons';
import { Badge, Tooltip } from '../ui';
import { Modal } from '../ui/Modal';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import { CodeBlock } from './CodeBlock';

function fmtMs(ms) {
  if (!Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}

function detectLanguage(data, isToolCall) {
  if (isToolCall) return 'json';
  return 'python';
}

// Group unnamed cells into one tab instead of creating a separate single-cell pad for each.
const UNNAMED_TAB_KEY = '__unnamed__';

export function ScratchpadModal({ open, onClose, steps = [], focusStepId = null }) {
  const { isNarrow } = useBreakpoint();

  // Trim tab IDs and treat empty/whitespace names as the shared unnamed group.
  const tabs = useMemo(() => {
    const byTab = new Map();
    for (const s of steps) {
      // Skip reasoning-only steps because they have no inspectable payload.
      if (!s._isScratchpad && !s._isToolCall) continue;
      const raw = s._scratchpadTabId;
      const tabId = typeof raw === 'string' && raw.trim() ? raw.trim() : null;
      const key = tabId || UNNAMED_TAB_KEY;
      if (!byTab.has(key)) {
        // Tool-call IDs are opaque, so display step labels; scratchpad IDs are already
        // human-readable names.
        const displayName = !tabId
          ? 'Untitled'
          : (s._isToolCall ? (s.label || tabId) : tabId);
        byTab.set(key, { id: key, name: displayName, cells: [] });
      }
      byTab.get(key).cells.push(s);
    }
    return [...byTab.values()];
  }, [steps]);

  const focusTabId = useMemo(() => {
    if (!focusStepId) return tabs[0]?.id;
    const focused = steps.find((s) => s.id === focusStepId);
    if (!focused) return tabs[0]?.id;
    const raw = focused._scratchpadTabId;
    const trimmed = typeof raw === 'string' && raw.trim() ? raw.trim() : null;
    const key = trimmed || UNNAMED_TAB_KEY;
    return tabs.find((t) => t.id === key)?.id || tabs[0]?.id;
  }, [focusStepId, steps, tabs]);

  const [activeTabId, setActiveTabId] = useState(focusTabId);
  useEffect(() => { if (focusTabId) setActiveTabId(focusTabId); }, [focusTabId]);

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];
  // Use a tool-call title for tabs containing no scratchpad cells.
  const activeIsToolCallOnly = !!activeTab && activeTab.cells.every((c) => c._isToolCall);
  const modalTitle = activeIsToolCallOnly ? (activeTab.name || 'Tool Call') : 'Scratchpad';


  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      width="min(1040px, 94vw)"
      height="82vh"
      fullBleed={isNarrow}
      ariaLabel={modalTitle}
    >
      <div className="scratchpad-modal flex h-full flex-col overflow-hidden">

        <div className="flex flex-none items-center justify-between border-b border-line px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex text-ink-3">{Ico.code(15)}</span>
            <span className="s-h3 text-ink">
              {modalTitle}
            </span>
          </div>
          <Tooltip content="Close">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-ink-3 hover:bg-surface-2 hover:text-ink"
            >
              ×
            </button>
          </Tooltip>
        </div>

        {/* Use theme variables so tab chrome retains contrast in both themes. */}
        {tabs.length > 1 && (
          <div style={{
            display: 'flex', flex: '0 0 auto',
            gap: 2,
            padding: '0 8px',
            background: 'var(--surface)',
            borderBottom: '1px solid var(--line)',
            overflowX: 'auto',
          }}>
            {tabs.map((t) => {
              const active = t.id === activeTabId;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveTabId(t.id)}
                  style={{
                    position: 'relative',
                    display: 'inline-flex', alignItems: 'center', gap: 8,
                    flexShrink: 0,
                    padding: '10px 12px',
                    background: 'transparent',
                    border: 0,
                    cursor: 'pointer',
                    fontFamily: 'var(--font-display)',
                    fontSize: 12.5,
                    fontWeight: 500,
                    letterSpacing: '0',
                    color: active ? 'var(--ink)' : 'var(--ink-3)',
                    transition: 'color 120ms ease',
                  }}
                  onMouseOver={(e) => {
                    if (!active) e.currentTarget.style.color = 'var(--ink-2)';
                  }}
                  onMouseOut={(e) => {
                    if (!active) e.currentTarget.style.color = 'var(--ink-3)';
                  }}
                >
                  <span style={{
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    maxWidth: 180,
                  }} title={t.name}>{t.name}</span>
                  <Badge
                    variant={active ? 'accent' : 'muted'}
                    size="xs"
                    className="min-w-[18px] justify-center font-mono tabular-nums"
                  >{t.cells.length}</Badge>
                  {active && (
                    <span aria-hidden style={{
                      position: 'absolute',
                      left: 8, right: 8,
                      bottom: -1,
                      height: 2,
                      borderRadius: 1,
                      background: 'var(--accent)',
                    }} />
                  )}
                </button>
              );
            })}
          </div>
        )}

        <div className="flex-1 overflow-y-auto" style={{ WebkitAppRegion: 'no-drag' }}>
          {activeTab?.cells.map((cell, i) => (
            <CellView
              key={cell.id}
              cell={cell}
              index={i + 1}
              total={activeTab.cells.length}
              focused={cell.id === focusStepId}
            />
          ))}
          {(!activeTab || activeTab.cells.length === 0) && (
            <p className="p-8 text-body text-ink-4">No steps in this turn.</p>
          )}
        </div>
      </div>
    </Modal>
  );
}

function CellView({ cell, index, total, focused = false }) {
  const [showCode, setShowCode] = useState(false);
  const containerRef = useRef(null);
  const data = cell.data || {};

  const [highlight, setHighlight] = useState(false);
  useEffect(() => {
    if (!focused) return undefined;
    const node = containerRef.current;
    if (!node) return undefined;
    const id = requestAnimationFrame(() => {
      try { node.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
      catch { node.scrollIntoView(); }
    });
    setHighlight(true);
    const t = setTimeout(() => setHighlight(false), 1600);
    return () => { cancelAnimationFrame(id); clearTimeout(t); };
  }, [focused]);
  const isToolCall = !!cell._isToolCall;
  // Tool events can be clipped at 64 KB; try canonical then result-carried code copies. For
  // tool-call args,
  // exclude one_line_description because it is progress metadata, not an argument.
  const code = isToolCall
    ? (() => {
        const { one_line_description: _omit, ...args } = data;
        return Object.keys(args).length > 0 ? JSON.stringify(args, null, 2) : '';
      })()
    : (data.code || cell.result?.code || cell.result?.input?.code || '');
  const stdout = cell.output || cell.result?.stdout || '';
  const stderr = cell.stderr || cell.result?.stderr || '';
  const reasoningMs =
    cell.executionStartedAt && cell.reasoningStartedAt
      ? cell.executionStartedAt - cell.reasoningStartedAt
      : null;
  // Prefer server-measured execution duration; arrival-time differences are a legacy fallback
  // affected by stream jitter.
  const executionMs = (typeof cell.executionDurationMs === 'number'
    && Number.isFinite(cell.executionDurationMs))
    ? cell.executionDurationMs
    : (cell.executionCompletedAt && cell.executionStartedAt
        ? cell.executionCompletedAt - cell.executionStartedAt
        : null);
  const language = detectLanguage(data, isToolCall);
  const hasErr = !!stderr;
  useEffect(() => { if (hasErr) setShowCode(true); }, [hasErr]);

  return (
    <div
      ref={containerRef}
      className={clsx(
        'scratchpad-cell',
        'border-b border-line py-5 last:border-b-0',
        'pl-6 pr-6',
        // Keep a transparent border when unfocused so the highlight does not shift layout.
        'border-l-2',
        highlight ? 'border-l-accent bg-surface-2' : 'border-l-transparent',
        'transition-colors duration-700',
      )}
    >
      <div
        className="scratchpad-cell-grid grid items-start"
        style={{ gridTemplateColumns: 'auto 1fr', columnGap: 12 }}
      >
        <span className="font-mono text-[10.5px] tracking-wider text-ink-4 pt-[2px]">
          step {index}/{total}
        </span>

        <div className="min-w-0 flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="truncate font-display text-[14px] font-semibold text-ink">
              {data.one_line_description || cell.label || 'Untitled'}
            </span>
            {code && (
              <CodeToggle checked={showCode} onChange={setShowCode} label={isToolCall ? 'Args' : 'Code'} />
            )}
          </div>

          {!isToolCall && (
            <div className="flex items-center gap-3 font-mono text-[10.5px] text-ink-4">
              <span>reason: <span className="text-ink-3">{fmtMs(reasoningMs) ?? '—'}</span></span>
              <span>exec: <span className="text-ink-3">{fmtMs(executionMs) ?? '—'}</span></span>
            </div>
          )}
          {isToolCall && executionMs != null && (
            <div className="flex items-center gap-3 font-mono text-[10.5px] text-ink-4">
              <span>duration: <span className="text-ink-3">{fmtMs(executionMs) ?? '—'}</span></span>
            </div>
          )}

          {showCode && code && (
            <Section
              label={isToolCall ? 'Arguments' : 'Code'}
              right={!isToolCall && Array.isArray(data.packages) && data.packages.length > 0 ? (
                <span
                  className="font-mono text-[10.5px] text-ink-4 truncate max-w-[60%]"
                  title={data.packages.join(', ')}
                >
                  pkgs: <span className="text-ink-3">{data.packages.join(', ')}</span>
                </span>
              ) : null}
            >
              <div className="overflow-hidden rounded-md border border-line">
                <CodeBlock code={code} language={language} />
              </div>
            </Section>
          )}

          {stdout && (
            (() => {
              let formattedOutput = stdout;
              let outputLang = null;
              if (isToolCall) {
                try {
                  const parsed = JSON.parse(stdout);
                  formattedOutput = JSON.stringify(parsed, null, 2);
                  outputLang = 'json';
                } catch { /* not JSON — render as plain text */ }
              }
              const outputBlock = outputLang
                ? <div className="overflow-hidden rounded-md border border-line"><CodeBlock code={formattedOutput} language={outputLang} /></div>
                : <pre className="overflow-x-auto rounded-md border border-line bg-surface-2 p-3 font-mono text-[12px] leading-snug text-ink">{formattedOutput}</pre>;
              return showCode
                ? <Section label="Output">{outputBlock}</Section>
                : <div className="mt-4">{outputBlock}</div>;
            })()
          )}

          {/* Show stderr with the inspector, which opens automatically for errored cells. */}
          {showCode && hasErr && (
            <Section label="Stderr">
              <pre className="overflow-x-auto rounded-md border border-red-200 bg-red-50 p-3 font-mono text-[12px] leading-snug text-red-700">
{stderr}
              </pre>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

function CodeToggle({ checked, onChange, label = 'Code' }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!!checked}
      aria-label={checked ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
      onClick={() => onChange?.(!checked)}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        flexShrink: 0,
        padding: '4px 6px',
        background: 'transparent',
        border: 0,
        borderRadius: 6,
        cursor: 'pointer',
        fontFamily: 'var(--font-body)',
        fontSize: 11.5,
        fontWeight: 500,
        color: 'var(--ink-3)',
        transition: 'color 120ms ease',
      }}
      onMouseOver={(e) => { e.currentTarget.style.color = 'var(--ink-2)'; }}
      onMouseOut={(e)  => { e.currentTarget.style.color = 'var(--ink-3)'; }}
    >
      <span>{label}</span>
      <span aria-hidden style={{
        position: 'relative',
        display: 'inline-block',
        width: 32, height: 18,
        borderRadius: 999,
        background: checked
          ? 'var(--accent)'
          : 'color-mix(in srgb, var(--ink) 18%, transparent)',
        transition: 'background 180ms ease',
      }}>
        <span style={{
          position: 'absolute',
          top: 2,
          left: checked ? 16 : 2,
          width: 14, height: 14,
          borderRadius: '50%',
          background: '#fff',
          boxShadow: '0 1px 2px rgba(15,16,17,0.18)',
          transition: 'left 180ms cubic-bezier(0.4, 0, 0.2, 1)',
        }} />
      </span>
    </button>
  );
}


function Section({ label, muted = false, right, children }) {
  return (
    <div className="mt-4 flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className={clsx(
          'font-display text-[10.5px] font-semibold uppercase tracking-widest',
          muted ? 'text-ink-4 opacity-60' : 'text-ink-4'
        )}>
          {label}
        </span>
        {right}
      </div>
      {children}
    </div>
  );
}
