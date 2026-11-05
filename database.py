import os
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, declarative_base

INTERNAL_DATABASE_URL = "postgresql://sawasdeedb:Sawasdee_Secure_2026_Db@svvconnectct-sawasdeedb-m78xfy:5432/sawasdee_db"
DATABASE_URL = os.environ.get("DATABASE_URL", INTERNAL_DATABASE_URL)

if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

try:
    engine = create_engine(
        DATABASE_URL,
        pool_pre_ping=True,
        pool_recycle=300,
    )
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
except Exception as e:
    engine = None
    SessionLocal = None
    print(f"SQLAlchemy engine setup note: {e}")

Base = declarative_base()


def get_db():
    if SessionLocal is None:
        return
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """Ensure cars and customers tables and columns exist at startup."""
    if engine is None:
        return
    customer_migrations = [
        "CREATE TABLE IF NOT EXISTS public.customers (full_name VARCHAR(150) PRIMARY KEY);",
        "ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS full_name VARCHAR(150);",
        "ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS phone_number VARCHAR(50);",
        "ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS id_card_no VARCHAR(50);",
        "ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS driver_license_no VARCHAR(50);",
        "ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS nationality VARCHAR(50);",
        "ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS whatsapp VARCHAR(50);",
        "ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS dob VARCHAR(50);",
        "ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS license_expire_date VARCHAR(50);",
        "ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS home_address TEXT;",
        "ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS current_address TEXT;"
    ]
    car_migrations = [
        "CREATE TABLE IF NOT EXISTS public.cars (plate VARCHAR(50) PRIMARY KEY);",
        "ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS brand VARCHAR(100);",
        "ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS model VARCHAR(100);",
        "ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS car_group VARCHAR(100);",
        "ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS fuel_system VARCHAR(50);",
        "ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS cc_ev VARCHAR(50);",
        "ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS owner_company VARCHAR(150);",
        "ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS color VARCHAR(50);",
        "ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS mileage VARCHAR(50);",
        "ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS daily_rate NUMERIC DEFAULT 0;",
        "ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS weekly_rate NUMERIC DEFAULT 0;",
        "ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS monthly_rate NUMERIC DEFAULT 0;",
        "ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS vin VARCHAR(100);",
        "ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS tax_expire_date VARCHAR(50);",
        "ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS prb_expire_date VARCHAR(50);",
        "ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS insurance_expire_date VARCHAR(50);",
        "ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS insurance_company VARCHAR(150);",
        "ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS car_owner VARCHAR(150);",
        "ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS beneficiary VARCHAR(150);",
        "ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS register_year VARCHAR(50);",
        "ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS prb_price NUMERIC DEFAULT 0;",
        "ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS insurance_premium NUMERIC DEFAULT 0;",
        "ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS last_service_date VARCHAR(50);",
        "ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS next_service_date VARCHAR(50);",
        "ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS next_service_mileage NUMERIC DEFAULT 0;",
        "ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS car_status VARCHAR(50) DEFAULT 'ว่างพร้อมใช้งาน';",
        "ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS is_debt_free BOOLEAN DEFAULT FALSE;",
        "ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS installment_amount NUMERIC DEFAULT 0;",
        "ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS total_installments INTEGER DEFAULT 0;",
        "ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS current_installment INTEGER DEFAULT 0;",
        "ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS payment_due_date VARCHAR(50);",
        "ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS finance_company VARCHAR(150);",
        "ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS notes TEXT;",
        "ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS image_url TEXT;"
    ]
    booking_migrations = [
        "ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS payment_type VARCHAR(50);",
        "ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS google_drive_link TEXT;"
    ]
    try:
        with engine.begin() as conn:
            for sql_stmt in customer_migrations + car_migrations + booking_migrations:
                try:
                    conn.execute(text(sql_stmt))
                except Exception:
                    pass
    except Exception as e:
        print(f"init_db execution note: {e}")
