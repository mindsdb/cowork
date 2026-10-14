// Shaping a connector spec for cloud.
//
// A connector whose methods carry a `cloud` block is one the hosted path can
// run. That block is a COMPLETE replacement for the desktop method, not a
// delta: the desktop copy documents choices cloud refuses (disabling TLS,
// pointing at localhost), so rendering it to a cloud user would describe a
// form the server will not accept. A method without the block cannot be
// submitted in cloud at all, so it is not offered.
//
// Connectors with no cloud block anywhere are left exactly as they are; that
// is every OAuth connector, and cloud already runs them through their own path.

import { describe, expect, it } from 'vitest';
import { isCloudDatasourceSpec, toCloudSpec } from './cloudConnectorSpec';
import { toDatasourceRows } from './datasourceConnectionRows';

const POSTGRES = {
  form_id: 'postgres-connector',
  title: 'Connect PostgreSQL',
  engine: 'postgres',
  _connector_id: 'postgres',
  methods: [
    {
      id: 'connection-string',
      label: 'Connection string',
      description: 'Paste a postgres:// URI. Works with sslmode=disable.',
      fields: [{ name: 'connection_string', label: 'Connection string', type: 'password', secret: true }],
    },
    {
      id: 'host-port',
      label: 'Host and port',
      description: 'Desktop copy: you may point at localhost.',
      how_to: 'Desktop how-to',
      fields: [
        { name: 'host', label: 'Host', type: 'text' },
        { name: 'sslmode', label: 'SSL mode', type: 'select', options: [{ value: 'disable', label: 'Disable' }] },
      ],
      cloud: {
        available: true,
        description: 'Cloud copy: the chain and hostname are always verified.',
        how_to: 'Cloud how-to',
        fields: [
          { name: 'host', label: 'Host', type: 'text', required: true },
          { name: 'schema', label: 'Schema', type: 'text' },
          { name: 'password', label: 'Password', type: 'password', secret: true, required: true },
          { name: 'tls_mode', label: 'Certificate trust', type: 'select', required: true, default: 'system' },
          { name: 'tls_verify', label: 'Certificate', type: 'boolean' },
        ],
      },
    },
  ],
};

const GMAIL = {
  form_id: 'gmail-connector',
  title: 'Connect Gmail',
  engine: 'gmail',
  methods: [{ id: 'browser', label: 'Sign in', fields: [], oauth: { auth_url: 'https://x' } }],
};

describe('isCloudDatasourceSpec', () => {
  it('is true only for a spec whose method carries a cloud block', () => {
    expect(isCloudDatasourceSpec(POSTGRES)).toBe(true);
    expect(isCloudDatasourceSpec(GMAIL)).toBe(false);
    expect(isCloudDatasourceSpec(null)).toBe(false);
    expect(isCloudDatasourceSpec({ methods: [] })).toBe(false);
  });
});

describe('toCloudSpec', () => {
  it('leaves a connector with no cloud block untouched', () => {
    expect(toCloudSpec(GMAIL)).toBe(GMAIL);
  });

  it('offers only the methods cloud can actually submit', () => {
    const shaped = toCloudSpec(POSTGRES);

    expect(shaped.methods.map((m) => m.id)).toEqual(['host-port']);
  });

  it('replaces the desktop fields and copy with the cloud ones, whole', () => {
    const [method] = toCloudSpec(POSTGRES).methods;

    expect(method.fields.map((f) => f.name)).toEqual(['host', 'schema', 'password', 'tls_mode', 'tls_verify']);
    expect(method.description).toBe('Cloud copy: the chain and hostname are always verified.');
    expect(method.how_to).toBe('Cloud how-to');
    // The desktop list documented an SSL mode that can be disabled; it must
    // not survive into a form whose server refuses that choice.
    expect(JSON.stringify(method.fields)).not.toContain('disable');
  });

  it('shows no copy at all when a cloud block omits it, rather than desktop copy', () => {
    const noCopy = {
      ...POSTGRES,
      methods: POSTGRES.methods.map((m) => (m.cloud ? { ...m, cloud: { available: true, fields: [] } } : m)),
    };
    const [method] = toCloudSpec(noCopy).methods;

    expect(method.description).toBeNull();
    expect(method.how_to).toBeNull();
  });

  it('marks the form so the chat layer keeps its values out of the conversation', () => {
    expect(toCloudSpec(POSTGRES)._cloud_datasource).toBe(true);
  });

  it('drops a cloud method that is declared but not yet available', () => {
    const notYet = {
      ...POSTGRES,
      methods: POSTGRES.methods.map((m) => (m.cloud ? { ...m, cloud: { ...m.cloud, available: false } } : m)),
    };

    expect(toCloudSpec(notYet).methods).toEqual([]);
  });
});

describe('opening the form against an existing connection', () => {
  const CONNECTION = {
    datasourceId: 7,
    revision: 6,
    name: 'Analytics',
    engine: 'postgres',
    hostMasked: 'db.example.com',
    port: 5432,
    database: 'analytics',
    username: 'readonly',
    tlsMode: 'system',
  };

  it('carries the id and the revision the server checks the edit against', () => {
    const shaped = toCloudSpec(POSTGRES, CONNECTION);

    expect(shaped._datasource_edit).toEqual({ id: 7, expectedRevision: 6 });
    expect(shaped.name).toBe('Analytics');
  });

  it('reopening a listed connection edits against its revision, not its credential version', () => {
    const [row] = toDatasourceRows([{
      id: 7, connector_id: 'postgres', method: 'host-port', name: 'Analytics', status: 'verified',
      credential_version: 2, revision: 6, host_masked: 'db.example.com', port: 5432,
      database: 'analytics', username: 'readonly', tls_mode: 'system',
    }]);

    expect(toCloudSpec(POSTGRES, row)._datasource_edit).toEqual({ id: 7, expectedRevision: 6 });
  });

  it('pre-fills what it knows and never the password, which only auth holds', () => {
    const [method] = toCloudSpec(POSTGRES, CONNECTION).methods;
    const byName = Object.fromEntries(method.fields.map((f) => [f.name, f]));

    expect(byName.host.default).toBe('db.example.com');
    expect(byName.password.default).toBeUndefined();
  });

  it('pre-fills the schema an edited connection named, and nothing when it named none', () => {
    const named = toCloudSpec(POSTGRES, { ...CONNECTION, dbSchema: 'sales_ops' }).methods[0];
    const unnamed = toCloudSpec(POSTGRES, CONNECTION).methods[0];

    expect(named.fields.find((f) => f.name === 'schema').default).toBe('sales_ops');
    expect(unnamed.fields.find((f) => f.name === 'schema').default).toBeUndefined();
  });

  it('checks the verification box only for a connection stored as verified', () => {
    const verified = toCloudSpec(POSTGRES, { ...CONNECTION, tlsMode: 'system' }).methods[0];
    const unverified = toCloudSpec(POSTGRES, { ...CONNECTION, tlsMode: 'prefer' }).methods[0];

    // A boolean, not the string: the submitted value is compared to `true`,
    // so `'true'` would render the box checked and still submit unverified.
    expect(verified.fields.find((f) => f.name === 'tls_verify').default).toBe(true);
    // Left alone rather than defaulted to `'false'`, which a checkbox reads as
    // checked.
    expect(unverified.fields.find((f) => f.name === 'tls_verify').default).toBeUndefined();
  });

  it('leaves a masked host empty rather than pre-filling the mask', () => {
    const [method] = toCloudSpec(POSTGRES, { ...CONNECTION, hostMasked: 'db.***.example.com' }).methods;
    const host = method.fields.find((f) => f.name === 'host');

    expect(host.default).toBeUndefined();
  });

  it('creates rather than edits when no connection is given', () => {
    expect(toCloudSpec(POSTGRES)._datasource_edit).toBeUndefined();
  });
});
