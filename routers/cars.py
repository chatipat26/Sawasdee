"""
Sawasdee Rental - Cars API Router
Endpoint for car 4-angle image uploads with Google Drive auto-upload integration.
"""

import os
import urllib.parse
from datetime import datetime
from typing import Optional, Dict, Any
from fastapi import APIRouter, UploadFile, File, Form, Query, HTTPException, Path

from services.google_drive_service import (
    upload_image_to_drive,
    build_car_filename,
    normalize_car_angle,
    FOLDER_CAR_ANGLES
)
from db import store, normalize_plate_str

router = APIRouter(prefix="/api/cars", tags=["cars"])

@router.post("/{car_id:path}/images")
async def upload_car_image(
    car_id: str = Path(..., description="Car license plate or ID"),
    file: UploadFile = File(...),
    angle: Optional[str] = Form(None),
    view: Optional[str] = Query(None)
):
    """
    Car Image Upload Endpoint (TARGET MISSION 2):
    - Uploads 4-angle car photos to Google Drive Folder: 1V5S_j4dXQGuUW6zCAwQaXSkYJ9XNo-Mj
    - Standardized naming: รถ_[มุม(หน้า/ซ้าย/หลัง/ขวา)]_[ทะเบียนรถ]_[YYYYMMDD].[ext]
    - Updates database table 'cars' with webViewLink (img_front, img_left, img_rear, img_right)
    - Returns URL immediately to frontend
    """
    clean_plate = urllib.parse.unquote(car_id).strip()
    if not clean_plate:
        raise HTTPException(status_code=400, detail="กรุณาระบุเลขทะเบียนรถยนต์")

    chosen_angle = angle or view or "front"
    target_filename, db_col = build_car_filename(
        angle=chosen_angle,
        plate=clean_plate,
        original_filename=file.filename
    )

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="ไฟล์รูปภาพว่างเปล่า (0 bytes)")

    # 1. Google Drive Auto-Upload
    gdrive_res = upload_image_to_drive(
        file=file_bytes,
        folder_id=FOLDER_CAR_ANGLES,
        file_name=target_filename,
        content_type=file.content_type or "image/jpeg"
    )

    image_url = None
    direct_url = None
    is_gdrive = False

    if gdrive_res.get("success"):
        image_url = gdrive_res.get("webViewLink")
        direct_url = gdrive_res.get("direct_url") or image_url
        is_gdrive = True
    else:
        # Resilient fallback: store in local base64/data store so demo never crashes
        print(f"[Cars API] GDrive upload notice ({gdrive_res.get('error')}), falling back to safe local storage")
        ext = file.filename.split(".")[-1] if "." in file.filename else "jpg"
        safe_fn = f"car_{db_col}_{int(datetime.now().timestamp() * 1000)}.{ext}"
        image_url = store.upload_photo(safe_fn, file_bytes, file.content_type or "image/jpeg")
        direct_url = image_url
        is_gdrive = False

    if not image_url:
        raise HTTPException(status_code=500, detail="ไม่สามารถบันทึกรูปภาพได้")

    # 2. Update Database 'cars' table
    norm_target = normalize_plate_str(clean_plate)
    matched_key = None
    target_car = None

    for k, v in store.cars.items():
        if k == clean_plate or normalize_plate_str(k) == norm_target:
            matched_key = k
            target_car = v
            break

    if not target_car:
        matched_key = clean_plate
        target_car = {
            "plate": clean_plate,
            "status": "ว่างพร้อมใช้งาน",
            "car_status": "ว่างพร้อมใช้งาน"
        }
        store.cars[matched_key] = target_car

    # Update 4-angle column in cars table
    target_car[db_col] = image_url
    if db_col == "img_front" or not target_car.get("image") or target_car.get("image") == "-":
        target_car["image"] = image_url
        target_car["image_url"] = image_url

    # Persist changes to database & storage
    store.async_sync_car(matched_key, target_car)

    thai_angle, _ = normalize_car_angle(chosen_angle)
    return {
        "success": True,
        "url": image_url,
        "webViewLink": image_url,
        "direct_url": direct_url,
        "filename": target_filename,
        "column": db_col,
        "angle": thai_angle,
        "plate": clean_plate,
        "is_gdrive": is_gdrive
    }
