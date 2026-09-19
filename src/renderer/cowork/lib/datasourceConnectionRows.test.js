// Relay connections rendered by the card the connections page already uses.
//
// The card keys on (engine, name) and reads `status`, so a datasource row
// carries its connector id as the engine — the same form auth stores and the
// turn producer filters on — and its own id for the routes that take one.
// `verified` maps to the card's `connected`; nothing else is translated,
// because a status the card does not know should read as itself rather than
// as healthy.

import { describe, expect, it } from 'vitest';
import { isDatasourceRow, toDatasourceRows } from './datasourceConnectionRows';

const VERIFIED = {
  id: 7, connector_id: 'postgres', method: 'host-port', name: 'Analytics',
  status: 'verified', credential_version: 3, host_masked: 'db.***.example.com',
  port: 5432, database: 'analytics', username: 'readonly', tls_mode: 'system',
};

describe('toDatasourceRows', () => {
  it('shapes a row the existing connection card can render', () => {
    const [row] = toDatasourceRows([VERIFIED]);

    expect(row.engine).toBe('postgres');
    expect(row.name).toBe('Analytics');
    expect(row.status).toBe('connected');
    expect(row.datasourceId).toBe(7);
    expect(isDatasourceRow(row)).toBe(true);
  });

  it('keeps a pending or failed status as itself rather than as healthy', () => {
    const rows = toDatasourceRows([
      { ...VERIFIED, id: 1, status: 'pending' },
      { ...VERIFIED, id: 2, status: 'failed', validation_error: 'password authentication failed' },
      { ...VERIFIED, id: 3, status: 'something_new' },
    ]);

    expect(rows.map((r) => r.status)).toEqual(['pending', 'failed', 'something_new']);
    expect(rows[1].validationError).toBe('password authentication failed');
  });

  it('carries the masked host and the version an edit has to send', () => {
    const [row] = toDatasourceRows([VERIFIED]);

    expect(row.hostMasked).toBe('db.***.example.com');
    expect(row.credentialVersion).toBe(3);
    expect(row.database).toBe('analytics');
    expect(row.username).toBe('readonly');
    expect(row.tlsMode).toBe('system');
  });

  it('never carries a secret, because the relay never sends one', () => {
    const [row] = toDatasourceRows([{ ...VERIFIED, password: 'leaked' }]);

    expect(JSON.stringify(row)).not.toContain('leaked');
  });

  it('survives an empty or malformed answer', () => {
    expect(toDatasourceRows(null)).toEqual([]);
    expect(toDatasourceRows([null, 'x'])).toEqual([]);
  });
});

describe('isDatasourceRow', () => {
  it('tells a datasource row from an OAuth connection', () => {
    expect(isDatasourceRow({ engine: 'gmail', name: 'work' })).toBe(false);
    expect(isDatasourceRow(null)).toBe(false);
  });
});
