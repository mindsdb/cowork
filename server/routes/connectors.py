"""Connector registry endpoints.

  GET  /v1/connectors                → list summaries (id, label, description, category, logo)
  GET  /v1/connectors/{id}           → full spec (the literal-retrieval path; no LLM)
  POST /v1/connectors/match          → natural-language → ranked candidates
  POST /v1/connectors/{id}/save      → save a connection using the connector's own
                                       JSON-declared field schema (bypasses Anton-core's
                                       built-in datasource registry — needed for OAuth
                                       and any other auth shapes that don't fit the
                                       legacy email/password engines)

The match endpoint runs a three-stage cascade so most calls finish
without an LLM:

  Stage 1  exact match (id or alias, normalized)         → 1 candidate
  Stage 2  token-overlap scoring                         → 1 confident, else multi
  Stage 3  LLM tiebreak (Haiku, optional, future)        → not yet wired

Stages 1-2 cover the common cases — clicks from the UI, canonical
names from the chat agent — without paying any model cost.
"""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import re
import secrets
import time
import uuid
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

from anton_api import connectors_registry as registry

logger = logging.getLogger("connectors")

router = APIRouter(prefix="/v1/connectors", tags=["connectors"])


class MatchRequest(BaseModel):
    query: str
    max_candidates: int = Field(default=3, ge=1, le=5)


@router.get("")
def list_connectors() -> dict:
    return {"connectors": registry.list_summaries()}


@router.get("/{connector_id}")
def get_connector(connector_id: str) -> dict:
    c = registry.get_connector(connector_id)
    if not c:
        raise HTTPException(status_code=404, detail="Connector not found")
    return c


# ─── Matching helpers ──────────────────────────────────────────────


def _normalize(s: str) -> str:
    """Lowercase + collapse non-alphanumerics to single spaces."""
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()


def _exact_match(query: str) -> str | None:
    nq = _normalize(query)
    if not nq:
        return None
    for c in registry.all_connectors().values():
        if _normalize(c.get("id", "")) == nq:
            return c["id"]
        for alias in c.get("aliases", []):
            if _normalize(alias) == nq:
                return c["id"]
    return None


def _token_score(query: str, c: dict) -> float:
    """Weighted token-overlap. Label > aliases > keywords > description."""
    q_tokens = set(_normalize(query).split())
    if not q_tokens:
        return 0.0

    label_tokens = set(_normalize(c.get("label", "")).split())
    alias_tokens: set[str] = set()
    for alias in c.get("aliases", []):
        alias_tokens.update(_normalize(alias).split())
    keyword_tokens = set(_normalize(" ".join(c.get("keywords", []))).split())
    desc_tokens = set(_normalize(c.get("description", "")).split())

    score = 0.0
    score += 3.0 * len(q_tokens & label_tokens)
    score += 2.5 * len(q_tokens & alias_tokens)
    score += 1.0 * len(q_tokens & keyword_tokens)
    score += 0.4 * len(q_tokens & desc_tokens)
    return score


@router.post("/match")
def match_connector(req: MatchRequest) -> dict:
    # Stage 1 — exact (id or alias, normalized).
    exact_id = _exact_match(req.query)
    if exact_id:
        return {
            "candidates": [{"id": exact_id, "confidence": 1.0}],
            "needs_clarification": False,
            "stage": "exact",
        }

    # Stage 2 — token-overlap scoring across the registry.
    scored: list[tuple[float, str]] = []
    for c in registry.all_connectors().values():
        s = _token_score(req.query, c)
        if s > 0:
            scored.append((s, c["id"]))
    scored.sort(reverse=True)

    if not scored:
        return {
            "candidates": [],
            "needs_clarification": True,
            "question": "I don't recognize that one — try the search box?",
            "stage": "no-match",
        }

    top_score = scored[0][0]
    runner_up = scored[1][0] if len(scored) > 1 else 0.0

    # Top is dominant — single confident pick. (top ≥ 2× runner-up
    # is the rule of thumb; tunable as the registry grows.)
    if runner_up == 0.0 or top_score >= runner_up * 2:
        return {
            "candidates": [{"id": scored[0][1], "confidence": 0.85}],
            "needs_clarification": False,
            "stage": "scored-single",
        }

    # Otherwise return up to N candidates with normalized confidence.
    n = min(req.max_candidates, len(scored))
    max_s = top_score
    return {
        "candidates": [
            {"id": cid, "confidence": round(s / max_s, 3)} for s, cid in scored[:n]
        ],
        "needs_clarification": True,
        "question": "Which one did you mean?",
        "stage": "scored-multi",
    }


# ─── Save endpoint ─────────────────────────────────────────────────


class SaveConnectorRequest(BaseModel):
    """Save a connection using the connector's own JSON-declared
    field schema. Validates required fields against the *picked
    method's* fields (or the spec's top-level `fields` for
    single-method specs), then writes the credentials map directly
    to the local data vault under engine = connector_id.

    This bypasses Anton-core's built-in datasource registry, which
    is what makes OAuth-shaped saves work without the legacy
    Gmail/Slack/etc. engines complaining about unfamiliar fields
    (refresh_token, client_id, etc.).
    """
    method: str | None = None
    name: str = ""
    values: dict[str, Any] = Field(default_factory=dict)


def _resolve_fields(spec: dict, method_id: str | None) -> tuple[list[dict], dict | None]:
    """Pull the field schema for the active method (or top-level
    fields for single-method specs). Returns (fields, method_def)."""
    form = spec.get("form") or {}
    methods = form.get("methods") or []
    if methods:
        if not method_id:
            return [], None
        method_def = next((m for m in methods if m.get("id") == method_id), None)
        if not method_def:
            return [], None
        return list(method_def.get("fields") or []), method_def
    return list(form.get("fields") or []), None


def _missing_required(fields: list[dict], values: dict[str, Any]) -> list[str]:
    out: list[str] = []
    for f in fields:
        if not f.get("required"):
            continue
        v = values.get(f.get("name"))
        if v is None or (isinstance(v, str) and not v.strip()):
            out.append(f.get("name"))
    return out


@router.post("/{connector_id}/save")
def save_connector(connector_id: str, req: SaveConnectorRequest) -> dict:
    spec = registry.get_connector(connector_id)
    if not spec:
        raise HTTPException(status_code=404, detail=f"Unknown connector: {connector_id}")

    form = spec.get("form") or {}
    methods = form.get("methods") or []
    if methods and not req.method:
        raise HTTPException(
            status_code=400,
            detail="`method` is required for connectors that declare multiple auth methods.",
        )

    fields, method_def = _resolve_fields(spec, req.method)
    if methods and method_def is None:
        raise HTTPException(status_code=400, detail=f"Unknown method: {req.method}")

    missing = _missing_required(fields, req.values)
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"Missing required fields: {', '.join(missing)}",
        )

    name = _persist_connection(
        connector_id,
        method=req.method,
        name=req.name,
        values=req.values,
        fields=fields,
    )
    return {
        "status": "ok",
        "engine": connector_id,
        "name": name,
        "method": req.method,
        "label": spec.get("label") or connector_id,
    }


def _persist_connection(
    connector_id: str,
    *,
    method: str | None,
    name: str,
    values: dict[str, Any],
    fields: list[dict] | None,
) -> str:
    """Write a credentials blob to the local data vault under
    engine = connector_id. Shared by the form-save route AND the web
    OAuth callback (so both go through the same modify-merge +
    secure-key resolution). Returns the resolved connection name.

    We bypass `anton.utils.datasources.save_connection` (which expects
    an engine_def from Anton-core's built-in registry) and write
    straight through `LocalDataVault.save`, treating the connector id
    as the engine name and the values map as the credentials blob.
    That's what lets OAuth + service-account + any other auth shape
    we declare in JSON land in the vault unchanged.
    """
    try:
        from anton.core.datasources.data_vault import LocalDataVault
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Anton data vault is unavailable") from exc

    resolved_name = (name or "").strip() or uuid.uuid4().hex[:8]

    # Strip empty-string values so the vault doesn't store noise.
    # Skip `None` too. Booleans / non-string values pass through.
    payload: dict[str, Any] = {}
    for k, v in (values or {}).items():
        if v is None:
            continue
        if isinstance(v, str) and not v.strip():
            continue
        payload[k] = v

    # Stamp method + connector metadata so anton's downstream tools
    # can identify which connector + which auth path produced this
    # record, without having to re-read the registry.
    if method:
        payload["_method"] = method
    payload["_connector_id"] = connector_id

    # Modify-flow merge: resolves `ANTON_VAULT_KEEP` sentinels in the
    # incoming payload against the existing vault record (no-op on
    # create paths where no prior record exists), and computes the
    # secure-key set to persist. Spec-marked secrets come from the
    # connector JSON's `secret: true` field flag. Both the merge
    # helper and the `secure_keys` save kwarg ship in newer anton-
    # core; defensive try/except around each so a stale install
    # falls through to a plain save instead of crashing.
    try:
        from anton.core.datasources.data_vault import resolve_modify_merge as _merge
    except ImportError:
        _merge = None
    spec_secret_names = [
        f.get("name") for f in (fields or [])
        if f.get("secret") and f.get("name")
    ]

    vault = LocalDataVault()
    try:
        if _merge is not None:
            merged_payload, secure_keys = _merge(
                vault, connector_id, resolved_name, payload,
                spec_secret_keys=spec_secret_names,
            )
        else:
            merged_payload, secure_keys = payload, None
        # Guard against the empty-fields failure mode that produced
        # vault rows like `{ fields: {}, secure_keys: [access_token] }`
        # — Anton then thought the connection was present but had no
        # DS_* vars to inject. Strip the meta-only keys before this
        # check so a payload that's literally only `_method` /
        # `_connector_id` (which the renderer can send if all real
        # fields were sentinels/blank) still trips the guard.
        meaningful = {k: v for k, v in (merged_payload or {}).items()
                      if not (isinstance(k, str) and k.startswith("_"))}
        if not meaningful:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Refusing to save empty credential record for connector "
                    f"{connector_id!r}. Fill in the required fields for the "
                    f"selected method and try again."
                ),
            )
        try:
            vault.save(connector_id, resolved_name, merged_payload, secure_keys=secure_keys)
        except TypeError:
            vault.save(connector_id, resolved_name, merged_payload)
    except AttributeError as exc:
        raise HTTPException(
            status_code=500,
            detail=(
                "LocalDataVault.save not available — Anton-core may need an update "
                f"that exposes a generic save path. ({exc})"
            ),
        ) from exc
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not save connection: {exc}") from exc

    return resolved_name


# ─── Web redirect-based OAuth ─────────────────────────────────────────────
#
# The Electron desktop app authenticates connectors through an in-process
# loopback PKCE flow (src/main/oauth-service.ts). The web SPA has no main
# process, so it can't open a loopback server — it needs a server-side
# redirect flow instead. These three endpoints provide it:
#
#   POST /v1/connectors/{id}/oauth/start    → mint PKCE + state, return authUrl
#   GET  /v1/connectors/oauth/callback      → provider redirects here; we
#                                             exchange code→tokens + persist
#   GET  /v1/connectors/oauth/status        → SPA polls this to learn the
#                                             outcome (it can't read the
#                                             callback's response itself)
#
# Pending state lives in-process keyed by `state`. The callback runs in the
# same FastAPI process the SPA talks to, so a dict is sufficient; entries
# expire after _OAUTH_TTL_SECONDS. A server restart mid-flow loses the
# pending entry — acceptable, the user just retries.
#
# DEPLOYMENT NOTE: the redirect URI below (`<origin>/v1/connectors/oauth/
# callback`) must be registered as an authorized redirect URI on the OAuth
# client used by the connector (Google Cloud console etc.). For Anton's
# hosted client that's an Anton-side registration; for BYOK the user adds
# it to their own client. Override the origin with
# ANTON_CONNECTOR_OAUTH_REDIRECT_BASE when the server is reachable at a
# public URL different from the bind host.

_PENDING_OAUTH: dict[str, dict[str, Any]] = {}
_OAUTH_TTL_SECONDS = 600  # 10 min — generous; users may fumble the consent screen


def _prune_pending_oauth() -> None:
    now = time.time()
    stale = [k for k, v in _PENDING_OAUTH.items() if now - float(v.get("_ts", 0)) > _OAUTH_TTL_SECONDS]
    for k in stale:
        _PENDING_OAUTH.pop(k, None)


def _connector_oauth_redirect_uri(request: Request | None = None) -> str:
    """Redirect URI the provider sends the browser back to. Must EXACTLY
    match a redirect URI registered on the connector's OAuth client.

    Resolution order (first wins):
      1. Explicit env override — for deployments behind a reverse proxy
         / custom domain / TLS terminator where neither autodetect nor
         the bind address is the public origin.
      2. Autodetect from the incoming request's base URL. This is the
         origin the SPA actually reached us on, so it's browser-
         reachable by construction — works for the desktop loopback
         (127.0.0.1:26866) and the dev-web Vite proxy alike, without
         any hardcoded port.
      3. Bind host:port fallback (only when no request is available,
         e.g. a unit test calling this directly).
    """
    configured = os.environ.get("ANTON_CONNECTOR_OAUTH_REDIRECT_BASE", "").strip()
    if not configured:
        configured = os.environ.get("ANTON_GOOGLE_OAUTH_REDIRECT_BASE", "").strip()
    if configured:
        base = configured.rstrip("/")
    elif request is not None:
        # `request.base_url` is scheme://host[:port]/ as this server saw
        # the request — i.e. the address the browser/SPA used to reach
        # the API. That's precisely the origin the OAuth redirect must
        # land on, so no port guessing.
        base = str(request.base_url).rstrip("/")
    else:
        host = os.environ.get("ANTON_SERVER_HOST", "127.0.0.1").strip() or "127.0.0.1"
        if host in {"0.0.0.0", "::", "[::]"}:
            host = "127.0.0.1"
        port = int(os.environ.get("ANTON_SERVER_PORT", "26866"))
        base = f"http://{host}:{port}"
    return f"{base}/v1/connectors/oauth/callback"


def _pkce_pair() -> tuple[str, str]:
    """Return (verifier, challenge) — RFC 7636 S256."""
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode("ascii")
    challenge = base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode("ascii")).digest()
    ).rstrip(b"=").decode("ascii")
    return verifier, challenge


def _oauth_method_meta(spec: dict, method_id: str | None) -> dict:
    """Pull the `oauth` metadata block off the active method (or the
    spec's top-level `oauth` for single-method connectors)."""
    form = spec.get("form") or {}
    methods = form.get("methods") or []
    if methods:
        m = next((x for x in methods if x.get("id") == method_id), None)
        if m and isinstance(m.get("oauth"), dict):
            return m["oauth"]
        return {}
    return form.get("oauth") if isinstance(form.get("oauth"), dict) else {}


class ConnectorOAuthStartRequest(BaseModel):
    method: str | None = None
    name: str = ""
    # BYOK credentials. When the connector ships a hosted client_id in
    # its spec these can be omitted; the request value takes priority
    # when present (so a user can override with their own client).
    client_id: str = ""
    client_secret: str = ""


def _connector_oauth_callback_page(title: str, message: str, *, success: bool) -> HTMLResponse:
    accent = "#1F9CB0" if success else "#b42318"
    return HTMLResponse(content=f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>{title}</title>
<style>
  :root {{ color-scheme: light dark; }}
  html, body {{ margin: 0; height: 100%; }}
  body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    display: grid; place-items: center; padding: 40px; background: #FAFAFA; color: #0E0F10; }}
  @media (prefers-color-scheme: dark) {{ body {{ background: #080d18; color: #E8EDF7; }} p {{ color: #8A97AE; }} }}
  .card {{ max-width: 440px; text-align: center; }}
  h1 {{ font-size: 22px; font-weight: 600; margin: 0 0 10px; }}
  p {{ font-size: 14px; line-height: 1.55; margin: 0; color: #6B6F73; }}
  .dot {{ display: inline-block; width: 8px; height: 8px; border-radius: 50%;
    background: {accent}; margin-right: 8px; vertical-align: middle; }}
</style></head>
<body><div class="card">
  <h1><span class="dot"></span>{title}</h1>
  <p>{message}</p>
</div></body></html>""")


@router.post("/{connector_id}/oauth/start")
def connector_oauth_start(connector_id: str, req: ConnectorOAuthStartRequest, request: Request) -> dict:
    """Begin a web OAuth flow for a connector. Returns the provider auth
    URL the SPA should open + the `state` it polls the status endpoint
    with. The SPA never sees the code or tokens — the callback persists
    them server-side."""
    _prune_pending_oauth()
    spec = registry.get_connector(connector_id)
    if not spec:
        raise HTTPException(status_code=404, detail=f"Unknown connector: {connector_id}")

    oauth_meta = _oauth_method_meta(spec, req.method)
    auth_url = str(oauth_meta.get("auth_url") or "").strip()
    token_url = str(oauth_meta.get("token_url") or "").strip()
    scopes = oauth_meta.get("scopes") or []
    extra = oauth_meta.get("extra_auth_params") or {}
    if not auth_url or not token_url or not isinstance(scopes, list) or not scopes:
        raise HTTPException(
            status_code=400,
            detail="Connector spec is missing OAuth metadata (auth_url / token_url / scopes).",
        )

    # client_id: request (BYOK) wins, else the connector's hosted id.
    client_id = req.client_id.strip() or str(oauth_meta.get("client_id") or "").strip()
    client_secret = req.client_secret.strip() or str(oauth_meta.get("client_secret") or "").strip()
    if not client_id:
        raise HTTPException(status_code=400, detail="Missing OAuth client ID for this connector.")

    verifier, challenge = _pkce_pair()
    state = secrets.token_urlsafe(24)
    redirect_uri = _connector_oauth_redirect_uri(request)

    _PENDING_OAUTH[state] = {
        "_ts": time.time(),
        "connector_id": connector_id,
        "method": req.method,
        "name": req.name,
        "client_id": client_id,
        "client_secret": client_secret,
        "token_url": token_url,
        "redirect_uri": redirect_uri,
        "verifier": verifier,
        "scopes": list(scopes),
        "status": "pending",
        "error": "",
        "result_name": "",
        "label": spec.get("label") or connector_id,
    }

    params = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "scope": " ".join(str(s) for s in scopes),
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    }
    if isinstance(extra, dict):
        params.update({str(k): str(v) for k, v in extra.items()})

    return {
        "status": "ok",
        "authUrl": f"{auth_url}?{urlencode(params)}",
        "state": state,
        "redirectUri": redirect_uri,
    }


@router.get("/oauth/callback")
def connector_oauth_callback(
    code: str = Query(default=""),
    state: str = Query(default=""),
    error: str = Query(default=""),
) -> HTMLResponse:
    """Provider redirects the user's browser here. Exchange the code for
    tokens and persist the connection, then render a page telling the
    user to return to Anton (the SPA learns the result via /oauth/status)."""
    _prune_pending_oauth()
    pending = _PENDING_OAUTH.get(state)

    if not pending:
        return _connector_oauth_callback_page(
            "Sign-in expired",
            "Anton couldn't find a pending connection for this sign-in. Start the connection again.",
            success=False,
        )

    def _fail(msg: str) -> HTMLResponse:
        pending["status"] = "error"
        pending["error"] = msg
        return _connector_oauth_callback_page(
            "Connection failed", msg, success=False,
        )

    if error:
        return _fail(f"The provider returned an error: {error}")
    if not code:
        return _fail("The provider did not return an authorization code.")

    token_body = {
        "grant_type": "authorization_code",
        "code": code,
        "client_id": pending["client_id"],
        "redirect_uri": pending["redirect_uri"],
        "code_verifier": pending["verifier"],
    }
    if pending.get("client_secret"):
        token_body["client_secret"] = pending["client_secret"]

    try:
        request_headers = {
            "Accept": "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
        }
        http_req = Request(
            pending["token_url"],
            data=urlencode(token_body).encode("utf-8"),
            headers=request_headers,
            method="POST",
        )
        with urlopen(http_req, timeout=20) as resp:
            token_data = json.loads(resp.read().decode("utf-8"))
    except HTTPError as exc:
        raw = exc.read().decode("utf-8", "replace")
        return _fail(f"Token exchange failed ({exc.code}): {raw[:300]}")
    except URLError:
        return _fail("Could not reach the provider's token endpoint.")
    except Exception as exc:  # noqa: BLE001
        return _fail(f"Token exchange error: {exc}")

    access_token = str(token_data.get("access_token") or "").strip()
    refresh_token = str(token_data.get("refresh_token") or "").strip()
    if not access_token and not refresh_token:
        return _fail("Token exchange did not return an access or refresh token.")

    oauth_values = {
        "client_id": pending["client_id"],
        **({"client_secret": pending["client_secret"]} if pending.get("client_secret") else {}),
        "refresh_token": refresh_token,
        "access_token": access_token,
        "scope": str(token_data.get("scope") or " ".join(pending.get("scopes") or [])),
        "token_type": str(token_data.get("token_type") or "Bearer"),
    }

    spec = registry.get_connector(pending["connector_id"]) or {}
    fields, _ = _resolve_fields(spec, pending.get("method"))
    try:
        saved_name = _persist_connection(
            pending["connector_id"],
            method=pending.get("method"),
            name=pending.get("name") or "",
            values=oauth_values,
            fields=fields,
        )
    except HTTPException as exc:
        return _fail(str(exc.detail))
    except Exception as exc:  # noqa: BLE001
        logger.exception("connector oauth persist failed")
        return _fail(f"Could not save the connection: {exc}")

    pending["status"] = "success"
    pending["result_name"] = saved_name
    return _connector_oauth_callback_page(
        f"{pending.get('label') or 'Connector'} connected",
        "You can close this tab and return to Anton.",
        success=True,
    )


@router.get("/oauth/status")
def connector_oauth_status(state: str = Query(...)) -> dict:
    """SPA polls this after opening the auth URL. The callback can't
    return data to the SPA directly (it renders in a separate browser
    tab), so the SPA reads the outcome here."""
    _prune_pending_oauth()
    pending = _PENDING_OAUTH.get(state)
    if not pending:
        # Unknown state = either never started, or expired/pruned after
        # success. We can't distinguish, so report 'expired' — the SPA
        # treats a previously-seen 'success' as terminal before this.
        return {"status": "expired"}
    out = {
        "status": pending.get("status", "pending"),
        "error": pending.get("error", ""),
        "name": pending.get("result_name", ""),
        "label": pending.get("label", ""),
    }
    # Once terminal, drop it so the dict doesn't grow unbounded. The SPA
    # has the result in hand after one terminal poll.
    if out["status"] in {"success", "error"}:
        _PENDING_OAUTH.pop(state, None)
    return out
