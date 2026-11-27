import { describe, expect, it } from 'vitest';
import { DENIED_LAUNCH_SWITCHES, deniedLaunchSwitch, isPackagedRun, scrubLaunchEnv } from './launch-guard';

/* A command line as `app.commandLine.hasSwitch` sees it: switch names only. */
function commandLine(...switches: string[]): (name: string) => boolean {
  return (name) => switches.includes(name);
}

interface GuardCase {
  name: string;
  packaged: boolean;
  switches: string[];
  inspectorActive: boolean;
  expected: string | null;
}

const deniedCases: GuardCase[] = DENIED_LAUNCH_SWITCHES.flatMap((name) => [
  { name: `packaged, --${name}, no inspector: refused`, packaged: true, switches: [name], inspectorActive: false, expected: name },
  { name: `packaged, --${name}, inspector on (CI's fused-on copy): allowed`, packaged: true, switches: [name], inspectorActive: true, expected: null },
  { name: `unpackaged, --${name}, no inspector: allowed`, packaged: false, switches: [name], inspectorActive: false, expected: null },
  { name: `unpackaged, --${name}, inspector on: allowed`, packaged: false, switches: [name], inspectorActive: true, expected: null },
]);

const otherCases: GuardCase[] = [
  { name: 'packaged, no switch: allowed', packaged: true, switches: [], inspectorActive: false, expected: null },
  { name: 'unpackaged, no switch: allowed', packaged: false, switches: [], inspectorActive: false, expected: null },
  /* anton's lint launch: [browser, <runner path>, "--headless=new", "--disable-gpu"]. */
  { name: "packaged, anton's lint switches: allowed", packaged: true, switches: ['headless', 'disable-gpu'], inspectorActive: false, expected: null },
  { name: 'packaged, --user-data-dir: allowed', packaged: true, switches: ['user-data-dir'], inspectorActive: false, expected: null },
  /* Corporate networks need a proxy, and a proxy alone cannot read HTTPS. */
  { name: 'packaged, proxy switches: allowed', packaged: true, switches: ['proxy-server', 'proxy-pac-url', 'proxy-bypass-list', 'no-proxy-server'], inspectorActive: false, expected: null },
  /* Playwright's launch of CI's installed-app copy. */
  { name: 'packaged, Playwright launch with the inspector on: allowed', packaged: true, switches: ['inspect', 'remote-debugging-port'], inspectorActive: true, expected: null },
  { name: 'packaged, Playwright launch on a release build (inspector fused off): refused', packaged: true, switches: ['inspect', 'remote-debugging-port'], inspectorActive: false, expected: 'remote-debugging-port' },
  { name: 'packaged, a denied switch beside allowed ones: refused', packaged: true, switches: ['headless', 'gpu-launcher', 'disable-gpu'], inspectorActive: false, expected: 'gpu-launcher' },
];

describe('deniedLaunchSwitch', () => {
  it.each([...deniedCases, ...otherCases])('$name', ({ packaged, switches, inspectorActive, expected }) => {
    expect(deniedLaunchSwitch({ packaged, hasSwitch: commandLine(...switches), inspectorActive })).toBe(expected);
  });

  it('denies the debugger and child-launcher switches', () => {
    expect([...DENIED_LAUNCH_SWITCHES]).toEqual(expect.arrayContaining([
      'remote-debugging-port',
      'remote-debugging-pipe',
      'renderer-cmd-prefix',
      'utility-cmd-prefix',
      'gpu-launcher',
      'browser-subprocess-path',
      'ignore-certificate-errors',
      'ignore-certificate-errors-spki-list',
      'log-net-log',
      'ssl-key-log-file',
    ]));
  });
});

describe('scrubLaunchEnv', () => {
  it('deletes SSLKEYLOGFILE in a packaged run and leaves the rest', () => {
    const env: NodeJS.ProcessEnv = { SSLKEYLOGFILE: '/tmp/keys.log', HTTPS_PROXY: 'http://proxy.example.test:3128', HOME: '/home/a' };

    scrubLaunchEnv(env, true);

    expect(env).toEqual({ HTTPS_PROXY: 'http://proxy.example.test:3128', HOME: '/home/a' });
  });

  it('leaves the environment alone in an unpackaged run', () => {
    const env: NodeJS.ProcessEnv = { SSLKEYLOGFILE: '/tmp/keys.log' };

    scrubLaunchEnv(env, false);

    expect(env).toEqual({ SSLKEYLOGFILE: '/tmp/keys.log' });
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
