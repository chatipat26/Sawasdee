import os
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, declarative_base


def load_env_file(env_path=None):
    """Load key-value pairs from .env into os.environ without overwriting existing env vars."""
    target = env_path or os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    try:
        from dotenv import load_dotenv
        load_dotenv(dotenv_path=target, override=False)
        return
    except ImportError:
        pass

    if not os.path.isfile(target):
        return
    try:
        with open(target, "r", encoding="utf-8") as f:
            for raw_line in f:
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                if line.startswith("export "):
                    line = line[len("export "):].strip()
                key, value = line.split("=", 1)
                key = key.strip()
                value = value.strip()
                if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
                    value = value[1:-1]
                if key:
                    os.environ.setdefault(key, value)
    except Exception as e:
        print(f"Environment file load note: {e}")


load_env_file()

DATABASE_URL = os.getenv("DATABASE_URL", "").strip()

if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

if DATABASE_URL:
    try:
        _is_pg = DATABASE_URL.startswith("postgresql")
        _connect_args = {"connect_timeout": int(os.getenv("DB_CONNECT_TIMEOUT", "5"))} if _is_pg else {}
        _pool_kwargs = {}
        if _is_pg:
            _pool_kwargs = {
                "pool_size": int(os.getenv("DB_POOL_MIN_SIZE", "2")),
                "max_overflow": int(os.getenv("DB_POOL_MAX_OVERFLOW", "8")),
                "pool_timeout": float(os.getenv("DB_POOL_TIMEOUT", "15")),
            }
        engine = create_engine(
            DATABASE_URL,
            pool_pre_ping=True,
            pool_recycle=300,
            connect_args=_connect_args,
            **_pool_kwargs,
        )
        SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    except Exception as e:
        engine = None
        SessionLocal = None
        print(f"SQLAlchemy engine setup note: {e}")
else:
    engine = None
    SessionLocal = None
    print("SQLAlchemy engine disabled: DATABASE_URL environment variable is not set.")

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
        "ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS current_address TEXT;",
        "ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS notes TEXT;",
        "ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS crm_tier VARCHAR(50);",
        "ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS watchlist_note TEXT;"
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
        "ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS image_url TEXT;",
        "ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS tax_status VARCHAR(50) DEFAULT 'รอชำระ';",
        "ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS prb_status VARCHAR(50) DEFAULT 'รอชำระ';",
        "ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS insurance_status VARCHAR(50) DEFAULT 'รอชำระ';",
        "ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS installment_status VARCHAR(50) DEFAULT 'รอชำระ';",
        "ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS owner VARCHAR(150);",
        "ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS owner_name VARCHAR(150);",
        "ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS reg_year VARCHAR(50);",
        "ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS registration_year VARCHAR(50);",
        "ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS chassis_no VARCHAR(100);",
        "ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS tax_expiry VARCHAR(50);",
        "ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS act_expiry VARCHAR(50);",
        "ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS ins_expiry VARCHAR(50);",
        "ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS ins_company VARCHAR(150);",
        "ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS act_price NUMERIC DEFAULT 0;",
        "ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS ins_premium NUMERIC DEFAULT 0;",
        "ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS next_engine_oil_date VARCHAR(50);",
        "ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS next_engine_oil_mileage NUMERIC DEFAULT 0;",
        "ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS img_front TEXT;",
        "ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS img_left TEXT;",
        "ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS img_rear TEXT;",
        "ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS img_right TEXT;",
        "ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS ins_doc_url TEXT;"
    ]
    booking_migrations = [
        "ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS payment_type VARCHAR(50);",
        "ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS google_drive_link TEXT;",
        "ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS payment_slip_url TEXT;",
        "ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS remaining_slip_link TEXT;",
        "ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS contract_pdf_url TEXT;",
        "ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS checkout_pdf_url VARCHAR(500);",
        "ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS checkin_pdf_url VARCHAR(500);",
        "ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS extension_history JSONB DEFAULT '[]'::jsonb;",
        "ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS is_fully_paid BOOLEAN DEFAULT FALSE;",
        "ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS checkin_img_front TEXT;",
        "ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS checkin_img_left TEXT;",
        "ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS checkin_img_rear TEXT;",
        "ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS checkin_img_right TEXT;",
        "ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS pricing_version SMALLINT DEFAULT 1;",
        "ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS delivery_mode VARCHAR(10) DEFAULT 'branch';",
        "ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS pickup_mode VARCHAR(10) DEFAULT 'branch';",
        "ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS delivery_fee NUMERIC DEFAULT 0;",
        "ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS pickup_fee NUMERIC DEFAULT 0;",
        "ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS fees_paid_amount NUMERIC DEFAULT 0;",
        "ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS delivery_zone VARCHAR(100);",
        "ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS pickup_zone VARCHAR(100);",
        "ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS delivery_map_url TEXT;",
        "ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS pickup_map_url TEXT;",
        "ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS received_by VARCHAR(100);",
        "ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS rental_payment_date DATE;",
        "ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS deposit_date DATE;",
        "ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS deposit_waived BOOLEAN DEFAULT FALSE;",
        "ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS driver2_name VARCHAR(200);",
        "ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS driver2_licence VARCHAR(50);",
        "ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS driver2_dob VARCHAR(20);",
        "ALTER TABLE public.completed_jobs ADD COLUMN IF NOT EXISTS pricing_version SMALLINT DEFAULT 1;",
        "ALTER TABLE public.completed_jobs ADD COLUMN IF NOT EXISTS delivery_mode VARCHAR(10) DEFAULT 'branch';",
        "ALTER TABLE public.completed_jobs ADD COLUMN IF NOT EXISTS pickup_mode VARCHAR(10) DEFAULT 'branch';",
        "ALTER TABLE public.completed_jobs ADD COLUMN IF NOT EXISTS delivery_fee NUMERIC DEFAULT 0;",
        "ALTER TABLE public.completed_jobs ADD COLUMN IF NOT EXISTS pickup_fee NUMERIC DEFAULT 0;",
        "ALTER TABLE public.completed_jobs ADD COLUMN IF NOT EXISTS fees_paid_amount NUMERIC DEFAULT 0;",
        "ALTER TABLE public.completed_jobs ADD COLUMN IF NOT EXISTS delivery_zone VARCHAR(100);",
        "ALTER TABLE public.completed_jobs ADD COLUMN IF NOT EXISTS pickup_zone VARCHAR(100);",
        "ALTER TABLE public.completed_jobs ADD COLUMN IF NOT EXISTS delivery_map_url TEXT;",
        "ALTER TABLE public.completed_jobs ADD COLUMN IF NOT EXISTS pickup_map_url TEXT;",
        "ALTER TABLE public.completed_jobs ADD COLUMN IF NOT EXISTS received_by VARCHAR(100);",
        "ALTER TABLE public.completed_jobs ADD COLUMN IF NOT EXISTS rental_payment_date DATE;",
        "ALTER TABLE public.completed_jobs ADD COLUMN IF NOT EXISTS deposit_date DATE;",
        "ALTER TABLE public.completed_jobs ADD COLUMN IF NOT EXISTS deposit_waived BOOLEAN DEFAULT FALSE;",
        """CREATE TABLE IF NOT EXISTS public.delivery_zones (
            id SERIAL PRIMARY KEY,
            zone_name VARCHAR(100) UNIQUE NOT NULL,
            default_delivery_fee NUMERIC DEFAULT 0,
            default_pickup_fee NUMERIC DEFAULT 0,
            is_active BOOLEAN DEFAULT TRUE,
            sort_order INTEGER DEFAULT 0,
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );"""
    ]
    maintenance_migrations = [
        """CREATE TABLE IF NOT EXISTS public.maintenance_records (
            id VARCHAR(50) PRIMARY KEY,
            car_id VARCHAR(50),
            car_brand VARCHAR(100),
            car_model VARCHAR(100),
            car_color VARCHAR(50),
            order_type VARCHAR(100),
            service_items TEXT,
            cost NUMERIC DEFAULT 0,
            actual_cost NUMERIC DEFAULT 0,
            service_center VARCHAR(150),
            service_center_phone VARCHAR(50),
            service_location VARCHAR(150),
            assigned_worker VARCHAR(100),
            schedule_date DATE,
            schedule_time VARCHAR(50),
            expected_finish_date DATE,
            expected_finish_time VARCHAR(50),
            status VARCHAR(50) DEFAULT 'รอดำเนินการ',
            current_mileage VARCHAR(50),
            notes TEXT,
            completion_notes TEXT,
            update_car_status BOOLEAN DEFAULT TRUE,
            created_by VARCHAR(100),
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            completed_at TIMESTAMPTZ,
            new_act_expiry VARCHAR(50),
            new_ins_expiry VARCHAR(50),
            new_tax_expiry VARCHAR(50),
            insurance_company VARCHAR(150),
            policy_no VARCHAR(100)
        );""",
        "ALTER TABLE public.maintenance_records ADD COLUMN IF NOT EXISTS service_items TEXT;",
        "ALTER TABLE public.maintenance_records ADD COLUMN IF NOT EXISTS cost NUMERIC DEFAULT 0;",
        "ALTER TABLE public.maintenance_records ADD COLUMN IF NOT EXISTS actual_cost NUMERIC DEFAULT 0;",
        "ALTER TABLE public.maintenance_records ADD COLUMN IF NOT EXISTS service_center VARCHAR(150);",
        "ALTER TABLE public.maintenance_records ADD COLUMN IF NOT EXISTS service_center_phone VARCHAR(50);",
        "ALTER TABLE public.maintenance_records ADD COLUMN IF NOT EXISTS service_location VARCHAR(150);",
        "ALTER TABLE public.maintenance_records ADD COLUMN IF NOT EXISTS assigned_worker VARCHAR(100);",
        "ALTER TABLE public.maintenance_records ADD COLUMN IF NOT EXISTS schedule_date DATE;",
        "ALTER TABLE public.maintenance_records ADD COLUMN IF NOT EXISTS schedule_time VARCHAR(50);",
        "ALTER TABLE public.maintenance_records ADD COLUMN IF NOT EXISTS expected_finish_date DATE;",
        "ALTER TABLE public.maintenance_records ADD COLUMN IF NOT EXISTS expected_finish_time VARCHAR(50);",
        "ALTER TABLE public.maintenance_records ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'รอดำเนินการ';",
        "ALTER TABLE public.maintenance_records ADD COLUMN IF NOT EXISTS current_mileage VARCHAR(50);",
        "ALTER TABLE public.maintenance_records ADD COLUMN IF NOT EXISTS notes TEXT;",
        "ALTER TABLE public.maintenance_records ADD COLUMN IF NOT EXISTS completion_notes TEXT;",
        "ALTER TABLE public.maintenance_records ADD COLUMN IF NOT EXISTS update_car_status BOOLEAN DEFAULT TRUE;",
        "ALTER TABLE public.maintenance_records ADD COLUMN IF NOT EXISTS created_by VARCHAR(100);",
        "ALTER TABLE public.maintenance_records ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;",
        "ALTER TABLE public.maintenance_records ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;",
        "ALTER TABLE public.maintenance_records ADD COLUMN IF NOT EXISTS new_act_expiry VARCHAR(50);",
        "ALTER TABLE public.maintenance_records ADD COLUMN IF NOT EXISTS new_ins_expiry VARCHAR(50);",
        "ALTER TABLE public.maintenance_records ADD COLUMN IF NOT EXISTS new_tax_expiry VARCHAR(50);",
        "ALTER TABLE public.maintenance_records ADD COLUMN IF NOT EXISTS insurance_company VARCHAR(150);",
        "ALTER TABLE public.maintenance_records ADD COLUMN IF NOT EXISTS policy_no VARCHAR(100);",
        "ALTER TABLE public.maintenance_records ADD COLUMN IF NOT EXISTS ins_doc_url TEXT;",
        """CREATE TABLE IF NOT EXISTS public.vehicle_maintenances (
            id SERIAL PRIMARY KEY,
            car_id VARCHAR(50) NOT NULL,
            date VARCHAR(50) NOT NULL,
            description TEXT NOT NULL,
            cost NUMERIC DEFAULT 0,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );""",
        "CREATE INDEX IF NOT EXISTS idx_vehicle_maintenances_car_id ON public.vehicle_maintenances(car_id);"
    ]
    financial_migrations = [
        """CREATE TABLE IF NOT EXISTS public.financial_records (
            id BIGSERIAL PRIMARY KEY,
            date TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            type VARCHAR(50),
            category VARCHAR(150),
            amount NUMERIC DEFAULT 0,
            description TEXT,
            ref_id VARCHAR(100)
        );""",
        "ALTER TABLE public.financial_records ADD COLUMN IF NOT EXISTS date TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;",
        "ALTER TABLE public.financial_records ADD COLUMN IF NOT EXISTS type VARCHAR(50);",
        "ALTER TABLE public.financial_records ADD COLUMN IF NOT EXISTS category VARCHAR(150);",
        "ALTER TABLE public.financial_records ADD COLUMN IF NOT EXISTS amount NUMERIC DEFAULT 0;",
        "ALTER TABLE public.financial_records ADD COLUMN IF NOT EXISTS description TEXT;",
        "ALTER TABLE public.financial_records ADD COLUMN IF NOT EXISTS ref_id VARCHAR(100);",
        "ALTER TABLE public.financial_records ADD COLUMN IF NOT EXISTS payment_method VARCHAR(100);",
        "ALTER TABLE public.financial_records ADD COLUMN IF NOT EXISTS slip_image_url TEXT;",
        "ALTER TABLE public.financial_records ADD COLUMN IF NOT EXISTS ref VARCHAR(100);",
        "ALTER TABLE public.financial_records ADD COLUMN IF NOT EXISTS detail TEXT;",
        "ALTER TABLE public.financial_records ADD COLUMN IF NOT EXISTS company VARCHAR(150);"
    ]
    work_order_logs_migrations = [
        """CREATE TABLE IF NOT EXISTS public.work_order_logs (
            id VARCHAR(100) PRIMARY KEY,
            car_id VARCHAR(100),
            booking_id VARCHAR(100),
            work_type VARCHAR(100),
            description TEXT,
            cost NUMERIC DEFAULT 0,
            staff_id VARCHAR(150),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );""",
        "ALTER TABLE public.work_order_logs ADD COLUMN IF NOT EXISTS staff_id VARCHAR(150);",
        "ALTER TABLE public.work_order_logs ADD COLUMN IF NOT EXISTS appointment_datetime TIMESTAMP WITH TIME ZONE;",
        "ALTER TABLE public.work_order_logs ADD COLUMN IF NOT EXISTS location TEXT;",
        "ALTER TABLE public.work_order_logs ADD COLUMN IF NOT EXISTS job_status VARCHAR(50) DEFAULT 'Pending';",
        "ALTER TABLE public.work_order_logs ADD COLUMN IF NOT EXISTS cost NUMERIC DEFAULT 0;",
        "ALTER TABLE public.work_order_logs ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;"
    ]
    sanitization_migrations = [
        """UPDATE public.cars 
        SET car_status = 'ว่างพร้อมใช้งาน', status = 'ว่างพร้อมใช้งาน' 
        WHERE (car_status IN ('ซ่อมบำรุง', 'ต่อทะเบียน/ประกัน', 'สถานะซ่อมบำรุง', 'กำลังซ่อมบำรุง', 'กำลังต่อภาษี/ประกัน', 'maintenance', 'Repair')
               OR status IN ('ซ่อมบำรุง', 'ต่อทะเบียน/ประกัน', 'สถานะซ่อมบำรุง', 'กำลังซ่อมบำรุง', 'กำลังต่อภาษี/ประกัน', 'maintenance', 'Repair'))
          AND plate NOT IN (
              SELECT DISTINCT car_id FROM public.work_order_logs 
              WHERE car_id IS NOT NULL 
                AND (work_type ILIKE '%Tax%' OR work_type ILIKE '%Repair%' OR work_type ILIKE '%Maintenance%' OR work_type ILIKE '%ซ่อม%' OR work_type ILIKE '%ภาษี%')
                AND job_status NOT IN ('Completed', 'เสร็จสิ้น', 'Canceled', 'ยกเลิก')
          )
          AND plate NOT IN (
              SELECT DISTINCT car_id FROM public.maintenance_records 
              WHERE car_id IS NOT NULL 
                AND status NOT IN ('เสร็จสิ้น', 'ยกเลิก', 'Completed', 'Canceled')
          );""",
        """UPDATE public.cars 
        SET car_status = 'ว่างพร้อมใช้งาน', status = 'ว่างพร้อมใช้งาน' 
        WHERE (car_status IN ('ซ่อมบำรุง', 'ต่อทะเบียน/ประกัน', 'สถานะซ่อมบำรุง', 'กำลังซ่อมบำรุง', 'กำลังต่อภาษี/ประกัน', 'maintenance', 'Repair')
               OR status IN ('ซ่อมบำรุง', 'ต่อทะเบียน/ประกัน', 'สถานะซ่อมบำรุง', 'กำลังซ่อมบำรุง', 'กำลังต่อภาษี/ประกัน', 'maintenance', 'Repair'))
          AND plate NOT IN (
              SELECT DISTINCT car_id FROM public.work_order_logs 
              WHERE car_id IS NOT NULL 
                AND job_status NOT IN ('Completed', 'เสร็จสิ้น', 'Canceled', 'ยกเลิก')
          );"""
    ]
    insurance_records_migrations = [
        """CREATE TABLE IF NOT EXISTS public.insurance_records (
            id VARCHAR(100) PRIMARY KEY,
            car_id VARCHAR(100),
            insurance_company VARCHAR(150),
            policy_no VARCHAR(100),
            ins_class VARCHAR(50),
            ins_category VARCHAR(100),
            ins_type VARCHAR(100),
            coverage_amount NUMERIC DEFAULT 0,
            premium NUMERIC DEFAULT 0,
            expiry_date VARCHAR(50),
            ins_doc_url TEXT,
            notes TEXT,
            created_by VARCHAR(100),
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );""",
        "ALTER TABLE public.insurance_records ADD COLUMN IF NOT EXISTS ins_doc_url TEXT;",
        "ALTER TABLE public.insurance_records ADD COLUMN IF NOT EXISTS insurance_company VARCHAR(150);",
        "ALTER TABLE public.insurance_records ADD COLUMN IF NOT EXISTS policy_no VARCHAR(100);",
        "ALTER TABLE public.insurance_records ADD COLUMN IF NOT EXISTS ins_company VARCHAR(150);",
        "ALTER TABLE public.insurance_records ADD COLUMN IF NOT EXISTS ins_policy_no VARCHAR(100);",
        "ALTER TABLE public.insurance_records ADD COLUMN IF NOT EXISTS ins_class VARCHAR(50);",
        "ALTER TABLE public.insurance_records ADD COLUMN IF NOT EXISTS ins_category VARCHAR(100);",
        "ALTER TABLE public.insurance_records ADD COLUMN IF NOT EXISTS ins_type VARCHAR(100);",
        "ALTER TABLE public.insurance_records ADD COLUMN IF NOT EXISTS coverage_amount NUMERIC DEFAULT 0;",
        "ALTER TABLE public.insurance_records ADD COLUMN IF NOT EXISTS premium NUMERIC DEFAULT 0;",
        "ALTER TABLE public.insurance_records ADD COLUMN IF NOT EXISTS expiry_date VARCHAR(50);",
        "ALTER TABLE public.insurance_records ADD COLUMN IF NOT EXISTS notes TEXT;",
        "ALTER TABLE public.insurance_records ADD COLUMN IF NOT EXISTS created_by VARCHAR(100);",
        "ALTER TABLE public.insurance_records ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;"
    ]
    try:
        with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
            try:
                conn.execute(text("SET lock_timeout = '2000ms';"))
                conn.execute(text("SET statement_timeout = '5000ms';"))
            except Exception:
                pass
            for sql_stmt in customer_migrations + car_migrations + booking_migrations + maintenance_migrations + insurance_records_migrations + financial_migrations + work_order_logs_migrations + sanitization_migrations:
                try:
                    conn.execute(text(sql_stmt))
                except Exception:
                    pass
    except Exception as e:
        print(f"init_db execution note: {e}")
