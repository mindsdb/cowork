"""Selected harness registry.

The selected harness is intentionally latched at server startup. Changing the
setting and restarting the backend gives a clear per-app-session swap without
mid-stream runtime drift.
"""

from __future__ import annotations

from .anton_provider import AntonHarnessProvider
from .config import selected_harness_id
from .hermes_provider import HermesHarnessProvider


_ACTIVE_ID = selected_harness_id()
_ANTON = AntonHarnessProvider()
_HERMES = HermesHarnessProvider()


def active_harness_id() -> str:
    return _ACTIVE_ID


def get_active_harness():
    if _ACTIVE_ID == "hermes":
        return _HERMES
    return _ANTON


def get_harness_by_id(harness_id: str):
    if harness_id == "hermes":
        return _HERMES
    return _ANTON
