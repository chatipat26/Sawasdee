"""
System, SPA Index, DB Migration, and Photo Upload API Router for SawasdeeRental.
"""

import hashlib
import json
import os
import time
import asyncio
from datetime import datetime
from typing import Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Response, UploadFile, File
from fastapi.responses import HTMLResponse

from db import store, get_db_client
from dependencies import BASE_DIR, TH_TZ, require_auth, require_admin, validate_upload_bytes
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


def _md5_sig(raw: str) -> str:
    return hashlib.md5(raw.encode("utf-8")).hexdigest()[:12]


@router.get("/api/status")
def get_system_status():
    with store.lock:
        bookings_snap = [dict(b) for b in store.bookings]
        cars_snap = [(p, dict(c)) for p, c in store.cars.items()]
        mnt_snap = [dict(m) for m in store.maintenance_records]
        cj_snap = [dict(cj) for cj in store.completed_jobs]
        cust_snap = [(k, dict(v)) for k, v in store.customers.items()]
        fin_snap = [dict(f) for f in store.financial_records]
        users_snap = [(k, dict(u)) for k, u in store.users.items()]
        last_sync = store.last_sync_time

    cars_raw = "|".join(sorted(
        f"{p}:{c.get('status','')}:{c.get('mileage','')}:{c.get('next_service_mileage','')}"
        f":{c.get('tax_expire_date') or c.get('tax_expiry','')}"
        f":{c.get('prb_expire_date') or c.get('act_expiry','')}"
        f":{c.get('insurance_expire_date') or c.get('ins_expiry','')}"
        f":{c.get('installment_amount',0)}:{c.get('is_debt_free',False)}"
        for p, c in cars_snap
    ))
    bk_raw = "|".join(sorted(
        f"{b.get('booking_id','')}:{b.get('status','')}:{b.get('car_id','')}"
        f":{b.get('net_price',0)}:{b.get('deposit_paid','')}:{b.get('rental_paid','')}"
        f":{b.get('contract_issued','')}:{b.get('dispatch_closed','')}:{b.get('return_closed','')}"
        for b in bookings_snap
    )) + f"|cj:{len(cj_snap)}"
    cust_raw = "|".join(sorted(
        f"{k}:{v.get('contact_no') or v.get('phone_number','')}:{v.get('crm_tier','')}:{v.get('watchlist_note','')}"
        for k, v in cust_snap
    ))
    mnt_raw = "|".join(sorted(
        f"{m.get('id','')}:{m.get('car_id','')}:{m.get('status','')}:{m.get('cost',0)}:{m.get('actual_cost',0)}"
        for m in mnt_snap
    ))
    users_raw = "|".join(sorted(
        f"{k}:{u.get('role','')}:{u.get('status','')}:{u.get('is_approved','')}:{u.get('line_user_id','')}"
        for k, u in users_snap
    ))

    cars_sig = _md5_sig(cars_raw)
    bookings_sig = _md5_sig(bk_raw)
    customers_sig = _md5_sig(cust_raw)
    maintenance_sig = _md5_sig(mnt_raw)
    users_sig = _md5_sig(users_raw)

    total_fin_amt = sum(float(f.get("amount") or 0.0) for f in fin_snap)
    finance_raw = f"fin:{len(fin_snap)}:{total_fin_amt:.2f}|cj:{len(cj_snap)}|bk:{bookings_sig}|mnt:{maintenance_sig}"
    finance_sig = _md5_sig(finance_raw)

    signatures = {
        "cars": cars_sig,
        "bookings": bookings_sig,
        "customers": customers_sig,
        "maintenance": maintenance_sig,
        "users": users_sig,
        "finance": finance_sig,
    }
    data_sig = f"{cars_sig}|{bookings_sig}|{customers_sig}|{maintenance_sig}|{users_sig}|{finance_sig}"

    return {
        "status": "online",
        "last_sync_time": last_sync,
        "last_sync_formatted": datetime.fromtimestamp(last_sync, tz=TH_TZ).strftime("%H:%M:%S") if last_sync else "เมื่อสักครู่",
        "total_cars": len(cars_snap),
        "total_customers": len(cust_snap),
        "total_bookings": len(bookings_snap),
        "total_completed": len(cj_snap),
        "total_users": len(users_snap),
        "total_maintenance": len(mnt_snap),
        "signatures": signatures,
        "data_signature": data_sig,
        "timestamp": time.time()
    }


@router.post("/api/sync")
def trigger_manual_sync():
    store.sync_from_database(force=True)
    return {"success": True, "message": "ซิงค์ข้อมูลกับฐานข้อมูล PostgreSQL สำเร็จเรียบร้อย"}


@router.get("/api/admin/backup-snapshot")
def download_admin_backup_snapshot(_admin: Dict[str, Any] = Depends(require_admin)):
    """Export full system operational snapshot (excluding user passwords) as downloadable JSON for Admin DR."""
    with store.lock:
        cars_list = [dict(c) for c in store.cars.values()]
        customers_list = [dict(c) for c in store.customers.values()]
        bookings_list = [dict(b) for b in store.bookings]
        completed_list = [dict(cj) for cj in store.completed_jobs]
        maint_list = [dict(m) for m in store.maintenance_records]
        fin_list = [dict(f) for f in store.financial_records]
        raw_users = [dict(u) for u in store.users.values()]

    sanitized_users = []
    for u in raw_users:
        clean_u = {k: v for k, v in u.items() if k not in ("password", "password_hash", "hashed_password")}
        sanitized_users.append(clean_u)

    now_dt = datetime.now(TH_TZ)
    snapshot_payload = {
        "backup_version": "1.0",
        "generated_at": now_dt.isoformat(),
        "generated_by": _admin.get("username", "admin"),
        "counts": {
            "cars": len(cars_list),
            "customers": len(customers_list),
            "bookings": len(bookings_list),
            "completed_jobs": len(completed_list),
            "maintenance_records": len(maint_list),
            "financial_records": len(fin_list),
            "users": len(sanitized_users),
        },
        "data": {
            "cars": cars_list,
            "customers": customers_list,
            "bookings": bookings_list,
            "completed_jobs": completed_list,
            "maintenance_records": maint_list,
            "financial_records": fin_list,
            "users": sanitized_users,
        },
    }
    json_bytes = json.dumps(snapshot_payload, ensure_ascii=False, indent=2, default=str).encode("utf-8")
    fname = f"sawasdee_backup_{now_dt.strftime('%Y%m%d_%H%M%S')}.json"
    return Response(
        content=json_bytes,
        media_type="application/json; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={fname}"},
    )


@router.post("/api/admin/migrate-cars")
def trigger_cars_migration(_admin: Dict[str, Any] = Depends(require_admin)):
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
    sub_type: Optional[str] = None,
    _user: Dict[str, Any] = Depends(require_auth),
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
    validate_upload_bytes(file.filename, file.content_type, contents, allow_pdf=True)
    ext = (file.filename or "").split(".")[-1] if "." in (file.filename or "") else "jpg"

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
