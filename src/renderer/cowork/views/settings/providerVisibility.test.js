import { expect, it } from 'vitest';
import { visibleProviderCards } from './providerVisibility';

const minds = { type: 'minds-cloud', apiKey: '***', mindsUrl: 'https://api.mindshub.ai' };
const custom = { type: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', name: 'Local' };
const cards = [minds, custom];

it('leaves the hosted provider list unchanged', () => {
  expect(visibleProviderCards({}, cards, true)).toBe(cards);
});

it('does not mistake a publishing key or default MindsHub URL for an inference endpoint', () => {
  expect(visibleProviderCards({
    mindsApiKey: '***', mindsUrl: minds.mindsUrl,
    planningProvider: 'openai-compatible', openaiBaseUrl: custom.baseUrl,
  }, cards, false)).toEqual([custom]);
  expect(visibleProviderCards({ mindsApiKey: '***', mindsUrl: minds.mindsUrl }, cards, false)).toEqual([custom]);
  expect(cards).toEqual([minds, custom]);
});

it.each([
  { planningProvider: 'minds-cloud' },
  { codingProvider: 'minds_cloud' },
  { planningProvider: 'minds-cloud', codingProvider: 'openai-compatible', openaiBaseUrl: custom.baseUrl },
  { planningProvider: 'openai-compatible', openaiBaseUrl: 'https://api.mindshub.ai/v1' },
  { planningProvider: 'openai-compatible', openaiBaseUrl: 'https://gateway.example:8443/v1', mindsUrl: 'https://gateway.example:8443' },
])('preserves a configured MindsHub inference endpoint: %j', (settings) => {
  expect(visibleProviderCards(settings, cards, false)).toEqual(cards);
});

it('does not match a different port or a lookalike public host', () => {
  for (const openaiBaseUrl of ['http://gateway.example:11434/v1', 'https://notmindshub.ai/v1']) {
    expect(visibleProviderCards({ openaiBaseUrl, mindsUrl: 'http://gateway.example:8443' }, cards, false)).toEqual([custom]);
  }
});
