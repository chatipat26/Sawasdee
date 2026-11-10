-- =============================================================================
-- Migration: Add 4-angle check-in image URL columns to bookings table
-- SawasdeeRental - Isolated Feature Addition (Strict Schema Preserved)
-- =============================================================================

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS checkin_img_front TEXT;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS checkin_img_left TEXT;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS checkin_img_rear TEXT;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS checkin_img_right TEXT;
