"""Cowork-owned runtime primitives.

The runtime package is the greenfield app-domain layer used for new
conversations. Harnesses execute turns; Cowork owns the persisted UI state.

Keep this package split-minded:
- stable primitives below are candidates for `mindsdb/cowork-server`;
- desktop orchestration such as Electron process supervision stays in
  `mindsdb/cowork`;
- harness adapters depend on this package, not the other way around.
"""

from .schemas import (
    CoworkAccessDecision,
    CoworkAccessPolicy,
    CoworkApprovalDecision,
    CoworkApprovalRequest,
    CoworkConversation,
    CoworkEvent,
    CoworkEventType,
    CoworkMessage,
    CoworkResourceRef,
    CoworkTurn,
    HarnessCapabilities,
    HarnessReadiness,
    HarnessTurnRequest,
    ProjectContext,
    ResolvedInferenceProfile,
)

__all__ = [
    "CoworkAccessDecision",
    "CoworkAccessPolicy",
    "CoworkApprovalDecision",
    "CoworkApprovalRequest",
    "CoworkConversation",
    "CoworkEvent",
    "CoworkEventType",
    "CoworkMessage",
    "CoworkResourceRef",
    "CoworkTurn",
    "HarnessCapabilities",
    "HarnessReadiness",
    "HarnessTurnRequest",
    "ProjectContext",
    "ResolvedInferenceProfile",
]
