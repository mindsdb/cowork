/* "Who can use it" on a person's own skill: only them, or everyone read-only.
   cowork-server decides whether the choice exists at all. A skill carries
   `capabilities.canShare`, and the skills list carries a top-level
   `canShare` for a skill that doesn't exist yet. Only a deployment where
   each person keeps their own skills grants either one. Hosted Cowork, the
   desktop app and a deployment whose skills everyone already shares never
   do, so the control never shows there. */

export const SKILL_SHARING_LABEL = 'Who can use it';

export const SKILL_SHARING_PRIVATE = 'private';
export const SKILL_SHARING_EVERYONE = 'everyone';

export const SKILL_SHARING_OPTIONS = [
  { value: SKILL_SHARING_PRIVATE, label: 'Only me', description: 'Only you see and use it.' },
  {
    value: SKILL_SHARING_EVERYONE,
    label: 'Everyone (read-only)',
    description: 'Everyone here can use it. Only you can change it.',
  },
];

export const SKILL_SHARING_CREATE_HINT = "You can change this later on the skill's page.";

/* Deliberately not canUseSharedResource: that helper grants a missing key on
   the desktop, which would show the control against a server with no
   sharing route. A missing `canShare` is false on every build. */
export function canShareSkill(skill) {
  return skill?.capabilities?.canShare === true;
}

/* The control's value for a skill. Only an explicit `shared: true` reads as
   shared, the same rule the Shared badge follows. */
export function sharingValue(skill) {
  return skill?.shared === true ? SKILL_SHARING_EVERYONE : SKILL_SHARING_PRIVATE;
}

/* The `shared` flag the API takes for a control value. */
export function sharedFromValue(value) {
  return value === SKILL_SHARING_EVERYONE;
}
