// The voice call's operator (ENG-4138, prototype). GPT-Live hands each request
// back with no tool calls of its own, so a request goes to the server's
// operator model (POST /voice/operate) with what is on screen; the model picks
// the app's actions, this runs them as the person (`actions`, from App.jsx),
// sends their results back, and repeats until the model answers in words.
//
// `history` is the call's own: it lives for one call, so "move it to Sales"
// after "start a task about Q3" knows what "it" is. Requests overlap (a "stop
// it" comes while Anton is still on the last one), so each runs on its own
// copy and adds its whole exchange to the history when it is done: the model
// never sees a request land between a tool call and its result.

import { voiceOperate } from '../../api';

export const MAX_ROUNDS = 6;
const MAX_HISTORY = 40;
const MAX_RESULT_CHARS = 4000;

function asCall(call) {
  return { id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments || {}) } };
}

/**
 * Resolves with what to say. `snapshot()` describes the screen now; it is read
 * every round, so it sees what the previous round's actions changed.
 */
export async function runOperator({ request, history, snapshot, actions, operate = voiceOperate, maxRounds = MAX_ROUNDS }) {
  const exchange = [{ role: 'user', content: request }];
  const settle = (said) => {
    history.push(...exchange, { role: 'assistant', content: said });
    return said;
  };
  console.info('[voice-call] request', request);
  for (let round = 0; round < maxRounds; round += 1) {
    const turn = await operate([...history, ...exchange].slice(-MAX_HISTORY), snapshot());
    const calls = turn?.tool_calls || [];
    if (!calls.length) return settle(String(turn?.content || '').trim() || 'Done.');
    exchange.push({ role: 'assistant', content: turn.content || '', tool_calls: calls.map(asCall) });
    // One at a time: an action can depend on the one before (create, then move).
    for (const call of calls) {
      let result;
      try {
        const run = actions[call.name];
        result = run ? await run(call.arguments || {}) : `There is no action called ${call.name}.`;
      } catch (err) {
        result = `That failed: ${err?.message || err}`;
      }
      console.info('[voice-call] action', call.name, call.arguments, '→', result);
      exchange.push({ role: 'tool', tool_call_id: call.id, content: String(result ?? 'Done.').slice(0, MAX_RESULT_CHARS) });
    }
  }
  return settle('That took more steps than I can take on a call. Have a look at the screen.');
}

export const isRunning = (task) => (task.messages || []).some((m) => m.role === '_streaming');

/** What the operator is told about the screen: where the person is, projects and recent tasks. */
export function describeScreen({
  route, currentTask, selectedProject, projects, tasks, callTaskId = null, working = null, browserPage = '', maxTasks = 30,
}) {
  const lines = [];
  if (route === 'task' && currentTask) {
    lines.push(`On screen: the task "${currentTask.title || 'Untitled'}" (id ${currentTask.id}) in project "${currentTask.projectName || 'general'}".`);
  } else if (route === 'projects' && selectedProject) {
    lines.push(`On screen: the project "${selectedProject.name}".`);
  } else {
    lines.push('On screen: Home. A request for work starts a new task.');
  }
  // The browser beside Home or a project: a new task from here is about its page, and takes it along.
  if (browserPage) lines.push(`The browser beside the page is open on ${browserPage}: a request for work is about it.`);
  const callTask = callTaskId && (tasks || []).find((t) => t.id === callTaskId);
  if (callTask) lines.push(`The task this call last gave Anton work in: "${callTask.title || 'Untitled'}" (id ${callTask.id})${isRunning(callTask) ? ', running now' : ''}.`);
  if (working) {
    const where = (tasks || []).find((t) => t.id === working.taskId);
    lines.push(`Anton is busy right now on the call's request "${working.request}"${where ? ` in "${where.title || 'Untitled'}" (id ${where.id})` : ''}. New work waits for it.`);
  }
  lines.push(`Projects: ${(projects || []).map((p) => `"${p.name}"`).join(', ') || 'none'}.`);
  const recent = (tasks || []).slice(0, maxTasks);
  if (recent.length) {
    lines.push('Recent tasks, newest first:');
    recent.forEach((t) => {
      lines.push(`- id ${t.id}: "${t.title || 'Untitled'}" in "${t.projectName || 'general'}"${isRunning(t) ? ', running now' : ''}`);
    });
  }
  return lines.join('\n');
}

function stepLine(step) {
  const status = step.status === 'in_progress' ? ' (running)' : step.status === 'failed' || step.status === 'error' ? ' (failed)' : '';
  return `- ${step.label || step.badge || 'Step'}${status}`;
}

/** A task's steps and latest answer, for the operator to talk about. */
export function describeSteps(task, { maxSteps = 25 } = {}) {
  const messages = task?.messages || [];
  const live = messages.find((m) => m.role === '_streaming');
  const last = [...messages].reverse().find((m) => m.role === 'assistant');
  const turn = live || last;
  if (!turn) return `"${task?.title || 'This task'}" has no steps yet.`;
  const steps = (turn.steps || []).filter((s) => s.label || s.badge);
  const lines = [live ? 'Running now. Its steps so far:' : 'Its last turn finished. Its steps:'];
  if (steps.length > maxSteps) lines.push(`(${steps.length - maxSteps} earlier steps left out)`);
  steps.slice(-maxSteps).forEach((s) => lines.push(stepLine(s)));
  if (!steps.length) lines.push('- no steps');
  if (live?.currentThought) lines.push(`Thinking: ${String(live.currentThought).slice(0, 300)}`);
  const answer = String(turn.content || '').trim();
  if (answer) lines.push(`${live ? 'Its answer so far' : 'Its answer'}: ${answer.slice(0, 1200)}`);
  return lines.join('\n');
}
