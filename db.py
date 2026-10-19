import os
import sys
import base64
import time
import threading
import re
import json
from datetime import datetime, date, time as d_time, timedelta
from supabase import create_client

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

HARDCODED_SUPABASE_URL = "https://brhuafypxrqtoznsuhaa.supabase.co"
HARDCODED_SERVICE_KEY = base64.b64decode("c2Jfc2VjcmV0X05qd3JsQWl6WW4tOFdhSFE3QTRHM2dfR1VmTUFyWFI=").decode()

def get_supabase_credentials():
    sb_url = os.environ.get("SUPABASE_URL", HARDCODED_SUPABASE_URL)
    sb_key = os.environ.get("SUPABASE_SERVICE_KEY", HARDCODED_SERVICE_KEY)
    try:
        import toml
        sec_path = os.path.join(BASE_DIR, ".streamlit", "secrets.toml")
        if os.path.exists(sec_path):
            sec = toml.load(sec_path)
            sb_url = sec.get("SUPABASE_URL", sb_url)
            sb_key = sec.get("SUPABASE_SERVICE_KEY", sb_key)
    except Exception:
        pass
    return sb_url, sb_key

_sb_client = None
def get_supabase_client():
    global _sb_client
    if _sb_client is not None:
        return _sb_client
    try:
        url, key = get_supabase_credentials()
        _sb_client = create_client(url, key)
        return _sb_client
    except Exception as e:
        print(f"Supabase client init note: {e}")
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

def get_car_fleet_status(car_plate, car_obj, bookings, filter_start_date=None, filter_end_date=None):
    c_status = str((car_obj or {}).get("status") or "").strip()
    if c_status in ["ซ่อมบำรุง", "ไม่พร้อมใช้งาน", "ระงับการใช้งาน"]:
        return "maintenance", "สถานะซ่อมบำรุง", "#F97316", "#FFF7ED", "#FDBA74"
        
    chk_s = to_date(filter_start_date)
    chk_e = to_date(filter_end_date)
    has_date_filter = bool(chk_s or chk_e)
    if chk_s and not chk_e: chk_e = chk_s
    elif chk_e and not chk_s: chk_s = chk_e
    if chk_s and chk_e and chk_e < chk_s: chk_e = chk_s
    
    active_bks = []
    if bookings:
        for b in bookings:
            if b.get("car_id") != car_plate: continue
            if b.get("status") in ["เสร็จสิ้น", "ยกเลิก"]: continue
            active_bks.append(b)
            
    is_booked_on_selected_date = False
    booked_b = None
    if chk_s and chk_e:
        for b in active_bks:
            b_s = to_date(b.get("start_date"))
            b_e = to_date(b.get("end_date"))
            if b_s and b_e and not (b_e < chk_s or b_s > chk_e):
                is_booked_on_selected_date = True
                booked_b = b
                break
                
    is_currently_rented = False
    if not has_date_filter:
        if c_status in ["กำลังเช่า", "รอส่งมอบ", "เตรียมส่งมอบ", "เตรียมรับคืน"]:
            is_currently_rented = True
        else:
            today_d = date.today()
            for b in active_bks:
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
    today_d = date.today()
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
        
    return "available", "ว่างไม่มีการจอง", "#10B981", "#ECFDF5", "#A7F3D0"

# -------------------------------------------------------------------------
# INITIAL CARS, CUSTOMERS, BOOKINGS, USERS
# -------------------------------------------------------------------------
DEFAULT_CARS = {
    "5ขฒ 5181": {"plate": "5ขฒ 5181", "brand": "Toyota", "model": "Yaris Ativ", "color": "ขาว (White)", "car_group": "รถเก๋ง (Sedan/Hatchback)", "engine_cc": "1200", "fuel_type": "เบนซิน", "company": "บจก.สวัสดี เรนทัล (Sawasdee Rental)", "price_day": 1000, "price_week": 6000, "price_month": 18000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "MR2BD8A3100079451", "act_expiry": "25/12/2026", "ins_expiry": "25/12/2026", "mileage": "21,476", "image": "https://images.unsplash.com/photo-1549399542-7e3f8b79c341?auto=format&fit=crop&q=80&w=500"},
    "5ขต 1490": {"plate": "5ขต 1490", "brand": "Toyota", "model": "Yaris Ativ", "color": "เทา-ดำ (Grey-Black)", "car_group": "รถเก๋ง (Sedan/Hatchback)", "engine_cc": "1200", "fuel_type": "เบนซิน", "company": "บจก.สวัสดี เรนทัล (Sawasdee Rental)", "price_day": 1000, "price_week": 6000, "price_month": 18000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "MR2BD8A3400071405", "act_expiry": "25/12/2026", "ins_expiry": "25/12/2026", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1549399542-7e3f8b79c341?auto=format&fit=crop&q=80&w=500"},
    "4ขฉ 8681": {"plate": "4ขฉ 8681", "brand": "Toyota", "model": "Corolla Cross", "color": "แดง-ดำ", "car_group": "SUV", "engine_cc": "1800", "fuel_type": "เบนซิน/Hybrid", "company": "โตโยต้า ลีสซิ่ง / คุณประสงฆ์", "price_day": 1800, "price_week": 11000, "price_month": 32000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "MR2KZAAX00035041", "act_expiry": "13/12/2024", "ins_expiry": "13/12/2024", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?auto=format&fit=crop&q=80&w=500"},
    "5ขธ 7101": {"plate": "5ขธ 7101", "brand": "Toyota", "model": "Corolla Cross", "color": "น้ำเงิน (Blue)", "car_group": "SUV", "engine_cc": "1800", "fuel_type": "เบนซิน/Hybrid", "company": "โตโยต้า ลีสซิ่ง", "price_day": 1800, "price_week": 11000, "price_month": 32000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "MR2KZAAG000055878", "act_expiry": "16/06/2025", "ins_expiry": "16/06/2025", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?auto=format&fit=crop&q=80&w=500"},
    "1ขธ 2151": {"plate": "1ขธ 2151", "brand": "Toyota", "model": "Corolla Cross", "color": "ขาว (White)", "car_group": "SUV", "engine_cc": "1800", "fuel_type": "เบนซิน/Hybrid", "company": "คุณเควิน นารูลา", "price_day": 1800, "price_week": 11000, "price_month": 32000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "MR2KZAAG200008254", "act_expiry": "29/10/2023", "ins_expiry": "29/10/2022", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?auto=format&fit=crop&q=80&w=500"},
    "1กถ 7011": {"plate": "1กถ 7011", "brand": "Honda", "model": "Freed", "color": "ขาว (White)", "car_group": "รถตู้ (Van)", "engine_cc": "1500", "fuel_type": "เบนซิน", "company": "คุณสมคิด", "price_day": 1400, "price_week": 8500, "price_month": 24000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "MHRGB3840BJ10001", "act_expiry": "02/10/2025", "ins_expiry": "17/11/2025", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1541899481282-d53bffe3c35d?auto=format&fit=crop&q=80&w=500"},
    "2กข 9011": {"plate": "2กข 9011", "brand": "Honda", "model": "Freed", "color": "ขาว (White)", "car_group": "รถตู้ (Van)", "engine_cc": "1500", "fuel_type": "เบนซิน", "company": "คุณอารินทร์", "price_day": 1400, "price_week": 8500, "price_month": 24000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "MHRGB3840CJ010915", "act_expiry": "28/03/2023", "ins_expiry": "28/03/2023", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1541899481282-d53bffe3c35d?auto=format&fit=crop&q=80&w=500"},
    "5ขณ 3171": {"plate": "5ขณ 3171", "brand": "Honda", "model": "HR-V", "color": "แดง (Red)", "car_group": "SUV", "engine_cc": "1500", "fuel_type": "เบนซิน/Hybrid", "company": "บจก.บี คลิ๊ก ลีส แอนด์ โลจิสติกส์", "price_day": 1600, "price_week": 9800, "price_month": 28000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "MRHRV5890NT103738", "act_expiry": "31/03/2023", "ins_expiry": "31/03/2023", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?auto=format&fit=crop&q=80&w=500"},
    "3ขญ 4980": {"plate": "3ขญ 4980", "brand": "Honda", "model": "HR-V", "color": "ขาว (White)", "car_group": "SUV", "engine_cc": "1500", "fuel_type": "เบนซิน/Hybrid", "company": "คุณอารินทร์", "price_day": 1600, "price_week": 9800, "price_month": 28000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "MRHRV5890NT107595", "act_expiry": "09/08/2025", "ins_expiry": "09/08/2025", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?auto=format&fit=crop&q=80&w=500"},
    "4ขน 6983": {"plate": "4ขน 6983", "brand": "Lexus", "model": "RX", "color": "ขาว (White)", "car_group": "รถหรู (Luxury)", "engine_cc": "2500", "fuel_type": "เบนซิน/Hybrid", "company": "คุณอารินทร์", "price_day": 4000, "price_week": 25000, "price_month": 75000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "JTJBK11A502006698", "act_expiry": "25/12/2025", "ins_expiry": "25/12/2025", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1542282088-72c9c27ed0cd?auto=format&fit=crop&q=80&w=500"},
    "8กฐ 3303": {"plate": "8กฐ 3303", "brand": "Nissan", "model": "Navara", "color": "ดำ (Black)", "car_group": "รถกระบะ (Pickup)", "engine_cc": "2500", "fuel_type": "ดีเซล", "company": "คุณสมคิด", "price_day": 1200, "price_week": 7200, "price_month": 20000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "MNTCC4D23Z0028203", "act_expiry": "17/01/2024", "ins_expiry": "17/01/2024", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1559416523-140ddc3d238c?auto=format&fit=crop&q=80&w=500"},
    "2ฒบ 6524": {"plate": "2ฒบ 6524", "brand": "Nissan", "model": "Navara", "color": "ส้ม (Orange)", "car_group": "รถกระบะ (Pickup)", "engine_cc": "2500", "fuel_type": "ดีเซล", "company": "บจก.บี คลิ๊ก ลีส แอนด์ โลจิสติกส์", "price_day": 1200, "price_week": 7200, "price_month": 20000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "MNTBC2D23Z0006241", "act_expiry": "23/01/2025", "ins_expiry": "23/01/2025", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1559416523-140ddc3d238c?auto=format&fit=crop&q=80&w=500"},
    "3ฒก 4467": {"plate": "3ฒก 4467", "brand": "Nissan", "model": "Navara", "color": "ขาว (White)", "car_group": "รถกระบะ (Pickup)", "engine_cc": "2500", "fuel_type": "ดีเซล", "company": "บจก.บี คลิ๊ก ลีส แอนด์ โลจิสติกส์", "price_day": 1200, "price_week": 7200, "price_month": 20000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "MNTBC2D23Z0004628", "act_expiry": "17/07/2024", "ins_expiry": "17/07/2024", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1559416523-140ddc3d238c?auto=format&fit=crop&q=80&w=500"},
    "1ขฌ 167": {"plate": "1ขฌ 167", "brand": "Nissan", "model": "X-Trail", "color": "เทา (Grey)", "car_group": "SUV", "engine_cc": "2000", "fuel_type": "เบนซิน", "company": "บจ.อนันต์", "price_day": 1800, "price_week": 11000, "price_month": 32000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "MNTJBNT32Z0200653", "act_expiry": "-", "ins_expiry": "-", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1552519507-da3b142c6e3d?auto=format&fit=crop&q=80&w=500"},
    "1นญ 1882": {"plate": "1นญ 1882", "brand": "Toyota", "model": "Majesty", "color": "ดำ (Black)", "car_group": "รถตู้ (Van)", "engine_cc": "2800", "fuel_type": "ดีเซล", "company": "บจก.สวัสดี เรนทัล (Sawasdee Rental)", "price_day": 4000, "price_week": 25000, "price_month": 75000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "JTFXB3AP408007967", "act_expiry": "02/09/2024", "ins_expiry": "02/09/2024", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1559297434-fae8a1916a79?auto=format&fit=crop&q=80&w=500"},
    "6กก 991": {"plate": "6กก 991", "brand": "Subaru", "model": "Forester", "color": "ขาว (White)", "car_group": "SUV", "engine_cc": "2000", "fuel_type": "เบนซิน", "company": "ซุปเปอร์เจ", "price_day": 2000, "price_week": 12000, "price_month": 35000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "MMRSK7KL5KT007724", "act_expiry": "09/10/2024", "ins_expiry": "09/10/2024", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1552519507-da3b142c6e3d?auto=format&fit=crop&q=80&w=500"},
    "2ขห 9175": {"plate": "2ขห 9175", "brand": "Toyota", "model": "Veloz", "color": "แดง (Red)", "car_group": "รถตู้ (Van)", "engine_cc": "1500", "fuel_type": "เบนซิน", "company": "บจก.สวัสดี เรนทัล (Sawasdee Rental)", "price_day": 1500, "price_week": 9000, "price_month": 26000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "MHFAB1BY800015213", "act_expiry": "08/06/2025", "ins_expiry": "08/06/2025", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1541899481282-d53bffe3c35d?auto=format&fit=crop&q=80&w=500"}
}

DEFAULT_MAINTENANCE_RECORDS = [
    {
        "id": "MNT261015001",
        "car_id": "4ขฉ 8681",
        "car_brand": "Toyota",
        "car_model": "Corolla Cross",
        "car_color": "แดง-ดำ",
        "order_type": "ซ่อมบำรุงทั่วไป / เช็คระยะ",
        "service_items": "เปลี่ยนถ่ายน้ำมันเครื่องสังเคราะห์แท้ 0W-20, เปลี่ยนไส้กรองน้ำมันเครื่อง, ตรวจเช็คระบบเบรก 4 ล้อ, สลับยาง-ถ่วงล้อ",
        "cost": 3450.0,
        "actual_cost": 3450.0,
        "service_center": "ศูนย์บริการ โตโยต้า บัสส์ วิภาวดี",
        "service_center_phone": "02-555-9999",
        "service_location": "ถ.วิภาวดีรังสิต แขวงลาดยาว เขตจตุจักร กรุงเทพฯ",
        "assigned_worker": "chaiwat.u",
        "schedule_date": "2026-10-15",
        "schedule_time": "09:00",
        "expected_finish_date": "2026-10-16",
        "expected_finish_time": "16:30",
        "status": "เสร็จสิ้น",
        "current_mileage": "30,120",
        "notes": "เช็คระยะตามกำหนด 30,000 กม.",
        "completion_notes": "ตรวจเช็คสภาพสมบูรณ์ทุกจุด เปลี่ยนถ่ายน้ำมันเครื่องเรียบร้อย รถพร้อมใช้งาน",
        "update_car_status": True,
        "created_by": "admin",
        "created_at": "2026-10-15 08:30:00",
        "completed_at": "2026-10-16 16:30:00"
    },
    {
        "id": "MNT261018002",
        "car_id": "1ขธ 2151",
        "car_brand": "Toyota",
        "car_model": "Corolla Cross",
        "car_color": "ขาว (White)",
        "order_type": "ต่อทะเบียนภาษี / พ.ร.บ.",
        "service_items": "ตรวจสภาพรถยนต์ (ตรอ.), ต่อภาษีประจำปี ขนส่งทางบก, ต่อ พ.ร.บ. คุ้มครองผู้ประสบภัยจากรถ",
        "cost": 1850.0,
        "actual_cost": 0.0,
        "service_center": "สำนักงานขนส่งกรุงเทพมหานครพื้นที่ 5 (จตุจักร) / ตรอ.วิภาวดี",
        "service_center_phone": "02-271-8888",
        "service_location": "กรมการขนส่งทางบก จตุจักร กทม.",
        "assigned_worker": "sam",
        "schedule_date": "2026-10-18",
        "schedule_time": "10:00",
        "expected_finish_date": "2026-10-20",
        "expected_finish_time": "15:00",
        "status": "กำลังซ่อมบำรุง",
        "current_mileage": "28,500",
        "notes": "ภาษีและ พรบ. กำลังจะหมดอายุ นำเล่มทะเบียนไปยื่นต่อภาษีประจำปี",
        "completion_notes": "",
        "update_car_status": True,
        "created_by": "admin",
        "created_at": "2026-10-18 09:15:00",
        "completed_at": None
    }
]

DEFAULT_USERS = {
    "admin": {
        "username": "admin",
        "name": "ผู้ดูแลระบบ (Admin)",
        "role": "Admin",
        "status": "approved",
        "password": "admin"
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
        self.users = dict(DEFAULT_USERS)
        self.maintenance_file = os.path.join(BASE_DIR, "data_maintenance.json")
        self.maintenance_records = []
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
        self.load_local_maintenance()

    def sync_from_supabase(self, force=False):
        """Synchronous full sync from Supabase Cloud"""
        self._sync_task(force=force)

    def sync_from_supabase_async(self, force=False):
        """Non-blocking background thread sync"""
        t = threading.Thread(target=self._sync_task, args=(force,), daemon=True)
        t.start()

    def _sync_task(self, force=False):
        if self.is_syncing and not force:
            return
        self.is_syncing = True
        try:
            sb = get_supabase_client()
            if not sb:
                return

            # 1. Users (from 'users' table + Supabase Auth admin list)
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

                # Also merge any accounts from Supabase Auth (e.g., Chatipat)
                try:
                    auth_list = sb.auth.admin.list_users()
                    existing_lower = {k.lower(): k for k in fresh_users.keys()}
                    for au in auth_list:
                        meta = au.user_metadata or {}
                        un = meta.get("username") or (au.email.split("@")[0] if au.email else None)
                        if un and un.lower() not in existing_lower:
                            new_u = {
                                "username": un,
                                "name": meta.get("name") or un,
                                "role": meta.get("role") or ("Admin" if un.lower() == "admin" else "Staff"),
                                "status": meta.get("status") or "approved"
                            }
                            fresh_users[un] = new_u
                            existing_lower[un.lower()] = un
                            try:
                                sb.table("users").upsert(new_u).execute()
                            except Exception:
                                pass
                except Exception:
                    pass

                if fresh_users:
                    with self.lock:
                        self.users = fresh_users
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
                        if b_copy.get("start_date"): b_copy["start_date"] = to_date(b_copy["start_date"])
                        if b_copy.get("end_date"): b_copy["end_date"] = to_date(b_copy["end_date"])
                        fresh_b.append(b_copy)
                    with self.lock:
                        self.bookings = fresh_b
            except Exception as e:
                print(f"Bookings sync error: {e}")

            # 3. Cars (and auto-release cars whose bookings were deleted from Supabase)
            try:
                c_res = sb.table("cars").select("*").execute()
                if c_res.data:
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
                            fresh_cars[pl] = c
                    if fresh_cars:
                        with self.lock:
                            self.cars = fresh_cars
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
                            fresh_cust[fn] = c
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

            # 7. Maintenance Records (if Supabase table exists)
            try:
                m_res = sb.table("maintenance_records").select("*").order("schedule_date", desc=True).execute()
                if m_res.data is not None and len(m_res.data) > 0:
                    with self.lock:
                        self.maintenance_records = m_res.data
                    self.save_local_maintenance()
            except Exception:
                pass

            self.last_sync_time = time.time()
            self.initial_sync_done = True
        except Exception as e:
            print(f"Sync task exception: {e}")
        finally:
            self.is_syncing = False

    def async_sync_booking(self, b_obj):
        def _task():
            sb = get_supabase_client()
            if not sb or not b_obj: return
            try:
                row = dict(b_obj)
                if "start_date" in row and row["start_date"]: row["start_date"] = str(row["start_date"])
                if "end_date" in row and row["end_date"]: row["end_date"] = str(row["end_date"])
                VALID_COLS = {
                    'booking_id', 'car_id', 'customer', 'start_date', 'end_date',
                    'start_time', 'end_time', 'contract_type', 'base_price', 'discount',
                    'net_price', 'deposit_paid', 'deposit_amount', 'rental_paid',
                    'remaining_rental', 'created_by', 'status', 'dispatch_closed',
                    'return_closed', 'worker_delivery', 'worker_return', 'loc_delivery',
                    'loc_return', 'extension_history', 'is_fully_paid', 'rental_payment_method'
                }
                filtered_row = {k: v for k, v in row.items() if k in VALID_COLS}
                sb.table("bookings").upsert(filtered_row).execute()
            except Exception as e:
                print(f"sb_sync_booking error: {e}")
        threading.Thread(target=_task, daemon=True).start()

    def async_delete_booking(self, bk_id):
        self.deleted_booking_ids.add(bk_id)
        with self.lock:
            self.bookings = [b for b in self.bookings if b.get("booking_id") != bk_id]
        def _task():
            sb = get_supabase_client()
            if not sb: return
            try:
                sb.table("bookings").delete().eq("booking_id", bk_id).execute()
            except Exception as e:
                print(f"sb_delete_booking error: {e}")
        threading.Thread(target=_task, daemon=True).start()

    def async_sync_car(self, plate, car_dict):
        VALID_CAR_COLS = {
            'plate', 'brand', 'model', 'color', 'car_group', 'engine_cc', 'fuel_type',
            'company', 'price_day', 'price_week', 'price_month', 'status', 'chassis_no',
            'act_expiry', 'ins_expiry', 'mileage', 'image', 'created_at'
        }
        with self.lock:
            existing = dict(self.cars.get(plate, {}))
            existing.update(car_dict)
            existing["plate"] = plate
            clean_mem = {k: v for k, v in existing.items() if k in VALID_CAR_COLS}
            self.cars[plate] = clean_mem
        def _task():
            sb = get_supabase_client()
            if not sb: return
            try:
                sb.table("cars").upsert(clean_mem).execute()
            except Exception as e:
                print(f"sb_sync_car error: {e}")
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
        def _task():
            sb = get_supabase_client()
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
        with self.lock:
            self.customers[name] = cust_dict
        def _task():
            sb = get_supabase_client()
            if not sb: return
            try:
                row = dict(cust_dict)
                row["full_name"] = name
                sb.table("customers").upsert(row).execute()
            except Exception as e:
                print(f"sb_sync_customer error: {e}")
        threading.Thread(target=_task, daemon=True).start()

    def async_delete_customer(self, name):
        with self.lock:
            self.customers.pop(name, None)
        def _task():
            sb = get_supabase_client()
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
            sb = get_supabase_client()
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
            sb = get_supabase_client()
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
            self.users[username] = u_dict
        def _task():
            sb = get_supabase_client()
            if not sb: return
            try:
                row = dict(u_dict)
                row["username"] = username
                sb.table("users").upsert(row).execute()
            except Exception as e:
                print(f"sb_sync_user error: {e}")
        threading.Thread(target=_task, daemon=True).start()

    def async_delete_user(self, username):
        with self.lock:
            self.users.pop(username, None)
        def _task():
            sb = get_supabase_client()
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
            sb = get_supabase_client()
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
            sb = get_supabase_client()
            if not sb: return
            try:
                sb.table("maintenance_records").delete().eq("id", mnt_id).execute()
            except Exception:
                pass
        threading.Thread(target=_task, daemon=True).start()

    def close_maintenance_record(self, mnt_id, actual_cost=None, completion_notes="", new_mileage=None, recorded_by="admin"):
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
                
            car_plate = rec.get("car_id")
            if car_plate and car_plate in self.cars:
                car = self.cars[car_plate]
                if car.get("status") in ["สถานะซ่อมบำรุง", "ซ่อมบำรุง", "ไม่พร้อมใช้งาน"]:
                    car["status"] = "ว่างพร้อมใช้งาน"
                if new_mileage and str(new_mileage).strip():
                    car["mileage"] = str(new_mileage).strip()
                self.async_sync_car(car_plate, car)
                
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
        sb = get_supabase_client()
        if sb:
            try:
                sb.storage.from_("inspection-photos").upload(
                    path=filename,
                    file=file_bytes,
                    file_options={"content-type": content_type, "upsert": "true"}
                )
                pub_url = sb.storage.from_("inspection-photos").get_public_url(filename)
                if pub_url:
                    return pub_url
            except Exception as e:
                print(f"Supabase storage upload fallback to base64: {e}")
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

    def archive_completed_booking(self, booking_id, fuel_level="⛽ เต็มถัง (Full - 8/8) [100%]", inspection_notes="ตรวจสภาพปกติ", inspection_photos=None, mileage="", late_fee=0.0):
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

            if target.get("car_id") in self.cars:
                self.cars[target["car_id"]]["status"] = "ว่างพร้อมใช้งาน"
                if mileage:
                    self.cars[target["car_id"]]["mileage"] = mileage
                self.async_sync_car(target["car_id"], self.cars[target["car_id"]])

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

store = DataStore()

def start_background_cloud_sync():
    def _loop():
        # Wait 2 seconds before first loop
        time.sleep(2)
        while True:
            try:
                store.sync_from_supabase_async()
            except Exception as e:
                print(f"Background cloud sync loop error: {e}")
            time.sleep(8)
    t = threading.Thread(target=_loop, daemon=True, name="SupabaseBackgroundSync")
    t.start()
