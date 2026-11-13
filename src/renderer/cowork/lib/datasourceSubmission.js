import i18n from '../../lib/i18n';

const tr = (key, vars) => i18n.t(`messages.datasourceSubmission.${key}`, { ns: 'projects', ...vars });
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
    throw new Error(tr('errors.nameRequired'));
  }

  const field = (key) => {
    const raw = values?.[key];
    return typeof raw === 'string' ? raw.trim() : raw;
  };

  const port = field('port');
  // The form asks one yes-or-no question about trust: verify the certificate
  // against the public authorities, or leave it to the server's own default,
  // which encrypts where the database offers it and checks nothing. A named
  // mode still wins, which is how a connection stored with a pasted CA
  // re-opens as itself.
  // `'true'` as well as `true`: a spec's own `default` arrives as JSON, so the
  // checked box can hold either, and only one of them may mean verified.
  const verifyRequested = values?.tls_verify === true || values?.tls_verify === 'true';
  const mode = field('tls_mode') || (verifyRequested ? 'system' : '');
  if (mode && !TLS_MODES.includes(mode)) {
    throw new Error(tr('errors.tlsModeRequired'));
  }
  const caPem = field('ca_pem');

  if (mode === 'custom_ca') {
    if (!caPem) {
      throw new Error(tr('errors.caRequired'));
    }
    if (new TextEncoder().encode(caPem).length > MAX_CA_PEM_BYTES) {
      throw new Error(tr('errors.caTooLarge'));
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
// Values are message keys under messages.datasourceSubmission.hints.
const HINTS = {
  tls_failed: 'tlsFailed',
  destination_forbidden: 'destinationForbidden',
  authentication_failed: 'authenticationFailed',
  insufficient_privileges: 'insufficientPrivileges',
  connection_failed: 'connectionFailed',
};

// Without certificate checks, `tls_failed` is the gateway refusing to send the
// password to an unidentified server, whether or not the password is right.
// Only `encrypted` insists on TLS, so there the handshake may be what failed.
// PostgreSQL also refuses a login asking for no password, Kerberos, or an
// unsigned SCRAM exchange there. Each value is a key under `hints.tls`.
const UNVERIFIED_CAUSES = {
  mysql: { prefer: 'refusedLogin', disabled: 'refusedLogin', encrypted: 'refusedLoginOrHandshake' },
  checkbox: { prefer: 'refusedPgLogin', disabled: 'refusedPgLogin', encrypted: 'refusedPgLoginOrHandshake' },
};

// MySQL's form asks which certificate to trust; the other engines' ask one yes-or-no question.
const TURN_CHECKS_ON = { checkbox: 'turnChecksOnCheckbox', mysql: 'turnChecksOnMysql' };

function hintText(key) {
  return key ? tr(`hints.${key}`) : '';
}

// The code's advice, except that `tls_failed` depends on whether the connection
// checked the server and on which form the engine has. '' when there is none.
function hintFor(connection) {
  const code = connection?.validation_code || connection?.validationCode;
  // Own keys only: the code arrives off the wire, and `__proto__` would otherwise render an object.
  if (code !== 'tls_failed') return hintText(Object.hasOwn(HINTS, code) ? HINTS[code] : null);
  const mysql = connection?.connector_id === 'mysql';
  const form = mysql ? 'mysql' : 'checkbox';
  if (Object.hasOwn(UNVERIFIED_CAUSES[form], connection?.tls_mode)) {
    // `encrypted` needs TLS, so a server without it fails before any login and SCRAM cannot help.
    // The box cannot help a server without a publicly signed certificate, and its form has no CA paste.
    const fallback = mysql || connection.tls_mode === 'encrypted' ? null : 'tls.pgScramFallback';
    return [`tls.${UNVERIFIED_CAUSES[form][connection.tls_mode]}`, `tls.${TURN_CHECKS_ON[form]}`, fallback]
      .filter(Boolean).map(hintText).join(' ');
  }
  if (!mysql) return hintText(HINTS.tls_failed);
  // The user already chose their own authority, so the pasted one or the host name is what failed.
  // Otherwise lead with the CA: an unchecked MySQL connection fails again whenever the server asks
  // for the password.
  return hintText(connection?.tls_mode === 'custom_ca' ? 'tls.mysqlCustomCaMismatch' : 'tls.mysqlUnverifiedCertificate');
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
      title: tr('state.connected'),
      detail: '',
    };
  }

  if (FAILED_STATUSES.has(status)) {
    return {
      kind: 'failed',
      canRetry: true,
      title: tr('state.failed'),
      detail: connection?.validation_error || '',
      // The server stores that validation failed, not why; the gateway's own
      // code rides along on the three routes that run a check, and it is the
      // only thing here that can tell the user what to change.
      hint: hintFor(connection),
    };
  }

  return {
    kind: 'pending',
    canRetry: false,
    title: tr('state.pending'),
    detail: tr('state.pendingDetail'),
  };
}
