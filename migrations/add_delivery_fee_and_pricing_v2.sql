-- =============================================================================
-- Migration: P3a — Off-site Delivery/Pickup Fees & Pricing Version v2 Schema
-- SawasdeeRental - Isolated Feature Addition (Backward-Compatible / Non-Locking)
-- =============================================================================

-- 1. Bookings Table: Pricing version & off-site delivery/pickup fee columns
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS pricing_version SMALLINT DEFAULT 1;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS delivery_mode VARCHAR(10) DEFAULT 'branch';
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS pickup_mode VARCHAR(10) DEFAULT 'branch';
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS delivery_fee NUMERIC DEFAULT 0;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS pickup_fee NUMERIC DEFAULT 0;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS fees_paid_amount NUMERIC DEFAULT 0;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS delivery_zone VARCHAR(100);
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS pickup_zone VARCHAR(100);
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS delivery_map_url TEXT;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS pickup_map_url TEXT;

-- 2. Bookings Table: Contract PDF & Payment confirmation fields
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS received_by VARCHAR(100);
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS rental_payment_date DATE;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS deposit_date DATE;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS deposit_waived BOOLEAN DEFAULT FALSE;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS driver2_name VARCHAR(200);
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS driver2_licence VARCHAR(50);
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS driver2_dob VARCHAR(20);

-- 3. Completed Jobs Table: Preserve fee breakdown on archived jobs
ALTER TABLE public.completed_jobs ADD COLUMN IF NOT EXISTS pricing_version SMALLINT DEFAULT 1;
ALTER TABLE public.completed_jobs ADD COLUMN IF NOT EXISTS delivery_mode VARCHAR(10) DEFAULT 'branch';
ALTER TABLE public.completed_jobs ADD COLUMN IF NOT EXISTS pickup_mode VARCHAR(10) DEFAULT 'branch';
ALTER TABLE public.completed_jobs ADD COLUMN IF NOT EXISTS delivery_fee NUMERIC DEFAULT 0;
ALTER TABLE public.completed_jobs ADD COLUMN IF NOT EXISTS pickup_fee NUMERIC DEFAULT 0;
ALTER TABLE public.completed_jobs ADD COLUMN IF NOT EXISTS fees_paid_amount NUMERIC DEFAULT 0;
ALTER TABLE public.completed_jobs ADD COLUMN IF NOT EXISTS delivery_zone VARCHAR(100);
ALTER TABLE public.completed_jobs ADD COLUMN IF NOT EXISTS pickup_zone VARCHAR(100);
ALTER TABLE public.completed_jobs ADD COLUMN IF NOT EXISTS delivery_map_url TEXT;
ALTER TABLE public.completed_jobs ADD COLUMN IF NOT EXISTS pickup_map_url TEXT;
ALTER TABLE public.completed_jobs ADD COLUMN IF NOT EXISTS received_by VARCHAR(100);
ALTER TABLE public.completed_jobs ADD COLUMN IF NOT EXISTS rental_payment_date DATE;
ALTER TABLE public.completed_jobs ADD COLUMN IF NOT EXISTS deposit_date DATE;
ALTER TABLE public.completed_jobs ADD COLUMN IF NOT EXISTS deposit_waived BOOLEAN DEFAULT FALSE;

-- 4. Delivery Zones Table (Preset zone rates for off-site delivery & pickup)
CREATE TABLE IF NOT EXISTS public.delivery_zones (
    id SERIAL PRIMARY KEY,
    zone_name VARCHAR(100) UNIQUE NOT NULL,
    default_delivery_fee NUMERIC DEFAULT 0,
    default_pickup_fee NUMERIC DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
