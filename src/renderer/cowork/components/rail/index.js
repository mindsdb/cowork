// Single import surface for right-rail box components.
//
//   import { RailCard, ProgressBox, WorkingFolderBox, ContextBox, ScheduledBox } from '../components/rail';

export { RailCard } from './RailCard';
export { RAIL_DOCKED_CLASS, RailToggle } from './RailPanel';
export { ProgressBox } from './ProgressBox';
export { WorkingFolderBox } from './WorkingFolderBox';
export { ContextBox } from './ContextBox';
export { ScheduledBox } from './ScheduledBox';
// Inner data components — exported in case callers want to reuse
// them outside the box wrapper (e.g. inside a custom card).
export { WorkingFolderLive } from './WorkingFolderLive';
export { ContextCard } from './ContextCard';
