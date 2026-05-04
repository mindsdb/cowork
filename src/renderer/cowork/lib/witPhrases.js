// Witty phrase banks for the three Progress phases. Picked
// pseudo-randomly per phase instance and rotated every ~13s while
// the phase is active. Stable per-key picks so the same phase doesn't
// flip its phrase on every render of the parent.

export const PHRASES = {
  thinking: [
    'Warming up the neurons',
    'Reading the room',
    'Picking the angle',
    'Sketching the approach',
    'Mapping the question',
    'Skimming what I know',
    'Choosing the tools',
    'Lining up the steps',
    'Sizing it up',
    'Deciding where to start',
    'Sniffing for clues',
    'Wiring the plan',
  ],
  working: [
    'Crunching the numbers',
    'Asking the data nicely',
    'Wrangling the data',
    'Running the gauntlet',
    'Pulling the threads',
    'Mining for gold',
    'Compiling the picture',
    'Stress-testing the math',
    'Plotting the points',
    'Hammering on it',
    'Following the breadcrumbs',
    'Doing the heavy lifting',
  ],
  reasoning: [
    'Distilling the insight',
    'Composing the response',
    'Polishing the phrasing',
    'Turning data into wisdom',
    'Putting the puzzle together',
    'Connecting the dots',
    'Weaving the threads',
    'Triangulating the truth',
    'Choosing the right words',
    'Making it readable',
    'Tightening the story',
    'Almost there, hang tight',
  ],
};

// djb2-ish hash for stable picks per key (so the same phase keeps
// the same phrase across renders, only the rotation timer changes it).
function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * Pick a phrase deterministically from a bank, given a key + tick.
 * The bank cycles in order starting at hash(key) % length, so
 * incrementing tick walks forward without ever picking the same
 * phrase twice in a row.
 */
export function pickPhrase(bank, key, tick = 0) {
  const list = PHRASES[bank] || [];
  if (list.length === 0) return '';
  const start = hash(String(key)) % list.length;
  return list[(start + tick) % list.length];
}
