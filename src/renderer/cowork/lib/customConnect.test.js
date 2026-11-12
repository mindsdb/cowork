import { describe, expect, it, vi } from 'vitest';

import {
  ADDRESS_FIELD,
  keySentAs,
  connectSpecFor,
  desktopOnlyOffer,
  mayConnectThroughChat,
  customConnectPayload,
  describeConnectFailure,
  isCustomConnectionRow,
  toCustomConnectSpec,
  toCustomConnectionRows,
} from './customConnect';

const SPEC = {
  form_id: 'acme_crm-connector',
  title: 'Connect Acme CRM',
  engine: 'acme_crm',
  _connector_id: 'acme_crm',
  fields: [
    { name: 'api_key', label: 'API key', type: 'password', secret: true, required: true, description: 'Use https://api.acme.example' },
  ],
};
const CHECK = { path: '/v1/me' };

describe('the custom connect form', () => {
  it('puts an empty API address with our own help before the template fields', () => {
    const spec = toCustomConnectSpec(SPEC, CHECK, 'Acme CRM');

    expect(spec.fields.map((f) => f.name)).toEqual([ADDRESS_FIELD, 'api_key']);
    const address = spec.fields[0];
    expect(address).toMatchObject({ label: 'API address', required: true, placeholder: '' });
    expect(address.default).toBeUndefined();
    expect(address.description).toMatch(/provider's documentation/);
    expect(spec.fields[1].description).toBe('Use https://api.acme.example');
    expect(spec.form_warning).toMatch(/Anton wrote the field names and help/);
    expect(spec._custom_connect).toEqual({ connectorId: 'acme_crm', label: 'Acme CRM', hasCheck: true });
    expect(spec.actions.map((a) => a.kind)).toEqual(['primary', 'cancel']);
  });

  it.each([
    [{ type: 'header', names: ['X-Api-Key'] }, 'Sent as the X-Api-Key header.'],
    [{ type: 'header', names: ['Authorization', 'X-Workspace'] }, 'Sent as the Authorization, X-Workspace headers.'],
    [{ type: 'basic', names: [] }, 'Sent as HTTP Basic sign-in.'],
    [{ type: 'query', names: ['access_key'] }, 'Sent in the request URL as access_key.'],
  ])('says where the key is sent for %j', (summary, sentence) => {
    expect(keySentAs(summary)).toBe(sentence);

    const spec = toCustomConnectSpec(SPEC, CHECK, 'Acme CRM', summary);

    expect(spec.form_warning).toBe(`Anton wrote the field names and help below. Check them against your provider before entering a key. ${sentence}`);
  });

  it.each([null, undefined, {}, { type: 'header', names: [] }, { type: 'query' }, { type: 'oauth', names: ['x'] }])(
    'adds nothing without a usable summary (%j)',
    (summary) => {
      expect(keySentAs(summary)).toBe('');
      expect(toCustomConnectSpec(SPEC, CHECK, 'Acme CRM', summary).form_warning).toBe(
        'Anton wrote the field names and help below. Check them against your provider before entering a key.',
      );
    },
  );

  it('says nothing of the key when the template cannot be connected', () => {
    const spec = toCustomConnectSpec(SPEC, null, 'Acme CRM', { type: 'header', names: ['X-Api-Key'] });

    expect(spec.form_warning).not.toMatch(/Sent as/);
  });

  it('asks for nothing and says why when the template has no check', () => {
    const spec = toCustomConnectSpec(SPEC, null, 'Acme CRM');

    expect(spec.fields).toEqual([]);
    expect(spec.form_warning).toMatch(/no connection check, so it cannot be connected/);
    expect(spec.form_warning).toMatch(/if it takes none, Anton can use it without a connector/);
    expect(spec._custom_connect.hasCheck).toBe(false);
    expect(spec.actions).toEqual([{ id: 'cancel', label: 'Close', kind: 'cancel' }]);
  });
});

describe('the connect request', () => {
  it('sends the address apart and only the non-empty template values', () => {
    const values = { [ADDRESS_FIELD]: ' api.acme.example ', api_key: 'k', workspace: '' };

    expect(customConnectPayload(values, 'Acme')).toEqual({
      name: 'Acme', address: 'api.acme.example', values: { api_key: 'k' },
    });
  });

  it('keeps a template field whatever its name; the connection name travels apart', () => {
    const values = { [ADDRESS_FIELD]: 'api.acme.example', api_key: 'k', user_label: 'tenant-7' };

    expect(customConnectPayload(values, 'Acme').values).toEqual({ api_key: 'k', user_label: 'tenant-7' });
  });
});

describe('a refused connect', () => {
  it('names a failed check and shows the provider status and excerpt as text', () => {
    const err = Object.assign(new Error(''), {
      code: 'authentication_failed',
      body: { detail: { code: 'authentication_failed', provider_status: 401, excerpt: '{"error":"bad key ***"}' } },
    });

    expect(describeConnectFailure(err)).toBe(
      'The provider refused these credentials. The provider answered 401. It said: {"error":"bad key ***"}',
    );
  });

  it('explains a check that ignores the key', () => {
    const err = Object.assign(new Error(''), { code: 'check_not_protected', body: { detail: { provider_status: 200, excerpt: '' } } });

    expect(describeConnectFailure(err)).toMatch(/^The check answered without your key.* The provider answered 200\.$/);
  });

  it("passes the server's own sentence through for a refusal before the check", () => {
    const err = Object.assign(new Error('The API address cannot include a path; type only the address, like api.example.com.'), {
      code: 'invalid_address', body: { detail: { code: 'invalid_address', message: 'x' } },
    });

    expect(describeConnectFailure(err)).toBe('The API address cannot include a path; type only the address, like api.example.com.');
  });

  it('falls back to a plain sentence', () => {
    expect(describeConnectFailure({})).toBe('Could not connect.');
  });
});

describe('stored custom connections', () => {
  it('read as custom rows the connections page renders', () => {
    const [row] = toCustomConnectionRows([
      { id: 7, connector_id: 'acme_crm', name: 'Acme', status: 'verified', template_missing: true, updated_at: '2026-11-09T10:00:00Z' },
      null,
    ]);

    expect(isCustomConnectionRow(row)).toBe(true);
    expect(row).toMatchObject({
      connectionId: 7, engine: 'acme_crm', name: 'Acme', custom: true, status: 'connected', templateMissing: true,
      updatedAt: '2026-11-09T10:00:00Z',
    });
    expect(toCustomConnectionRows('nope')).toEqual([]);
    expect(isCustomConnectionRow({ engine: 'gmail' })).toBe(false);
  });
});

describe('the form a picked connector opens', () => {
  const full = { id: 'acme_crm', custom: true, check: CHECK };

  it('is the custom connect form for a custom connector in cloud', () => {
    const spec = connectSpecFor({ full, baseSpec: SPEC, label: 'Acme CRM', orgMode: true });

    expect(spec._custom_connect).toMatchObject({ connectorId: 'acme_crm', hasCheck: true });
    expect(spec.fields[0].name).toBe(ADDRESS_FIELD);
  });

  it('carries the server summary of where the key is sent', () => {
    const withSummary = { ...full, auth_summary: { type: 'query', names: ['access_key'] } };

    const spec = connectSpecFor({ full: withSummary, baseSpec: SPEC, label: 'Acme CRM', orgMode: true });

    expect(spec.form_warning).toMatch(/Sent in the request URL as access_key\.$/);
  });

  it('is the spec as is on desktop, custom or not', () => {
    expect(connectSpecFor({ full, baseSpec: SPEC, label: 'Acme CRM', orgMode: false })).toBe(SPEC);
  });

  it('is the hosted shape for any other connector in cloud', () => {
    const base = { ...SPEC, methods: [{ id: 'm', fields: [], cloud: { available: true, fields: [] } }] };

    const spec = connectSpecFor({ full: { id: 'postgres' }, baseSpec: base, label: 'PostgreSQL', orgMode: true });

    expect(spec._cloud_datasource).toBe(true);
    expect(spec._custom_connect).toBeUndefined();
  });
});

describe('a connector whose form could not be loaded', () => {
  it('never falls back to a connect chat when it is a custom connector in cloud', () => {
    expect(mayConnectThroughChat({ orgMode: true, connector: { id: 'acme_crm', custom: true } })).toBe(false);
  });

  it('may still fall back for any other connector, and on desktop', () => {
    expect(mayConnectThroughChat({ orgMode: true, connector: { id: 'gmail' } })).toBe(true);
    expect(mayConnectThroughChat({ orgMode: false, connector: { id: 'acme_crm', custom: true } })).toBe(true);
  });
});

describe('the offer for a connector cloud does not run yet', () => {
  const HASDATA_CUSTOM = { id: 'hasdata_custom', label: 'HasData', custom: true };

  it("connects the member's own custom one first", () => {
    const connect = vi.fn();
    const build = vi.fn();
    const offer = desktopOnlyOffer({ connector: { id: 'hasdata', label: 'HasData' }, customMatch: HASDATA_CUSTOM, canBuild: true, connect, build });

    expect(offer.label).toBe('Connect your custom HasData');
    offer.onAccept();
    expect(connect).toHaveBeenCalledWith(HASDATA_CUSTOM);
    expect(build).not.toHaveBeenCalled();
  });

  it('offers to build one, naming the connector, when there is none', () => {
    const build = vi.fn();
    const offer = desktopOnlyOffer({ connector: { id: 'hasdata', label: 'HasData' }, customMatch: null, canBuild: true, connect: vi.fn(), build });

    expect(offer.label).toBe('Build a custom connector');
    offer.onAccept();
    expect(build).toHaveBeenCalledWith('HasData');
  });

  it('offers nothing for SharePoint, which has its own form', () => {
    const custom = { id: 'sharepoint_custom', label: 'SharePoint', custom: true };
    expect(desktopOnlyOffer({ connector: { id: 'sharepoint', label: 'SharePoint' }, customMatch: custom, canBuild: true, connect: vi.fn(), build: vi.fn() })).toBeNull();
  });

  it('offers nothing when no custom one exists and none can be built', () => {
    expect(desktopOnlyOffer({ connector: { id: 'hasdata', label: 'HasData' }, customMatch: null, canBuild: false, connect: vi.fn(), build: vi.fn() })).toBeNull();
  });
});
