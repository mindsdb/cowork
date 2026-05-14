// react-markdown `code` slot replacement. Adapted from mdb-ai/MarkdownCode.
// Three behaviours:
//   - ```chartjs <full Chart.js config> → render the chart inline
//   - ```chart  <intent JSON>          → not supported yet (no compile
//                                        endpoint in our backend),
//                                        shows error placeholder.
//   - everything else                  → plain <code> with our token style

import { useEffect, useMemo } from 'react';
import { ChartLoadingState, ChartErrorState } from './ChartStates';
import { MessageChart } from './MessageChart';
import { parseChartIntent } from './utils';
import { highlightCode } from './hljs';
import Ico from '../Icons';
import { patchForm, setForm } from '../datavault/formStore';
import { parseFormSpec } from '../datavault/parseFormSpec';

export function MarkdownCode(props) {
  const lang = props?.className?.replace('language-', '') || '';
  const text = String(props?.children ?? '');
  const id = props?.id;
  const complete = props?.complete !== false; // assume complete unless told otherwise
  const conversationId = props?.conversationId || null;

  // ── ALL HOOKS FIRST ───────────────────────────────────────────────
  // Critical: every useMemo/useEffect must run on every render of
  // this component instance, in the same order. The earlier version
  // had `useMemo(formSpec)` + `useEffect` followed by an early return
  // for `data-vault-form`, which meant `useMemo(chartIntent)` below
  // ran on some renders and not others — that's a rules-of-hooks
  // violation that React surfaces as a max-update-depth crash.
  //
  // We compute every memo up front, then branch on lang for the
  // actual return. Each branch's logic is otherwise unchanged.

  // Both `data-vault-form` (full spec) and `data-vault-form-patch`
  // (partial update) parse the same way — just a JSON object. The
  // difference is in how the form store consumes them: setForm
  // replaces, patchForm merges.
  const isFormLang = lang === 'data-vault-form' || lang === 'data-vault-form-patch';
  const parseAttempt = useMemo(() => {
    if (!isFormLang) return { spec: null, error: null };
    if (!complete) return { spec: null, error: null };
    return parseFormSpec(text);
  }, [isFormLang, text, complete]);
  const formSpec = parseAttempt.spec;
  const parseError = parseAttempt.error;

  const chartIntent = useMemo(() => {
    if (lang === 'chart' && text) return parseChartIntent(text);
    return null;
  }, [lang, text]);

  // Highlighted output for ordinary fenced blocks. We skip the special
  // langs (chartjs/chart/data-vault-form*) so we don't pay the hljs
  // cost on blocks that have their own renderer. Computed unconditionally
  // (i.e. always returning `null` for the special branches) keeps the
  // hook count stable across renders, in line with the comment above
  // about rules-of-hooks discipline.
  const highlighted = useMemo(() => {
    const isSpecial = isFormLang || lang === 'chart' || lang === 'chartjs';
    if (!lang || isSpecial) return null;
    // Strip a single trailing newline left by remark — keeps Copy output
    // clean and avoids a phantom blank line at the bottom of the block.
    return highlightCode(text.replace(/\n$/, ''), lang);
  }, [lang, isFormLang, text]);

  useEffect(() => {
    if (!isFormLang || !conversationId || !complete) return;
    if (formSpec) {
      // Patch dialect merges into the existing form (preserves the
      // user's typed values + only changes the bits Anton specified);
      // the full dialect replaces.
      if (lang === 'data-vault-form-patch') {
        patchForm(conversationId, formSpec);
      } else {
        setForm(conversationId, formSpec);
      }
      return;
    }
    if (parseError) {
      // Push a synthetic "parse error" spec into the form store so
      // the side panel surfaces a retry affordance instead of just
      // a dead inline error. The user clicks "Ask Anton to retry"
      // → DataVaultFormPanel dispatches a recovery message.
      setForm(conversationId, {
        form_id: 'fm_parse_error',
        title: 'Form did not parse',
        subtitle: 'Anton sent a form spec that wasn’t valid JSON.',
        logo: 'database',
        logo_color: 'var(--danger)',
        fields: [],
        form_error: parseError,
        actions: [
          { id: 'retry', label: 'Ask Anton to retry', kind: 'primary' },
          { id: 'dismiss', label: 'Dismiss', kind: 'cancel' },
        ],
        // Carry the raw text so the panel can offer a "show raw" peek.
        _raw: text.length > 1000 ? text.slice(0, 1000) + '\n…' : text,
        _is_error: true,
      });
    }
  }, [isFormLang, lang, complete, formSpec, parseError, conversationId, text]);

  // ── BRANCHES (no more hooks past this point) ──────────────────────

  if (isFormLang) {
    const isPatch = lang === 'data-vault-form-patch';
    // Patches are pure side-channel updates (status_text changes,
    // success/failure flips, field merges). The form panel reflects
    // them live via the formStore subscription in the useEffect
    // above — surfacing them in chat too would just produce a stack
    // of "Form updated…" noise as the probe streams. So patches
    // render NOTHING in chat. Full `data-vault-form` blocks (initial
    // form appearance) still get a one-time pointer card.
    if (isPatch) return null;
    if (!complete) {
      return (
        <div style={{
          margin: '8px 0',
          padding: '10px 12px',
          borderRadius: 8,
          background: 'var(--surface-2)',
          border: '1px dashed var(--line-2)',
          color: 'var(--ink-4)',
          fontFamily: 'var(--font-body)', fontSize: 12.5,
          display: 'inline-flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ display: 'inline-flex', color: 'var(--accent)' }}>{Ico.database(13)}</span>
          Preparing form…
        </div>
      );
    }
    if (!formSpec) {
      return (
        <div style={{
          margin: '8px 0',
          padding: '10px 12px',
          borderRadius: 8,
          background: 'color-mix(in srgb, var(--danger) 10%, var(--surface))',
          border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)',
          color: 'var(--danger)',
          fontFamily: 'var(--font-body)', fontSize: 12.5,
          display: 'flex', flexDirection: 'column', gap: 4,
        }}>
          <strong style={{ fontWeight: 600 }}>Form spec did not parse.</strong>
          {parseError && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)' }}>
              {parseError}
            </span>
          )}
          <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>
            Use the side panel to ask Anton to retry.
          </span>
        </div>
      );
    }
    return (
      <div style={{
        margin: '8px 0',
        padding: '10px 12px',
        borderRadius: 8,
        background: 'color-mix(in srgb, var(--accent) 8%, var(--surface))',
        border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
        color: 'var(--ink-2)',
        fontFamily: 'var(--font-body)', fontSize: 12.5,
        display: 'inline-flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ display: 'inline-flex', color: 'var(--accent)' }}>{Ico.database(13)}</span>
        <span>
          <strong style={{ color: 'var(--ink)' }}>{formSpec.title || 'Form'}</strong>
          {' — fill it out in the side panel →'}
        </span>
      </div>
    );
  }

  // Intent format — needs a server endpoint to compile JSON into a real
  // Chart.js config. We don't have that yet, so surface a clear message.
  if (lang === 'chart') {
    if (!complete) return <ChartLoadingState />;
    if (!chartIntent || chartIntent.error) {
      return <ChartErrorState error={chartIntent?.error || 'Invalid chart specification'} />;
    }
    return (
      <ChartErrorState error="`chart` intent format requires a backend compile endpoint (not wired yet). Use `chartjs` for full configs." />
    );
  }

  // Legacy / direct chartjs format — full Chart.js config in the block.
  if (lang === 'chartjs') {
    return complete ? <MessageChart id={id || 'chart'} text={text} /> : <ChartLoadingState />;
  }

  // Ordinary fenced block — Claude-style card with a language header,
  // a Copy button (handled by a delegated listener in MarkdownContent),
  // and a syntax-highlighted body. MarkdownContent strips the outer
  // <pre> for fenced children so the <div> wrapper stays valid HTML.
  if (lang && highlighted) {
    const raw = text.replace(/\n$/, '');
    return (
      <div className="anton-code-block" data-language={highlighted.language}>
        <div className="anton-code-block-header">
          <span className="anton-code-block-lang">{highlighted.language}</span>
          <button
            type="button"
            className="anton-code-block-copy"
            data-copy-code=""
            aria-label={`Copy ${highlighted.language} code`}
          >
            <span className="anton-code-block-copy-icon anton-code-block-copy-icon--idle" aria-hidden="true">
              {Ico.copy(12)}
            </span>
            <span className="anton-code-block-copy-icon anton-code-block-copy-icon--done" aria-hidden="true">
              {Ico.check(12)}
            </span>
            <span className="anton-code-block-copy-label">Copy</span>
          </button>
        </div>
        <pre className="anton-code-block-pre">
          <code
            className={`hljs language-${highlighted.language}`}
            data-source={raw}
            dangerouslySetInnerHTML={{ __html: highlighted.html }}
          />
        </pre>
      </div>
    );
  }

  // Inline code (single backticks) — kept visually distinct from fenced
  // blocks: no header, lighter background, in-flow.
  return (
    <code className="font-mono text-[12.5px] text-ink rounded bg-surface-2 px-1 py-0.5">
      {props.children}
    </code>
  );
}
