// `<EmailChipsInput>` — addresses typed by hand become removable chips on
// Enter, comma or blur. Anything that isn't an email stays in the box with a
// note, so nothing is dropped silently, and `onPendingChange` tells the
// parent there is text that hasn't become a chip yet. Used for people
// outside the org on the artifact Share panel (ENG-3787).

import { useState } from 'react';
import Ico from './Icons';
import { Input } from './ui';
import { parseEmailInput } from '../lib/orgSharing';

export function EmailChip({ label, removeLabel, onRemove }) {
  return (
    <li className="inline-flex items-center gap-1 rounded-full border border-solid border-line bg-surface py-[2px] pl-[10px] pr-1 font-body text-[12px] text-ink">
      {label}
      <button
        type="button"
        aria-label={removeLabel}
        onClick={onRemove}
        className="inline-flex bg-transparent border-0 cursor-pointer p-[2px] text-ink-4"
      >{Ico.close(12)}</button>
    </li>
  );
}

/**
 * @param {{
 *   emails: string[],
 *   onChange: (emails: string[]) => void,
 *   onPendingChange?: (pending: boolean) => void,
 *   inputLabel?: string,
 *   listLabel?: string,
 *   placeholder?: string,
 * }} props
 */
export function EmailChipsInput({
  emails,
  onChange,
  onPendingChange = () => {},
  inputLabel = 'Add people by email',
  listLabel = 'People',
  placeholder = 'name@company.com',
}) {
  const [text, setText] = useState('');
  const [invalid, setInvalid] = useState([]);

  const commit = () => {
    const { valid, invalid: bad } = parseEmailInput(text, emails);
    if (valid.length) onChange([...emails, ...valid]);
    setInvalid(bad);
    setText(bad.join(', '));
    onPendingChange(bad.length > 0);
  };

  return (
    <div className="flex flex-col gap-2">
      {emails.length > 0 && (
        <ul className="m-0 p-0 list-none flex flex-wrap gap-[6px]" aria-label={listLabel}>
          {emails.map((email) => (
            <EmailChip
              key={email}
              label={email}
              removeLabel={`Remove ${email}`}
              onRemove={() => onChange(emails.filter((e) => e !== email))}
            />
          ))}
        </ul>
      )}
      <Input
        aria-label={inputLabel}
        value={text}
        placeholder={placeholder}
        onChange={(v) => {
          setText(v);
          if (invalid.length) setInvalid([]);
          onPendingChange(v.trim().length > 0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); }
        }}
        onBlur={commit}
      />
      {invalid.length > 0 && (
        <span className="font-body text-xs text-danger" role="alert">
          {invalid.length === 1 ? `Not an email: ${invalid[0]}` : `Not emails: ${invalid.join(', ')}`}
        </span>
      )}
    </div>
  );
}

export default EmailChipsInput;
