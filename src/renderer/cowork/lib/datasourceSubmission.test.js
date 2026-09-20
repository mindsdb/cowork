// Turning a filled cloud form into the body the relay validates, and turning
// the connection it answers with into what the form shows next.
//
// The relay takes structured fields only: no cloud method offers a connection
// string, and the server refuses a TLS block alongside one. A created or
// edited connection comes back `pending` — auth marks it so, and only the
// gateway's probe completion moves it to verified or failed — so "pending" is
// a state of its own with a refresh, not a synonym for either.

import { describe, expect, it } from 'vitest';
import { buildDatasourcePayload, describeConnectionState } from './datasourceSubmission';

const SPEC = { _connector_id: 'postgres', engine: 'postgres' };
const VALUES = {
  host: ' db.example.com ',
  port: '5432',
  database: 'analytics',
  username: 'readonly',
  password: 'secret',
  tls_mode: 'system',
  ca_pem: '',
};

describe('buildDatasourcePayload', () => {
  it('sends the structured shape the relay validates', () => {
    const payload = buildDatasourcePayload({ spec: SPEC, method: 'host-port', values: VALUES, name: 'Analytics' });

    expect(payload).toEqual({
      connector_id: 'postgres',
      method: 'host-port',
      name: 'Analytics',
      input_mode: 'structured',
      host: 'db.example.com',
      port: 5432,
      database: 'analytics',
      username: 'readonly',
      password: 'secret',
      tls: { mode: 'system', ca_pem: null },
    });
  });

  it('sends a schema only when the form has one', () => {
    const named = buildDatasourcePayload({
      spec: SPEC,
      method: 'host-port',
      values: { ...VALUES, schema: '  sales_ops  ' },
      name: 'Analytics',
    });
    expect(named.schema).toBe('sales_ops');

    // An empty field is left out, so the server reads it as no schema rather
    // than as a name of nothing.
    const blank = buildDatasourcePayload({
      spec: SPEC,
      method: 'host-port',
      values: { ...VALUES, schema: '   ' },
      name: 'Analytics',
    });
    expect('schema' in blank).toBe(false);
  });

  it('carries a pasted certificate only when custom trust is chosen', () => {
    const withCa = buildDatasourcePayload({
      spec: SPEC,
      method: 'host-port',
      values: { ...VALUES, tls_mode: 'custom_ca', ca_pem: '-----BEGIN CERTIFICATE-----\nx\n-----END CERTIFICATE-----' },
      name: 'Analytics',
    });
    expect(withCa.tls.mode).toBe('custom_ca');
    expect(withCa.tls.ca_pem).toContain('BEGIN CERTIFICATE');

    // Chosen trust wins over a certificate left behind by a previous choice.
    const systemTrust = buildDatasourcePayload({
      spec: SPEC,
      method: 'host-port',
      values: { ...VALUES, tls_mode: 'system', ca_pem: '-----BEGIN CERTIFICATE-----\nx\n-----END CERTIFICATE-----' },
      name: 'Analytics',
    });
    expect(systemTrust.tls).toEqual({ mode: 'system', ca_pem: null });
  });

  it('leaves an absent port to the server default rather than inventing one', () => {
    const payload = buildDatasourcePayload({
      spec: SPEC,
      method: 'host-port',
      values: { ...VALUES, port: '' },
      name: 'Analytics',
    });
    expect(payload.port).toBeNull();
  });

  it('refuses an oversized certificate here, naming the limit, rather than after a round trip', () => {
    const tooBig = `-----BEGIN CERTIFICATE-----\n${'A'.repeat(64 * 1024)}\n-----END CERTIFICATE-----`;

    expect(() => buildDatasourcePayload({
      spec: SPEC,
      method: 'host-port',
      values: { ...VALUES, tls_mode: 'custom_ca', ca_pem: tooBig },
      name: 'Analytics',
    })).toThrow(/64 KiB/);
  });

  it('refuses custom trust with nothing pasted', () => {
    expect(() => buildDatasourcePayload({
      spec: SPEC,
      method: 'host-port',
      values: { ...VALUES, tls_mode: 'custom_ca', ca_pem: '' },
      name: 'Analytics',
    })).toThrow(/CA certificate/i);
  });

  it('accepts a certificate inside the limit', () => {
    const fine = `-----BEGIN CERTIFICATE-----\n${'A'.repeat(1000)}\n-----END CERTIFICATE-----`;
    const payload = buildDatasourcePayload({
      spec: SPEC,
      method: 'host-port',
      values: { ...VALUES, tls_mode: 'custom_ca', ca_pem: fine },
      name: 'Analytics',
    });

    expect(payload.tls.ca_pem).toBe(fine);
  });

  it('refuses to build without a name, which the relay requires', () => {
    expect(() => buildDatasourcePayload({ spec: SPEC, method: 'host-port', values: VALUES, name: '  ' }))
      .toThrow(/name/i);
  });
});

describe('describeConnectionState', () => {
  it('treats a pending connection as its own state, not as success', () => {
    const state = describeConnectionState({ status: 'pending', name: 'Analytics' });

    expect(state.kind).toBe('pending');
    expect(state.canRetry).toBe(false);
    expect(state.title).toMatch(/check/i);
  });

  it('reports a verified connection as connected', () => {
    expect(describeConnectionState({ status: 'verified', name: 'Analytics' }).kind).toBe('verified');
  });

  it('reports a failed connection with the reason auth recorded, and offers a retry', () => {
    const state = describeConnectionState({
      status: 'failed',
      name: 'Analytics',
      validation_error: 'password authentication failed',
    });

    expect(state.kind).toBe('failed');
    expect(state.canRetry).toBe(true);
    expect(state.detail).toBe('password authentication failed');
  });

  it('tells a user what to change when the account cannot read the schema', () => {
    // Auth stores only that validation failed, so without the gateway's code
    // a mistyped or unreadable schema reads as a plain "could not connect".
    const state = describeConnectionState({ status: 'failed', validation_code: 'insufficient_privileges' });

    expect(state.hint).toMatch(/schema/i);
    expect(state.hint).toMatch(/capitals|case/i);
  });

  it('never claims success for a status it does not recognise', () => {
    expect(describeConnectionState({ status: 'something_new' }).kind).toBe('pending');
    expect(describeConnectionState(null).kind).toBe('pending');
  });
});

describe('the trust choice the user made', () => {
  const spec = { _connector_id: 'postgres' };
  const base = { host: 'db.example.com', database: 'appdb', username: 'u', password: 'p' };

  it.each(['system', 'encrypted', 'disabled'])('travels as %s rather than being collapsed', (mode) => {
    const payload = buildDatasourcePayload({
      spec, method: 'host-port', values: { ...base, tls_mode: mode }, name: 'A',
    });

    expect(payload.tls).toEqual({ mode, ca_pem: null });
  });

  it('carries a pasted bundle only with custom trust', () => {
    const payload = buildDatasourcePayload({
      spec, method: 'host-port', values: { ...base, tls_mode: 'custom_ca', ca_pem: 'PEM' }, name: 'A',
    });

    expect(payload.tls).toEqual({ mode: 'custom_ca', ca_pem: 'PEM' });
  });

  it('sends no trust block when the form did not ask', () => {
    // What every connection captured through the cloud form now looks like:
    // the server applies its own default rather than the page inventing one.
    const payload = buildDatasourcePayload({ spec, method: 'host-port', values: base, name: 'A' });

    expect('tls' in payload).toBe(false);
  });

  it('refuses a value the server would not accept instead of substituting one', () => {
    expect(() => buildDatasourcePayload({
      spec, method: 'host-port', values: { ...base, tls_mode: 'verify-full' }, name: 'A',
    })).toThrow(/certificate should be checked/i);
  });
});
