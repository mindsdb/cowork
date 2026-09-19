// The cloud datasource submission: what goes to the relay, and what the
// connection it answers with means for the form.
//
// Structured fields only. No cloud method offers a connection string, and the
// relay refuses a TLS block alongside one, so there is no DSN branch to keep.
// The server owns every content rule (a reachable public host, an approved
// port, a certificate that parses); this builds the shape and lets the
// server's own message come back when it refuses.

const CONNECTED_STATUSES = new Set(['verified']);
const FAILED_STATUSES = new Set(['failed']);

export function buildDatasourcePayload({ spec, method, values, name }) {
  const trimmedName = String(name || '').trim();
  if (!trimmedName) {
    throw new Error('Give this connection a name so you can tell it apart later.');
  }

  const field = (key) => {
    const raw = values?.[key];
    return typeof raw === 'string' ? raw.trim() : raw;
  };

  const port = field('port');
  const mode = field('tls_mode') === 'custom_ca' ? 'custom_ca' : 'system';
  const caPem = field('ca_pem');

  return {
    connector_id: spec?._connector_id || spec?.engine || '',
    method,
    name: trimmedName,
    input_mode: 'structured',
    host: field('host') || '',
    // An empty port is the server's per-connector default, which is the only
    // port it accepts anyway; inventing one here would just move the refusal.
    port: port === '' || port == null ? null : Number(port),
    database: field('database') || '',
    username: field('username') || '',
    password: values?.password ?? '',
    // The chosen trust wins: a certificate left behind by a previous choice
    // must not travel with a system-trust connection.
    tls: { mode, ca_pem: mode === 'custom_ca' ? (caPem || null) : null },
  };
}

// auth creates a connection `pending` and only the gateway's probe completion
// moves it on, so pending is a real state the user waits in, and anything
// unrecognised is treated as pending rather than as success.
export function describeConnectionState(connection) {
  const status = connection?.status;

  if (CONNECTED_STATUSES.has(status)) {
    return {
      kind: 'verified',
      canRetry: false,
      title: 'Connected',
      detail: '',
    };
  }

  if (FAILED_STATUSES.has(status)) {
    return {
      kind: 'failed',
      canRetry: true,
      title: 'Could not connect',
      detail: connection?.validation_error || '',
    };
  }

  return {
    kind: 'pending',
    canRetry: false,
    title: 'Checking the connection',
    detail: 'Your credentials are stored encrypted. This page updates when the check finishes.',
  };
}
