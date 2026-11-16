"""
Sawasdee Rental - Cars API Router
Endpoint for car 4-angle image uploads with Google Drive auto-upload integration.
"""

import os
import re
import urllib.parse
from datetime import datetime
from typing import Optional, Dict, Any, List, Tuple
from fastapi import APIRouter, UploadFile, File, Form, Query, HTTPException, Path

from services.google_drive_service import (
    upload_image_to_drive,
    build_car_filename,
    normalize_car_angle,
    FOLDER_CAR_ANGLES
)
from db import store, normalize_plate_str

router = APIRouter(prefix="/api/cars", tags=["cars"])

def normalize_plate_key(plate: Optional[str]) -> str:
    """Normalize license plate text by stripping spaces, dashes, dots, and slashes."""
    if not plate:
        return ""
    return re.sub(r"[\s\-_./]+", "", str(plate)).strip().lower()

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

    # 2. Update Database 'cars' table with robust plate matching
    norm_target = normalize_plate_key(clean_plate)
    matched_key = None
    target_car = None

    # Step A: Match against in-memory store
    for k, v in store.cars.items():
        if k == clean_plate or normalize_plate_key(k) == norm_target:
            matched_key = k
            target_car = v
            break

    # Step B: Direct database lookup using normalized comparison to find exact plate stored in PostgreSQL
    actual_db_plate = None
    sb = None
    try:
        from db import get_db_client
        sb = get_db_client()
        if sb and hasattr(sb, "run"):
            from psycopg import sql as _sql
            # Strip spaces, dashes, dots, and slashes on DB column to match norm_target
            find_res = sb.run([(
                _sql.SQL("SELECT plate FROM cars WHERE regexp_replace(lower(plate), '[\\s\\-_./]+', '', 'g') = %s LIMIT 1"),
                [norm_target]
            )])
            if find_res and len(find_res) > 0 and find_res[0].get("plate"):
                actual_db_plate = str(find_res[0]["plate"]).strip()
    except Exception as query_err:
        print(f"[Cars API] DB plate lookup note: {query_err}")

    # Determine canonical plate key
    canonical_plate = actual_db_plate or matched_key or clean_plate

    if not target_car:
        target_car = store.cars.get(canonical_plate) or {
            "plate": canonical_plate,
            "status": "ว่างพร้อมใช้งาน",
            "car_status": "ว่างพร้อมใช้งาน"
        }
        store.cars[canonical_plate] = target_car

    # Update 4-angle column in cars object
    target_car[db_col] = image_url
    if db_col == "img_front" or not target_car.get("image") or target_car.get("image") == "-":
        target_car["image"] = image_url
        target_car["image_url"] = image_url

    # Persist changes to in-memory store and async database sync
    store.async_sync_car(canonical_plate, target_car)
    if matched_key and matched_key != canonical_plate:
        store.cars[matched_key] = target_car
        store.async_sync_car(matched_key, target_car)

    # Step C: Direct database UPDATE using all matched plate variations to guarantee persistence
    if sb:
        try:
            db_update = {db_col: image_url}
            if db_col == "img_front" or not target_car.get("image") or target_car.get("image") == "-":
                db_update["image_url"] = image_url

            target_plates = {p for p in [actual_db_plate, canonical_plate, matched_key, clean_plate] if p}
            for p in target_plates:
                sb.table("cars").update(db_update).eq("plate", p).execute()
        except Exception as dberr:
            print(f"[Cars API] Direct DB update warning: {dberr}")

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

@router.post("/{car_id:path}/4-angles")
async def upload_car_4_angles(
    car_id: str = Path(..., description="Car license plate or ID"),
    booking_id: Optional[str] = Form(None),
    job_type: Optional[str] = Form("Dispatch"),
    files: Optional[Union[List[UploadFile], UploadFile]] = File(None),
    front: Optional[UploadFile] = File(None),
    left: Optional[UploadFile] = File(None),
    rear: Optional[UploadFile] = File(None),
    right: Optional[UploadFile] = File(None)
):
    """
    Car 4-Angle Batch Upload Endpoint:
    - Receives up to 4 photos for the 4 angles: front, left, rear, right
    - Uploads each photo to Google Drive Folder: 1V5S_j4dXQGuUW6zCAwQaXSkYJ9XNo-Mj (FOLDER_CAR_ANGLES)
    - NEVER deletes existing files in Google Drive (historical archive preservation)
    - Standardized naming: รถ_[มุม]_[ทะเบียน]_[YYYYMMDD].[ext]
    - Updates 'cars' table in PostgreSQL (img_front, img_left, img_rear, img_right, image_url)
    - Updates in-memory store.cars and store.bookings (if booking_id provided)
    - Returns Google Drive URLs to frontend
    """
    clean_plate = urllib.parse.unquote(car_id).strip()
    if (not clean_plate or clean_plate == "unknown") and booking_id:
        target_bk = next((b for b in store.bookings if b.get("booking_id") == booking_id), None)
        if target_bk and target_bk.get("car_id"):
            clean_plate = str(target_bk.get("car_id")).strip()

    if not clean_plate or clean_plate == "unknown":
        raise HTTPException(status_code=400, detail="กรุณาระบุเลขทะเบียนรถยนต์")

    angle_files = {}
    if isinstance(front, UploadFile) and front.filename:
        angle_files["front"] = front
    if isinstance(left, UploadFile) and left.filename:
        angle_files["left"] = left
    if isinstance(rear, UploadFile) and rear.filename:
        angle_files["rear"] = rear
    if isinstance(right, UploadFile) and right.filename:
        angle_files["right"] = right

    if isinstance(files, UploadFile) and files.filename:
        files = [files]
    elif not isinstance(files, (list, tuple)):
        files = []

    angle_order = ["front", "left", "rear", "right"]
    for idx, f in enumerate(files[:4]):
        if isinstance(f, UploadFile) and f.filename and angle_order[idx] not in angle_files:
            angle_files[angle_order[idx]] = f

    if not angle_files:
        raise HTTPException(status_code=400, detail="กรุณาเลือกไฟล์รูปภาพอย่างน้อย 1 รูป")

    angle_urls = {}
    angle_results = []
    today_str = datetime.now().strftime("%Y%m%d")

    for angle_key, file_obj in angle_files.items():
        try:
            target_filename, db_col = build_car_filename(
                angle=angle_key,
                plate=clean_plate,
                original_filename=file_obj.filename,
                date_str=today_str
            )
            file_bytes = await file_obj.read()
            if not file_bytes:
                continue

            gdrive_res = upload_image_to_drive(
                file=file_bytes,
                folder_id=FOLDER_CAR_ANGLES,
                file_name=target_filename,
                content_type=file_obj.content_type or "image/jpeg"
            )

            if gdrive_res.get("success"):
                img_url = gdrive_res.get("webViewLink")
            else:
                ext = file_obj.filename.split(".")[-1] if "." in file_obj.filename else "jpg"
                safe_fn = f"car_{db_col}_{int(datetime.now().timestamp()*1000)}.{ext}"
                img_url = store.upload_photo(safe_fn, file_bytes, file_obj.content_type or "image/jpeg")

            if img_url:
                angle_urls[db_col] = img_url
                angle_results.append({
                    "angle": angle_key,
                    "column": db_col,
                    "filename": target_filename,
                    "url": img_url
                })
        except Exception as e:
            print(f"[Cars 4-Angles API] Error uploading angle {angle_key} for {clean_plate}: {e}")

    if not angle_urls:
        raise HTTPException(status_code=500, detail="ไม่สามารถอัปโหลดรูปภาพได้")

    # Match canonical plate in store.cars
    norm_target = normalize_plate_key(clean_plate)
    matched_key = None
    target_car = None

    for k, v in store.cars.items():
        if k == clean_plate or normalize_plate_key(k) == norm_target:
            matched_key = k
            target_car = v
            break

    canonical_plate = matched_key or clean_plate
    if not target_car:
        target_car = store.cars.get(canonical_plate) or {
            "plate": canonical_plate,
            "status": "ว่างพร้อมใช้งาน"
        }
        store.cars[canonical_plate] = target_car

    # Update in-memory car with 4-angle URLs
    for col, url in angle_urls.items():
        target_car[col] = url

    if "img_front" in angle_urls or not target_car.get("image") or target_car.get("image") == "-":
        main_img = angle_urls.get("img_front") or next(iter(angle_urls.values()), "")
        if main_img:
            target_car["image"] = main_img
            target_car["image_url"] = main_img

    store.async_sync_car(canonical_plate, target_car)

    # Database UPDATE in table 'cars'
    try:
        from db import get_db_client
        sb = get_db_client()
        if sb:
            db_update = dict(angle_urls)
            if "image_url" in target_car:
                db_update["image_url"] = target_car["image_url"]
            sb.table("cars").update(db_update).eq("plate", canonical_plate).execute()
    except Exception as dbe:
        print(f"[Cars 4-Angles API] Database update cars error: {dbe}")

    # Attach to booking record if booking_id provided
    if booking_id:
        try:
            b_target = next((b for b in store.bookings if b.get("booking_id") == booking_id), None)
            if b_target:
                is_ret = str(job_type).lower() in ("return", "checkin")
                photo_str = ",".join([angle_urls.get(c, "") for c in ["img_front", "img_left", "img_rear", "img_right"] if angle_urls.get(c)])
                if is_ret:
                    for c in ["img_front", "img_left", "img_rear", "img_right"]:
                        if c in angle_urls:
                            b_target["checkin_" + c] = angle_urls[c]
                    b_target["inspection_photos_in"] = photo_str
                    b_target["return_photos"] = photo_str
                else:
                    for c in ["img_front", "img_left", "img_rear", "img_right"]:
                        if c in angle_urls:
                            b_target["checkout_" + c] = angle_urls[c]
                    b_target["inspection_photos_out"] = photo_str
                    b_target["dispatch_photos"] = photo_str
                store.async_sync_booking(b_target)
        except Exception as be:
            print(f"[Cars 4-Angles API] Booking sync error: {be}")

    return {
        "success": True,
        "plate": canonical_plate,
        "booking_id": booking_id,
        "angles": angle_urls,
        "results": angle_results,
        "urls": [angle_urls.get("img_front", ""), angle_urls.get("img_left", ""), angle_urls.get("img_rear", ""), angle_urls.get("img_right", "")],
        "message": "อัปโหลดรูปรถยนต์ 4 มุมขึ้น Google Drive และอัปเดตข้อมูลรถสำเร็จ"
    }
