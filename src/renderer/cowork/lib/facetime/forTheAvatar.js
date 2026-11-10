// What a video call's avatar may be handed from Anton (prototype).
//
// Nuance ends a call, as a policy violation, when a tool result holds a phone
// number other than an emergency number, and repeated ends pause the person's
// calls. So every number that looks like a phone number is replaced before
// Anton's answer goes back. The avatar only says the gist; the whole answer
// is in the task on screen.

// A run of digits with phone punctuation between them: an optional +country,
// an optional (area), then groups split by spaces, dots or dashes.
const CANDIDATE = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{1,4}\)[\s.-]?)?\d{2,4}(?:[\s.-]\d{2,5}){1,4}|\+\d{7,15}|\b\d{10,15}\b/g;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DECIMAL = /^\d+\.\d+$/;

export const PHONE_PLACEHOLDER = '[phone number]';

export function withoutPhoneNumbers(text) {
  return String(text ?? '').replace(CANDIDATE, (match) => {
    const digits = match.replace(/\D/g, '').length;
    if (digits < 7 || digits > 15) return match;
    if (ISO_DATE.test(match) || DECIMAL.test(match)) return match;
    return PHONE_PLACEHOLDER;
  });
}

// Plenty for two or three spoken sentences; the rest is on screen.
export const MAX_RESULT_CHARS = 6000;

export function forTheAvatar(answer, { maxChars = MAX_RESULT_CHARS } = {}) {
  let text = String(answer ?? '')
    // Code and data blocks are for the screen, not for speech.
    .replace(/```[\s\S]*?```/g, '[a block shown in the task]')
    .trim();
  if (!text) return 'Anton finished without a written answer. The task on screen shows what it did.';
  text = withoutPhoneNumbers(text);
  if (text.length > maxChars) text = `${text.slice(0, maxChars)}… (the rest is in the task on screen)`;
  return text;
}
