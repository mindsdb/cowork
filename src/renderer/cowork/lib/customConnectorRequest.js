// What a "Build a custom connector" click sends to Anton. With no search
// (the permanent entry), Anton asks which system to connect.
export function buildCustomConnectorRequest(query) {
  const name = String(query || '').trim();
  if (name) return `Build a custom connector for ${name}`;
  return 'Build a custom connector. Ask me which system I want to connect.';
}
