import os
import io
import time
import asyncio
from datetime import datetime, date, timedelta, timezone
from typing import Optional, List, Dict, Any, Union
from pydantic import BaseModel, Field
from fastapi import FastAPI, HTTPException, Request, Response, UploadFile, File, Form, Depends, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
import re

from gdrive_service import (
    gdrive_service,
    build_gdrive_filename,
    get_gdrive_folder_id,
    FOLDER_INSURANCE_ACT,
    FOLDER_CAR_ANGLES,
    FOLDER_PAYMENT_SLIPS
)

from db import (
    store,
    get_db_client,
    get_car_fleet_status,
    calculate_rental_duration_and_days,
    format_date_dmy,
    to_date,
    start_background_cloud_sync,
    DEFAULT_HP_LEASING,
    DEFAULT_HP_SUMMARY,
    DEFAULT_PROPERTY_INSURANCE,
    deduplicate_cars_dict,
    hash_password,
    verify_password,
    is_password_hashed
)
import pdf_engine
from line_service import (
    send_line_broadcast_message,
    send_line_push_message,
    send_line_reply_message,
    send_line_to_admin_async,
    send_line_to_worker_async,
    resolve_worker_line_id,
    get_admin_line_id,
    notify_line_work_order,
    notify_line_maintenance,
    notify_line_close_maintenance,
    notify_line_deposit,
    notify_line_expense,
    check_and_send_expiry_alerts,
    init_expiry_scheduler_thread
)

from dependencies import (
    BASE_DIR,
    TH_TZ,
    static_dir,
    INACTIVE_BOOKING_STATUSES,
    now_th,
    convert_gdrive_url,
    normalize_plate,
    get_car_key,
)
from services.google_drive_service import async_upload_pdf_to_drive
from services.booking_service import (
    find_booking_overlap,
    raise_overlap_error,
    release_car_after_booking,
    require_contract_before_rent,
    record_booking_completion_income,
    _update_car_mileage_on_return,
    _resolve_cust_and_car,
)
from services.finance_service import (
    compute_monthly_expenses,
    normalize_payment_channel,
    compute_dashboard_statistics,
)
from services.maintenance_service import execute_hard_delete_work_order_db

from routers import (
    cars_router,
    auth_router,
    customers_router,
    line_router,
    system_router,
    finance_router,
    reports_router,
    maintenance_router,
)
app = FastAPI(title="SawasdeeRental Web App", version="2.0.0")
app.include_router(cars_router)
app.include_router(auth_router)
app.include_router(customers_router)
app.include_router(line_router)
app.include_router(system_router)
app.include_router(finance_router)
app.include_router(reports_router)
app.include_router(maintenance_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_origin_regex=r"https?://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Inspection PDF route with automatic on-demand generation fallback (prevents 404 on Render restarts)
@app.get("/static/pdf/inspections/{fname}")
def serve_static_inspection_pdf(fname: str):
    insp_dir = os.path.join(static_dir, "pdf", "inspections")
    file_path = os.path.join(insp_dir, fname)
    if os.path.exists(file_path):
        return FileResponse(file_path, media_type="application/pdf", filename=fname)
    m = re.match(r"^Inspection_(Checkout|Checkin|Checklist)_(MRC\w+)\.pdf$", fname, re.IGNORECASE)
    if m:
        kind = m.group(1).lower()
        bk_id = m.group(2)
        try:
            if kind == "checklist":
                return get_job_pdf(bk_id=bk_id)
            else:
                return get_inspection_pdf(bk_id=bk_id, type=kind, download=0)
        except Exception as e:
            print(f"[PDF Engine] On-demand fallback generation error for {fname}: {e}")
    raise HTTPException(status_code=404, detail="File Not Found")

app.mount("/static", StaticFiles(directory=static_dir), name="static")

from database import init_db

# Start background sync and scheduler on startup
@app.on_event("startup")
def startup_event():
    print("🚀 Starting SawasdeeRental Web App server...")
    import threading

    def _async_startup_bootstrap():
        # Attempt direct PostgreSQL schema check/migration (non-blocking)
        try:
            init_db()
            sb = get_db_client()
            if sb and hasattr(sb, "ensure_schema"):
                sb.ensure_schema()
        except Exception as e:
            print(f"Startup schema check note: {e}")

        # Perform initial sync in background so uvicorn binds port & returns 200 immediately
        try:
            store.sync_from_database(force=True)
        except Exception as e:
            print(f"Startup sync note: {e}")

    try:
        threading.Thread(target=_async_startup_bootstrap, daemon=True).start()
    except Exception as e:
        print(f"Startup bootstrap thread note: {e}")

    try:
        start_background_cloud_sync()
    except Exception as e:
        print(f"Background cloud sync start note: {e}")

    try:
        init_expiry_scheduler_thread()
    except Exception as e:
        print(f"Expiry scheduler start note: {e}")

# -------------------------------------------------------------------------
# CARS FLEET
# -------------------------------------------------------------------------
@app.get("/api/cars")
@app.get("/api/vehicles")
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
        if _fs and not _fe: _fe = _fs
        if _fe and not _fs: _fs = _fe
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

@app.get("/api/finance-companies")
@app.get("/api/cars/finance-companies")
@app.get("/api/vehicles/finance-companies")
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

@app.get("/api/cars/options")
@app.get("/api/vehicles/options")
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

from schemas import (
    VehicleCreate,
    VehicleUpdate,
    VehicleResponse,
    CustomerCreate,
    CustomerUpdate,
    CustomerResponse,
)
from models import Vehicle, Customer

@app.post("/api/cars")
@app.post("/api/vehicles")
@app.put("/api/cars")
@app.put("/api/vehicles")
@app.put("/api/cars/{plate_param}")
@app.put("/api/vehicles/{plate_param}")
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

@app.get("/api/cars/{plate:path}/insurance-records")
def get_car_insurance_records(plate: str):
    clean_plate = urllib.parse.unquote(plate).strip()
    norm = re.sub(r"[\s\-\.]+", "", clean_plate).lower()
    matched = [
        r for r in getattr(store, "insurance_records", [])
        if str(r.get("car_id", "")).strip() == clean_plate or re.sub(r"[\s\-\.]+", "", str(r.get("car_id", ""))).lower() == norm
    ]
    return {"success": True, "plate": clean_plate, "records": matched}

@app.get("/api/hp-leasing")
def get_hp_leasing_data():
    return {
        "contracts": DEFAULT_HP_LEASING,
        "summary": DEFAULT_HP_SUMMARY,
        "property_insurance": DEFAULT_PROPERTY_INSURANCE
    }

@app.get("/api/cars/check-duplicates")
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

@app.delete("/api/cars/{plate}")
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
@app.post("/api/cars/{car_id}/images")
@app.post("/api/cars/{car_id:path}/images")
async def upload_car_image_endpoint(
    car_id: str,
    file: UploadFile = File(...),
    angle: Optional[str] = Form(None),
    view: Optional[str] = Query(None)
):
    """
    Dedicated endpoint for uploading car 4-angle images to Google Drive.
    Delegates to routers.cars.upload_car_image.
    """
    from routers.cars import upload_car_image
    return await upload_car_image(car_id=car_id, file=file, angle=angle, view=view)

@app.post("/api/cars/{car_id:path}/4-angles")
@app.post("/api/inspections/{car_id:path}/4-angles")
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
    from routers.cars import upload_car_4_angles
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
# BOOKINGS
# -------------------------------------------------------------------------
@app.get("/api/bookings")
def list_bookings():
    if not store.initial_sync_done:
        store.sync_from_database(force=True)
    with store.lock:
        bookings_snap = [dict(b) for b in store.bookings]
        cars_snap = {k: dict(v) for k, v in store.cars.items()}
        customers_snap = {k: dict(v) for k, v in store.customers.items()}
    res = []
    for b_copy in bookings_snap:
        b_copy["start_date_formatted"] = format_date_dmy(b_copy.get("start_date"))
        b_copy["end_date_formatted"] = format_date_dmy(b_copy.get("end_date"))
        c_obj = cars_snap.get(b_copy.get("car_id"), {})
        b_copy["car_brand"] = c_obj.get("brand", "")
        b_copy["car_model"] = c_obj.get("model", "")
        b_copy["car_image"] = c_obj.get("image", "")
        cust_obj = customers_snap.get(b_copy.get("customer"), {})
        b_copy["customer_phone"] = cust_obj.get("contact_no", "-")
        # Robust data mapping for complex fields (JSON list, Boolean, PDF url)
        ext_val = b_copy.get("extension_history")
        if isinstance(ext_val, str):
            try:
                import json
                parsed_ext = json.loads(ext_val)
                b_copy["extension_history"] = parsed_ext if isinstance(parsed_ext, list) else [parsed_ext]
            except Exception:
                b_copy["extension_history"] = []
        elif not isinstance(ext_val, list):
            b_copy["extension_history"] = []
        b_copy["is_fully_paid"] = bool(b_copy.get("is_fully_paid", False) or b_copy.get("rental_paid", False))
        b_copy["contract_pdf_url"] = b_copy.get("contract_pdf_url") or ""
        b_copy["checkout_pdf_url"] = b_copy.get("checkout_pdf_url") or ""
        b_copy["checkin_pdf_url"] = b_copy.get("checkin_pdf_url") or ""
        
        # Harmonize slips between columns and payment_meta
        for item in (b_copy.get("extension_history") or []):
            if isinstance(item, dict) and item.get("type") == "payment_meta":
                if item.get("deposit_slip") and not b_copy.get("deposit_slip"):
                    b_copy["deposit_slip"] = item["deposit_slip"]
                if item.get("rental_slip") and not b_copy.get("rental_slip"):
                    b_copy["rental_slip"] = item["rental_slip"]
                if item.get("remaining_slip_link") and not b_copy.get("remaining_slip_link"):
                    b_copy["remaining_slip_link"] = item["remaining_slip_link"]
                if item.get("payment_slip_url") and not b_copy.get("payment_slip_url"):
                    b_copy["payment_slip_url"] = item["payment_slip_url"]
        if b_copy.get("payment_slip_url") and not b_copy.get("deposit_slip"):
            b_copy["deposit_slip"] = b_copy["payment_slip_url"]
        if b_copy.get("deposit_slip") and not b_copy.get("payment_slip_url"):
            b_copy["payment_slip_url"] = b_copy["deposit_slip"]
        if b_copy.get("remaining_slip_link") and not b_copy.get("rental_slip"):
            b_copy["rental_slip"] = b_copy["remaining_slip_link"]
        if b_copy.get("rental_slip") and not b_copy.get("remaining_slip_link"):
            b_copy["remaining_slip_link"] = b_copy["rental_slip"]

        # TARGET MISSION 3: Safe balance calculation (net_price - deposit_amount)
        if b_copy.get("rental_paid"):
            b_copy["remaining_rental"] = 0.0
        elif b_copy.get("deposit_paid"):
            np_val = float(b_copy.get("net_price") or 0.0)
            dep_val = float(b_copy.get("deposit_amount") or 5000.0)
            cur_rem = float(b_copy.get("remaining_rental") or 0.0)
            if (cur_rem >= np_val and np_val > 0) or b_copy.get("remaining_rental") is None:
                b_copy["remaining_rental"] = max(0.0, np_val - dep_val)
        res.append(b_copy)
    return res

@app.get("/api/bookings/{bk_id}")
def get_booking(bk_id: str):
    target = next((b for b in store.bookings if b.get("booking_id") == bk_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="ไม่พบรายการจอง")
    b_copy = dict(target)
    b_copy["start_date_formatted"] = format_date_dmy(target.get("start_date"))
    b_copy["end_date_formatted"] = format_date_dmy(target.get("end_date"))
    c_obj = store.cars.get(target.get("car_id"), {})
    b_copy["car_brand"] = c_obj.get("brand", "")
    b_copy["car_model"] = c_obj.get("model", "")
    b_copy["car_image"] = c_obj.get("image", "")
    cust_obj = store.customers.get(target.get("customer"), {})
    b_copy["customer_phone"] = cust_obj.get("contact_no", "-")
    ext_val = b_copy.get("extension_history")
    if isinstance(ext_val, str):
        try:
            import json
            parsed_ext = json.loads(ext_val)
            b_copy["extension_history"] = parsed_ext if isinstance(parsed_ext, list) else [parsed_ext]
        except Exception:
            b_copy["extension_history"] = []
    elif not isinstance(ext_val, list):
        b_copy["extension_history"] = []
    b_copy["is_fully_paid"] = bool(b_copy.get("is_fully_paid", False) or b_copy.get("rental_paid", False))
    b_copy["contract_pdf_url"] = b_copy.get("contract_pdf_url") or ""
    
    # Harmonize slips between columns and payment_meta
    for item in (b_copy.get("extension_history") or []):
        if isinstance(item, dict) and item.get("type") == "payment_meta":
            if item.get("deposit_slip") and not b_copy.get("deposit_slip"):
                b_copy["deposit_slip"] = item["deposit_slip"]
            if item.get("rental_slip") and not b_copy.get("rental_slip"):
                b_copy["rental_slip"] = item["rental_slip"]
            if item.get("remaining_slip_link") and not b_copy.get("remaining_slip_link"):
                b_copy["remaining_slip_link"] = item["remaining_slip_link"]
            if item.get("payment_slip_url") and not b_copy.get("payment_slip_url"):
                b_copy["payment_slip_url"] = item["payment_slip_url"]
    if b_copy.get("payment_slip_url") and not b_copy.get("deposit_slip"):
        b_copy["deposit_slip"] = b_copy["payment_slip_url"]
    if b_copy.get("deposit_slip") and not b_copy.get("payment_slip_url"):
        b_copy["payment_slip_url"] = b_copy["deposit_slip"]
    if b_copy.get("remaining_slip_link") and not b_copy.get("rental_slip"):
        b_copy["rental_slip"] = b_copy["remaining_slip_link"]
    if b_copy.get("rental_slip") and not b_copy.get("remaining_slip_link"):
        b_copy["remaining_slip_link"] = b_copy["rental_slip"]
    
    # TARGET MISSION 3: Safe balance calculation (net_price - deposit_amount)
    if b_copy.get("rental_paid"):
        b_copy["remaining_rental"] = 0.0
    elif b_copy.get("deposit_paid"):
        np_val = float(b_copy.get("net_price") or 0.0)
        dep_val = float(b_copy.get("deposit_amount") or 5000.0)
        cur_rem = float(b_copy.get("remaining_rental") or 0.0)
        if (cur_rem >= np_val and np_val > 0) or b_copy.get("remaining_rental") is None:
            b_copy["remaining_rental"] = max(0.0, np_val - dep_val)
    return b_copy

@app.post("/api/bookings")
def create_booking(payload: Dict[str, Any]):
    try:
        # Generate booking ID in Thailand Time: MRC<YYMMDD><HHMMSS>
        now = now_th()
        bk_id = payload.get("booking_id") or f"MRC{now.strftime('%y%m%d%H%M%S')}"
        
        start_d = to_date(payload.get("start_date"))
        end_d = to_date(payload.get("end_date"))
        
        if not start_d or not end_d:
            raise HTTPException(
                status_code=400,
                detail="กรุณาระบุวันที่เริ่มต้นและสิ้นสุดสัญญาให้ถูกต้อง"
            )

        # Block backdated contracts (start_date must be >= today in Thailand timezone)
        th_today = now.date()
        if start_d < th_today:
            raise HTTPException(
                status_code=400,
                detail=f"ไม่อนุญาตให้ทำสัญญาหรือจองรถย้อนหลัง: วันที่เริ่มต้น ({start_d.strftime('%d/%m/%Y')}) ต้องไม่น้อยกว่าวันที่ปัจจุบัน ({th_today.strftime('%d/%m/%Y')})"
            )
        if end_d < start_d:
            raise HTTPException(
                status_code=400,
                detail=f"วันที่สิ้นสุดสัญญา ({end_d.strftime('%d/%m/%Y')}) ต้องไม่น้อยกว่าวันที่เริ่มต้น ({start_d.strftime('%d/%m/%Y')})"
            )

        # Prevent double booking: block immediately when dates overlap an existing active queue
        _conflict = find_booking_overlap(payload.get("car_id"), start_d, end_d)
        if _conflict:
            raise_overlap_error(_conflict, "จองรถ")

        default_t = now.strftime("%H:%M")
        start_t = payload.get("start_time") or default_t
        end_t = payload.get("end_time") or default_t
        
        billable_days, extra_hours, rem_minutes, is_over_4hr, explanation = calculate_rental_duration_and_days(
            start_d, start_t, end_d, end_t
        )
        
        car_id = payload.get("car_id")
        car_obj = store.cars.get(car_id, {})
        price_day = float(car_obj.get("price_day") or car_obj.get("daily_rate") or 1000)
        price_week = float(car_obj.get("price_week") or (price_day * 6))
        price_month = float(car_obj.get("price_month") or (price_day * 20))
        contract_type = payload.get("contract_type", "รายวัน")
        
        base_price = payload.get("base_price")
        if base_price is None:
            if contract_type == "รายสัปดาห์":
                if billable_days <= 7:
                    base_price = price_week
                else:
                    weeks = billable_days // 7
                    rem_days = billable_days % 7
                    base_price = (weeks * price_week) + (rem_days * price_day)
            elif contract_type == "รายเดือน":
                if billable_days <= 30:
                    base_price = price_month
                else:
                    months = billable_days // 30
                    rem_days = billable_days % 30
                    base_price = (months * price_month) + (rem_days * price_day)
            else:
                base_price = price_day * billable_days

        discount = float(payload.get("discount", 0))
        net_price = max(0.0, float(base_price) - discount)
        deposit_amount = 5000.0 # STRICT RULE: Fixed 5,000 THB deposit
        deposit_paid = bool(payload.get("deposit_paid", False))
        rental_paid = bool(payload.get("rental_paid", False))

        dep_slip_url = convert_gdrive_url(payload.get("deposit_slip", "") or payload.get("slip_url", "") or payload.get("payment_slip_url", ""))
        rent_slip_url = convert_gdrive_url(payload.get("rental_slip", "") or payload.get("remaining_slip_link", ""))

        booking = {
            "booking_id": bk_id,
            "car_id": car_id,
            "customer": payload.get("customer", "ลูกค้าทั่วไป (Walk-in)"),
            "start_date": start_d,
            "end_date": end_d,
            "start_time": start_t,
            "end_time": end_t,
            "contract_type": contract_type,
            "base_price": base_price,
            "discount": discount,
            "net_price": net_price,
            "deposit_amount": deposit_amount,
            "deposit_paid": deposit_paid,
            "deposit_ref": payload.get("deposit_ref", "") or payload.get("payment_ref", ""),
            "deposit_slip": dep_slip_url,
            "payment_slip_url": dep_slip_url,
            "rental_paid": rental_paid,
            "remaining_rental": 0.0 if rental_paid else (max(0.0, net_price - deposit_amount) if deposit_paid else net_price),
            "rental_ref": payload.get("rental_ref", ""),
            "rental_slip": rent_slip_url,
            "remaining_slip_link": rent_slip_url,
            "created_by": payload.get("created_by", "admin"),
            "status": "รอส่งมอบ" if deposit_paid else "รอชำระมัดจำ",
            "dispatch_closed": False,
            "return_closed": False,
            "worker_delivery": payload.get("worker_delivery", ""),
            "worker_return": payload.get("worker_return", ""),
            "loc_delivery": payload.get("loc_delivery", "Sukhumvit"),
            "loc_return": payload.get("loc_return", payload.get("loc_delivery", "Sukhumvit")),
            "extension_history": [],
            "is_fully_paid": rental_paid,
            "rental_payment_method": payload.get("rental_payment_method", "เงินสด"),
            "created_at": now.isoformat()
        }
        
        with store.lock:
            store.bookings.insert(0, booking)
            c_key = get_car_key(car_id)
            if c_key and c_key in store.cars:
                norm_ck = re.sub(r"[\s\-_]", "", str(c_key)).strip().lower()
                has_active_on_rent = any(
                    re.sub(r"[\s\-_]", "", str(b.get("car_id", ""))).strip().lower() == norm_ck
                    and b.get("status") in ("กำลังเช่า", "รอรับคืน")
                    for b in store.bookings
                )
                if not has_active_on_rent and store.cars[c_key].get("status") != "ซ่อมบำรุง":
                    store.cars[c_key]["status"] = "ติดจอง"
                    store.async_sync_car(c_key, store.cars[c_key])
                
        store.async_sync_booking(booking)
        return {"success": True, "booking_id": bk_id, "booking": booking}
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Error in create_booking: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"เกิดข้อผิดพลาดในการสร้างรายการจอง: {str(e)}"
        )

@app.put("/api/bookings/{bk_id}")
def update_booking(bk_id: str, payload: Dict[str, Any]):
    target = next((b for b in store.bookings if b.get("booking_id") == bk_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="ไม่พบรายการจอง")
        
    th_today = now_th().date()
    if "start_date" in payload:
        new_sd = to_date(payload["start_date"])
        if new_sd and new_sd < th_today:
            raise HTTPException(
                status_code=400,
                detail=f"ไม่อนุญาตให้แก้ไขวันที่สัญญาย้อนหลัง: วันที่เริ่มต้น ({new_sd.strftime('%d/%m/%Y')}) ต้องไม่น้อยกว่าวันที่ปัจจุบัน ({th_today.strftime('%d/%m/%Y')})"
            )

    # ---- Validate everything BEFORE mutating the booking ----
    new_status = payload.get("status")
    prev_status = target.get("status")
    chk_s = to_date(payload["start_date"]) if "start_date" in payload else to_date(target.get("start_date"))
    chk_e = to_date(payload["end_date"]) if "end_date" in payload else to_date(target.get("end_date"))
    if chk_s and chk_e and chk_e < chk_s:
        raise HTTPException(status_code=400, detail="วันที่สิ้นสุดสัญญาต้องไม่น้อยกว่าวันที่เริ่มต้น")
    if ("start_date" in payload or "end_date" in payload) and prev_status not in INACTIVE_BOOKING_STATUSES:
        _conflict = find_booking_overlap(target.get("car_id"), chk_s, chk_e, exclude_booking_id=bk_id)
        if _conflict:
            raise_overlap_error(_conflict, "บันทึกวันที่")
    if payload.get("contract_issued"):
        if not target.get("deposit_paid"):
            raise HTTPException(status_code=400, detail="⚠️ ไม่สามารถออกสัญญาได้: ยังไม่ได้ชำระเงินมัดจำ")
        if not target.get("rental_paid"):
            raise HTTPException(status_code=400, detail="⚠️ ไม่สามารถออกสัญญาได้: ยังไม่ได้ชำระค่าเช่า (ชำระด้วยเงินสด / QR / บัตรเครดิต / PayPal ก่อนออกสัญญา)")
        target["contract_issued"] = True
    if new_status == "กำลังเช่า" and prev_status != "กำลังเช่า":
        require_contract_before_rent(target)
    if new_status == "เสร็จสิ้น" and prev_status not in ("กำลังเช่า", "เตรียมรับคืน", "เสร็จสิ้น"):
        raise HTTPException(status_code=400, detail="⚠️ ไม่สามารถรับคืนรถได้: รถยังไม่ได้ส่งมอบ (สถานะต้องเป็น \"กำลังเช่า\" ก่อน)")

    for k, v in payload.items():
        if k in ["start_date", "end_date"]:
            target[k] = to_date(v)
        else:
            target[k] = v

    # When status is updated to "กำลังเช่า", update car status and dispatch_closed
    if target.get("status") == "กำลังเช่า":
        target["dispatch_closed"] = True
        car_id = target.get("car_id")
        if car_id in store.cars:
            store.cars[car_id]["status"] = "กำลังเช่า"
            store.async_sync_car(car_id, store.cars[car_id])
    elif target.get("status") == "เสร็จสิ้น":
        target["dispatch_closed"] = True
        target["return_closed"] = True
        release_car_after_booking(target.get("car_id"), bk_id)
        record_booking_completion_income(target)

    store.async_sync_booking(target)

    # Log to universal work_order_logs only if transitioning to "กำลังเช่า"
    if new_status == "กำลังเช่า" and prev_status != "กำลังเช่า":
        try:
            cid = target.get("car_id", "")
            d_mileage = payload.get("dispatch_mileage") or target.get("dispatch_mileage", "-")
            d_fuel = payload.get("dispatch_fuel") or target.get("dispatch_fuel", "-")
            d_notes = payload.get("dispatch_notes") or target.get("dispatch_notes", "")
            store.log_work_order(
                car_id=cid,
                booking_id=bk_id,
                work_type="Dispatch",
                description=f"ส่งมอบรถยนต์เรียบร้อย เลขไมล์: {d_mileage}, น้ำมัน: {d_fuel}, หมายเหตุ: {d_notes}",
                cost=0.0,
                staff_id=target.get("worker_delivery", "admin")
            )
        except Exception as e:
            print(f"Error logging dispatch work order: {e}")

    return {"success": True, "booking": target}

@app.patch("/api/bookings/{bk_id}/contract-pdf")
@app.put("/api/bookings/{bk_id}/contract-pdf")
def update_booking_contract_pdf(bk_id: str, payload: Dict[str, Any]):
    """Decoupled update for contract_pdf_url without altering core booking logic."""
    target = next((b for b in store.bookings if b.get("booking_id") == bk_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="ไม่พบรายการจอง")
    pdf_url = payload.get("contract_pdf_url") or payload.get("pdf_url") or f"/api/pdf/contract/{bk_id}"
    target["contract_pdf_url"] = str(pdf_url)
    store.async_sync_booking(target)
    return {"success": True, "booking_id": bk_id, "contract_pdf_url": target["contract_pdf_url"]}

@app.post("/api/bookings/{bk_id}/generate-inspection-pdf")
def generate_booking_inspection_pdf(bk_id: str, payload: Optional[Dict[str, Any]] = None):
    """
    Generate official vehicle inspection checklist PDF from booking data.
    Accepts inspection data (Checkout/Checkin), marked car diagram (Base64), signatures, notes.
    Stores generated PDF file to static storage and saves the URL in checkout_pdf_url / checkin_pdf_url.
    """
    payload = payload or {}
    target = next((b for b in store.bookings if b.get("booking_id") == bk_id), None)
    if not target:
        target = next((cj for cj in store.completed_jobs if cj.get("booking_id") == bk_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="ไม่พบข้อมูลการจอง")

    cust, car = _resolve_cust_and_car(target)
    insp_type = str(payload.get("inspection_type") or ("checkout" if not target.get("return_closed") else "checkin")).lower().strip()
    is_checkout = insp_type in ("checkout", "dispatch", "out")
    clean_type = "checkout" if is_checkout else "checkin"

    merged_payload = dict(payload)
    # 1. Odometer
    odo_val = (
        merged_payload.get("odometer") or
        merged_payload.get("odometer_out" if is_checkout else "odometer_in") or
        merged_payload.get("mileage") or
        target.get("odometer_out" if is_checkout else "odometer_in") or
        target.get("dispatch_mileage" if is_checkout else "return_mileage") or
        car.get("mileage")
    )
    if odo_val is not None:
        merged_payload["odometer"] = str(odo_val).strip()
        merged_payload["odometer_out" if is_checkout else "odometer_in"] = str(odo_val).strip()
        target["odometer_out" if is_checkout else "odometer_in"] = str(odo_val).strip()
        target["dispatch_mileage" if is_checkout else "return_mileage"] = str(odo_val).strip()
        # Auto-update car mileage on check-in with validation
        if not is_checkout and str(odo_val).strip() not in ("", "-"):
            disp_km = target.get("odometer_out") or target.get("dispatch_mileage")
            c_target_id = target.get("car_id") or (car.get("plate") if car else None)
            _update_car_mileage_on_return(c_target_id, odo_val, disp_km)

    # 2. Fuel Level
    fuel_val = (
        merged_payload.get("fuel_level") or
        merged_payload.get("fuel_out" if is_checkout else "fuel_in") or
        target.get("fuel_out" if is_checkout else "fuel_in") or
        target.get("dispatch_fuel" if is_checkout else "return_fuel") or
        "เต็มถัง (Full - 8/8) [100%]"
    )
    if fuel_val is not None:
        merged_payload["fuel_level"] = str(fuel_val).strip()
        merged_payload["fuel_out" if is_checkout else "fuel_in"] = str(fuel_val).strip()
        target["fuel_out" if is_checkout else "fuel_in"] = str(fuel_val).strip()
        target["dispatch_fuel" if is_checkout else "return_fuel"] = str(fuel_val).strip()

    # 3. Notes / Remarks / Damage
    notes_val = (
        merged_payload.get("remarks") or
        merged_payload.get("notes") or
        merged_payload.get("inspection_notes") or
        merged_payload.get("damage_notes") or
        merged_payload.get("damage_desc") or
        merged_payload.get("inspection_notes_out" if is_checkout else "inspection_notes_in") or
        target.get("inspection_notes_out" if is_checkout else "inspection_notes_in") or
        target.get("dispatch_notes" if is_checkout else "return_notes") or
        target.get("remarks")
    )
    if notes_val is not None:
        notes_str = str(notes_val).strip()
        merged_payload["notes"] = notes_str
        merged_payload["remarks"] = notes_str
        merged_payload["inspection_notes"] = notes_str
        merged_payload["inspection_notes_out" if is_checkout else "inspection_notes_in"] = notes_str
        target["inspection_notes_out" if is_checkout else "inspection_notes_in"] = notes_str
        target["dispatch_notes" if is_checkout else "return_notes"] = notes_str
        target["remarks"] = notes_str

    # 4. Checkbox categories
    cats_val = (
        merged_payload.get("inspection_categories") or
        merged_payload.get("inspection_categories_out" if is_checkout else "inspection_categories_in") or
        target.get("inspection_categories_out" if is_checkout else "inspection_categories_in") or
        target.get("inspection_categories")
    )
    if cats_val is not None:
        merged_payload["inspection_categories"] = cats_val
        merged_payload["inspection_categories_out" if is_checkout else "inspection_categories_in"] = cats_val
        target["inspection_categories_out" if is_checkout else "inspection_categories_in"] = cats_val
        target["inspection_categories"] = cats_val

    for img_col in ("checkin_img_front", "checkin_img_left", "checkin_img_rear", "checkin_img_right"):
        if img_col in merged_payload and merged_payload.get(img_col) is not None:
            target[img_col] = str(merged_payload.get(img_col)).strip() or None

    # 5. Diagram & Damage Marks
    diag_val = (
        merged_payload.get("car_diagram") or
        merged_payload.get("car_diagram_out" if is_checkout else "car_diagram_in") or
        merged_payload.get("diagram_base64")
    )
    if diag_val:
        merged_payload["car_diagram_out" if is_checkout else "car_diagram_in"] = diag_val
        target["car_diagram_out" if is_checkout else "car_diagram_in"] = diag_val
        if is_checkout:
            target["car_diagram"] = diag_val

    marks_val = (
        merged_payload.get("damage_marks") or
        merged_payload.get("damage_marks_out" if is_checkout else "damage_marks_in")
    )
    if marks_val:
        merged_payload["damage_marks_out" if is_checkout else "damage_marks_in"] = marks_val
        target["damage_marks_out" if is_checkout else "damage_marks_in"] = marks_val
        if is_checkout:
            target["damage_marks"] = marks_val

    if not merged_payload.get("staff_name") and not merged_payload.get("inspector_name"):
        merged_payload["staff_name"] = target.get("worker_delivery" if is_checkout else "worker_return") or "Staff"

    try:
        pdf_bytes = pdf_engine.generate_inspection_checklist_pdf(
            template_path="car_inspection_updated.pdf",
            booking_info=target,
            customer_info=cust,
            car_info=car,
            inspection_type=clean_type,
            payload=merged_payload
        )
    except Exception as e:
        print(f"[PDF Engine] Error generating inspection checklist PDF: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"PDF Generation Error: {str(e)}")

    insp_dir = os.path.join(static_dir, "pdf", "inspections")
    os.makedirs(insp_dir, exist_ok=True)
    fname = f"Inspection_{clean_type.capitalize()}_{bk_id}.pdf"
    file_path = os.path.join(insp_dir, fname)
    try:
        with open(file_path, "wb") as f:
            f.write(pdf_bytes)
    except Exception as io_err:
        print(f"[PDF Engine] Storage write note: {io_err}")

    local_pdf_url = f"/static/pdf/inspections/{fname}"
    pdf_url = local_pdf_url
    insp_col = "checkout_pdf_url" if is_checkout else "checkin_pdf_url"
    insp_label = f"ใบตรวจสภาพรถ_{clean_type.capitalize()}"

    # Google Drive Priority Upload & DB Update
    try:
        from services.google_drive_service import upload_pdf_to_drive, build_pdf_filename, FOLDER_INSPECTIONS
        gdrive_fname = build_pdf_filename(insp_label, bk_id)
        res = upload_pdf_to_drive(pdf_bytes, FOLDER_INSPECTIONS, gdrive_fname, doc_type=insp_label)
        if res.get("success") and res.get("webViewLink"):
            pdf_url = res.get("webViewLink")
            print(f"[Inspection PDF Gen] Direct Google Drive upload success: {pdf_url}")
    except Exception as gdrive_err:
        print(f"[Inspection PDF Gen] Direct Google Drive upload note: {gdrive_err}")

    target[insp_col] = pdf_url
    store.async_sync_booking(target)
    try:
        from db import get_db_client
        sb = get_db_client()
        if sb:
            sb.table("bookings").update({insp_col: pdf_url}).eq("booking_id", bk_id).execute()
    except Exception as dberr:
        print(f"[Inspection PDF Gen] Direct DB update notice: {dberr}")

    # Fallback background retry if direct upload failed
    if pdf_url == local_pdf_url:
        try:
            from services.google_drive_service import FOLDER_INSPECTIONS
            async_upload_pdf_to_drive(
                doc_type=insp_label,
                ref_id=bk_id,
                pdf_bytes=pdf_bytes,
                folder_id=FOLDER_INSPECTIONS,
                booking_dict=target,
                db_col=insp_col
            )
        except Exception as bg_err:
            print(f"[Inspection PDF Gen] Background retry notice: {bg_err}")

    return {
        "success": True,
        "booking_id": bk_id,
        "inspection_type": clean_type,
        "pdf_url": pdf_url,
        "checkout_pdf_url": target.get("checkout_pdf_url"),
        "checkin_pdf_url": target.get("checkin_pdf_url")
    }

@app.post("/api/bookings/{bk_id}/extend")
def extend_booking(bk_id: str, payload: Dict[str, Any]):
    """Flow 6.2: customer extends the contract -> overlap check -> new contract (PDF) -> payment."""
    target = next((b for b in store.bookings if b.get("booking_id") == bk_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="ไม่พบรายการจอง")
    if target.get("status") not in ("กำลังเช่า", "เตรียมรับคืน"):
        raise HTTPException(status_code=400, detail="⚠️ ต่อสัญญาได้เฉพาะรายการที่อยู่ในสถานะ \"กำลังเช่า\" เท่านั้น")

    old_end = to_date(target.get("end_date"))
    old_end_t = target.get("end_time") or "10:00"
    new_end = to_date(payload.get("new_end_date"))
    new_end_t = payload.get("new_end_time") or old_end_t
    if not new_end or not old_end:
        raise HTTPException(status_code=400, detail="กรุณาระบุวันที่ต่อสัญญาใหม่")
    if new_end <= old_end:
        raise HTTPException(
            status_code=400,
            detail=f"วันที่ต่อสัญญาใหม่ ({new_end.strftime('%d/%m/%Y')}) ต้องมากกว่าวันสิ้นสุดสัญญาเดิม ({old_end.strftime('%d/%m/%Y')})"
        )

    # Block immediately if another queue is booked inside the extension window
    _conflict = find_booking_overlap(target.get("car_id"), old_end, new_end, exclude_booking_id=bk_id)
    if _conflict:
        raise_overlap_error(_conflict, "ต่อสัญญา")

    extra_days, _eh, _rm, _ov, _expl = calculate_rental_duration_and_days(old_end, old_end_t, new_end, new_end_t)
    car_obj = store.cars.get(target.get("car_id"), {})
    price_day = float(car_obj.get("price_day") or car_obj.get("daily_rate") or 1000)
    extra_price = payload.get("extra_price")
    extra_price = float(extra_price) if extra_price not in (None, "") else price_day * extra_days

    also_pay_rental = bool(payload.get("also_pay_rental", False))
    pay_method = str(payload.get("payment_method") or target.get("rental_payment_method") or "โอนเงิน / สแกน QR")
    pay_ref = str(payload.get("payment_ref") or "").strip()

    ext_list = list(target.get("extension_history") or [])
    ext_no = len([x for x in ext_list if isinstance(x, dict) and x.get("type") == "extension"]) + 1
    ext_list.append({
        "type": "extension",
        "no": ext_no,
        "old_end_date": str(old_end),
        "old_end_time": old_end_t,
        "new_end_date": str(new_end),
        "new_end_time": new_end_t,
        "extra_days": extra_days,
        "extra_price": extra_price,
        "paid_at_extend": also_pay_rental,
        "created_at": now_th().isoformat()
    })

    prev_outstanding = 0.0 if target.get("rental_paid") else float(target.get("remaining_rental") or 0.0)
    total_due = prev_outstanding + extra_price
    th_today = now_th().date().isoformat()
    target["extension_history"] = ext_list
    target["end_date"] = new_end
    target["end_time"] = new_end_t
    target["base_price"] = float(target.get("base_price") or 0.0) + extra_price
    target["net_price"] = float(target.get("net_price") or 0.0) + extra_price
    if also_pay_rental:
        target["remaining_rental"] = 0.0
        target["rental_paid"] = True
        target["is_fully_paid"] = True
        target["rental_payment_date"] = th_today
        target["rental_payment_method"] = pay_method
        if pay_ref:
            target["rental_ref"] = pay_ref
        if "ชำระวันคืนรถ" in pay_method:
            target["payment_status_note"] = "รอชำระวันคืนรถ" 
        car_comp = car_obj.get("company", "Sawasdee Rent A Car")
        rent_detail = f"ชำระค่าเช่าต่อสัญญา #{ext_no} รถ {target.get('car_id')} ({pay_method})"
        if pay_ref:
            rent_detail += f" [Ref/สลิป: {pay_ref}]"
        store.async_sync_financial({
            "company": car_comp,
            "type": "รายรับ",
            "category": "ค่าเช่ารถ",
            "amount": total_due,
            "ref": bk_id,
            "date": th_today,
            "detail": rent_detail
        })
    else:
        target["remaining_rental"] = total_due
        target["rental_paid"] = False
        target["is_fully_paid"] = False
    target["contract_issued"] = True
    store.async_sync_booking(target)

    return {
        "success": True,
        "booking": target,
        "extension_no": ext_no,
        "extra_days": extra_days,
        "extra_price": extra_price,
        "paid_now": also_pay_rental,
        "pdf_url": f"/api/pdf/contract/{bk_id}?download=1"
    }

@app.get("/api/bookings/{bk_id}/extend-check")
def extend_check(bk_id: str, new_end_date: str):
    """Pre-check for the Extend Contract dialog (overlap + price preview)."""
    target = next((b for b in store.bookings if b.get("booking_id") == bk_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="ไม่พบรายการจอง")
    old_end = to_date(target.get("end_date"))
    new_end = to_date(new_end_date)
    if not new_end or not old_end or new_end <= old_end:
        return {"ok": False, "message": "วันที่ต่อสัญญาใหม่ต้องมากกว่าวันสิ้นสุดสัญญาเดิม"}
    conflict = find_booking_overlap(target.get("car_id"), old_end, new_end, exclude_booking_id=bk_id)
    if conflict:
        return {
            "ok": False,
            "message": f"ติดจองคิวอื่น: {conflict.get('customer')} ({format_date_dmy(conflict.get('start_date'))} - {format_date_dmy(conflict.get('end_date'))})"
        }
    days, _a, _b, _c, _d = calculate_rental_duration_and_days(old_end, target.get("end_time") or "10:00", new_end, target.get("end_time") or "10:00")
    car_obj = store.cars.get(target.get("car_id"), {})
    price_day = float(car_obj.get("price_day") or car_obj.get("daily_rate") or 1000)
    return {"ok": True, "extra_days": days, "extra_price": price_day * days}

@app.delete("/api/bookings/{bk_id}")
def delete_booking(bk_id: str):
    target = next((b for b in store.bookings if b.get("booking_id") == bk_id), None)
    if target and target.get("car_id") in store.cars:
        release_car_after_booking(target["car_id"], bk_id)
        
    store.async_delete_booking(bk_id)
    return {"success": True}

# -------------------------------------------------------------------------
# DEPOSIT & PAYMENT WORKFLOW
# -------------------------------------------------------------------------
@app.post("/api/bookings/{bk_id}/deposit")
def record_deposit(bk_id: str, payload: Dict[str, Any]):
    target = next((b for b in store.bookings if b.get("booking_id") == bk_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="ไม่พบรายการจอง")

    dep_amount = float(payload.get("amount") or payload.get("deposit_amount") or 5000.0) # STRICT RULE: Fixed 5,000 THB deposit
    dep_method = str(payload.get("payment_method", "โอนเงิน / สแกน QR"))
    dep_ref = str(payload.get("ref_id") or payload.get("payment_ref") or payload.get("deposit_ref") or "").strip()
    dep_slip = convert_gdrive_url(str(payload.get("slip_image_url") or payload.get("slip_url") or payload.get("deposit_slip") or "").strip())
    pay_type = str(payload.get("payment_type") or "").strip() or ("มัดจำและค่าเช่า" if bool(payload.get("also_pay_rental", False)) else "มัดจำประกันสัญญา")
    gdrive_link = str(payload.get("google_drive_link") or "").strip()
    also_pay_rental = bool(payload.get("also_pay_rental", False))
    net_p = float(target.get("net_price", 0.0))

    th_today = now_th().date().isoformat()
    target["deposit_paid"] = True
    target["deposit_amount"] = dep_amount
    target["deposit_date"] = th_today
    target["deposit_method"] = dep_method
    target["deposit_ref"] = dep_ref
    target["deposit_slip"] = dep_slip
    target["payment_slip_url"] = dep_slip
    target["payment_type"] = pay_type
    target["google_drive_link"] = gdrive_link
    if "ชำระวันคืนรถ" in dep_method:
        target["payment_status_note"] = "รอชำระวันคืนรถ" 

    if also_pay_rental:
        target["rental_paid"] = True
        target["remaining_rental"] = 0.0
        target["is_fully_paid"] = True
        target["rental_payment_date"] = th_today
        target["rental_payment_method"] = dep_method
        target["rental_ref"] = dep_ref
        target["rental_slip"] = dep_slip
        target["remaining_slip_link"] = dep_slip
    else:
        # TARGET MISSION 3: ยอดเงินคงเหลือ = ราคาค่าเช่าที่ตกลง (net_price) - เงินมัดจำที่ชำระแล้ว (deposit_amount)
        target["remaining_rental"] = max(0.0, net_p - dep_amount)

    if target.get("status") == "รอชำระมัดจำ":
        target["status"] = "รอส่งมอบ"

    car_id = target.get("car_id")
    c_key = get_car_key(car_id)
    if c_key and c_key in store.cars:
        norm_ck = re.sub(r"[\s\-_]", "", str(c_key)).strip().lower()
        has_active_on_rent = any(
            re.sub(r"[\s\-_]", "", str(b.get("car_id", ""))).strip().lower() == norm_ck
            and b.get("booking_id") != bk_id
            and b.get("status") in ("กำลังเช่า", "รอรับคืน")
            for b in store.bookings
        )
        if not has_active_on_rent and store.cars[c_key].get("status") != "ซ่อมบำรุง":
            store.cars[c_key]["status"] = "ติดจอง"
            store.async_sync_car(c_key, store.cars[c_key])

    store.async_sync_booking(target)

    # Record financial: Deposit (Strict mapping to financial_records per Mission 2)
    car_comp = store.cars.get(car_id, {}).get("company", "Sawasdee Rent A Car")
    dep_detail = f"รับเงินมัดจำประกันสัญญาตอนจองรถ ({dep_method})"
    if dep_ref:
        dep_detail += f" [Ref/สลิป: {dep_ref}]"
    
    now_ts = now_th().strftime("%Y-%m-%d %H:%M:%S")
    f_dep = {
        "date": now_ts,
        "type": "Income",
        "category": "Deposit",
        "amount": dep_amount,
        "ref_id": bk_id,
        "description": dep_detail,
        # Backward-compatible & schema aliases
        "ref": bk_id,
        "detail": dep_detail,
        "company": car_comp,
        "payment_method": dep_method,
        "slip_image_url": dep_slip,
        "slip_url": dep_slip
    }
    try:
        store.sync_financial(f_dep)
    except Exception as fin_err:
        print(f"Error recording financial deposit: {fin_err}")

    if also_pay_rental:
        rent_detail = f"ชำระค่าเช่ารถพร้อมมัดจำ {car_id} ({dep_method})"
        if dep_ref:
            rent_detail += f" [Ref/สลิป: {dep_ref}]"
        f_rent = {
            "date": now_ts,
            "type": "Income",
            "category": "Rental",
            "amount": net_p,
            "ref_id": bk_id,
            "description": rent_detail,
            "ref": bk_id,
            "detail": rent_detail,
            "company": car_comp,
            "payment_method": dep_method,
            "slip_image_url": dep_slip,
            "slip_url": dep_slip
        }
        try:
            store.sync_financial(f_rent)
        except Exception as fin_rent_err:
            print(f"Error recording financial rental: {fin_rent_err}")

    # Deposit confirmation no longer sends LINE. Receipt PDF and DB save stay unchanged.
    # try:
    #     notify_line_deposit(target, dep_amount, dep_method, dep_ref, dep_slip, also_pay_rental)
    # except Exception as line_err:
    #     print(f"Error sending LINE deposit notification: {line_err}")

    return {"success": True, "booking": target}

@app.post("/api/bookings/{bk_id}/settle")
def settle_rental(bk_id: str, payload: Dict[str, Any]):
    target = next((b for b in store.bookings if b.get("booking_id") == bk_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="ไม่พบรายการจอง")

    settle_method = str(payload.get("payment_method", "โอนเงิน / สแกน QR"))
    settle_ref = str(payload.get("payment_ref") or payload.get("rental_ref") or "").strip()
    settle_slip = convert_gdrive_url(str(payload.get("slip_url") or payload.get("rental_slip") or payload.get("remaining_slip_link") or payload.get("slip_image_url") or "").strip())
    # Amount due = outstanding balance (covers extension top-ups); falls back to net_price - deposit
    rem_due = float(target.get("remaining_rental") if target.get("remaining_rental") is not None else 0.0)
    if rem_due <= 0.0 and not target.get("rental_paid"):
        net_val = float(target.get("net_price") or 0.0)
        dep_val = float(target.get("deposit_amount") or 5000.0) if target.get("deposit_paid") else 0.0
        rem_due = max(0.0, net_val - dep_val)
    net_p = rem_due

    th_today = now_th().date().isoformat()
    target["rental_paid"] = True
    target["remaining_rental"] = 0.0
    target["is_fully_paid"] = True
    target["rental_payment_date"] = th_today
    target["rental_payment_method"] = settle_method
    if settle_ref:
        target["rental_ref"] = settle_ref
    if settle_slip:
        target["rental_slip"] = settle_slip
        target["remaining_slip_link"] = settle_slip
    if "ชำระวันคืนรถ" in settle_method:
        target["payment_status_note"] = "รอชำระวันคืนรถ" 

    store.async_sync_booking(target)

    car_id = target.get("car_id")
    car_comp = store.cars.get(car_id, {}).get("company", "Sawasdee Rent A Car")
    now_ts = now_th().strftime("%Y-%m-%d %H:%M:%S")
    rent_detail = f"ชำระค่าเช่ารถคงเหลือ {car_id} ({settle_method})"
    if settle_ref:
        rent_detail += f" [Ref/สลิป: {settle_ref}]"
    f_rent = {
        "date": now_ts,
        "type": "Income",
        "category": "Rental",
        "amount": net_p,
        "ref_id": bk_id,
        "description": rent_detail,
        "ref": bk_id,
        "detail": rent_detail,
        "company": car_comp,
        "payment_method": settle_method,
        "slip_image_url": settle_slip,
        "slip_url": settle_slip
    }
    try:
        store.sync_financial(f_rent)
    except Exception as fin_settle_err:
        print(f"Error recording financial settle: {fin_settle_err}")

    # LINE notification disabled for deposit/rental payments (kept only for work orders)
    # try:
    #     notify_line_deposit(target, net_p, settle_method, settle_ref, settle_slip, also_rent=True, is_settle_only=True)
    # except Exception as line_err:
    #     print(f"Error sending LINE settle notification: {line_err}")

    return {"success": True, "booking": target}

@app.post("/api/bookings/{bk_id}/payment-slip")
def update_payment_slip(bk_id: str, payload: Dict[str, Any]):
    target = next((b for b in store.bookings if b.get("booking_id") == bk_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="ไม่พบรายการจอง")

    if "payment_ref" in payload or "deposit_ref" in payload:
        ref_val = str(payload.get("payment_ref") or payload.get("deposit_ref") or "").strip()
        target["deposit_ref"] = ref_val
    if "slip_url" in payload or "deposit_slip" in payload or "payment_slip_url" in payload:
        slip_val = str(payload.get("slip_url") or payload.get("deposit_slip") or payload.get("payment_slip_url") or "").strip()
        target["deposit_slip"] = convert_gdrive_url(slip_val)
        target["payment_slip_url"] = convert_gdrive_url(slip_val)
    if "rental_ref" in payload:
        target["rental_ref"] = str(payload.get("rental_ref") or "").strip()
    if "rental_slip" in payload or "remaining_slip_link" in payload:
        rent_slip_val = str(payload.get("rental_slip") or payload.get("remaining_slip_link") or "").strip()
        target["rental_slip"] = convert_gdrive_url(rent_slip_val)
        target["remaining_slip_link"] = convert_gdrive_url(rent_slip_val)
    if "payment_type" in payload:
        target["payment_type"] = str(payload.get("payment_type") or "").strip()
    if "google_drive_link" in payload:
        target["google_drive_link"] = str(payload.get("google_drive_link") or "").strip()

    try:
        cust, car = _resolve_cust_and_car(target)
        pdf_bytes = pdf_engine.generate_inspection_checklist_pdf(
            template_path="car_inspection_updated.pdf",
            booking_info=target,
            customer_info=cust,
            car_info=car,
            inspection_type="checkout",
            payload={
                "odometer": mileage,
                "fuel_level": fuel,
                "notes": notes,
                "staff_name": target.get("worker_delivery", "Staff")
            }
        )
        insp_dir = os.path.join(static_dir, "pdf", "inspections")
        os.makedirs(insp_dir, exist_ok=True)
        fname = f"Inspection_Checkout_{bk_id}.pdf"
        with open(os.path.join(insp_dir, fname), "wb") as f:
            f.write(pdf_bytes)
        target["checkout_pdf_url"] = f"/static/pdf/inspections/{fname}"
        try:
            from services.google_drive_service import FOLDER_INSPECTIONS
            async_upload_pdf_to_drive(
                doc_type="ใบตรวจสภาพรถ_Checkout",
                ref_id=bk_id,
                pdf_bytes=pdf_bytes,
                folder_id=FOLDER_INSPECTIONS,
                booking_dict=target,
                db_col="checkout_pdf_url"
            )
        except Exception as bg_gdrive_err:
            print(f"[Mileage Fuel] GDrive upload notice: {bg_gdrive_err}")
    except Exception as gen_err:
        print(f"[PDF Engine] Auto-generate checkout inspection error: {gen_err}")

    store.async_sync_booking(target)
    return {"success": True, "booking": target, "checkout_pdf_url": target.get("checkout_pdf_url")}

# -------------------------------------------------------------------------
# DISPATCH & RETURN WORK ORDERS
# -------------------------------------------------------------------------
@app.post("/api/bookings/{bk_id}/assign")
def assign_worker(bk_id: str, payload: Dict[str, Any]):
    target = next((b for b in store.bookings if b.get("booking_id") == bk_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="ไม่พบรายการจอง")

    job_type = payload.get("job_type", "Dispatch")
    worker = payload.get("worker", "")
    location = payload.get("location", "")
    time_val = payload.get("time", "10:00")
    s_date_val = payload.get("start_date")
    e_date_val = payload.get("end_date")

    action_type = payload.get("action_type", "assign")
    odometer = payload.get("odometer")
    fuel_level = payload.get("fuel_level")
    inspection_notes = payload.get("inspection_notes")
    inspection_photos = payload.get("inspection_photos")

    # ---- Validate before mutating (state machine + overlap protection) ----
    new_sd = to_date(s_date_val) if s_date_val else to_date(target.get("start_date"))
    new_ed = to_date(e_date_val) if e_date_val else to_date(target.get("end_date"))
    if new_sd and new_ed and new_ed < new_sd:
        raise HTTPException(status_code=400, detail="วันที่คืนรถต้องไม่น้อยกว่าวันที่เริ่มเช่า")
    dates_changed = (new_sd != to_date(target.get("start_date"))) or (new_ed != to_date(target.get("end_date")))
    if dates_changed and target.get("status") not in INACTIVE_BOOKING_STATUSES:
        _conflict = find_booking_overlap(target.get("car_id"), new_sd, new_ed, exclude_booking_id=bk_id)
        if _conflict:
            raise_overlap_error(_conflict, "บันทึกวันที่")
    if job_type == "Dispatch" and action_type == "handover_now":
        require_contract_before_rent(target)
    if job_type != "Dispatch" and action_type == "complete_now" and target.get("status") not in ("กำลังเช่า", "เตรียมรับคืน"):
        raise HTTPException(status_code=400, detail="⚠️ ไม่สามารถรับคืนรถได้: รถยังไม่ได้ส่งมอบ (สถานะต้องเป็น \"กำลังเช่า\" ก่อน)")

    if s_date_val:
        target["start_date"] = to_date(s_date_val)
    if e_date_val:
        target["end_date"] = to_date(e_date_val)

    if job_type == "Dispatch":
        target["worker_delivery"] = worker
        target["loc_delivery"] = location
        target["start_time"] = time_val
        if odometer is not None and str(odometer).strip() != "":
            target["odometer_out"] = str(odometer).strip()
            target["dispatch_mileage"] = str(odometer).strip()
        if fuel_level is not None and str(fuel_level).strip() != "":
            target["fuel_out"] = str(fuel_level).strip()
            target["dispatch_fuel"] = str(fuel_level).strip()
        if inspection_notes is not None:
            target["inspection_notes_out"] = str(inspection_notes).strip()
            target["dispatch_notes"] = str(inspection_notes).strip()
            target["remarks"] = str(inspection_notes).strip()
        insp_cats = payload.get("inspection_categories") or payload.get("inspection_categories_out")
        if insp_cats is not None:
            target["inspection_categories_out"] = insp_cats
            target["inspection_categories"] = insp_cats
        if inspection_photos is not None and str(inspection_photos).strip() != "":
            target["inspection_photos_out"] = str(inspection_photos).strip()
            target["dispatch_photos"] = str(inspection_photos).strip()
        if action_type == "handover_now":
            target["status"] = "กำลังเช่า"
            target["dispatch_closed"] = True
            car_id = target.get("car_id")
            if car_id in store.cars:
                store.cars[car_id]["status"] = "กำลังเช่า"
                store.async_sync_car(car_id, store.cars[car_id])
        elif target.get("status") in ["รอส่งมอบ", "รอชำระมัดจำ"]:
            target["status"] = "เตรียมส่งมอบ"
    else:
        target["worker_return"] = worker
        target["loc_return"] = location
        target["end_time"] = time_val
        if odometer is not None and str(odometer).strip() != "":
            disp_km = target.get("odometer_out") or target.get("dispatch_mileage")
            _update_car_mileage_on_return(target.get("car_id"), odometer, disp_km)
            target["odometer_in"] = str(odometer).strip()
            target["return_mileage"] = str(odometer).strip()
        if fuel_level is not None and str(fuel_level).strip() != "":
            target["fuel_in"] = str(fuel_level).strip()
            target["return_fuel"] = str(fuel_level).strip()
        if inspection_notes is not None:
            target["inspection_notes_in"] = str(inspection_notes).strip()
            target["return_notes"] = str(inspection_notes).strip()
            target["remarks"] = str(inspection_notes).strip()
        insp_cats = payload.get("inspection_categories") or payload.get("inspection_categories_in")
        if insp_cats is not None:
            target["inspection_categories_in"] = insp_cats
            target["inspection_categories"] = insp_cats
        if inspection_photos is not None and str(inspection_photos).strip() != "":
            target["inspection_photos_in"] = str(inspection_photos).strip()
            target["return_photos"] = str(inspection_photos).strip()
        for img_col in ("checkin_img_front", "checkin_img_left", "checkin_img_rear", "checkin_img_right"):
            if img_col in payload and payload.get(img_col) is not None:
                target[img_col] = str(payload.get(img_col)).strip() or None
        if action_type == "complete_now":
            target["status"] = "เสร็จสิ้น"
            target["return_closed"] = True
            release_car_after_booking(target.get("car_id"), bk_id)
        elif target.get("status") == "กำลังเช่า":
            target["status"] = "เตรียมรับคืน"

    # Auto-generate or update official inspection checklist PDF
    try:
        cust, car = _resolve_cust_and_car(target)
        is_checkout = (job_type == "Dispatch")
        clean_type = "checkout" if is_checkout else "checkin"
        current_insp_payload = {
            "odometer": target.get("odometer_out" if is_checkout else "odometer_in"),
            "odometer_out": target.get("odometer_out"),
            "odometer_in": target.get("odometer_in"),
            "fuel_level": target.get("fuel_out" if is_checkout else "fuel_in"),
            "fuel_out": target.get("fuel_out"),
            "fuel_in": target.get("fuel_in"),
            "notes": target.get("inspection_notes_out" if is_checkout else "inspection_notes_in"),
            "remarks": target.get("remarks") or target.get("inspection_notes_out" if is_checkout else "inspection_notes_in"),
            "inspection_notes": target.get("inspection_notes_out" if is_checkout else "inspection_notes_in"),
            "inspection_categories": target.get("inspection_categories_out" if is_checkout else "inspection_categories_in"),
            "staff_name": worker or target.get("worker_delivery" if is_checkout else "worker_return") or "Staff"
        }
        pdf_bytes = pdf_engine.generate_inspection_checklist_pdf(
            template_path="car_inspection_updated.pdf",
            booking_info=target,
            customer_info=cust,
            car_info=car,
            inspection_type=clean_type,
            payload=current_insp_payload
        )
        insp_dir = os.path.join(static_dir, "pdf", "inspections")
        os.makedirs(insp_dir, exist_ok=True)
        fname = f"Inspection_{clean_type.capitalize()}_{bk_id}.pdf"
        with open(os.path.join(insp_dir, fname), "wb") as f:
            f.write(pdf_bytes)
        insp_col = "checkout_pdf_url" if is_checkout else "checkin_pdf_url"
        target[insp_col] = f"/static/pdf/inspections/{fname}"
        try:
            from services.google_drive_service import FOLDER_INSPECTIONS
            insp_label = f"ใบตรวจสภาพรถ_{clean_type.capitalize()}"
            async_upload_pdf_to_drive(
                doc_type=insp_label,
                ref_id=bk_id,
                pdf_bytes=pdf_bytes,
                folder_id=FOLDER_INSPECTIONS,
                booking_dict=target,
                db_col=insp_col
            )
        except Exception as bg_gdrive_err:
            print(f"[Assign Worker] GDrive upload notice: {bg_gdrive_err}")
    except Exception as auto_pdf_err:
        print(f"[PDF Engine] Auto inspection update in assign: {auto_pdf_err}")

    store.async_sync_booking(target)

    # Decoupled Work Order Log for Dispatch / Return Assignment
    try:
        appt_date = s_date_val if job_type == "Dispatch" else e_date_val
        appt_dt = f"{appt_date} {time_val}:00" if appt_date and time_val else (str(appt_date) if appt_date else None)
        j_status = "Completed" if action_type == "complete_now" else ("In Progress" if action_type == "handover_now" else "Pending")
        store.log_work_order(
            car_id=target.get("car_id"),
            booking_id=bk_id,
            work_type=job_type,
            description=f"ใบงาน{'ส่งมอบรถ (Dispatch)' if job_type == 'Dispatch' else 'รับรถคืน (Return)'} พนักงาน: {worker} สถานที่: {location or '-'}",
            cost=0.0,
            staff_id=worker,
            appointment_datetime=appt_dt,
            location=location,
            job_status=j_status
        )
    except Exception as wo_err:
        print(f"Work order log note: {wo_err}")

    # Work order LINE notification retired per system rule

    return {"success": True, "booking": target}

# -------------------------------------------------------------------------
# BACK OFFICE WORK ORDERS & INSPECTIONS
# -------------------------------------------------------------------------
@app.get("/api/backoffice/jobs")
def list_backoffice_jobs():
    jobs = []
    archived_ids = {cj.get("booking_id") for cj in store.completed_jobs}
    for b in store.bookings:
        if b.get("status") in ["ยกเลิก", "เสร็จสิ้น"] or b.get("booking_id") in archived_ids:
            continue

        is_disp_closed = bool(b.get("dispatch_closed", False)) or (b.get("status") in ["กำลังเช่า", "เตรียมรับคืน"])
        is_ret_closed = bool(b.get("return_closed", False))

        cust_obj = store.customers.get(b.get("customer"), {})
        cust_phone = cust_obj.get("contact_no", "-")

        # 1. Dispatch Job
        if not is_disp_closed:
            s_d = b.get('start_date')
            s_d_str = s_d.strftime("%Y-%m-%d") if isinstance(s_d, (date, datetime)) else str(s_d or "")
            jobs.append({
                "job_type": "Dispatch",
                "job_type_label": "จัดส่งรถ (Dispatch)",
                "booking_id": b.get("booking_id"),
                "car_id": b.get("car_id"),
                "customer": b.get("customer"),
                "customer_phone": cust_phone,
                "schedule": f"{format_date_dmy(b.get('start_date'))} ({b.get('start_time', '10:00')})",
                "date_iso": s_d_str,
                "start_date": s_d_str,
                "start_time": b.get("start_time", "10:00"),
                "worker": b.get("worker_delivery") or "Wait",
                "location": b.get("loc_delivery") or "-",
                "status": b.get("status", "รอส่งมอบ"),
                "is_locked": False,
                "deposit_paid": b.get("deposit_paid", False),
                "rental_paid": b.get("rental_paid", False),
                "net_price": b.get("net_price", 0)
            })

        # 2. Return Job
        if not is_ret_closed:
            e_d = b.get('end_date')
            e_d_str = e_d.strftime("%Y-%m-%d") if isinstance(e_d, (date, datetime)) else str(e_d or "")
            is_ret_locked = not is_disp_closed
            ret_status = "🔒 รอส่งรถก่อน" if is_ret_locked else (b.get("status") if b.get("status") != "รอชำระมัดจำ" else "รอรับคืน")
            jobs.append({
                "job_type": "Return",
                "job_type_label": "รับรถคืน (Return)",
                "booking_id": b.get("booking_id"),
                "car_id": b.get("car_id"),
                "customer": b.get("customer"),
                "customer_phone": cust_phone,
                "schedule": f"คืน: {format_date_dmy(b.get('end_date'))} ({b.get('end_time', '10:00')})",
                "date_iso": e_d_str,
                "end_date": e_d_str,
                "end_time": b.get("end_time", "10:00"),
                "worker": b.get("worker_return") or "Wait",
                "location": b.get("loc_return") or b.get("loc_delivery") or "-",
                "status": ret_status,
                "is_locked": is_ret_locked,
                "deposit_paid": b.get("deposit_paid", False),
                "rental_paid": b.get("rental_paid", False),
                "net_price": b.get("net_price", 0)
            })

    # 3. Maintenance & Renewal Work Orders
    for m in store.maintenance_records:
        m_stat = m.get("status", "รอดำเนินการ")
        if m_stat in ["ยกเลิก", "เสร็จสิ้น"]:
            continue
        m_type = m.get("order_type", "ซ่อมบำรุงทั่วไป / เช็คระยะ")
        is_renewal = any(k in m_type for k in ["ต่อทะเบียน", "พ.ร.บ.", "พรบ", "ประกัน"])
        j_type = "Renewal" if is_renewal else "Maintenance"
        j_label = "📄 ต่อทะเบียน/พรบ./ประกัน" if is_renewal else "🛠️ ซ่อมบำรุง (Maintenance)"
        
        m_sd_str = str(m.get("schedule_date") or "")
        jobs.append({
            "job_type": j_type,
            "job_type_label": j_label,
            "booking_id": m.get("id"),
            "car_id": m.get("car_id"),
            "customer": f"🏢 {m.get('service_center', '-')}",
            "customer_phone": m.get("service_center_phone") or "-",
            "schedule": f"นัด: {format_date_dmy(m.get('schedule_date'))} ({m.get('schedule_time', '09:00')}) ➔ รับ: {format_date_dmy(m.get('expected_finish_date'))}",
            "date_iso": m_sd_str,
            "start_date": m_sd_str,
            "start_time": str(m.get("schedule_time") or "09:00"),
            "end_date": str(m.get("expected_finish_date") or ""),
            "worker": m.get("assigned_worker") or "Wait",
            "location": m.get("service_location") or m.get("service_center") or "-",
            "status": m_stat,
            "is_locked": False,
            "deposit_paid": True,
            "rental_paid": True,
            "net_price": float(m.get("cost", 0)),
            "service_items": m.get("service_items", "-"),
            "is_maintenance": True,
            "maintenance_id": m.get("id"),
            "order_type": m_type
        })

    jobs.sort(key=lambda x: (x["booking_id"], x["job_type"] == "Dispatch"), reverse=True)
    return jobs

@app.post("/api/bookings/{bk_id}/close-dispatch")
def close_dispatch(bk_id: str, payload: Dict[str, Any]):
    target = next((b for b in store.bookings if b.get("booking_id") == bk_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="ไม่พบรายการจอง")

    require_contract_before_rent(target)

    fuel = payload.get("fuel_level", "⛽ เต็มถัง (Full - 8/8) [100%]")
    mileage = payload.get("mileage", "")
    notes = payload.get("notes", "ตรวจสภาพรถยนต์ก่อนส่งมอบเรียบร้อยดี")
    photos = payload.get("photos", [])

    target["dispatch_closed"] = True
    target["dispatch_fuel"] = fuel
    target["dispatch_mileage"] = mileage
    target["dispatch_notes"] = notes
    target["dispatch_photos"] = photos
    target["status"] = "กำลังเช่า"

    car_diag = payload.get("car_diagram") or payload.get("car_diagram_out") or payload.get("diagram_base64")
    if car_diag:
        target["car_diagram_out"] = car_diag
        target["car_diagram"] = car_diag
    dmg_marks = payload.get("damage_marks") or payload.get("damage_marks_out")
    if dmg_marks:
        target["damage_marks_out"] = dmg_marks
        target["damage_marks"] = dmg_marks

    car_id = target.get("car_id")
    if car_id in store.cars:
        store.cars[car_id]["status"] = "กำลังเช่า"
        if mileage:
            store.cars[car_id]["mileage"] = mileage
        store.async_sync_car(car_id, store.cars[car_id])

    store.async_sync_booking(target)
    return {"success": True, "booking": target}

@app.post("/api/bookings/{bk_id}/close-return")
def close_return(bk_id: str, payload: Dict[str, Any]):
    action = payload.get("action", "end_contract")
    fuel = payload.get("fuel_level", "⛽ เต็มถัง (Full - 8/8) [100%]")
    mileage = payload.get("mileage", "")
    target_bk = next((b for b in store.bookings if b.get("booking_id") == bk_id), {})
    disp_km = target_bk.get("odometer_out") or target_bk.get("dispatch_mileage")
    if mileage:
        _update_car_mileage_on_return(target_bk.get("car_id"), mileage, disp_km)
    notes = payload.get("notes", "ตรวจสภาพรถยนต์ตอนรับคืนเรียบร้อยดี")
    photos = payload.get("photos", [])
    late_fee = float(payload.get("late_fee", 0.0))
    condition = payload.get("condition", "normal")
    damage_desc = payload.get("damage_desc", "")
    repair_cost = float(payload.get("repair_cost", 0.0))
    service_center = payload.get("service_center", "")
    img_f = payload.get("checkin_img_front")
    img_l = payload.get("checkin_img_left")
    img_re = payload.get("checkin_img_rear")
    img_ri = payload.get("checkin_img_right")
    for k_img, v_img in [("checkin_img_front", img_f), ("checkin_img_left", img_l), ("checkin_img_rear", img_re), ("checkin_img_right", img_ri)]:
        if v_img is not None:
            target_bk[k_img] = str(v_img).strip() or None

    car_diag = payload.get("car_diagram") or payload.get("car_diagram_in") or payload.get("diagram_base64")
    if car_diag:
        target_bk["car_diagram_in"] = car_diag
    dmg_marks = payload.get("damage_marks") or payload.get("damage_marks_in")
    if dmg_marks:
        target_bk["damage_marks_in"] = dmg_marks

    if action == "swap_vehicle":
        new_car_id = str(payload.get("new_car_id", "")).strip()
        if not new_car_id:
            raise HTTPException(status_code=400, detail="กรุณาเลือกรถคันใหม่สำหรับเปลี่ยนทดแทน")
        success = store.swap_booking_vehicle(
            booking_id=bk_id,
            new_car_id=new_car_id,
            fuel_level=fuel,
            inspection_notes=notes,
            inspection_photos=photos,
            mileage=mileage,
            damage_desc=damage_desc,
            repair_cost=repair_cost,
            service_center=service_center
        )
        if not success:
            raise HTTPException(status_code=404, detail="ไม่สามารถเปลี่ยนรถทดแทนได้ หรือไม่พบรหัสการจอง")

        # Log to universal work_order_logs for Swap
        try:
            target = next((b for b in store.bookings if b.get("booking_id") == bk_id), {})
            store.log_work_order(
                car_id=target.get("car_id") or new_car_id,
                booking_id=bk_id,
                work_type="Swap",
                description=f"สลับเปลี่ยนรถทดแทนเป็น {new_car_id} เนื่องจากรถเสียหาย: {damage_desc}. เลขไมล์: {mileage or '-'}, น้ำมัน: {fuel}",
                cost=repair_cost,
                staff_id="admin"
            )
        except Exception as e:
            print(f"Error logging swap work order: {e}")

        return {"success": True, "action": "swap_vehicle", "new_car_id": new_car_id}

    success = store.archive_completed_booking(
        booking_id=bk_id,
        fuel_level=fuel,
        inspection_notes=notes,
        inspection_photos=photos,
        mileage=mileage,
        late_fee=late_fee,
        condition=condition,
        damage_desc=damage_desc,
        repair_cost=repair_cost,
        service_center=service_center,
        checkin_img_front=img_f,
        checkin_img_left=img_l,
        checkin_img_rear=img_re,
        checkin_img_right=img_ri
    )
    if not success:
        raise HTTPException(status_code=404, detail="ไม่สามารถปิดงานรับคืนได้ หรือไม่พบรหัสการจอง")

    # Log to universal work_order_logs for Return
    try:
        target = next((b for b in store.bookings if b.get("booking_id") == bk_id), {})
        record_booking_completion_income(target)
        desc_text = f"ตรวจรับรถคืน ({condition})"
        if damage_desc:
            desc_text += f" ความเสียหาย: {damage_desc}"
        desc_text += f", เลขไมล์: {mileage or '-'}, น้ำมัน: {fuel}, หมายเหตุ: {notes}"
        store.log_work_order(
            car_id=target.get("car_id", ""),
            booking_id=bk_id,
            work_type="Return",
            description=desc_text,
            cost=repair_cost,
            staff_id="admin"
        )
    except Exception as e:
        print(f"Error logging return work order: {e}")

    return {"success": True, "action": "end_contract"}

# -------------------------------------------------------------------------
# VEHICLE MAINTENANCE & ROI (MISSION 2)
# -------------------------------------------------------------------------
import urllib.parse

@app.get("/api/cars/{plate:path}/maintenances")
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

@app.post("/api/cars/{plate:path}/maintenances")
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

@app.delete("/api/cars/{plate:path}/maintenances/{m_id}")
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

# -------------------------------------------------------------------------
# PDF DOCUMENT STREAMING ENDPOINTS
# -------------------------------------------------------------------------

@app.get("/api/pdf/contract/{bk_id}")
def get_contract_pdf(bk_id: str, download: int = 0):
    target = next((b for b in store.bookings if b.get("booking_id") == bk_id), None)
    if not target:
        target = next((cj for cj in store.completed_jobs if cj.get("booking_id") == bk_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="ไม่พบข้อมูลการจอง")

    cust, car = _resolve_cust_and_car(target)
    try:
        pdf_bytes = pdf_engine.generate_filled_pdf("rental_template_blank_v2.pdf", target, cust, car)
    except Exception as e:
        print(f"PDF Error: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"PDF Error: {str(e)}")

    if not target.get("contract_pdf_url"):
        target["contract_pdf_url"] = f"/api/pdf/contract/{bk_id}"
    if not target.get("contract_issued") and target.get("deposit_paid") and target.get("rental_paid"):
        target["contract_issued"] = True
    store.async_sync_booking(target)

    # Isolated Feature: Auto-upload Contract PDF to Google Drive in background thread
    try:
        from services.google_drive_service import FOLDER_CONTRACTS
        async_upload_pdf_to_drive(
            doc_type="สัญญาเช่า",
            ref_id=bk_id,
            pdf_bytes=pdf_bytes,
            folder_id=FOLDER_CONTRACTS,
            booking_dict=target,
            db_col="contract_pdf_url"
        )
    except Exception as gdrive_err:
        print(f"[Contract PDF] Auto-upload notice: {gdrive_err}")

    ext_count = len([x for x in (target.get("extension_history") or []) if isinstance(x, dict) and x.get("type") == "extension"])
    fname = f"Agreement_{bk_id}" + (f"_ext{ext_count}" if ext_count else "") + ".pdf"
    disp = "attachment" if download else "inline"
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f"{disp}; filename={fname}"}
    )

@app.get("/api/pdf/receipt/{bk_id}")
def get_receipt_pdf(bk_id: str):
    target = next((b for b in store.bookings if b.get("booking_id") == bk_id), None)
    if not target:
        target = next((cj for cj in store.completed_jobs if cj.get("booking_id") == bk_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="ไม่พบข้อมูลการจอง")

    cust, car = _resolve_cust_and_car(target)
    amt = float(target.get("net_price", 0.0))
    method = target.get("rental_payment_method") or target.get("final_payment_method", "เงินสด")
    ref_no = target.get("rental_ref") or target.get("deposit_ref")

    pdf_bytes = pdf_engine.generate_receipt_bytes(f"REC{bk_id}", target, cust, car, amt, method, "ค่าเช่ารถยนต์ (Vehicle Rental Fee)", ref_no=ref_no)

    # Isolated Feature: Auto-upload Receipt PDF to Google Drive in background thread
    try:
        from services.google_drive_service import FOLDER_RECEIPTS
        async_upload_pdf_to_drive(
            doc_type="ใบเสร็จ",
            ref_id=bk_id,
            pdf_bytes=pdf_bytes,
            folder_id=FOLDER_RECEIPTS,
            booking_dict=target,
            db_col="receipt_pdf_url"
        )
    except Exception as gdrive_err:
        print(f"[Receipt PDF] Auto-upload notice: {gdrive_err}")

    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f"inline; filename=Receipt_{bk_id}.pdf"}
    )

@app.get("/api/pdf/deposit-receipt/{bk_id}")
def get_deposit_receipt_pdf(bk_id: str):
    target = next((b for b in store.bookings if b.get("booking_id") == bk_id), None)
    if not target:
        target = next((cj for cj in store.completed_jobs if cj.get("booking_id") == bk_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="ไม่พบข้อมูลการจอง")

    cust, car = _resolve_cust_and_car(target)
    amt = float(target.get("deposit_amount", 5000.0))
    method = target.get("deposit_method", "เงินสด")
    ref_no = target.get("deposit_ref")

    pdf_bytes = pdf_engine.generate_receipt_bytes(f"DEP{bk_id}", target, cust, car, amt, method, "เงินมัดจำประกันสัญญา (Security Deposit)", ref_no=ref_no)

    # Isolated Feature: Auto-upload Deposit Receipt PDF to Google Drive in background thread
    try:
        from services.google_drive_service import FOLDER_RECEIPTS
        async_upload_pdf_to_drive(
            doc_type="ใบเสร็จมัดจำ",
            ref_id=bk_id,
            pdf_bytes=pdf_bytes,
            folder_id=FOLDER_RECEIPTS,
            booking_dict=target,
            db_col="deposit_receipt_pdf_url"
        )
    except Exception as gdrive_err:
        print(f"[Deposit Receipt PDF] Auto-upload notice: {gdrive_err}")

    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f"inline; filename=Deposit_Receipt_{bk_id}.pdf"}
    )

@app.get("/api/pdf/inspection/{bk_id}")
def get_inspection_pdf(bk_id: str, type: str = "checkout", download: int = 0):
    target = next((b for b in store.bookings if b.get("booking_id") == bk_id), None)
    if not target:
        target = next((cj for cj in store.completed_jobs if cj.get("booking_id") == bk_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="ไม่พบข้อมูลการจอง")

    cust, car = _resolve_cust_and_car(target)
    is_checkout = str(type).lower().strip() in ("checkout", "dispatch", "out")
    clean_type = "checkout" if is_checkout else "checkin"

    insp_dir = os.path.join(static_dir, "pdf", "inspections")
    fname = f"Inspection_{clean_type.capitalize()}_{bk_id}.pdf"
    file_path = os.path.join(insp_dir, fname)

    pdf_bytes = pdf_engine.generate_inspection_checklist_pdf(
        template_path="car_inspection_updated.pdf",
        booking_info=target,
        customer_info=cust,
        car_info=car,
        inspection_type=clean_type,
        payload=target
    )
    try:
        os.makedirs(insp_dir, exist_ok=True)
        with open(file_path, "wb") as f:
            f.write(pdf_bytes)
    except Exception:
        pass

    pdf_url = f"/static/pdf/inspections/{fname}"
    if is_checkout and not target.get("checkout_pdf_url"):
        target["checkout_pdf_url"] = pdf_url
        store.async_sync_booking(target)
    elif not is_checkout and not target.get("checkin_pdf_url"):
        target["checkin_pdf_url"] = pdf_url
        store.async_sync_booking(target)

    # Isolated Feature: Auto-upload Inspection PDF to Google Drive in background thread
    try:
        from services.google_drive_service import FOLDER_INSPECTIONS
        insp_col = "checkout_pdf_url" if is_checkout else "checkin_pdf_url"
        insp_label = f"ใบตรวจสภาพรถ_{clean_type.capitalize()}"
        async_upload_pdf_to_drive(
            doc_type=insp_label,
            ref_id=bk_id,
            pdf_bytes=pdf_bytes,
            folder_id=FOLDER_INSPECTIONS,
            booking_dict=target,
            db_col=insp_col
        )
    except Exception as gdrive_err:
        print(f"[Inspection PDF] Auto-upload notice: {gdrive_err}")

    disp = "attachment" if download else "inline"
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f"{disp}; filename={fname}"}
    )

@app.get("/api/pdf/job/{bk_id}")
def get_job_pdf(bk_id: str, type: Optional[str] = None):
    target = next((b for b in store.bookings if b.get("booking_id") == bk_id), None)
    if not target:
        target = next((cj for cj in store.completed_jobs if cj.get("booking_id") == bk_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="ไม่พบข้อมูลการจอง")

    cust, car = _resolve_cust_and_car(target)
    job_type = str(type).lower() if type else ("Return" if target.get("return_closed") else "Dispatch")
    worker = target.get("worker_return") if job_type == "Return" else target.get("worker_delivery")
    loc = target.get("loc_return") if job_type == "Return" else target.get("loc_delivery")
    try:
        pdf_bytes = pdf_engine.generate_job_pdf(target, cust, car, job_type, worker, loc, inspection_data=target)
    except Exception as pdf_err:
        print(f"[API] Warning: generate_job_pdf failed: {pdf_err}, using emergency fallback generator")
        pdf_bytes = pdf_engine._generate_fallback_inspection_pdf(target, cust, car, is_checkout=(job_type != "return"), payload=target)
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f"inline; filename=Inspection_Checklist_{bk_id}.pdf"}
    )

@app.get("/api/html/inspection/{bk_id}", response_class=HTMLResponse)
def get_inspection_html(bk_id: str, type: Optional[str] = None):
    target = next((b for b in store.bookings if b.get("booking_id") == bk_id), None)
    if not target:
        target = next((cj for cj in store.completed_jobs if cj.get("booking_id") == bk_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="ไม่พบข้อมูลการจอง")

    cust, car = _resolve_cust_and_car(target)
    job_type = str(type).lower() if type else ("Return" if target.get("return_closed") else "Dispatch")
    worker = target.get("worker_return") if job_type == "Return" else target.get("worker_delivery")
    loc = target.get("loc_return") if job_type == "Return" else target.get("loc_delivery")
    html_content = pdf_engine.render_inspection_html(target, cust, car, job_type, worker, loc, inspection_data=target)
    return HTMLResponse(content=html_content)

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8501))
    uvicorn.run("server:app", host="0.0.0.0", port=port, reload=False)


@app.post("/api/inspections/checkin")
@app.post("/api/inspections/{bk_id}/checkin")
def complete_inspection_checkin_direct(bk_id: Optional[str] = None, payload: Optional[Dict[str, Any]] = None):
    """Dedicated endpoint for direct check-in inspection mileage update & PDF completion."""
    payload = payload or {}
    b_id = bk_id or payload.get("booking_id")
    if not b_id:
        raise HTTPException(status_code=400, detail="booking_id is required")
    return generate_booking_inspection_pdf(b_id, {**payload, "inspection_type": "checkin"})
