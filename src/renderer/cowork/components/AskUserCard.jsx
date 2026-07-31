import { useEffect, useId, useState } from 'react';
import { submitAnswer } from '../api';

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

  // This is the only interactive control in an otherwise static stream, it
  // appears unprompted mid-turn, and it blocks the agent — so a screen-reader
  // user needs to be told it is their turn. The region has to mount EMPTY and
  // be filled on a later commit: aria-live announces content CHANGES, so a
  // card that arrives with its text already in place is silent.
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => {
    setAnnouncement(settled ? '' : `The agent is asking a question: ${q.prompt || ''}`);
  }, [settled, q.prompt]);

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
  // What the user actually picked, in the answer's own order, mapped back to
  // the labels they clicked. Rendered because a card reloaded in the answered
  // state otherwise showed the prompt, greyed buttons, and nothing at all about
  // the choice — the state the props-derived `settled` design exists to serve.
  const chosenLabels = (answer?.values || []).map((v) => {
    const opt = (q.options || []).find((o) => o.value === v);
    return opt?.label || v;
  });

  return (
    <div className="rounded-lg border border-line bg-surface-2 p-3">
      <div id={promptId} className="mb-2 text-[13px] text-ink">{q.prompt}</div>

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
        {(q.options || []).map((option) => (
          <button
            key={option.value}
            type="button"
            disabled={settled || busy}
            data-chosen={chosen.has(option.value) ? 'true' : 'false'}
            aria-pressed={isMany ? picked.includes(option.value) : chosen.has(option.value)}
            onClick={() => onOption(option.value)}
            className={`flex flex-col items-start rounded-md border px-2.5 py-1.5 text-left text-[12.5px] disabled:opacity-60 ${
              chosen.has(option.value)
                ? 'border-accent bg-accent-bg text-ink font-medium'
                : 'border-line'
            }`}
          >
            <span>{option.label || option.value}</span>
            {option.detail ? (
              <span className="text-[11px] text-ink-4">{option.detail}</span>
            ) : null}
          </button>
        ))}
      </div>

      {isMany && !settled ? (
        <button
          type="button"
          disabled={picked.length === 0 || busy}
          onClick={() => send({ values: picked })}
          className="mt-2 rounded-md border border-line px-2.5 py-1 text-[12px] disabled:opacity-60"
        >
          Send
        </button>
      ) : null}

      {!settled ? (
        <div className="mt-2 flex items-center gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => send({ skipped: true })}
            className="text-[11.5px] text-ink-4 underline"
          >
            Skip
          </button>
          {q.allow_custom ? (
            <span className="text-[11px] text-ink-4">
              …or type your own answer below.
            </span>
          ) : null}
        </div>
      ) : null}

      {answer?.status === 'cancelled' ? (
        <div className="mt-2 text-[11.5px] text-ink-4">Skipped.</div>
      ) : null}
      {answer?.status === 'timeout' ? (
        <div className="mt-2 text-[11.5px] text-ink-4">No answer — timed out.</div>
      ) : null}
      {answer?.text ? (
        <div className="mt-2 text-[11.5px] text-ink-3">Answered: {answer.text}</div>
      ) : chosenLabels.length > 0 ? (
        <div className="mt-2 text-[11.5px] text-ink-3">
          Answered: {chosenLabels.join(', ')}
        </div>
      ) : null}
      {expired || gone ? (
        <div className="mt-2 text-[11.5px] text-ink-4">
          This question is no longer active.
        </div>
      ) : null}
    </div>
  );
}
