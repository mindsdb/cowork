/*
 * Answers a schedule was saved from this app run, by answer key, so their
 * "Run this on a schedule" step shows as done instead of offering a second,
 * duplicate schedule. Held in memory only: a reload offers the step again.
 */

const scheduled = new Set();
const listeners = new Set();

export function markAnswerScheduled(answerKey) {
  if (!answerKey || scheduled.has(answerKey)) return;
  scheduled.add(answerKey);
  listeners.forEach((listener) => listener());
}

export function isAnswerScheduled(answerKey) {
  return !!answerKey && scheduled.has(answerKey);
}

export function subscribeScheduledAnswers(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Saves a schedule made from an answer's next step and, once the save
 * succeeded, marks that answer scheduled. A failed save leaves the step
 * offered, so the person can try again.
 */
export async function createScheduleForAnswer(create, payload, answerKey) {
  const created = await create(payload);
  markAnswerScheduled(answerKey);
  return created;
}

/** Tests only: forget every answer marked so far. */
export function resetScheduledAnswersForTests() {
  scheduled.clear();
  listeners.forEach((listener) => listener());
}
