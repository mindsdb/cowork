import { useEffect, useId, useMemo, useState } from 'react';
import { submitAnswer } from '../api';
import { MarkdownContent, MarkdownPlainText } from './markdown/MarkdownContent';
import ChatCardShell from './ChatCardShell';
import { cn } from '../lib/cn';

// An option button. Hover is `enabled:` only and the cursor resets when
// disabled: `hover:` also matches a disabled button, and globals.css gives
// every button a pointer, so a settled card still looked live. Explicit bg-*
// on both branches: preflight is off, so a button with no background falls
// through to native chrome. Only unselected options dim: the chosen one is
// the answer.
const OPTION = 'flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left text-sm transition-colors disabled:cursor-default';
const OPTION_IDLE = 'border-line bg-surface text-ink enabled:hover:bg-surface-3 disabled:opacity-60';
const OPTION_SELECTED = 'border-accent bg-accent-bg text-ink font-medium';

/**
 * An inline question card: the agent is blocked until this is answered.
 *
 * The answered state is driven by `step.data.answer`, which arrives on the
 * `response.ask_user_answered` event — never by the local click. That is what
 * makes the card correct after a reload and in a second tab.
 */
export default function AskUserCard({ step, conversationId, onAnswered, expired = false }) {
  const q = step?.data || {};
  const answer = q.answer || null;
  const isMany = q.select === 'many';
  const [picked, setPicked] = useState([]);
  const [gone, setGone] = useState(false);
  const [busy, setBusy] = useState(false);
  const promptId = useId();

  const settled = Boolean(answer) || expired || gone;

  // Only a multi-line prompt is markdown: the ask_user tool asks for one
  // plain-text line, and markdown would lose text in it ("<div>" vanishes,
  // "__init__" turns bold). The multi-line PRD brief needs softBreaks for its
  // single-newline lines; forms and charts stay off so a fence is plain code.
  // Memoised: ChatView re-renders on every streamed delta, and each card
  // would otherwise re-parse its brief every time.
  const prompt = q.prompt || '';
  const promptBody = useMemo(
    () => (prompt.trim().includes('\n') ? (
      <MarkdownContent
        text={prompt}
        softBreaks
        neutralizeLoopback
        enableForms={false}
        enableCharts={false}
      />
    ) : (
      <MarkdownPlainText>{prompt.trim()}</MarkdownPlainText>
    )),
    [prompt],
  );

  // This is the only interactive control in an otherwise static stream, it
  // appears unprompted mid-turn, and it blocks the agent — so a screen-reader
  // user needs to be told it is their turn. The region has to mount EMPTY and
  // be filled on a later commit: aria-live announces content CHANGES, so a
  // card that arrives with its text already in place is silent. The line is
  // fixed: the prompt can be a long markdown brief, and it is read through
  // the options group's aria-labelledby instead.
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => {
    setAnnouncement(settled ? '' : 'The agent is asking a question');
  }, [settled]);

  const send = async (payload) => {
    if (settled || busy) return;
    setBusy(true);
    const result = await submitAnswer(conversationId, q.question_id, payload);
    // `busy` is cleared ONLY for a failure the user can retry. On success the
    // card stays disabled until `settled` flips, which needs the
    // ask_user_answered event — clearing here would fully re-enable every
    // control in the window between the 200 and that event, and a second click
    // in that window submits again and 409s.
    const retryable = result?.status === 'error' || result?.status === 'rejected';
    if (retryable) setBusy(false);
    if (result?.status === 'not_found') setGone(true);
    // The conversation id AND the question id travel with the result: the
    // listener must not have to assume this card belongs to whatever
    // conversation is currently open, nor that this is the only question that
    // conversation has ever asked.
    onAnswered?.(result, conversationId, q.question_id);
  };

  const onOption = (value) => {
    if (!isMany) {
      void send({ values: [value] });
      return;
    }
    setPicked((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    );
  };

  const chosen = new Set(answer?.values || []);
  const chosenLabels = (answer?.values || []).map((v) => {
    const opt = (q.options || []).find((o) => o.value === v);
    return opt?.label || v;
  });
  // The typed text, or what the user picked in the answer's own order, mapped
  // back to the labels they clicked. Rendered because a card reloaded in the
  // answered state otherwise showed the prompt, greyed buttons, and nothing at
  // all about the choice — the state the props-derived `settled` design exists
  // to serve.
  const answerText = answer?.text || chosenLabels.join(', ');

  // Single-select submits on the option click, so it has no primary; a
  // multi-select stages picks until Send. The hint says what the composer
  // enforces: a select-only question refuses typed text (it would be rejected
  // as an answer, and it cannot be sent as a message without deadlocking the
  // blocked turn), so the user learns it before hitting it.
  const actions = settled ? null : {
    leading: (
      <span className="font-body text-xs leading-snug text-ink-4">
        {q.allow_custom
          ? '…or type your own answer below.'
          : 'Pick an option above — a typed reply won\'t be accepted. Skip to type something else.'}
      </span>
    ),
    secondary: { label: 'Skip', onClick: () => send({ skipped: true }), disabled: busy },
    primary: isMany
      ? { label: 'Send', onClick: () => send({ values: picked }), disabled: picked.length === 0 || busy }
      : null,
  };

  return (
    // No kind row: the turn's "Question for you" step already names the card.
    <ChatCardShell
      tone="question"
      kind={false}
      actions={actions}
      footer={settled ? (
        <>
          {answer?.status === 'cancelled' ? <div className="text-xs text-ink-4">Skipped.</div> : null}
          {answer?.status === 'timeout' ? <div className="text-xs text-ink-4">No answer — timed out.</div> : null}
          {/* Body text, not a status caption: a composer-typed answer is not
              echoed as a user message anywhere else. The bold prefix (styled
              like markdown bold) sets it apart from the prompt, which uses the
              same prose style. */}
          {answerText ? (
            <MarkdownPlainText>
              <strong className="font-semibold text-ink">Answered:</strong> {answerText}
            </MarkdownPlainText>
          ) : null}
          {expired || gone ? <div className="text-xs text-ink-4">This question is no longer active.</div> : null}
        </>
      ) : null}
    >
      {/* Only paragraphs reset their outer margins in the markdown sizes;
          drop them for a leading heading or trailing list in the card. */}
      <div
        id={promptId}
        className="mb-2 text-ink [&>.markdown-content>:first-child]:mt-0 [&>.markdown-content>:last-child]:mb-0"
      >
        {promptBody}
      </div>

      <div className="sr-only" role="status" aria-live="polite">{announcement}</div>

      {/* role="group" + aria-labelledby ties the options to the prompt, so the
          prompt is announced when focus enters the group rather than being a
          loose line of text above unrelated buttons.

          Deliberately NOT role="radiogroup" for single-select: that contract
          promises arrow-key navigation with a roving tabindex, which these
          plain tab-stop buttons do not implement, and a half-kept promise reads
          worse to a screen reader than an honest toggle group. `aria-pressed`
          is therefore set in BOTH modes — for single-select it reflects the
          server's recorded answer. */}
      <div className="flex flex-col gap-1.5" role="group" aria-labelledby={promptId}>
        {(q.options || []).map((option) => {
          // Single-select submits on click, so "selected" only ever means
          // the server-confirmed answer. Multi-select stages picks locally
          // until Send, so before settling it must reflect that local
          // toggle — otherwise a click has no visible effect at all. Once
          // settled, the confirmed `chosen` set is the source of truth for
          // both.
          const isSelected = isMany
            ? (settled ? chosen.has(option.value) : picked.includes(option.value))
            : chosen.has(option.value);
          return (
            <button
              key={option.value}
              type="button"
              disabled={settled || busy}
              data-chosen={isSelected ? 'true' : 'false'}
              aria-pressed={isSelected}
              onClick={() => onOption(option.value)}
              className={cn(OPTION, isSelected ? OPTION_SELECTED : OPTION_IDLE)}
            >
              <span>{option.label || option.value}</span>
              {option.detail ? (
                <span className="text-xs text-ink-4">{option.detail}</span>
              ) : null}
            </button>
          );
        })}
      </div>

    </ChatCardShell>
  );
}
