// The one glyph map for step rows, shared by Cowork's thinking steps and
// Code Mode's activity rows.
//
// Each surface's adapter picks the name: Code Mode's activitySummary.stepLabel
// and Cowork's lib/responseStreamAdapter.js. Cowork's adapter names
// (`code`, `cube`, `doc`) predate the shared map, so they stay as keys and
// draw the same glyphs as `command`, `tool` and `read`.

import type { ReactNode } from 'react';
import Ico from '../Icons';
import type { IconSize } from '../ui/Icon';

export const STEP_ICONS = {
  read: Ico.doc,
  search: Ico.search,
  web: Ico.globe,
  list: Ico.folder,
  command: Ico.code,
  edit: Ico.edit,
  tool: Ico.cube,
  image: Ico.image,
  thought: Ico.brain,
  memory: Ico.brain,
  compact: Ico.list,
  plan: Ico.taskCheck,
  retry: Ico.refresh,
  error: Ico.warning,
  approval: Ico.key,
  question: Ico.chats,
  save: Ico.save,
  download: Ico.download,
  sparkle: Ico.sparkle,
  code: Ico.code,
  cube: Ico.cube,
  doc: Ico.doc,
} satisfies Record<string, (size?: IconSize) => ReactNode>;

export type StepIconName = keyof typeof STEP_ICONS;

/** An unknown name draws the sparkle. Every name an adapter emits needs an
 *  entry above: the sparkle reads as a chosen glyph and hides the gap. */
export function StepGlyph({ name, size }: { name?: string; size: IconSize }) {
  const draw = (name && name in STEP_ICONS ? STEP_ICONS[name as StepIconName] : null) ?? Ico.sparkle;
  return <>{draw(size)}</>;
}
