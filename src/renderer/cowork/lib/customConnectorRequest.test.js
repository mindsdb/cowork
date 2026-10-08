import { describe, expect, it } from 'vitest';

import { buildCustomConnectorRequest } from './customConnectorRequest';

describe('buildCustomConnectorRequest', () => {
  it('names the searched system', () => {
    expect(buildCustomConnectorRequest('Kinaxis RapidResponse')).toBe('Build a custom connector for Kinaxis RapidResponse');
  });

  it('trims the search', () => {
    expect(buildCustomConnectorRequest('  acme  ')).toBe('Build a custom connector for acme');
  });

  it('asks Anton to ask which system when there is no search', () => {
    for (const empty of ['', '   ', undefined, null]) {
      expect(buildCustomConnectorRequest(empty)).toBe('Build a custom connector. Ask me which system I want to connect.');
    }
  });
});
