import { describe, it, expect } from 'vitest';
import { filterExtraFields } from './oauth-extra-fields';

describe('filterExtraFields', () => {
  it('keeps only keys the connector declares', () => {
    expect(filterExtraFields({ developer_token: 'ABC', _picked_files: 'malicious' }, ['developer_token'])).toEqual({
      developer_token: 'ABC',
    });
  });

  it('drops everything for a connector with no declared fields', () => {
    expect(filterExtraFields({ developer_token: 'ABC' }, [])).toEqual({});
  });

  it('drops falsy/empty-string values, matching cowork-server state.py\'s equivalent filter', () => {
    expect(filterExtraFields({ developer_token: 'ABC', login_customer_id: '' }, ['developer_token', 'login_customer_id'])).toEqual({
      developer_token: 'ABC',
    });
  });

  it('drops a non-string value instead of persisting it as-is', () => {
    expect(filterExtraFields({ developer_token: true }, ['developer_token'])).toEqual({});
  });

  it('rejects null/undefined', () => {
    expect(filterExtraFields(null, ['developer_token'])).toEqual({});
    expect(filterExtraFields(undefined, ['developer_token'])).toEqual({});
  });

  it('rejects an array even though typeof it is "object"', () => {
    expect(filterExtraFields(['a', 'b'], ['developer_token'])).toEqual({});
  });

  it('rejects a primitive', () => {
    expect(filterExtraFields('developer_token', ['developer_token'])).toEqual({});
  });

  it('returns an empty object for an empty payload', () => {
    expect(filterExtraFields({}, ['developer_token'])).toEqual({});
  });
});
