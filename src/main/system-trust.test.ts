import * as tls from 'node:tls';
import { performance } from 'node:perf_hooks';
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

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('trustSystemCertificates', () => {
  it('adds the system roots to the default roots', () => {
    getCACertificates.mockImplementation((type) => (type === 'system' ? ['SYSTEM-ROOT'] : ['BUNDLED-ROOT']));

    trustSystemCertificates();

    expect(setDefaultCACertificates).toHaveBeenCalledWith(['BUNDLED-ROOT', 'SYSTEM-ROOT']);
    expect(diagnostic).toHaveBeenCalledWith('main.system-trust', 'INFO', 'system_trust_store_read', {
      count: 1,
      duration_ms: expect.any(Number),
    });
  });

  it('leaves the defaults alone when the system store is empty, and still logs the read', () => {
    getCACertificates.mockReturnValue([]);

    trustSystemCertificates();

    expect(setDefaultCACertificates).not.toHaveBeenCalled();
    expect(diagnostic).toHaveBeenCalledWith('main.system-trust', 'INFO', 'system_trust_store_read', {
      count: 0,
      duration_ms: expect.any(Number),
    });
  });

  it('reports a store it cannot read and keeps the bundled roots', () => {
    getCACertificates.mockImplementation(() => {
      throw new Error('keychain unavailable');
    });

    expect(() => trustSystemCertificates()).not.toThrow();
    expect(setDefaultCACertificates).not.toHaveBeenCalled();
    expect(diagnostic).toHaveBeenCalledWith('main.system-trust', 'WARNING', 'system_trust_store_not_added', expect.any(Error));
    expect(diagnostic).toHaveBeenCalledTimes(1);
  });

  it('logs how long the read and the swap took, in whole milliseconds', () => {
    getCACertificates.mockImplementation((type) => (type === 'system' ? ['SYSTEM-ROOT'] : ['BUNDLED-ROOT']));
    vi.spyOn(performance, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(1042.4);

    trustSystemCertificates();

    expect(diagnostic).toHaveBeenCalledWith('main.system-trust', 'INFO', 'system_trust_store_read', {
      count: 1,
      duration_ms: 42,
    });
  });

  it('prints the root count and the duration in the logged line', async () => {
    const { diagnostic: printDiagnostic } = await vi.importActual<typeof import('../shared/diagnostics')>('../shared/diagnostics');
    vi.mocked(diagnostic).mockImplementationOnce(printDiagnostic);
    vi.stubEnv('LOG_LEVEL', 'INFO');
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    getCACertificates.mockImplementation((type) => (type === 'system' ? ['SYSTEM-ROOT', 'OTHER-ROOT'] : ['BUNDLED-ROOT']));
    vi.spyOn(performance, 'now').mockReturnValueOnce(500).mockReturnValueOnce(537);

    trustSystemCertificates();

    expect(output).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(output.mock.calls[0][0]))).toMatchObject({
      logger: 'main.system-trust',
      log_level: 'INFO',
      event: 'system_trust_store_read',
      count: 2,
      duration_ms: 37,
    });
  });
});
