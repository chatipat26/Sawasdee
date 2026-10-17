import os
import io
import time
from datetime import datetime, date, timedelta
from typing import Optional, List, Dict, Any
from fastapi import FastAPI, HTTPException, Request, Response, UploadFile, File, Form, Depends
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
import pandas as pd

from db import (
    store,
    get_car_fleet_status,
    calculate_rental_duration_and_days,
    format_date_dmy,
    to_date,
    start_background_cloud_sync
)
import pdf_engine
from line_service import (
    send_line_broadcast_message,
    notify_line_work_order,
    check_and_send_expiry_alerts,
    init_expiry_scheduler_thread
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

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

# Start background sync and scheduler on startup
@app.on_event("startup")
def startup_event():
    print("🚀 Starting SawasdeeRental Web App server...")
    # Trigger non-blocking async background sync
    store.sync_from_supabase_async(force=True)
    start_background_cloud_sync()
    init_expiry_scheduler_thread()

# -------------------------------------------------------------------------
# ROOT HTML (SPA)
# -------------------------------------------------------------------------
@app.api_route("/", methods=["GET", "HEAD"], response_class=HTMLResponse)
async def serve_index():
    index_file = os.path.join(BASE_DIR, "templates", "index.html")
    if os.path.exists(index_file):
        with open(index_file, "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
    return HTMLResponse("<h1>Sawasdee Rental</h1><p>Building client application...</p>")

# -------------------------------------------------------------------------
# SYSTEM STATUS & SYNC
# -------------------------------------------------------------------------
@app.get("/api/status")
async def get_system_status():
    return {
        "status": "online",
        "last_sync_time": store.last_sync_time,
        "last_sync_formatted": datetime.fromtimestamp(store.last_sync_time).strftime("%H:%M:%S") if store.last_sync_time else "เมื่อสักครู่",
        "total_cars": len(store.cars),
        "total_customers": len(store.customers),
        "total_bookings": len(store.bookings),
        "total_completed": len(store.completed_jobs),
        "timestamp": time.time()
    }

@app.post("/api/sync")
async def trigger_manual_sync():
    store.sync_from_supabase(force=True)
    return {"success": True, "message": "ซิงค์ข้อมูลจาก Supabase Cloud สำเร็จเรียบร้อย"}

# -------------------------------------------------------------------------
# AUTHENTICATION & USERS
# -------------------------------------------------------------------------
@app.post("/api/auth/login")
async def login(payload: Dict[str, Any]):
    un = str(payload.get("username", "")).strip()
    pw = str(payload.get("password", "")).strip()
    if not un or not pw:
        raise HTTPException(status_code=400, detail="กรุณากรอกชื่อผู้ใช้และรหัสผ่าน")

    user = store.users.get(un)
    if not user:
        # Check case-insensitive
        for k, v in store.users.items():
            if k.lower() == un.lower():
                user = v
                break

    if not user or user.get("password") != pw:
        raise HTTPException(status_code=401, detail="ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง")

    if user.get("status") == "pending":
        raise HTTPException(status_code=403, detail="บัญชีของคุณอยู่ระหว่างรอผู้ดูแลระบบ (Admin) อนุมัติการเข้าใช้งาน")

    return {
        "success": True,
        "user": {
            "username": user.get("username"),
            "name": user.get("name") or user.get("username"),
            "role": user.get("role", "Staff"),
            "status": user.get("status", "approved")
        }
    }

@app.post("/api/auth/register")
async def register(payload: Dict[str, Any]):
    un = str(payload.get("username", "")).strip().lower()
    fn = str(payload.get("name", "")).strip()
    pw = str(payload.get("password", "")).strip()
    if not un or not pw:
        raise HTTPException(status_code=400, detail="กรุณากรอกชื่อผู้ใช้งานและรหัสผ่าน")
    if un in store.users:
        raise HTTPException(status_code=400, detail="ชื่อผู้ใช้นี้มีในระบบแล้ว")

    new_u = {
        "username": un,
        "name": fn or un,
        "password": pw,
        "role": "Staff",
        "status": "pending",
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
    users_list = []
    for u in store.users.values():
        u_safe = dict(u)
        u_safe.pop("password", None)
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

# -------------------------------------------------------------------------
# CARS FLEET
# -------------------------------------------------------------------------
@app.get("/api/cars")
async def list_cars(start_date: Optional[str] = None, end_date: Optional[str] = None):
    cars_data = []
    for plate, car in store.cars.items():
        status_key, status_desc, color, bg, border = get_car_fleet_status(
            plate, car, store.bookings, start_date, end_date
        )
        c_copy = dict(car)
        c_copy["fleet_status_key"] = status_key
        c_copy["fleet_status_desc"] = status_desc
        c_copy["status_color"] = color
        c_copy["status_bg"] = bg
        c_copy["status_border"] = border
        cars_data.append(c_copy)
    return cars_data

@app.post("/api/cars")
async def create_or_update_car(payload: Dict[str, Any]):
    plate = str(payload.get("plate", "")).strip()
    if not plate:
        raise HTTPException(status_code=400, detail="กรุณาระบุเลขทะเบียนรถ")
    store.async_sync_car(plate, payload)
    return {"success": True, "car": payload}

# -------------------------------------------------------------------------
# CUSTOMERS
# -------------------------------------------------------------------------
@app.get("/api/customers")
async def list_customers():
    return list(store.customers.values())

@app.post("/api/customers")
async def create_or_update_customer(payload: Dict[str, Any]):
    name = str(payload.get("full_name", "")).strip()
    if not name:
        raise HTTPException(status_code=400, detail="กรุณาระบุชื่อ-นามสกุลลูกค้า")
    store.async_sync_customer(name, payload)
    return {"success": True, "customer": payload}

@app.delete("/api/customers/{name}")
async def delete_customer(name: str):
    store.async_delete_customer(name)
    return {"success": True}

# -------------------------------------------------------------------------
# BOOKINGS
# -------------------------------------------------------------------------
@app.get("/api/bookings")
async def list_bookings():
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
    # Generate booking ID: MRC<YYMMDD><HHMMSS>
    now = datetime.now()
    bk_id = payload.get("booking_id") or f"MRC{now.strftime('%y%m%d%H%M%S')}"
    
    start_d = to_date(payload.get("start_date"))
    end_d = to_date(payload.get("end_date"))
    start_t = payload.get("start_time", "10:00")
    end_t = payload.get("end_time", "10:00")
    
    billable_days, extra_hours, rem_minutes, is_over_4hr, explanation = calculate_rental_duration_and_days(
        start_d, start_t, end_d, end_t
    )
    
    car_id = payload.get("car_id")
    car_obj = store.cars.get(car_id, {})
    price_day = float(car_obj.get("price_day", 1000))
    contract_type = payload.get("contract_type", "รายวัน")
    
    base_price = payload.get("base_price")
    if base_price is None:
        if contract_type == "รายวัน":
            base_price = price_day * billable_days
        elif contract_type == "รายสัปดาห์":
            base_price = float(car_obj.get("price_week", price_day * 6))
        elif contract_type == "รายเดือน":
            base_price = float(car_obj.get("price_month", price_day * 20))
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
        "rental_paid": rental_paid,
        "remaining_rental": 0.0 if rental_paid else net_price,
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
        "created_at": datetime.utcnow().isoformat()
    }
    
    with store.lock:
        store.bookings.insert(0, booking)
        if car_id in store.cars:
            store.cars[car_id]["status"] = "ติดจอง"
            store.async_sync_car(car_id, store.cars[car_id])
            
    store.async_sync_booking(booking)
    return {"success": True, "booking_id": bk_id, "booking": booking}

@app.put("/api/bookings/{bk_id}")
async def update_booking(bk_id: str, payload: Dict[str, Any]):
    target = next((b for b in store.bookings if b.get("booking_id") == bk_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="ไม่พบรายการจอง")
        
    for k, v in payload.items():
        if k in ["start_date", "end_date"]:
            target[k] = to_date(v)
        else:
            target[k] = v
            
    store.async_sync_booking(target)
    return {"success": True, "booking": target}

@app.delete("/api/bookings/{bk_id}")
async def delete_booking(bk_id: str):
    target = next((b for b in store.bookings if b.get("booking_id") == bk_id), None)
    if target and target.get("car_id") in store.cars:
        car_id = target["car_id"]
        store.cars[car_id]["status"] = "ว่างพร้อมใช้งาน"
        store.async_sync_car(car_id, store.cars[car_id])
        
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
    dep_method = str(payload.get("payment_method", "เงินสด"))
    also_pay_rental = bool(payload.get("also_pay_rental", False))
    net_p = float(target.get("net_price", 0.0))

    target["deposit_paid"] = True
    target["deposit_amount"] = dep_amount
    target["deposit_date"] = date.today().isoformat()
    target["deposit_method"] = dep_method

    if also_pay_rental:
        target["rental_paid"] = True
        target["remaining_rental"] = 0.0
        target["is_fully_paid"] = True
        target["rental_payment_date"] = date.today().isoformat()
        target["rental_payment_method"] = dep_method
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
    f_dep = {
        "company": car_comp,
        "type": "รายรับ",
        "category": "เงินมัดจำประกันสัญญา (จองรถ)",
        "amount": dep_amount,
        "ref": bk_id,
        "date": datetime.now().strftime("%Y-%m-%d"),
        "detail": f"รับเงินมัดจำประกันสัญญาตอนจองรถ ({dep_method})"
    }
    store.async_sync_financial(f_dep)

    if also_pay_rental:
        f_rent = {
            "company": car_comp,
            "type": "รายรับ",
            "category": "ค่าเช่ารถ",
            "amount": net_p,
            "ref": bk_id,
            "date": datetime.now().strftime("%Y-%m-%d"),
            "detail": f"ชำระค่าเช่ารถพร้อมมัดจำ {car_id} ({dep_method})"
        }
        store.async_sync_financial(f_rent)

    return {"success": True, "booking": target}

@app.post("/api/bookings/{bk_id}/settle")
async def settle_rental(bk_id: str, payload: Dict[str, Any]):
    target = next((b for b in store.bookings if b.get("booking_id") == bk_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="ไม่พบรายการจอง")

    settle_method = str(payload.get("payment_method", "เงินสด"))
    net_p = float(target.get("net_price", 0.0))

    target["rental_paid"] = True
    target["remaining_rental"] = 0.0
    target["is_fully_paid"] = True
    target["rental_payment_date"] = date.today().isoformat()
    target["rental_payment_method"] = settle_method

    store.async_sync_booking(target)

    car_id = target.get("car_id")
    car_comp = store.cars.get(car_id, {}).get("company", "Sawasdee Rent A Car")
    f_rent = {
        "company": car_comp,
        "type": "รายรับ",
        "category": "ค่าเช่ารถ",
        "amount": net_p,
        "ref": bk_id,
        "date": datetime.now().strftime("%Y-%m-%d"),
        "detail": f"ชำระค่าเช่ารถคงเหลือ {car_id} ({settle_method})"
    }
    store.async_sync_financial(f_rent)

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

    if job_type == "Dispatch":
        target["worker_delivery"] = worker
        target["loc_delivery"] = location
        target["start_time"] = time_val
        if target.get("status") in ["รอส่งมอบ", "รอชำระมัดจำ"]:
            target["status"] = "เตรียมส่งมอบ"
    else:
        target["worker_return"] = worker
        target["loc_return"] = location
        target["end_time"] = time_val
        if target.get("status") == "กำลังเช่า":
            target["status"] = "เตรียมรับคืน"

    store.async_sync_booking(target)

    # Trigger LINE alert
    cust_obj = store.customers.get(target.get("customer"), {})
    b_with_cust = dict(target)
    b_with_cust["customer_phone"] = cust_obj.get("contact_no", "-")
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
            jobs.append({
                "job_type": "Dispatch",
                "job_type_label": "จัดส่งรถ (Dispatch)",
                "booking_id": b.get("booking_id"),
                "car_id": b.get("car_id"),
                "customer": b.get("customer"),
                "customer_phone": cust_phone,
                "schedule": f"{format_date_dmy(b.get('start_date'))} ({b.get('start_time', '10:00')})",
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
                "worker": b.get("worker_return") or "Wait",
                "location": b.get("loc_return") or b.get("loc_delivery") or "-",
                "status": ret_status,
                "is_locked": is_ret_locked,
                "deposit_paid": b.get("deposit_paid", False),
                "rental_paid": b.get("rental_paid", False),
                "net_price": b.get("net_price", 0)
            })

    jobs.sort(key=lambda x: (x["booking_id"], x["job_type"] == "Dispatch"), reverse=True)
    return jobs

@app.post("/api/bookings/{bk_id}/close-dispatch")
async def close_dispatch(bk_id: str, payload: Dict[str, Any]):
    target = next((b for b in store.bookings if b.get("booking_id") == bk_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="ไม่พบรายการจอง")

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
# EXECUTIVE DASHBOARD & REPORTS
# -------------------------------------------------------------------------
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
        "company_distribution": company_counts
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
    df = pd.DataFrame(rows)
    csv_bytes = df.to_csv(index=False).encode('utf-8-sig')
    return StreamingResponse(
        io.BytesIO(csv_bytes),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=completed_jobs_{month or 'all'}.csv"}
    )

# -------------------------------------------------------------------------
# PDF DOCUMENT STREAMING ENDPOINTS
# -------------------------------------------------------------------------
@app.get("/api/pdf/contract/{bk_id}")
async def get_contract_pdf(bk_id: str):
    target = next((b for b in store.bookings if b.get("booking_id") == bk_id), None)
    if not target:
        target = next((cj for cj in store.completed_jobs if cj.get("booking_id") == bk_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="ไม่พบข้อมูลการจอง")

    cust = store.customers.get(target.get("customer"), {})
    car = store.cars.get(target.get("car_id"), {})
    pdf_bytes = pdf_engine.generate_filled_pdf("rental_template_blank_v2.pdf", target, cust, car)

    target["contract_issued"] = True
    store.async_sync_booking(target)

    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f"inline; filename=Agreement_{bk_id}.pdf"}
    )

@app.get("/api/pdf/receipt/{bk_id}")
async def get_receipt_pdf(bk_id: str):
    target = next((b for b in store.bookings if b.get("booking_id") == bk_id), None)
    if not target:
        target = next((cj for cj in store.completed_jobs if cj.get("booking_id") == bk_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="ไม่พบข้อมูลการจอง")

    cust = store.customers.get(target.get("customer"), {})
    car = store.cars.get(target.get("car_id"), {})
    amt = float(target.get("net_price", 0.0))
    method = target.get("rental_payment_method") or target.get("final_payment_method", "เงินสด")

    pdf_bytes = pdf_engine.generate_receipt_bytes(f"REC{bk_id}", target, cust, car, amt, method, "ค่าเช่ารถยนต์ (Vehicle Rental Fee)")
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f"inline; filename=Receipt_{bk_id}.pdf"}
    )

@app.get("/api/pdf/deposit-receipt/{bk_id}")
async def get_deposit_receipt_pdf(bk_id: str):
    target = next((b for b in store.bookings if b.get("booking_id") == bk_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="ไม่พบข้อมูลการจอง")

    cust = store.customers.get(target.get("customer"), {})
    car = store.cars.get(target.get("car_id"), {})
    amt = float(target.get("deposit_amount", 5000.0))
    method = target.get("deposit_method", "เงินสด")

    pdf_bytes = pdf_engine.generate_receipt_bytes(f"DEP{bk_id}", target, cust, car, amt, method, "เงินมัดจำประกันสัญญา (Security Deposit)")
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

    cust = store.customers.get(target.get("customer"), {})
    car = store.cars.get(target.get("car_id"), {})
    pdf_bytes = pdf_engine.generate_job_pdf(target, cust, car, "Return", target.get("worker_return"), target.get("loc_return"), inspection_data=target)
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f"inline; filename=Inspection_Checklist_{bk_id}.pdf"}
    )

# -------------------------------------------------------------------------
# LINE MESSAGING
# -------------------------------------------------------------------------
@app.post("/api/line/broadcast")
async def trigger_line_broadcast(payload: Dict[str, Any]):
    msg = payload.get("message", "ทดสอบการส่งข้อความจากระบบ Sawasdee Rental")
    success = send_line_broadcast_message(msg)
    return {"success": success}

@app.post("/api/line/check-expiry")
async def trigger_expiry_alert_check():
    res = check_and_send_expiry_alerts(store.cars, target_days=(30, 31, 7, 0))
    return res

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8501))
    uvicorn.run("server:app", host="0.0.0.0", port=port, reload=False)

