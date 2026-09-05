// Keep adapter step.icon names aligned with these registry keys.

import Ico from '../Icons';

const ICON_MAP = {
  sparkle:  Ico.sparkle,
  code:     Ico.code,
  search:   Ico.search,
  save:     Ico.save,
  memory:   Ico.brain,
  download: Ico.download,
  cube:     Ico.cube,
};

export function StepIcon({ type, size = 12 }) {
  const draw = ICON_MAP[type] || Ico.sparkle;
  return draw(size);
}
