export type Phase =
  | 'welcome'
  | 'sso-pending'
  | 'subscribe'
  | 'subscribe-pending'
  | 'byok'
  | 'validating'
  | 'success';

export type ByokProvider = 'anthropic' | 'openai' | 'gemini' | 'openai-compatible';

export interface ModelOption {
  id: string;
  label: string;
}

export type FinalizeOutcome =
  | { kind: 'committed' }
  | { kind: 'upgrade-required' }
  | { kind: 'error'; detail: string };
