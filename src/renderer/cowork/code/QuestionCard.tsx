import { useState } from 'react';
import Button from '../components/ui/Button';
import type { PendingQuestion } from './api';
import './task-control.css';

export function QuestionCard({ pending, busy, onAnswer }: {
  pending: PendingQuestion;
  busy: boolean;
  onAnswer: (answers: Record<string, string[]>) => Promise<void>;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const complete = pending.questions.every(question => !!answers[question.id]?.trim());
  const submit = async () => {
    if (busy || !complete) return;
    setError('');
    try {
      await onAnswer(Object.fromEntries(pending.questions.map(question => [question.id, [answers[question.id].trim()]])));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not send your answers. Try again.');
    }
  };
  return <section className="code-decision" aria-label="Agent questions">
    <header className="code-decision__header"><span className="code-decision__eyebrow">Your input</span><h3>A quick decision before continuing</h3></header>
    {pending.questions.map(question => <fieldset key={question.id} disabled={busy} className="code-question">
      <legend>{question.question}</legend>
      {!question.isSecret && question.options?.map((option, index) => <label className="code-question__option" key={`${option.label}-${index}`}>
        <input type="radio" name={`${pending.id}-${question.id}`} value={option.label} checked={answers[question.id] === option.label}
          onChange={() => setAnswers(current => ({ ...current, [question.id]: option.label }))} />
        <span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>
      </label>)}
      {(question.isSecret || question.isOther || !question.options?.length) && <label className="code-question__custom">
        <span>{question.isSecret ? 'Private answer' : question.options?.length ? 'Or write your own answer' : 'Your answer'}</span>
        <input type={question.isSecret ? 'password' : 'text'} autoComplete="off" maxLength={8000}
          value={!question.isSecret && question.options?.some(option => option.label === answers[question.id]) ? '' : answers[question.id] || ''}
          onChange={event => setAnswers(current => ({ ...current, [question.id]: event.target.value }))} />
      </label>}
    </fieldset>)}
    {error && <p className="code-decision__error" role="alert">{error}</p>}
    <footer><span>No answer is sent until you continue.</span><Button variant="primary" size="sm" disabled={busy || !complete} onClick={() => void submit()}>{busy ? 'Sending…' : 'Continue'}</Button></footer>
  </section>;
}
