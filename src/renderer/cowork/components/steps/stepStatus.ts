// The one status vocabulary for step rows. Each surface maps its own data
// onto it: Cowork in thinking/ThinkingStep.jsx (thinkingStepStatus), Code
// Mode in code/activitySummary.ts (codeStepStatus).
//
//   running    work in progress: the label reads strong, with animated dots
//   done       finished
//   failed     ended badly: the glyph tints and a status word follows
//              ("Failed", or a surface's own word such as "Timed out")
//   recovered  ended with an error the agent moved past: a quiet dot.
//              Errors inside a scratchpad run are normal, and a loud marker
//              read as the whole turn failing.
export type StepStatus = 'running' | 'done' | 'failed' | 'recovered';

export const STEP_STATUS_TEXT: Record<Extract<StepStatus, 'failed' | 'recovered'>, string> = {
  failed: 'Failed',
  recovered: 'Ended with an error',
};
