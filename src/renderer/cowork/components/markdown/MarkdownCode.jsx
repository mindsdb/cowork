// react-markdown `code` slot replacement. Adapted from mdb-ai/MarkdownCode.
// Three behaviours:
//   - ```chartjs <full Chart.js config> → render the chart inline
//   - ```chart  <intent JSON>          → not supported yet (no compile
//                                        endpoint in our backend),
//                                        shows error placeholder.
//   - everything else                  → plain <code> with our token style

import { useEffect, useMemo, useRef } from 'react';
import { ChartLoadingState, ChartErrorState } from './ChartStates';
import { MessageChart } from './MessageChart';
import { parseChartIntent } from './utils';
import { highlightCode } from './hljs';
import Ico from '../Icons';
import { patchForm, setForm, getForm } from '../datavault/formStore';
import { parseFormSpec } from '../datavault/parseFormSpec';

export function MarkdownCode(props) {
  const lang = props?.className?.replace('language-', '') || '';
  const text = String(props?.children ?? '');
  const isBlock = props?.block === true;
  const id = props?.id;
  const complete = props?.complete !== false; // assume complete unless told otherwise
  const conversationId = props?.conversationId || null;
  // Capability flags. Assistant turns leave these defaulted to true so
  // existing behavior (forms, charts, parse-error pointers) is
  // unchanged. User turns pass `false` so a typed ```data-vault-form
  // / ```chart / ```chartjs fence falls through to the ordinary code
  // block branch and never triggers a side-effect renderer.
  const enableForms = props?.enableForms !== false;
  const enableCharts = props?.enableCharts !== false;
  // Track whether this block was already complete when first mounted.
  // Historical messages mount with complete=true immediately; live
  // streams mount with complete=false and flip to true when the chunk
  // finishes. We skip form-store side-effects for historical replays
  // so navigating back to a chat doesn't re-trigger success modals.
  const wasCompleteOnMount = useRef(complete);
  const isHistorical = wasCompleteOnMount.current;

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
  const isFormLang = enableForms && (lang === 'data-vault-form' || lang === 'data-vault-form-patch');
  const parseAttempt = useMemo(() => {
    if (!isFormLang) return { spec: null, error: null };
    if (!complete) return { spec: null, error: null };
    return parseFormSpec(text);
  }, [isFormLang, text, complete]);
  const formSpec = parseAttempt.spec;
  const parseError = parseAttempt.error;

  const chartIntent = useMemo(() => {
    if (enableCharts && lang === 'chart' && text) return parseChartIntent(text);
    return null;
  }, [enableCharts, lang, text]);

  // Highlighted output for ordinary fenced blocks. We skip the special
  // langs (chartjs/chart/data-vault-form*) so we don't pay the hljs
  // cost on blocks that have their own renderer. Computed unconditionally
  // (i.e. always returning `null` for the special branches) keeps the
  // hook count stable across renders, in line with the comment above
  // about rules-of-hooks discipline. When charts/forms are disabled the
  // special langs flow through here so they render as plain highlighted
  // code blocks (and `lang` is preserved as a header label).
  const highlighted = useMemo(() => {
    const isChartLang = lang === 'chart' || lang === 'chartjs';
    const isSpecial = isFormLang || (enableCharts && isChartLang);

    if (isSpecial) return null;

    // Inline code has no language and is not inside a <pre>, so it should
    // remain inline. Fenced/indented code without a language is marked by
    // MarkdownContent's pre override as `block: true` and should render as
    // a full plaintext code block.
    if (!lang && !isBlock) return null;

    // Strip a single trailing newline left by remark — keeps Copy output
    // clean and avoids a phantom blank line at the bottom of the block.
    return highlightCode(text.replace(/\n$/, ''), lang || 'plaintext');
  }, [lang, isBlock, isFormLang, enableCharts, text]);

  useEffect(() => {
    if (!isFormLang || !conversationId || !complete) return;
    // Skip form-store side-effects for historical messages. When the
    // user navigates back to a chat, every completed message re-mounts
    // with complete=true from the start. Without this guard, all
    // data-vault-form / data-vault-form-patch blocks replay into the
    // store — causing dismissed success modals to reappear.
    if (isHistorical) return;
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
        subtitle: "The agent sent a form spec that was not valid JSON.",
        logo: 'database',
        logo_color: 'var(--danger)',
        fields: [],
        form_error: parseError,
        actions: [
          { id: 'retry', label: 'Ask the agent to retry', kind: 'primary' },
          { id: 'dismiss', label: 'Dismiss', kind: 'cancel' },
        ],
        // Carry the raw text so the panel can offer a "show raw" peek.
        _raw: text.length > 1000 ? text.slice(0, 1000) + '\n…' : text,
        _is_error: true,
      });
    }
  }, [isFormLang, lang, complete, formSpec, parseError, conversationId, text, isHistorical]);

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
            Use the side panel to ask the agent to retry.
          </span>
        </div>
      );
    }
    // The card is clickable: clicking re-opens the side panel when it's
    // been closed (mirrors ConnectIntroBubble for the picker path). No-op
    // when a form is already active for this conversation — the panel is
    // showing, and re-publishing the original spec would clobber any
    // in-progress input. Gated at click time via getForm() so we don't
    // need to subscribe to the store from inside the markdown renderer.
    const reopenPanel = () => {
      if (!conversationId || !formSpec) return;
      if (getForm(conversationId)) return; // already open
      setForm(conversationId, formSpec);
    };
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={reopenPanel}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); reopenPanel(); } }}
        title="Open in the side panel"
        style={{
          margin: '8px 0',
          padding: '10px 12px',
          borderRadius: 8,
          background: 'color-mix(in srgb, var(--accent) 8%, var(--surface))',
          border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
          color: 'var(--ink-2)',
          fontFamily: 'var(--font-body)', fontSize: 12.5,
          display: 'inline-flex', alignItems: 'center', gap: 8,
          cursor: 'pointer',
        }}
      >
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
  // Gated on `enableCharts`; when disabled (user turns), fall through to
  // the ordinary highlighted code block below.
  if (enableCharts && lang === 'chart') {
    if (!complete) return <ChartLoadingState />;
    if (!chartIntent || chartIntent.error) {
      return <ChartErrorState error={chartIntent?.error || 'Invalid chart specification'} />;
    }
    return (
      <ChartErrorState error="`chart` intent format requires a backend compile endpoint (not wired yet). Use `chartjs` for full configs." />
    );
  }

  // Legacy / direct chartjs format — full Chart.js config in the block.
  if (enableCharts && lang === 'chartjs') {
    return complete ? <MessageChart id={id || 'chart'} text={text} /> : <ChartLoadingState />;
  }

  // Ordinary fenced block — Claude-style card with a language header,
  // a Copy button (handled by a delegated listener in MarkdownContent),
  // and a syntax-highlighted body. MarkdownContent strips the outer
  // <pre> for fenced children so the <div> wrapper stays valid HTML.
  if ((lang || isBlock) && highlighted) {
    const raw = text.replace(/\n$/, '');
    // No-language fences render via the plaintext fallback; suppress the
    // label so the header reads as a bare Copy affordance instead of a
    // noisy "plaintext" tag. The accessible Copy label is generalised
    // for the same reason.
    const isPlaintext = highlighted.language === 'plaintext';
    return (
      <div className="anton-code-block" data-language={highlighted.language}>
        <div className="anton-code-block-header">
          <span className="anton-code-block-lang">{isPlaintext ? '' : highlighted.language}</span>
          <button
            type="button"
            className="anton-code-block-copy"
            data-copy-code=""
            aria-label={isPlaintext ? 'Copy code' : `Copy ${highlighted.language} code`}
          >
            <span className="anton-code-block-copy-icon anton-code-block-copy-icon--idle" aria-hidden="true">
              {Ico.copy(12)}
            </span>
            <span className="anton-code-block-copy-icon anton-code-block-copy-icon--done" aria-hidden="true">
              {Ico.check(12)}
            </span>
            {/* aria-live="polite" so screen readers announce the Copy →
                Copied → Copy transition without interrupting whatever
                they were reading. The delegated click listener in
                MarkdownContent mutates this span's textContent, which
                is what the live region picks up. */}
            <span className="anton-code-block-copy-label" aria-live="polite">Copy</span>
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
  // blocks: no header, lighter accent-tinted background, in-flow. Styled
  // in globals.css so the tint can use color-mix(...) against the theme
  // tokens (Tailwind alone can't reach the cyberpunk-accent wash we want).
  return (
    <code className="anton-inline-code">{props.children}</code>
  );
}
