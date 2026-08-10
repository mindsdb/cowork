// Anton error classification shared by the live-stream path (App.jsx) and
// the history-hydration path (api.js). The two must agree: a config/auth
// failure renders the connect-a-provider card, and before this module
// existed only the live path knew that — a reloaded conversation showed the
// same failure as a raw error string instead (ENG-1304).

export function isAntonConfigError(message, event) {
  const text = String(message || '');
  return (
    event?.code === 'config_required' ||
    /Configure ANTON_/i.test(text) ||
    /Could not resolve authentication method/i.test(text) ||
    /Expected one of api_key, auth_token, or credentials/i.test(text)
  );
}

export function normalizeAntonError(message, event) {
  if (isAntonConfigError(message, event)) {
    // Pay-as-you-go wording (ENG-1305): there is no subscription to sell —
    // a MindsHub account starts on the free monthly Air grant.
    return 'No LLM provider is connected for this account. Start free with MindsHub or add your own provider in Settings.';
  }
  const text = String(message || '');
  return text || 'Could not complete this task.';
}
