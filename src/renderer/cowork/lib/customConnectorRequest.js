// The message a "Build a custom connector" click sends to Anton, so the user
// starts the build flow without typing the request themselves.

// `query` is the directory search the user typed, or '' from the permanent
// entry, which leaves Anton to ask which system to connect.
export function buildCustomConnectorRequest(query) {
  const name = String(query || '').trim();
  if (name) return `Build a custom connector for ${name}`;
  return 'Build a custom connector. Ask me which system I want to connect.';
}
