import os
import sys
import base64
import time
import threading
import re
import json
from datetime import datetime, date, time as d_time, timedelta

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
    # Prefer a direct PostgreSQL connection (Dokploy Postgres container) when DATABASE_URL is set.
    # PgClient mimics the supabase-py query API, so the rest of the code works unchanged.
    db_url = os.environ.get("DATABASE_URL")
    if db_url:
        try:
            from pg_client import PgClient
            _sb_client = PgClient(db_url)
            return _sb_client
        except Exception as e:
            print(f"PostgreSQL client init error: {e}")
            return None
    try:
        from supabase import create_client
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
    if c_status in ["ต่อทะเบียน/ประกัน", "ต่อภาษี/ประกัน", "รอต่อทะเบียน"]:
        return "renewal", "กำลังต่อภาษี/ประกัน", "#D97706", "#FEF3C7", "#FCD34D"
        
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
    "5ขฒ 5181": {"plate": "5ขฒ 5181", "brand": "Toyota", "model": "Yaris Ativ", "color": "ขาว (White)", "car_group": "รถเก๋ง (Sedan/Hatchback)", "engine_cc": "1200", "fuel_type": "เบนซิน", "company": "บจก.สวัสดี เรนทัล (Sawasdee Rental)", "price_day": 1000, "price_week": 6000, "price_month": 18000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "MR2BD8A3100079451", "act_expiry": "25/12/2026", "ins_expiry": "25/12/2026", "mileage": "21,476", "image": "https://images.unsplash.com/photo-1549399542-7e3f8b79c341?auto=format&fit=crop&q=80&w=500", "owner": "SWD", "beneficiary": "บจก.โตโยต้า ลีสซิ่ง", "reg_year": "2567", "tax_expiry": "28/03/2027", "ins_company": "คุ้มภัยโตเกียวมารีน", "last_service_date": "14/07/2026", "next_service": "14/01/2027", "tire_change": "-", "notes": "", "hp_contract_no": "A10916051", "hp_installment": 10748},
    "5ขต 1490": {"plate": "5ขต 1490", "brand": "Toyota", "model": "Yaris Ativ", "color": "เทา-ดำ (Grey-Black)", "car_group": "รถเก๋ง (Sedan/Hatchback)", "engine_cc": "1200", "fuel_type": "เบนซิน", "company": "บจก.สวัสดี เรนทัล (Sawasdee Rental)", "price_day": 1000, "price_week": 6000, "price_month": 18000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "MR2BD8A3400071405", "act_expiry": "25/12/2026", "ins_expiry": "25/12/2026", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1549399542-7e3f8b79c341?auto=format&fit=crop&q=80&w=500", "owner": "SWD", "beneficiary": "บจก.โตโยต้า ลีสซิ่ง", "reg_year": "2567", "tax_expiry": "17/05/2027", "ins_company": "คุ้มภัยโตเกียวมารีน", "last_service_date": "-", "next_service": "-", "tire_change": "-", "notes": "", "hp_contract_no": "A10916050", "hp_installment": 10748},
    "3ขห 3011": {"plate": "3ขห 3011", "brand": "Toyota", "model": "Yaris Ativ", "color": "เทา (Grey)", "car_group": "รถเก๋ง (Sedan/Hatchback)", "engine_cc": "1200", "fuel_type": "เบนซิน", "company": "คุณอารินทร์", "price_day": 1000, "price_week": 6000, "price_month": 18000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "MR2BD8A3700012496", "act_expiry": "25/11/2026", "ins_expiry": "25/11/2026", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1549399542-7e3f8b79c341?auto=format&fit=crop&q=80&w=500", "owner": "คุณอารินทร์", "beneficiary": "บีคลิ๊ก", "reg_year": "2566", "tax_expiry": "08/03/2027", "ins_company": "วิริยะ", "last_service_date": "-", "next_service": "-", "tire_change": "-", "notes": ""},
    "7ขต 8337": {"plate": "7ขต 8337", "brand": "Jaecoo", "model": "Jaecoo 7", "color": "ดำ (Black)", "car_group": "SUV", "engine_cc": "1600 Turbo", "fuel_type": "เบนซิน", "company": "บจก.บี คลิ๊ก ลีส แอนด์ โลจิสติกส์", "price_day": 2000, "price_week": 12000, "price_month": 35000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "PRBDB1HB1SA015942", "act_expiry": "15/01/2027", "ins_expiry": "15/01/2027", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1552519507-da3b142c6e3d?auto=format&fit=crop&q=80&w=500", "owner": "บีคลิ๊ก", "beneficiary": "บีคลิ๊ก", "reg_year": "2569", "tax_expiry": "10/03/2027", "ins_company": "-", "last_service_date": "-", "next_service": "-", "tire_change": "-", "notes": "มีคู่มือ"},
    "6ขญ 3119": {"plate": "6ขญ 3119", "brand": "Toyota", "model": "Yaris Cross", "color": "น้ำเงิน (Blue)", "car_group": "SUV", "engine_cc": "1500", "fuel_type": "เบนซิน/Hybrid", "company": "บจก.สวัสดี เรนทัล (Sawasdee Rental)", "price_day": 1600, "price_week": 9800, "price_month": 28000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "MR2A78BF004050706", "act_expiry": "23/11/2026", "ins_expiry": "23/11/2026", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?auto=format&fit=crop&q=80&w=500", "owner": "SWD", "beneficiary": "สวัสดี เรนทัล", "reg_year": "2567", "tax_expiry": "07/03/2027", "ins_company": "คุ้มภัยโตเกียวมารีน", "last_service_date": "02/04/2026", "next_service": "40000", "tire_change": "-", "notes": "คุณนันธิดาเช่าอยู่ / คุณนันธิดาเช็คระยะส่งสลิปแล้วสวัสดีจ่ายคืน", "hp_contract_no": "A10984839", "hp_installment": 16323},
    "8ขข 6817": {"plate": "8ขข 6817", "brand": "Jaecoo", "model": "Jaecoo 7", "color": "เขียวโอลีฟ / เทา-ดำ (Olive Grey)", "car_group": "SUV", "engine_cc": "1600 Turbo", "fuel_type": "เบนซิน", "company": "บจก.บี คลิ๊ก ลีส แอนด์ โลจิสติกส์", "price_day": 2000, "price_week": 12000, "price_month": 35000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "PRBDB1HB1SA020983", "act_expiry": "19/08/2027", "ins_expiry": "19/08/2027", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1552519507-da3b142c6e3d?auto=format&fit=crop&q=80&w=500", "owner": "บีคลิ๊ก", "beneficiary": "บีคลิ๊ก", "reg_year": "2569", "tax_expiry": "19/08/2027", "ins_company": "คุ้มภัยโตเกียวมารีน", "last_service_date": "-", "next_service": "-", "tire_change": "-", "notes": "บีคลิ๊กซื้อสด"},
    "7ขง 5041": {"plate": "7ขง 5041", "brand": "Toyota", "model": "Corolla Altis", "color": "เทา (Grey)", "car_group": "รถเก๋ง (Sedan/Hatchback)", "engine_cc": "1800", "fuel_type": "เบนซิน", "company": "บจก.สวัสดี เรนทัล (Sawasdee Rental)", "price_day": 1400, "price_week": 8500, "price_month": 24000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "MR2BK3BE800029073", "act_expiry": "30/06/2026", "ins_expiry": "30/06/2026", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1621007947382-bb3c3994e3fb?auto=format&fit=crop&q=80&w=500", "owner": "SWD", "beneficiary": "สวัสดี เรนทัล", "reg_year": "2568", "tax_expiry": "15/12/2026", "ins_company": "อินทรประกันภัย", "last_service_date": "-", "next_service": "-", "tire_change": "-", "notes": "", "hp_contract_no": "P11124483", "hp_installment": 16184},
    "7ขน 4588": {"plate": "7ขน 4588", "brand": "Toyota", "model": "Yaris Cross", "color": "ขาว-ดำ (Two-Tone)", "car_group": "SUV", "engine_cc": "1500", "fuel_type": "เบนซิน/Hybrid", "company": "คุณสมคิด", "price_day": 1600, "price_week": 9800, "price_month": 28000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "MR2A78BF004090770", "act_expiry": "-", "ins_expiry": "-", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?auto=format&fit=crop&q=80&w=500", "owner": "คุณสมคิด", "beneficiary": "คุณสมคิด", "reg_year": "2569", "tax_expiry": "09/04/2027", "ins_company": "คุ้มภัยโตเกียวมารีน", "last_service_date": "-", "next_service": "-", "tire_change": "-", "notes": "ซื้อจากคุณกรรณิการ์"},
    "7ขล 653": {"plate": "7ขล 653", "brand": "BYD", "model": "Dolphin", "color": "ขาว (White)", "car_group": "รถเก๋ง (Sedan/Hatchback)", "engine_cc": "EV (ไฟฟ้า 100%)", "fuel_type": "ไฟฟ้า (EV)", "company": "บจก.บี คลิ๊ก ลีส แอนด์ โลจิสติกส์", "price_day": 1500, "price_week": 9000, "price_month": 25000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "LGXCE4CBXSG015122", "act_expiry": "27/12/2026", "ins_expiry": "27/12/2026", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1552519507-da3b142c6e3d?auto=format&fit=crop&q=80&w=500", "owner": "บีคลิ๊ก", "beneficiary": "บีคลิ๊ก", "reg_year": "2569", "tax_expiry": "19/04/2027", "ins_company": "คุ้มภัยโตเกียวมารีน", "last_service_date": "-", "next_service": "-", "tire_change": "-", "notes": "คุณหฤทัยใช้อยู่"},
    "6ขย 816": {"plate": "6ขย 816", "brand": "BYD", "model": "Dolphin", "color": "ขาว (White)", "car_group": "รถเก๋ง (Sedan/Hatchback)", "engine_cc": "EV (ไฟฟ้า 100%)", "fuel_type": "ไฟฟ้า (EV)", "company": "บจก.บี คลิ๊ก ลีส แอนด์ โลจิสติกส์", "price_day": 1500, "price_week": 9000, "price_month": 25000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "LGXCE4CB3SG010781", "act_expiry": "-", "ins_expiry": "-", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1552519507-da3b142c6e3d?auto=format&fit=crop&q=80&w=500", "owner": "บีคลิ๊ก", "beneficiary": "บจก.บี คลิ๊ก ลีส แอนด์ โลจิสติกส์", "reg_year": "-", "tax_expiry": "-", "ins_company": "-", "last_service_date": "-", "next_service": "-", "tire_change": "-", "notes": ""},
    "7ขด 856": {"plate": "7ขด 856", "brand": "GWM", "model": "Ora Good Cat", "color": "เบจ (Beige)", "car_group": "SUV", "engine_cc": "EV (ไฟฟ้า 100%)", "fuel_type": "ไฟฟ้า (EV)", "company": "บจก.สวัสดี เรนทัล (Sawasdee Rental)", "price_day": 1800, "price_week": 11000, "price_month": 32000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "MNUAATD50SR010935", "act_expiry": "29/11/2026", "ins_expiry": "29/11/2026", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1563720223185-11003d516935?auto=format&fit=crop&q=80&w=500", "owner": "SWD", "beneficiary": "สวัสดี เรนทัล", "reg_year": "2568", "tax_expiry": "26/12/2026", "ins_company": "วิริยะประกันภัย", "last_service_date": "-", "next_service": "-", "tire_change": "-", "notes": "คุณเจนนี่ใช้อยู่", "hp_contract_no": "6801869", "hp_installment": 15720},
    "7ขฉ 2011": {"plate": "7ขฉ 2011", "brand": "GWM", "model": "Ora Good Cat", "color": "ขาว (White)", "car_group": "SUV", "engine_cc": "EV (ไฟฟ้า 100%)", "fuel_type": "ไฟฟ้า (EV)", "company": "บจก.สวัสดี เรนทัล (Sawasdee Rental)", "price_day": 1800, "price_week": 11000, "price_month": 32000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "MNUAATD50SR010936", "act_expiry": "29/11/2026", "ins_expiry": "29/11/2026", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1563720223185-11003d516935?auto=format&fit=crop&q=80&w=500", "owner": "SWD", "beneficiary": "สวัสดี เรนทัล", "reg_year": "2568", "tax_expiry": "26/12/2026", "ins_company": "วิริยะประกันภัย", "last_service_date": "-", "next_service": "-", "tire_change": "-", "notes": "", "hp_contract_no": "6801875", "hp_installment": 15720},
    "พม 6999": {"plate": "พม 6999", "brand": "Honda", "model": "CR-V", "color": "ขาว (White)", "car_group": "SUV", "engine_cc": "2000", "fuel_type": "เบนซิน", "company": "บจก.บี คลิ๊ก ลีส แอนด์ โลจิสติกส์", "price_day": 2500, "price_week": 15000, "price_month": 39000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "MRHRY9879RP100803", "act_expiry": "18/10/2026", "ins_expiry": "18/10/2026", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?auto=format&fit=crop&q=80&w=500", "owner": "บีคลิ๊ก", "beneficiary": "บีคลิ๊ก", "reg_year": "2568", "tax_expiry": "30/12/2026", "ins_company": "เมืองไทยประกันภัย", "last_service_date": "-", "next_service": "-", "tire_change": "-", "notes": "", "hp_contract_no": "Bclick (CR-V 1.5ES)", "hp_installment": 113390},
    "7ขง 4611": {"plate": "7ขง 4611", "brand": "Toyota", "model": "Yaris Cross", "color": "ส้ม (Orange)", "car_group": "SUV", "engine_cc": "1500", "fuel_type": "เบนซิน/Hybrid", "company": "บจก.สวัสดี เรนทัล (Sawasdee Rental)", "price_day": 1600, "price_week": 9800, "price_month": 28000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "MR2A78BF804075269", "act_expiry": "-", "ins_expiry": "-", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?auto=format&fit=crop&q=80&w=500", "owner": "สวัสดี", "beneficiary": "บจก.สวัสดี เรนทัล (Sawasdee Rental)", "reg_year": "-", "tax_expiry": "-", "ins_company": "-", "last_service_date": "14/07/2026", "next_service": "-", "tire_change": "-", "notes": "", "hp_contract_no": "A11166836", "hp_installment": 13102},
    "7ขจ 1099": {"plate": "7ขจ 1099", "brand": "GWM", "model": "Tank 300", "color": "เทา (Grey)", "car_group": "SUV", "engine_cc": "2000", "fuel_type": "เบนซิน/Hybrid", "company": "บจก.พี.ดี.พี. (P.D.P. Co., Ltd.)", "price_day": 2600, "price_week": 15000, "price_month": 39000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "MNUBB7S70SR008610", "act_expiry": "03/11/2026", "ins_expiry": "03/11/2026", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1552519507-da3b142c6e3d?auto=format&fit=crop&q=80&w=500", "owner": "พี.ดี.พี.", "beneficiary": "พี.ดี.พี", "reg_year": "2568", "tax_expiry": "24/12/2026", "ins_company": "วิริยะประกันภัย", "last_service_date": "-", "next_service": "-", "tire_change": "-", "notes": "", "hp_contract_no": "6801686", "hp_installment": 25672},
    "ป้ายแดง (Alphard ขาว)": {"plate": "ป้ายแดง (Alphard ขาว)", "brand": "Toyota", "model": "Alphard", "color": "ขาว (White)", "car_group": "รถตู้ (Van)", "engine_cc": "2500", "fuel_type": "เบนซิน/Hybrid", "company": "คุณอารินทร์", "price_day": 4500, "price_week": 28000, "price_month": 85000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "AAHH400067981", "act_expiry": "-", "ins_expiry": "25/08/2027", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1609521263047-f8f205293f24?auto=format&fit=crop&q=80&w=500", "owner": "คุณอารินทร์", "beneficiary": "คุณอารินทร์", "reg_year": "-", "tax_expiry": "-", "ins_company": "นวกิจประกันภัย", "last_service_date": "-", "next_service": "-", "tire_change": "-", "notes": ""},
    "ต 1259": {"plate": "ต 1259", "brand": "Toyota", "model": "Veloz", "color": "ขาว (White)", "car_group": "รถตู้ (Van)", "engine_cc": "1500", "fuel_type": "เบนซิน", "company": "บจก.บี คลิ๊ก ลีส แอนด์ โลจิสติกส์", "price_day": 1500, "price_week": 9000, "price_month": 26000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "MHFABIBY200120135", "act_expiry": "14/08/2027", "ins_expiry": "14/08/2027", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1541899481282-d53bffe3c35d?auto=format&fit=crop&q=80&w=500", "owner": "บีคลิ๊ก", "beneficiary": "บีคลิ๊ก", "reg_year": "-", "tax_expiry": "-", "ins_company": "คุ้มภัยโตเกียวมารีน", "last_service_date": "-", "next_service": "-", "tire_change": "-", "notes": ""},
    "ต 1260": {"plate": "ต 1260", "brand": "Toyota", "model": "Veloz", "color": "ขาว (White)", "car_group": "รถตู้ (Van)", "engine_cc": "1500", "fuel_type": "เบนซิน", "company": "บจก.บี คลิ๊ก ลีส แอนด์ โลจิสติกส์", "price_day": 1500, "price_week": 9000, "price_month": 26000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "MHFABIBY900120066", "act_expiry": "14/08/2027", "ins_expiry": "14/08/2027", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1541899481282-d53bffe3c35d?auto=format&fit=crop&q=80&w=500", "owner": "บีคลิ๊ก", "beneficiary": "บีคลิ๊ก", "reg_year": "-", "tax_expiry": "-", "ins_company": "คุ้มภัยโตเกียวมารีน", "last_service_date": "-", "next_service": "-", "tire_change": "-", "notes": ""},
    "ต 1256": {"plate": "ต 1256", "brand": "Toyota", "model": "Commuter", "color": "ขาว (White)", "car_group": "รถตู้ (Van)", "engine_cc": "2800", "fuel_type": "ดีเซล", "company": "บจก.บี คลิ๊ก ลีส แอนด์ โลจิสติกส์", "price_day": 2500, "price_week": 15000, "price_month": 42000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "MMKBBHCP706457302", "act_expiry": "06/08/2027", "ins_expiry": "06/08/2027", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1570125909232-eb263c188f7e?auto=format&fit=crop&q=80&w=500", "owner": "บีคลิ๊ก", "beneficiary": "บีคลิ๊ก", "reg_year": "-", "tax_expiry": "-", "ins_company": "วิริยะประกันภัย", "last_service_date": "-", "next_service": "-", "tire_change": "-", "notes": ""},
    "7ขง 1762": {"plate": "7ขง 1762", "brand": "Toyota", "model": "Veloz", "color": "แดง (Red)", "car_group": "รถตู้ (Van)", "engine_cc": "1500", "fuel_type": "เบนซิน", "company": "บจก.สวัสดี เรนทัล (Sawasdee Rental)", "price_day": 1500, "price_week": 9000, "price_month": 26000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "MHFAB1BY000114785", "act_expiry": "20/10/2027", "ins_expiry": "20/10/2027", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1541899481282-d53bffe3c35d?auto=format&fit=crop&q=80&w=500", "owner": "สวัสดี", "beneficiary": "สวัสดี", "reg_year": "2568", "tax_expiry": "11/12/2025", "ins_company": "ไอโออิ กรุงเทพ", "last_service_date": "-", "next_service": "-", "tire_change": "-", "notes": "", "hp_contract_no": "A11158158", "hp_installment": 13584},
    "7ขช 8613": {"plate": "7ขช 8613", "brand": "Jaecoo", "model": "Jaecoo 6", "color": "ขาว-ดำ (Two-Tone)", "car_group": "SUV", "engine_cc": "EV (ไฟฟ้า 100%)", "fuel_type": "ไฟฟ้า (EV)", "company": "คุณอารินทร์", "price_day": 2200, "price_week": 13000, "price_month": 37000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "LNNBBDBN3SD906986", "act_expiry": "27/11/2026", "ins_expiry": "27/11/2026", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1552519507-da3b142c6e3d?auto=format&fit=crop&q=80&w=500", "owner": "คุณอารินทร์", "beneficiary": "คุณอารินทร์", "reg_year": "2569", "tax_expiry": "13/01/2027", "ins_company": "วิริยะประกันภัย", "last_service_date": "-", "next_service": "-", "tire_change": "-", "notes": "พี่วรรณใช้อยู่"},
    "ต 1257": {"plate": "ต 1257", "brand": "Toyota", "model": "Yaris Ativ", "color": "ขาว (White)", "car_group": "รถเก๋ง (Sedan/Hatchback)", "engine_cc": "1200", "fuel_type": "เบนซิน", "company": "บจก.สวัสดี เรนทัล (Sawasdee Rental)", "price_day": 1000, "price_week": 6000, "price_month": 18000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "MR2BD8A3100178609", "act_expiry": "27/08/2027", "ins_expiry": "27/08/2027", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1549399542-7e3f8b79c341?auto=format&fit=crop&q=80&w=500", "owner": "สวัสดี", "beneficiary": "สวัสดี", "reg_year": "-", "tax_expiry": "-", "ins_company": "คุ้มภัยโตเกียวมารีน", "last_service_date": "-", "next_service": "-", "tire_change": "-", "notes": ""},
    "1ขค 642": {"plate": "1ขค 642", "brand": "Nissan", "model": "Almera", "color": "ขาว (White)", "car_group": "รถเก๋ง (Sedan/Hatchback)", "engine_cc": "1000 Turbo", "fuel_type": "เบนซิน", "company": "คุณสมคิด", "price_day": 1000, "price_week": 6000, "price_month": 18000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "MNTBAAN18Z0003911", "act_expiry": "16/03/2026", "ins_expiry": "16/03/2026", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1549399542-7e3f8b79c341?auto=format&fit=crop&q=80&w=500", "owner": "-", "beneficiary": "คุณสมคิด ดูเบ", "reg_year": "2563", "tax_expiry": "29/05/2026", "ins_company": "คุ้มภัยโตเกียวมารีน", "last_service_date": "-", "next_service": "-", "tire_change": "-", "notes": "รถเช่า/มีเล่มทะเบียน"},
    "7กก 16": {"plate": "7กก 16", "brand": "Toyota", "model": "Alphard", "color": "ขาว (White)", "car_group": "รถตู้ (Van)", "engine_cc": "2500", "fuel_type": "เบนซิน/Hybrid", "company": "บางกอก", "price_day": 4500, "price_week": 28000, "price_month": 85000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "AGH300096998", "act_expiry": "25/08/2025", "ins_expiry": "25/08/2025", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1609521263047-f8f205293f24?auto=format&fit=crop&q=80&w=500", "owner": "-", "beneficiary": "บางกอก", "reg_year": "2561", "tax_expiry": "09/02/2026", "ins_company": "เมืองไทยประกันภัย", "last_service_date": "24/03/2026", "next_service": "-", "tire_change": "-", "notes": "22/8/69 เคลมประกันเดิมLMG(ก่อนเปลี่ยนบริษัทใหม่)"},
    "5ขข 2527": {"plate": "5ขข 2527", "brand": "Toyota", "model": "Yaris Cross", "color": "ส้มแดง (Orange-Red)", "car_group": "SUV", "engine_cc": "1500", "fuel_type": "เบนซิน/Hybrid", "company": "บจก.สวัสดี เรนทัล (Sawasdee Rental)", "price_day": 1600, "price_week": 9800, "price_month": 28000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "MR2A78BF904005201", "act_expiry": "23/11/2025", "ins_expiry": "23/11/2025", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?auto=format&fit=crop&q=80&w=500", "owner": "-", "beneficiary": "สวัสดี เรนทัล", "reg_year": "2567", "tax_expiry": "04/01/2026", "ins_company": "คุ้มภัยโตเกียวมารีน", "last_service_date": "-", "next_service": "-", "tire_change": "-", "notes": "รถจอดบนตึก", "hp_contract_no": "A10914809", "hp_installment": 14007},
    "6กษ 2700": {"plate": "6กษ 2700", "brand": "BMW", "model": "3 Series", "color": "ดำ (Black)", "car_group": "รถหรู (Luxury)", "engine_cc": "2000", "fuel_type": "เบนซิน", "company": "คุณอารินทร์", "price_day": 3500, "price_week": 22000, "price_month": 65000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "WBA8E12070K793709", "act_expiry": "19/10/2023", "ins_expiry": "19/10/2023", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1555215695-3004980ad54e?auto=format&fit=crop&q=80&w=500", "owner": "-", "beneficiary": "คุณอารินทร์", "reg_year": "2561", "tax_expiry": "03/01/2025", "ins_company": "LMG", "last_service_date": "-", "next_service": "-", "tire_change": "-", "notes": "มีเล่ม / รถอยู่พัทยา / ประกัน+พรบ.ให้คุณอารินทร์(บจ.ชานเซลเลอร์จ่ายค่าประกัน)"},
    "ป้ายแดง (BMW ดำ)": {"plate": "ป้ายแดง (BMW ดำ)", "brand": "BMW", "model": "3 Series", "color": "ดำ (Black)", "car_group": "รถหรู (Luxury)", "engine_cc": "2000", "fuel_type": "เบนซิน", "company": "บางกอก", "price_day": 3500, "price_week": 22000, "price_month": 65000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "MMF8T34030BV99155", "act_expiry": "29/04/2022", "ins_expiry": "29/04/2022", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1555215695-3004980ad54e?auto=format&fit=crop&q=80&w=500", "owner": "-", "beneficiary": "บางกอก", "reg_year": "2563", "tax_expiry": "-", "ins_company": "แอกซ่า", "last_service_date": "-", "next_service": "-", "tire_change": "-", "notes": "ซื้อรถมาปี 2563 / บางกอกทำจ่ายอนันตร์โดยตรง / คุณเควินใช้อยู่"},
    "ป้ายแดง (BMW ขาว)": {"plate": "ป้ายแดง (BMW ขาว)", "brand": "BMW", "model": "3 Series", "color": "ขาว (White)", "car_group": "รถหรู (Luxury)", "engine_cc": "2000", "fuel_type": "เบนซิน", "company": "บางกอก", "price_day": 3500, "price_week": 22000, "price_month": 65000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "MMF8T34030BV99151", "act_expiry": "29/04/2022", "ins_expiry": "29/04/2022", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1555215695-3004980ad54e?auto=format&fit=crop&q=80&w=500", "owner": "-", "beneficiary": "บางกอก", "reg_year": "2563", "tax_expiry": "-", "ins_company": "แอกซ่า", "last_service_date": "-", "next_service": "-", "tire_change": "-", "notes": "ซื้อรถมาปี 2563 / บางกอกทำจ่ายอนันตร์โดยตรง / คุณนาวินใช้อยู่"},
    "ป้ายแดง (Commuter ขาว)": {"plate": "ป้ายแดง (Commuter ขาว)", "brand": "Toyota", "model": "Commuter", "color": "ขาว (White)", "car_group": "รถตู้ (Van)", "engine_cc": "2800", "fuel_type": "ดีเซล", "company": "บจก.สวัสดี เรนทัล (Sawasdee Rental)", "price_day": 2500, "price_week": 15000, "price_month": 42000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "MMKBBHCP106530236", "act_expiry": "08/03/2025", "ins_expiry": "08/03/2025", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1570125909232-eb263c188f7e?auto=format&fit=crop&q=80&w=500", "owner": "-", "beneficiary": "สวัสดี เรนทัล", "reg_year": "2567", "tax_expiry": "-", "ins_company": "คุ้มภัยโตเกียวมารีน", "last_service_date": "-", "next_service": "-", "tire_change": "-", "notes": "รถตู้พระ/ประกัน+พรบ.คุณอารินทร์จ่ายตรง", "hp_contract_no": "A10955195", "hp_installment": 22796},
    "3กฉ 63": {"plate": "3กฉ 63", "brand": "Honda", "model": "CR-V", "color": "ดำ (Black)", "car_group": "SUV", "engine_cc": "2000", "fuel_type": "เบนซิน", "company": "บริษัท ฮอนด้า ออโต้โมบิล", "price_day": 2500, "price_week": 15000, "price_month": 39000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "MRHRS5868RP100535", "act_expiry": "31/08/2024", "ins_expiry": "31/08/2024", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?auto=format&fit=crop&q=80&w=500", "owner": "-", "beneficiary": "บริษัท ฮอนด้า ออโต้โมบิล", "reg_year": "2567", "tax_expiry": "08/02/2026", "ins_company": "กรุงเทพประกันภัย", "last_service_date": "-", "next_service": "-", "tire_change": "-", "notes": "คุณอารินทร์ใช้อยู่ ผใส่ป้ายแดง)"},
    "ป้ายแดง (CR-V เชียงใหม่)": {"plate": "ป้ายแดง (CR-V เชียงใหม่)", "brand": "Honda", "model": "CR-V (ใหม่)", "color": "ขาว (White)", "car_group": "SUV", "engine_cc": "1500 Turbo", "fuel_type": "เบนซิน", "company": "บจก.บี คลิ๊ก ลีส แอนด์ โลจิสติกส์", "price_day": 2500, "price_week": 15000, "price_month": 39000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "-", "act_expiry": "18/10/2025", "ins_expiry": "18/10/2025", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1552519507-da3b142c6e3d?auto=format&fit=crop&q=80&w=500", "owner": "-", "beneficiary": "บจก.บี คลิ๊ก ลีส แอนด์ โลจิสติกส์", "reg_year": "2025", "tax_expiry": "18/10/2025", "ins_company": "เมืองไทยประกันภัย", "last_service_date": "-", "next_service": "-", "tire_change": "-", "notes": "คุณอารินทร์ใช้อยู่ ที่เชียงใหม่ใส่ป้ายแดง) ผ่อนกับบีคลิ๊ก"},
    "ชศ 411": {"plate": "ชศ 411", "brand": "Honda", "model": "CR-V", "color": "ขาวมุก (Pearl White)", "car_group": "SUV", "engine_cc": "2000", "fuel_type": "เบนซิน", "company": "บจก.บี คลิ๊ก ลีส แอนด์ โลจิสติกส์", "price_day": 2500, "price_week": 15000, "price_month": 39000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "MRHRY9851RP100177", "act_expiry": "29/04/2024", "ins_expiry": "29/04/2024", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?auto=format&fit=crop&q=80&w=500", "owner": "-", "beneficiary": "บจก.บี คลิ๊ก ลีส แอนด์ โลจิสติกส์", "reg_year": "2567", "tax_expiry": "23/01/2026", "ins_company": "ธนชาตประกันภัย", "last_service_date": "-", "next_service": "-", "tire_change": "-", "notes": "สวัสดีผ่อนอยู่กับบีคลิ๊ก"},
    "8กย 4595": {"plate": "8กย 4595", "brand": "Honda", "model": "CR-V", "color": "ขาว (White)", "car_group": "SUV", "engine_cc": "2000", "fuel_type": "เบนซิน", "company": "K.Anupreet", "price_day": 2500, "price_week": 15000, "price_month": 39000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "MRHRW6830JP104868", "act_expiry": "27/01/2024", "ins_expiry": "27/01/2024", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?auto=format&fit=crop&q=80&w=500", "owner": "-", "beneficiary": "K.Anupreet", "reg_year": "2562", "tax_expiry": "ลูกค้าต่อเอง", "ins_company": "ไทยศรีประกันภัย", "last_service_date": "-", "next_service": "-", "tire_change": "-", "notes": "(18/6/62 ส่งป้ายทะเบียนเหล็ก+เล่มทะเบียน)จดทะเบียน 31/5/2562 / ต่อประกันภัยและพรบ.(โอนเข้าบัญชีคุณอารินทร์)/ผ่อนครบลูกค้าต่อภาษีเอง/ 116 ซ.ราชพฤกษ์9 อิ่มอัมพร 2 แขวงตลิ่งชัน เขตตลิ่งชัน กรุงเทพฯ10170/มีเคลม ผิด 1 ครั้ง 26-4-2023/ย้ายบ้านโครงการ บางกอก บูเลอวาร์ด ซิกเนเจอร์ บางแวก72 เลขที่ 63/1 ถนนบางแวก, บางเชือกหนัง, ตลิ่งชัน, กรุงเทพ 10170"},
    "7ขข 6741": {"plate": "7ขข 6741", "brand": "Honda", "model": "CR-V", "color": "ขาว (White)", "car_group": "SUV", "engine_cc": "2000", "fuel_type": "เบนซิน", "company": "บางกอก", "price_day": 2500, "price_week": 15000, "price_month": 39000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "MRHRM2830GP103516", "act_expiry": "06/11/2022", "ins_expiry": "06/11/2022", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?auto=format&fit=crop&q=80&w=500", "owner": "-", "beneficiary": "บางกอก", "reg_year": "2559", "tax_expiry": "27/06/2025", "ins_company": "MSIG", "last_service_date": "-", "next_service": "-", "tire_change": "-", "notes": "รถอยู่เชียงราย/ มีเล่ม / มีป้ายเหล็กอยู่ออฟฟิศ / มีหนังสืออนุญาตรถระหว่างประเทศ หมดอายุ 27 June 2022/(ป้ายแดง ต-1254)/23-7-63 เอารถเข้าศูนย์ / ประกันภัยคิดราคาตามเรทรถส่วนบุคคลไม่ใช่รับจ่างหรือให้เช่า/16-7-65อนันต์ส่งสลักหลัง ผู้รับผลประโยชน์เป็นคุณอารินทร์/6-765คุณอารินทร์เอาป้ายเหล็กไปแล้ว"},
    "3ขค 1951": {"plate": "3ขค 1951", "brand": "Toyota", "model": "Corolla Cross", "color": "ขาว-ดำ (Two-Tone)", "car_group": "SUV", "engine_cc": "1800", "fuel_type": "เบนซิน/Hybrid", "company": "โตโยต้า ลีสซิ่ง", "price_day": 1800, "price_week": 11000, "price_month": 32000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "MR2KZAAG200063142", "act_expiry": "25/12/2025", "ins_expiry": "25/12/2025", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?auto=format&fit=crop&q=80&w=500", "owner": "-", "beneficiary": "โตโยต้า ลีสซิ่ง", "reg_year": "2023", "tax_expiry": "18/05/2025", "ins_company": "ไอโออิ", "last_service_date": "-", "next_service": "-", "tire_change": "-", "notes": "MRS.EDEH W ใช้อยู่ที่พัทยา (ผ่อนอยู่ 18,544.-)", "hp_contract_no": "A10778291", "hp_installment": 18544},
    "4ขฉ 8681": {"plate": "4ขฉ 8681", "brand": "Toyota", "model": "Corolla Cross", "color": "แดง-ดำ", "car_group": "SUV", "engine_cc": "1800", "fuel_type": "เบนซิน/Hybrid", "company": "โตโยต้า ลีสซิ่ง / คุณประสงฆ์", "price_day": 1800, "price_week": 11000, "price_month": 32000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "MR2KZAAX00035041", "act_expiry": "13/12/2024", "ins_expiry": "13/12/2024", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?auto=format&fit=crop&q=80&w=500", "owner": "-", "beneficiary": "โตโยต้า ลีสซิ่ง / คุณประสงฆ์", "reg_year": "2565", "tax_expiry": "08/06/2024", "ins_company": "กรุงไทยพานิชประกันภัย", "last_service_date": "-", "next_service": "-", "tire_change": "-", "notes": "สลับกับ CROSS สีขาว (MRS.EDEH WINDAVIANA)/28-5-67 รับเอกสารโอนลอย,สัญญาซื้อขาย มาจากพี่วรรณ(อยู่ในแฟ้ม)/5-7-67 เช็คระยะ"},
    "5ขธ 7101": {"plate": "5ขธ 7101", "brand": "Toyota", "model": "Corolla Cross", "color": "น้ำเงิน (Blue)", "car_group": "SUV", "engine_cc": "1800", "fuel_type": "เบนซิน/Hybrid", "company": "โตโยต้า ลีสซิ่ง", "price_day": 1800, "price_week": 11000, "price_month": 32000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "MR2KZAAG000055878", "act_expiry": "16/06/2025", "ins_expiry": "16/06/2025", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?auto=format&fit=crop&q=80&w=500", "owner": "-", "beneficiary": "โตโยต้า ลีสซิ่ง", "reg_year": "2567", "tax_expiry": "14/08/2026", "ins_company": "คุ้มภัยโตเกียวมารีน", "last_service_date": "-", "next_service": "-", "tire_change": "-", "notes": "แล็บสีเทา"},
    "1ขธ 2151": {"plate": "1ขธ 2151", "brand": "Toyota", "model": "Corolla Cross", "color": "ขาว (White)", "car_group": "SUV", "engine_cc": "1800", "fuel_type": "เบนซิน/Hybrid", "company": "คุณเควิน นารูลา", "price_day": 1800, "price_week": 11000, "price_month": 32000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "MR2KZAAG200008254", "act_expiry": "29/10/2023", "ins_expiry": "29/10/2022", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?auto=format&fit=crop&q=80&w=500", "owner": "-", "beneficiary": "คุณเควิน นารูลา", "reg_year": "2563", "tax_expiry": "08/12/2023", "ins_company": "กรุงไทยพานิชประกันภัย", "last_service_date": "-", "next_service": "-", "tire_change": "-", "notes": "มีเล่ม /22-2-65โอนกรรมสิทธ์จาก Mr.Terence Kevin o'connor เป็น คุณเควิน นารูลา/ ส่งรถให้คุณเควิน 13-12-2564/1-12-65คุณอารินทร์แจ้งว่าลูกค้าต่อเอง"},
    "1กถ 7011": {"plate": "1กถ 7011", "brand": "Honda", "model": "Freed", "color": "ขาว (White)", "car_group": "รถตู้ (Van)", "engine_cc": "1500", "fuel_type": "เบนซิน", "company": "คุณสมคิด", "price_day": 1400, "price_week": 8500, "price_month": 24000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "MHRGB3840BJ10001", "act_expiry": "02/10/2025", "ins_expiry": "17/11/2025", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1541899481282-d53bffe3c35d?auto=format&fit=crop&q=80&w=500", "owner": "-", "beneficiary": "คุณสมคิด", "reg_year": "2556", "tax_expiry": "29/01/2026", "ins_company": "คุ้มภัยโตเกียวมารีน", "last_service_date": "-", "next_service": "-", "tire_change": "-", "notes": "มีเล่ม / รถอยู่เชียงใหม่ / โอนเป็นชื่อคุณสมคิด 15-09-2563 / 9-4-64 เปลี่ยนยางและซ่อมแอร์แล้ว/16/9/64เปลี่ยนTRUE SET DOOR MINROR ด้านซ้าย มีเล่ม / รถอยู่เชียงใหม่ / โอนเป็นชื่อคุณสมคิด 15-09-2563 / 9-4-64 เปลี่ยนยางและซ่อมแอร์แล้ว/16/9/64เปลี่ยนTRUE SET DOOR MINROR ด้านซ้าย/15-9-65 รับกลับมาจากเชียงใหม่ คุณอารินทร์ให้แจ้งเคลมทั้งคัน"},
    "2กข 9011": {"plate": "2กข 9011", "brand": "Honda", "model": "Freed", "color": "ขาว (White)", "car_group": "รถตู้ (Van)", "engine_cc": "1500", "fuel_type": "เบนซิน", "company": "คุณอารินทร์", "price_day": 1400, "price_week": 8500, "price_month": 24000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "MHRGB3840CJ010915", "act_expiry": "28/03/2023", "ins_expiry": "28/03/2023", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1541899481282-d53bffe3c35d?auto=format&fit=crop&q=80&w=500", "owner": "-", "beneficiary": "คุณอารินทร์", "reg_year": "2556", "tax_expiry": "09/05/2026", "ins_company": "ไทยศรี", "last_service_date": "-", "next_service": "-", "tire_change": "-", "notes": "มีเล่ม / โอนเป็นชื่อคุณอารินทร์ 10-06-2563 27-4-63 UPเป็น4G / ในรถไม่มี Easy Pass /4-4-66 เช็คระยะและเปลี่ยนแบตเตอรรี่"},
    "5ขณ 3171": {"plate": "5ขณ 3171", "brand": "Honda", "model": "HR-V", "color": "แดง (Red)", "car_group": "SUV", "engine_cc": "1500", "fuel_type": "เบนซิน/Hybrid", "company": "บจก.บี คลิ๊ก ลีส แอนด์ โลจิสติกส์", "price_day": 1600, "price_week": 9800, "price_month": 28000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "MRHRV5890NT103738", "act_expiry": "31/03/2023", "ins_expiry": "31/03/2023", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?auto=format&fit=crop&q=80&w=500", "owner": "-", "beneficiary": "บจก.บี คลิ๊ก ออโต้", "reg_year": "2567", "tax_expiry": "10/06/2025", "ins_company": "กรุงเทพประกันภัย", "last_service_date": "-", "next_service": "-", "tire_change": "-", "notes": "จ่ายค่างวดในนาม บีคลิ๊ก/25-6-67เข้าศูนย์พัฒนาการเปลี่ยนถ่ายน้ำมันเครื่อง"},
    "3ขญ 4980": {"plate": "3ขญ 4980", "brand": "Honda", "model": "HR-V", "color": "ขาว (White)", "car_group": "SUV", "engine_cc": "1500", "fuel_type": "เบนซิน/Hybrid", "company": "คุณอารินทร์", "price_day": 1600, "price_week": 9800, "price_month": 28000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "MRHRV5890NT107595", "act_expiry": "09/08/2025", "ins_expiry": "09/08/2025", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?auto=format&fit=crop&q=80&w=500", "owner": "-", "beneficiary": "คุณอารินทร์", "reg_year": "2565", "tax_expiry": "29/08/2026", "ins_company": "ไอโออิ กรุงเทพประกันภัย", "last_service_date": "-", "next_service": "-", "tire_change": "-", "notes": "มีเล่มทะเบียน /ประกันคุณภาพรถใหม่ 29-3-65(2ปี/40,000กม)/6-2-66ส่งป้ายเหล็ก 3ขญ 4980,ป้ายวงกลม 2566 ไปเชียงใหม่"},
    "4ขน 6983": {"plate": "4ขน 6983", "brand": "Lexus", "model": "RX", "color": "ขาว (White)", "car_group": "รถหรู (Luxury)", "engine_cc": "2500", "fuel_type": "เบนซิน/Hybrid", "company": "คุณอารินทร์", "price_day": 4000, "price_week": 25000, "price_month": 75000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "JTJBK11A502006698", "act_expiry": "25/12/2025", "ins_expiry": "25/12/2025", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1542282088-72c9c27ed0cd?auto=format&fit=crop&q=80&w=500", "owner": "-", "beneficiary": "คุณอารินทร์", "reg_year": "2554", "tax_expiry": "18/03/2025", "ins_company": "อินทรประกันภัย", "last_service_date": "-", "next_service": "-", "tire_change": "-", "notes": "มีเล่ม /21/10/64 คุณอารินทร์เอาไปใช้ ใส่ทะเบียน ษษ-991 / 13-1-65คุณอารินทร์ให้สลับทะเบียนกลับมาที่เดิม( CRVคุณอารินทร์สลับกับLEXUS)/ รถอยู่เชียงราย /14-3-65ส่งป้ายเหล็ก 1ขร-4960ไปเชียงแสง (เดิมทะเบียน 1ขร 4960)"},
    "8กฐ 3303": {"plate": "8กฐ 3303", "brand": "Nissan", "model": "Navara", "color": "ดำ (Black)", "car_group": "รถกระบะ (Pickup)", "engine_cc": "2500", "fuel_type": "ดีเซล", "company": "คุณสมคิด", "price_day": 1200, "price_week": 7200, "price_month": 20000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "MNTCC4D23Z0028203", "act_expiry": "17/01/2024", "ins_expiry": "17/01/2024", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1559416523-140ddc3d238c?auto=format&fit=crop&q=80&w=500", "owner": "-", "beneficiary": "คุณสมคิด", "reg_year": "2562", "tax_expiry": "04/02/2026", "ins_company": "LMG", "last_service_date": "-", "next_service": "-", "tire_change": "-", "notes": "มีเล่ม / พัทยา/ คู่มือรถอยู่กับพี่วรรณ/ 18-4-65 เอารถเข้าศูนย์นิสสันเพชรบุรี"},
    "2ฒบ 6524": {"plate": "2ฒบ 6524", "brand": "Nissan", "model": "Navara", "color": "ส้ม (Orange)", "car_group": "รถกระบะ (Pickup)", "engine_cc": "2500", "fuel_type": "ดีเซล", "company": "บจก.บี คลิ๊ก ลีส แอนด์ โลจิสติกส์", "price_day": 1200, "price_week": 7200, "price_month": 20000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "MNTBC2D23Z0006241", "act_expiry": "23/01/2025", "ins_expiry": "23/01/2025", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1559416523-140ddc3d238c?auto=format&fit=crop&q=80&w=500", "owner": "-", "beneficiary": "บี คลิ๊ก (LC กรีน)", "reg_year": "2562", "tax_expiry": "24/01/2026", "ins_company": "ไทยศรีประกันภัย", "last_service_date": "-", "next_service": "-", "tire_change": "-", "notes": "เล่มและสัญญาซื้อขายอยู่ออฟฟิศ / KIM SANG JOผ่อนอยู่ / ลูกค้าโอนเงินให้พี่วรรณ / ส่งเอกสารให้ลูกค้าทางไปรษณีย์ พี่วรรณเป็นคนจ่ายค่าส่ง/ หางพรบ.นำไปต่อภาษีในปีนั้นของทุกปี"},
    "3ฒก 4467": {"plate": "3ฒก 4467", "brand": "Nissan", "model": "Navara", "color": "ขาว (White)", "car_group": "รถกระบะ (Pickup)", "engine_cc": "2500", "fuel_type": "ดีเซล", "company": "บจก.บี คลิ๊ก ลีส แอนด์ โลจิสติกส์", "price_day": 1200, "price_week": 7200, "price_month": 20000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "MNTBC2D23Z0004628", "act_expiry": "17/07/2024", "ins_expiry": "17/07/2024", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1559416523-140ddc3d238c?auto=format&fit=crop&q=80&w=500", "owner": "-", "beneficiary": "บจ.บี คลิ๊ก ออโต้", "reg_year": "2563", "tax_expiry": "-", "ins_company": "ไทยศรีประกันภัย", "last_service_date": "-", "next_service": "-", "tire_change": "-", "notes": "(คุณวารีแยมซิง ตรงข้ามปรีดีฯ26 ) 086-5207218 /14-7-65 ต้อมเอารถเข้าศูนย์เช็คระยะ /ค่าประกันตั้งเช็คจ่ายเก็บเงินลูกค้า"},
    "1ขฌ 167": {"plate": "1ขฌ 167", "brand": "Nissan", "model": "X-Trail", "color": "เทา (Grey)", "car_group": "SUV", "engine_cc": "2000", "fuel_type": "เบนซิน", "company": "บจ.อนันต์", "price_day": 1800, "price_week": 11000, "price_month": 32000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "MNTJBNT32Z0200653", "act_expiry": "-", "ins_expiry": "-", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1552519507-da3b142c6e3d?auto=format&fit=crop&q=80&w=500", "owner": "-", "beneficiary": "บจ.อนันต์", "reg_year": "2563", "tax_expiry": "03/09/2021", "ins_company": "-", "last_service_date": "-", "next_service": "-", "tire_change": "-", "notes": "17-8-64 คุณอารินทร์ให้ลูกค้าต่อเอง / เล่มทะเบียนให้คุณกุลเดช 16-11-64 / ผ่อนอยู่ 20,366.-/เดือน (24งวด)/ลูกค้าต่อภาษี-ประกันเอง"},
    "1นญ 1882": {"plate": "1นญ 1882", "brand": "Toyota", "model": "Majesty", "color": "ดำ (Black)", "car_group": "รถตู้ (Van)", "engine_cc": "2800", "fuel_type": "ดีเซล", "company": "บจก.สวัสดี เรนทัล (Sawasdee Rental)", "price_day": 4000, "price_week": 25000, "price_month": 75000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "JTFXB3AP408007967", "act_expiry": "02/09/2024", "ins_expiry": "02/09/2024", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1559297434-fae8a1916a79?auto=format&fit=crop&q=80&w=500", "owner": "-", "beneficiary": "บจก.สวัสดี เรนทัล", "reg_year": "-", "tax_expiry": "-", "ins_company": "กรุงเทพประกันภัย", "last_service_date": "31/07/2026", "next_service": "-", "tire_change": "-", "notes": "ยังผ่อนอยู่", "hp_contract_no": "A11013342", "hp_installment": 40567},
    "6กก 991": {"plate": "6กก 991", "brand": "Subaru", "model": "Forester", "color": "ขาว (White)", "car_group": "SUV", "engine_cc": "2000", "fuel_type": "เบนซิน", "company": "ซุปเปอร์เจ", "price_day": 2000, "price_week": 12000, "price_month": 35000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "MMRSK7KL5KT007724", "act_expiry": "09/10/2024", "ins_expiry": "09/10/2024", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1552519507-da3b142c6e3d?auto=format&fit=crop&q=80&w=500", "owner": "-", "beneficiary": "ซุปเปอร์เจ", "reg_year": "2564", "tax_expiry": "08/02/2026", "ins_company": "คุ้มภัยโตเกียวมารีน", "last_service_date": "-", "next_service": "-", "tire_change": "-", "notes": "ทะเบียน 6กก-991 / ผ่อนอยู่กับกรุงศรี/5-4-65 เข้าศูนย์เช็ครยะ/10-2-66 เข้าศูนเคลมกระจกหน้า-ติกฟีลม์/เข้าศูนย์เช็คระยะ เดือนสิงหาคม"},
    "2ขห 9175": {"plate": "2ขห 9175", "brand": "Toyota", "model": "Veloz", "color": "แดง (Red)", "car_group": "รถตู้ (Van)", "engine_cc": "1500", "fuel_type": "เบนซิน", "company": "บจก.สวัสดี เรนทัล (Sawasdee Rental)", "price_day": 1500, "price_week": 9000, "price_month": 26000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "MHFAB1BY800015213", "act_expiry": "08/06/2025", "ins_expiry": "08/06/2025", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1541899481282-d53bffe3c35d?auto=format&fit=crop&q=80&w=500", "owner": "-", "beneficiary": "บจก.สวัสดี เรนทัล", "reg_year": "2565", "tax_expiry": "25/04/2025", "ins_company": "วิริยะประกันภัย", "last_service_date": "24/07/2026", "next_service": "-", "tire_change": "-", "notes": "รถจอดบนตึก"},
    "ชร 331": {"plate": "ชร 331", "brand": "Toyota", "model": "Vios", "color": "แดงไวน์ (Red Wine)", "car_group": "รถเก๋ง (Sedan/Hatchback)", "engine_cc": "1500", "fuel_type": "เบนซิน", "company": "คุณอารินทร์", "price_day": 1000, "price_week": 6000, "price_month": 18000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "MR053HY9305197326", "act_expiry": "11/07/2024", "ins_expiry": "11/07/2024", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1549399542-7e3f8b79c341?auto=format&fit=crop&q=80&w=500", "owner": "-", "beneficiary": "คุณอารินทร์", "reg_year": "2553", "tax_expiry": "02/11/2023", "ins_company": "วิริยะ", "last_service_date": "-", "next_service": "-", "tire_change": "-", "notes": "มีเล่ม / Easy Pass อยู่ออฟฟิศ / ลูกค้าเช่าอยู่"},
    "ถก 4777": {"plate": "ถก 4777", "brand": "Toyota", "model": "Hilux Vigo", "color": "ขาว (White)", "car_group": "รถกระบะ (Pickup)", "engine_cc": "2500", "fuel_type": "ดีเซล", "company": "คุณพรเทพ", "price_day": 1100, "price_week": 6600, "price_month": 19000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "MR0GS12G509203908", "act_expiry": "28/02/2023", "ins_expiry": "28/02/2023", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1559416523-140ddc3d238c?auto=format&fit=crop&q=80&w=500", "owner": "-", "beneficiary": "คุณพรเทพ", "reg_year": "-", "tax_expiry": "ลูกค้าต่อเอง", "ins_company": "คุ้มภัยโตเกียวมารีน", "last_service_date": "-", "next_service": "-", "tire_change": "-", "notes": "ต่อประกันและพรบ.ให้ลูกค้า / คุณพรเทพชำระค่าประกัน ปี 65-66 / โทรแจ้งคุณพรเทพ ต่อประกัน 081-6139073/บ้านเลขที่ 60/12 ปรีดีพนมยงค์ 14 แยก 6"},
    "9กบ 2700": {"plate": "9กบ 2700", "brand": "Toyota", "model": "Yaris", "color": "แดง (Red)", "car_group": "รถเก๋ง (Sedan/Hatchback)", "engine_cc": "1200", "fuel_type": "เบนซิน", "company": "คุณสมคิด", "price_day": 1000, "price_week": 6000, "price_month": 18000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "MR2K33F3301306101", "act_expiry": "04/09/2023", "ins_expiry": "04/09/2023", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1590362891991-f776e747a588?auto=format&fit=crop&q=80&w=500", "owner": "-", "beneficiary": "คุณสมคิด", "reg_year": "2563", "tax_expiry": "30/01/2026", "ins_company": "-", "last_service_date": "-", "next_service": "-", "tire_change": "-", "notes": "ผ่อนอยู่ (18,606)/จดทะเบียน 30 มกราคม 2563 / รถอยู่พัทยา/มีคู่มือใช้รถ/กุญแจสำรองอยู่กับพี่วรรณ/23-5-65เข้าศูนย์ ระยะ39,831กม.เปลี่ยนอัลเตอร์เนเตอร์(ไดชาร์จ)/24-5-65เอาป้ายเหล็กและป้ายวงกลมปี2566ไปติดที่รถ (ป้ายแดง 5399คืนพี่วรรณ)"},
    "2ฒฮ 8060": {"plate": "2ฒฮ 8060", "brand": "Toyota", "model": "Hilux Revo", "color": "เทา (Grey)", "car_group": "รถกระบะ (Pickup)", "engine_cc": "2400", "fuel_type": "ดีเซล", "company": "บจ.ยีวัน โอเวอร์ซีส์", "price_day": 1200, "price_week": 7200, "price_month": 20000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "MR0EB8CB500914791", "act_expiry": "16/04/2025", "ins_expiry": "16/04/2025", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1559416523-140ddc3d238c?auto=format&fit=crop&q=80&w=500", "owner": "-", "beneficiary": "บจ.ยีวัน โอเวอร์ซีส์", "reg_year": "2563", "tax_expiry": "12/10/2021", "ins_company": "ไทยศรี", "last_service_date": "-", "next_service": "-", "tire_change": "-", "notes": "คุณอัมฤทธิ์(ลูกค้าคุณอารินทร์)/เก็บเงินค้าประกันลูกค้า คุณเปรม(ญ)091-8798262 ปรีดีฯ42/13-6-65 คุณเปรมให้รับเช็ค+หักณ.ที่จ่ายติดต่อคุณจิ๋ม 02-3918562/14-6-65รับเช็คเข้าบัญชีคุณอารินทร์+หักณ.ที่จ่ายให้อนันต์ขอคืน คุณเจี๊ยบ(สอบถามรับเช็ค02-4601806)"},
    "ศล 3111": {"plate": "ศล 3111", "brand": "Peugeot", "model": "3008", "color": "ขาว (White)", "car_group": "SUV", "engine_cc": "1600 Turbo", "fuel_type": "เบนซิน", "company": "คุณอนิชา", "price_day": 2000, "price_week": 12000, "price_month": 35000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "VF34B5FVAAS209058", "act_expiry": "25/08/2025", "ins_expiry": "25/08/2025", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1552519507-da3b142c6e3d?auto=format&fit=crop&q=80&w=500", "owner": "-", "beneficiary": "คุณอนิชา", "reg_year": "2559", "tax_expiry": "20/09/2025", "ins_company": "เมืองไทยประกันภัย", "last_service_date": "-", "next_service": "-", "tire_change": "-", "notes": "8C /พรบ.2 ใบ 20/9/2024  คุณสมคิดซื้อตอนทำเรื่องต่อภาษี(ภาษีขาด)"},
    "3ขญ 741": {"plate": "3ขญ 741", "brand": "Toyota", "model": "Corolla Cross", "color": "ขาว (White)", "car_group": "SUV", "engine_cc": "1800", "fuel_type": "เบนซิน/Hybrid", "company": "คุณหฤทัย(บจก.ไอฮาร์ท)", "price_day": 1800, "price_week": 11000, "price_month": 32000, "status": "ว่างพร้อมใช้งาน", "chassis_no": "MR2KZA", "act_expiry": "24/12/2024", "ins_expiry": "24/12/2024", "mileage": "15,000", "image": "https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?auto=format&fit=crop&q=80&w=500", "owner": "-", "beneficiary": "คุณหฤทัย(บจก.ไอฮาร์ท)", "reg_year": "-", "tax_expiry": "24/08/2023", "ins_company": "ไทยศรี", "last_service_date": "-", "next_service": "-", "tire_change": "-", "notes": "คุณหฤทัยใช้อยู่ / ผ่อนกับบางกอก 48 งวด/พีโอต่อภาษีเก็บเงินลูกค้าพร้อมกับค่างวด/ประกันและพรบ.ทำจ่ายอนันต์ไม่มีหักณ.ที่จ่ายส่งประกันให้พี่โอเก็บเงินลูกค้าเพื่อโอนเงินคืนคุณอารินทร์แล้วส่งใบเสร็จใบกำกับให้พี่โอส่งคืนลูกค้า"}
}

DEFAULT_PROPERTY_INSURANCE = [
    {
        "id": "PROP-001",
        "title": "ประกันภัยทรัพย์สิน โครงการหมู่บ้านแกรนด์ แอนด์ กรีน บ้านเลขที่ 499/41",
        "owner": "คุณอารินทร์ ดูเบ",
        "ins_company": "คุ้มภัยโตเกียวมารีน",
        "expiry_date": "11/03/2026",
        "notes": "เลขที่สินไหม 20250930992 (แผ่นดินไหว 28/3/2025)"
    },
    {
        "id": "PROP-002",
        "title": "ประกันอุบัติเหตุส่วนบุคคล",
        "owner": "คุณอารินทร์ ดูเบ",
        "ins_company": "ฟอลคอนประกันภัย",
        "expiry_date": "01/05/2026",
        "notes": "ต่อประกันแล้ว รอกรมธรรม์ตัวจริง (คุณอารินทร์จ่ายเอง 7,300 บาท 29/4/2025)"
    },
    {
        "id": "PROP-003",
        "title": "ประกันภัยทรัพย์สิน โครงการเดอะแกรนด์ พระราม2 บ้านเลขที่ 77/59",
        "owner": "คุณเควิน นารูลา",
        "ins_company": "กรุงเทพประกันภัย",
        "expiry_date": "15/06/2026",
        "notes": "ทุนประกันภัย 10 ล้านบาท เบี้ย 12,186.23 บาท"
    },
    {
        "id": "PROP-004",
        "title": "ประกันภัยบ้าน (โครงการบางกอก บูเลอวาร์ด ซิกเนเจอร์ บางแวก 72 เลขที่ 63/1)",
        "owner": "คุณอนุปรี๊ด นารูลา",
        "ins_company": "-",
        "expiry_date": "-",
        "notes": "บ้านเลขที่ 63/1 ถนนบางแวก แขวงบางเชือกหนัง เขตตลิ่งชัน กทม. 10170"
    }
]

DEFAULT_HP_LEASING = [
    {
        "no": 1,
        "model": "Toyota Yaris Ativ Auto1200CC",
        "plate": "5ขฒ 5181",
        "chassis_no": "MR2BD8A3100079451",
        "contract_no": "A10916051",
        "down_payment_date": "29/12/2023",
        "down_payment": 152267.92,
        "first_payment_date": "28/01/2024",
        "due_day": "ทุกวันที่ 28",
        "installment": 10748.0,
        "total_months": 48,
        "paid_2023_2024": 128976.0,
        "paid_2025": 96732.0,
        "paid_months": 21,
        "paid_amount": 225708.0,
        "remaining_months": 27,
        "remaining_amount": 290196.0,
        "total_financed": 515904.0,
        "total_car_price": 668171.92
    },
    {
        "no": 2,
        "model": "Toyota Yaris Ativ Auto1200CC",
        "plate": "5ขต 1490",
        "chassis_no": "MR2BD8A3400071405",
        "contract_no": "A10916050",
        "down_payment_date": "29/12/2023",
        "down_payment": 152267.92,
        "first_payment_date": "28/01/2024",
        "due_day": "ทุกวันที่ 28",
        "installment": 10748.0,
        "total_months": 48,
        "paid_2023_2024": 128976.0,
        "paid_2025": 96732.0,
        "paid_months": 21,
        "paid_amount": 225708.0,
        "remaining_months": 27,
        "remaining_amount": 290196.0,
        "total_financed": 515904.0,
        "total_car_price": 668171.92
    },
    {
        "no": 3,
        "model": "Toyota Altis Auto1800CC",
        "plate": "7ขง 5041",
        "chassis_no": "MR2BK3BE800029073",
        "contract_no": "P11124483",
        "down_payment_date": "11/06/2025",
        "down_payment": 236888.88,
        "first_payment_date": "11/07/2025",
        "due_day": "ทุกวันที่ 11",
        "installment": 16184.0,
        "total_months": 48,
        "paid_2023_2024": 0.0,
        "paid_2025": 48552.0,
        "paid_months": 3,
        "paid_amount": 48552.0,
        "remaining_months": 45,
        "remaining_amount": 728280.0,
        "total_financed": 776832.0,
        "total_car_price": 1013720.88
    },
    {
        "no": 4,
        "model": "Toyota Corolla Cross",
        "plate": "3ขค 1951",
        "chassis_no": "MR2KZAAG200063142",
        "contract_no": "A10778291",
        "down_payment_date": "23/12/2022",
        "down_payment": 259516.92,
        "first_payment_date": "23/01/2023",
        "due_day": "ทุกวันที่ 23",
        "installment": 18544.0,
        "total_months": 48,
        "paid_2023_2024": 445056.0,
        "paid_2025": 166896.0,
        "paid_months": 33,
        "paid_amount": 611952.0,
        "remaining_months": 15,
        "remaining_amount": 278160.0,
        "total_financed": 890112.0,
        "total_car_price": 1149628.92
    },
    {
        "no": 5,
        "model": "Toyota Yaris Cross Auto1500CC",
        "plate": "5ขข 2527",
        "chassis_no": "MR2A78BF904005201",
        "contract_no": "A10914809",
        "down_payment_date": "25/12/2023",
        "down_payment": 236888.88,
        "first_payment_date": "25/01/2024",
        "due_day": "ทุกวันที่ 25",
        "installment": 14007.0,
        "total_months": 48,
        "paid_2023_2024": 168084.0,
        "paid_2025": 126063.0,
        "paid_months": 21,
        "paid_amount": 294147.0,
        "remaining_months": 27,
        "remaining_amount": 378189.0,
        "total_financed": 672336.0,
        "total_car_price": 909224.88
    },
    {
        "no": 6,
        "model": "Toyota Commuter Auto2800CC",
        "plate": "ป้ายแดง (Commuter ขาว)",
        "chassis_no": "MMKBBHCP106530236",
        "contract_no": "A10955195",
        "down_payment_date": "11/04/2024",
        "down_payment": 351000.0,
        "first_payment_date": "01/05/2024",
        "due_day": "ทุกวันที่ 1",
        "installment": 22796.0,
        "total_months": 48,
        "paid_2023_2024": 182368.0,
        "paid_2025": 205164.0,
        "paid_months": 17,
        "paid_amount": 387532.0,
        "remaining_months": 31,
        "remaining_amount": 706676.0,
        "total_financed": 1094208.0,
        "total_car_price": 1445208.0
    },
    {
        "no": 7,
        "model": "Toyota Yaris Cross Auto1500CC",
        "plate": "6ขญ 3119",
        "chassis_no": "MR2A78BF004050706",
        "contract_no": "A10984839",
        "down_payment_date": "17/06/2024",
        "down_payment": 182297.28,
        "first_payment_date": "07/07/2024",
        "due_day": "ทุกวันที่ 7",
        "installment": 16323.0,
        "total_months": 48,
        "paid_2023_2024": 97938.0,
        "paid_2025": 146907.0,
        "paid_months": 15,
        "paid_amount": 244845.0,
        "remaining_months": 33,
        "remaining_amount": 538659.0,
        "total_financed": 783504.0,
        "total_car_price": 965801.28
    },
    {
        "no": 8,
        "model": "Toyota Majesty 2.8",
        "plate": "1นญ 1882",
        "chassis_no": "JTFXB3AP408007967",
        "contract_no": "A11013342",
        "down_payment_date": "02/09/2024",
        "down_payment": 667028.08,
        "first_payment_date": "02/10/2024",
        "due_day": "ทุกวันที่ 2",
        "installment": 40567.0,
        "total_months": 48,
        "paid_2023_2024": 121701.0,
        "paid_2025": 365103.0,
        "paid_months": 12,
        "paid_amount": 486804.0,
        "remaining_months": 36,
        "remaining_amount": 1460412.0,
        "total_financed": 1947216.0,
        "total_car_price": 2614244.08
    },
    {
        "no": 9,
        "model": "ORA Good Cat P",
        "plate": "7ขด 856",
        "chassis_no": "MNUAATD50SR010935",
        "contract_no": "6801869",
        "down_payment_date": "29/11/2024",
        "down_payment": 215880.0,
        "first_payment_date": "05/01/2025",
        "due_day": "ทุกวันที่ 5",
        "installment": 15720.0,
        "total_months": 48,
        "paid_2023_2024": 0.0,
        "paid_2025": 141480.0,
        "paid_months": 9,
        "paid_amount": 141480.0,
        "remaining_months": 39,
        "remaining_amount": 613080.0,
        "total_financed": 754560.0,
        "total_car_price": 970440.0
    },
    {
        "no": 10,
        "model": "ORA Good Cat P",
        "plate": "7ขฉ 2011",
        "chassis_no": "MNUAATD50SR010936",
        "contract_no": "6801875",
        "down_payment_date": "29/11/2024",
        "down_payment": 215880.0,
        "first_payment_date": "05/01/2025",
        "due_day": "ทุกวันที่ 5",
        "installment": 15720.0,
        "total_months": 48,
        "paid_2023_2024": 0.0,
        "paid_2025": 141480.0,
        "paid_months": 9,
        "paid_amount": 141480.0,
        "remaining_months": 39,
        "remaining_amount": 613080.0,
        "total_financed": 754560.0,
        "total_car_price": 970440.0
    },
    {
        "no": 11,
        "model": "All New Tank 300 HEV Pro",
        "plate": "7ขจ 1099",
        "chassis_no": "MNUBB7S70SR008610",
        "contract_no": "6801686",
        "down_payment_date": "03/11/2024",
        "down_payment": 457917.52,
        "first_payment_date": "10/12/2024",
        "due_day": "ทุกวันที่ 10",
        "installment": 25672.0,
        "total_months": 48,
        "paid_2023_2024": 25672.0,
        "paid_2025": 231048.0,
        "paid_months": 10,
        "paid_amount": 256720.0,
        "remaining_months": 38,
        "remaining_amount": 975536.0,
        "total_financed": 1232256.0,
        "total_car_price": 1690173.52
    },
    {
        "no": 12,
        "model": "Yaris Cross Auto1500CC",
        "plate": "7ขง 4611",
        "chassis_no": "MR2A78BF804075269",
        "contract_no": "A11166836",
        "down_payment_date": "08/09/2025",
        "down_payment": 276714.08,
        "first_payment_date": "08/10/2025",
        "due_day": "ทุกวันที่ 8",
        "installment": 13102.0,
        "total_months": 48,
        "paid_2023_2024": 0.0,
        "paid_2025": 0.0,
        "paid_months": 0,
        "paid_amount": 0.0,
        "remaining_months": 48,
        "remaining_amount": 628896.0,
        "total_financed": 628896.0,
        "total_car_price": 905610.08
    },
    {
        "no": 13,
        "model": "Veloz Auto1500CC",
        "plate": "7ขง 1762",
        "chassis_no": "MHFAB1BY000114785",
        "contract_no": "A11158158",
        "down_payment_date": "23/08/2025",
        "down_payment": 215868.08,
        "first_payment_date": "23/09/2025",
        "due_day": "ทุกวันที่ 23",
        "installment": 13584.0,
        "total_months": 48,
        "paid_2023_2024": 0.0,
        "paid_2025": 13584.0,
        "paid_months": 1,
        "paid_amount": 13584.0,
        "remaining_months": 47,
        "remaining_amount": 638448.0,
        "total_financed": 652032.0,
        "total_car_price": 867900.08
    },
    {
        "no": 14,
        "model": "CR-V 1.5ES",
        "plate": "พม 6999",
        "chassis_no": "MRHRY9879RP100803",
        "contract_no": "Bclick",
        "down_payment_date": "18/10/2024",
        "down_payment": 411140.0,
        "first_payment_date": "25/11/2024",
        "due_day": "ทุกวันที่ 25",
        "installment": 113390.0,
        "total_months": 12,
        "paid_2023_2024": 226780.0,
        "paid_2025": 1020510.0,
        "paid_months": 11,
        "paid_amount": 1247290.0,
        "remaining_months": 1,
        "remaining_amount": 113390.0,
        "total_financed": 1360680.0,
        "total_car_price": 1771820.0
    }
]

DEFAULT_HP_SUMMARY = {
    "total_contracts": 14,
    "total_down_payment": 4031555.56,
    "total_monthly_installment": 347095.0,
    "total_paid_2023_2024": 1396551.0,
    "total_paid_2025": 2800251.0,
    "total_paid_amount": 4325802.0,
    "total_remaining_amount": 8253198.0,
    "total_financed": 12579000.0,
    "total_car_price": 16610555.56
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
                            combined = {k: dict(v) for k, v in DEFAULT_CARS.items()}
                            for k, v in self.cars.items():
                                if k in combined:
                                    combined[k].update(v)
                                else:
                                    combined[k] = dict(v)
                            for k, v in fresh_cars.items():
                                if k in combined:
                                    combined[k].update({fk: fv for fk, fv in v.items() if fv is not None})
                                else:
                                    combined[k] = dict(v)
                            self.cars = deduplicate_cars_dict(combined, self.deleted_car_plates)
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

                # Persist payment metadata inside extension_history JSONB column
                ext_list = list(row.get("extension_history") or [])
                meta_item = {
                    "type": "payment_meta",
                    "deposit_ref": row.get("deposit_ref", ""),
                    "deposit_slip": row.get("deposit_slip", ""),
                    "rental_ref": row.get("rental_ref", ""),
                    "rental_slip": row.get("rental_slip", ""),
                    "deposit_method": row.get("deposit_method", ""),
                    "deposit_date": row.get("deposit_date", "")
                }
                ext_list = [x for x in ext_list if not (isinstance(x, dict) and x.get("type") == "payment_meta")]
                ext_list.append(meta_item)
                row["extension_history"] = ext_list

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
        SUPABASE_CAR_COLS = {
            'plate', 'brand', 'model', 'color', 'car_group', 'engine_cc', 'fuel_type',
            'company', 'price_day', 'price_week', 'price_month', 'status', 'chassis_no',
            'act_expiry', 'ins_expiry', 'mileage', 'image', 'created_at'
        }
        ALL_CAR_COLS = SUPABASE_CAR_COLS | {
            'owner', 'beneficiary', 'reg_year', 'tax_expiry', 'ins_company',
            'last_service_date', 'next_service', 'tire_change', 'notes',
            'hp_contract_no', 'hp_installment'
        }
        with self.lock:
            existing = dict(self.cars.get(plate, {}))
            existing.update(car_dict)
            existing["plate"] = plate
            clean_mem = {k: v for k, v in existing.items() if k in ALL_CAR_COLS}
            self.cars[plate] = clean_mem
            sb_payload = {k: v for k, v in clean_mem.items() if k in SUPABASE_CAR_COLS}
        self.save_local_cars()
        def _task():
            sb = get_supabase_client()
            if not sb: return
            try:
                sb.table("cars").upsert(sb_payload).execute()
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
        self.save_local_cars()
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
            existing = dict(self.users.get(username, {}))
            existing.update(u_dict)
            existing["username"] = username
            self.users[username] = existing
        self.save_local_users()
        def _task():
            sb = get_supabase_client()
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

    def close_maintenance_record(self, mnt_id, actual_cost=None, completion_notes="", new_mileage=None, recorded_by="admin", new_act_expiry=None, new_ins_expiry=None, policy_no=None):
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
                
            car_plate = rec.get("car_id")
            if car_plate and car_plate in self.cars:
                car = self.cars[car_plate]
                if car.get("status") in ["สถานะซ่อมบำรุง", "ซ่อมบำรุง", "ไม่พร้อมใช้งาน", "ต่อทะเบียน/ประกัน", "ต่อภาษี/ประกัน", "รอต่อทะเบียน"]:
                    car["status"] = "ว่างพร้อมใช้งาน"
                if new_mileage and str(new_mileage).strip():
                    car["mileage"] = str(new_mileage).strip()
                if new_act_expiry and str(new_act_expiry).strip() and str(new_act_expiry).strip() != "-":
                    car["act_expiry"] = str(new_act_expiry).strip()
                if new_ins_expiry and str(new_ins_expiry).strip() and str(new_ins_expiry).strip() != "-":
                    car["ins_expiry"] = str(new_ins_expiry).strip()
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
        # Wait 5 seconds before first loop
        time.sleep(5)
        while True:
            try:
                store.sync_from_supabase_async()
            except Exception as e:
                print(f"Background cloud sync loop error: {e}")
            time.sleep(120)
    t = threading.Thread(target=_loop, daemon=True, name="SupabaseBackgroundSync")
    t.start()
