"""
pg_client.py - Direct PostgreSQL client with a supabase-py compatible API.

Lets the existing code (sb.table("x").select("*").eq(...).execute().data)
run unchanged against a plain PostgreSQL database (e.g. a Dokploy Postgres
container) instead of Supabase PostgREST.

Supported query builder methods:
    select, eq, ilike, order, limit, insert, upsert, update, delete, execute

Supabase-only features (auth, storage) are NOT available. Accessing them
raises an exception, which the existing code already catches and falls back
from (users-table password check, base64 photo storage).
"""
import threading
import uuid
from datetime import date, datetime, time as d_time
from decimal import Decimal

import psycopg
from psycopg import sql
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb


class PgUnsupportedFeature(Exception):
    pass


class _Unsupported:
    """Stand-in for sb.auth / sb.storage: any use raises PgUnsupportedFeature."""

    def __init__(self, feature):
        self._feature = feature

    def __getattr__(self, name):
        raise PgUnsupportedFeature(f"Supabase {self._feature} is not available on direct PostgreSQL")


class PgResult:
    def __init__(self, data):
        self.data = data
        self.count = len(data) if data is not None else 0


def _to_json_value(v):
    """Make values look like what PostgREST returns over JSON."""
    if isinstance(v, datetime):
        return v.isoformat()
    if isinstance(v, (date, d_time)):
        return v.isoformat()
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, uuid.UUID):
        return str(v)
    if isinstance(v, memoryview):
        return bytes(v).decode("utf-8", errors="replace")
    return v


def _to_db_value(v):
    if isinstance(v, (dict, list)):
        return Jsonb(v)
    return v


class PgQuery:
    def __init__(self, client, table):
        self._client = client
        self._table = table
        self._op = "select"
        self._columns = "*"
        self._filters = []  # (column, operator_sql, value)
        self._order = []  # (column, desc)
        self._limit = None
        self._payload = None

    # ---------- operation selectors ----------
    def select(self, columns="*", **_kwargs):
        self._op = "select"
        self._columns = columns or "*"
        return self

    def insert(self, rows, **_kwargs):
        self._op = "insert"
        self._payload = rows
        return self

    def upsert(self, rows, on_conflict=None, **_kwargs):
        self._op = "upsert"
        self._payload = rows
        self._on_conflict = on_conflict
        return self

    def update(self, values, **_kwargs):
        self._op = "update"
        self._payload = values
        return self

    def delete(self, **_kwargs):
        self._op = "delete"
        return self

    # ---------- filters / modifiers ----------
    def eq(self, column, value):
        self._filters.append((column, "=", value))
        return self

    def ilike(self, column, pattern):
        self._filters.append((column, "ILIKE", pattern))
        return self

    def order(self, column, desc=False, **_kwargs):
        self._order.append((column, desc))
        return self

    def limit(self, n, **_kwargs):
        self._limit = int(n)
        return self

    # ---------- SQL builders ----------
    def _where(self):
        if not self._filters:
            return sql.SQL(""), []
        parts, params = [], []
        for col, op, val in self._filters:
            parts.append(sql.SQL("{} " + op + " %s").format(sql.Identifier(col)))
            params.append(val)
        return sql.SQL(" WHERE ") + sql.SQL(" AND ").join(parts), params

    def _rows(self):
        rows = self._payload
        if isinstance(rows, dict):
            rows = [rows]
        return [r for r in (rows or []) if r]

    def _build_select(self):
        if self._columns.strip() == "*":
            cols = sql.SQL("*")
        else:
            cols = sql.SQL(", ").join(
                sql.Identifier(c.strip()) for c in self._columns.split(",") if c.strip()
            )
        q = sql.SQL("SELECT {} FROM {}").format(cols, sql.Identifier(self._table))
        where, params = self._where()
        q += where
        if self._order:
            q += sql.SQL(" ORDER BY ") + sql.SQL(", ").join(
                sql.SQL("{} {}").format(sql.Identifier(c), sql.SQL("DESC" if d else "ASC"))
                for c, d in self._order
            )
        if self._limit is not None:
            q += sql.SQL(" LIMIT {}").format(sql.Literal(self._limit))
        return [(q, params)]

    def _build_insert(self, upsert):
        statements = []
        conflict_cols = None
        if upsert:
            if getattr(self, "_on_conflict", None):
                conflict_cols = [c.strip() for c in self._on_conflict.split(",")]
            else:
                conflict_cols = self._client.primary_key(self._table)
        for row in self._rows():
            cols = list(row.keys())
            q = sql.SQL("INSERT INTO {} ({}) VALUES ({})").format(
                sql.Identifier(self._table),
                sql.SQL(", ").join(sql.Identifier(c) for c in cols),
                sql.SQL(", ").join(sql.Placeholder() for _ in cols),
            )
            if upsert and conflict_cols:
                update_cols = [c for c in cols if c not in conflict_cols]
                q += sql.SQL(" ON CONFLICT ({}) ").format(
                    sql.SQL(", ").join(sql.Identifier(c) for c in conflict_cols)
                )
                if update_cols:
                    q += sql.SQL("DO UPDATE SET ") + sql.SQL(", ").join(
                        sql.SQL("{} = EXCLUDED.{}").format(sql.Identifier(c), sql.Identifier(c))
                        for c in update_cols
                    )
                else:
                    q += sql.SQL("DO NOTHING")
            q += sql.SQL(" RETURNING *")
            statements.append((q, [_to_db_value(row[c]) for c in cols]))
        return statements

    def _build_update(self):
        values = self._payload or {}
        if not values:
            return []
        cols = list(values.keys())
        q = sql.SQL("UPDATE {} SET ").format(sql.Identifier(self._table)) + sql.SQL(", ").join(
            sql.SQL("{} = %s").format(sql.Identifier(c)) for c in cols
        )
        where, params = self._where()
        q += where + sql.SQL(" RETURNING *")
        return [(q, [_to_db_value(values[c]) for c in cols] + params)]

    def _build_delete(self):
        where, params = self._where()
        if not self._filters:
            # PostgREST refuses DELETE without filters; mirror that safety net.
            raise ValueError("DELETE requires at least one filter")
        q = sql.SQL("DELETE FROM {}").format(sql.Identifier(self._table)) + where
        q += sql.SQL(" RETURNING *")
        return [(q, params)]

    def execute(self):
        if self._op == "select":
            statements = self._build_select()
        elif self._op == "insert":
            statements = self._build_insert(upsert=False)
        elif self._op == "upsert":
            statements = self._build_insert(upsert=True)
        elif self._op == "update":
            statements = self._build_update()
        elif self._op == "delete":
            statements = self._build_delete()
        else:
            raise ValueError(f"Unknown operation {self._op}")
        return PgResult(self._client.run(statements))


class PgClient:
    def __init__(self, dsn):
        self._dsn = dsn
        self._conn = None
        self._lock = threading.RLock()
        self._pk_cache = {}
        self._schema_checked = False
        self.auth = _Unsupported("auth")
        self.storage = _Unsupported("storage")

    def _connection(self):
        if self._conn is None or self._conn.closed:
            self._conn = psycopg.connect(self._dsn, autocommit=True, row_factory=dict_row)
            if not self._schema_checked:
                self._schema_checked = True
                try:
                    with self._conn.cursor() as cur:
                        cur.execute("ALTER TABLE IF EXISTS public.users ADD COLUMN IF NOT EXISTS line_user_id TEXT;")
                        cur.execute("ALTER TABLE IF EXISTS public.customers ADD COLUMN IF NOT EXISTS line_user_id TEXT;")
                except Exception as e:
                    print(f"Schema check note: {e}")
        return self._conn

    def run(self, statements):
        """Run statements in one transaction; reconnect once if the connection dropped."""
        for attempt in (1, 2):
            with self._lock:
                try:
                    conn = self._connection()
                    out = []
                    with conn.transaction():
                        with conn.cursor() as cur:
                            for q, params in statements:
                                cur.execute(q, params)
                                if cur.description:
                                    out.extend(
                                        {k: _to_json_value(v) for k, v in r.items()} for r in cur.fetchall()
                                    )
                    return out
                except psycopg.OperationalError:
                    try:
                        if self._conn is not None:
                            self._conn.close()
                    except Exception:
                        pass
                    self._conn = None
                    if attempt == 2:
                        raise

    def primary_key(self, table):
        if table not in self._pk_cache:
            rows = self.run([(
                sql.SQL(
                    "SELECT a.attname AS col FROM pg_index i "
                    "JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) "
                    "WHERE i.indrelid = %s::regclass AND i.indisprimary"
                ),
                [f"public.{table}"],
            )])
            self._pk_cache[table] = [r["col"] for r in rows]
        return self._pk_cache[table]

    def table(self, name):
        return PgQuery(self, name)

    # supabase-py alias
    def from_(self, name):
        return self.table(name)
