import { useState } from 'react';
import Input from '../components/ui/Input';
import { RadioGroup, Radio } from '../components/ui/RadioGroup';
import Ico from '../components/Icons';
import type { PendingQuestion } from './api';
import { DecisionTray } from './DecisionTray';

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
  return <DecisionTray
    label="Agent questions"
    kind={pending.questions.length > 1 ? `${pending.questions.length} questions` : 'Question'}
    icon={Ico.user(12)}
    onSubmit={() => void submit()}
    actions={{ primary: { label: busy ? 'Sending…' : 'Continue', type: 'submit', disabled: busy || !complete } }}
  >
    {pending.questions.map(question => <fieldset key={question.id} disabled={busy} className="code-question">
      <legend id={`${pending.id}-${question.id}-legend`}>{question.question}</legend>
      {!question.isSecret && !!question.options?.length && <RadioGroup aria-labelledby={`${pending.id}-${question.id}-legend`} disabled={busy}
        value={question.options.some(option => option.label === answers[question.id]) ? answers[question.id] : ''}
        onValueChange={label => setAnswers(current => ({ ...current, [question.id]: label }))}>
        {question.options.map((option, index) => <Radio value={option.label} variant="card" size="sm" className="code-question__option" key={`${option.label}-${index}`}>
          <span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>
        </Radio>)}
      </RadioGroup>}
      {(question.isSecret || question.isOther || !question.options?.length) && <label className="code-question__custom">
        <span>{question.isSecret ? 'Private answer' : question.options?.length ? 'Or write your own answer' : 'Your answer'}</span>
        <Input type={question.isSecret ? 'password' : 'text'} autoComplete="off" maxLength={8000}
          value={!question.isSecret && question.options?.some(option => option.label === answers[question.id]) ? '' : answers[question.id] || ''}
          onChange={value => setAnswers(current => ({ ...current, [question.id]: value }))} />
      </label>}
    </fieldset>)}
    {error && <p className="code-decision__error" role="alert">{error}</p>}
  </DecisionTray>;
}
