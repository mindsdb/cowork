# Cowork on the CVS AIP / LMS gateway

This deployment runs the Cowork web image against CVS's LMS gateway
(`https://hyperion-lms-api.prod.cvshealth.com`), which speaks the
Anthropic Messages protocol and authenticates with LMS-issued
`aip_llm_*` keys. No Anthropic account or GCP auth is needed.

## Quick start

```sh
# 1. Build the image (from the workspace root, one level above cowork/)
docker build -f cowork/Dockerfile -t cowork:cvs .

# 2. Make sure the LMS key exists (provisioned by running CVS Code once)
jq -r .lmsApiKey ~/.cvscode/.lms-credentials.json   # should print aip_llm_...

# 3. Start
cd cowork/deploy/cvs
docker compose up -d
```

Open <http://localhost:26866>. After accepting the terms screen the app
goes straight to the workspace — provider onboarding is skipped because
the container boots preconfigured.

## How it works

- `scripts/docker-entrypoint.sh` runs before the server. If
  `ANTON_ANTHROPIC_API_KEY` is not set it reads `lmsApiKey` from the
  mounted `~/.cvscode/.lms-credentials.json`. On first boot it writes
  all `ANTON_*` env vars to `~/.anton/.env`, which cowork-server's
  one-time env→DB migration turns into stored settings.
- `ANTHROPIC_BASE_URL` is read directly by the `anthropic` Python SDK
  inside the agent, routing every model call through the LMS gateway
  instead of `api.anthropic.com`.
- The `aip_llm_*` key format is fine — nothing in the stack validates
  key prefixes.

## Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `ANTHROPIC_BASE_URL` | LMS prod gateway | Gateway endpoint |
| `COWORK_MODEL` | `claude-opus-4-7` | Planning + coding model id |
| `ANTON_ANTHROPIC_API_KEY` | (from creds file) | Set to bypass the creds-file lookup |
| `COWORK_LMS_CREDS_FILE` | `~/.cvscode/.lms-credentials.json` (in-container) | Alternate creds file path |
| `ANTON_TERMS_CONSENT` | unset | `true` skips the terms screen for all browsers |

Settings changed later in the UI persist in the `cowork-data` volume
(SQLite, key encrypted at rest) and take precedence over the env seed.

## Rotating the LMS key

The creds file is only read when `ANTON_ANTHROPIC_API_KEY` is absent
**and** only applied to the settings DB on the volume's first boot.
After rotating the key, either update it in the UI (Settings → provider
API key) or reset the deployment:

```sh
docker compose down -v && docker compose up -d   # -v wipes cowork-data
```

## Known cosmetic limitation

The "test key" / provider-ping buttons in Settings call
`api.anthropic.com` directly (hardcoded), so they report failure even
though the gateway path works. This does not block anything — readiness
only checks that a key is stored. First-class gateway support (base URL
in the UI + gateway-aware validation) is tracked as follow-up work on
the main branches.
