// storyEventKinds.js
// Maps a Story-rail event `kind` to its presentation metadata:
//   { icon, accentColor, label, signal }
//
// - `icon`    : single-glyph fallback shown inside an event's avatar node when
//               the author has no initials (e.g. system/ai rows). Kept as text
//               so it renders with no extra deps.
// - `accentColor` : the kind's accent, drawn from the redesign CSS vars so it
//               tracks the theme. The AI gradient is handled at the avatar
//               level (author.isAI) — here `ai-edit` still carries an accent
//               for connectors/labels.
// - `label`   : human label used by filter chips / grouped ("coalesced") rows.
// - `signal`  : 'high' | 'low'. Low-signal kinds are the ones the rail
//               COALESCES when several land back-to-back (see StoryRail).
//
// No React here — pure data + a tiny lookup helper so it can be reused by the
// composer, filters, and any future Story consumers.

export const STORY_EVENT_KINDS = {
  chat: {
    icon: '✉', // ✉ envelope-ish chat glyph
    accentColor: 'var(--ink-3)',
    label: 'Chat',
    signal: 'high',
  },
  version: {
    icon: '⚑', // ⚑ flag = a saved version / milestone
    accentColor: 'var(--accent)',
    label: 'Versions',
    signal: 'high',
  },
  comment: {
    icon: '“', // “ opening quote = a comment
    accentColor: 'var(--ink-2)',
    label: 'Comments',
    signal: 'high',
  },
  review: {
    icon: '✓', // ✓ check = review / approval
    accentColor: 'var(--success)',
    label: 'Reviews',
    signal: 'high',
  },
  'ai-edit': {
    icon: 'A', // Anton
    accentColor: 'var(--accent)',
    label: 'AI edits',
    signal: 'low', // repeated tiny AI edits collapse into one expandable row
  },
  system: {
    icon: '⚡', // ⚡ system / connection / lifecycle event
    accentColor: 'var(--ink-4)',
    label: 'System',
    signal: 'low', // "preview ready" x N etc. collapse
  },
};

// Safe lookup with a neutral fallback so an unknown kind never crashes a row.
export function getStoryKind(kind) {
  return (
    STORY_EVENT_KINDS[kind] || {
      icon: '•', // • bullet
      accentColor: 'var(--ink-3)',
      label: 'Event',
      signal: 'high',
    }
  );
}

// The filter chips, in display order. `kind: null` == the "All" chip.
// Only a curated subset is surfaced as chips per the design
// (All / Versions / Comments / Reviews); other kinds still show under "All".
export const STORY_FILTERS = [
  { id: 'all', label: 'All', kind: null },
  { id: 'version', label: 'Versions', kind: 'version' },
  { id: 'comment', label: 'Comments', kind: 'comment' },
  { id: 'review', label: 'Reviews', kind: 'review' },
];

export default STORY_EVENT_KINDS;
