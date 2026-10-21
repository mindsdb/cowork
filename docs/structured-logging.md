# Client and web diagnostics

Browser diagnostics default to WARNING and emit stable JSON events through the
native console. Arbitrary caller values, tokens, HTTP payloads and error messages
are omitted; safe error types, stack coordinates and explicit metadata remain.
For a temporary investigation run `localStorage.setItem('diagnostic_log_level',
'DEBUG')` in that browser and reload. Reset with
`localStorage.removeItem('diagnostic_log_level')` and reload. Blocked browser
storage falls back to WARNING. This does not enable application debug responses.

The nginx image defaults to `LOG_LEVEL=WARNING`, `ACCESS_LOG_MODE=errors`.
Dev/PR retains failures only; staging/production charts use `all` to retain
ordinary successes. Successful exact GET/HEAD `/healthz` probes are always quiet;
failed probes remain observable. Access records contain method, status, generated
request ID and duration without URL, query, address or headers.

Open-source nginx does not provide a JSON error formatter. The launcher classifies
its native stderr into static reasons (upstream connection/timeout, configuration,
permission, file and worker failures), excluding the original text. Native error
records have no request ID; correlated access records retain request IDs/status.
The template lives outside nginx's automatic template directory so the stock
entrypoint cannot render a duplicate log format. The launcher preserves failure exit codes, forwards termination, and drains its
error reader. `python3 scripts/test-nginx-logging.py` exercises actual nginx; it
requires nginx and envsubst on PATH. Restore WARNING and the environment access
mode after a temporary INFO/DEBUG or `all` override.

Electron uses the same adapter with the process `LOG_LEVEL` override. Server
stdout/stderr lines are forwarded without adding a text prefix, preserving JSON.
Existing UI debug tails remain available. Safe updater version/channel decisions
remain available at INFO, while normal successful startup is quiet. Backend logs
require an installed server release with its own privacy implementation; older
servers still produce their original output. The combined web image requires the
paired server logging config at build time and fails the build if it is absent.
Publish that package first or build the paired source refs for review.

Diagnostics use `logged_at`, `logger`, `log_level`, and `message`. Explicit events,
reasons, source locations and correlation fields identify failures. Exception
values, source lines, locals, arbitrary extras, HTTP queries and provider bodies
are excluded. Use the structured fields when querying logs; the previous text
prefixes are no longer a parsing contract.

Enable extra detail only for an owned troubleshooting session, repeat the failing
operation, and restore the default afterward. Logging controls do not enable
framework debug responses. Roll back a release by restoring its previous image
or package version and its previous logging settings together. Before promotion,
verify collector parsing, saved searches, alerts and retained operational streams
against the emitted records. A passing unit suite does not establish deployment
or collector compatibility.
