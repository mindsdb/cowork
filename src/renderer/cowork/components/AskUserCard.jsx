import { useState } from 'react';
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

  const settled = Boolean(answer) || expired || gone;

  const send = async (payload) => {
    if (settled || busy) return;
    setBusy(true);
    const result = await submitAnswer(conversationId, q.question_id, payload);
    setBusy(false);
    if (result?.status === 'not_found') setGone(true);
    // The conversation id travels with the result so the listener doesn't have
    // to assume this card belongs to whatever conversation is currently open.
    onAnswered?.(result, conversationId);
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

  return (
    <div className="rounded-lg border border-line bg-surface-2 p-3">
      <div className="mb-2 text-[13px] text-ink">{q.prompt}</div>

      <div className="flex flex-col gap-1.5">
        {(q.options || []).map((option) => (
          <button
            key={option.value}
            type="button"
            disabled={settled || busy}
            data-chosen={chosen.has(option.value) ? 'true' : 'false'}
            aria-pressed={isMany ? picked.includes(option.value) : undefined}
            onClick={() => onOption(option.value)}
            className="flex flex-col items-start rounded-md border border-line px-2.5 py-1.5 text-left text-[12.5px] disabled:opacity-60"
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
      ) : null}
      {expired || gone ? (
        <div className="mt-2 text-[11.5px] text-ink-4">
          This question is no longer active.
        </div>
      ) : null}
    </div>
  );
}
