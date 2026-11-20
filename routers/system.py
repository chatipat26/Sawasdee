"""
System, SPA Index, DB Migration, and Photo Upload API Router for SawasdeeRental.
"""

import os
import time
import asyncio
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import HTMLResponse

from db import store, get_db_client
from dependencies import BASE_DIR, TH_TZ
from gdrive_service import (
    gdrive_service,
    FOLDER_INSURANCE_ACT,
    FOLDER_CAR_ANGLES,
    FOLDER_PAYMENT_SLIPS,
)

router = APIRouter(tags=["system"])


@router.api_route("/", methods=["GET", "HEAD"], response_class=HTMLResponse)
def serve_index():
    index_file = os.path.join(BASE_DIR, "templates", "index.html")
    no_cache_headers = {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0"
    }
    if os.path.exists(index_file):
        with open(index_file, "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read(), headers=no_cache_headers)
    return HTMLResponse("<h1>Sawasdee Rental</h1><p>Building client application...</p>", headers=no_cache_headers)


@router.get("/api/status")
def get_system_status():
    with store.lock:
        bookings_snap = [dict(b) for b in store.bookings]
        cars_snap = [(p, dict(c)) for p, c in store.cars.items()]
        mnt_snap = [dict(m) for m in store.maintenance_records]
        cj_len = len(store.completed_jobs)
        cust_len = len(store.customers)
        fin_len = len(store.financial_records)
        users_len = len(store.users)
        last_sync = store.last_sync_time
    bk_sig = ",".join(sorted(f"{b.get('booking_id','')}:{b.get('status','')}:{b.get('deposit_paid','')}:{b.get('rental_paid','')}" for b in bookings_snap))
    cj_sig = str(cj_len)
    car_sig = ",".join(sorted(f"{p}:{c.get('status','')}:{c.get('act_expiry','')}:{c.get('ins_expiry','')}" for p, c in cars_snap))
    mnt_sig = ",".join(sorted(f"{m.get('id','')}:{m.get('status','')}:{m.get('cost','')}" for m in mnt_snap))
    data_sig = f"{len(bookings_snap)}|{bk_sig}|{cj_sig}|{cust_len}|{fin_len}|{len(mnt_snap)}|{hash(mnt_sig)}|{hash(car_sig)}"
    return {
        "status": "online",
        "last_sync_time": last_sync,
        "last_sync_formatted": datetime.fromtimestamp(last_sync, tz=TH_TZ).strftime("%H:%M:%S") if last_sync else "เมื่อสักครู่",
        "total_cars": len(cars_snap),
        "total_customers": cust_len,
        "total_bookings": len(bookings_snap),
        "total_completed": cj_len,
        "total_users": users_len,
        "total_maintenance": len(mnt_snap),
        "data_signature": data_sig,
        "timestamp": time.time()
    }


@router.post("/api/sync")
def trigger_manual_sync():
    store.sync_from_database(force=True)
    return {"success": True, "message": "ซิงค์ข้อมูลกับฐานข้อมูล PostgreSQL สำเร็จเรียบร้อย"}


@router.post("/api/admin/migrate-cars")
def trigger_cars_migration():
    """Execute raw ALTER TABLE commands on PostgreSQL to guarantee all 34 columns."""
    sb = get_db_client()
    if sb and hasattr(sb, "connection"):
        try:
            with sb.connection() as conn:
                with conn.cursor() as cur:
                    car_sqls = [
                        "CREATE TABLE IF NOT EXISTS public.cars (plate VARCHAR(50) PRIMARY KEY);",
                        "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS brand VARCHAR(100);",
                        "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS model VARCHAR(100);",
                        "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS car_group VARCHAR(100);",
                        "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS fuel_system VARCHAR(50);",
                        "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS cc_ev VARCHAR(50);",
                        "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS owner_company VARCHAR(150);",
                        "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS color VARCHAR(50);",
                        "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS mileage VARCHAR(50);",
                        "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS daily_rate NUMERIC DEFAULT 0;",
                        "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS weekly_rate NUMERIC DEFAULT 0;",
                        "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS monthly_rate NUMERIC DEFAULT 0;",
                        "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS vin VARCHAR(100);",
                        "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS tax_expire_date VARCHAR(50);",
                        "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS prb_expire_date VARCHAR(50);",
                        "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS insurance_expire_date VARCHAR(50);",
                        "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS insurance_company VARCHAR(150);",
                        "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS car_owner VARCHAR(150);",
                        "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS beneficiary VARCHAR(150);",
                        "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS register_year VARCHAR(50);",
                        "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS prb_price NUMERIC DEFAULT 0;",
                        "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS insurance_premium NUMERIC DEFAULT 0;",
                        "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS last_service_date VARCHAR(50);",
                        "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS next_service_date VARCHAR(50);",
                        "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS next_service_mileage NUMERIC DEFAULT 0;",
                        "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS car_status VARCHAR(50);",
                        "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS is_debt_free BOOLEAN DEFAULT FALSE;",
                        "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS finance_company VARCHAR(150);",
                        "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS installment_amount NUMERIC DEFAULT 0;",
                        "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS total_installments INTEGER DEFAULT 0;",
                        "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS current_installment INTEGER DEFAULT 0;",
                        "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS payment_due_date VARCHAR(50);",
                        "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS notes TEXT;",
                        "ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS image_url TEXT;"
                    ]
                    for q in car_sqls:
                        cur.execute(q)
            return {"success": True, "message": "อัปเดต Schema ตาราง cars ครบทั้ง 34 คอลัมน์เรียบร้อย"}
        except Exception as e:
            return {"success": False, "error": str(e)}
    return {"success": True, "message": "เชื่อมต่อผ่าน REST Client เรียบร้อย"}


@router.post("/api/upload-photo")
async def upload_photo(
    file: UploadFile = File(...),
    category: Optional[str] = None,
    ref_id: Optional[str] = None,
    plate: Optional[str] = None,
    sub_type: Optional[str] = None
):
    """
    Unified upload endpoint:
    - Automatically organizes into Google Drive folders if credentials configured
    - Standardizes filenames:
        พ.ร.บ./กรมธรรม์: [กรมธรรม์/พรบ]_[ทะเบียนรถ]_[YYYYMMDD] (Folder: 1cxfQEi9oHUIBBF4oMMHJgIvGu8fxOOEq)
        รูปรถยนต์ 4 มุม: รถ_[มุม]_[ทะเบียนรถ]_[YYYYMMDD] (Folder: 1V5S_j4dXQGuUW6zCAwQaXSkYJ9XNo-Mj)
        สลิปการโอนเงิน: สลิป_[รหัสการจอง/อ้างอิง]_[YYYYMMDD] (Folder: 1BqKO4TXM4sJQ5_GzKdcVPTwE_qyiAsv8)
    - Fallback: Safe compressed Base64 photo storage if GDrive is not yet configured
    """
    contents = await file.read()
    ext = file.filename.split(".")[-1] if "." in file.filename else "jpg"

    def _process_upload():
        # 1. Google Drive Auto-Upload (TARGET MISSION 2)
        if gdrive_service.is_configured():
            target_ref = ref_id or plate or "ref"
            res = gdrive_service.upload_file(
                file_bytes=contents,
                category=category or "slip",
                ref_or_plate=target_ref,
                sub_type=sub_type,
                original_filename=file.filename,
                content_type=file.content_type or "image/jpeg"
            )
            if res.get("success"):
                return {
                    "success": True,
                    "url": res["webViewLink"],
                    "webViewLink": res["webViewLink"],
                    "direct_url": res["direct_url"],
                    "filename": res["filename"],
                    "folder_id": res["folder_id"],
                    "is_gdrive": True
                }
            else:
                print(f"[Upload] GDrive upload error, falling back to local base64: {res.get('error')}")

        # 2. Resilient Base64 fallback (safe for current demo)
        safe_fn = f"insp_{int(time.time()*1000)}.{ext}"
        url = store.upload_photo(safe_fn, contents, file.content_type or "image/jpeg")
        if not url:
            raise HTTPException(status_code=500, detail="อัปโหลดรูปภาพไม่สำเร็จ")
        return {"success": True, "url": url, "filename": safe_fn, "is_gdrive": False}

    return await asyncio.to_thread(_process_upload)


@router.get("/api/gdrive/status")
def get_gdrive_status():
    """Returns Google Drive service connection status and configured folder IDs."""
    return {
        "success": True,
        "configured": gdrive_service.is_configured(),
        "client_email": gdrive_service.get_service_account_email(),
        "folders": {
            "insurance_act": FOLDER_INSURANCE_ACT,
            "car_angles": FOLDER_CAR_ANGLES,
            "payment_slips": FOLDER_PAYMENT_SLIPS
        }
    }
