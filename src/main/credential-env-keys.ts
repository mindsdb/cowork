// The dotenv keys that carry a provider credential.
//
// A leaf module on purpose. Two callers need this list and neither can import
// the other: the sign-out scrub writes the file (and reaches electron through
// its writer), while account-data only reads it and is imported by the token
// store and the sidecar process manager, which must not pull electron in at
// module load. Duplicating it instead would let a newly added provider key be
// stripped on sign-out but not counted as data, or the reverse.

// ANTON_PLANNING_MODEL / ANTON_CODING_MODEL are intentionally absent: a model
// is a choice, not a credential, and the sign-out path must not mutate one.
export const CREDENTIAL_ENV_KEYS = [
  'ANTON_MINDS_API_KEY',
  'ANTON_MINDS_URL',
  'ANTON_MINDS_ENABLED',
  'ANTON_OPENAI_API_KEY',
  'ANTON_OPENAI_BASE_URL',
  'ANTON_OPENAI_API_KEY_CUSTOM',
  'ANTON_ANTHROPIC_API_KEY',
  'ANTON_GEMINI_API_KEY',
  'ANTON_PLANNING_PROVIDER',
  'ANTON_CODING_PROVIDER',
];
