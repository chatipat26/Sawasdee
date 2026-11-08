import os
import sys
import base64
import time
import threading
import re
import json
from datetime import datetime, date, time as d_time, timedelta

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

INTERNAL_DATABASE_URL = "postgresql://sawasdeedb:Sawasdee_Secure_2026_Db@svvconnectct-sawasdeedb-m78xfy:5432/sawasdee_db"
DATABASE_URL = os.environ.get("DATABASE_URL", INTERNAL_DATABASE_URL)

_db_client = None
def get_db_client():
    global _db_client
    if _db_client is not None:
        return _db_client
    db_url = os.environ.get("DATABASE_URL", INTERNAL_DATABASE_URL)
    try:
        from pg_client import PgClient
        _db_client = PgClient(db_url)
        return _db_client
    except Exception as e:
        print(f"PostgreSQL client init error: {e}")
        return None

# -------------------------------------------------------------------------
# DATE & TIME HELPERS
# -------------------------------------------------------------------------
def to_date(d):
    if not d:
        return None
    if isinstance(d, datetime):
        return d.date()
    if isinstance(d, date):
        return d
    try:
        s = str(d).strip().split("T")[0]
        if "-" in s:
            parts = s.split("-")
            return date(int(parts[0]), int(parts[1]), int(parts[2]))
        if "/" in s:
            parts = s.split("/")
            return date(int(parts[2]), int(parts[1]), int(parts[0]))
    except Exception:
        pass
    return None

def format_date_dmy(date_val):
    if not date_val:
        return "-"
    d = to_date(date_val)
    if d:
        return d.strftime("%d/%m/%Y")
    return str(date_val)

def parse_time_val(t_val, default_time=d_time(10, 0)):
    if isinstance(t_val, d_time):
        return t_val
    if isinstance(t_val, str) and ":" in t_val:
        try:
            parts = t_val.strip().split(":")
            return d_time(int(parts[0]), int(parts[1]))
        except Exception:
            pass
    return default_time

def calculate_rental_duration_and_days(start_date, start_time, end_date, end_time):
    """
    คำนวณระยะเวลาเช่ารถ (วันและชั่วโมง)
    เงื่อนไข: หากเวลารับรถคืนเกินเวลานัดส่งรถเกิน 4 ชม. จะปรับคิดเพิ่มเป็น 1 วันเต็ม
    """
    if not start_date or not end_date:
        return 1, 0, 0, False, "1 วัน"
        
    s_d = to_date(start_date)
    e_d = to_date(end_date)
    s_t = parse_time_val(start_time, d_time(10, 0))
    e_t = parse_time_val(end_time, d_time(10, 0))
    
    start_dt = datetime.combine(s_d, s_t)
    end_dt = datetime.combine(e_d, e_t)
    
    if end_dt <= start_dt:
        return 1, 0, 0, False, "1 วัน (ขั้นต่ำ)"
        
    diff = end_dt - start_dt
    total_seconds = int(diff.total_seconds())
    total_hours = total_seconds // 3600
    rem_minutes = (total_seconds % 3600) // 60
    
    base_days = total_hours // 24
    extra_hours = total_hours % 24
    
    is_over_4hr = False
    if extra_hours > 4 or (extra_hours == 4 and rem_minutes > 0):
        billable_days = base_days + 1
        is_over_4hr = True
        explanation = f"{base_days} วัน + ล่าช้าเกินเวลา {extra_hours} ชม. {rem_minutes} นาที (เกิน 4 ชม. ปรับคิดเพิ่มเป็น 1 วันเต็ม ➔ รวม {billable_days} วัน)"
    else:
        billable_days = max(1, base_days)
        if extra_hours > 0 or rem_minutes > 0:
            explanation = f"{base_days} วัน + เกินเวลา {extra_hours} ชม. {rem_minutes} นาที (อนุโลมไม่เกิน 4 ชม. ไม่คิดวันเพิ่ม ➔ คิด {billable_days} วัน)"
        else:
            explanation = f"ตรงเวลาพอดี {billable_days} วัน ({billable_days * 24} ชั่วโมง)"
            
    return billable_days, extra_hours, rem_minutes, is_over_4hr, explanation

def normalize_plate_str(plate):
    if not plate:
        return ""
    return re.sub(r"[\s\-_]", "", str(plate)).strip().lower()

def get_car_fleet_status(car_plate, car_obj, bookings, filter_start_date=None, filter_end_date=None):
    c_status = str((car_obj or {}).get("status") or "").strip()
    if c_status in ["สถานะซ่อมบำรุง", "ซ่อมบำรุง", "ไม่พร้อมใช้งาน", "ระงับการใช้งาน"]:
        return "maintenance", "สถานะซ่อมบำรุง", "#F97316", "#FFF7ED", "#FDBA74"
    if c_status in ["ต่อทะเบียน/ประกัน", "ต่อภาษี/ประกัน", "รอต่อทะเบียน"]:
        return "renewal", "กำลังต่อภาษี/ประกัน", "#D97706", "#FEF3C7", "#FCD34D"
        
    chk_s = to_date(filter_start_date)
    chk_e = to_date(filter_end_date)
    has_date_filter = bool(chk_s or chk_e)
    if chk_s and not chk_e: chk_e = chk_s
    elif chk_e and not chk_s: chk_s = chk_e
    if chk_s and chk_e and chk_e < chk_s: chk_e = chk_s
    
    norm_car_plate = normalize_plate_str(car_plate)
    active_bks = []
    if bookings:
        for b in bookings:
            if normalize_plate_str(b.get("car_id")) != norm_car_plate: continue
            b_st = str(b.get("status") or "").strip()
            if b_st in ["เสร็จสิ้น", "ยกเลิก", "Completed", "Canceled", "completed", "canceled"]: continue
            active_bks.append(b)
            
    is_booked_on_selected_date = False
    booked_b = None
    if chk_s and chk_e:
        for b in active_bks:
            b_s = to_date(b.get("start_date"))
            b_e = to_date(b.get("end_date"))
            if b_s and b_e:
                # Time Overlap formula: (Search_StartDate < Booking_EndDate) AND (Search_EndDate > Booking_StartDate)
                if b_s == b_e or chk_s == chk_e:
                    overlaps = (chk_s <= b_e) and (chk_e >= b_s)
                else:
                    overlaps = (chk_s < b_e) and (chk_e > b_s)
                if overlaps:
                    is_booked_on_selected_date = True
                    booked_b = b
                    break
                    
    is_currently_rented = False
    today_d = date.today()
    if has_date_filter:
        if c_status in ["กำลังเช่า", "รอรับคืน"]:
            if chk_s <= today_d <= chk_e:
                is_currently_rented = True
    else:
        if c_status in ["กำลังเช่า", "รอรับคืน"]:
            is_currently_rented = True
        else:
            for b in active_bks:
                if b.get("status") in ["กำลังเช่า", "รอรับคืน"]:
                    b_s = to_date(b.get("start_date"))
                    b_e = to_date(b.get("end_date"))
                    if b_s and b_e and (b_s <= today_d <= b_e):
                        is_currently_rented = True
                        booked_b = b
                        break
                    
    if is_booked_on_selected_date or is_currently_rented:
        info_txt = "ไม่ว่างในวันที่เลือก"
        if booked_b:
            info_txt = f"ไม่ว่างในวันที่เลือก ({booked_b.get('customer')}) {format_date_dmy(booked_b.get('start_date'))} - {format_date_dmy(booked_b.get('end_date'))}"
        return "unavailable", info_txt, "#EF4444", "#FEF2F2", "#FCA5A5"

    # Check for advance bookings in the future
    has_advance_booking = False
    adv_b = None
    if c_status == "ติดจอง":
        has_advance_booking = True
    elif active_bks:
        for b in active_bks:
            b_s = to_date(b.get("start_date"))
            b_e = to_date(b.get("end_date"))
            if (b_e and b_e >= today_d) or (b_s and b_s >= today_d):
                has_advance_booking = True
                adv_b = b
                break
                
    if has_advance_booking:
        info_txt = "มีการจองล่วงหน้าไว้"
        if adv_b:
            info_txt = f"มีการจองล่วงหน้าไว้ ({adv_b.get('customer')}) {format_date_dmy(adv_b.get('start_date'))} - {format_date_dmy(adv_b.get('end_date'))}"
        return "reserved", info_txt, "#F59E0B", "#FFFBEB", "#FDE68A"
        
    return "available", "ว่างพร้อมใช้งาน", "#10B981", "#ECFDF5", "#A7F3D0"

# -------------------------------------------------------------------------
# INITIAL CARS, CUSTOMERS, BOOKINGS, USERS
# -------------------------------------------------------------------------
DEFAULT_CARS = {}

# Clean Slate: ลบ Mock Data ของกรมธรรม์ประกันภัยทรัพย์สิน และ ตารางผ่อนชำระค่างวดรถยนต์ (HP / Leasing)
DEFAULT_PROPERTY_INSURANCE = []

DEFAULT_HP_LEASING = []

DEFAULT_HP_SUMMARY = {
    "total_contracts": 0,
    "total_down_payment": 0.0,
    "total_monthly_installment": 0.0,
    "total_paid_2023_2024": 0.0,
    "total_paid_2025": 0.0,
    "total_paid_amount": 0.0,
    "total_remaining_amount": 0.0,
    "total_financed": 0.0,
    "total_car_price": 0.0
}

def deduplicate_cars_dict(cars_dict, deleted_plates=None):
    """Deduplicate cars by normalized license plate and chassis_no, merging metadata."""
    deleted_plates = deleted_plates or set()
    deleted_norms = {re.sub(r"[\s\-\.]+", "", str(dp)).lower() for dp in deleted_plates}
    result = {}
    norm_to_key = {}
    chassis_to_key = {}

    for raw_key, car in (cars_dict or {}).items():
        if not isinstance(car, dict):
            continue
        pl = str(car.get("plate") or raw_key).strip()
        if not pl:
            continue
        norm_pl = re.sub(r"[\s\-\.]+", "", pl).lower()
        if pl in deleted_plates or norm_pl in deleted_norms:
            continue

        chassis = str(car.get("chassis_no") or "").strip().upper()
        has_valid_chassis = bool(chassis and chassis != "-" and len(chassis) >= 8)

        existing_key = None
        if norm_pl in norm_to_key:
            existing_key = norm_to_key[norm_pl]
        elif has_valid_chassis and chassis in chassis_to_key:
            existing_key = chassis_to_key[chassis]

        if existing_key and existing_key in result:
            # Merge non-empty values into existing canonical record
            target = result[existing_key]
            for fk, fv in car.items():
                if fv is not None and str(fv).strip() not in ["", "-"]:
                    if fk not in target or str(target.get(fk, "")).strip() in ["", "-"]:
                        target[fk] = fv
                    elif fk in ["status", "mileage", "act_expiry", "ins_expiry", "tax_expiry", "price_day", "price_week", "price_month"]:
                        target[fk] = fv
        else:
            c_copy = dict(car)
            c_copy["plate"] = pl
            result[pl] = c_copy
            norm_to_key[norm_pl] = pl
            if has_valid_chassis:
                chassis_to_key[chassis] = pl

    return result

DEFAULT_MAINTENANCE_RECORDS = []

DEFAULT_USERS = {
    "admin": {
        "username": "admin",
        "name": "ผู้ดูแลระบบ (Admin)",
        "role": "Admin",
        "status": "approved",
        "password": "admin",
        "line_user_id": os.environ.get("LINE_TARGET_USER_ID", "Ub7b6353ba826c0ba5c3d9fac3531ef77")
    }
}

class DataStore:
    def __init__(self):
        self.cars = dict(DEFAULT_CARS)
        self.customers = {
            "ลูกค้าทั่วไป (Walk-in)": {
                "full_name": "ลูกค้าทั่วไป (Walk-in)",
                "nationality": "THAI",
                "dob": "01/01/1990",
                "passport_id": "-",
                "licence_no": "-",
                "issue_place": "-",
                "licence_expiry": "01/01/2030",
                "home_address": "-",
                "thai_address": "-",
                "contact_no": "-",
                "whatsapp": "-",
                "email": "-"
            }
        }
        self.bookings = []
        self.completed_jobs = []
        self.financial_records = []
        self.users = {k: dict(v) for k, v in DEFAULT_USERS.items()}
        self.cars_file = os.path.join(BASE_DIR, "data_cars.json")
        self.users_file = os.path.join(BASE_DIR, "data_users.json")
        self.maintenance_file = os.path.join(BASE_DIR, "data_maintenance.json")
        self.maintenance_records = []
        self.vehicle_maintenances_file = os.path.join(BASE_DIR, "data_vehicle_maintenances.json")
        self.vehicle_maintenances = []
        self.deleted_booking_ids = {
            "MRC261017104446", "MRC261017071034", "MRC261017102938", "MRC261017101804",
            "MRC261017104728", "MRC261017105734", "MRC261014110200", "MRC261014174658",
            "MRC261012110000", "MRC261010145909", "MRC261008093000"
        }
        self.deleted_car_plates = {
            "อบ 0000", "อบ0000"
        }
        self.last_sync_time = time.time()
        self.is_syncing = False
        self.initial_sync_done = False
        self.lock = threading.RLock()
        self.load_local_cars()
        self.load_local_users()
        self.load_local_maintenance()
        self.load_local_vehicle_maintenances()
        self.work_order_logs_file = os.path.join(BASE_DIR, "data_work_order_logs.json")
        self.work_order_logs = []
        self.load_local_work_order_logs()

        self.maintenance_logs_file = os.path.join(BASE_DIR, "data_maintenance_logs.json")
        self.maintenance_logs = []
        self.load_local_maintenance_logs()

    def load_local_users(self):
        merged = {k: dict(v) for k, v in DEFAULT_USERS.items()}
        try:
            if os.path.exists(self.users_file):
                with open(self.users_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if isinstance(data, dict):
                        for k, v in data.items():
                            if not isinstance(v, dict):
                                continue
                            if k in merged:
                                merged[k].update(v)
                            else:
                                merged[k] = dict(v)
        except Exception as e:
            print(f"Error loading local users: {e}")
        with self.lock:
            self.users = merged
        self.save_local_users()

    def save_local_users(self):
        try:
            with self.lock:
                payload = dict(self.users)
            with open(self.users_file, "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"Error saving local users: {e}")

    def load_local_cars(self):
        merged = {k: dict(v) for k, v in DEFAULT_CARS.items()}
        try:
            if os.path.exists(self.cars_file):
                with open(self.cars_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if isinstance(data, dict):
                        deleted_saved = data.get("_deleted_car_plates")
                        if isinstance(deleted_saved, list):
                            self.deleted_car_plates.update(deleted_saved)
                        cars_saved = data.get("cars") if "cars" in data and isinstance(data["cars"], dict) else data
                        for k, v in cars_saved.items():
                            if k == "_deleted_car_plates" or not isinstance(v, dict):
                                continue
                            if k in merged:
                                merged[k].update(v)
                            else:
                                merged[k] = dict(v)
        except Exception as e:
            print(f"Error loading local cars: {e}")
        with self.lock:
            self.cars = deduplicate_cars_dict(merged, self.deleted_car_plates)
        self.save_local_cars()

    def save_local_cars(self):
        try:
            with self.lock:
                payload = {
                    "_deleted_car_plates": sorted(list(self.deleted_car_plates)),
                    "cars": self.cars
                }
            with open(self.cars_file, "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"Error saving local cars: {e}")

    def sync_from_database(self, force=False):
        """Synchronous full sync from PostgreSQL"""
        self._sync_task(force=force)

    def sync_from_database_async(self, force=False):
        """Non-blocking background thread sync"""
        t = threading.Thread(target=self._sync_task, args=(force,), daemon=True)
        t.start()

    def _sync_task(self, force=False):
        if self.is_syncing and not force:
            return
        self.is_syncing = True
        try:
            sb = get_db_client()
            if not sb:
                return

            # 1. Users (from 'users' table)
            try:
                u_res = sb.table("users").select("*").execute()
                fresh_users = {}
                if u_res.data:
                    for u in u_res.data:
                        un = u.get("username")
                        if un:
                            u_copy = dict(u)
                            if not u_copy.get("status"):
                                u_copy["status"] = "approved"
                            if not u_copy.get("role"):
                                u_copy["role"] = "Admin" if un.lower() == "admin" else "Staff"
                            fresh_users[un] = u_copy


                if fresh_users:
                    with self.lock:
                        merged_u = {k: dict(v) for k, v in self.users.items()}
                        for un, u_data in fresh_users.items():
                            if un in merged_u:
                                existing_line_id = merged_u[un].get("line_user_id")
                                merged_u[un].update({fk: fv for fk, fv in u_data.items() if fv is not None})
                                if existing_line_id and not merged_u[un].get("line_user_id"):
                                    merged_u[un]["line_user_id"] = existing_line_id
                            else:
                                merged_u[un] = dict(u_data)
                        if "admin" in merged_u and not merged_u["admin"].get("line_user_id"):
                            merged_u["admin"]["line_user_id"] = os.environ.get("LINE_TARGET_USER_ID", "Ub7b6353ba826c0ba5c3d9fac3531ef77")
                        self.users = merged_u
                    self.save_local_users()
            except Exception as e:
                print(f"Users sync error: {e}")

            # 2. Bookings
            fresh_b = []
            try:
                b_res = sb.table("bookings").select("*").order("created_at", desc=True).execute()
                if b_res.data is not None:
                    for b in b_res.data:
                        bid = b.get("booking_id")
                        if bid in self.deleted_booking_ids:
                            try:
                                sb.table("bookings").delete().eq("booking_id", bid).execute()
                            except Exception:
                                pass
                            continue
                        b_copy = dict(b)
                        b_copy["deposit_amount"] = 5000.0 # STRICT: Fixed 5,000 THB
                        if b_copy.get("start_date"): b_copy["start_date"] = to_date(b_copy["start_date"])
                        if b_copy.get("end_date"): b_copy["end_date"] = to_date(b_copy["end_date"])
                        # Reconstruct payment slip and ref metadata from extension_history if stored
                        for item in b_copy.get("extension_history", []) or []:
                            if isinstance(item, dict) and item.get("type") == "payment_meta":
                                if item.get("deposit_ref") and not b_copy.get("deposit_ref"):
                                    b_copy["deposit_ref"] = item["deposit_ref"]
                                if item.get("deposit_slip") and not b_copy.get("deposit_slip"):
                                    b_copy["deposit_slip"] = item["deposit_slip"]
                                if item.get("rental_ref") and not b_copy.get("rental_ref"):
                                    b_copy["rental_ref"] = item["rental_ref"]
                                if item.get("rental_slip") and not b_copy.get("rental_slip"):
                                    b_copy["rental_slip"] = item["rental_slip"]
                                if item.get("deposit_method") and not b_copy.get("deposit_method"):
                                    b_copy["deposit_method"] = item["deposit_method"]
                                if item.get("deposit_date") and not b_copy.get("deposit_date"):
                                    b_copy["deposit_date"] = item["deposit_date"]
                                if item.get("payment_type") and not b_copy.get("payment_type"):
                                    b_copy["payment_type"] = item["payment_type"]
                                if item.get("google_drive_link") and not b_copy.get("google_drive_link"):
                                    b_copy["google_drive_link"] = item["google_drive_link"]
                                if item.get("contract_issued") and not b_copy.get("contract_issued"):
                                    b_copy["contract_issued"] = True
                            if isinstance(item, dict) and item.get("type") == "swap_meta":
                                if item.get("pending_damage_cost") is not None:
                                    b_copy["pending_damage_cost"] = float(item["pending_damage_cost"])
                                if item.get("swap_history"):
                                    b_copy["swap_history"] = item["swap_history"]
                        fresh_b.append(b_copy)
                    with self.lock:
                        self.bookings = fresh_b
            except Exception as e:
                print(f"Bookings sync error: {e}")

            # 3. Cars (and auto-release cars whose bookings were deleted from the database)
            try:
                c_res = sb.table("cars").select("*").execute()
                if c_res.data is not None:
                    active_booked_plates = {
                        b.get("car_id") for b in fresh_b
                        if b.get("car_id") and b.get("status") not in ["เสร็จสิ้น", "ยกเลิก"]
                    }
                    fresh_cars = {}
                    for c in c_res.data:
                        pl = c.get("plate")
                        if pl:
                            clean_pl = str(pl).strip()
                            clean_norm = re.sub(r"[\s\-\.]+", "", clean_pl).lower()
                            is_deleted = any(
                                (dp == clean_pl or re.sub(r"[\s\-\.]+", "", str(dp)).lower() == clean_norm)
                                for dp in self.deleted_car_plates
                            )
                            if is_deleted:
                                try:
                                    sb.table("cars").delete().eq("plate", pl).execute()
                                except Exception:
                                    pass
                                continue
                            if c.get("status") in ["ติดจอง", "รอส่งมอบ", "เตรียมส่งมอบ", "กำลังเช่า", "เตรียมรับคืน"] and pl not in active_booked_plates:
                                c["status"] = "ว่างพร้อมใช้งาน"
                                try:
                                    sb.table("cars").update({"status": "ว่างพร้อมใช้งาน"}).eq("plate", pl).execute()
                                except Exception:
                                    pass
                            elif c.get("status") == "กำลังเช่า":
                                has_real_on_rent = any(
                                    (b.get("car_id") == pl or re.sub(r"[\s\-_]", "", str(b.get("car_id", ""))).strip().lower() == clean_norm)
                                    and b.get("status") in ("กำลังเช่า", "รอรับคืน")
                                    for b in fresh_b
                                )
                                if not has_real_on_rent:
                                    c["status"] = "ติดจอง"
                                    try:
                                        sb.table("cars").update({"status": "ติดจอง"}).eq("plate", pl).execute()
                                    except Exception:
                                        pass
                            merged_c = dict(self.cars.get(pl, {}))
                            for k, v in c.items():
                                if v is not None and v != "":
                                    merged_c[k] = v
                                elif k not in merged_c:
                                    merged_c[k] = v
                            # Synchronize aliases bidirectionally (robust against placeholder '-')
                            def _pair(d, k1, k2):
                                v1, v2 = d.get(k1), d.get(k2)
                                h1 = v1 is not None and v1 != "" and v1 != "-"
                                h2 = v2 is not None and v2 != "" and v2 != "-"
                                if h1 and not h2: d[k2] = v1
                                elif h2 and not h1: d[k1] = v2
                                elif k1 not in d and k2 in d: d[k1] = v2
                                elif k2 not in d and k1 in d: d[k2] = v1

                            _pair(merged_c, 'fuel_system', 'fuel_type')
                            _pair(merged_c, 'cc_ev', 'engine_cc')
                            _pair(merged_c, 'owner_company', 'company')
                            _pair(merged_c, 'daily_rate', 'price_day')
                            _pair(merged_c, 'weekly_rate', 'price_week')
                            _pair(merged_c, 'monthly_rate', 'price_month')
                            _pair(merged_c, 'vin', 'chassis_no')
                            _pair(merged_c, 'tax_expire_date', 'tax_expiry')
                            _pair(merged_c, 'prb_expire_date', 'act_expiry')
                            _pair(merged_c, 'insurance_expire_date', 'ins_expiry')
                            _pair(merged_c, 'insurance_company', 'ins_company')
                            _pair(merged_c, 'car_owner', 'owner')
                            _pair(merged_c, 'register_year', 'reg_year')
                            _pair(merged_c, 'car_status', 'status')
                            _pair(merged_c, 'image_url', 'image')
                            _pair(merged_c, 'prb_price', 'act_price')
                            _pair(merged_c, 'insurance_premium', 'ins_premium')
                            _pair(merged_c, 'next_service_mileage', 'next_engine_oil_mileage')
                            _pair(merged_c, 'next_service_date', 'next_engine_oil_date')
                            if 'next_service_date' in merged_c and 'next_service' not in merged_c:
                                merged_c['next_service'] = merged_c['next_service_date']
                            fresh_cars[pl] = merged_c
                    if fresh_cars is not None:
                        with self.lock:
                            self.cars = fresh_cars
                        self.save_local_cars()
            except Exception as e:
                print(f"Cars sync error: {e}")

            # 4. Customers
            try:
                cust_res = sb.table("customers").select("*").execute()
                if cust_res.data is not None:
                    fresh_cust = {
                        "ลูกค้าทั่วไป (Walk-in)": {
                            "full_name": "ลูกค้าทั่วไป (Walk-in)",
                            "nationality": "THAI",
                            "dob": "01/01/1990",
                            "passport_id": "-",
                            "licence_no": "-",
                            "issue_place": "-",
                            "licence_expiry": "01/01/2030",
                            "home_address": "-",
                            "thai_address": "-",
                            "contact_no": "-",
                            "whatsapp": "-",
                            "email": "-"
                        }
                    }
                    for c in cust_res.data:
                        fn = c.get("full_name")
                        if fn:
                            cust_obj = dict(self.customers.get(fn, {}))
                            for k, v in c.items():
                                if v is not None and v != "":
                                    cust_obj[k] = v
                                elif k not in cust_obj:
                                    cust_obj[k] = v
                            phone_val = cust_obj.get("phone_number") or cust_obj.get("contact_no") or cust_obj.get("phone") or "-"
                            id_val = cust_obj.get("id_card_no") or cust_obj.get("passport_id") or cust_obj.get("id_card") or "-"
                            lic_val = cust_obj.get("driver_license_no") or cust_obj.get("licence_no") or cust_obj.get("driver_license") or "-"
                            lic_exp = cust_obj.get("license_expire_date") or cust_obj.get("licence_expiry") or "-"
                            home_val = cust_obj.get("home_address") or cust_obj.get("address") or "-"
                            curr_val = cust_obj.get("current_address") or cust_obj.get("thai_address") or "-"

                            cust_obj["phone_number"] = phone_val
                            cust_obj["contact_no"] = phone_val
                            cust_obj["phone"] = phone_val
                            cust_obj["id_card_no"] = id_val
                            cust_obj["passport_id"] = id_val
                            cust_obj["id_card"] = id_val
                            cust_obj["driver_license_no"] = lic_val
                            cust_obj["licence_no"] = lic_val
                            cust_obj["driver_license"] = lic_val
                            cust_obj["license_expire_date"] = lic_exp
                            cust_obj["licence_expiry"] = lic_exp
                            cust_obj["home_address"] = home_val
                            cust_obj["address"] = home_val
                            cust_obj["current_address"] = curr_val
                            cust_obj["thai_address"] = curr_val
                            fresh_cust[fn] = cust_obj
                    with self.lock:
                        self.customers = fresh_cust
            except Exception as e:
                print(f"Customers sync error: {e}")

            # 5. Completed Jobs
            try:
                cj_res = sb.table("completed_jobs").select("*").order("created_at", desc=True).execute()
                if cj_res.data is not None:
                    fresh_cj = []
                    for cj in cj_res.data:
                        c_copy = dict(cj)
                        if c_copy.get("start_date"): c_copy["start_date"] = to_date(c_copy["start_date"])
                        if c_copy.get("end_date"): c_copy["end_date"] = to_date(c_copy["end_date"])
                        if c_copy.get("completed_date"): c_copy["completed_date"] = to_date(c_copy["completed_date"])
                        fresh_cj.append(c_copy)
                    with self.lock:
                        self.completed_jobs = fresh_cj
            except Exception as e:
                print(f"Completed jobs sync error: {e}")

            # 6. Financial Records
            try:
                f_res = sb.table("financial_records").select("*").order("date", desc=True).execute()
                if f_res.data is not None:
                    with self.lock:
                        self.financial_records = f_res.data
            except Exception as e:
                print(f"Financial records sync error: {e}")

            # 7. Maintenance Records (if PostgreSQL table exists)
            try:
                m_res = sb.table("maintenance_records").select("*").order("schedule_date", desc=True).execute()
                if m_res.data is not None:
                    with self.lock:
                        self.maintenance_records = m_res.data
                    self.save_local_maintenance()
            except Exception:
                pass

            # 8. Vehicle Maintenances
            try:
                vm_res = sb.table("vehicle_maintenances").select("*").order("date", desc=True).execute()
                if vm_res.data is not None:
                    with self.lock:
                        self.vehicle_maintenances = vm_res.data
                    self.save_local_vehicle_maintenances()
            except Exception:
                pass

            self.last_sync_time = time.time()
            self.initial_sync_done = True
        except Exception as e:
            print(f"Sync task exception: {e}")
            # 9. Work Order Logs
            try:
                wol_res = sb.table("work_order_logs").select("*").order("created_at", desc=True).limit(500).execute()
                if wol_res.data is not None:
                    with self.lock:
                        self.work_order_logs = wol_res.data
                    self.save_local_work_order_logs()
            except Exception:
                pass

            # 10. Maintenance Logs
            try:
                ml_res = sb.table("maintenance_logs").select("*").order("created_at", desc=True).limit(1000).execute()
                if ml_res.data is not None:
                    with self.lock:
                        self.maintenance_logs = ml_res.data
                    self.save_local_maintenance_logs()
            except Exception:
                pass

        finally:
            self.is_syncing = False

    def async_sync_booking(self, b_obj):
        def _task():
            sb = get_db_client()
            if not sb or not b_obj: return
            try:
                row = dict(b_obj)
                if "start_date" in row and row["start_date"]: row["start_date"] = str(row["start_date"])
                if "end_date" in row and row["end_date"]: row["end_date"] = str(row["end_date"])

                # Persist payment metadata inside extension_history JSONB column
                ext_list = list(row.get("extension_history") or [])
                meta_item = {
                    "type": "payment_meta",
                    "deposit_ref": row.get("deposit_ref", ""),
                    "deposit_slip": row.get("deposit_slip", ""),
                    "rental_ref": row.get("rental_ref", ""),
                    "rental_slip": row.get("rental_slip", ""),
                    "deposit_method": row.get("deposit_method", ""),
                    "deposit_date": row.get("deposit_date", ""),
                    "payment_type": row.get("payment_type", ""),
                    "google_drive_link": row.get("google_drive_link", ""),
                    "contract_issued": bool(row.get("contract_issued", False))
                }
                ext_list = [x for x in ext_list if not (isinstance(x, dict) and x.get("type") == "payment_meta")]
                ext_list.append(meta_item)

                swap_meta_item = {
                    "type": "swap_meta",
                    "pending_damage_cost": float(row.get("pending_damage_cost") or 0.0),
                    "swap_history": list(row.get("swap_history") or [])
                }
                ext_list = [x for x in ext_list if not (isinstance(x, dict) and x.get("type") == "swap_meta")]
                if swap_meta_item["pending_damage_cost"] > 0 or swap_meta_item["swap_history"]:
                    ext_list.append(swap_meta_item)

                row["extension_history"] = ext_list

                VALID_COLS = {
                    'booking_id', 'car_id', 'customer', 'start_date', 'end_date',
                    'start_time', 'end_time', 'contract_type', 'base_price', 'discount',
                    'net_price', 'deposit_paid', 'deposit_amount', 'rental_paid',
                    'remaining_rental', 'created_by', 'status', 'dispatch_closed',
                    'return_closed', 'worker_delivery', 'worker_return', 'loc_delivery',
                    'loc_return', 'extension_history', 'is_fully_paid', 'rental_payment_method',
                    'payment_type', 'google_drive_link'
                }
                filtered_row = {k: v for k, v in row.items() if k in VALID_COLS}
                db_cols = None
                if hasattr(sb, "run"):
                    from psycopg import sql as _sql
                    col_rows = sb.run([(_sql.SQL(
                        "SELECT column_name FROM information_schema.columns "
                        "WHERE table_schema = 'public' AND table_name = 'bookings'"), [])])
                    db_cols = {r["column_name"] for r in col_rows} or None
                if db_cols:
                    filtered_row = {k: v for k, v in filtered_row.items() if k in db_cols}
                sb.table("bookings").upsert(filtered_row).execute()
            except Exception as e:
                print(f"sb_sync_booking error: {e}")
        threading.Thread(target=_task, daemon=True).start()

    def async_delete_booking(self, bk_id):
        self.deleted_booking_ids.add(bk_id)
        with self.lock:
            self.bookings = [b for b in self.bookings if b.get("booking_id") != bk_id]
        def _task():
            sb = get_db_client()
            if not sb: return
            try:
                sb.table("bookings").delete().eq("booking_id", bk_id).execute()
            except Exception as e:
                print(f"sb_delete_booking error: {e}")
        threading.Thread(target=_task, daemon=True).start()

    def async_sync_car(self, plate, car_dict):
        STANDARD_34_COLS = {
            'plate', 'brand', 'model', 'car_group', 'fuel_system', 'cc_ev',
            'owner_company', 'color', 'mileage', 'daily_rate', 'weekly_rate', 'monthly_rate',
            'vin', 'tax_expire_date', 'prb_expire_date', 'insurance_expire_date', 'insurance_company',
            'car_owner', 'beneficiary', 'register_year',
            'prb_price', 'insurance_premium',
            'last_service_date', 'next_service_date', 'next_service_mileage',
            'car_status', 'is_debt_free', 'installment_amount', 'total_installments', 'current_installment',
            'payment_due_date', 'finance_company', 'notes', 'image_url'
        }
        CAR_DB_COLS = STANDARD_34_COLS | {
            'engine_cc', 'fuel_type', 'company', 'price_day', 'price_week', 'price_month',
            'status', 'chassis_no', 'act_expiry', 'ins_expiry', 'image', 'created_at',
            'owner', 'reg_year', 'tax_expiry', 'ins_company', 'act_price', 'ins_premium',
            'insurance_policy_no', 'policy_no'
        }
        ALL_CAR_COLS = CAR_DB_COLS | {
            'next_service', 'tire_change', 'hp_contract_no', 'hp_installment',
            'next_engine_oil_date', 'next_engine_oil_mileage',
            'next_tire_change_date', 'next_tire_change_mileage'
        }
        with self.lock:
            existing = dict(self.cars.get(plate, {}))
            existing.update(car_dict)
            existing["plate"] = plate

            # Bidirectional alias synchronization (robust against placeholder '-')
            def _pair_sync(d, k1, k2):
                v1, v2 = d.get(k1), d.get(k2)
                h1 = v1 is not None and v1 != "" and v1 != "-"
                h2 = v2 is not None and v2 != "" and v2 != "-"
                if h1 and not h2: d[k2] = v1
                elif h2 and not h1: d[k1] = v2
                elif k1 not in d and k2 in d: d[k1] = v2
                elif k2 not in d and k1 in d: d[k2] = v1

            _pair_sync(existing, 'fuel_system', 'fuel_type')
            _pair_sync(existing, 'cc_ev', 'engine_cc')
            _pair_sync(existing, 'owner_company', 'company')
            _pair_sync(existing, 'daily_rate', 'price_day')
            _pair_sync(existing, 'weekly_rate', 'price_week')
            _pair_sync(existing, 'monthly_rate', 'price_month')
            _pair_sync(existing, 'vin', 'chassis_no')
            _pair_sync(existing, 'tax_expire_date', 'tax_expiry')
            _pair_sync(existing, 'prb_expire_date', 'act_expiry')
            _pair_sync(existing, 'insurance_expire_date', 'ins_expiry')
            _pair_sync(existing, 'insurance_company', 'ins_company')
            _pair_sync(existing, 'insurance_policy_no', 'policy_no')
            _pair_sync(existing, 'car_owner', 'owner')
            _pair_sync(existing, 'register_year', 'reg_year')
            _pair_sync(existing, 'car_status', 'status')
            _pair_sync(existing, 'image_url', 'image')
            _pair_sync(existing, 'prb_price', 'act_price')
            _pair_sync(existing, 'insurance_premium', 'ins_premium')
            _pair_sync(existing, 'next_service_mileage', 'next_engine_oil_mileage')
            _pair_sync(existing, 'next_service_date', 'next_engine_oil_date')
            if 'next_service_date' in existing and 'next_service' not in existing:
                existing['next_service'] = existing['next_service_date']

            clean_mem = {k: v for k, v in existing.items() if k in ALL_CAR_COLS}
            self.cars[plate] = clean_mem
            sb_payload = {k: v for k, v in clean_mem.items() if k in CAR_DB_COLS}
        self.save_local_cars()
        def _task():
            sb = get_db_client()
            if not sb: return
            try:
                db_cols = None
                if hasattr(sb, "run"):
                    from psycopg import sql as _sql
                    rows = sb.run([(_sql.SQL(
                        "SELECT column_name FROM information_schema.columns "
                        "WHERE table_schema = 'public' AND table_name = 'cars'"), [])])
                    db_cols = {r["column_name"] for r in rows} or None
                payload_to_save = {k: v for k, v in sb_payload.items() if db_cols is None or k in db_cols}
                sb.table("cars").upsert(payload_to_save).execute()
            except Exception as e:
                print(f"sb_sync_car error: {e}")
                try:
                    fallback_payload = {k: v for k, v in sb_payload.items() if k in STANDARD_34_COLS}
                    sb.table("cars").upsert(fallback_payload).execute()
                except Exception as e2:
                    print(f"sb_sync_car fallback error: {e2}")
        threading.Thread(target=_task, daemon=True).start()

    def async_delete_car(self, plate):
        clean_plate = str(plate).strip()
        norm = re.sub(r"[\s\-\.]+", "", clean_plate).lower()
        with self.lock:
            to_remove = [k for k in self.cars if k == clean_plate or re.sub(r"[\s\-\.]+", "", str(k)).lower() == norm]
            for k in to_remove:
                self.cars.pop(k, None)
                self.deleted_car_plates.add(k)
            self.deleted_car_plates.add(clean_plate)
        self.save_local_cars()
        def _task():
            sb = get_db_client()
            if not sb: return
            try:
                sb.table("cars").delete().eq("plate", clean_plate).execute()
                for k in to_remove:
                    if k != clean_plate:
                        sb.table("cars").delete().eq("plate", k).execute()
            except Exception as e:
                print(f"sb_delete_car error: {e}")
        threading.Thread(target=_task, daemon=True).start()

    def async_sync_customer(self, name, cust_dict):
        def _pick(*keys):
            for k in keys:
                v = cust_dict.get(k)
                if v is not None and str(v).strip() not in ("", "-"):
                    return v
            return "-"
        phone_val = _pick("phone_number", "contact_no", "phone")
        id_val = _pick("id_card_no", "passport_id", "id_card")
        lic_val = _pick("driver_license_no", "licence_no", "driver_license")
        lic_exp = _pick("license_expire_date", "licence_expiry")
        home_val = _pick("home_address", "address")
        curr_val = _pick("current_address", "thai_address")

        cust_dict["full_name"] = name
        cust_dict["phone_number"] = phone_val
        cust_dict["contact_no"] = phone_val
        cust_dict["phone"] = phone_val
        cust_dict["id_card_no"] = id_val
        cust_dict["passport_id"] = id_val
        cust_dict["id_card"] = id_val
        cust_dict["driver_license_no"] = lic_val
        cust_dict["licence_no"] = lic_val
        cust_dict["driver_license"] = lic_val
        cust_dict["license_expire_date"] = lic_exp
        cust_dict["licence_expiry"] = lic_exp
        cust_dict["home_address"] = home_val
        cust_dict["address"] = home_val
        cust_dict["current_address"] = curr_val
        cust_dict["thai_address"] = curr_val

        with self.lock:
            self.customers[name] = cust_dict
        def _task():
            sb = get_db_client()
            if not sb: return
            CUSTOMER_10_COLS = {
                'full_name', 'phone_number', 'id_card_no', 'driver_license_no',
                'nationality', 'whatsapp', 'dob', 'license_expire_date',
                'home_address', 'current_address'
            }
            ALL_CUSTOMER_COLS = CUSTOMER_10_COLS | {
                'contact_no', 'phone', 'passport_id', 'id_card', 'licence_no',
                'driver_license', 'licence_expiry', 'thai_address', 'address',
                'nickname', 'email', 'line_id', 'line_user_id', 'notes', 'id_card_photo',
                'driver_license_photo'
            }
            try:
                row = {k: v for k, v in cust_dict.items() if k in ALL_CUSTOMER_COLS}
                if hasattr(sb, "run"):
                    from psycopg import sql as _sql
                    rows = sb.run([(_sql.SQL(
                        "SELECT column_name FROM information_schema.columns "
                        "WHERE table_schema = 'public' AND table_name = 'customers'"), [])])
                    db_cols = {r["column_name"] for r in rows}
                    if db_cols:
                        row = {k: v for k, v in row.items() if k in db_cols}
                row["full_name"] = name
                sb.table("customers").upsert(row).execute()
            except Exception as e:
                print(f"sb_sync_customer error: {e}")
                try:
                    fallback_row = {k: v for k, v in cust_dict.items() if k in CUSTOMER_10_COLS}
                    fallback_row["full_name"] = name
                    sb.table("customers").upsert(fallback_row).execute()
                except Exception as e2:
                    print(f"sb_sync_customer fallback error: {e2}")
        threading.Thread(target=_task, daemon=True).start()

    def async_delete_customer(self, name):
        with self.lock:
            self.customers.pop(name, None)
        def _task():
            sb = get_db_client()
            if not sb: return
            try:
                sb.table("customers").delete().eq("full_name", name).execute()
            except Exception as e:
                print(f"sb_delete_customer error: {e}")
        threading.Thread(target=_task, daemon=True).start()

    def async_sync_completed_job(self, job_dict):
        with self.lock:
            existing = next((i for i, x in enumerate(self.completed_jobs) if x.get("booking_id") == job_dict.get("booking_id")), None)
            if existing is not None:
                self.completed_jobs[existing] = job_dict
            else:
                self.completed_jobs.insert(0, job_dict)
        def _task():
            sb = get_db_client()
            if not sb: return
            try:
                VALID_CJ_COLS = {
                    'booking_id', 'car_id', 'customer', 'start_date', 'end_date',
                    'completed_date', 'base_price', 'discount', 'net_price', 'fuel_level',
                    'inspection_notes', 'inspection_photos', 'mileage', 'worker_delivery',
                    'worker_return', 'status', 'contract_type'
                }
                row = {k: v for k, v in job_dict.items() if k in VALID_CJ_COLS}
                if "start_date" in row and row["start_date"]: row["start_date"] = str(row["start_date"])
                if "end_date" in row and row["end_date"]: row["end_date"] = str(row["end_date"])
                if "completed_date" in row and row["completed_date"]: row["completed_date"] = str(row["completed_date"])
                sb.table("completed_jobs").upsert(row).execute()
            except Exception as e:
                print(f"sb_sync_completed_job error: {e}")
        threading.Thread(target=_task, daemon=True).start()

    def async_sync_financial(self, f_dict):
        with self.lock:
            self.financial_records.insert(0, f_dict)
        def _task():
            sb = get_db_client()
            if not sb: return
            try:
                row = dict(f_dict)
                row.pop("id", None)
                if "date" in row and row["date"]: row["date"] = str(row["date"])
                sb.table("financial_records").insert(row).execute()
            except Exception as e:
                print(f"sb_sync_financial error: {e}")
        threading.Thread(target=_task, daemon=True).start()

    def async_sync_user(self, username, u_dict):
        with self.lock:
            existing = dict(self.users.get(username, {}))
            existing.update(u_dict)
            existing["username"] = username
            self.users[username] = existing
        self.save_local_users()
        def _task():
            sb = get_db_client()
            if not sb: return
            row = dict(existing)
            row["username"] = username
            try:
                sb.table("users").upsert(row).execute()
            except Exception as e:
                try:
                    fallback_row = {k: v for k, v in row.items() if k in ("username", "password", "name", "role", "status", "created_at")}
                    sb.table("users").upsert(fallback_row).execute()
                except Exception as e2:
                    print(f"sb_sync_user error: {e2}")
        threading.Thread(target=_task, daemon=True).start()

    def async_delete_user(self, username):
        with self.lock:
            self.users.pop(username, None)
        self.save_local_users()
        def _task():
            sb = get_db_client()
            if not sb: return
            try:
                sb.table("users").delete().eq("username", username).execute()
            except Exception as e:
                print(f"sb_delete_user error: {e}")
        threading.Thread(target=_task, daemon=True).start()

    def load_local_maintenance(self):
        try:
            if os.path.exists(self.maintenance_file):
                with open(self.maintenance_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if isinstance(data, list) and len(data) > 0:
                        self.maintenance_records = data
                        return
        except Exception as e:
            print(f"Error loading local maintenance: {e}")
        # Default sample records
        self.maintenance_records = list(DEFAULT_MAINTENANCE_RECORDS)
        self.save_local_maintenance()

    def save_local_maintenance(self):
        try:
            with open(self.maintenance_file, "w", encoding="utf-8") as f:
                json.dump(self.maintenance_records, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"Error saving local maintenance: {e}")

    def async_sync_maintenance(self, m_dict):
        m_id = m_dict.get("id")
        with self.lock:
            existing_idx = next((i for i, x in enumerate(self.maintenance_records) if x.get("id") == m_id), None)
            if existing_idx is not None:
                self.maintenance_records[existing_idx] = m_dict
            else:
                self.maintenance_records.insert(0, m_dict)
        self.save_local_maintenance()
        def _task():
            sb = get_db_client()
            if not sb: return
            try:
                sb.table("maintenance_records").upsert(m_dict).execute()
            except Exception as e:
                pass
        threading.Thread(target=_task, daemon=True).start()

    def async_delete_maintenance(self, mnt_id):
        with self.lock:
            self.maintenance_records = [x for x in self.maintenance_records if x.get("id") != mnt_id]
        self.save_local_maintenance()
        def _task():
            sb = get_db_client()
            if not sb: return
            try:
                sb.table("maintenance_records").delete().eq("id", mnt_id).execute()
            except Exception:
                pass
        threading.Thread(target=_task, daemon=True).start()

    def load_local_vehicle_maintenances(self):
        try:
            if os.path.exists(self.vehicle_maintenances_file):
                with open(self.vehicle_maintenances_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if isinstance(data, list):
                        self.vehicle_maintenances = data
                        return
        except Exception as e:
            print(f"Error loading local vehicle maintenances: {e}")
        self.vehicle_maintenances = []
        self.save_local_vehicle_maintenances()

    def save_local_vehicle_maintenances(self):
        try:
            with open(self.vehicle_maintenances_file, "w", encoding="utf-8") as f:
                json.dump(self.vehicle_maintenances, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"Error saving local vehicle maintenances: {e}")

    def get_vehicle_maintenances(self, car_plate):
        p_clean = str(car_plate or "").strip()
        with self.lock:
            return [
                m for m in self.vehicle_maintenances
                if str(m.get("car_id") or "").strip() == p_clean
            ]

    def async_add_vehicle_maintenance(self, m_dict):
        with self.lock:
            if not m_dict.get("id"):
                existing_ids = [m.get("id") for m in self.vehicle_maintenances if isinstance(m.get("id"), int)]
                m_dict["id"] = max(existing_ids, default=0) + 1
            if not m_dict.get("created_at"):
                m_dict["created_at"] = datetime.now().isoformat()
            self.vehicle_maintenances.insert(0, m_dict)
        self.save_local_vehicle_maintenances()

        def _task():
            sb = get_db_client()
            if not sb: return
            try:
                row = {
                    "car_id": str(m_dict.get("car_id", "")),
                    "date": str(m_dict.get("date", "")),
                    "description": str(m_dict.get("description", "")),
                    "cost": float(m_dict.get("cost") or 0.0),
                }
                sb.table("vehicle_maintenances").insert(row).execute()
            except Exception as e:
                print(f"async_add_vehicle_maintenance error: {e}")

        threading.Thread(target=_task, daemon=True).start()
        return m_dict

    def async_delete_vehicle_maintenance(self, m_id):
        with self.lock:
            self.vehicle_maintenances = [m for m in self.vehicle_maintenances if str(m.get("id")) != str(m_id)]
        self.save_local_vehicle_maintenances()

        def _task():
            sb = get_db_client()
            if not sb: return
            try:
                sb.table("vehicle_maintenances").delete().eq("id", m_id).execute()
            except Exception as e:
                print(f"async_delete_vehicle_maintenance error: {e}")

        threading.Thread(target=_task, daemon=True).start()

    def load_local_work_order_logs(self):
        try:
            if os.path.exists(self.work_order_logs_file):
                with open(self.work_order_logs_file, "r", encoding="utf-8") as f:
                    self.work_order_logs = json.load(f)
                return
        except Exception as e:
            print(f"Error loading work order logs: {e}")
        self.work_order_logs = []
        self.save_local_work_order_logs()

    def save_local_work_order_logs(self):
        try:
            with open(self.work_order_logs_file, "w", encoding="utf-8") as f:
                json.dump(self.work_order_logs, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"Error saving work order logs: {e}")

    def log_work_order(self, car_id, booking_id=None, work_type="Maintenance", description="", cost=0.0, staff_id="admin"):
        log_id = f"WOL{datetime.now().strftime('%y%m%d%H%M%S%f')[:15]}"
        log_entry = {
            "id": log_id,
            "car_id": str(car_id or "").strip(),
            "booking_id": str(booking_id or "").strip() or None,
            "work_type": str(work_type or "Maintenance").strip(),
            "description": str(description or "").strip(),
            "cost": float(cost or 0.0),
            "staff_id": str(staff_id or "admin").strip(),
            "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        }
        with self.lock:
            self.work_order_logs.insert(0, log_entry)
            self.save_local_work_order_logs()

        def _db_task():
            try:
                sb = get_db_client()
                if sb:
                    sb.table("work_order_logs").insert(dict(log_entry)).execute()
            except Exception as e:
                print(f"Error logging work order to DB: {e}")

        threading.Thread(target=_db_task, daemon=True).start()
        return log_entry

    def load_local_maintenance_logs(self):
        try:
            if os.path.exists(self.maintenance_logs_file):
                with open(self.maintenance_logs_file, "r", encoding="utf-8") as f:
                    self.maintenance_logs = json.load(f)
                return
        except Exception as e:
            print(f"Error loading maintenance logs: {e}")
        self.maintenance_logs = []
        self.save_local_maintenance_logs()

    def save_local_maintenance_logs(self):
        try:
            with open(self.maintenance_logs_file, "w", encoding="utf-8") as f:
                json.dump(self.maintenance_logs, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"Error saving maintenance logs: {e}")

    def log_maintenance(self, car_id, date=None, expense_type="ซ่อมบำรุง", description="", cost=0.0, recorded_by="admin"):
        log_id = f"ML{datetime.now().strftime('%y%m%d%H%M%S%f')[:15]}"
        d_val = str(date or datetime.now().strftime("%Y-%m-%d")).strip()
        log_entry = {
            "id": log_id,
            "car_id": str(car_id or "").strip(),
            "date": d_val,
            "expense_type": str(expense_type or "ซ่อมบำรุง").strip(),
            "description": str(description or "").strip(),
            "cost": float(cost or 0.0),
            "recorded_by": str(recorded_by or "admin").strip(),
            "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        }
        with self.lock:
            self.maintenance_logs.insert(0, log_entry)
            self.save_local_maintenance_logs()

        def _db_task():
            try:
                sb = get_db_client()
                if sb:
                    sb.table("maintenance_logs").insert(dict(log_entry)).execute()
            except Exception as e:
                print(f"Error logging maintenance to DB: {e}")

        threading.Thread(target=_db_task, daemon=True).start()
        return log_entry

    def async_delete_maintenance_log(self, m_id):
        with self.lock:
            self.maintenance_logs = [x for x in self.maintenance_logs if str(x.get("id")) != str(m_id)]
            self.save_local_maintenance_logs()
        def _task():
            try:
                sb = get_db_client()
                if sb:
                    sb.table("maintenance_logs").delete().eq("id", m_id).execute()
            except Exception as e:
                pass
        threading.Thread(target=_task, daemon=True).start()

    def get_combined_maintenance_history(self, car_plate):
        p_clean = normalize_plate_str(car_plate)
        history = []
        seen_ids = set()

        # 1. maintenance_logs (newest persistent logs)
        for ml in self.maintenance_logs:
            if normalize_plate_str(ml.get("car_id")) == p_clean:
                m_id = str(ml.get("id") or "")
                if m_id and m_id not in seen_ids:
                    seen_ids.add(m_id)
                    history.append({
                        "id": m_id,
                        "car_id": ml.get("car_id"),
                        "date": ml.get("date") or ml.get("created_at", "")[:10],
                        "expense_type": ml.get("expense_type") or "ซ่อมบำรุง",
                        "description": ml.get("description") or "-",
                        "cost": float(ml.get("cost") or 0.0),
                        "recorded_by": ml.get("recorded_by") or "-",
                        "created_at": ml.get("created_at") or ""
                    })

        # 2. vehicle_maintenances (legacy quick logs)
        for vm in self.vehicle_maintenances:
            if normalize_plate_str(vm.get("car_id")) == p_clean:
                m_id = str(vm.get("id") or "")
                if m_id and m_id not in seen_ids:
                    seen_ids.add(m_id)
                    history.append({
                        "id": m_id,
                        "car_id": vm.get("car_id"),
                        "date": vm.get("date") or vm.get("created_at", "")[:10],
                        "expense_type": "ซ่อมบำรุง",
                        "description": vm.get("description") or "-",
                        "cost": float(vm.get("cost") or 0.0),
                        "recorded_by": "admin",
                        "created_at": vm.get("created_at") or ""
                    })

        # 3. maintenance_records (work orders)
        for mr in self.maintenance_records:
            if normalize_plate_str(mr.get("car_id")) == p_clean:
                m_id = str(mr.get("id") or "")
                if m_id and m_id not in seen_ids:
                    seen_ids.add(m_id)
                    cost_val = float(mr.get("actual_cost") or mr.get("cost") or 0.0)
                    m_date = mr.get("completed_at", "")[:10] or mr.get("schedule_date", "")[:10] or mr.get("created_at", "")[:10]
                    desc_parts = [mr.get("order_type", ""), mr.get("service_items", "")]
                    if mr.get("service_center"):
                        desc_parts.append(f"อู่: {mr.get('service_center')}")
                    if mr.get("completion_notes"):
                        desc_parts.append(f"({mr.get('completion_notes')})")
                    desc = " - ".join(p for p in desc_parts if p)
                    history.append({
                        "id": m_id,
                        "car_id": mr.get("car_id"),
                        "date": m_date or datetime.now().strftime("%Y-%m-%d"),
                        "expense_type": mr.get("order_type") or "ซ่อมบำรุง",
                        "description": desc or "-",
                        "cost": cost_val,
                        "recorded_by": mr.get("assigned_worker") or "admin",
                        "created_at": mr.get("created_at") or mr.get("completed_at") or ""
                    })

        # Sort descending by date, then created_at
        history.sort(key=lambda item: (str(item.get("date") or ""), str(item.get("created_at") or "")), reverse=True)
        return history

    def get_car_financial_roi(self, car_plate):
        p_clean = str(car_plate or "").strip()
        income = 0.0
        for b in self.bookings:
            if str(b.get("car_id") or "").strip() == p_clean:
                if b.get("rental_paid") or b.get("is_fully_paid") or b.get("status") in ["เสร็จสิ้น", "กำลังเช่า", "รอส่งมอบ", "รอรับคืน"]:
                    income += float(b.get("net_price") or b.get("rental_rate") or 0.0)
                exts = b.get("extension_history") or []
                for ext in exts:
                    if ext.get("paid"):
                        income += float(ext.get("amount") or 0.0)

        b_ids = {b.get("booking_id") for b in self.bookings if b.get("booking_id")}
        for cj in self.completed_jobs:
            if str(cj.get("car_id") or "").strip() == p_clean:
                if cj.get("booking_id") not in b_ids:
                    income += float(cj.get("net_price") or cj.get("rental_rate") or 0.0)

        # Calculate maintenance cost from combined history to strictly guarantee consistency with the history table
        combined_history = self.get_combined_maintenance_history(p_clean)
        maint_cost = sum(float(h.get("cost") or 0.0) for h in combined_history)

        net_profit = income - maint_cost
        return {
            "car_id": p_clean,
            "total_income": round(income, 2),
            "total_maintenance_cost": round(maint_cost, 2),
            "net_profit_roi": round(net_profit, 2)
        }

    def close_maintenance_record(self, mnt_id, actual_cost=None, completion_notes="", new_mileage=None, recorded_by="admin", new_act_expiry=None, new_ins_expiry=None, new_tax_expiry=None, insurance_company=None, policy_no=None):
        with self.lock:
            rec = next((x for x in self.maintenance_records if x.get("id") == mnt_id), None)
            if not rec:
                return None
            
            rec["status"] = "เสร็จสิ้น"
            rec["completed_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            if actual_cost is not None and str(actual_cost).strip() != "":
                try:
                    rec["actual_cost"] = float(actual_cost)
                except Exception:
                    pass
            else:
                rec["actual_cost"] = float(rec.get("cost", 0))
                
            if completion_notes:
                rec["completion_notes"] = completion_notes
            if policy_no and str(policy_no).strip():
                rec["policy_no"] = str(policy_no).strip()
            if new_act_expiry and str(new_act_expiry).strip():
                rec["new_act_expiry"] = str(new_act_expiry).strip()
            if new_ins_expiry and str(new_ins_expiry).strip():
                rec["new_ins_expiry"] = str(new_ins_expiry).strip()
            if new_tax_expiry and str(new_tax_expiry).strip():
                rec["new_tax_expiry"] = str(new_tax_expiry).strip()
            if insurance_company and str(insurance_company).strip():
                rec["insurance_company"] = str(insurance_company).strip()
                
            car_plate = rec.get("car_id")
            if car_plate and car_plate in self.cars:
                car = self.cars[car_plate]
                if car.get("status") in ["สถานะซ่อมบำรุง", "ซ่อมบำรุง", "ไม่พร้อมใช้งาน", "ต่อทะเบียน/ประกัน", "ต่อภาษี/ประกัน", "รอต่อทะเบียน"]:
                    car["status"] = "ว่างพร้อมใช้งาน"
                if new_mileage and str(new_mileage).strip():
                    car["mileage"] = str(new_mileage).strip()
                if new_tax_expiry and str(new_tax_expiry).strip() and str(new_tax_expiry).strip() != "-":
                    car["tax_expiry"] = str(new_tax_expiry).strip()
                    car["tax_expire_date"] = str(new_tax_expiry).strip()
                if new_act_expiry and str(new_act_expiry).strip() and str(new_act_expiry).strip() != "-":
                    car["act_expiry"] = str(new_act_expiry).strip()
                    car["prb_expire_date"] = str(new_act_expiry).strip()
                if new_ins_expiry and str(new_ins_expiry).strip() and str(new_ins_expiry).strip() != "-":
                    car["ins_expiry"] = str(new_ins_expiry).strip()
                    car["insurance_expire_date"] = str(new_ins_expiry).strip()
                if insurance_company and str(insurance_company).strip() and str(insurance_company).strip() != "-":
                    car["insurance_company"] = str(insurance_company).strip()
                    car["ins_company"] = str(insurance_company).strip()
                if policy_no and str(policy_no).strip():
                    car["insurance_policy_no"] = str(policy_no).strip()
                    car["policy_no"] = str(policy_no).strip()
                self.async_sync_car(car_plate, car)

            # Insert persistent maintenance log entry
            final_cost = float(rec.get("actual_cost") or rec.get("cost", 0))
            today_str = datetime.now().strftime("%Y-%m-%d")
            o_type = rec.get("order_type") or "ซ่อมบำรุง"
            desc_items = []
            if rec.get("service_items"): desc_items.append(str(rec.get("service_items")))
            if insurance_company: desc_items.append(f"บริษัทประกัน: {insurance_company}")
            if policy_no: desc_items.append(f"เลขที่กรมธรรม์/ใบเสร็จ: {policy_no}")
            if rec.get("service_center"): desc_items.append(f"อู่/ศูนย์: {rec.get('service_center')}")
            if completion_notes: desc_items.append(f"บันทึก: {completion_notes}")
            full_desc = f"{o_type} - {' | '.join(desc_items)}" if desc_items else o_type

            self.log_maintenance(
                car_id=car_plate,
                date=today_str,
                expense_type=o_type,
                description=full_desc,
                cost=final_cost,
                recorded_by=recorded_by
            )
                
            # Record financial expense
            final_cost = float(rec.get("actual_cost") or rec.get("cost", 0))
            if final_cost > 0:
                is_renewal = any(k in str(rec.get("order_type", "")) for k in ["ต่อทะเบียน", "พ.ร.บ.", "พรบ", "ประกัน"])
                cat = "ค่าต่อทะเบียน/พรบ./ประกัน" if is_renewal else "ค่าซ่อมบำรุงและดูแลรักษารถ"
                f_item = {
                    "company": (self.cars.get(car_plate) or {}).get("company", "บจก.สวัสดี เรนทัล (Sawasdee Rental)"),
                    "type": "รายจ่าย",
                    "category": cat,
                    "amount": final_cost,
                    "ref": mnt_id,
                    "date": datetime.now().strftime("%Y-%m-%d"),
                    "detail": f"{rec.get('order_type')} {car_plate} - {rec.get('service_items', '')} ({rec.get('service_center', '')})"
                }
                self.async_sync_financial(f_item)
                
            self.async_sync_maintenance(rec)
            return rec

    def upload_photo(self, filename, file_bytes, content_type="image/jpeg"):
        import base64
        import io
        try:
            # Compress image with PIL before base64 encoding to prevent payload bloat
            try:
                from PIL import Image
                img = Image.open(io.BytesIO(file_bytes))
                if img.mode in ("RGBA", "P"):
                    img = img.convert("RGB")
                img.thumbnail((800, 600), Image.Resampling.LANCZOS)
                out_buf = io.BytesIO()
                img.save(out_buf, format="JPEG", quality=75, optimize=True)
                compressed_bytes = out_buf.getvalue()
                b64 = base64.b64encode(compressed_bytes).decode("utf-8")
                return f"data:image/jpeg;base64,{b64}"
            except Exception as pil_err:
                b64 = base64.b64encode(file_bytes).decode("utf-8")
                return f"data:{content_type};base64,{b64}"
        except Exception as e:
            print(f"Error encoding photo: {e}")
            return None

    def archive_completed_booking(self, booking_id, fuel_level="⛽ เต็มถัง (Full - 8/8) [100%]", inspection_notes="ตรวจสภาพปกติ", inspection_photos=None, mileage="", late_fee=0.0, condition="normal", damage_desc="", repair_cost=0.0, service_center=""):
        with self.lock:
            target = next((b for b in self.bookings if b.get("booking_id") == booking_id), None)
            if not target:
                return False

            target["status"] = "เสร็จสิ้น"
            target["dispatch_closed"] = True
            target["return_closed"] = True
            if late_fee:
                target["late_fee"] = float(late_fee)
            end_d = target.get("end_date") or date.today()
            b_car = self.cars.get(target.get("car_id"), {})
            b_comp = b_car.get("company", "Sawasdee Rent A Car")
            net_p = float(target.get("net_price", 0))
            car_id = target.get("car_id")
            dep_amt = 5000.0 # STRICT RULE: Fixed 5,000 THB deposit for all bookings
            repair_cost = float(repair_cost or 0.0)
            pending_damage = float(target.get("pending_damage_cost") or 0.0)
            total_damage = repair_cost + pending_damage
            today_str = datetime.now().strftime("%Y-%m-%d")

            # Branching logic: Branch A (normal) vs Branch B (needs repair or has deferred damage)
            if condition == "needs_repair" or total_damage > 0:
                deducted = min(total_damage, dep_amt) if dep_amt > 0 else 0.0
                refund_rem = max(0.0, dep_amt - deducted)
                target["needs_repair"] = bool(repair_cost > 0)
                full_damage_desc = damage_desc
                if pending_damage > 0:
                    note_pending = f"[รวมค่าเสียหายยกยอดจากรถเดิม ฿{pending_damage:,.2f}]"
                    full_damage_desc = f"{damage_desc} {note_pending}".strip() if damage_desc else note_pending
                target["damage_desc"] = full_damage_desc
                target["repair_cost_deducted"] = deducted
                target["deposit_refunded"] = True
                target["deposit_refund_amount"] = refund_rem

                # Car transitions to Maintenance status if current vehicle has damage
                if repair_cost > 0 and car_id in self.cars:
                    self.cars[car_id]["status"] = "สถานะซ่อมบำรุง"
                    if mileage:
                        self.cars[car_id]["mileage"] = mileage
                    self.async_sync_car(car_id, self.cars[car_id])
                elif car_id in self.cars:
                    has_queue = any(
                        b.get("car_id") == car_id
                        and b.get("booking_id") != booking_id
                        and b.get("status") not in ("ยกเลิก", "เสร็จสิ้น")
                        for b in self.bookings
                    )
                    self.cars[car_id]["status"] = "ติดจอง" if has_queue else "ว่างพร้อมใช้งาน"
                    if mileage:
                        self.cars[car_id]["mileage"] = mileage
                    self.async_sync_car(car_id, self.cars[car_id])

                # Auto-create maintenance record in store if current vehicle is damaged
                if repair_cost > 0:
                    mnt_id = f"MNT{datetime.now().strftime('%y%m%d%H%M%S')}"
                    c_brand = b_car.get("brand", "")
                    c_model = b_car.get("model", "")
                    mnt_rec = {
                        "id": mnt_id,
                        "car_id": car_id,
                        "car_brand": f"{c_brand} {c_model}".strip(),
                        "order_type": "ซ่อมบำรุงจากความเสียหายหลังการเช่า",
                        "service_items": damage_desc or inspection_notes or "ตรวจพบความเสียหายหลังการเช่า",
                        "cost": repair_cost,
                        "status": "รอดำเนินการ",
                        "schedule_date": date.today(),
                        "expected_finish_date": date.today(),
                        "service_center": service_center or "ศูนย์บริการ / อู่ซ่อม",
                        "notes": f"เปิดจากงานรับคืน {booking_id} (หักเงินมัดจำ ฿{deducted:,.2f})"
                    }
                    self.maintenance_records.insert(0, mnt_rec)
                    self.async_sync_maintenance(mnt_rec)

                # Record financial deduction & refund
                if deducted > 0:
                    f_deduct = {
                        "company": b_comp,
                        "type": "รายรับ",
                        "category": "ค่าเสียหาย/ซ่อมบำรุงหักจากมัดจำ",
                        "amount": deducted,
                        "ref": booking_id,
                        "date": today_str,
                        "detail": f"หักค่าเสียหาย/ซ่อมบำรุงจากมัดจำ {booking_id} ({car_id})" + (f" (รวมยกยอด ฿{pending_damage:,.2f})" if pending_damage > 0 else "")
                    }
                    self.async_sync_financial(f_deduct)

                if refund_rem > 0:
                    f_ref_rem = {
                        "company": b_comp,
                        "type": "รายจ่าย",
                        "category": "คืนเงินมัดจำประกันสัญญา",
                        "amount": refund_rem,
                        "ref": booking_id,
                        "date": today_str,
                        "detail": f"คืนมัดจำคงเหลือหลังหักค่าซ่อม {booking_id} ({car_id})"
                    }
                    self.async_sync_financial(f_ref_rem)
            else:
                # Branch A: Normal condition -> refund full deposit & release car
                target["deposit_refunded"] = True
                target["deposit_refund_amount"] = dep_amt

                if car_id in self.cars:
                    has_queue = any(
                        b.get("car_id") == car_id
                        and b.get("booking_id") != booking_id
                        and b.get("status") not in ("ยกเลิก", "เสร็จสิ้น")
                        for b in self.bookings
                    )
                    self.cars[car_id]["status"] = "ติดจอง" if has_queue else "ว่างพร้อมใช้งาน"
                    if mileage:
                        self.cars[car_id]["mileage"] = mileage
                    self.async_sync_car(car_id, self.cars[car_id])

                if dep_amt > 0:
                    f_refund = {
                        "company": b_comp,
                        "type": "รายจ่าย",
                        "category": "คืนเงินมัดจำประกันสัญญา",
                        "amount": dep_amt,
                        "ref": booking_id,
                        "date": today_str,
                        "detail": f"คืนเงินมัดจำเต็มจำนวนหลังตรวจสภาพผ่าน {booking_id} ({car_id})"
                    }
                    self.async_sync_financial(f_refund)

            archived_item = {
                "booking_id": target["booking_id"],
                "car_id": target["car_id"],
                "customer": target["customer"],
                "company": b_comp,
                "start_date": target.get("start_date"),
                "end_date": end_d,
                "start_time": target.get("start_time", "10:00"),
                "end_time": target.get("end_time", "10:00"),
                "completed_date": date.today(),
                "contract_type": target.get("contract_type", "รายวัน"),
                "base_price": target.get("base_price", net_p),
                "discount": target.get("discount", 0),
                "net_price": net_p,
                "late_fee": float(target.get("late_fee", late_fee or 0)),
                "worker_delivery": target.get("worker_delivery", "-"),
                "worker_return": target.get("worker_return", "-"),
                "loc_delivery": target.get("loc_delivery", "-"),
                "loc_return": target.get("loc_return", "-"),
                "fuel_level": fuel_level,
                "inspection_notes": inspection_notes,
                "inspection_photos": inspection_photos or [],
                "mileage": mileage or b_car.get("mileage", "-"),
                "status": "เสร็จสิ้น"
            }

            self.async_sync_booking(target)
            self.async_sync_completed_job(archived_item)

            if not any(f.get("ref") == booking_id and f.get("category") == "ค่าเช่ารถ" for f in self.financial_records):
                f_item = {
                    "company": b_comp,
                    "type": "รายรับ",
                    "category": "ค่าเช่ารถ",
                    "amount": net_p,
                    "ref": booking_id,
                    "date": datetime.now().strftime("%Y-%m-%d"),
                    "detail": f"ค่าเช่าปิดงาน {target['car_id']} - {b_car.get('model', '')}"
                }
                self.async_sync_financial(f_item)

            actual_late = float(target.get("late_fee", late_fee or 0))
            if actual_late > 0 and not any(f.get("ref") == booking_id and "ล่าช้า" in f.get("category", "") for f in self.financial_records):
                f_late = {
                    "company": b_comp,
                    "type": "รายรับ",
                    "category": "ค่าปรับคืนรถล่าช้า (เกิน 4 ชม. ปรับ 1 วัน)",
                    "amount": actual_late,
                    "ref": booking_id,
                    "date": datetime.now().strftime("%Y-%m-%d"),
                    "detail": f"ค่าปรับคืนรถล่าช้าเกิน 4 ชม. (1 วันเต็ม) {target['car_id']}"
                }
                self.async_sync_financial(f_late)
            return True

    def swap_booking_vehicle(self, booking_id, new_car_id, fuel_level="⛽ เต็มถัง (Full - 8/8) [100%]", inspection_notes="สลับรถทดแทน", inspection_photos=None, mileage="", damage_desc="", repair_cost=0.0, service_center=""):
        with self.lock:
            target = next((b for b in self.bookings if b.get("booking_id") == booking_id), None)
            if not target:
                return False

            old_car_id = target.get("car_id")
            repair_cost = float(repair_cost or 0.0)
            today_str = datetime.now().strftime("%Y-%m-%d")

            # 1. Update Old Car -> Maintenance
            b_old_car = self.cars.get(old_car_id, {})
            if old_car_id in self.cars:
                self.cars[old_car_id]["status"] = "สถานะซ่อมบำรุง"
                if mileage:
                    self.cars[old_car_id]["mileage"] = mileage
                self.async_sync_car(old_car_id, self.cars[old_car_id])

            # Auto-create maintenance record for old car
            mnt_id = f"MNT{datetime.now().strftime('%y%m%d%H%M%S')}"
            c_brand = b_old_car.get("brand", "")
            c_model = b_old_car.get("model", "")
            mnt_rec = {
                "id": mnt_id,
                "car_id": old_car_id,
                "car_brand": f"{c_brand} {c_model}".strip(),
                "order_type": "ซ่อมบำรุงจากความเสียหายระหว่างเช่า (สลับรถทดแทน)",
                "service_items": damage_desc or inspection_notes or "ตรวจพบความเสียหายระหว่างเช่า ลูกค้าเปลี่ยนรถทดแทน",
                "cost": repair_cost,
                "status": "รอดำเนินการ",
                "schedule_date": date.today(),
                "expected_finish_date": date.today(),
                "service_center": service_center or "ศูนย์บริการ / อู่ซ่อม",
                "notes": f"เกิดจากการสลับรถทดแทนใน Booking {booking_id} (ยอดค่าเสียหายรอหักมัดจำ ฿{repair_cost:,.2f})"
            }
            self.maintenance_records.insert(0, mnt_rec)
            self.async_sync_maintenance(mnt_rec)

            # 2. Update New Car -> On Rent
            if new_car_id in self.cars:
                self.cars[new_car_id]["status"] = "กำลังเช่า"
                self.async_sync_car(new_car_id, self.cars[new_car_id])

            # 3. Update Existing Booking (booking continuation)
            target["car_id"] = new_car_id
            target["status"] = "กำลังเช่า"
            target["dispatch_closed"] = True
            target["return_closed"] = False

            # Accumulate pending damage cost to be deducted at contract completion
            prev_pending = float(target.get("pending_damage_cost") or 0.0)
            target["pending_damage_cost"] = prev_pending + repair_cost

            # Record swap history
            if "swap_history" not in target or not isinstance(target["swap_history"], list):
                target["swap_history"] = []
            target["swap_history"].append({
                "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "old_car_id": old_car_id,
                "new_car_id": new_car_id,
                "damage_desc": damage_desc,
                "repair_cost": repair_cost,
                "mileage": mileage,
                "fuel_level": fuel_level,
                "notes": inspection_notes,
                "photos": inspection_photos or [],
                "service_center": service_center
            })

            self.save_local_cars()
            self.save_local_bookings()
            self.async_sync_booking(target)
            return True

store = DataStore()

def start_background_cloud_sync():
    def _loop():
        # Wait 5 seconds before first loop
        time.sleep(5)
        while True:
            try:
                store.sync_from_database_async()
            except Exception as e:
                print(f"Background cloud sync loop error: {e}")
            time.sleep(120)
    t = threading.Thread(target=_loop, daemon=True, name="PostgresBackgroundSync")
    t.start()

