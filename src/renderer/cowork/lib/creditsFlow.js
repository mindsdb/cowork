/* Whether the user has just gone to pay (any billing link). Arms the availability follow-up
   polling in useModelAvailabilityTriggers; module-level so every billing button shares it. */

const flow = { armedAt: null, pollStart: null, awaySinceArm: false, returned: false };
const listeners = new Set();
const notify = () => listeners.forEach((listener) => listener());

export const FOLLOW_UP_FOR_MS = 10 * 60_000;
// An arm whose polling has not started by then is stale (e.g. paid for nothing that was locked).
export const ARM_EXPIRES_MS = 30 * 60_000;

export function startCreditsFlow(now = Date.now()) {
  Object.assign(flow, { armedAt: now, pollStart: null, awaySinceArm: false, returned: false });
  notify();
}

export function endCreditsFlow() {
  if (flow.armedAt === null && flow.pollStart === null) return;
  Object.assign(flow, { armedAt: null, pollStart: null, awaySinceArm: false, returned: false });
  notify();
}

/** A copy of the flow state; change it through the functions here. */
export function creditsFlowState() {
  return { ...flow };
}

export function setCreditsFlowPollStart(at) {
  flow.pollStart = at;
}

/** Window lost focus while armed: the user is likely paying elsewhere. */
export function noteCreditsFlowAway() {
  if (flow.armedAt !== null && !flow.returned) flow.awaySinceArm = true;
}

/** Window regained focus. The first return after leaving restarts the follow-up window. */
export function noteCreditsFlowReturn() {
  if (!flow.awaySinceArm) return;
  flow.awaySinceArm = false;
  flow.returned = true;
  flow.pollStart = null;
}

/** Whether the flow is armed and not stale at `now`; clears a stale arm. */
export function isCreditsFlowArmed(now = Date.now()) {
  if (flow.armedAt === null) return false;
  if (flow.pollStart === null && !flow.returned && now - flow.armedAt > ARM_EXPIRES_MS) {
    endCreditsFlow();
    return false;
  }
  return true;
}

/** Calls `listener` whenever the flow is armed or ended; returns the unsubscribe. */
export function subscribeCreditsFlow(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Delay before the next follow-up re-check, `elapsed` ms into polling; null once it is over. */
export function followUpDelay(elapsed) {
  if (elapsed >= FOLLOW_UP_FOR_MS) return null;
  if (elapsed < 2 * 60_000) return 15_000;
  if (elapsed < 5 * 60_000) return 30_000;
  return 60_000;
}
