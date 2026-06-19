// Single import surface for right-rail box components.
//
//   import { RailCard, ProgressBox, WorkingFolderBox, ContextBox, ScheduledBox } from '../components/rail';

export { RailCard } from './RailCard';
export { ProgressBox } from './ProgressBox';
export { WorkingFolderBox } from './WorkingFolderBox';
export { ContextBox } from './ContextBox';
export { ScheduledBox } from './ScheduledBox';
export { InstructionsBox } from './InstructionsBox';
// Inner data components — exported in case callers want to reuse
export { WorkingFolderLive } from './WorkingFolderLive';
export { ContextCard } from './ContextCard';
export { default as ProjectInstructions } from '../project/ProjectInstructions';
