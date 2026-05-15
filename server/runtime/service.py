"""Cowork runtime orchestration behind /v1/responses."""

from __future__ import annotations

import logging
from typing import AsyncIterator

from anton_api import projects_store
from harnesses.config import selected_harness_id
from harnesses.registry import get_harness_by_id

from .conversations import store
from .access import (
    build_access_policy,
    classify_resource,
    current_approvals_mode,
    event_for_access_denied,
    event_for_approval,
    file_resource_from_event,
    make_approval,
    preflight_resources,
)
from .approvals import approval_coordinator
from .artifact_events import TurnArtifactCollector
from .artifacts import ensure_artifact_root
from .events import cowork_event_to_legacy_sse, iter_sse_payloads
from .inference import resolve_inference_profile, validate_inference_profile
from .schemas import (
    CoworkEvent,
    CoworkMessage,
    HarnessReadiness,
    HarnessTurnRequest,
    ProjectContext,
    ResolvedInferenceProfile,
)


logger = logging.getLogger(__name__)


class RuntimeService:
    def _project_context(self, project: str | None) -> ProjectContext:
        projects_store.ensure_general_project()
        try:
            name, base = projects_store.resolve_project(project)
        except FileNotFoundError:
            name, base = projects_store.resolve_project(None)
        return ProjectContext(id=name, name=name, path=str(base))

    def _artifact_root(self, project_name: str) -> str:
        return str(ensure_artifact_root(projects_store.project_path(project_name)))

    def _failed_event(self, turn_id: str, code: str, message: str) -> CoworkEvent:
        legacy = {"type": "response.failed", "code": code, "error": message}
        return CoworkEvent(
            type="response.failed",
            turn_id=turn_id,
            payload={
                "legacy": legacy,
                "legacy_type": "response.failed",
                "code": code,
                "message": message,
                "label": "Response failed",
                "status": "failed",
            },
        )

    async def _handle_preflight_access(
        self,
        *,
        conv,
        turn,
        user_input: str,
        access_policy,
        approvals_mode: str,
        interactive_approvals: bool,
    ) -> AsyncIterator[CoworkEvent]:
        for resource in preflight_resources(user_input):
            decision = classify_resource(access_policy, resource)
            if decision.status == "allowed":
                continue
            if decision.status == "denied":
                denied = event_for_access_denied(turn.id, decision)
                store.append_event(conv, turn.id, denied)
                yield denied
                failed = self._failed_event(turn.id, "access_denied", decision.reason)
                store.append_event(conv, turn.id, failed)
                store.finish_turn(conv, turn.id, "failed", decision.reason)
                yield failed
                return

            if approvals_mode == "off":
                approval = make_approval(turn_id=turn.id, decision=decision, status="bypassed")
                store.add_approval(conv, turn.id, approval)
                event = event_for_approval(approval)
                store.append_event(conv, turn.id, event)
                yield event
                continue

            approval = make_approval(turn_id=turn.id, decision=decision, status="pending")
            store.add_approval(conv, turn.id, approval)
            required = event_for_approval(approval)
            store.append_event(conv, turn.id, required)
            yield required
            if not interactive_approvals:
                denied = store.update_approval(approval.id, "expired")
                expired_approval = denied[1] if denied else approval.model_copy(update={"status": "expired"})
                expired = event_for_approval(expired_approval, "approval.denied")
                store.append_event(conv, turn.id, expired)
                yield expired
                failed = self._failed_event(turn.id, "approval_required", "Approval is required before this scheduled or non-interactive task can continue.")
                store.append_event(conv, turn.id, failed)
                store.finish_turn(conv, turn.id, "failed", failed.payload.get("message"))
                yield failed
                return

            approval_coordinator.register(approval.id)
            decision_text = await approval_coordinator.wait(approval.id)
            if decision_text != "approved":
                updated = store.update_approval(approval.id, "denied" if decision_text == "denied" else "expired")
                resolved = updated[1] if updated else approval.model_copy(update={"status": decision_text})
                denied_event = event_for_approval(resolved, "approval.denied")
                store.append_event(conv, turn.id, denied_event)
                yield denied_event
                failed = self._failed_event(turn.id, "approval_denied", "Approval was denied or expired.")
                store.append_event(conv, turn.id, failed)
                store.finish_turn(conv, turn.id, "failed", failed.payload.get("message"))
                yield failed
                return

            updated = store.update_approval(approval.id, "approved")
            resolved = updated[1] if updated else approval.model_copy(update={"status": "approved"})
            granted = event_for_approval(resolved, "approval.granted")
            store.append_event(conv, turn.id, granted)
            yield granted

    def _audit_event_access(self, *, event: CoworkEvent, turn_id: str, access_policy, approvals_mode: str) -> CoworkEvent | None:
        if approvals_mode != "require":
            return None
        resource = file_resource_from_event(event)
        if resource is None:
            return None
        decision = classify_resource(access_policy, resource)
        if decision.status == "denied":
            return event_for_access_denied(turn_id, decision)
        return None

    async def stream_response(
        self,
        *,
        user_input: str,
        conversation_id: str | None,
        project: str | None,
        model: str | None,
        disabled_connections: list[dict[str, Any]] | None,
        attachment_ids: list[str] | None = None,
        harness_override: str | None = None,
        inference_override: dict[str, Any] | None = None,
        interactive_approvals: bool = True,
    ) -> AsyncIterator[str]:
        del model
        conv = store.get(conversation_id) if conversation_id else None
        if inference_override:
            try:
                inference = ResolvedInferenceProfile.model_validate(inference_override)
            except Exception:
                inference = resolve_inference_profile()
        elif conv is not None and conv.inference_profile:
            try:
                inference = ResolvedInferenceProfile.model_validate(conv.inference_profile)
            except Exception:
                inference = resolve_inference_profile()
        else:
            inference = resolve_inference_profile()
        if conv is None:
            harness_id = harness_override or selected_harness_id()
            project_context = self._project_context(project)
            conv = store.create(
                project=project_context.name,
                harness=harness_id,
                inference=inference,
                conversation_id=conversation_id,
                title=user_input.strip()[:80],
                disabled_connections=disabled_connections,
            )
        else:
            project_context = self._project_context(conv.project_id)
            harness_id = conv.harness

        harness = get_harness_by_id(harness_id)
        capabilities = harness.capabilities()
        approvals_mode = current_approvals_mode()
        inference_ok, inference_error = validate_inference_profile(inference)
        artifact_root = self._artifact_root(project_context.name)
        access_policy = build_access_policy(
            project_context=project_context,
            artifact_root=artifact_root,
            uploads=[],
            disabled_connections=disabled_connections,
            approvals_mode=approvals_mode,
        )
        readiness = harness.validate_request(
            HarnessTurnRequest(
                conversation_id=conv.id,
                turn_id="readiness",
                messages=conv.messages,
                user_input=user_input,
                project_context=project_context,
                disabled_connections=disabled_connections,
                inference=inference,
                artifact_root=artifact_root,
                approvals_mode=approvals_mode,
                access_policy=access_policy,
                interactive_approvals=interactive_approvals,
                harness_state=conv.harness_state,
            )
        )
        if not inference_ok:
            readiness = HarnessReadiness.fail("inference_not_ready", inference_error)
        user_message = CoworkMessage(role="user", content=user_input)
        conv = store.append_message(conv, user_message)
        conv, turn, _assistant = store.start_turn(conv, user_message.id)

        if not readiness.ready:
            failed = self._failed_event(turn.id, readiness.code or "not_ready", readiness.message or "Harness is not ready")
            store.append_event(conv, turn.id, failed)
            store.finish_turn(conv, turn.id, "failed", failed.payload.get("message"))
            yield cowork_event_to_legacy_sse(failed)
            return

        if approvals_mode == "require" and capabilities.approval_mode == "none":
            failed = self._failed_event(turn.id, "approval_unsupported", "The selected harness does not support Cowork approval checks.")
            store.append_event(conv, turn.id, failed)
            store.finish_turn(conv, turn.id, "failed", failed.payload.get("message"))
            yield cowork_event_to_legacy_sse(failed)
            return

        async for access_event in self._handle_preflight_access(
            conv=conv,
            turn=turn,
            user_input=user_input,
            access_policy=access_policy,
            approvals_mode=approvals_mode,
            interactive_approvals=interactive_approvals,
        ):
            yield cowork_event_to_legacy_sse(access_event)
            if access_event.type == "response.failed":
                return

        request = HarnessTurnRequest(
            conversation_id=conv.id,
            turn_id=turn.id,
            messages=conv.messages,
            user_input=user_input,
            project_context=project_context,
            disabled_connections=disabled_connections,
            inference=inference,
            artifact_root=artifact_root,
            approvals_mode=approvals_mode,
            access_policy=access_policy,
            approval_grants=[
                approval
                for t in (store.get(conv.id) or conv).turns
                if t.id == turn.id
                for approval in t.approvals
                if approval.status in {"approved", "bypassed"}
            ],
            interactive_approvals=interactive_approvals,
            harness_state=conv.harness_state,
            runtime_options={"cowork_canonical": True},
        )
        terminal_seen = False
        artifacts = TurnArtifactCollector(artifact_root)
        try:
            async for event in harness.start_turn(request):
                conv = store.get(conv.id) or conv
                store.append_event(conv, turn.id, event)
                denied = self._audit_event_access(
                    event=event,
                    turn_id=turn.id,
                    access_policy=access_policy,
                    approvals_mode=approvals_mode,
                )
                if denied is not None:
                    store.append_event(conv, turn.id, denied)
                    terminal_seen = True
                    store.finish_turn(conv, turn.id, "failed", denied.payload.get("message"))
                    yield cowork_event_to_legacy_sse(denied)
                    failed = self._failed_event(turn.id, "access_denied", str(denied.payload.get("message") or "Access denied"))
                    store.append_event(conv, turn.id, failed)
                    yield cowork_event_to_legacy_sse(failed)
                    return
                artifacts.note_event(event)
                if event.type == "response.completed":
                    for artifact_event in artifacts.collect(turn.id):
                        store.append_event(conv, turn.id, artifact_event)
                        yield cowork_event_to_legacy_sse(artifact_event)
                    terminal_seen = True
                    store.finish_turn(conv, turn.id, "completed")
                elif event.type == "response.failed":
                    for artifact_event in artifacts.collect(turn.id):
                        store.append_event(conv, turn.id, artifact_event)
                        yield cowork_event_to_legacy_sse(artifact_event)
                    terminal_seen = True
                    message = str(event.payload.get("message") or event.payload.get("error") or "Response failed")
                    store.finish_turn(conv, turn.id, "failed", message)
                yield cowork_event_to_legacy_sse(event)
        except GeneratorExit:
            await harness.cancel_turn(turn.id)
            conv = store.get(conv.id) or conv
            store.finish_turn(conv, turn.id, "cancelled")
            raise
        except Exception as exc:
            logger.exception("Cowork runtime turn failed")
            conv = store.get(conv.id) or conv
            for artifact_event in artifacts.collect(turn.id):
                store.append_event(conv, turn.id, artifact_event)
                yield cowork_event_to_legacy_sse(artifact_event)
            failed = self._failed_event(turn.id, "runtime_error", str(exc) or "Runtime error")
            store.append_event(conv, turn.id, failed)
            store.finish_turn(conv, turn.id, "failed", str(exc))
            terminal_seen = True
            yield cowork_event_to_legacy_sse(failed)
        finally:
            if not terminal_seen:
                conv = store.get(conv.id) or conv
                for artifact_event in artifacts.collect(turn.id):
                    store.append_event(conv, turn.id, artifact_event)
                last = next((t for t in conv.turns if t.id == turn.id), None)
                if last and last.status == "running":
                    store.finish_turn(conv, turn.id, "partial")

    async def complete_text(
        self,
        *,
        user_input: str,
        conversation_id: str | None,
        project: str | None,
        model: str | None,
        disabled_connections: list[dict[str, Any]] | None,
        harness_override: str | None = None,
        inference_override: dict[str, Any] | None = None,
        interactive_approvals: bool = False,
    ) -> tuple[str, str | None]:
        text: list[str] = []
        seen_id = conversation_id
        async for chunk in self.stream_response(
            user_input=user_input,
            conversation_id=conversation_id,
            project=project,
            model=model,
            disabled_connections=disabled_connections,
            harness_override=harness_override,
            inference_override=inference_override,
            interactive_approvals=interactive_approvals,
        ):
            for _event_type, payload in iter_sse_payloads(chunk):
                if payload.get("type") == "response.created":
                    seen_id = payload.get("conversation_id") or seen_id
                elif payload.get("type") == "response.output_text.delta":
                    text.append(str(payload.get("delta") or ""))
                elif payload.get("type") == "response.failed":
                    raise RuntimeError(str(payload.get("error") or "Response failed"))
        return "".join(text), seen_id


runtime_service = RuntimeService()
