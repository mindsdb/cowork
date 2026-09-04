export function parseCommandLine(value: string): string[] {
  const args: string[] = [];
  let current = '';
  let tokenStarted = false;
  let quote: 'single' | 'double' | null = null;
  let escaped = false;
  const trimmed = value.trim();
  for (let index = 0; index < trimmed.length; index += 1) {
    const character = trimmed[index];
    const next = trimmed[index + 1];
    if (escaped) {
      current += character;
      tokenStarted = true;
      escaped = false;
    } else if (character === '\\' && quote !== 'single') {
      // Preserve Windows path separators. Backslash is an escape only where
      // it is actually needed to keep a quote or unquoted space in one argv.
      const escapesNext = quote === 'double' ? next === '"' || next === '\\' : next === '"' || next === "'" || /\s/.test(next || '');
      if (escapesNext) escaped = true;
      else {
        current += character;
        tokenStarted = true;
      }
    } else if (character === "'" && quote !== 'double') {
      tokenStarted = true;
      quote = quote === 'single' ? null : 'single';
    } else if (character === '"' && quote !== 'single') {
      tokenStarted = true;
      quote = quote === 'double' ? null : 'double';
    } else if (/\s/.test(character) && !quote) {
      if (tokenStarted) args.push(current);
      current = '';
      tokenStarted = false;
    } else {
      current += character;
      tokenStarted = true;
    }
  }
  if (escaped) {
    current += '\\';
    tokenStarted = true;
  }
  if (quote) throw new Error('Close the quoted command argument.');
  if (tokenStarted) args.push(current);
  return args;
}

export function formatCommandLine(argv: string[]): string {
  return argv.map((argument) => (
    /^[A-Za-z0-9_./:@%+=,-]+$/.test(argument)
      ? argument
      : `"${argument.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
  )).join(' ');
}
