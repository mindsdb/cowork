// Anton error classification shared by the live-stream path (App.jsx) and
// the history-hydration path (api.js). The two must agree: a config/auth
// failure renders the connect-a-provider card, and before this module
// existed only the live path knew that — a reloaded conversation showed the
// same failure as a raw error string instead (ENG-1304).

import i18n from '../../lib/i18n';

/* User-facing copy, translated when it is read (never at import). */
const tr = (key, vars) => i18n.t(`messages.antonErrors.${key}`, { ns: 'projects', ...vars });

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
    /* Pay-as-you-go wording (ENG-1305): there is no subscription to sell.
       A MindsHub account starts on the free MindsHub Air allowance. */
    return tr('noProvider');
  }
  const text = String(message || '');
  return text || tr('couldNotComplete');
}
