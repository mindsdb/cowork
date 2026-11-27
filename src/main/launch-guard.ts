/* Which launches of a packaged build the entry point refuses.
 *
 * A program running as the user can start the signed binary with Chromium
 * switches that hand that program control of it, or of its traffic: a DevTools
 * endpoint that runs script in the app's windows, a program of its choosing
 * started in place of one of the app's child processes, or a way to read the
 * app's HTTPS requests and the bearer tokens in them. Proxy switches stay
 * allowed: corporate networks need them, and a proxy alone cannot read HTTPS.
 * A packaged build refuses the switches below before `ready`, and removes
 * SSLKEYLOGFILE from its environment. The one exception to the refusal is a
 * run whose Node inspector is active:
 * the release build turns the inspector off with an Electron fuse, so only a
 * copy with that fuse turned back on (CI's installed-app smokes, driven by
 * Playwright with `--inspect=0 --remote-debugging-port=0`) can get there. */

/* Matched with `app.commandLine.hasSwitch`, which reads the same parsed
 * command line Chromium acts on: `--name=value`, `--name value` and `-name`
 * all count, and anything after a bare `--` counts for neither. */
export const DENIED_LAUNCH_SWITCHES = [
  /* A DevTools endpoint on a local TCP port: any local process connects and
     runs script in every window and frame. */
  'remote-debugging-port',
  /* The same DevTools protocol over file descriptors 3 and 4 the caller holds. */
  'remote-debugging-pipe',
  /* A caller-chosen program wraps each renderer's launch. */
  'renderer-cmd-prefix',
  /* A caller-chosen program wraps each utility process's launch (network,
     storage, audio, Electron's utilityProcess). */
  'utility-cmd-prefix',
  /* A caller-chosen program wraps the GPU process's launch. */
  'gpu-launcher',
  /* A caller-chosen executable replaces the helper every child process starts from. */
  'browser-subprocess-path',
  /* Linux: a caller-chosen program wraps the zygote that forks renderers. The
     zygote starts before the main script runs, so the guard ends that run but
     cannot stop the first launch. */
  'zygote-cmd-prefix',
  /* Chromium accepts any server certificate, so a proxy the caller runs reads
     the app's HTTPS requests. */
  'ignore-certificate-errors',
  /* The same for any certificate whose public key hash the caller lists. */
  'ignore-certificate-errors-spki-list',
  /* Chromium logs the app's requests to a file the caller names: their URLs
     always, and their headers, tokens included, once `--net-log-capture-mode`
     asks for them. */
  'log-net-log',
  /* Chromium writes the TLS session keys to a file the caller names, which
     decrypts a capture of the app's HTTPS traffic. */
  'ssl-key-log-file',
] as const;

export type DeniedLaunchSwitch = (typeof DENIED_LAUNCH_SWITCHES)[number];

/* Environment variables a packaged build deletes from its own environment at
 * the top of the main script. Chromium's network service writes TLS session
 * keys to the file SSLKEYLOGFILE names, and every child inherits it, the
 * sidecar included (Python's `ssl.create_default_context` honors it too).
 * Deleting it there keeps Chromium's children from seeing it, and it keeps the
 * app starting for a user who sets it for their own debugging, where refusing
 * to start would not. */
export const SCRUBBED_LAUNCH_ENV = ['SSLKEYLOGFILE'] as const;

/** Deletes `SCRUBBED_LAUNCH_ENV` from `env` in a packaged run. */
export function scrubLaunchEnv(env: NodeJS.ProcessEnv, packaged: boolean): void {
  if (!packaged) return;
  for (const name of SCRUBBED_LAUNCH_ENV) delete env[name];
}

export interface RunIdentity {
  /** `app.isPackaged`, which Electron derives from the executable's file name alone. */
  isPackaged: boolean;
  /** `process.defaultApp`: true only when Electron's default app loaded this app from a path argument. */
  defaultApp: boolean | undefined;
}

/* A run counts as unpackaged only when both signals say so. `app.isPackaged`
 * is false for any executable named `electron`, so a copy of the signed binary
 * renamed to that would pass for a development run on its own. Electron's
 * default app, which sets `process.defaultApp`, ships only in the npm
 * `electron` package, and a packaged build never loads it. */
export function isPackagedRun({ isPackaged, defaultApp }: RunIdentity): boolean {
  return isPackaged || defaultApp !== true;
}

export interface LaunchGuardInput {
  /** From `isPackagedRun`. */
  packaged: boolean;
  /** `app.commandLine.hasSwitch`. */
  hasSwitch: (name: string) => boolean;
  /** Whether Node's inspector is listening (`inspector.url()` is set). */
  inspectorActive: boolean;
}

/** The first denied switch this launch carries, or null when the launch may go on. */
export function deniedLaunchSwitch({ packaged, hasSwitch, inspectorActive }: LaunchGuardInput): DeniedLaunchSwitch | null {
  if (!packaged || inspectorActive) return null;
  return DENIED_LAUNCH_SWITCHES.find((name) => hasSwitch(name)) ?? null;
}
