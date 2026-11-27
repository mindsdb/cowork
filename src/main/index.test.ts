import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { appMock, diagnosticMock, launch } = vi.hoisted(() => ({
  launch: {
    switches: [] as string[],
    switchValues: {} as Record<string, string>,
    inspectorUrl: undefined as string | undefined,
  },
  appMock: {
    isPackaged: true,
    commandLine: { hasSwitch: vi.fn(), getSwitchValue: vi.fn() },
    getPath: vi.fn(),
    exit: vi.fn(),
  },
  diagnosticMock: vi.fn(),
}));
vi.mock('electron', () => ({ app: appMock }));
vi.mock('node:inspector', () => ({ url: () => launch.inspectorUrl }));
vi.mock('../shared/diagnostics', () => ({ diagnostic: diagnosticMock }));

/* index.ts loads its branches with Node's own `require`, which a unit test
 * cannot point at a TypeScript module: reaching a branch shows up as
 * "Cannot find module". */
describe('index: the launch guard runs before either branch', () => {
  let stderr: ReturnType<typeof vi.spyOn>;
  /* A fresh temporary folder per test. `app.getPath('logs')` answers a folder
     inside it that does not exist yet, so a refusal has to create it. */
  let root: string;
  let logsFolder: string;
  let logFile: string;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    appMock.isPackaged = true;
    launch.switches = ['remote-debugging-port'];
    launch.switchValues = {};
    launch.inspectorUrl = undefined;
    appMock.commandLine.hasSwitch.mockImplementation((name: string) => launch.switches.includes(name));
    appMock.commandLine.getSwitchValue.mockImplementation((name: string) => launch.switchValues[name] ?? '');
    root = mkdtempSync(join(tmpdir(), 'index-launch-guard-'));
    logsFolder = join(root, 'Logs', 'MindsHub Cowork');
    logFile = join(logsFolder, 'launch-guard.log');
    appMock.getPath.mockImplementation((name: string) => {
      if (name === 'logs') return logsFolder;
      throw new Error(`index.ts asked for the ${name} path`);
    });
    stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.stubEnv('ANTON_HTML_LINT_TARGET', '/tmp/page.html');
    /* A shell that sets it would refuse every packaged launch below. */
    vi.stubEnv('NODE_USE_ENV_PROXY', undefined);
  });

  afterEach(() => {
    Reflect.deleteProperty(process, 'defaultApp');
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  it('refuses a packaged launch with a denied switch and loads neither lint mode nor the app', async () => {
    await import('./index');

    expect(appMock.exit).toHaveBeenCalledWith(1);
    expect(stderr).toHaveBeenCalledOnce();
    expect(String(stderr.mock.calls[0][0])).toBe('launch-guard: a packaged build does not start with --remote-debugging-port\n');
  });

  it('writes a diagnostic before it exits', async () => {
    await import('./index');

    expect(diagnosticMock).toHaveBeenCalledExactlyOnceWith('main.launch-guard', 'ERROR', 'launch_guard_refused_denied_switch');
    expect(diagnosticMock.mock.invocationCallOrder[0]).toBeLessThan(appMock.exit.mock.invocationCallOrder[0]);
  });

  /* A launch from the Finder, the Dock or a desktop shortcut discards stderr,
     so the file is what a user or support finds. */
  it('appends the diagnostic as one JSON line to launch-guard.log in the logs folder, creating the folder, before it exits', async () => {
    let atExit: string | null = null;
    appMock.exit.mockImplementationOnce(() => {
      atExit = existsSync(logFile) ? readFileSync(logFile, 'utf8') : null;
    });
    const before = Date.now();

    await import('./index');

    const after = Date.now();
    expect(appMock.getPath).toHaveBeenCalledExactlyOnceWith('logs');
    expect(appMock.exit).toHaveBeenCalledWith(1);
    expect(atExit).toBe(readFileSync(logFile, 'utf8'));
    const lines = readFileSync(logFile, 'utf8').split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe('');
    const record = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(record).toEqual({
      logged_at: expect.any(String),
      logger: 'main.launch-guard',
      log_level: 'ERROR',
      event: 'launch_guard_refused_denied_switch',
      message: 'launch guard refused denied switch',
    });
    const loggedAt = String(record.logged_at);
    expect(new Date(loggedAt).toISOString()).toBe(loggedAt);
    expect(Date.parse(loggedAt)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(loggedAt)).toBeLessThanOrEqual(after);
  });

  it('keeps what launch-guard.log already holds and adds the new refusal after it', async () => {
    const earlier = '{"event":"an earlier refusal"}\n';
    mkdirSync(logsFolder, { recursive: true });
    writeFileSync(logFile, earlier);

    await import('./index');

    const contents = readFileSync(logFile, 'utf8');
    expect(contents.startsWith(earlier)).toBe(true);
    const added = contents.slice(earlier.length).split('\n');
    expect(added).toHaveLength(2);
    expect(JSON.parse(added[0])).toMatchObject({ event: 'launch_guard_refused_denied_switch' });
  });

  it('writes nothing from the command line to launch-guard.log', async () => {
    launch.switches = ['host-rules'];
    launch.switchValues = { 'host-rules': 'MAP * 127.0.0.1:41234' };

    await import('./index');

    const contents = readFileSync(logFile, 'utf8');
    expect(contents).not.toContain('host-rules');
    expect(contents).not.toContain('41234');
  });

  it.each([
    {
      name: 'the logs folder cannot be created',
      arrange: () => {
        writeFileSync(join(root, 'Logs'), 'a file where the folder belongs');
      },
    },
    {
      name: 'Electron cannot name the logs folder',
      arrange: () => {
        appMock.getPath.mockImplementationOnce(() => {
          throw new Error("Failed to get 'logs' path");
        });
      },
    },
  ])('still writes the reason and exits with status 1 when $name', async ({ arrange }) => {
    arrange();

    await import('./index');

    expect(appMock.exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(stderr).toHaveBeenCalledOnce();
    expect(String(stderr.mock.calls[0][0])).toBe('launch-guard: a packaged build does not start with --remote-debugging-port\n');
    expect(existsSync(logFile)).toBe(false);
    expect(diagnosticMock.mock.calls).toEqual([
      ['main.launch-guard', 'ERROR', 'launch_guard_refused_denied_switch'],
      ['main.launch-guard', 'WARNING', 'launch_guard_log_not_written', expect.any(Error)],
    ]);
    expect(diagnosticMock.mock.invocationCallOrder[1]).toBeLessThan(appMock.exit.mock.invocationCallOrder[0]);
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
    expect(existsSync(logsFolder)).toBe(false);
  });

  it('refuses a packaged launch whose bypass list removes the loopback exemption, and names that problem', async () => {
    launch.switches = ['proxy-server', 'proxy-bypass-list'];
    launch.switchValues = { 'proxy-server': 'http://proxy.corp.example:3128', 'proxy-bypass-list': '*.corp.example;<-loopback>' };

    await import('./index');

    expect(appMock.exit).toHaveBeenCalledWith(1);
    expect(stderr).toHaveBeenCalledOnce();
    expect(String(stderr.mock.calls[0][0])).toBe('launch-guard: a packaged build does not start when --proxy-bypass-list removes the loopback exemption with <-loopback>\n');
    expect(diagnosticMock).toHaveBeenCalledExactlyOnceWith('main.launch-guard', 'ERROR', 'launch_guard_refused_loopback_exemption_removed');
  });

  it("lets CI's copy with the inspector on through with a bypass list that removes the loopback exemption", async () => {
    launch.inspectorUrl = 'ws://127.0.0.1:9229/test';
    launch.switches = ['proxy-server', 'proxy-bypass-list'];
    launch.switchValues = { 'proxy-server': 'http://proxy.corp.example:3128', 'proxy-bypass-list': '<-loopback>' };

    await expect(import('./index')).rejects.toThrow(/Cannot find module '\.\/html-lint-host'/);
    expect(appMock.exit).not.toHaveBeenCalled();
  });

  it('lets a development run with a bypass list that removes the loopback exemption through to lint mode', async () => {
    appMock.isPackaged = false;
    Object.defineProperty(process, 'defaultApp', { value: true, configurable: true });
    launch.switches = ['proxy-server', 'proxy-bypass-list'];
    launch.switchValues = { 'proxy-server': 'http://proxy.corp.example:3128', 'proxy-bypass-list': '<-loopback>' };

    await expect(import('./index')).rejects.toThrow(/Cannot find module '\.\/html-lint-host'/);
    expect(appMock.exit).not.toHaveBeenCalled();
  });

  it('lets a packaged launch with an ordinary bypass list through to the app', async () => {
    launch.switches = ['proxy-server', 'proxy-bypass-list'];
    launch.switchValues = { 'proxy-server': 'http://proxy.corp.example:3128', 'proxy-bypass-list': '*.corp.example;10.0.0.0/8' };
    vi.stubEnv('ANTON_HTML_LINT_TARGET', '');

    await expect(import('./index')).rejects.toThrow(/Cannot find module '\.\/app'/);
    expect(appMock.exit).not.toHaveBeenCalled();
  });

  it('refuses a packaged launch whose --enable-features names EnablePerfettoSystemTracing, and names the feature', async () => {
    launch.switches = ['enable-features'];
    launch.switchValues = { 'enable-features': 'ParallelDownloading,*EnablePerfettoSystemTracing<Trial:p/v' };

    await import('./index');

    expect(appMock.exit).toHaveBeenCalledWith(1);
    expect(stderr).toHaveBeenCalledOnce();
    expect(String(stderr.mock.calls[0][0])).toBe('launch-guard: a packaged build does not start when --enable-features names EnablePerfettoSystemTracing\n');
    expect(diagnosticMock).toHaveBeenCalledExactlyOnceWith('main.launch-guard', 'ERROR', 'launch_guard_refused_denied_feature');
    expect(JSON.parse(readFileSync(logFile, 'utf8'))).toMatchObject({ event: 'launch_guard_refused_denied_feature' });
  });

  it('lets a packaged launch with other --enable-features values through to the app', async () => {
    launch.switches = ['enable-features'];
    launch.switchValues = { 'enable-features': 'ParallelDownloading,OverlayScrollbar' };
    vi.stubEnv('ANTON_HTML_LINT_TARGET', '');

    await expect(import('./index')).rejects.toThrow(/Cannot find module '\.\/app'/);
    expect(appMock.exit).not.toHaveBeenCalled();
  });

  /* Node routes main's own requests through HTTP_PROXY during its bootstrap,
     before index.ts runs, so the guard refuses the launch rather than deleting
     the variable. */
  it('refuses a packaged launch with NODE_USE_ENV_PROXY set, says why, and logs it', async () => {
    launch.switches = [];
    vi.stubEnv('NODE_USE_ENV_PROXY', '1');
    vi.stubEnv('HTTP_PROXY', 'http://proxy.corp.example:3128');

    await import('./index');

    expect(appMock.exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(stderr).toHaveBeenCalledOnce();
    expect(String(stderr.mock.calls[0][0])).toBe(
      "launch-guard: a packaged build does not start with NODE_USE_ENV_PROXY set, because Node would send the app's requests to its local server through HTTP_PROXY; unset it or set it to 0\n",
    );
    expect(diagnosticMock).toHaveBeenCalledExactlyOnceWith('main.launch-guard', 'ERROR', 'launch_guard_refused_node_env_proxy');
    expect(diagnosticMock.mock.invocationCallOrder[0]).toBeLessThan(appMock.exit.mock.invocationCallOrder[0]);
    const lines = readFileSync(logFile, 'utf8').split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toMatchObject({ logger: 'main.launch-guard', log_level: 'ERROR', event: 'launch_guard_refused_node_env_proxy' });
    expect(lines[0]).not.toContain('proxy.corp.example');
  });

  it.each([
    { name: '0', value: '0' },
    { name: 'empty', value: '' },
  ])('lets a packaged launch with NODE_USE_ENV_PROXY $name through to the app', async ({ value }) => {
    launch.switches = [];
    vi.stubEnv('NODE_USE_ENV_PROXY', value);
    vi.stubEnv('HTTP_PROXY', 'http://proxy.corp.example:3128');
    vi.stubEnv('ANTON_HTML_LINT_TARGET', '');

    await expect(import('./index')).rejects.toThrow(/Cannot find module '\.\/app'/);
    expect(appMock.exit).not.toHaveBeenCalled();
    expect(diagnosticMock).not.toHaveBeenCalled();
  });

  it('lets a development run with NODE_USE_ENV_PROXY set through to lint mode', async () => {
    appMock.isPackaged = false;
    Object.defineProperty(process, 'defaultApp', { value: true, configurable: true });
    launch.switches = [];
    vi.stubEnv('NODE_USE_ENV_PROXY', '1');
    vi.stubEnv('HTTP_PROXY', 'http://proxy.corp.example:3128');

    await expect(import('./index')).rejects.toThrow(/Cannot find module '\.\/html-lint-host'/);
    expect(appMock.exit).not.toHaveBeenCalled();
    expect(process.env.NODE_USE_ENV_PROXY).toBe('1');
  });

  it("lets CI's copy with the inspector on through with NODE_USE_ENV_PROXY set", async () => {
    launch.inspectorUrl = 'ws://127.0.0.1:9229/test';
    launch.switches = [];
    vi.stubEnv('NODE_USE_ENV_PROXY', '1');

    await expect(import('./index')).rejects.toThrow(/Cannot find module '\.\/html-lint-host'/);
    expect(appMock.exit).not.toHaveBeenCalled();
  });

  it('deletes SSLKEYLOGFILE and NODE_TLS_REJECT_UNAUTHORIZED before anything else loads in a packaged run', async () => {
    launch.switches = [];
    vi.stubEnv('ANTON_HTML_LINT_TARGET', '');
    vi.stubEnv('SSLKEYLOGFILE', '/tmp/keys.log');
    vi.stubEnv('NODE_TLS_REJECT_UNAUTHORIZED', '0');
    vi.stubEnv('UV_TOOL_BIN_DIR', '/tmp/other/bin');
    vi.stubEnv('MINDS_API_HOST', 'https://api.example.test');

    await expect(import('./index')).rejects.toThrow(/Cannot find module '\.\/app'/);
    expect(process.env.SSLKEYLOGFILE).toBeUndefined();
    expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
    expect(process.env.UV_TOOL_BIN_DIR).toBeUndefined();
    expect(process.env.MINDS_API_HOST).toBeUndefined();
  });

  it('keeps SSLKEYLOGFILE and NODE_TLS_REJECT_UNAUTHORIZED in a development run', async () => {
    appMock.isPackaged = false;
    Object.defineProperty(process, 'defaultApp', { value: true, configurable: true });
    vi.stubEnv('SSLKEYLOGFILE', '/tmp/keys.log');
    vi.stubEnv('NODE_TLS_REJECT_UNAUTHORIZED', '0');

    await expect(import('./index')).rejects.toThrow(/Cannot find module '\.\/html-lint-host'/);
    expect(process.env.SSLKEYLOGFILE).toBe('/tmp/keys.log');
    expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBe('0');
  });

  it('lets a packaged launch without a denied switch through to the app', async () => {
    launch.switches = ['headless', 'disable-gpu'];
    vi.stubEnv('ANTON_HTML_LINT_TARGET', '');

    await expect(import('./index')).rejects.toThrow(/Cannot find module '\.\/app'/);
    expect(appMock.exit).not.toHaveBeenCalled();
    expect(diagnosticMock).not.toHaveBeenCalled();
    expect(appMock.getPath).not.toHaveBeenCalled();
    expect(existsSync(logsFolder)).toBe(false);
  });
});
