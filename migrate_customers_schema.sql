-- =============================================================================
-- SawasdeeRental Customer Table Schema Migration (Strict 10 Fields)
-- Run this script in DBeaver / PostgreSQL Query Tool
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.customers (
    full_name VARCHAR(150) PRIMARY KEY
);

-- Enforce 10 required fields matching the Add/Edit Customer UI Modal
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS full_name VARCHAR(150);
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS phone_number VARCHAR(50);
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS id_card_no VARCHAR(50);
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS driver_license_no VARCHAR(50);
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS nationality VARCHAR(50);
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS whatsapp VARCHAR(50);
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS dob VARCHAR(50);
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS license_expire_date VARCHAR(50);
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS home_address TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS current_address TEXT;

-- Verify columns
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'customers'
ORDER BY ordinal_position;
