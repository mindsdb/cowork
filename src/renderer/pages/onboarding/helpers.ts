import {
  ANTHROPIC_MODELS,
  CUSTOM_MODEL,
  GEMINI_BASE_URL,
  GEMINI_MODELS,
  OPENAI_MODELS,
} from './constants';
import type { ByokProvider, ModelOption } from './types';

export function decodeEmailFromJwt(token: string): string {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return '';
    let payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (payload.length % 4) payload += '=';
    const parsed = JSON.parse(
      decodeURIComponent(
        atob(payload)
          .split('')
          .map((char) => '%' + ('00' + char.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      )
    );
    return typeof parsed?.email === 'string' ? parsed.email : '';
  } catch {
    return '';
  }
}

export function getModelsForProvider(provider: ByokProvider): ModelOption[] {
  if (provider === 'anthropic') return ANTHROPIC_MODELS;
  if (provider === 'openai') return OPENAI_MODELS;
  if (provider === 'gemini') return GEMINI_MODELS;
  return [];
}

export function getDefaultModel(provider: ByokProvider): string {
  if (provider === 'anthropic') return ANTHROPIC_MODELS[0].id;
  if (provider === 'openai') return OPENAI_MODELS[0].id;
  if (provider === 'gemini') return GEMINI_MODELS[0].id;
  return CUSTOM_MODEL;
}

export function resolveSelectedModel(selectedModel: string, customModel: string): string {
  return selectedModel === CUSTOM_MODEL ? customModel.trim() : selectedModel;
}

export function canConnectByok(
  provider: ByokProvider,
  selectedModel: string,
  customModel: string,
  customBaseUrl: string,
  apiKey: string,
): boolean {
  const model = resolveSelectedModel(selectedModel, customModel);
  if (!model) return false;
  if (provider === 'openai-compatible') return customBaseUrl.trim().length > 0;
  return apiKey.trim().length > 0;
}

export function buildByokValidationRequest(
  provider: ByokProvider,
  selectedModel: string,
  customModel: string,
  customBaseUrl: string,
  apiKey: string,
) {
  const model = resolveSelectedModel(selectedModel, customModel);
  const validationProvider = provider === 'anthropic' ? 'anthropic' : 'openai-compatible';
  const baseUrl =
    provider === 'openai' ? 'https://api.openai.com/v1'
    : provider === 'gemini' ? GEMINI_BASE_URL
    : provider === 'openai-compatible' ? customBaseUrl.trim()
    : undefined;
  const normalizedApiKey = apiKey.trim() || (provider === 'openai-compatible' ? 'not-needed' : '');

  return {
    apiKey: normalizedApiKey,
    baseUrl,
    model,
    provider: validationProvider,
  };
}
