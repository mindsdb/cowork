import { describe, it, expect } from 'vitest';
import { isMindsBaseUrl, mindsServesOpenAiCompatible, endpointHost } from './minds-endpoint';

// Routing is decided here, so every branch gets a case only it can satisfy.
// Getting this wrong sends a prompt meant for a machine on the user's own
// network to a hosted gateway instead.
describe('isMindsBaseUrl', () => {
  it('recognises MindsHub public hosts', () => {
    expect(isMindsBaseUrl('https://api.mindshub.ai/v1')).toBe(true);
    expect(isMindsBaseUrl('https://mindshub.ai')).toBe(true);
    expect(isMindsBaseUrl('https://llm.mdb.ai/api/v1')).toBe(true);
    expect(isMindsBaseUrl('https://mdb.ai')).toBe(true);
  });

  it('does not match a lookalike host', () => {
    expect(isMindsBaseUrl('https://notmindshub.ai/v1')).toBe(false);
    expect(isMindsBaseUrl('https://mindshub.ai.evil.test/v1')).toBe(false);
  });

  it('treats a LAN endpoint as the user\'s own even with a minds_url set', () => {
    expect(isMindsBaseUrl('http://192.168.1.100:1234/v1', 'https://api.mindshub.ai')).toBe(false);
    expect(isMindsBaseUrl('http://localhost:11434/v1', 'https://api.mindshub.ai')).toBe(false);
  });

  it('matches a self-hosted gateway through minds_url', () => {
    expect(isMindsBaseUrl('http://gateway.internal:8080/v1', 'http://gateway.internal:8080')).toBe(true);
  });

  it('separates a gateway from a model server on the same host', () => {
    expect(isMindsBaseUrl('http://gateway.internal:1234/v1', 'http://gateway.internal:8080')).toBe(false);
  });

  it('classifies a schemeless base URL by its host', () => {
    expect(isMindsBaseUrl('api.mindshub.ai/v1')).toBe(true);
    expect(isMindsBaseUrl('192.168.1.100:1234', 'https://api.mindshub.ai')).toBe(false);
  });

  it('is false for input that identifies no endpoint', () => {
    expect(isMindsBaseUrl('')).toBe(false);
    expect(isMindsBaseUrl('   ')).toBe(false);
    expect(isMindsBaseUrl('not a url')).toBe(false);
    expect(isMindsBaseUrl('http://')).toBe(false);
    // Parses fine, names no host — a pasted path or a non-network scheme.
    expect(isMindsBaseUrl('file:///tmp/models')).toBe(false);
    expect(isMindsBaseUrl('mailto:someone@example.com')).toBe(false);
  });

  it('ignores an unparseable minds_url rather than matching on it', () => {
    expect(isMindsBaseUrl('http://192.168.1.100:1234/v1', 'not a url')).toBe(false);
  });
});

describe('mindsServesOpenAiCompatible', () => {
  it('follows the base URL when there is one', () => {
    expect(mindsServesOpenAiCompatible({ baseUrl: 'https://api.mindshub.ai/v1' })).toBe(true);
    expect(mindsServesOpenAiCompatible({
      baseUrl: 'http://192.168.1.100:1234/v1', mindsUrl: 'https://api.mindshub.ai',
    })).toBe(false);
  });

  // With no base URL the OpenAI key decides, and only where the answer routes.
  it('reads a bare MindsHub-key config as MindsHub', () => {
    expect(mindsServesOpenAiCompatible({ mindsUrl: 'https://api.mindshub.ai' })).toBe(true);
    expect(mindsServesOpenAiCompatible({ baseUrl: '   ' })).toBe(true);
  });

  it('declines once an OpenAI key makes the endpoint unidentifiable', () => {
    expect(mindsServesOpenAiCompatible({ openAiApiKey: 'sk-x' })).toBe(false);
  });
});

describe('endpointHost', () => {
  it('includes the port when one is given', () => {
    expect(endpointHost('http://192.168.1.100:1234/v1')).toBe('192.168.1.100:1234');
    expect(endpointHost('192.168.1.100:1234')).toBe('192.168.1.100:1234');
  });

  it('omits a default port', () => {
    expect(endpointHost('https://api.mindshub.ai/v1')).toBe('api.mindshub.ai');
  });

  it('is empty when no host is named', () => {
    expect(endpointHost('')).toBe('');
    expect(endpointHost('not a url')).toBe('');
  });
});
