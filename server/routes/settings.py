"""Settings — reads and writes Anton configuration.

Anton's current SDK reads configuration from ``ANTON_*`` environment names.
The desktop app keeps using friendly frontend field names, but this module is
the translation layer and the single place that handles legacy env fallbacks.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import httpx
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Optional

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .cowork_state import update_state, load_state

router = APIRouter()
logger = logging.getLogger(__name__)

GLOBAL_ENV_PATH = Path.home() / ".anton" / ".env"

CANONICAL_KEY_FALLBACKS = {
    "ANTON_ANTHROPIC_API_KEY": ("ANTHROPIC_API_KEY",),
    "ANTON_OPENAI_API_KEY": ("OPENAI_API_KEY",),
}

PROVIDER_LABELS = {
    "anthropic": "Anthropic",
    "openai": "OpenAI",
    "openai-compatible": "OpenAI-compatible",
}

UI_DEFAULTS = {
    "greeting": "Let's knock something off your list",
    "tone": "balanced",
    "defaultModel": "",
    "autoPin": True,
    "showDots": True,
    "showCounters": True,
    "accentVariant": "aqua",
}

# Multi-provider config. Each provider has its own credentials and lives
# in state.preferences.providers. Env vars in ~/.anton/.env are derived
# from this list on every save so anton-core's existing ANTON_* contract
# is unchanged. One provider per type; exactly one isDefault.
PROVIDER_TYPES = ("minds-cloud", "anthropic", "openai", "gemini", "openai-compatible")

PROVIDER_TYPE_LABELS = {
    "minds-cloud":       "MindsHub",
    "anthropic":         "Anthropic",
    "openai":            "OpenAI",
    "gemini":            "Gemini",
    "openai-compatible": "OpenAI-compatible",
}

# Server-owned so the UI doesn't drift from what each backend actually
# accepts. Empty list = user must supply (openai-compatible).
#
# minds-cloud is MindsHub's `latest:*` alias namespace. The router
# dispatches each alias to the actual upstream provider (Anthropic,
# OpenAI, Google, Fireworks) — the cowork app never needs to know which
# provider serves a given alias. Direct-provider buckets below stay on
# concrete model IDs because they hit the providers' own APIs.
RECOMMENDED_MODELS: dict[str, list[str]] = {
    "minds-cloud": [
        "latest:sonnet", "latest:opus", "latest:haiku",
        "latest:gpt", "latest:gpt-low", "latest:gpt-medium",
        "latest:gpt-high", "latest:gpt-codex",
        "latest:gpt-mini", "latest:gpt-nano",
        "latest:gemini", "latest:gemini-flash",
        "latest:kimi", "latest:deepseek", "latest:qwen",
    ],
    "anthropic":         ["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5-20251001"],
    "openai":            ["gpt-5.4", "gpt-5.4-mini", "o3", "o4-mini"],
    "gemini":            ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-3-flash-preview"],
    "openai-compatible": [],
}

# Default planning + coding model per type. Used when modelMode == 'default'.
RECOMMENDED_PAIR = {
    "minds-cloud":       ("latest:sonnet", "latest:haiku"),
    "anthropic":         ("claude-sonnet-4-6", "claude-haiku-4-5-20251001"),
    "openai":            ("gpt-5.4", "gpt-5.4-mini"),
    "gemini":            ("gemini-2.5-pro", "gemini-2.5-flash"),
    "openai-compatible": ("", ""),
}

GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"
OPENAI_BASE_URL = "https://api.openai.com/v1"
MINDS_API_PATH_SUFFIX = "/api/v1"

OPENAI_FAMILY = ("openai", "gemini", "openai-compatible", "minds-cloud")


def _read_dotenv(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    result = {}
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            result[key.strip()] = val.strip().strip('"').strip("'")
    except Exception:
        pass
    return result


def _write_dotenv(path: Path, data: dict[str, str], delete_keys: tuple[str, ...] = ()) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        path.parent.chmod(0o700)
    except OSError:
        pass
    existing = _read_dotenv(path)
    for key in delete_keys:
        existing.pop(key, None)
    existing.update({k: v for k, v in data.items() if v})  # don't write empty strings
    lines = [f"{k}={v}" for k, v in existing.items()]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    try:
        path.chmod(0o600)
    except OSError:
        pass


def _stage_string_env(
    patch_value: Optional[str],
    env_key: str,
    writes: dict[str, str],
    delete_keys: list[str],
) -> None:
    """Apply an optional text field to dotenv writes, treating empty as delete."""
    if patch_value is None:
        return
    value = patch_value.strip()
    if value:
        writes[env_key] = value
    else:
        delete_keys.append(env_key)


def _get_env(key: str, default: str = "", legacy_keys: tuple[str, ...] | None = None) -> str:
    """Read from env → ~/.anton/.env → legacy env → default."""
    val = os.environ.get(key)
    if val:
        return val
    dotenv = _read_dotenv(GLOBAL_ENV_PATH)
    val = dotenv.get(key)
    if val:
        return val

    for legacy_key in legacy_keys or CANONICAL_KEY_FALLBACKS.get(key, ()):
        val = os.environ.get(legacy_key)
        if val:
            return val
        val = dotenv.get(legacy_key)
        if val:
            return val
    return default


def _bool_env(key: str, default: bool) -> bool:
    return _get_env(key, str(default).lower()).strip().lower() in {"1", "true", "yes", "on"}


def _masked(key: str) -> str:
    return "***" if _get_env(key) else ""


def _migrate_legacy_keys() -> list[str]:
    """Copy legacy API keys into Anton's canonical names without deleting them."""
    dotenv = _read_dotenv(GLOBAL_ENV_PATH)
    writes: dict[str, str] = {}
    for canonical, legacy_keys in CANONICAL_KEY_FALLBACKS.items():
        if os.environ.get(canonical) or dotenv.get(canonical):
            continue
        for legacy_key in legacy_keys:
            legacy_value = os.environ.get(legacy_key) or dotenv.get(legacy_key)
            if legacy_value:
                writes[canonical] = legacy_value
                break

    if writes:
        _write_dotenv(GLOBAL_ENV_PATH, writes)
        os.environ.update(writes)
    return list(writes.keys())


def get_config_status() -> dict[str, Any]:
    """Return safe readiness metadata for health checks and setup gates."""
    migrated = _migrate_legacy_keys()
    provider = _get_env("ANTON_PLANNING_PROVIDER", "anthropic")
    model = _get_env("ANTON_PLANNING_MODEL", "claude-sonnet-4-6")

    anthropic_key = bool(_get_env("ANTON_ANTHROPIC_API_KEY"))
    openai_key = bool(_get_env("ANTON_OPENAI_API_KEY"))
    openai_base_url = bool(_get_env("ANTON_OPENAI_BASE_URL"))
    minds_key = bool(_get_env("ANTON_MINDS_API_KEY"))

    missing: list[str] = []
    if provider == "anthropic" and not anthropic_key:
        missing.append("ANTON_ANTHROPIC_API_KEY")
    elif provider == "openai" and not openai_key:
        missing.append("ANTON_OPENAI_API_KEY")
    elif provider == "openai-compatible":
        if not (openai_key or minds_key):
            missing.append("ANTON_OPENAI_API_KEY or ANTON_MINDS_API_KEY")
        if not (openai_base_url or minds_key):
            missing.append("ANTON_OPENAI_BASE_URL")

    ready = len(missing) == 0
    return {
        "config_ready": ready,
        "config_error": "" if ready else f"Configure {', '.join(missing)} for {PROVIDER_LABELS.get(provider, provider)}.",
        "provider": provider,
        "model": model,
        "provider_label": PROVIDER_LABELS.get(provider, provider),
        "migrated": migrated,
    }


def _ui_settings() -> dict[str, Any]:
    prefs = load_state().get("preferences", {})
    if not isinstance(prefs, dict):
        prefs = {}
    merged = dict(UI_DEFAULTS)
    merged.update({key: value for key, value in prefs.items() if key in UI_DEFAULTS})

    # `defaultModel` is no longer a user-editable preference — the
    # planning role's model (projected onto ANTON_PLANNING_MODEL on
    # every save) is the single source of truth for "what the renderer
    # should send as the active model". Reading state.preferences for
    # this field caused a long-standing bug: a stale `defaultModel`
    # (e.g. `gpt-5.4` from an earlier OpenAI experiment) silently
    # overrode the active env model, the renderer sent it on every
    # chat, and mdb.ai 500'd with "Mind 'gpt-5.4' not found". Now we
    # always derive from env and aggressively clean up legacy values.
    env_planning_model = _get_env("ANTON_PLANNING_MODEL", "claude-sonnet-4-6")
    if "defaultModel" in prefs:
        try:
            def _drop_legacy_default_model(state: dict) -> None:
                p = state.get("preferences")
                if isinstance(p, dict):
                    p.pop("defaultModel", None)
            update_state(_drop_legacy_default_model)
            logger.info(
                "Dropped legacy state.preferences.defaultModel=%r (now derived from env).",
                prefs.get("defaultModel"),
            )
        except Exception as e:
            logger.debug("Could not persist defaultModel cleanup: %s", e)
    merged["defaultModel"] = env_planning_model

    return merged


# ───────────────────────── Providers state model ─────────────────────────
#
# Single source of truth: state.preferences.providers (list, one per type)
# plus state.preferences.modelMode ("default" | "custom") plus
# state.preferences.modelOverrides ({planning|coding: {providerType, model}}).
#
# ~/.anton/.env stays the contract Anton core reads from — every save derives
# ANTON_* values from the providers list so anton-core needs no changes.

def _empty_provider(ptype: str) -> dict[str, Any]:
    base = {"type": ptype, "apiKey": "", "isDefault": False}
    if ptype == "openai-compatible":
        base["baseUrl"] = ""
        base["name"] = ""
    if ptype == "minds-cloud":
        base.update({
            "mindsUrl": "https://api.mindshub.ai",
            "mindsMindName": "",
            "mindsDatasource": "",
            "mindsDatasourceEngine": "",
            "mindsSslVerify": True,
        })
    return base


def _providers_from_env() -> list[dict[str, Any]]:
    """Migration: read the legacy single-provider env state and return a
    providers list (zero or one entries). Called when state.preferences
    has no `providers` key yet."""
    provider = _get_env("ANTON_PLANNING_PROVIDER", "")
    base_url = (_get_env("ANTON_OPENAI_BASE_URL") or "").rstrip("/")
    minds_url = (_get_env("ANTON_MINDS_URL") or "").rstrip("/")
    anthropic_key = _get_env("ANTON_ANTHROPIC_API_KEY")
    openai_key = _get_env("ANTON_OPENAI_API_KEY")
    minds_key = _get_env("ANTON_MINDS_API_KEY")

    result: list[dict[str, Any]] = []

    if anthropic_key:
        e = _empty_provider("anthropic")
        e["apiKey"] = anthropic_key
        result.append(e)

    if minds_key:
        e = _empty_provider("minds-cloud")
        e["apiKey"] = minds_key
        if minds_url:
            e["mindsUrl"] = minds_url
        e["mindsMindName"] = _get_env("ANTON_MINDS_MIND_NAME", "")
        e["mindsDatasource"] = _get_env("ANTON_MINDS_DATASOURCE", "")
        e["mindsDatasourceEngine"] = _get_env("ANTON_MINDS_DATASOURCE_ENGINE", "")
        e["mindsSslVerify"] = _bool_env("ANTON_MINDS_SSL_VERIFY", True)
        result.append(e)

    # OPENAI slot can be driven by openai, gemini, openai-compatible, or
    # by minds-cloud (which derives the slot from the minds key/url).
    # Distinguish based on the saved base URL — but skip if minds-cloud
    # already covered it (same key + url-matches-minds).
    if provider == "openai" and openai_key:
        e = _empty_provider("openai")
        e["apiKey"] = openai_key
        result.append(e)
    elif provider == "openai-compatible" and openai_key:
        if base_url.startswith("https://generativelanguage.googleapis.com/"):
            e = _empty_provider("gemini")
            e["apiKey"] = openai_key
            result.append(e)
        elif minds_url and base_url.startswith(minds_url):
            # Already covered by minds-cloud entry above. Skip.
            pass
        elif base_url and base_url != OPENAI_BASE_URL.rstrip("/"):
            e = _empty_provider("openai-compatible")
            e["apiKey"] = openai_key
            e["baseUrl"] = base_url
            result.append(e)
        elif not any(p["type"] == "openai" for p in result):
            # Bare "openai-compatible" with the OpenAI public URL → treat as openai.
            e = _empty_provider("openai")
            e["apiKey"] = openai_key
            result.append(e)

    # Default = the provider currently driving the planning role.
    planning_anton_provider = provider or ("anthropic" if anthropic_key else "")
    preferred_default = None
    if planning_anton_provider == "anthropic":
        preferred_default = "anthropic"
    elif planning_anton_provider == "openai":
        preferred_default = "openai"
    elif planning_anton_provider == "openai-compatible":
        if base_url.startswith("https://generativelanguage.googleapis.com/"):
            preferred_default = "gemini"
        elif minds_url and base_url.startswith(minds_url):
            preferred_default = "minds-cloud"
        elif base_url:
            preferred_default = "openai-compatible"

    for p in result:
        if p["type"] == preferred_default:
            p["isDefault"] = True
            break
    else:
        if result:
            result[0]["isDefault"] = True

    return result


def _normalize_provider(p: Any) -> Optional[dict[str, Any]]:
    """Coerce a single provider dict to a known-shape entry, dropping
    unknown types and unexpected fields."""
    if not isinstance(p, dict):
        return None
    ptype = p.get("type")
    if ptype not in PROVIDER_TYPES:
        return None
    out = _empty_provider(ptype)
    api_key = p.get("apiKey")
    if isinstance(api_key, str):
        out["apiKey"] = api_key
    out["isDefault"] = bool(p.get("isDefault"))
    if ptype == "openai-compatible":
        if isinstance(p.get("baseUrl"), str):
            out["baseUrl"] = p["baseUrl"].strip()
        if isinstance(p.get("name"), str):
            out["name"] = p["name"].strip()
    if ptype == "minds-cloud":
        for key in ("mindsUrl", "mindsMindName", "mindsDatasource", "mindsDatasourceEngine"):
            v = p.get(key)
            if isinstance(v, str):
                out[key] = v.strip()
        if "mindsSslVerify" in p:
            out["mindsSslVerify"] = bool(p["mindsSslVerify"])
    return out


def _dedupe_by_type(providers: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """One instance per type. Later entries win (so a PATCH overrides)."""
    by_type: dict[str, dict[str, Any]] = {}
    for p in providers:
        by_type[p["type"]] = p
    return list(by_type.values())


def _apply_default_invariant(providers: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Exactly one entry has isDefault=True. If none, first wins. If
    multiple, the first wins."""
    if not providers:
        return providers
    chosen_idx = next((i for i, p in enumerate(providers) if p.get("isDefault")), 0)
    for i, p in enumerate(providers):
        p["isDefault"] = (i == chosen_idx)
    return providers


def _masked_providers(providers: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """GET projection — replace stored apiKey with '***' sentinel."""
    out = []
    for p in providers:
        copy = dict(p)
        copy["apiKey"] = "***" if p.get("apiKey") else ""
        out.append(copy)
    return out


def _merge_providers_patch(
    stored: list[dict[str, Any]],
    incoming: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Merge an incoming providers list with the stored one. An apiKey
    of '***' means 'preserve the existing secret'; a non-sentinel value
    overrides it. Entries not in `incoming` are removed."""
    stored_by_type = {p["type"]: p for p in stored}
    merged: list[dict[str, Any]] = []
    for raw in incoming:
        p = _normalize_provider(raw)
        if p is None:
            continue
        if p["apiKey"] == "***":
            prev = stored_by_type.get(p["type"], {})
            p["apiKey"] = prev.get("apiKey", "")
        merged.append(p)
    return _apply_default_invariant(_dedupe_by_type(merged))


def _load_providers() -> list[dict[str, Any]]:
    """Read providers from state, migrating from env on first read."""
    prefs = load_state().get("preferences", {})
    if not isinstance(prefs, dict):
        prefs = {}
    raw = prefs.get("providers")
    if isinstance(raw, list) and raw:
        normalized = [_normalize_provider(p) for p in raw]
        cleaned = [p for p in normalized if p is not None]
        if cleaned:
            return _apply_default_invariant(_dedupe_by_type(cleaned))
    migrated = _providers_from_env()
    if migrated:
        try:
            update_state(lambda s: s.setdefault("preferences", {}).update({"providers": migrated}))
        except Exception as e:
            logger.debug("Could not persist migrated providers: %s", e)
    return migrated


def _default_provider(providers: list[dict[str, Any]]) -> Optional[dict[str, Any]]:
    """MindsHub is the implicit fallback for any role that hasn't been
    explicitly assigned — it's the only provider users can't delete,
    so it's also the only one we can safely depend on. Falls back to
    the first registered provider if MindsHub is somehow missing."""
    minds = next((p for p in providers if p["type"] == "minds-cloud"), None)
    if minds:
        return minds
    return providers[0] if providers else None


def _provider_by_type(providers: list[dict[str, Any]], ptype: Optional[str]) -> Optional[dict[str, Any]]:
    if not ptype:
        return None
    return next((p for p in providers if p["type"] == ptype), None)


def _role_anton_provider(provider_type: str) -> str:
    """Map a UI provider type to anton-core's planning_provider value
    (anton-core only knows anthropic / openai / openai-compatible)."""
    if provider_type == "anthropic":
        return "anthropic"
    if provider_type == "openai":
        return "openai"
    return "openai-compatible"


def _base_url_for(provider: dict[str, Any]) -> str:
    if provider["type"] == "gemini":
        return GEMINI_BASE_URL
    if provider["type"] == "minds-cloud":
        url = (provider.get("mindsUrl") or "https://api.mindshub.ai").rstrip("/")
        return f"{url}{MINDS_API_PATH_SUFFIX}"
    if provider["type"] == "openai-compatible":
        return provider.get("baseUrl", "") or ""
    if provider["type"] == "openai":
        return OPENAI_BASE_URL
    return ""


def _resolve_role(
    providers: list[dict[str, Any]],
    model_mode: str,
    overrides: dict[str, Any],
    role: str,
    default_provider: Optional[dict[str, Any]],
) -> tuple[Optional[dict[str, Any]], str]:
    """Return (provider_entry, model_id) driving the given role."""
    if model_mode == "custom" and isinstance(overrides, dict):
        o = overrides.get(role) or {}
        ptype = o.get("providerType")
        target = _provider_by_type(providers, ptype)
        model = (o.get("model") or "").strip()
        if target and model:
            return target, model
    # Default mode (or custom with missing override) → default provider's
    # recommended pair.
    if not default_provider:
        return None, ""
    pair = RECOMMENDED_PAIR.get(default_provider["type"], ("", ""))
    return default_provider, pair[0 if role == "planning" else 1]


def _env_from_providers(
    providers: list[dict[str, Any]],
    model_mode: str,
    overrides: dict[str, Any],
) -> tuple[dict[str, str], list[str]]:
    """Compute the env-var writes/deletes that project a providers list
    + role assignments onto Anton's canonical ANTON_* surface."""
    writes: dict[str, str] = {}
    deletes: list[str] = []

    by_type = {p["type"]: p for p in providers}

    # Per-provider credential slots. Each registered provider keeps its
    # auth on disk so users can switch back without re-entering.
    if "anthropic" in by_type and by_type["anthropic"].get("apiKey"):
        writes["ANTON_ANTHROPIC_API_KEY"] = by_type["anthropic"]["apiKey"]
    else:
        deletes.append("ANTON_ANTHROPIC_API_KEY")

    if "minds-cloud" in by_type:
        m = by_type["minds-cloud"]
        if m.get("apiKey"):
            writes["ANTON_MINDS_API_KEY"] = m["apiKey"]
        else:
            deletes.append("ANTON_MINDS_API_KEY")
        writes["ANTON_MINDS_URL"] = (m.get("mindsUrl") or "https://api.mindshub.ai").rstrip("/")
        for key, env in (
            ("mindsMindName", "ANTON_MINDS_MIND_NAME"),
            ("mindsDatasource", "ANTON_MINDS_DATASOURCE"),
            ("mindsDatasourceEngine", "ANTON_MINDS_DATASOURCE_ENGINE"),
        ):
            v = m.get(key)
            if v:
                writes[env] = v
            else:
                deletes.append(env)
        writes["ANTON_MINDS_SSL_VERIFY"] = "true" if m.get("mindsSslVerify", True) else "false"
    else:
        deletes.extend([
            "ANTON_MINDS_API_KEY", "ANTON_MINDS_URL",
            "ANTON_MINDS_MIND_NAME", "ANTON_MINDS_DATASOURCE",
            "ANTON_MINDS_DATASOURCE_ENGINE", "ANTON_MINDS_SSL_VERIFY",
        ])

    default_p = _default_provider(providers)
    planning_p, planning_model = _resolve_role(providers, model_mode, overrides, "planning", default_p)
    coding_p, coding_model     = _resolve_role(providers, model_mode, overrides, "coding",   default_p)

    if planning_p:
        writes["ANTON_PLANNING_PROVIDER"] = _role_anton_provider(planning_p["type"])
        writes["ANTON_PLANNING_MODEL"]    = planning_model
    if coding_p:
        writes["ANTON_CODING_PROVIDER"] = _role_anton_provider(coding_p["type"])
        writes["ANTON_CODING_MODEL"]    = coding_model

    # OPENAI slot — only the role currently using an openai-family provider
    # drives this. Planning wins if both roles use that family but disagree
    # (constraint surfaced to the UI: in custom mode, conflicting openai
    # base URLs across roles aren't supportable).
    openai_driver = None
    for role_p in (planning_p, coding_p):
        if role_p and role_p["type"] in OPENAI_FAMILY:
            openai_driver = role_p
            break
    if openai_driver and openai_driver.get("apiKey"):
        writes["ANTON_OPENAI_API_KEY"]  = openai_driver["apiKey"]
        base = _base_url_for(openai_driver)
        if base:
            writes["ANTON_OPENAI_BASE_URL"] = base
        else:
            deletes.append("ANTON_OPENAI_BASE_URL")
    else:
        deletes.extend(["ANTON_OPENAI_API_KEY", "ANTON_OPENAI_BASE_URL"])

    # Avoid writing+deleting the same key in the same pass.
    write_keys = set(writes)
    deletes = [k for k in deletes if k not in write_keys]
    return writes, deletes


def _load_model_config() -> dict[str, Any]:
    """state.preferences.modelMode + modelOverrides, with defaults."""
    prefs = load_state().get("preferences", {})
    if not isinstance(prefs, dict):
        prefs = {}
    mode = prefs.get("modelMode")
    if mode not in ("default", "custom"):
        mode = "default"
    overrides = prefs.get("modelOverrides") or {}
    if not isinstance(overrides, dict):
        overrides = {}
    return {"modelMode": mode, "modelOverrides": overrides}


def _normalize_overrides(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    out: dict[str, Any] = {}
    for role in ("planning", "coding"):
        v = value.get(role)
        if not isinstance(v, dict):
            continue
        ptype = v.get("providerType")
        model = v.get("model")
        if ptype in PROVIDER_TYPES and isinstance(model, str):
            out[role] = {"providerType": ptype, "model": model.strip()}
    return out


REVEALABLE_KEYS = {
    "anthropic": "ANTON_ANTHROPIC_API_KEY",
    "openai":    "ANTON_OPENAI_API_KEY",
    "minds":     "ANTON_MINDS_API_KEY",
}


@router.get("/reveal-key/{name}")
async def reveal_key(name: str):
    env_key = REVEALABLE_KEYS.get(name.lower())
    if env_key is None:
        raise HTTPException(status_code=404, detail="Unknown key name")
    return {"value": _get_env(env_key)}


@router.get("")
async def get_settings():
    status = get_config_status()
    ui = _ui_settings()
    providers = _load_providers()
    model_cfg = _load_model_config()
    return {
        "planningProvider": _get_env("ANTON_PLANNING_PROVIDER", "anthropic"),
        "planningModel":    _get_env("ANTON_PLANNING_MODEL", "claude-sonnet-4-6"),
        "codingProvider":   _get_env("ANTON_CODING_PROVIDER", "anthropic"),
        "codingModel":      _get_env("ANTON_CODING_MODEL", "claude-haiku-4-5-20251001"),
        "openaiBaseUrl":    _get_env("ANTON_OPENAI_BASE_URL", ""),
        "anthropicApiKey":  _masked("ANTON_ANTHROPIC_API_KEY"),
        "openaiApiKey":     _masked("ANTON_OPENAI_API_KEY"),
        "mindsApiKey":      _masked("ANTON_MINDS_API_KEY"),
        "mindsUrl":         _get_env("ANTON_MINDS_URL", "https://api.mindshub.ai"),
        "mindsMindName":    _get_env("ANTON_MINDS_MIND_NAME", ""),
        "mindsDatasource":  _get_env("ANTON_MINDS_DATASOURCE", ""),
        "mindsDatasourceEngine": _get_env("ANTON_MINDS_DATASOURCE_ENGINE", ""),
        "mindsSslVerify":   _bool_env("ANTON_MINDS_SSL_VERIFY", True),
        "publishUrl":       _get_env("ANTON_PUBLISH_URL", "https://4nton.ai"),
        "memoryEnabled":    _bool_env("ANTON_MEMORY_ENABLED", True),
        "memoryMode":       _get_env("ANTON_MEMORY_MODE", "autopilot"),
        "episodicMemory":   _bool_env("ANTON_EPISODIC_MEMORY", True),
        "proactiveDashboards": _bool_env("ANTON_PROACTIVE_DASHBOARDS", False),
        "configReady": status["config_ready"],
        "configError": status["config_error"],
        "providerLabel": status["provider_label"],
        "greeting":      ui["greeting"],
        "tone":          ui["tone"],
        "defaultModel":  ui["defaultModel"] or status["model"],
        "autoPin":       ui["autoPin"],
        "showDots":      ui["showDots"],
        "showCounters":  ui["showCounters"],
        "accentVariant": ui["accentVariant"],
        "uiUpdateMode":  _get_env("UI_UPDATE_MODE", "manual"),
        # Multi-provider surface (canonical going forward)
        "providers":     _masked_providers(providers),
        "modelMode":     model_cfg["modelMode"],
        "modelOverrides": model_cfg["modelOverrides"],
        "providerTypes":  list(PROVIDER_TYPES),
        "providerTypeLabels": PROVIDER_TYPE_LABELS,
        "recommendedModels": RECOMMENDED_MODELS,
        "recommendedPair":   {k: list(v) for k, v in RECOMMENDED_PAIR.items()},
        "providerStatus": (load_state().get("preferences", {}) or {}).get("providerStatus") or {},
    }


class SettingsPatch(BaseModel):
    greeting:             Optional[str] = None
    tone:                 Optional[str] = None
    defaultModel:         Optional[str] = None
    autoPin:              Optional[bool] = None
    showDots:             Optional[bool] = None
    showCounters:         Optional[bool] = None
    accentVariant:        Optional[str] = None
    planningProvider:     Optional[str] = None
    planningModel:        Optional[str] = None
    codingProvider:       Optional[str] = None
    codingModel:          Optional[str] = None
    openaiBaseUrl:        Optional[str] = None
    anthropicApiKey:      Optional[str] = None
    openaiApiKey:         Optional[str] = None
    mindsApiKey:          Optional[str] = None
    mindsUrl:             Optional[str] = None
    mindsMindName:        Optional[str] = None
    mindsDatasource:      Optional[str] = None
    mindsDatasourceEngine: Optional[str] = None
    mindsSslVerify:       Optional[bool] = None
    publishUrl:           Optional[str] = None
    memoryEnabled:        Optional[bool] = None
    memoryMode:           Optional[str] = None
    episodicMemory:       Optional[bool] = None
    proactiveDashboards:  Optional[bool] = None
    uiUpdateMode:         Optional[str] = None
    # Multi-provider patch surface. When `providers` is provided, the
    # legacy single-provider fields above are ignored and env vars get
    # derived from the list instead.
    providers:            Optional[list[dict[str, Any]]] = None
    modelMode:            Optional[str] = None
    modelOverrides:       Optional[dict[str, Any]] = None
    providerStatus:       Optional[dict[str, str]] = None


@router.put("")
async def update_settings(patch: SettingsPatch):
    writes: dict[str, str] = {}
    delete_keys: list[str] = []
    pref_writes: dict[str, Any] = {}

    if patch.greeting is not None:
        pref_writes["greeting"] = patch.greeting
    if patch.tone is not None:
        pref_writes["tone"] = patch.tone
    # `defaultModel` is derived from ANTON_PLANNING_MODEL on every read
    # (see _ui_settings); ignore inbound writes so a renderer round-
    # trip can't re-seed the legacy preference.
    _ = patch.defaultModel  # accepted but discarded
    if patch.autoPin is not None:
        pref_writes["autoPin"] = patch.autoPin
    if patch.showDots is not None:
        pref_writes["showDots"] = patch.showDots
    if patch.showCounters is not None:
        pref_writes["showCounters"] = patch.showCounters
    if patch.accentVariant is not None:
        pref_writes["accentVariant"] = patch.accentVariant
    if patch.providerStatus is not None:
        # Sanitize — only accept the three known states per type.
        clean = {}
        for k, v in patch.providerStatus.items():
            if isinstance(k, str) and v in ("ok", "fail", "untested"):
                clean[k] = v
        pref_writes["providerStatus"] = clean

    # When the new providers surface is part of the patch, it is the
    # canonical source for all credentials / provider / model env vars.
    # The legacy single-provider fields are ignored on this path so a
    # naive client can't half-write conflicting state.
    using_providers_patch = patch.providers is not None

    if using_providers_patch:
        stored = _load_providers()
        merged = _merge_providers_patch(stored, patch.providers or [])
        # modelMode / modelOverrides defaults — if not in patch, keep the
        # currently stored values so callers can patch them independently.
        existing_cfg = _load_model_config()
        model_mode = patch.modelMode if patch.modelMode in ("default", "custom") else existing_cfg["modelMode"]
        overrides_in = patch.modelOverrides if patch.modelOverrides is not None else existing_cfg["modelOverrides"]
        overrides = _normalize_overrides(overrides_in)

        prov_writes, prov_deletes = _env_from_providers(merged, model_mode, overrides)
        writes.update(prov_writes)
        delete_keys.extend(prov_deletes)

        pref_writes["providers"] = merged
        pref_writes["modelMode"] = model_mode
        pref_writes["modelOverrides"] = overrides
    else:
        _stage_string_env(patch.planningProvider, "ANTON_PLANNING_PROVIDER", writes, delete_keys)
        _stage_string_env(patch.planningModel, "ANTON_PLANNING_MODEL", writes, delete_keys)
        # defaultModel is derived from env on every read; do not mirror
        # planningModel into the legacy preference here.
        _stage_string_env(patch.codingProvider, "ANTON_CODING_PROVIDER", writes, delete_keys)
        _stage_string_env(patch.codingModel, "ANTON_CODING_MODEL", writes, delete_keys)
        _stage_string_env(patch.openaiBaseUrl, "ANTON_OPENAI_BASE_URL", writes, delete_keys)
        _stage_string_env(patch.mindsUrl, "ANTON_MINDS_URL", writes, delete_keys)
        _stage_string_env(patch.mindsMindName, "ANTON_MINDS_MIND_NAME", writes, delete_keys)
        _stage_string_env(patch.mindsDatasource, "ANTON_MINDS_DATASOURCE", writes, delete_keys)
        _stage_string_env(patch.mindsDatasourceEngine, "ANTON_MINDS_DATASOURCE_ENGINE", writes, delete_keys)
        if patch.mindsSslVerify is not None:
            writes["ANTON_MINDS_SSL_VERIFY"] = str(patch.mindsSslVerify).lower()

        # API keys — write if provided and not the masked sentinel
        if patch.anthropicApiKey is not None and patch.anthropicApiKey != "***":
            if patch.anthropicApiKey.strip():
                writes["ANTON_ANTHROPIC_API_KEY"] = patch.anthropicApiKey.strip()
            else:
                delete_keys.append("ANTON_ANTHROPIC_API_KEY")
        if patch.openaiApiKey is not None and patch.openaiApiKey != "***":
            if patch.openaiApiKey.strip():
                writes["ANTON_OPENAI_API_KEY"] = patch.openaiApiKey.strip()
            else:
                delete_keys.append("ANTON_OPENAI_API_KEY")
        if patch.mindsApiKey is not None and patch.mindsApiKey != "***":
            if patch.mindsApiKey.strip():
                writes["ANTON_MINDS_API_KEY"] = patch.mindsApiKey.strip()
            else:
                delete_keys.append("ANTON_MINDS_API_KEY")

    _stage_string_env(patch.memoryMode, "ANTON_MEMORY_MODE", writes, delete_keys)
    _stage_string_env(patch.publishUrl, "ANTON_PUBLISH_URL", writes, delete_keys)
    if patch.memoryEnabled is not None:
        writes["ANTON_MEMORY_ENABLED"] = str(patch.memoryEnabled).lower()
    if patch.episodicMemory is not None:
        writes["ANTON_EPISODIC_MEMORY"] = str(patch.episodicMemory).lower()
    if patch.proactiveDashboards is not None:
        writes["ANTON_PROACTIVE_DASHBOARDS"] = str(patch.proactiveDashboards).lower()
    _stage_string_env(patch.uiUpdateMode, "UI_UPDATE_MODE", writes, delete_keys)

    if writes or delete_keys:
        try:
            _write_dotenv(GLOBAL_ENV_PATH, writes, tuple(delete_keys))
            # Also update current process environment
            for k, v in writes.items():
                os.environ[k] = v
            for key in delete_keys:
                os.environ.pop(key, None)
        except Exception as e:
            logger.warning("Failed to write settings: %s", e)
            raise HTTPException(status_code=500, detail="Settings could not be saved.") from e

    # The providers-patch path already projects state deterministically;
    # legacy-path heuristics below would risk un-doing those writes.
    if using_providers_patch:
        if pref_writes:
            try:
                update_state(lambda state: state.setdefault("preferences", {}).update(pref_writes))
            except Exception as e:
                logger.warning("Failed to write local preferences: %s", e)
                raise HTTPException(status_code=500, detail="Local preferences could not be saved.") from e
        _evict_chat_sessions()
        status = get_config_status()
        return {
            "status": "ok",
            "updated": list(writes.keys()) + [f"deleted:{key}" for key in delete_keys] + [f"ui:{key}" for key in pref_writes],
            "configReady": status["config_ready"],
            "configError": status["config_error"],
        }

    # Post-write hygiene: the save handler intentionally skips "***"
    # sentinel patches to preserve stored keys, which means a cross-
    # provider switch can leave a key from the *previous* provider
    # sitting in ANTON_OPENAI_API_KEY and silently fail auth against
    # the new endpoint. Catch the two unambiguous cases:
    #
    #   1. Active state = Minds Cloud, but ANTON_OPENAI_API_KEY holds a
    #      non-Minds value → router auth will 401 against MindsHub.
    #   2. Active state = OpenAI / non-Minds compatible, but
    #      ANTON_OPENAI_API_KEY holds an `mdb_…` Minds key → will 401
    #      against api.openai.com (or any non-Minds host).
    #
    # In both cases we *delete* the stale key. AntonSettings.model_post_init
    # then derives openai auth from minds_api_key for case 1, and case 2
    # prompts the user to paste the right OpenAI key.
    provider_now = _get_env("ANTON_PLANNING_PROVIDER")
    minds_url_now = (_get_env("ANTON_MINDS_URL") or "").rstrip("/")
    minds_key_now = _get_env("ANTON_MINDS_API_KEY")
    openai_base_now = (_get_env("ANTON_OPENAI_BASE_URL") or "").rstrip("/")
    openai_key_now = _get_env("ANTON_OPENAI_API_KEY")

    is_minds_cloud_now = bool(
        provider_now == "openai-compatible"
        and minds_url_now
        and openai_base_now.startswith(minds_url_now)
    )

    stale_to_clear: list[str] = []
    if is_minds_cloud_now:
        if openai_key_now and openai_key_now != minds_key_now:
            stale_to_clear.append("ANTON_OPENAI_API_KEY")
    elif provider_now in ("openai", "openai-compatible"):
        if openai_key_now.startswith("mdb_"):
            stale_to_clear.append("ANTON_OPENAI_API_KEY")

    if stale_to_clear:
        try:
            _write_dotenv(GLOBAL_ENV_PATH, {}, tuple(stale_to_clear))
            for key in stale_to_clear:
                os.environ.pop(key, None)
            logger.info(
                "Cleared stale credential(s) after preset switch (provider=%s, minds_cloud=%s): %s",
                provider_now, is_minds_cloud_now, stale_to_clear,
            )
        except Exception as e:
            logger.warning("Failed to clear stale credentials: %s", e)

    if pref_writes:
        try:
            update_state(lambda state: state.setdefault("preferences", {}).update(pref_writes))
        except Exception as e:
            logger.warning("Failed to write local preferences: %s", e)
            raise HTTPException(status_code=500, detail="Local preferences could not be saved.") from e

    _evict_chat_sessions()

    status = get_config_status()
    return {
        "status": "ok",
        "updated": list(writes.keys()) + [f"deleted:{key}" for key in delete_keys] + [f"ui:{key}" for key in pref_writes],
        "configReady": status["config_ready"],
        "configError": status["config_error"],
    }


def _evict_chat_sessions() -> None:
    """Drop the in-memory ChatSession pool so the next turn rebuilds
    against the freshly-saved provider/model/env. Best-effort — import
    lazily so this module stays importable from contexts that haven't
    spun up the conversation manager yet."""
    try:
        from server.anton_api import conversation_manager as cm
        cm._live.clear()
    except Exception as e:
        logger.debug("Could not evict chat sessions after settings save: %s", e)


async def _ping_provider(p: dict[str, Any]) -> tuple[str, str]:
    """Lightweight auth check for a single provider. Returns
    (status, detail) where status is 'ok' or 'fail' and detail is a
    short human-readable reason on failure (HTTP code, transport error,
    or 'no apiKey')."""
    ptype = p.get("type")
    key = (p.get("apiKey") or "").strip()
    timeout = httpx.Timeout(12.0)

    async def _check(url: str, headers: dict[str, str]) -> tuple[str, str]:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            r = await client.get(url, headers=headers)
            if r.status_code < 400:
                return "ok", f"HTTP {r.status_code}"
            return "fail", f"HTTP {r.status_code}"

    try:
        if ptype == "anthropic":
            if not key:
                return "fail", "missing API key"
            return await _check(
                "https://api.anthropic.com/v1/models",
                {"x-api-key": key, "anthropic-version": "2023-06-01"},
            )
        if ptype == "openai":
            if not key:
                return "fail", "missing API key"
            return await _check(
                "https://api.openai.com/v1/models",
                {"Authorization": f"Bearer {key}"},
            )
        if ptype == "gemini":
            if not key:
                return "fail", "missing API key"
            return await _check(
                "https://generativelanguage.googleapis.com/v1beta/openai/models",
                {"Authorization": f"Bearer {key}"},
            )
        if ptype == "openai-compatible":
            base = (p.get("baseUrl") or "").rstrip("/")
            if not base:
                return "fail", "missing base URL"
            headers = {"Authorization": f"Bearer {key}"} if key else {}
            return await _check(f"{base}/models", headers)
        if ptype == "minds-cloud":
            if not key:
                return "fail", "missing API key"
            base = (p.get("mindsUrl") or "https://api.mindshub.ai").rstrip("/")
            # MindsHub exposes `/api/v1/minds/` as the auth-checked list
            # endpoint (the OpenAI-compatible `/models` route 401s even
            # for valid keys). This matches the URL used by the Electron
            # main process's validateMinds helper.
            return await _check(
                f"{base}/api/v1/minds/",
                {"Authorization": f"Bearer {key}"},
            )
    except httpx.HTTPError as e:
        return "fail", f"{type(e).__name__}: {e}"
    except Exception as e:
        logger.warning("Provider %s ping crashed: %s", ptype, e)
        return "fail", f"{type(e).__name__}: {e}"
    return "fail", "unknown provider type"


class TestProvidersPatch(BaseModel):
    providers: Optional[list[dict[str, Any]]] = None


@router.post("/test-providers")
async def test_providers(patch: TestProvidersPatch | None = None):
    """Ping each provider and persist a per-type status map so the UI
    can render a green/red dot that survives a reload.

    Accepts an optional `providers` list in the request body so the UI
    can test current un-saved state (e.g. right after the user types a
    key but before clicking Save). '***' apiKey sentinels are merged
    with stored values."""
    stored = _load_providers()
    if patch and patch.providers is not None:
        merged = _merge_providers_patch(stored, patch.providers)
    else:
        merged = stored

    # Ping all providers in parallel so total wait time is roughly the
    # slowest single provider's response, not the sum.
    results = await asyncio.gather(*[_ping_provider(p) for p in merged], return_exceptions=True)
    statuses: dict[str, str] = {}
    details: dict[str, str] = {}
    for p, r in zip(merged, results):
        if isinstance(r, Exception):
            statuses[p["type"]] = "fail"
            details[p["type"]] = f"{type(r).__name__}: {r}"
        else:
            statuses[p["type"]], details[p["type"]] = r

    try:
        def _merge_statuses(state):
            prefs = state.setdefault("preferences", {})
            existing = prefs.get("providerStatus")
            if not isinstance(existing, dict):
                existing = {}
            existing.update(statuses)
            prefs["providerStatus"] = existing
        update_state(_merge_statuses)
    except Exception as e:
        logger.debug("Could not persist providerStatus: %s", e)

    return {"providerStatus": statuses, "providerStatusDetails": details}


@router.post("/validate")
async def validate_settings():
    status = get_config_status()
    return {
        "status": "ok" if status["config_ready"] else "needs_config",
        "configReady": status["config_ready"],
        "configError": status["config_error"],
        "provider": status["provider"],
        "model": status["model"],
    }


# ─── Onboarding-only surface (web SPA parity with Electron) ─────────
# These endpoints back the host abstraction's readSettings/saveSettings/
# checkInstall/checkConfigured/validateProvider methods on the web. The
# Electron renderer goes through window.antontron instead — see
# src/renderer/platform/host.ts. The contract here matches the IPC
# shapes so the same React onboarding pages work in both shells.


@router.get("/raw")
async def read_raw_settings():
    """Return ~/.anton/.env as a flat dict — same shape as the
    Electron `readSettings` IPC. Onboarding uses this to load existing
    values when the user revisits the LLM-provider screen.

    Values are returned in the clear because the user is configuring
    their own backend; there is no cross-tenant exposure on a single-
    user FastAPI instance. If we ever multi-tenant the web host this
    must move to a per-user store."""
    return _read_dotenv(GLOBAL_ENV_PATH)


class RawSettingsBody(BaseModel):
    content: str


@router.post("/raw")
async def write_raw_settings(body: RawSettingsBody):
    """Replace ~/.anton/.env with the supplied dotenv content. Mirrors
    the Electron `saveSettings` IPC. Onboarding builds the lines
    locally (provider, model, keys) and posts the joined string."""
    try:
        GLOBAL_ENV_PATH.parent.mkdir(parents=True, exist_ok=True)
        try:
            GLOBAL_ENV_PATH.parent.chmod(0o700)
        except OSError:
            pass
        GLOBAL_ENV_PATH.write_text(body.content + "\n", encoding="utf-8")
        try:
            GLOBAL_ENV_PATH.chmod(0o600)
        except OSError:
            pass
        # Reflect the writes in the running process so subsequent
        # health checks pick them up without a server restart.
        for line in body.content.splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            os.environ[key.strip()] = val.strip().strip('"').strip("'")
    except Exception as e:
        logger.warning("Failed to write raw settings: %s", e)
        raise HTTPException(status_code=500, detail="Settings could not be saved.") from e
    return {"ok": True}


@router.get("/install-status")
async def install_status():
    """The hosted FastAPI server is its own install — if this endpoint
    answers, anton + python deps are by definition ready. Returned for
    parity with the Electron `checkInstall` IPC so App.tsx's setup gate
    can short-circuit on web."""
    return {"antonInstalled": True, "serverDepsReady": True}


@router.get("/configured")
async def check_configured():
    """Cheap predicate used by App.tsx's onboarding gate. Mirrors the
    Electron `checkConfigured` IPC: a key being present is enough — we
    don't ping the provider here (validate-provider does that)."""
    env = _read_dotenv(GLOBAL_ENV_PATH)
    if env.get("ANTON_ANTHROPIC_API_KEY") or os.environ.get("ANTON_ANTHROPIC_API_KEY"):
        return {"configured": True, "provider": "anthropic"}
    if (env.get("ANTON_OPENAI_API_KEY") or os.environ.get("ANTON_OPENAI_API_KEY")) and (
        env.get("ANTON_OPENAI_BASE_URL") or os.environ.get("ANTON_OPENAI_BASE_URL")
    ):
        return {"configured": True, "provider": "minds"}
    return {"configured": False, "provider": ""}


class ValidateProviderBody(BaseModel):
    provider: str
    apiKey: str
    baseUrl: Optional[str] = None
    model: Optional[str] = None


def _http_json(url: str, method: str, headers: dict[str, str], body: Optional[bytes] = None) -> tuple[int, str]:
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.status, resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", errors="replace") if e.fp else ""
    except urllib.error.URLError as e:
        raise RuntimeError(str(e.reason)) from e


def _validate_anthropic(api_key: str, model: str) -> dict[str, Any]:
    try:
        body = json.dumps({"model": model, "max_tokens": 1, "messages": [{"role": "user", "content": "ping"}]}).encode()
        status, text = _http_json(
            "https://api.anthropic.com/v1/messages",
            "POST",
            {"x-api-key": api_key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
            body,
        )
        if status in (200, 201):
            return {"ok": True}
        try:
            msg = json.loads(text).get("error", {}).get("message") or f"HTTP {status}"
        except Exception:
            msg = f"HTTP {status}"
        return {"ok": False, "error": msg}
    except Exception:
        logger.warning("Anthropic provider validation failed", exc_info=True)
        return {"ok": False, "error": "Cannot connect"}


def _validate_minds(api_key: str, base_url: str) -> dict[str, Any]:
    # mdb.ai requires HTTP/2; urllib only speaks HTTP/1.1 and gets a 401.
    # httpx (already a transitive dep via anton) handles HTTP/2 via ALPN.
    try:
        base = base_url.rstrip("/")
        with httpx.Client(http2=True, timeout=15) as client:
            resp = client.get(
                f"{base}/api/v1/minds/",
                headers={"Authorization": f"Bearer {api_key}"},
            )
        if resp.status_code in (401, 403):
            return {"ok": False, "error": "Invalid API key"}
        if 200 <= resp.status_code < 300:
            return {"ok": True}
        return {"ok": False, "error": f"Server returned HTTP {resp.status_code}"}
    except Exception:
        logger.warning("Minds provider validation failed", exc_info=True)
        return {"ok": False, "error": "Cannot connect"}


def _validate_openai_compatible(api_key: str, base_url: str, model: Optional[str]) -> dict[str, Any]:
    try:
        normalized = base_url.rstrip("/")
        # Bases that already include a versioned path (e.g. Gemini's
        # /v1beta/openai) skip the implicit /v1 prefix.
        import re
        chat_url = f"{normalized}/chat/completions" if re.search(r"/v\d", normalized) else f"{normalized}/v1/chat/completions"
        body = json.dumps({"model": model or "gpt-4o", "messages": [{"role": "user", "content": "ping"}]}).encode()
        status, text = _http_json(
            chat_url,
            "POST",
            {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            body,
        )
        if status in (200, 201):
            return {"ok": True}
        if status in (401, 403):
            return {"ok": False, "error": "Invalid API key"}
        try:
            msg = json.loads(text).get("error", {}).get("message") or f"HTTP {status}"
        except Exception:
            msg = f"HTTP {status}"
        return {"ok": False, "error": msg}
    except Exception:
        logger.warning("OpenAI-compatible provider validation failed", exc_info=True)
        return {"ok": False, "error": "Cannot connect"}


@router.post("/validate-provider")
async def validate_provider(body: ValidateProviderBody):
    """Server-side provider key check. Mirrors the Electron
    `validateProvider` IPC; same shape, same provider names."""
    if body.provider == "anthropic":
        return _validate_anthropic(body.apiKey, body.model or "claude-sonnet-4-6")
    if body.provider == "minds":
        return _validate_minds(body.apiKey, body.baseUrl or "https://mdb.ai")
    if body.provider == "openai-compatible":
        return _validate_openai_compatible(body.apiKey, body.baseUrl or "https://api.openai.com/v1", body.model)
    return {"ok": False, "error": "Unknown provider"}
