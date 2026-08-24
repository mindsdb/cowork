import { describe, expect, it } from 'vitest';

import { formatCommandLine, parseCommandLine } from './commandLine';


describe('structured project commands', () => {
  it('round-trips shell-free argv on macOS and Windows', () => {
    const cases = [
      ['npm', 'run', 'test:unit'],
      ['/Applications/My Tool/bin/node', '--flag=value'],
      ['C:\\Program Files\\nodejs\\node.exe', 'script with spaces.js'],
      ['C:\\work\\repo\\tool.exe', '--output', 'C:\\temp\\result.txt'],
      ['C:\\Program Files\\tooling\\', 'value with "quotes" and \'apostrophes\''],
    ];
    for (const argv of cases) expect(parseCommandLine(formatCommandLine(argv))).toEqual(argv);
  });

  it('preserves a Windows path typed with normal backslashes', () => {
    expect(parseCommandLine('"C:\\Program Files\\nodejs\\node.exe" test.js')).toEqual([
      'C:\\Program Files\\nodejs\\node.exe',
      'test.js',
    ]);
  });

  it('rejects an unfinished quoted argument at save time', () => {
    expect(() => parseCommandLine('npm run "test')).toThrow('Close the quoted command argument');
  });
});
