-- =============================================================================
-- Migration: Strict 34-Column Vehicle Schema Synchronization & Cleanup
-- Description: Synchronize vehicles/cars schema to exactly 34 standard columns
--              and safely drop deprecated legacy columns.
-- =============================================================================

-- Step 1: Add new standard columns if not already present
ALTER TABLE public.cars
    ADD COLUMN IF NOT EXISTS car_group VARCHAR(100),
    ADD COLUMN IF NOT EXISTS fuel_system VARCHAR(50),
    ADD COLUMN IF NOT EXISTS cc_ev VARCHAR(50),
    ADD COLUMN IF NOT EXISTS owner_company VARCHAR(150),
    ADD COLUMN IF NOT EXISTS daily_rate NUMERIC DEFAULT 0,
    ADD COLUMN IF NOT EXISTS weekly_rate NUMERIC DEFAULT 0,
    ADD COLUMN IF NOT EXISTS monthly_rate NUMERIC DEFAULT 0,
    ADD COLUMN IF NOT EXISTS vin VARCHAR(100),
    ADD COLUMN IF NOT EXISTS tax_expire_date VARCHAR(50),
    ADD COLUMN IF NOT EXISTS prb_expire_date VARCHAR(50),
    ADD COLUMN IF NOT EXISTS insurance_expire_date VARCHAR(50),
    ADD COLUMN IF NOT EXISTS insurance_company VARCHAR(150),
    ADD COLUMN IF NOT EXISTS car_owner VARCHAR(150),
    ADD COLUMN IF NOT EXISTS beneficiary VARCHAR(150),
    ADD COLUMN IF NOT EXISTS register_year VARCHAR(50),
    ADD COLUMN IF NOT EXISTS prb_price NUMERIC DEFAULT 0,
    ADD COLUMN IF NOT EXISTS insurance_premium NUMERIC DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_service_date VARCHAR(50),
    ADD COLUMN IF NOT EXISTS next_service_date VARCHAR(50),
    ADD COLUMN IF NOT EXISTS next_service_mileage NUMERIC DEFAULT 0,
    ADD COLUMN IF NOT EXISTS car_status VARCHAR(50) DEFAULT 'ว่างพร้อมใช้งาน',
    ADD COLUMN IF NOT EXISTS is_debt_free BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS installment_amount NUMERIC DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total_installments INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS current_installment INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS payment_due_date VARCHAR(50),
    ADD COLUMN IF NOT EXISTS finance_company VARCHAR(150),
    ADD COLUMN IF NOT EXISTS notes TEXT,
    ADD COLUMN IF NOT EXISTS image_url TEXT;

-- Step 2: Migrate data from older column names to standard column names if applicable
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='cars' AND column_name='fuel_type') THEN
        UPDATE public.cars SET fuel_system = COALESCE(fuel_system, fuel_type) WHERE fuel_system IS NULL;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='cars' AND column_name='engine_cc') THEN
        UPDATE public.cars SET cc_ev = COALESCE(cc_ev, engine_cc) WHERE cc_ev IS NULL;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='cars' AND column_name='company') THEN
        UPDATE public.cars SET owner_company = COALESCE(owner_company, company) WHERE owner_company IS NULL;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='cars' AND column_name='status') THEN
        UPDATE public.cars SET car_status = COALESCE(car_status, status) WHERE car_status IS NULL;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='cars' AND column_name='chassis_no') THEN
        UPDATE public.cars SET vin = COALESCE(vin, chassis_no) WHERE vin IS NULL;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='cars' AND column_name='act_expiry') THEN
        UPDATE public.cars SET prb_expire_date = COALESCE(prb_expire_date, act_expiry) WHERE prb_expire_date IS NULL;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='cars' AND column_name='ins_expiry') THEN
        UPDATE public.cars SET insurance_expire_date = COALESCE(insurance_expire_date, ins_expiry) WHERE insurance_expire_date IS NULL;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='cars' AND column_name='tax_expiry') THEN
        UPDATE public.cars SET tax_expire_date = COALESCE(tax_expire_date, tax_expiry) WHERE tax_expire_date IS NULL;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='cars' AND column_name='owner') THEN
        UPDATE public.cars SET car_owner = COALESCE(car_owner, owner) WHERE car_owner IS NULL;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='cars' AND column_name='reg_year') THEN
        UPDATE public.cars SET register_year = COALESCE(register_year, reg_year) WHERE register_year IS NULL;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='cars' AND column_name='image') THEN
        UPDATE public.cars SET image_url = COALESCE(image_url, image) WHERE image_url IS NULL;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='cars' AND column_name='act_price') THEN
        UPDATE public.cars SET prb_price = COALESCE(prb_price, NULLIF(regexp_replace(act_price, '[^0-9.]', '', 'g'), '')::NUMERIC) WHERE prb_price IS NULL OR prb_price = 0;
    END IF;
END $$;

-- Step 3: Strictly DROP legacy/deprecated columns
ALTER TABLE public.cars
    DROP COLUMN IF EXISTS prb_brand,
    DROP COLUMN IF EXISTS act_brand,
    DROP COLUMN IF EXISTS insurance_coverage,
    DROP COLUMN IF EXISTS insurance_brand,
    DROP COLUMN IF EXISTS leasing_contract,
    DROP COLUMN IF EXISTS leasing_total_installments,
    DROP COLUMN IF EXISTS leasing_current_installment,
    DROP COLUMN IF EXISTS leasing_last_payment_date,
    DROP COLUMN IF EXISTS leasing_installment_amount,
    DROP COLUMN IF EXISTS tax_year,
    DROP COLUMN IF EXISTS tax_start_date,
    DROP COLUMN IF EXISTS act_start_date,
    DROP COLUMN IF EXISTS ins_start_date,
    DROP COLUMN IF EXISTS manager,
    DROP COLUMN IF EXISTS engine_no,
    DROP COLUMN IF EXISTS maintenance_detail;

-- Step 4: Ensure 'vehicles' alias view exists for unified querying
CREATE OR REPLACE VIEW public.vehicles AS
SELECT
    plate, brand, model, car_group, fuel_system, cc_ev,
    owner_company, color, mileage, daily_rate, weekly_rate, monthly_rate,
    vin, tax_expire_date, prb_expire_date, insurance_expire_date, insurance_company,
    car_owner, beneficiary, register_year,
    prb_price, insurance_premium,
    last_service_date, next_service_date, next_service_mileage,
    car_status, is_debt_free, installment_amount, total_installments, current_installment,
    payment_due_date, finance_company, notes, image_url
FROM public.cars;
