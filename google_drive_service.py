"""
Google Drive Service Proxy for SawasdeeRental
Delegates to services.google_drive_service
"""
from services.google_drive_service import (
    upload_image_to_drive,
    get_drive_service,
    is_drive_configured,
    build_car_filename,
    normalize_car_angle,
    clean_plate_for_filename,
    FOLDER_CAR_ANGLES,
    FOLDER_INSURANCE_ACT,
    FOLDER_PAYMENT_SLIPS
)
