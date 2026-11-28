import fs from 'node:fs';
import path from 'node:path';
import type { PlaywrightTestConfig } from '@playwright/test';

export interface FixtureConfig {
  /** `artifact-card` for `playwright.artifact-card.config.ts`. */
  name: string;
  config: PlaywrightTestConfig;
}

/** The `playwright.<name>.config.ts` files at the repo root whose tests live in e2e/:
 *  the browser-only fixture suites. Discovered, not listed, so a new suite needs only
 *  its config. Evaluates each config module; throws if one points at e2e/ without a
 *  testMatch, since its specs would then run under every other config too.
 *  `skip` names configs not to load at all (a caller that is itself one of them). */
export function browserFixtureConfigs(rootDir: string, skip: string[] = []): FixtureConfig[] {
  const e2eDir = path.resolve(rootDir, 'e2e');
  return fs
    .readdirSync(rootDir)
    .map((file) => /^playwright\.(.+)\.config\.ts$/.exec(file))
    .filter((match): match is RegExpExecArray => match !== null && !skip.includes(match[1]))
    .flatMap(([file, name]) => {
      // A runtime require is the point here: the set of configs is discovered, not listed.
      const config: PlaywrightTestConfig = require(path.join(rootDir, file)).default;
      if (path.resolve(rootDir, config.testDir ?? '.') !== e2eDir) return [];
      if (!config.testMatch) throw new Error(`${file} points at e2e/ without a testMatch`);
      return [{ name, config }];
    });
}
