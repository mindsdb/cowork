"""Docker entrypoint — wraps cowork-server with SPA static-file serving.

In the Docker image, the same FastAPI process serves both:
  /api/v1/*  — cowork-server API endpoints
  /          — cowork SPA (single-page app with client-side routing)

This wrapper imports the cowork-server app and adds SPA routes on top.
Run with: uvicorn spa_wrapper:app --host 0.0.0.0 --port 26866
"""

import os
from pathlib import Path

from fastapi import HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from cowork.server import app  # noqa: F401 — re-exported for uvicorn

SPA_DIR = Path(os.environ.get("COWORK_SPA_DIR", "/app/dist/renderer-web"))
_provider_tests = os.environ.get("COWORK_PROVIDER_TESTS_ENABLED", "true")
if _provider_tests not in {"true", "false"}:
    raise ValueError("COWORK_PROVIDER_TESTS_ENABLED must be 'true' or 'false'.")

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
        meta = f'<meta name="cowork-provider-tests-enabled" content="{_provider_tests}">'
        html = html.replace("<head>", f"<head>\n    {meta}", 1)
        return HTMLResponse(html, headers={"Cache-Control": "no-store"})

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
