// The project modal edits task defaults as free text; these helpers own the
// text format so the summary line and the saved payload cannot disagree.

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


// The summary must never throw while the user is mid-edit, so it reads names
// loosely instead of parsing; parseEnvironmentVariables validates on save.
// Saving keeps one value per name, so a name typed twice counts once here too.
export function countEnvironmentVariables(text: string): number {
  const names = new Set<string>();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const separator = line.indexOf('=');
    names.add((separator > 0 ? line.slice(0, separator) : line).trim());
  }
  return names.size;
}


export function parsePortNames(text: string): string[] {
  return text.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);
}


export function describeTaskDefaults({
  agent,
  model,
  permission,
  variableCount,
  portNames,
}: {
  agent: string;
  model: string;
  permission: string;
  variableCount: number;
  portNames: string[];
}): string {
  const parts = [agent, model, permission];
  if (variableCount) parts.push(`${variableCount} variable${variableCount === 1 ? '' : 's'}`);
  if (portNames.length) parts.push(portNames.join(', '));
  return parts.filter(Boolean).join(' · ');
}
