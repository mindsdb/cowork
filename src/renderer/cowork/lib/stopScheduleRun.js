import i18n from '../../lib/i18n';

const msg = (key) => i18n.t(`messages.stopScheduleRun.${key}`, { ns: 'projects' });

// Stop a scheduled task's run in flight. Every way this can't stop anything
// says so, rather than returning as if the run stopped.
export async function stopScheduleRun(id, { fetchRuns, cancel, refresh }) {
  let runs;
  try {
    ({ runs = [] } = await fetchRuns(id, { limit: 5, strict: true }));
  } catch {
    throw new Error(msg('unreachable'));
  }
  const going = runs.filter((r) => r.status === 'running');
  const running = going.find((r) => r.conversationId);
  if (running) {
    const result = await cancel(running.conversationId);
    if (result?.status === 'error') throw new Error(msg('failed'));
  } else if (going.length) {
    // The run is still setting up and has no conversation to stop yet.
    await refresh();
    throw new Error(msg('starting'));
  }
  // With no run going, it already ended, and the refresh shows how.
  await refresh();
}
