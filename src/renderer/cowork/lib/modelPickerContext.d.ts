import type { Context } from 'react';

export interface ModelPickerCatalog {
  models: Array<{ id: string; name: string }>;
  modelMeta: Record<string, unknown> | null;
}

export const ModelPickerContext: Context<ModelPickerCatalog | null>;
export function useModelPickerContext(): ModelPickerCatalog | null;
