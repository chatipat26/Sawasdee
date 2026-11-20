"""
Sawasdee Rental - Cars API Router
Endpoints for fleet management, vehicle options, maintenance ROI, and car 4-angle image uploads.
"""

import os
import io
import re
import time
import asyncio
import urllib.parse
from datetime import datetime
from typing import Optional, Dict, Any, List, Tuple, Union
from fastapi import APIRouter, UploadFile, File, Form, Query, HTTPException, Path, Request
from fastapi.responses import JSONResponse

from services.google_drive_service import (
    upload_image_to_drive,
    build_car_filename,
    normalize_car_angle,
    FOLDER_CAR_ANGLES
)
from db import (
    store,
    normalize_plate_str,
    get_db_client,
    get_car_fleet_status,
    to_date,
    DEFAULT_HP_LEASING,
    DEFAULT_HP_SUMMARY,
    DEFAULT_PROPERTY_INSURANCE,
)
from dependencies import INACTIVE_BOOKING_STATUSES, now_th, normalize_plate
from schemas import VehicleCreate
from services.maintenance_service import execute_hard_delete_work_order_db

router = APIRouter(tags=["cars"])

def normalize_plate_key(plate: Optional[str]) -> str:
    """Normalize license plate text by stripping spaces, dashes, dots, and slashes."""
    if not plate:
        return ""
    return re.sub(r"[\s\-_./]+", "", str(plate)).strip().lower()

def _is_file(obj: Any) -> bool:
    """Helper to check if an object is a valid file upload (duck-typing compatible)."""
    if obj is None:
        return False
    fn = getattr(obj, "filename", None)
    return bool(fn and str(fn).strip())

@router.post("/api/cars/{car_id:path}/images")
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

    file_name_orig = file.filename
    file_content_type = file.content_type or "image/jpeg"

    def _process_car_image():
        # 1. Google Drive Auto-Upload
        gdrive_res = upload_image_to_drive(
            file=file_bytes,
            folder_id=FOLDER_CAR_ANGLES,
            file_name=target_filename,
            content_type=file_content_type
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
            ext = file_name_orig.split(".")[-1] if "." in file_name_orig else "jpg"
            safe_fn = f"car_{db_col}_{int(datetime.now().timestamp() * 1000)}.{ext}"
            image_url = store.upload_photo(safe_fn, file_bytes, file_content_type)
            direct_url = image_url
            is_gdrive = False

        if not image_url:
            raise HTTPException(status_code=500, detail="ไม่สามารถบันทึกรูปภาพได้")

        # 2. Update Database 'cars' table with robust plate matching
        norm_target = normalize_plate_key(clean_plate)
        matched_key = None
        target_car = None

        # Step A: Match against in-memory store under lock
        with store.lock:
            for k, v in store.cars.items():
                if k == clean_plate or normalize_plate_key(k) == norm_target:
                    matched_key = k
                    target_car = dict(v)
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

        with store.lock:
            if not target_car:
                existing_c = store.cars.get(canonical_plate)
                target_car = dict(existing_c) if existing_c else {
                    "plate": canonical_plate,
                    "status": "ว่างพร้อมใช้งาน",
                    "car_status": "ว่างพร้อมใช้งาน"
                }

            # Update 4-angle column in cars object
            target_car[db_col] = image_url
            if db_col == "img_front" or not target_car.get("image") or target_car.get("image") == "-":
                target_car["image"] = image_url
                target_car["image_url"] = image_url

            store.cars[canonical_plate] = target_car
            if matched_key and matched_key != canonical_plate:
                store.cars[matched_key] = target_car

        # Persist changes to in-memory store and async database sync
        store.async_sync_car(canonical_plate, target_car)
        if matched_key and matched_key != canonical_plate:
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

    return await asyncio.to_thread(_process_car_image)

@router.post("/api/cars/{car_id:path}/4-angles")
async def upload_car_4_angles(
    request: Request,
    car_id: str = Path(..., description="Car license plate or ID"),
    booking_id: Optional[str] = Form(None),
    job_type: Optional[str] = Form("Dispatch"),
    files: Optional[Union[List[UploadFile], UploadFile]] = File(None),
    photos: Optional[Union[List[UploadFile], UploadFile]] = File(None),
    images: Optional[Union[List[UploadFile], UploadFile]] = File(None),
    file: Optional[UploadFile] = File(None),
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

    # 1. Direct explicit angle params
    if _is_file(front):
        angle_files["front"] = front
    if _is_file(left):
        angle_files["left"] = left
    if _is_file(rear):
        angle_files["rear"] = rear
    if _is_file(right):
        angle_files["right"] = right

    # 2. Direct list / generic params
    extra_files = []
    for candidate in [files, photos, images, file]:
        if not candidate:
            continue
        if isinstance(candidate, (list, tuple)):
            for f in candidate:
                if _is_file(f) and f not in extra_files:
                    extra_files.append(f)
        elif _is_file(candidate) and candidate not in extra_files:
            extra_files.append(candidate)

    # 3. Comprehensive fallback: inspect raw request form if request is provided
    if request:
        try:
            form_data = await request.form()
            if not booking_id and form_data.get("booking_id"):
                booking_id = str(form_data.get("booking_id"))
            if not job_type and form_data.get("job_type"):
                job_type = str(form_data.get("job_type"))

            # Check explicit angle keys in form_data
            for ak in ["front", "left", "rear", "right"]:
                if ak not in angle_files:
                    v = form_data.get(ak)
                    if _is_file(v):
                        angle_files[ak] = v

            # Check all items in multi_items (covers files, photos, images, etc.)
            for key, val in form_data.multi_items():
                if _is_file(val):
                    k_lower = key.lower().strip()
                    if k_lower in ("front", "left", "rear", "right"):
                        if k_lower not in angle_files:
                            angle_files[k_lower] = val
                    else:
                        if val not in extra_files and val not in angle_files.values():
                            extra_files.append(val)
        except Exception as form_err:
            print(f"[upload_car_4_angles] request.form fallback warning: {form_err}")

    # 4. Sequentially allocate extra files into missing angle slots
    angle_order = ["front", "left", "rear", "right"]
    for f in extra_files:
        if f in angle_files.values():
            continue
        for angle in angle_order:
            if angle not in angle_files:
                angle_files[angle] = f
                break

    if not angle_files:
        raise HTTPException(status_code=400, detail="กรุณาเลือกไฟล์รูปภาพอย่างน้อย 1 รูป")

    angle_items = []
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
            angle_items.append((
                angle_key,
                target_filename,
                db_col,
                file_bytes,
                file_obj.content_type or "image/jpeg",
                file_obj.filename,
            ))
        except Exception as e:
            print(f"[Cars 4-Angles API] Error reading angle {angle_key} for {clean_plate}: {e}")

    def _process_4_angles():
        angle_urls = {}
        angle_results = []
        for angle_key, target_filename, db_col, file_bytes, ctype, orig_name in angle_items:
            try:
                gdrive_res = upload_image_to_drive(
                    file=file_bytes,
                    folder_id=FOLDER_CAR_ANGLES,
                    file_name=target_filename,
                    content_type=ctype
                )

                if gdrive_res.get("success"):
                    img_url = gdrive_res.get("webViewLink")
                else:
                    ext = orig_name.split(".")[-1] if "." in orig_name else "jpg"
                    safe_fn = f"car_{db_col}_{int(datetime.now().timestamp()*1000)}.{ext}"
                    img_url = store.upload_photo(safe_fn, file_bytes, ctype)

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

        with store.lock:
            for k, v in store.cars.items():
                if k == clean_plate or normalize_plate_key(k) == norm_target:
                    matched_key = k
                    target_car = dict(v)
                    break

            canonical_plate = matched_key or clean_plate
            if not target_car:
                existing_c = store.cars.get(canonical_plate)
                target_car = dict(existing_c) if existing_c else {
                    "plate": canonical_plate,
                    "status": "ว่างพร้อมใช้งาน"
                }

            # Update in-memory car with 4-angle URLs
            for col, url in angle_urls.items():
                target_car[col] = url

            if "img_front" in angle_urls or not target_car.get("image") or target_car.get("image") == "-":
                main_img = angle_urls.get("img_front") or next(iter(angle_urls.values()), "")
                if main_img:
                    target_car["image"] = main_img
                    target_car["image_url"] = main_img

            store.cars[canonical_plate] = target_car

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
                b_target = None
                with store.lock:
                    b_raw = next((b for b in store.bookings if b.get("booking_id") == booking_id), None)
                    if b_raw:
                        is_ret = str(job_type).lower() in ("return", "checkin")
                        photo_str = ",".join([angle_urls.get(c, "") for c in ["img_front", "img_left", "img_rear", "img_right"] if angle_urls.get(c)])
                        if is_ret:
                            for c in ["img_front", "img_left", "img_rear", "img_right"]:
                                if c in angle_urls:
                                    b_raw["checkin_" + c] = angle_urls[c]
                            b_raw["inspection_photos_in"] = photo_str
                            b_raw["return_photos"] = photo_str
                        else:
                            for c in ["img_front", "img_left", "img_rear", "img_right"]:
                                if c in angle_urls:
                                    b_raw["checkout_" + c] = angle_urls[c]
                            b_raw["inspection_photos_out"] = photo_str
                            b_raw["dispatch_photos"] = photo_str
                        b_target = dict(b_raw)
                if b_target:
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

    return await asyncio.to_thread(_process_4_angles)


# -------------------------------------------------------------------------
# CARS FLEET, OPTIONS, HP LEASING & CAR MAINTENANCE ROI
# -------------------------------------------------------------------------
@router.get("/api/cars")
@router.get("/api/vehicles")
def list_cars(start_date: Optional[str] = None, end_date: Optional[str] = None):
    if not store.initial_sync_done:
        store.sync_from_database(force=True)
    with store.lock:
        cars_snapshot = [(plate, dict(car)) for plate, car in store.cars.items()]
        bookings_snapshot = [dict(b) for b in store.bookings]
    cars_data = []
    for plate, car in cars_snapshot:
        norm_p = re.sub(r"[\s\-_]", "", str(plate)).strip().lower()

        # Check if this car has an active booking that is truly On Rent
        has_real_on_rent = any(
            re.sub(r"[\s\-_]", "", str(_b.get("car_id", ""))).strip().lower() == norm_p
            and _b.get("status") in ("กำลังเช่า", "รอรับคืน")
            for _b in bookings_snapshot
        )

        # Self-healing: if car.status is "กำลังเช่า" but NO booking is actually on rent, auto-correct
        if car.get("status") == "กำลังเช่า" and not has_real_on_rent:
            has_queue = any(
                re.sub(r"[\s\-_]", "", str(_b.get("car_id", ""))).strip().lower() == norm_p
                and _b.get("status") not in INACTIVE_BOOKING_STATUSES
                for _b in bookings_snapshot
            )
            corrected_status = "ติดจอง" if has_queue else "ว่างพร้อมใช้งาน"
            car["status"] = corrected_status
            with store.lock:
                if plate in store.cars:
                    store.cars[plate]["status"] = corrected_status
                    car_to_sync = dict(store.cars[plate])
                else:
                    car_to_sync = dict(car)
            store.async_sync_car(plate, car_to_sync)

        status_key, status_desc, color, bg, border = get_car_fleet_status(
            plate, car, bookings_snapshot, start_date, end_date
        )
        c_copy = dict(car)
        c_copy["fleet_status_key"] = status_key
        _fs, _fe = to_date(start_date), to_date(end_date)
        if _fs and not _fe:
            _fe = _fs
        if _fe and not _fs:
            _fs = _fe
        _on_rent = False
        if _fs and _fe:
            for _b in store.bookings:
                b_pid = re.sub(r"[\s\-_]", "", str(_b.get("car_id", ""))).strip().lower()
                if b_pid != norm_p or _b.get("status") in ("เสร็จสิ้น", "ยกเลิก", "Completed", "Canceled"):
                    continue
                _bs, _be = to_date(_b.get("start_date")), to_date(_b.get("end_date"))
                if _bs and _be:
                    if _bs == _be or _fs == _fe:
                        _overlaps = (_fs <= _be) and (_fe >= _bs)
                    else:
                        _overlaps = (_fs < _be) and (_fe > _bs)
                    if _overlaps:
                        c_copy["fleet_status_key"] = "unavailable"
                        if _b.get("status") in ("กำลังเช่า", "รอรับคืน"):
                            _on_rent = True
                        break
        else:
            _on_rent = has_real_on_rent

        c_copy["is_on_rent"] = _on_rent
        c_copy["fleet_status_desc"] = status_desc
        c_copy["status_color"] = color
        c_copy["status_bg"] = bg
        c_copy["status_border"] = border
        cars_data.append(c_copy)
    return cars_data


@router.get("/api/finance-companies")
@router.get("/api/cars/finance-companies")
@router.get("/api/vehicles/finance-companies")
def get_finance_companies():
    """Fetch existing finance companies from database and in-memory store."""
    companies = set()
    for c in store.cars.values():
        fc = str(c.get("finance_company", "") or "").strip()
        if fc and fc not in ("-", "None", "none", "null", ""):
            companies.add(fc)

    # Also fetch from PostgreSQL table if available
    try:
        sb = get_db_client()
        if sb:
            res = sb.table("cars").select("finance_company").execute()
            for r in (res.data or []):
                fc = str(r.get("finance_company") or "").strip()
                if fc and fc not in ("-", "None", "none", "null", ""):
                    companies.add(fc)
    except Exception as e:
        print(f"Finance companies DB query note: {e}")

    defaults = [
        "โตโยต้า ลีสซิ่ง (Toyota Leasing)",
        "ทีทีบีไดรฟ์ / ธนชาต (ttb DRIVE)",
        "กรุงศรี ออโต้ (Krungsri Auto)",
        "กสิกร ลีสซิ่ง (KLeasing)",
        "ฮอนด้า ลีสซิ่ง (Honda Leasing)",
        "ไทยพาณิชย์ (SCB)",
        "เกียรตินาคินภัทร (KKP)",
        "ทิสโก้ (TISCO)"
    ]
    combined = sorted(list(companies.union(defaults)))
    return {"success": True, "companies": combined}


@router.get("/api/cars/options")
@router.get("/api/vehicles/options")
def get_vehicle_form_options():
    """Fetch unique values for Brand, Model, Company, Color, Insurance Co, Owner, Beneficiary, Year for Creatable Comboboxes."""
    brands = set()
    models = set()
    companies = set()
    colors = set()
    ins_companies = set()
    owners = set()
    beneficiaries = set()
    reg_years = set()

    for c in store.cars.values():
        for field, s in [
            ("brand", brands),
            ("model", models),
            ("company", companies),
            ("color", colors),
            ("ins_company", ins_companies),
            ("owner", owners),
            ("beneficiary", beneficiaries),
            ("reg_year", reg_years),
        ]:
            val = str(c.get(field, "") or "").strip()
            if val and val not in ("-", "None", "none", "null", ""):
                s.add(val)

    # Defaults to ensure initial clean suggestions
    default_brands = ["Toyota", "Honda", "Isuzu", "Mitsubishi", "Nissan", "Mazda", "Ford", "BYD", "GWM", "MG", "Mercedes-Benz", "BMW", "Hyundai"]
    default_companies = ["บจก.สวัสดี เรนทัล (Sawasdee Rental)", "Sawasdee Rent A Car", "P.D.P. Co., Ltd.", "Sawasdee Car Rent"]
    default_colors = ["ขาว", "ดำ", "เทา", "บรอนซ์เงิน", "แดง", "น้ำเงิน", "WHITE", "BLACK", "GREY", "SILVER"]
    default_ins = ["คุ้มภัยโตเกียวมารีน", "วิริยะประกันภัย", "ทิพยประกันภัย", "กรุงเทพประกันภัย", "ธนชาตประกันภัย", "เมืองไทยประกันภัย"]
    default_owners = ["SWD", "บีคลิ๊ก", "บจก.สวัสดี เรนทัล (Sawasdee Rental)", "Sawasdee Rent A Car"]
    default_beneficiaries = ["บจก.สวัสดี เรนทัล (Sawasdee Rental)", "Sawasdee Rent A Car", "P.D.P. Co., Ltd.", "โตโยต้า ลีสซิ่ง"]
    default_years = ["2568", "2567", "2566", "2565", "2564", "2563", "2025", "2024", "2023", "2022"]

    brands.update(default_brands)
    companies.update(default_companies)
    colors.update(default_colors)
    ins_companies.update(default_ins)
    owners.update(default_owners)
    beneficiaries.update(default_beneficiaries)
    reg_years.update(default_years)

    return {
        "success": True,
        "brands": sorted(list(brands)),
        "models": sorted(list(models)),
        "companies": sorted(list(companies)),
        "colors": sorted(list(colors)),
        "ins_companies": sorted(list(ins_companies)),
        "owners": sorted(list(owners)),
        "beneficiaries": sorted(list(beneficiaries)),
        "reg_years": sorted(list(reg_years))
    }


@router.post("/api/cars")
@router.post("/api/vehicles")
@router.put("/api/cars")
@router.put("/api/vehicles")
@router.put("/api/cars/{plate_param}")
@router.put("/api/vehicles/{plate_param}")
def create_or_update_car(payload: Union[VehicleCreate, Dict[str, Any]], plate_param: Optional[str] = None):
    if hasattr(payload, "model_dump"):
        payload = payload.model_dump(exclude_unset=False)
    elif hasattr(payload, "dict"):
        payload = payload.dict()
    else:
        payload = dict(payload)

    def _has(v):
        return v is not None and str(v).strip() not in ("", "-")

    # Remap legacy keys onto canonical keys so new columns are never stored as NULL
    for new_key, legacy_key in (
        ("vin", "chassis_no"),
        ("tax_expire_date", "tax_expiry"),
        ("prb_expire_date", "act_expiry"),
        ("insurance_expire_date", "ins_expiry"),
    ):
        if not _has(payload.get(new_key)) and _has(payload.get(legacy_key)):
            payload[new_key] = payload[legacy_key]
        payload[new_key] = payload.get(new_key) if payload.get(new_key) is not None else "-"
    for new_key, legacy_key in (("daily_rate", "price_day"), ("weekly_rate", "price_week"), ("monthly_rate", "price_month")):
        try:
            new_v = float(payload.get(new_key) or 0)
            old_v = float(payload.get(legacy_key) or 0)
        except (TypeError, ValueError):
            continue
        if new_v <= 0 < old_v:
            payload[new_key] = old_v
        elif old_v <= 0 < new_v:
            payload[legacy_key] = new_v
    if payload.get("payment_due_date") is None:
        payload["payment_due_date"] = "-"

    plate = str(payload.get("plate", "") or plate_param or "").strip()
    if not plate:
        return JSONResponse(
            status_code=400,
            content={"error": "missing_plate", "message": "กรุณาระบุเลขทะเบียนรถ"}
        )

    original_plate = str(payload.get("original_plate") or "").strip()
    norm_new = normalize_plate(plate)
    norm_orig = normalize_plate(original_plate) if original_plate else ""

    new_chassis = str(payload.get("chassis_no") or payload.get("vin") or "").strip().upper()
    has_valid_chassis = bool(new_chassis and new_chassis != "-" and len(new_chassis) >= 6)

    # 1. Query in-memory store for duplicates (normalized plate and chassis/VIN)
    plate_exists = False
    vin_exists = False
    conflict_car = None

    for existing_plate, c_obj in store.cars.items():
        if norm_orig and normalize_plate(existing_plate) == norm_orig:
            continue  # Editing same vehicle is allowed
        if normalize_plate(existing_plate) == norm_new:
            plate_exists = True
            conflict_car = c_obj
            break
        if has_valid_chassis:
            existing_chassis = str(c_obj.get("chassis_no") or c_obj.get("vin") or "").strip().upper()
            if existing_chassis and existing_chassis == new_chassis:
                vin_exists = True
                conflict_car = c_obj
                break

    # 2. Query Database (PostgreSQL) directly to ensure complete consistency
    if not plate_exists and not vin_exists:
        try:
            sb = get_db_client()
            if sb:
                db_res = sb.table("cars").select("plate, chassis_no, brand, model").execute()
                for row in (db_res.data or []):
                    r_plate = str(row.get("plate") or "").strip()
                    if norm_orig and normalize_plate(r_plate) == norm_orig:
                        continue
                    if normalize_plate(r_plate) == norm_new:
                        plate_exists = True
                        conflict_car = row
                        break
                    if has_valid_chassis:
                        r_chassis = str(row.get("chassis_no") or "").strip().upper()
                        if r_chassis and r_chassis == new_chassis:
                            vin_exists = True
                            conflict_car = row
                            break
        except Exception as e:
            print(f"Direct DB duplicate query check note: {e}")

    # Return 409 Conflict if duplicate detected
    if plate_exists or vin_exists:
        err_msg = "ข้อมูลซ้ำ: พบเลขทะเบียนหรือเลขตัวถังนี้ในระบบแล้ว"
        if conflict_car:
            c_p = conflict_car.get("plate") or ""
            c_b = conflict_car.get("brand") or ""
            c_m = conflict_car.get("model") or ""
            if c_p:
                err_msg += f" (ทะเบียน {c_p} {c_b} {c_m})".strip()
        return JSONResponse(
            status_code=409,
            content={
                "error": "duplicate_vehicle",
                "message": err_msg,
                "detail": err_msg
            }
        )

    # 3. If plate renamed/corrected from a different original_plate
    if original_plate and original_plate != plate and original_plate in store.cars:
        store.async_delete_car(original_plate)
        with store.lock:
            for b in store.bookings:
                if b.get("car_id") == original_plate:
                    b["car_id"] = plate
                    store.async_sync_booking(b)

    # 3. Compress car image if passed as a large base64 data URI
    img_data = payload.get("image")
    if img_data and isinstance(img_data, str) and img_data.startswith("data:image/") and ";base64," in img_data:
        try:
            if len(img_data) > 100000:
                import base64
                from PIL import Image
                header, b64_str = img_data.split(";base64,", 1)
                raw_bytes = base64.b64decode(b64_str)
                pil_img = Image.open(io.BytesIO(raw_bytes))
                if pil_img.mode in ("RGBA", "P"):
                    pil_img = pil_img.convert("RGB")
                pil_img.thumbnail((800, 600), Image.Resampling.LANCZOS)
                buf = io.BytesIO()
                pil_img.save(buf, format="JPEG", quality=75, optimize=True)
                new_b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
                payload["image"] = f"data:image/jpeg;base64,{new_b64}"
        except Exception as e:
            print(f"Car image compression note: {e}")

    # Sanitize service interval fields (date string and mileage number)
    raw_ns_date = payload.get("next_service_date") or payload.get("next_engine_oil_date")
    if raw_ns_date:
        payload["next_service_date"] = str(raw_ns_date).strip()
        payload["next_engine_oil_date"] = str(raw_ns_date).strip()
    raw_ns_mileage = payload.get("next_service_mileage") if payload.get("next_service_mileage") is not None else payload.get("next_engine_oil_mileage")
    if raw_ns_mileage is not None and str(raw_ns_mileage).strip() != "":
        try:
            val_m = float(str(raw_ns_mileage).replace(",", "").strip())
            payload["next_service_mileage"] = val_m
            payload["next_engine_oil_mileage"] = val_m
        except Exception:
            payload["next_service_mileage"] = 0.0
            payload["next_engine_oil_mileage"] = 0.0
    else:
        payload["next_service_mileage"] = 0.0
        payload["next_engine_oil_mileage"] = 0.0

    # Sanitize prb_price (float) and insurance_premium (float)
    raw_prb_price = payload.get("prb_price") if payload.get("prb_price") is not None else payload.get("act_price")
    if raw_prb_price is not None and str(raw_prb_price).strip() != "":
        try:
            val_p = float(str(raw_prb_price).replace(",", "").strip())
            payload["prb_price"] = val_p
            payload["act_price"] = val_p
        except Exception:
            payload["prb_price"] = 0.0
            payload["act_price"] = 0.0
    else:
        payload["prb_price"] = 0.0
        payload["act_price"] = 0.0

    raw_ins_premium = payload.get("insurance_premium") if payload.get("insurance_premium") is not None else payload.get("ins_premium")
    if raw_ins_premium is not None and str(raw_ins_premium).strip() != "":
        try:
            val_i = float(str(raw_ins_premium).replace(",", "").strip())
            payload["insurance_premium"] = val_i
            payload["ins_premium"] = val_i
        except Exception:
            payload["insurance_premium"] = 0.0
            payload["ins_premium"] = 0.0
    else:
        payload["insurance_premium"] = 0.0
        payload["ins_premium"] = 0.0

    # Sanitize register_year, owner_name, beneficiary, insurance_company & finance_company
    reg_year_val = str(payload.get("registration_year") or payload.get("register_year") or payload.get("reg_year") or "-").strip() or "-"
    payload["registration_year"] = reg_year_val
    payload["register_year"] = reg_year_val
    payload["reg_year"] = reg_year_val

    owner_val = str(payload.get("owner_name") or payload.get("car_owner") or payload.get("owner") or "-").strip() or "-"
    payload["owner_name"] = owner_val
    payload["car_owner"] = owner_val
    payload["owner"] = owner_val

    payload["beneficiary"] = str(payload.get("beneficiary") or "-").strip() or "-"

    ins_comp_val = str(payload.get("insurance_company") or payload.get("ins_company") or "-").strip() or "-"
    payload["insurance_company"] = ins_comp_val
    payload["ins_company"] = ins_comp_val

    fin_comp_val = str(payload.get("finance_company") or "-").strip() or "-"
    payload["finance_company"] = fin_comp_val

    # Vehicle Identification Numbers
    engine_no_val = str(payload.get("engine_no") or "-").strip() or "-"
    payload["engine_no"] = engine_no_val

    # ACT Policy Details (เลข พ.ร.บ. - Map to policy_no & act_policy_no)
    act_pol = str(payload.get("act_policy_no") or "-").strip() or "-"
    if act_pol == "-" and payload.get("policy_no") and str(payload.get("policy_no")).strip() not in ["", "-"]:
        act_pol = str(payload.get("policy_no")).strip()
    payload["act_policy_no"] = act_pol
    payload["policy_no"] = act_pol  # STRICT: db_car.policy_no = payload.act_policy_no (ACT policy number)
    act_comp = str(payload.get("act_company") or "-").strip() or "-"
    payload["act_company"] = act_comp

    # Comprehensive Insurance Policy Details (เลขกรมธรรม์ประกันภัย - Map to insurance_policy_no & ins_policy_no)
    ins_pol = str(payload.get("ins_policy_no") or payload.get("insurance_policy_no") or "-").strip() or "-"
    payload["ins_policy_no"] = ins_pol
    payload["insurance_policy_no"] = ins_pol  # STRICT: db_car.insurance_policy_no = payload.insurance_policy_no

    payload["ins_category"] = str(payload.get("ins_category") or "-").strip() or "-"
    payload["ins_type"] = str(payload.get("ins_type") or "-").strip() or "-"
    payload["ins_class"] = str(payload.get("ins_class") or "-").strip() or "-"

    raw_cov = payload.get("ins_coverage_amount")
    if raw_cov is not None and str(raw_cov).strip() != "":
        try:
            payload["ins_coverage_amount"] = float(str(raw_cov).replace(",", "").strip())
        except Exception:
            payload["ins_coverage_amount"] = 0.0
    else:
        payload["ins_coverage_amount"] = 0.0

    # TARGET MISSION 2: Auto-log renewal history into maintenance_records when expiry dates change
    existing_car = store.cars.get(plate) or (store.cars.get(original_plate) if original_plate else None)
    if existing_car:
        def _clean_d(val):
            return str(val or "").strip()

        old_tax = _clean_d(existing_car.get("tax_expire_date") or existing_car.get("tax_expiry"))
        new_tax = _clean_d(payload.get("tax_expire_date") or payload.get("tax_expiry"))

        old_act = _clean_d(existing_car.get("prb_expire_date") or existing_car.get("act_expiry"))
        new_act = _clean_d(payload.get("prb_expire_date") or payload.get("act_expiry"))

        old_ins = _clean_d(existing_car.get("insurance_expire_date") or existing_car.get("ins_expiry"))
        new_ins = _clean_d(payload.get("insurance_expire_date") or payload.get("ins_expiry"))

        now_t = now_th()
        worker = str(payload.get("recorded_by") or payload.get("assigned_worker") or "admin")

        # 1. Insurance Renewal Log
        if new_ins and new_ins != "-" and new_ins != old_ins:
            ins_cost = float(payload.get("insurance_premium", 0) or 0)
            ins_co = str(payload.get("insurance_company") or existing_car.get("insurance_company") or "-")
            rec_id = f"MNT{now_t.strftime('%y%m%d%H%M%S')}"
            renewal_rec = {
                "id": rec_id,
                "car_id": plate,
                "car_brand": payload.get("brand") or existing_car.get("brand", ""),
                "car_model": payload.get("model") or existing_car.get("model", ""),
                "car_color": payload.get("color") or existing_car.get("color", ""),
                "order_type": "ต่อประกันภัยรถยนต์",
                "service_items": f"1. ต่ออายุกรมธรรม์ประกันภัย ถึง {new_ins}\n2. บริษัทประกัน: {ins_co}\n3. เบี้ยประกัน: ฿{ins_cost:,.2f}",
                "cost": ins_cost,
                "actual_cost": ins_cost,
                "service_center": ins_co if ins_co != "-" else "ศูนย์บริการมาตรฐาน",
                "service_center_phone": "-",
                "service_location": "-",
                "assigned_worker": worker,
                "schedule_date": now_t.date().isoformat(),
                "schedule_time": now_t.strftime("%H:%M"),
                "expected_finish_date": now_t.date().isoformat(),
                "expected_finish_time": now_t.strftime("%H:%M"),
                "status": "เสร็จสิ้น",
                "current_mileage": str(payload.get("mileage") or existing_car.get("mileage") or "-"),
                "notes": f"บันทึกประวัติต่ออายุประกันภัยรถยนต์ ทะเบียน {plate} (หมดอายุใหม่: {new_ins})",
                "completion_notes": f"ต่อประกันเรียบร้อย สิ้นสุด {new_ins}",
                "update_car_status": False,
                "created_by": worker,
                "created_at": now_t.strftime("%Y-%m-%d %H:%M:%S"),
                "completed_at": now_t.strftime("%Y-%m-%d %H:%M:%S"),
                "new_ins_expiry": new_ins,
                "insurance_company": ins_co
            }
            store.async_sync_maintenance(renewal_rec)
            try:
                store.log_work_order(
                    car_id=plate,
                    booking_id=rec_id,
                    work_type="Renew Tax",
                    description=f"ต่อประกันภัยรถยนต์: {ins_co} สิ้นสุด {new_ins}. เบี้ย: ฿{ins_cost:,.2f}",
                    cost=ins_cost,
                    staff_id=worker
                )
            except Exception as e:
                print(f"Error logging work order for car insurance renewal: {e}")

        # 2. ACT / PRB Renewal Log
        if new_act and new_act != "-" and new_act != old_act:
            act_cost = float(payload.get("prb_price", 0) or 0)
            time.sleep(0.01)
            rec_id = f"MNT{now_th().strftime('%y%m%d%H%M%S')}"
            renewal_rec = {
                "id": rec_id,
                "car_id": plate,
                "car_brand": payload.get("brand") or existing_car.get("brand", ""),
                "car_model": payload.get("model") or existing_car.get("model", ""),
                "car_color": payload.get("color") or existing_car.get("color", ""),
                "order_type": "ต่อทะเบียน / พ.ร.บ.",
                "service_items": f"1. ต่ออายุ พ.ร.บ. คุ้มครองผู้ประสบภัยจากรถ ถึง {new_act}\n2. ราคา พ.ร.บ.: ฿{act_cost:,.2f}",
                "cost": act_cost,
                "actual_cost": act_cost,
                "service_center": "สำนักงานขนส่ง / ตัวแทน พ.ร.บ.",
                "service_center_phone": "-",
                "service_location": "-",
                "assigned_worker": worker,
                "schedule_date": now_t.date().isoformat(),
                "schedule_time": now_t.strftime("%H:%M"),
                "expected_finish_date": now_t.date().isoformat(),
                "expected_finish_time": now_t.strftime("%H:%M"),
                "status": "เสร็จสิ้น",
                "current_mileage": str(payload.get("mileage") or existing_car.get("mileage") or "-"),
                "notes": f"บันทึกประวัติต่อ พ.ร.บ. ทะเบียน {plate} (หมดอายุใหม่: {new_act})",
                "completion_notes": f"ต่อ พ.ร.บ. เรียบร้อย สิ้นสุด {new_act}",
                "update_car_status": False,
                "created_by": worker,
                "created_at": now_t.strftime("%Y-%m-%d %H:%M:%S"),
                "completed_at": now_t.strftime("%Y-%m-%d %H:%M:%S"),
                "new_act_expiry": new_act
            }
            store.async_sync_maintenance(renewal_rec)
            try:
                store.log_work_order(
                    car_id=plate,
                    booking_id=rec_id,
                    work_type="Renew Tax",
                    description=f"ต่อ พ.ร.บ. รถยนต์: สิ้นสุด {new_act}. ค่า พ.ร.บ.: ฿{act_cost:,.2f}",
                    cost=act_cost,
                    staff_id=worker
                )
            except Exception as e:
                print(f"Error logging work order for car PRB renewal: {e}")

        # 3. Tax Renewal Log
        if new_tax and new_tax != "-" and new_tax != old_tax:
            time.sleep(0.01)
            rec_id = f"MNT{now_th().strftime('%y%m%d%H%M%S')}"
            renewal_rec = {
                "id": rec_id,
                "car_id": plate,
                "car_brand": payload.get("brand") or existing_car.get("brand", ""),
                "car_model": payload.get("model") or existing_car.get("model", ""),
                "car_color": payload.get("color") or existing_car.get("color", ""),
                "order_type": "ต่อภาษีประจำปี",
                "service_items": f"1. ตรวจสภาพรถยนต์ ตรอ.\n2. ชำระภาษีรถยนต์ประจำปี สิ้นสุด {new_tax}",
                "cost": 0.0,
                "actual_cost": 0.0,
                "service_center": "สำนักงานขนส่งทางบก",
                "service_center_phone": "-",
                "service_location": "-",
                "assigned_worker": worker,
                "schedule_date": now_t.date().isoformat(),
                "schedule_time": now_t.strftime("%H:%M"),
                "expected_finish_date": now_t.date().isoformat(),
                "expected_finish_time": now_t.strftime("%H:%M"),
                "status": "เสร็จสิ้น",
                "current_mileage": str(payload.get("mileage") or existing_car.get("mileage") or "-"),
                "notes": f"บันทึกประวัติต่อภาษีรถยนต์ประจำปี ทะเบียน {plate} (หมดอายุใหม่: {new_tax})",
                "completion_notes": f"ต่อภาษีเรียบร้อย สิ้นสุด {new_tax}",
                "update_car_status": False,
                "created_by": worker,
                "created_at": now_t.strftime("%Y-%m-%d %H:%M:%S"),
                "completed_at": now_t.strftime("%Y-%m-%d %H:%M:%S"),
                "new_tax_expiry": new_tax
            }
            store.async_sync_maintenance(renewal_rec)
            try:
                store.log_work_order(
                    car_id=plate,
                    booking_id=rec_id,
                    work_type="Renew Tax",
                    description=f"ต่อภาษีรถยนต์ประจำปี: สิ้นสุด {new_tax}",
                    cost=0.0,
                    staff_id=worker
                )
            except Exception as e:
                print(f"Error logging work order for car tax renewal: {e}")

    # TARGET MISSION 3: Auto-log to insurance_records table for historical policy tracking
    ins_company_val = str(payload.get("ins_company") or payload.get("insurance_company") or "-").strip() or "-"
    ins_expiry_val = str(payload.get("insurance_expire_date") or payload.get("ins_expiry") or "-").strip() or "-"
    if ins_pol != "-" or ins_company_val != "-" or (ins_expiry_val != "-" and ins_expiry_val != ""):
        clean_p = re.sub(r'[^a-zA-Z0-9]', '', plate)
        ins_rec_id = f"INS{now_th().strftime('%y%m%d%H%M%S')}_{clean_p}"
        ins_rec = {
            "id": ins_rec_id,
            "car_id": plate,
            "ins_company": ins_company_val,
            "ins_policy_no": ins_pol,
            "ins_class": str(payload.get("ins_class") or "-"),
            "ins_category": str(payload.get("ins_category") or "-"),
            "ins_type": str(payload.get("ins_type") or "-"),
            "ins_coverage_amount": float(payload.get("ins_coverage_amount") or 0.0),
            "ins_premium": float(payload.get("insurance_premium") or payload.get("ins_premium") or 0.0),
            "expiry_date": ins_expiry_val,
            "ins_doc_url": payload.get("ins_doc_url") or None,
            "notes": f"บันทึกประวัติกรมธรรม์ประกันภัย ทะเบียน {plate}",
            "created_by": str(payload.get("recorded_by") or payload.get("assigned_worker") or "admin"),
            "created_at": now_th().strftime("%Y-%m-%d %H:%M:%S")
        }
        store.async_sync_insurance_record(ins_rec)

    payload["plate"] = plate
    store.async_sync_car(plate, payload)
    return {"success": True, "car": store.cars.get(plate, payload)}


@router.get("/api/cars/{plate:path}/insurance-records")
def get_car_insurance_records(plate: str):
    clean_plate = urllib.parse.unquote(plate).strip()
    norm = re.sub(r"[\s\-\.]+", "", clean_plate).lower()
    matched = [
        r for r in getattr(store, "insurance_records", [])
        if str(r.get("car_id", "")).strip() == clean_plate or re.sub(r"[\s\-\.]+", "", str(r.get("car_id", ""))).lower() == norm
    ]
    return {"success": True, "plate": clean_plate, "records": matched}


@router.get("/api/hp-leasing")
def get_hp_leasing_data():
    return {
        "contracts": DEFAULT_HP_LEASING,
        "summary": DEFAULT_HP_SUMMARY,
        "property_insurance": DEFAULT_PROPERTY_INSURANCE
    }


@router.get("/api/cars/check-duplicates")
def check_car_duplicates():
    seen_plates = {}
    seen_chassis = {}
    duplicate_plates = []
    duplicate_chassis = []

    for plate, car in store.cars.items():
        np = normalize_plate(plate)
        if np in seen_plates:
            duplicate_plates.append({"plate": plate, "conflicts_with": seen_plates[np]})
        else:
            seen_plates[np] = plate

        ch = str(car.get("chassis_no") or "").strip().upper()
        if ch and ch != "-" and len(ch) >= 8:
            if ch in seen_chassis:
                duplicate_chassis.append({"plate": plate, "chassis_no": ch, "conflicts_with": seen_chassis[ch]})
            else:
                seen_chassis[ch] = plate

    return {
        "total_cars": len(store.cars),
        "duplicate_plates_count": len(duplicate_plates),
        "duplicate_chassis_count": len(duplicate_chassis),
        "duplicate_plates": duplicate_plates,
        "duplicate_chassis": duplicate_chassis,
        "is_clean": len(duplicate_plates) == 0 and len(duplicate_chassis) == 0
    }


@router.delete("/api/cars/{plate}")
def delete_car(plate: str):
    plate = plate.strip()
    norm_target = normalize_plate(plate)
    target_key = None
    target_obj = None

    for p_key, c in store.cars.items():
        if p_key == plate or normalize_plate(p_key) == norm_target:
            target_key = p_key
            target_obj = c
            break

    if not target_obj and target_key not in store.cars:
        raise HTTPException(status_code=404, detail=f"ไม่พบข้อมูลรถยนต์ทะเบียน '{plate}' ในระบบ")

    actual_plate = target_key or plate

    # Check if this car has active bookings / contracts
    active_bks = [
        b for b in store.bookings
        if (b.get("car_id") == actual_plate or (target_key and b.get("car_id") == target_key))
        and b.get("status") not in ["เสร็จสิ้น", "ยกเลิก"]
    ]
    if active_bks:
        raise HTTPException(
            status_code=400,
            detail=f"ไม่สามารถลบรถยนต์ทะเบียน '{actual_plate}' ได้ เนื่องจากมีรายการจองหรือสัญญาที่ยังไม่เสร็จสิ้น ({len(active_bks)} รายการ)"
        )

    store.async_delete_car(actual_plate)
    return {"success": True, "message": f"ลบข้อมูลรถยนต์ทะเบียน {actual_plate} เรียบร้อยแล้ว"}


# -------------------------------------------------------------------------
# CAR 4-ANGLE IMAGES (GOOGLE DRIVE AUTO-UPLOAD - TARGET MISSION 2)
# -------------------------------------------------------------------------
@router.post("/api/cars/{car_id}/images")
@router.post("/api/cars/{car_id:path}/images")
async def upload_car_image_endpoint(
    car_id: str,
    file: UploadFile = File(...),
    angle: Optional[str] = Form(None),
    view: Optional[str] = Query(None)
):
    """
    Dedicated endpoint for uploading car 4-angle images to Google Drive.
    Delegates to upload_car_image.
    """
    return await upload_car_image(car_id=car_id, file=file, angle=angle, view=view)


@router.post("/api/cars/{car_id:path}/4-angles")
@router.post("/api/inspections/{car_id:path}/4-angles")
async def upload_car_4_angles_endpoint(
    request: Request,
    car_id: str,
    booking_id: Optional[str] = Form(None),
    job_type: Optional[str] = Form("Dispatch"),
    files: Optional[Union[List[UploadFile], UploadFile]] = File(None),
    photos: Optional[Union[List[UploadFile], UploadFile]] = File(None),
    images: Optional[Union[List[UploadFile], UploadFile]] = File(None),
    file: Optional[UploadFile] = File(None),
    front: Optional[UploadFile] = File(None),
    left: Optional[UploadFile] = File(None),
    rear: Optional[UploadFile] = File(None),
    right: Optional[UploadFile] = File(None)
):
    return await upload_car_4_angles(
        request=request,
        car_id=car_id,
        booking_id=booking_id,
        job_type=job_type,
        files=files,
        photos=photos,
        images=images,
        file=file,
        front=front,
        left=left,
        rear=rear,
        right=right
    )


# -------------------------------------------------------------------------
# VEHICLE MAINTENANCE & ROI (MISSION 2)
# -------------------------------------------------------------------------
@router.get("/api/cars/{plate:path}/maintenances")
def get_car_maintenances(plate: str):
    clean_plate = urllib.parse.unquote(plate).strip()
    records = store.get_combined_maintenance_history(clean_plate)
    roi_data = store.get_car_financial_roi(clean_plate)
    return {
        "success": True,
        "plate": clean_plate,
        "records": records,
        **roi_data
    }


@router.post("/api/cars/{plate:path}/maintenances")
def add_car_maintenance(plate: str, payload: Dict[str, Any]):
    clean_plate = urllib.parse.unquote(plate).strip()
    if not clean_plate:
        raise HTTPException(status_code=400, detail="ไม่พบทะเบียนรถ")

    m_date = str(payload.get("date") or now_th().date().isoformat()).strip()
    desc = str(payload.get("description") or "").strip()
    if not desc:
        raise HTTPException(status_code=400, detail="กรุณาระบุรายละเอียดการซ่อมบำรุง")

    try:
        cost_val = float(payload.get("cost") or 0.0)
    except Exception:
        cost_val = 0.0

    record = {
        "car_id": clean_plate,
        "date": m_date,
        "description": desc,
        "cost": cost_val,
        "created_at": datetime.now().isoformat()
    }
    # TARGET MISSION 3: Strict Routing - renewal/insurance goes to insurance_records, NOT maintenance_logs
    is_renewal_quick = any(k in desc.lower() for k in ["ต่ออายุ", "ต่อทะเบียน", "พ.ร.บ.", "พรบ", "ประกัน", "ภาษี", "act", "insurance", "tax", "กรมธรรม์"])
    if is_renewal_quick:
        ins_rec_id = f"INS{now_th().strftime('%y%m%d%H%M%S')}_{re.sub(r'[^a-zA-Z0-9]', '', clean_plate)}"
        ins_rec = {
            "id": ins_rec_id,
            "car_id": clean_plate,
            "ins_company": (store.cars.get(clean_plate) or {}).get("ins_company") or "-",
            "ins_policy_no": (store.cars.get(clean_plate) or {}).get("ins_policy_no") or "-",
            "ins_class": str((store.cars.get(clean_plate) or {}).get("ins_class") or "-"),
            "ins_category": str((store.cars.get(clean_plate) or {}).get("ins_category") or "-"),
            "ins_type": "ต่ออายุ พ.ร.บ./ประกันภัย",
            "ins_coverage_amount": float((store.cars.get(clean_plate) or {}).get("ins_coverage_amount") or 0.0),
            "ins_premium": cost_val,
            "expiry_date": m_date,
            "ins_doc_url": (store.cars.get(clean_plate) or {}).get("ins_doc_url") or None,
            "notes": desc,
            "created_by": "admin",
            "created_at": datetime.now().isoformat()
        }
        try:
            store.async_sync_insurance_record(ins_rec)
        except Exception as e_ins:
            print(f"async_sync_insurance_record quick error: {e_ins}")
        saved = ins_rec
    else:
        saved = store.async_add_vehicle_maintenance(record)
        try:
            store.log_maintenance(
                car_id=clean_plate,
                date=m_date,
                expense_type="ซ่อมบำรุง",
                description=desc,
                cost=cost_val,
                recorded_by="admin"
            )
        except Exception:
            pass

    roi_data = store.get_car_financial_roi(clean_plate)
    records = store.get_combined_maintenance_history(clean_plate)

    return {
        "success": True,
        "message": "บันทึกประวัติซ่อมบำรุงเรียบร้อย",
        "record": saved,
        "records": records,
        **roi_data
    }


@router.delete("/api/cars/{plate:path}/maintenances/{m_id}")
def delete_car_maintenance(plate: str, m_id: str):
    clean_plate = urllib.parse.unquote(plate).strip()
    clean_id = urllib.parse.unquote(m_id).strip()
    store.hard_delete_work_order(clean_id, car_id=clean_plate)
    execute_hard_delete_work_order_db(clean_id, clean_plate)
    store.async_delete_vehicle_maintenance(clean_id)
    store.async_delete_maintenance_log(clean_id)
    roi_data = store.get_car_financial_roi(clean_plate)
    records = store.get_combined_maintenance_history(clean_plate)
    return {
        "success": True,
        "message": "ลบรายการซ่อมบำรุงเรียบร้อย",
        "records": records,
        **roi_data
    }
