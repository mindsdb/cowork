// Step icon registry. Maps the adapter's `step.icon` string to one of
// our existing Ico glyphs (Lucide-equivalent), keeping mdb-ai's naming
// so a verbatim port doesn't need lookups changed.
//
// Every `icon` value lib/responseStreamAdapter.js emits needs an entry here:
// an unknown one falls back to the sparkle, which reads as a real glyph and
// hides the gap. Glyph choices follow Code Mode's STEP_ICON
// (code/EventTimeline.tsx) where the two share a meaning.

import Ico from '../Icons';

export const ICON_MAP = {
  sparkle:  Ico.sparkle,
  code:     Ico.code,
  search:   Ico.search,
  save:     Ico.save,
  memory:   Ico.brain,
  download: Ico.download,
  cube:     Ico.cube,
  // Anton's narration between steps (ENG-3554).
  note:     Ico.chats,
  doc:      Ico.doc,
  compact:  Ico.list,
  question: Ico.chats,
};

export function StepIcon({ type, size = 12 }) {
  const draw = ICON_MAP[type] || Ico.sparkle;
  return draw(size);
}
