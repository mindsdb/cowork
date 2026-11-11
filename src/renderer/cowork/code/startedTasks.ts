// Tasks created in this renderer whose timeline hasn't opened yet. A new task
// opens with its first message already in the history, so the timeline can't
// tell it apart from reopening an old task; the create action marks it here.
const started = new Set<string>();


export function markTaskStarted(sessionId: string): void {
  started.add(sessionId);
}


// True once for a marked task, so switching away and back opens at the end.
export function takeTaskStarted(sessionId: string): boolean {
  return started.delete(sessionId);
}
