export interface ModelPickerSource {
  id: string;
  name: string;
}

export interface ModelPickerMeta {
  modelProviders?: Record<string, string>;
  modelFamilies?: Record<string, string>;
  modelEnabled?: Record<string, boolean>;
  onRefresh?: () => Promise<unknown> | unknown;
}

export interface ModelPickerOption {
  value: string;
  label: string;
  tag?: string;
  provider?: string;
}

export function buildModelPickerOptions(
  models?: ModelPickerSource[],
  modelMeta?: ModelPickerMeta,
): ModelPickerOption[];

export function withModelPickerFallback(
  models?: ModelPickerSource[],
  id?: string,
  name?: string,
): ModelPickerSource[];
