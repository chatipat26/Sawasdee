-- =============================================================================
-- SawasdeeRental PostgreSQL Database Schema
-- Fully Migrated from Original Data Store (Strict Schema Preserved)
-- =============================================================================

-- 1. Users Table (Authentication & Access Control)
CREATE TABLE IF NOT EXISTS public.users (
    username VARCHAR(100) PRIMARY KEY,
    password VARCHAR(255) NOT NULL,
    name VARCHAR(200),
    role VARCHAR(50) DEFAULT 'Staff',
    status VARCHAR(50) DEFAULT 'pending',
    line_id VARCHAR(100),
    line_user_id TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 2. Vehicles / Cars Table (Fleet Management - Strict 34-Column Schema)
CREATE TABLE IF NOT EXISTS public.cars (
    plate VARCHAR(50) PRIMARY KEY,
    brand VARCHAR(100),
    model VARCHAR(100),
    car_group VARCHAR(100),
    fuel_system VARCHAR(50),
    cc_ev VARCHAR(50),
    owner_company VARCHAR(150),
    color VARCHAR(50),
    mileage VARCHAR(50),
    daily_rate NUMERIC DEFAULT 0,
    weekly_rate NUMERIC DEFAULT 0,
    monthly_rate NUMERIC DEFAULT 0,
    vin VARCHAR(100),
    tax_expire_date VARCHAR(50),
    prb_expire_date VARCHAR(50),
    insurance_expire_date VARCHAR(50),
    insurance_company VARCHAR(150),
    car_owner VARCHAR(150),
    beneficiary VARCHAR(150),
    register_year VARCHAR(50),
    prb_price NUMERIC DEFAULT 0,
    insurance_premium NUMERIC DEFAULT 0,
    last_service_date VARCHAR(50),
    next_service_date VARCHAR(50),
    next_service_mileage NUMERIC DEFAULT 0,
    car_status VARCHAR(50) DEFAULT 'ว่างพร้อมใช้งาน',
    is_debt_free BOOLEAN DEFAULT FALSE,
    installment_amount NUMERIC DEFAULT 0,
    total_installments INTEGER DEFAULT 0,
    current_installment INTEGER DEFAULT 0,
    payment_due_date VARCHAR(50),
    finance_company VARCHAR(150),
    notes TEXT,
    image_url TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE OR REPLACE VIEW public.vehicles AS
SELECT * FROM public.cars;


-- 3. Customers Table (CRM - Strict 10-Field Schema)
CREATE TABLE IF NOT EXISTS public.customers (
    full_name VARCHAR(200) PRIMARY KEY,
    phone_number VARCHAR(50),
    id_card_no VARCHAR(50),
    driver_license_no VARCHAR(50),
    nationality VARCHAR(50) DEFAULT 'THAI',
    whatsapp VARCHAR(50) DEFAULT '-',
    dob VARCHAR(50) DEFAULT '-',
    license_expire_date VARCHAR(50) DEFAULT '-',
    home_address TEXT DEFAULT '-',
    current_address TEXT DEFAULT '-',
    phone VARCHAR(50),
    contact_no VARCHAR(50),
    id_card VARCHAR(50),
    passport_id VARCHAR(50),
    driver_license VARCHAR(50),
    licence_no VARCHAR(50),
    licence_expiry VARCHAR(50) DEFAULT '-',
    thai_address TEXT DEFAULT '-',
    address TEXT DEFAULT '-',
    nickname VARCHAR(100),
    line_id VARCHAR(100),
    line_user_id TEXT,
    notes TEXT,
    id_card_photo TEXT,
    driver_license_photo TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 4. Bookings Table (Active Bookings & Operations)
CREATE TABLE IF NOT EXISTS public.bookings (
    booking_id VARCHAR(50) PRIMARY KEY,
    car_id VARCHAR(50),
    customer VARCHAR(200),
    start_date DATE,
    start_time VARCHAR(20),
    end_date DATE,
    end_time VARCHAR(20),
    total_days NUMERIC DEFAULT 1,
    daily_rate NUMERIC DEFAULT 0,
    total_price NUMERIC DEFAULT 0,
    discount NUMERIC DEFAULT 0,
    net_price NUMERIC DEFAULT 0,
    deposit_paid BOOLEAN DEFAULT FALSE,
    deposit_amount NUMERIC DEFAULT 0,
    deposit_payment_method VARCHAR(100),
    rental_paid BOOLEAN DEFAULT FALSE,
    rental_amount_paid NUMERIC DEFAULT 0,
    rental_payment_method VARCHAR(100),
    status VARCHAR(50) DEFAULT 'รอชำระมัดจำ',
    loc_delivery TEXT,
    loc_return TEXT,
    worker_delivery VARCHAR(100),
    worker_return VARCHAR(100),
    dispatch_closed BOOLEAN DEFAULT FALSE,
    return_closed BOOLEAN DEFAULT FALSE,
    dispatch_date TIMESTAMPTZ,
    return_date TIMESTAMPTZ,
    dispatch_mileage VARCHAR(50),
    return_mileage VARCHAR(50),
    dispatch_fuel VARCHAR(50),
    return_fuel VARCHAR(50),
    dispatch_notes TEXT,
    return_notes TEXT,
    dispatch_photos JSONB DEFAULT '[]'::jsonb,
    return_photos JSONB DEFAULT '[]'::jsonb,
    payment_slip_url TEXT,
    payment_type VARCHAR(50),
    google_drive_link TEXT,
    extension_history JSONB DEFAULT '[]'::jsonb,
    is_fully_paid BOOLEAN DEFAULT FALSE,
    contract_pdf_url TEXT,
    created_by VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS payment_type VARCHAR(50);
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS google_drive_link TEXT;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS contract_pdf_url TEXT;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS extension_history JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS is_fully_paid BOOLEAN DEFAULT FALSE;

-- 5. Completed Jobs Table (Historical Archive)
CREATE TABLE IF NOT EXISTS public.completed_jobs (
    booking_id VARCHAR(50) PRIMARY KEY,
    car_id VARCHAR(50),
    customer VARCHAR(200),
    start_date DATE,
    end_date DATE,
    total_days NUMERIC DEFAULT 1,
    net_price NUMERIC DEFAULT 0,
    completed_date TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    data JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 6. Financial Records Table (Ledger & Accounting)
CREATE TABLE IF NOT EXISTS public.financial_records (
    id BIGSERIAL PRIMARY KEY,
    company VARCHAR(150),
    type VARCHAR(50),
    category VARCHAR(150),
    amount NUMERIC DEFAULT 0,
    ref VARCHAR(100),
    date DATE,
    detail TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 7. Maintenance Records Table (Fleet Maintenance & Renewals)
CREATE TABLE IF NOT EXISTS public.maintenance_records (
    id VARCHAR(50) PRIMARY KEY,
    car_id VARCHAR(50),
    car_brand VARCHAR(100),
    car_model VARCHAR(100),
    car_color VARCHAR(50),
    order_type VARCHAR(100),
    schedule_date DATE,
    expected_finish_date DATE,
    service_center VARCHAR(150),
    service_center_phone VARCHAR(50),
    assigned_worker VARCHAR(100),
    service_items TEXT,
    estimated_cost NUMERIC DEFAULT 0,
    actual_cost NUMERIC DEFAULT 0,
    cost NUMERIC DEFAULT 0,
    mileage VARCHAR(50),
    status VARCHAR(50) DEFAULT 'รอดำเนินการ',
    notes TEXT,
    created_by VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Create Essential Indexes for Performance
CREATE INDEX IF NOT EXISTS idx_cars_status ON public.cars(status);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON public.bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_dates ON public.bookings(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_maintenance_status ON public.maintenance_records(status);
CREATE INDEX IF NOT EXISTS idx_financial_date ON public.financial_records(date);

-- ==============================================================================
-- Master SQL Migration Scripts (Run in DBeaver / PostgreSQL)
-- ==============================================================================

-- 1. อัปเดตตารางรถยนต์ (cars / vehicles)
ALTER TABLE cars ADD COLUMN IF NOT EXISTS brand VARCHAR(100);
ALTER TABLE cars ADD COLUMN IF NOT EXISTS model VARCHAR(100);
ALTER TABLE cars ADD COLUMN IF NOT EXISTS car_group VARCHAR(100);
ALTER TABLE cars ADD COLUMN IF NOT EXISTS fuel_system VARCHAR(50);
ALTER TABLE cars ADD COLUMN IF NOT EXISTS cc_ev VARCHAR(50);
ALTER TABLE cars ADD COLUMN IF NOT EXISTS owner_company VARCHAR(150);
ALTER TABLE cars ADD COLUMN IF NOT EXISTS color VARCHAR(50);
ALTER TABLE cars ADD COLUMN IF NOT EXISTS mileage VARCHAR(50);
ALTER TABLE cars ADD COLUMN IF NOT EXISTS daily_rate NUMERIC;
ALTER TABLE cars ADD COLUMN IF NOT EXISTS weekly_rate NUMERIC;
ALTER TABLE cars ADD COLUMN IF NOT EXISTS monthly_rate NUMERIC;
ALTER TABLE cars ADD COLUMN IF NOT EXISTS vin VARCHAR(100);
ALTER TABLE cars ADD COLUMN IF NOT EXISTS tax_expire_date VARCHAR(50);
ALTER TABLE cars ADD COLUMN IF NOT EXISTS prb_expire_date VARCHAR(50);
ALTER TABLE cars ADD COLUMN IF NOT EXISTS insurance_expire_date VARCHAR(50);
ALTER TABLE cars ADD COLUMN IF NOT EXISTS insurance_company VARCHAR(150);
ALTER TABLE cars ADD COLUMN IF NOT EXISTS car_owner VARCHAR(150);
ALTER TABLE cars ADD COLUMN IF NOT EXISTS beneficiary VARCHAR(150);
ALTER TABLE cars ADD COLUMN IF NOT EXISTS register_year VARCHAR(50);
ALTER TABLE cars ADD COLUMN IF NOT EXISTS prb_price NUMERIC;
ALTER TABLE cars ADD COLUMN IF NOT EXISTS insurance_premium NUMERIC;
ALTER TABLE cars ADD COLUMN IF NOT EXISTS last_service_date VARCHAR(50);
ALTER TABLE cars ADD COLUMN IF NOT EXISTS next_service_date VARCHAR(50);
ALTER TABLE cars ADD COLUMN IF NOT EXISTS next_service_mileage NUMERIC;
ALTER TABLE cars ADD COLUMN IF NOT EXISTS car_status VARCHAR(50);
ALTER TABLE cars ADD COLUMN IF NOT EXISTS is_debt_free BOOLEAN;
ALTER TABLE cars ADD COLUMN IF NOT EXISTS installment_amount NUMERIC;
ALTER TABLE cars ADD COLUMN IF NOT EXISTS total_installments INTEGER;
ALTER TABLE cars ADD COLUMN IF NOT EXISTS current_installment INTEGER;
ALTER TABLE cars ADD COLUMN IF NOT EXISTS payment_due_date VARCHAR(50);
ALTER TABLE cars ADD COLUMN IF NOT EXISTS finance_company VARCHAR(150);
ALTER TABLE cars ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE cars ADD COLUMN IF NOT EXISTS image_url TEXT;

-- 2. อัปเดตตารางลูกค้า (customers)
ALTER TABLE customers ADD COLUMN IF NOT EXISTS full_name VARCHAR(150);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS phone_number VARCHAR(50);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS id_card_no VARCHAR(50);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS driver_license_no VARCHAR(50);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS nationality VARCHAR(50);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS whatsapp VARCHAR(50);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS dob VARCHAR(50);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS license_expire_date VARCHAR(50);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS home_address TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS current_address TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS email VARCHAR(150);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS line_user_id TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();


-- 8. ตารางใบงาน (work_order_logs) สำหรับงานส่งมอบรถและรับรถคืน
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
CREATE INDEX IF NOT EXISTS idx_work_order_logs_booking_id ON public.work_order_logs(booking_id);
CREATE INDEX IF NOT EXISTS idx_work_order_logs_car_id ON public.work_order_logs(car_id);
