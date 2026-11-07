import os
import io
import time
from datetime import datetime, date, timedelta, timezone
from typing import Optional, List, Dict, Any, Union
from pydantic import BaseModel, Field
from fastapi import FastAPI, HTTPException, Request, Response, UploadFile, File, Form, Depends
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
import re

def convert_gdrive_url(url: str) -> str:
    """Convert Google Drive share link to direct image view URL to save server storage."""
    if not url or not isinstance(url, str):
        return url
    u = url.strip()
    m = re.search(r'drive\.google\.com/file/d/([a-zA-Z0-9_-]+)', u)
    if m:
        return f"https://lh3.googleusercontent.com/d/{m.group(1)}"
    m = re.search(r'drive\.google\.com/(?:open|uc)\?(?:[^&]*&)*id=([a-zA-Z0-9_-]+)', u)
    if m:
        return f"https://lh3.googleusercontent.com/d/{m.group(1)}"
    return u

from db import (
    store,
    get_supabase_client,
    get_car_fleet_status,
    calculate_rental_duration_and_days,
    format_date_dmy,
    to_date,
    start_background_cloud_sync,
    DEFAULT_HP_LEASING,
    DEFAULT_HP_SUMMARY,
    DEFAULT_PROPERTY_INSURANCE,
    deduplicate_cars_dict
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

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TH_TZ = timezone(timedelta(hours=7))

def now_th():
    return datetime.now(TH_TZ)

# -------------------------------------------------------------------------
# BUSINESS FLOW GUARDS (state machine / overlap protection)
# -------------------------------------------------------------------------
INACTIVE_BOOKING_STATUSES = ("เสร็จสิ้น", "ยกเลิก")

def find_booking_overlap(car_id, start_d, end_d, exclude_booking_id=None):
    """Return the first active booking of car_id whose date range overlaps [start_d, end_d], else None."""
    if not car_id or not start_d or not end_d:
        return None
    for b in store.bookings:
        if b.get("car_id") != car_id:
            continue
        if exclude_booking_id and b.get("booking_id") == exclude_booking_id:
            continue
        if b.get("status") in INACTIVE_BOOKING_STATUSES:
            continue
        b_s = to_date(b.get("start_date"))
        b_e = to_date(b.get("end_date"))
        if b_s and b_e and not (b_e < start_d or b_s > end_d):
            return b
    return None

def raise_overlap_error(conflict, action="จองรถ"):
    raise HTTPException(
        status_code=409,
        detail=(
            f"⚠️ ไม่สามารถ{action}ได้: วันที่ทับซ้อนกับคิวเดิมของรถคันนี้ "
            f"(รหัส {conflict.get('booking_id')} / ลูกค้า {conflict.get('customer')} / "
            f"{format_date_dmy(conflict.get('start_date'))} - {format_date_dmy(conflict.get('end_date'))})"
        )
    )

def release_car_after_booking(car_id, finished_booking_id=None):
    """Return car to Available, or back to Reserved if another active queue still exists."""
    if car_id not in store.cars:
        return
    has_queue = any(
        b.get("car_id") == car_id
        and b.get("booking_id") != finished_booking_id
        and b.get("status") not in INACTIVE_BOOKING_STATUSES
        for b in store.bookings
    )
    store.cars[car_id]["status"] = "ติดจอง" if has_queue else "ว่างพร้อมใช้งาน"
    store.async_sync_car(car_id, store.cars[car_id])

def require_contract_before_rent(booking):
    """On-Rent status may only be reached after the rental contract has been issued."""
    if not booking.get("contract_issued"):
        raise HTTPException(
            status_code=400,
            detail="⚠️ ไม่สามารถเปลี่ยนสถานะเป็น \"กำลังเช่า\" ได้: ต้องออกสัญญาเช่าให้เรียบร้อยก่อน (จอง ➔ มัดจำ ➔ ใบงาน ➔ ชำระค่าเช่า ➔ สัญญา)"
        )
    if not booking.get("deposit_paid"):
        raise HTTPException(status_code=400, detail="⚠️ ยังไม่ได้ชำระเงินมัดจำ ไม่สามารถส่งมอบรถได้")

app = FastAPI(title="SawasdeeRental Web App", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Static and Templates directories
static_dir = os.path.join(BASE_DIR, "static")
os.makedirs(static_dir, exist_ok=True)
os.makedirs(os.path.join(static_dir, "css"), exist_ok=True)
os.makedirs(os.path.join(static_dir, "js"), exist_ok=True)
app.mount("/static", StaticFiles(directory=static_dir), name="static")

from database import init_db

# Start background sync and scheduler on startup
@app.on_event("startup")
def startup_event():
    print("🚀 Starting SawasdeeRental Web App server...")
    # Attempt direct PostgreSQL schema check/migration
    try:
        init_db()
        sb = get_supabase_client()
        if sb and hasattr(sb, "_connection"):
            sb._connection()
    except Exception as e:
        print(f"Startup schema check note: {e}")
    # Perform initial synchronous sync so all database tables are immediately available
    store.sync_from_supabase(force=True)
    start_background_cloud_sync()
    init_expiry_scheduler_thread()

# -------------------------------------------------------------------------
# ROOT HTML (SPA)
# -------------------------------------------------------------------------
@app.api_route("/", methods=["GET", "HEAD"], response_class=HTMLResponse)
async def serve_index():
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

# -------------------------------------------------------------------------
# SYSTEM STATUS & SYNC
# -------------------------------------------------------------------------
@app.get("/api/status")
async def get_system_status():
    bk_sig = ",".join(sorted(f"{b.get('booking_id','')}:{b.get('status','')}:{b.get('deposit_paid','')}:{b.get('rental_paid','')}" for b in store.bookings))
    cj_sig = str(len(store.completed_jobs))
    car_sig = ",".join(sorted(f"{p}:{c.get('status','')}:{c.get('act_expiry','')}:{c.get('ins_expiry','')}" for p, c in store.cars.items()))
    mnt_sig = ",".join(sorted(f"{m.get('id','')}:{m.get('status','')}:{m.get('cost','')}" for m in store.maintenance_records))
    data_sig = f"{len(store.bookings)}|{bk_sig}|{cj_sig}|{len(store.customers)}|{len(store.financial_records)}|{len(store.maintenance_records)}|{hash(mnt_sig)}|{hash(car_sig)}"
    return {
        "status": "online",
        "last_sync_time": store.last_sync_time,
        "last_sync_formatted": datetime.fromtimestamp(store.last_sync_time, tz=TH_TZ).strftime("%H:%M:%S") if store.last_sync_time else "เมื่อสักครู่",
        "total_cars": len(store.cars),
        "total_customers": len(store.customers),
        "total_bookings": len(store.bookings),
        "total_completed": len(store.completed_jobs),
        "total_users": len(store.users),
        "total_maintenance": len(store.maintenance_records),
        "data_signature": data_sig,
        "timestamp": time.time()
    }

@app.post("/api/sync")
async def trigger_manual_sync():
    store.sync_from_supabase(force=True)
    return {"success": True, "message": "ซิงค์ข้อมูลกับฐานข้อมูล PostgreSQL สำเร็จเรียบร้อย"}

@app.post("/api/admin/migrate-cars")
async def trigger_cars_migration():
    """Execute raw ALTER TABLE commands on PostgreSQL to guarantee all 34 columns."""
    sb = get_supabase_client()
    if sb and hasattr(sb, "_connection"):
        try:
            conn = sb._connection()
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

# -------------------------------------------------------------------------
# AUTHENTICATION & USERS
# -------------------------------------------------------------------------
@app.post("/api/auth/login")
async def login(payload: Dict[str, Any]):
    un = str(payload.get("username", "")).strip()
    pw = str(payload.get("password", "")).strip()
    
    if not un or not pw:
        raise HTTPException(status_code=400, detail="กรุณากรอกชื่อผู้ใช้งานและรหัสผ่าน")

    user_rec = None

    # 1. In-memory / users table match with real password check (instant response)
    for k, v in store.users.items():
        if k.lower() == un.lower() or (v.get("email") and v.get("email").lower() == un.lower()):
            stored_pw = str(v.get("password", "")).strip()
            is_admin = (k.lower() in ["admin", "administrator"])
            pw_matched = (stored_pw and (stored_pw == pw or stored_pw.lower() == pw.lower()))
            if not pw_matched and is_admin:
                pw_matched = (pw in ["admin", "admin123", "sawasdee2024", "sawasdee", "A248624"])
            elif not pw_matched and k.lower() in ["chatipat", "chati"]:
                pw_matched = (pw in ["admin123", "admin", "sawasdee2024", "123456", "Chatipat@2024", "A248624"])
            elif not pw_matched and k.lower() in ["chaiwat.u", "chaiwat"]:
                pw_matched = (pw in ["A248624", "admin123", "123456"])
            
            if pw_matched:
                user_rec = dict(v)
                break

    # 2. Standard fallback accounts before hitting external network
    if not user_rec and un.lower() in ["admin", "administrator"] and pw in ["admin", "admin123", "sawasdee2024", "sawasdee", "A248624"]:
        user_rec = {"username": "admin", "name": "ผู้ดูแลระบบ (Admin)", "role": "Admin", "status": "approved"}
    elif not user_rec and un.lower() in ["chatipat", "chati"] and pw in ["admin123", "admin", "sawasdee2024", "123456", "Chatipat@2024", "A248624"]:
        user_rec = {"username": "Chatipat", "name": "Chatipat", "role": "Admin", "status": "approved"}
    elif not user_rec and un.lower() in ["chaiwat.u", "chaiwat"] and pw in ["A248624", "admin123", "123456"]:
        user_rec = {"username": "chaiwat.u", "name": "chaiwat.u", "role": "Staff", "status": "approved"}

    sb = get_supabase_client() if not user_rec else None

    # 3. Direct query to PostgreSQL users table with password check
    if not user_rec and sb:
        try:
            res = sb.table("users").select("*").ilike("username", un).execute()
            if res.data:
                for row in res.data:
                    stored_pw = str(row.get("password", "")).strip()
                    if stored_pw and (stored_pw == pw or stored_pw.lower() == pw.lower()):
                        user_rec = dict(row)
                        break
        except Exception:
            pass

    # 4. Standard admin credentials check if not in db table yet
    if not user_rec and un.lower() in ["admin", "administrator"]:
        if pw in ["admin", "admin123", "sawasdee2024", "sawasdee", "A248624"]:
            user_rec = {
                "username": "admin",
                "name": "ผู้ดูแลระบบ (Admin)",
                "role": "Admin",
                "status": "approved"
            }

    # 5. Standard Chatipat credentials check
    if not user_rec and un.lower() in ["chatipat", "chati"]:
        if pw in ["admin123", "admin", "sawasdee2024", "123456", "Chatipat@2024", "A248624"]:
            user_rec = {
                "username": "Chatipat",
                "name": "Chatipat",
                "role": "Admin",
                "status": "approved"
            }

    # 6. Standard chaiwat.u credentials check
    if not user_rec and un.lower() in ["chaiwat.u", "chaiwat"]:
        if pw in ["A248624", "admin123", "123456"]:
            user_rec = {
                "username": "chaiwat.u",
                "name": "chaiwat.u",
                "role": "Staff",
                "status": "approved"
            }

    if not user_rec:
        raise HTTPException(status_code=401, detail="ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง")

    is_pending = (user_rec.get("status") == "pending")
    if is_pending:
        return {
            "success": False,
            "is_pending": True,
            "detail": "บัญชีของคุณอยู่ระหว่างรอการอนุมัติจากผู้ดูแลระบบ (Admin)",
            "user": user_rec
        }

    canon_un = user_rec.get("username", un)
    if canon_un not in store.users:
        store.async_sync_user(canon_un, user_rec)

    return {
        "success": True,
        "is_pending": False,
        "user": {
            "username": canon_un,
            "name": user_rec.get("name") or canon_un,
            "role": user_rec.get("role", "Staff"),
            "status": user_rec.get("status", "approved"),
            "line_user_id": user_rec.get("line_user_id", "")
        }
    }

@app.post("/api/auth/register")
async def register(payload: Dict[str, Any]):
    un = str(payload.get("username", "")).strip().lower()
    fn = str(payload.get("name", "")).strip()
    pw = str(payload.get("password", "")).strip()
    line_id = str(payload.get("line_user_id") or payload.get("line_id") or "").strip()
    if not un or not pw:
        raise HTTPException(status_code=400, detail="กรุณากรอกชื่อผู้ใช้งานและรหัสผ่าน")
    if not line_id:
        raise HTTPException(status_code=400, detail="กรุณากรอกไอดีไลน์ (LINE ID / LINE User ID) เพื่อใช้รับแจ้งเตือนใบงาน")
    if un in store.users:
        raise HTTPException(status_code=400, detail="ชื่อผู้ใช้นี้มีในระบบแล้ว")

    new_u = {
        "username": un,
        "name": fn or un,
        "password": pw,
        "role": "Staff",
        "status": "pending",
        "line_user_id": line_id,
        "created_at": datetime.utcnow().isoformat()
    }
    store.async_sync_user(un, new_u)
    return {"success": True, "message": "ลงทะเบียนสำเร็จ กรุณารอผู้ดูแลระบบ (Admin) อนุมัติการใช้งาน"}

@app.post("/api/auth/change-password")
async def change_password(payload: Dict[str, Any]):
    un = str(payload.get("username", "")).strip()
    old_pw = str(payload.get("old_password", "")).strip()
    new_pw = str(payload.get("new_password", "")).strip()
    user = store.users.get(un)
    if not user or user.get("password") != old_pw:
        raise HTTPException(status_code=400, detail="รหัสผ่านเดิมไม่ถูกต้อง")
    user["password"] = new_pw
    store.async_sync_user(un, user)
    return {"success": True, "message": "เปลี่ยนรหัสผ่านเรียบร้อย"}

@app.get("/api/users")
async def list_users():
    if not store.initial_sync_done or len(store.users) <= 1:
        store.sync_from_supabase(force=True)
    users_list = []
    for u in store.users.values():
        u_safe = dict(u)
        u_safe.pop("password", None)
        if not u_safe.get("status"):
            u_safe["status"] = "approved"
        users_list.append(u_safe)
    return users_list

@app.post("/api/users/{username}/approve")
async def approve_user(username: str):
    if username not in store.users:
        raise HTTPException(status_code=404, detail="ไม่พบผู้ใช้นี้")
    store.users[username]["status"] = "approved"
    store.async_sync_user(username, store.users[username])
    return {"success": True}

@app.post("/api/users/{username}/reject")
async def reject_user(username: str):
    if username not in store.users:
        raise HTTPException(status_code=404, detail="ไม่พบผู้ใช้นี้")
    store.users[username]["status"] = "pending"
    store.async_sync_user(username, store.users[username])
    return {"success": True}

@app.delete("/api/users/{username}")
async def delete_user(username: str):
    if username.lower() == "admin":
        raise HTTPException(status_code=400, detail="ไม่สามารถลบบัญชีผู้ดูแลระบบหลัก (admin) ได้")
    store.async_delete_user(username)
    return {"success": True}

@app.put("/api/users/{username}/line-id")
@app.post("/api/users/{username}/line-id")
async def update_user_line_id(username: str, payload: Dict[str, Any]):
    if username not in store.users:
        raise HTTPException(status_code=404, detail="ไม่พบผู้ใช้นี้ในระบบ")
    line_uid = str(payload.get("line_user_id") or "").strip()
    store.users[username]["line_user_id"] = line_uid
    if "role" in payload and payload["role"] in ("Admin", "Staff"):
        store.users[username]["role"] = payload["role"]
    if "name" in payload and str(payload["name"]).strip():
        store.users[username]["name"] = str(payload["name"]).strip()
    store.async_sync_user(username, store.users[username])
    return {"success": True, "username": username, "line_user_id": line_uid}

@app.post("/api/users/{username}/test-line")
async def test_user_line_push(username: str):
    if username not in store.users:
        raise HTTPException(status_code=404, detail="ไม่พบผู้ใช้นี้ในระบบ")
    u = store.users[username]
    line_uid = resolve_worker_line_id(username)
    if not line_uid:
        raise HTTPException(status_code=400, detail=f"ผู้ใช้ '{username}' ยังไม่ได้ผูก LINE User ID")
    msg = "\n".join([
        "✅ ทดสอบระบบแจ้งเตือนตรง (Direct Push)",
        "────────────────────",
        f"👤 ผู้ใช้งาน: {username} ({u.get('name', username)})",
        f"🏷️ บทบาท: {u.get('role', 'Staff')}",
        "📲 สถานะ: เชื่อมต่อ LINE สำเร็จ พร้อมรับแจ้งเตือนใบงานเฉพาะของคุณโดยตรง"
    ])
    ok = send_line_push_message(msg, to_user_id=line_uid)
    return {"success": ok, "to_user_id": line_uid}

# -------------------------------------------------------------------------
# CARS FLEET
# -------------------------------------------------------------------------
@app.get("/api/cars")
@app.get("/api/vehicles")
async def list_cars(start_date: Optional[str] = None, end_date: Optional[str] = None):
    if not store.initial_sync_done:
        store.sync_from_supabase(force=True)
    cars_data = []
    for plate, car in store.cars.items():
        status_key, status_desc, color, bg, border = get_car_fleet_status(
            plate, car, store.bookings, start_date, end_date
        )
        c_copy = dict(car)
        c_copy["fleet_status_key"] = status_key
        # Distinguish a real "On Rent" car from one that is only reserved for the selected dates
        _fs, _fe = to_date(start_date), to_date(end_date)
        if _fs and not _fe: _fe = _fs
        if _fe and not _fs: _fs = _fe
        _on_rent = False
        if _fs and _fe:
            for _b in store.bookings:
                if _b.get("car_id") != plate or _b.get("status") not in ("กำลังเช่า", "เตรียมรับคืน"):
                    continue
                _bs, _be = to_date(_b.get("start_date")), to_date(_b.get("end_date"))
                if _bs and _be and not (_be < _fs or _bs > _fe):
                    _on_rent = True
                    break
        else:
            _on_rent = str(car.get("status") or "").strip() in ("กำลังเช่า", "เตรียมรับคืน") or any(
                _b.get("car_id") == plate and _b.get("status") in ("กำลังเช่า", "เตรียมรับคืน")
                for _b in store.bookings
            )
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
async def get_finance_companies():
    """Fetch existing finance companies from database and in-memory store."""
    companies = set()
    for c in store.cars.values():
        fc = str(c.get("finance_company", "") or "").strip()
        if fc and fc not in ("-", "None", "none", "null", ""):
            companies.add(fc)
    
    # Also fetch from PostgreSQL/Supabase table if available
    try:
        sb = get_supabase_client()
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
async def get_vehicle_form_options():
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

def normalize_plate(plate: str) -> str:
    if not plate:
        return ""
    import re
    return re.sub(r"[\s\-\.]+", "", str(plate)).lower()

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
async def create_or_update_car(payload: Union[VehicleCreate, Dict[str, Any]], plate_param: Optional[str] = None):
    if hasattr(payload, "model_dump"):
        payload = payload.model_dump(exclude_unset=False)
    elif hasattr(payload, "dict"):
        payload = payload.dict()
    else:
        payload = dict(payload)

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

    # 2. Query Database (PostgreSQL / Supabase) directly to ensure complete consistency
    if not plate_exists and not vin_exists:
        try:
            sb = get_supabase_client()
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

    # Sanitize register_year & insurance_company & finance_company
    reg_year_val = str(payload.get("register_year") or payload.get("reg_year") or "-").strip() or "-"
    payload["register_year"] = reg_year_val
    payload["reg_year"] = reg_year_val

    ins_comp_val = str(payload.get("insurance_company") or payload.get("ins_company") or "-").strip() or "-"
    payload["insurance_company"] = ins_comp_val
    payload["ins_company"] = ins_comp_val

    fin_comp_val = str(payload.get("finance_company") or "-").strip() or "-"
    payload["finance_company"] = fin_comp_val

    payload["plate"] = plate
    store.async_sync_car(plate, payload)
    return {"success": True, "car": store.cars.get(plate, payload)}

@app.get("/api/hp-leasing")
async def get_hp_leasing_data():
    return {
        "contracts": DEFAULT_HP_LEASING,
        "summary": DEFAULT_HP_SUMMARY,
        "property_insurance": DEFAULT_PROPERTY_INSURANCE
    }

@app.get("/api/cars/check-duplicates")
async def check_car_duplicates():
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
async def delete_car(plate: str):
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
# CUSTOMERS
# -------------------------------------------------------------------------
@app.get("/api/customers")
async def list_customers():
    if not store.initial_sync_done:
        store.sync_from_supabase(force=True)
    return list(store.customers.values())

@app.post("/api/customers")
async def create_or_update_customer(payload: Union[CustomerCreate, Dict[str, Any]]):
    if hasattr(payload, "model_dump"):
        payload = payload.model_dump(exclude_unset=False)
    elif hasattr(payload, "dict"):
        payload = payload.dict()
    else:
        payload = dict(payload)
    name = str(payload.get("full_name", "")).strip()
    if not name:
        raise HTTPException(status_code=400, detail="กรุณาระบุชื่อ-นามสกุลลูกค้า")
    
    original_name = str(payload.get("original_name") or "").strip()
    is_new = not bool(original_name)

    # 0. Block duplicate customer name if adding new customer
    if is_new and name in store.customers:
        raise HTTPException(
            status_code=400,
            detail=f"มีลูกค้ารายชื่อ '{name}' ในระบบแล้ว หากต้องการแก้ไขข้อมูล กรุณากดปุ่ม [✏️ ดู/แก้ไข]"
        )
    
    # 1. Block duplicate Phone Number (Contact No.)
    contact_no = str(payload.get("phone_number") or payload.get("contact_no") or payload.get("phone") or "").strip()
    if contact_no and contact_no not in ["-", "none", "None", ""]:
        clean_phone = "".join(ch for ch in contact_no if ch.isdigit())
        if len(clean_phone) >= 9:
            norm_phone = "0" + clean_phone[2:] if clean_phone.startswith("66") else clean_phone
            for c_name, c_obj in store.customers.items():
                if original_name and c_name.strip() == original_name:
                    continue # editing existing customer is allowed
                existing_phone = str(c_obj.get("phone_number") or c_obj.get("contact_no") or c_obj.get("phone") or "").strip()
                if existing_phone and existing_phone not in ["-", "none", "None", ""]:
                    clean_exist_phone = "".join(ch for ch in existing_phone if ch.isdigit())
                    norm_exist = "0" + clean_exist_phone[2:] if clean_exist_phone.startswith("66") else clean_exist_phone
                    if norm_exist == norm_phone:
                        raise HTTPException(
                            status_code=400,
                            detail=f"เบอร์โทรศัพท์ '{contact_no}' ซ้ำกับข้อมูลของลูกค้า '{c_name}' ในระบบแล้ว"
                        )
    
    # 2. Block duplicate Citizen ID / Passport No.
    passport_id = str(payload.get("id_card_no") or payload.get("passport_id") or payload.get("id_card") or "").strip()
    if passport_id and passport_id not in ["-", "none", "None", ""]:
        clean_pass = passport_id.replace(" ", "").replace("-", "").lower()
        for c_name, c_obj in store.customers.items():
            if original_name and c_name.strip() == original_name:
                continue # editing existing customer is allowed
            existing_pass = str(c_obj.get("id_card_no") or c_obj.get("passport_id") or c_obj.get("id_card") or "").strip()
            if existing_pass and existing_pass not in ["-", "none", "None", ""]:
                clean_exist = existing_pass.replace(" ", "").replace("-", "").lower()
                if clean_exist == clean_pass:
                    raise HTTPException(
                        status_code=400,
                        detail=f"หมายเลขบัตร ปชช. / Passport '{passport_id}' ซ้ำกับข้อมูลของลูกค้า '{c_name}' ในระบบแล้ว"
                    )

    # If renamed customer, delete the old customer record first
    if original_name and original_name != name and original_name in store.customers:
        store.async_delete_customer(original_name)

    clean_payload = dict(payload)
    clean_payload.pop("original_name", None)
    clean_payload["full_name"] = name
    store.async_sync_customer(name, clean_payload)
    return {"success": True, "customer": clean_payload}

@app.delete("/api/customers/{name}")
async def delete_customer(name: str):
    if name == "ลูกค้าทั่วไป (Walk-in)":
        raise HTTPException(status_code=400, detail="ไม่สามารถลบลูกค้ารายการเริ่มต้นของระบบได้")
    store.async_delete_customer(name)
    return {"success": True}

# -------------------------------------------------------------------------
# BOOKINGS
# -------------------------------------------------------------------------
@app.get("/api/bookings")
async def list_bookings():
    if not store.initial_sync_done:
        store.sync_from_supabase(force=True)
    res = []
    for b in store.bookings:
        b_copy = dict(b)
        b_copy["start_date_formatted"] = format_date_dmy(b.get("start_date"))
        b_copy["end_date_formatted"] = format_date_dmy(b.get("end_date"))
        c_obj = store.cars.get(b.get("car_id"), {})
        b_copy["car_brand"] = c_obj.get("brand", "")
        b_copy["car_model"] = c_obj.get("model", "")
        b_copy["car_image"] = c_obj.get("image", "")
        cust_obj = store.customers.get(b.get("customer"), {})
        b_copy["customer_phone"] = cust_obj.get("contact_no", "-")
        res.append(b_copy)
    return res

@app.post("/api/bookings")
async def create_booking(payload: Dict[str, Any]):
    # Generate booking ID in Thailand Time: MRC<YYMMDD><HHMMSS>
    now = now_th()
    bk_id = payload.get("booking_id") or f"MRC{now.strftime('%y%m%d%H%M%S')}"
    
    start_d = to_date(payload.get("start_date"))
    end_d = to_date(payload.get("end_date"))
    
    # Block backdated contracts (start_date must be >= today in Thailand timezone)
    th_today = now.date()
    if start_d and start_d < th_today:
        raise HTTPException(
            status_code=400,
            detail=f"ไม่อนุญาตให้ทำสัญญาหรือจองรถย้อนหลัง: วันที่เริ่มต้น ({start_d.strftime('%d/%m/%Y')}) ต้องไม่น้อยกว่าวันที่ปัจจุบัน ({th_today.strftime('%d/%m/%Y')})"
        )
    if start_d and end_d and end_d < start_d:
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
    deposit_amount = float(payload.get("deposit_amount", 5000.0))
    deposit_paid = bool(payload.get("deposit_paid", False))
    rental_paid = bool(payload.get("rental_paid", False))

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
        "deposit_slip": convert_gdrive_url(payload.get("deposit_slip", "") or payload.get("slip_url", "")),
        "rental_paid": rental_paid,
        "remaining_rental": 0.0 if rental_paid else net_price,
        "rental_ref": payload.get("rental_ref", ""),
        "rental_slip": convert_gdrive_url(payload.get("rental_slip", "")),
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
        # Flow step 4: after booking the car becomes "Reserved" (never jumps to On Rent).
        # A car that is currently On Rent / in workshop keeps its status while accepting future queues.
        if car_id in store.cars and store.cars[car_id].get("status") not in ("กำลังเช่า", "ซ่อมบำรุง"):
            store.cars[car_id]["status"] = "ติดจอง"
            store.async_sync_car(car_id, store.cars[car_id])
            
    store.async_sync_booking(booking)
    w_del = str(booking.get("worker_delivery", "")).strip()
    if w_del and w_del not in ["Wait", "-"]:
        cust_obj = store.customers.get(booking.get("customer"), {})
        b_with_cust = dict(booking)
        b_with_cust["customer_phone"] = cust_obj.get("contact_no", "-")
        b_with_cust["car_brand"] = car_obj.get("brand", "")
        b_with_cust["car_model"] = car_obj.get("model", "")
        notify_line_work_order(
            booking_obj=b_with_cust,
            job_type="Dispatch",
            worker_name=w_del,
            location=booking.get("loc_delivery", ""),
            appointment_time=start_t
        )
    return {"success": True, "booking_id": bk_id, "booking": booking}

@app.put("/api/bookings/{bk_id}")
async def update_booking(bk_id: str, payload: Dict[str, Any]):
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
    if payload.get("contract_issued") and not target.get("contract_issued"):
        if not target.get("deposit_paid"):
            raise HTTPException(status_code=400, detail="⚠️ ไม่สามารถออกสัญญาได้: ยังไม่ได้ชำระเงินมัดจำ")
        if not target.get("rental_paid"):
            raise HTTPException(status_code=400, detail="⚠️ ไม่สามารถออกสัญญาได้: ยังไม่ได้ชำระค่าเช่า (ชำระด้วยเงินสด / QR / บัตรเครดิต / PayPal ก่อนออกสัญญา)")
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

    store.async_sync_booking(target)
    return {"success": True, "booking": target}

@app.post("/api/bookings/{bk_id}/extend")
async def extend_booking(bk_id: str, payload: Dict[str, Any]):
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
        "created_at": now_th().isoformat()
    })

    prev_outstanding = 0.0 if target.get("rental_paid") else float(target.get("remaining_rental") or 0.0)
    target["extension_history"] = ext_list
    target["end_date"] = new_end
    target["end_time"] = new_end_t
    target["base_price"] = float(target.get("base_price") or 0.0) + extra_price
    target["net_price"] = float(target.get("net_price") or 0.0) + extra_price
    target["remaining_rental"] = prev_outstanding + extra_price
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
        "pdf_url": f"/api/pdf/contract/{bk_id}?download=1"
    }

@app.get("/api/bookings/{bk_id}/extend-check")
async def extend_check(bk_id: str, new_end_date: str):
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
async def delete_booking(bk_id: str):
    target = next((b for b in store.bookings if b.get("booking_id") == bk_id), None)
    if target and target.get("car_id") in store.cars:
        release_car_after_booking(target["car_id"], bk_id)
        
    store.async_delete_booking(bk_id)
    return {"success": True}

# -------------------------------------------------------------------------
# DEPOSIT & PAYMENT WORKFLOW
# -------------------------------------------------------------------------
@app.post("/api/bookings/{bk_id}/deposit")
async def record_deposit(bk_id: str, payload: Dict[str, Any]):
    target = next((b for b in store.bookings if b.get("booking_id") == bk_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="ไม่พบรายการจอง")

    dep_amount = float(payload.get("deposit_amount", 5000.0))
    dep_method = str(payload.get("payment_method", "โอนเงิน / สแกน QR"))
    dep_ref = str(payload.get("payment_ref") or payload.get("deposit_ref") or "").strip()
    dep_slip = convert_gdrive_url(str(payload.get("slip_url") or payload.get("deposit_slip") or "").strip())
    also_pay_rental = bool(payload.get("also_pay_rental", False))
    net_p = float(target.get("net_price", 0.0))

    th_today = now_th().date().isoformat()
    target["deposit_paid"] = True
    target["deposit_amount"] = dep_amount
    target["deposit_date"] = th_today
    target["deposit_method"] = dep_method
    target["deposit_ref"] = dep_ref
    target["deposit_slip"] = dep_slip

    if also_pay_rental:
        target["rental_paid"] = True
        target["remaining_rental"] = 0.0
        target["is_fully_paid"] = True
        target["rental_payment_date"] = th_today
        target["rental_payment_method"] = dep_method
        target["rental_ref"] = dep_ref
        target["rental_slip"] = dep_slip
    else:
        target["remaining_rental"] = net_p

    if target.get("status") == "รอชำระมัดจำ":
        target["status"] = "รอส่งมอบ"

    car_id = target.get("car_id")
    if car_id in store.cars:
        store.cars[car_id]["status"] = "ติดจอง"
        store.async_sync_car(car_id, store.cars[car_id])

    store.async_sync_booking(target)

    # Record financial: Deposit
    car_comp = store.cars.get(car_id, {}).get("company", "Sawasdee Rent A Car")
    dep_detail = f"รับเงินมัดจำประกันสัญญาตอนจองรถ ({dep_method})"
    if dep_ref:
        dep_detail += f" [Ref/สลิป: {dep_ref}]"
    f_dep = {
        "company": car_comp,
        "type": "รายรับ",
        "category": "เงินมัดจำประกันสัญญา (จองรถ)",
        "amount": dep_amount,
        "ref": bk_id,
        "date": th_today,
        "detail": dep_detail
    }
    store.async_sync_financial(f_dep)

    if also_pay_rental:
        rent_detail = f"ชำระค่าเช่ารถพร้อมมัดจำ {car_id} ({dep_method})"
        if dep_ref:
            rent_detail += f" [Ref/สลิป: {dep_ref}]"
        f_rent = {
            "company": car_comp,
            "type": "รายรับ",
            "category": "ค่าเช่ารถ",
            "amount": net_p,
            "ref": bk_id,
            "date": th_today,
            "detail": rent_detail
        }
        store.async_sync_financial(f_rent)

    # Trigger LINE notification for deposit payment & slip
    try:
        notify_line_deposit(target, dep_amount, dep_method, dep_ref, dep_slip, also_pay_rental)
    except Exception as line_err:
        print(f"Error sending LINE deposit notification: {line_err}")

    return {"success": True, "booking": target}

@app.post("/api/bookings/{bk_id}/settle")
async def settle_rental(bk_id: str, payload: Dict[str, Any]):
    target = next((b for b in store.bookings if b.get("booking_id") == bk_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="ไม่พบรายการจอง")

    settle_method = str(payload.get("payment_method", "โอนเงิน / สแกน QR"))
    settle_ref = str(payload.get("payment_ref") or payload.get("rental_ref") or "").strip()
    settle_slip = convert_gdrive_url(str(payload.get("slip_url") or payload.get("rental_slip") or "").strip())
    # Amount due = outstanding balance (covers extension top-ups); falls back to full rental price
    net_p = float(target.get("remaining_rental") or target.get("net_price", 0.0))

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

    store.async_sync_booking(target)

    car_id = target.get("car_id")
    car_comp = store.cars.get(car_id, {}).get("company", "Sawasdee Rent A Car")
    rent_detail = f"ชำระค่าเช่ารถคงเหลือ {car_id} ({settle_method})"
    if settle_ref:
        rent_detail += f" [Ref/สลิป: {settle_ref}]"
    f_rent = {
        "company": car_comp,
        "type": "รายรับ",
        "category": "ค่าเช่ารถ",
        "amount": net_p,
        "ref": bk_id,
        "date": th_today,
        "detail": rent_detail
    }
    store.async_sync_financial(f_rent)

    try:
        notify_line_deposit(target, net_p, settle_method, settle_ref, settle_slip, also_rent=True, is_settle_only=True)
    except Exception as line_err:
        print(f"Error sending LINE settle notification: {line_err}")

    return {"success": True, "booking": target}

@app.post("/api/bookings/{bk_id}/payment-slip")
async def update_payment_slip(bk_id: str, payload: Dict[str, Any]):
    target = next((b for b in store.bookings if b.get("booking_id") == bk_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="ไม่พบรายการจอง")

    if "payment_ref" in payload or "deposit_ref" in payload:
        ref_val = str(payload.get("payment_ref") or payload.get("deposit_ref") or "").strip()
        target["deposit_ref"] = ref_val
    if "slip_url" in payload or "deposit_slip" in payload:
        slip_val = str(payload.get("slip_url") or payload.get("deposit_slip") or "").strip()
        target["deposit_slip"] = convert_gdrive_url(slip_val)
    if "rental_ref" in payload:
        target["rental_ref"] = str(payload.get("rental_ref") or "").strip()
    if "rental_slip" in payload:
        target["rental_slip"] = convert_gdrive_url(str(payload.get("rental_slip") or "").strip())

    store.async_sync_booking(target)
    return {"success": True, "booking": target}

# -------------------------------------------------------------------------
# DISPATCH & RETURN WORK ORDERS
# -------------------------------------------------------------------------
@app.post("/api/bookings/{bk_id}/assign")
async def assign_worker(bk_id: str, payload: Dict[str, Any]):
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
        if action_type == "complete_now":
            target["status"] = "เสร็จสิ้น"
            target["return_closed"] = True
            release_car_after_booking(target.get("car_id"), bk_id)
        elif target.get("status") == "กำลังเช่า":
            target["status"] = "เตรียมรับคืน"

    store.async_sync_booking(target)

    # Trigger LINE alert (Broadcast to all staff on LINE OA)
    cust_obj = store.customers.get(target.get("customer"), {})
    car_obj = store.cars.get(target.get("car_id"), {})
    b_with_cust = dict(target)
    b_with_cust["customer_phone"] = cust_obj.get("contact_no", "-")
    b_with_cust["car_brand"] = car_obj.get("brand", "")
    b_with_cust["car_model"] = car_obj.get("model", "")
    notify_line_work_order(
        booking_obj=b_with_cust,
        job_type=job_type,
        worker_name=worker,
        location=location,
        appointment_time=time_val
    )

    return {"success": True, "booking": target}

# -------------------------------------------------------------------------
# BACK OFFICE WORK ORDERS & INSPECTIONS
# -------------------------------------------------------------------------
@app.get("/api/backoffice/jobs")
async def list_backoffice_jobs():
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
async def close_dispatch(bk_id: str, payload: Dict[str, Any]):
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

    car_id = target.get("car_id")
    if car_id in store.cars:
        store.cars[car_id]["status"] = "กำลังเช่า"
        if mileage:
            store.cars[car_id]["mileage"] = mileage
        store.async_sync_car(car_id, store.cars[car_id])

    store.async_sync_booking(target)
    return {"success": True, "booking": target}

@app.post("/api/bookings/{bk_id}/close-return")
async def close_return(bk_id: str, payload: Dict[str, Any]):
    fuel = payload.get("fuel_level", "⛽ เต็มถัง (Full - 8/8) [100%]")
    mileage = payload.get("mileage", "")
    notes = payload.get("notes", "ตรวจสภาพรถยนต์ตอนรับคืนเรียบร้อยดี")
    photos = payload.get("photos", [])
    late_fee = float(payload.get("late_fee", 0.0))

    success = store.archive_completed_booking(
        booking_id=bk_id,
        fuel_level=fuel,
        inspection_notes=notes,
        inspection_photos=photos,
        mileage=mileage,
        late_fee=late_fee
    )
    if not success:
        raise HTTPException(status_code=404, detail="ไม่สามารถปิดงานรับคืนได้ หรือไม่พบรหัสการจอง")
    return {"success": True}

@app.post("/api/upload-photo")
async def upload_photo(file: UploadFile = File(...)):
    contents = await file.read()
    ext = file.filename.split(".")[-1] if "." in file.filename else "jpg"
    safe_fn = f"insp_{int(time.time()*1000)}.{ext}"
    url = store.upload_photo(safe_fn, contents, file.content_type or "image/jpeg")
    if not url:
        raise HTTPException(status_code=500, detail="อัปโหลดรูปภาพไม่สำเร็จ")
    return {"success": True, "url": url, "filename": safe_fn}

# -------------------------------------------------------------------------
# FLEET MAINTENANCE & SERVICE WORK ORDERS
# -------------------------------------------------------------------------
@app.get("/api/maintenance")
async def list_maintenance(
    car_id: Optional[str] = None,
    status: Optional[str] = None,
    order_type: Optional[str] = None,
    search: Optional[str] = None
):
    records = list(store.maintenance_records)
    if car_id and car_id != "ทั้งหมด":
        records = [r for r in records if r.get("car_id") == car_id]
    if status and status != "ทั้งหมด":
        records = [r for r in records if r.get("status") == status]
    if order_type and order_type != "ทั้งหมด":
        records = [r for r in records if order_type in str(r.get("order_type", ""))]
    if search:
        kw = search.lower().strip()
        records = [
            r for r in records
            if kw in str(r.get("id", "")).lower()
            or kw in str(r.get("car_id", "")).lower()
            or kw in str(r.get("car_brand", "")).lower()
            or kw in str(r.get("car_model", "")).lower()
            or kw in str(r.get("service_center", "")).lower()
            or kw in str(r.get("service_items", "")).lower()
            or kw in str(r.get("assigned_worker", "")).lower()
        ]
    return records

@app.post("/api/maintenance")
async def create_maintenance(payload: Dict[str, Any]):
    car_id = str(payload.get("car_id", "")).strip()
    if not car_id:
        raise HTTPException(status_code=400, detail="กรุณาระบุทะเบียนรถ")
    
    car = store.cars.get(car_id, {})
    now_str = now_th().strftime("%y%m%d%H%M%S")
    mnt_id = f"MNT{now_str}"
    
    cost_val = 0.0
    try:
        cost_val = float(payload.get("cost", 0) or 0)
    except Exception:
        pass
        
    sched_d = payload.get("schedule_date") or date.today().strftime("%Y-%m-%d")
    sched_t = payload.get("schedule_time") or "09:00"
    exp_d = payload.get("expected_finish_date") or sched_d
    exp_t = payload.get("expected_finish_time") or "17:00"
    
    order_type = payload.get("order_type") or "ซ่อมบำรุงทั่วไป / เช็คระยะ"
    service_items = payload.get("service_items") or "-"
    service_center = payload.get("service_center") or "-"
    service_center_phone = payload.get("service_center_phone") or "-"
    service_location = payload.get("service_location") or "-"
    assigned_worker = payload.get("assigned_worker") or "admin"
    current_mileage = payload.get("current_mileage") or car.get("mileage", "-")
    notes = payload.get("notes") or ""
    update_car_status = bool(payload.get("update_car_status", True))
    created_by = payload.get("created_by") or "admin"
    
    is_renewal = any(k in order_type for k in ["ต่อทะเบียน", "พ.ร.บ.", "พรบ", "ประกัน", "ภาษี"])
    init_status = "กำลังต่อภาษี/ประกัน" if is_renewal else ("กำลังซ่อมบำรุง" if update_car_status else "รอดำเนินการ")
    
    record = {
        "id": mnt_id,
        "car_id": car_id,
        "car_brand": car.get("brand", payload.get("car_brand", "")),
        "car_model": car.get("model", payload.get("car_model", "")),
        "car_color": car.get("color", payload.get("car_color", "")),
        "order_type": order_type,
        "service_items": service_items,
        "cost": cost_val,
        "actual_cost": 0.0,
        "service_center": service_center,
        "service_center_phone": service_center_phone,
        "service_location": service_location,
        "assigned_worker": assigned_worker,
        "schedule_date": sched_d,
        "schedule_time": sched_t,
        "expected_finish_date": exp_d,
        "expected_finish_time": exp_t,
        "status": init_status,
        "current_mileage": current_mileage,
        "notes": notes,
        "completion_notes": "",
        "update_car_status": update_car_status,
        "created_by": created_by,
        "created_at": now_th().strftime("%Y-%m-%d %H:%M:%S"),
        "completed_at": None
    }
    
    if update_car_status and car_id in store.cars:
        store.cars[car_id]["status"] = "ต่อทะเบียน/ประกัน" if is_renewal else "ซ่อมบำรุง"
        store.async_sync_car(car_id, store.cars[car_id])
        
    store.async_sync_maintenance(record)
    
    # Notify via LINE with all required maintenance details
    try:
        notify_line_maintenance(record)
    except Exception as e:
        print(f"Error notifying line maintenance: {e}")
        
    return {"success": True, "maintenance": record}

@app.get("/api/maintenance/{mnt_id}")
async def get_maintenance(mnt_id: str):
    target = next((m for m in store.maintenance_records if m.get("id") == mnt_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="ไม่พบข้อมูลใบงานซ่อมบำรุง")
    return target

@app.put("/api/maintenance/{mnt_id}")
async def update_maintenance(mnt_id: str, payload: Dict[str, Any]):
    target = next((m for m in store.maintenance_records if m.get("id") == mnt_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="ไม่พบข้อมูลใบงานซ่อมบำรุง")
    
    for k, v in payload.items():
        if k not in ["id", "created_at"]:
            target[k] = v
            
    store.async_sync_maintenance(target)
    return {"success": True, "maintenance": target}

@app.post("/api/maintenance/{mnt_id}/close")
async def close_maintenance(mnt_id: str, payload: Dict[str, Any]):
    actual_cost = payload.get("actual_cost")
    notes = payload.get("completion_notes", "")
    new_mileage = payload.get("mileage")
    recorded_by = payload.get("recorded_by", "admin")
    new_act_expiry = payload.get("new_act_expiry")
    new_ins_expiry = payload.get("new_ins_expiry")
    policy_no = payload.get("policy_no")
    
    closed = store.close_maintenance_record(
        mnt_id,
        actual_cost=actual_cost,
        completion_notes=notes,
        new_mileage=new_mileage,
        recorded_by=recorded_by,
        new_act_expiry=new_act_expiry,
        new_ins_expiry=new_ins_expiry,
        policy_no=policy_no
    )
    if not closed:
        raise HTTPException(status_code=404, detail="ไม่พบใบงานซ่อมบำรุงที่ต้องการปิดงาน")
        
    # Notify via LINE that maintenance / renewal is closed
    try:
        notify_line_close_maintenance(closed, store.cars.get(closed.get("car_id")))
    except Exception as e:
        print(f"Error notifying line close maintenance: {e}")

    return {"success": True, "maintenance": closed, "car": store.cars.get(closed.get("car_id"))}

@app.delete("/api/maintenance/{mnt_id}")
async def delete_maintenance(mnt_id: str):
    target = next((m for m in store.maintenance_records if m.get("id") == mnt_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="ไม่พบข้อมูลใบงานซ่อมบำรุง")
        
    car_id = target.get("car_id")
    if car_id and car_id in store.cars:
        if store.cars[car_id].get("status") in ["ซ่อมบำรุง", "สถานะซ่อมบำรุง"]:
            store.cars[car_id]["status"] = "ว่างพร้อมใช้งาน"
            store.async_sync_car(car_id, store.cars[car_id])
            
    store.async_delete_maintenance(mnt_id)
    return {"success": True, "message": "ลบใบงานสำเร็จ"}

@app.get("/api/pdf/maintenance/{mnt_id}")
async def get_maintenance_pdf(mnt_id: str):
    target = next((m for m in store.maintenance_records if m.get("id") == mnt_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="ไม่พบข้อมูลใบงานซ่อมบำรุง")
        
    car = store.cars.get(target.get("car_id"), {})
    pdf_bytes = pdf_engine.generate_maintenance_job_pdf(target, car)
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f"inline; filename=WorkOrder_{mnt_id}.pdf"}
    )

# -------------------------------------------------------------------------
# EXECUTIVE DASHBOARD & REPORTS
# -------------------------------------------------------------------------
@app.get("/api/reports/car-profitability")
async def get_car_profitability():
    # Computes gross revenue, expenses (repairs/maintenance), and net profit per car
    rev_by_car = {}
    rentals_by_car = {}
    completed_bids = set()

    for j in store.completed_jobs:
        pl = j.get("car_id")
        if pl:
            rev_by_car[pl] = rev_by_car.get(pl, 0.0) + float(j.get("net_price", 0.0)) + float(j.get("late_fee", 0.0))
            rentals_by_car[pl] = rentals_by_car.get(pl, 0) + 1
        if j.get("booking_id"):
            completed_bids.add(j["booking_id"])

    for b in store.bookings:
        pl = b.get("car_id")
        bid = b.get("booking_id")
        if pl and bid not in completed_bids:
            if b.get("rental_paid") or b.get("status") in ["กำลังเช่า", "เตรียมรับคืน", "รอส่งมอบ", "เตรียมส่งมอบ"]:
                rev_by_car[pl] = rev_by_car.get(pl, 0.0) + float(b.get("net_price", 0.0))
                rentals_by_car[pl] = rentals_by_car.get(pl, 0) + 1

    exp_by_car = {}
    mnt_ids = set()
    for m in store.maintenance_records:
        pl = m.get("car_id")
        if pl:
            cost_val = float(m.get("actual_cost") or m.get("cost") or 0.0)
            exp_by_car[pl] = exp_by_car.get(pl, 0.0) + cost_val
        if m.get("id"):
            mnt_ids.add(m["id"])

    for f in store.financial_records:
        f_type = f.get("type")
        f_amt = float(f.get("amount", 0.0) or 0.0)
        f_ref = str(f.get("ref", ""))
        f_det = str(f.get("detail", ""))

        matched_pl = None
        for pl in store.cars.keys():
            if pl == f_ref or pl in f_det:
                matched_pl = pl
                break

        if matched_pl:
            if f_type == "รายรับ" and f.get("category") == "ค่าเช่ารถ":
                if f_ref not in completed_bids:
                    rev_by_car[matched_pl] = rev_by_car.get(matched_pl, 0.0) + f_amt
            elif f_type == "รายจ่าย":
                if f_ref not in mnt_ids:
                    exp_by_car[matched_pl] = exp_by_car.get(matched_pl, 0.0) + f_amt

    profitability = []
    for plate, car in store.cars.items():
        gross = round(rev_by_car.get(plate, 0.0), 2)
        exp = round(exp_by_car.get(plate, 0.0), 2)
        net = round(gross - exp, 2)
        r_cnt = rentals_by_car.get(plate, 0)

        profitability.append({
            "plate": plate,
            "brand": car.get("brand", ""),
            "model": car.get("model", ""),
            "color": car.get("color", ""),
            "company": car.get("company", "Sawasdee Rent A Car"),
            "status": car.get("status", "ว่างพร้อมใช้งาน"),
            "price_day": float(car.get("price_day") or car.get("daily_rate") or 0),
            "total_rentals": r_cnt,
            "gross_revenue": gross,
            "total_expense": exp,
            "net_profit": net
        })

    # Sort descending: Highest net profit first, then revenue, then rentals count
    profitability.sort(key=lambda x: (x["net_profit"], x["gross_revenue"], x["total_rentals"]), reverse=True)
    for idx, item in enumerate(profitability, 1):
        item["rank"] = idx

    return profitability

@app.get("/api/reports/kpis")
async def get_dashboard_kpis():
    total_cars = len(store.cars)
    active_rentals = sum(1 for b in store.bookings if b.get("status") in ["กำลังเช่า", "เตรียมรับคืน"])
    utilization_rate = round((active_rentals / max(1, total_cars)) * 100, 1)

    total_revenue = sum(float(f.get("amount", 0)) for f in store.financial_records if f.get("type") == "รายรับ")

    # Fleet share by company
    company_counts = {}
    for c in store.cars.values():
        comp = c.get("company", "อื่นๆ")
        company_counts[comp] = company_counts.get(comp, 0) + 1

    return {
        "total_cars": total_cars,
        "active_rentals": active_rentals,
        "total_bookings": len(store.bookings),
        "total_completed": len(store.completed_jobs),
        "utilization_rate": utilization_rate,
        "total_revenue": total_revenue,
        "company_distribution": company_counts,
        "financial_records": store.financial_records
    }

@app.get("/api/reports/monthly")
async def get_monthly_reports(month: Optional[str] = None):
    # month format: "YYYY-MM"
    jobs = store.completed_jobs
    if month:
        filtered = []
        for j in jobs:
            c_d = j.get("completed_date") or j.get("end_date")
            d = to_date(c_d)
            if d and d.strftime("%Y-%m") == month:
                filtered.append(j)
        jobs = filtered

    total_rev = sum(float(j.get("net_price", 0)) for j in jobs)
    return {
        "total_jobs": len(jobs),
        "total_revenue": total_rev,
        "jobs": jobs
    }

@app.get("/api/reports/export-csv")
async def export_csv(month: Optional[str] = None):
    jobs = store.completed_jobs
    if month:
        filtered = []
        for j in jobs:
            c_d = j.get("completed_date") or j.get("end_date")
            d = to_date(c_d)
            if d and d.strftime("%Y-%m") == month:
                filtered.append(j)
        jobs = filtered

    rows = []
    for x in jobs:
        rows.append({
            "รหัสการจอง": x.get("booking_id", ""),
            "วันที่เสร็จสิ้น": format_date_dmy(x.get("completed_date") or x.get("end_date")),
            "ทะเบียนรถ": x.get("car_id", ""),
            "ลูกค้า": x.get("customer", ""),
            "บริษัท": x.get("company", ""),
            "ประเภทสัญญา": x.get("contract_type", "รายวัน"),
            "รายรับสุทธิ (THB)": x.get("net_price", 0),
            "พนักงานส่งรถ": x.get("worker_delivery", "-"),
            "พนักงานรับรถ": x.get("worker_return", "-"),
            "สถานที่": x.get("loc_return") or x.get("loc_delivery") or "-",
            "ระดับน้ำมัน": x.get("fuel_level", "-"),
            "สถานะ": "เสร็จสิ้น"
        })
    import csv
    buf = io.StringIO()
    fieldnames = [
        "รหัสการจอง", "วันที่เสร็จสิ้น", "ทะเบียนรถ", "ลูกค้า", "บริษัท",
        "ประเภทสัญญา", "รายรับสุทธิ (THB)", "พนักงานส่งรถ", "พนักงานรับรถ",
        "สถานที่", "ระดับน้ำมัน", "สถานะ"
    ]
    writer = csv.DictWriter(buf, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(rows)
    csv_bytes = buf.getvalue().encode('utf-8-sig')
    return StreamingResponse(
        io.BytesIO(csv_bytes),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=completed_jobs_{month or 'all'}.csv"}
    )

def _resolve_cust_and_car(target):
    cust = store.customers.get(target.get("customer"))
    if not cust and target.get("customer"):
        target_cname = str(target.get("customer")).strip().lower()
        for k, v in store.customers.items():
            if str(k).strip().lower() == target_cname:
                cust = v
                break
    if not cust:
        cust = {
            "full_name": target.get("customer", "-"),
            "contact_no": target.get("customer_phone", "-"),
            "passport_id": target.get("customer_id_card", "-")
        }

    car = store.cars.get(target.get("car_id"))
    if not car and target.get("car_id"):
        target_plate = str(target.get("car_id")).strip().lower()
        for k, v in store.cars.items():
            if str(k).strip().lower() == target_plate:
                car = v
                break
    if not car:
        car = {
            "plate": target.get("car_id", "-"),
            "brand": target.get("car_brand", ""),
            "model": target.get("car_model", "")
        }
    return cust, car

# -------------------------------------------------------------------------
# PDF DOCUMENT STREAMING ENDPOINTS
# -------------------------------------------------------------------------
@app.get("/api/pdf/contract/{bk_id}")
async def get_contract_pdf(bk_id: str, download: int = 0):
    target = next((b for b in store.bookings if b.get("booking_id") == bk_id), None)
    if not target:
        target = next((cj for cj in store.completed_jobs if cj.get("booking_id") == bk_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="ไม่พบข้อมูลการจอง")

    cust, car = _resolve_cust_and_car(target)
    pdf_bytes = pdf_engine.generate_filled_pdf("rental_template_blank_v2.pdf", target, cust, car)

    # Viewing the PDF only counts as "contract issued" once the flow prerequisites are satisfied
    if not target.get("contract_issued") and target.get("deposit_paid") and target.get("rental_paid"):
        target["contract_issued"] = True
        store.async_sync_booking(target)

    ext_count = len([x for x in (target.get("extension_history") or []) if isinstance(x, dict) and x.get("type") == "extension"])
    fname = f"Agreement_{bk_id}" + (f"_ext{ext_count}" if ext_count else "") + ".pdf"
    disp = "attachment" if download else "inline"
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f"{disp}; filename={fname}"}
    )

@app.get("/api/pdf/receipt/{bk_id}")
async def get_receipt_pdf(bk_id: str):
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
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f"inline; filename=Receipt_{bk_id}.pdf"}
    )

@app.get("/api/pdf/deposit-receipt/{bk_id}")
async def get_deposit_receipt_pdf(bk_id: str):
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
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f"inline; filename=Deposit_Receipt_{bk_id}.pdf"}
    )

@app.get("/api/pdf/job/{bk_id}")
async def get_job_pdf(bk_id: str):
    target = next((b for b in store.bookings if b.get("booking_id") == bk_id), None)
    if not target:
        target = next((cj for cj in store.completed_jobs if cj.get("booking_id") == bk_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="ไม่พบข้อมูลการจอง")

    cust, car = _resolve_cust_and_car(target)
    pdf_bytes = pdf_engine.generate_job_pdf(target, cust, car, "Return", target.get("worker_return"), target.get("loc_return"), inspection_data=target)
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f"inline; filename=Inspection_Checklist_{bk_id}.pdf"}
    )

# -------------------------------------------------------------------------
# LINE MESSAGING (DIRECT PUSH & AUTO-LINK WEBHOOK)
# -------------------------------------------------------------------------
@app.post("/api/line/broadcast")
async def trigger_line_broadcast(payload: Dict[str, Any]):
    msg = payload.get("message", "ทดสอบการส่งข้อความจากระบบ Sawasdee Rental")
    to_uid = payload.get("to_user_id")
    worker = payload.get("worker_name")
    if worker and not to_uid:
        to_uid = resolve_worker_line_id(worker)
    success = send_line_push_message(msg, to_user_id=to_uid or get_admin_line_id())
    return {"success": success, "to_user_id": to_uid or get_admin_line_id()}

@app.post("/api/line/check-expiry")
async def trigger_expiry_alert_check(payload: Optional[Dict[str, Any]] = None):
    mode = (payload or {}).get("recipient_mode")
    res = check_and_send_expiry_alerts(store.cars, target_days=(30, 31, 7, 0), recipient_mode=mode)
    return res

@app.post("/api/line/webhook")
@app.post("/webhook/line")
async def line_bot_webhook(request: Request):
    """
    Webhook สำหรับผูกบัญชี LINE ของพนักงานอัตโนมัติ (ใช้ replyToken ฟรี 0 โควต้า):
    - พนักงานพิมพ์ชื่อผู้ใช้ (Username) เช่น 'chaiwat.u' ส่งมาในแชท LINE OA
    - ระบบจะบันทึก line_user_id คู่กับ username ลงฐานข้อมูลทันที
    """
    try:
        body = await request.json()
    except Exception:
        return {"status": "ok"}

    events = body.get("events") or []
    for ev in events:
        ev_type = ev.get("type")
        source = ev.get("source") or {}
        line_uid = source.get("userId")
        reply_token = ev.get("replyToken")

        if ev_type == "message" and ev.get("message", {}).get("type") == "text" and line_uid:
            raw_text = str(ev.get("message", {}).get("text") or "").strip()
            clean_text = raw_text.replace("ผูกบัญชี", "").replace("link", "").strip()
            matched_user = None

            for uname, u_obj in store.users.items():
                u_line = str(u_obj.get("line_user_id") or "").strip().lower()
                if (
                    uname.lower() == clean_text.lower()
                    or str(u_obj.get("name") or "").strip().lower() == clean_text.lower()
                    or (u_line and u_line == clean_text.lower())
                ):
                    matched_user = u_obj
                    break

            if matched_user:
                uname = matched_user.get("username")
                matched_user["line_user_id"] = line_uid
                store.async_sync_user(uname, matched_user)
                if reply_token:
                    send_line_reply_message(
                        reply_token,
                        "\n".join([
                            "✅ ผูกบัญชีสำเร็จ!",
                            f"👤 ชื่อผู้ใช้: {uname} ({matched_user.get('name', uname)})",
                            f"📲 LINE ID: {line_uid}",
                            "ระบบจะส่งใบงานส่งรถ/รับรถ/ซ่อมบำรุง ที่คุณเป็นผู้รับผิดชอบมาที่แชทนี้โดยตรงครับ"
                        ])
                    )
            elif reply_token:
                send_line_reply_message(
                    reply_token,
                    "\n".join([
                        "📲 รหัส LINE User ID ของคุณคือ:",
                        line_uid,
                        "",
                        "💡 พิมพ์ชื่อผู้ใช้งาน (Username) ของคุณในระบบ (เช่น chaiwat.u) ส่งมาในแชทนี้เพื่อผูกบัญชีรับใบงานอัตโนมัติ หรือคัดลอกรหัสข้างต้นไปใส่ในหน้าจัดการผู้ใช้งานได้เลยครับ"
                    ])
                )
    return {"status": "ok"}

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8501))
    uvicorn.run("server:app", host="0.0.0.0", port=port, reload=False)

