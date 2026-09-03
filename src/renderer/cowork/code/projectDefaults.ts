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


// The summary must never throw while the user is mid-edit, so it counts
// lines rather than parsing them; parseEnvironmentVariables validates on save.
export function countEnvironmentLines(text: string): number {
  return text.split('\n').filter((line) => line.trim()).length;
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
