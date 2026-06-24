// Step icon registry. Maps the adapter's `step.icon` string to one of
// our existing Ico glyphs (Lucide-equivalent), keeping mdb-ai's naming
// so a verbatim port doesn't need lookups changed.

import Ico from '../Icons';

const ICON_MAP = {
  sparkle:  Ico.sparkle,
  code:     Ico.code,
  search:   Ico.search,
  brain:    Ico.brain,
  memory:   Ico.brain,
  // 'save' / 'download' / 'cube' aren't in our glyph set yet — fall
  // through to sparkle so the row still has a marker.
};

export function StepIcon({ type, size = 12 }) {
  const draw = ICON_MAP[type] || Ico.sparkle;
  return draw(size);
}
