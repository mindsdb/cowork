"""POST /v1/responses — OpenAI Responses API.

Streaming SSE by default; pass {"stream": false} for one-shot JSON.
Cowork extensions: project (name) + attachment_ids fields on the request.
The returned `response.created` event carries the conversation_id the
frontend uses as its task id.
"""

from __future__ import annotations

import logging
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from anton_api.models import (
    Message,
    ResponseObject,
    ResponseOutput,
    ResponseOutputContent,
    ResponseStatus,
    ResponsesRequest,
)
from harnesses.base import HarnessConfigurationError, HarnessRuntimeError
from harnesses.registry import get_active_harness
from .attachments import attachment_context
from .settings import get_config_status


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/v1", tags=["responses"])


def _resolve_input(req: ResponsesRequest) -> str:
    if isinstance(req.input, str):
        return req.input
    user_messages = [m for m in req.input if isinstance(m, Message) and m.role == "user"]
    if not user_messages:
        raise HTTPException(status_code=400, detail="No user message in input")
    content = user_messages[-1].content
    if not isinstance(content, str):
        raise HTTPException(status_code=400, detail="Only string user content is supported")
    return content


def _assembled_user_input(content: str, project_name: str | None, session_id: str | None, attachment_ids: list[str]) -> str:
    context = attachment_context(project_name, session_id, attachment_ids)
    if not context:
        return content
    return f"{content}\n\n{context}"


@router.post("/responses")
async def create_response(req: ResponsesRequest):
    harness = get_active_harness()
    health = await harness.health()
    if not health.get("available"):
        raise HTTPException(
            status_code=503,
            detail=health.get("error") or f"{harness.label} is not available.",
        )

    config = get_config_status()
    if not config["config_ready"]:
        raise HTTPException(
            status_code=400,
            detail=config["config_error"] or "Anton is not configured.",
        )

    user_text = _resolve_input(req)
    final_input = _assembled_user_input(
        user_text,
        req.project,
        req.conversation,
        req.attachment_ids,
    )
    dc_payload = None
    if req.disabled_connections is not None:
        dc_payload = [d.model_dump() for d in req.disabled_connections]
    
    if req.stream:
        return StreamingResponse(
            harness.stream_response(
                user_input=final_input,
                conversation_id=req.conversation,
                project=req.project,
                model=req.model,
                disabled_connections=dc_payload,
            ),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "Access-Control-Allow-Origin": "*",
            },
        )

    # Non-streaming: collect text and return a single ResponseObject.
    try:
        text, _cid = await harness.complete_text(
            user_input=final_input,
            conversation_id=req.conversation,
            project=req.project,
            model=req.model,
            disabled_connections=dc_payload,
        )
    except HarnessConfigurationError as exc:
        logger.warning("%s configuration error: %s", harness.label, exc)
        raise HTTPException(status_code=400, detail=str(exc) or "Configuration error")
    except HarnessRuntimeError as exc:
        logger.error("%s runtime error: %s", harness.label, exc)
        raise HTTPException(status_code=500, detail=str(exc) or "An unexpected error occurred")

    return ResponseObject(
        model="hermes-agent" if harness.id == "hermes" else (req.model or harness.id),
        status=ResponseStatus.completed,
        output=[ResponseOutput(
            status=ResponseStatus.completed,
            content=[ResponseOutputContent(text=text)],
        )],
    )
