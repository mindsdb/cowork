// chartjs accepts a complete Chart.js config; chart intent blocks need an unavailable compiler and
// show an error.

import { useEffect, useMemo, useRef } from 'react';
import { ChartLoadingState, ChartErrorState } from './ChartStates';
import { MessageChart } from './MessageChart';
import { parseChartIntent } from './utils';
import { highlightCode } from './hljs';
import Ico from '../Icons';
import { Alert } from '../ui';
import { patchForm, setForm, getForm } from '../datavault/formStore';
import { parseFormSpec } from '../datavault/parseFormSpec';

export function MarkdownCode(props) {
  const lang = props?.className?.replace('language-', '') || '';
  const text = String(props?.children ?? '');
  const isBlock = props?.block === true;
  const id = props?.id;
  const complete = props?.complete !== false;
  const conversationId = props?.conversationId || null;
  // Disable form/chart capabilities for user turns so typed special fences render as code without
  // side effects.
  const enableForms = props?.enableForms !== false;
  const enableCharts = props?.enableCharts !== false;
  // Already-complete mounts are historical; suppress form side effects so navigation cannot reopen
  // dismissed modals.
  const wasCompleteOnMount = useRef(complete);
  const isHistorical = wasCompleteOnMount.current;

  // Run every hook before branching by language; early returns would change hook order as streamed
  // fences evolve.

  // Full forms replace store state; form patches merge it. Both parse as JSON objects.
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

  // Skip highlighting for enabled special renderers; disabled forms/charts fall back to ordinary
  // code.
  // Keep the memo unconditional to preserve hook order.
  const highlighted = useMemo(() => {
    const isChartLang = lang === 'chart' || lang === 'chartjs';
    const isSpecial = isFormLang || (enableCharts && isChartLang);

    if (isSpecial) return null;

    // Language-less code is inline unless MarkdownContent marks it as a fenced/indented block.
    if (!lang && !isBlock) return null;

    // Strip a single trailing newline left by remark — keeps Copy output
    // clean and avoids a phantom blank line at the bottom of the block.
    return highlightCode(text.replace(/\n$/, ''), lang || 'plaintext');
  }, [lang, isBlock, isFormLang, enableCharts, text]);

  useEffect(() => {
    if (!isFormLang || !conversationId || !complete) return;
    // Do not replay historical form updates into the store or dismissed panels would reopen.
    if (isHistorical) return;
    if (formSpec) {
      // Patch forms preserve existing input; full forms replace it.
      if (lang === 'data-vault-form-patch') {
        patchForm(conversationId, formSpec);
      } else {
        setForm(conversationId, formSpec);
      }
      return;
    }
    if (parseError) {
      // Publish a parse-error form so the panel can ask Anton to retry instead of leaving a dead
      // inline error.
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
        _raw: text.length > 1000 ? text.slice(0, 1000) + '\n…' : text,
        _is_error: true,
      });
    }
  }, [isFormLang, lang, complete, formSpec, parseError, conversationId, text, isHistorical]);

  // No hooks below these early-return branches.

  if (isFormLang) {
    const isPatch = lang === 'data-vault-form-patch';
    // Patches update the panel silently; only full forms render a chat pointer, avoiding repeated
    // status messages.
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
        <Alert variant="danger" title="Form spec did not parse." className="my-2">
          {parseError && (
            <span style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)', marginTop: 4 }}>
              {parseError}
            </span>
          )}
          <span style={{ display: 'block', fontSize: 11.5, color: 'var(--ink-3)', marginTop: 4 }}>
            Use the side panel to ask the agent to retry.
          </span>
        </Alert>
      );
    }
    // Check the store at click time before reopening; replacing an active form would destroy
    // in-progress input.
    const reopenPanel = () => {
      if (!conversationId || !formSpec) return;
      if (getForm(conversationId)) return;
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

  // Intent charts require a server compiler that is not available yet. Disabled charts fall through
  // to code.
  if (enableCharts && lang === 'chart') {
    if (!complete) return <ChartLoadingState />;
    if (!chartIntent || chartIntent.error) {
      return <ChartErrorState error={chartIntent?.error || 'Invalid chart specification'} />;
    }
    return (
      <ChartErrorState error="`chart` intent format requires a backend compile endpoint (not wired yet). Use `chartjs` for full configs." />
    );
  }

  if (enableCharts && lang === 'chartjs') {
    return complete ? <MessageChart id={id || 'chart'} text={text} /> : <ChartLoadingState />;
  }

  // MarkdownContent removes the outer pre so this block wrapper remains valid HTML.
  if ((lang || isBlock) && highlighted) {
    const raw = text.replace(/\n$/, '');
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
            {/* Announce delegated Copy label updates without interrupting screen-reader output. */}
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

  return (
    <code className="anton-inline-code">{props.children}</code>
  );
}
