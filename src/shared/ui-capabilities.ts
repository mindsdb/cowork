export function platformUiEnabled(target: string | undefined, value: string | undefined): boolean {
  return target !== 'web' || value === 'true';
}
