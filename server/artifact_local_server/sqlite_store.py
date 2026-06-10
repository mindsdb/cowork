"""
SqliteStore — a drop-in local replacement for a boto3 DynamoDB Table object.

Implements the subset of the DynamoDB Table API that Anton-generated handler.py
code uses:  put_item, get_item, delete_item, update_item, query, scan.

Backed by a single SQLite file at the path given to the constructor.
Schema is created on first access — no migration step needed locally
(the migration runner handles production DynamoDB; locally we always start
from a single flat table and evolve via ALTER if needed).

Usage in handler.py:
    import os
    LOCAL = os.environ.get("LOCAL_MODE") == "1"
    if LOCAL:
        from artifact_local_server.sqlite_store import SqliteStore
        store = SqliteStore(os.environ["STORAGE_PATH"])
    else:
        import boto3
        store = boto3.resource("dynamodb").Table(os.environ["DYNAMO_TABLE"])
"""

import json
import sqlite3
import threading
from pathlib import Path
from typing import Any


class SqliteStore:
    """
    DynamoDB Table interface backed by SQLite.

    Items are stored as a single JSON blob column keyed by (pk, sk).
    This mirrors DynamoDB's schemaless attribute model — adding new
    attributes to items requires no schema change.

    The pk/sk column names are derived from the first put_item call,
    or can be set explicitly via SqliteStore(path, pk="user_id", sk="item_id").
    """

    def __init__(self, path: str, pk: str = "pk", sk: str | None = "sk"):
        self._path = Path(path)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._pk = pk
        self._sk = sk
        self._local = threading.local()
        self._ensure_table()

    def _conn(self) -> sqlite3.Connection:
        if not getattr(self._local, "conn", None):
            self._local.conn = sqlite3.connect(str(self._path), check_same_thread=False)
            self._local.conn.row_factory = sqlite3.Row
        return self._local.conn

    def _ensure_table(self) -> None:
        self._conn().execute("""
            CREATE TABLE IF NOT EXISTS items (
                pk   TEXT NOT NULL,
                sk   TEXT NOT NULL DEFAULT '__none__',
                data TEXT NOT NULL DEFAULT '{}',
                PRIMARY KEY (pk, sk)
            )
        """)
        self._conn().commit()

    # ── Helpers ─────────────────────────────────────────────────────────

    def _row_to_item(self, row) -> dict:
        item = json.loads(row["data"])
        item[self._pk] = row["pk"]
        if self._sk and row["sk"] != "__none__":
            item[self._sk] = row["sk"]
        return item

    def _item_to_row(self, item: dict) -> tuple[str, str, str]:
        pk_val = str(item.get(self._pk, ""))
        sk_val = str(item.get(self._sk, "")) if self._sk else "__none__"
        # Store all non-key attrs in data blob
        data = {k: v for k, v in item.items() if k not in (self._pk, self._sk)}
        return pk_val, sk_val, json.dumps(data)

    # ── DynamoDB Table interface ─────────────────────────────────────────

    def put_item(self, Item: dict, **kwargs) -> dict:
        pk, sk, data = self._item_to_row(Item)
        self._conn().execute(
            "INSERT OR REPLACE INTO items (pk, sk, data) VALUES (?, ?, ?)",
            (pk, sk, data)
        )
        self._conn().commit()
        return {}

    def get_item(self, Key: dict, **kwargs) -> dict:
        pk = str(Key.get(self._pk, ""))
        sk = str(Key.get(self._sk, "")) if self._sk else "__none__"
        row = self._conn().execute(
            "SELECT * FROM items WHERE pk=? AND sk=?", (pk, sk)
        ).fetchone()
        return {"Item": self._row_to_item(row)} if row else {}

    def delete_item(self, Key: dict, **kwargs) -> dict:
        pk = str(Key.get(self._pk, ""))
        sk = str(Key.get(self._sk, "")) if self._sk else "__none__"
        self._conn().execute("DELETE FROM items WHERE pk=? AND sk=?", (pk, sk))
        self._conn().commit()
        return {}

    def update_item(self, Key: dict, UpdateExpression: str = "",
                    ExpressionAttributeValues: dict | None = None, **kwargs) -> dict:
        """Minimal UpdateExpression support: SET attr = :val."""
        existing = self.get_item(Key=Key).get("Item", {})
        if ExpressionAttributeValues:
            # Parse "SET a = :a, b = :b"
            import re
            for match in re.finditer(r"(\w+)\s*=\s*(:\w+)", UpdateExpression or ""):
                attr, placeholder = match.group(1), match.group(2)
                if placeholder in ExpressionAttributeValues:
                    existing[attr] = ExpressionAttributeValues[placeholder]
        self.put_item(Item={**existing, **{k: v for k, v in Key.items()}})
        return {"Attributes": existing}

    def scan(self, **kwargs) -> dict:
        rows = self._conn().execute("SELECT * FROM items").fetchall()
        items = [self._row_to_item(r) for r in rows]
        # FilterExpression support (basic equality only)
        fe = kwargs.get("FilterExpression")
        eav = kwargs.get("ExpressionAttributeValues", {})
        ean = kwargs.get("ExpressionAttributeNames", {})
        if fe and eav:
            items = _apply_filter(items, fe, eav, ean)
        return {"Items": items, "Count": len(items), "ScannedCount": len(items)}

    def query(self, KeyConditionExpression: Any = None,
              ExpressionAttributeValues: dict | None = None,
              ExpressionAttributeNames: dict | None = None,
              IndexName: str | None = None, **kwargs) -> dict:
        """Query by pk (required). Optional sk filter. IndexName is ignored locally."""
        eav = ExpressionAttributeValues or {}
        ean = ExpressionAttributeNames or {}
        # Extract pk value from KeyConditionExpression string patterns
        pk_val = None
        sk_cond = None
        if isinstance(KeyConditionExpression, str):
            import re
            # Handle "#n = :v" style
            m = re.search(r"(?:#\w+|\w+)\s*=\s*(:\w+)", KeyConditionExpression)
            if m:
                placeholder = m.group(1)
                pk_val = str(eav.get(placeholder, ""))
        else:
            # boto3 ConditionExpression object — extract via .values
            try:
                vals = list(KeyConditionExpression.values.values())
                if vals:
                    pk_val = str(vals[0])
            except Exception:
                pass

        if pk_val is None:
            return self.scan(**kwargs)

        rows = self._conn().execute(
            "SELECT * FROM items WHERE pk=?", (pk_val,)
        ).fetchall()
        items = [self._row_to_item(r) for r in rows]
        fe = kwargs.get("FilterExpression")
        if fe and eav:
            items = _apply_filter(items, fe, eav, ean)
        return {"Items": items, "Count": len(items), "ScannedCount": len(items)}


def _apply_filter(items: list, fe: Any, eav: dict, ean: dict) -> list:
    """Very basic FilterExpression evaluator (equality checks only)."""
    if not isinstance(fe, str):
        return items  # skip complex expression objects locally
    import re
    conditions = re.findall(r"(\w+)\s*=\s*(:\w+)", fe)
    out = []
    for item in items:
        match = all(str(item.get(attr, "")) == str(eav.get(ph, ""))
                    for attr, ph in conditions)
        if match:
            out.append(item)
    return out
