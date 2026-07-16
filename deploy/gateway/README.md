# Cowork on a custom Anthropic-protocol gateway

This deployment runs the Cowork web image against an internal gateway
that speaks the Anthropic Messages protocol — a custom base URL and
gateway-issued API keys instead of api.anthropic.com. No Anthropic
account is needed; key format is not validated anywhere in the stack,
so gateway-issued key prefixes work as-is.

## Quick start

```sh
# 1. Build the image (from the workspace root, one level above cowork/).
#    Pin the backend release for a reproducible, scannable artifact:
docker build -f cowork/Dockerfile -t cowork:gateway \
  --build-arg COWORK_SERVER_VERSION=0.26.7.13.3 .

# 2. Configure and start (see docker-compose.yml for the options)
cd cowork/deploy/gateway
ANTHROPIC_BASE_URL=https://your-gateway.example.com docker compose up -d
```

Open <http://localhost:26866>. After accepting the terms screen the app
goes straight to the workspace — provider onboarding is skipped because
the container boots preconfigured.

## How it works

- `scripts/docker-entrypoint.py` runs before the server. If
  `ANTON_ANTHROPIC_API_KEY` is not set it can read the key from a
  mounted JSON credentials file (`COWORK_LLM_CREDS_FILE`, field name
  `COWORK_LLM_CREDS_FIELD`, default `apiKey`). On first boot it writes
  all `ANTON_*` env vars to the server's `.env`, which cowork-server's
  one-time env→DB migration turns into stored settings.
- `ANTHROPIC_BASE_URL` is read directly by the `anthropic` Python SDK
  inside the agent, routing every model call through the gateway
  instead of `api.anthropic.com`.

## Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `ANTHROPIC_BASE_URL` | (required) | Gateway endpoint |
| `COWORK_MODEL` | `claude-opus-4-7` | Planning + coding model id |
| `ANTON_ANTHROPIC_API_KEY` | — | Gateway-issued API key (direct) |
| `COWORK_LLM_CREDS_FILE` | — | Path to a mounted JSON credentials file |
| `COWORK_LLM_CREDS_FIELD` | `apiKey` | JSON field holding the key |
| `ANTON_TERMS_CONSENT` | unset | `true` skips the terms screen for all browsers |

Settings changed later in the UI persist in the `cowork-data` volume
(SQLite, key encrypted at rest) and take precedence over the env seed.

## Rotating the key

The credentials file is only read when `ANTON_ANTHROPIC_API_KEY` is
absent **and** only applied to the settings DB on the volume's first
boot. After rotating the key, either update it in the UI (Settings →
provider API key) or reset the deployment:

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
