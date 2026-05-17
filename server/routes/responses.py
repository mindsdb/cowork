"""POST /v1/responses — OpenAI Responses API.

Streaming SSE by default; pass {"stream": false} for one-shot JSON.
Cowork extensions: project (name) + attachment_ids fields on the request.
The returned `response.created` event carries the conversation_id the
frontend uses as its task id.
"""

from __future__ import annotations

import json
import logging
import time
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

from anton_api import conversation_manager
from anton_api.formatter import format_responses_stream
from anton_api.models import (
    Message,
    ResponseObject,
    ResponseOutput,
    ResponseOutputContent,
    ResponseStatus,
    ResponsesRequest,
)
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
    if not conversation_manager.is_anton_available():
        raise HTTPException(
            status_code=503,
            detail="Anton is not installed in this desktop environment.",
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
    
    if req.stream:
        async def stream():
            cid: str | None = None
            # Per-turn event capture for the cowork sidecar. The sink is
            # called by `format_responses_stream` for every event before
            # serialisation so we record exactly the SSE-shape dicts the
            # client adapter consumes (no parsing back from the wire).
            recorded_events: list[dict] = []
            started_at_ms: int | None = None

            def _record(event_type: str, data: dict) -> None:
                nonlocal started_at_ms
                if started_at_ms is None:
                    started_at_ms = int(time.time() * 1000)
                # Defensive copy so later mutations of `data` (rare but
                # cheap to guard against) don't churn what we'll persist.
                recorded_events.append({**data})

            try:
                dc_payload = None
                if req.disabled_connections is not None:
                    dc_payload = [d.model_dump() for d in req.disabled_connections]
                event_stream, cid = await conversation_manager.chat_stream(
                    final_input,
                    conversation_id=req.conversation,
                    project=req.project,
                    model=req.model if req.model and req.model != "anton" else None,
                    disabled_connections=dc_payload,
                )

                async for chunk in format_responses_stream(
                    event_stream,
                    model=req.model or "anton",
                    conversation_id=cid,
                    event_sink=_record,
                ):
                    yield chunk
            except conversation_manager.AntonConfigurationError as exc:
                logger.warning("Anton configuration error: %s", exc)
                yield (
                    "event: response.failed\n"
                    f"data: {json.dumps({'type': 'response.failed', 'code': 'config_required', 'error': 'Configuration error'})}\n\n"
                )
            except conversation_manager.AntonRuntimeError as exc:
                logger.error("Anton runtime error: %s", exc)
                yield (
                    "event: response.failed\n"
                    f"data: {json.dumps({'type': 'response.failed', 'code': 'anton_error', 'error': 'An unexpected error occurred'})}\n\n"
                )
            except Exception:
                logger.exception("response stream failed")
                yield (
                    "event: response.failed\n"
                    f"data: {json.dumps({'type': 'response.failed', 'code': 'server_error', 'error': 'Internal server error'})}\n\n"
                )
            finally:
                # Persist whatever we captured so reopening the
                # conversation rebuilds the Thinking block + scratchpad
                # tabs. Runs even on failed/aborted streams so partial
                # turns are still recoverable.
                if cid and recorded_events:
                    try:
                        conversation_manager.record_turn_events(
                            cid, started_at_ms, recorded_events,
                        )
                    except Exception:
                        logger.debug("Could not record turn events", exc_info=True)

        return StreamingResponse(
            stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "Access-Control-Allow-Origin": "*",
            },
        )

    # Non-streaming: collect text and return a single ResponseObject.
    from anton.core.llm.provider import StreamTextDelta

    collected: list[str] = []
    try:
        dc_payload = None
        if req.disabled_connections is not None:
            dc_payload = [d.model_dump() for d in req.disabled_connections]
        event_stream, cid = await conversation_manager.chat_stream(
            final_input,
            conversation_id=req.conversation,
            project=req.project,
            model=req.model if req.model and req.model != "anton" else None,
            disabled_connections=dc_payload,
        )
        async for event in event_stream:
            if isinstance(event, StreamTextDelta):
                collected.append(event.text)
    except conversation_manager.AntonConfigurationError as exc:
        logger.warning("Anton configuration error: %s", exc)
        raise HTTPException(status_code=400, detail="Configuration error")
    except conversation_manager.AntonRuntimeError as exc:
        logger.error("Anton runtime error: %s", exc)
        raise HTTPException(status_code=500, detail="An unexpected error occurred")

    return ResponseObject(
        model=req.model or "anton",
        status=ResponseStatus.completed,
        output=[ResponseOutput(
            status=ResponseStatus.completed,
            content=[ResponseOutputContent(text="".join(collected))],
        )],
    )


class CancelRequest(__import__("pydantic").BaseModel):
    """POST body for /v1/responses/cancel. Lives next to the route
    rather than in models.py because it's a server-internal endpoint
    (not part of the Responses-API surface)."""
    conversation_id: str


@router.post("/responses/cancel")
async def cancel_response(req: CancelRequest):
    """Phase 3 — explicit cancellation of an in-flight turn.

    The renderer's Stop button hits this rather than relying on fetch
    abort. Fetch abort tears down the SSE consumer, which under
    Phase 1 has zero effect on the producer task — exactly the
    behaviour we wanted for "user closed the tab," but it means the
    Stop button now needs its own signal path to actually halt work.

    Effect:
      1. The producer task receives ``CancelledError``.
      2. ``_produce_turn`` catches it, calls
         ``_finalize_history_on_explicit_cancel`` (writes the
         ``[Stopped by user]`` placeholder + persists history), and
         writes a ``Cancelled`` terminal record to the buffer.
      3. Any active tail readers see the ``Cancelled`` record and
         end their generators cleanly.

    Idempotent: a second cancel for an already-done turn is a no-op
    that returns ``cancelled=false``.
    """
    cancelled = await conversation_manager.cancel_in_flight(req.conversation_id)
    return {"cancelled": cancelled, "conversation_id": req.conversation_id}


@router.get("/responses/in-flight-list")
async def in_flight_list():
    """All conversation_ids whose producer task is currently running.

    The renderer uses this for cross-client sync of stream state:

      * On app boot — populate the local "is conversation X mid-stream?"
        cache so the first render of each conversation already knows.
      * On window focus — refresh the cache; catches cases where the
        user started a stream in another tab/window/client.
      * Heartbeat poll (every 5s, only while the cache is non-empty) —
        catches the multi-monitor case where the user has both clients
        visible and is watching one while the other reaches completion.

    Cheap by design: in-memory registry lookup, no disk reads. The
    full ``/responses/tail`` and ``/responses/in-flight`` endpoints
    handle the actual stream reconnect; this is just the cache feed.
    """
    from anton_api import stream_registry as _stream_registry
    return {
        "in_flight": [
            {
                "conversation_id": cid,
                "turn_id": h.turn_id,
                "latest_seq": h.buffer.latest_seq,
            }
            for cid, h in _stream_registry.registry._by_cid.items()
            if h.is_running
        ],
    }


@router.get("/responses/in-flight")
async def in_flight_status(conversation_id: str = Query(...)):
    """Phase 2 — cheap probe so the renderer can decide whether to
    open a ``/tail`` SSE connection on conversation mount.

    Returns:
        ``in_flight`` — True if a producer task is still running.
        ``has_buffer`` — True if a TurnHandle exists (running or just
            finished; useful for "the producer wrote Done 50 ms ago,
            but we still have events to replay").
        ``latest_seq`` — Total number of records written so far. The
            renderer passes ``from_seq=latest_seq`` only when it
            already has the same data locally; for first-mount
            reconnect, pass ``from_seq=0`` to replay the whole turn.
        ``turn_id`` — Turn index inside the conversation, for
            display/debug.

    Cheap by design: no SSE, no disk read beyond the registry lookup.
    """
    from anton_api import stream_registry as _stream_registry
    handle = _stream_registry.registry.get(conversation_id)
    if handle is None:
        return {
            "in_flight": False,
            "has_buffer": False,
            "latest_seq": 0,
            "turn_id": None,
        }
    return {
        "in_flight": handle.is_running,
        "has_buffer": True,
        "latest_seq": handle.buffer.latest_seq,
        "turn_id": handle.turn_id,
    }


@router.get("/responses/tail")
async def tail_response(
    conversation_id: str = Query(..., description="Conversation to tail."),
    from_seq: int = Query(
        0,
        ge=0,
        description=(
            "Sequence number to resume from. Records with seq >= "
            "from_seq are yielded; older records are skipped. Use the "
            "seq of the last event the client successfully rendered."
        ),
    ),
    model: str = Query("anton", description="Model name to echo back in SSE frames."),
):
    """Phase 2 — reconnect to an in-flight (or just-finished) turn.

    Tails the file-backed buffer that ``POST /v1/responses`` started.
    Behaviour by buffer state:

      * **Live producer** — yields events as they're written. If the
        client passes ``from_seq=N``, it gets every event since N AND
        the live tail. The producer is unaffected by this consumer
        coming or going.
      * **Producer just finished** — yields the remaining buffered
        events through to the terminal record, then the SSE stream
        ends. Useful for the "client reconnects 50 ms after the
        producer wrote `Done`" race.
      * **No buffer in registry** — returns ``404``. The renderer
        should fall back to ``GET /v1/conversations/{id}/messages``
        for the persisted history.

    The SSE frames it emits are byte-for-byte the same shape as
    ``POST /v1/responses`` produces — the renderer reuses its existing
    event parser without modification.
    """
    if not conversation_manager.is_anton_available():
        raise HTTPException(
            status_code=503,
            detail="Anton is not installed in this desktop environment.",
        )

    event_stream = conversation_manager.tail_conversation(
        conversation_id, from_seq=from_seq,
    )
    if event_stream is None:
        # No live buffer for this conversation. The client should fall
        # back to the persisted history endpoint.
        raise HTTPException(
            status_code=404,
            detail="No in-flight buffer for this conversation.",
        )

    async def stream():
        try:
            async for chunk in format_responses_stream(
                event_stream,
                model=model,
                conversation_id=conversation_id,
                # No event_sink on tail: turn events were already
                # recorded by the producer's original POST /responses
                # request. Recording them again on tail would duplicate
                # the per-turn event log.
                event_sink=None,
            ):
                yield chunk
        except conversation_manager.AntonRuntimeError as exc:
            logger.error("Anton runtime error during tail: %s", exc)
            yield (
                "event: response.failed\n"
                f"data: {json.dumps({'type': 'response.failed', 'code': 'anton_error', 'error': 'An unexpected error occurred'})}\n\n"
            )
        except Exception:
            logger.exception("response tail stream failed")
            yield (
                "event: response.failed\n"
                f"data: {json.dumps({'type': 'response.failed', 'code': 'server_error', 'error': 'Internal server error'})}\n\n"
            )

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Access-Control-Allow-Origin": "*",
        },
    )
