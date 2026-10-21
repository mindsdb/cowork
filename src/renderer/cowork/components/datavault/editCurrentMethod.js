// Field synthesis for the modify flow's "Currently saved values" method.
// Pure: reads the saved record and the matched spec method only.

import { isBrowserSignInMethod } from './methodHero';

const niceLabel = (name) => String(name || '')
  .replace(/_/g, ' ')
  .replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Find the spec method a saved connection was created with.
 *
 * @param {{ method?: string, fields?: object }} saved - the saved record from fetchSavedConnection
 * @param {Array<{ id: string }>} methods - the connector spec's form methods
 * @returns {object | null} the matching method, or null when none matches or
 *   it signs in through the browser (those edit as on a plain saved record)
 */
export function findSavedSpecMethod(saved, methods) {
  // The detail API lifts `_method` out of `fields`; older records still carry it there.
  const savedMethodId = saved?.method || (saved?.fields || {})._method || null;
  if (!Array.isArray(methods)) return null;
  const match = methods.find((m) => m && m.id === savedMethodId) || null;
  return isBrowserSignInMethod(match) ? null : match;
}

/**
 * Build the synthetic "Currently saved values" method for the modify flow.
 *
 * @param {object[]} fields - the fields from editCurrentFields
 * @param {object | null} specMethod - the matched spec method, or null
 * @returns {object} a method whose `_underlying_method` is the id sent on submit
 */
export function buildEditCurrentMethod(fields, specMethod) {
  return {
    id: '__edit_current__',
    label: 'Currently saved values',
    description: 'Edit the values stored for this connection.',
    fields,
    _underlying_method: specMethod?.id || null,
  };
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
