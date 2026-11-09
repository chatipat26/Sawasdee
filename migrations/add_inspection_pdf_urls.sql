-- =============================================================================
-- Migration: Add checkout_pdf_url and checkin_pdf_url to bookings table
-- SawasdeeRental - Isolated Feature Addition (Strict Schema Preserved)
-- =============================================================================

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS checkout_pdf_url VARCHAR(500);
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS checkin_pdf_url VARCHAR(500);
