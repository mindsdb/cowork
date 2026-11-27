import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { appMock, launch } = vi.hoisted(() => ({
  launch: { switches: [] as string[], inspectorUrl: undefined as string | undefined },
  appMock: {
    isPackaged: true,
    commandLine: { hasSwitch: vi.fn() },
    exit: vi.fn(),
  },
}));
vi.mock('electron', () => ({ app: appMock }));
vi.mock('node:inspector', () => ({ url: () => launch.inspectorUrl }));

/* index.ts loads its branches with Node's own `require`, which a unit test
 * cannot point at a TypeScript module: reaching a branch shows up as
 * "Cannot find module". */
describe('index: the launch guard runs before either branch', () => {
  let stderr: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    appMock.isPackaged = true;
    launch.switches = ['remote-debugging-port'];
    launch.inspectorUrl = undefined;
    appMock.commandLine.hasSwitch.mockImplementation((name: string) => launch.switches.includes(name));
    stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.stubEnv('ANTON_HTML_LINT_TARGET', '/tmp/page.html');
  });

  afterEach(() => {
    Reflect.deleteProperty(process, 'defaultApp');
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('refuses a packaged launch with a denied switch and loads neither lint mode nor the app', async () => {
    await import('./index');

    expect(appMock.exit).toHaveBeenCalledWith(1);
    expect(stderr).toHaveBeenCalledOnce();
    expect(String(stderr.mock.calls[0][0])).toMatch(/--remote-debugging-port\n$/);
  });

  it('refuses the signed binary renamed to `electron`, which reads as unpackaged to Electron', async () => {
    appMock.isPackaged = false;
    expect(process.defaultApp).toBeUndefined();

    await import('./index');

    expect(appMock.exit).toHaveBeenCalledWith(1);
  });

  it("lets CI's copy with the inspector on through to lint mode", async () => {
    launch.inspectorUrl = 'ws://127.0.0.1:9229/test';

    await expect(import('./index')).rejects.toThrow(/Cannot find module '\.\/html-lint-host'/);
    expect(appMock.exit).not.toHaveBeenCalled();
  });

  it('deletes SSLKEYLOGFILE before anything else loads in a packaged run', async () => {
    launch.switches = [];
    vi.stubEnv('ANTON_HTML_LINT_TARGET', '');
    vi.stubEnv('SSLKEYLOGFILE', '/tmp/keys.log');

    await expect(import('./index')).rejects.toThrow(/Cannot find module '\.\/app'/);
    expect(process.env.SSLKEYLOGFILE).toBeUndefined();
  });

  it('keeps SSLKEYLOGFILE in a development run', async () => {
    appMock.isPackaged = false;
    Object.defineProperty(process, 'defaultApp', { value: true, configurable: true });
    vi.stubEnv('SSLKEYLOGFILE', '/tmp/keys.log');

    await expect(import('./index')).rejects.toThrow(/Cannot find module '\.\/html-lint-host'/);
    expect(process.env.SSLKEYLOGFILE).toBe('/tmp/keys.log');
  });

  it('lets a packaged launch without a denied switch through to the app', async () => {
    launch.switches = ['headless', 'disable-gpu'];
    vi.stubEnv('ANTON_HTML_LINT_TARGET', '');

    await expect(import('./index')).rejects.toThrow(/Cannot find module '\.\/app'/);
    expect(appMock.exit).not.toHaveBeenCalled();
  });
});
