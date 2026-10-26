import { readFileSync, appendFileSync } from 'node:fs';
import { channels, STEP_NAMES } from './macos-setup-contract.mjs';

// The Windows setup smoke writes the same result files under its own name.
const PLATFORMS = { macos: 'macOS setup', windows: 'Windows setup' };
const platform = process.env.SETUP_PLATFORM || 'macos';
if (!Object.hasOwn(PLATFORMS, platform)) throw new Error(`Unknown setup platform: ${platform}`);
const allowedSteps = new Set(['Preparation', 'Download package', 'Install package', 'Trim root store', 'Launch and isolate app', 'Setup', ...Object.values(STEP_NAMES)]);
const failures = [];
for (const channel of channels(process.env.CHANNELS)) {
  try {
    const result = JSON.parse(readFileSync(`test-results/${platform}-setup-${channel}/result.json`, 'utf8'));
    if (result.passed !== true) {
      failures.push(`${channel}: ${allowedSteps.has(result.failingStep) ? result.failingStep : 'Setup'}`);
    }
  } catch {
    failures.push(`${channel}: runner or workflow failure`);
  }
}
if (process.env.INSTALL_RESULT !== 'success' && failures.length === 0) failures.push('runner or evidence upload failure');
const label = `${PLATFORMS[platform]} (${failures.join('; ')}; setup logs in run artifacts)`;
appendFileSync(process.env.GITHUB_OUTPUT, `failed=${failures.length > 0}\nlabel=${label}\n`);
