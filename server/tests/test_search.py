"""Tests for services/search.py."""
from services.search import _score


class TestScore:
    def test_empty_text(self):
        assert _score("", "test") == 0

    def test_empty_query(self):
        assert _score("anything", "") == 0

    def test_case_insensitive(self):
        assert _score("Hello World", "hello") > 0

    def test_match_higher_than_miss(self):
        assert _score("Hello World", "hello") > _score("Hello World", "goodbye")

    def test_repeated_matches_score_higher(self):
        assert _score("test test test", "test") > _score("test", "test")

    def test_multi_term(self):
        assert _score("test other", "test other") > _score("test other", "test")

    def test_no_match(self):
        assert _score("no match here", "xyz") == 0


class TestSearchRoute:
    def test_empty_query(self, app_client):
        resp = app_client.get("/v1/search", params={"q": ""})
        assert resp.json()["results"] == []

    def test_finds_attachments(self, app_client):
        app_client.post("/v1/attachments/snippet", json={
            "title": "SearchTarget", "content": "findme",
        })
        resp = app_client.get("/v1/search", params={"q": "SearchTarget"})
        assert resp.status_code == 200
        assert any(r["type"] == "attachment" for r in resp.json()["results"])
