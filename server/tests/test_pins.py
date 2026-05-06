"""Tests for services/pins.py."""
import pytest
from services.pins import (
    VALID_PIN_TYPES,
    pin_key,
    upsert_pin,
)


class TestPinKey:
    def test_format(self):
        assert pin_key("task", "t1") == "task:t1"
        assert pin_key("project", "p1") == "project:p1"

    def test_with_slash(self):
        assert pin_key("artifact", "a/b") == "artifact:a/b"


class TestValidPinTypes:
    def test_expected_types(self):
        assert VALID_PIN_TYPES == {"task", "project", "artifact", "schedule"}

    def test_rejects_unknown(self):
        assert "random" not in VALID_PIN_TYPES


class TestUpsertPin:
    def test_inserts_new(self):
        state = {"pins": []}
        pin = upsert_pin(state, "task", "t1", "My task")
        assert pin["id"] == "t1"
        assert pin["title"] == "My task"
        assert pin["type"] == "task"
        assert len(state["pins"]) == 1

    def test_updates_existing_title(self):
        state = {"pins": []}
        upsert_pin(state, "task", "t1", "Original")
        upsert_pin(state, "task", "t1", "Updated")
        assert len(state["pins"]) == 1
        assert state["pins"][0]["title"] == "Updated"

    def test_preserves_title_on_none(self):
        state = {"pins": []}
        upsert_pin(state, "task", "t1", "Keep me")
        upsert_pin(state, "task", "t1", None)
        assert state["pins"][0]["title"] == "Keep me"

    def test_inserts_at_front(self):
        state = {"pins": []}
        upsert_pin(state, "task", "t1", "First")
        upsert_pin(state, "task", "t2", "Second")
        assert state["pins"][0]["id"] == "t2"


class TestPinRoutes:
    def test_create_and_list(self, app_client):
        resp = app_client.post("/v1/pins", json={"item_type": "task", "item_id": "r-1", "title": "Route pin"})
        assert resp.status_code == 200
        assert resp.json()["pins"][0]["id"] == "r-1"

        listed = app_client.get("/v1/pins")
        assert listed.status_code == 200
        assert any(p["id"] == "r-1" for p in listed.json()["pins"])

    def test_delete(self, app_client):
        app_client.post("/v1/pins", json={"item_type": "task", "item_id": "del-1", "title": "Delete me"})
        resp = app_client.delete("/v1/pins/del-1")
        assert resp.status_code == 200

    def test_delete_missing_404(self, app_client):
        resp = app_client.delete("/v1/pins/nonexistent")
        assert resp.status_code == 404

    def test_bad_type_400(self, app_client):
        resp = app_client.post("/v1/pins", json={"item_type": "invalid", "item_id": "x"})
        assert resp.status_code == 400

    def test_auto_pin_after_visits(self, app_client):
        for _ in range(3):
            resp = app_client.post("/v1/pins/auto-1/visit", params={"auto_pin": "true", "title": "Auto"})
        assert resp.json()["autoPinned"] is True

    def test_reorder(self, app_client):
        app_client.post("/v1/pins", json={"item_type": "task", "item_id": "a", "title": "A"})
        app_client.post("/v1/pins", json={"item_type": "task", "item_id": "b", "title": "B"})
        resp = app_client.put("/v1/pins/reorder", json={"item_ids": ["a", "b"]})
        assert resp.status_code == 200
        ids = [p["id"] for p in resp.json()["pins"] if p["id"] in ("a", "b")]
        assert ids == ["a", "b"]
