from __future__ import annotations

import os
import sys
import tempfile
import unittest
import json
import asyncio
from pathlib import Path
from unittest.mock import patch


SERVER_ROOT = Path(__file__).resolve().parents[1]
if str(SERVER_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVER_ROOT))

from anton_api import projects_store
from runtime.conversations import CoworkConversationStore
from runtime.events import (
    cowork_event_to_legacy_sse,
    iter_sse_payloads,
)
from harnesses.legacy_events import (
    normalize_legacy_payload,
    normalize_legacy_payloads,
)
from runtime.artifacts import scan_updated_artifacts, snapshot_artifacts
from runtime.artifact_events import TurnArtifactCollector, artifact_created_event
from runtime.access import (
    build_access_policy,
    classify_resource,
    event_for_access_denied,
    event_for_approval,
    make_approval,
)
from runtime.schemas import (
    CoworkResourceRef,
    CoworkMessage,
    HarnessReadiness,
    HarnessTurnRequest,
    HarnessCapabilities,
    ProjectContext,
    ResolvedInferenceProfile,
)


class RuntimeSchemaTests(unittest.TestCase):
    def test_legacy_delta_event_round_trips_to_responses_sse(self) -> None:
        event = normalize_legacy_payload(
            {"type": "response.output_text.delta", "delta": "hello", "sequence_number": 1},
            "turn_1",
        )

        self.assertEqual(event.type, "message.delta")
        self.assertEqual(event.payload["delta"], "hello")

        emitted = cowork_event_to_legacy_sse(event)
        payloads = iter_sse_payloads(emitted)
        self.assertEqual(payloads[0][0], "response.output_text.delta")
        self.assertEqual(payloads[0][1]["delta"], "hello")
        self.assertEqual(payloads[0][1]["cowork_event_type"], "message.delta")
        self.assertEqual(payloads[0][1]["cowork_event_schema"], "cowork.event.v1")

    def test_canonical_event_schema_rejects_unknown_types(self) -> None:
        from pydantic import ValidationError
        from runtime.schemas import CoworkEvent

        event = CoworkEvent(type="message.delta", turn_id="turn_1", payload={"delta": "ok"})
        dumped = event.model_dump(by_alias=True)

        self.assertEqual(dumped["schema"], "cowork.event.v1")
        self.assertEqual(dumped["type"], "message.delta")
        with self.assertRaises(ValidationError):
            CoworkEvent(type="legacy.random", turn_id="turn_1")

    def test_request_and_readiness_models_serialize(self) -> None:
        profile = ResolvedInferenceProfile(
            provider_type="minds-cloud",
            provider_label="MindsHub",
            planning_provider_type="minds-cloud",
            planning_provider_label="MindsHub",
            planning_base_url="https://mdb.ai/api/v1",
            planning_api_key_ref="ANTON_MINDS_API_KEY",
            coding_provider_type="minds-cloud",
            coding_provider_label="MindsHub",
            coding_base_url="https://mdb.ai/api/v1",
            coding_api_key_ref="ANTON_MINDS_API_KEY",
            planning_model="_reason_",
            coding_model="_code_",
        )
        request = HarnessTurnRequest(
            conversation_id="conv_1",
            turn_id="turn_1",
            messages=[CoworkMessage(role="user", content="Hi")],
            user_input="Hi",
            project_context=ProjectContext(id="general", name="general", path="/tmp/general"),
            inference=profile,
            artifact_root="/tmp/general/artifacts",
        )
        ready = HarnessReadiness.ok()

        self.assertTrue(ready.model_dump()["ready"])
        self.assertEqual(request.model_dump()["inference"]["planning_model"], "_reason_")
        self.assertEqual(request.model_dump()["inference"]["coding_provider_type"], "minds-cloud")
        self.assertEqual(request.inference.safe_dump()["planning_api_key_ref"], "ANTON_MINDS_API_KEY")

    def test_tool_and_artifact_progress_normalize(self) -> None:
        tool = normalize_legacy_payload(
            {
                "type": "response.in_progress",
                "phase": "tool",
                "progress_status": "completed",
                "tool_name": "browser_navigate",
                "message": "browser_navigate complete",
            },
            "turn_1",
        )
        artifact = normalize_legacy_payload(
            {
                "type": "response.in_progress",
                "phase": "artifact",
                "progress_status": "completed",
                "artifact": {"title": "Deck", "path": "/tmp/deck.pptx"},
            },
            "turn_1",
        )

        self.assertEqual(tool.type, "tool.completed")
        self.assertEqual(tool.payload["tool_name"], "browser_navigate")
        self.assertEqual(artifact.type, "artifact.created")
        self.assertEqual(artifact.payload["artifact"]["title"], "Deck")

    def test_typed_file_source_and_approval_events_normalize_to_progress(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "notes.md"
            source.write_text("hello", encoding="utf-8")
            events = normalize_legacy_payloads(
                {
                    "type": "response.in_progress",
                    "phase": "tool",
                    "progress_status": "completed",
                    "tool_name": "read_file",
                    "message": f"Read {source}; approval required before editing",
                },
                "turn_1",
                project_root=str(root),
            )

        types = [event.type for event in events]
        self.assertIn("file.accessed", types)
        self.assertIn("source.used", types)
        self.assertIn("approval.required", types)
        file_event = next(event for event in events if event.type == "file.accessed")
        emitted = cowork_event_to_legacy_sse(file_event)
        payloads = iter_sse_payloads(emitted)
        self.assertEqual(payloads[0][1]["type"], "response.in_progress")
        self.assertEqual(payloads[0][1]["phase"], "file")
        self.assertEqual(payloads[0][1]["cowork_event_type"], "file.accessed")

    def test_access_policy_classifies_paths_and_actions(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            artifacts = root / "artifacts"
            artifacts.mkdir()
            policy = build_access_policy(
                project_context=ProjectContext(id="general", name="general", path=str(root)),
                artifact_root=str(artifacts),
                approvals_mode="require",
            )

            read_decision = classify_resource(policy, CoworkResourceRef(
                resource_type="file",
                operation="read",
                path=str(root / "notes.md"),
                scope=str(root / "notes.md"),
            ))
            artifact_write = classify_resource(policy, CoworkResourceRef(
                resource_type="file",
                operation="write",
                path=str(artifacts / "deck" / "deck.md"),
                scope=str(artifacts / "deck" / "deck.md"),
            ))
            project_write = classify_resource(policy, CoworkResourceRef(
                resource_type="file",
                operation="write",
                path=str(root / "notes.md"),
                scope=str(root / "notes.md"),
            ))
            outside = classify_resource(policy, CoworkResourceRef(
                resource_type="file",
                operation="read",
                path="/tmp/outside.txt",
                scope="/tmp/outside.txt",
            ))
            internal = classify_resource(policy, CoworkResourceRef(
                resource_type="file",
                operation="read",
                path=str(root / ".cowork" / "state.json"),
                scope=str(root / ".cowork" / "state.json"),
            ))

        self.assertEqual(read_decision.status, "allowed")
        self.assertEqual(artifact_write.status, "allowed")
        self.assertEqual(project_write.status, "approval_required")
        self.assertEqual(outside.status, "denied")
        self.assertEqual(internal.status, "denied")

    def test_approval_and_access_events_emit_legacy_progress(self) -> None:
        resource = CoworkResourceRef(resource_type="shell", operation="execute", scope="shell")
        decision = classify_resource(
            build_access_policy(
                project_context=ProjectContext(id="general", name="general", path="/tmp/general"),
                artifact_root="/tmp/general/artifacts",
                approvals_mode="require",
            ),
            resource,
        )
        approval = make_approval(turn_id="turn_1", decision=decision, status="pending")
        approval_event = event_for_approval(approval)
        denied_event = event_for_access_denied("turn_1", decision)

        approval_payload = iter_sse_payloads(cowork_event_to_legacy_sse(approval_event))[0][1]
        denied_payload = iter_sse_payloads(cowork_event_to_legacy_sse(denied_event))[0][1]

        self.assertEqual(approval_payload["phase"], "approval")
        self.assertEqual(approval_payload["approval_id"], approval.id)
        self.assertEqual(approval_payload["cowork_event_type"], "approval.required")
        self.assertEqual(denied_payload["phase"], "access")
        self.assertEqual(denied_payload["progress_status"], "failed")
        self.assertEqual(denied_payload["cowork_event_type"], "access.denied")

    def test_artifact_scan_uses_canonical_project_root(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "artifacts"
            root.mkdir()
            before = snapshot_artifacts(root)
            folder = root / "deck"
            folder.mkdir()
            (folder / "metadata.json").write_text(json.dumps({
                "name": "Deck",
                "type": "document",
                "primary": "deck.md",
            }), encoding="utf-8")
            (folder / "README.md").write_text("# Deck", encoding="utf-8")
            (folder / "deck.md").write_text("Hello", encoding="utf-8")

            artifacts = scan_updated_artifacts(root, before)

        self.assertEqual(len(artifacts), 1)
        self.assertEqual(artifacts[0]["title"], "Deck")
        self.assertTrue(artifacts[0]["path"].endswith("deck.md"))

    def test_turn_artifact_collector_dedupes_harness_hints(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "artifacts"
            root.mkdir()
            collector = TurnArtifactCollector(root)
            folder = root / "deck"
            folder.mkdir()
            metadata = {
                "name": "Deck",
                "type": "document",
                "primary": "deck.md",
            }
            (folder / "metadata.json").write_text(json.dumps(metadata), encoding="utf-8")
            (folder / "README.md").write_text("# Deck", encoding="utf-8")
            primary = folder / "deck.md"
            primary.write_text("Hello", encoding="utf-8")

            collector.note_event(artifact_created_event("turn_1", {
                "title": "Deck",
                "folder": str(folder),
                "path": str(primary),
            }))
            events = collector.collect("turn_1")

        self.assertEqual(events, [])


class CoworkConversationStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.old_projects_dir = os.environ.get("ANTON_PROJECTS_DIR")
        self.old_state_dir = os.environ.get("ANTON_COWORK_STATE_DIR")
        os.environ["ANTON_PROJECTS_DIR"] = str(Path(self.tmp.name) / "projects")
        os.environ["ANTON_COWORK_STATE_DIR"] = str(Path(self.tmp.name) / "state")
        projects_store.ensure_general_project()

    def tearDown(self) -> None:
        if self.old_projects_dir is None:
            os.environ.pop("ANTON_PROJECTS_DIR", None)
        else:
            os.environ["ANTON_PROJECTS_DIR"] = self.old_projects_dir
        if self.old_state_dir is None:
            os.environ.pop("ANTON_COWORK_STATE_DIR", None)
        else:
            os.environ["ANTON_COWORK_STATE_DIR"] = self.old_state_dir
        self.tmp.cleanup()

    def test_store_reloads_messages_and_events_from_cowork_state(self) -> None:
        store = CoworkConversationStore()
        profile = ResolvedInferenceProfile(
            provider_type="minds-cloud",
            provider_label="MindsHub",
            planning_model="_reason_",
            coding_model="_code_",
        )
        conv = store.create(project="general", harness="hermes", inference=profile, title="Hello")
        conv = store.append_message(conv, CoworkMessage(role="user", content="Hello"))
        user_message = conv.messages[-1]
        conv, turn, _assistant = store.start_turn(conv, user_message.id)
        event = normalize_legacy_payload(
            {"type": "response.output_text.delta", "delta": "Hi there"},
            turn.id,
        )
        store.append_event(conv, turn.id, event)
        store.finish_turn(conv, turn.id, "completed")

        reloaded = store.get(conv.id)
        self.assertIsNotNone(reloaded)
        messages = store.display_messages(reloaded)
        self.assertEqual(messages[-1]["role"], "assistant")
        self.assertEqual(messages[-1]["content"], "Hi there")
        self.assertEqual(reloaded.harness, "hermes")

    def test_noninteractive_approval_required_fails_before_harness_execution(self) -> None:
        from routes.cowork_state import update_state
        from runtime.service import RuntimeService

        class FakeHarness:
            id = "fake"
            label = "Fake"

            def capabilities(self):
                return HarnessCapabilities(approval_mode="preflight")

            def validate_request(self, request):
                return HarnessReadiness.ok()

            async def start_turn(self, request):
                raise AssertionError("harness should not be called before approval")

            async def cancel_turn(self, turn_id):
                return None

        profile = ResolvedInferenceProfile(
            provider_type="minds-cloud",
            provider_label="MindsHub",
            planning_model="_reason_",
            coding_model="_code_",
        )
        update_state(lambda state: state.setdefault("preferences", {}).update({"approvalsMode": "require"}))
        service = RuntimeService()

        async def run() -> str:
            with patch("runtime.service.resolve_inference_profile", return_value=profile), \
                 patch("runtime.service.validate_inference_profile", return_value=(True, "")), \
                 patch("runtime.service.selected_harness_id", return_value="fake"), \
                 patch("runtime.service.get_harness_by_id", return_value=FakeHarness()):
                text, _cid = await service.complete_text(
                    user_input="Please edit the project file",
                    conversation_id=None,
                    project="general",
                    model=None,
                    disabled_connections=None,
                    interactive_approvals=False,
                )
                return text

        with self.assertRaises(RuntimeError) as ctx:
            asyncio.run(run())
        self.assertIn("Approval", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
