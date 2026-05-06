"""Tests for services/schedules.py."""
from datetime import datetime, timedelta, timezone

import pytest
from services.schedules import (
    InvalidScheduleError,
    advance_schedule,
    normalise_cadence,
    parse_datetime,
    task_title,
)


class TestTaskTitle:
    def test_short(self):
        assert task_title("Hello world") == "Hello world"

    def test_empty(self):
        assert task_title("") == "Scheduled task"

    def test_none(self):
        assert task_title(None) == "Scheduled task"

    def test_whitespace_only(self):
        assert task_title("  \n  ") == "Scheduled task"

    def test_truncates_long(self):
        result = task_title("A" * 100)
        assert len(result) <= 61
        assert result.endswith("\u2026")

    def test_multiline_uses_first(self):
        assert task_title("First line\nSecond line") == "First line"

    def test_strips_whitespace(self):
        assert task_title("  Leading spaces  ") == "Leading spaces"


class TestParseDatetime:
    def test_z_suffix(self):
        assert parse_datetime("2025-01-01T00:00:00Z") is not None

    def test_offset(self):
        assert parse_datetime("2025-01-01T00:00:00+00:00") is not None

    def test_positive_offset(self):
        assert parse_datetime("2025-06-15T14:30:00+05:30") is not None

    def test_invalid(self):
        assert parse_datetime("not-a-date") is None

    def test_none(self):
        assert parse_datetime(None) is None

    def test_empty(self):
        assert parse_datetime("") is None

    def test_whitespace(self):
        assert parse_datetime("  ") is None

    def test_normalizes_to_utc(self):
        parsed = parse_datetime("2025-01-01T00:00:00Z")
        assert parsed.tzinfo == timezone.utc


class TestNormaliseCadence:
    @pytest.mark.parametrize("cadence", ["once", "hourly", "daily", "weekly"])
    def test_valid(self, cadence):
        assert normalise_cadence(cadence) == cadence

    def test_strips_and_lowercases(self):
        assert normalise_cadence("  WEEKLY  ") == "weekly"

    @pytest.mark.parametrize("cadence", ["biweekly", "", "monthly", "yearly"])
    def test_rejects_invalid(self, cadence):
        with pytest.raises(InvalidScheduleError):
            normalise_cadence(cadence)


class TestAdvanceSchedule:
    def test_once_disables(self):
        schedule = {"cadence": "once", "enabled": True}
        advance_schedule(schedule)
        assert schedule["enabled"] is False

    def test_daily_bumps_to_future(self):
        now = datetime.now(timezone.utc)
        past = (now - timedelta(hours=2)).isoformat()
        schedule = {"cadence": "daily", "enabled": True, "nextRunAt": past}
        advance_schedule(schedule)
        assert parse_datetime(schedule["nextRunAt"]) > now

    def test_hourly_with_old_date(self):
        now = datetime.now(timezone.utc)
        old = (now - timedelta(days=3)).isoformat()
        schedule = {"cadence": "hourly", "enabled": True, "nextRunAt": old}
        advance_schedule(schedule)
        assert parse_datetime(schedule["nextRunAt"]) > now

    def test_weekly_advances_by_week(self):
        now = datetime.now(timezone.utc)
        past = (now - timedelta(hours=1)).isoformat()
        schedule = {"cadence": "weekly", "enabled": True, "nextRunAt": past}
        advance_schedule(schedule)
        next_run = parse_datetime(schedule["nextRunAt"])
        assert next_run > now
        assert (next_run - now).days >= 6


class TestScheduleRoutes:
    def test_create_and_list(self, app_client):
        future = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
        resp = app_client.post("/v1/schedules", json={
            "title": "Test", "prompt": "Say hi", "cadence": "once", "next_run_at": future,
        })
        assert resp.status_code == 200
        assert resp.json()["schedule"]["title"] == "Test"

        listed = app_client.get("/v1/schedules")
        assert listed.status_code == 200

    def test_pause_resume(self, app_client):
        future = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
        created = app_client.post("/v1/schedules", json={
            "prompt": "x", "cadence": "once", "next_run_at": future,
        })
        sid = created.json()["schedule"]["id"]

        paused = app_client.post(f"/v1/schedules/{sid}/pause")
        assert paused.json()["schedule"]["enabled"] is False

        resumed = app_client.post(f"/v1/schedules/{sid}/resume")
        assert resumed.json()["schedule"]["enabled"] is True

    def test_update(self, app_client):
        future = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
        created = app_client.post("/v1/schedules", json={
            "prompt": "x", "cadence": "once", "next_run_at": future,
        })
        sid = created.json()["schedule"]["id"]

        updated = app_client.put(f"/v1/schedules/{sid}", json={"title": "New title"})
        assert updated.json()["schedule"]["title"] == "New title"

    def test_bad_cadence_400(self, app_client):
        future = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
        resp = app_client.post("/v1/schedules", json={
            "prompt": "x", "cadence": "biweekly", "next_run_at": future,
        })
        assert resp.status_code == 400

    def test_delete(self, app_client):
        future = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
        created = app_client.post("/v1/schedules", json={
            "prompt": "x", "cadence": "once", "next_run_at": future,
        })
        sid = created.json()["schedule"]["id"]
        assert app_client.delete(f"/v1/schedules/{sid}").status_code == 200

    def test_delete_missing_404(self, app_client):
        assert app_client.delete("/v1/schedules/nonexistent").status_code == 404

    def test_missed_schedule_catchup(self, app_client):
        past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        app_client.post("/v1/schedules", json={
            "title": "Missed", "prompt": "late", "cadence": "once", "next_run_at": past,
        })
        listed = app_client.get("/v1/schedules").json()["schedules"]
        assert any(s["title"] == "Missed" and s.get("catchupPending") for s in listed)
