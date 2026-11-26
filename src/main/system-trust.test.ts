import * as tls from 'node:tls';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:tls', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:tls')>();
  return { ...actual, getCACertificates: vi.fn(), setDefaultCACertificates: vi.fn() };
});
vi.mock('../shared/diagnostics', () => ({ diagnostic: vi.fn() }));

import { diagnostic } from '../shared/diagnostics';
import { trustSystemCertificates } from './system-trust';

const getCACertificates = vi.mocked(tls.getCACertificates);
const setDefaultCACertificates = vi.mocked(tls.setDefaultCACertificates);

afterEach(() => vi.clearAllMocks());

describe('trustSystemCertificates', () => {
  it('adds the system roots to the default roots', () => {
    getCACertificates.mockImplementation((type) => (type === 'system' ? ['SYSTEM-ROOT'] : ['BUNDLED-ROOT']));

    trustSystemCertificates();

    expect(setDefaultCACertificates).toHaveBeenCalledWith(['BUNDLED-ROOT', 'SYSTEM-ROOT']);
  });

  it('leaves the defaults alone when the system store is empty', () => {
    getCACertificates.mockReturnValue([]);

    trustSystemCertificates();

    expect(setDefaultCACertificates).not.toHaveBeenCalled();
  });

  it('reports a store it cannot read and keeps the bundled roots', () => {
    getCACertificates.mockImplementation(() => {
      throw new Error('keychain unavailable');
    });

    expect(() => trustSystemCertificates()).not.toThrow();
    expect(setDefaultCACertificates).not.toHaveBeenCalled();
    expect(diagnostic).toHaveBeenCalledWith('main.system-trust', 'WARNING', 'system_trust_store_not_added', expect.any(Error));
  });
});
