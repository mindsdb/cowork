"""Regression tests for connector-spec field naming.

Background — the bug this guards against:

The renderer renders a connector's form straight from its JSON spec.
Field names in the spec become the keys of the credentials map sent
to ``POST /datasources``. That handler validates against anton's
built-in engine registry (``anton/core/datasources/datasources.md``),
which declares the *canonical* field names for each engine.

When the two diverge — e.g. cowork's ``mysql.json`` had a field named
``username`` while anton's MySQL engine_def expects ``user`` — the
validation either rejects the save (missing required ``user``) or,
worse, the field is silently dropped on the legacy save path and the
resulting vault row has no ``DS_..._USER`` env var to inject. Either
way, the connection is unusable.

This test enforces the convention that DB-pattern connectors use
anton's canonical names. A method is treated as "DB-pattern" when it
declares a ``host`` field (databases are addressed by host:port,
SaaS APIs are not). For those methods, common aliases like
``username``/``pwd``/``db``/``hostname`` are rejected in favor of
the canonical ``user``/``password``/``database``/``host``.

Run with::

    python3 -m unittest server.tests.test_connector_field_names -v
"""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path


_THIS_DIR = Path(__file__).resolve().parent
_SERVER_DIR = _THIS_DIR.parent
if str(_SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(_SERVER_DIR))

CONNECTORS_DIR = _SERVER_DIR / "connectors"


# Field aliases that anton's engine_def parser does NOT recognize.
# When a spec uses the alias, the credential is silently dropped on
# save (or worse, the engine validation rejects the request with a
# "missing required field" error). Keep this map in sync with anton's
# canonical names in ``anton/core/datasources/datasources.md``.
ALIAS_TO_CANONICAL = {
    "username": "user",
    "pwd": "password",
    "db": "database",
    "hostname": "host",
}


def _iter_methods(spec: dict):
    """Yield (method_id, fields) for every method in a connector spec.

    Single-method specs are normalized to one synthetic method with
    id="<top-level>" so the caller doesn't have to branch.
    """
    form = spec.get("form") or {}
    methods = form.get("methods")
    if methods:
        for m in methods:
            yield m.get("id", "<unnamed>"), list(m.get("fields") or [])
    else:
        yield "<top-level>", list(form.get("fields") or [])


class ConnectorFieldNameTest(unittest.TestCase):
    """Connector JSON specs must use anton's canonical field names."""

    def test_db_pattern_methods_use_canonical_names(self):
        """A method with a ``host`` field is a DB-pattern method; in
        those, alias names like ``username`` must be the canonical
        ``user`` (and same for the other aliases).

        Non-DB-pattern methods (SaaS APIs, OAuth flows) are exempt —
        their ``username`` is often the legitimate canonical name for
        the upstream service.
        """
        self.assertTrue(
            CONNECTORS_DIR.is_dir(),
            f"Connectors directory not found at {CONNECTORS_DIR}",
        )

        failures: list[str] = []
        for path in sorted(CONNECTORS_DIR.glob("*.json")):
            try:
                spec = json.loads(path.read_text(encoding="utf-8"))
            except json.JSONDecodeError as exc:
                failures.append(f"{path.name}: invalid JSON — {exc}")
                continue

            for method_id, fields in _iter_methods(spec):
                names = {f.get("name") for f in fields if f.get("name")}
                if "host" not in names:
                    continue
                for alias, canonical in ALIAS_TO_CANONICAL.items():
                    if alias in names:
                        failures.append(
                            f"{path.name} method={method_id!r}: "
                            f"DB-pattern (declares 'host') uses alias "
                            f"{alias!r} — rename to canonical "
                            f"{canonical!r} to match anton's engine_def"
                        )

        self.assertEqual(
            failures,
            [],
            "DB-pattern connector specs must use anton's canonical field "
            "names. Offenders:\n  " + "\n  ".join(failures),
        )


if __name__ == "__main__":
    unittest.main()
