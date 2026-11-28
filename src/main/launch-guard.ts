/* Which launches of a packaged build the entry point refuses.
 *
 * A program running as the user can start the signed binary with Chromium
 * switches that hand that program control of it, or of its traffic: a DevTools
 * endpoint that runs script in the app's windows, a program of its choosing
 * started in place of one of the app's child processes, a way to read the
 * app's HTTPS requests and the bearer tokens in them, or a way to send the
 * window's requests to the local server somewhere else. The local server at
 * `http://127.0.0.1:<port>` speaks plain HTTP, and main adds the bearer token
 * and the window proof to the window's requests to it, so whoever receives
 * those requests reads both. The same program can also name a Chromium feature
 * in `--enable-features` (DENIED_LAUNCH_FEATURES), or set NODE_USE_ENV_PROXY,
 * which sends main's own requests to the local server through a proxy
 * (nodeEnvProxyOn).
 *
 * Proxy switches stay allowed, because corporate networks need them. By
 * default Chromium sends requests for loopback hosts, `127.0.0.1` among them,
 * directly rather than through a proxy, and that exemption is what keeps the
 * local server's plain-HTTP traffic away from a proxy. A bypass list removes
 * the exemption with the `<-loopback>` rule, so a packaged build refuses a
 * `--proxy-bypass-list` that carries that rule and allows every other bypass
 * list. The same rule can also arrive through an operating system proxy
 * setting, so the main window's token listener also asks the session how it
 * routes each request to the local server before it adds the token
 * (requireDirectRoute in server-token-listener.ts, loopback-proxy.ts).
 *
 * A packaged build refuses these launches before `ready`, and removes the
 * variables in SCRUBBED_LAUNCH_ENV from its environment. The one exception to
 * the refusal is a run whose Node inspector is active:
 * the release build turns the inspector off with an Electron fuse, so only a
 * copy with that fuse turned back on (CI's installed-app smokes, driven by
 * Playwright with `--inspect=0 --remote-debugging-port=0`) can get there. */

import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { diagnostic } from '../shared/diagnostics';

/* Matched with `app.commandLine.hasSwitch`, which reads the same parsed
 * command line Chromium acts on. `--name=value` and `-name` count as the
 * switch. `--name value` counts too: Chromium sets the switch with an empty
 * value and keeps `value` as a positional argument. Anything after a bare `--`
 * is positional, so it counts as no switch. */
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
  /* Chromium logs the app's requests to a file the caller names. Its default
     capture mode strips only the Authorization and cookie headers, so the file
     holds every URL and every other header in full, X-MindsHub-Authorization,
     x-api-key and the window proof included. */
  'log-net-log',
  /* Chromium records a trace from startup and writes it to a file the caller
     names (`--trace-startup-file`). With the `disabled-by-default-netlog`
     category, the trace holds the app's request URLs and headers, with only
     Authorization and cookies stripped, as `--log-net-log` does. */
  'trace-startup',
  /* The same startup trace, with its categories and output file read from a
     JSON file the caller names. */
  'trace-config-file',
  /* The same startup trace, configured by a Perfetto trace config that the
     caller passes as the switch's value (`--trace-perfetto-config`) or in a
     file it names (`--trace-perfetto-config-file`). A config with the netlog
     category records the app's request headers, tokens included. */
  'trace-perfetto-config',
  'trace-perfetto-config-file',
  /* The same trace, recorded until the app exits and written to a file the
     caller names (`--enable-tracing-output`). */
  'enable-tracing',
  /* The same trace, printed to the console, which the caller who started the
     app reads. */
  'trace-to-console',
  /* The same trace by another route: a background trace the caller
     configures, which Chromium can upload to a URL it names. */
  'enable-background-tracing',
  /* Chromium writes the TLS session keys to a file the caller names, which
     decrypts a capture of the app's HTTPS traffic. */
  'ssl-key-log-file',
  /* Chromium connects to a host and port the caller names in place of the ones
     a request asks for, `127.0.0.1` included, so the window's plain-HTTP
     requests to the local server reach a listener the caller runs. */
  'host-rules',
  /* The same remapping when Chromium resolves a host, `127.0.0.1` included. */
  'host-resolver-rules',
  /* Chromium stops enforcing the same-origin policy, so any page the app shows
     reads responses from other origins. A packaged build has no use for it. */
  'disable-web-security',
  /* Flags the caller hands to V8 in the main process and every renderer, such
     as `--allow-natives-syntax`, which exposes V8's internal functions to page
     script. A packaged build has no use for them. Electron applies them to the
     main process before the main script runs, so there the guard ends the run
     before any renderer starts. */
  'js-flags',
] as const;

export type DeniedLaunchSwitch = (typeof DENIED_LAUNCH_SWITCHES)[number];

/* Chromium features that a packaged build refuses when `--enable-features`
 * names them. The guard reads the switch's value with enableFeaturesNames.
 * Other `--enable-features` values stay allowed. */
export const DENIED_LAUNCH_FEATURES = [
  /* Chromium hands the app's traces to a Perfetto system tracing service. On
     the systems where Chromium supports it, Linux among them, any program
     running as the user can run that service. A trace the service records
     with the netlog category holds the app's request headers, tokens included.
     Chromium turns the feature on before the main script runs, so the guard
     ends that run before any window exists. */
  'EnablePerfettoSystemTracing',
] as const;

export type DeniedLaunchFeature = (typeof DENIED_LAUNCH_FEATURES)[number];

/* The feature names in an `--enable-features` value, read the way Chromium's
 * FeatureList reads them. Chromium splits the value on commas and trims each
 * entry. An entry is a name, optionally followed by `<Trial`, then `.Group`,
 * then `:param/value` pairs, so the name ends at the first `<`, `.` or `:`. A
 * leading `*` tells Chromium to keep the feature's default state, which can be
 * on, so the guard reads past it and counts the name. */
export function enableFeaturesNames(enableFeatures: string): string[] {
  return enableFeatures
    .split(',')
    .map((entry) => entry.trim().replace(/^\*/, '').split(/[<.:]/)[0].trim())
    .filter((name) => name !== '');
}

/* The bypass-list rule that removes Chromium's implicit loopback exemption.
 * Chromium splits a bypass list on commas and semicolons, trims each rule,
 * and matches this one without regard to case. */
const REMOVE_LOOPBACK_EXEMPTION_RULE = '<-loopback>';

/** Whether a `--proxy-bypass-list` value removes Chromium's implicit loopback exemption. */
export function removesLoopbackExemption(bypassList: string): boolean {
  return bypassList
    .split(/[,;]/)
    .some((rule) => rule.trim().toLowerCase() === REMOVE_LOOPBACK_EXEMPTION_RULE);
}

/* Whether a NODE_USE_ENV_PROXY value turns on Node's environment proxy. With
 * it on and HTTP_PROXY set, Node sends main's own requests through that proxy,
 * its requests to the local server at `http://127.0.0.1:<port>` included, and
 * those carry the bearer token and the window proof (authHeader in
 * server-auth.ts). Node sets the proxy up during its bootstrap, before the
 * main script runs, so deleting the variable here comes too late, and a
 * packaged build refuses the launch instead. The guard reads an unset value,
 * an empty value and `0` as off, and every other value as on. */
export function nodeEnvProxyOn(value: string | undefined): boolean {
  return value !== undefined && value !== '' && value !== '0';
}

/* Environment variables a packaged build deletes from its own environment at
 * the top of the main script. Every child inherits the environment, the
 * sidecar and the server's Node children included.
 * - SSLKEYLOGFILE: Chromium's network service writes TLS session keys to the
 *   file it names (Python's `ssl.create_default_context` honors it too).
 * - NODE_TLS_REJECT_UNAUTHORIZED: set to `0`, it turns off certificate checks
 *   for every Node TLS client. Node reads it on each TLS connection, in main
 *   and in the server's Node children. A user who sets it to get past TLS
 *   inspection gets the OS trust store instead, the same trade the
 *   `nodeOptions` fuse makes for NODE_EXTRA_CA_CERTS.
 * - The development overrides that choose which local server runs and where
 *   the app's tokens go. Main starts the server it finds and writes the app
 *   secret, the access token and the window proof to its stdin, so whoever
 *   picks that server receives all three. UV_TOOL_DIR and UV_TOOL_BIN_DIR
 *   pick the folder the server binary runs from (the app sets its own
 *   per-channel values after this). COWORK_SERVER_DIR picks a source
 *   checkout. COWORK_SERVER_PACKAGE, ANTON_PACKAGE, COWORK_SERVER_REF,
 *   ANTON_REF, COWORK_SERVER_CHANNEL and COWORK_SERVER_MIN_VERSION pick what
 *   gets installed. MINDS_API_HOST picks the host that receives sign-in and
 *   token refresh requests. ANTON_DEVTOOLS opens DevTools on the main window;
 *   View > Toggle Developer Tools still does.
 * Deleting them there keeps Chromium's children and the sidecar from seeing
 * them, and it keeps the app starting for a user who sets one for their own
 * debugging, where refusing to start would not. A packaged build then uses
 * the values baked in at build time. */
export const SCRUBBED_LAUNCH_ENV = [
  'SSLKEYLOGFILE',
  'NODE_TLS_REJECT_UNAUTHORIZED',
  'UV_TOOL_DIR',
  'UV_TOOL_BIN_DIR',
  'COWORK_SERVER_DIR',
  'COWORK_SERVER_PACKAGE',
  'ANTON_PACKAGE',
  'COWORK_SERVER_REF',
  'ANTON_REF',
  'COWORK_SERVER_CHANNEL',
  'COWORK_SERVER_MIN_VERSION',
  'MINDS_API_HOST',
  'ANTON_DEVTOOLS',
] as const;

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
  /** `app.commandLine.getSwitchValue`: the switch's value, or an empty string. */
  getSwitchValue: (name: string) => string;
  /** Whether Node's inspector is listening (`inspector.url()` is set). */
  inspectorActive: boolean;
  /** `process.env.NODE_USE_ENV_PROXY`, or undefined when it is unset. */
  nodeUseEnvProxy: string | undefined;
}

/** Why a packaged launch is refused. */
export type LaunchRefusal =
  | { reason: 'denied-switch'; name: DeniedLaunchSwitch }
  | { reason: 'denied-feature'; name: DeniedLaunchFeature }
  | { reason: 'loopback-exemption-removed' }
  | { reason: 'node-env-proxy' };

/** The first reason this launch is refused, or null when the launch may go on. */
export function launchRefusal({ packaged, hasSwitch, getSwitchValue, inspectorActive, nodeUseEnvProxy }: LaunchGuardInput): LaunchRefusal | null {
  if (!packaged || inspectorActive) return null;
  const name = DENIED_LAUNCH_SWITCHES.find((candidate) => hasSwitch(candidate));
  if (name) return { reason: 'denied-switch', name };
  const enabledFeatures = enableFeaturesNames(getSwitchValue('enable-features'));
  const feature = DENIED_LAUNCH_FEATURES.find((candidate) => enabledFeatures.includes(candidate));
  if (feature) return { reason: 'denied-feature', name: feature };
  if (removesLoopbackExemption(getSwitchValue('proxy-bypass-list'))) return { reason: 'loopback-exemption-removed' };
  if (nodeEnvProxyOn(nodeUseEnvProxy)) return { reason: 'node-env-proxy' };
  return null;
}

/** What a refused launch writes before it exits: a stderr line, and the event its diagnostic and its LAUNCH_GUARD_LOG_FILE line carry. */
export interface LaunchRefusalReport {
  stderrLine: string;
  event: string;
}

export function launchRefusalReport(refusal: LaunchRefusal): LaunchRefusalReport {
  switch (refusal.reason) {
    case 'denied-switch':
      return {
        stderrLine: `launch-guard: a packaged build does not start with --${refusal.name}\n`,
        event: 'launch_guard_refused_denied_switch',
      };
    case 'denied-feature':
      return {
        stderrLine: `launch-guard: a packaged build does not start when --enable-features names ${refusal.name}\n`,
        event: 'launch_guard_refused_denied_feature',
      };
    case 'loopback-exemption-removed':
      return {
        stderrLine: 'launch-guard: a packaged build does not start when --proxy-bypass-list removes the loopback exemption with <-loopback>\n',
        event: 'launch_guard_refused_loopback_exemption_removed',
      };
    case 'node-env-proxy':
      return {
        stderrLine: "launch-guard: a packaged build does not start with NODE_USE_ENV_PROXY set, because Node would send the app's requests to its local server through HTTP_PROXY; unset it or set it to 0\n",
        event: 'launch_guard_refused_node_env_proxy',
      };
  }
}

/** The logger a refused launch's diagnostic and its LAUNCH_GUARD_LOG_FILE line name. */
export const LAUNCH_GUARD_LOGGER = 'main.launch-guard';

/* The file in the app's logs folder (`app.getPath('logs')`) that a refused
 * launch appends one line to. A launch from the Finder, the Dock or a desktop
 * shortcut sends stderr nowhere a user can find it, so this file is what a
 * user or support finds afterwards. */
export const LAUNCH_GUARD_LOG_FILE = 'launch-guard.log';

/** One line of LAUNCH_GUARD_LOG_FILE: the fields `diagnostic` prints for the refusal, and nothing from the command line. */
export interface LaunchRefusalLogRecord {
  logged_at: string;
  logger: typeof LAUNCH_GUARD_LOGGER;
  log_level: 'ERROR';
  event: string;
  message: string;
}

/** The JSON line, newline included, that a refused launch appends to LAUNCH_GUARD_LOG_FILE. */
export function launchRefusalLogLine(event: string, loggedAt: Date): string {
  const record: LaunchRefusalLogRecord = {
    logged_at: loggedAt.toISOString(),
    logger: LAUNCH_GUARD_LOGGER,
    log_level: 'ERROR',
    event,
    message: event.replace(/_/g, ' '),
  };
  return `${JSON.stringify(record)}\n`;
}

/* Appends the refusal's line to LAUNCH_GUARD_LOG_FILE in the folder that
 * `logsFolder` returns, and creates the folder when it is missing. The caller
 * exits right after, so the write is synchronous. `logsFolder` is a function
 * so that a failure to name the folder is caught here too: any failure becomes
 * a warning diagnostic, never an exception that would keep the run from
 * exiting. */
export function appendLaunchRefusalLog(logsFolder: () => string, event: string): void {
  try {
    const folder = logsFolder();
    mkdirSync(folder, { recursive: true });
    appendFileSync(join(folder, LAUNCH_GUARD_LOG_FILE), launchRefusalLogLine(event, new Date()));
  } catch (error) {
    diagnostic(LAUNCH_GUARD_LOGGER, 'WARNING', 'launch_guard_log_not_written', error);
  }
}
