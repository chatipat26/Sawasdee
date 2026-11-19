"""
pg_client.py - Direct PostgreSQL client with a simple table query-builder API.

Lets the app code (db.table("x").select("*").eq(...).execute().data)
run against a plain PostgreSQL database (e.g. a Dokploy Postgres container).

Supported query builder methods:
    select, eq, ilike, order, limit, insert, upsert, update, delete, execute
"""
import os
import time
import threading
import uuid
from contextlib import contextmanager
from datetime import date, datetime, time as d_time
from decimal import Decimal

try:
    import psycopg
    from psycopg import sql
    from psycopg.rows import dict_row
    from psycopg.types.json import Jsonb
except ImportError:
    try:
        import psycopg2 as psycopg
        from psycopg2 import sql
        from psycopg2.extras import RealDictCursor as dict_row, Json as Jsonb
    except ImportError:
        psycopg = None


def _is_conn_closed(conn) -> bool:
    """Return True if a psycopg/psycopg2 connection is closed or broken."""
    if conn is None:
        return True
    return bool(getattr(conn, "closed", False) or getattr(conn, "broken", False))


def _close_quietly(conn) -> None:
    if conn is None:
        return
    try:
        conn.close()
    except Exception:
        pass


class PsycopgConnectionPool:
    """
    Thread-safe PostgreSQL connection pool for psycopg v3 / psycopg2.
    Maintains min_size..max_size connections with checkout timeout and
    automatic health verification / recovery for dropped VPS connections.
    """

    def __init__(
        self,
        dsn: str,
        min_size: int = 2,
        max_size: int = 10,
        timeout: float = 15.0,
        connect_timeout: int = 5,
        max_idle_check_seconds: float = 15.0,
    ):
        if psycopg is None:
            raise RuntimeError("psycopg / psycopg2 driver is not installed")
        self._dsn = dsn
        self._min_size = max(0, int(min_size))
        self._max_size = max(1, int(max_size))
        if self._min_size > self._max_size:
            self._min_size = self._max_size
        self._timeout = float(timeout)
        self._connect_timeout = int(connect_timeout)
        self._max_idle_check_seconds = float(max_idle_check_seconds)
        self._cond = threading.Condition(threading.RLock())
        self._idle: list[tuple[object, float]] = []
        self._total_created = 0
        self._in_use = 0
        self._closed = False
        self._warm_up()

    def _open_connection(self):
        return psycopg.connect(
            self._dsn,
            autocommit=True,
            row_factory=dict_row,
            connect_timeout=self._connect_timeout,
        )

    def _ping_connection(self, conn) -> bool:
        if _is_conn_closed(conn):
            return False
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
            return True
        except Exception:
            return False

    def _warm_up(self) -> None:
        """Best-effort warm-up up to min_size connections without failing on transient outages."""
        for _ in range(self._min_size):
            with self._cond:
                if self._closed or self._total_created >= self._min_size:
                    return
                self._total_created += 1
            try:
                conn = self._open_connection()
            except Exception as e:
                with self._cond:
                    self._total_created = max(0, self._total_created - 1)
                print(f"[PgPool] Warm-up skipped: {e}")
                return
            with self._cond:
                if self._closed:
                    _close_quietly(conn)
                    self._total_created = max(0, self._total_created - 1)
                    return
                self._idle.append((conn, time.time()))
                self._cond.notify_all()

    def acquire(self):
        """Acquire a healthy connection from the pool, waiting up to self._timeout seconds."""
        deadline = time.monotonic() + self._timeout
        while True:
            conn = None
            last_used = 0.0
            should_open = False

            with self._cond:
                if self._closed:
                    raise RuntimeError("PostgreSQL connection pool is closed")

                if self._idle:
                    conn, last_used = self._idle.pop()
                    self._in_use += 1
                elif self._total_created < self._max_size:
                    self._total_created += 1
                    self._in_use += 1
                    should_open = True
                else:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise TimeoutError(
                            f"PostgreSQL connection pool exhausted "
                            f"(max_size={self._max_size}, timeout={self._timeout}s)"
                        )
                    self._cond.wait(timeout=remaining)
                    continue

            if should_open:
                try:
                    return self._open_connection()
                except Exception:
                    with self._cond:
                        self._in_use = max(0, self._in_use - 1)
                        self._total_created = max(0, self._total_created - 1)
                        self._cond.notify_all()
                    raise

            # Validate idle connection outside the pool lock
            needs_ping = (time.time() - last_used) > self._max_idle_check_seconds
            if not _is_conn_closed(conn) and (not needs_ping or self._ping_connection(conn)):
                return conn

            _close_quietly(conn)
            with self._cond:
                self._in_use = max(0, self._in_use - 1)
                self._total_created = max(0, self._total_created - 1)
                self._cond.notify_all()

    def release(self, conn, discard: bool = False) -> None:
        """Return a connection back to the pool, or discard it if broken/closed."""
        if conn is None:
            return
        broken = discard or _is_conn_closed(conn)
        with self._cond:
            self._in_use = max(0, self._in_use - 1)
            if broken or self._closed:
                _close_quietly(conn)
                self._total_created = max(0, self._total_created - 1)
            else:
                self._idle.append((conn, time.time()))
            self._cond.notify()

    @contextmanager
    def connection(self):
        """Context manager that always returns or discards the checked-out connection."""
        conn = self.acquire()
        discard = False
        try:
            yield conn
        except psycopg.OperationalError:
            discard = True
            raise
        except Exception:
            if _is_conn_closed(conn):
                discard = True
            raise
        finally:
            if not discard and _is_conn_closed(conn):
                discard = True
            self.release(conn, discard=discard)

    def get_stats(self) -> dict:
        with self._cond:
            return {
                "min_size": self._min_size,
                "max_size": self._max_size,
                "total_connections": self._total_created,
                "idle_connections": len(self._idle),
                "in_use_connections": self._in_use,
            }

    def close_all(self) -> None:
        with self._cond:
            self._closed = True
            while self._idle:
                conn, _ = self._idle.pop()
                _close_quietly(conn)
                self._total_created = max(0, self._total_created - 1)
            self._cond.notify_all()


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
        known_cols = set(self._client.table_columns(self._table)) if hasattr(self._client, "table_columns") else set()
        for row in self._rows():
            if known_cols:
                cols = [c for c in row.keys() if c in known_cols]
            else:
                cols = list(row.keys())
            if not cols:
                continue
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
    def __init__(self, dsn, min_size=None, max_size=None, timeout=None):
        self._dsn = dsn
        pool_min = int(min_size if min_size is not None else os.getenv("DB_POOL_MIN_SIZE", "2"))
        pool_max = int(max_size if max_size is not None else os.getenv("DB_POOL_MAX_SIZE", "10"))
        pool_timeout = float(timeout if timeout is not None else os.getenv("DB_POOL_TIMEOUT", "15.0"))
        connect_timeout = int(os.getenv("DB_CONNECT_TIMEOUT", "5"))
        self._pool = PsycopgConnectionPool(
            dsn,
            min_size=pool_min,
            max_size=pool_max,
            timeout=pool_timeout,
            connect_timeout=connect_timeout,
        )
        self._schema_lock = threading.Lock()
        self._meta_lock = threading.RLock()
        self._pk_cache = {}
        self._cols_cache = {}
        self._schema_checked = False

    @contextmanager
    def connection(self):
        """Checkout a pooled connection via context manager and return it on exit."""
        with self._pool.connection() as conn:
            yield conn

    def get_pool_stats(self) -> dict:
        return self._pool.get_stats()

    def close(self) -> None:
        self._pool.close_all()

    def ensure_schema(self):
        if self._schema_checked:
            return
        with self._schema_lock:
            if self._schema_checked:
                return
            with self.connection() as conn:
                try:
                    schema_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "schema.sql")
                    if os.path.exists(schema_path):
                        with open(schema_path, "r", encoding="utf-8") as sf:
                            schema_sql = sf.read()
                        with conn.cursor() as cur:
                            cur.execute(schema_sql)
                    with conn.cursor() as cur:
                        cur.execute("ALTER TABLE IF EXISTS public.users ADD COLUMN IF NOT EXISTS line_user_id TEXT;")
                        cur.execute("ALTER TABLE IF EXISTS public.customers ADD COLUMN IF NOT EXISTS line_user_id TEXT;")
                        # Force migration for all 34 vehicle columns
                        car_migrations = [
                            "CREATE TABLE IF NOT EXISTS public.cars (plate VARCHAR(50) PRIMARY KEY);",
                            "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS brand VARCHAR(100);",
                            "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS model VARCHAR(100);",
                            "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS car_group VARCHAR(100);",
                            "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS fuel_system VARCHAR(50);",
                            "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS cc_ev VARCHAR(50);",
                            "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS owner_company VARCHAR(150);",
                            "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS color VARCHAR(50);",
                            "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS mileage VARCHAR(50);",
                            "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS daily_rate NUMERIC DEFAULT 0;",
                            "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS weekly_rate NUMERIC DEFAULT 0;",
                            "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS monthly_rate NUMERIC DEFAULT 0;",
                            "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS vin VARCHAR(100);",
                            "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS tax_expire_date VARCHAR(50);",
                            "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS prb_expire_date VARCHAR(50);",
                            "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS insurance_expire_date VARCHAR(50);",
                            "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS insurance_company VARCHAR(150);",
                            "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS car_owner VARCHAR(150);",
                            "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS beneficiary VARCHAR(150);",
                            "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS register_year VARCHAR(50);",
                            "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS prb_price NUMERIC DEFAULT 0;",
                            "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS insurance_premium NUMERIC DEFAULT 0;",
                            "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS last_service_date VARCHAR(50);",
                            "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS next_service_date VARCHAR(50);",
                            "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS next_service_mileage NUMERIC DEFAULT 0;",
                            "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS car_status VARCHAR(50);",
                            "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS is_debt_free BOOLEAN DEFAULT FALSE;",
                            "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS finance_company VARCHAR(150);",
                            "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS installment_amount NUMERIC DEFAULT 0;",
                            "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS total_installments INTEGER DEFAULT 0;",
                            "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS current_installment INTEGER DEFAULT 0;",
                            "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS payment_due_date VARCHAR(50);",
                            "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS notes TEXT;",
                            "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS image_url TEXT;",
                            "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS act_policy_no VARCHAR(100);",
                            "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS act_company VARCHAR(150);",
                            "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS ins_policy_no VARCHAR(100);",
                            "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS ins_company VARCHAR(150);",
                            "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS ins_category VARCHAR(100);",
                            "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS ins_coverage_amount NUMERIC DEFAULT 0;",
                            "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS ins_type VARCHAR(100);",
                            "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS ins_class VARCHAR(50);",
                            "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS insurance_policy_no VARCHAR(100);",
                            "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS policy_no VARCHAR(100);",
                            "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS tax_expiry VARCHAR(50);",
                            "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS act_expiry VARCHAR(50);",
                            "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS ins_expiry VARCHAR(50);",
                            "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS engine_cc VARCHAR(50);",
                            "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS fuel_type VARCHAR(50);",
                            "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS company VARCHAR(150);",
                            "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS price_day NUMERIC DEFAULT 0;",
                            "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS price_week NUMERIC DEFAULT 0;",
                            "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS price_month NUMERIC DEFAULT 0;",
                            "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS status VARCHAR(50);",
                            "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS chassis_no VARCHAR(100);",
                            "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS owner VARCHAR(150);",
                            "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS owner_name VARCHAR(150);",
                            "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS reg_year VARCHAR(50);",
                            "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS act_price NUMERIC DEFAULT 0;",
                            "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS ins_premium NUMERIC DEFAULT 0;",
                            "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS engine_no VARCHAR(100);"
                        ]
                        for m_sql in car_migrations:
                            cur.execute(m_sql)
                        with self._meta_lock:
                            self._cols_cache = {}
                        cur.execute("ALTER TABLE IF EXISTS public.bookings ADD COLUMN IF NOT EXISTS payment_type VARCHAR(50);")
                        cur.execute("ALTER TABLE IF EXISTS public.bookings ADD COLUMN IF NOT EXISTS google_drive_link TEXT;")
                        cur.execute("ALTER TABLE IF EXISTS public.bookings ADD COLUMN IF NOT EXISTS contract_pdf_url TEXT;")
                        cur.execute("ALTER TABLE IF EXISTS public.bookings ADD COLUMN IF NOT EXISTS checkout_pdf_url VARCHAR(500);")
                        cur.execute("ALTER TABLE IF EXISTS public.bookings ADD COLUMN IF NOT EXISTS checkin_pdf_url VARCHAR(500);")
                        cur.execute("ALTER TABLE IF EXISTS public.bookings ADD COLUMN IF NOT EXISTS extension_history JSONB DEFAULT '[]'::jsonb;")
                        cur.execute("ALTER TABLE IF EXISTS public.bookings ADD COLUMN IF NOT EXISTS is_fully_paid BOOLEAN DEFAULT FALSE;")

                    print("✅ PostgreSQL cars (34 cols) schema ensured via ALTER TABLE.")
                except Exception as e:
                    print(f"PostgreSQL Schema check note: {e}")
                self._migrate_customers(conn)
                self._migrate_bookings(conn)
                self._migrate_work_order_logs(conn)
                self._migrate_maintenance_logs(conn)
                self._migrate_insurance_records(conn)
                self._schema_checked = True

    def _migrate_insurance_records(self, conn):
        try:
            with conn.cursor() as cur:
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS public.insurance_records (
                        id VARCHAR(100) PRIMARY KEY,
                        car_id VARCHAR(50) NOT NULL,
                        ins_company VARCHAR(150),
                        ins_policy_no VARCHAR(100),
                        ins_class VARCHAR(50),
                        ins_category VARCHAR(100),
                        ins_type VARCHAR(100),
                        ins_coverage_amount NUMERIC DEFAULT 0,
                        ins_premium NUMERIC DEFAULT 0,
                        expiry_date VARCHAR(50),
                        ins_doc_url TEXT,
                        notes TEXT,
                        created_by VARCHAR(100),
                        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
                    );
                    CREATE INDEX IF NOT EXISTS idx_insurance_records_car_id ON public.insurance_records(car_id);
                    CREATE INDEX IF NOT EXISTS idx_insurance_records_expiry ON public.insurance_records(expiry_date);
                    ALTER TABLE IF EXISTS public.insurance_records ADD COLUMN IF NOT EXISTS ins_doc_url TEXT;
                """)
            print("PostgreSQL insurance_records table ensured.")
        except Exception as e:
            print(f"Insurance records migration note: {e}")

    def _migrate_bookings(self, conn):
        try:
            with conn.cursor() as cur:
                cur.execute("ALTER TABLE IF EXISTS public.bookings ADD COLUMN IF NOT EXISTS payment_type VARCHAR(50);")
                cur.execute("ALTER TABLE IF EXISTS public.bookings ADD COLUMN IF NOT EXISTS google_drive_link TEXT;")
                cur.execute("ALTER TABLE IF EXISTS public.bookings ADD COLUMN IF NOT EXISTS contract_pdf_url TEXT;")
                cur.execute("ALTER TABLE IF EXISTS public.bookings ADD COLUMN IF NOT EXISTS checkout_pdf_url VARCHAR(500);")
                cur.execute("ALTER TABLE IF EXISTS public.bookings ADD COLUMN IF NOT EXISTS checkin_pdf_url VARCHAR(500);")
                cur.execute("ALTER TABLE IF EXISTS public.bookings ADD COLUMN IF NOT EXISTS inspection_categories JSONB DEFAULT '{}'::jsonb;")
                cur.execute("ALTER TABLE IF EXISTS public.bookings ADD COLUMN IF NOT EXISTS inspection_categories_out JSONB DEFAULT '{}'::jsonb;")
                cur.execute("ALTER TABLE IF EXISTS public.bookings ADD COLUMN IF NOT EXISTS inspection_categories_in JSONB DEFAULT '{}'::jsonb;")
                cur.execute("ALTER TABLE IF EXISTS public.bookings ADD COLUMN IF NOT EXISTS extension_history JSONB DEFAULT '[]'::jsonb;")
                cur.execute("ALTER TABLE IF EXISTS public.bookings ADD COLUMN IF NOT EXISTS is_fully_paid BOOLEAN DEFAULT FALSE;")
                cur.execute("ALTER TABLE IF EXISTS public.bookings ADD COLUMN IF NOT EXISTS checkin_img_front TEXT;")
                cur.execute("ALTER TABLE IF EXISTS public.bookings ADD COLUMN IF NOT EXISTS checkin_img_left TEXT;")
                cur.execute("ALTER TABLE IF EXISTS public.bookings ADD COLUMN IF NOT EXISTS checkin_img_rear TEXT;")
                cur.execute("ALTER TABLE IF EXISTS public.bookings ADD COLUMN IF NOT EXISTS checkin_img_right TEXT;")
            print("✅ PostgreSQL bookings schema ensured (contract_pdf_url, extension_history, is_fully_paid).")
        except Exception as e:
            print(f"PostgreSQL bookings migration note: {e}")

    def _migrate_work_order_logs(self, conn):
        try:
            with conn.cursor() as cur:
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS public.work_order_logs (
                        id VARCHAR(100) PRIMARY KEY,
                        car_id VARCHAR(100),
                        booking_id VARCHAR(100),
                        work_type VARCHAR(100),
                        description TEXT,
                        cost NUMERIC DEFAULT 0,
                        staff_id VARCHAR(150),
                        appointment_datetime TIMESTAMP WITH TIME ZONE,
                        location TEXT,
                        job_status VARCHAR(50) DEFAULT 'Pending',
                        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                    );
                    ALTER TABLE public.work_order_logs ADD COLUMN IF NOT EXISTS staff_id VARCHAR(150);
                    ALTER TABLE public.work_order_logs ADD COLUMN IF NOT EXISTS appointment_datetime TIMESTAMP WITH TIME ZONE;
                    ALTER TABLE public.work_order_logs ADD COLUMN IF NOT EXISTS location TEXT;
                    ALTER TABLE public.work_order_logs ADD COLUMN IF NOT EXISTS job_status VARCHAR(50) DEFAULT 'Pending';
                    ALTER TABLE public.work_order_logs ADD COLUMN IF NOT EXISTS cost NUMERIC DEFAULT 0;
                    ALTER TABLE public.work_order_logs ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
                """)
            print("PostgreSQL work_order_logs table ensured with expanded columns.")
        except Exception as e:
            print(f"Work order logs migration note: {e}")

    def _migrate_maintenance_logs(self, conn):
        try:
            with conn.cursor() as cur:
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS public.maintenance_logs (
                        id VARCHAR(100) PRIMARY KEY,
                        car_id VARCHAR(100),
                        date VARCHAR(50),
                        expense_type VARCHAR(100),
                        description TEXT,
                        cost NUMERIC DEFAULT 0,
                        recorded_by VARCHAR(100),
                        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                    );
                """)
                cur.execute("ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS insurance_policy_no VARCHAR(100);")
                cur.execute("ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS policy_no VARCHAR(100);")
                cur.execute("ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS tax_expiry VARCHAR(50);")
                cur.execute("ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS act_expiry VARCHAR(50);")
                cur.execute("ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS ins_expiry VARCHAR(50);")
                cur.execute("ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS ins_company VARCHAR(150);")
                cur.execute("ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS act_policy_no VARCHAR(100);")
                cur.execute("ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS ins_policy_no VARCHAR(100);")
                cur.execute("ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS ins_category VARCHAR(100);")
                cur.execute("ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS ins_coverage_amount NUMERIC DEFAULT 0;")
                cur.execute("ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS ins_type VARCHAR(100);")
                cur.execute("ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS ins_class VARCHAR(50);")
                cur.execute("ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS act_company VARCHAR(150);")
                cur.execute("ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS img_front TEXT;")
                cur.execute("ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS img_left TEXT;")
                cur.execute("ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS img_rear TEXT;")
                cur.execute("ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS img_right TEXT;")
                cur.execute("ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS ins_doc_url TEXT;")
                cur.execute("ALTER TABLE IF EXISTS public.maintenance_records ADD COLUMN IF NOT EXISTS ins_doc_url TEXT;")

                # Ensure financial_records table and columns
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS public.financial_records (
                        id BIGSERIAL PRIMARY KEY,
                        company VARCHAR(150),
                        type VARCHAR(50),
                        category VARCHAR(150),
                        amount NUMERIC DEFAULT 0,
                        ref VARCHAR(100),
                        date DATE,
                        detail TEXT,
                        description TEXT,
                        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
                    );
                """)
                cur.execute("ALTER TABLE IF EXISTS public.financial_records ADD COLUMN IF NOT EXISTS description TEXT;")
                cur.execute("ALTER TABLE IF EXISTS public.financial_records ADD COLUMN IF NOT EXISTS detail TEXT;")
                cur.execute("ALTER TABLE IF EXISTS public.financial_records ADD COLUMN IF NOT EXISTS ref VARCHAR(100);")
                cur.execute("ALTER TABLE IF EXISTS public.financial_records ADD COLUMN IF NOT EXISTS company VARCHAR(150);")
                try:
                    cur.execute("UPDATE public.cars SET ins_policy_no = COALESCE(NULLIF(ins_policy_no, ''), NULLIF(insurance_policy_no, '')) WHERE (ins_policy_no IS NULL OR ins_policy_no = '' OR ins_policy_no = '-') AND insurance_policy_no IS NOT NULL;")
                    cur.execute("UPDATE public.cars SET act_policy_no = COALESCE(NULLIF(act_policy_no, ''), NULLIF(policy_no, '')) WHERE (act_policy_no IS NULL OR act_policy_no = '' OR act_policy_no = '-') AND policy_no IS NOT NULL;")
                    cur.execute("UPDATE public.cars SET policy_no = COALESCE(NULLIF(policy_no, ''), NULLIF(act_policy_no, '')) WHERE (policy_no IS NULL OR policy_no = '' OR policy_no = '-') AND act_policy_no IS NOT NULL;")
                except Exception:
                    pass
            print("PostgreSQL maintenance_logs table and car columns ensured.")
        except Exception as e:
            print(f"Maintenance logs migration note: {e}")

    def _migrate_customers(self, conn):
        """Add the 10 customer columns and backfill them from legacy columns.
        Each statement runs on its own so one failure cannot skip the rest."""
        cols = [
            ("full_name", "VARCHAR(150)"), ("phone_number", "VARCHAR(50)"), ("id_card_no", "VARCHAR(50)"),
            ("driver_license_no", "VARCHAR(50)"), ("nationality", "VARCHAR(50)"), ("whatsapp", "VARCHAR(50)"),
            ("dob", "VARCHAR(50)"), ("license_expire_date", "VARCHAR(50)"), ("home_address", "TEXT"),
            ("current_address", "TEXT"), ("email", "VARCHAR(150)"), ("line_user_id", "TEXT"),
        ]
        stmts = ["CREATE TABLE IF NOT EXISTS public.customers (full_name VARCHAR(150) PRIMARY KEY);"]
        stmts += [f"ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS {n} {t};" for n, t in cols]
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT column_name FROM information_schema.columns "
                            "WHERE table_schema='public' AND table_name='customers'")
                existing = {r["column_name"] for r in cur.fetchall()}
        except Exception:
            existing = set()
        for s in stmts:
            try:
                with conn.cursor() as cur:
                    cur.execute(s)
            except Exception as e:
                print(f"Customer migration note: {e}")
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT column_name FROM information_schema.columns "
                            "WHERE table_schema='public' AND table_name='customers'")
                existing = {r["column_name"] for r in cur.fetchall()}
        except Exception:
            pass
        legacy = [
            ("phone_number", ["phone", "contact_no"]),
            ("id_card_no", ["id_card", "passport_id"]),
            ("driver_license_no", ["driver_license", "licence_no"]),
            ("license_expire_date", ["licence_expiry"]),
            ("home_address", ["thai_address", "address"]),
            ("current_address", ["address", "thai_address"]),
        ]
        for new, olds in legacy:
            for old in olds:
                if new in existing and old in existing:
                    try:
                        with conn.cursor() as cur:
                            cur.execute(
                                sql.SQL(
                                    "UPDATE public.customers SET {new} = {old} "
                                    "WHERE ({new} IS NULL OR {new} IN ('', '-')) "
                                    "AND {old} IS NOT NULL AND {old}::text NOT IN ('', '-')"
                                ).format(new=sql.Identifier(new), old=sql.Identifier(old))
                            )
                    except Exception as e:
                        print(f"Customer backfill note: {e}")
        defaults = {"nationality": "THAI", "whatsapp": "-", "dob": "-", "license_expire_date": "-",
                    "home_address": "-", "current_address": "-", "phone_number": "-",
                    "id_card_no": "-", "driver_license_no": "-"}
        for col, val in defaults.items():
            if col in existing:
                try:
                    with conn.cursor() as cur:
                        cur.execute(
                            sql.SQL("UPDATE public.customers SET {col} = %s WHERE {col} IS NULL").format(
                                col=sql.Identifier(col)
                            ),
                            (val,),
                        )
                except Exception as e:
                    print(f"Customer default note: {e}")
        print("PostgreSQL customers (10 cols) schema ensured and backfilled.")

    def run(self, statements):
        """Run statements in one transaction using a pooled connection; retry once on dropped link."""
        self.ensure_schema()
        for attempt in (1, 2):
            try:
                with self.connection() as conn:
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
                if attempt == 2:
                    raise

    def primary_key(self, table):
        with self._meta_lock:
            cached = self._pk_cache.get(table)
        if cached is not None:
            return cached
        rows = self.run([(
            sql.SQL(
                "SELECT a.attname AS col FROM pg_index i "
                "JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) "
                "WHERE i.indrelid = %s::regclass AND i.indisprimary"
            ),
            [f"public.{table}"],
        )])
        cols = [r["col"] for r in rows]
        with self._meta_lock:
            self._pk_cache[table] = cols
        return cols

    def table_columns(self, table):
        with self._meta_lock:
            cached = self._cols_cache.get(table)
        if cached is not None:
            return cached
        try:
            rows = self.run([(
                sql.SQL(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_schema = 'public' AND table_name = %s"
                ),
                [table]
            )])
            cols = [r["column_name"] for r in rows]
            if cols:
                with self._meta_lock:
                    self._cols_cache[table] = cols
            return cols
        except Exception as e:
            print(f"[pg_client] Error fetching columns for {table}: {e}")
            return []

    def table(self, name):
        return PgQuery(self, name)
