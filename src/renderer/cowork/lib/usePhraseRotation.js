// Tiny hook: rotate a phrase from one of the witty banks every
// `intervalMs` ms while `active` is true. Returns the current phrase.
// Stable across re-renders (the tick lives in state, not in render).

import { useEffect, useState } from 'react';
import { pickPhrase } from './witPhrases';

export function usePhraseRotation(bank, key, { active = true, intervalMs = 13000 } = {}) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);
  return pickPhrase(bank, key, tick);
}
