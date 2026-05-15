"""Anton harness provider wrapper."""

from __future__ import annotations

import json
import logging
import time
from typing import AsyncIterator

from anton_api import conversation_manager
from anton_api.formatter import format_responses_stream
from anton_api.models import (
    ResponseObject,
    ResponseOutput,
    ResponseOutputContent,
    ResponseStatus,
)
from runtime.events import iter_sse_payloads
from .legacy_events import normalize_legacy_payloads
from runtime.schemas import (
    CoworkEvent,
    HarnessCapabilities,
    HarnessReadiness,
    HarnessTurnRequest,
)

from .base import HarnessConfigurationError, HarnessRuntimeError


logger = logging.getLogger(__name__)


class AntonHarnessProvider:
    id = "anton"
    label = "Anton"

    def capabilities(self) -> HarnessCapabilities:
        return HarnessCapabilities(
            memory=True,
            skills=True,
            artifacts=True,
            streaming=True,
            tool_progress=True,
            cancellation=True,
            sidecar=False,
            approval_mode="preflight",
            file_access_reporting="heuristic",
            tool_event_reporting="structured",
            native_memory_mode="anton",
            native_skills_mode="anton",
            session_memory_snapshot=False,
        )

    async def health(self) -> dict:
        return {
            "id": self.id,
            "label": self.label,
            "available": conversation_manager.is_anton_available(),
        }

    def validate_request(self, request: HarnessTurnRequest) -> HarnessReadiness:
        del request
        if not conversation_manager.is_anton_available():
            return HarnessReadiness.fail(
                "anton_unavailable",
                "Anton is not installed in this desktop environment.",
            )
        return HarnessReadiness.ok()

    async def start_turn(self, request: HarnessTurnRequest) -> AsyncIterator[CoworkEvent]:
        async for chunk in self._stream_legacy_sse(
            user_input=request.user_input,
            conversation_id=request.conversation_id,
            project=request.project_context.name,
            model=request.inference.planning_model,
            disabled_connections=request.disabled_connections,
            inference_profile=request.inference.safe_dump(),
        ):
            for _event_type, payload in iter_sse_payloads(chunk):
                for event in normalize_legacy_payloads(
                    payload,
                    request.turn_id,
                    project_root=request.project_context.path,
                ):
                    yield event

    async def cancel_turn(self, turn_id: str) -> None:
        del turn_id
        return None

    def list_live(self) -> list[str]:
        return conversation_manager.list_live()

    async def close_all(self) -> None:
        await conversation_manager.close_all()

    def list_conversations(self, limit: int = 200, project: str | None = None) -> list[dict]:
        conversations = conversation_manager.list_conversations(limit=limit, project=project)
        for conversation in conversations:
            conversation.setdefault("harness", self.id)
        return conversations

    def get_conversation(self, conversation_id: str) -> dict | None:
        meta = conversation_manager.get_conversation(conversation_id)
        if meta:
            meta.setdefault("harness", self.id)
        return meta

    def get_messages(self, conversation_id: str) -> list[dict] | None:
        return conversation_manager.get_messages(conversation_id)

    def load_turns(self, conversation_id: str) -> dict | None:
        return conversation_manager.load_turns(conversation_id)

    def update_conversation(self, conversation_id: str, **patch) -> dict | None:
        return conversation_manager.update_conversation(conversation_id, **patch)

    def delete_turn(self, conversation_id: str, turn_index: int) -> dict | None:
        return conversation_manager.delete_turn(conversation_id, turn_index)

    def delete_conversation(self, conversation_id: str) -> bool:
        return conversation_manager.delete_conversation(conversation_id)

    def move_conversation(self, conversation_id: str, target_project: str) -> dict | None:
        return conversation_manager.move_conversation(conversation_id, target_project)

    async def stream_response(
        self,
        *,
        user_input: str,
        conversation_id: str | None,
        project: str | None,
        model: str | None,
        disabled_connections: list[dict] | None,
    ) -> AsyncIterator[str]:
        from runtime.service import runtime_service

        async for chunk in runtime_service.stream_response(
            user_input=user_input,
            conversation_id=conversation_id,
            project=project,
            model=model,
            disabled_connections=disabled_connections,
            harness_override=self.id,
        ):
            yield chunk

    async def _stream_legacy_sse(
        self,
        *,
        user_input: str,
        conversation_id: str | None,
        project: str | None,
        model: str | None,
        disabled_connections: list[dict] | None,
        inference_profile: dict | None,
    ) -> AsyncIterator[str]:
        cid: str | None = None
        recorded_events: list[dict] = []
        started_at_ms: int | None = None

        def _record(_event_type: str, data: dict) -> None:
            nonlocal started_at_ms
            if started_at_ms is None:
                started_at_ms = int(time.time() * 1000)
            recorded_events.append({**data})

        try:
            event_stream, cid = await conversation_manager.chat_stream(
                user_input,
                conversation_id=conversation_id,
                project=project,
                model=model if model and model != "anton" else None,
                disabled_connections=disabled_connections,
                inference_profile=inference_profile,
            )
            async for chunk in format_responses_stream(
                event_stream,
                model=model or "anton",
                conversation_id=cid,
                event_sink=_record,
            ):
                yield chunk
        except conversation_manager.AntonConfigurationError as exc:
            logger.warning("Anton configuration error: %s", exc)
            yield self._failed_event("config_required", "Configuration error")
        except conversation_manager.AntonRuntimeError as exc:
            logger.error("Anton runtime error: %s", exc)
            yield self._failed_event("anton_error", "An unexpected error occurred")
        except Exception:
            logger.exception("Anton response stream failed")
            yield self._failed_event("server_error", "Internal server error")
        finally:
            if cid and recorded_events:
                try:
                    conversation_manager.record_turn_events(
                        cid,
                        started_at_ms,
                        recorded_events,
                    )
                except Exception:
                    logger.debug("Could not record Anton turn events", exc_info=True)

    async def complete_text(
        self,
        *,
        user_input: str,
        conversation_id: str | None,
        project: str | None,
        model: str | None,
        disabled_connections: list[dict] | None,
    ) -> tuple[str, str | None]:
        if not conversation_manager.is_anton_available():
            raise HarnessConfigurationError("Anton is not installed in this desktop environment.")

        from anton.core.llm.provider import StreamTextDelta

        collected: list[str] = []
        try:
            event_stream, cid = await conversation_manager.chat_stream(
                user_input,
                conversation_id=conversation_id,
                project=project,
                model=model if model and model != "anton" else None,
                disabled_connections=disabled_connections,
            )
            async for event in event_stream:
                if isinstance(event, StreamTextDelta):
                    collected.append(event.text)
            return "".join(collected), cid
        except conversation_manager.AntonConfigurationError as exc:
            raise HarnessConfigurationError(str(exc)) from exc
        except conversation_manager.AntonRuntimeError as exc:
            raise HarnessRuntimeError(str(exc)) from exc

    @staticmethod
    def _failed_event(code: str, message: str) -> str:
        payload = {"type": "response.failed", "code": code, "error": message}
        return f"event: response.failed\ndata: {json.dumps(payload)}\n\n"

    @staticmethod
    def response_object(model: str | None, text: str) -> ResponseObject:
        return ResponseObject(
            model=model or "anton",
            status=ResponseStatus.completed,
            output=[
                ResponseOutput(
                    status=ResponseStatus.completed,
                    content=[ResponseOutputContent(text=text)],
                )
            ],
        )
