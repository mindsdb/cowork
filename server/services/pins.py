"""Pin and visit-count business logic.

Pure domain logic — no HTTPException, no Pydantic models, no FastAPI.
Routes catch domain errors and map them to HTTP responses.
"""
from __future__ import annotations

from routes.cowork_state import load_state, update_state, utc_now_iso

VALID_PIN_TYPES = {"task", "project", "artifact", "schedule"}
AUTO_PIN_THRESHOLD = 3


def pin_key(item_type: str, item_id: str) -> str:
    return f"{item_type}:{item_id}"


def is_pinned(item_id: str, item_type: str = "task") -> bool:
    key = pin_key(item_type, item_id)
    state = load_state()
    return any(item.get("key") == key for item in state.get("pins", []))


def upsert_pin(state: dict, item_type: str, item_id: str, title: str | None = None) -> dict:
    key = pin_key(item_type, item_id)
    now = utc_now_iso()
    existing = next((item for item in state["pins"] if item.get("key") == key), None)
    if existing:
        existing["updatedAt"] = now
        if title:
            existing["title"] = title
        return existing
    pin = {
        "key": key,
        "type": item_type,
        "id": item_id,
        "title": title or item_id,
        "createdAt": now,
        "updatedAt": now,
    }
    state["pins"].insert(0, pin)
    return pin


def get_pins() -> list[dict]:
    state = load_state()
    return state.get("pins", [])


def add_pin(item_type: str, item_id: str, title: str | None = None) -> dict:
    def mutate(state):
        pin = upsert_pin(state, item_type, item_id, title)
        return {"pin": pin, "pins": list(state["pins"])}
    return update_state(mutate)


def remove_pin(item_id: str, item_type: str = "task") -> dict:
    """Returns {'found': bool, 'pins': list}."""
    key = pin_key(item_type, item_id)

    def mutate(state):
        before = len(state.get("pins", []))
        state["pins"] = [item for item in state.get("pins", []) if item.get("key") != key]
        return {"found": len(state["pins"]) < before, "pins": list(state["pins"])}

    return update_state(mutate)


def reorder_pins(item_ids: list[str]) -> list[dict]:
    def mutate(state):
        pins_by_id = {item.get("id"): item for item in state.get("pins", [])}
        reordered = [pins_by_id[item_id] for item_id in item_ids if item_id in pins_by_id]
        existing_ids = {item.get("id") for item in reordered}
        reordered.extend(item for item in state.get("pins", []) if item.get("id") not in existing_ids)
        state["pins"] = reordered
        return list(reordered)

    return update_state(mutate)


def record_visit(task_id: str, auto_pin: bool = False, title: str | None = None) -> dict:
    def mutate(state):
        visits = state.setdefault("visit_counts", {})
        visits[task_id] = int(visits.get(task_id, 0)) + 1
        pin = None
        if auto_pin and visits[task_id] >= AUTO_PIN_THRESHOLD:
            pin = upsert_pin(state, "task", task_id, title)
        return {"taskId": task_id, "visits": visits[task_id], "autoPinned": bool(pin), "pin": pin}

    return update_state(mutate)
