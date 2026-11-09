/* Connecting a member's own custom connector in the cloud: the form it opens,
   what a refused connect says, and the stored connections as connection rows.

   The template is model-written, so its field labels and help are marked as
   Anton's, and the API address field is ours: empty, with fixed help, so a
   template cannot suggest where the key goes. The form is dedicated entry,
   kept out of the chat like the cloud database form. Pure, so each shape is
   testable on its own. */

import { toCloudSpec } from './cloudConnectorSpec';

export const ADDRESS_FIELD = '_api_address';

const ADDRESS_HELP = "The address your provider's documentation gives for its API, such as api.example.com.";
const TEMPLATE_NOTE = 'Anton wrote the field names and help below. Check them against your provider before entering a key.';
const NO_CHECK_NOTE = 'This connector has no connection check, so it cannot be connected. Ask Anton to build it again.';

const MARKER = '__custom_connection__';

/**
 * Shape a custom connector's spec into its cloud connect form.
 * @param {object} spec The connect spec App builds from the connector's form.
 * @param {object|null} check The connector's check, or null when it has none.
 * @param {string} label The connector's label, the connection's default name.
 * @returns {object}
 */
export function toCustomConnectSpec(spec, check, label) {
  const templateFields = Array.isArray(spec?.fields) ? spec.fields : [];
  const hasCheck = Boolean(check && typeof check === 'object');
  return {
    ...spec,
    _custom_connect: { connectorId: spec?._connector_id || spec?.engine, label, hasCheck },
    form_warning: hasCheck ? TEMPLATE_NOTE : NO_CHECK_NOTE,
    actions: hasCheck
      ? [{ id: 'submit', label: 'Connect', kind: 'primary' }, { id: 'cancel', label: 'Cancel', kind: 'cancel' }]
      : [{ id: 'cancel', label: 'Close', kind: 'cancel' }],
    fields: hasCheck
      ? [
        {
          name: ADDRESS_FIELD,
          label: 'API address',
          type: 'text',
          required: true,
          secret: false,
          placeholder: '',
          description: ADDRESS_HELP,
        },
        ...templateFields,
      ]
      : [],
  };
}

/**
 * The connect form a picked connector opens. In cloud, a member's own custom
 * connector connects through its own check, never through a chat turn; any
 * other connector is shaped for the hosted path. Desktop takes the spec as is.
 * @param {{full: object, baseSpec: object, label: string, orgMode: boolean, editingConnection?: object|null}} args
 * @returns {object}
 */
export function connectSpecFor({ full, baseSpec, label, orgMode, editingConnection = null }) {
  if (!orgMode) return baseSpec;
  if (full?.custom) return toCustomConnectSpec(baseSpec, full.check || null, label);
  return toCloudSpec(baseSpec, editingConnection);
}

/**
 * The connect request body from the form's values: the address apart, the
 * template's own fields as values, empty ones left out.
 * @param {Record<string, unknown>} values
 * @param {string} name
 * @returns {{name: string, address: string, values: Record<string, string>}}
 */
export function customConnectPayload(values, name) {
  const fieldValues = {};
  for (const [key, value] of Object.entries(values || {})) {
    if (key === ADDRESS_FIELD) continue;
    if (typeof value === 'string' && value !== '') fieldValues[key] = value;
  }
  const address = typeof values?.[ADDRESS_FIELD] === 'string' ? values[ADDRESS_FIELD].trim() : '';
  return { name, address, values: fieldValues };
}

const CHECK_FAILURES = {
  check_not_protected: 'The check answered without your key, so it cannot prove the key works. Ask Anton to build the connector again with an endpoint that needs the key.',
  authentication_failed: 'The provider refused these credentials.',
  provider_error: 'The provider answered with an error.',
  host_unresolved: 'That address could not be found.',
  host_not_public: 'That address is not on the public internet.',
  address_refused: 'That address cannot be used.',
  timed_out: 'The provider did not answer in time.',
  unreachable: 'The provider could not be reached.',
};

/**
 * What a refused connect says: the server's sentence, or ours for a check
 * that ran, with the provider's status and its scrubbed excerpt as plain text.
 * @param {Error & {code?: string|null, body?: object|null}} err
 * @returns {string}
 */
export function describeConnectFailure(err) {
  const detail = err?.body?.detail && typeof err.body.detail === 'object' ? err.body.detail : {};
  const sentence = CHECK_FAILURES[err?.code] || err?.message || 'Could not connect.';
  const parts = [sentence];
  if (Number.isInteger(detail.provider_status)) parts.push(`The provider answered ${detail.provider_status}.`);
  if (typeof detail.excerpt === 'string' && detail.excerpt.trim()) parts.push(`It said: ${detail.excerpt}`);
  return parts.join(' ');
}

export function isCustomConnectionRow(row) {
  return Boolean(row && row[MARKER]);
}

/**
 * A member's stored custom API connections in the shape the connections page renders.
 * @param {unknown} connections The relay's list.
 * @returns {object[]}
 */
export function toCustomConnectionRows(connections) {
  if (!Array.isArray(connections)) return [];
  return connections
    .filter((c) => c && typeof c === 'object')
    .map((c) => ({
      [MARKER]: true,
      connectionId: c.id,
      engine: c.connector_id,
      name: c.name,
      custom: true,
      status: c.status === 'verified' ? 'connected' : c.status,
      templateMissing: c.template_missing === true,
      updatedAt: c.updated_at || c.created_at || null,
    }));
}
