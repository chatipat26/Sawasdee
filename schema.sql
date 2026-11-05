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

-- 2. Cars Table (Fleet Management)
CREATE TABLE IF NOT EXISTS public.cars (
    plate VARCHAR(50) PRIMARY KEY,
    brand VARCHAR(100),
    model VARCHAR(100),
    color VARCHAR(50),
    car_group VARCHAR(100),
    engine_cc VARCHAR(50),
    fuel_type VARCHAR(50),
    company VARCHAR(150),
    status VARCHAR(50) DEFAULT 'ว่างพร้อมใช้งาน',
    daily_rate NUMERIC DEFAULT 0,
    mileage VARCHAR(50),
    image TEXT,
    reg_year VARCHAR(50),
    engine_no VARCHAR(100),
    chassis_no VARCHAR(100),
    owner VARCHAR(150),
    manager VARCHAR(150),
    leasing_contract VARCHAR(100),
    leasing_total_installments VARCHAR(50),
    leasing_current_installment VARCHAR(50),
    leasing_last_payment_date VARCHAR(50),
    leasing_installment_amount VARCHAR(50),
    insurance_brand VARCHAR(100),
    insurance_premium VARCHAR(50),
    insurance_coverage VARCHAR(50),
    ins_start_date VARCHAR(50),
    ins_expiry VARCHAR(50),
    tax_year VARCHAR(50),
    tax_start_date VARCHAR(50),
    tax_expiry VARCHAR(50),
    act_brand VARCHAR(100),
    act_price VARCHAR(50),
    act_start_date VARCHAR(50),
    act_expiry VARCHAR(50),
    maintenance_detail TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 3. Customers Table (CRM)
CREATE TABLE IF NOT EXISTS public.customers (
    full_name VARCHAR(200) PRIMARY KEY,
    nickname VARCHAR(100),
    phone VARCHAR(50),
    id_card VARCHAR(50),
    driver_license VARCHAR(50),
    line_id VARCHAR(100),
    line_user_id TEXT,
    address TEXT,
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
    created_by VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

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
