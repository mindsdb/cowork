// editIndex.js — barrel for the M1 "Fix it in place" inline-edit feature.
//
// Usage:
//   import { EditableBlock, useInlineEdit } from '.../redesign/editIndex.js';
//   // or render the standalone demo:
//   import { EditableBlockDemo } from '.../redesign/editIndex.js';

export { useInlineEdit, EDIT_STATES } from './useInlineEdit.js';
export { Puck } from './Puck.jsx';
export { InlineDiff } from './InlineDiff.jsx';
export { EditableBlock, EditableBlockDemo } from './EditableBlock.jsx';

// Default export is the working demo, so the feature can be mounted directly.
export { default } from './EditableBlock.jsx';
