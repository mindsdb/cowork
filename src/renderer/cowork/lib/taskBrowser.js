// Which tasks have the shared browser switched off (ENG-3188), from the
// composer's + menu. On is the default, so only the tasks switched off are
// kept, on this device, by conversation id: the server does not store it, as
// it does not store a chat's connector mutes. Every send to such a task asks
// for `browser: "off"`.
//
// Storage can be missing or throw (private windows, blocked site data); the
// switch then lasts as long as the task's record in memory.

const KEY = 'cowork.browserOffTasks';
// Enough for every task anyone keeps open; the oldest drop first.
const MAX = 500;

function read() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function isTaskBrowserOff(id) {
  return !!id && read().includes(id);
}

export function rememberTaskBrowser(id, off) {
  if (!id || String(id).startsWith('tmp-')) return;
  try {
    const ids = read().filter((x) => x !== id);
    if (off) ids.push(id);
    localStorage.setItem(KEY, JSON.stringify(ids.slice(-MAX)));
  } catch {
    // Kept on the task's record only.
  }
}
