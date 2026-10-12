// The project modal edits the environment as free text; these helpers own the
// text format it is saved in.

export function parseEnvironmentVariables(text: string): [string, string][] {
  return text
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      const separator = line.indexOf('=');
      if (separator < 1) throw new Error(`Environment line needs NAME=value: ${line}`);
      return [line.slice(0, separator).trim(), line.slice(separator + 1)];
    });
}


export function parsePortNames(text: string): string[] {
  return text.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);
}
