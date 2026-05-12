"""Common harness provider primitives."""

from __future__ import annotations

from typing import AsyncIterator, Protocol


class HarnessConfigurationError(RuntimeError):
    """Raised when the selected harness is missing required configuration."""


class HarnessRuntimeError(RuntimeError):
    """Raised when the selected harness fails while processing a request."""


class HarnessProvider(Protocol):
    id: str
    label: str

    async def health(self) -> dict:
        ...

    def list_live(self) -> list[str]:
        ...

    async def close_all(self) -> None:
        ...

    def list_conversations(self, limit: int = 200, project: str | None = None) -> list[dict]:
        ...

    def get_conversation(self, conversation_id: str) -> dict | None:
        ...

    def get_messages(self, conversation_id: str) -> list[dict] | None:
        ...

    def load_turns(self, conversation_id: str) -> dict | None:
        ...

    def update_conversation(self, conversation_id: str, **patch) -> dict | None:
        ...

    def delete_turn(self, conversation_id: str, turn_index: int) -> dict | None:
        ...

    def delete_conversation(self, conversation_id: str) -> bool:
        ...

    def move_conversation(self, conversation_id: str, target_project: str) -> dict | None:
        ...

    async def stream_response(
        self,
        *,
        user_input: str,
        conversation_id: str | None,
        project: str | None,
        model: str | None,
        disabled_connections: list[dict] | None,
    ) -> AsyncIterator[str]:
        ...

    async def complete_text(
        self,
        *,
        user_input: str,
        conversation_id: str | None,
        project: str | None,
        model: str | None,
        disabled_connections: list[dict] | None,
    ) -> tuple[str, str | None]:
        ...
