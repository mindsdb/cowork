// The icons the editor's menus and callouts draw, by the key or tone canvasOps
// names (canvasOps keeps the kinds and tones themselves as data and decisions).
import {
  ChartColumn, CircleCheck, Code, Gauge, Heading1, Heading2, Heading3, Image, Info, List, ListOrdered, ListTodo, Minus,
  OctagonAlert, Pilcrow, Quote, Sparkles, StickyNote, Table2, TriangleAlert,
} from 'lucide-react';

/** A block kind's icon, by its menu key (TURN_INTO, INSERTABLE and the agent's item). */
export const BLOCK_ICONS = {
  paragraph: Pilcrow,
  heading1: Heading1,
  heading2: Heading2,
  heading3: Heading3,
  bullet: List,
  numbered: ListOrdered,
  task: ListTodo,
  quote: Quote,
  callout: Info,
  table: Table2,
  chart: ChartColumn,
  metrics: Gauge,
  code: Code,
  divider: Minus,
  image: Image,
  ask: Sparkles,
};

/** A callout tone's icon (CALLOUT_TONES). */
export const TONE_ICONS = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: OctagonAlert,
  note: StickyNote,
};
