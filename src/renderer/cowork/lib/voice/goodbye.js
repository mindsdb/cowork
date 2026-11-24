// Whether something the person said on a voice call is them ending it
// (ENG-4631): "you're dismissed", "you can hang up now", "ok, bye", "that's all,
// thanks". GPT-Live often answers a goodbye itself, as small talk, and never
// hands it back to the app, so the call kept listening: the call checks what
// was heard against this and hangs up after Anton's own goodbye.
//
// The whole utterance must be a goodbye, with only polite filler around it, so
// "do it later" or "bye the way, also check Q3" never ends a call. A request
// that also asks for work goes to the operator as before, and its hang_up tool
// still ends the call when that is what was meant.

// Words that may come with a goodbye and change nothing.
const FILLER = [
  'ok', 'okay', 'alright', 'all right', 'right', 'great', 'perfect', 'cool', 'awesome', 'nice', 'good', 'no',
  'thanks', 'thank you', 'thanks a lot', 'thank you so much', 'thanks so much', 'cheers', 'got it',
  'sounds good', 'anton', 'so', 'well', 'yeah', 'yes', 'please', 'for now', 'for today', 'now', 'man',
];

// Ways to end the call. One of these must be in what was heard.
const ENDINGS = [
  'bye', 'bye bye', 'goodbye', 'good bye', 'bye now', 'see you', 'see ya', 'see you later', 'talk later',
  'talk to you later', 'later', 'catch you later',
  "you're dismissed", 'you are dismissed', 'dismissed',
  'you can hang up', 'hang up', 'you can go', 'you can leave', 'you may go', 'you can go now',
  'end the call', 'end this call', 'stop the call', 'close the call', 'end call', 'hang up the call',
  "that's all", 'that is all', "that'll be all", 'that will be all', "that's it for now", "that's it for today",
  "we're done", 'we are done', "we're done here", "i'm all set", 'nothing else', 'over and out',
  // Spoken the same way in the app's other languages.
  'adiós', 'adios', 'hasta luego', 'tchau', 'até logo', 'au revoir', 'tschüss', 'ciao', 'arrivederci',
];

const words = (list) => list
  .slice()
  .sort((a, b) => b.length - a.length)
  .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+'))
  .join('|');

const ENDING = new RegExp(`(?:^|\\s)(?:${words(ENDINGS)})(?=\\s|$)`, 'u');
const ONLY_GOODBYE = new RegExp(`^(?:(?:${words([...ENDINGS, ...FILLER])})(?:\\s+|$))+$`, 'u');

export function normalizeUtterance(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[’`]/g, "'")
    // Keep letters (any script), digits, apostrophes and spaces.
    .replace(/[^\p{L}\p{N}'\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when `text`, as a whole, is the person ending the call. */
export function isGoodbye(text) {
  const said = normalizeUtterance(text);
  if (!said || said.length > 120) return false;
  return ENDING.test(said) && ONLY_GOODBYE.test(said);
}
