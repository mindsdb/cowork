// Stop a scheduled task's run in flight. Every way this can't stop anything
// says so, rather than returning as if the run stopped.
export async function stopScheduleRun(id, { fetchRuns, cancel, refresh }) {
  let runs;
  try {
    ({ runs = [] } = await fetchRuns(id, { limit: 5, strict: true }));
  } catch {
    throw new Error('Couldn’t reach the server to stop the run. Try again.');
  }
  const going = runs.filter((r) => r.status === 'running');
  const running = going.find((r) => r.conversationId);
  if (running) {
    const result = await cancel(running.conversationId);
    if (result?.status === 'error') throw new Error('Couldn’t stop the run. Try again.');
  } else if (going.length) {
    // The run is still setting up and has no conversation to stop yet.
    await refresh();
    throw new Error('The run is still starting. Try Stop again in a moment.');
  }
  // With no run going, it already ended, and the refresh shows how.
  await refresh();
}
