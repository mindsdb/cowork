// The cloud datasource submission: what goes to the relay, and what the
// connection it answers with means for the form.
//
// Structured fields only. No cloud method offers a connection string, and the
// relay refuses a TLS block alongside one, so there is no DSN branch to keep.
// The server owns every content rule (a reachable public host, an approved
// port, a certificate that parses); this builds the shape and lets the
// server's own message come back when it refuses.

// The server's own bound, mirrored so an oversized paste is refused at the
// field instead of after a round trip. Bytes, not characters: a certificate
// chain is ASCII but the check upstream counts encoded length.
export const MAX_CA_PEM_BYTES = 64 * 1024;

// Every trust choice the form offers, and the only values the server accepts.
// Collapsing an unrecognised one into `system` would be worse than refusing it:
// the connection would be stored stricter than the user chose, fail its check,
// and say nothing about why.
export const TLS_MODES = ['system', 'custom_ca', 'encrypted', 'disabled', 'prefer'];

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
  // The cloud form does not ask about certificates, so most connections carry
  // no choice at all and the server applies its own: encryption where the
  // database offers it, no check on who answered. A value only appears when
  // something deliberately set one, such as re-opening a connection that was
  // stored with a verified mode.
  const mode = field('tls_mode') || '';
  if (mode && !TLS_MODES.includes(mode)) {
    throw new Error('Choose how this server\'s certificate should be checked.');
  }
  const caPem = field('ca_pem');

  if (mode === 'custom_ca') {
    if (!caPem) {
      throw new Error('Paste the CA certificate, or choose public certificate authorities.');
    }
    if (new TextEncoder().encode(caPem).length > MAX_CA_PEM_BYTES) {
      throw new Error('That CA certificate is larger than the 64 KiB limit. Paste only the chain this server needs.');
    }
  }

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
    // Optional, and only PostgreSQL asks: an empty field is left out so the
    // server reads it as no schema rather than as an empty name.
    ...(field('schema') ? { schema: field('schema') } : {}),
    username: field('username') || '',
    password: values?.password ?? '',
    // Only when something chose one. The chosen trust wins over a certificate
    // left behind by a previous choice, and no choice leaves the decision with
    // the server rather than inventing one here.
    ...(mode ? { tls: { mode, ca_pem: mode === 'custom_ca' ? (caPem || null) : null } } : {}),
  };
}

// What a user can do about a refusal, by the gateway's own code. Only the ones
// with an answer appear: a code with no useful advice is better shown as the
// plain failure than dressed up in a guess.
const HINTS = {
  tls_failed:
    "The server's certificate could not be verified. A self-hosted database usually presents the "
    + 'certificate it generated for itself, which no client can check. If that is this server, set '
    + 'Certificate trust to "Encrypt, but do not check the certificate", or to "No encryption" if it '
    + 'offers none.',
  destination_forbidden:
    'That address cannot be reached from here. The database has to be on a public address, not a '
    + 'private or local one.',
  authentication_failed: 'The server refused the username or password.',
  connection_failed:
    'The server did not answer. Check the host and port, and that your firewall allows the connection.',
};

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
      // The server stores that validation failed, not why; the gateway's own
      // code rides along on the three routes that run a check, and it is the
      // only thing here that can tell the user what to change.
      hint: HINTS[connection?.validation_code || connection?.validationCode] || '',
    };
  }

  return {
    kind: 'pending',
    canRetry: false,
    title: 'Checking the connection',
    detail: 'Your credentials are stored encrypted. This page updates when the check finishes.',
  };
}
