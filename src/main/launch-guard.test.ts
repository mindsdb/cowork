import { afterEach, describe, expect, it, vi } from 'vitest';
import { diagnostic } from '../shared/diagnostics';
import {
  DENIED_LAUNCH_FEATURES,
  DENIED_LAUNCH_SWITCHES,
  enableFeaturesNames,
  isPackagedRun,
  LAUNCH_GUARD_LOGGER,
  launchRefusal,
  launchRefusalLogLine,
  launchRefusalReport,
  nodeEnvProxyOn,
  removesLoopbackExemption,
  SCRUBBED_LAUNCH_ENV,
  scrubLaunchEnv,
  type LaunchGuardInput,
  type LaunchRefusal,
} from './launch-guard';

/* A command line as `app.commandLine` sees it: each switch name with its
 * value, an empty string for a switch without one. */
type SwitchValues = Record<string, string>;

function guardInput(packaged: boolean, switches: SwitchValues, inspectorActive: boolean, nodeUseEnvProxy?: string): LaunchGuardInput {
  return {
    packaged,
    hasSwitch: (name) => Object.hasOwn(switches, name),
    getSwitchValue: (name) => (Object.hasOwn(switches, name) ? switches[name] : ''),
    inspectorActive,
    nodeUseEnvProxy,
  };
}

interface GuardCase {
  name: string;
  packaged: boolean;
  switches: SwitchValues;
  inspectorActive: boolean;
  /** NODE_USE_ENV_PROXY, unset when absent. */
  nodeUseEnvProxy?: string;
  expected: LaunchRefusal | null;
}

/* Every refusal reaches a packaged run without the inspector only. */
function refusedOnlyWhenPackaged(label: string, switches: SwitchValues, refusal: LaunchRefusal, nodeUseEnvProxy?: string): GuardCase[] {
  return [
    { name: `packaged, ${label}, no inspector: refused`, packaged: true, switches, inspectorActive: false, nodeUseEnvProxy, expected: refusal },
    { name: `packaged, ${label}, inspector on (CI's fused-on copy): allowed`, packaged: true, switches, inspectorActive: true, nodeUseEnvProxy, expected: null },
    { name: `unpackaged, ${label}, no inspector: allowed`, packaged: false, switches, inspectorActive: false, nodeUseEnvProxy, expected: null },
    { name: `unpackaged, ${label}, inspector on: allowed`, packaged: false, switches, inspectorActive: true, nodeUseEnvProxy, expected: null },
  ];
}

const deniedCases: GuardCase[] = DENIED_LAUNCH_SWITCHES.flatMap((name) =>
  refusedOnlyWhenPackaged(`--${name}`, { [name]: '' }, { reason: 'denied-switch', name }),
);

const PROXY_SERVER = 'http://proxy.corp.example:3128';
const LOOPBACK_REFUSAL: LaunchRefusal = { reason: 'loopback-exemption-removed' };

const loopbackCases: GuardCase[] = [
  ...refusedOnlyWhenPackaged(
    'a proxy with --proxy-bypass-list=<-loopback>',
    { 'proxy-server': PROXY_SERVER, 'proxy-bypass-list': '<-loopback>' },
    LOOPBACK_REFUSAL,
  ),
  /* The guard reads the bypass list on its own, whatever the other proxy switches say. */
  { name: 'packaged, --proxy-bypass-list=<-loopback> without --proxy-server: refused', packaged: true, switches: { 'proxy-bypass-list': '<-loopback>' }, inspectorActive: false, expected: LOOPBACK_REFUSAL },
  { name: 'packaged, <-loopback> among other rules: refused', packaged: true, switches: { 'proxy-server': PROXY_SERVER, 'proxy-bypass-list': '*.corp.example; <-LoopBack> ,10.0.0.0/8' }, inspectorActive: false, expected: LOOPBACK_REFUSAL },
  /* `--proxy-bypass-list <-loopback>`: Chromium sets the switch with an empty
     value and keeps `<-loopback>` positional, so the exemption holds. */
  { name: 'packaged, <-loopback> after a space, read as a positional argument: allowed', packaged: true, switches: { 'proxy-server': PROXY_SERVER, 'proxy-bypass-list': '' }, inspectorActive: false, expected: null },
  { name: 'packaged, a denied switch and <-loopback>: the denied switch is reported', packaged: true, switches: { 'host-rules': 'MAP * 127.0.0.1', 'proxy-bypass-list': '<-loopback>' }, inspectorActive: false, expected: { reason: 'denied-switch', name: 'host-rules' } },
];

const PERFETTO_SYSTEM_TRACING_REFUSAL: LaunchRefusal = { reason: 'denied-feature', name: 'EnablePerfettoSystemTracing' };

/* Chromium's `--enable-features` syntax: `Name<Trial.Group:param/value`, with
   an optional leading `*`, entries separated by commas. */
const featureCases: GuardCase[] = [
  ...refusedOnlyWhenPackaged(
    '--enable-features=EnablePerfettoSystemTracing',
    { 'enable-features': 'EnablePerfettoSystemTracing' },
    PERFETTO_SYSTEM_TRACING_REFUSAL,
  ),
  ...[
    'ParallelDownloading,EnablePerfettoSystemTracing,OverlayScrollbar',
    'ParallelDownloading, EnablePerfettoSystemTracing ',
    '*EnablePerfettoSystemTracing',
    'EnablePerfettoSystemTracing<Trial',
    'EnablePerfettoSystemTracing<Trial.Group',
    'EnablePerfettoSystemTracing.Group',
    'EnablePerfettoSystemTracing:p/v',
    '*EnablePerfettoSystemTracing<Trial.Group:p/v/q/w',
    'OverlayScrollbar,*EnablePerfettoSystemTracing:p/v',
  ].map((value): GuardCase => ({
    name: `packaged, --enable-features=${value}: refused`,
    packaged: true,
    switches: { 'enable-features': value },
    inspectorActive: false,
    expected: PERFETTO_SYSTEM_TRACING_REFUSAL,
  })),
  ...[
    'ParallelDownloading,OverlayScrollbar',
    'EnablePerfettoSystemTracingX',
    'XEnablePerfettoSystemTracing',
    'enableperfettosystemtracing',
    'ParallelDownloading<EnablePerfettoSystemTracing',
    'ParallelDownloading:EnablePerfettoSystemTracing/1',
  ].map((value): GuardCase => ({
    name: `packaged, --enable-features=${value}: allowed`,
    packaged: true,
    switches: { 'enable-features': value },
    inspectorActive: false,
    expected: null,
  })),
  /* `--enable-features EnablePerfettoSystemTracing`: Chromium sets the switch
     with an empty value and keeps the name positional, so no feature turns on. */
  { name: 'packaged, the feature after a space, read as a positional argument: allowed', packaged: true, switches: { 'enable-features': '' }, inspectorActive: false, expected: null },
  { name: 'packaged, --disable-features=EnablePerfettoSystemTracing: allowed', packaged: true, switches: { 'disable-features': 'EnablePerfettoSystemTracing' }, inspectorActive: false, expected: null },
  { name: 'packaged, a denied switch and the feature: the denied switch is reported', packaged: true, switches: { 'trace-startup': '', 'enable-features': 'EnablePerfettoSystemTracing' }, inspectorActive: false, expected: { reason: 'denied-switch', name: 'trace-startup' } },
];

const NODE_ENV_PROXY_REFUSAL: LaunchRefusal = { reason: 'node-env-proxy' };

const nodeEnvProxyCases: GuardCase[] = [
  ...refusedOnlyWhenPackaged('NODE_USE_ENV_PROXY=1', {}, NODE_ENV_PROXY_REFUSAL, '1'),
  { name: 'packaged, NODE_USE_ENV_PROXY=true: refused', packaged: true, switches: {}, inspectorActive: false, nodeUseEnvProxy: 'true', expected: NODE_ENV_PROXY_REFUSAL },
  { name: 'packaged, NODE_USE_ENV_PROXY=0: allowed', packaged: true, switches: {}, inspectorActive: false, nodeUseEnvProxy: '0', expected: null },
  { name: 'packaged, NODE_USE_ENV_PROXY empty: allowed', packaged: true, switches: {}, inspectorActive: false, nodeUseEnvProxy: '', expected: null },
  /* Corporate networks need a proxy, and Chromium's proxy switches keep the loopback exemption. */
  { name: 'packaged, NODE_USE_ENV_PROXY=0 with proxy switches: allowed', packaged: true, switches: { 'proxy-server': PROXY_SERVER }, inspectorActive: false, nodeUseEnvProxy: '0', expected: null },
  { name: 'packaged, a denied switch and NODE_USE_ENV_PROXY=1: the denied switch is reported', packaged: true, switches: { 'host-rules': 'MAP * 127.0.0.1' }, inspectorActive: false, nodeUseEnvProxy: '1', expected: { reason: 'denied-switch', name: 'host-rules' } },
];

const otherCases: GuardCase[] = [
  { name: 'packaged, no switch: allowed', packaged: true, switches: {}, inspectorActive: false, expected: null },
  { name: 'unpackaged, no switch: allowed', packaged: false, switches: {}, inspectorActive: false, expected: null },
  /* anton's lint launch: [browser, <runner path>, "--headless=new", "--disable-gpu"]. */
  { name: "packaged, anton's lint switches: allowed", packaged: true, switches: { headless: 'new', 'disable-gpu': '' }, inspectorActive: false, expected: null },
  { name: 'packaged, --user-data-dir: allowed', packaged: true, switches: { 'user-data-dir': '/tmp/cowork-profile' }, inspectorActive: false, expected: null },
  /* macOS passes `-psn_0_1` to an app the Finder starts on older systems. */
  { name: 'packaged, -psn_0_1: allowed', packaged: true, switches: { psn_0_1: '' }, inspectorActive: false, expected: null },
  { name: 'packaged, --lang=fr: allowed', packaged: true, switches: { lang: 'fr' }, inspectorActive: false, expected: null },
  /* electron-updater relaunches the app with `--updated` after an install. */
  { name: "packaged, electron-updater's --updated: allowed", packaged: true, switches: { updated: '' }, inspectorActive: false, expected: null },
  /* Corporate networks need a proxy, and an ordinary bypass list keeps the loopback exemption. */
  { name: 'packaged, proxy switches with an ordinary bypass list: allowed', packaged: true, switches: { 'proxy-server': PROXY_SERVER, 'proxy-pac-url': 'http://proxy.corp.example/proxy.pac', 'proxy-bypass-list': '*.corp.example;10.0.0.0/8', 'no-proxy-server': '' }, inspectorActive: false, expected: null },
  { name: 'packaged, --proxy-bypass-list=<local>: allowed', packaged: true, switches: { 'proxy-server': PROXY_SERVER, 'proxy-bypass-list': '<local>' }, inspectorActive: false, expected: null },
  /* Playwright's launch of CI's installed-app copy. */
  { name: 'packaged, Playwright launch with the inspector on: allowed', packaged: true, switches: { inspect: '0', 'remote-debugging-port': '0' }, inspectorActive: true, expected: null },
  { name: 'packaged, Playwright launch on a release build (inspector fused off): refused', packaged: true, switches: { inspect: '0', 'remote-debugging-port': '0' }, inspectorActive: false, expected: { reason: 'denied-switch', name: 'remote-debugging-port' } },
  { name: 'packaged, a denied switch beside allowed ones: refused', packaged: true, switches: { headless: 'new', 'gpu-launcher': '/tmp/wrap', 'disable-gpu': '' }, inspectorActive: false, expected: { reason: 'denied-switch', name: 'gpu-launcher' } },
  /* A startup trace of the network category, which writes request headers to the named file. */
  { name: 'packaged, a netlog startup trace to a file: refused', packaged: true, switches: { 'trace-startup': 'disabled-by-default-netlog', 'trace-startup-file': '/tmp/trace.json' }, inspectorActive: false, expected: { reason: 'denied-switch', name: 'trace-startup' } },
];

describe('launchRefusal', () => {
  it.each([...deniedCases, ...loopbackCases, ...featureCases, ...nodeEnvProxyCases, ...otherCases])('$name', ({ packaged, switches, inspectorActive, nodeUseEnvProxy, expected }) => {
    expect(launchRefusal(guardInput(packaged, switches, inspectorActive, nodeUseEnvProxy))).toEqual(expected);
  });

  it('denies exactly these switches', () => {
    expect([...DENIED_LAUNCH_SWITCHES]).toEqual([
      'remote-debugging-port',
      'remote-debugging-pipe',
      'renderer-cmd-prefix',
      'utility-cmd-prefix',
      'gpu-launcher',
      'browser-subprocess-path',
      'zygote-cmd-prefix',
      'ignore-certificate-errors',
      'ignore-certificate-errors-spki-list',
      'log-net-log',
      'trace-startup',
      'trace-config-file',
      'trace-perfetto-config',
      'trace-perfetto-config-file',
      'enable-tracing',
      'trace-to-console',
      'enable-background-tracing',
      'ssl-key-log-file',
      'host-rules',
      'host-resolver-rules',
      'disable-web-security',
      'js-flags',
    ]);
  });

  it('denies exactly these features in --enable-features', () => {
    expect([...DENIED_LAUNCH_FEATURES]).toEqual(['EnablePerfettoSystemTracing']);
  });
});

describe('enableFeaturesNames', () => {
  it.each([
    { value: '', expected: [] },
    { value: 'A', expected: ['A'] },
    { value: 'A,B', expected: ['A', 'B'] },
    { value: ' A , B ', expected: ['A', 'B'] },
    { value: 'A,,B,', expected: ['A', 'B'] },
    { value: '*A', expected: ['A'] },
    { value: 'A<Trial', expected: ['A'] },
    { value: 'A<Trial.Group', expected: ['A'] },
    { value: 'A.Group', expected: ['A'] },
    { value: 'A:p/v', expected: ['A'] },
    { value: 'A:p/v/q/w', expected: ['A'] },
    { value: '*A<Trial.Group:p/v,B', expected: ['A', 'B'] },
  ])('"$value": $expected', ({ value, expected }) => {
    expect(enableFeaturesNames(value)).toEqual(expected);
  });
});

describe('nodeEnvProxyOn', () => {
  it.each([
    { value: undefined, expected: false },
    { value: '', expected: false },
    { value: '0', expected: false },
    { value: '1', expected: true },
    { value: 'true', expected: true },
    { value: '00', expected: true },
  ])('$value: $expected', ({ value, expected }) => {
    expect(nodeEnvProxyOn(value)).toBe(expected);
  });
});

describe('removesLoopbackExemption', () => {
  it.each([
    { bypassList: '<-loopback>', expected: true },
    { bypassList: '<-LOOPBACK>', expected: true },
    { bypassList: '  <-loopback>  ', expected: true },
    { bypassList: '*.corp.example,<-loopback>', expected: true },
    { bypassList: '*.corp.example;<-loopback>;10.0.0.0/8', expected: true },
    { bypassList: '', expected: false },
    { bypassList: '<local>', expected: false },
    { bypassList: '*.corp.example;10.0.0.0/8', expected: false },
    { bypassList: 'localhost,127.0.0.1', expected: false },
    { bypassList: 'example-loopback.corp.example', expected: false },
  ])('"$bypassList": $expected', ({ bypassList, expected }) => {
    expect(removesLoopbackExemption(bypassList)).toBe(expected);
  });
});

describe('launchRefusalReport', () => {
  it('names the denied switch in the same stderr line as before', () => {
    expect(launchRefusalReport({ reason: 'denied-switch', name: 'remote-debugging-port' })).toEqual({
      stderrLine: 'launch-guard: a packaged build does not start with --remote-debugging-port\n',
      event: 'launch_guard_refused_denied_switch',
    });
  });

  it('says the bypass list removes the loopback exemption, not that the switch is refused', () => {
    expect(launchRefusalReport({ reason: 'loopback-exemption-removed' })).toEqual({
      stderrLine: 'launch-guard: a packaged build does not start when --proxy-bypass-list removes the loopback exemption with <-loopback>\n',
      event: 'launch_guard_refused_loopback_exemption_removed',
    });
  });

  it('names the denied feature, not the --enable-features switch alone', () => {
    expect(launchRefusalReport({ reason: 'denied-feature', name: 'EnablePerfettoSystemTracing' })).toEqual({
      stderrLine: 'launch-guard: a packaged build does not start when --enable-features names EnablePerfettoSystemTracing\n',
      event: 'launch_guard_refused_denied_feature',
    });
  });

  it('names NODE_USE_ENV_PROXY, says why, and says how to start', () => {
    expect(launchRefusalReport({ reason: 'node-env-proxy' })).toEqual({
      stderrLine: "launch-guard: a packaged build does not start with NODE_USE_ENV_PROXY set, because Node would send the app's requests to its local server through HTTP_PROXY; unset it or set it to 0\n",
      event: 'launch_guard_refused_node_env_proxy',
    });
  });
});

describe('launchRefusalLogLine', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('is one JSON line with the event, the logger, the level and the time, and nothing else', () => {
    const line = launchRefusalLogLine('launch_guard_refused_denied_switch', new Date('2026-01-02T03:04:05.678Z'));

    expect(line.endsWith('\n')).toBe(true);
    expect(line.slice(0, -1)).not.toContain('\n');
    expect(JSON.parse(line)).toEqual({
      logged_at: '2026-01-02T03:04:05.678Z',
      logger: 'main.launch-guard',
      log_level: 'ERROR',
      event: 'launch_guard_refused_denied_switch',
      message: 'launch guard refused denied switch',
    });
  });

  it('holds the same object the diagnostic prints for the same event', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-02T03:04:05.678Z'));
    const printed = vi.spyOn(console, 'error').mockImplementation(() => {});

    diagnostic(LAUNCH_GUARD_LOGGER, 'ERROR', 'launch_guard_refused_loopback_exemption_removed');

    expect(printed).toHaveBeenCalledOnce();
    expect(JSON.parse(launchRefusalLogLine('launch_guard_refused_loopback_exemption_removed', new Date()))).toEqual(
      JSON.parse(String(printed.mock.calls[0][0])),
    );
  });
});

describe('scrubLaunchEnv', () => {
  it('deletes SSLKEYLOGFILE and NODE_TLS_REJECT_UNAUTHORIZED in a packaged run and leaves the rest', () => {
    const env: NodeJS.ProcessEnv = {
      SSLKEYLOGFILE: '/tmp/keys.log',
      NODE_TLS_REJECT_UNAUTHORIZED: '0',
      HTTPS_PROXY: 'http://proxy.example.test:3128',
      HOME: '/home/a',
    };

    scrubLaunchEnv(env, true);

    expect(env).toEqual({ HTTPS_PROXY: 'http://proxy.example.test:3128', HOME: '/home/a' });
  });

  it('deletes NODE_TLS_REJECT_UNAUTHORIZED on its own in a packaged run', () => {
    const env: NodeJS.ProcessEnv = { NODE_TLS_REJECT_UNAUTHORIZED: '0', HOME: '/home/a' };

    scrubLaunchEnv(env, true);

    expect(env).toEqual({ HOME: '/home/a' });
  });

  it('leaves the environment alone in an unpackaged run', () => {
    const env: NodeJS.ProcessEnv = { SSLKEYLOGFILE: '/tmp/keys.log', NODE_TLS_REJECT_UNAUTHORIZED: '0' };

    scrubLaunchEnv(env, false);

    expect(env).toEqual({ SSLKEYLOGFILE: '/tmp/keys.log', NODE_TLS_REJECT_UNAUTHORIZED: '0' });
  });

  /* The overrides that pick which local server runs, what gets installed, and where tokens go. */
  const steering: NodeJS.ProcessEnv = {
    UV_TOOL_DIR: '/tmp/other/tools',
    UV_TOOL_BIN_DIR: '/tmp/other/bin',
    COWORK_SERVER_DIR: '/tmp/other/checkout',
    COWORK_SERVER_PACKAGE: 'cowork-server @ file:///tmp/other/pkg',
    ANTON_PACKAGE: '/tmp/other/anton',
    COWORK_SERVER_REF: 'some-branch',
    ANTON_REF: 'some-branch',
    COWORK_SERVER_CHANNEL: 'git',
    COWORK_SERVER_MIN_VERSION: '0.0.1',
    MINDS_API_HOST: 'https://api.example.test',
    ANTON_DEVTOOLS: '1',
  };

  it('deletes every server, install and API host override in a packaged run, and keeps the port and the rest', () => {
    const env: NodeJS.ProcessEnv = { ...steering, COWORK_SERVER_PORT: '41234', UV_CACHE_DIR: '/tmp/uv-cache', HOME: '/home/a' };

    scrubLaunchEnv(env, true);

    expect(env).toEqual({ COWORK_SERVER_PORT: '41234', UV_CACHE_DIR: '/tmp/uv-cache', HOME: '/home/a' });
  });

  it('keeps every server, install and API host override in an unpackaged run', () => {
    const env: NodeJS.ProcessEnv = { ...steering };

    scrubLaunchEnv(env, false);

    expect(env).toEqual(steering);
  });

  it('scrubs exactly these variables', () => {
    expect([...SCRUBBED_LAUNCH_ENV]).toEqual([
      'SSLKEYLOGFILE',
      'NODE_TLS_REJECT_UNAUTHORIZED',
      ...Object.keys(steering),
    ]);
  });
});

describe('isPackagedRun', () => {
  it.each([
    { name: 'a packaged build', isPackaged: true, defaultApp: undefined, expected: true },
    { name: 'npm run dev and e2e: `electron <path>` through the default app', isPackaged: false, defaultApp: true, expected: false },
    { name: 'the signed binary renamed to `electron`', isPackaged: false, defaultApp: undefined, expected: true },
    { name: 'a packaged build started through a default app', isPackaged: true, defaultApp: true, expected: true },
  ])('$name: $expected', ({ isPackaged, defaultApp, expected }) => {
    expect(isPackagedRun({ isPackaged, defaultApp })).toBe(expected);
  });
});
