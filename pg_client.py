"""
pg_client.py - Direct PostgreSQL client with a simple table query-builder API.

Lets the app code (db.table("x").select("*").eq(...).execute().data)
run against a plain PostgreSQL database (e.g. a Dokploy Postgres container).

Supported query builder methods:
    select, eq, ilike, order, limit, insert, upsert, update, delete, execute
"""
import threading
import uuid
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
    def __init__(self, dsn):
        self._dsn = dsn
        self._conn = None
        self._lock = threading.RLock()
        self._pk_cache = {}
        self._schema_checked = False

    def _connection(self):
        if self._conn is None or self._conn.closed:
            self._conn = psycopg.connect(self._dsn, autocommit=True, row_factory=dict_row)
            if not self._schema_checked:
                self._schema_checked = True
                try:
                    schema_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "schema.sql")
                    if os.path.exists(schema_path):
                        with open(schema_path, "r", encoding="utf-8") as sf:
                            schema_sql = sf.read()
                        with self._conn.cursor() as cur:
                            cur.execute(schema_sql)
                    with self._conn.cursor() as cur:
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
                            "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS image_url TEXT;"
                        ]
                        for m_sql in car_migrations:
                            cur.execute(m_sql)
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
                self._migrate_customers()
                self._migrate_bookings()
                self._migrate_work_order_logs()
                self._migrate_maintenance_logs()
        return self._conn
    def _migrate_bookings(self):
        try:
            with self._conn.cursor() as cur:
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
            print("✅ PostgreSQL bookings schema ensured (contract_pdf_url, extension_history, is_fully_paid).")
        except Exception as e:
            print(f"PostgreSQL bookings migration note: {e}")

    def _migrate_work_order_logs(self):
        try:
            with self._conn.cursor() as cur:
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

    def _migrate_maintenance_logs(self):
        try:
            with self._conn.cursor() as cur:
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
            print("PostgreSQL maintenance_logs table and car columns ensured.")
        except Exception as e:
            print(f"Maintenance logs migration note: {e}")


    def _migrate_customers(self):
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
            with self._conn.cursor() as cur:
                cur.execute("SELECT column_name FROM information_schema.columns "
                            "WHERE table_schema='public' AND table_name='customers'")
                existing = {r["column_name"] for r in cur.fetchall()}
        except Exception:
            existing = set()
        for s in stmts:
            try:
                with self._conn.cursor() as cur:
                    cur.execute(s)
            except Exception as e:
                print(f"Customer migration note: {e}")
        try:
            with self._conn.cursor() as cur:
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
                        with self._conn.cursor() as cur:
                            cur.execute(
                                f"UPDATE public.customers SET {new} = {old} "
                                f"WHERE ({new} IS NULL OR {new} IN ('', '-')) "
                                f"AND {old} IS NOT NULL AND {old}::text NOT IN ('', '-')"
                            )
                    except Exception as e:
                        print(f"Customer backfill note: {e}")
        defaults = {"nationality": "THAI", "whatsapp": "-", "dob": "-", "license_expire_date": "-",
                    "home_address": "-", "current_address": "-", "phone_number": "-",
                    "id_card_no": "-", "driver_license_no": "-"}
        for col, val in defaults.items():
            if col in existing:
                try:
                    with self._conn.cursor() as cur:
                        cur.execute(f"UPDATE public.customers SET {col} = %s WHERE {col} IS NULL", (val,))
                except Exception as e:
                    print(f"Customer default note: {e}")
        print("PostgreSQL customers (10 cols) schema ensured and backfilled.")

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

    def table_columns(self, table):
        if not hasattr(self, "_cols_cache"):
            self._cols_cache = {}
        if table not in self._cols_cache:
            try:
                rows = self.run([(
                    sql.SQL(
                        "SELECT column_name FROM information_schema.columns "
                        "WHERE table_schema = 'public' AND table_name = %s"
                    ),
                    [table]
                )])
                self._cols_cache[table] = [r["column_name"] for r in rows]
            except Exception as e:
                print(f"[pg_client] Error fetching columns for {table}: {e}")
                self._cols_cache[table] = []
        return self._cols_cache[table]

    def table(self, name):
        return PgQuery(self, name)
