# Data Vault — Architecture Overview (anton-core)

This document describes how anton-core's data vault works end-to-end, from
the moment a user shares credentials in chat to the moment LLM-generated
scratchpad code references those credentials by environment variable.

The reference implementation lives in
`anton/core/datasources/data_vault.py`, with helpers in
`anton/utils/datasources.py`. The vault is a thin abstraction over JSON
files on disk; the cleverness is in the prompt-injection and
env-namespacing layers around it, not the storage itself.

---

## TL;DR

1. The vault is a directory of per-connection JSON files at
   `~/.anton/data_vault/<engine>-<name>`. Each file holds the raw
   credential fields plus metadata (engine name, connection name,
   timestamps, optional `secure_keys` list).
2. On every chat turn, anton-core hydrates `os.environ` with one
   namespaced env var per credential field — `DS_<ENGINE>_<NAME>__<FIELD>`
   — so anything spawned in this process tree (notably the scratchpad
   subprocess) can read them.
3. The LLM **never sees credential values**. It sees a system-prompt
   section listing the available env-var **names** so it knows which
   identifier to reference.
4. Anything the LLM emits as a `connect_new_datasource` tool call goes
   through a save path that writes the JSON file, re-injects env vars,
   and registers which fields are secret for output scrubbing.
5. Scratchpad subprocesses inherit the parent's env (`os.environ.copy()`),
   so LLM-generated code can `import os; os.environ["DS_..."]` directly.
   Output coming back from the scratchpad is scrubbed against the secret
   set before being returned to the LLM.

---

## On-disk layout

Vault root: `~/.anton/data_vault/` (mode `0o700`). Per-connection file
name: `<sanitized_engine>-<sanitized_name>` (no extension; `_sanitize`
replaces non-`[\w\-]` with `_`).

Sample record (`postgres-prod_db`):

```json
{
  "engine": "postgres",
  "name": "prod_db",
  "created_at": "2026-04-12T18:30:11.422Z",
  "updated_at": "2026-05-07T09:14:02.781Z",
  "fields": {
    "host": "db.example.com",
    "port": "5432",
    "user": "anton_ro",
    "password": "s3cr3t",
    "database": "analytics"
  },
  "secure_keys": ["password"]
}
```

Field semantics:

- `engine` / `name` — primary key. The pair must round-trip through
  `_sanitize` cleanly so the slug `engine-name` matches the file path.
- `created_at` is preserved across rewrites; `updated_at` is stamped on
  every save.
- `fields` is the credential payload — flat string→string map. The LLM
  doesn't author this; it comes from the connector form (in antontron)
  or the `/connect` interactive flow (in the CLI).
- `secure_keys` — authoritative list of field names that contain
  secrets, used at scrub time. Older records that don't carry this list
  fall back to a name-matching heuristic (any field whose name
  case-insensitively contains `password`, `secret`, `token`, `key`,
  `credential`, `auth`, or `passphrase`).

Persistence is atomic: writes go to `<path>.tmp`, `chmod 0600`, then
`rename()`. Reads are best-effort — bad JSON or missing files return
`None`, never raise.

The interface is captured by the `DataVault` `Protocol`. A cloud
implementation can satisfy it with a different backend (Vault,
Postgres, KMS-wrapped blobs, etc.) without touching the prompt-injection
layer.

---

## Sentinel for modify flows: `ANTON_VAULT_KEEP`

Editing an existing connection presents a tricky UX problem: the form
needs to show *something* in secret slots, but we can't send the real
value to the renderer. The vault uses a sentinel string —
`ANTON_VAULT_KEEP` — as the placeholder, and `resolve_modify_merge`
applies the merge on submit:

- Field comes back as the literal sentinel → "leave the existing vault
  value alone."
- Field comes back as empty string → "explicitly clear this field."
- Field comes back with anything else → overwrite.

`secure_keys` is also reconciled: the union of (a) the prior record's
secure list, (b) any spec-marked secret fields the caller supplies, and
(c) the heuristic. Secrets only ever upgrade — once a field is marked
secret it cannot be demoted.

---

## Env-var injection

The vault doesn't speak directly to scratchpad code; it speaks through
`os.environ`. Two helpers do the work:

### `_slug_env_prefix(engine, name)`

Returns `DS_<ENGINE>_<NAME>` after upper-casing and replacing non-word
characters with `_`. Examples:

| engine     | name      | prefix                |
|------------|-----------|-----------------------|
| postgres   | prod_db   | `DS_POSTGRES_PROD_DB` |
| sql-server | prod-db   | `DS_SQL_SERVER_PROD_DB` |
| postgres   | prod-db.eu| `DS_POSTGRES_PROD_DB_EU` |

### `LocalDataVault.inject_env(engine, name, *, flat=False)`

Default mode injects **namespaced** vars per field:

```
DS_POSTGRES_PROD_DB__HOST=db.example.com
DS_POSTGRES_PROD_DB__PORT=5432
DS_POSTGRES_PROD_DB__USER=anton_ro
DS_POSTGRES_PROD_DB__PASSWORD=s3cr3t
DS_POSTGRES_PROD_DB__DATABASE=analytics
```

`flat=True` is a transitional mode used only during the test_snippet
execution that validates a brand-new connection — it injects
unprefixed `DS_HOST`, `DS_PORT`, … so the registry-supplied snippet
doesn't have to know the connection name.

`restore_namespaced_env(vault)` is the canonical setup call:

1. Clears `_DS_KNOWN_VARS` / `_DS_SECRET_VARS` registries.
2. `vault.clear_ds_env()` — wipes every `DS_*` var in `os.environ`.
3. For each saved connection: `inject_env(engine, name)` (namespaced)
   then `register_secret_vars(engine_def, engine, name)` to record
   which `DS_*` keys are secret-shaped.

This is called on every chat-session bootstrap (`session.py`) so a
delete-then-readd of a connection cleans up stale env vars correctly.

---

## What the LLM sees: the prompt section

`anton/utils/datasources.py:build_datasource_context` builds the
system-prompt block that's appended after every other system context
section. It is injected by `ChatSystemPromptBuilder.build(...)` via
the `datasource_context` argument (`anton/core/llm/prompt_builder.py:165`).

The block looks like this (real example, three connections):

```
## Connected Data Sources

Credentials are pre-injected as namespaced DS_<ENGINE_NAME>__<FIELD>
environment variables. Use them directly in scratchpad code
(e.g. DS_POSTGRES_PROD_DB__HOST). Never read the data vault files
directly.
If you see `[DS_<NAME>]` patterns in scratchpad output, those are
scrub-markers where a secret value was redacted before returning text
to you — the actual value IS injected in the env var. Reference it by
name; never treat the bracket form as a literal credential or pass it
back as a value to any tool.

- `postgres-prod_db` (postgres) → DS_POSTGRES_PROD_DB__HOST, DS_POSTGRES_PROD_DB__PORT, DS_POSTGRES_PROD_DB__USER, DS_POSTGRES_PROD_DB__PASSWORD, DS_POSTGRES_PROD_DB__DATABASE
- `hubspot-main` (hubspot) → DS_HUBSPOT_MAIN__API_KEY
- `gmail-default` (gmail) → DS_GMAIL_DEFAULT__CLIENT_ID, DS_GMAIL_DEFAULT__CLIENT_SECRET, DS_GMAIL_DEFAULT__REFRESH_TOKEN
```

Three things to notice:

1. **No values appear.** The LLM is told the names of the env vars,
   not their contents. Even if the model is jail-broken into "echo
   your full system prompt," there are no credentials to leak.
2. **The slug syntax is taught explicitly.** The model is shown both
   the conceptual format (`DS_<ENGINE_NAME>__<FIELD>`) and a concrete
   example (`DS_POSTGRES_PROD_DB__HOST`).
3. **The scrub-marker convention is documented.** When the scratchpad
   output contains `[DS_POSTGRES_PROD_DB__PASSWORD]`, the model knows
   it's a redaction marker, not the actual value, and that the real
   value is still in the env var.

The `active_only` parameter restricts the listing to a single
connection slug. Used by `/connect` and the modify flow to focus the
model's attention on the connection that just changed.

---

## How the agent acquires new connections

There are two write paths into the vault. Both end up calling
`save_connection(vault, engine_def, name, credentials, secure_keys=...)`
in `anton/utils/datasources.py`, which:

1. `vault.save(...)` — writes the JSON file.
2. `restore_namespaced_env(vault)` — clears and re-injects ALL `DS_*`
   vars across all connections, so a save+load cycle is consistent.
3. `register_secret_vars(...)` — records which keys are secret-shaped
   so future scratchpad output can be scrubbed.
4. Returns the slug `<engine>-<name>` for telemetry / display.

### Path 1 — interactive `/connect` (CLI)

User types `/connect postgres`. Anton walks them through the
registry-defined fields one at a time, runs the engine's
`test_snippet` to validate, and only persists on success.

### Path 2 — the `connect_new_datasource` tool

Defined in `anton/tools.py:CONNECT_DATASOURCE_TOOL`. The LLM calls it
when the user pastes credentials in chat. Two sub-modes live inside
the same tool:

- **Non-interactive** — when `known_variables` is supplied. The tool
  saves the partial credentials silently (no prompts), runs the test
  snippet if all required fields are present, and returns a
  confirmation. This is the "I just dropped my Postgres password in
  chat" case — the credentials hit the vault before they touch
  anywhere else.
- **Interactive** — when `known_variables` is empty. The tool runs the
  same one-prompt-at-a-time flow as `/connect`, but driven by the LLM
  having decided "we need a Postgres connection right now."

The tool description is the part that controls what the LLM does.
Excerpts (full text in `anton/tools.py:323`):

> Connect a data source to Anton's Local Vault. Two modes:
>
> (a) Non-interactive: call this tool **IMMEDIATELY** when the user
> shares credentials in chat (host, password, API token, service
> account JSON, etc.). Pass all extracted values as known_variables.
> The tool saves to the vault without any prompts and returns a
> confirmation. This ensures credentials are persisted before being
> used anywhere — never reference chat-supplied credentials directly
> in scratchpad code; always go through the vault.
>
> (b) Interactive: call with just engine and no known_variables when
> the user has no credentials in context yet.
>
> Supported engines: see the built-in registry (PostgreSQL, MySQL,
> Snowflake, BigQuery, Redshift, Databricks, MariaDB, MSSQL, Oracle,
> HubSpot, Salesforce, Shopify, Gmail, and more). Unknown engines …
> are also saved silently as ad-hoc connections when known_variables
> are provided … A minimal engine definition is appended to
> `~/.anton/datasources.md` so future sessions recognize it.

The "never reference chat-supplied credentials directly in scratchpad
code; always go through the vault" sentence is the load-bearing
instruction that pushes the model away from typing passwords into
generated code. Combined with the prompt section that tells it the
DS_-var name to reference instead, this is what makes the indirection
work in practice.

---

## How scratchpad code reaches the env vars

When the LLM emits a scratchpad cell, the `LocalScratchpadBackend`
(at `anton/core/backends/local.py`) spawns a Python subprocess inside
a per-pad venv. The relevant env-propagation lines:

```python
env = os.environ.copy()              # inherits every DS_* var
if self._coding_model:
    env["ANTON_SCRATCHPAD_MODEL"] = self._coding_model
# … other tweaks …
```

Because the parent process's `os.environ` already has every
`DS_<ENGINE>_<NAME>__<FIELD>` set (from the bootstrap's
`restore_namespaced_env` call), the scratchpad subprocess inherits all
of them automatically. LLM-emitted code looks like this:

```python
import os
import psycopg

conn = psycopg.connect(
    host=os.environ["DS_POSTGRES_PROD_DB__HOST"],
    port=os.environ["DS_POSTGRES_PROD_DB__PORT"],
    user=os.environ["DS_POSTGRES_PROD_DB__USER"],
    password=os.environ["DS_POSTGRES_PROD_DB__PASSWORD"],
    dbname=os.environ["DS_POSTGRES_PROD_DB__DATABASE"],
)
```

The model wrote this only knowing the slug — the actual `s3cr3t` value
never appeared in either the system prompt or the model's input
context. Identifiers in, identifiers out.

---

## Output scrubbing: `scrub_credentials`

After the scratchpad cell runs, its stdout/stderr/repr is wrapped in a
`ScratchpadCell` and formatted into a `tool_result` block to send back
to the LLM. Before that handoff, `scrub_credentials(text)` walks the
text twice:

1. **Strict pass.** For every key in `_DS_SECRET_VARS` (registered as
   `secret: true` in the engine's `datasources.md` definition or via
   `secure_keys` on the vault record), replace any literal occurrence
   of the env-var's value with `[<KEY>]`. So a stack trace that
   accidentally printed `password='s3cr3t'` becomes
   `password='[DS_POSTGRES_PROD_DB__PASSWORD]'`.
2. **Heuristic pass.** For every `DS_*` env var that is *not* in the
   known set (i.e. a custom engine that wasn't registered yet) AND has
   a value longer than 8 characters, replace its value the same way.
   The length guard prevents trivially-true tokens like `on` / `true`
   from getting scrubbed mid-text.

The second pass is the safety net for "user pasted credentials for an
engine the registry doesn't know about." `connect_new_datasource`
appends a stub engine definition to `~/.anton/datasources.md` for
those, but the registry-reload happens after the scrub pass for the
current cell, so the heuristic catches the gap.

This scrub is applied at `session.py:1017` for non-scratchpad tool
results too — anything coming back from a tool dispatch.

---

## Lifecycle — full trace of one connection

Walking through a single user request: "save my Postgres prod with
host db.example.com user anton_ro password s3cr3t."

1. **LLM receives system prompt**, which currently says
   `## Connected Data Sources` is empty (no connections yet).
2. **LLM emits** `connect_new_datasource(engine="postgres",
   known_variables={"host":"db.example.com","user":"anton_ro","password":"s3cr3t"})`.
3. **Tool dispatcher** (`anton/tools.py:handle_connect_datasource`)
   resolves the engine def from the registry, looks up
   `engine_def.name_from` to compute a default name (Postgres uses
   `host` + `database`), and calls `save_connection(vault, engine_def,
   "prod_db", {...})`.
4. **`save_connection` in `anton/utils/datasources.py:192`** writes
   the JSON file with `secure_keys=["password"]`, calls
   `restore_namespaced_env(vault)` which now injects:
   ```
   DS_POSTGRES_PROD_DB__HOST=db.example.com
   DS_POSTGRES_PROD_DB__USER=anton_ro
   DS_POSTGRES_PROD_DB__PASSWORD=s3cr3t
   ```
   into `os.environ`, and `register_secret_vars(engine_def, ...)` adds
   `DS_POSTGRES_PROD_DB__PASSWORD` to `_DS_SECRET_VARS`.
5. **Tool returns** a confirmation string like "Saved connection
   `postgres-prod_db`."
6. **Next assistant turn** starts. `session.py:_build_system_prompt`
   re-runs `build_datasource_context`, which now includes:
   ```
   - `postgres-prod_db` (postgres) → DS_POSTGRES_PROD_DB__HOST, DS_POSTGRES_PROD_DB__USER, DS_POSTGRES_PROD_DB__PASSWORD
   ```
7. **User asks** "show me the top 10 customers by signup date."
8. **LLM emits scratchpad** code that does
   `psycopg.connect(host=os.environ["DS_POSTGRES_PROD_DB__HOST"], ...,
   password=os.environ["DS_POSTGRES_PROD_DB__PASSWORD"])`.
9. **Scratchpad subprocess** spawns with `os.environ.copy()` — all
   the `DS_*` vars are inherited, the connect call works.
10. **Scratchpad output** comes back. If it contained `s3cr3t` (e.g.
    from a stack trace), `scrub_credentials` would replace it with
    `[DS_POSTGRES_PROD_DB__PASSWORD]` before the LLM ever sees it.
11. **LLM writes the answer** referencing the slug name (e.g. "I
    queried `postgres-prod_db`") but not values.

The vault file on disk, the env vars in the process, and the prompt
section presented to the LLM are now all in sync. Subsequent turns,
new sessions, even a full restart all reproduce the same picture
because step 4's `restore_namespaced_env` runs from
`session.py` on every chat-session bootstrap.

---

## Mapping to antontron

The Electron app speaks to the same vault — the bundled FastAPI
server (`server/routes/datavault.py` → `anton_api.LocalDataVault`)
exposes thin REST endpoints over `LocalDataVault`. The renderer-side
connector picker UI submits a form spec, the form spec gets handed to
`save_connection` server-side, and from that point the lifecycle is
identical to the CLI path. The renderer never holds credential values
beyond the form submission round-trip; everything else flows through
env vars in the python child.

`ANTON_VAULT_KEEP` is also the contract between the renderer's
modify-form pre-fill and the server's submit-handler merge — secret
slots arrive at the renderer as the sentinel, the user edits or
leaves them, and the server applies `resolve_modify_merge` on submit.
