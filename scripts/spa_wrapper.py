"""Docker entrypoint — wraps cowork-server with SPA static-file serving.

In the Docker image, the same FastAPI process serves both:
  /api/v1/*  — cowork-server API endpoints
  /          — cowork SPA (single-page app with client-side routing)

This wrapper imports the cowork-server app and adds SPA routes on top.
Run with: uvicorn spa_wrapper:app --host 0.0.0.0 --port 26866
"""

import os
from html import escape as html_escape
from pathlib import Path
from typing import Annotated

from fastapi import HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, StringConstraints, TypeAdapter, ValidationError

from cowork.server import app  # noqa: F401 — re-exported for uvicorn

SPA_DIR = Path(os.environ.get("COWORK_SPA_DIR", "/app/dist/renderer-web"))
_provider_tests = os.environ.get("COWORK_PROVIDER_TESTS_ENABLED", "true")
if _provider_tests not in {"true", "false"}:
    raise ValueError("COWORK_PROVIDER_TESTS_ENABLED must be 'true' or 'false'.")
# Whether a build without the platform UI shows the composer's model picker: "default" starts each
# new conversation on the operator's model, "open" keeps the user's last pick. "off" writes no tag,
# so the shell stays as the build made it.
_model_picker = os.environ.get("COWORK_MODEL_PICKER", "off")
if _model_picker not in {"off", "default", "open"}:
    raise ValueError("COWORK_MODEL_PICKER must be 'off', 'default' or 'open'.")
# Whether cowork-server publishes with one shared token (COWORK_PUBLISH_TOKEN) instead of the
# person's own key. Only the container environment counts: cowork-server also reads the token from
# its .env files (cowork.common.settings.app_settings), which this wrapper doesn't. The page gets
# only the yes or no, never the token: the Share box offers "Only you" and says a Public link
# reaches the internet only when it's no.
_shared_publish_token = "true" if os.environ.get("COWORK_PUBLISH_TOKEN", "").strip() else "false"


# A reasoning effort, such as medium or xhigh: lowercase letters alone.
Effort = Annotated[str, StringConstraints(pattern=r"^[a-z]+$")]
ModelEfforts = dict[str, list[Effort]]
_MODEL_EFFORTS = TypeAdapter(ModelEfforts)


class OperatorEfforts(BaseModel):
    """The cowork-model-efforts tag, as the composer reads it (OperatorEfforts in
    src/renderer/lib/modelPicker.ts): the efforts users may pick on each model, and on "Operator default"."""

    models: ModelEfforts
    operator_default: list[Effort] = Field(serialization_alias="operatorDefault")


def _model_efforts_meta(value: str, planning_model: str, coding_model: str) -> str | None:
    """The composer's effort control under the picker: VALUE, a JSON object of each model's efforts
    users may pick, and "Operator default"'s, those both PLANNING_MODEL and CODING_MODEL list, since
    a question with no model runs on both and the server gives its effort to both. None when unset."""
    if not value:
        return None
    if _model_picker == "off":
        raise ValueError("COWORK_MODEL_EFFORTS needs COWORK_MODEL_PICKER 'default' or 'open'.")
    rule = "COWORK_MODEL_EFFORTS must be a JSON object of model ids to lists of lowercase efforts."
    try:
        models = _MODEL_EFFORTS.validate_json(value)
    except ValidationError:
        raise ValueError(rule) from None
    planning, coding = models.get(planning_model, []), models.get(coding_model, [])
    tag = OperatorEfforts(models=models, operator_default=[effort for effort in planning if effort in coding])
    return tag.model_dump_json(by_alias=True)


# Read once, at start: the container's role models come from the same environment as the server's.
_model_efforts = _model_efforts_meta(
    os.environ.get("COWORK_MODEL_EFFORTS", ""), os.environ.get("PLANNING_MODEL", ""), os.environ.get("CODING_MODEL", "")
)

if SPA_DIR.exists():
    # Subdirectories that the SPA build emits — served by StaticFiles so
    # they get correct MIME-types and range-request handling for free.
    # "brand" holds the stock deployment brand; mounting it also answers an
    # unknown brand file with 404 instead of the SPA shell.
    for _sub in ("assets", "brand", "fonts", "gravity-field", "logos"):
        _sub_path = SPA_DIR / _sub
        if _sub_path.exists():
            app.mount(
                f"/{_sub}",
                StaticFiles(directory=str(_sub_path)),
                name=f"spa-{_sub}",
            )

    # Pre-resolve every top-level file in SPA_DIR into a string→Path
    # allowlist. The fallback handler uses full_path only as a dict key,
    # never as a path component, so traversal sequences simply miss the
    # dict and fall through to the SPA shell.
    _spa_files: dict[str, Path] = {
        entry.name: entry for entry in SPA_DIR.iterdir() if entry.is_file()
    }
    _spa_shell: Path = SPA_DIR / "index-web.html"

    def shell_response() -> HTMLResponse:
        html = _spa_shell.read_text(encoding="utf-8")
        # The setting must arrive before the renderer runs, on every shell URL.
        # Refuse a changed template rather than silently losing the operator's choice.
        if html.count("<head>") != 1 or "cowork-provider-tests-enabled" in html:
            raise ValueError("The SPA shell needs one <head> and no provider-testing metadata.")
        if "cowork-model-picker" in html or "cowork-model-efforts" in html:
            raise ValueError("The SPA shell needs no model-picker metadata.")
        if "cowork-shared-publish-token" in html:
            raise ValueError("The SPA shell needs no publish-token metadata.")
        metas = [
            f'<meta name="cowork-provider-tests-enabled" content="{_provider_tests}">',
            f'<meta name="cowork-shared-publish-token" content="{_shared_publish_token}">',
        ]
        if _model_picker != "off":
            metas.append(f'<meta name="cowork-model-picker" content="{_model_picker}">')
        if _model_efforts is not None:
            metas.append(f'<meta name="cowork-model-efforts" content="{html_escape(_model_efforts)}">')
        html = html.replace("<head>", "<head>" + "".join(f"\n    {meta}" for meta in metas), 1)
        return HTMLResponse(html, headers={"Cache-Control": "no-store", "X-Cowork-Spa-Shell": "1"})

    @app.get("/health")
    async def health_compat():
        # Compat endpoint — proxies to /api/v1/health for callers that probe /health.
        # Called from mindshub_frontend to establish instance health -- update
        # there before removing here
        from cowork.api.v1.endpoints.health import health

        return health()

    @app.get("/")
    async def root():
        return shell_response()

    @app.api_route(
        "/{full_path:path}",
        methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    )
    async def spa_fallback(full_path: str, request: Request):
        # /api/* paths must never serve the SPA shell in place of a
        # missing API endpoint. Routes are registered with trailing
        # slashes (e.g. /api/v1/pins/) but clients often omit them;
        # Starlette's redirect_slashes would normally 307, but this
        # catch-all matches first. 307 preserves the original HTTP
        # method so POST/PUT/PATCH/DELETE all work correctly.
        if full_path.startswith("api/") or full_path == "api":
            if not full_path.endswith("/"):
                qs = str(request.url.query)
                target = f"/{full_path}/" + (f"?{qs}" if qs else "")
                return RedirectResponse(url=target, status_code=307)
            raise HTTPException(status_code=404)
        # Top-level file the build emitted? Serve it. Otherwise this is
        # a client-side route — serve the SPA shell so the renderer's
        # router can take over.
        served = _spa_files.get(full_path)
        if served is not None and served != _spa_shell:
            return FileResponse(str(served))
        return shell_response()
