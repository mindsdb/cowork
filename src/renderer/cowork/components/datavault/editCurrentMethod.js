// Field synthesis for the modify flow's "Currently saved values" method,
// extracted from App.jsx's handleModifyConnection so it can be tested
// without rendering App. Pure: reads the saved record and the matched spec
// method, never the network or the form store.

const GENIE_METHOD_ID = 'genie-mcp';

const niceLabel = (name) => String(name || '')
  .replace(/_/g, ' ')
  .replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Find the spec method a saved connection was created with.
 *
 * @param {{ method?: string, fields?: object }} saved - the saved record from fetchSavedConnection
 * @param {Array<{ id: string }>} methods - the connector spec's form methods
 * @returns {object | null} the matching method, or null when none matches
 */
export function findSavedSpecMethod(saved, methods) {
  // The detail API lifts `_method` out of `fields`; only Genie reads it from there, others keep the `fields` lookup.
  const savedMethodId = saved?.method === GENIE_METHOD_ID
    ? GENIE_METHOD_ID
    : (saved?.fields || {})._method || null;
  if (!Array.isArray(methods)) return null;
  return methods.find((m) => m && m.id === savedMethodId) || null;
}

/**
 * Build the synthetic method's fields from the saved record alone.
 *
 * @param {{ fields?: object, secureKeys?: string[] }} saved - the saved record
 * @param {object | null} specMethod - the matched spec method, or null
 * @returns {object[]} one form field per user-visible saved key, with the
 *   saved value (masked for secrets) as its default
 */
export function editCurrentFields(saved, specMethod) {
  const savedFields = saved?.fields || {};
  const secureKeys = saved?.secureKeys || [];
  const specSecretNames = new Set(
    (specMethod?.fields || []).filter((f) => f && f.secret).map((f) => f.name)
  );
  const valueByName = {};
  const shownHiddenSecrets = new Set();
  for (const [k, v] of Object.entries(savedFields)) {
    if (!k.startsWith('_')) {
      valueByName[k] = v;
      continue;
    }
    // A secret saved under a hidden name is required on submit, so it shows under the spec's name.
    const visibleName = k.slice(1);
    if (secureKeys.includes(k) && specSecretNames.has(visibleName) && !(visibleName in savedFields)) {
      valueByName[visibleName] = v;
      shownHiddenSecrets.add(visibleName);
    }
  }
  return Object.keys(valueByName).map((k) => {
    const isSecret = secureKeys.includes(k) || shownHiddenSecrets.has(k);
    return {
      name: k,
      label: niceLabel(k),
      type: isSecret ? 'password' : 'text',
      secret: isSecret,
      required: false,
      default: valueByName[k],
    };
  });
}
