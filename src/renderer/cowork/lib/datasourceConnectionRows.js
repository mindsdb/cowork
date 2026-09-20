// Relay connections in the shape the connections page's card already renders.
//
// The card keys on (engine, name) and reads `status`, so a datasource row
// carries its connector id as the engine: the same form auth stores, and the
// one the turn producer compares a conversation's disabled entries against.
// The row keeps its own numeric id too, because every relay route takes that.

const DATASOURCE_MARKER = '__datasource__';

export function isDatasourceRow(row) {
  return Boolean(row && row[DATASOURCE_MARKER]);
}

export function toDatasourceRows(connections) {
  if (!Array.isArray(connections)) return [];
  return connections
    .filter((c) => c && typeof c === 'object')
    .map((c) => ({
      [DATASOURCE_MARKER]: true,
      datasourceId: c.id,
      engine: c.connector_id,
      name: c.name,
      method: c.method,
      // The card's own vocabulary for a healthy connection. Every other
      // status passes through untranslated: one the card does not know must
      // read as itself, never as connected.
      status: c.status === 'verified' ? 'connected' : c.status,
      validationError: c.validation_error || '',
      // The server stores that validation failed, not why. The gateway's code
      // rides along on create, edit and retry, and it is what turns a refusal
      // into something the owner can act on here as well as in the chat form.
      validationCode: c.validation_code || '',
      credentialVersion: c.credential_version,
      hostMasked: c.host_masked || '',
      port: c.port ?? null,
      database: c.database || '',
      username: c.username || '',
      tlsMode: c.tls_mode || '',
      updatedAt: c.updated_at || c.created_at || null,
    }));
}
