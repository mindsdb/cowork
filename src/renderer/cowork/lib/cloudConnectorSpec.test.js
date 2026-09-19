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
          { name: 'password', label: 'Password', type: 'password', secret: true, required: true },
          { name: 'tls_mode', label: 'Certificate trust', type: 'select', required: true, default: 'system' },
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

    expect(method.fields.map((f) => f.name)).toEqual(['host', 'password', 'tls_mode']);
    expect(method.description).toBe('Cloud copy: the chain and hostname are always verified.');
    expect(method.how_to).toBe('Cloud how-to');
    // The desktop list documented an SSL mode that can be disabled; it must
    // not survive into a form whose server refuses that choice.
    expect(JSON.stringify(method.fields)).not.toContain('disable');
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
