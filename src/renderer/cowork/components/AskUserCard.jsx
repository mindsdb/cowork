import { useEffect, useId, useState } from 'react';
import { submitAnswer } from '../api';

/**
 * The agent waits for an answer. Use response.ask_user_answered data, not local clicks,
 * so answered state survives reloads and stays consistent across tabs.
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

  // Announce this blocking mid-turn question after mount: aria-live needs an initially empty region
  // and a later content change.
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => {
    setAnnouncement(settled ? '' : `The agent is asking a question: ${q.prompt || ''}`);
  }, [settled, q.prompt]);

  const send = async (payload) => {
    if (settled || busy) return;
    setBusy(true);
    const result = await submitAnswer(conversationId, q.question_id, payload);
    // Keep successful submissions disabled until ask_user_answered arrives; re-enabling after the
    // HTTP response allows a duplicate 409.
    const retryable = result?.status === 'error' || result?.status === 'rejected';
    if (retryable) setBusy(false);
    if (result?.status === 'not_found') setGone(true);
    // Carry both IDs so listeners can identify the answer after navigation or another question in
    // the same conversation.
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
  // Show the recorded labels in answer order when reloading an answered card.
  const chosenLabels = (answer?.values || []).map((v) => {
    const opt = (q.options || []).find((o) => o.value === v);
    return opt?.label || v;
  });

  return (
    <div className="rounded-lg border border-line bg-surface-2 p-3">
      <div id={promptId} className="mb-2 text-[13px] text-ink">{q.prompt}</div>

      <div className="sr-only" role="status" aria-live="polite">{announcement}</div>

      {/*
 * Associate options with the prompt. Use a toggle group: radiogroup would require arrow-key
 * navigation and roving tabindex.
 * For single-select, aria-pressed reflects the server-confirmed answer.
 */}
      <div className="flex flex-col gap-1.5" role="group" aria-labelledby={promptId}>
        {(q.options || []).map((option) => {
          // Multi-select previews local picks until submission settles; settled cards and
          // single-select use the confirmed answer.
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
              // Set every branch’s background explicitly: Tailwind preflight is off, so unset
              // buttons retain native chrome.
              className={`flex flex-col items-start rounded-md border px-2.5 py-1.5 text-left text-[12.5px] transition-colors disabled:opacity-60 ${
                isSelected
                  ? 'border-accent bg-accent-bg text-ink font-medium'
                  : 'border-line bg-surface text-ink hover:bg-surface-3 hover:border-line-2'
              }`}
            >
              <span>{option.label || option.value}</span>
              {option.detail ? (
                <span className="text-[11px] text-ink-4">{option.detail}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      {isMany && !settled ? (
        <button
          type="button"
          disabled={picked.length === 0 || busy}
          onClick={() => send({ values: picked })}
          className="mt-2 rounded-md border border-line bg-surface text-ink px-2.5 py-1 text-[12px] transition-colors hover:bg-surface-3 hover:border-line-2 disabled:opacity-60"
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
            className="bg-transparent border-0 text-[11.5px] text-ink-4 underline"
          >
            Skip
          </button>
          {q.allow_custom ? (
            <span className="text-[11px] text-ink-4">
              …or type your own answer below.
            </span>
          ) : (
            // A select-only question blocks normal sends; explain why a typed reply cannot be
            // accepted.
            <span className="text-[11px] text-ink-4">
              Pick an option above — a typed reply won&apos;t be accepted. Skip to type
              something else.
            </span>
          )}
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
