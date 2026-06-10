import type { ModelOption } from './types';

const KEYCLOAK_URL = import.meta.env.VITE_KEYCLOAK_URL || 'https://auth.mindshub.ai/auth';
const KEYCLOAK_BASE = KEYCLOAK_URL.replace('/auth', '');
export const MINDS_API_BASE = import.meta.env.VITE_MINDS_API_URL || 'https://api.mindshub.ai';
// Single source of truth for the MindsHub console. Flip to
// https://console.mindshub.ai when the desktop app moves to prod.
export const MINDS_CONSOLE_URL = MINDS_API_BASE.replace('://api.', '://console.');
export const MINDS_BILLING_URL = `${MINDS_CONSOLE_URL}/settings/organization/billing`;
export const MINDS_API_KEY_URL = `${MINDS_CONSOLE_URL}/api-key`;
export const MINDS_REGISTER_URL = `${KEYCLOAK_BASE}/auth/realms/mindsdb/account`;

export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
export const CUSTOM_MODEL = '__custom__';

export const ANTHROPIC_MODELS: ModelOption[] = [
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { id: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
];

export const OPENAI_MODELS: ModelOption[] = [
  { id: 'gpt-5.4', label: 'GPT-5.4' },
  { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' },
  { id: 'o3', label: 'o3' },
  { id: 'o4-mini', label: 'o4 Mini' },
];

export const GEMINI_MODELS: ModelOption[] = [
  { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
];
