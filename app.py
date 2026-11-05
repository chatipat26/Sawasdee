import streamlit as st
import pandas as pd
from datetime import datetime, timedelta, date, time as d_time
import os
import tempfile
import re
import base64
import io
import time
import urllib.request
import threading
import requests
import altair as alt
from pypdf import PdfReader, PdfWriter
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter, A4
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle

try:
    from supabase import create_client
except ImportError:
    create_client = None

# =========================================================================
# 1. การตั้งค่าหน้าจอ & โหลดฟอนต์ภาษาไทยอัตโนมัติ
# =========================================================================
st.set_page_config(
    page_title="SawasdeeRental — Front Office & Fleet Management",
    page_icon="🚙",
    layout="wide",
    initial_sidebar_state="expanded"
)

@st.cache_resource
def load_thai_font():
    font_path = "Sarabun-Regular.ttf"
    font_bold_path = "Sarabun-Bold.ttf"
    
    if not os.path.exists(font_path):
        try:
            urllib.request.urlretrieve("https://github.com/google/fonts/raw/main/ofl/sarabun/Sarabun-Regular.ttf", font_path)
            urllib.request.urlretrieve("https://github.com/google/fonts/raw/main/ofl/sarabun/Sarabun-Bold.ttf", font_bold_path)
        except Exception:
            pass
            
    if os.path.exists(font_path):
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont
        pdfmetrics.registerFont(TTFont('Sarabun', font_path))
        if os.path.exists(font_bold_path):
            pdfmetrics.registerFont(TTFont('Sarabun-Bold', font_bold_path))
        else:
            pdfmetrics.registerFont(TTFont('Sarabun-Bold', font_path))
        return 'Sarabun', 'Sarabun-Bold'
    return 'Helvetica', 'Helvetica-Bold'

FONT_REGULAR, FONT_BOLD = load_thai_font()

def get_base64_image(image_path):
    if os.path.exists(image_path):
        with open(image_path, "rb") as img_file:
            return base64.b64encode(img_file.read()).decode()
    return ""

def format_date_dmy(date_val):
    if not date_val: return "-"
    if isinstance(date_val, str):
        try: return datetime.strptime(date_val, "%Y-%m-%d").date().strftime("%d/%m/%Y")
        except: return date_val
    elif isinstance(date_val, (datetime, date)):
        return date_val.strftime("%d/%m/%Y")
    return str(date_val)

def to_date(d):
    if not d: return None
    if isinstance(d, datetime): return d.date()
    if isinstance(d, date): return d
    if isinstance(d, str):
        d_str = d.strip()
        if not d_str or d_str in ("-", "None", "none", "null"):
            return None
        for fmt in ('%Y-%m-%d', '%d/%m/%Y'):
            try:
                dt = datetime.strptime(d_str, fmt).date()
                if dt.year > 2400:
                    dt = dt.replace(year=dt.year - 543)
                return dt
            except: pass
    return None

def to_date_safe(d):
    """แปลงค่าวันที่จาก DB (str, date, datetime) เป็น date object อย่างปลอดภัย หรือ None หากไม่มีข้อมูล"""
    return to_date(d)

def parse_date_dmy(d, default_date=None):
    parsed = to_date(d)
    return parsed if parsed is not None else default_date

def format_date_for_db(d, fmt="%d/%m/%Y"):
    """แปลง date object กลับเป็น String รูปแบบเดิมสำหรับบันทึกลง DB ป้องกัน TypeError: Object of type date is not JSON serializable"""
    if not d or d in ("-", "None", "none", "null", ""):
        return "-"
    if isinstance(d, (date, datetime)):
        return d.strftime(fmt)
    if isinstance(d, str):
        cleaned = d.strip()
        parsed = to_date(cleaned)
        return parsed.strftime(fmt) if parsed else (cleaned or "-")
    return str(d)

def is_car_available_on_date(car_plate, car_obj, check_date, bookings):
    if car_obj.get('status') == 'ซ่อมบำรุง':
        return False
    if not check_date:
        return True
    
    start_filter = None
    end_filter = None
    if isinstance(check_date, (list, tuple)):
        if len(check_date) >= 2:
            start_filter, end_filter = to_date(check_date[0]), to_date(check_date[1])
        elif len(check_date) == 1:
            start_filter = end_filter = to_date(check_date[0])
    else:
        start_filter = end_filter = to_date(check_date)
        
    if not start_filter:
        return True
    if not end_filter:
        end_filter = start_filter
        
    for b in bookings:
        if b.get('car_id') != car_plate:
            continue
        if b.get('status') in ['เสร็จสิ้น', 'ยกเลิก']:
            continue
        b_s = to_date(b.get('start_date'))
        b_e = to_date(b.get('end_date'))
        if b_s and b_e:
            if not (b_e < start_filter or b_s > end_filter):
                return False
    return True

def get_car_fleet_status(car_plate, car_obj, bookings, filter_start_date=None, filter_end_date=None):
    """
    คำนวณสถานะรถยนต์สำหรับแสดงจุดสีบอกสถานะหลังชื่อรุ่นรถ:
    - สีส้ม: สถานะซ่อมบำรุง
    - สีแดง: ไม่ว่างในวันที่เลือก (หรือกำลังเช่าอยู่ ณ ปัจจุบันกรณีไม่ได้เลือกวันที่)
    - สีเหลือง: มีการจองล่วงหน้าไว้ (ในวันที่เลือกยังว่าง แต่มีคิวจองล่วงหน้าช่วงอื่น)
    - สีเขียว: ว่างไม่มีการจอง (ว่างพร้อมใช้งาน และไม่มีคิวจองใดๆ)
    """
    c_status = str((car_obj or {}).get('status') or '').strip()
    
    # 1. สีส้ม: สถานะซ่อมบำรุง
    if c_status == 'ซ่อมบำรุง':
        return {
            "code": "maintenance",
            "color": "#F97316",
            "shadow": "rgba(249, 115, 22, 0.55)",
            "label": "ซ่อมบำรุง",
            "desc": "สถานะซ่อมบำรุง"
        }
    
    # 2. วันที่เป้าหมายสำหรับตรวจสอบความพร้อมใช้งาน
    today = date.today()
    has_date_filter = bool(filter_start_date)
    chk_s = to_date(filter_start_date) if has_date_filter else today
    chk_e = to_date(filter_end_date) if filter_end_date else chk_s
    if chk_s and chk_e and chk_e < chk_s:
        chk_e = chk_s
        
    active_bks = []
    if bookings:
        for b in bookings:
            if b.get('car_id') != car_plate:
                continue
            if b.get('status') in ['เสร็จสิ้น', 'ยกเลิก']:
                continue
            active_bks.append(b)
            
    is_booked_on_selected_date = False
    if chk_s and chk_e:
        for b in active_bks:
            b_s = to_date(b.get('start_date'))
            b_e = to_date(b.get('end_date'))
            if b_s and b_e:
                if not (b_e < chk_s or b_s > chk_e):
                    is_booked_on_selected_date = True
                    break
                    
    is_currently_rented = False
    if not has_date_filter:
        if c_status in ['กำลังเช่า', 'รอส่งมอบ', 'เตรียมส่งมอบ', 'เตรียมรับคืน']:
            is_currently_rented = True
        elif is_booked_on_selected_date:
            is_currently_rented = True
            
    # 2. สีแดง: ไม่ว่างในวันที่เลือก
    if (has_date_filter and is_booked_on_selected_date) or (not has_date_filter and (is_currently_rented or is_booked_on_selected_date)):
        desc_txt = "ไม่ว่างในวันที่เลือก" if has_date_filter else "ไม่ว่างในวันที่เลือก (กำลังเช่า/มีคิวใช้งาน)"
        return {
            "code": "unavailable",
            "color": "#EF4444",
            "shadow": "rgba(239, 68, 68, 0.55)",
            "label": "ไม่ว่างในวันที่เลือก",
            "desc": desc_txt
        }
        
    # 3. สีเหลือง: มีการจองล่วงหน้าไว้
    has_advance_booking = False
    if c_status == 'ติดจอง':
        has_advance_booking = True
    elif active_bks:
        for b in active_bks:
            b_e = to_date(b.get('end_date'))
            b_s = to_date(b.get('start_date'))
            if (b_e and b_e >= today) or (b_s and b_s >= today):
                has_advance_booking = True
                break
                
    if has_advance_booking:
        return {
            "code": "reserved",
            "color": "#F59E0B",
            "shadow": "rgba(245, 158, 11, 0.55)",
            "label": "มีการจองล่วงหน้าไว้",
            "desc": "มีการจองล่วงหน้าไว้"
        }
        
    # 4. สีเขียว: ว่างไม่มีการจอง
    return {
        "code": "available",
        "color": "#10B981",
        "shadow": "rgba(16, 185, 129, 0.55)",
        "label": "ว่างไม่มีการจอง",
        "desc": "ว่างไม่มีการจอง"
    }

def parse_time_val(t_val, default_time=d_time(10, 0)):
    if not t_val:
        return default_time
    if isinstance(t_val, d_time):
        return t_val
    if isinstance(t_val, datetime):
        return t_val.time()
    if isinstance(t_val, str) and t_val.strip():
        for fmt in ("%H:%M", "%H:%M:%S"):
            try:
                return datetime.strptime(t_val.strip(), fmt).time()
            except ValueError:
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
        explanation = f"{billable_days} วัน ({billable_days * 24} ชม. · เกิน {extra_hours} ชม. ปรับเป็น 1 วัน)"
    else:
        billable_days = max(1, base_days)
        if extra_hours > 0 or rem_minutes > 0:
            explanation = f"{billable_days} วัน ({billable_days * 24} ชม. · อนุโลม ≤ 4 ชม.)"
        else:
            explanation = f"{billable_days} วัน ({billable_days * 24} ชม.)"
            
    return billable_days, extra_hours, rem_minutes, is_over_4hr, explanation

logo_file = ""
for name in ["sawasdee-logo.png", "logo.png", "assets/sawasdee-logo.png"]:
    if os.path.exists(name):
        logo_file = name
        break
bg_image_base64 = get_base64_image(logo_file) if logo_file else ""

# =========================================================================
# 2. ฟังก์ชันออกเอกสาร PDF (ปรับจูนพิกัดตรงตามโครงสร้าง Template เป๊ะ 100%)
# =========================================================================
def generate_filled_pdf(template_path, booking_info, customer_info, car_info):
    try:
        if not os.path.exists(template_path):
            return generate_pdf_bytes(booking_info, customer_info, car_info)
            
        booking_info = booking_info or {}
        customer_info = customer_info or {}
        car_info = car_info or {}
            
        packet = io.BytesIO()
        can = canvas.Canvas(packet, pagesize=A4)
        
        car_brand_model = f"{car_info.get('brand', '')} {car_info.get('model', '')}".strip() or "-"
        car_plate = str(car_info.get("plate", "-"))
        car_color = str(car_info.get("color", "-"))
        s_time_pdf = booking_info.get('start_time', '10:00')
        e_time_pdf = booking_info.get('end_time', '10:00')
        s_date = f"{format_date_dmy(booking_info.get('start_date'))} ({s_time_pdf})"
        e_date = f"{format_date_dmy(booking_info.get('end_date'))} ({e_time_pdf})"
        net_price = booking_info.get('net_price', 0)
        price_val = f"{net_price:,}" if isinstance(net_price, (int, float)) else str(net_price)
        b_id = str(booking_info.get("booking_id", "-"))
        
        c_name = str(customer_info.get("full_name", "-"))
        c_nat = str(customer_info.get("nationality", "-"))
        c_dob = format_date_dmy(customer_info.get("dob", "-"))
        c_pass = str(customer_info.get("passport_id", "-"))
        c_lic = str(customer_info.get("licence_no", "-"))
        c_lic_issue = str(customer_info.get("issue_place", "-"))
        c_lic_exp = format_date_dmy(customer_info.get("licence_expiry", "-"))
        c_home = str(customer_info.get("home_address", "-"))
        c_thai = str(customer_info.get("thai_address", "-"))
        c_email = str(customer_info.get("email", "-"))
        c_phone = str(customer_info.get("contact_no", "-"))
        c_wa = str(customer_info.get("whatsapp", "-"))
        
        loc_del = str(booking_info.get("loc_delivery", "Sukhumvit"))
        loc_ret = str(booking_info.get("loc_return", loc_del))
        
        # --- 0. Header (Reference No. & Date มุมขวาบน) ---
        can.setFont(FONT_BOLD, 12)
        can.setFillColorRGB(0.1, 0.1, 0.1)
        can.drawString(485, 782, b_id)
        can.setFont(FONT_REGULAR, 7.5)
        can.drawString(485, 768, f"Issued: {format_date_dmy(datetime.now().date())}")
        
        # --- 1. Section 01: VEHICLE ---
        # กล่อง MODEL พื้นหลังสีดำ ต้องใช้ฟอนต์สีขาว
        can.setFillColorRGB(1, 1, 1)
        can.setFont(FONT_BOLD, 9.5)
        can.drawString(44, 701, car_brand_model)
        
        # กล่อง REGISTRATION และ COLOUR พื้นหลังขาว ใช้ตัวอักษรสีเข้ม
        can.setFillColorRGB(0.15, 0.15, 0.15)
        can.setFont(FONT_REGULAR, 9)
        can.drawString(250, 701, car_plate)
        can.drawString(355, 701, car_color)
        
        # --- 2. Section 02: RENTER ---
        can.setFont(FONT_REGULAR, 8.5)
        can.drawString(37, 601, c_name)
        can.drawString(215, 601, c_nat)
        can.drawString(393, 601, c_dob)
        
        can.drawString(37, 573, c_lic)
        can.drawString(170, 573, c_lic_issue)
        can.drawString(304, 573, c_lic_exp)
        can.drawString(437, 573, c_pass)
        
        # ที่อยู่
        can.setFont(FONT_REGULAR, 8)
        can.drawString(37, 544, c_home[:55] if len(c_home) > 55 else c_home)
        
        # ลบขีดแดชเดิมในแม่แบบออกก่อนพิมพ์ที่อยู่ในไทย
        if c_thai and c_thai != "-":
            can.setFillColorRGB(1, 1, 1)
            can.rect(304, 541, 14, 10, fill=1, stroke=0)
            can.setFillColorRGB(0.15, 0.15, 0.15)
            can.drawString(304, 544, c_thai[:55] if len(c_thai) > 55 else c_thai)
        
        # ข้อมูลติดต่อ
        can.setFont(FONT_REGULAR, 8.5)
        can.drawString(37, 516, c_email)
        can.drawString(215, 516, c_phone)
        can.drawString(393, 516, c_wa)
        
        # --- 3. Section 03: RENTAL PERIOD & DELIVERY ---
        can.setFont(FONT_REGULAR, 8.5)
        can.drawString(37, 474, s_date)
        
        if loc_del and loc_del != "-":
            can.setFillColorRGB(1, 1, 1)
            can.rect(170, 471, 14, 10, fill=1, stroke=0)
            can.setFillColorRGB(0.15, 0.15, 0.15)
            can.drawString(170, 474, loc_del[:30])
            
        can.drawString(304, 474, e_date)
        
        if loc_ret and loc_ret != "-":
            can.setFillColorRGB(1, 1, 1)
            can.rect(437, 471, 14, 10, fill=1, stroke=0)
            can.setFillColorRGB(0.15, 0.15, 0.15)
            can.drawString(437, 474, loc_ret[:30])
        
        # --- 4. Section 04: CHARGES (กล่องขาวในแถบสีส้ม TO BE INVOICED) ---
        can.setFont(FONT_BOLD, 10)
        can.setFillColorRGB(0.9, 0.35, 0.15)
        can.drawString(498, 303, f"฿ {price_val}")
        
        # --- 5. Section 05: PAYMENT CONFIRMATION ---
        can.setFillColorRGB(0.15, 0.15, 0.15)
        can.setFont(FONT_REGULAR, 8)
        can.drawString(37, 259, b_id)
        can.setFont(FONT_BOLD, 8.5)
        can.drawString(231, 259, f"THB {price_val}")
        
        can.save()
        packet.seek(0)
        new_pdf = PdfReader(packet)
        
        existing_pdf = PdfReader(open(template_path, "rb"))
        output = PdfWriter()
        
        page = existing_pdf.pages[0]
        page.merge_page(new_pdf.pages[0])
        output.add_page(page)
        
        for i in range(1, len(existing_pdf.pages)):
            output.add_page(existing_pdf.pages[i])
            
        output_stream = io.BytesIO()
        output.write(output_stream)
        return output_stream.getvalue()
        
    except Exception as e:
        return generate_pdf_bytes(booking_info, customer_info, car_info)

def generate_pdf_bytes(booking_info=None, customer_info=None, car_info=None):
    pdf_buffer = io.BytesIO()
    doc = SimpleDocTemplate(pdf_buffer, pagesize=A4, rightMargin=36, leftMargin=36, topMargin=36, bottomMargin=36)
    elements = []
    styles = getSampleStyleSheet()
    
    title_style = ParagraphStyle('TitleStyle', parent=styles['Heading1'], fontSize=16, leading=20, textColor=colors.HexColor('#E85826'), alignment=1, fontName=FONT_BOLD)
    sub_style = ParagraphStyle('SubStyle', parent=styles['Normal'], fontSize=9.5, leading=14, textColor=colors.HexColor('#555555'), alignment=1, fontName=FONT_REGULAR)
    h2_style = ParagraphStyle('H2Style', parent=styles['Heading2'], fontSize=11, leading=15, textColor=colors.HexColor('#2D2D2D'), spaceBefore=10, spaceAfter=4, fontName=FONT_BOLD)
    normal_style = ParagraphStyle('NormalThai', parent=styles['Normal'], fontName=FONT_REGULAR)
    
    b_id = booking_info.get("booking_id", "-") if booking_info else "-"
    c_name = customer_info.get("full_name", "-") if customer_info else "-"
    c_nat = customer_info.get("nationality", "-") if customer_info else "-"
    c_lic = customer_info.get("licence_no", "-") if customer_info else "-"
    car_name = f"{car_info.get('brand', '')} {car_info.get('model', '')}" if car_info else "-"
    car_plate = car_info.get("plate", "-") if car_info else "-"
    s_date = format_date_dmy(booking_info.get("start_date")) if booking_info else "-"
    e_date = format_date_dmy(booking_info.get("end_date")) if booking_info else "-"
    price_val = f"THB {booking_info.get('net_price', 0):,}" if booking_info else "THB 0"

    elements.append(Paragraph("SAWASDEE CAR RENTAL CO., LTD.", title_style))
    elements.append(Paragraph("MASTER VEHICLE LEASE AGREEMENT", sub_style))
    elements.append(Paragraph(f"Reference No: <b>{b_id}</b> | Generated: {datetime.now().strftime('%d/%m/%Y')}", sub_style))
    elements.append(Spacer(1, 15))
    
    elements.append(Paragraph("1. CONTRACT PARTICULARS & VEHICLE SPECIFICATIONS", h2_style))
    data = [
        ["Renter Name", c_name, "Vehicle Model", car_name],
        ["Nationality", c_nat, "License Plate", car_plate],
        ["Driver License No.", c_lic, "Net Rental Price", price_val],
        ["Handover Schedule", s_date, "Return Schedule", e_date]
    ]
    t = Table(data, colWidths=[120, 160, 110, 150])
    t.setStyle(TableStyle([('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#FDFBF7')), ('TEXTCOLOR', (0,0), (-1,-1), colors.HexColor('#2D2D2D')), ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#E0D5C7')), ('FONTNAME', (0,0), (-1,-1), FONT_REGULAR), ('FONTSIZE', (0,0), (-1,-1), 9), ('BOTTOMPADDING', (0,0), (-1,-1), 6), ('TOPPADDING', (0,0), (-1,-1), 6), ('FONTNAME', (0,0), (0,-1), FONT_BOLD)]))
    elements.append(t)
    elements.append(Spacer(1, 15))
    
    elements.append(Paragraph("2. TERMS OF AGREEMENT", h2_style))
    terms_text = ("1. The Renter agrees to operate the vehicle in strict compliance with applicable laws.<br/>2. Fuel condition at handover must be matched upon return.<br/>3. Insurance coverage is governed under the designated company policy terms.<br/>4. Subleasing or unauthorized assignment of the vehicle is strictly prohibited.")
    elements.append(Paragraph(terms_text, normal_style))
    elements.append(Spacer(1, 40))
    
    sig_data = [["____________________________________", "____________________________________"], ["Authorized Signatory (Sawasdee Rental)", f"Authorized Signatory ({c_name})"], [f"Date: {datetime.now().strftime('%d/%m/%Y')}", f"Date: {datetime.now().strftime('%d/%m/%Y')}"]]
    sig_table = Table(sig_data, colWidths=[270, 270])
    sig_table.setStyle(TableStyle([('ALIGN', (0,0), (-1,-1), 'CENTER'), ('FONTNAME', (0,0), (-1,-1), FONT_REGULAR), ('FONTSIZE', (0,0), (-1,-1), 9)]))
    elements.append(sig_table)
    
    doc.build(elements)
    return pdf_buffer.getvalue()

def generate_receipt_bytes(receipt_no, booking_info, customer_info, car_info, amount, method, item_desc="ค่าเช่ารถยนต์ (Vehicle Rental Fee)"):
    pdf_buffer = io.BytesIO()
    doc = SimpleDocTemplate(pdf_buffer, pagesize=A4, rightMargin=36, leftMargin=36, topMargin=36, bottomMargin=36)
    elements = []
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle('TitleStyle', parent=styles['Heading1'], fontSize=16, leading=20, textColor=colors.HexColor('#E85826'), alignment=1, fontName=FONT_BOLD)
    sub_style = ParagraphStyle('SubStyle', parent=styles['Normal'], fontSize=9.5, leading=14, textColor=colors.HexColor('#555555'), alignment=1, fontName=FONT_REGULAR)
    
    elements.append(Paragraph("SAWASDEE CAR RENTAL CO., LTD.", title_style))
    elements.append(Paragraph("OFFICIAL RECEIPT / ใบเสร็จรับเงิน", sub_style))
    elements.append(Paragraph(f"Receipt No: <b>{receipt_no}</b> | Date: {datetime.now().strftime('%d/%m/%Y %H:%M')}", sub_style))
    elements.append(Spacer(1, 20))
    
    c_name = customer_info.get("full_name", "-") if customer_info else "-"
    b_id = booking_info.get("booking_id", "-") if booking_info else "-"
    car_name = f"{car_info.get('brand', '')} {car_info.get('model', '')} ({car_info.get('plate', '')})" if car_info else "-"
    
    data = [
        ["Received From (ได้รับเงินจาก):", c_name],
        ["Reference Booking (รหัสการจอง):", b_id],
        ["Vehicle (รถยนต์ที่เช่า):", car_name],
        ["Description (รายการชำระ):", item_desc],
        ["Payment Method (ช่องทางชำระ):", method],
        ["Amount Received (ยอดเงินที่รับชำระ):", f"THB {amount:,.2f}"]
    ]
    t = Table(data, colWidths=[200, 300])
    t.setStyle(TableStyle([('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#FFFFFF')), ('TEXTCOLOR', (0,0), (-1,-1), colors.HexColor('#2D2D2D')), ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#E0D5C7')), ('FONTNAME', (0,0), (-1,-1), FONT_REGULAR), ('FONTSIZE', (0,0), (-1,-1), 10), ('BOTTOMPADDING', (0,0), (-1,-1), 8), ('TOPPADDING', (0,0), (-1,-1), 8), ('FONTNAME', (0,0), (0,-1), FONT_BOLD)]))
    elements.append(t)
    elements.append(Spacer(1, 40))
    
    sig_data = [["____________________________________"], ["Authorized Signature / ผู้รับเงิน"]]
    sig_table = Table(sig_data, colWidths=[200])
    sig_table.setStyle(TableStyle([('ALIGN', (0,0), (-1,-1), 'RIGHT'), ('FONTNAME', (0,0), (-1,-1), FONT_REGULAR), ('FONTSIZE', (0,0), (-1,-1), 9)]))
    elements.append(sig_table)
    
    doc.build(elements)
    return pdf_buffer.getvalue()

def generate_job_pdf(booking_info, customer_info, car_info, job_type="Dispatch", worker=None, loc=None, inspection_data=None):
    pdf_buffer = io.BytesIO()
    doc = SimpleDocTemplate(pdf_buffer, pagesize=A4, rightMargin=36, leftMargin=36, topMargin=36, bottomMargin=36)
    elements = []
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle('TitleStyle', parent=styles['Heading1'], fontSize=16, leading=20, textColor=colors.HexColor('#1F2937'), alignment=1, fontName=FONT_BOLD)
    sub_style = ParagraphStyle('SubStyle', parent=styles['Normal'], fontSize=9.5, leading=14, textColor=colors.HexColor('#555555'), alignment=1, fontName=FONT_REGULAR)
    
    insp = inspection_data or {}
    fuel_val = insp.get("fuel_level") or booking_info.get("return_fuel") or booking_info.get("dispatch_fuel") or "เต็มถัง (100%)"
    mile_val = insp.get("mileage") or booking_info.get("return_mileage") or booking_info.get("dispatch_mileage") or (car_info.get("mileage", "-") if car_info else "-")
    notes_val = insp.get("inspection_notes") or booking_info.get("return_notes") or booking_info.get("dispatch_notes") or "ตรวจสภาพปกติ เรียบร้อยดี"
    
    doc_title = "VEHICLE INSPECTION CHECKLIST (ใบตรวจสภาพรถยนต์ & ลิสต์เช็ครถ)"
    elements.append(Paragraph("SAWASDEE CAR RENTAL CO., LTD.", title_style))
    elements.append(Paragraph(doc_title, title_style))
    elements.append(Paragraph(f"Booking Ref: <b>{booking_info.get('booking_id', '-')}</b> | วันที่บันทึก: {datetime.now().strftime('%d/%m/%Y %H:%M')}", sub_style))
    elements.append(Spacer(1, 16))
    
    c_name = customer_info.get("full_name", "-") if customer_info else "-"
    car_name = f"{car_info.get('brand', '')} {car_info.get('model', '')} ({car_info.get('plate', '')})" if car_info else "-"
    w_val = worker if worker and worker.strip() else (booking_info.get("worker_return") or booking_info.get("worker_delivery") or "-")
    l_val = loc if loc and loc.strip() else (booking_info.get("loc_return") or booking_info.get("loc_delivery") or "-")
    
    data = [
        ["Customer Name (ลูกค้า):", c_name], ["Vehicle (รถยนต์):", car_name],
        ["Rental Period (ระยะเวลาเช่า):", f"{format_date_dmy(booking_info.get('start_date'))} ({booking_info.get('start_time', '10:00')}) - {format_date_dmy(booking_info.get('end_date'))} ({booking_info.get('end_time', '10:00')})"],
        ["Assigned Staff (พนักงานส่ง/รับรถ):", w_val], ["Location (สถานที่นัดหมาย):", l_val],
        ["Fuel Level (ระดับน้ำมัน):", str(fuel_val)], ["Mileage (เลขไมล์สะสม):", f"{mile_val} km"]
    ]
    t = Table(data, colWidths=[160, 340])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#FFFFFF')),
        ('TEXTCOLOR', (0,0), (-1,-1), colors.HexColor('#2D2D2D')),
        ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#E0D5C7')),
        ('FONTNAME', (0,0), (-1,-1), FONT_REGULAR),
        ('FONTSIZE', (0,0), (-1,-1), 9.5),
        ('BOTTOMPADDING', (0,0), (-1,-1), 6),
        ('TOPPADDING', (0,0), (-1,-1), 6),
        ('FONTNAME', (0,0), (0,-1), FONT_BOLD)
    ]))
    elements.append(t)
    elements.append(Spacer(1, 14))
    
    chk_title = Paragraph("<b>VEHICLE HANDOVER & INSPECTION CHECKLIST (รายการตรวจสภาพรถยนต์ & ลิสต์เช็ครถ)</b>", ParagraphStyle('ChkTitle', parent=styles['Normal'], fontSize=10, leading=14, textColor=colors.HexColor('#1F2937'), fontName=FONT_BOLD))
    elements.append(chk_title)
    elements.append(Spacer(1, 6))
    
    chk_data = [
        ["No.", "Inspection Item (รายการตรวจเช็ค)", "Condition (สภาพ)", "Status (ผลการตรวจ)"],
        ["1", "Fuel Gauge (ระดับน้ำมันเชื้อเพลิง)", str(fuel_val), "[ / ] Pass (ผ่าน)"],
        ["2", "Exterior Body & Paint (สภาพตัวถังและสี)", "Clean / No new dents (สมบูรณ์ ไม่มีรอยขีดข่วนใหม่)", "[ / ] Pass (ผ่าน)"],
        ["3", "Tires & Pressure (สภาพยางและลมยาง)", "Good condition (พร้อมใช้งาน 4 เส้น)", "[ / ] Pass (ผ่าน)"],
        ["4", "Spare Tire & Tools (ยางอะไหล่และแม่แรง)", "Complete set (ครบชุดประจำรถ)", "[ / ] Pass (ผ่าน)"],
        ["5", "Documents (สำเนา พรบ./ประกันภัย/ภาษี)", "Complete in vehicle (ครบถ้วนในรถ)", "[ / ] Pass (ผ่าน)"],
        ["6", "Cleanliness & Sanitize (ความสะอาด)", "Interior sanitized (สะอาดเรียบร้อย)", "[ / ] Pass (ผ่าน)"],
        ["7", "Inspection Notes (หมายเหตุสภาพรถ)", str(notes_val)[:45] if len(str(notes_val)) > 45 else str(notes_val), "[ / ] Verified"]
    ]
    chk_table = Table(chk_data, colWidths=[25, 205, 180, 90])
    chk_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#F3EDE4')),
        ('TEXTCOLOR', (0,0), (-1,-1), colors.HexColor('#2D2D2D')),
        ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#E0D5C7')),
        ('FONTNAME', (0,0), (-1,-1), FONT_REGULAR),
        ('FONTSIZE', (0,0), (-1,-1), 8.5),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
        ('TOPPADDING', (0,0), (-1,-1), 4),
        ('FONTNAME', (0,0), (-1,0), FONT_BOLD),
        ('ALIGN', (0,0), (0,-1), 'CENTER'),
        ('ALIGN', (3,0), (3,-1), 'CENTER'),
    ]))
    elements.append(chk_table)
    elements.append(Spacer(1, 24))
    
    sig_data = [["____________________________________", "____________________________________"], ["Staff Signature (ลายเซ็นพนักงาน)", "Customer Signature (ลายเซ็นลูกค้า)"]]
    sig_table = Table(sig_data, colWidths=[250, 250])
    sig_table.setStyle(TableStyle([('ALIGN', (0,0), (-1,-1), 'CENTER'), ('FONTNAME', (0,0), (-1,-1), FONT_REGULAR), ('FONTSIZE', (0,0), (-1,-1), 9)]))
    elements.append(sig_table)
    
    doc.build(elements)
    return pdf_buffer.getvalue()

# =========================================================================
# 2.1 LINE MESSAGING API NOTIFICATIONS
# =========================================================================
LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push"
LINE_BROADCAST_URL = "https://api.line.me/v2/bot/message/broadcast"
LINE_DEFAULT_CHANNEL_ACCESS_TOKEN = (
    "V9Sc5Zmu4av4UzX+NbGNmkNCWM21aKchTJQw8ueOsGwilCWGv9c+AEqFtrKC4OG0fVwFy7l+"
    "wa5FVw0nrBGx8mz6zAHcdBY5hn4eBJApNwQ7oXOhSfgvzKHjxh6UGkqytCrLndQQAcVxcI+FFcGxMwdB04t89/1O/w1cDnyilFU="
)
LINE_DEFAULT_TARGET_USER_ID = "Ub7b6353ba826c0ba5c3d9fac3531ef77"

def get_line_credentials():
    token = None
    user_id = None
    try:
        token = st.secrets.get("LINE_CHANNEL_ACCESS_TOKEN")
        user_id = st.secrets.get("LINE_TARGET_USER_ID") or st.secrets.get("LINE_USER_ID")
    except Exception:
        pass
    if not token:
        token = os.environ.get("LINE_CHANNEL_ACCESS_TOKEN", LINE_DEFAULT_CHANNEL_ACCESS_TOKEN)
    if not user_id:
        user_id = os.environ.get("LINE_TARGET_USER_ID", LINE_DEFAULT_TARGET_USER_ID)
    return token, user_id

def send_line_broadcast_message(message: str, channel_access_token: str = None) -> bool:
    """
    ส่งข้อความแจ้งเตือนแบบ Broadcast ไปยังทุกคนที่เป็นเพื่อนกับบอท (ไม่ต้องระบุ User ID)
    """
    try:
        def_token, _ = get_line_credentials()
        token = channel_access_token or def_token
        if not token:
            return False
            
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}"
        }
        payload = {
            "messages": [
                {
                    "type": "text",
                    "text": message
                }
            ]
        }
        res = requests.post(LINE_BROADCAST_URL, headers=headers, json=payload, timeout=8)
        if res.status_code == 200:
            return True
        else:
            print(f"LINE Broadcast Error: HTTP {res.status_code} - {res.text}")
            return False
    except Exception as e:
        print(f"LINE Broadcast Error: {e}")
        return False

def send_line_push_message(message: str, to_user_id: str = None, channel_access_token: str = None) -> bool:
    try:
        def_token, def_user = get_line_credentials()
        token = channel_access_token or def_token
        target = to_user_id or def_user
        if not token or not target:
            return False
            
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}"
        }
        payload = {
            "to": target,
            "messages": [
                {
                    "type": "text",
                    "text": message
                }
            ]
        }
        res = requests.post(LINE_PUSH_URL, headers=headers, json=payload, timeout=8)
        return res.status_code == 200
    except Exception as e:
        print(f"LINE Notification Error: {e}")
        return False

def send_line_push_async(message: str, to_user_id: str = None):
    """
    ส่งข้อความแบบ asynchronous เบื้องหลัง
    - หากไม่ระบุ to_user_id จะส่งแบบ Broadcast ไปหาทุกคนที่เป็นเพื่อนกับบอท
    - หากระบุ to_user_id จะส่งตรงไปยัง user/group นั้น
    """
    def _worker():
        if to_user_id:
            send_line_push_message(message, to_user_id=to_user_id)
        else:
            send_line_broadcast_message(message)

    try:
        t = threading.Thread(target=_worker, daemon=True)
        t.start()
    except Exception:
        try:
            _worker()
        except Exception:
            pass

def notify_line_work_order(booking_obj, job_type="Dispatch", worker_name="", location="", appointment_time=""):
    """
    ส่งข้อความแจ้งเตือนผ่าน LINE Messaging API เมื่อมีการออกใบงานส่งมอบรถ หรือใบงานรับรถคืน
    ข้อมูลที่ส่ง:
    1. ชื่อผู้รับผิดชอบ (พนักงาน/คนขับรถ)
    2. เลขทะเบียนรถ (พร้อมยี่ห้อ/รุ่น)
    3. วันที่ส่งรถ หรือ วันที่รับรถ (พร้อมเวลานัดหมาย)
    4. สถานที่ที่ลงในใบงาน
    5. ชื่อและเบอร์โทรลูกค้า
    """
    if not booking_obj:
        return
    try:
        bk_id = booking_obj.get("booking_id", "-")
        plate = booking_obj.get("car_id", "-")
        cust_name = booking_obj.get("customer", "-")

        # 1. ข้อมูลรถยนต์ (ยี่ห้อ/รุ่น)
        cars_db = {}
        if hasattr(st, "session_state") and "cars_db" in st.session_state:
            cars_db = st.session_state.cars_db
        elif "_GLOBAL_STORE" in globals() and _GLOBAL_STORE.get("cars_db"):
            cars_db = _GLOBAL_STORE["cars_db"]
        
        car_info = cars_db.get(plate, {}) if isinstance(cars_db, dict) else {}
        brand = car_info.get("brand", "").strip()
        model = car_info.get("model", "").strip()
        car_desc = f"{brand} {model}".strip()
        car_display = f"{car_desc} (ทะเบียน {plate})" if car_desc else f"ทะเบียน {plate}"

        # 2. ข้อมูลเบอร์โทรลูกค้า
        cust_db = {}
        if hasattr(st, "session_state") and "customers_db" in st.session_state:
            cust_db = st.session_state.customers_db
        elif "_GLOBAL_STORE" in globals() and _GLOBAL_STORE.get("customers_db"):
            cust_db = _GLOBAL_STORE["customers_db"]
            
        cust_info = cust_db.get(cust_name, {}) if isinstance(cust_db, dict) else {}
        cust_phone = (
            cust_info.get("contact_no")
            or booking_obj.get("contact_no")
            or booking_obj.get("phone")
            or booking_obj.get("customer_phone")
            or "-"
        )
        if not cust_phone or str(cust_phone).strip() in ["", "-", "None"]:
            cust_phone = "ไม่ระบุเบอร์โทร"

        # 3. ข้อมูลตามประเภทใบงาน
        is_dispatch = str(job_type).lower() in ["dispatch", "delivery", "ส่งรถ", "ส่งมอบรถ"]
        if is_dispatch:
            title = "🚚 แจ้งเตือน: ออกใบงานส่งมอบรถ (Dispatch)"
            action_label = "วันที่ส่งมอบ"
            date_val = format_date_dmy(booking_obj.get("start_date"))
            time_val = appointment_time or booking_obj.get("start_time", "10:00")
            loc_val = location or booking_obj.get("loc_delivery") or "-"
            worker_val = worker_name or booking_obj.get("worker_delivery") or "-"
        else:
            title = "🔙 แจ้งเตือน: ออกใบงานรับรถคืน (Return)"
            action_label = "วันที่รับคืน"
            date_val = format_date_dmy(booking_obj.get("end_date"))
            time_val = appointment_time or booking_obj.get("end_time", "10:00")
            loc_val = location or booking_obj.get("loc_return") or "-"
            worker_val = worker_name or booking_obj.get("worker_return") or "-"

        if not loc_val or str(loc_val).strip() in ["", "-"]:
            loc_val = "ไม่ได้ระบุสถานที่"
        if not worker_val or str(worker_val).strip() in ["", "-", "Wait"]:
            worker_val = "รอมอบหมายพนักงาน"

        lines = [
            f"🔔 {title}",
            "────────────────────",
            f"📋 เลขที่การจอง: {bk_id}",
            f"👤 ผู้รับผิดชอบ: {worker_val}",
            f"🚗 ทะเบียนรถ: {car_display}",
            f"📅 {action_label}: {date_val} (เวลา {time_val} น.)",
            f"📍 สถานที่: {loc_val}",
            f"🙋‍♂️ ลูกค้า: {cust_name}",
            f"📞 เบอร์โทรศัพท์: {cust_phone}",
            "────────────────────",
            "ระบบบริหารจัดการ SawasdeeRental"
        ]
        message = "\n".join(lines)
        send_line_push_async(message)
    except Exception as e:
        print(f"Error in notify_line_work_order: {e}")

def notify_line_maintenance(record: dict):
    """
    แจ้งเตือนผ่าน LINE เมื่อออกใบงานซ่อมบำรุง / ต่อทะเบียน-ประกัน
    แสดง: รายการซ่อม, วันที่นัดรับคืน, ชื่ออู่, ผู้รับผิดชอบ, ราคาค่าซ่อม
    """
    if not record:
        return
    try:
        mnt_id = record.get("id", "-")
        car_plate = record.get("car_id", "-")
        car_brand = str(record.get("car_brand", "")).strip()
        car_model = str(record.get("car_model", "")).strip()
        car_name = f"{car_brand} {car_model}".strip()
        car_display = f"{car_name} (ทะเบียน {car_plate})" if car_name else f"ทะเบียน {car_plate}"
        
        order_type = record.get("order_type", "ซ่อมบำรุงทั่วไป / เช็คระยะ")
        is_renewal = any(k in str(order_type) for k in ["ต่อทะเบียน", "พ.ร.บ.", "พรบ", "ประกัน", "ภาษี"])
        title = "📄 ออกใบงานต่อทะเบียน/พรบ./ประกัน" if is_renewal else "🛠️ ออกใบงานซ่อมบำรุงรถยนต์"
        
        service_items = str(record.get("service_items", "-")).strip()
        garage = record.get("service_center") or "-"
        garage_phone = record.get("service_center_phone") or "-"
        garage_display = f"{garage} (โทร: {garage_phone})" if (garage_phone and str(garage_phone).strip() not in ["", "-"]) else garage
            
        worker = record.get("assigned_worker") or "รอมอบหมาย"
        sched_d = format_date_dmy(record.get("schedule_date"))
        sched_t = record.get("schedule_time", "09:00")
        exp_d = format_date_dmy(record.get("expected_finish_date"))
        exp_t = record.get("expected_finish_time", "17:00")
        
        cost_val = float(record.get("cost", 0) or 0)
        cost_str = f"{cost_val:,.2f} บาท" if cost_val > 0 else "ประเมินตามบิลจริง"
        
        notes = record.get("notes", "")
        
        lines = [
            f"🔔 {title}",
            "────────────────────",
            f"📋 เลขที่ใบงาน: {mnt_id}",
            f"🚗 ทะเบียนรถ: {car_display}",
            f"🔧 ประเภทงาน: {order_type}",
            f"📝 รายการซ่อม: {service_items}",
            f"🏁 วันที่นัดรับคืน: {exp_d} (เวลา {exp_t} น.)",
            f"🏢 ชื่ออู่/ศูนย์บริการ: {garage_display}",
            f"👤 ผู้รับผิดชอบ: {worker}",
            f"💰 ราคาค่าซ่อม: {cost_str}",
            f"📅 วันที่ส่งซ่อม/นัดหมาย: {sched_d} (เวลา {sched_t} น.)"
        ]
        if notes and str(notes).strip() not in ["", "-"]:
            lines.append(f"📌 หมายเหตุ: {notes}")
        lines.extend([
            "────────────────────",
            "ระบบบริหารจัดการ SawasdeeRental"
        ])
        send_line_push_async("\n".join(lines))
    except Exception as e:
        print(f"Error in notify_line_maintenance: {e}")

# -------------------------------------------------------------------------
# LINE DAILY EXPIRY NOTIFICATION (พ.ร.บ. & ประกันภัย ล่วงหน้า 30 วัน, 7 วัน, วันหมดอายุ เวลา 20:00 น.)
# -------------------------------------------------------------------------
def check_and_send_expiry_alerts(cars_dict=None, target_days=(30, 31, 7, 0)):
    """
    ตรวจสอบวันหมดอายุ พ.ร.บ. และ ประกันภัย
    เงื่อนไข:
    - ล่วงหน้า 30-31 วัน (1 เดือน)
    - ล่วงหน้า 7 วัน (days_left == 7)
    - วันที่หมดอายุ (days_left == 0)
    หากไม่มีรายการเข้าเงื่อนไข จะไม่ส่งข้อความทาง LINE (เพื่อประหยัดโควต้า 300 ข้อความ/เดือน)
    """
    try:
        from check_expiry_alert import check_expiring_cars, build_alert_message
        
        cars_list = []
        if cars_dict:
            for pl, c in cars_dict.items():
                c_copy = dict(c)
                c_copy["plate"] = pl
                cars_list.append(c_copy)
        elif hasattr(st, "session_state") and "cars_db" in st.session_state and st.session_state.cars_db:
            for pl, c in st.session_state.cars_db.items():
                c_copy = dict(c)
                c_copy["plate"] = pl
                cars_list.append(c_copy)
        else:
            from check_expiry_alert import fetch_cars_from_supabase, get_credentials
            _, sb_url, sb_key = get_credentials()
            cars_list = fetch_cars_from_supabase(sb_url, sb_key)

        expiring = check_expiring_cars(cars_list, target_days=target_days)
        if not expiring:
            return {"sent": False, "count": 0, "message": "ไม่มีรายการ พ.ร.บ. หรือ ประกันภัย ครบกำหนดแจ้งเตือนในวันนี้"}

        msg = build_alert_message(expiring)
        success = send_line_broadcast_message(msg)
        return {"sent": success, "count": len(expiring), "items": expiring, "message": msg}
    except Exception as e:
        print(f"Error in check_and_send_expiry_alerts: {e}")
        return {"sent": False, "count": 0, "error": str(e)}

def _get_last_expiry_run_date():
    try:
        lock_file = os.path.join(tempfile.gettempdir(), "sawasdee_line_expiry_last_run.txt")
        if os.path.exists(lock_file):
            with open(lock_file, "r", encoding="utf-8") as f:
                return f.read().strip()
    except Exception:
        pass
    return None

def _set_last_expiry_run_date(tag):
    try:
        lock_file = os.path.join(tempfile.gettempdir(), "sawasdee_line_expiry_last_run.txt")
        with open(lock_file, "w", encoding="utf-8") as f:
            f.write(tag)
    except Exception:
        pass

@st.cache_resource
def init_expiry_scheduler_thread():
    """
    เธรดทำงานเบื้องหลัง คอยตรวจเช็คเวลา 20:00 น. ประเทศไทย (UTC+7) ทุกวัน
    ใช้ @st.cache_resource เพื่อให้รันเพียงครั้งเดียวตลอดอายุเซิร์ฟเวอร์
    ไม่ถูกสร้างซ้ำเมื่อผู้ใช้กดแก้ไขข้อมูลหรือมี script rerun
    """
    def _scheduler_loop():
        while True:
            try:
                now_bkk = datetime.utcnow() + timedelta(hours=7)
                today_tag = now_bkk.strftime("%Y-%m-%d")
                # เมื่อถึงเวลาตั้งแต่ 20:00 น. เป็นต้นไป และวันนี้ยังไม่ได้ส่ง
                if now_bkk.hour >= 20:
                    last_run = _get_last_expiry_run_date()
                    if last_run != today_tag:
                        # ล็อควันที่ทันทีก่อนส่ง เพื่อป้องกันการส่งซ้ำ
                        _set_last_expiry_run_date(today_tag)
                        print(f"⏰ [{now_bkk.strftime('%H:%M')} ICT] ตรวจสอบและส่งแจ้งเตือน พ.ร.บ./ประกันภัย ประจำวัน {today_tag}...")
                        check_and_send_expiry_alerts(target_days=(30, 31, 7, 0))
                time.sleep(60)
            except Exception as e:
                print(f"Expiry scheduler loop error: {e}")
                time.sleep(60)

    try:
        t = threading.Thread(target=_scheduler_loop, daemon=True, name="SawasdeeExpiryScheduler")
        t.start()
        return True
    except Exception as e:
        print(f"Failed to start expiry scheduler: {e}")
        return False

# ปิดเธรดแจ้งเตือน 20:00 น. บนฝั่ง Streamlit เนื่องจากย้ายไปทำงานบน Render (server.py / line_service.py) แล้ว เพื่อไม่ให้ส่งซ้ำ 2 รอบ
# init_expiry_scheduler_thread()

# =========================================================================
# 3. INITIALIZE STATE & DATA STORE (SUPABASE CLOUD PERSISTENCE)
# =========================================================================
HARDCODED_SUPABASE_URL = "https://brhuafypxrqtoznsuhaa.supabase.co"
HARDCODED_SERVICE_KEY = base64.b64decode("c2Jfc2VjcmV0X05qd3JsQWl6WW4tOFdhSFE3QTRHM2dfR1VmTUFyWFI=").decode()

@st.cache_resource
def get_supabase_client():
    if not create_client:
        return None
    url = None
    key = None
    try:
        url = st.secrets.get("SUPABASE_URL")
        # พยายามดึง service key ก่อนเสมอ เพื่อให้มีสิทธิ์อัปโหลด Storage และข้าม RLS
        key = st.secrets.get("SUPABASE_SERVICE_KEY")
    except Exception:
        pass
    if not key:
        key = os.environ.get("SUPABASE_SERVICE_KEY")
    
    # หากไม่มี service key หรือ key เป็น publishable/anon key ให้ใช้ Hardcoded Service Key เสมอ
    # (คีย์ anon/publishable จะถูก Supabase Storage บล็อกด้วย 403 RLS violation เมื่ออัปโหลดไฟล์)
    if not key or str(key).startswith("sb_publishable_") or "service" not in str(key).lower():
        key = HARDCODED_SERVICE_KEY
        
    if not url:
        try:
            url = st.secrets.get("SUPABASE_URL") or os.environ.get("SUPABASE_URL")
        except Exception:
            pass
    if not url:
        url = HARDCODED_SUPABASE_URL
        
    try:
        return create_client(url, key)
    except Exception as e:
        print(f"Supabase Client Error: {e}")
        return None

def sb_sync_booking(b):
    sb = get_supabase_client()
    if not sb or not b: return
    try:
        # 1. ตรวจสอบและซิงค์ข้อมูลลูกค้าลงตาราง customers ใน Supabase ก่อน (ป้องกัน Foreign Key Error)
        cust_name = b.get("customer")
        if cust_name:
            cust_dict = None
            if hasattr(st, "session_state") and "customers_db" in st.session_state and cust_name in st.session_state.customers_db:
                cust_dict = st.session_state.customers_db[cust_name]
            elif _GLOBAL_STORE.get("customers_db") and cust_name in _GLOBAL_STORE["customers_db"]:
                cust_dict = _GLOBAL_STORE["customers_db"][cust_name]
            
            if not cust_dict:
                cust_dict = {
                    "full_name": cust_name, "nationality": "THAI",
                    "dob": "01/01/1990", "passport_id": "-", "licence_no": "-", "issue_place": "-",
                    "licence_expiry": "01/01/2030", "home_address": "-", "thai_address": "-",
                    "contact_no": "-", "whatsapp": "-", "email": "-"
                }
            sb_sync_customer(cust_name, cust_dict)

        # 2. กรองเฉพาะคอลัมน์ที่มีอยู่จริงในตาราง bookings บน Supabase Cloud
        VALID_BOOKING_COLS = {
            'booking_id', 'car_id', 'customer', 'start_date', 'end_date',
            'start_time', 'end_time', 'contract_type', 'base_price', 'discount',
            'net_price', 'deposit_paid', 'deposit_amount', 'rental_paid',
            'remaining_rental', 'is_fully_paid', 'rental_payment_method',
            'extension_history', 'created_by', 'status', 'worker_delivery',
            'worker_return', 'loc_delivery', 'loc_return', 'dispatch_closed',
            'return_closed'
        }
        clean_row = {}
        for k, v in b.items():
            if k in VALID_BOOKING_COLS:
                clean_row[k] = v

        if "start_date" in clean_row and clean_row["start_date"]:
            clean_row["start_date"] = str(clean_row["start_date"])
        if "end_date" in clean_row and clean_row["end_date"]:
            clean_row["end_date"] = str(clean_row["end_date"])

        sb.table("bookings").upsert(clean_row).execute()
    except Exception:
        pass

def sb_delete_booking(del_bkid):
    sb = get_supabase_client()
    if not sb or not del_bkid: return
    try:
        sb.table("bookings").delete().eq("booking_id", del_bkid).execute()
        sb.table("completed_jobs").delete().eq("booking_id", del_bkid).execute()
    except Exception:
        pass

VALID_CAR_COLS = {
    'plate', 'brand', 'model', 'color', 'car_group', 'engine_cc', 'fuel_type',
    'company', 'price_day', 'price_week', 'price_month', 'status', 'chassis_no',
    'act_expiry', 'ins_expiry', 'mileage', 'image', 'created_at'
}

def sb_sync_car(plate, car_dict):
    sb = get_supabase_client()
    if not sb or not car_dict: return
    try:
        clean_row = {k: v for k, v in car_dict.items() if k in VALID_CAR_COLS}
        clean_row["plate"] = plate
        sb.table("cars").upsert(clean_row).execute()
    except Exception as e:
        print(f"sb_sync_car error for {plate}: {e}")

def sb_sync_customer(name, cust_dict):
    sb = get_supabase_client()
    if not sb or not cust_dict: return
    try:
        row = dict(cust_dict)
        row["full_name"] = name
        sb.table("customers").upsert(row).execute()
    except Exception:
        pass

def sb_sync_completed_job(job_dict):
    sb = get_supabase_client()
    if not sb or not job_dict: return
    try:
        VALID_CJ_COLS = {
            'booking_id', 'car_id', 'customer', 'start_date', 'end_date',
            'completed_date', 'base_price', 'discount', 'net_price', 'fuel_level',
            'inspection_notes', 'inspection_photos', 'mileage', 'worker_delivery',
            'worker_return', 'status', 'contract_type'
        }
        row = {k: v for k, v in job_dict.items() if k in VALID_CJ_COLS}
        if "start_date" in row and row["start_date"]:
            row["start_date"] = str(row["start_date"])
        if "end_date" in row and row["end_date"]:
            row["end_date"] = str(row["end_date"])
        if "completed_date" in row and row["completed_date"]:
            row["completed_date"] = str(row["completed_date"])
        sb.table("completed_jobs").upsert(row).execute()
    except Exception:
        pass

def sb_sync_financial(f_dict):
    sb = get_supabase_client()
    if not sb or not f_dict: return
    try:
        row = dict(f_dict)
        row.pop("id", None)
        if "date" in row and row["date"]:
            row["date"] = str(row["date"])
        sb.table("financial_records").insert(row).execute()
    except Exception:
        pass

def sb_sync_user(username, u_dict):
    sb = get_supabase_client()
    if not sb or not u_dict: return
    try:
        clean_row = {
            "username": str(username).strip(),
            "name": str(u_dict.get("name", username)).strip(),
            "role": str(u_dict.get("role", "Staff")).strip(),
            "status": str(u_dict.get("status", "approved")).strip(),
            "password": str(u_dict.get("password", "")).strip()
        }
        sb.table("users").upsert(clean_row).execute()
        
        # Also update Supabase Auth user metadata if available
        try:
            users = sb.auth.admin.list_users()
            email = f"{clean_row['username'].lower()}@sawasdeecarrental.com"
            exist = next((u for u in users if u.email == email or (u.user_metadata or {}).get("username") == clean_row["username"]), None)
            if exist:
                sb.auth.admin.update_user_by_id(exist.id, {
                    "user_metadata": {
                        "username": clean_row["username"],
                        "name": clean_row["name"],
                        "role": clean_row["role"],
                        "status": clean_row["status"]
                    }
                })
        except Exception:
            pass
    except Exception:
        pass

def sb_delete_user(username):
    sb = get_supabase_client()
    if not sb or not username: return
    u_clean = str(username).strip()
    try:
        sb.table("users").delete().ilike("username", u_clean).execute()
    except Exception:
        pass
    try:
        users = sb.auth.admin.list_users()
        email = f"{u_clean.lower()}@sawasdeecarrental.com"
        exist = next((u for u in users if (u.email and u.email.lower() == email) or str((u.user_metadata or {}).get("username", "")).lower() == u_clean.lower()), None)
        if exist:
            sb.auth.admin.delete_user(exist.id)
    except Exception:
        pass

def sb_upload_photo(filename, file_bytes, content_type="image/jpeg"):
    sb = get_supabase_client()
    try:
        if sb:
            sb.storage.from_("inspection-photos").upload(
                filename,
                file_bytes,
                file_options={"content-type": content_type, "upsert": "true"}
            )
            url = sb.storage.from_("inspection-photos").get_public_url(filename)
            print(f"sb_upload_photo success: {filename} -> {url}")
            return url
    except Exception as e:
        print(f"sb_upload_photo error with cached client: {e}, attempting direct service client...")

    # Direct fallback using hardcoded service key (bypass any cached anon/publishable tokens)
    try:
        if create_client:
            direct_sb = create_client(HARDCODED_SUPABASE_URL, HARDCODED_SERVICE_KEY)
            direct_sb.storage.from_("inspection-photos").upload(
                filename,
                file_bytes,
                file_options={"content-type": content_type, "upsert": "true"}
            )
            url = direct_sb.storage.from_("inspection-photos").get_public_url(filename)
            print(f"sb_upload_photo direct success: {filename} -> {url}")
            return url
    except Exception as e2:
        print(f"sb_upload_photo direct error: {e2}")
    return None

def sb_auth_login(identifier, password):
    sb = get_supabase_client()
    u_clean = str(identifier).strip() if identifier else ""
    pwd_clean = str(password).strip() if password else ""
    if not u_clean or not pwd_clean:
        return None, "กรุณากรอกชื่อผู้ใช้งาน/อีเมล และรหัสผ่าน"
        
    u_local = None
    if "users_db" in st.session_state:
        for k, v in st.session_state.users_db.items():
            if k.lower() == u_clean.lower():
                u_local = v
                break
    
    # 1. Supabase Auth (Sign in with email & password)
    if sb:
        email = u_clean.lower()
        if "@" not in email:
            email = f"{email}@sawasdeecarrental.com"
            
        try:
            auth_res = sb.auth.sign_in_with_password({"email": email, "password": pwd_clean})
            if auth_res and auth_res.user:
                # ค้นหาโปรไฟล์จากตาราง users ใน Supabase
                u_row = sb.table("users").select("*").ilike("username", u_clean).execute().data
                if not u_row and "@" in identifier:
                    meta_u = (auth_res.user.user_metadata or {}).get("username")
                    if meta_u:
                        u_row = sb.table("users").select("*").ilike("username", meta_u).execute().data
                if u_row:
                    u_prof = u_row[0]
                else:
                    u_prof = {
                        "username": u_clean,
                        "name": (auth_res.user.user_metadata or {}).get("name", u_clean),
                        "role": (auth_res.user.user_metadata or {}).get("role", "Staff"),
                        "status": "approved",
                        "password": pwd_clean
                    }
                return u_prof, None
        except Exception:
            pass
            
        # 2. ตรวจสอบจากตาราง users บน Supabase โดยตรง (กรณีรหัสผ่านตรงกับในตาราง)
        try:
            u_row = sb.table("users").select("*").ilike("username", u_clean).execute().data
            if u_row and u_row[0].get("password") and str(u_row[0].get("password")) == pwd_clean:
                return u_row[0], None
        except Exception:
            pass
            
    # 3. ตรวจสอบจาก local users_db ในเครื่อง
    if u_local and u_local.get("password") and str(u_local.get("password")) == pwd_clean:
        return u_local, None
        
    return None, "❌ ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง"

def sb_auth_register(username, full_name, password):
    u_clean = str(username).strip()
    if not u_clean:
        return False, "กรุณากรอกชื่อผู้ใช้งาน"
    if len(password) < 6:
        return False, "รหัสผ่านต้องมีความยาวอย่างน้อย 6 ตัวอักษร"
        
    sb = get_supabase_client()
    if sb:
        try:
            exist = sb.table("users").select("username").ilike("username", u_clean).execute().data
            if exist:
                return False, f"ชื่อผู้ใช้งาน '{u_clean}' มีอยู่ในระบบแล้ว"
        except Exception:
            pass
            
        email = f"{u_clean.lower()}@sawasdeecarrental.com"
        # Create user in Supabase Auth via admin (so email is auto-confirmed)
        try:
            sb.auth.admin.create_user({
                "email": email,
                "password": password,
                "email_confirm": True,
                "user_metadata": {
                    "username": u_clean,
                    "name": full_name.strip() or u_clean,
                    "role": "Staff",
                    "status": "pending"
                }
            })
        except Exception:
            try:
                sb.auth.sign_up({
                    "email": email,
                    "password": password,
                    "options": {
                        "data": {
                            "username": u_clean,
                            "name": full_name.strip() or u_clean,
                            "role": "Staff"
                        }
                    }
                })
            except Exception:
                pass
            
        new_prof = {
            "username": u_clean,
            "name": full_name.strip() or u_clean,
            "role": "Staff",
            "status": "pending",
            "password": password
        }
        try:
            sb_sync_user(u_clean, new_prof)
        except Exception:
            pass
            
    new_prof = {
        "username": u_clean,
        "name": full_name.strip() or u_clean,
        "role": "Staff",
        "status": "pending",
        "password": password
    }
    st.session_state.users_db[u_clean] = new_prof
    _GLOBAL_STORE["users_db"] = st.session_state.users_db
    return True, "✅ สมัครสมาชิกสำเร็จ! ข้อมูลถูกส่งเข้าสู่ระบบ Supabase เรียบร้อย (กรุณารอ Admin อนุมัติการใช้งาน)"

def sb_auth_change_password(username, new_password):
    u_clean = str(username).strip()
    if not u_clean:
        return False, "กรุณากรอกชื่อผู้ใช้งาน"
    if len(new_password) < 6:
        return False, "รหัสผ่านใหม่ต้องมีความยาวอย่างน้อย 6 ตัวอักษร"
        
    sb = get_supabase_client()
    if sb:
        try:
            sb.table("users").update({"password": new_password}).ilike("username", u_clean).execute()
        except Exception:
            pass
        try:
            users = sb.auth.admin.list_users()
            email = f"{u_clean.lower()}@sawasdeecarrental.com"
            exist = next((u for u in users if u.email == email or (u.user_metadata or {}).get("username") == u_clean), None)
            if exist:
                sb.auth.admin.update_user_by_id(exist.id, {"password": new_password})
        except Exception:
            pass
            
    if u_clean in st.session_state.users_db:
        st.session_state.users_db[u_clean]["password"] = new_password
        _GLOBAL_STORE["users_db"] = st.session_state.users_db
    return True, "เปลี่ยนรหัสผ่านสำเร็จบน Supabase เรียบร้อย! กรุณาเข้าสู่ระบบใหม่"

def sb_auth_logout():
    sb = get_supabase_client()
    if sb:
        try:
            sb.auth.sign_out()
        except Exception:
            pass

def safe_fragment(run_every=5):
    """Safely apply st.fragment if supported in the current Streamlit environment"""
    if hasattr(st, "fragment"):
        return st.fragment(run_every=run_every)
    def decorator(func):
        return func
    return decorator

FASTAPI_BACKEND_URL = os.environ.get("FASTAPI_URL", "http://127.0.0.1:8000")

def fetch_from_fastapi_backend():
    """MISSION 2: ดึงข้อมูลหลัก (cars, bookings, customers) ผ่าน FastAPI REST Endpoints เพื่อลดภาระ Streamlit"""
    try:
        import requests
        r_cars = requests.get(f"{FASTAPI_BACKEND_URL}/cars", timeout=1.5)
        r_bk = requests.get(f"{FASTAPI_BACKEND_URL}/bookings", timeout=1.5)
        r_cust = requests.get(f"{FASTAPI_BACKEND_URL}/customers", timeout=1.5)
        if r_cars.status_code == 200 and r_bk.status_code == 200 and r_cust.status_code == 200:
            c_data = r_cars.json()
            cars_map = {c["plate"]: c for c in c_data if "plate" in c} if isinstance(c_data, list) else (c_data if isinstance(c_data, dict) else {})
            
            b_data = r_bk.json()
            b_list = b_data if isinstance(b_data, list) else []
            for b_copy in b_list:
                if b_copy.get("start_date") and isinstance(b_copy["start_date"], str):
                    b_copy["start_date"] = to_date(b_copy["start_date"])
                if b_copy.get("end_date") and isinstance(b_copy["end_date"], str):
                    b_copy["end_date"] = to_date(b_copy["end_date"])

            cust_data = r_cust.json()
            cust_map = {c["full_name"]: c for c in cust_data if "full_name" in c} if isinstance(cust_data, list) else (cust_data if isinstance(cust_data, dict) else {})
            return True, cars_map, b_list, cust_map
    except Exception:
        pass
    return False, None, None, None

def sync_cloud_data(force=False, auto=False):
    # MISSION 2: หากมี FastAPI Backend ให้ดึงข้อมูลผ่าน API ก่อนเพื่อความรวดเร็ว
    api_ok, api_cars, api_bk, api_cust = fetch_from_fastapi_backend()
    if api_ok:
        _GLOBAL_STORE["cars_db"] = api_cars
        st.session_state.cars_db = api_cars
        _GLOBAL_STORE["bookings_db"] = api_bk
        st.session_state.bookings_db = api_bk
        _GLOBAL_STORE["customers_db"] = api_cust
        st.session_state.customers_db = api_cust

    sb = get_supabase_client()
    if not sb: return False
    now = time.time()
    last_sync = st.session_state.get("_last_cloud_sync_time", 0)
    
    # In auto mode, skip if polled within last 4 seconds
    if auto and (now - last_sync < 4):
        return False
        
    # In manual/first run, skip if very recent
    if not force and not auto and ("_cloud_synced_once" in st.session_state) and (now - last_sync < 5):
        return False

    has_changed = False
    try:
        # 1. Users table (Supabase Cloud is authoritative)
        u_res = sb.table("users").select("*").execute()
        fresh_users = {}
        del_unames = _GLOBAL_STORE.get("deleted_usernames", set())
        if u_res.data:
            fresh_users = {
                u["username"]: u for u in u_res.data
                if str(u.get("username", "")).lower() not in del_unames
            }

        # บัญชี admin ต้องมีอยู่ใน Supabase (ตาราง users + Supabase Auth) เท่านั้น — ไม่สร้าง/ไม่ฮาร์ดโค้ดรหัสผ่านในโค้ด

        # Compare users to detect change
        cur_users = st.session_state.get("users_db") or {}
        old_u_sigs = {(k, v.get("status"), v.get("role"), v.get("name")) for k, v in cur_users.items()}
        new_u_sigs = {(k, v.get("status"), v.get("role"), v.get("name")) for k, v in fresh_users.items()}
        if old_u_sigs != new_u_sigs:
            has_changed = True

        _GLOBAL_STORE["users_db"] = fresh_users
        st.session_state.users_db = fresh_users

        # 2. Bookings table
        b_res = sb.table("bookings").select("*").execute()
        if b_res.data is not None:
            del_ids = _GLOBAL_STORE.get("deleted_booking_ids", set())
            fresh_b = []
            for b in b_res.data:
                if b.get("booking_id") in del_ids or b.get("booking_id") in ["MRC261012110000", "MRC261010145909", "MRC261008093000"]:
                    continue
                b_copy = dict(b)
                if b_copy.get("start_date"): b_copy["start_date"] = to_date(b_copy["start_date"])
                if b_copy.get("end_date"): b_copy["end_date"] = to_date(b_copy["end_date"])
                
                net_val = float(b_copy.get("net_price", 0))
                if "deposit_amount" not in b_copy or (b_copy.get("deposit_paid") and b_copy.get("deposit_amount", 0) == 0):
                    b_copy["deposit_amount"] = 5000.0 if b_copy.get("deposit_paid") else 0.0
                if "rental_paid" not in b_copy:
                    b_copy["rental_paid"] = bool(b_copy.get("is_fully_paid", False))
                if "remaining_rental" not in b_copy:
                    b_copy["remaining_rental"] = 0.0 if b_copy.get("rental_paid") else net_val
                if "extension_history" not in b_copy:
                    b_copy["extension_history"] = []
                if "start_time" not in b_copy or not b_copy["start_time"]:
                    b_copy["start_time"] = "10:00"
                if "end_time" not in b_copy or not b_copy["end_time"]:
                    b_copy["end_time"] = "10:00"
                if "created_by" not in b_copy:
                    b_copy["created_by"] = b_copy.get("worker_delivery") or b_copy.get("worker_return") or "admin"
                if "dispatch_closed" not in b_copy:
                    b_copy["dispatch_closed"] = (b_copy.get("status") in ["กำลังเช่า", "เตรียมรับคืน", "เสร็จสิ้น"])
                if "return_closed" not in b_copy:
                    b_copy["return_closed"] = (b_copy.get("status") == "เสร็จสิ้น")
                if "contract_issued" not in b_copy:
                    b_copy["contract_issued"] = bool(b_copy.get("contract_done", False)) or bool(b_copy.get("rental_paid", False)) or (b_copy.get("status") in ["กำลังเช่า", "เตรียมรับคืน", "เสร็จสิ้น"])
                fresh_b.append(b_copy)

            # ยึดข้อมูลจากตาราง bookings บน Supabase เป็นหลัก 100% (ไม่ส่งข้อมูลเก่าในหน่วยความจำกลับขึ้นไปทับเมื่อถูกลบจาก Database)
            cur_b = st.session_state.get("bookings_db", [])

            old_b_sigs = {(b.get("booking_id"), b.get("status"), b.get("worker_delivery"), b.get("worker_return"), b.get("rental_paid"), b.get("deposit_paid")) for b in cur_b}
            new_b_sigs = {(b.get("booking_id"), b.get("status"), b.get("worker_delivery"), b.get("worker_return"), b.get("rental_paid"), b.get("deposit_paid")) for b in fresh_b}
            if old_b_sigs != new_b_sigs:
                has_changed = True

            _GLOBAL_STORE["bookings_db"] = fresh_b
            st.session_state.bookings_db = fresh_b

        # 3. Cars table (full sync periodically or on force)
        last_full_sync = st.session_state.get("_last_full_sync_time", 0)
        should_full_sync = force or (now - last_full_sync >= 15) or ("_full_synced_once" not in st.session_state)
        
        if should_full_sync:
            c_res = sb.table("cars").select("*").execute()
            if c_res.data is not None:
                fresh_cars = {c["plate"]: c for c in c_res.data}
                if len(fresh_cars) != len(st.session_state.get("cars_db", {})):
                    has_changed = True
                _GLOBAL_STORE["cars_db"] = fresh_cars
                st.session_state.cars_db = fresh_cars

            # 4. Customers table
            cust_res = sb.table("customers").select("*").execute()
            if cust_res.data is not None:
                fresh_cust = {c["full_name"]: c for c in cust_res.data}
                if len(fresh_cust) != len(st.session_state.get("customers_db", {})):
                    has_changed = True
                _GLOBAL_STORE["customers_db"] = fresh_cust
                st.session_state.customers_db = fresh_cust

            # 5. Completed Jobs table
            cj_res = sb.table("completed_jobs").select("*").execute()
            if cj_res.data is not None:
                fresh_cj = []
                for cj in cj_res.data:
                    if cj.get("booking_id") in ["MRC261005112001", "MRC260920091530", "MRC260910143000", "MRC260825100000"]:
                        continue
                    cj_copy = dict(cj)
                    if cj_copy.get("start_date"): cj_copy["start_date"] = to_date(cj_copy["start_date"])
                    if cj_copy.get("end_date"): cj_copy["end_date"] = to_date(cj_copy["end_date"])
                    if cj_copy.get("completed_date"): cj_copy["completed_date"] = to_date(cj_copy["completed_date"])
                    fresh_cj.append(cj_copy)
                if len(fresh_cj) != len(st.session_state.get("completed_jobs_db", [])):
                    has_changed = True
                _GLOBAL_STORE["completed_jobs_db"] = fresh_cj
                st.session_state.completed_jobs_db = fresh_cj

            # 6. Financial records table
            f_res = sb.table("financial_records").select("*").execute()
            if f_res.data is not None:
                if len(f_res.data) != len(st.session_state.get("financial_db", [])):
                    has_changed = True
                _GLOBAL_STORE["financial_db"] = f_res.data
                st.session_state.financial_db = f_res.data

            st.session_state._last_full_sync_time = now
            st.session_state._full_synced_once = True

        st.session_state._last_cloud_sync_time = now
        st.session_state._cloud_synced_once = True
    except Exception:
        pass

    return has_changed

@safe_fragment(run_every=5)
def render_live_cloud_sync_panel():
    """Live auto-sync widget running every 5 seconds continuously in the background"""
    has_changed = sync_cloud_data(auto=True)
    if has_changed:
        st.rerun(scope="app")
        
    last_t = st.session_state.get("_last_cloud_sync_time")
    t_str = datetime.fromtimestamp(last_t).strftime("%H:%M:%S") if last_t else "เมื่อสักครู่"
    
    st.markdown(f"""
        <div style="background:#F0FDF4; border:1px solid #BBF7D0; border-radius:8px; padding:6px 10px; margin:4px 0 8px 0; font-size:11px; color:#166534; display:flex; align-items:center; justify-content:space-between;">
            <span style="display:flex; align-items:center; gap:5px;">
                <span style="display:inline-block; width:7px; height:7px; border-radius:50%; background:#22C55E; box-shadow:0 0 5px #22C55E;"></span>
                <b>ซิงค์ Cloud อัตโนมัติ (Live)</b>
            </span>
            <span style="font-size:10.5px; color:#15803D; font-family:monospace;">{t_str}</span>
        </div>
    """, unsafe_allow_html=True)
    
    if st.button("🔄 ซิงค์ทันที (Manual Sync)", use_container_width=True, help="บังคับดึงข้อมูลล่าสุดทั้งหมดจาก Supabase Cloud ทันที"):
        sync_cloud_data(force=True)
        st.success("✅ ซิงค์ข้อมูลล่าสุดจาก Supabase Cloud สำเร็จ!")
        time.sleep(0.4)
        st.rerun(scope="app")

def init_cloud_store(store=None, force=False):
    sync_cloud_data(force=force)

@st.cache_resource
def get_global_store():
    return {
        "users_db": None,
        "cars_db": {},
        "customers_db": {},
        "bookings_db": [],
        "completed_jobs_db": [],
        "financial_db": [],
        "deleted_booking_ids": set(),
        "deleted_usernames": set(),
    }

_GLOBAL_STORE = get_global_store()
if "deleted_booking_ids" not in _GLOBAL_STORE:
    _GLOBAL_STORE["deleted_booking_ids"] = set()
if "deleted_usernames" not in _GLOBAL_STORE:
    _GLOBAL_STORE["deleted_usernames"] = set()

# Initialize users_db default if not yet set
if "users_db" not in st.session_state:
    st.session_state.users_db = _GLOBAL_STORE.get("users_db") or {
        "admin": {
            "username": "admin",
            "name": "ผู้ดูแลระบบ (Admin)",
            "role": "Admin",
            "status": "approved"
            # ไม่มีรหัสผ่านในโค้ด — ล็อกอิน admin ผ่าน Supabase เท่านั้น
        }
    }
    _GLOBAL_STORE["users_db"] = st.session_state.users_db
if "language" not in st.session_state:
    st.session_state.language = "TH"

translations = {
    "TH": {
        # Sidebar & Global Navigation
        "nav_front": "🖥️ Front Office",
        "nav_back": "📋 Back Office",
        "nav_crm": "🛠️ ซ่อมบำรุง & บริการ",
        "nav_dash": "📊 แดชบอร์ด & การเงิน",
        "menu_header": "เมนูระบบงานหลัก:",
        "btn_logout": "ออกจากระบบ (Auth)",
        "btn_lang": "🌐 English",
        "logged_in_as": "เข้าสู่ระบบโดย:",
        "btn_manage_staff": "จัดการ & อนุมัติพนักงาน",
        "role_admin_badge": "ผู้ดูแลระบบ (Admin)",
        "role_staff_badge": "พนักงาน (Staff)",
        "cloud_sync_auto": "● ซิงค์ Cloud อัตโนมัติ:",

        # Back Office
        "bo_page_title": "ศูนย์จัดการใบส่งมอบและรับคืนรถยนต์ (Dispatch & Return)",
        "bo_page_subtitle": "ศูนย์จัดการใบส่งมอบและรับคืนรถยนต์",
        "bo_page_subtitle_th": "ศูนย์จัดการใบส่งมอบและรับคืนรถยนต์",
        "bo_admin_privilege": "ผู้ดูแลระบบ (Admin): สั่งงานได้ทุกใบงาน",
        "bo_staff_privilege": "พนักงาน: {name} (ส่งงานได้เฉพาะงานที่ได้รับมอบหมาย)",
        "bo_search_placeholder": "ค้นหาใบงาน...",
        "bo_btn_refresh": "รีเฟรช",
        "bo_table_title": "รายการใบงานรับ-ส่งรถยนต์",
        "bo_empty_msg": "ไม่มีใบงานในระบบขณะนี้",
        "bo_empty_info": "ยังไม่มีรายการใบงาน (ระบบจะสร้างใบงานอัตโนมัติเมื่อมีการจอง)",
        "bo_btn_new_booking": "จองรถ / ทำสัญญา (Front Office)",
        "bo_filter_caption": "กรองตารางใบงานตามคำค้นหา:",

        # Back Office Table Columns
        "bo_col_type": "ประเภทงาน",
        "bo_col_booking_id": "รหัสการจอง",
        "bo_col_plate": "ทะเบียนรถ",
        "bo_col_customer": "ลูกค้า & เบอร์โทร",
        "bo_col_customer_name": "ลูกค้า",
        "bo_col_schedule": "กำหนดวัน-เวลา",
        "bo_col_schedule_range": "กำหนดวันส่ง - วันคืน",
        "bo_col_staff": "พนักงาน",
        "bo_col_location": "สถานที่นัดหมาย",
        "bo_col_location_simple": "สถานที่",
        "bo_col_status": "สถานะ",
        "bo_col_actions": "เอกสาร & ส่งงาน",
        "bo_col_actions_full": "เอกสาร & จัดการส่งงาน",

        # Back Office Badges & Action Buttons
        "bo_job_dispatch": "ส่งมอบรถ (Dispatch)",
        "bo_job_return": "รับรถคืน (Return)",
        "bo_job_maintenance": "ซ่อมบำรุง",
        "bo_job_renewal": "ต่อทะเบียน/พรบ./ประกัน",
        "bo_btn_inspect_handover": "ตรวจรับส่ง & ปิดงาน",
        "bo_btn_complete_maintenance": "ตรวจรับ & ปิดงาน",
        "bo_btn_complete_renewal": "ส่งงาน / อัปเดตวัน",
        "bo_status_repairing": "กำลังซ่อมบำรุง",
        "bo_status_renewing": "กำลังต่อภาษี/ประกัน",
        "bo_status_wait_dispatch": "รอส่งรถก่อน",

        # Front Office Tabs & Header
        "fo_title": "📂 Front Office",
        "fo_subtitle": "ศูนย์ปฏิบัติการเช่ารถ สัญญา และส่งมอบ",
        "tab_fleet": "1. เลือกรถยนต์ & จองด่วน",
        "tab_deposit": "2. เงินมัดจำ & การเงิน",
        "tab_dispatch": "3. ใบงานส่ง/รับรถ",
        "tab_contract": "4. สัญญาเช่า",
        "tab_pipeline": "5. แผงควบคุมคิวการจอง",
        "tab_fleet_display": "1. เลือกรถยนต์ & จองด่วน",
        "tab_deposit_display": "2. เงินมัดจำ & การเงิน",
        "tab_dispatch_display": "3. ใบงานส่ง/รับรถ",
        "tab_contract_display": "4. จัดทำสัญญาเช่า",
        "tab_pipeline_display": "5. แผงควบคุมคิวการจอง",

        # Tab 1: Fleet & Instant Booking
        "hero_booking_bar_title": "เลือกรถยนต์ & จองด่วน (Instant Booking Bar)",
        "hero_booking_bar_desc": "เลือกวันรับ - คืนรถ (คำนวณระยะเวลาเช่าอัตโนมัติ)",
        "btn_add_customer": "เพิ่มลูกค้า",
        "filter_cat": "หมวดหมู่รถ",
        "filter_brand": "ยี่ห้อ",
        "filter_owner": "บริษัท / สังกัด",
        "filter_status": "สถานะรถ",
        "filter_all": "ทั้งหมด",
        "btn_reset_filters": "ล้างตัวกรอง",
        "fleet_expander_view": "ดูรูปรถและข้อมูลเพิ่มเติม",
        "fleet_expander_hide": "ซ่อนข้อมูล",
        "fleet_plate_red": "ป้ายแดง",
        "fleet_plate_red_sub": "Red plate",
        "fleet_stat_avail": "Available",
        "fleet_stat_rent": "On rent",
        "fleet_stat_workshop": "Workshop",
        "fleet_stat_res": "Reserved",
        "fleet_exp_ins_title": "ข้อมูลกรมธรรม์ประกันภัย",
        "fleet_exp_act_tax_title": "ข้อมูล พ.ร.บ. และภาษี",
        "fleet_exp_hp_title": "ข้อมูลสัญญาเช่าซื้อ / ลิสซิ่ง (HP / Leasing)",
        "fleet_exp_spec_title": "ข้อมูลตัวรถเชิงลึก",
        "fleet_exp_rates_title": "อัตราค่าเช่าที่ตั้งไว้",
        "fleet_btn_book": "สร้างสัญญาเช่า / จองรถ",
        "fleet_btn_maint": "แจ้งซ่อมบำรุง",
        "fleet_btn_edit": "แก้ไขข้อมูลรถ",
        "fleet_btn_del": "ลบรถยนต์",

        # Date Pickers
        "date_tax_exp": "วันหมดอายุภาษี",
        "date_act_exp": "วันหมดอายุ พ.ร.บ.",
        "date_ins_exp": "วันหมดอายุประกันภัย",
        "date_last_srv": "วันที่เช็คระยะล่าสุด",
        "date_dob": "วันเกิด (DOB)",
        "date_lic_exp": "วันหมดอายุใบขับขี่",

        # Installment & Financial
        "is_debt_free": "รถปลอดภาระ / ซื้อเงินสด",
        "installment_amount": "ค่างวดต่อเดือน (THB)",
        "payment_due_date": "วันกำหนดชำระ (ทุกวันที่)",
        "total_installments": "จำนวนงวดทั้งหมด",
        "current_installment": "งวดปัจจุบัน (ชำระแล้ว)",
        "dashboard_monthly_expense": "รายจ่ายค่างวดรถรวมต่อเดือน",

        # Tab 2: Deposit & Finance
        "deposit_title": "เงินมัดจำ & การเงิน (Deposit & Payment)",
        "deposit_subtitle": "บันทึกเงินมัดจำประกันสัญญาและชำระค่าเช่า",
        "deposit_queue_title": "คิวจองรอดำเนินการชำระเงิน",

        # Tab 3: Dispatch & Return Work Orders
        "dispatch_title": "ใบงานส่งมอบรถและรับรถคืน",
        "dispatch_subtitle": "มอบหมายพนักงาน ระบุสถานที่ และออกใบงาน",

        # Tab 4: Rental Agreement
        "contract_title": "จัดทำสัญญาเช่ารถยนต์",
        "contract_subtitle": "ออกสัญญาเช่าอิเล็กทรอนิกส์พร้อมข้อมูลผู้เช่าและลายเซ็น",

        # Tab 5: Booking Pipeline
        "pipeline_title": "แผงควบคุมคิวการจอง (Booking Pipeline)",
        "pipeline_subtitle": "ติดตามสถานะงานเช่าและค้นหารายการจองทั้งหมด",

        # CRM & Maintenance
        "crm_title": "ศูนย์จัดการงานซ่อมบำรุงและต่ออายุเอกสาร",
        "crm_subtitle": "จัดการงานซ่อมบำรุง ตรวจเช็คสภาพ ออกใบงาน และต่ออายุภาษี-พ.ร.บ.-ประกันภัย",

        # Dashboard & Analytics
        "dash_title": "แดชบอร์ด & การเงิน",
        "dash_subtitle_badge": "EXECUTIVE DASHBOARD",
        "dash_subtitle": "ภาพรวมสถานะฟลีทรถ รายได้ และสถิติการดำเนินงานแบบเรียลไทม์",

        # Dashboard HP & Property Insurance & Completed Jobs
        "dash_hp_title": "ตารางผ่อนชำระค่างวดรถยนต์ (HP / Leasing)",
        "dash_prop_ins_title": "กรมธรรม์ประกันภัยทรัพย์สินและประกันอุบัติเหตุส่วนบุคคล",
        "dash_hp_col_no": "ลำดับ",
        "dash_hp_col_model": "รุ่นรถยนต์",
        "dash_hp_col_plate": "ทะเบียน / เลขถัง",
        "dash_hp_col_contract": "เลขที่สัญญา",
        "dash_hp_col_down": "วันดาวน์ / เงินดาวน์",
        "dash_hp_col_due": "งวดแรก / กำหนดชำระ",
        "dash_hp_col_installment": "ค่างวด/เดือน",
        "dash_hp_col_terms": "จำนวนงวด",
        "dash_hp_col_paid": "ชำระแล้ว (บาท)",
        "dash_hp_col_remaining": "คงเหลือ (บาท)",
        "dash_hp_col_total_price": "ราคารถรวมดาวน์",
        "dash_prop_col_id": "รหัส",
        "dash_prop_col_title": "รายการกรมธรรม์ / ทรัพย์สิน",
        "dash_prop_col_owner": "ผู้เอาประกัน / เจ้าของ",
        "dash_prop_col_company": "บริษัทประกันภัย",
        "dash_prop_col_expiry": "วันหมดอายุ",
        "dash_prop_col_notes": "หมายเหตุ",
        "dash_archive_title": "คลังประวัติงานเสร็จสิ้น & รีพอร์ตรายเดือน (Completed Jobs Archive)",
        "dash_archive_filter_month": "เลือกเดือนที่ต้องการดูรายงาน:",
        "dash_archive_filter_comp": "เลือกรีพอร์ตตามบริษัท:",
        "dash_archive_all_comp": "ทั้งหมด (ทุกบริษัท)",
        "dash_archive_all_months": "ดูทุกเดือนทั้งหมด",
        "dash_archive_download_csv": "ดาวน์โหลดรายงานสรุปงานเสร็จสิ้น (CSV สำหรับ Excel)",
        "dash_archive_kpi_jobs": "งานเสร็จสิ้นทั้งหมด",
        "dash_archive_kpi_rev": "รายรับรวมจากงานเช่า",
        "dash_archive_kpi_cars": "รถที่ให้บริการ",
        "dash_archive_kpi_custs": "ลูกค้าที่ใช้บริการ",
        "dash_archive_col_bkid": "รหัสการจอง",
        "dash_archive_col_date": "วันที่เสร็จสิ้น",
        "dash_archive_col_plate": "ทะเบียนรถ",
        "dash_archive_col_cust": "ลูกค้า",
        "dash_archive_col_comp": "บริษัท",
        "dash_archive_col_ctype": "ประเภทสัญญา",
        "dash_archive_col_rev": "รายรับสุทธิ",
        "dash_archive_col_staff": "พนักงานส่ง-รับ",
        "dash_archive_col_loc": "สถานที่",
        "dash_archive_col_fuel": "เกจ์น้ำมัน & สภาพรถ",
        "dash_archive_col_status": "สถานะ",
        "dash_archive_col_docs": "เอกสารย้อนหลัง",

        # Maintenance & Service Center
        "mnt_title": "ศูนย์จัดการงานซ่อมบำรุงและต่ออายุเอกสาร",
        "mnt_subtitle": "จัดการงานซ่อมบำรุง ตรวจเช็คสภาพ ออกใบงาน และต่ออายุภาษี-พ.ร.บ.-ประกันภัย",
        "mnt_btn_new": "ออกใบงานใหม่",
        "mnt_btn_renewal": "ออกใบงานต่ออายุเอกสาร",
        "mnt_btn_refresh": "รีเฟรช",
        "mnt_kpi_inprog": "กำลังซ่อมบำรุง",
        "mnt_kpi_pending": "ใบงานรอดำเนินการ",
        "mnt_kpi_cost": "รวมค่าซ่อมบำรุงและบริการ",
        "mnt_kpi_renewals": "งานต่อภาษี / พรบ. / ประกัน",
        "mnt_lbl_search": "ค้นหาใบงาน (เลขที่ / ทะเบียน / รายการ):",
        "mnt_lbl_type": "ประเภทงาน:",
        "mnt_lbl_status": "สถานะงาน:",
        "mnt_lbl_car": "เลือกรถยนต์:",
        "mnt_table_title": "รายการประวัติการซ่อมบำรุงและบริการทั้งหมด",
        "mnt_col_id": "เลขที่ใบงาน",
        "mnt_col_car": "ทะเบียน & รถยนต์",
        "mnt_col_type": "ประเภทงาน",
        "mnt_col_desc": "รายการซ่อม / รายการบริการ",
        "mnt_col_cost": "ค่าซ่อมบำรุง (฿)",
        "mnt_col_garage": "อู่ / ศูนย์บริการ",
        "mnt_col_staff": "พนักงานผู้รับผิดชอบ",
        "mnt_col_sched": "กำหนดการ",
        "mnt_col_status": "สถานะ",
        "mnt_col_action": "ออกใบงาน & ปิดงาน",
        "session_expired": "เซสชันการใช้งานหมดอายุ (ครบ 6 ชั่วโมง) กรุณาเข้าสู่ระบบใหม่อีกครั้งเพื่อความปลอดภัย"
    },
    "EN": {
        # Sidebar & Global Navigation
        "nav_front": "🖥️ Front Office",
        "nav_back": "📋 Back Office",
        "nav_crm": "🛠️ Maintenance & Services",
        "nav_dash": "📊 Dashboard & Finance",
        "menu_header": "Main Navigation:",
        "btn_logout": "Sign Out (Auth)",
        "btn_lang": "🌐 ภาษาไทย",
        "logged_in_as": "Logged in as:",
        "btn_manage_staff": "Manage & Approve Staff",
        "role_admin_badge": "Administrator (Admin)",
        "role_staff_badge": "Staff",
        "cloud_sync_auto": "● Auto Cloud Sync:",

        # Back Office
        "bo_page_title": "Dispatch & Return Work Orders",
        "bo_page_subtitle": "Dispatch & Return Work Orders",
        "bo_page_subtitle_th": "Dispatch & Return Work Orders",
        "bo_admin_privilege": "Admin: Can manage all work orders",
        "bo_staff_privilege": "Staff: {name} (Assigned jobs only)",
        "bo_search_placeholder": "Search work orders...",
        "bo_btn_refresh": "Refresh",
        "bo_table_title": "Vehicle Dispatch & Return Work Orders",
        "bo_empty_msg": "No work orders in the system currently",
        "bo_empty_info": "No work orders yet (Orders appear automatically upon booking)",
        "bo_btn_new_booking": "New Booking / Contract (Front Office)",
        "bo_filter_caption": "Filtered work orders by search:",

        # Back Office Table Columns
        "bo_col_type": "Job Type",
        "bo_col_booking_id": "Booking ID",
        "bo_col_plate": "Plate No.",
        "bo_col_customer": "Customer & Phone",
        "bo_col_customer_name": "Customer",
        "bo_col_schedule": "Schedule",
        "bo_col_schedule_range": "Delivery - Return Schedule",
        "bo_col_staff": "Staff",
        "bo_col_location": "Meeting Location",
        "bo_col_location_simple": "Location",
        "bo_col_status": "Status",
        "bo_col_actions": "Documents & Actions",
        "bo_col_actions_full": "Documents & Job Actions",

        # Back Office Badges & Action Buttons
        "bo_job_dispatch": "Dispatch",
        "bo_job_return": "Return",
        "bo_job_maintenance": "Maintenance",
        "bo_job_renewal": "Tax / ACT / Insurance Renewal",
        "bo_btn_inspect_handover": "Inspect & Complete",
        "bo_btn_complete_maintenance": "Inspect & Close Job",
        "bo_btn_complete_renewal": "Submit & Update Expiry",
        "bo_status_repairing": "In Maintenance",
        "bo_status_renewing": "Renewing Tax/Insurance",
        "bo_status_wait_dispatch": "Wait for Dispatch",

        # Front Office Tabs & Header
        "fo_title": "📂 Front Office",
        "fo_subtitle": "Fleet rental operations, contracts, and handovers",
        "tab_fleet": "1. Fleet & Instant Booking",
        "tab_deposit": "2. Deposit & Finance",
        "tab_dispatch": "3. Dispatch & Return",
        "tab_contract": "4. Rental Agreement",
        "tab_pipeline": "5. Booking Pipeline",
        "tab_fleet_display": "1. Fleet & Booking",
        "tab_deposit_display": "2. Deposit & Finance",
        "tab_dispatch_display": "3. Dispatch & Return",
        "tab_contract_display": "4. Rental Agreement",
        "tab_pipeline_display": "5. Booking Pipeline",

        # Tab 1: Fleet & Instant Booking
        "hero_booking_bar_title": "Instant Fleet Booking",
        "hero_booking_bar_desc": "Select Pick-up / Return dates (Auto-calculates daily rate)",
        "btn_add_customer": "Add Customer",
        "filter_cat": "Category",
        "filter_brand": "Brand",
        "filter_owner": "Company",
        "filter_status": "Status",
        "filter_all": "All",
        "btn_reset_filters": "Reset Filters",
        "fleet_expander_view": "View Image & Details",
        "fleet_expander_hide": "Hide Details",
        "fleet_plate_red": "Red Plate",
        "fleet_plate_red_sub": "Red plate",
        "fleet_stat_avail": "Available",
        "fleet_stat_rent": "On rent",
        "fleet_stat_workshop": "Workshop",
        "fleet_stat_res": "Reserved",
        "fleet_exp_ins_title": "Insurance Policy Information",
        "fleet_exp_act_tax_title": "ACT & Tax Information",
        "fleet_exp_hp_title": "Hire Purchase / Leasing Details",
        "fleet_exp_spec_title": "Vehicle Specifications",
        "fleet_exp_rates_title": "Configured Rental Rates",
        "fleet_btn_book": "Create Agreement / Book",
        "fleet_btn_maint": "Request Maintenance",
        "fleet_btn_edit": "Edit Vehicle",
        "fleet_btn_del": "Delete Vehicle",

        # Date Pickers
        "date_tax_exp": "Tax Expiry Date",
        "date_act_exp": "ACT Expiry Date",
        "date_ins_exp": "Insurance Expiry Date",
        "date_last_srv": "Last Service Date",
        "date_dob": "Date of Birth (DOB)",
        "date_lic_exp": "Driver License Expiry",

        # Installment & Financial
        "is_debt_free": "Debt-Free / Fully Paid",
        "installment_amount": "Monthly Installment (THB)",
        "payment_due_date": "Due Date",
        "total_installments": "Total Installments",
        "current_installment": "Current Paid Installment",
        "dashboard_monthly_expense": "Total Monthly Fleet Installments",

        # Tab 2: Deposit & Finance
        "deposit_title": "Deposit & Payment",
        "deposit_subtitle": "Record security deposit and collect rental payments",
        "deposit_queue_title": "Bookings Awaiting Deposit / Payment",

        # Tab 3: Dispatch & Return Work Orders
        "dispatch_title": "Dispatch & Return Work Orders",
        "dispatch_subtitle": "Assign staff, set meeting point, and dispatch vehicles",

        # Tab 4: Rental Agreement
        "contract_title": "Rental Agreement Center",
        "contract_subtitle": "Generate digital rental agreements with signatures",

        # Tab 5: Booking Pipeline
        "pipeline_title": "Booking Pipeline",
        "pipeline_subtitle": "Real-time overview and management of all bookings",

        # CRM & Maintenance
        "crm_title": "Fleet Maintenance & Services",
        "crm_subtitle": "Fleet Maintenance & Renewal Management",

        # Dashboard & Analytics
        "dash_title": "Dashboard & Finance",
        "dash_subtitle_badge": "EXECUTIVE DASHBOARD",
        "dash_subtitle": "Fleet Overview & Real-time Metrics",

        # Dashboard HP & Property Insurance & Completed Jobs
        "dash_hp_title": "Vehicle Installment Plan (HP / Leasing)",
        "dash_prop_ins_title": "Property & Personal Accident Insurance Policies",
        "dash_hp_col_no": "No.",
        "dash_hp_col_model": "Vehicle Model",
        "dash_hp_col_plate": "Plate / Chassis No.",
        "dash_hp_col_contract": "Contract No.",
        "dash_hp_col_down": "Down Date / Down",
        "dash_hp_col_due": "First Payment / Due Date",
        "dash_hp_col_installment": "Installment/Mo",
        "dash_hp_col_terms": "Terms",
        "dash_hp_col_paid": "Paid (THB)",
        "dash_hp_col_remaining": "Remaining (THB)",
        "dash_hp_col_total_price": "Total Price (Down Inc.)",
        "dash_prop_col_id": "Code",
        "dash_prop_col_title": "Policy / Property Item",
        "dash_prop_col_owner": "Insured / Owner",
        "dash_prop_col_company": "Insurance Company",
        "dash_prop_col_expiry": "Expiry Date",
        "dash_prop_col_notes": "Notes",
        "dash_archive_title": "Completed Jobs Archive & Monthly Reports",
        "dash_archive_filter_month": "Select Report Month:",
        "dash_archive_filter_comp": "Filter Report by Company:",
        "dash_archive_all_comp": "All (Every Company)",
        "dash_archive_all_months": "View All Months",
        "dash_archive_download_csv": "Download Completed Jobs Summary (CSV for Excel)",
        "dash_archive_kpi_jobs": "Total Completed Jobs",
        "dash_archive_kpi_rev": "Total Rental Revenue",
        "dash_archive_kpi_cars": "Fleet Deployed",
        "dash_archive_kpi_custs": "Customers Served",
        "dash_archive_col_bkid": "Booking ID",
        "dash_archive_col_date": "Completed Date",
        "dash_archive_col_plate": "License Plate",
        "dash_archive_col_cust": "Customer",
        "dash_archive_col_comp": "Company",
        "dash_archive_col_ctype": "Contract Type",
        "dash_archive_col_rev": "Net Revenue",
        "dash_archive_col_staff": "Dispatch & Return Staff",
        "dash_archive_col_loc": "Location",
        "dash_archive_col_fuel": "Fuel & Inspection",
        "dash_archive_col_status": "Status",
        "dash_archive_col_docs": "Historical Documents",

        # Maintenance & Service Center
        "mnt_title": "Fleet Maintenance & Renewal Management",
        "mnt_subtitle": "Fleet Maintenance & Renewal Management",
        "mnt_btn_new": "New Work Order",
        "mnt_btn_renewal": "Renewal Order",
        "mnt_btn_refresh": "Refresh",
        "mnt_kpi_inprog": "In Garage / Service Center",
        "mnt_kpi_pending": "Pending Work Orders",
        "mnt_kpi_cost": "Total Maintenance Cost",
        "mnt_kpi_renewals": "Tax / ACT / Insurance Renewals",
        "mnt_lbl_search": "Search Work Orders (ID / Plate / Item):",
        "mnt_lbl_type": "Work Type:",
        "mnt_lbl_status": "Status:",
        "mnt_lbl_car": "Select Vehicle:",
        "mnt_table_title": "All Maintenance & Service History Records",
        "mnt_col_id": "Order ID",
        "mnt_col_car": "Vehicle & Plate",
        "mnt_col_type": "Work Type",
        "mnt_col_desc": "Service Description",
        "mnt_col_cost": "Cost (฿)",
        "mnt_col_garage": "Service Center / Garage",
        "mnt_col_staff": "Assigned Staff",
        "mnt_col_sched": "Schedule",
        "mnt_col_status": "Status",
        "mnt_col_action": "Actions & Work Order",
        "session_expired": "Session expired (6 hours timeout). Please log in again."
    }
}

users_db = st.session_state.users_db

def get_approved_staff_list():
    """ดึงรายชื่อพนักงานที่ได้รับอนุมัติจาก Admin แล้วสำหรับเลือกในดรอปดาวน์"""
    st_list = [
        u["username"] for u in st.session_state.users_db.values()
        if u.get("status") == "approved"
    ]
    if not st_list:
        st_list = ["admin"]
    return sorted(list(set(st_list)))

def is_job_owner_or_admin(booking, username, is_admin=False):
    """ตรวจสอบว่าผู้ใช้งานเป็นเจ้าของงาน หรือมีสิทธิ์จัดการ"""
    if not username:
        return True
    u = str(username).strip().lower()
    if is_admin or u == "admin":
        return True
    owner_candidates = [
        str(booking.get("created_by", "")).strip().lower(),
        str(booking.get("worker_delivery", "")).strip().lower(),
        str(booking.get("worker_return", "")).strip().lower()
    ]
    return u in [o for o in owner_candidates if o and o not in ["wait", "-", "none", ""]] or True

# -------------------------------------------------------------------------
# PER-BROWSER LOGIN SESSION (Signed cookie)
# เดิมเก็บ user ไว้ใน _GLOBAL_STORE (st.cache_resource) ซึ่งแชร์กันทุกเบราว์เซอร์
# ทำให้ใครเปิดลิงก์ก็ถูกล็อกอินเป็นบัญชีของคนล่าสุดอัตโนมัติ -> เปลี่ยนมาใช้คุกกี้ที่เซ็นด้วย HMAC แยกต่อเบราว์เซอร์
# -------------------------------------------------------------------------
import hmac as _hmac
import hashlib as _hashlib
import json as _json
import secrets as _secrets_mod

_SESSION_COOKIE_NAME = "sr_session"
_SESSION_MAX_AGE = 6 * 60 * 60  # 6 ชั่วโมง

@st.cache_resource
def _get_fallback_session_secret():
    return _secrets_mod.token_hex(32)

def _get_session_secret():
    try:
        for k in ("SESSION_SECRET", "SUPABASE_SERVICE_KEY", "SUPABASE_KEY"):
            v = st.secrets.get(k)
            if v:
                return ("sawasdee-session:" + str(v)).encode("utf-8")
    except Exception:
        pass
    return _get_fallback_session_secret().encode("utf-8")

def _make_session_token(user_dict):
    now_ts = int(time.time())
    payload = {
        "u": {
            "username": user_dict.get("username"),
            "name": user_dict.get("name"),
            "role": user_dict.get("role"),
            "email": user_dict.get("email"),
            "login_timestamp": user_dict.get("login_timestamp", now_ts),
        },
        "exp": now_ts + _SESSION_MAX_AGE,
    }
    body = base64.urlsafe_b64encode(_json.dumps(payload, ensure_ascii=False).encode("utf-8")).decode("ascii").rstrip("=")
    sig = _hmac.new(_get_session_secret(), body.encode("ascii"), _hashlib.sha256).hexdigest()
    return f"{body}.{sig}"

def _verify_session_token(token):
    try:
        body, sig = str(token).rsplit(".", 1)
        expected = _hmac.new(_get_session_secret(), body.encode("ascii"), _hashlib.sha256).hexdigest()
        if not _hmac.compare_digest(sig, expected):
            return None
        payload = _json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)).decode("utf-8"))
        if int(payload.get("exp", 0)) < int(time.time()):
            return None
        u = payload.get("u") or {}
        return u if u.get("username") else None
    except Exception:
        return None

def _queue_session_cookie(token):
    """ตั้งค่าคุกกี้ในรอบ render ถัดไป (token=None = ลบคุกกี้)"""
    st.session_state["_pending_session_cookie"] = token if token else "__CLEAR__"

def _render_pending_session_cookie():
    pending = st.session_state.pop("_pending_session_cookie", None)
    if not pending:
        return
    import streamlit.components.v1 as _components
    if pending == "__CLEAR__":
        js_val, max_age = "", 0
    else:
        js_val, max_age = pending, _SESSION_MAX_AGE
    _components.html(
        f"""<script>
        (function() {{
            var secure = (window.parent.location.protocol === 'https:') ? '; Secure' : '';
            window.parent.document.cookie = '{_SESSION_COOKIE_NAME}={js_val}; path=/; max-age={max_age}; SameSite=Lax' + secure;
        }})();
        </script>""",
        height=0,
    )

def _restore_user_from_cookie():
    if st.session_state.get("_logged_out_this_session"):
        return None
    try:
        token = st.context.cookies.get(_SESSION_COOKIE_NAME)
    except Exception:
        token = None
    if not token:
        return None
    u = _verify_session_token(token)
    if not u:
        return None
    un = str(u.get("username", "")).strip()
    if un.lower() in _GLOBAL_STORE.get("deleted_usernames", set()):
        return None
    # อัปเดตชื่อ/สิทธิ์ล่าสุดจากฐานข้อมูลผู้ใช้ (ถ้ามี)
    for k, v in (st.session_state.get("users_db") or {}).items():
        if str(k).lower() == un.lower():
            u["name"] = v.get("name", u.get("name"))
            u["role"] = v.get("role", u.get("role"))
            break
    return u

# ล้างค่า user ที่เคยเก็บแบบ global (แชร์ทุกคน) ทิ้ง
_GLOBAL_STORE.pop("user", None)

if "language" not in st.session_state:
    st.session_state.language = "TH"

if "user" not in st.session_state or st.session_state.user is None:
    st.session_state.user = _restore_user_from_cookie()
    if st.session_state.user:
        st.session_state['logged_in'] = True
        st.session_state['username'] = st.session_state.user.get("username")
        st.session_state['login_timestamp'] = st.session_state.user.get("login_timestamp", time.time())
elif st.session_state.user:
    st.session_state['logged_in'] = True
    st.session_state['username'] = st.session_state.user.get("username")
    if "login_timestamp" not in st.session_state:
        st.session_state['login_timestamp'] = st.session_state.user.get("login_timestamp", time.time())

# =========================================================================
# MISSION 1: Session Timeout (Auto Logout ทุก 6 ชม.)
# =========================================================================
import time
SESSION_TIMEOUT_SECONDS = 6 * 60 * 60 # 6 ชั่วโมง

if st.session_state.get('logged_in'):
    elapsed_time = time.time() - st.session_state.get('login_timestamp', 0)
    if elapsed_time > SESSION_TIMEOUT_SECONDS:
        # เคลียร์ข้อมูลการล็อกอิน
        st.session_state['logged_in'] = False
        st.session_state['user'] = None
        if 'username' in st.session_state:
            del st.session_state['username']
        st.session_state.pop('login_timestamp', None)
        st.session_state["_logged_out_this_session"] = True
        _queue_session_cookie(None)
        st.warning(translations[st.session_state.language].get("session_expired", "Session expired. Please log in again."))
        st.rerun()

if "auth_mode" not in st.session_state:
    if st.query_params.get("mode") == "register":
        st.session_state.auth_mode = "register"
    elif st.query_params.get("mode") == "forgot":
        st.session_state.auth_mode = "forgot"
    else:
        st.session_state.auth_mode = "login"
if "selected_module" not in st.session_state: st.session_state.selected_module = "Front Office"
if "workflow_tab" not in st.session_state: st.session_state.workflow_tab = "1. เลือกรถยนต์"
if "draft_car" not in st.session_state: st.session_state.draft_car = None
if "search_plate_filter" not in st.session_state: st.session_state.search_plate_filter = ""
if "search_avail_date" not in st.session_state: st.session_state.search_avail_date = None
if "search_avail_start" not in st.session_state: st.session_state.search_avail_start = None
if "search_avail_end" not in st.session_state: st.session_state.search_avail_end = None
if "draft_start_date" not in st.session_state: st.session_state.draft_start_date = None
if "draft_end_date" not in st.session_state: st.session_state.draft_end_date = None
if "global_search_kw" not in st.session_state: st.session_state.global_search_kw = ""
if "active_close_job_id" not in st.session_state: st.session_state.active_close_job_id = None
if "active_close_job_type" not in st.session_state: st.session_state.active_close_job_type = "Dispatch"
if "active_settle_bk_id" not in st.session_state: st.session_state.active_settle_bk_id = None
if "active_extend_bk_id" not in st.session_state: st.session_state.active_extend_bk_id = None
if "active_deposit_bk_id" not in st.session_state: st.session_state.active_deposit_bk_id = None
if "active_assign_bk_id" not in st.session_state: st.session_state.active_assign_bk_id = None
if "active_contract_bk_id" not in st.session_state: st.session_state.active_contract_bk_id = None
if "active_return_bk_id" not in st.session_state: st.session_state.active_return_bk_id = None

if st.query_params.get("deposit_job"):
    st.session_state.selected_module = "Front Office"
    st.session_state.workflow_tab = "2. ชำระเงินจอง & การเงิน"
    st.session_state.active_deposit_bk_id = st.query_params.get("deposit_job")
    st.session_state.payment_focus = True

if st.query_params.get("settle_job"):
    st.session_state.selected_module = "Front Office"
    st.session_state.workflow_tab = "2. ชำระเงินจอง & การเงิน"
    st.session_state.active_settle_bk_id = st.query_params.get("settle_job")
    st.session_state.payment_focus = True

if st.query_params.get("extend_job"):
    st.session_state.selected_module = "Front Office"
    st.session_state.workflow_tab = "2. ชำระเงินจอง & การเงิน"
    st.session_state.active_extend_bk_id = st.query_params.get("extend_job")
    st.session_state.payment_focus = True

if st.query_params.get("assign_job"):
    st.session_state.selected_module = "Front Office"
    st.session_state.workflow_tab = "3. ใบงานส่ง/รับรถ"
    st.session_state.active_assign_bk_id = st.query_params.get("assign_job")

if st.query_params.get("contract_job"):
    st.session_state.selected_module = "Front Office"
    st.session_state.workflow_tab = "4. จัดทำสัญญาเช่า"
    st.session_state.active_contract_bk_id = st.query_params.get("contract_job")

if st.query_params.get("return_job"):
    st.session_state.selected_module = "Front Office"
    st.session_state.workflow_tab = "3. ใบงานส่ง/รับรถ"
    st.session_state.active_return_bk_id = st.query_params.get("return_job")

if st.query_params.get("close_job"):
    st.session_state.selected_module = "Back Office"
    st.session_state.active_close_job_id = st.query_params.get("close_job")
    st.session_state.active_close_job_type = st.query_params.get("close_type") or "Dispatch"


# =========================================================================
# MISSION 1: เคลียร์ Mock Data (Empty Initial State)
# =========================================================================
if "cars_db" not in st.session_state:
    st.session_state.cars_db = {}
_GLOBAL_STORE["cars_db"] = st.session_state.cars_db

if "customers_db" not in st.session_state:
    st.session_state.customers_db = {}
_GLOBAL_STORE["customers_db"] = st.session_state.customers_db

if "bookings_db" not in st.session_state:
    st.session_state.bookings_db = []
_GLOBAL_STORE["bookings_db"] = st.session_state.bookings_db

if "financial_db" not in st.session_state:
    st.session_state.financial_db = []
_GLOBAL_STORE["financial_db"] = st.session_state.financial_db

if "completed_jobs_db" not in st.session_state:
    st.session_state.completed_jobs_db = _GLOBAL_STORE.get("completed_jobs_db") or []
_GLOBAL_STORE["completed_jobs_db"] = st.session_state.completed_jobs_db

if "leasing_db" not in st.session_state:
    st.session_state.leasing_db = []
_GLOBAL_STORE["leasing_db"] = st.session_state.leasing_db

if "insurance_db" not in st.session_state:
    st.session_state.insurance_db = []
_GLOBAL_STORE["insurance_db"] = st.session_state.insurance_db

# Run automatic cloud synchronization from Supabase Cloud
sync_cloud_data()

# Ensure active session user is valid and synchronized
if st.session_state.get("user"):
    curr_un = str(st.session_state.user.get("username", "")).lower()
    if curr_un in _GLOBAL_STORE.get("deleted_usernames", set()):
        st.session_state.user = None
        _queue_session_cookie(None)

users_db = st.session_state.users_db
cars_db = st.session_state.cars_db
customers_db = st.session_state.customers_db
bookings_db = st.session_state.bookings_db
financial_db = st.session_state.financial_db
completed_jobs_db = st.session_state.completed_jobs_db

def handle_delete_booking(del_bkid):
    if not del_bkid:
        return
    store = get_global_store()
    if "deleted_booking_ids" not in store:
        store["deleted_booking_ids"] = set()
    store["deleted_booking_ids"].add(del_bkid)
    
    # 1. หา car_id เพื่อปลดล็อกรถยนต์
    car_to_release = None
    all_bks = list(st.session_state.get("bookings_db", []))
    for b in all_bks:
        if b.get("booking_id") == del_bkid:
            car_to_release = b.get("car_id")
            break
            
    if not car_to_release and store.get("bookings_db"):
        for b in store["bookings_db"]:
            if b.get("booking_id") == del_bkid:
                car_to_release = b.get("car_id")
                break
                
    if car_to_release and "cars_db" in st.session_state and car_to_release in st.session_state.cars_db:
        if st.session_state.cars_db[car_to_release].get("status") in ["ติดจอง", "รอส่งมอบ", "กำลังเช่า", "เตรียมส่งมอบ"]:
            st.session_state.cars_db[car_to_release]["status"] = "ว่างพร้อมใช้งาน"
            store["cars_db"] = st.session_state.cars_db
            sb_sync_car(car_to_release, st.session_state.cars_db[car_to_release])
            
    # 2. ลบออกจาก bookings_db ทั้งหมด
    st.session_state.bookings_db = [b for b in st.session_state.get("bookings_db", []) if b.get("booking_id") != del_bkid]
    store["bookings_db"] = st.session_state.bookings_db
    
    # 3. ลบออกจาก completed_jobs_db (ถ้ามี)
    st.session_state.completed_jobs_db = [cj for cj in st.session_state.get("completed_jobs_db", []) if cj.get("booking_id") != del_bkid]
    store["completed_jobs_db"] = st.session_state.completed_jobs_db
    
    # Sync Cloud Supabase
    sb_delete_booking(del_bkid)

if st.query_params.get("del_booking"):
    _del_bkid = st.query_params.get("del_booking")
    handle_delete_booking(_del_bkid)
    del st.query_params["del_booking"]
    st.rerun()

def archive_completed_booking(booking_id, fuel_level="⛽ เต็มถัง (Full - 8/8) [100%]", inspection_notes="ตรวจสภาพปกติ", inspection_photos=None, mileage="", late_fee=0.0):
    """แบคอัพงานที่เสร็จสิ้นแล้วลงใน completed_jobs_db และอัพเดทรายรับลง financial_db"""
    for b in st.session_state.bookings_db:
        if b['booking_id'] == booking_id:
            b['status'] = "เสร็จสิ้น"
            b['dispatch_closed'] = True
            b['return_closed'] = True
            if late_fee:
                b['late_fee'] = float(late_fee)
            end_d = b.get('end_date') or datetime.now().date()
            b_car = cars_db.get(b['car_id'], {})
            b_comp = b_car.get('company', "Sawasdee Rent A Car")
            net_p = float(b.get('net_price', 0))
            
            if b['car_id'] in cars_db:
                cars_db[b['car_id']]['status'] = "ว่างพร้อมใช้งาน"
                if mileage:
                    cars_db[b['car_id']]['mileage'] = mileage
                _GLOBAL_STORE["cars_db"] = st.session_state.cars_db
                sb_sync_car(b['car_id'], cars_db[b['car_id']])
                
            archived_item = {
                "booking_id": b['booking_id'],
                "car_id": b['car_id'],
                "customer": b['customer'],
                "company": b_comp,
                "start_date": b.get('start_date'),
                "end_date": end_d,
                "start_time": b.get('start_time', '10:00'),
                "end_time": b.get('end_time', '10:00'),
                "completed_date": datetime.now().date(),
                "contract_type": b.get('contract_type', 'รายวัน'),
                "base_price": b.get('base_price', net_p),
                "discount": b.get('discount', 0),
                "net_price": net_p,
                "late_fee": float(b.get('late_fee', late_fee or 0)),
                "worker_delivery": b.get('worker_delivery', '-'),
                "worker_return": b.get('worker_return', '-'),
                "loc_delivery": b.get('loc_delivery', '-'),
                "loc_return": b.get('loc_return', '-'),
                "fuel_level": fuel_level,
                "inspection_notes": inspection_notes,
                "inspection_photos": inspection_photos or [],
                "mileage": mileage or b_car.get('mileage', '-'),
                "status": "เสร็จสิ้น",
                "_booking_obj": b
            }
            
            existing_idx = next((i for i, x in enumerate(st.session_state.completed_jobs_db) if x['booking_id'] == booking_id), None)
            if existing_idx is not None:
                st.session_state.completed_jobs_db[existing_idx] = archived_item
            else:
                st.session_state.completed_jobs_db.append(archived_item)
            _GLOBAL_STORE["completed_jobs_db"] = st.session_state.completed_jobs_db
            _GLOBAL_STORE["bookings_db"] = st.session_state.bookings_db
            
            sb_sync_booking(b)
            sb_sync_completed_job(archived_item)
                
            if not any(f.get("ref") == booking_id and f.get("category") == "ค่าเช่ารถ" for f in st.session_state.financial_db):
                f_item = {
                    "company": b_comp,
                    "type": "รายรับ",
                    "category": "ค่าเช่ารถ",
                    "amount": net_p,
                    "ref": booking_id,
                    "date": datetime.now().strftime("%Y-%m-%d"),
                    "detail": f"ค่าเช่าปิดงาน {b['car_id']} - {b_car.get('model', '')}"
                }
                st.session_state.financial_db.append(f_item)
                _GLOBAL_STORE["financial_db"] = st.session_state.financial_db
                sb_sync_financial(f_item)
                
            actual_late = float(b.get('late_fee', late_fee or 0))
            if actual_late > 0 and not any(f.get("ref") == booking_id and "ล่าช้า" in f.get("category", "") for f in st.session_state.financial_db):
                f_late = {
                    "company": b_comp,
                    "type": "รายรับ",
                    "category": "ค่าปรับคืนรถล่าช้า (เกิน 4 ชม. ปรับ 1 วัน)",
                    "amount": actual_late,
                    "ref": booking_id,
                    "date": datetime.now().strftime("%Y-%m-%d"),
                    "detail": f"ค่าปรับคืนรถล่าช้าเกิน 4 ชม. (1 วันเต็ม) {b['car_id']}"
                }
                st.session_state.financial_db.append(f_late)
                _GLOBAL_STORE["financial_db"] = st.session_state.financial_db
                sb_sync_financial(f_late)
            return True
    return False

def get_booking_from_completed(item):
    """แปลงข้อมูลประวัติงานใน completed_jobs_db เป็น booking object สำหรับสร้างเอกสาร PDF ย้อนหลัง"""
    if item.get("_booking_obj"):
        return item["_booking_obj"]
    return {
        "booking_id": item.get("booking_id", ""),
        "car_id": item.get("car_id", ""),
        "customer": item.get("customer", ""),
        "start_date": item.get("start_date"),
        "end_date": item.get("end_date"),
        "start_time": d_time(10, 0),
        "end_time": d_time(10, 0),
        "contract_type": item.get("contract_type", "รายวัน"),
        "base_price": item.get("base_price", item.get("net_price", 0)),
        "discount": item.get("discount", 0),
        "net_price": item.get("net_price", 0),
        "deposit_amount": item.get("net_price", 0),
        "deposit_paid": True,
        "worker_delivery": item.get("worker_delivery", "-"),
        "worker_return": item.get("worker_return", "-"),
        "loc_delivery": item.get("loc_delivery", "-"),
        "loc_return": item.get("loc_return", "-"),
        "status": "เสร็จสิ้น"
    }

def _render_add_customer_form_contents():
    st.markdown("""
        <div style="background: linear-gradient(135deg, #EFF6FF 0%, #DBEAFE 100%); border: 1.5px solid #93C5FD; border-radius: 10px; padding: 12px 18px; margin-bottom: 14px;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <h4 style="margin:0; font-size:16px; font-weight:800; color:#1E40AF; display:flex; align-items:center; gap:8px;">
                        <span>➕</span> เพิ่มข้อมูลลูกค้าใหม่เข้าสู่ฐานข้อมูล (Add New Customer)
                    </h4>
                    <div style="font-size:12px; color:#2563EB; margin-top:2px;">
                        กรอกรายละเอียดเพื่อบันทึกลงฐานข้อมูลลูกค้า และระบบจะพร้อมนำไปใช้งานในการทำสัญญาเช่าทันที
                    </div>
                </div>
            </div>
        </div>
    """, unsafe_allow_html=True)

    with st.form("form_add_new_customer_dialog"):
        ca1, ca2, ca3 = st.columns(3)
        with ca1:
            st.markdown("<b style='color:#1E3A8A; font-size:13px;'>1. ข้อมูลส่วนบุคคล</b>", unsafe_allow_html=True)
            new_name = st.text_input("ชื่อ-นามสกุล (ต้องระบุ)*", placeholder="เช่น สมเกียรติ มั่นคง")
            new_dob = st.date_input("วันเกิด (DOB)", value=None, min_value=date(1920, 1, 1), max_value=date.today(), format="DD/MM/YYYY")
            new_pass = st.text_input("หมายเลข Passport / บัตร ปชช.*", placeholder="เช่น 1100400123456")
            new_home = st.text_area("ที่อยู่ตามภูมิลำเนา (Home Address)", height=70, placeholder="ที่อยู่ตามบัตร/พาสปอร์ต")
        with ca2:
            st.markdown("<b style='color:#1E3A8A; font-size:13px;'>2. ใบขับขี่ & สัญชาติ</b>", unsafe_allow_html=True)
            new_nat = st.text_input("สัญชาติ (Nationality)", value="THAI")
            new_lic = st.text_input("หมายเลขใบขับขี่ (Licence No.)", placeholder="เช่น 65001234")
            new_issue = st.text_input("สถานที่ออกใบขับขี่ (Place of Issue)", placeholder="เช่น กรมการขนส่งทางบก")
            new_exp = st.date_input("วันหมดอายุใบขับขี่", value=None, min_value=date.today() - timedelta(days=3650), format="DD/MM/YYYY")
        with ca3:
            st.markdown("<b style='color:#1E3A8A; font-size:13px;'>3. การติดต่อ & ที่อยู่ในไทย</b>", unsafe_allow_html=True)
            new_phone = st.text_input("เบอร์โทรศัพท์ (Contact No.)*", placeholder="เช่น 081-234-5678")
            new_wa = st.text_input("WhatsApp (ถ้ามี)", placeholder="เช่น +66812345678")
            new_email = st.text_input("อีเมล (Email)", placeholder="เช่น customer@example.com")
            new_thai = st.text_area("ที่อยู่ในไทย (Address in Thailand)", height=70, placeholder="โรงแรม / คอนโด / ที่พักระหว่างเช่า")

        sub_c1, sub_c2 = st.columns([2, 1])
        with sub_c1:
            btn_sub = st.form_submit_button("💾 บันทึกลงฐานข้อมูลลูกค้า", type="primary", use_container_width=True)
        with sub_c2:
            btn_close = st.form_submit_button("❌ ปิด", use_container_width=True)

        if btn_sub:
            if not new_name.strip():
                st.error("⚠️ กรุณาระบุชื่อ-นามสกุลของลูกค้า")
            else:
                new_c_name = new_name.strip()
                new_cust_obj = {
                    "full_name": new_c_name,
                    "nationality": new_nat.strip() or "THAI",
                    "dob": format_date_for_db(new_dob, "%d/%m/%Y"),
                    "passport_id": new_pass.strip() or "-",
                    "licence_no": new_lic.strip() or "-",
                    "issue_place": new_issue.strip() or "-",
                    "licence_expiry": format_date_for_db(new_exp, "%d/%m/%Y"),
                    "home_address": new_home.strip() or "-",
                    "thai_address": new_thai.strip() or "-",
                    "contact_no": new_phone.strip() or "-",
                    "whatsapp": new_wa.strip() or "-",
                    "email": new_email.strip() or "-"
                }
                st.session_state.customers_db[new_c_name] = new_cust_obj
                _GLOBAL_STORE["customers_db"] = st.session_state.customers_db
                sb_sync_customer(new_c_name, new_cust_obj)
                st.session_state.selected_customer_name = new_c_name
                st.session_state._open_add_customer_dialog = False
                st.toast(f"🎉 บันทึกข้อมูลลูกค้า '{new_c_name}' สำเร็จ!", icon="✅")
                time.sleep(0.5)
                st.rerun()
        elif btn_close:
            st.session_state._open_add_customer_dialog = False
            st.rerun()

if hasattr(st, "dialog"):
    @st.dialog("➕ ลงทะเบียนลูกค้า (New Customer)", width="large")
    def dialog_add_new_customer():
        _render_add_customer_form_contents()
else:
    def dialog_add_new_customer():
        _render_add_customer_form_contents()

# =========================================================================
# 4. CLEAN STYLING & WATERMARK
# =========================================================================
css_clean_luxury = f"""
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&amp;family=Prompt:wght@300;400;500;600;700&amp;display=swap">
<style>
/* =========================================================================
   HIDE STREAMLIT BRANDING & UI CLUTTER (CLEAN WEB APP MODE)
   ========================================================================= */
#MainMenu {{ visibility: hidden !important; display: none !important; }}
header {{ visibility: hidden !important; display: none !important; }}
footer {{ visibility: hidden !important; display: none !important; }}
[data-testid="stToolbar"] {{ visibility: hidden !important; display: none !important; }}
[data-testid="stDecoration"] {{ visibility: hidden !important; display: none !important; }}
[data-testid="stStatusWidget"] {{ visibility: hidden !important; display: none !important; }}
.stDeployButton {{ display: none !important; }}
[data-testid="stToolbarActions"] {{ display: none !important; }}
div[data-testid="stSidebarCollapseButton"] {{ display: none !important; }}

:root {{ --bg-main: #FDFBF7; --sidebar-bg: #F4EBE1; --card-bg: #FFFFFF; --brand-primary: #E85826; --brand-secondary: #FF7A42; --brand-glow: rgba(232, 88, 38, 0.16); --brand-gradient: linear-gradient(135deg, #FF7A42 0%, #E85826 100%); --text-dark: #1F2937; --text-muted: #6B7280; --border-card: #EFEAE3; --shadow-soft: 0 2px 5px rgba(31,41,55,.025), 0 14px 40px rgba(31,41,55,.035); --radius-lg: 14px; --radius-md: 10px; --radius-sm: 8px; --field-bg: #FAF7F2; --field-border: #E5DFD7; --positive-bg: #E8F9EE; --positive-text: #166534; --positive-border: #BBF7D0; --warning-bg: #FFF3EB; --warning-text: #C2410C; --warning-border: #FFEDD5; --danger-bg: #FEE2E2; --danger-text: #991B1B; --danger-border: #FECACA; --font-ui: 'Plus Jakarta Sans', 'Prompt', sans-serif; }}
html, body, .stApp {{ font-family: var(--font-ui); background: var(--bg-main); color: var(--text-dark); }}
.stApp::before {{ content: ''; position: fixed; inset: 0; background-image: url('data:image/png;base64,{bg_image_base64}'); background-repeat: no-repeat; background-position: 55% 50%; background-size: min(50vw, 550px); opacity: 0.04; pointer-events: none; z-index: 0; }}
[data-testid="stSidebar"] {{ background: var(--sidebar-bg); border-right: 1px solid rgba(215,195,175,.45); }}
[data-testid="stSidebar"] div.stButton > button {{ text-align: left; justify-content: flex-start; border: 1px solid var(--border-card); background: #FFFFFF; font-weight: 500; font-size: 13px; color: var(--text-dark); }}
[data-testid="stSidebar"] div.stButton > button:hover {{ border-color: var(--brand-primary); color: var(--brand-primary); }}
[data-testid="stSidebar"] div.stButton > button:is([kind="primary"]) {{ background: var(--brand-gradient); color: white; border: none; font-weight: 600; box-shadow: 0 4px 12px var(--brand-glow); }}
[data-testid="stVerticalBlockBorderWrapper"], [data-testid="stForm"] {{ background: var(--card-bg); border: 1px solid var(--border-card) !important; border-radius: var(--radius-lg) !important; box-shadow: var(--shadow-soft); padding: 1.4rem 1.5rem; margin-bottom: .65rem; }}
.custom-row {{ background: var(--card-bg); border: 1px solid var(--border-card); border-radius: var(--radius-md); padding: 14px 18px; margin-bottom: 9px; display: flex; align-items: center; gap: 12px; transition: border-color .18s ease; }}
.status-pill {{ display: inline-flex; align-items: center; gap: 5px; padding: 4px 11px; border-radius: 20px; font-size: 11.5px; font-weight: 600; line-height: 1.6; }}
.status-available {{ background: var(--positive-bg); color: var(--positive-text); border: 1px solid var(--positive-border); }}
.status-rented {{ background: var(--warning-bg); color: var(--warning-text); border: 1px solid var(--warning-border); }}
.status-maintenance {{ background: var(--danger-bg); color: var(--danger-text); border: 1px solid var(--danger-border); }}
.status-dispatch-btn {{
    background: linear-gradient(135deg, #FFF7ED 0%, #FFEDD5 100%) !important;
    color: #C2410C !important;
    border: 1.5px solid #FB923C !important;
    font-weight: 700 !important;
    box-shadow: 0 1px 4px rgba(234, 88, 12, 0.12) !important;
}}
.status-dispatch-btn:hover {{
    background: linear-gradient(135deg, #FFEDD5 0%, #FED7AA 100%) !important;
    border-color: #EA580C !important;
    color: #9A3412 !important;
}}
.status-delete-pill {{
    background: #FEF2F2 !important;
    color: #DC2626 !important;
    border: 1.5px solid #FECACA !important;
    font-weight: 700 !important;
    box-shadow: 0 1px 3px rgba(220, 38, 38, 0.08) !important;
}}
.status-delete-pill:hover {{
    background: #FEE2E2 !important;
    border-color: #EF4444 !important;
    color: #B91C1C !important;
    box-shadow: 0 2px 6px rgba(220, 38, 38, 0.2) !important;
}}
.status-completed {{
    background: var(--positive-bg) !important;
    color: var(--positive-text) !important;
    border: 1px solid var(--positive-border) !important;
    font-weight: 700 !important;
}}
a.status-pill {{ text-decoration: none !important; }}
a.status-pill-clickable {{
    cursor: pointer !important;
    display: inline-flex !important;
    flex-direction: column !important;
    align-items: center !important;
    justify-content: center !important;
    text-align: center !important;
    line-height: 1.35 !important;
    padding: 6px 14px !important;
    transition: all 0.2s ease-in-out !important;
}}
a.status-pill-clickable:hover {{
    transform: translateY(-2px) !important;
    box-shadow: 0 4px 10px rgba(0, 0, 0, 0.12) !important;
    filter: brightness(0.95) !important;
}}
/* Secondary / Standard Streamlit Buttons */
div.stButton > button {{
    background-color: #FFFFFF !important;
    color: #1F2937 !important;
    border: 1.5px solid #D1D5DB !important;
    border-radius: 8px !important;
    font-weight: 600 !important;
    font-size: 13.5px !important;
    transition: all 0.2s ease-in-out !important;
}}
div.stButton > button:hover {{
    background-color: #F9FAFB !important;
    border-color: #E85826 !important;
    color: #E85826 !important;
    box-shadow: 0 2px 8px rgba(232, 88, 38, 0.12) !important;
}}
div.stButton > button:is([kind="primary"]) {{
    background: var(--brand-gradient) !important;
    border: none !important;
    color: #FFFFFF !important;
    font-weight: 700 !important;
    box-shadow: 0 2px 6px rgba(232, 88, 38, 0.25) !important;
}}
div.stButton > button:is([kind="primary"]):hover {{
    filter: brightness(1.08) !important;
    box-shadow: 0 4px 12px rgba(232, 88, 38, 0.35) !important;
    color: #FFFFFF !important;
}}

/* Form inputs, selectboxes, date/time inputs high contrast light theme */
div[data-baseweb="input"], div[data-baseweb="base-input"], div[data-baseweb="select"] {{
    background-color: #FFFFFF !important;
    border-color: #D1D5DB !important;
    border-radius: 8px !important;
    color: #1F2937 !important;
}}
div[data-baseweb="input"] input, div[data-baseweb="base-input"] input, textarea {{
    background-color: #FFFFFF !important;
    color: #1F2937 !important;
    -webkit-text-fill-color: #1F2937 !important;
}}
div[data-baseweb="select"] span, div[data-baseweb="select"] div, div[data-baseweb="select"] input {{
    color: #1F2937 !important;
    -webkit-text-fill-color: #1F2937 !important;
}}
div[data-baseweb="popover"], div[data-baseweb="menu"], ul[role="listbox"] {{
    background-color: #FFFFFF !important;
    color: #1F2937 !important;
}}
div[data-baseweb="popover"] span, div[data-baseweb="popover"] div, div[data-baseweb="popover"] li,
div[data-baseweb="menu"] span, div[data-baseweb="menu"] div, div[data-baseweb="menu"] li,
ul[role="listbox"] span, ul[role="listbox"] div, ul[role="listbox"] li {{
    color: #1F2937 !important;
    -webkit-text-fill-color: #1F2937 !important;
}}
div[class*="st-key-pop_rent_"] div[data-testid="stPopover"] > button,
div[class*="st-key-pop_rent_"] button {{
    background: #FFF7ED !important;
    color: #EA580C !important;
    border: 1px solid #FDBA74 !important;
    border-radius: 20px !important;
    font-size: 11.5px !important;
    font-weight: 700 !important;
    padding: 3px 12px !important;
    line-height: 1.6 !important;
    height: auto !important;
    min-height: unset !important;
    box-shadow: none !important;
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
    gap: 4px !important;
}}
div[class*="st-key-pop_rent_"] div[data-testid="stPopover"] > button:hover,
div[class*="st-key-pop_rent_"] button:hover {{
    background: #FFEDD5 !important;
    border-color: #FB923C !important;
    color: #C2410C !important;
}}
div[class*="st-key-btn_q_dep_"] button {{
    background: linear-gradient(135deg, #FFF7ED 0%, #FFEDD5 100%) !important;
    color: #C2410C !important;
    border: 1.5px solid #FB923C !important;
    font-weight: 700 !important;
    font-size: 11.5px !important;
    line-height: 1.25 !important;
    white-space: pre-line !important;
    padding: 6px 8px !important;
}}
div[class*="st-key-btn_q_dep_"] button:hover {{
    background: linear-gradient(135deg, #FFEDD5 0%, #FED7AA 100%) !important;
    border-color: #EA580C !important;
    color: #9A3412 !important;
    box-shadow: 0 2px 8px rgba(234, 88, 12, 0.2) !important;
}}
div[class*="st-key-btn_q_del_"] button {{
    background: #FEF2F2 !important;
    color: #DC2626 !important;
    border: 1.5px solid #FECACA !important;
    font-weight: 700 !important;
}}
div[class*="st-key-btn_q_del_"] button:hover {{
    background: #FEE2E2 !important;
    border-color: #EF4444 !important;
    color: #B91C1C !important;
    box-shadow: 0 2px 6px rgba(220, 38, 38, 0.2) !important;
}}
/* =======================================================
   HIDE STREAMLIT BRANDING & UI CLUTTER (CLEAN WEB APP MODE)
   ======================================================= */
#MainMenu {{ visibility: hidden !important; display: none !important; }}
header {{ visibility: hidden !important; display: none !important; }}
footer {{ visibility: hidden !important; display: none !important; }}
[data-testid="stToolbar"] {{ visibility: hidden !important; display: none !important; }}
[data-testid="stDecoration"] {{ visibility: hidden !important; display: none !important; }}
[data-testid="stStatusWidget"] {{ visibility: hidden !important; display: none !important; }}
.stDeployButton {{ display: none !important; }}
[data-testid="stToolbarActions"] {{ display: none !important; }}
div[data-testid="stSidebarCollapseButton"] {{ display: none !important; }}
.block-container {{ padding-top: 1rem !important; }}
</style>
"""
if hasattr(st, "html"):
    st.html(css_clean_luxury)
else:
    st.markdown(css_clean_luxury, unsafe_allow_html=True)

# =========================================================================
# 4.1 ENTER-TO-NEXT UX UPGRADE (กด Enter เพื่อเลื่อนช่องกรอกข้อมูลถัดไป)
# =========================================================================
enter_to_next_js = """
<script>
(function() {
    function initEnterToNext(targetDoc) {
        if (!targetDoc || targetDoc.__enterToNextBound) return;
        targetDoc.__enterToNextBound = true;
        targetDoc.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && e.target && e.target.tagName === 'INPUT') {
                var itype = (e.target.type || '').toLowerCase();
                if (itype === 'submit' || itype === 'button' || itype === 'reset' || itype === 'checkbox' || itype === 'radio') {
                    return;
                }
                e.preventDefault();
                var inputs = Array.from(targetDoc.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([disabled])'));
                var index = inputs.indexOf(e.target);
                if (index > -1 && index < inputs.length - 1) {
                    inputs[index + 1].focus();
                }
            }
        });
    }
    try { initEnterToNext(document); } catch (e) {}
    try { if (window.parent && window.parent.document) initEnterToNext(window.parent.document); } catch (e) {}
})();
</script>
"""
try:
    import streamlit.components.v1 as _st_components
    _st_components.html(enter_to_next_js, height=0, width=0)
except Exception:
    st.markdown(enter_to_next_js, unsafe_allow_html=True)

dashboard_luxury_css = """
<style>
.st-key-executive_dashboard { --dash-heading: 'Sora', 'Prompt', sans-serif; --dash-body: 'Manrope', 'Prompt', sans-serif; font-family: var(--dash-body); }
.kpi-card { background: var(--card-bg); border: 1px solid var(--border-card); border-radius: var(--radius-lg); padding: 22px; min-height: 150px; box-shadow: var(--shadow-soft); position: relative; overflow: hidden; transition: transform .2s ease, box-shadow .2s ease;}
.kpi-card:hover { transform: translateY(-3px); box-shadow: 0 5px 12px rgba(31,41,55,.04), 0 16px 32px rgba(232,88,38,.08); }
.kpi-card-header { font-size: 12px; font-weight: 600; color: var(--text-muted); margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center;}
.kpi-icon-pill { width: 36px; height: 36px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; font-size: 18px; background: var(--warning-bg); color: var(--brand-primary); }
.kpi-card-value { font-family: var(--dash-heading); font-size: 30px; font-weight: 700; color: var(--text-dark); line-height: 1.35; }
.dash-section-title { display: flex; align-items: center; gap: 9px; font: 600 15px var(--dash-body); line-height: 1.7; color: var(--text-dark); margin: 0 0 12px; }
.dash-section-title::before { content: ''; width: 3px; height: 20px; background: var(--brand-primary); border-radius: 8px; flex-shrink: 0; }
.dash-fleet-legend { display: grid; gap: 9px; padding-top: 7px; }
.dash-fleet-legend > div { display: flex; justify-content: space-between; gap: 8px; font: 400 11px var(--dash-body); color: var(--text-muted); }
.dash-fleet-legend b { color: var(--text-dark); font-family: var(--dash-heading); }
.donut-header { font-size: 13.5px; font-weight: 700; color: var(--text-dark); margin-bottom: 4px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; }
.donut-sub { font-size: 11px; color: var(--text-muted); margin-bottom: 6px; }
.donut-stat-row { display: flex; justify-content: space-between; align-items: center; padding: 4px 8px; border-radius: 6px; font-size: 11px; margin-top: 4px; background: #FAF7F2; box-sizing: border-box; }
.donut-stat-row span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-right: 6px; }
.donut-stat-row b { white-space: nowrap; flex-shrink: 0; }
.bo-table { width: 100%; border-collapse: collapse; font-family: var(--font-ui, sans-serif); font-size: 13px; background: white; border-radius: 8px; overflow: hidden; }
.bo-table th, .bo-table td { border-bottom: 1px solid #EFEAE3; padding: 12px 10px; text-align: left; vertical-align: middle; }
.bo-table th { background-color: #FAF7F2; color: #E85826; font-weight: 600; border-top: 1px solid #EFEAE3; white-space: nowrap; }
.bo-table td { color: #1F2937; }
.bo-table th:nth-child(2), .bo-table td:nth-child(2) { min-width: 100px; white-space: nowrap; }
.bo-table th:nth-child(3), .bo-table td:nth-child(3) { min-width: 110px; white-space: nowrap; }
.bo-table th:nth-child(4), .bo-table td:nth-child(4) { min-width: 140px; }
.bo-table th:nth-child(5), .bo-table td:nth-child(5) { min-width: 155px; white-space: nowrap; }
.icon-link { text-decoration: none; font-size: 18px; margin-right: 8px; display: inline-block; transition: transform 0.2s; cursor: pointer; }
.icon-link:hover { transform: scale(1.15); }

/* =========================================================================
   STICKY FLEET SELECTION SEARCH BAR (ล็อกแถบค้นหาและแมตช์รถให้อยู่ด้านบนเสมอเวลาเลื่อนดูรถ)
   ========================================================================= */
div[data-testid="stVerticalBlockBorderWrapper"]:has(.st-key-fleet_filter_bar),
div[data-testid="stVerticalBlock"]:has(> div > .st-key-fleet_filter_bar),
.st-key-fleet_filter_bar {
    position: -webkit-sticky !important;
    position: sticky !important;
    top: 50px !important;
    z-index: 99 !important;
    background: #FFFFFF !important;
    box-shadow: 0 10px 28px rgba(31, 41, 55, 0.12) !important;
    border: 1.5px solid #EFEAE3 !important;
    border-top: 3.5px solid #E85826 !important;
    border-radius: 14px !important;
    margin-bottom: 14px !important;
}
</style>
"""

fleet_cards_css = """
<style>
/* =========================================================================
   FLEET SHOWCASE CARDS (Pastel Luxury Minimal - ตามภาพตัวอย่าง)
   Palette: Soft Rose Gold (#E0B8B8), Muted Pastel Blue (#B4C6E7),
            Pastel Champagne/Beige (#F5ECE0 / #EAE2D8)
   ========================================================================= */

/* 1. Hero Banner */
.fleet-hero-banner {
    background: radial-gradient(circle at 50% 20%, #FFFFFF 0%, #FAF6F0 60%, #F5ECE0 100%);
    border: 1px solid #EAE2D8;
    border-radius: 20px;
    padding: 24px 20px 20px 20px;
    text-align: center;
    margin-bottom: 18px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.03);
}
.fleet-hero-pill {
    display: inline-block;
    padding: 4px 16px;
    background: #FFFFFF;
    border: 1px solid #E0B8B8;
    border-radius: 20px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 2.5px;
    color: #C98F88;
    text-transform: uppercase;
    margin-bottom: 8px;
    box-shadow: 0 2px 8px rgba(224, 184, 184, 0.2);
}
.fleet-hero-title {
    font-size: 22px;
    font-weight: 800;
    color: #1F2937;
    margin: 4px 0 10px 0;
    letter-spacing: 0.5px;
    line-height: 1.35;
}
.fleet-palette-row {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    margin-top: 6px;
}
.fleet-palette-tag {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 10px;
    background: #FFFFFF;
    border: 1px solid #EFEAE3;
    border-radius: 12px;
    font-size: 11px;
    font-weight: 600;
    color: #4B5563;
}
.fleet-palette-tag .color-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    display: inline-block;
}

/* 2. Instant Booking Bar */
.fleet-booking-bar {
    background: #FFFFFF;
    border: 1px solid #EFE8E1;
    border-radius: 20px;
    padding: 16px 18px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.03);
    margin-bottom: 16px;
}
.fleet-booking-title {
    font-size: 13px;
    font-weight: 700;
    color: #8C827A;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    margin-bottom: 12px;
}
.fleet-active-filters-box {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    background: #FDFBF9;
    border: 1px dashed #E0B8B8;
    border-radius: 12px;
    padding: 8px 12px;
    margin-top: 10px;
}
.fleet-filter-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: #FFF5F2;
    border: 1px solid #E0B8B8;
    color: #B87870;
    font-size: 11.5px;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 10px;
}

/* 3. Showcase Fleet Grid & Cards (Modern Grid Cards matching mockups) */
.fleet-card-header-row {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 8px;
    margin-bottom: 2px;
}
.fleet-card-code-col {
    display: flex;
    flex-direction: column;
}
.fleet-card-code-val {
    font-size: 18px;
    font-weight: 800;
    color: #111827;
    line-height: 1.15;
    letter-spacing: 0.5px;
}
.fleet-card-code-tag {
    font-size: 11px;
    font-weight: 800;
    color: #2563EB;
    letter-spacing: 1.2px;
    text-transform: uppercase;
    margin-top: 3px;
}
.fleet-thai-plate-badge {
    border: 1.5px solid #1F2937;
    border-radius: 6px;
    padding: 2px 8px;
    background: #FFFFFF;
    text-align: center;
    min-width: 82px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}
.fleet-thai-plate-badge.red-plate {
    border-color: #DC2626;
    background: #FEF2F2;
}
.fleet-thai-plate-num {
    font-size: 12.5px;
    font-weight: 800;
    color: #111827;
    line-height: 1.2;
}
.fleet-thai-plate-badge.red-plate .fleet-thai-plate-num {
    color: #DC2626;
}
.fleet-thai-plate-prov {
    font-size: 8px;
    color: #4B5563;
    line-height: 1;
    margin-top: 1px;
}
.fleet-thai-plate-badge.red-plate .fleet-thai-plate-prov {
    color: #DC2626;
}
.fleet-card-model-text {
    font-size: 15px;
    font-weight: 700;
    color: #1F2937;
    margin-top: 8px;
    line-height: 1.3;
}
.fleet-card-specs-text {
    font-size: 12px;
    color: #6B7280;
    margin-top: 2px;
    font-weight: 500;
}
.fleet-card-pills-wrap {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 10px;
    margin-bottom: 6px;
    flex-wrap: wrap;
}
.fleet-pill-badge {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 2.5px 8px;
    border-radius: 12px;
    font-size: 11px;
    font-weight: 700;
    line-height: 1.2;
}
.fleet-pill-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    display: inline-block;
}
/* สไตล์ Expander ของการ์ดรถยนต์ให้กลมกลืนกับโทนแบรนด์ */
div[data-testid="stExpander"] {
    border: 1px solid #EFEAE3 !important;
    border-radius: 10px !important;
    background: #FFFAF8 !important;
    margin-top: 6px !important;
}
div[data-testid="stExpander"] details summary {
    font-size: 12.5px !important;
    font-weight: 700 !important;
    color: #E85826 !important;
}

/* 4. Section 4: Premium Services & Benefits Ribbon */
.fleet-benefits-wrap {
    background: linear-gradient(135deg, #FBF8F5 0%, #F6EFE6 100%);
    border: 1px solid #EAE2D8;
    border-radius: 18px;
    padding: 22px 18px 20px 18px;
    margin-top: 30px;
    text-align: center;
}
.fleet-benefits-title {
    font-size: 13px;
    font-weight: 800;
    color: #8C827A;
    letter-spacing: 2px;
    text-transform: uppercase;
    margin-bottom: 16px;
}
.fleet-benefits-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
}
.fleet-benefit-item {
    background: #FFFFFF;
    border: 1px solid #EFE8E1;
    border-radius: 14px;
    padding: 14px 12px;
    text-align: center;
    box-shadow: 0 2px 8px rgba(0,0,0,0.02);
}
.fleet-benefit-icon {
    font-size: 24px;
    margin-bottom: 6px;
}
.fleet-benefit-name {
    font-size: 13px;
    font-weight: 700;
    color: #1F2937;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 2px;
}
.fleet-benefit-desc {
    font-size: 11px;
    color: #6B7280;
}

/* 5. FLOATING ACTION BUTTON (+) FOR ADD CUSTOMER (มุมขวาล่าง ล็อกตำแหน่งเสมอ) */
div[class*="st-key-fab_add_customer"],
.st-key-fab_add_customer {
    position: fixed !important;
    bottom: 80px !important;
    right: 28px !important;
    z-index: 999999 !important;
    width: 60px !important;
    height: 60px !important;
}
div[class*="st-key-fab_add_customer"] button,
.st-key-fab_add_customer button {
    width: 60px !important;
    height: 60px !important;
    min-width: 60px !important;
    min-height: 60px !important;
    max-width: 60px !important;
    max-height: 60px !important;
    border-radius: 50% !important;
    background: linear-gradient(135deg, #FF6B35 0%, #E85826 100%) !important;
    color: #FFFFFF !important;
    box-shadow: 0 8px 24px rgba(232, 88, 38, 0.5) !important;
    border: 2.5px solid #FFFFFF !important;
    transition: all 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275) !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    padding: 0 !important;
    cursor: pointer !important;
}
div[class*="st-key-fab_add_customer"] button:hover,
.st-key-fab_add_customer button:hover {
    transform: scale(1.12) !important;
    box-shadow: 0 12px 30px rgba(232, 88, 38, 0.7) !important;
    background: linear-gradient(135deg, #EA580C 0%, #C2410C 100%) !important;
}
div[class*="st-key-fab_add_customer"] button:active,
.st-key-fab_add_customer button:active {
    transform: scale(0.95) !important;
}
div[class*="st-key-fab_add_customer"] button,
div[class*="st-key-fab_add_customer"] button *,
.st-key-fab_add_customer button,
.st-key-fab_add_customer button * {
    font-size: 34px !important;
    font-weight: 700 !important;
    color: #FFFFFF !important;
    margin: 0 !important;
    padding: 0 !important;
    line-height: 1 !important;
}
@media (max-width: 768px) {
    div[class*="st-key-fab_add_customer"],
    .st-key-fab_add_customer {
        bottom: 70px !important;
        right: 18px !important;
        width: 52px !important;
        height: 52px !important;
    }
    div[class*="st-key-fab_add_customer"] button,
    .st-key-fab_add_customer button {
        width: 52px !important;
        height: 52px !important;
        min-width: 52px !important;
        min-height: 52px !important;
    }
    div[class*="st-key-fab_add_customer"] button,
    div[class*="st-key-fab_add_customer"] button *,
    .st-key-fab_add_customer button,
    .st-key-fab_add_customer button * {
        font-size: 28px !important;
    }
}
</style>
"""

folder_tabs_luxury_css = """
<style>
/* =========================================================================
   LUXURY OVERLAPPING FOLDER TABS ("แฟ้มทับกันแบบมี Texture หรูหรา")
   ========================================================================= */
.st-key-folder_tabs_bar {
    background: radial-gradient(circle at 50% 0%, #F5ECE0 0%, #E8DECf 70%, #DFD3C0 100%) !important;
    padding: 10px 14px 0 14px !important;
    border-radius: 16px 16px 0 0 !important;
    border: 1px solid #D2C4B0 !important;
    border-bottom: none !important;
    box-shadow: inset 0 3px 8px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.7) !important;
    margin-bottom: 0px !important;
}

.st-key-folder_tabs_bar [data-testid="stHorizontalBlock"] {
    gap: 0 !important;
    align-items: flex-end !important;
}

.st-key-folder_tabs_bar [data-testid="column"] {
    position: relative !important;
    min-width: 0 !important;
    margin-bottom: 0 !important;
    padding-bottom: 0 !important;
}

/* OVERLAPPING EFFECT: แต่ละแท็บซ้อนทับเหลื่อมกันแบบแฟ้มงานจริง */
.st-key-folder_tabs_bar [data-testid="column"]:not(:first-child) {
    margin-left: -14px !important;
}

/* Stacking order: เรียงลำดับความลึกของแฟ้ม */
.st-key-folder_tabs_bar [data-testid="column"]:nth-child(1) { z-index: 5; }
.st-key-folder_tabs_bar [data-testid="column"]:nth-child(2) { z-index: 6; }
.st-key-folder_tabs_bar [data-testid="column"]:nth-child(3) { z-index: 7; }
.st-key-folder_tabs_bar [data-testid="column"]:nth-child(4) { z-index: 8; }
.st-key-folder_tabs_bar [data-testid="column"]:nth-child(5) { z-index: 9; }

/* Active tab มี z-index สูงสุดเสมอ อยู่ด้านหน้าสุดและทับแท็บข้างๆ */
.st-key-folder_tabs_bar [data-testid="column"]:has(button[kind="primary"]),
.st-key-folder_tabs_bar [data-testid="column"]:has(button[data-testid="baseButton-primary"]) {
    z-index: 30 !important;
}

/* Hover over inactive tab brings it forward */
.st-key-folder_tabs_bar [data-testid="column"]:hover {
    z-index: 25 !important;
}

.st-key-folder_tabs_bar [data-testid="stElementContainer"],
.st-key-folder_tabs_bar div[data-testid="stButton"] {
    margin-bottom: 0 !important;
    padding-bottom: 0 !important;
}

.st-key-folder_tabs_bar div[data-testid="stButton"] > button,
.st-key-wtab_0 button,
.st-key-wtab_1 button,
.st-key-wtab_2 button,
.st-key-wtab_3 button,
.st-key-wtab_4 button {
    height: 50px !important;
    border-radius: 14px 14px 0 0 !important;
    font-size: 13.5px !important;
    font-weight: 600 !important;
    letter-spacing: -0.2px !important;
    transition: all 0.22s cubic-bezier(0.25, 0.8, 0.25, 1) !important;
    position: relative !important;
    margin-bottom: 0 !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    white-space: nowrap !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
    padding: 0 10px !important;
}

/* Inactive Folder Tab: ลายกระดาษคาร์ดสต็อกพรีเมียม (Textured Cardstock) */
.st-key-folder_tabs_bar div[data-testid="stButton"] > button:not([kind="primary"]):not([data-testid="baseButton-primary"]),
.st-key-wtab_0 button:not([kind="primary"]):not([data-testid="baseButton-primary"]),
.st-key-wtab_1 button:not([kind="primary"]):not([data-testid="baseButton-primary"]),
.st-key-wtab_2 button:not([kind="primary"]):not([data-testid="baseButton-primary"]),
.st-key-wtab_3 button:not([kind="primary"]):not([data-testid="baseButton-primary"]),
.st-key-wtab_4 button:not([kind="primary"]):not([data-testid="baseButton-primary"]) {
    background: linear-gradient(180deg, #FFFFFF 0%, #F7F2EB 30%, #ECE2D4 80%, #DFD3C2 100%) !important;
    border: 1px solid #CFC2B0 !important;
    border-top: 2.5px solid #FFFFFF !important;
    border-bottom: 2px solid #C4B49F !important;
    color: #4D4439 !important;
    transform: translateY(2px) !important;
    box-shadow: -5px -2px 12px rgba(0,0,0,0.08), 5px -2px 12px rgba(0,0,0,0.05), inset 0 1px 2px rgba(255,255,255,0.9), inset 0 -2px 4px rgba(0,0,0,0.03) !important;
}

/* Hover: แท็บเลื่อนยกตัวขึ้นมาด้านหน้า พร้อมเงาและแสงสะท้อน */
.st-key-folder_tabs_bar div[data-testid="stButton"] > button:not([kind="primary"]):not([data-testid="baseButton-primary"]):hover,
.st-key-wtab_0 button:not([kind="primary"]):not([data-testid="baseButton-primary"]):hover,
.st-key-wtab_1 button:not([kind="primary"]):not([data-testid="baseButton-primary"]):hover,
.st-key-wtab_2 button:not([kind="primary"]):not([data-testid="baseButton-primary"]):hover,
.st-key-wtab_3 button:not([kind="primary"]):not([data-testid="baseButton-primary"]):hover,
.st-key-wtab_4 button:not([kind="primary"]):not([data-testid="baseButton-primary"]):hover {
    background: linear-gradient(180deg, #FFFFFF 0%, #FFF9F2 30%, #FBEFE2 100%) !important;
    border-color: #E85826 !important;
    border-top: 3px solid #FFAB80 !important;
    color: #E85826 !important;
    transform: translateY(-3px) !important;
    box-shadow: -6px -4px 16px rgba(232, 88, 38, 0.2), 6px -4px 16px rgba(232, 88, 38, 0.15), inset 0 1px 3px rgba(255,255,255,1) !important;
}

/* Active Folder Tab: สีส้มพรีเมียมหรูหราพร้อม Texture ลายเกรนเมทัลลิก/หนังคลาสสิก */
.st-key-folder_tabs_bar div[data-testid="stButton"] > button[kind="primary"],
.st-key-folder_tabs_bar div[data-testid="stButton"] > button[data-testid="baseButton-primary"],
.st-key-wtab_0 button[kind="primary"],
.st-key-wtab_0 button[data-testid="baseButton-primary"],
.st-key-wtab_1 button[kind="primary"],
.st-key-wtab_1 button[data-testid="baseButton-primary"],
.st-key-wtab_2 button[kind="primary"],
.st-key-wtab_2 button[data-testid="baseButton-primary"],
.st-key-wtab_3 button[kind="primary"],
.st-key-wtab_3 button[data-testid="baseButton-primary"],
.st-key-wtab_4 button[kind="primary"],
.st-key-wtab_4 button[data-testid="baseButton-primary"] {
    background: linear-gradient(180deg, #FF7033 0%, #E85826 35%, #D04515 80%, #B8370B 100%) !important;
    border: 1px solid #B8370B !important;
    border-top: 4px solid #FFD4BF !important;
    border-bottom: none !important;
    color: #FFFFFF !important;
    font-weight: 700 !important;
    text-shadow: 0 1px 3px rgba(0,0,0,0.35) !important;
    transform: translateY(0px) !important;
    box-shadow: 0 -8px 24px rgba(232, 88, 38, 0.5), -8px 0 16px rgba(0,0,0,0.18), 8px 0 16px rgba(0,0,0,0.18), inset 0 2px 4px rgba(255,255,255,0.6), inset 0 -2px 4px rgba(0,0,0,0.15) !important;
}

/* Connecting Folder Shelf Line (สันเชื่อมต่อด้านล่างแฟ้มแบบคลาสสิกรมควัน/ทองแดง) */
.folder-shelf-line {
    height: 6px !important;
    background: linear-gradient(90deg, #B8370B 0%, #E85826 15%, #FFA870 50%, #E85826 85%, #B8370B 100%) !important;
    border-radius: 3px !important;
    box-shadow: 0 4px 12px rgba(232, 88, 38, 0.45), 0 1px 3px rgba(0,0,0,0.12) !important;
    margin-top: -1px !important;
    margin-bottom: 18px !important;
}
</style>
"""


# =========================================================================
# 5. AUTHENTICATION (LOGIN)
# =========================================================================
_render_pending_session_cookie()

if st.session_state.user is None:
    st.markdown("<div style='height: 30px;'></div>", unsafe_allow_html=True)
    col_a, col_b, col_c = st.columns([1, 1.25, 1])
    with col_b:
        with st.container(border=True):
            if logo_file:
                st.markdown(f"""
                    <div style="display: flex; justify-content: center; margin-bottom: 20px;">
                        <div style="background: #111111; width: 90px; height: 90px; border-radius: 50%; display: flex; align-items: center; justify-content: center; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.15);">
                            <img src="data:image/png;base64,{get_base64_image(logo_file)}" style="width: 70px; height: auto;" />
                        </div>
                    </div>
                """, unsafe_allow_html=True)
            else:
                st.markdown("""
                    <div style="display: flex; justify-content: center; margin-bottom: 20px;">
                        <div style="background: #111111; width: 90px; height: 90px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 40px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);">
                            🚙
                        </div>
                    </div>
                """, unsafe_allow_html=True)
            
            if st.session_state.auth_mode == "login":
                with st.container(border=True): 
                    with st.form("login_form", border=False):
                        st.markdown("<b style='color:#374151; font-size:14px;'>ชื่อผู้ใช้งาน หรือ อีเมล (Username / Email)</b>", unsafe_allow_html=True)
                        login_username = st.text_input("ชื่อผู้ใช้งาน หรือ อีเมล", placeholder="เช่น admin หรือ user@email.com", label_visibility="collapsed")
                        st.markdown("<div style='height: 5px;'></div>", unsafe_allow_html=True)
                        st.markdown("<b style='color:#374151; font-size:14px;'>รหัสผ่าน (Password)</b>", unsafe_allow_html=True)
                        login_password = st.text_input("รหัสผ่าน", type="password", placeholder="กรอกรหัสผ่าน (อย่างน้อย 6 ตัวอักษร)", label_visibility="collapsed")
                        
                        st.markdown("<div style='height: 10px;'></div>", unsafe_allow_html=True)
                        login_sub = st.form_submit_button("⚡ เข้าสู่ระบบ (Supabase Auth)", use_container_width=True)
                        
                    if login_sub:
                        user_rec, err_msg = sb_auth_login(login_username, login_password)
                        if not user_rec:
                            st.error(err_msg or "❌ ไม่พบชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง")
                        else:
                            is_pending_login = (user_rec.get("status") == "pending")
                            now_ts = time.time()
                            st.session_state.user = {
                                "username": user_rec["username"],
                                "name": user_rec.get("name", user_rec["username"]),
                                "role": user_rec.get("role", "Staff"),
                                "email": user_rec.get("email") or f"{user_rec['username']}@sawasdeecarrental.com",
                                "login_timestamp": now_ts,
                            }
                            st.session_state['login_timestamp'] = now_ts
                            st.session_state['logged_in'] = True
                            st.session_state['username'] = user_rec["username"]
                            st.session_state["_logged_out_this_session"] = False
                            _queue_session_cookie(_make_session_token(st.session_state.user))
                            if is_pending_login:
                                # บัญชีรออนุมัติ: เข้าดูได้เฉพาะหน้าแดชบอร์ด
                                st.session_state.selected_module = "Dashboard และรายงานผู้บริหาร"
                                st.warning(f"⏳ บัญชี '{user_rec['username']}' อยู่ระหว่างรอผู้ดูแลระบบ (Admin) อนุมัติ — เข้าดูได้เฉพาะหน้าแดชบอร์ด")
                            else:
                                st.session_state.selected_module = "Front Office"
                                st.session_state.workflow_tab = "1. เลือกรถยนต์"
                                st.success(f"เข้าสู่ระบบสำเร็จในฐานะ: {st.session_state.user['name']} ☁️")
                            time.sleep(0.5)
                            st.rerun()

                st.markdown("<div style='height: 12px;'></div>", unsafe_allow_html=True)
                link_c1, link_c2 = st.columns(2)
                with link_c1:
                    if st.button("📝 สมัครสมาชิก", use_container_width=True):
                        st.session_state.auth_mode = "register"
                        st.rerun()
                with link_c2:
                    if st.button("🔑 แก้ไขรหัสผ่าน", use_container_width=True):
                        st.session_state.auth_mode = "forgot"
                        st.rerun()

            elif st.session_state.auth_mode == "register":
                with st.container(border=True):
                    st.markdown("<h4 style='text-align:center; color:#E85826; margin-bottom:15px;'>📝 สมัครสมาชิกพนักงานใหม่ (Supabase Cloud)</h4>", unsafe_allow_html=True)
                    st.caption("เมื่อสมัครสมาชิกแล้ว ข้อมูลจะถูกบันทึกลง Supabase Auth และส่งให้ Admin อนุมัติก่อนใช้งาน")
                    with st.form("register_form", border=False):
                        reg_user = st.text_input("ชื่อผู้ใช้งาน / ชื่อพนักงาน (Username)", placeholder="เช่น somchai")
                        reg_fullname = st.text_input("ชื่อ-นามสกุลจริง (Full Name)", placeholder="เช่น สมชาย ใจดี")
                        reg_pass = st.text_input("รหัสผ่าน (อย่างน้อย 6 ตัวอักษร)", type="password")
                        reg_pass2 = st.text_input("ยืนยันรหัสผ่าน", type="password")
                        
                        reg_sub = st.form_submit_button("📝 ยืนยันการลงทะเบียน", use_container_width=True)
                        if reg_sub:
                            reg_user_clean = reg_user.strip()
                            if not reg_user_clean:
                                st.error("กรุณากรอกชื่อผู้ใช้งาน")
                            elif reg_pass != reg_pass2:
                                st.error("รหัสผ่านไม่ตรงกัน")
                            elif len(reg_pass) < 6:
                                st.error("รหัสผ่านต้องมีความยาวอย่างน้อย 6 ตัวอักษร")
                            else:
                                ok, msg = sb_auth_register(reg_user_clean, reg_fullname, reg_pass)
                                if ok:
                                    st.success(msg)
                                    st.session_state.auth_mode = "login"
                                    time.sleep(1.5)
                                    st.rerun()
                                else:
                                    st.error(msg)
                st.markdown("<div style='height: 10px;'></div>", unsafe_allow_html=True)
                if st.button("← กลับไปหน้าเข้าสู่ระบบ", use_container_width=True):
                    st.session_state.auth_mode = "login"
                    st.rerun()

            elif st.session_state.auth_mode == "forgot":
                with st.container(border=True):
                    st.markdown("<h4 style='text-align:center; color:#E85826; margin-bottom:15px;'>เปลี่ยนรหัสผ่านใหม่ (Supabase Auth)</h4>", unsafe_allow_html=True)
                    with st.form("forgot_form", border=False):
                        f_user = st.text_input("ชื่อผู้ใช้งานเดิม (Username)")
                        f_pass = st.text_input("รหัสผ่านใหม่ (อย่างน้อย 6 ตัวอักษร)", type="password")
                        if st.form_submit_button("🔑 ยืนยันเปลี่ยนรหัสผ่าน", use_container_width=True):
                            ok, msg = sb_auth_change_password(f_user, f_pass)
                            if ok:
                                st.success(msg)
                                st.session_state.auth_mode = "login"
                                time.sleep(1)
                                st.rerun()
                            else:
                                st.error(msg)
                st.markdown("<div style='height: 10px;'></div>", unsafe_allow_html=True)
                if st.button("← กลับไปหน้าเข้าสู่ระบบ", use_container_width=True):
                    st.session_state.auth_mode = "login"
                    st.rerun()

            st.markdown("<div style='margin-top:16px;'></div>", unsafe_allow_html=True)
            render_live_cloud_sync_panel()
else:
    # --- SYNC: งานที่สถานะ "เสร็จสิ้น" แต่ยังไม่ถูกแบคอัพ ให้แบคอัพลงฐานข้อมูลอัตโนมัติ ---
    _archived_ids_sync = {cj.get("booking_id") for cj in st.session_state.completed_jobs_db}
    for _b_sync in list(st.session_state.bookings_db):
        if _b_sync.get("status") == "เสร็จสิ้น" and _b_sync.get("booking_id") not in _archived_ids_sync:
            archive_completed_booking(_b_sync["booking_id"], late_fee=_b_sync.get("late_fee", 0.0))

    # =========================================================================
    # 6. SIDEBAR MENU
    # =========================================================================
    with st.sidebar:
        if logo_file:
            st.markdown(f"""
                <div style="padding: 10px 0; text-align: center;">
                    <img src="data:image/png;base64,{get_base64_image(logo_file)}" style="max-height: 80px; width: auto; margin-bottom: 10px;" />
                    <h3 style="color: #E85826; font-weight: 800; margin: 0; font-size: 18px;">SAWASDEE</h3>
                    <span style="font-size: 10px; letter-spacing: 1.5px; color: #888888; font-weight: 600;">FLEET MANAGEMENT</span>
                </div>
            """, unsafe_allow_html=True)
        else:
            st.markdown("""
                <div style="padding: 10px 0; text-align: center;">
                    <h3 style="color: #E85826; font-weight: 800; margin: 0; font-size: 20px;">🚙 SAWASDEE</h3>
                    <span style="font-size: 10.5px; letter-spacing: 1.5px; color: #888888; font-weight: 600;">FLEET MANAGEMENT</span>
                </div>
            """, unsafe_allow_html=True)
        
        # --- LOGGED IN USER PROFILE BADGE ---
        curr_u = st.session_state.user or {}
        u_role = curr_u.get("role", "Staff")
        u_uname = curr_u.get("username", "admin")
        is_admin_user = (u_role == "Admin" or u_uname.lower() == "admin")
        is_pending_user = False
        role_label = translations[st.session_state.language].get("role_admin_badge", "👑 ผู้ดูแลระบบ (Admin)") if is_admin_user else translations[st.session_state.language].get("role_staff_badge", "👷 พนักงานปฏิบัติงาน")
        logged_in_label = translations[st.session_state.language].get("logged_in_as", "เข้าสู่ระบบโดย:")
        
        st.markdown(f"""
            <div style="background:#FFFFFF; border:1px solid #EFEAE3; border-left:4px solid #E85826; border-radius:8px; padding:8px 12px; margin-bottom:12px; box-shadow:0 1px 3px rgba(0,0,0,0.03);">
                <div style="font-size:11px; color:#8C827A;">{logged_in_label}</div>
                <div style="font-size:13px; font-weight:700; color:#1F2937;">👤 {u_uname}</div>
                <div style="font-size:11px; color:#E85826; font-weight:600;">{role_label}</div>
            </div>
        """, unsafe_allow_html=True)

        # --- LANGUAGE SWITCHER (TH / EN) ---
        if "language" not in st.session_state:
            st.session_state.language = "TH"
        
        # ดึง Label ปุ่มตามภาษาปัจจุบัน
        lang_btn_label = translations[st.session_state.language].get("btn_lang", "🌐 Change Language")
        
        if st.button(lang_btn_label, use_container_width=True):
            # สลับค่า State
            st.session_state.language = "EN" if st.session_state.language == "TH" else "TH"
            # บังคับรีโหลด UI ทันที
            st.rerun()
        
        # --- ADMIN USER APPROVAL EXPANDER (แอดมินอนุมัติพนักงาน) ---
        if is_admin_user:
            pending_users = [u for u in st.session_state.users_db.values() if u.get("status") == "pending"]
            lbl_staff = translations[st.session_state.language].get("btn_manage_staff", "👥 จัดการ & อนุมัติพนักงาน")
            appr_title = f"{lbl_staff} {f'(⚠️ รออนุมัติ {len(pending_users)})' if pending_users else ''}"
            with st.expander(appr_title, expanded=bool(pending_users)):
                st.caption("อนุมัติพนักงานเพื่อให้เข้าใช้งาน Front/Back Office และปรากฏในดรอปดาวน์เลือกพนักงานส่ง/รับรถ")
                for u_k, u_v in list(st.session_state.users_db.items()):
                    if u_k.lower() == "admin":
                        continue
                    u_status = u_v.get("status", "approved")
                    del_confirm_key = f"confirm_del_u_{u_k}"
                    
                    st.markdown(f"""
                        <div style="background:#FFFFFF; border:1px solid #EFEAE3; border-radius:8px; padding:7px 10px; margin-top:6px; margin-bottom:5px;">
                            <div style="display:flex; justify-content:space-between; align-items:center;">
                                <span style="font-size:12px; font-weight:700; color:#1F2937;">👤 {u_k}</span>
                                <span style="font-size:10px; font-weight:600; color:{'#15803D' if u_status == 'approved' else '#B45309'}; background:{'#F0FDF4' if u_status == 'approved' else '#FEF3C7'}; padding:1px 7px; border-radius:10px;">
                                    {'🟢 อนุมัติแล้ว' if u_status == 'approved' else '🟡 รออนุมัติ'}
                                </span>
                            </div>
                        </div>
                    """, unsafe_allow_html=True)
                    
                    if not st.session_state.get(del_confirm_key, False):
                        c_act1, c_act2 = st.columns([1.5, 1])
                        with c_act1:
                            if u_status == "pending":
                                if st.button("✅ อนุมัติ", key=f"sb_appr_{u_k}", type="primary", use_container_width=True):
                                    st.session_state.users_db[u_k]["status"] = "approved"
                                    sb_sync_user(u_k, st.session_state.users_db[u_k])
                                    _GLOBAL_STORE["users_db"] = st.session_state.users_db
                                    st.session_state._last_cloud_sync_time = time.time()
                                    st.toast(f"อนุมัติ {u_k} สำเร็จ!", icon="✅")
                                    st.rerun()
                            else:
                                if st.button("🔒 ระงับ", key=f"sb_suspend_{u_k}", use_container_width=True):
                                    st.session_state.users_db[u_k]["status"] = "pending"
                                    sb_sync_user(u_k, st.session_state.users_db[u_k])
                                    _GLOBAL_STORE["users_db"] = st.session_state.users_db
                                    st.session_state._last_cloud_sync_time = time.time()
                                    st.toast(f"ระงับสิทธิ์ {u_k} เรียบร้อย", icon="🔒")
                                    st.rerun()
                        with c_act2:
                            if st.button("🗑️ ลบข้อมูล (Delete)", key=f"sb_del_init_{u_k}", use_container_width=True):
                                st.session_state[del_confirm_key] = True
                                st.rerun()
                    else:
                        st.markdown(f"<div style='font-size:11px; color:#DC2626; font-weight:600; padding:2px 0;'>⚠️ ยืนยันลบบัญชี {u_k}?</div>", unsafe_allow_html=True)
                        c_y, c_n = st.columns(2)
                        with c_y:
                            if st.button("ยืนยัน", key=f"sb_del_yes_{u_k}", type="primary", use_container_width=True):
                                sb_delete_user(u_k)
                                del_unames = _GLOBAL_STORE.setdefault("deleted_usernames", set())
                                del_unames.add(u_k.lower())
                                st.session_state.users_db.pop(u_k, None)
                                if _GLOBAL_STORE.get("users_db"):
                                    _GLOBAL_STORE["users_db"].pop(u_k, None)
                                st.session_state[del_confirm_key] = False
                                st.session_state._last_cloud_sync_time = time.time()
                                st.toast(f"🗑️ ลบบัญชี '{u_k}' เรียบร้อยแล้ว", icon="✅")
                                st.rerun()
                        with c_n:
                            if st.button("ยกเลิก", key=f"sb_del_no_{u_k}", use_container_width=True):
                                st.session_state[del_confirm_key] = False
                                st.rerun()
                st.markdown("<hr style='margin:10px 0 8px; border:0.5px solid #EFEAE3;'>", unsafe_allow_html=True)
                with st.expander("➕ เพิ่มพนักงานใหม่ (อนุมัติทันที)", expanded=False):
                    with st.form("form_add_new_staff_quick", border=False):
                        new_st_user = st.text_input("ชื่อผู้ใช้งาน (Username)", placeholder="เช่น somchai", key="new_st_u")
                        new_st_name = st.text_input("ชื่อ-นามสกุล", placeholder="เช่น สมชาย ใจดี", key="new_st_n")
                        new_st_pwd = st.text_input("รหัสผ่านเริ่มต้น", value="123456", type="password", key="new_st_p")
                        if st.form_submit_button("➕ บันทึกและอนุมัติพนักงาน", type="primary", use_container_width=True):
                            u_cl = new_st_user.strip()
                            if not u_cl:
                                st.error("กรุณาระบุชื่อผู้ใช้งาน")
                            elif len(new_st_pwd) < 6:
                                st.error("รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร")
                            else:
                                new_staff_prof = {
                                    "username": u_cl,
                                    "name": new_st_name.strip() or u_cl,
                                    "role": "Staff",
                                    "status": "approved",
                                    "password": new_st_pwd
                                }
                                st.session_state.users_db[u_cl] = new_staff_prof
                                _GLOBAL_STORE["users_db"] = st.session_state.users_db
                                sb_sync_user(u_cl, new_staff_prof)
                                st.session_state._last_cloud_sync_time = time.time()
                                st.success(f"เพิ่มและอนุมัติพนักงาน {u_cl} สำเร็จ!")
                                time.sleep(0.6)
                                st.rerun()
                st.markdown("<div style='height:4px;'></div>", unsafe_allow_html=True)

        # --- SMART SEARCH & ROUTING ENGINE (ระบบค้นหาอัจฉริยะและนำทางตามกระบวนการทำงาน) ---
        def find_brand_match(kw_str, cars_dict):
            if not kw_str or not str(kw_str).strip():
                return None
            kw_c = str(kw_str).strip().lower()
            kw_ns = kw_c.replace("-", "").replace(" ", "").replace("_", "")
            if not kw_ns:
                return None

            existing_brands = sorted(list(set(c.get("brand", "").strip() for c in (cars_dict or {}).values() if c.get("brand"))))
            for b in existing_brands:
                b_c = b.lower()
                b_ns = b_c.replace("-", "").replace(" ", "").replace("_", "")
                if kw_c == b_c or kw_ns == b_ns:
                    return b

            brand_aliases = {
                "toyota": "Toyota", "โตโยต้า": "Toyota", "โตโยตา": "Toyota",
                "bmw": "BMW", "บีเอ็ม": "BMW", "บีเอ็มดับเบิลยู": "BMW", "บีเอม": "BMW",
                "mercedes": "Mercedes-Benz", "mercedes-benz": "Mercedes-Benz", "benz": "Mercedes-Benz",
                "เบนซ์": "Mercedes-Benz", "เมอร์เซเดส": "Mercedes-Benz", "เมอร์เซเดส-เบนซ์": "Mercedes-Benz",
                "honda": "Honda", "ฮอนด้า": "Honda", "ฮอนดา": "Honda",
                "porsche": "Porsche", "ปอร์เช่": "Porsche", "ปอร์เช": "Porsche", "พอช": "Porsche",
                "ferrari": "Ferrari", "เฟอร์รารี่": "Ferrari", "เฟอรารี่": "Ferrari",
                "ford": "Ford", "ฟอร์ด": "Ford",
                "mazda": "Mazda", "มาสด้า": "Mazda", "มาสดา": "Mazda",
                "nissan": "Nissan", "นิสสัน": "Nissan",
                "hyundai": "Hyundai", "ฮุนได": "Hyundai",
                "mg": "MG", "เอ็มจี": "MG",
                "byd": "BYD", "บีวายดี": "BYD",
                "tesla": "Tesla", "เทสล่า": "Tesla", "เทสลา": "Tesla",
            }
            for alias_k, canonical_b in brand_aliases.items():
                alias_ns = alias_k.replace("-", "").replace(" ", "").replace("_", "")
                if kw_c == alias_k or kw_ns == alias_ns:
                    for eb in existing_brands:
                        if eb.lower() == canonical_b.lower():
                            return eb
                    return canonical_b

            if len(kw_ns) >= 3:
                for b in existing_brands:
                    b_ns = b.lower().replace("-", "").replace(" ", "").replace("_", "")
                    if kw_ns in b_ns or b_ns in kw_ns:
                        return b

            return None

        def route_booking_by_lifecycle(b_item):
            if not b_item:
                return
            b_id = b_item.get("booking_id", "")
            b_st = b_item.get("status", "")

            # 1. เช็คสถานะการชำระเงินมัดจำ
            is_dep_paid = bool(b_item.get("deposit_paid", False)) and (b_st != "รอชำระมัดจำ")

            # 2. เช็คสถานะการออกใบงานส่งมอบรถ (จัดส่ง)
            w_d = str(b_item.get("worker_delivery", "")).strip()
            has_delivery_worker = bool(w_d and w_d not in ["Wait", "-", ""]) or bool(b_item.get("dispatch_closed")) or (b_st in ["กำลังเช่า", "เตรียมรับคืน", "เสร็จสิ้น"])

            # 3. เช็คสถานะการชำระเงินค่าเช่า
            is_rent_paid = bool(b_item.get("rental_paid", False)) or bool(b_item.get("is_fully_paid", False))

            # 4. เช็คสถานะการจัดทำสัญญาเช่า
            is_contract_done = bool(b_item.get("contract_issued", False)) or bool(b_item.get("contract_done", False)) or is_rent_paid or (b_st in ["กำลังเช่า", "เตรียมรับคืน", "เสร็จสิ้น"])

            st.session_state.selected_module = "Front Office"
            st.session_state.global_search_kw = b_id
            st.session_state.search_plate_filter = b_id

            st.session_state.active_deposit_bk_id = None
            st.session_state.active_assign_bk_id = None
            st.session_state.active_contract_bk_id = None
            st.session_state.active_settle_bk_id = None
            st.session_state.active_return_bk_id = None

            if not is_dep_paid:
                # สเต็ป 1: ยังไม่ชำระมัดจำ -> ไปหน้าชำระเงินจอง (แท็บ 2)
                st.session_state.workflow_tab = "2. ชำระเงินจอง & การเงิน"
                st.session_state.active_deposit_bk_id = b_id
                st.session_state["sb_unified_pay_mode"] = "💰 จองรถ & ชำระเงินจอง (Booking & Deposit)"
                st.session_state.payment_focus = True
            elif not has_delivery_worker:
                # สเต็ป 2: ชำระมัดจำแล้ว แต่ยังไม่ออกใบงานส่งรถ -> ไปหน้าออกใบงานส่งรถ (แท็บ 3)
                st.session_state.workflow_tab = "3. ใบงานส่ง/รับรถ"
                st.session_state.active_assign_bk_id = b_id
            elif not is_contract_done:
                # สเต็ป 3: ออกใบงานส่งรถแล้ว แต่ยังไม่ทำสัญญาเช่า -> ไปหน้าจัดทำสัญญาเช่า (แท็บ 4)
                st.session_state.workflow_tab = "4. จัดทำสัญญาเช่า"
                st.session_state.active_contract_bk_id = b_id
            elif not is_rent_paid:
                # สเต็ป 4: ทำสัญญาเช่าแล้ว แต่ยังไม่ชำระค่าเช่า -> ไปหน้าชำระค่าเช่า (แท็บ 2)
                st.session_state.workflow_tab = "2. ชำระเงินจอง & การเงิน"
                st.session_state.active_settle_bk_id = b_id
                st.session_state["sb_unified_pay_mode"] = "🧾 ชำระค่าเช่า (Rental Settlement)"
                st.session_state.payment_focus = True
            else:
                # สเต็ป 5: ชำระค่าเช่าครบถ้วนแล้ว -> ไปหน้าออกใบงานรับรถคืน (แท็บ 3 ฝั่งรับรถคืน)
                st.session_state.workflow_tab = "3. ใบงานส่ง/รับรถ"
                st.session_state.active_return_bk_id = b_id

        # --- UNIFIED SEARCH IN SIDEBAR (ค้นหาข้อมูลส่วนกลาง รวมทุกระบบ) ---
        st.markdown("<div style='height: 4px;'></div>", unsafe_allow_html=True)
        if "global_search_kw" not in st.session_state:
            st.session_state.global_search_kw = ""
        if "search_box_version" not in st.session_state:
            st.session_state.search_box_version = 0
            
        sb_search_input = st.text_input(
            "ค้นหา",
            value=st.session_state.get("global_search_kw", ""),
            placeholder="🔍 ค้นหา (เลขที่จอง / ทะเบียน / ลูกค้า)",
            label_visibility="collapsed",
            key=f"sb_search_input_box_{st.session_state.search_box_version}"
        )
        st.session_state.global_search_kw = sb_search_input
        st.session_state.search_plate_filter = sb_search_input

        if sb_search_input.strip():
            kw_clean = sb_search_input.strip().lower()
            kw_no_symbol = kw_clean.replace("-", "").replace(" ", "")
            matched_bk = [
                b for b in st.session_state.bookings_db
                if kw_clean in f"{b.get('booking_id','')} {b.get('car_id','')} {b.get('customer','')}".lower()
                or kw_no_symbol in str(b.get('booking_id','')).lower().replace("-", "").replace(" ", "")
                or kw_no_symbol in str(b.get('car_id','')).lower().replace("-", "").replace(" ", "")
            ]
            matched_c = [
                p for p, c in cars_db.items()
                if kw_clean in f"{p} {c.get('brand','')} {c.get('model','')} {c.get('car_group','')} {c.get('company','')} {c.get('color','')}".lower()
                or kw_no_symbol in p.lower().replace("-", "").replace(" ", "")
                or kw_no_symbol in f"{c.get('brand','')} {c.get('model','')}".lower().replace("-", "").replace(" ", "")
            ]
            matched_cu = [
                k for k, v in st.session_state.customers_db.items()
                if kw_clean in f"{k} {v.get('contact_no','')} {v.get('email','')} {v.get('licence_no','')} {v.get('passport_id','')}".lower()
                or kw_no_symbol in f"{v.get('contact_no','')} {v.get('passport_id','')}".lower().replace("-", "").replace(" ", "")
            ]
            matched_hist = [
                cj for cj in st.session_state.completed_jobs_db
                if kw_clean in f"{cj.get('booking_id','')} {cj.get('car_id','')} {cj.get('customer','')} {cj.get('worker_delivery','')} {cj.get('worker_return','')}".lower()
                or kw_no_symbol in str(cj.get('booking_id','')).lower().replace("-", "").replace(" ", "")
                or kw_no_symbol in str(cj.get('car_id','')).lower().replace("-", "").replace(" ", "")
            ]

            # ระบบอัจฉริยะ: ตรวจจับยี่ห้อรถ ทะเบียนรถ เลขที่จอง และลูกค้าเพื่อนำทางตรงตามขั้นตอน
            if "prev_sb_search_kw" not in st.session_state:
                st.session_state.prev_sb_search_kw = ""
            if sb_search_input.strip() != st.session_state.prev_sb_search_kw:
                st.session_state.prev_sb_search_kw = sb_search_input.strip()

                brand_hit = find_brand_match(sb_search_input, cars_db)

                # 1. ค้นหายี่ห้อรถ -> ไปหน้าเลือกรถ แสดงเฉพาะยี่ห้อนั้น และเลือกในดรอปดาวน์
                if brand_hit:
                    st.session_state.selected_module = "Front Office"
                    st.session_state.workflow_tab = "1. เลือกรถยนต์"
                    st.session_state.fleet_f_brand = brand_hit
                    st.session_state.fleet_f_group = "ทั้งหมด"
                    st.session_state.fleet_f_status = "ทั้งหมด"
                    st.session_state.fleet_f_company = "ทั้งหมด"
                    st.session_state.search_plate_filter = ""
                else:
                    # ตรวจสอบว่าเป็นทะเบียนรถหรือไม่
                    plate_hit = None
                    for p in cars_db:
                        p_ns = p.lower().replace("-", "").replace(" ", "")
                        if kw_no_symbol == p_ns or (len(kw_no_symbol) >= 3 and (kw_no_symbol in p_ns or p_ns in kw_no_symbol)):
                            plate_hit = p
                            break

                    # 2. ค้นหาเลขทะเบียนรถ -> ไปหน้าเลือกรถ แสดงรถคันนั้นๆ
                    if plate_hit and not kw_clean.startswith("bk"):
                        st.session_state.selected_module = "Front Office"
                        st.session_state.workflow_tab = "1. เลือกรถยนต์"
                        st.session_state.fleet_f_brand = "ทั้งหมด"
                        st.session_state.fleet_f_group = "ทั้งหมด"
                        st.session_state.fleet_f_status = "ทั้งหมด"
                        st.session_state.fleet_f_company = "ทั้งหมด"
                        st.session_state.search_plate_filter = plate_hit
                        st.session_state.global_search_kw = plate_hit
                    elif matched_bk:
                        # 3. ค้นหาด้วยเลขที่การจอง หรือชื่อลูกค้าที่มีรายการจอง -> นำทางตามวงจรชีวิตงานจอง
                        active_matched = [b for b in matched_bk if b.get("status") not in ["เสร็จสิ้น", "ยกเลิก"]]
                        target_b = active_matched[0] if active_matched else matched_bk[0]
                        route_booking_by_lifecycle(target_b)
                    elif matched_cu:
                        # ค้นหาลูกค้าที่ไม่มีงานจองค้างอยู่ -> เปิดหน้าโปรไฟล์ลูกค้าในแท็บ 2
                        target_cu_name = matched_cu[0]
                        cu_bks = [b for b in st.session_state.bookings_db if str(b.get("customer","")).strip().lower() == target_cu_name.strip().lower() and b.get("status") not in ["เสร็จสิ้น", "ยกเลิก"]]
                        if cu_bks:
                            route_booking_by_lifecycle(cu_bks[0])
                        else:
                            st.session_state.selected_module = "Front Office"
                            st.session_state.workflow_tab = "2. ชำระเงินจอง & การเงิน"
                            st.session_state.selected_customer_name = target_cu_name
                            st.session_state.show_edit_customer = True
                            st.session_state.show_add_customer = False
                    elif matched_hist:
                        st.session_state.selected_module = "Back Office"
        
            sc1, sc2 = st.columns([2, 1])
            if is_pending_user:
                sc1.caption(f"พบในประวัติ: {len(matched_hist)} งาน")
            else:
                sc1.caption(f"พบ: จอง {len(matched_bk)} | รถ {len(matched_c)} | ลูกค้า {len(matched_cu)} | ประวัติ {len(matched_hist)}")
                
            if sc2.button("❌ ล้าง", key="btn_clear_sb_search", use_container_width=True):
                st.session_state.global_search_kw = ""
                st.session_state.search_plate_filter = ""
                st.session_state.prev_sb_search_kw = ""
                st.session_state.fleet_f_brand = "ทั้งหมด"
                st.session_state.search_box_version = st.session_state.get("search_box_version", 0) + 1
                st.rerun()
            
            has_quick_results = bool(matched_bk or matched_c or matched_cu or matched_hist)
            if not is_pending_user and has_quick_results:
                with st.expander("🎯 ผลลัพธ์ที่พบด่วน", expanded=True):
                    if matched_bk:
                        st.markdown("<b style='font-size:11px; color:#E85826;'>📋 การจองที่พบ:</b>", unsafe_allow_html=True)
                        for b_item in matched_bk[:4]:
                            b_id = b_item.get("booking_id", "")
                            b_car = b_item.get("car_id", "")
                            b_cust = b_item.get("customer", "")
                            b_st = b_item.get("status", "")
                            w_d = b_item.get("worker_delivery")
                            has_delivery = bool(w_d and str(w_d).strip() and str(w_d).strip() != "Wait")
                            is_pending_dep = (not b_item.get("deposit_paid")) or (b_st == "รอชำระมัดจำ")
                            is_rent_paid = bool(b_item.get("rental_paid", False)) or bool(b_item.get("is_fully_paid", False))
                            is_contract_done = bool(b_item.get("contract_issued", False)) or bool(b_item.get("contract_done", False)) or is_rent_paid or (b_st in ["กำลังเช่า", "เตรียมรับคืน", "เสร็จสิ้น"])
                            
                            if is_pending_dep:
                                badge_icon = "🟡"
                                tag_str = "รอชำระมัดจำ (แท็บ 2)"
                            elif not has_delivery:
                                badge_icon = "🚚"
                                tag_str = "รอออกใบงานส่งรถ (แท็บ 3)"
                            elif not is_contract_done:
                                badge_icon = "📝"
                                tag_str = "รอจัดทำสัญญา (แท็บ 4)"
                            elif not is_rent_paid:
                                badge_icon = "🧾"
                                tag_str = "รอชำระค่าเช่า (แท็บ 2)"
                            else:
                                badge_icon = "🔙"
                                tag_str = "รอรับรถคืน (แท็บ 3)"
                            
                            btn_label = f"{badge_icon} {b_id} ({b_car})"
                            btn_help = f"ลูกค้า: {b_cust} | ขั้นตอน: {tag_str} | คนขับ: {w_d or 'Wait'}"
                            
                            if st.button(btn_label, key=f"sb_nav_bk_{b_id}", use_container_width=True, help=btn_help):
                                st.session_state.search_box_version = st.session_state.get("search_box_version", 0) + 1
                                route_booking_by_lifecycle(b_item)
                                st.rerun()
                    if matched_c:
                        st.markdown("<b style='font-size:11px; color:#EA580C;'>🚘 รถยนต์ที่พบ:</b>", unsafe_allow_html=True)
                        for p in matched_c[:3]:
                            if st.button(f"🚗 {p}", key=f"sb_nav_car_{p}", use_container_width=True):
                                st.session_state.global_search_kw = p
                                st.session_state.search_plate_filter = p
                                st.session_state.fleet_f_brand = "ทั้งหมด"
                                st.session_state.fleet_f_group = "ทั้งหมด"
                                st.session_state.fleet_f_status = "ทั้งหมด"
                                st.session_state.fleet_f_company = "ทั้งหมด"
                                st.session_state.search_box_version = st.session_state.get("search_box_version", 0) + 1
                                st.session_state.selected_module = "Front Office"
                                st.session_state.workflow_tab = "1. เลือกรถยนต์"
                                st.rerun()
                    if matched_cu:
                        st.markdown("<b style='font-size:11px; color:#3B82F6;'>👤 ข้อมูลลูกค้าที่พบ:</b>", unsafe_allow_html=True)
                        for cu_name in matched_cu[:3]:
                            if st.button(f"👤 {cu_name[:16]}", key=f"sb_nav_cu_{cu_name}", use_container_width=True):
                                st.session_state.search_box_version = st.session_state.get("search_box_version", 0) + 1
                                cu_bks = [b for b in st.session_state.bookings_db if str(b.get("customer","")).strip().lower() == cu_name.strip().lower() and b.get("status") not in ["เสร็จสิ้น", "ยกเลิก"]]
                                if cu_bks:
                                    route_booking_by_lifecycle(cu_bks[0])
                                else:
                                    st.session_state.global_search_kw = cu_name
                                    st.session_state.search_plate_filter = cu_name
                                    st.session_state.selected_module = "Front Office"
                                    st.session_state.workflow_tab = "2. ชำระเงินจอง & การเงิน"
                                    st.session_state.selected_customer_name = cu_name
                                    st.session_state.show_edit_customer = True
                                    st.session_state.show_add_customer = False
                                st.rerun()
                    if matched_hist and not matched_bk:
                        st.markdown("<b style='font-size:11px; color:#6B7280;'>📂 ประวัติงานเดิม:</b>", unsafe_allow_html=True)
                        for cj_item in matched_hist[:3]:
                            cj_id = cj_item.get("booking_id", "")
                            cj_car = cj_item.get("car_id", "")
                            if st.button(f"📁 {cj_id} ({cj_car})", key=f"sb_nav_cj_{cj_id}", use_container_width=True):
                                st.session_state.selected_module = "Back Office"
                                st.session_state.global_search_kw = cj_id
                                st.session_state.search_plate_filter = cj_id
                                st.session_state.search_box_version = st.session_state.get("search_box_version", 0) + 1
                                st.rerun()
        else:
            st.session_state.prev_sb_search_kw = ""

                                
        st.markdown("<div style='height: 4px;'></div>", unsafe_allow_html=True)
        st.markdown(f"<p style='font-size:11px; font-weight:700; color:#8C827A; margin: 10px 0 6px 2px;'>{t_sidebar.get('menu_header', 'เมนูระบบงานหลัก:')}</p>", unsafe_allow_html=True)
        
        current_lang = st.session_state.get("language", "TH")
        if current_lang not in translations:
            current_lang = "TH"
            st.session_state.language = "TH"
        t_sidebar = translations[current_lang]

        modules = [
            (t_sidebar["nav_front"], "Front Office"),
            (t_sidebar["nav_back"], "Back Office"),
            (t_sidebar["nav_crm"], "โมดูลจัดการลูกค้า"),
            (t_sidebar["nav_dash"], "Dashboard และรายงานผู้บริหาร")
        ]
        
        for label, val in modules:
            btn_type = "primary" if st.session_state.selected_module == val else "secondary"
            if st.button(label, key=f"nav_{val}", type=btn_type, use_container_width=True):
                st.session_state.selected_module = val
                for qk in list(st.query_params.keys()):
                    del st.query_params[qk]
                st.session_state.active_close_job_id = None
                st.session_state.active_close_job_type = None
                st.session_state.active_deposit_bk_id = None
                st.session_state.active_settle_bk_id = None
                st.session_state.active_extend_bk_id = None
                st.session_state.active_assign_bk_id = None
                st.session_state.active_contract_bk_id = None
                st.session_state.active_return_bk_id = None
                st.rerun()
                
        st.markdown("---")
        render_live_cloud_sync_panel()

        if st.button(translations.get(st.session_state.get("language", "TH"), translations["TH"])["btn_logout"], key="btn_logout_sidebar", use_container_width=True):
            sb_auth_logout()
            st.session_state.user = None
            st.session_state['logged_in'] = False
            if 'username' in st.session_state:
                del st.session_state['username']
            st.session_state.pop('login_timestamp', None)
            st.session_state["_logged_out_this_session"] = True
            _queue_session_cookie(None)
            st.session_state.auth_mode = "login"
            for qk in list(st.query_params.keys()):
                del st.query_params[qk]
            st.session_state.active_close_job_id = None
            st.session_state.active_close_job_type = None
            st.session_state.active_deposit_bk_id = None
            st.session_state.active_settle_bk_id = None
            st.session_state.active_extend_bk_id = None
            st.session_state.active_assign_bk_id = None
            st.session_state.active_contract_bk_id = None
            st.session_state.active_return_bk_id = None
            st.rerun()

    if st.session_state.selected_module == "โมดูลจัดการลูกค้า":
        st.session_state.selected_module = "Front Office"
        st.session_state.workflow_tab = "2. ชำระเงินจอง & การเงิน"

    module = st.session_state.selected_module

    # =========================================================================
    # 7.1 FRONT OFFICE MODULE
    # =========================================================================
    if module == "Front Office":
        if hasattr(st, "html"):
            st.html(folder_tabs_luxury_css)
        else:
            st.markdown(folder_tabs_luxury_css, unsafe_allow_html=True)
        fo_hdr = translations[st.session_state.language].get("fo_title", "Front Office (ระบบปฏิบัติการเช่ารถ)")
        fo_sub = translations[st.session_state.language].get("fo_subtitle", "เลือกลำดับขั้นตอนตามแฟ้มงานด้านล่างเพื่อดำเนินการจัดเตรียมรถ สัญญา และส่งมอบ")
        st.markdown(f"""
            <div style="margin-bottom: 16px;">
                <h1 style="font-size: 25px; font-weight: 700; color: #1F2937; margin: 0; display:flex; align-items:center; gap:8px;">
                    <span>📂</span> {fo_hdr}
                </h1>
                <div style="font-size: 12px; color: #6B7280; margin-top: 4px;">{fo_sub}</div>
            </div>
        """, unsafe_allow_html=True)
        
        # ปรับความเข้ากันได้ย้อนหลัง (Tab Normalization)
        tab_aliases = {
            # รองรับชื่อแท็บเดิมและแบบย่อทั้งหมด
            "1. แผงควบคุมการจอง": "5. แผงควบคุมการจอง",
            "แผงควบคุมการจอง": "5. แผงควบคุมการจอง",
            "2. เลือกรถยนต์": "1. เลือกรถยนต์",
            "เลือกรถยนต์": "1. เลือกรถยนต์",
            "3. ชำระเงินจอง & การเงิน": "2. ชำระเงินจอง & การเงิน",
            "3. ชำระเงินจอง": "2. ชำระเงินจอง & การเงิน",
            "3. จัดทำสัญญา & ชำระเงิน": "2. ชำระเงินจอง & การเงิน",
            "4. รับมัดจำ (ล็อกคิว/ใบเสร็จ)": "2. ชำระเงินจอง & การเงิน",
            "ชำระเงินจอง & การเงิน": "2. ชำระเงินจอง & การเงิน",
            "4. ใบงานส่ง/รับรถ": "3. ใบงานส่ง/รับรถ",
            "5. ใบงานส่ง/รับรถ": "3. ใบงานส่ง/รับรถ",
            "ใบงานส่ง/รับรถ": "3. ใบงานส่ง/รับรถ",
            "5. จัดทำสัญญาเช่า": "4. จัดทำสัญญาเช่า",
            "3. จัดทำสัญญาเช่า": "4. จัดทำสัญญาเช่า",
            "จัดทำสัญญาเช่า": "4. จัดทำสัญญาเช่า"
        }
        if st.session_state.workflow_tab in tab_aliases:
            st.session_state.workflow_tab = tab_aliases[st.session_state.workflow_tab]

        tabs = [
            "1. เลือกรถยนต์",
            "2. ชำระเงินจอง & การเงิน",
            "3. ใบงานส่ง/รับรถ",
            "4. จัดทำสัญญาเช่า",
            "5. แผงควบคุมการจอง"
        ]
        tab_display_map = {
            "1. เลือกรถยนต์": translations[st.session_state.language].get("tab_fleet_display", "🚘 2. ค้นหารถยนต์ (Fleet Selection)"),
            "2. ชำระเงินจอง & การเงิน": translations[st.session_state.language].get("tab_deposit_display", "💳 4. การเงินและมัดจำ (Financial & Deposit)"),
            "3. ใบงานส่ง/รับรถ": translations[st.session_state.language].get("tab_dispatch_display", "🚚 5. ระบบงานภาคสนาม (Dispatch & Return)"),
            "4. จัดทำสัญญาเช่า": translations[st.session_state.language].get("tab_contract_display", "📝 3. สัญญาเช่า (Lease Agreement)"),
            "5. แผงควบคุมการจอง": translations[st.session_state.language].get("tab_pipeline_display", "📂 1. แผงควบคุม (Booking Dashboard)")
        }
        
        with st.container(key="folder_tabs_bar"):
            t_cols = st.columns(5, gap="xxsmall")
            for i, t in enumerate(tabs):
                btn_type = "primary" if st.session_state.workflow_tab == t else "secondary"
                btn_label = tab_display_map.get(t, t.split(" (")[0])
                if t_cols[i].button(btn_label, key=f"wtab_{i}", type=btn_type, use_container_width=True):
                    st.session_state.workflow_tab = t
                    st.rerun()

        st.markdown('<div class="folder-shelf-line"></div>', unsafe_allow_html=True)

        current_tab = st.session_state.workflow_tab
        
        # --- TAB 1: FLEET SELECTION ---
        if current_tab in ["1. เลือกรถยนต์", "2. เลือกรถยนต์"]:
            # --- 1) จัดการ State ของตัวกรอง Tab 2 เพื่อให้เซลเลือกรถและรีเซ็ตได้อย่างแม่นยำ ---
            if "fleet_f_group" not in st.session_state: st.session_state.fleet_f_group = "ทั้งหมด"
            if "fleet_f_brand" not in st.session_state: st.session_state.fleet_f_brand = "ทั้งหมด"
            if "fleet_f_status" not in st.session_state: st.session_state.fleet_f_status = "ทั้งหมด"
            if "fleet_f_company" not in st.session_state: st.session_state.fleet_f_company = "ทั้งหมด"
            if "fleet_f_start" not in st.session_state: st.session_state.fleet_f_start = None
            if "fleet_f_end" not in st.session_state: st.session_state.fleet_f_end = None

            # เชื่อมโยงคำค้นหาจากไซด์บาร์ (ยี่ห้อ, รุ่น, ทะเบียน, สี)
            search_kw = st.session_state.get("global_search_kw", st.session_state.get("search_plate_filter", "")).strip()

            def reset_all_fleet_filters():
                st.session_state.fleet_f_group = "ทั้งหมด"
                st.session_state.fleet_f_brand = "ทั้งหมด"
                st.session_state.fleet_f_status = "ทั้งหมด"
                st.session_state.fleet_f_company = "ทั้งหมด"
                st.session_state.fleet_f_start = None
                st.session_state.fleet_f_end = None
                st.session_state.global_search_kw = ""
                st.session_state.search_plate_filter = ""
                st.session_state.prev_sb_search_kw = ""
                st.session_state.search_box_version = st.session_state.get("search_box_version", 0) + 1
                st.session_state.search_avail_start = None
                st.session_state.search_avail_end = None
                st.session_state._fleet_auto_kw = ""
                st.session_state.fleet_detail_plate = None

            if hasattr(st, "html"):
                st.html(fleet_cards_css)
            else:
                st.markdown(fleet_cards_css, unsafe_allow_html=True)

            # --- SECTION 1: HERO SECTION & BANNER (Pastel Luxury Minimal) ---
            st.markdown(
                '<div class="fleet-hero-banner">'
                '<div class="fleet-hero-pill">LUXURY CAR RENTAL THAILAND</div>'
                '<h2 class="fleet-hero-title">EXPERIENCE THAILAND IN UNPARALLELED LUXURY. BOOK YOUR ELITE DRIVE.</h2>'
                '<div class="fleet-palette-row">'
                '<span class="fleet-palette-tag"><span class="color-dot" style="background:#E0B8B8;"></span> Soft Rose Gold (#E0B8B8)</span>'
                '<span class="fleet-palette-tag"><span class="color-dot" style="background:#B4C6E7;"></span> Muted Pastel Blue (#B4C6E7)</span>'
                '<span class="fleet-palette-tag"><span class="color-dot" style="background:#EAE2D8;"></span> Pastel Champagne/Beige (#F5ECE0)</span>'
                '</div>'
                '</div>',
                unsafe_allow_html=True
            )

            # --- SECTION 2: INSTANT BOOKING FORM (THE BOOKING BAR) ---
            _existing_groups = sorted(list(set(c.get("car_group", "").strip() for c in cars_db.values() if c.get("car_group"))))
            _group_options = ["ทั้งหมด"] + _existing_groups

            _existing_brands = sorted(list(set(c.get("brand", "").strip() for c in cars_db.values() if c.get("brand"))))
            _brand_options = ["ทั้งหมด"] + _existing_brands

            _company_options = ["ทั้งหมด"] + sorted(list(set(c.get("company", "").strip() for c in cars_db.values() if c.get("company"))))
            _status_options = [
                "ทั้งหมด",
                "ว่างไม่มีการจอง (🟢)",
                "มีการจองล่วงหน้าไว้ (🟡)",
                "ไม่ว่างในวันที่เลือก (🔴)",
                "สถานะซ่อมบำรุง (🟠)",
                "ว่างพร้อมใช้งาน (🟢+🟡)",
                "กำลังเช่า",
                "ติดจอง"
            ]

            with st.container(border=True, key="fleet_filter_bar"):
                bk_bar_title = translations[st.session_state.language].get("hero_booking_bar_title", "✨ 2. INSTANT BOOKING FORM (THE BOOKING BAR) — ค้นหาและเลือกรถด่วนสำหรับเซล")
                st.markdown(
                    f'<div class="fleet-booking-title">{bk_bar_title}</div>',
                    unsafe_allow_html=True
                )
                
                # แถวที่ 1: ดรอปดาวน์ตัวกรองทั้งหมด (หมวดหมู่รถ, ยี่ห้อ, กรรมสิทธิ์/บริษัท, สถานะรถ)
                b_c1, b_c2, b_c3, b_c4 = st.columns(4)
                with b_c1:
                    cur_grp_idx = _group_options.index(st.session_state.fleet_f_group) if st.session_state.fleet_f_group in _group_options else 0
                    f_group = st.selectbox("หมวดหมู่รถ (Category)", _group_options, index=cur_grp_idx, key="fleet_f_group")
                with b_c2:
                    cur_brd_idx = _brand_options.index(st.session_state.fleet_f_brand) if st.session_state.fleet_f_brand in _brand_options else 0
                    f_brand = st.selectbox("ยี่ห้อ (Brand)", _brand_options, index=cur_brd_idx, key="fleet_f_brand")
                with b_c3:
                    cur_comp_idx = _company_options.index(st.session_state.fleet_f_company) if st.session_state.fleet_f_company in _company_options else 0
                    f_company = st.selectbox("กรรมสิทธิ์/บริษัท", _company_options, index=cur_comp_idx, key="fleet_f_company")
                with b_c4:
                    cur_st_idx = _status_options.index(st.session_state.fleet_f_status) if st.session_state.fleet_f_status in _status_options else 0
                    f_status = st.selectbox("สถานะรถ (Status)", _status_options, index=cur_st_idx, key="fleet_f_status")

                # แถวที่ 2: ระบุวันที่ (วันที่ส่งรถ, วันที่คืนรถ) และปุ่มล้างตัวกรอง
                d_c1, d_c2, d_c3 = st.columns([1.5, 1.5, 1.0])
                with d_c1:
                    f_avail_start = st.date_input(
                        "วันที่ส่งรถ (Pick-up)", 
                        value=st.session_state.fleet_f_start, 
                        format="DD/MM/YYYY", 
                        key="fleet_f_start",
                        help="เลือกระบุวันที่เริ่มส่งมอบรถ (ถ้าต้องการตรวจสอบรถว่าง)"
                    )
                with d_c2:
                    f_avail_end = st.date_input(
                        "วันที่คืนรถ (Return)", 
                        value=st.session_state.fleet_f_end, 
                        format="DD/MM/YYYY", 
                        key="fleet_f_end",
                        help="เลือกระบุวันที่คืนรถ (ถ้าต้องการตรวจสอบรถว่าง)"
                    )
                with d_c3:
                    st.markdown("<div style='height: 28px;'></div>", unsafe_allow_html=True)
                    st.button("🔄 ล้างตัวกรอง (Reset Filters)", on_click=reset_all_fleet_filters, use_container_width=True, help="คืนค่าตัวกรองทั้งหมดและแสดงรถยนต์ทุกคันทันที")

            # ซิงค์วันที่เลือกในหน้าดูรถยนต์เข้าสู่ดราฟต์สัญญาเช่า เพื่อให้หน้าทำสัญญาแสดงผลทันทีโดยไม่ต้องเลือกซ้ำ
            if f_avail_start:
                st.session_state.draft_start_date = f_avail_start
            if f_avail_end:
                st.session_state.draft_end_date = f_avail_end

            # --- 2) ระบบคัดกรองรถยนต์ (Match Engine) ---
            if f_avail_start and f_avail_end and f_avail_end < f_avail_start:
                st.warning("⚠️ วันที่คืนรถต้องไม่น้อยกว่าวันที่ส่งรถ")

            _fleet_matched = []
            for plate, c in cars_db.items():
                # กรองคำค้นหาจากไซด์บาร์ (ยี่ห้อ, รุ่น, ทะเบียน, สี, บริษัท)
                if search_kw:
                    is_brand_search = (f_brand != "ทั้งหมด" and (
                        search_kw.lower() == f_brand.lower() or 
                        search_kw.lower() in ["โตโยต้า", "toyota", "bmw", "บีเอ็ม", "benz", "เบนซ์", "mercedes-benz", "honda", "ฮอนด้า", "porsche", "ปอร์เช่", "ferrari", "ford", "mazda", "nissan", "hyundai", "byd", "tesla"]
                    ))
                    if not is_brand_search:
                        target_txt = f"{plate} {c.get('brand','')} {c.get('model','')} {c.get('car_group','')} {c.get('company','')} {c.get('color','')}".lower()
                        target_no_sym = target_txt.replace("-", "").replace(" ", "")
                        kw_clean = search_kw.lower()
                        kw_no_sym = kw_clean.replace("-", "").replace(" ", "")
                        if kw_clean not in target_txt and kw_no_sym not in target_no_sym:
                            continue
                
                # กรองหมวดหมู่
                if f_group != "ทั้งหมด":
                    cg = c.get('car_group', '')
                    if f_group != cg and f_group.lower() not in cg.lower() and cg.lower() not in f_group.lower():
                        continue

                # กรองยี่ห้อ
                if f_brand != "ทั้งหมด":
                    if c.get('brand', '').strip().lower() != f_brand.strip().lower():
                        continue

                # กรองบริษัทกรรมสิทธิ์
                if f_company != "ทั้งหมด":
                    if c.get('company', '').strip() != f_company.strip():
                        continue

                # ตรวจสอบสถานะสีความพร้อมใช้งานของรถ
                _car_st = get_car_fleet_status(plate, c, st.session_state.bookings_db, f_avail_start, f_avail_end)
                
                # กรองสถานะตามตัวเลือก
                if f_status.startswith("ว่างไม่มีการจอง"):
                    if _car_st['code'] != "available":
                        continue
                elif f_status.startswith("มีการจองล่วงหน้าไว้"):
                    if _car_st['code'] != "reserved":
                        continue
                elif f_status.startswith("ไม่ว่างในวันที่เลือก"):
                    if _car_st['code'] != "unavailable":
                        continue
                elif f_status.startswith("สถานะซ่อมบำรุง") or f_status == "ซ่อมบำรุง":
                    if _car_st['code'] != "maintenance":
                        continue
                elif f_status.startswith("ว่างพร้อมใช้งาน"):
                    if _car_st['code'] not in ["available", "reserved"]:
                        continue
                elif f_status != "ทั้งหมด":
                    if c.get('status') != f_status:
                        continue

                _fleet_matched.append((plate, c))

            total_fleet_count = len(cars_db)
            matched_count = len(_fleet_matched)

            # แสดงแถบสรุปสถานะฟีลเตอร์ (Active Filter Ribbon)
            _is_any_filter = (
                f_group != "ทั้งหมด" or
                f_brand != "ทั้งหมด" or
                f_status != "ทั้งหมด" or
                f_company != "ทั้งหมด" or
                bool(search_kw) or
                bool(f_avail_start)
            )

            if _is_any_filter:
                chips_html = []
                if f_group != "ทั้งหมด": chips_html.append(f'<span class="fleet-filter-chip">หมวดหมู่: {f_group}</span>')
                if f_brand != "ทั้งหมด": chips_html.append(f'<span class="fleet-filter-chip">ยี่ห้อ: {f_brand}</span>')
                if f_status != "ทั้งหมด": chips_html.append(f'<span class="fleet-filter-chip">สถานะ: {f_status}</span>')
                if f_company != "ทั้งหมด": chips_html.append(f'<span class="fleet-filter-chip">บริษัท: {f_company}</span>')
                if search_kw: chips_html.append(f'<span class="fleet-filter-chip">คำค้นหา: &ldquo;{search_kw}&rdquo;</span>')
                if f_avail_start:
                    d_txt = f"{format_date_dmy(f_avail_start)} - {format_date_dmy(f_avail_end)}" if f_avail_end else format_date_dmy(f_avail_start)
                    chips_html.append(f'<span class="fleet-filter-chip">📅 {d_txt}</span>')
                
                chips_str = " ".join(chips_html)
                st.markdown(
                    f'<div class="fleet-active-filters-box">'
                    f'<span style="font-size:12px; font-weight:700; color:#4B5563;">⚡ ฟีลเตอร์ที่กำลังทำงาน:</span>'
                    f'{chips_str}'
                    f'<span style="margin-left:auto; font-size:12px; color:#6B7280;">(แสดง <b>{matched_count}</b> จากทั้งหมด {total_fleet_count} คัน)</span>'
                    f'</div>',
                    unsafe_allow_html=True
                )

            # ฟอร์มเพิ่มรถยนต์ใหม่ (คงฟีเจอร์เดิมครบถ้วน 100%)
            with st.expander("🚗➕ เพิ่มยานพาหนะ (Add Vehicle)", expanded=False):
                    st.markdown("<div style='font-size:13.5px; font-weight:700; color:#E85826; margin-bottom:12px;'>📋 แบบฟอร์มลงทะเบียนยานพาหนะ (Add Vehicle) เข้าสู่ฐานข้อมูล</div>", unsafe_allow_html=True)
                    
                    add_c1, add_c2, add_c3 = st.columns(3)
                    with add_c1:
                        add_plate = st.text_input("ทะเบียนรถ (เช่น 1กข 9999 กทม.)*", placeholder="กรอกป้ายทะเบียน", key="add_car_plate").strip()
                        add_brand = st.selectbox("ยี่ห้อ (Brand)*", ["Toyota", "Honda", "GWM", "BYD", "Mercedes-Benz", "BMW", "Isuzu", "Ford", "Nissan", "Mazda", "MG", "Tesla", "Hyundai", "อื่นๆ"], key="add_car_brand")
                        add_model = st.text_input("รุ่น (Model)*", placeholder="เช่น Camry, Tank 300, Alphard", key="add_car_model").strip()
                        add_color = st.text_input("สีตัวถัง (Color)", placeholder="เช่น ขาว (White), ดำ (Black)", key="add_car_color").strip()
                    
                    with add_c2:
                        add_group = st.selectbox("กลุ่มรถ (Car Group)*", ["รถเก๋ง (Sedan/Hatchback)", "SUV", "รถตู้ (Van)", "รถกระบะ", "รถสปอร์ต/หรูหรา"], key="add_car_group")
                        add_cc = st.selectbox("ขนาดเครื่องยนต์ (CC)*", ["1200", "1500", "1800", "2000", "2400", "2500", "3000", "EV"], key="add_car_cc")
                        add_fuel = st.selectbox("ระบบเชื้อเพลิง*", ["เบนซิน", "ดีเซล", "เบนซิน/Hybrid", "ดีเซล/Hybrid", "ไฟฟ้า (EV)"], key="add_car_fuel")
                        add_comp = st.selectbox("กรรมสิทธิ์/บริษัทเจ้าของรถ*", ["Sawasdee Rent A Car", "P.D.P. Co., Ltd.", "Sawasdee Car Rent"], key="add_car_comp")
                    
                    with add_c3:
                        add_p_day = st.number_input("ราคาเช่ารายวัน (฿/วัน)*", min_value=0, value=1500, step=100, key="add_car_pday")
                        add_p_week = st.number_input("ราคาเช่ารายสัปดาห์ (฿/สัปดาห์)", min_value=0, value=9000, step=500, key="add_car_pweek")
                        add_p_month = st.number_input("ราคาเช่ารายเดือน (฿/เดือน)", min_value=0, value=25000, step=1000, key="add_car_pmonth")
                        add_status = st.selectbox("สถานะเริ่มต้น*", ["ว่างพร้อมใช้งาน", "ซ่อมบำรุง", "เตรียมส่งมอบ"], key="add_car_status")
                    
                    st.markdown("<hr style='margin:12px 0; border:0.5px solid #EFEAE3;'>", unsafe_allow_html=True)
                    doc_c1, doc_c2, doc_c3 = st.columns(3)
                    with doc_c1:
                        add_chassis = st.text_input("เลขตัวถัง (VIN / Chassis No)", placeholder="เช่น MRXGWM...", key="add_car_chassis").strip()
                        add_mileage = st.text_input("เลขไมล์ปัจจุบัน (km)", value="10,000", key="add_car_mileage").strip()
                    with doc_c2:
                        add_tax = st.date_input("วันหมดอายุภาษี", value=None, format="DD/MM/YYYY", key="add_car_tax")
                        add_act = st.date_input("วันหมดอายุ พ.ร.บ.", value=None, format="DD/MM/YYYY", key="add_car_act")
                        add_ins = st.date_input("วันหมดอายุประกันภัย", value=None, format="DD/MM/YYYY", key="add_car_ins")
                    with doc_c3:
                        add_img_file = st.file_uploader("รูปถ่ายรถ (JPG, PNG, WEBP):", type=["jpg", "jpeg", "png", "webp"], key="add_car_img_file")
                        if add_img_file is not None:
                            st.image(add_img_file, caption="ตัวอย่างรูปรถใหม่", use_container_width=True)
                    
                    st.markdown("<hr style='margin:12px 0; border:0.5px solid #EFEAE3;'>", unsafe_allow_html=True)
                    add_debt_free = st.checkbox(translations[st.session_state.language].get("is_debt_free", "รถปลอดภาระ / ซื้อเงินสด"), value=True, key="add_car_debt_free")
                    if not add_debt_free:
                        inst_c1, inst_c2, inst_c3, inst_c4 = st.columns(4)
                        with inst_c1:
                            add_inst_amt = st.number_input(translations[st.session_state.language].get("installment_amount", "ค่างวดต่อเดือน (THB)"), min_value=0.0, value=0.0, step=500.0, key="add_car_inst_amt")
                        with inst_c2:
                            add_total_inst = st.number_input(translations[st.session_state.language].get("total_installments", "จำนวนงวดทั้งหมด"), min_value=0, value=48, step=1, key="add_car_total_inst")
                        with inst_c3:
                            add_curr_inst = st.number_input(translations[st.session_state.language].get("current_installment", "งวดปัจจุบัน (ชำระแล้ว)"), min_value=0, value=0, step=1, key="add_car_curr_inst")
                        with inst_c4:
                            add_due_date = st.date_input(translations[st.session_state.language].get("payment_due_date", "วันกำหนดชำระ (ทุกวันที่)"), value=None, format="DD/MM/YYYY", key="add_car_due_date")
                    else:
                        add_inst_amt = 0.0
                        add_total_inst = 0
                        add_curr_inst = 0
                        add_due_date = None

                    btn_c_save, btn_c_tip = st.columns([1.5, 2])
                    with btn_c_save:
                        if st.button("💾 บันทึกรถยนต์ใหม่เข้าสู่ฐานข้อมูล", type="primary", key="btn_save_new_vehicle", use_container_width=True):
                            if not add_plate:
                                st.error("⚠️ กรุณาระบุทะเบียนรถ")
                            elif not add_model:
                                st.error("⚠️ กรุณาระบุรุ่นรถ")
                            elif add_plate in cars_db:
                                st.error(f"⚠️ ทะเบียนรถ '{add_plate}' มีอยู่ในฐานข้อมูลแล้ว ไม่สามารถเพิ่มซ้ำได้")
                            else:
                                new_car_img = ""
                                if add_img_file is not None:
                                    car_bytes = add_img_file.read()
                                    mime_f = add_img_file.type or "image/jpeg"
                                    safe_pl = re.sub(r'[^a-zA-Z0-9_\.-]', '_', add_plate)
                                    pub_url = sb_upload_photo(f"car_{safe_pl}_{int(time.time())}.jpg", car_bytes, mime_f)
                                    if pub_url:
                                        new_car_img = pub_url
                                    else:
                                        b64_f = base64.b64encode(car_bytes).decode()
                                        new_car_img = f"data:{mime_f};base64,{b64_f}"
                                
                                new_car_data = {
                                    "plate": add_plate,
                                    "brand": add_brand,
                                    "model": add_model,
                                    "color": add_color or "ไม่ระบุ",
                                    "car_group": add_group,
                                    "engine_cc": str(add_cc),
                                    "fuel_type": add_fuel,
                                    "company": add_comp,
                                    "price_day": int(add_p_day),
                                    "price_week": int(add_p_week),
                                    "price_month": int(add_p_month),
                                    "status": add_status,
                                    "chassis_no": add_chassis or "-",
                                    "tax_expiry": format_date_for_db(add_tax, "%d/%m/%Y"),
                                    "act_expiry": format_date_for_db(add_act, "%d/%m/%Y"),
                                    "ins_expiry": format_date_for_db(add_ins, "%d/%m/%Y"),
                                    "mileage": add_mileage or "0",
                                    "image": new_car_img,
                                    "is_debt_free": bool(add_debt_free),
                                    "installment_amount": float(add_inst_amt) if not add_debt_free else 0.0,
                                    "total_installments": int(add_total_inst) if not add_debt_free else 0,
                                    "current_installment": int(add_curr_inst) if not add_debt_free else 0,
                                    "payment_due_date": format_date_for_db(add_due_date, "%Y-%m-%d") if not add_debt_free and add_due_date else "-"
                                }
                                st.session_state.cars_db[add_plate] = new_car_data
                                cars_db[add_plate] = new_car_data
                                sb_sync_car(add_plate, new_car_data)
                                st.success(f"✅ บันทึกรถยนต์ทะเบียน '{add_plate}' ({add_brand} {add_model}) เข้าสู่ฐานข้อมูลเรียบร้อยแล้ว!")
                                time.sleep(1)
                                st.rerun()
                    with btn_c_tip:
                        st.caption("💡 รถยนต์ที่เพิ่มใหม่จะแสดงในการ์ดเลือกรถทันที และซิงค์ไปยังหน้า Dashboard กองยานพาหนะ และ Back Office อัตโนมัติ")


            # --- SECTION 3: PREMIUM FLEET SHOWCASE ("OUR ELITE FLEET") ---
            # รูปรถเรียงกันเป็น Card (มีรูป ราคา ยี่ห้อ รุ่น) พร้อมจุดสถานะบอกความพร้อมใช้งาน
            _matched_avail_count = sum(1 for _p, _c in _fleet_matched if get_car_fleet_status(_p, _c, st.session_state.bookings_db, f_avail_start, f_avail_end)['code'] in ['available', 'reserved'])
            _subtitle_str = f"พบรถยนต์ทั้งหมด <b>{matched_count}</b> คัน (พร้อมใช้งาน <b>{_matched_avail_count}</b> คัน)" if matched_count != _matched_avail_count else f"พบรถยนต์พร้อมใช้งาน <b>{matched_count}</b> คัน"

            st.markdown(
                f'<div style="text-align: center; margin: 20px 0 12px 0;">'
                f'<div style="font-size: 11px; letter-spacing: 2.5px; text-transform: uppercase; color: #8C827A; font-weight: 700;">SAWASDEE RENTAL SHOWCASE</div>'
                f'<h3 style="font-size: 22px; font-weight: 800; color: #1F2937; margin: 2px 0 0 0; letter-spacing: 0.5px;">OUR ELITE FLEET</h3>'
                f'<div style="font-size: 13px; color: #6B7280; margin-top: 3px;">{_subtitle_str}</div>'
                f'<div style="display:flex; justify-content:center; align-items:center; gap:12px; margin: 10px 0 4px 0; font-size:12px; color:#4B5563; flex-wrap:wrap;">'
                f'<span style="display:inline-flex; align-items:center; gap:5px; background:#F0FDF4; border:1px solid #BBF7D0; padding:2px 10px; border-radius:12px; font-weight:600; color:#15803D;"><span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#10B981; box-shadow:0 0 5px rgba(16,185,129,0.5);"></span> ว่างไม่มีการจอง</span>'
                f'<span style="display:inline-flex; align-items:center; gap:5px; background:#FEFCE8; border:1px solid #FEF08A; padding:2px 10px; border-radius:12px; font-weight:600; color:#A16207;"><span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#F59E0B; box-shadow:0 0 5px rgba(245,158,11,0.5);"></span> มีการจองล่วงหน้าไว้</span>'
                f'<span style="display:inline-flex; align-items:center; gap:5px; background:#FEF2F2; border:1px solid #FECACA; padding:2px 10px; border-radius:12px; font-weight:600; color:#B91C1C;"><span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#EF4444; box-shadow:0 0 5px rgba(239,68,68,0.5);"></span> ไม่ว่างในวันที่เลือก</span>'
                f'<span style="display:inline-flex; align-items:center; gap:5px; background:#FFF7ED; border:1px solid #FED7AA; padding:2px 10px; border-radius:12px; font-weight:600; color:#C2410C;"><span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#F97316; box-shadow:0 0 5px rgba(249,115,22,0.5);"></span> สถานะซ่อมบำรุง</span>'
                f'</div>'
                f'</div>',
                unsafe_allow_html=True
            )

            import html as _html_esc
            _FLEET_COLS = 3
            _FLEET_DEFAULT_IMG = ""

            def format_plate_display(plate):
                """แยกเลขทะเบียนและจังหวัดสำหรับแสดงผลแบบป้ายทะเบียนไทย"""
                plate_str = str(plate or "").strip()
                is_red = "ป้ายแดง" in plate_str or "red" in plate_str.lower()
                parts = plate_str.split()
                if len(parts) >= 3 and any(pv in parts[-1] for pv in ["กรุงเทพ", "กทม", "เชียงใหม่", "ชลบุรี", "ภูเก็ต"]):
                    plate_no = " ".join(parts[:-1])
                    province = parts[-1]
                elif len(parts) == 2 and any(pv in parts[1] for pv in ["กรุงเทพ", "กทม", "เชียงใหม่", "ชลบุรี", "ภูเก็ต"]):
                    plate_no = parts[0]
                    province = parts[1]
                else:
                    plate_no = plate_str
                    province = "กรุงเทพมหานคร"
                return plate_no, province, is_red

            def get_car_expiry_alert_info(c, is_en=False):
                """คำนวณการแจ้งเตือนวันหมดอายุ ประกันภัย / พ.ร.บ. / ภาษี"""
                today = date.today()
                checks = [
                    ("Insurance" if is_en else "ประกันภัย", c.get("ins_expiry")),
                    ("ACT" if is_en else "พ.ร.บ.", c.get("act_expiry")),
                    ("Tax" if is_en else "ภาษี", c.get("tax_expiry")),
                ]
                urgent_item = None
                min_diff = None

                for doc_name, exp_raw in checks:
                    if not exp_raw or str(exp_raw).strip() in ["-", "", "None"]:
                        continue
                    exp_d = None
                    if isinstance(exp_raw, (date, datetime)):
                        exp_d = exp_raw if isinstance(exp_raw, date) else exp_raw.date()
                    else:
                        for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y"):
                            try:
                                exp_d = datetime.strptime(str(exp_raw).strip(), fmt).date()
                                break
                            except ValueError:
                                pass
                    if not exp_d:
                        continue
                    diff = (exp_d - today).days
                    if diff <= 30:
                        if min_diff is None or diff < min_diff:
                            min_diff = diff
                            urgent_item = (doc_name, diff)

                if urgent_item is None:
                    return None

                doc_name, diff = urgent_item
                if diff < 0:
                    days_ago = abs(diff)
                    text = f"{doc_name} {days_ago} days overdue" if is_en else f"{doc_name} เกินกำหนด {days_ago} วัน"
                    return {
                        "text": text,
                        "bg": "#FEE2E2",
                        "border": "#FECACA",
                        "color": "#991B1B",
                        "dot": "#EF4444"
                    }
                elif diff == 0:
                    text = f"{doc_name} today" if is_en else f"{doc_name} หมดอายุวันนี้"
                    return {
                        "text": text,
                        "bg": "#FEF3C7",
                        "border": "#FDE68A",
                        "color": "#92400E",
                        "dot": "#F59E0B"
                    }
                else:
                    text = f"{doc_name} in {diff} days" if is_en else f"{doc_name} ใน {diff} วัน"
                    return {
                        "text": text,
                        "bg": "#FEF3C7",
                        "border": "#FDE68A",
                        "color": "#92400E",
                        "dot": "#F59E0B"
                    }

            is_en_lang = (st.session_state.language == "EN")
            exp_open_lbl = translations[st.session_state.language].get("fleet_expander_view", "🔍 ดูรูปรถและข้อมูลเพิ่มเติม")

            # วาดการ์ดรูปรถเรียงกันเป็น Grid ทีละ 3 คอลัมน์ (ตามรูปตัวอย่าง)
            for _row_start in range(0, len(_fleet_matched), _FLEET_COLS):
                _row_items = _fleet_matched[_row_start:_row_start + _FLEET_COLS]
                _row_cols = st.columns(_FLEET_COLS)
                for _i, (_p, _c) in enumerate(_row_items):
                    _idx = _row_start + _i
                    _img = _html_esc.escape(str(_c.get("image") or _FLEET_DEFAULT_IMG), quote=True)
                    _brand = _html_esc.escape(str(_c.get('brand', '')).strip())
                    _model = _html_esc.escape(str(_c.get('model', '')).strip())
                    _full_title = f"{_brand} {_model}".strip() or _html_esc.escape(_p)
                    _color = _html_esc.escape(str(_c.get('color', 'WHITE')).upper())
                    _fuel = _html_esc.escape(str(_c.get('fuel_type', 'Petrol')))
                    _year = str(_c.get('reg_year') or _c.get('year') or '2024')
                    _specs_sub = f"{_year} · {_color} · {_fuel}"

                    # รหัสรถยนต์และแท็กหมวดหมู่ เช่น SW001 และ NIMBLE
                    _car_code = _html_esc.escape(str(_c.get('car_code') or _c.get('code') or f"SW{_idx+1:03d}"))
                    _raw_group = str(_c.get('car_group') or 'SEDAN').upper()
                    _clean_tag = re.sub(r'\(.*?\)', '', _raw_group).strip()
                    if "รถเก๋ง" in _raw_group or "SEDAN" in _clean_tag:
                        _cat_tag = "NIMBLE" if _idx % 2 == 0 else "SEDAN"
                    elif "SUV" in _clean_tag:
                        _cat_tag = "ASPIRE" if _idx % 2 == 0 else "SUV"
                    elif "VAN" in _clean_tag or "ตู้" in _raw_group:
                        _cat_tag = "PRESTIGE"
                    else:
                        _cat_tag = _clean_tag[:10] if _clean_tag else "FLEET"

                    # ป้ายทะเบียนไทย
                    _plt_no, _plt_prov, _is_red = format_plate_display(_p)
                    _plt_no_esc = _html_esc.escape(_plt_no)
                    _plt_prov_esc = _html_esc.escape(_plt_prov)

                    if _is_red:
                        _plate_html = (
                            '<div class="fleet-thai-plate-badge red-plate">'
                            f'<div class="fleet-thai-plate-num">{translations[st.session_state.language].get("fleet_plate_red", "ป้ายแดง")}</div>'
                            f'<div class="fleet-thai-plate-prov">{translations[st.session_state.language].get("fleet_plate_red_sub", "Red plate")}</div>'
                            '</div>'
                        )
                    else:
                        _plate_html = (
                            '<div class="fleet-thai-plate-badge">'
                            f'<div class="fleet-thai-plate-num">{_plt_no_esc}</div>'
                            f'<div class="fleet-thai-plate-prov">{_plt_prov_esc}</div>'
                            '</div>'
                        )

                    # สถานะรถยนต์
                    _c_st = get_car_fleet_status(_p, _c, st.session_state.bookings_db, f_avail_start, f_avail_end)
                    _st_code = _c_st['code']
                    if _st_code == "available":
                        _st_txt = "Available" if is_en_lang else "ว่างไม่มีการจอง"
                        _st_bg, _st_bdr, _st_clr, _st_dot = "#ECFDF5", "#A7F3D0", "#065F46", "#10B981"
                    elif _st_code == "reserved":
                        _st_txt = "Reserved" if is_en_lang else "ติดจอง"
                        _st_bg, _st_bdr, _st_clr, _st_dot = "#FEFCE8", "#FEF08A", "#A16207", "#F59E0B"
                    elif _st_code == "maintenance":
                        _st_txt = "Workshop" if is_en_lang else "ซ่อมบำรุง"
                        _st_bg, _st_bdr, _st_clr, _st_dot = "#FFF7ED", "#FED7AA", "#9A3412", "#F97316"
                    else:
                        _st_txt = "On rent" if is_en_lang else "กำลังเช่า"
                        _st_bg, _st_bdr, _st_clr, _st_dot = "#EFF6FF", "#BFDBFE", "#1E40AF", "#3B82F6"

                    _status_pill_html = (
                        f'<span class="fleet-pill-badge" style="background:{_st_bg}; border:1px solid {_st_bdr}; color:{_st_clr};">'
                        f'<span class="fleet-pill-dot" style="background:{_st_dot};"></span> {_st_txt}'
                        f'</span>'
                    )

                    # การแจ้งเตือนเอกสาร/ประกัน (ถ้ามี)
                    _alert_info = get_car_expiry_alert_info(_c, is_en_lang)
                    _alert_pill_html = ""
                    if _alert_info:
                        _alert_pill_html = (
                            f'<span class="fleet-pill-badge" style="background:{_alert_info["bg"]}; border:1px solid {_alert_info["border"]}; color:{_alert_info["color"]};">'
                            f'<span class="fleet-pill-dot" style="background:{_alert_info["dot"]};"></span> {_alert_info["text"]}'
                            f'</span>'
                        )

                    # ค้นหาการจองปัจจุบันของคันนี้
                    active_rent_bk = None
                    for b in reversed(st.session_state.bookings_db):
                        if b.get("car_id") == _p and b.get("status") in ["กำลังเช่า", "เตรียมส่งมอบ", "รอส่งมอบ", "เตรียมรับคืน", "รอชำระมัดจำ"]:
                            active_rent_bk = b
                            break

                    with _row_cols[_i]:
                        with st.container(border=True):
                            # --- MISSION 1: หน้าการ์ด (CARD FRONT) ---
                            st.markdown(
                                f'<div class="fleet-card-header-row">'
                                f'<div class="fleet-card-code-col">'
                                f'<div class="fleet-card-code-val">{_car_code}</div>'
                                f'<div class="fleet-card-code-tag">{_cat_tag}</div>'
                                f'</div>'
                                f'{_plate_html}'
                                f'</div>'
                                f'<div class="fleet-card-model-text">{_full_title}</div>'
                                f'<div class="fleet-card-specs-text">{_specs_sub}</div>'
                                f'<div class="fleet-card-pills-wrap">'
                                f'{_status_pill_html}'
                                f'{_alert_pill_html}'
                                f'</div>',
                                unsafe_allow_html=True
                            )

                            # --- MISSION 2: ซ่อนรูปภาพและข้อมูลเชิงลึกใน EXPANDER (100% DATASET RETENTION) ---
                            with st.expander(exp_open_lbl, expanded=False):
                                # 1. รูปภาพรถยนต์ และปุ่มอัพเดทรูป
                                if _img:
                                    st.image(_img, use_container_width=True)
                                else:
                                    st.info("ไม่มีรูปภาพ (No Image)")
                                with st.popover("📸 อัพเดทรูปสภาพรถคันนี้", use_container_width=True):
                                    st.markdown(f"**อัพเดทรูปรถปัจจุบัน ({_p})**")
                                    t2_up = st.file_uploader("เลือกไฟล์รูปภาพ:", type=["jpg", "jpeg", "png", "webp"], key=f"t2_up_{_p}")
                                    if t2_up is not None:
                                        st.image(t2_up, caption="ตัวอย่างรูปใหม่", use_container_width=True)
                                        if st.button("💾 บันทึกรูปภาพนี้", key=f"t2_save_{_p}", type="primary"):
                                            t2_bytes = t2_up.getvalue() if hasattr(t2_up, "getvalue") else t2_up.read()
                                            t2_mime = t2_up.type or "image/jpeg"
                                            t2_b64 = base64.b64encode(t2_bytes).decode()
                                            t2_uri = f"data:{t2_mime};base64,{t2_b64}"
                                            safe_pl = re.sub(r'[^a-zA-Z0-9_\.-]', '_', _p)
                                            ext = t2_up.name.split('.')[-1] if '.' in t2_up.name else 'jpg'
                                            pub_url = sb_upload_photo(f"car_{safe_pl}_{int(time.time())}.{ext}", t2_bytes, t2_mime)
                                            final_img = pub_url if pub_url else t2_uri
                                            st.session_state.cars_db[_p]["image"] = final_img
                                            cars_db[_p]["image"] = final_img
                                            sb_sync_car(_p, cars_db[_p])
                                            st.success(f"✅ บันทึกรูปภาพใหม่ของ {_p} สำเร็จ!")
                                            time.sleep(0.8)
                                            st.rerun()

                                # ข้อมูลการเช่าปัจจุบัน (ถ้ามี)
                                if _c.get('status') == "กำลังเช่า" and active_rent_bk:
                                    cust_exp_info = st.session_state.customers_db.get(active_rent_bk.get('customer'), {})
                                    st.markdown(f"""
                                        <div style="background:#FFF7ED; border:1.5px solid #FDBA74; border-radius:8px; padding:10px 12px; margin:8px 0; font-size:12px; line-height:1.6;">
                                            <b style="color:#9A3412;">📋 ข้อมูลการเช่าปัจจุบัน (Active Rental):</b><br/>
                                            👤 <b>ลูกค้า:</b> {active_rent_bk.get('customer', '-')} ({cust_exp_info.get('phone', '-')})<br/>
                                            📅 <b>ระยะเวลา:</b> {format_date_dmy(active_rent_bk.get('start_date'))} ถึง {format_date_dmy(active_rent_bk.get('end_date'))}<br/>
                                            📍 <b>สถานที่:</b> {active_rent_bk.get('loc_delivery', '-')}<br/>
                                            👷 <b>พนักงาน:</b> {active_rent_bk.get('worker_delivery', '-')}
                                        </div>
                                    """, unsafe_allow_html=True)
                                    
                                    c_dl1, c_dl2 = st.columns(2)
                                    with c_dl1:
                                        pdf_c_b = generate_filled_pdf("rental_template_blank_v2.pdf", active_rent_bk, cust_exp_info, _c)
                                        st.download_button("📝 สัญญาเช่า", data=pdf_c_b, file_name=f"Agreement_{active_rent_bk.get('booking_id')}.pdf", mime="application/pdf", use_container_width=True, key=f"dl_agr_grid_{_p}")
                                    with c_dl2:
                                        pdf_d_b = generate_job_pdf(active_rent_bk, cust_exp_info, _c, "Dispatch", active_rent_bk.get('worker_delivery'), active_rent_bk.get('loc_delivery'))
                                        st.download_button("📋 ใบสั่งงาน", data=pdf_d_b, file_name=f"WorkOrder_{active_rent_bk.get('booking_id')}.pdf", mime="application/pdf", use_container_width=True, key=f"dl_wo_grid_{_p}")

                                # 2. ข้อมูลกรมธรรม์ประกันภัย
                                st.markdown(f"**{translations[st.session_state.language].get('fleet_exp_ins_title', '🛡️ ข้อมูลกรมธรรม์ประกันภัย')}**")
                                st.markdown(f"""
                                - **ยี่ห้อ/บริษัทประกัน:** {_c.get('insurance_brand') or _c.get('ins_company', '-')}
                                - **เบี้ยประกันภัย:** {_c.get('insurance_premium', '-')} บาท
                                - **ทุนประกันภัย:** {_c.get('insurance_coverage', '-')} บาท
                                - **วันเริ่มคุ้มครอง:** {_c.get('ins_start_date', '-')}
                                - **วันหมดอายุประกัน:** <b style="color:#DC2626;">{_c.get('ins_expiry', '-')}</b>
                                """)

                                # 3. ข้อมูล พ.ร.บ. และภาษี
                                st.markdown(f"**{translations[st.session_state.language].get('fleet_exp_act_tax_title', '📄 ข้อมูล พ.ร.บ. และภาษี')}**")
                                st.markdown(f"""
                                - **ยี่ห้อ พ.ร.บ.:** {_c.get('act_brand', '-')} | **ราคา:** {_c.get('act_price', '-')} บาท
                                - **วันเริ่ม พ.ร.บ.:** {_c.get('act_start_date', '-')} | **วันหมดอายุ พ.ร.บ.:** <b style="color:#DC2626;">{_c.get('act_expiry', '-')}</b>
                                - **ปีภาษี:** {_c.get('tax_year', '-')} | **วันเริ่มภาษี:** {_c.get('tax_start_date', '-')}
                                - **วันหมดอายุภาษี:** <b style="color:#DC2626;">{_c.get('tax_expiry', '-')}</b>
                                """)

                                # 4. ข้อมูลสัญญาเช่าซื้อ / ลิสซิ่ง (HP / Leasing)
                                st.markdown(f"**{translations[st.session_state.language].get('fleet_exp_hp_title', '💳 ข้อมูลสัญญาเช่าซื้อ / ลิสซิ่ง (HP / Leasing)')}**")
                                st.markdown(f"""
                                - **เลขที่สัญญา:** {_c.get('leasing_contract') or _c.get('hp_contract_no', '-')}
                                - **ค่างวดต่อเดือน:** {_c.get('leasing_installment_amount') or _c.get('hp_installment', '-')} บาท
                                - **จำนวนงวด:** {_c.get('leasing_total_installments', '-')} งวด | **งวดปัจจุบัน:** {_c.get('leasing_current_installment', '-')}
                                - **วันที่ชำระล่าสุด:** {_c.get('leasing_last_payment_date', '-')}
                                """)

                                # 5. ข้อมูลตัวรถเชิงลึก
                                st.markdown(f"**{translations[st.session_state.language].get('fleet_exp_spec_title', '🚘 ข้อมูลตัวรถเชิงลึก')}**")
                                st.markdown(f"""
                                - **เลขไมล์สะสม:** {_c.get('mileage', '0')} km
                                - **เลขเครื่องยนต์:** {_c.get('engine_no', '-')}
                                - **เลขตัวถัง (VIN):** {_c.get('chassis_no', '-')}
                                - **ขนาดเครื่องยนต์:** {_c.get('engine_cc', '-')} cc | **ระบบเชื้อเพลิง:** {_c.get('fuel_type', '-')}
                                - **สีตัวถัง:** {_c.get('color', '-')} | **ประเภทรถ:** {_c.get('car_group', '-')}
                                - **เจ้าของกรรมสิทธิ์:** {_c.get('company') or _c.get('owner', '-')}
                                - **ผู้ดูแล:** {_c.get('manager', '-')}
                                """)

                                # 6. อัตราค่าเช่าที่ตั้งไว้
                                st.markdown(f"**{translations[st.session_state.language].get('fleet_exp_rates_title', '💰 อัตราค่าเช่าที่ตั้งไว้')}**")
                                st.markdown(f"""
                                - **รายวัน:** ฿{int(float(_c.get('price_day', 0) or 0)):,}
                                - **รายสัปดาห์:** ฿{int(float(_c.get('price_week', 0) or 0)):,}
                                - **รายเดือน:** ฿{int(float(_c.get('price_month', 0) or 0)):,}
                                """)

                                # 7. ปุ่ม Action ต่างๆ
                                st.markdown("<hr style='margin:8px 0; border:0.5px solid #EFEAE3;'>", unsafe_allow_html=True)
                                act_c1, act_c2 = st.columns([1.4, 1.0])
                                with act_c1:
                                    if _c.get('status') != "ซ่อมบำรุง":
                                        book_btn_lbl = f"✅ สร้างสัญญาเช่า ({_p})" if _c.get('status') == "ว่างพร้อมใช้งาน" else f"📅 จองล่วงหน้า ({_p})"
                                        if st.button(book_btn_lbl, key=f"grid_bk_{_p}", type="primary", use_container_width=True):
                                            st.session_state.draft_car = _p
                                            if f_avail_start:
                                                st.session_state.draft_start_date = f_avail_start
                                                st.session_state.draft_end_date = f_avail_end if (f_avail_end and f_avail_end >= f_avail_start) else (f_avail_start + timedelta(days=3))
                                            elif not st.session_state.get("draft_start_date"):
                                                st.session_state.draft_start_date = datetime.now().date()
                                                st.session_state.draft_end_date = datetime.now().date() + timedelta(days=3)
                                            st.session_state["c_start_date_tab3"] = st.session_state.draft_start_date
                                            st.session_state["c_end_date_tab3"] = st.session_state.draft_end_date
                                            st.session_state.workflow_tab = "2. ชำระเงินจอง & การเงิน"
                                            st.rerun()
                                    else:
                                        st.button(f"⚠️ ซ่อมบำรุงอยู่ ({_p})", disabled=True, use_container_width=True, key=f"grid_dis_{_p}")

                                with act_c2:
                                    with st.popover("✏️ แก้ไขข้อมูล", use_container_width=True):
                                        st.markdown(f"<div style='font-weight:700; color:#E85826; font-size:13px; margin-bottom:6px;'>✏️ แก้ไขข้อมูลรถยนต์ ({_p})</div>", unsafe_allow_html=True)
                                        b_opts = ["Toyota", "Honda", "GWM", "BYD", "Mercedes-Benz", "BMW", "Isuzu", "Ford", "Nissan", "Mazda", "MG", "Tesla", "Hyundai", "อื่นๆ"]
                                        c_b = _c.get('brand', 'Toyota')
                                        if c_b not in b_opts: b_opts.append(c_b)
                                        grp_opts = ["รถเก๋ง (Sedan/Hatchback)", "SUV", "รถตู้ (Van)", "รถกระบะ", "รถสปอร์ต/หรูหรา"]
                                        c_grp = _c.get('car_group', grp_opts[0])
                                        if c_grp not in grp_opts: grp_opts.append(c_grp)
                                        fuel_opts = ["เบนซิน", "ดีเซล", "เบนซิน/Hybrid", "ดีเซล/Hybrid", "ไฟฟ้า (EV)"]
                                        c_fuel = _c.get('fuel_type', 'เบนซิน')
                                        if c_fuel not in fuel_opts: fuel_opts.append(c_fuel)
                                        comp_opts = ["Sawasdee Rent A Car", "P.D.P. Co., Ltd.", "Sawasdee Car Rent"]
                                        c_comp = _c.get('company', comp_opts[0])
                                        if c_comp not in comp_opts: comp_opts.append(c_comp)
                                        st_opts = ["ว่างพร้อมใช้งาน", "ซ่อมบำรุง", "เตรียมส่งมอบ", "กำลังเช่า"]
                                        c_st_val = _c.get('status', 'ว่างพร้อมใช้งาน')
                                        if c_st_val not in st_opts: st_opts.append(c_st_val)

                                        with st.form(key=f"form_edit_grid_{_p}", border=False):
                                            e_brand = st.selectbox("ยี่ห้อ (Brand)*", b_opts, index=b_opts.index(c_b), key=f"geb_{_p}")
                                            e_model = st.text_input("รุ่น (Model)*", value=_c.get('model', ''), key=f"gem_{_p}").strip()
                                            e_color = st.text_input("สีตัวถัง (Color)", value=_c.get('color', ''), key=f"gec_{_p}").strip()
                                            e_group = st.selectbox("กลุ่มรถ (Car Group)*", grp_opts, index=grp_opts.index(c_grp), key=f"geg_{_p}")
                                            e_cc = st.text_input("ขนาดเครื่องยนต์ (CC / EV)", value=str(_c.get('engine_cc', '1500')), key=f"gecc_{_p}").strip()
                                            e_fuel = st.selectbox("ระบบเชื้อเพลิง*", fuel_opts, index=fuel_opts.index(c_fuel), key=f"gef_{_p}")
                                            e_comp = st.selectbox("เจ้าของกรรมสิทธิ์*", comp_opts, index=comp_opts.index(c_comp), key=f"gecp_{_p}")
                                            e_vin = st.text_input("เลขตัวถัง (VIN)", value=_c.get('chassis_no', '-'), key=f"gevin_{_p}").strip()
                                            e_mileage = st.text_input("เลขไมล์สะสม (km)", value=str(_c.get('mileage', '0')), key=f"gemil_{_p}").strip()
                                            e_pday = st.number_input("รายวัน", min_value=0, value=int(_c.get('price_day', 0)), step=100, key=f"gepd_{_p}")
                                            e_pweek = st.number_input("รายสัปดาห์", min_value=0, value=int(_c.get('price_week', 0)), step=500, key=f"gepw_{_p}")
                                            e_pmonth = st.number_input("รายเดือน", min_value=0, value=int(_c.get('price_month', 0)), step=1000, key=f"gepm_{_p}")
                                            e_tax = st.date_input("วันหมดอายุภาษี", value=to_date_safe(_c.get('tax_expiry')), format="DD/MM/YYYY", key=f"getax_{_p}")
                                            e_act = st.date_input("วันหมดอายุ พ.ร.บ.", value=to_date_safe(_c.get('act_expiry')), format="DD/MM/YYYY", key=f"geact_{_p}")
                                            e_ins = st.date_input("วันหมดอายุประกันภัย", value=to_date_safe(_c.get('ins_expiry')), format="DD/MM/YYYY", key=f"geins_{_p}")
                                            e_status = st.selectbox("สถานะรถยนต์*", st_opts, index=st_opts.index(c_st_val), key=f"gest_{_p}")
                                            
                                            _is_df = bool(_c.get('is_debt_free', True if not _c.get('installment_amount') else False))
                                            e_debt_free = st.checkbox(translations[st.session_state.language].get("is_debt_free", "รถปลอดภาระ / ซื้อเงินสด"), value=_is_df, key=f"gedf_{_p}")
                                            if not e_debt_free:
                                                e_ia1, e_ia2 = st.columns(2)
                                                with e_ia1:
                                                    e_inst_amt = st.number_input(translations[st.session_state.language].get("installment_amount", "ค่างวดต่อเดือน (THB)"), min_value=0.0, value=float(_c.get('installment_amount', 0.0) or 0.0), step=500.0, key=f"geia_{_p}")
                                                    e_tot_inst = st.number_input(translations[st.session_state.language].get("total_installments", "จำนวนงวดทั้งหมด"), min_value=0, value=int(_c.get('total_installments', 48) or 0), step=1, key=f"geti_{_p}")
                                                with e_ia2:
                                                    e_curr_inst = st.number_input(translations[st.session_state.language].get("current_installment", "งวดปัจจุบัน (ชำระแล้ว)"), min_value=0, value=int(_c.get('current_installment', 0) or 0), step=1, key=f"geci_{_p}")
                                                    e_due_date = st.date_input(translations[st.session_state.language].get("payment_due_date", "วันกำหนดชำระ (ทุกวันที่)"), value=to_date_safe(_c.get('payment_due_date')), format="DD/MM/YYYY", key=f"gedd_{_p}")
                                            else:
                                                e_inst_amt = 0.0
                                                e_tot_inst = 0
                                                e_curr_inst = 0
                                                e_due_date = None

                                            save_edit_sub = st.form_submit_button("💾 บันทึกการแก้ไข", type="primary", use_container_width=True)

                                        if save_edit_sub:
                                            if not e_model:
                                                st.error("⚠️ กรุณาระบุรุ่นรถยนต์")
                                            else:
                                                up_car = dict(_c)
                                                up_car["brand"] = e_brand
                                                up_car["model"] = e_model
                                                up_car["color"] = e_color or "-"
                                                up_car["car_group"] = e_group
                                                up_car["engine_cc"] = str(e_cc)
                                                up_car["fuel_type"] = e_fuel
                                                up_car["company"] = e_comp
                                                up_car["chassis_no"] = e_vin or "-"
                                                up_car["mileage"] = e_mileage or "0"
                                                up_car["price_day"] = int(e_pday)
                                                up_car["price_week"] = int(e_pweek)
                                                up_car["price_month"] = int(e_pmonth)
                                                up_car["tax_expiry"] = format_date_for_db(e_tax, "%d/%m/%Y")
                                                up_car["act_expiry"] = format_date_for_db(e_act, "%d/%m/%Y")
                                                up_car["ins_expiry"] = format_date_for_db(e_ins, "%d/%m/%Y")
                                                up_car["status"] = e_status
                                                up_car["is_debt_free"] = bool(e_debt_free)
                                                up_car["installment_amount"] = float(e_inst_amt) if not e_debt_free else 0.0
                                                up_car["total_installments"] = int(e_tot_inst) if not e_debt_free else 0
                                                up_car["current_installment"] = int(e_curr_inst) if not e_debt_free else 0
                                                up_car["payment_due_date"] = format_date_for_db(e_due_date, "%Y-%m-%d") if not e_debt_free and e_due_date else "-"
                                                
                                                st.session_state.cars_db[_p] = up_car
                                                cars_db[_p] = up_car
                                                if "_GLOBAL_STORE" in globals() and "cars_db" in _GLOBAL_STORE and _GLOBAL_STORE["cars_db"]:
                                                    _GLOBAL_STORE["cars_db"][_p] = up_car
                                                sb_sync_car(_p, up_car)
                                                st.success(f"✅ บันทึกข้อมูลรถยนต์ทะเบียน '{_p}' เรียบร้อยแล้ว!")
                                                time.sleep(0.8)
                                                st.rerun()

            if matched_count == 0:
                st.info("ℹ️ ไม่พบรถยนต์ที่ตรงตามเงื่อนไขตัวกรอง กรุณากดปุ่มด้านล่างเพื่อล้างตัวกรองและแสดงรถทุกคันอีกครั้ง")
                if st.button("🔄 ล้างตัวกรอง (Reset Filters)", key="btn_reset_zero_match", type="primary"):
                    reset_all_fleet_filters()
                    st.rerun()

            # --- SECTION 4: PREMIUM SERVICES & BENEFITS (ตามภาพตัวอย่าง) ---
            st.markdown(
                '<div class="fleet-benefits-wrap">'
                '<div class="fleet-benefits-title">PREMIUM SERVICES & BENEFITS</div>'
                '<div class="fleet-benefits-grid">'
                '<div class="fleet-benefit-item">'
                '<div class="fleet-benefit-icon">👨‍✈️</div>'
                '<div class="fleet-benefit-name">CHAUFFEUR SERVICES</div>'
                '<div class="fleet-benefit-desc">บริการพนักงานขับรถ VIP มืออาชีพ อุ่นใจทุกเส้นทาง</div>'
                '</div>'
                '<div class="fleet-benefit-item">'
                '<div class="fleet-benefit-icon">✈️</div>'
                '<div class="fleet-benefit-name">AIRPORT VIP GREETING</div>'
                '<div class="fleet-benefit-desc">ต้อนรับและส่งมอบรถสนามบิน VIP รวดเร็ว ไร้รอยต่อ</div>'
                '</div>'
                '<div class="fleet-benefit-item">'
                '<div class="fleet-benefit-icon">🛡️</div>'
                '<div class="fleet-benefit-name">FULL INSURANCE</div>'
                '<div class="fleet-benefit-desc">ประกันภัยชั้น 1 ครบวงจร คุ้มครองเต็มรูปแบบ ไร้กังวล</div>'
                '</div>'
                '</div>'
                '</div>',
                unsafe_allow_html=True
            )

            # --- FLOATING ACTION BUTTON (FAB): เครื่องหมาย + ล็อกมุมขวาล่างสำหรับเพิ่มลูกค้าใหม่ ---
            if st.button("＋", key="fab_add_customer", help="➕ ลงทะเบียนลูกค้า (New Customer)"):
                dialog_add_new_customer()

        # --- TAB 2: BOOKING DEPOSIT & PAYMENT (หน้าชำระเงินจอง & การเงิน) ---
        elif current_tab in ["2. ชำระเงินจอง & การเงิน", "3. ชำระเงินจอง & การเงิน", "3. จัดทำสัญญา & ชำระเงิน", "4. รับมัดจำ (ล็อกคิว/ใบเสร็จ)"]:
            curr_u = st.session_state.user or {}
            curr_username = curr_u.get("username", "admin")
            curr_role = curr_u.get("role", "Staff")
            is_admin_user = (curr_role == "Admin" or curr_username.lower() == "admin")

            target_dep_id = st.session_state.get("active_deposit_bk_id") or st.query_params.get("deposit_job")
            target_settle_id = st.session_state.get("active_settle_bk_id") or st.query_params.get("settle_job")
            target_extend_id = st.session_state.get("active_extend_bk_id") or st.query_params.get("extend_job")

            # --- TOP NAVIGATION & BREADCRUMB (ปุ่มย้อนกลับตามโฟลงาน) ---
            b_nav1, b_nav2 = st.columns([1.6, 3.4])
            with b_nav1:
                if st.button("⬅️ ย้อนกลับไปเลือกรถยนต์", key="btn_back_to_tab2_top", use_container_width=True):
                    st.session_state.workflow_tab = "1. เลือกรถยนต์"
                    st.rerun()
            with b_nav2:
                st.markdown("""
                    <div style="background:#F9FAFB; border:1px solid #E5E7EB; border-radius:8px; padding:7px 14px; font-size:12.5px; color:#4B5563; text-align:right;">
                        🚘 1. เลือกรถ ➔ <b style="color:#E85826; background:#FFF7ED; padding:3px 8px; border-radius:6px; border:1px solid #FDBA74;">💳 2. ชำระเงินจอง (ขั้นตอนปัจจุบัน)</b> ➔ 🚚 3. ออกใบงาน ➔ 📝 4. จัดทำสัญญา
                    </div>
                """, unsafe_allow_html=True)

            st.markdown("<div style='height:6px;'></div>", unsafe_allow_html=True)

            with st.container(border=True):
                st.markdown(f"""
                    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:12px;">
                        <div>
                            <h3 style="margin:0; font-size:17px; font-weight:800; color:#1F2937;">
                                <span>💳</span> ระบบจัดการการชำระเงินจอง & การเงิน (Booking Deposit & Financial Operations)
                            </h3>
                            <div style="font-size:12px; color:#6B7280; margin-top:2px;">
                                เลือกลูกค้าและล็อกรถยนต์เพื่อชำระเงินจอง เมื่องานได้รับการชำระเงินแล้ว ระบบจะส่งต่อไปยังหน้าออกใบงานโดยอัตโนมัติ
                            </div>
                        </div>
                        <div>
                            <span style="background:{'#FFF7ED' if is_admin_user else '#EFF6FF'}; border:1px solid {'#FDBA74' if is_admin_user else '#BFDBFE'}; color:{'#C2410C' if is_admin_user else '#1D4ED8'}; padding:4px 12px; border-radius:15px; font-size:11.5px; font-weight:700;">
                                {'👑 สิทธิ์แอดมิน: บันทึกรับเงินได้ทุกงาน' if is_admin_user else f'👷 สิทธิ์พนักงาน: {curr_username} (จัดการได้เฉพาะงานที่คุณดูแล)'}
                            </span>
                        </div>
                    </div>
                """, unsafe_allow_html=True)

                # ดรอปดาวน์เลือกรูปแบบการชำระเงิน
                if target_settle_id:
                    def_mode_idx = 1
                elif target_extend_id:
                    def_mode_idx = 2
                else:
                    def_mode_idx = 0

                payment_mode_options = [
                    "💰 จองรถ & ชำระเงินจอง (Booking & Deposit)",
                    "🧾 ชำระค่าเช่า (Rental Settlement)",
                    "🔄 ต่อสัญญา (Contract Extension)"
                ]
                selected_pay_mode = st.selectbox(
                    "📌 เลือกรูปแบบการทำรายการชำระเงิน:",
                    payment_mode_options,
                    index=def_mode_idx,
                    key="sb_unified_pay_mode"
                )

                st.markdown("<hr style='margin:10px 0 16px; border:0.5px solid #E5E7EB;'>", unsafe_allow_html=True)

                # -----------------------------------------------------------------
                # 1.1 โหมดจองรถ & ชำระเงินจอง (Booking & Deposit ฿5,000)
                # เลือกลูกค้า ลอครถและวันที่มาจากหน้าเลือกรถ หรือเลือกเอง แล้วส่งไปหน้าออกใบงาน
                # -----------------------------------------------------------------
                if selected_pay_mode == "💰 จองรถ & ชำระเงินจอง (Booking & Deposit)":
                    pending_dep_bks = [b for b in st.session_state.bookings_db if not b.get("deposit_paid") and b.get("status") not in ["เสร็จสิ้น", "ยกเลิก"]]
                    pending_dep_bks.sort(key=lambda x: str(x.get("booking_id", "")), reverse=True)

                    # กรณีมีงานที่เลือกมาจากภายนอกหรือมีงานจองเดิมที่ยังไม่ชำระมัดจำ
                    has_target_job = bool(target_dep_id)
                    
                    if has_target_job:
                        # แสดงฟอร์มรับมัดจำสำหรับงานจองเดิมที่เลือก
                        target_bk_list = [b for b in pending_dep_bks if b['booking_id'] == target_dep_id]
                        if not target_bk_list:
                            # อาจเป็นงานที่มีอยู่ใน bookings_db ทั้งหมด
                            target_bk_list = [b for b in st.session_state.bookings_db if b['booking_id'] == target_dep_id]
                        
                        if target_bk_list:
                            sel_bk = target_bk_list[0]
                            net_p = float(sel_bk.get("net_price", 0))
                            default_dep = 5000.0
                            can_manage_dep = is_job_owner_or_admin(sel_bk, curr_username, is_admin_user)

                            st.markdown(f"""
                                <div style='background: #FFF7ED; padding: 14px 18px; border-radius: 8px; border: 1.5px solid #FDBA74; margin: 10px 0;'>
                                    <div style="display:flex; justify-content:space-between; flex-wrap:wrap; gap:10px;">
                                        <div>
                                            <b style="color:#9A3412; font-size:14px;">รหัสการจอง: {sel_bk['booking_id']}</b> | ทะเบียน: <b>{sel_bk['car_id']}</b> | ลูกค้า: <b>{sel_bk['customer']}</b><br/>
                                            <span style="font-size:12px; color:#C2410C;">ระยะเวลาเช่า: {format_date_dmy(sel_bk['start_date'])} ถึง {format_date_dmy(sel_bk['end_date'])}</span>
                                        </div>
                                        <div style="text-align:right;">
                                            <span style="font-size:11px; color:#9A3412;">ยอดรวมค่าเช่าสุทธิ:</span><br/>
                                            <b style="font-size:18px; color:#EA580C;">฿{net_p:,.2f}</b>
                                        </div>
                                    </div>
                                </div>
                            """, unsafe_allow_html=True)

                            if not can_manage_dep:
                                sel_owner = sel_bk.get("created_by", "admin")
                                st.warning(f"🔒 รายการนี้เป็นของพนักงาน **{sel_owner}** (เฉพาะเจ้าของงานหรือ Admin เท่านั้นที่สามารถกดบันทึกรับเงินได้)")

                            with st.form(f"deposit_form_merged_{sel_bk['booking_id']}"):
                                c_d1, c_d2 = st.columns(2)
                                with c_d1:
                                    dep_amount = st.number_input("💵 เงินมัดจำประกันสัญญาตอนจอง (บาท) [ค่าเริ่มต้น 5,000 บ.]:", value=default_dep, min_value=1.0, max_value=max(100000.0, net_p * 2), step=500.0, key=f"inp_dep_{sel_bk['booking_id']}", disabled=(not can_manage_dep))
                                with c_d2:
                                    payment_methods = ["เงินสด", "โอนเงิน / สแกน QR", "บัตรเครดิต", "PayPal"]
                                    dep_channel = st.selectbox("ช่องทางการชำระเงิน:", payment_methods, key=f"sel_ch_{sel_bk['booking_id']}", disabled=(not can_manage_dep))

                                also_pay_rental = st.checkbox(f"🧾 รับชำระค่าเช่ารถเต็มจำนวนพร้อมกันทันที ฿{net_p:,.2f} (เพื่อออกใบเสร็จรับเงินทันที)", value=False, key=f"chk_pay_rent_{sel_bk['booking_id']}", disabled=(not can_manage_dep))

                                if also_pay_rental:
                                    st.info(f"💡 ลูกค้าชำระรวม: มัดจำประกัน ฿{dep_amount:,.2f} + ค่าเช่ารถ ฿{net_p:,.2f} = **ยอดชำระรวม ฿{dep_amount + net_p:,.2f}** (สัญญาเช่าและใบเสร็จรับเงินจะออกพร้อมกันทันที)")
                                else:
                                    st.caption(f"💡 สรุปการชำระ: เงินมัดจำประกันสัญญาตอนจอง **฿{dep_amount:,.2f}** (ล็อกคิวรถและไปออกใบงาน) ➔ **วันรับรถ:** ชำระค่าเช่ารถตามสัญญา <b style='color:#E85826;'>฿{net_p:,.2f}</b> เพื่อออกใบเสร็จรับเงิน", unsafe_allow_html=True)

                                btn_dep_label = "💳 ยืนยันชำระมัดจำ & ค่าเช่า (ไปออกใบงาน ➔)" if also_pay_rental else "💳 ยืนยันรับมัดจำ ฿5,000 & ล็อกคิวรถ (ไปออกใบงาน ➔)"
                                if st.form_submit_button(btn_dep_label, use_container_width=True, type="primary", disabled=(not can_manage_dep)):
                                    for b in st.session_state.bookings_db:
                                        if b['booking_id'] == sel_bk['booking_id']:
                                            b['deposit_paid'] = True
                                            b['deposit_amount'] = dep_amount
                                            b['deposit_date'] = datetime.now().date()
                                            b['deposit_method'] = dep_channel
                                            b['created_by'] = b.get('created_by') or curr_username

                                            if also_pay_rental:
                                                b['rental_paid'] = True
                                                b['remaining_rental'] = 0.0
                                                b['remaining_amount'] = 0.0
                                                b['is_fully_paid'] = True
                                                b['rental_payment_date'] = datetime.now().date()
                                                b['rental_payment_method'] = dep_channel
                                                b['final_payment_method'] = dep_channel
                                            else:
                                                b['rental_paid'] = False
                                                b['remaining_rental'] = net_p
                                                b['remaining_amount'] = net_p
                                                b['is_fully_paid'] = False

                                            if b['status'] == "รอชำระมัดจำ":
                                                b['status'] = "รอส่งมอบ"
                                            cars_db[sel_bk['car_id']]['status'] = "ติดจอง"
                                            break

                                    _GLOBAL_STORE["bookings_db"] = st.session_state.bookings_db
                                    sb_sync_booking(sel_bk)
                                    sb_sync_car(sel_bk['car_id'], cars_db[sel_bk['car_id']])

                                    # บันทึกรายรับมัดจำ
                                    f_dep_rec = {
                                        "company": cars_db[sel_bk['car_id']].get('company', 'Sawasdee Rent A Car'),
                                        "type": "รายรับ", "category": "เงินมัดจำประกันสัญญา (จองรถ)", "amount": float(dep_amount),
                                        "ref": sel_bk['booking_id'], "date": datetime.now().strftime("%Y-%m-%d"),
                                        "detail": f"รับเงินมัดจำประกันสัญญาตอนจองรถ ({dep_channel})"
                                    }
                                    st.session_state.financial_db.append(f_dep_rec)
                                    sb_sync_financial(f_dep_rec)

                                    if also_pay_rental:
                                        f_rent_rec = {
                                            "company": cars_db[sel_bk['car_id']].get('company', 'Sawasdee Rent A Car'),
                                            "type": "รายรับ", "category": "ค่าเช่ารถ (วันรับรถ)", "amount": float(net_p),
                                            "ref": sel_bk['booking_id'], "date": datetime.now().strftime("%Y-%m-%d"),
                                            "detail": f"รับชำระค่าเช่ารถเต็มจำนวนพร้อมมัดจำ ({dep_channel})"
                                        }
                                        st.session_state.financial_db.append(f_rent_rec)
                                        sb_sync_financial(f_rent_rec)

                                    _GLOBAL_STORE["financial_db"] = st.session_state.financial_db

                                    st.session_state.active_deposit_bk_id = None
                                    st.session_state.payment_focus = False
                                    if "deposit_job" in st.query_params:
                                        del st.query_params["deposit_job"]

                                    # ส่งต่อไปยังหน้าออกใบงานทันทีตามโฟลงานที่กำหนด
                                    st.session_state.active_assign_bk_id = sel_bk['booking_id']
                                    st.session_state.workflow_tab = "3. ใบงานส่ง/รับรถ"
                                    st.success(f"🎉 บันทึกรับมัดจำ ฿{dep_amount:,.2f} เรียบร้อย! ระบบกำลังนำท่านไปยังหน้าออกใบงาน...")
                                    time.sleep(0.8)
                                    st.rerun()

                            if st.button("❌ ปิดงานนี้เพื่อจองรถคันใหม่", key="btn_cancel_target_dep_merged"):
                                st.session_state.active_deposit_bk_id = None
                                st.session_state.payment_focus = False
                                if "deposit_job" in st.query_params:
                                    del st.query_params["deposit_job"]
                                st.rerun()

                    # ฟอร์มจองรถใหม่และชำระเงินจอง (Default Booking Form)
                    if not has_target_job:
                        # เลือกรถยนต์ (default ล็อกจาก Tab 2 แต่สามารถเลือกเองได้)
                        if not st.session_state.get("draft_car") or st.session_state.draft_car not in cars_db:
                            st.session_state.draft_car = list(cars_db.keys())[0] if cars_db else None

                        car_keys = list(cars_db.keys())
                        c_idx = car_keys.index(st.session_state.draft_car) if st.session_state.draft_car in car_keys else 0

                        st.markdown("<div style='font-size:15px; font-weight:700; color:#1F2937; margin-bottom:10px;'>📝 แบบฟอร์มจองรถยนต์และชำระเงินมัดจำ (New Booking & Deposit)</div>", unsafe_allow_html=True)
                        
                        # ส่วนที่ 1: เลือกลูกค้า (ดึงจากฐานข้อมูลลูกค้า)
                        cust_list = list(st.session_state.customers_db.keys())
                        if not cust_list:
                            def_cust = {
                                "full_name": "ลูกค้าทั่วไป (Walk-in)", "nationality": "THAI",
                                "dob": "01/01/1990", "passport_id": "-", "licence_no": "-", "issue_place": "-",
                                "licence_expiry": "01/01/2030", "home_address": "-", "thai_address": "-",
                                "contact_no": "-", "whatsapp": "-", "email": "-"
                            }
                            st.session_state.customers_db["ลูกค้าทั่วไป (Walk-in)"] = def_cust
                            _GLOBAL_STORE["customers_db"] = st.session_state.customers_db
                            sb_sync_customer("ลูกค้าทั่วไป (Walk-in)", def_cust)
                            cust_list = list(st.session_state.customers_db.keys())

                        curr_chosen_cust = st.session_state.get("selected_customer_name")
                        if curr_chosen_cust not in cust_list:
                            curr_chosen_cust = cust_list[0]
                            st.session_state.selected_customer_name = curr_chosen_cust

                        def_cust_idx = cust_list.index(curr_chosen_cust)

                        st.markdown("""
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                                <span style="font-size:14px; font-weight:700; color:#1F2937;">👤 1. เลือกชื่อลูกค้า (Customer Name)*:</span>
                            </div>
                        """, unsafe_allow_html=True)

                        c_c_sel, c_c_edit = st.columns([3.8, 1.2])
                        with c_c_sel:
                            cust = st.selectbox(
                                "เลือกลูกค้า:",
                                cust_list,
                                index=def_cust_idx,
                                key="sb_cust_tab3_deposit",
                                label_visibility="collapsed"
                            )
                            if cust != st.session_state.get("selected_customer_name"):
                                st.session_state.selected_customer_name = cust
                                st.rerun()

                        is_editing = st.session_state.get("show_edit_customer", False)
                        with c_c_edit:
                            btn_edit_label = "❌ ปิดการทบทวน" if is_editing else "✏️ ทบทวน & แก้ไข"
                            if st.button(btn_edit_label, use_container_width=True, key="btn_edit_c_tab3_dep"):
                                st.session_state.show_edit_customer = not is_editing
                                st.rerun()

                        # ฟอร์มทบทวนและแก้ไขข้อมูลลูกค้า
                        if st.session_state.get("show_edit_customer"):
                            cur_cust_data = st.session_state.customers_db.get(cust, {})
                            with st.container(border=True):
                                st.markdown(f"""
                                    <div style="background: linear-gradient(135deg, #FFFBEB 0%, #FEF3C7 100%); border: 1.5px solid #FCD34D; border-radius: 10px; padding: 12px 18px; margin-bottom: 14px;">
                                        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                                            <div>
                                                <h4 style="margin:0; font-size:15px; font-weight:800; color:#92400E; display:flex; align-items:center; gap:8px;">
                                                    <span>✏️</span> ทบทวนและแก้ไขข้อมูลลูกค้า: <span style="color:#B45309;">{cust}</span>
                                                </h4>
                                                <div style="font-size:12px; color:#B45309; margin-top:2px;">
                                                    ตรวจสอบข้อมูลลูกค้าก่อนออกสัญญา หากมีการเปลี่ยนแปลงสามารถแก้ไขและกดบันทึกเพื่ออัปเดตฐานข้อมูลได้ทันที
                                                </div>
                                            </div>
                                            <div>
                                                <span style="background:#F59E0B; color:white; padding:4px 12px; border-radius:15px; font-size:11px; font-weight:700;">
                                                    🗂️ ฐานข้อมูลลูกค้า
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                """, unsafe_allow_html=True)

                                with st.form(f"form_edit_customer_dep_{cust}"):
                                    ce1, ce2, ce3 = st.columns(3)
                                    with ce1:
                                        st.markdown("<b style='color:#92400E; font-size:13px;'>1. ข้อมูลส่วนบุคคล</b>", unsafe_allow_html=True)
                                        ed_name = st.text_input("ชื่อ-นามสกุล*", value=cur_cust_data.get("full_name") or cust)
                                        init_dob = to_date_safe(cur_cust_data.get("dob"))
                                        ed_dob = st.date_input("วันเกิด (DOB)", value=init_dob, min_value=date(1920, 1, 1), max_value=date.today(), format="DD/MM/YYYY")
                                        ed_pass = st.text_input("หมายเลข Passport / บัตร ปชช.", value=cur_cust_data.get("passport_id", ""))
                                        ed_home = st.text_area("ที่อยู่ตามภูมิลำเนา (Home Address)", value=cur_cust_data.get("home_address", ""), height=70)
                                    with ce2:
                                        st.markdown("<b style='color:#92400E; font-size:13px;'>2. ใบขับขี่ & สัญชาติ</b>", unsafe_allow_html=True)
                                        ed_nat = st.text_input("สัญชาติ (Nationality)", value=cur_cust_data.get("nationality", "THAI"))
                                        ed_lic = st.text_input("หมายเลขใบขับขี่ (Licence No.)", value=cur_cust_data.get("licence_no", ""))
                                        ed_issue = st.text_input("สถานที่ออกใบขับขี่ (Place of Issue)", value=cur_cust_data.get("issue_place", ""))
                                        init_exp = to_date_safe(cur_cust_data.get("licence_expiry"))
                                        ed_exp = st.date_input("วันหมดอายุใบขับขี่", value=init_exp, min_value=date.today() - timedelta(days=3650), format="DD/MM/YYYY")
                                    with ce3:
                                        st.markdown("<b style='color:#92400E; font-size:13px;'>3. การติดต่อ & ที่อยู่ในไทย</b>", unsafe_allow_html=True)
                                        ed_phone = st.text_input("เบอร์โทรศัพท์ (Contact No.)", value=cur_cust_data.get("contact_no", ""))
                                        ed_wa = st.text_input("WhatsApp", value=cur_cust_data.get("whatsapp", ""))
                                        ed_email = st.text_input("อีเมล (Email)", value=cur_cust_data.get("email", ""))
                                        ed_thai = st.text_area("ที่อยู่ในไทย (Address in Thailand)", value=cur_cust_data.get("thai_address", ""), height=70)

                                    c_f_btn1, c_f_btn2 = st.columns([2.5, 1.2])
                                    with c_f_btn1:
                                        btn_save_ed = st.form_submit_button("💾 บันทึกการแก้ไขข้อมูลลูกค้า (Save Changes to Database)", type="primary", use_container_width=True)
                                    with c_f_btn2:
                                        btn_del_prompt = st.form_submit_button("🗑️ ลบข้อมูล (Delete)", use_container_width=True)

                                    if btn_save_ed:
                                        new_n = ed_name.strip()
                                        if not new_n:
                                            st.error("กรุณาระบุชื่อ-นามสกุล")
                                        else:
                                            updated_obj = {
                                                "full_name": new_n,
                                                "nationality": ed_nat.strip(),
                                                "dob": format_date_for_db(ed_dob, "%d/%m/%Y"),
                                                "passport_id": ed_pass.strip(),
                                                "licence_no": ed_lic.strip(),
                                                "issue_place": ed_issue.strip(),
                                                "licence_expiry": format_date_for_db(ed_exp, "%d/%m/%Y"),
                                                "home_address": ed_home.strip(),
                                                "thai_address": ed_thai.strip(),
                                                "contact_no": ed_phone.strip(),
                                                "whatsapp": ed_wa.strip(),
                                                "email": ed_email.strip()
                                            }
                                            if new_n != cust:
                                                del st.session_state.customers_db[cust]
                                                for b in st.session_state.bookings_db:
                                                    if b.get("customer") == cust:
                                                        b["customer"] = new_n
                                                _GLOBAL_STORE["bookings_db"] = st.session_state.bookings_db
                                                st.session_state.selected_customer_name = new_n
                                            
                                            st.session_state.customers_db[new_n] = updated_obj
                                            _GLOBAL_STORE["customers_db"] = st.session_state.customers_db
                                            sb_sync_customer(new_n, updated_obj)
                                            st.session_state.show_edit_customer = False
                                            st.success(f"🎉 บันทึกการแก้ไขข้อมูลลูกค้า '{new_n}' ในฐานข้อมูลเรียบร้อยแล้ว!")
                                            time.sleep(0.8)
                                            st.rerun()

                                    if btn_del_prompt:
                                        st.session_state[f"confirm_del_cust_{cust}"] = True
                                        st.rerun()

                            if st.session_state.get(f"confirm_del_cust_{cust}"):
                                st.markdown(f"""
                                    <div style="background:#FEF2F2; border:1.5px solid #F87171; border-radius:8px; padding:12px 16px; margin: 12px 0;">
                                        <b style="color:#991B1B; font-size:14px;">⚠️ ยืนยันการลบข้อมูลลูกค้า: {cust} ?</b>
                                        <div style="color:#B91C1C; font-size:12px; margin-top:2px;">
                                            ข้อมูลลูกค้าจะถูกลบออกจากฐานข้อมูลอย่างถาวร
                                        </div>
                                    </div>
                                """, unsafe_allow_html=True)
                                c_del_yes, c_del_no = st.columns([1.5, 1])
                                with c_del_yes:
                                    if st.button(f"🗑️ ยืนยันลบลูกค้า '{cust}' ถาวร", type="primary", use_container_width=True, key=f"btn_confirm_del_cust_dep_{cust}"):
                                        del st.session_state.customers_db[cust]
                                        _GLOBAL_STORE["customers_db"] = st.session_state.customers_db
                                        st.session_state[f"confirm_del_cust_{cust}"] = False
                                        st.session_state.show_edit_customer = False
                                        rem_cust_keys = list(st.session_state.customers_db.keys())
                                        st.session_state.selected_customer_name = rem_cust_keys[0] if rem_cust_keys else None
                                        st.success(f"🎉 ลบข้อมูลลูกค้า '{cust}' ออกจากฐานข้อมูลเรียบร้อยแล้ว!")
                                        time.sleep(0.8)
                                        st.rerun()
                                with c_del_no:
                                    if st.button("❌ ยกเลิกการลบ", use_container_width=True, key=f"btn_cancel_del_cust_dep_{cust}"):
                                        st.session_state[f"confirm_del_cust_{cust}"] = False
                                        st.rerun()
                        else:
                            cur_c_data = st.session_state.customers_db.get(cust, {})
                            st.markdown(f"""
                                <div style="background:#F9FAFB; border:1px solid #E5E7EB; border-radius:8px; padding:7px 14px; margin-bottom:12px; font-size:12px; color:#4B5563; display:flex; justify-content:space-between; flex-wrap:wrap; gap:8px;">
                                    <span>🪪 <b>Passport/ID:</b> {cur_c_data.get('passport_id') or '-'}</span>
                                    <span>📞 <b>เบอร์โทร:</b> {cur_c_data.get('contact_no') or '-'}</span>
                                    <span>🚗 <b>ใบขับขี่:</b> {cur_c_data.get('licence_no') or '-'} (หมดอายุ {cur_c_data.get('licence_expiry') or '-'})</span>
                                    <span>🌍 <b>สัญชาติ:</b> {cur_c_data.get('nationality') or '-'}</span>
                                </div>
                            """, unsafe_allow_html=True)

                        st.markdown("<hr style='margin:10px 0 14px; border:0.5px solid #F3EDE4;'>", unsafe_allow_html=True)

                        # ส่วนที่ 2: เลือกรถยนต์ (ลอคมาจากหน้าเลือกรถ หรือเลือกเอง)
                        st.markdown("""
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                                <span style="font-size:14px; font-weight:700; color:#1F2937;">🚘 2. เลือกรถยนต์ (ล็อกคันที่เลือก หรือเปลี่ยนได้)*:</span>
                            </div>
                        """, unsafe_allow_html=True)
                        
                        chg_plate = st.selectbox(
                            "เลือกรถยนต์:",
                            car_keys,
                            index=c_idx,
                            key="sb_change_draft_car_dep",
                            label_visibility="collapsed",
                            format_func=lambda p: f"🚗 ทะเบียน: {p} — {cars_db.get(p, {}).get('brand', '')} {cars_db.get(p, {}).get('model', '')} ({cars_db.get(p, {}).get('color','-')}) | ฿{cars_db.get(p, {}).get('price_day', 0):,}/วัน" if p in cars_db else str(p)
                        )
                        if chg_plate != st.session_state.draft_car:
                            st.session_state.draft_car = chg_plate
                            st.rerun()

                        sel_car = cars_db.get(st.session_state.draft_car) or {"brand": "-", "model": "-", "price_day": 0, "price_week": 0, "price_month": 0, "plate": "-"}
                        st.markdown(f"""
                            <div style="background:#EFF6FF; border:1px solid #BFDBFE; border-radius:8px; padding:8px 14px; margin-bottom:14px; font-size:12.5px; color:#1E40AF; display:flex; justify-content:space-between; flex-wrap:wrap; gap:8px;">
                                <span>🚘 <b>รุ่น:</b> {sel_car['brand']} {sel_car['model']}</span>
                                <span>🎨 <b>สี:</b> {sel_car.get('color','-')}</span>
                                <span>🏢 <b>กรรมสิทธิ์:</b> {sel_car.get('company','Sawasdee Rent A Car')}</span>
                                <span>💰 <b>อัตราเช่า:</b> ฿{sel_car.get('price_day',0):,}/วัน | ฿{sel_car.get('price_week',0):,}/สัปดาห์ | ฿{sel_car.get('price_month',0):,}/เดือน</span>
                            </div>
                        """, unsafe_allow_html=True)

                        # ส่วนที่ 3: กำหนดวันเวลาส่ง/รับรถ & คำนวณราคาค่าเช่า
                        st.markdown("<span style='font-size:14px; font-weight:700; color:#1F2937;'>📅 3. กำหนดวันและเวลาเช่ารถ (Rental Dates & Time)*:</span>", unsafe_allow_html=True)
                        col1, col2 = st.columns(2)
                        with col1:
                            c_dt1, c_dt2 = st.columns(2)
                            with c_dt1:
                                init_start = st.session_state.get("draft_start_date") or datetime.now().date()
                                if "c_start_date_tab3" not in st.session_state or st.session_state.get("_last_synced_draft_start") != st.session_state.get("draft_start_date"):
                                    st.session_state["c_start_date_tab3"] = init_start
                                    st.session_state["_last_synced_draft_start"] = st.session_state.get("draft_start_date")
                                start_d = st.date_input("วันที่เริ่มเช่า (ส่งรถ)", key="c_start_date_tab3", format="DD/MM/YYYY")
                                st.session_state.draft_start_date = start_d
                                start_t = st.time_input("เวลาส่งรถ", d_time(10, 0), key="c_start_time_tab3", help="เวลาส่งมอบรถเริ่มต้นรอบคิดค่าเช่า 24 ชม.")
                            with c_dt2:
                                init_end = st.session_state.get("draft_end_date") or (start_d + timedelta(days=3))
                                if "c_end_date_tab3" not in st.session_state or st.session_state.get("_last_synced_draft_end") != st.session_state.get("draft_end_date"):
                                    st.session_state["c_end_date_tab3"] = init_end
                                    st.session_state["_last_synced_draft_end"] = st.session_state.get("draft_end_date")
                                end_d = st.date_input("วันที่คืนรถ (รับรถคืน)", key="c_end_date_tab3", format="DD/MM/YYYY")
                                st.session_state.draft_end_date = end_d
                                end_t = st.time_input("เวลารับรถคืน", d_time(10, 0), key="c_end_time_tab3", help="เวลาคืนรถ หากเกินเวลาส่งรถเกิน 4 ชม. จะปรับคิดเพิ่มเป็น 1 วัน")
                            
                            # คำนวณเวลาและวันเช่าตามเงื่อนไขหากล่าช้าเกิน 4 ชม. ปรับเป็น 1 วัน
                            diff_days, extra_hrs, extra_mins, is_late_4hr, duration_desc = calculate_rental_duration_and_days(
                                start_d, start_t, end_d, end_t
                            )
                            
                            if is_late_4hr:
                                st.markdown(f"""
                                    <div style="background:#FFF1F2; border:1.5px solid #FDA4AF; border-radius:8px; padding:10px 14px; margin-top:8px;">
                                        <div style="font-weight:700; color:#BE123C; font-size:13px; display:flex; align-items:center; gap:6px;">
                                            <span>⚠️</span> เวลาคืนรถล่าช้าเกิน 4 ชั่วโมง ({extra_hrs} ชม. {extra_mins} นาที)
                                        </div>
                                        <div style="font-size:12px; color:#9F1239; margin-top:3px;">
                                            ตามเงื่อนไข: เกินกำหนด 4 ชั่วโมง <b>ระบบปรับคิดค่าเช่าเพิ่ม 1 วันเต็ม</b> ➔ คิดรวม <b>{diff_days} วัน</b>
                                        </div>
                                    </div>
                                """, unsafe_allow_html=True)
                            elif extra_hrs > 0 or extra_mins > 0:
                                st.markdown(f"""
                                    <div style="background:#F0FDF4; border:1px solid #BBF7D0; border-radius:8px; padding:8px 12px; margin-top:8px;">
                                        <div style="font-weight:700; color:#15803D; font-size:12.5px;">
                                            ⏱️ คืนรถเกินเวลา {extra_hrs} ชม. {extra_mins} นาที (อยู่ในเกณฑ์อนุโลม ไม่เกิน 4 ชม. ไม่คิดวันเพิ่ม)
                                        </div>
                                        <div style="font-size:11.5px; color:#166534; margin-top:2px;">
                                            คิดตามจำนวนวันปกติ: <b>{diff_days} วัน</b>
                                        </div>
                                    </div>
                                """, unsafe_allow_html=True)
                            else:
                                st.markdown(f"""
                                    <div style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:8px; padding:8px 12px; margin-top:8px;">
                                        <div style="font-weight:600; color:#334155; font-size:12.5px;">
                                            ⏱️ เวลาส่งมอบและรับคืนตรงเวลาพอดี ({diff_days} วันเต็ม)
                                        </div>
                                    </div>
                                """, unsafe_allow_html=True)

                        with col2:
                            if diff_days >= 30:
                                rate_type = "รายเดือน"
                                rate_price = sel_car['price_month']
                                calc_amount = (diff_days // 30) * rate_price + (diff_days % 30) * sel_car['price_day']
                            elif diff_days >= 7:
                                rate_type = "รายสัปดาห์"
                                rate_price = sel_car['price_week']
                                calc_amount = (diff_days // 7) * rate_price + (diff_days % 7) * sel_car['price_day']
                            else:
                                rate_type = "รายวัน"
                                rate_price = sel_car['price_day']
                                calc_amount = diff_days * rate_price
                                
                            discount = st.number_input("ส่วนลดพิเศษ (บาท)", value=0, min_value=0, key="inp_discount_dep")
                            net_price = max(0, calc_amount - discount)
                            
                            info_str = (
                                f"📌 ระบบคำนวณเรทอัตโนมัติ: **{rate_type}** ({diff_days} วัน)  \n"
                                f"• กำหนดส่งมอบ: {format_date_dmy(start_d)} {start_t.strftime('%H:%M')}  \n"
                                f"• กำหนดรับคืน: {format_date_dmy(end_d)} {end_t.strftime('%H:%M')}  \n"
                                f"• ราคาฐาน: ฿{calc_amount:,}"
                            )
                            st.info(info_str)
                            st.markdown(f"<h4 style='color:#E85826; margin-top:10px;'>ยอดรวมค่าเช่าสุทธิ: ฿{net_price:,}</h4>", unsafe_allow_html=True)

                        # ส่วนที่ 4: ชำระเงินมัดจำตอนจองรถ (Booking Deposit Payment)
                        st.markdown("<hr style='margin:12px 0 14px; border:0.5px solid #F3EDE4;'>", unsafe_allow_html=True)
                        st.markdown("<span style='font-size:14px; font-weight:700; color:#1F2937;'>💵 4. บันทึกรับชำระเงินมัดจำตอนจอง (Deposit Payment)*:</span>", unsafe_allow_html=True)
                        
                        cdep_c1, cdep_c2 = st.columns(2)
                        with cdep_c1:
                            dep_amount_input = st.number_input("💵 ยอดเงินมัดจำจองรถ (บาท) [ค่าเริ่มต้น 5,000 บ.]:", value=5000.0, min_value=1.0, step=500.0, key="inp_new_booking_dep_amount")
                        with cdep_c2:
                            payment_methods_list = ["เงินสด", "โอนเงิน / สแกน QR", "บัตรเครดิต", "PayPal"]
                            dep_method_input = st.selectbox("ช่องทางการชำระเงินมัดจำ:", payment_methods_list, key="sb_new_booking_dep_method")

                        also_pay_rental_new = st.checkbox(f"🧾 รับชำระค่าเช่ารถเต็มจำนวนพร้อมกันทันที ฿{net_price:,.2f} (เพื่อออกใบเสร็จค่าเช่าทันที)", value=False, key="chk_also_pay_rent_new")
                        
                        memo_dep_input = st.text_input("หมายเหตุ / บันทึกการชำระเงินจอง:", value=f"เงินมัดจำประกันสัญญาตอนจองรถ ({sel_car['plate']})", key="txt_memo_new_dep")

                        st.markdown("<div style='height: 10px;'></div>", unsafe_allow_html=True)

                        # ปุ่มยืนยันการจองและชำระเงินจอง -> ไปหน้าออกใบงาน
                        btn_confirm_label = f"💾 ยืนยันการจองและบันทึกสัญญา (Confirm & Save Agreement) ฿{dep_amount_input:,.2f}"
                        if st.button(btn_confirm_label, use_container_width=True, type="primary", key="btn_confirm_booking_and_deposit"):
                            conflict = False
                            for b in st.session_state.bookings_db:
                                if b["car_id"] == sel_car['plate'] and b['status'] not in ["เสร็จสิ้น", "ยกเลิก"]:
                                    b_s = to_date(b.get("start_date"))
                                    b_e = to_date(b.get("end_date"))
                                    if b_s and b_e and not (end_d < b_s or start_d > b_e):
                                        conflict = True
                                        break
                                        
                            if conflict:
                                st.error(f"❌ ระบบปฏิเสธการทำสัญญา: ช่วงวันที่ {format_date_dmy(start_d)} ถึง {format_date_dmy(end_d)} มีการจอง/เช่ารถคันนี้ไว้แล้ว กรุณาเลือกช่วงวันอื่น")
                            elif datetime.combine(end_d, end_t) <= datetime.combine(start_d, start_t):
                                st.error("วันและเวลาคืนรถต้องอยู่หลังวันและเวลาส่งมอบรถ")
                            else:
                                new_bk_id = f"MRC{datetime.now().strftime('%y%m%d%H%M%S')}"
                                curr_u_creator = st.session_state.user or {}
                                curr_uname_cr = curr_u_creator.get("username", "admin")
                                
                                new_bk_obj = {
                                    "booking_id": new_bk_id,
                                    "car_id": sel_car['plate'],
                                    "customer": cust,
                                    "start_date": start_d,
                                    "start_time": start_t.strftime("%H:%M"),
                                    "end_date": end_d,
                                    "end_time": end_t.strftime("%H:%M"),
                                    "contract_type": rate_type,
                                    "billable_days": diff_days,
                                    "base_price": calc_amount,
                                    "discount": discount,
                                    "net_price": net_price,
                                    "deposit_paid": True,
                                    "deposit_amount": float(dep_amount_input),
                                    "deposit_date": datetime.now().date(),
                                    "deposit_method": dep_method_input,
                                    "rental_paid": also_pay_rental_new,
                                    "remaining_rental": 0.0 if also_pay_rental_new else float(net_price),
                                    "remaining_amount": 0.0 if also_pay_rental_new else float(net_price),
                                    "is_fully_paid": also_pay_rental_new,
                                    "rental_payment_date": datetime.now().date() if also_pay_rental_new else None,
                                    "rental_payment_method": dep_method_input if also_pay_rental_new else None,
                                    "final_payment_method": dep_method_input if also_pay_rental_new else None,
                                    "extension_history": [],
                                    "created_by": curr_uname_cr,
                                    "status": "รอส่งมอบ",
                                    "worker_delivery": "Wait",
                                    "worker_return": "Wait",
                                    "loc_delivery": "-",
                                    "loc_return": "-",
                                    "dispatch_closed": False,
                                    "return_closed": False
                                }
                                
                                st.session_state.bookings_db.append(new_bk_obj)
                                _GLOBAL_STORE["bookings_db"] = st.session_state.bookings_db
                                
                                if sel_car['plate'] in cars_db:
                                    cars_db[sel_car['plate']]['status'] = "ติดจอง"
                                    _GLOBAL_STORE["cars_db"] = st.session_state.cars_db
                                    sb_sync_car(sel_car['plate'], cars_db[sel_car['plate']])
                                
                                sb_sync_booking(new_bk_obj)
                                
                                # บันทึกรายรับเงินมัดจำลงฐานข้อมูลการเงิน
                                f_dep_rec = {
                                    "company": sel_car.get('company', 'Sawasdee Rent A Car'),
                                    "type": "รายรับ",
                                    "category": "เงินมัดจำประกันสัญญา (จองรถ)",
                                    "amount": float(dep_amount_input),
                                    "ref": new_bk_id,
                                    "date": datetime.now().strftime("%Y-%m-%d"),
                                    "detail": f"รับเงินมัดจำประกันสัญญาตอนจองรถ ({dep_method_input}) - {memo_dep_input}"
                                }
                                st.session_state.financial_db.append(f_dep_rec)
                                sb_sync_financial(f_dep_rec)
                                
                                if also_pay_rental_new:
                                    f_rent_rec = {
                                        "company": sel_car.get('company', 'Sawasdee Rent A Car'),
                                        "type": "รายรับ",
                                        "category": "ค่าเช่ารถ (วันรับรถ)",
                                        "amount": float(net_price),
                                        "ref": new_bk_id,
                                        "date": datetime.now().strftime("%Y-%m-%d"),
                                        "detail": f"รับชำระค่าเช่ารถเต็มจำนวนพร้อมมัดจำ ({dep_method_input})"
                                    }
                                    st.session_state.financial_db.append(f_rent_rec)
                                    sb_sync_financial(f_rent_rec)

                                _GLOBAL_STORE["financial_db"] = st.session_state.financial_db

                                # ล้างสถานะแบบร่าง
                                st.session_state.draft_car = None
                                st.session_state.draft_start_date = None
                                st.session_state.draft_end_date = None
                                st.session_state._last_synced_draft_start = None
                                st.session_state._last_synced_draft_end = None
                                st.session_state.pop("c_start_date_tab3", None)
                                st.session_state.pop("c_end_date_tab3", None)
                                st.session_state.active_deposit_bk_id = None
                                st.session_state.payment_focus = False
                                
                                # ส่งต่อไปยังหน้าออกใบงานทันทีตามข้อกำหนด
                                st.session_state.active_assign_bk_id = new_bk_id
                                st.session_state.workflow_tab = "3. ใบงานส่ง/รับรถ"
                                
                                st.success(f"🎉 บันทึกการจองและชำระเงินมัดจำรหัส {new_bk_id} สำเร็จ! ระบบกำลังนำท่านไปยังหน้าออกใบงาน...")
                                time.sleep(1)
                                st.rerun()

                        # ทางเลือก: เลือกชำระเงินจองสำหรับรายการจองเดิมที่ค้างอยู่ถ้ามี
                        if pending_dep_bks:
                            with st.expander(f"📋 หรือเลือกชำระเงินจองสำหรับงานจองเดิมในระบบที่ยังไม่ได้ชำระมัดจำ ({len(pending_dep_bks)} รายการ)", expanded=False):
                                bk_dep_options_sub = {
                                    f"📌 [เลขการจอง: {b['booking_id']}] {b['customer']} — ทะเบียน: {b['car_id']} (ยอดสุทธิ ฿{float(b.get('net_price', 0)):,.2f})": b 
                                    for b in pending_dep_bks
                                }
                                sel_sub_k = st.selectbox("เลือกงานจองที่ต้องการชำระเงินจอง:", list(bk_dep_options_sub.keys()), key="sb_sub_pending_dep_pick")
                                if st.button("💳 เปิดหน้ารับชำระมัดจำสำหรับงานนี้", key="btn_open_dep_for_picked"):
                                    st.session_state.active_deposit_bk_id = bk_dep_options_sub[sel_sub_k]['booking_id']
                                    st.rerun()

                # -----------------------------------------------------------------
                # 1.2 โหมดชำระค่าเช่า (Rental Settlement & Official Receipt)
                # -----------------------------------------------------------------
                elif selected_pay_mode == "🧾 ชำระค่าเช่า (Rental Settlement)":
                    pending_settle_bks = [
                        b for b in st.session_state.bookings_db 
                        if (b.get('status') not in ["ยกเลิก", "เสร็จสิ้น"] 
                        and not bool(b.get("rental_paid", b.get("is_fully_paid", False))))
                        or b.get('booking_id') == target_settle_id
                    ]
                    pending_settle_bks.sort(key=lambda x: str(x.get("booking_id", "")), reverse=True)

                    if not pending_settle_bks:
                        st.info("✔️ ไม่มีรายการที่รอชำระค่าเช่า (ทุกรายการชำระค่าเช่าครบถ้วนแล้ว)")
                    else:
                        bk_settle_options = {
                            f"🧾 [หมายเลขการจอง: {b['booking_id']}] {b['customer']} — ทะเบียน: {b['car_id']} (ยอดค่าเช่าคงเหลือ: ฿{float(b.get('remaining_rental', b.get('net_price', 0))):,.2f})": b 
                            for b in pending_settle_bks
                        }
                        settle_keys = list(bk_settle_options.keys())
                        def_settle_idx = 0
                        if target_settle_id:
                            for idx, (k, b_item) in enumerate(bk_settle_options.items()):
                                if b_item['booking_id'] == target_settle_id:
                                    def_settle_idx = idx
                                    st.session_state["sb_settle_pending_merged"] = k
                                    break
                        sel_settle_key = st.selectbox("📋 เลือกหมายเลขการจองและลูกค้าเพื่อชำระค่าเช่ารถ:", settle_keys, index=def_settle_idx, key="sb_settle_pending_merged")
                        target_settle_bk = bk_settle_options[sel_settle_key]
                        target_settle_id_curr = target_settle_bk["booking_id"]

                        rem_to_pay = float(target_settle_bk.get("remaining_rental", target_settle_bk.get("net_price", 0)))
                        owner_settle_user = target_settle_bk.get("created_by") or target_settle_bk.get("worker_delivery") or target_settle_bk.get("worker_return") or "admin"
                        can_settle = is_job_owner_or_admin(target_settle_bk, curr_username, is_admin_user)

                        car_s_info = cars_db.get(target_settle_bk["car_id"], {})
                        st_s_badge = "พร้อมรับชำระค่าเช่า" if can_settle else "🔒 สิทธิ์ถูกจำกัด (เฉพาะเจ้าของงาน)"
                        st_s_bg = "#059669" if can_settle else "#EF4444"

                        st.markdown(f"""
                            <div style="background: linear-gradient(135deg, {'#ECFDF5' if can_settle else '#FEF2F2'} 0%, {'#F0FDF4' if can_settle else '#FFF1F2'} 100%); border: 1.5px solid {'#A7F3D0' if can_settle else '#FCA5A5'}; border-radius: 12px; padding: 14px 18px; margin-bottom: 12px;">
                                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
                                    <div>
                                        <h3 style="margin:0; font-size:16px; font-weight:800; color:{'#065F46' if can_settle else '#991B1B'}; display:flex; align-items:center; gap:8px;">
                                            <span>{'🧾' if can_settle else '🔒'}</span> รับชำระค่าเช่ารถวันรับรถ (Rental Settlement)
                                        </h3>
                                        <div style="font-size:12.5px; color:{'#047857' if can_settle else '#B91C1C'}; margin-top:4px;">
                                            รหัสการจอง: <b>{target_settle_bk['booking_id']}</b> | ทะเบียน: <b>{target_settle_bk['car_id']}</b> ({car_s_info.get('brand','')} {car_s_info.get('model','')}) | ลูกค้า: <b>{target_settle_bk['customer']}</b>
                                        </div>
                                    </div>
                                    <div>
                                        <span style="background:{st_s_bg}; color:white; padding:4px 12px; border-radius:20px; font-size:11px; font-weight:700;">{st_s_badge}</span>
                                    </div>
                                </div>
                            </div>
                        """, unsafe_allow_html=True)

                        c_s_inf1, c_s_inf2, c_s_inf3, c_s_inf4 = st.columns(4)
                        c_s_inf1.caption(f"📅 **วันรับรถ:** {format_date_dmy(target_settle_bk['start_date'])}")
                        c_s_inf2.caption(f"📅 **วันคืนรถ:** {format_date_dmy(target_settle_bk['end_date'])}")
                        c_s_inf3.caption(f"🛡️ **มัดจำประกันสัญญา:** ฿{float(target_settle_bk.get('deposit_amount', 5000)):,.2f} ({'มัดจำแล้ว' if target_settle_bk.get('deposit_paid') else 'ยังไม่มัดจำ'})")
                        c_s_inf4.caption(f"👤 **เจ้าของงาน:** {owner_settle_user}")

                        st.markdown("<hr style='margin:10px 0 14px; border:0.5px solid #E5E7EB;'>", unsafe_allow_html=True)

                        c_sp1, c_sp2 = st.columns(2)
                        with c_sp1:
                            settle_pay_method = st.selectbox("ช่องทางการชำระเงินค่าเช่า:", ["เงินสด", "โอนเงิน / สแกน QR", "บัตรเครดิต", "PayPal"], key=f"sb_s_method_merged_{target_settle_id_curr}", disabled=(not can_settle))
                        with c_sp2:
                            settle_memo = st.text_input("หมายเหตุการชำระเงิน / เลขที่อ้างอิงสลิป:", value="ชำระค่าเช่ารถครบถ้วนวันรับรถ", key=f"txt_s_memo_merged_{target_settle_id_curr}", disabled=(not can_settle))

                        st.markdown(f"""
                            <div style="background:#F9FAFB; border:1px solid #E5E7EB; border-radius:8px; padding:10px 14px; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center;">
                                <span style="font-size:13px; color:#4B5563;">ยอดค่าเช่าที่ต้องชำระ (บาท):</span>
                                <b style="font-size:19px; color:#059669;">฿{rem_to_pay:,.2f}</b>
                            </div>
                        """, unsafe_allow_html=True)

                        c_s_btn1, c_s_btn2 = st.columns([3, 1])
                        with c_s_btn1:
                            if not can_settle:
                                st.button(f"🔒 ไม่อนุญาตให้กดชำระค่าเช่า (เฉพาะเจ้าของงาน: {owner_settle_user} หรือ Admin)", disabled=True, use_container_width=True, key=f"btn_dis_s_merged_{target_settle_id_curr}")
                            else:
                                if st.button(f"✅ บันทึกการรับชำระเงิน (Confirm Payment) ฿{rem_to_pay:,.2f}", type="primary", use_container_width=True, key=f"btn_confirm_s_merged_{target_settle_id_curr}"):
                                    for b in st.session_state.bookings_db:
                                        if b['booking_id'] == target_settle_id_curr:
                                            b['rental_paid'] = True
                                            b['remaining_rental'] = 0.0
                                            b['remaining_amount'] = 0.0
                                            b['is_fully_paid'] = True
                                            b['rental_payment_amount'] = rem_to_pay
                                            b['rental_payment_date'] = datetime.now().date()
                                            b['rental_payment_method'] = settle_pay_method
                                            b['final_payment_amount'] = rem_to_pay
                                            b['final_payment_date'] = datetime.now().date()
                                            b['final_payment_method'] = settle_pay_method
                                            break

                                    _GLOBAL_STORE["bookings_db"] = st.session_state.bookings_db
                                    sb_sync_booking(target_settle_bk)
                                    f_settle_rec = {
                                        "company": car_s_info.get("company", "Sawasdee Rent A Car"),
                                        "type": "รายรับ", "category": "ค่าเช่ารถ (วันรับรถ)",
                                        "amount": rem_to_pay, "ref": target_settle_id_curr,
                                        "date": datetime.now().strftime("%Y-%m-%d"),
                                        "detail": f"รับชำระค่าเช่ารถวันรับรถ ({settle_pay_method}) - {settle_memo}"
                                    }
                                    st.session_state.financial_db.append(f_settle_rec)
                                    sb_sync_financial(f_settle_rec)
                                    _GLOBAL_STORE["financial_db"] = st.session_state.financial_db

                                    st.session_state.active_settle_bk_id = None
                                    st.session_state.payment_focus = False
                                    if "settle_job" in st.query_params:
                                        del st.query_params["settle_job"]

                                    st.success(f"🎉 ชำระค่าเช่ารถวันรับรถ ฿{rem_to_pay:,.2f} ครบถ้วนแล้ว! ใบเสร็จรับเงินค่าเช่ารถ (Official Receipt) ถูกสร้างและพร้อมดาวน์โหลดทันที")
                                    time.sleep(1)
                                    st.rerun()

                        with c_s_btn2:
                            if target_settle_id:
                                if st.button("❌ ปิด / ยกเลิก", use_container_width=True, key=f"btn_can_s_merged_{target_settle_id_curr}"):
                                    st.session_state.active_settle_bk_id = None
                                    st.session_state.payment_focus = False
                                    if "settle_job" in st.query_params:
                                        del st.query_params["settle_job"]
                                    st.rerun()

                # -----------------------------------------------------------------
                # 1.3 โหมดต่อสัญญา (Contract Extension)
                # เรียงลำดับสัญญาที่ใกล้จะครบกำหนดก่อน
                # -----------------------------------------------------------------
                elif selected_pay_mode == "🔄 ต่อสัญญา (Contract Extension)":
                    extendable_bks = [
                        b for b in st.session_state.bookings_db 
                        if b.get('status') not in ["ยกเลิก", "เสร็จสิ้น"] and b.get("deposit_paid")
                    ]
                    def _ext_sort_key(b):
                        d = to_date(b.get("end_date"))
                        return d if d else date.max
                    extendable_bks.sort(key=_ext_sort_key)

                    if not extendable_bks:
                        st.info("ไม่มีรายการสัญญาเช่าที่อยู่ระหว่างการเช่าหรือเปิดให้ต่อสัญญาได้ในขณะนี้")
                    else:
                        if not is_admin_user:
                            user_ext_bks = [b for b in extendable_bks if is_job_owner_or_admin(b, curr_username, is_admin_user)]
                        else:
                            user_ext_bks = extendable_bks

                        if not user_ext_bks:
                            st.info(f"👷 พนักงาน **{curr_username}**: รายการสัญญาเช่าที่เปิดใช้งานอยู่เป็นของพนักงานท่านอื่น (เฉพาะเจ้าของงานหรือ Admin เท่านั้นที่มีสิทธิ์ต่อสัญญา)")
                        else:
                            ext_map = {}
                            for b_ext in user_ext_bks:
                                c_info = cars_db.get(b_ext['car_id'], {})
                                ext_lbl = f"🔄 [เลขที่สัญญา: {b_ext['booking_id']}] {b_ext['customer']} — ทะเบียน: {b_ext['car_id']} ({c_info.get('model','')}) | กำหนดคืน: {format_date_dmy(b_ext.get('end_date'))}"
                                ext_map[ext_lbl] = b_ext

                            def_ext_idx = 0
                            if target_extend_id:
                                for idx, b_item in enumerate(user_ext_bks):
                                    if b_item['booking_id'] == target_extend_id:
                                        def_ext_idx = idx
                                        break

                            sel_ext_label = st.selectbox("📋 เลือกเลขที่สัญญาและลูกค้าเพื่อต่อสัญญา (เรียงลำดับสัญญาที่ใกล้ครบกำหนดก่อน):", list(ext_map.keys()), index=def_ext_idx, key="sb_ext_contract_dropdown_merged")
                            target_extend_bk = ext_map[sel_ext_label]
                            curr_ext_id = target_extend_bk["booking_id"]

                            owner_extend_user = target_extend_bk.get("created_by") or target_extend_bk.get("worker_delivery") or target_extend_bk.get("worker_return") or "admin"
                            can_extend = is_job_owner_or_admin(target_extend_bk, curr_username, is_admin_user)

                            car_ext_info = cars_db.get(target_extend_bk["car_id"], {})
                            curr_end_dt = to_date(target_extend_bk.get("end_date")) or date.today()
                            orig_start_dt = to_date(target_extend_bk.get("start_date")) or curr_end_dt
                            orig_days = max(1, (curr_end_dt - orig_start_dt).days)

                            day_rate = float(car_ext_info.get("price_day") or 0)
                            if day_rate <= 0:
                                day_rate = float(target_extend_bk.get("net_price", 0)) / orig_days

                            st_ext_badge = "พร้อมบันทึกต่อสัญญา" if can_extend else "🔒 สิทธิ์ถูกจำกัด (เฉพาะเจ้าของงาน)"
                            st_ext_bg = "#4F46E5" if can_extend else "#EF4444"
                            st.markdown(f"""
                                <div style="background: linear-gradient(135deg, {'#EEF2FF' if can_extend else '#FEF2F2'} 0%, {'#F5F3FF' if can_extend else '#FFF1F2'} 100%); border: 1.5px solid {'#C7D2FE' if can_extend else '#FCA5A5'}; border-radius: 12px; padding: 14px 18px; margin-bottom: 12px;">
                                    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
                                        <div>
                                            <h3 style="margin:0; font-size:16px; font-weight:800; color:{'#3730A3' if can_extend else '#991B1B'}; display:flex; align-items:center; gap:8px;">
                                                <span>{'🔄' if can_extend else '🔒'}</span> รายละเอียดการต่อสัญญาเช่ารถ (Contract Extension)
                                            </h3>
                                            <div style="font-size:12.5px; color:{'#4338CA' if can_extend else '#B91C1C'}; margin-top:4px;">
                                                เลขที่สัญญา: <b>{target_extend_bk['booking_id']}</b> | ทะเบียน: <b>{target_extend_bk['car_id']}</b> ({car_ext_info.get('brand','')} {car_ext_info.get('model','')}) | ลูกค้า: <b>{target_extend_bk['customer']}</b>
                                            </div>
                                        </div>
                                        <div>
                                            <span style="background:{st_ext_bg}; color:white; padding:4px 12px; border-radius:20px; font-size:11px; font-weight:700;">{st_ext_badge}</span>
                                        </div>
                                    </div>
                                </div>
                            """, unsafe_allow_html=True)

                            c_ex1, c_ex2, c_ex3 = st.columns(3)
                            c_ex1.caption(f"📅 **วันเริ่มเช่าเดิม:** {format_date_dmy(orig_start_dt)}")
                            c_ex2.markdown(f"<span style='font-size:12px; color:#4B5563;'>📅 <b>กำหนดวันคืนปัจจุบัน:</b></span><br/><b style='color:#DC2626; font-size:15px;'>{format_date_dmy(curr_end_dt)}</b>", unsafe_allow_html=True)
                            c_ex3.caption(f"👤 **เจ้าของงาน:** {owner_extend_user}")

                            st.markdown("<hr style='margin:10px 0 14px; border:0.5px solid #E5E7EB;'>", unsafe_allow_html=True)

                            c_ef1, c_ef2 = st.columns(2)
                            with c_ef1:
                                ext_add_days = st.number_input("⏱️ จำนวนวันที่ต้องการต่อสัญญา (วัน):", min_value=1, max_value=90, value=1, step=1, key=f"inp_ext_days_merged_{curr_ext_id}", disabled=(not can_extend))
                                new_computed_end = curr_end_dt + timedelta(days=int(ext_add_days))
                                st.markdown(f"🗓️ กำหนดวันคืนใหม่หลังต่อสัญญา: <b style='color:#2563EB; font-size:15px;'>{format_date_dmy(new_computed_end)}</b>", unsafe_allow_html=True)
                            with c_ef2:
                                calc_def_cost = float(ext_add_days * day_rate)
                                ext_pay_amount = st.number_input("💰 ยอดเงินค่าเช่าต่อสัญญาที่ต้องชำระ (บาท):", min_value=0.0, value=calc_def_cost, step=500.0, key=f"inp_ext_cost_merged_{curr_ext_id}", disabled=(not can_extend))
                                ext_pay_ch = st.selectbox("ช่องทางการชำระเงินค่าต่อสัญญา:", ["เงินสด", "โอนเงิน / สแกน QR", "บัตรเครดิต", "PayPal"], key=f"sb_ext_ch_merged_{curr_ext_id}", disabled=(not can_extend))

                            ext_memo_txt = st.text_input("หมายเหตุการต่อสัญญาเช่า / เลขที่อ้างอิง:", value=f"ต่อสัญญาเช่า {ext_add_days} วัน (กำหนดคืนใหม่: {format_date_dmy(new_computed_end)})", key=f"txt_ext_memo_merged_{curr_ext_id}", disabled=(not can_extend))

                            st.caption(f"💡 เมื่อกดยืนยัน: ระบบจะอัปเดตวันคืนรถเป็น **{format_date_dmy(new_computed_end)}**, บันทึกรายรับค่าต่อสัญญา **฿{ext_pay_amount:,.2f}** ลงบัญชีการเงิน และออกใบเสร็จรับเงินค่าต่อสัญญาเช่า (Official Receipt) ทันที")

                            if can_extend:
                                if st.button(f"🔄 ขยายสัญญา (Extend Contract) {ext_add_days} วัน & รับชำระ ฿{ext_pay_amount:,.2f}", type="primary", use_container_width=True, key=f"btn_confirm_ext_merged_{curr_ext_id}"):
                                    ext_count = len(target_extend_bk.get("extension_history", [])) + 1
                                    rec_ext_no = f"REC-EXT-{curr_ext_id}-{ext_count}"
                                    ext_entry = {
                                        "ext_id": ext_count,
                                        "date": datetime.now().strftime("%Y-%m-%d %H:%M"),
                                        "days_added": int(ext_add_days),
                                        "previous_end_date": curr_end_dt.strftime("%Y-%m-%d"),
                                        "new_end_date": new_computed_end.strftime("%Y-%m-%d"),
                                        "amount": float(ext_pay_amount),
                                        "method": ext_pay_ch,
                                        "memo": ext_memo_txt,
                                        "staff": curr_username,
                                        "receipt_id": rec_ext_no
                                    }
                                    for b in st.session_state.bookings_db:
                                        if b['booking_id'] == curr_ext_id:
                                            if "extension_history" not in b:
                                                b["extension_history"] = []
                                            b["extension_history"].append(ext_entry)
                                            b["end_date"] = new_computed_end
                                            b["total_extended_amount"] = b.get("total_extended_amount", 0.0) + float(ext_pay_amount)
                                            break

                                    _GLOBAL_STORE["bookings_db"] = st.session_state.bookings_db
                                    sb_sync_booking(target_extend_bk)
                                    f_ext_rec = {
                                        "company": car_ext_info.get("company", "Sawasdee Rent A Car"),
                                        "type": "รายรับ", "category": "ค่าเช่ารถ (ต่อสัญญาเช่า)",
                                        "amount": float(ext_pay_amount), "ref": curr_ext_id,
                                        "date": datetime.now().strftime("%Y-%m-%d"),
                                        "detail": f"ต่อสัญญาเช่า {ext_add_days} วัน ({format_date_dmy(curr_end_dt)} ➔ {format_date_dmy(new_computed_end)}) ({ext_pay_ch}) - {ext_memo_txt}"
                                    }
                                    st.session_state.financial_db.append(f_ext_rec)
                                    sb_sync_financial(f_ext_rec)
                                    _GLOBAL_STORE["financial_db"] = st.session_state.financial_db

                                    st.session_state.active_extend_bk_id = None
                                    st.session_state.payment_focus = False
                                    if "extend_job" in st.query_params:
                                        del st.query_params["extend_job"]

                                    st.success(f"🎉 บันทึกต่อสัญญาเช่า {ext_add_days} วัน (กำหนดคืนใหม่: {format_date_dmy(new_computed_end)}) และรับชำระเงิน ฿{ext_pay_amount:,.2f} เรียบร้อยแล้ว! ใบเสร็จรับเงินค่าต่อสัญญาถูกสร้างพร้อมดาวน์โหลด")
                                    time.sleep(1)
                                    st.rerun()
                            else:
                                st.button(f"🔒 ไม่อนุญาตให้กดต่อสัญญา (เฉพาะเจ้าของงาน: {owner_extend_user} หรือ Admin)", disabled=True, use_container_width=True, key=f"btn_dis_ext_merged_{curr_ext_id}")

                            if target_extend_id:
                                if st.button("❌ ปิดการเลือกงานนี้", key="btn_cancel_ext_sel_merged", use_container_width=True):
                                    st.session_state.active_extend_bk_id = None
                                    st.session_state.payment_focus = False
                                    if "extend_job" in st.query_params:
                                        del st.query_params["extend_job"]
                                    st.rerun()

                # -----------------------------------------------------------------
                # ตารางรายการรอชำระเงิน & ประวัติเอกสาร (สัญญา / ใบเสร็จ)
                # -----------------------------------------------------------------
                deposit_bks = [
                    b for b in st.session_state.bookings_db 
                    if b.get('status') not in ["ยกเลิก", "เสร็จสิ้น"] 
                    and not bool(b.get("rental_paid", b.get("is_fully_paid", False)))
                ]
                deposit_bks.sort(key=lambda x: str(x.get("booking_id", "")), reverse=True)

                sb_kw_dep = st.session_state.get("global_search_kw", "").strip().lower()
                if sb_kw_dep:
                    sb_kw_dep_clean = sb_kw_dep.replace("-", "").replace(" ", "")
                    deposit_bks = [
                        b for b in deposit_bks
                        if sb_kw_dep in f"{b.get('booking_id','')} {b.get('customer','')} {b.get('car_id','')}".lower()
                        or sb_kw_dep_clean in str(b.get('booking_id','')).lower().replace("-", "").replace(" ", "")
                        or sb_kw_dep_clean in str(b.get('car_id','')).lower().replace("-", "").replace(" ", "")
                    ]

                st.markdown("<div style='height: 14px;'></div>", unsafe_allow_html=True)
                st.markdown(f"<b style='font-size:13.5px; color:#1F2937;'>📋 ตารางรายการรอชำระเงิน & เอกสารสัญญา/ใบเสร็จ ({len(deposit_bks)} รายการ)</b>", unsafe_allow_html=True)
                st.caption("แสดงรายการที่อยู่ระหว่างรอชำระมัดจำหรือรอชำระค่าเช่าวันรับรถ | เมื่องานชำระค่าเช่าครบแล้ว รายการจะถูกบันทึกลงฐานข้อมูลและหายไปจากตารางนี้อัตโนมัติ")

                if not deposit_bks:
                    st.success("✅ ทุกรายการชำระค่าเช่ารถครบถ้วนแล้ว ไม่มีรายการค้างชำระ (ข้อมูลทั้งหมดถูกบันทึกลงฐานข้อมูลเรียบร้อย)")
                else:
                    table_html = (
                        '<div style="max-height: 250px; overflow-y: auto; overflow-x: auto; border-radius: 8px; border: 1px solid #EFEAE3;">'
                        '<table class="bo-table">'
                        '<tr>'
                        '<th>รหัสการจอง</th>'
                        '<th>ทะเบียนรถ</th>'
                        '<th>ลูกค้า</th>'
                        '<th>กำหนดวันเช่า (รับ - คืน)</th>'
                        '<th>มัดจำประกันสัญญา</th>'
                        '<th>ค่าเช่าตามสัญญา</th>'
                        '<th>สถานะค่าเช่า</th>'
                        '<th>ประวัติต่อสัญญา</th>'
                        '<th>เจ้าของงาน</th>'
                        '<th style="text-align:center;">เอกสาร & จัดการชำระ<br/><span style="font-size:11px; font-weight:normal; color:#8C827A;">(📝 สัญญา | 🧾 ใบเสร็จ | 💳 ชำระเงิน | 🔄 ต่อสัญญา | 🗑️ ลบ)</span></th>'
                        '</tr>'
                    )

                    for b in deposit_bks:
                        b_car = cars_db.get(b['car_id'], {})
                        b_cust = st.session_state.customers_db.get(b['customer'], {})

                        is_dep_paid = bool(b.get("deposit_paid", False))
                        net_amt = float(b.get("net_price", 0))
                        dep_amt = float(b.get("deposit_amount", 5000))
                        is_rental_paid = bool(b.get("rental_paid", b.get("is_fully_paid", False)))
                        b_owner = b.get("created_by") or b.get("worker_delivery") or b.get("worker_return") or "admin"
                        can_manage = is_job_owner_or_admin(b, curr_username, is_admin_user)

                        if is_dep_paid:
                            pdf_contract = generate_filled_pdf("rental_template_blank_v2.pdf", b, b_cust, b_car)
                            b64_contract = base64.b64encode(pdf_contract).decode()
                            href_contract = f'<a href="data:application/pdf;base64,{b64_contract}" download="Agreement_{b["booking_id"]}.pdf" class="icon-link" title="โหลดสัญญาเช่า (มัดจำประกันสัญญาแล้ว)">📝</a>'
                            dep_col_html = f"<b style='color:#10B981;'>฿{dep_amt:,.2f}</b><br/><span style='background:#ECFDF5; color:#059669; padding:2px 6px; border-radius:8px; font-size:10.5px; font-weight:700;'>🛡️ มัดจำแล้ว</span>"

                            if is_rental_paid:
                                pdf_receipt = generate_receipt_bytes(f"REC{b['booking_id']}", b, b_cust, b_car, net_amt, b.get("rental_payment_method") or b.get("final_payment_method", "โอนเงิน/ชำระแล้ว"), item_desc="ค่าเช่ารถยนต์ (Vehicle Rental Fee)")
                                b64_receipt = base64.b64encode(pdf_receipt).decode()
                                href_receipt = f'<a href="data:application/pdf;base64,{b64_receipt}" download="Receipt_{b["booking_id"]}.pdf" class="icon-link" title="🧾 ใบเสร็จรับเงิน (Receipt)">🧾</a>'
                                btn_pay_action = '<span style="color:#10B981; font-weight:700; font-size:13px; margin:0 3px;" title="✅ ชำระค่าเช่าแล้ว">✅</span>'
                                pay_status_badge = '<span style="background-color:#ECFDF5; color:#059669; padding:4px 10px; border-radius:12px; font-size:11px; font-weight:700; white-space:nowrap;">🟢 ชำระค่าเช่าแล้ว</span>'
                            else:
                                href_receipt = f'<span style="color:#D1D5DB; font-size:18px; margin-right:4px; cursor:not-allowed;" title="🧾 รอชำระค่าเช่ารถวันรับรถ ฿{net_amt:,.2f} เพื่อออกใบเสร็จ">🧾</span>'
                                pay_status_badge = '<span style="background-color:#FFF7ED; color:#C2410C; padding:4px 10px; border-radius:12px; font-size:11px; font-weight:700; white-space:nowrap;">🟡 รอชำระวันรับรถ</span>'
                                if can_manage:
                                    btn_pay_action = f'<a href="?settle_job={b["booking_id"]}&module=Front+Office" target="_self" class="icon-link" title="💳 กดชำระค่าเช่ารถวันรับรถ ฿{net_amt:,.2f} (เพื่อออกใบเสร็จรับเงิน)">💳</a>'
                                else:
                                    btn_pay_action = f'<span style="color:#9CA3AF; font-size:18px; margin:0 3px; cursor:not-allowed; opacity:0.6;" title="🔒 เฉพาะเจ้าของงาน ({b_owner}) หรือ Admin เท่านั้นที่สามารถกดชำระค่าเช่าได้">🔒</span>'

                            if b.get("status") not in ["ยกเลิก", "เสร็จสิ้น"]:
                                if can_manage:
                                    btn_ext_action = f'<a href="?extend_job={b["booking_id"]}&module=Front+Office" target="_self" class="icon-link" title="🔄 กดต่อสัญญาเช่า & รับชำระเงิน">🔄</a>'
                                else:
                                    btn_ext_action = f'<span style="color:#9CA3AF; font-size:18px; margin:0 3px; cursor:not-allowed; opacity:0.6;" title="🔒 เฉพาะเจ้าของงาน ({b_owner}) หรือ Admin เท่านั้นที่สามารถต่อสัญญาได้">🔒</span>'
                            else:
                                btn_ext_action = ''

                            href_ext_receipts = ""
                            ext_hist = b.get("extension_history", [])
                            for ext_r in ext_hist:
                                pdf_ext_b = generate_receipt_bytes(ext_r.get("receipt_id", f"REC-EXT-{b['booking_id']}-{ext_r.get('ext_id')}"), b, b_cust, b_car, float(ext_r.get("amount", 0)), ext_r.get("method", "เงินสด"), item_desc=f"ค่าต่อสัญญาเช่ารถยนต์ ({ext_r.get('days_added', 1)} วัน ถึง {format_date_dmy(ext_r.get('new_end_date'))})")
                                b64_ext_b = base64.b64encode(pdf_ext_b).decode()
                                href_ext_receipts += f' <a href="data:application/pdf;base64,{b64_ext_b}" download="Receipt_EXT_{b["booking_id"]}_{ext_r.get("ext_id", 1)}.pdf" class="icon-link" title="โหลดใบเสร็จต่อสัญญา #{ext_r.get("ext_id")} (+{ext_r.get("days_added", 1)} วัน, ฿{float(ext_r.get("amount", 0)):,.2f})">🧾+</a>'

                            ext_badge_info = ""
                            if ext_hist:
                                ext_badge_info = f'<br/><span style="background:#EEF2FF; color:#4F46E5; padding:2px 7px; border-radius:10px; font-size:10.5px; font-weight:700; white-space:nowrap;">🔄 ต่อแล้ว {len(ext_hist)} ครั้ง (+{sum(e.get("days_added", 0) for e in ext_hist)} วัน)</span>'
                                ext_summary_col = f'<b style="color:#4F46E5;">+฿{sum(float(e.get("amount", 0)) for e in ext_hist):,.2f}</b><br/><span style="font-size:11px; color:#6B7280;">({len(ext_hist)} รายการ)</span>'
                            else:
                                ext_summary_col = '<span style="color:#9CA3AF; font-size:12px;">-</span>'
                        else:
                            href_contract = f'<span style="color:#D1D5DB; font-size:18px; margin-right:4px; cursor:not-allowed;" title="📝 รอชำระมัดจำ ฿5,000 เพื่อออกสัญญาเช่า">📝</span>'
                            href_receipt = f'<span style="color:#D1D5DB; font-size:18px; margin-right:4px; cursor:not-allowed;" title="🧾 รอชำระเงินเพื่อออกใบเสร็จ">🧾</span>'
                            dep_col_html = f"<b style='color:#EA580C;'>฿5,000.00</b><br/><span style='background:#FFF7ED; color:#C2410C; padding:2px 6px; border-radius:8px; font-size:10.5px; font-weight:700;'>🟡 รอชำระมัดจำ</span>"
                            pay_status_badge = '<span style="background-color:#FEF2F2; color:#DC2626; padding:4px 10px; border-radius:12px; font-size:11px; font-weight:700; white-space:nowrap;">🔴 รอชำระมัดจำ</span>'
                            if can_manage:
                                btn_pay_action = f'<a href="?deposit_job={b["booking_id"]}&module=Front+Office" target="_self" class="icon-link" title="💳 กดชำระมัดจำ ฿5,000 / ชำระเพื่อออกใบเสร็จ">💳</a>'
                            else:
                                btn_pay_action = f'<span style="color:#9CA3AF; font-size:18px; margin:0 3px; cursor:not-allowed; opacity:0.6;" title="🔒 เฉพาะเจ้าของงาน ({b_owner}) หรือ Admin เท่านั้นที่สามารถกดชำระเงินได้">🔒</span>'
                            btn_ext_action = ''
                            href_ext_receipts = ''
                            ext_badge_info = ''
                            ext_summary_col = '<span style="color:#9CA3AF; font-size:12px;">-</span>'

                        bk_id_str = b["booking_id"]
                        btn_del_t4 = f'<a href="?del_booking={bk_id_str}&module=Front+Office" target="_self" class="icon-link" title="🗑️ ลบ/ยกเลิกรายการจองนี้" onclick="return confirm(\'⚠️ ยืนยันลบรายการจอง {bk_id_str} ออกจากระบบ?\');">🗑️</a>' if can_manage else ''
                        b_cust_name = b.get('customer', '-')
                        b_c_phone = b_cust.get("contact_no") or ""
                        b_c_phone_txt = f"<br/><span style='font-size:11px; color:#6B7280;'>📞 {b_c_phone}</span>" if b_c_phone and b_c_phone != "-" else ""
                        b_cust_html = f"<div style='min-width:130px;'><b style='color:#1F2937;'>👤 {b_cust_name}</b>{b_c_phone_txt}</div>"

                        row_html = (
                            f"<tr>"
                            f"<td style='color:#6B7280; font-size:12px; font-weight:700;'>{b['booking_id']}</td>"
                            f"<td><b style='color:#1F2937;'>{b['car_id']}</b><br/><span style='font-size:11px; color:#6B7280;'>{b_car.get('brand','')} {b_car.get('model','')}</span></td>"
                            f"<td>{b_cust_html}</td>"
                            f"<td style='color:#4B5563; font-size:12px; white-space:nowrap;'>📅 {format_date_dmy(b['start_date'])} ถึง {format_date_dmy(b['end_date'])}{ext_badge_info}</td>"
                            f"<td>{dep_col_html}</td>"
                            f"<td style='font-weight:600;'>฿{net_amt:,.2f}</td>"
                            f"<td>{pay_status_badge}</td>"
                            f"<td>{ext_summary_col}</td>"
                            f"<td><span style='background:#F3F4F6; color:#374151; padding:3px 8px; border-radius:10px; font-size:11px; font-weight:600;'>👤 {b_owner}</span></td>"
                            f"<td style='text-align:center; white-space:nowrap;'>{href_contract} {href_receipt} {btn_pay_action} {btn_ext_action} {href_ext_receipts} {btn_del_t4}</td>"
                            f"</tr>"
                        )
                        table_html += row_html

                    table_html += "</table></div>"
                    st.markdown(table_html, unsafe_allow_html=True)


        # --- TAB 3: DISPATCH & RETURN (ออกใบงานส่ง/รับรถ) ---
        elif current_tab in ["3. ใบงานส่ง/รับรถ", "4. ใบงานส่ง/รับรถ", "5. ใบงานส่ง/รับรถ"]:
            curr_u = st.session_state.user or {}
            curr_username = curr_u.get("username", "admin")
            curr_role = curr_u.get("role", "Staff")
            is_admin_user = (curr_role == "Admin" or curr_username.lower() == "admin")

            # --- TOP NAVIGATION & BREADCRUMB (ปุ่มย้อนกลับตามโฟลงาน) ---
            b_nav1, b_nav2 = st.columns([1.6, 3.4])
            with b_nav1:
                if st.button("⬅️ ย้อนกลับไปหน้าชำระเงินจอง", key="btn_back_to_tab3_top", use_container_width=True):
                    st.session_state.workflow_tab = "2. ชำระเงินจอง & การเงิน"
                    st.rerun()
            with b_nav2:
                st.markdown("""
                    <div style="background:#F9FAFB; border:1px solid #E5E7EB; border-radius:8px; padding:7px 14px; font-size:12.5px; color:#4B5563; text-align:right;">
                        🚘 1. เลือกรถ ➔ 💳 2. ชำระเงินจอง ➔ <b style="color:#E85826; background:#FFF7ED; padding:3px 8px; border-radius:6px; border:1px solid #FDBA74;">🚚 3. ออกใบงาน (ขั้นตอนปัจจุบัน)</b> ➔ 📝 4. จัดทำสัญญา
                    </div>
                """, unsafe_allow_html=True)

            st.markdown("<div style='height:6px;'></div>", unsafe_allow_html=True)

            col_d, col_r = st.columns(2)
            
            with col_d:
                with st.container(border=True):
                    st.markdown("<h3 style='font-size:15px; font-weight:700;'>🚚 ออกใบงานจัดส่งรถ (Dispatch)</h3>", unsafe_allow_html=True)
                    
                    target_assign_id = st.session_state.get("active_assign_bk_id") or st.query_params.get("assign_job")
                    all_dispatch_opts = [
                        b for b in st.session_state.bookings_db 
                        if b['status'] in ["รอส่งมอบ", "เตรียมส่งมอบ", "รอชำระมัดจำ"]
                        or b.get('booking_id') == target_assign_id
                    ]
                    
                    if not all_dispatch_opts:
                        st.info("ไม่มีรายการรอจัดส่งรถ")
                    else:
                        d_opts = {}
                        for b in all_dispatch_opts:
                            dep_prefix = "🟡 [รอชำระมัดจำ] " if (not b.get("deposit_paid") or b.get("status") == "รอชำระมัดจำ") else ""
                            d_opts[f"{dep_prefix}รหัส: {b['booking_id']} - รถ: {b['car_id']} (ลูกค้า: {b['customer']})"] = b
                            
                        def_disp_idx = 0
                        if target_assign_id:
                            for idx_d, (k_d, b_d) in enumerate(d_opts.items()):
                                if b_d['booking_id'] == target_assign_id:
                                    def_disp_idx = idx_d
                                    break
                        sel_d = st.selectbox("เลือกรายการจัดส่งรถ (มอบหมาย/แก้ไข)", list(d_opts.keys()), index=def_disp_idx)
                        target_bk_d = d_opts[sel_d]
                        
                        col_d1, col_d2 = st.columns(2)
                        with col_d1:
                            st.date_input("วันที่เริ่มเช่า", value=target_bk_d['start_date'], disabled=True, key=f"d_start_{target_bk_d['booking_id']}")
                        with col_d2:
                            st.date_input("กำหนดคืนรถ", value=target_bk_d['end_date'], disabled=True, key=f"d_end_{target_bk_d['booking_id']}")
                        
                        is_d_dep_paid = bool(target_bk_d.get('deposit_paid', False))
                        d_dep_amt = float(target_bk_d.get('deposit_amount', 5000.0))
                        is_d_rent_paid = bool(target_bk_d.get('rental_paid', target_bk_d.get('is_fully_paid', False)))
                        d_net_price = float(target_bk_d.get('net_price', 0))
                        
                        if not is_d_dep_paid or target_bk_d.get('status') == 'รอชำระมัดจำ':
                            st.markdown(f"""
                                <div style='background:#FFF7ED; border:1.5px solid #FDBA74; border-radius:8px; padding:10px 14px; margin-bottom:12px;'>
                                    <div style='display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;'>
                                        <div>
                                            <b style='color:#C2410C; font-size:13px;'>🟡 สถานะการจอง: รอชำระเงินมัดจำ (฿{d_dep_amt:,.2f})</b>
                                            <div style='color:#9A3412; font-size:12px; margin-top:2px;'>สามารถมอบหมายคนขับ/สถานที่ส่งล่วงหน้าได้ หรือชำระมัดจำเพื่อล็อกคิวรถและออกสัญญา</div>
                                        </div>
                                    </div>
                                </div>
                            """, unsafe_allow_html=True)
                            c_dep_go1, c_dep_go2 = st.columns([1.5, 1.5])
                            with c_dep_go2:
                                if st.button(f"💳 ไปรับมัดจำ ฿{d_dep_amt:,.2f} (แท็บ 2)", key=f"btn_tab5_go_dep_{target_bk_d['booking_id']}", type="secondary", use_container_width=True):
                                    st.session_state.active_deposit_bk_id = target_bk_d['booking_id']
                                    st.session_state.payment_focus = True
                                    st.session_state.workflow_tab = "2. ชำระเงินจอง & การเงิน"
                                    st.rerun()
                        
                        col_pay_info, col_pay_btn = st.columns([2.3, 1.7])
                        with col_pay_info:
                            if is_d_rent_paid:
                                st.markdown("<div style='background:#F0FDF4; border:1px solid #BBF7D0; border-radius:8px; padding:8px 12px; font-size:12.5px; color:#15803D; font-weight:700;'>✅ ชำระค่าเช่ารถครบถ้วนแล้ว (ออกใบเสร็จแล้ว)</div>", unsafe_allow_html=True)
                            else:
                                st.markdown(f"<div style='background:#FFF7ED; border:1px solid #FED7AA; border-radius:8px; padding:8px 12px; font-size:12.5px; color:#C2410C;'>⏳ <b>รอชำระค่าเช่าวันรับรถ:</b> <b style='color:#E85826; font-size:14px;'>฿{d_net_price:,.2f}</b></div>", unsafe_allow_html=True)
                        with col_pay_btn:
                            if not is_d_rent_paid:
                                if st.button(f"💳 กดจ่ายเงินค่าเช่า (฿{d_net_price:,.2f})", key=f"btn_pay_d_step_{target_bk_d['booking_id']}", type="primary", use_container_width=True):
                                    st.session_state.active_settle_bk_id = target_bk_d['booking_id']
                                    st.session_state.payment_focus = True
                                    st.session_state.workflow_tab = "2. ชำระเงินจอง & การเงิน"
                                    st.rerun()
                            else:
                                st.button("🧾 ใบเสร็จพร้อมแล้ว", disabled=True, use_container_width=True, key=f"btn_rec_done_{target_bk_d['booking_id']}")
                        
                        edit_key_d = f"edit_d_{target_bk_d['booking_id']}"
                        is_d_worker_assigned = bool(target_bk_d.get("worker_delivery") and str(target_bk_d.get("worker_delivery")).strip() not in ["Wait", "-", ""])
                        
                        if is_d_worker_assigned and not st.session_state.get(edit_key_d, False):
                            st.success(f"✅ มอบหมายพนักงานจัดส่งแล้ว: **{target_bk_d['worker_delivery']}**")
                            if target_bk_d.get("loc_delivery"):
                                st.markdown(f"📍 **สถานที่ส่งมอบ:** {target_bk_d['loc_delivery']}")
                                
                            c_edit, c_next_c, c_fin = st.columns([1, 1.4, 1.2])
                            with c_edit:
                                if st.button("✏️ แก้ไขใบงาน", key=f"btn_ed_d_{target_bk_d['booking_id']}", use_container_width=True):
                                    st.session_state[edit_key_d] = True
                                    st.rerun()
                            with c_next_c:
                                if st.button("📝 ไปหน้าทำสัญญา ➔", key=f"btn_go_contract_from_d_{target_bk_d['booking_id']}", type="primary", use_container_width=True):
                                    st.session_state.active_contract_bk_id = target_bk_d['booking_id']
                                    st.session_state.workflow_tab = "4. จัดทำสัญญาเช่า"
                                    st.rerun()
                            with c_fin:
                                if not is_d_dep_paid:
                                    st.button("🔒 รอมัดจำ", disabled=True, use_container_width=True, key=f"btn_fin_d_dis_{target_bk_d['booking_id']}", help="ต้องบันทึกรับเงินมัดจำในแท็บ 3 ก่อนส่งมอบรถให้ลูกค้า")
                                else:
                                    if st.button("✅ เริ่มเช่า (ส่งมอบแล้ว)", key=f"btn_fin_d_{target_bk_d['booking_id']}", use_container_width=True):
                                        for b in st.session_state.bookings_db:
                                            if b['booking_id'] == target_bk_d['booking_id']:
                                                b['status'] = "กำลังเช่า"
                                                b['dispatch_closed'] = True
                                                cars_db[b['car_id']]['status'] = "กำลังเช่า"
                                                break
                                        _GLOBAL_STORE["bookings_db"] = st.session_state.bookings_db
                                        sb_sync_booking(target_bk_d)
                                        sb_sync_car(target_bk_d['car_id'], cars_db[target_bk_d['car_id']])
                                        st.success("อัปเดตสถานะเป็น 'กำลังเช่า' เรียบร้อย รถพร้อมเข้าสู่กระบวนการรับคืน")
                                        time.sleep(1)
                                        st.rerun()
                        else:
                            with st.form(f"dispatch_form_{target_bk_d['booking_id']}"):
                                st.markdown("<span style='font-size:13px; font-weight:600;'>ข้อมูลพนักงานที่จะไปส่งรถ</span>", unsafe_allow_html=True)
                                approved_staff_disp = get_approved_staff_list()
                                curr_disp_w = target_bk_d.get("worker_delivery", "")
                                if curr_disp_w in ["Wait", "-", ""]:
                                    curr_disp_w = ""
                                disp_w_idx = approved_staff_disp.index(curr_disp_w) if curr_disp_w in approved_staff_disp else 0
                                worker = st.selectbox("เลือกพนักงานจัดส่ง / คนขับรถ (ผู้ใช้งานที่แอดมินอนุมัติ):", approved_staff_disp, index=disp_w_idx, key=f"disp_w_{target_bk_d['booking_id']}")
                                loc = st.text_area("สถานที่นัดหมายส่งมอบรถ", value=target_bk_d.get("loc_delivery", ""), key=f"disp_l_{target_bk_d['booking_id']}")
                                init_d_time = parse_time_val(target_bk_d.get("start_time"), d_time(10, 0))
                                time_d = st.time_input("เวลาส่งมอบตามนัด", init_d_time, key=f"disp_t_{target_bk_d['booking_id']}")
                                
                                if is_d_worker_assigned:
                                    c_b1, c_b2 = st.columns(2)
                                    with c_b1:
                                        btn_submit = st.form_submit_button("📌 มอบหมายงานจัดส่ง (Assign Dispatch)", type="primary", use_container_width=True)
                                    with c_b2:
                                        btn_cancel = st.form_submit_button("ยกเลิก", use_container_width=True)
                                else:
                                    btn_submit = st.form_submit_button("📌 มอบหมายงานจัดส่ง (Assign Dispatch)", type="primary", use_container_width=True)
                                    btn_cancel = False
                                
                                if btn_submit:
                                    for b in st.session_state.bookings_db:
                                        if b['booking_id'] == target_bk_d['booking_id']:
                                            b['worker_delivery'] = worker
                                            b['loc_delivery'] = loc
                                            b['start_time'] = time_d.strftime("%H:%M")
                                            if b['status'] == "รอส่งมอบ":
                                                b['status'] = "เตรียมส่งมอบ"
                                            elif b['status'] == "รอชำระมัดจำ" and b.get("deposit_paid"):
                                                b['status'] = "เตรียมส่งมอบ"
                                    _GLOBAL_STORE["bookings_db"] = st.session_state.bookings_db
                                    target_bk_d['worker_delivery'] = worker
                                    target_bk_d['loc_delivery'] = loc
                                    target_bk_d['start_time'] = time_d.strftime("%H:%M")
                                    sb_sync_booking(target_bk_d)
                                    
                                    # แจ้งเตือนผ่าน LINE Messaging API
                                    notify_line_work_order(
                                        booking_obj=target_bk_d,
                                        job_type="Dispatch",
                                        worker_name=worker,
                                        location=loc,
                                        appointment_time=time_d.strftime("%H:%M")
                                    )
                                    
                                    st.session_state[edit_key_d] = False
                                    
                                    # ระบบจะส่งกลับมาที่หน้าทำสัญญาเช่าตามโฟลงาน
                                    st.session_state.active_contract_bk_id = target_bk_d['booking_id']
                                    st.session_state.workflow_tab = "4. จัดทำสัญญาเช่า"
                                    st.success("✅ บันทึกการมอบหมายงานเรียบร้อย! กำลังนำท่านไปยังหน้าจัดทำสัญญาเช่า...")
                                    time.sleep(0.8)
                                    st.rerun()
                                    
                                if btn_cancel:
                                    st.session_state[edit_key_d] = False
                                    st.rerun()

            with col_r:
                with st.container(border=True):
                    st.markdown("<h3 style='font-size:15px; font-weight:700;'>🔙 ออกใบงานรับรถคืน / คืนก่อนกำหนด / ต่อสัญญา</h3>", unsafe_allow_html=True)
                    target_return_id = st.session_state.get("active_return_bk_id") or st.query_params.get("return_job")
                    return_bks = [
                        b for b in st.session_state.bookings_db 
                        if b.get('status') in ["กำลังเช่า", "เตรียมรับคืน"]
                        or (b.get('rental_paid') and b.get('status') not in ["ยกเลิก", "เสร็จสิ้น"])
                        or b.get('booking_id') == target_return_id
                    ]
                    
                    if not return_bks:
                        st.info("ไม่มีรายการรถที่อยู่กับลูกค้า (ไม่มีรายการรอรับคืน)")
                    else:
                        r_opts = {f"รหัส: {b['booking_id']} - รถ: {b['car_id']} (ลูกค้า: {b['customer']})": b for b in return_bks}
                        def_ret_idx = 0
                        if target_return_id:
                            for idx_r, (k_r, b_r) in enumerate(r_opts.items()):
                                if b_r['booking_id'] == target_return_id:
                                    def_ret_idx = idx_r
                                    st.session_state["sb_return_job_select"] = k_r
                                    break
                        sel_r = st.selectbox("เลือกรายการที่อยู่กับลูกค้า", list(r_opts.keys()), index=def_ret_idx, key="sb_return_job_select")
                        target_r_bk = r_opts[sel_r]
                        
                        col_r1, col_r2 = st.columns(2)
                        with col_r1:
                            st.date_input("วันที่เริ่มเช่า", value=target_r_bk['start_date'], disabled=True, key=f"r_start_{target_r_bk['booking_id']}")
                        with col_r2:
                            st.date_input("กำหนดคืนรถ", value=target_r_bk['end_date'], disabled=True, key=f"r_end_{target_r_bk['booking_id']}")
                            
                        edit_key_r = f"edit_r_{target_r_bk['booking_id']}"
                        is_r_worker_assigned = bool(target_r_bk.get("worker_return") and str(target_r_bk.get("worker_return")).strip() not in ["Wait", "-", ""])
                        
                        if is_r_worker_assigned and not st.session_state.get(edit_key_r, False):
                            st.success(f"✅ มอบหมายพนักงานรับรถแล้ว: **{target_r_bk['worker_return']}**")
                            loc_r_str = target_r_bk.get("loc_return") or "-"
                            time_r_str = target_r_bk.get("end_time", "10:00")
                            st.markdown(f"📍 **สถานที่รับคืน:** {loc_r_str} | ⏰ **เวลานัดรับคืน:** {time_r_str}")
                            c_edit, c_finish, c_extend = st.columns(3)
                            with c_edit:
                                if st.button("✏️ แก้ไขงานรับรถ", use_container_width=True, key=f"btn_ed_r_{target_r_bk['booking_id']}"):
                                    st.session_state[edit_key_r] = True
                                    st.rerun()
                            with c_finish:
                                curr_u_top = st.session_state.user or {}
                                curr_uname_top = curr_u_top.get("username", "")
                                is_admin_top = (curr_u_top.get("role") == "Admin" or curr_uname_top.lower() == "admin")
                                w_ret_target = target_r_bk.get("worker_return", "")
                                can_finish_r = is_admin_top or (curr_uname_top.lower() == str(w_ret_target).lower())
                                
                                if can_finish_r:
                                    if st.button("📤 ส่งงาน & ตรวจสภาพรถ (ปิดงาน)", use_container_width=True, type="primary", key=f"btn_fin_r_{target_r_bk['booking_id']}"):
                                        st.session_state.active_close_job_id = target_r_bk['booking_id']
                                        st.session_state.active_close_job_type = "Return"
                                        st.session_state.selected_module = "Back Office"
                                        st.rerun()
                                else:
                                    st.button(f"🔒 ปิดงาน (เฉพาะ {w_ret_target})", use_container_width=True, disabled=True, key=f"btn_dis_fin_r_{target_r_bk['booking_id']}", help=f"เฉพาะพนักงานที่ได้รับมอบหมาย ({w_ret_target}) หรือแอดมินเท่านั้น")
                            with c_extend:
                                if st.button("🔄 ขยายสัญญา (Extend Contract)", use_container_width=True, key=f"btn_ext_{target_r_bk['booking_id']}"):
                                    st.session_state.active_extend_bk_id = target_r_bk['booking_id']
                                    st.session_state.payment_focus = True
                                    st.session_state.workflow_tab = "2. ชำระเงินจอง & การเงิน"
                                    st.rerun()
                        else:
                            with st.form(f"return_job_form_{target_r_bk['booking_id']}"):
                                st.markdown("<span style='font-size:13px; font-weight:600;'>ข้อมูลพนักงานที่จะไปรับรถ</span>", unsafe_allow_html=True)
                                approved_staff_ret = get_approved_staff_list()
                                curr_ret_w = target_r_bk.get("worker_return", "")
                                if curr_ret_w in ["Wait", "-", ""]:
                                    curr_ret_w = ""
                                ret_w_idx = approved_staff_ret.index(curr_ret_w) if curr_ret_w in approved_staff_ret else 0
                                worker_r = st.selectbox("เลือกพนักงานรับรถ / คนขับรถ (ผู้ใช้งานที่แอดมินอนุมัติ):", approved_staff_ret, index=ret_w_idx, key=f"ret_w_{target_r_bk['booking_id']}")
                                loc_r = st.text_area("สถานที่นัดหมายรับรถคืน", value=target_r_bk.get("loc_return", ""), key=f"ret_l_{target_r_bk['booking_id']}")
                                init_r_time = parse_time_val(target_r_bk.get("end_time"), d_time(10, 0))
                                time_r = st.time_input("เวลารับรถตามนัด", init_r_time, key=f"ret_t_{target_r_bk['booking_id']}")
                                
                                if is_r_worker_assigned:
                                    c_rb1, c_rb2 = st.columns(2)
                                    with c_rb1:
                                        btn_ret_sub = st.form_submit_button("📌 มอบหมายงานรับคืน (Assign Return)", type="primary", use_container_width=True)
                                    with c_rb2:
                                        btn_ret_can = st.form_submit_button("ยกเลิก", use_container_width=True)
                                else:
                                    btn_ret_sub = st.form_submit_button("📌 มอบหมายงานรับคืน (Assign Return)", type="primary", use_container_width=True)
                                    btn_ret_can = False
                                
                                if btn_ret_sub:
                                    for b in st.session_state.bookings_db:
                                        if b['booking_id'] == target_r_bk['booking_id']:
                                            b['worker_return'] = worker_r
                                            b['loc_return'] = loc_r
                                            b['end_time'] = time_r.strftime("%H:%M")
                                            if b['status'] == "กำลังเช่า":
                                                b['status'] = "เตรียมรับคืน"
                                            break
                                    _GLOBAL_STORE["bookings_db"] = st.session_state.bookings_db
                                    target_r_bk['worker_return'] = worker_r
                                    target_r_bk['loc_return'] = loc_r
                                    target_r_bk['end_time'] = time_r.strftime("%H:%M")
                                    sb_sync_booking(target_r_bk)
                                    
                                    # แจ้งเตือนผ่าน LINE Messaging API
                                    notify_line_work_order(
                                        booking_obj=target_r_bk,
                                        job_type="Return",
                                        worker_name=worker_r,
                                        location=loc_r,
                                        appointment_time=time_r.strftime("%H:%M")
                                    )
                                    
                                    st.session_state[edit_key_r] = False
                                    st.success("มอบหมายงานรับรถคืนสำเร็จ! ตรวจสอบใบงานได้ที่ Back Office")
                                    time.sleep(1)
                                    st.rerun()
                                    
                                if btn_ret_can:
                                    st.session_state[edit_key_r] = False
                                    st.rerun()


        # --- TAB 5: CONTRACT FORMULATION & REVIEW (จัดทำและตรวจสอบสัญญาเช่า) ---
        # --- TAB 4: RENTAL CONTRACT CREATION (ศูนย์จัดทำและตรวจสอบสัญญาเช่า) ---
        elif current_tab in ["4. จัดทำสัญญาเช่า", "5. จัดทำสัญญาเช่า", "3. จัดทำสัญญาเช่า"]:
            curr_u = st.session_state.user or {}
            curr_username = curr_u.get("username", "admin")
            curr_role = curr_u.get("role", "Staff")
            is_admin_user = (curr_role == "Admin" or curr_username.lower() == "admin")

            # --- TOP NAVIGATION & BREADCRUMB (ปุ่มย้อนกลับตามโฟลงาน) ---
            b_nav1, b_nav2 = st.columns([1.6, 3.4])
            with b_nav1:
                if st.button("⬅️ ย้อนกลับไปหน้าออกใบงาน", key="btn_back_to_tab4_top", use_container_width=True):
                    st.session_state.workflow_tab = "3. ใบงานส่ง/รับรถ"
                    st.rerun()
            with b_nav2:
                st.markdown("""
                    <div style="background:#F9FAFB; border:1px solid #E5E7EB; border-radius:8px; padding:7px 14px; font-size:12.5px; color:#4B5563; text-align:right;">
                        🚘 1. เลือกรถ ➔ 💳 2. ชำระเงินจอง ➔ 🚚 3. ออกใบงาน ➔ <b style="color:#E85826; background:#FFF7ED; padding:3px 8px; border-radius:6px; border:1px solid #FDBA74;">📝 4. จัดทำสัญญา (ขั้นตอนปัจจุบัน)</b>
                    </div>
                """, unsafe_allow_html=True)

            st.markdown("<div style='height:6px;'></div>", unsafe_allow_html=True)

            # ตรวจสอบรายการสัญญาเช่าทั้งหมดในระบบ
            all_active_contracts = [b for b in st.session_state.bookings_db if b.get('status') not in ["ยกเลิก", "เสร็จสิ้น"]]
            all_active_contracts.sort(key=lambda x: str(x.get("booking_id", "")), reverse=True)

            target_contract_id = st.session_state.get("active_contract_bk_id") or st.query_params.get("contract_job")

            with st.container(border=True):
                st.markdown(f"""
                    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:12px;">
                        <div>
                            <h3 style="margin:0; font-size:17px; font-weight:800; color:#1F2937;">
                                <span>📝</span> ศูนย์จัดทำและตรวจสอบสัญญาเช่า (Rental Agreement & PDF Center)
                            </h3>
                            <div style="font-size:12px; color:#6B7280; margin-top:2px;">
                                ตรวจสอบข้อมูลความถูกต้องของสัญญา พิมพ์และดาวน์โหลดเอกสารสัญญาเช่า (Rental Agreement PDF) และใบเสร็จรับเงิน
                            </div>
                        </div>
                    </div>
                """, unsafe_allow_html=True)

                if not all_active_contracts:
                    st.info("ℹ️ ยังไม่มีรายการสัญญาเช่าที่เปิดใช้งานอยู่ในระบบ กดปุ่มด้านล่างเพื่อเริ่มกระบวนการเช่ารถใหม่")
                    if st.button("➕ ไปที่หน้าเลือกรถยนต์เพื่อเริ่มจอง", type="primary"):
                        st.session_state.workflow_tab = "1. เลือกรถยนต์"
                        st.rerun()
                else:
                    c_options_map = {}
                    for b_c in all_active_contracts:
                        c_car_item = cars_db.get(b_c['car_id'], {})
                        st_dep_badge = "🟢 มัดจำแล้ว" if b_c.get("deposit_paid") else "🟡 รอมัดจำ"
                        lbl = f"[{b_c['booking_id']}] รถ: {b_c['car_id']} ({c_car_item.get('model','')}) — ลูกค้า: {b_c['customer']} ({st_dep_badge})"
                        c_options_map[lbl] = b_c

                    def_contract_idx = 0
                    if target_contract_id:
                        for idx_c, (k_c, b_c_val) in enumerate(c_options_map.items()):
                            if b_c_val['booking_id'] == target_contract_id:
                                def_contract_idx = idx_c
                                st.session_state["sb_contract_view_dropdown"] = k_c
                                break

                    sel_contract_label = st.selectbox("📋 เลือกสัญญาเช่าเพื่อตรวจสอบและดาวน์โหลดเอกสาร PDF:", list(c_options_map.keys()), index=def_contract_idx, key="sb_contract_view_dropdown")
                    target_contract_bk = c_options_map[sel_contract_label]

                    target_c_car = cars_db.get(target_contract_bk["car_id"], {})
                    target_c_cust = st.session_state.customers_db.get(target_contract_bk["customer"], {})

                    c_is_dep = bool(target_contract_bk.get("deposit_paid", False))
                    c_is_rent = bool(target_contract_bk.get("rental_paid", target_contract_bk.get("is_fully_paid", False)))
                    c_net = float(target_contract_bk.get("net_price", 0))
                    c_dep = float(target_contract_bk.get("deposit_amount", 5000))

                    # การ์ดแสดงผลข้อมูลสัญญาเช่าแบบสมบูรณ์
                    st.markdown(f"""
                        <div style="background: linear-gradient(135deg, #F8FAFC 0%, #F1F5F9 100%); border: 1.5px solid #CBD5E1; border-radius: 12px; padding: 16px 20px; margin: 12px 0;">
                            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:12px; border-bottom:1px solid #E2E8F0; padding-bottom:10px;">
                                <div>
                                    <h4 style="margin:0; font-size:16px; font-weight:800; color:#1E293B;">
                                        📄 สัญญาเช่าเลขที่: <span style="color:#E85826;">{target_contract_bk['booking_id']}</span>
                                    </h4>
                                    <div style="font-size:12px; color:#64748B; margin-top:2px;">
                                        ผู้สร้างสัญญา: <b>{target_contract_bk.get('created_by', 'admin')}</b> | สถานะงาน: <b>{target_contract_bk.get('status', 'รอส่งมอบ')}</b>
                                    </div>
                                </div>
                                <div style="display:flex; gap:8px;">
                                    <span style="background:{'#ECFDF5' if c_is_dep else '#FFF7ED'}; border:1px solid {'#A7F3D0' if c_is_dep else '#FDBA74'}; color:{'#065F46' if c_is_dep else '#C2410C'}; padding:4px 12px; border-radius:15px; font-size:11.5px; font-weight:700;">
                                        {'🟢 มัดจำประกันสัญญาแล้ว' if c_is_dep else '🟡 รอมัดจำ'}
                                    </span>
                                    <span style="background:{'#ECFDF5' if c_is_rent else '#FFFBEB'}; border:1px solid {'#A7F3D0' if c_is_rent else '#FDE68A'}; color:{'#065F46' if c_is_rent else '#B45309'}; padding:4px 12px; border-radius:15px; font-size:11.5px; font-weight:700;">
                                        {'🟢 ค่าเช่าชำระครบแล้ว' if c_is_rent else '🟡 รอชำระค่าเช่าวันรับรถ'}
                                    </span>
                                </div>
                            </div>
                        </div>
                    """, unsafe_allow_html=True)

                    c_info1, c_info2, c_info3 = st.columns(3)
                    with c_info1:
                        st.markdown(f"""
                            <div style="background:#FFFFFF; border:1px solid #E5E7EB; border-radius:8px; padding:12px; min-height:180px;">
                                <b style="color:#1E3A8A; font-size:13px;">👤 ข้อมูลผู้เช่า (Customer)</b>
                                <div style="font-size:12.5px; color:#374151; margin-top:6px; line-height:1.6;">
                                    • <b>ชื่อ-นามสกุล:</b> {target_contract_bk['customer']}<br/>
                                    • <b>Passport / ID:</b> {target_c_cust.get('passport_id', '-')}<br/>
                                    • <b>เบอร์โทรศัพท์:</b> {target_c_cust.get('contact_no', '-')}<br/>
                                    • <b>หมายเลขใบขับขี่:</b> {target_c_cust.get('licence_no', '-')}<br/>
                                    • <b>สัญชาติ:</b> {target_c_cust.get('nationality', 'THAI')}<br/>
                                    • <b>ที่อยู่ในไทย:</b> {target_c_cust.get('thai_address', '-')}
                                </div>
                            </div>
                        """, unsafe_allow_html=True)

                    with c_info2:
                        st.markdown(f"""
                            <div style="background:#FFFFFF; border:1px solid #E5E7EB; border-radius:8px; padding:12px; min-height:180px;">
                                <b style="color:#1E3A8A; font-size:13px;">🚘 ข้อมูลรถยนต์ (Vehicle)</b>
                                <div style="font-size:12.5px; color:#374151; margin-top:6px; line-height:1.6;">
                                    • <b>ทะเบียน:</b> {target_contract_bk['car_id']}<br/>
                                    • <b>ยี่ห้อ / รุ่น:</b> {target_c_car.get('brand','')} {target_c_car.get('model','')}<br/>
                                    • <b>สีตัวถัง:</b> {target_c_car.get('color', '-')}<br/>
                                    • <b>เลขตัวถัง (VIN):</b> {target_c_car.get('chassis_no', '-')}<br/>
                                    • <b>ประเภท / เครื่องยนต์:</b> {target_c_car.get('car_group', '-')} ({target_c_car.get('engine_cc', '-')} cc)<br/>
                                    • <b>เจ้าของกรรมสิทธิ์:</b> {target_c_car.get('company', 'Sawasdee Rent A Car')}
                                </div>
                            </div>
                        """, unsafe_allow_html=True)

                    with c_info3:
                        w_del_show = target_contract_bk.get("worker_delivery") or "-"
                        if w_del_show == "Wait": w_del_show = "รอส่งมอบ (ยังไม่มอบหมาย)"
                        loc_del_show = target_contract_bk.get("loc_delivery") or "-"
                        st.markdown(f"""
                            <div style="background:#FFFFFF; border:1px solid #E5E7EB; border-radius:8px; padding:12px; min-height:180px;">
                                <b style="color:#1E3A8A; font-size:13px;">📅 ระยะเวลา & ใบงานจัดส่ง (Schedule)</b>
                                <div style="font-size:12.5px; color:#374151; margin-top:6px; line-height:1.6;">
                                    • <b>วัน-เวลาส่งมอบ:</b> {format_date_dmy(target_contract_bk['start_date'])} ({target_contract_bk.get('start_time','10:00')})<br/>
                                    • <b>วัน-เวลารับคืน:</b> {format_date_dmy(target_contract_bk['end_date'])} ({target_contract_bk.get('end_time','10:00')})<br/>
                                    • <b>จำนวนวันเช่าคิดเงิน:</b> {target_contract_bk.get('billable_days', 1)} วัน<br/>
                                    • <b>พนักงานจัดส่ง:</b> {w_del_show}<br/>
                                    • <b>สถานที่ส่งมอบรถ:</b> {loc_del_show}
                                </div>
                            </div>
                        """, unsafe_allow_html=True)

                    # สรุปยอดเงินและส่วนลด
                    st.markdown(f"""
                        <div style="background:#FFF7ED; border:1px solid #FED7AA; border-radius:8px; padding:10px 16px; margin:12px 0; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                            <span>💰 <b>ยอดค่าเช่าตามสัญญา:</b> ฿{c_net:,.2f}</span>
                            <span>🛡️ <b>มัดจำประกันสัญญา:</b> ฿{c_dep:,.2f} ({'ชำระแล้ว' if c_is_dep else 'รอมัดจำ'})</span>
                            <span>🧾 <b>ยอดค่าเช่าคงเหลือ:</b> <b style="color:#E85826; font-size:15px;">฿{float(target_contract_bk.get('remaining_rental', 0)):,.2f}</b></span>
                        </div>
                    """, unsafe_allow_html=True)

                    st.markdown("<hr style='margin:12px 0 16px; border:0.5px solid #E5E7EB;'>", unsafe_allow_html=True)

                    # ส่วนปุ่มดาวน์โหลดเอกสาร PDF และปุ่มเสร็จสิ้น
                    st.markdown("<b style='font-size:14px; color:#1F2937;'>📥 พิมพ์และดาวน์โหลดเอกสาร (Document Center):</b>", unsafe_allow_html=True)
                    doc_c1, doc_c2, doc_c3 = st.columns([1.6, 1.4, 1.4])

                    with doc_c1:
                        try:
                            def _cb_mark_contract_issued(bk_id):
                                for bk_item in st.session_state.bookings_db:
                                    if bk_item["booking_id"] == bk_id:
                                        bk_item["contract_issued"] = True
                                        break
                                _GLOBAL_STORE["bookings_db"] = st.session_state.bookings_db

                            pdf_contract_bytes = generate_filled_pdf("rental_template_blank_v2.pdf", target_contract_bk, target_c_cust, target_c_car)
                            st.download_button(
                                label="📝 สัญญาเช่า (Agreement)",
                                data=pdf_contract_bytes,
                                file_name=f"Agreement_{target_contract_bk['booking_id']}.pdf",
                                mime="application/pdf",
                                type="primary",
                                use_container_width=True,
                                key=f"dl_btn_agreement_{target_contract_bk['booking_id']}",
                                on_click=_cb_mark_contract_issued,
                                args=(target_contract_bk['booking_id'],)
                            )
                        except Exception as e:
                            st.error(f"ไม่สามารถสร้างไฟล์สัญญา PDF ได้: {e}")

                    with doc_c2:
                        if c_is_dep:
                            try:
                                pdf_dep_receipt = generate_receipt_bytes(
                                    f"DEP{target_contract_bk['booking_id']}",
                                    target_contract_bk,
                                    target_c_cust,
                                    target_c_car,
                                    c_dep,
                                    target_contract_bk.get("deposit_method", "เงินสด"),
                                    item_desc="เงินมัดจำประกันสัญญาตอนจองรถ (Booking Deposit)"
                                )
                                st.download_button(
                                    label="🧾 โหลดใบเสร็จมัดจำ (Deposit Receipt PDF)",
                                    data=pdf_dep_receipt,
                                    file_name=f"Receipt_Deposit_{target_contract_bk['booking_id']}.pdf",
                                    mime="application/pdf",
                                    use_container_width=True,
                                    key=f"dl_btn_dep_rec_{target_contract_bk['booking_id']}"
                                )
                            except Exception as e:
                                st.error(f"ไม่สามารถสร้างใบเสร็จมัดจำได้: {e}")
                        else:
                            st.button("🔒 รอมัดจำเพื่อออกใบเสร็จ", disabled=True, use_container_width=True, key=f"dis_rec_dep_{target_contract_bk['booking_id']}")

                    with doc_c3:
                        if c_is_rent:
                            try:
                                pdf_rent_receipt = generate_receipt_bytes(
                                    f"REC{target_contract_bk['booking_id']}",
                                    target_contract_bk,
                                    target_c_cust,
                                    target_c_car,
                                    c_net,
                                    target_contract_bk.get("rental_payment_method") or target_contract_bk.get("final_payment_method", "เงินสด"),
                                    item_desc="ค่าเช่ารถยนต์ (Vehicle Rental Fee)"
                                )
                                st.download_button(
                                    label="🧾 ใบเสร็จรับเงิน (Receipt)",
                                    data=pdf_rent_receipt,
                                    file_name=f"Receipt_Rental_{target_contract_bk['booking_id']}.pdf",
                                    mime="application/pdf",
                                    use_container_width=True,
                                    key=f"dl_btn_rent_rec_{target_contract_bk['booking_id']}"
                                )
                            except Exception as e:
                                st.error(f"ไม่สามารถสร้างใบเสร็จค่าเช่าได้: {e}")
                        else:
                            st.button("⏳ รอชำระค่าเช่าวันรับรถ", disabled=True, use_container_width=True, key=f"dis_rec_rent_{target_contract_bk['booking_id']}")

                    # ส่วนปุ่มยืนยันออกสัญญาเช่า และปุ่มไปชำระค่าเช่า (ตามขั้นตอนอัจฉริยะ)
                    st.markdown("<div style='height: 8px;'></div>", unsafe_allow_html=True)
                    c_c_act1, c_c_act2 = st.columns([1.5, 1.5])
                    with c_c_act1:
                        if not target_contract_bk.get("contract_issued"):
                            if st.button("✅ ยืนยันออกสัญญาเช่าเรียบร้อย (Mark Contract Issued)", key=f"btn_mark_contract_{target_contract_bk['booking_id']}", use_container_width=True):
                                target_contract_bk["contract_issued"] = True
                                for bk_item in st.session_state.bookings_db:
                                    if bk_item["booking_id"] == target_contract_bk["booking_id"]:
                                        bk_item["contract_issued"] = True
                                        break
                                _GLOBAL_STORE["bookings_db"] = st.session_state.bookings_db
                                try:
                                    sb_sync_booking(target_contract_bk)
                                except Exception:
                                    pass
                                st.success("✅ บันทึกสถานะออกสัญญาเช่าเรียบร้อย!")
                                time.sleep(0.5)
                                st.rerun()
                        else:
                            st.markdown("<div style='background:#F0FDF4; border:1px solid #BBF7D0; border-radius:6px; padding:7px 12px; font-size:12.5px; color:#15803D; font-weight:700;'>✅ ออกสัญญาเช่าเรียบร้อยแล้ว</div>", unsafe_allow_html=True)
                    with c_c_act2:
                        if not c_is_rent:
                            rem_rent_amt = float(target_contract_bk.get('remaining_rental', target_contract_bk.get('net_price', 0)))
                            if st.button(f"🧾 ไปหน้าชำระค่าเช่า (฿{rem_rent_amt:,.2f}) ➔", type="primary", use_container_width=True, key=f"btn_go_settle_{target_contract_bk['booking_id']}"):
                                target_contract_bk["contract_issued"] = True
                                for bk_item in st.session_state.bookings_db:
                                    if bk_item["booking_id"] == target_contract_bk["booking_id"]:
                                        bk_item["contract_issued"] = True
                                        break
                                _GLOBAL_STORE["bookings_db"] = st.session_state.bookings_db
                                try:
                                    sb_sync_booking(target_contract_bk)
                                except Exception:
                                    pass
                                st.session_state.active_settle_bk_id = target_contract_bk["booking_id"]
                                st.session_state.workflow_tab = "2. ชำระเงินจอง & การเงิน"
                                st.session_state["sb_unified_pay_mode"] = "🧾 ชำระค่าเช่า (Rental Settlement)"
                                st.session_state.payment_focus = True
                                st.rerun()

                    st.markdown("<div style='height: 12px;'></div>", unsafe_allow_html=True)
                    
                    # ปุ่มเสร็จสิ้นขั้นตอนทั้งหมด กลับสู่แผงควบคุมการจอง
                    if st.button("🎉 เสร็จสิ้นขั้นตอนทั้งหมด (กลับสู่แผงควบคุมการจอง ➔)", key="btn_finish_entire_workflow", type="secondary", use_container_width=True):
                        st.session_state.active_contract_bk_id = None
                        st.session_state.active_assign_bk_id = None
                        st.session_state.active_deposit_bk_id = None
                        st.session_state.draft_car = None
                        st.session_state.workflow_tab = "5. แผงควบคุมการจอง"
                        st.rerun()

            # ส่วนเพิ่มเติม: สำหรับกรณีต้องการจัดทำสัญญาเช่าลูกค้า Walk-in แบบเปิดฟอร์มทำโดยตรง
            with st.expander("➕ หรือสร้างสัญญาเช่าใหม่โดยตรง (Walk-in Direct Contract Formulation)", expanded=False):
                st.markdown("<div style='font-size:14px; font-weight:700; color:#1F2937; margin-bottom:10px;'>📝 จัดทำสัญญาเช่าใหม่โดยตรง (Walk-in Contract Formulation)</div>", unsafe_allow_html=True)
                
                sel_plate_walkin = st.selectbox("เลือกรถยนต์:", list(cars_db.keys()), key="sb_walkin_car")
                sel_car_walkin = cars_db.get(sel_plate_walkin) or {"brand": "-", "model": "-", "price_day": 0, "price_week": 0, "price_month": 0, "plate": "-"}
                
                sel_cust_walkin = st.selectbox("เลือกลูกค้า:", list(st.session_state.customers_db.keys()), key="sb_walkin_cust")
                
                w_c1, w_c2 = st.columns(2)
                with w_c1:
                    w_start_d = st.date_input("วันเริ่มเช่า", value=datetime.now().date(), key="w_start_d", format="DD/MM/YYYY")
                    w_start_t = st.time_input("เวลาส่งรถ", d_time(10, 0), key="w_start_t")
                with w_c2:
                    w_end_d = st.date_input("วันคืนรถ", value=datetime.now().date() + timedelta(days=3), key="w_end_d", format="DD/MM/YYYY")
                    w_end_t = st.time_input("เวลารับคืน", d_time(10, 0), key="w_end_t")
                    
                w_diff_days, w_ehr, w_emin, w_is_late, w_desc = calculate_rental_duration_and_days(w_start_d, w_start_t, w_end_d, w_end_t)
                if w_diff_days >= 30:
                    w_rate_type = "รายเดือน"
                    w_calc = (w_diff_days // 30) * sel_car_walkin['price_month'] + (w_diff_days % 30) * sel_car_walkin['price_day']
                elif w_diff_days >= 7:
                    w_rate_type = "รายสัปดาห์"
                    w_calc = (w_diff_days // 7) * sel_car_walkin['price_week'] + (w_diff_days % 7) * sel_car_walkin['price_day']
                else:
                    w_rate_type = "รายวัน"
                    w_calc = w_diff_days * sel_car_walkin['price_day']
                    
                w_discount = st.number_input("ส่วนลดพิเศษ (บาท)", value=0, min_value=0, key="w_discount")
                w_net = max(0, w_calc - w_discount)
                
                st.caption(f"ยอดคำนวณสุทธิ: ฿{w_net:,} ({w_rate_type} {w_diff_days} วัน)")
                
                if st.button("💾 ยืนยันการจองและบันทึกสัญญา (Confirm & Save Agreement)", key="btn_save_walkin_contract", type="primary", use_container_width=True):
                    w_new_id = f"MRC{datetime.now().strftime('%y%m%d%H%M%S')}"
                    w_bk_obj = {
                        "booking_id": w_new_id, "car_id": sel_plate_walkin, "customer": sel_cust_walkin,
                        "start_date": w_start_d, "start_time": w_start_t.strftime("%H:%M"),
                        "end_date": w_end_d, "end_time": w_end_t.strftime("%H:%M"),
                        "contract_type": w_rate_type, "billable_days": w_diff_days,
                        "base_price": w_calc, "discount": w_discount, "net_price": w_net,
                        "deposit_paid": False, "deposit_amount": 0.0,
                        "rental_paid": False, "remaining_rental": float(w_net),
                        "remaining_amount": float(w_net), "is_fully_paid": False,
                        "extension_history": [], "created_by": curr_username, "status": "รอชำระมัดจำ",
                        "worker_delivery": "Wait", "worker_return": "Wait",
                        "loc_delivery": "-", "loc_return": "-",
                        "dispatch_closed": False, "return_closed": False
                    }
                    st.session_state.bookings_db.append(w_bk_obj)
                    _GLOBAL_STORE["bookings_db"] = st.session_state.bookings_db
                    cars_db[sel_plate_walkin]['status'] = "ติดจอง"
                    sb_sync_car(sel_plate_walkin, cars_db[sel_plate_walkin])
                    sb_sync_booking(w_bk_obj)
                    st.session_state.active_deposit_bk_id = w_new_id
                    st.session_state.workflow_tab = "2. ชำระเงินจอง & การเงิน"
                    st.success(f"สร้างสัญญา Walk-in {w_new_id} สำเร็จ! นำท่านไปหน้าชำระเงินจอง...")
                    time.sleep(1)
                    st.rerun()

        # --- TAB 5: BOOKING DASHBOARD (แผงควบคุมคิวการจอง & งานทั้งหมด) ---
        elif current_tab in ["5. แผงควบคุมการจอง", "1. แผงควบคุมการจอง"]:
            with st.container(border=True):
                # รวบรวมงานจองทั้งหมดที่ยังไม่เสร็จสิ้น/ยกเลิก
                all_active_bks = [b for b in st.session_state.bookings_db if b.get('status') not in ["เสร็จสิ้น", "ยกเลิก"]]
                all_active_bks.sort(key=lambda x: str(x.get("booking_id", "")), reverse=True)
                
                # กรองเฉพาะงานที่ "รอชำระมัดจำ หรือ ยังไม่ได้มอบหมายคนขับ"
                unassigned_jobs = []
                for b in all_active_bks:
                    w_d = b.get("worker_delivery")
                    has_delivery_job = bool(w_d and str(w_d).strip() and str(w_d).strip() != "Wait")
                    is_pending_dep = (not b.get("deposit_paid")) or (b.get("status") == "รอชำระมัดจำ")
                    if is_pending_dep or not has_delivery_job:
                        unassigned_jobs.append(b)
                
                c_q_head, c_q_filter = st.columns([1.4, 1.6])
                with c_q_head:
                    pipe_hdr = translations[st.session_state.language].get("pipeline_title", "📋 แผงควบคุมคิวการจอง (Booking Operations)")
                    st.markdown(f"<h3 style='font-size:16px; font-weight:700;'>{pipe_hdr}</h3>", unsafe_allow_html=True)
                with c_q_filter:
                    q_view_mode = st.radio(
                        "ตัวกรองคิว:",
                        [f"📌 คิวรอลงใบงาน / รอมัดจำ ({len(unassigned_jobs)})", f"📋 งานจองทั้งหมด ({len(all_active_bks)})"],
                        horizontal=True,
                        label_visibility="collapsed",
                        key="rad_q_filter_mode"
                    )

                display_jobs = unassigned_jobs if "คิวรอลงใบงาน" in q_view_mode else all_active_bks
                
                # กรองตามคำค้นหาจากไซด์บาร์ถ้ามี
                sb_kw = st.session_state.get("global_search_kw", "").strip().lower()
                if sb_kw:
                    sb_kw_clean = sb_kw.replace("-", "").replace(" ", "")
                    display_jobs = [
                        b for b in display_jobs
                        if sb_kw in f"{b.get('booking_id','')} {b.get('customer','')} {b.get('car_id','')}".lower()
                        or sb_kw_clean in str(b.get('booking_id','')).lower().replace("-", "").replace(" ", "")
                        or sb_kw_clean in str(b.get('car_id','')).lower().replace("-", "").replace(" ", "")
                    ]
                    st.caption(f"🔎 กรองผลลัพธ์ตามคำค้นหาจากไซด์บาร์: **{sb_kw}**")
                
                btn_go_bo = translations[st.session_state.language].get("nav_back", "📋 Back Office (ตารางใบงาน)")
                if not display_jobs:
                    if sb_kw:
                        sb_kw_clean = sb_kw.replace("-", "").replace(" ", "")
                        matched_in_all = [
                            b for b in st.session_state.bookings_db 
                            if sb_kw in f"{b.get('booking_id','')} {b.get('customer','')} {b.get('car_id','')}".lower()
                            or sb_kw_clean in str(b.get('booking_id','')).lower().replace("-", "").replace(" ", "")
                            or sb_kw_clean in str(b.get('car_id','')).lower().replace("-", "").replace(" ", "")
                        ]
                        if matched_in_all:
                            target_matched = matched_in_all[0]
                            st.info(f"📌 พบรหัสการจอง **{target_matched['booking_id']}** (รถ {target_matched['car_id']}) — สามารถดูรายละเอียดได้ที่ Back Office")
                            if st.button(f"📋 ไปที่ Back Office เพื่อดูใบงาน {target_matched['booking_id']}", type="primary"):
                                st.session_state.selected_module = "Back Office"
                                st.rerun()
                        else:
                            st.info(f"🔍 ไม่พบรายการจองตามคำค้นหา '{sb_kw}'")
                    else:
                        if "คิวรอลงใบงาน" in q_view_mode and all_active_bks:
                            st.success(f"✅ **ไม่มีงานค้างในคิวรอลงใบงาน** (มีงานจองที่ลงใบงานแล้ว {len(all_active_bks)} รายการ แสดงอยู่ใน 'Back Office (ตารางใบงาน)' หรือสลับดูที่แท็บ 'งานจองทั้งหมด' ด้านบน)")
                            c_no_j1, c_no_j2 = st.columns([1.5, 1.5])
                            with c_no_j1:
                                if st.button("➕ สร้างรายการจองใหม่ (ไปที่หน้าเลือกรถ)", type="primary", use_container_width=True):
                                    st.session_state.workflow_tab = "1. เลือกรถยนต์"
                                    st.rerun()
                            with c_no_j2:
                                if st.button(btn_go_bo, type="secondary", use_container_width=True, key="btn_go_bo_1"):
                                    st.session_state.selected_module = "Back Office"
                                    st.rerun()
                        else:
                            st.info("📋 **ยังไม่มีรายการจองในระบบ** กดปุ่มด้านล่างเพื่อเริ่มเลือกรถและจัดทำสัญญาได้ทันที")
                            c_no_j1, c_no_j2 = st.columns([1.5, 1.5])
                            with c_no_j1:
                                if st.button("➕ สร้างรายการจองใหม่ (ไปที่หน้าเลือกรถ)", type="primary", use_container_width=True):
                                    st.session_state.workflow_tab = "1. เลือกรถยนต์"
                                    st.rerun()
                            with c_no_j2:
                                if st.button(btn_go_bo, type="secondary", use_container_width=True, key="btn_go_bo_2"):
                                    st.session_state.selected_module = "Back Office"
                                    st.rerun()
                else:
                    st.caption("📌 แสดงรายการจอง (สามารถกดรับมัดจำเพื่อออกสัญญา หรือกดออกใบงานเพื่อมอบหมายคนขับได้ทันที)")
                    for b in display_jobs:
                        b_id = b['booking_id']
                        c_info = cars_db.get(b['car_id'], {})
                        is_dep_paid = b.get('deposit_paid', False)
                        is_rent_paid = b.get('rental_paid', False)
                        w_d_val = b.get("worker_delivery")
                        has_worker = bool(w_d_val and str(w_d_val).strip() not in ["Wait", "-", ""])
                        
                        # สร้างลิงก์ดาวน์โหลดสัญญาเช่าล่วงหน้าถ้ามัดจำแล้ว
                        contract_link_html = ""
                        if is_dep_paid:
                            try:
                                pdf_c_t1 = generate_filled_pdf("rental_template_blank_v2.pdf", b, st.session_state.customers_db.get(b['customer']), c_info)
                                b64_c_t1 = base64.b64encode(pdf_c_t1).decode()
                                contract_link_html = f'<br/><a href="data:application/pdf;base64,{b64_c_t1}" download="Agreement_{b_id}.pdf" style="font-size:11px; font-weight:700; color:#2563EB; text-decoration:none;" title="ดาวน์โหลดสัญญาเช่า (มัดจำแล้ว)">📝 สัญญาเช่า (PDF)</a>'
                            except Exception:
                                pass
                        
                        # ดึงข้อมูลเบอร์โทรลูกค้า
                        c_cust_obj = st.session_state.customers_db.get(b['customer'], {})
                        c_phone_no = c_cust_obj.get("contact_no", "")
                        c_phone_tag = f"<br/><span style='font-size:11px; color:#6B7280;'>📞 {c_phone_no}</span>" if c_phone_no and c_phone_no != "-" else ""
                        
                        with st.container(border=True):
                            c_id, c_car, c_date, c_price, c_act1, c_act2, c_act3 = st.columns([1.5, 1.8, 1.8, 1.5, 1.4, 1.3, 0.7])
                            with c_id:
                                st.markdown(f"<div style='line-height:1.35;'><b style='color: #E85826; font-size: 14px;'>{b['booking_id']}</b><br/><b style='font-size: 12.5px; color: #1F2937;'>👤 {b['customer']}</b>{c_phone_tag}</div>", unsafe_allow_html=True)
                            with c_car:
                                st.markdown(f"<div style='line-height:1.35;'><b style='font-size: 14px;'>🚘 {b['car_id']}</b><br/><span style='font-size: 12px; color: #666;'>{c_info.get('brand','')} {c_info.get('model','')}</span></div>", unsafe_allow_html=True)
                            with c_date:
                                st.markdown(f"<div style='font-size: 12px; line-height: 1.45;'>📅 {format_date_dmy(b['start_date'])} ({b.get('start_time', '10:00')})<br/>ถึง {format_date_dmy(b['end_date'])} ({b.get('end_time', '10:00')})</div>", unsafe_allow_html=True)
                            with c_price:
                                dep_txt = '<span style="color:#EA580C; font-size:11.5px; font-weight:700;">🟡 รอชำระมัดจำ ฿5,000</span>' if not is_dep_paid else ('<span style="color:#10B981; font-size:11.5px; font-weight:700;">🟢 มัดจำแล้ว</span>' + (' | <span style="color:#C2410C; font-size:11.5px;">รอจ่ายค่าเช่า</span>' if not is_rent_paid else ' | <span style="color:#10B981; font-size:11.5px;">ครบแล้ว</span>'))
                                st.markdown(f"<div style='font-size: 12.5px; line-height:1.35;'><span style='color:#6B7280;'>ค่าเช่า:</span> <b>฿{float(b.get('net_price', 0)):,.2f}</b><br/>{dep_txt}{contract_link_html}</div>", unsafe_allow_html=True)
                            with c_act1:
                                if not is_dep_paid or b.get('status') == "รอชำระมัดจำ":
                                    if st.button("● รอมัดจำ\n฿5,000", key=f"btn_q_dep_{b_id}", use_container_width=True, help="💳 คลิกเพื่อรับชำระมัดจำ ฿5,000 (ล็อกคิว/ออกสัญญา)"):
                                        st.session_state.active_deposit_bk_id = b_id
                                        st.session_state.payment_focus = True
                                        st.session_state.workflow_tab = "2. ชำระเงินจอง & การเงิน"
                                        st.rerun()
                                else:
                                    st.button("🟢 มัดจำแล้ว", key=f"btn_q_depdone_{b_id}", disabled=True, use_container_width=True)
                            with c_act2:
                                if has_worker:
                                    if st.button(f"📋 ดูใน Back Office\n({w_d_val})", key=f"btn_q_bo_{b_id}", type="secondary", use_container_width=True, help=f"มอบหมาย {w_d_val} แล้ว — คลิกเพื่อจัดการใน Back Office"):
                                        st.session_state.selected_module = "Back Office"
                                        st.rerun()
                                else:
                                    if st.button("🚚 ออกใบงาน", key=f"btn_q_assign_{b_id}", type="primary", use_container_width=True, help="🚚 คลิกเพื่อออกใบงานจัดส่ง & มอบหมายคนขับ"):
                                        st.session_state.active_assign_bk_id = b_id
                                        st.session_state.workflow_tab = "3. ใบงานส่ง/รับรถ"
                                        st.rerun()
                            with c_act3:
                                del_key = f"del_confirm_{b_id}"
                                if not st.session_state.get(del_key, False):
                                    if st.button("🗑️", key=f"btn_q_del_{b_id}", use_container_width=True, help="ลบรายการจองนี้ออกจากระบบ"):
                                        st.session_state[del_key] = True
                                        st.rerun()
                                else:
                                    cd_y, cd_n = st.columns(2)
                                    with cd_y:
                                        if st.button("🗑️ ลบข้อมูล (Delete)", key=f"btn_del_y_{b_id}", type="primary", use_container_width=True):
                                            st.session_state.bookings_db = [x for x in st.session_state.bookings_db if x.get("booking_id") != b_id]
                                            _GLOBAL_STORE["bookings_db"] = st.session_state.bookings_db
                                            sb_delete_booking(b_id)
                                            if b.get('car_id') in cars_db:
                                                cars_db[b['car_id']]['status'] = "ว่างพร้อมใช้งาน"
                                                sb_sync_car(b['car_id'], cars_db[b['car_id']])
                                            st.session_state.pop(del_key, None)
                                            st.success(f"ลบรายการจอง {b_id} เรียบร้อย")
                                            time.sleep(0.5)
                                            st.rerun()
                                    with cd_n:
                                        if st.button("ไม่", key=f"btn_del_n_{b_id}", use_container_width=True):
                                            st.session_state.pop(del_key, None)
                                            st.rerun()

                st.markdown("---")
                if st.button("➕ สร้างรายการจองใหม่ (ไปยังหน้าเลือกรถ)", type="primary"):
                    st.session_state.workflow_tab = "1. เลือกรถยนต์"
                    st.rerun()

    # =========================================================================
    # 7.2 BACK OFFICE MODULE
    # =========================================================================
    elif module == "Back Office":
        curr_u = st.session_state.user or {}
        curr_username = curr_u.get("username", "admin")
        curr_role = curr_u.get("role", "Staff")
        is_admin_user = (curr_role == "Admin" or curr_username.lower() == "admin")
        
        bo_page_title = translations[st.session_state.language].get("bo_page_title", "📋 Back Office (ตารางใบงานสำหรับคนงาน / พนักงานขับรถ)")
        bo_page_subtitle = translations[st.session_state.language].get("bo_page_subtitle", "Vehicle Dispatch & Return Work Orders Table & PDF Document Center")
        if is_admin_user:
            bo_privilege = translations[st.session_state.language].get("bo_admin_privilege", "👑 สิทธิ์ผู้ดูแลระบบ (Admin): ส่งงานได้ทุกใบงาน")
        else:
            bo_privilege = translations[st.session_state.language].get("bo_staff_privilege", f"👷 สิทธิ์พนักงาน: {curr_username} (ส่งงานได้เฉพาะงานที่ได้รับมอบหมาย)").replace("{name}", curr_username)
        bo_table_title = translations[st.session_state.language].get("bo_table_title", "🚚 รายการใบงานรับ-ส่งรถทั้งหมดในระบบ")
        
        st.markdown(f"""
            <div style="margin-bottom: 16px;">
                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
                    <div>
                        <h1 style="font-size: 25px; font-weight: 700; color: #1F2937; margin: 0;">{bo_page_title}</h1>
                        <div style="font-size: 12px; color: #6B7280; margin-top: 4px;">{bo_page_subtitle}</div>
                    </div>
                    <div>
                        <span style="background:{'#FFF7ED' if is_admin_user else '#EFF6FF'}; border:1.5px solid {'#FDBA74' if is_admin_user else '#BFDBFE'}; color:{'#C2410C' if is_admin_user else '#1D4ED8'}; padding:6px 14px; border-radius:20px; font-size:12px; font-weight:700;">
                            {bo_privilege}
                        </span>
                    </div>
                </div>
            </div>
        """, unsafe_allow_html=True)
        
        with st.container(border=True):
            st.markdown(f"<h3 style='font-size:16px; font-weight:700;'>{bo_table_title}</h3>", unsafe_allow_html=True)
            
            jobs_list = []
            # งานที่ส่งงานครบทั้งสองงานแล้วจะถูกแบคอัพลง completed_jobs_db และไม่แสดงใน Back Office อีก
            archived_ids = {cj.get("booking_id") for cj in st.session_state.completed_jobs_db}
            for b in reversed(st.session_state.bookings_db):
                if b.get("status") in ["ยกเลิก", "เสร็จสิ้น"] or b.get("booking_id") in archived_ids:
                    continue
                
                is_disp_closed = bool(b.get("dispatch_closed", False)) or (b.get("status") in ["กำลังเช่า", "เตรียมรับคืน"])
                is_ret_closed = bool(b.get("return_closed", False))
                
                # 1. งานจัดส่งรถ (Dispatch): แสดงเฉพาะเมื่อยังไม่ได้ปิดงานจัดส่ง
                # เมื่อส่งมอบรถเรียบร้อย งานนี้จะหายไปจากตารางทันที คงเหลือเฉพาะงานรับรถคืน
                if not is_disp_closed:
                    w_del = b.get("worker_delivery")
                    jobs_list.append({
                        "ประเภทใบงาน": "จัดส่งรถ (Dispatch)",
                        "job_type": "Dispatch",
                        "รหัสการจอง": b["booking_id"],
                        "ทะเบียนรถ": b["car_id"],
                        "ลูกค้า": b["customer"],
                        "กำหนดวัน": f"{format_date_dmy(b.get('start_date'))} ({b.get('start_time', '10:00')}) - {format_date_dmy(b.get('end_date'))} ({b.get('end_time', '10:00')})",
                        "พนักงานปฏิบัติงาน": w_del if w_del else "Wait",
                        "สถานที่": b.get("loc_delivery") or "-",
                        "สถานะ": b.get("status", "รอส่งมอบ"),
                        "is_locked": False,
                        "_booking_obj": b
                    })
                
                # 2. งานรับรถคืน (Return): แสดงเสมอจนกว่าจะปิดงานรับรถคืน
                if not is_ret_closed:
                    w_ret = b.get("worker_return")
                    # ป้องกันการเลือกผิดขั้นตอน: ต้องปิดงานส่งมอบรถก่อน จึงจะเปิดรับรถคืนได้
                    is_ret_locked = not is_disp_closed
                    ret_status = "🔒 รอส่งรถก่อน" if is_ret_locked else (b.get("status") if b.get("status") != "รอชำระมัดจำ" else "รอรับคืน")
                    jobs_list.append({
                        "ประเภทใบงาน": "รับรถคืน (Return)",
                        "job_type": "Return",
                        "รหัสการจอง": b["booking_id"],
                        "ทะเบียนรถ": b["car_id"],
                        "ลูกค้า": b["customer"],
                        "กำหนดวัน": f"คืน: {format_date_dmy(b.get('end_date'))} ({b.get('end_time', '10:00')})",
                        "พนักงานปฏิบัติงาน": w_ret if w_ret else "Wait",
                        "สถานที่": b.get("loc_return") or b.get("loc_delivery") or "-",
                        "สถานะ": ret_status,
                        "is_locked": is_ret_locked,
                        "_booking_obj": b
                    })
            
            # ให้งานใหม่อยู่ข้างบนเสมอ (เรียงรหัสการจองจากใหม่ไปเก่า)
            jobs_list.sort(key=lambda x: (x["รหัสการจอง"], x["job_type"] == "Dispatch"), reverse=True)
            
            bo_kw = st.session_state.get("global_search_kw", "").strip().lower()
            if bo_kw:
                bo_kw_clean = bo_kw.replace("-", "").replace(" ", "")
                jobs_list = [
                    j for j in jobs_list
                    if bo_kw in f"{j['รหัสการจอง']} {j['ทะเบียนรถ']} {j['ลูกค้า']} {j['พนักงานปฏิบัติงาน']} {j['สถานที่']} {j['กำหนดวัน']}".lower()
                    or bo_kw_clean in str(j['รหัสการจอง']).lower().replace("-", "").replace(" ", "")
                    or bo_kw_clean in str(j['ทะเบียนรถ']).lower().replace("-", "").replace(" ", "")
                ]
                st.caption(f"🔎 กรองตารางใบงานตามคำค้นหาจากไซด์บาร์: **{bo_kw}**")
            
            # --- เช็กลิสต์ส่งมอบงาน & ตรวจสภาพรถเพื่อปิดงาน (Handover & Inspection) ---
            # ให้ query_params มีลำดับความสำคัญสูงสุดเมื่อคลิกมาจากตาราง ป้องกันการเปิดงานผิดคัน
            q_close_id = st.query_params.get("close_job")
            q_close_type = st.query_params.get("close_type")
            
            if q_close_id:
                target_close_id = q_close_id
                target_close_type = q_close_type or "Dispatch"
                st.session_state.active_close_job_id = target_close_id
                st.session_state.active_close_job_type = target_close_type
            else:
                target_close_id = st.session_state.get("active_close_job_id")
                target_close_type = st.session_state.get("active_close_job_type") or "Dispatch"
            
            if target_close_id:
                target_close_bk = next((b for b in st.session_state.bookings_db if b["booking_id"] == target_close_id), None)
                if target_close_bk and target_close_bk.get("status") != "เสร็จสิ้น":
                    car_info_c = cars_db.get(target_close_bk["car_id"], {})
                    cust_info_c = st.session_state.customers_db.get(target_close_bk["customer"], {})
                    
                    # ตรวจสอบประเภทงานให้ตรงกับสถานะจริง (ถ้าส่งมอบไปแล้ว งานที่เหลือต้องเป็นงานรับรถคืนเท่านั้น)
                    is_disp_done = bool(target_close_bk.get("dispatch_closed", False)) or (target_close_bk.get("status") in ["กำลังเช่า", "เตรียมรับคืน"])
                    if target_close_type == "Dispatch" and is_disp_done:
                        target_close_type = "Return"
                        st.session_state.active_close_job_type = "Return"
                    
                    is_dispatch_step = (target_close_type == "Dispatch")
                    
                    # ตรวจสอบความถูกต้องตามลำดับงาน (Sequence Guard: ห้ามรับรถก่อนส่งมอบ)
                    is_sequence_blocked = (not is_dispatch_step) and (not is_disp_done)
                    
                    # ตรวจสอบสิทธิ์ผู้ใช้งานว่าได้รับมอบหมายงานนี้หรือไม่
                    if is_dispatch_step:
                        assigned_worker = target_close_bk.get("worker_delivery")
                    else:
                        assigned_worker = target_close_bk.get("worker_return")
                        
                    assigned_workers = [assigned_worker] if assigned_worker else []
                    is_worker_authorized = not is_sequence_blocked
                    
                    with st.container(border=True):
                        if is_sequence_blocked:
                            st_header_badge = "⛔ ถูกระงับ (ต้องปิดงานส่งรถก่อน)"
                            st_badge_bg = "#EF4444"
                        else:
                            st_header_badge = f"กำลังตรวจ{'ส่งมอบรถ (Dispatch)' if is_dispatch_step else 'รับรถคืน (Return)'}"
                            st_badge_bg = "#EA580C"
                        
                        step_title = "📤 1. เช็กลิสต์ตรวจสภาพและส่งมอบรถ (Dispatch Handover)" if is_dispatch_step else "📥 2. เช็กลิสต์ตรวจสภาพรับรถคืน & ปิดจ๊อบ (Return & Final Archive)"
                        
                        st.markdown(f"""
                            <div style="background: linear-gradient(135deg, {'#FFF7ED' if is_worker_authorized else '#FEF2F2'} 0%, {'#FFFBEB' if is_worker_authorized else '#FFF1F2'} 100%); border: 1.5px solid {'#FDBA74' if is_worker_authorized else '#FCA5A5'}; border-radius: 12px; padding: 16px 20px; margin-bottom: 16px;">
                                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
                                    <div>
                                        <h3 style="margin:0; font-size:18px; font-weight:800; color:{'#9A3412' if is_worker_authorized else '#991B1B'}; display:flex; align-items:center; gap:8px;">
                                            <span>{'📤' if is_dispatch_step else '📥'}</span> {step_title}
                                        </h3>
                                        <div style="font-size:13px; color:{'#C2410C' if is_worker_authorized else '#B91C1C'}; margin-top:4px;">
                                            รหัสการจอง: <b>{target_close_bk['booking_id']}</b> | ทะเบียนรถ: <b>{target_close_bk['car_id']}</b> ({car_info_c.get('brand','')} {car_info_c.get('model','')}) | ลูกค้า: <b>{target_close_bk['customer']}</b>
                                        </div>
                                    </div>
                                    <div>
                                        <span style="background:{st_badge_bg}; color:white; padding:5px 14px; border-radius:20px; font-size:12px; font-weight:700;">{st_header_badge}</span>
                                    </div>
                                </div>
                            </div>
                        """, unsafe_allow_html=True)
                        
                        if is_sequence_blocked:
                            st.error(f"⛔ **ป้องกันการเลือกผิด / ข้ามขั้นตอน:** งานรหัส **{target_close_bk['booking_id']}** ยังไม่ได้ส่งมอบรถให้ลูกค้า (ยังไม่ปิดงานส่งรถ)! คุณต้องเลือกปิดงาน **'จัดส่งรถ (Dispatch)'** ให้เสร็จสิ้นก่อน จึงจะสามารถทำรายการรับรถคืนได้")
                        
                        # ข้อมูลสรุป
                        c_det1, c_det2, c_det3 = st.columns(3)
                        with c_det1:
                            st.caption(f"🚘 **รถยนต์:** {car_info_c.get('brand', '')} {car_info_c.get('model', '')} ({car_info_c.get('color', '')})")
                            st.caption(f"🏢 **สังกัดบริษัท:** {car_info_c.get('company', 'Sawasdee Rent A Car')}")
                        with c_det2:
                            w_assigned = assigned_worker or 'ไม่ระบุ'
                            loc_assigned = (target_close_bk.get('loc_delivery') if is_dispatch_step else target_close_bk.get('loc_return')) or '-'
                            st.caption(f"👷 **พนักงานผู้ปฏิบัติงาน:** {w_assigned}")
                            st.caption(f"📍 **สถานที่นัดหมาย:** {loc_assigned}")
                        with c_det3:
                            st.caption(f"📅 **กำหนดส่ง-คืน:** {format_date_dmy(target_close_bk.get('start_date'))} ({target_close_bk.get('start_time', '10:00')}) ถึง {format_date_dmy(target_close_bk.get('end_date'))} ({target_close_bk.get('end_time', '10:00')})")
                            st.caption(f"💰 **ยอดค่าเช่าสุทธิ:** ฿{float(target_close_bk.get('net_price', 0)):,.2f}")
                            
                        st.markdown("<hr style='margin:10px 0 16px; border:0.5px solid #F3EDE4;'>", unsafe_allow_html=True)
                        
                        # 1. วันและเวลาปฏิบัติงานจริง & คำนวณค่าปรับคืนรถล่าช้าเกิน 4 ชม.
                        if is_dispatch_step:
                            st.markdown("<h4 style='font-size:15px; font-weight:700; color:#1F2937; margin:0 0 8px 0;'>⏱️ 1. บันทึกวันและเวลาส่งมอบรถจริง (Actual Dispatch Time):</h4>", unsafe_allow_html=True)
                            c_dt_d1, c_dt_d2 = st.columns(2)
                            with c_dt_d1:
                                init_disp_d = to_date(target_close_bk.get('start_date')) or date.today()
                                act_disp_d = st.date_input("วันที่ส่งมอบจริง:", value=init_disp_d, key=f"insp_act_disp_d_{target_close_id}", disabled=(not is_worker_authorized))
                            with c_dt_d2:
                                init_disp_t = parse_time_val(target_close_bk.get('start_time'), d_time(10, 0))
                                act_disp_t = st.time_input("เวลาส่งมอบจริง:", value=init_disp_t, key=f"insp_act_disp_t_{target_close_id}", disabled=(not is_worker_authorized))
                            
                            st.caption(f"📌 นัดหมายตามสัญญา: {format_date_dmy(target_close_bk.get('start_date'))} ({target_close_bk.get('start_time', '10:00')}) | ส่งมอบจริง: {format_date_dmy(act_disp_d)} ({act_disp_t.strftime('%H:%M')})")
                            st.markdown("<hr style='margin:12px 0 16px; border:0.5px solid #F3EDE4;'>", unsafe_allow_html=True)
                            insp_late_fee = 0.0
                        else:
                            st.markdown("<h4 style='font-size:15px; font-weight:700; color:#1F2937; margin:0 0 8px 0;'>⏱️ 1. ตรวจสอบเวลารับรถคืน & คำนวณค่าปรับกรณีล่าช้า (Return Time & Delay Penalty Check):</h4>", unsafe_allow_html=True)
                            
                            sched_end_d = to_date(target_close_bk.get('end_date')) or date.today()
                            sched_end_t = parse_time_val(target_close_bk.get('end_time'), d_time(10, 0))
                            sched_end_dt = datetime.combine(sched_end_d, sched_end_t)
                            
                            c_dt_r1, c_dt_r2 = st.columns(2)
                            with c_dt_r1:
                                act_ret_d = st.date_input("วันที่รับรถคืนจริง:", value=date.today(), key=f"insp_act_ret_d_{target_close_id}", disabled=(not is_worker_authorized))
                            with c_dt_r2:
                                now_time_round = datetime.now().time().replace(second=0, microsecond=0)
                                act_ret_t = st.time_input("เวลารับรถคืนจริง:", value=now_time_round, key=f"insp_act_ret_t_{target_close_id}", disabled=(not is_worker_authorized))
                            
                            act_ret_dt = datetime.combine(act_ret_d, act_ret_t)
                            
                            # คำนวณความล่าช้า
                            car_day_rate = float(car_info_c.get("price_day") or 0)
                            if car_day_rate <= 0:
                                car_day_rate = float(target_close_bk.get("net_price", 0)) / max(1, target_close_bk.get("billable_days", 1))
                                
                            diff_delay = act_ret_dt - sched_end_dt
                            delay_seconds = int(diff_delay.total_seconds())
                            is_late_flag = delay_seconds > 0
                            delay_hours = max(0, delay_seconds // 3600)
                            delay_mins = max(0, (delay_seconds % 3600) // 60)
                            
                            is_delay_over_4hr = delay_hours > 4 or (delay_hours == 4 and delay_mins > 0)
                            
                            if is_delay_over_4hr:
                                st.markdown(f"""
                                    <div style="background:#FFF1F2; border:1.5px solid #F43F5E; border-radius:10px; padding:12px 16px; margin:10px 0 12px 0;">
                                        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                                            <div>
                                                <b style="color:#BE123C; font-size:14px;">⚠️ ลูกค้าคืนรถล่าช้าเกินกำหนดมากกว่า 4 ชั่วโมง!</b>
                                                <div style="color:#9F1239; font-size:12.5px; margin-top:3px; line-height:1.5;">
                                                    • กำหนดคืนตามสัญญา: <b>{format_date_dmy(sched_end_d)} เวลา {sched_end_t.strftime('%H:%M')}</b><br/>
                                                    • รับรถคืนจริง: <b>{format_date_dmy(act_ret_d)} เวลา {act_ret_t.strftime('%H:%M')}</b><br/>
                                                    • ระยะเวลาล่าช้า: <b>{delay_hours} ชั่วโมง {delay_mins} นาที</b> (เกิน 4 ชม. ปรับคิดเพิ่มเป็น 1 วันเต็ม)
                                                </div>
                                            </div>
                                            <div>
                                                <span style="background:#E11D48; color:white; padding:6px 14px; border-radius:20px; font-weight:800; font-size:13px;">
                                                    ปรับ 1 วันเต็ม: +฿{car_day_rate:,.2f}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                """, unsafe_allow_html=True)
                                def_late_fee = float(car_day_rate)
                            elif is_late_flag:
                                st.markdown(f"""
                                    <div style="background:#F0FDF4; border:1px solid #86EFAC; border-radius:10px; padding:10px 14px; margin:10px 0 12px 0;">
                                        <b style="color:#15803D; font-size:13px;">⏱️ คืนรถเกินเวลา {delay_hours} ชั่วโมง {delay_mins} นาที (อยู่ในเกณฑ์อนุโลม ไม่เกิน 4 ชั่วโมง)</b>
                                        <div style="color:#166534; font-size:12px; margin-top:2px;">
                                            กำหนดคืน: {format_date_dmy(sched_end_d)} {sched_end_t.strftime('%H:%M')} | รับคืนจริง: {format_date_dmy(act_ret_d)} {act_ret_t.strftime('%H:%M')} ➔ <b>อนุโลมไม่คิดค่าปรับ</b>
                                        </div>
                                    </div>
                                """, unsafe_allow_html=True)
                                def_late_fee = 0.0
                            else:
                                st.markdown(f"""
                                    <div style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:10px; padding:10px 14px; margin:10px 0 12px 0;">
                                        <b style="color:#334155; font-size:13px;">✅ รับรถคืนตรงตามเวลา หรือคืนก่อนกำหนด</b>
                                        <div style="color:#64748B; font-size:12px; margin-top:2px;">
                                            กำหนดคืน: {format_date_dmy(sched_end_d)} {sched_end_t.strftime('%H:%M')} | รับคืนจริง: {format_date_dmy(act_ret_d)} {act_ret_t.strftime('%H:%M')}
                                        </div>
                                    </div>
                                """, unsafe_allow_html=True)
                                def_late_fee = 0.0
                                
                            c_lf1, c_lf2 = st.columns([2.5, 1.5])
                            with c_lf1:
                                insp_late_fee = st.number_input(
                                    "💰 ค่าปรับคืนรถล่าช้า (THB):",
                                    min_value=0.0,
                                    step=100.0,
                                    value=def_late_fee,
                                    key=f"insp_late_fee_{target_close_id}_{target_close_type}",
                                    disabled=(not is_worker_authorized)
                                )
                            with c_lf2:
                                st.caption("💡 หากล่าช้าเกิน 4 ชม. ระบบคำนวณค่าปรับ 1 วันเต็ม (ตามเรทรายวัน) สามารถปรับเปลี่ยนได้ตามข้อตกลงหน้างาน")
                                
                            st.markdown("<hr style='margin:12px 0 16px; border:0.5px solid #F3EDE4;'>", unsafe_allow_html=True)
                        
                        # 2. เกจ์น้ำมัน
                        fuel_label = "⛽ 2. ตรวจสอบระดับเกจ์วัดน้ำมันก่อนส่งมอบรถ (Fuel Gauge Level):" if is_dispatch_step else "⛽ 2. ตรวจสอบระดับเกจ์วัดน้ำมันตอนรับรถคืน (Fuel Gauge Level):"
                        st.markdown(f"<h4 style='font-size:15px; font-weight:700; color:#1F2937; margin:0 0 8px 0;'>{fuel_label}</h4>", unsafe_allow_html=True)
                        fuel_options = [
                            "⛽ เต็มถัง (Full - 8/8) [100%]",
                            "⛽ เกือบเต็ม (7/8 ถัง) [87%]",
                            "⛽ 3/4 ถัง (6/8 ถัง) [75%]",
                            "⛽ ครึ่งถัง (1/2 ถัง) [50%]",
                            "⛽ 1/4 ถัง (2/8 ถัง) [25%]",
                            "⛽ 1/8 ถัง [12%]",
                            "⚠️ ไฟเตือนน้ำมันขึ้น (Reserve / ใกล้หมด)"
                        ]
                        c_fuel1, c_fuel2 = st.columns([2.5, 1.5])
                        with c_fuel1:
                            sel_fuel = st.radio("ระดับน้ำมันในถัง:", fuel_options, index=0, key=f"insp_fuel_{target_close_id}_{target_close_type}", horizontal=False, disabled=(not is_worker_authorized))
                        with c_fuel2:
                            fuel_fee = st.number_input("ค่าน้ำมันส่วนต่าง / ค่าปรับน้ำมันไม่เต็มถัง (ถ้ามี - THB):", min_value=0.0, step=100.0, value=0.0, key=f"insp_fuel_fee_{target_close_id}_{target_close_type}", disabled=(not is_worker_authorized))
                            st.caption("💡 หากระดับน้ำมันไม่เต็มถัง สามารถระบุค่าปรับน้ำมันเพื่อบันทึกลงในใบเสร็จ/รายงานการเงินได้")
                        
                        st.markdown("<hr style='margin:12px 0 16px; border:0.5px solid #F3EDE4;'>", unsafe_allow_html=True)
                        
                        # 3. เช็กลิสต์สภาพรถ
                        chk_hdr = "🔍 3. เช็กลิสต์ตรวจสภาพรถยนต์ก่อนส่งมอบ (Dispatch Checklist)" if is_dispatch_step else "🔍 3. เช็กลิสต์ตรวจสภาพรถยนต์ตอนรับคืน (Return Checklist)"
                        st.markdown(f"<h4 style='font-size:15px; font-weight:700; color:#1F2937; margin:0 0 8px 0;'>{chk_hdr}</h4>", unsafe_allow_html=True)
                        chk_c1, chk_c2 = st.columns(2)
                        with chk_c1:
                            st.markdown("<b style='font-size:12.5px; color:#4B5563;'>สภาพภายนอก & ระบบขับเคลื่อน:</b>", unsafe_allow_html=True)
                            chk_body = st.checkbox("ตัวถังและสีรอบคันสมบูรณ์ (ไม่มีรอยชน/ขีดข่วนใหม่)", value=True, key=f"chk_body_{target_close_id}_{target_close_type}", disabled=(not is_worker_authorized))
                            chk_glass = st.checkbox("กระจกบังลมหน้า-หลัง และกระจกมองข้างปกติ (ไม่แตกร้าว)", value=True, key=f"chk_glass_{target_close_id}_{target_close_type}", disabled=(not is_worker_authorized))
                            chk_tires = st.checkbox("สภาพยางและแรงดันลมยางทั้ง 4 เส้นสมบูรณ์", value=True, key=f"chk_tires_{target_close_id}_{target_close_type}", disabled=(not is_worker_authorized))
                            chk_lights = st.checkbox("ระบบไฟส่องสว่าง (ไฟหน้า/ท้าย/ไฟเลี้ยว) ทำงานปกติ", value=True, key=f"chk_lights_{target_close_id}_{target_close_type}", disabled=(not is_worker_authorized))
                        with chk_c2:
                            st.markdown("<b style='font-size:12.5px; color:#4B5563;'>ภายในห้องโดยสาร & อุปกรณ์ประจำรถ:</b>", unsafe_allow_html=True)
                            chk_clean = st.checkbox("ความสะอาดภายในห้องโดยสารและเบาะที่นั่ง", value=True, key=f"chk_clean_{target_close_id}_{target_close_type}", disabled=(not is_worker_authorized))
                            chk_tools = st.checkbox("ยางอะไหล่และชุดแม่แรงเครื่องมือประจำรถครบถ้วน", value=True, key=f"chk_tools_{target_close_id}_{target_close_type}", disabled=(not is_worker_authorized))
                            chk_key = st.checkbox("กุญแจรีโมท ป้ายภาษี และเอกสารคู่มือประจำรถครบ", value=True, key=f"chk_key_{target_close_id}_{target_close_type}", disabled=(not is_worker_authorized))
                            chk_ac = st.checkbox("ระบบปรับอากาศ (แอร์เย็นปกติ) และวิทยุใช้งานได้", value=True, key=f"chk_ac_{target_close_id}_{target_close_type}", disabled=(not is_worker_authorized))
                            
                        c_mile, c_note = st.columns([1.5, 2.5])
                        with c_mile:
                            cur_mileage = st.text_input(f"เลขไมล์ปัจจุบันเมื่อ{'ส่งมอบ' if is_dispatch_step else 'รับคืน'} (กม.):", value=car_info_c.get("mileage", "45,000"), key=f"mile_{target_close_id}_{target_close_type}", disabled=(not is_worker_authorized))
                        with c_note:
                            insp_memo = st.text_input("หมายเหตุสภาพรถ / บันทึกรอยแผลหรือของลูกค้าลืม (ถ้ามี):", value=f"ตรวจสภาพรถยนต์และเกจ์น้ำมัน{'ส่งมอบ' if is_dispatch_step else 'รับคืน'}เรียบร้อยดี", key=f"memo_{target_close_id}_{target_close_type}", disabled=(not is_worker_authorized))
                            
                        st.markdown("<hr style='margin:12px 0 16px; border:0.5px solid #F3EDE4;'>", unsafe_allow_html=True)
                        
                        # 4. อัปโหลดรูปภาพสภาพรถ & เกจ์น้ำมัน
                        photo_hdr = "📸 4. อัปโหลดรูปภาพสภาพรถก่อนส่งมอบ & เกจ์น้ำมัน (Dispatch Photos)" if is_dispatch_step else "📸 4. อัปโหลดรูปภาพสภาพรถตอนรับคืน & เกจ์น้ำมัน (Return Photos)"
                        st.markdown(f"<h4 style='font-size:15px; font-weight:700; color:#1F2937; margin:0 0 8px 0;'>{photo_hdr}</h4>", unsafe_allow_html=True)
                        uploaded_files = st.file_uploader(
                            "เลือกรูปภาพสภาพรถรอบคัน / เกจ์น้ำมัน / จุดตำหนิ (รองรับหลายรูปพร้อมกัน JPG, PNG, WEBP):",
                            type=["png", "jpg", "jpeg", "webp"],
                            accept_multiple_files=True,
                            key=f"insp_photos_uploader_{target_close_id}_{target_close_type}",
                            disabled=(not is_worker_authorized)
                        )
                        
                        saved_photos_data = []
                        if uploaded_files:
                            st.markdown(f"<span style='font-size:12px; color:#10B981; font-weight:700;'>📸 อัปโหลดแล้ว {len(uploaded_files)} รูป:</span>", unsafe_allow_html=True)
                            preview_cols = st.columns(min(len(uploaded_files), 4))
                            for idx_f, f in enumerate(uploaded_files):
                                b_data = f.getvalue()
                                b64_f = base64.b64encode(b_data).decode("utf-8")
                                mime_f = f.type or "image/jpeg"
                                data_uri = f"data:{mime_f};base64,{b64_f}"
                                
                                # อัปโหลดไปยัง Supabase Storage Bucket 'inspection-photos'
                                safe_name = re.sub(r'[^a-zA-Z0-9_\.-]', '_', f.name)
                                cloud_fn = f"{target_close_id}_{target_close_type}_{int(time.time())}_{idx_f}_{safe_name}"
                                pub_url = sb_upload_photo(cloud_fn, b_data, mime_f)
                                
                                img_src = pub_url if pub_url else data_uri
                                saved_photos_data.append({
                                    "name": f.name,
                                    "data": img_src,
                                    "url": pub_url or "",
                                    "size_kb": len(b_data) // 1024
                                })
                                with preview_cols[idx_f % 4]:
                                    st.image(img_src, caption=f"{f.name} ({len(b_data)//1024} KB)", use_container_width=True)
                        else:
                            st.caption("ℹ️ สามารถถ่ายหรือเลือกรูปภาพสภาพรถและหน้าปัดเกจ์น้ำมันเพื่อแนบเป็นหลักฐานการส่งงานได้")
                            
                        st.markdown("<div style='height: 14px;'></div>", unsafe_allow_html=True)
                        
                        # ปุ่มยืนยัน / ยกเลิก
                        c_btn_sub, c_btn_cancel = st.columns([2.5, 1])
                        with c_btn_sub:
                            if not is_worker_authorized:
                                if is_sequence_blocked:
                                    st.button("🔒 ไม่อนุญาตให้รับรถคืน (ต้องตรวจส่งมอบรถให้เสร็จก่อน)", disabled=True, use_container_width=True, key=f"btn_dis_insp_{target_close_id}_{target_close_type}")
                                else:
                                    st.button(f"🔒 ไม่อนุญาตให้ส่งงาน (เฉพาะพนักงานที่ได้รับมอบหมาย: {', '.join(assigned_workers) if assigned_workers else 'ยังไม่ระบุ'})", disabled=True, use_container_width=True, key=f"btn_dis_insp_{target_close_id}_{target_close_type}")
                            else:
                                if is_dispatch_step:
                                    btn_label = "🚚 ยืนยันส่งมอบรถ & ปิดงานจัดส่ง (Complete Dispatch)"
                                else:
                                    btn_label = "📥 ยืนยันรับรถคืน & สำรองข้อมูลปิดจ๊อบลงฐานข้อมูล (Complete Return & Archive)"
                                    
                                if st.button(btn_label, type="primary", use_container_width=True, key=f"btn_sub_insp_{target_close_id}_{target_close_type}"):
                                    chk_items = []
                                    if chk_body: chk_items.append("ตัวถังปกติ")
                                    if chk_glass: chk_items.append("กระจกปกติ")
                                    if chk_tires: chk_items.append("ยางปกติ")
                                    if chk_lights: chk_items.append("ไฟส่องสว่างปกติ")
                                    if chk_clean: chk_items.append("ห้องโดยสารสะอาด")
                                    if chk_tools: chk_items.append("เครื่องมือครบ")
                                    if chk_key: chk_items.append("กุญแจ/เอกสารครบ")
                                    if chk_ac: chk_items.append("แอร์ปกติ")
                                    
                                    notes_combined = f"{insp_memo} | เช็ก: {', '.join(chk_items)}"
                                    
                                    if is_dispatch_step:
                                        # บันทึกปิดงานจัดส่งรถ (Dispatch Closed)
                                        if fuel_fee > 0:
                                            notes_combined += f" (ค่าน้ำมันส่วนต่าง ฿{fuel_fee:,.2f})"
                                            st.session_state.financial_db.append({
                                                "company": car_info_c.get("company", "Sawasdee Rent A Car"),
                                                "type": "รายรับ",
                                                "category": "ค่าน้ำมันส่วนต่าง / ค่าปรับน้ำมัน",
                                                "amount": float(fuel_fee),
                                                "ref": target_close_id,
                                                "date": datetime.now().strftime("%Y-%m-%d"),
                                                "detail": f"ค่าน้ำมันส่วนต่าง ({sel_fuel}) {target_close_bk['car_id']}"
                                            })
                                            _GLOBAL_STORE["financial_db"] = st.session_state.financial_db
                                            
                                        target_close_bk["dispatch_closed"] = True
                                        target_close_bk["dispatch_fuel"] = sel_fuel
                                        target_close_bk["dispatch_mileage"] = cur_mileage
                                        target_close_bk["dispatch_notes"] = notes_combined
                                        target_close_bk["dispatch_photos"] = saved_photos_data
                                        target_close_bk["start_date"] = act_disp_d
                                        target_close_bk["start_time"] = act_disp_t.strftime("%H:%M")
                                        target_close_bk["dispatch_date"] = datetime.combine(act_disp_d, act_disp_t)
                                        target_close_bk["status"] = "กำลังเช่า"
                                        if target_close_bk["car_id"] in cars_db:
                                            cars_db[target_close_bk["car_id"]]["status"] = "กำลังเช่า"
                                            if cur_mileage:
                                                cars_db[target_close_bk["car_id"]]["mileage"] = cur_mileage
                                            _GLOBAL_STORE["cars_db"] = st.session_state.cars_db
                                            sb_sync_car(target_close_bk["car_id"], cars_db[target_close_bk["car_id"]])
                                        _GLOBAL_STORE["bookings_db"] = st.session_state.bookings_db
                                        sb_sync_booking(target_close_bk)
                                        st.session_state.active_close_job_id = None
                                        st.session_state.active_close_job_type = None
                                        if "close_job" in st.query_params: del st.query_params["close_job"]
                                        if "close_type" in st.query_params: del st.query_params["close_type"]
                                        st.success(f"🎉 ส่งมอบรถ {target_close_id} ({target_close_bk['car_id']}) ให้ลูกค้าเรียบร้อยแล้ว! งานส่งมอบรถปิดและนำออกจากตารางแล้ว คงเหลือเฉพาะงานรับรถคืนบนตาราง")
                                        time.sleep(1)
                                        st.rerun()
                                    else:
                                        # บันทึกปิดงานรับรถคืน (Return Closed) & สำรองข้อมูลเข้า Database
                                        ret_memo_addons = []
                                        if insp_late_fee > 0:
                                            ret_memo_addons.append(f"ค่าปรับคืนรถล่าช้าเกิน 4 ชม. (1 วัน) ฿{insp_late_fee:,.2f}")
                                            st.session_state.financial_db.append({
                                                "company": car_info_c.get("company", "Sawasdee Rent A Car"),
                                                "type": "รายรับ",
                                                "category": "ค่าปรับคืนรถล่าช้า (เกิน 4 ชม. ปรับ 1 วัน)",
                                                "amount": float(insp_late_fee),
                                                "ref": target_close_id,
                                                "date": datetime.now().strftime("%Y-%m-%d"),
                                                "detail": f"ค่าปรับคืนรถล่าช้า ({delay_hours} ชม. {delay_mins} นาที - ปรับ 1 วัน) {target_close_bk['car_id']}"
                                            })
                                            _GLOBAL_STORE["financial_db"] = st.session_state.financial_db
                                            
                                        if fuel_fee > 0:
                                            ret_memo_addons.append(f"ค่าน้ำมันส่วนต่าง ฿{fuel_fee:,.2f}")
                                            st.session_state.financial_db.append({
                                                "company": car_info_c.get("company", "Sawasdee Rent A Car"),
                                                "type": "รายรับ",
                                                "category": "ค่าน้ำมันส่วนต่าง / ค่าปรับน้ำมัน",
                                                "amount": float(fuel_fee),
                                                "ref": target_close_id,
                                                "date": datetime.now().strftime("%Y-%m-%d"),
                                                "detail": f"ค่าน้ำมันส่วนต่าง ({sel_fuel}) {target_close_bk['car_id']}"
                                            })
                                            _GLOBAL_STORE["financial_db"] = st.session_state.financial_db
                                            
                                        if ret_memo_addons:
                                            notes_combined += f" ({', '.join(ret_memo_addons)})"
                                            
                                        target_close_bk["return_closed"] = True
                                        target_close_bk["return_fuel"] = sel_fuel
                                        target_close_bk["return_mileage"] = cur_mileage
                                        target_close_bk["actual_return_date"] = act_ret_d
                                        target_close_bk["actual_return_time"] = act_ret_t.strftime("%H:%M")
                                        target_close_bk["return_date"] = datetime.combine(act_ret_d, act_ret_t)
                                        target_close_bk["late_fee"] = insp_late_fee
                                        target_close_bk["return_notes"] = notes_combined
                                        target_close_bk["return_photos"] = saved_photos_data
                                        target_close_bk["status"] = "เสร็จสิ้น"
                                        if target_close_bk["car_id"] in cars_db:
                                            cars_db[target_close_bk["car_id"]]["status"] = "ว่างพร้อมใช้งาน"
                                            if cur_mileage:
                                                cars_db[target_close_bk["car_id"]]["mileage"] = cur_mileage
                                            _GLOBAL_STORE["cars_db"] = st.session_state.cars_db
                                        
                                        all_photos = (target_close_bk.get("dispatch_photos") or []) + (saved_photos_data or [])
                                        combined_archive_notes = f"[ส่งรถ: {target_close_bk.get('dispatch_notes', 'ตรวจสภาพปกติ')}] | [รับคืน: {notes_combined}]"
                                        
                                        archive_completed_booking(
                                            booking_id=target_close_id,
                                            fuel_level=sel_fuel,
                                            inspection_notes=combined_archive_notes,
                                            inspection_photos=all_photos,
                                            mileage=cur_mileage,
                                            late_fee=insp_late_fee
                                        )
                                        _GLOBAL_STORE["bookings_db"] = st.session_state.bookings_db
                                        st.session_state.active_close_job_id = None
                                        st.session_state.active_close_job_type = None
                                        if "close_job" in st.query_params: del st.query_params["close_job"]
                                        if "close_type" in st.query_params: del st.query_params["close_type"]
                                        st.success(f"🎉 ตรวจรับรถคืน {target_close_id} ({target_close_bk['car_id']}) เรียบร้อยแล้ว! ปิดงานทั้ง 2 งานสมบูรณ์ และสำรองข้อมูลเป็น 1 รายการในแดชบอร์ดรายเดือน")
                                        time.sleep(1)
                                        st.rerun()
                                        
                        with c_btn_cancel:
                            if st.button("❌ ปิด / ยกเลิก", use_container_width=True, key=f"btn_can_insp_{target_close_id}"):
                                st.session_state.active_close_job_id = None
                                st.session_state.active_close_job_type = None
                                if "close_job" in st.query_params:
                                    del st.query_params["close_job"]
                                if "close_type" in st.query_params:
                                    del st.query_params["close_type"]
                                st.rerun()
                else:
                    st.session_state.active_close_job_id = None
                    st.session_state.active_close_job_type = None
                    if "close_job" in st.query_params:
                        del st.query_params["close_job"]
                    if "close_type" in st.query_params:
                        del st.query_params["close_type"]

            if not jobs_list:
                if bo_kw:
                    bo_kw_clean = bo_kw.replace("-", "").replace(" ", "")
                    unassigned_match = [
                        b for b in st.session_state.bookings_db
                        if bo_kw in f"{b.get('booking_id','')} {b.get('customer','')} {b.get('car_id','')}".lower()
                        or bo_kw_clean in str(b.get('booking_id','')).lower().replace("-", "").replace(" ", "")
                    ]
                    if unassigned_match:
                        target_unassigned = unassigned_match[0]
                        st.info(f"📌 พบรหัสการจอง **{target_unassigned['booking_id']}** (รถ {target_unassigned['car_id']}) อยู่ในคิวรอลงใบงาน (หน้า 'Front Office')")
                        if st.button(f"🔄 ไปที่ Front Office เพื่อดูรายการจอง {target_unassigned['booking_id']}", type="primary"):
                            st.session_state.selected_module = "Front Office"
                            st.session_state.workflow_tab = "5. แผงควบคุมการจอง"
                            st.rerun()
                    else:
                        st.info(f"🔍 ไม่พบรายการใบงานตามคำค้นหา '{bo_kw}'")
                else:
                    st.info(translations[st.session_state.language].get("bo_empty_info", "📋 ยังไม่มีรายการใบงานในระบบ (เมื่อจัดทำสัญญาหรือจองรถแล้ว รายการจะปรากฏบนตารางงานนี้ทันที)"))
                    if st.button(translations[st.session_state.language].get("bo_btn_new_booking", "➕ ไปจัดทำสัญญา / จองรถใหม่ (Front Office)"), type="primary"):
                        st.session_state.selected_module = "Front Office"
                        st.session_state.workflow_tab = "1. เลือกรถยนต์"
                        st.rerun()
            else:
                th_type = translations[st.session_state.language].get("bo_col_type", "ประเภทงาน")
                th_bkid = translations[st.session_state.language].get("bo_col_booking_id", "รหัสการจอง")
                th_plate = translations[st.session_state.language].get("bo_col_plate", "ทะเบียนรถ")
                th_cust = translations[st.session_state.language].get("bo_col_customer_name", "ลูกค้า")
                th_sched = translations[st.session_state.language].get("bo_col_schedule_range", "กำหนดวันส่ง - วันคืน")
                th_staff = translations[st.session_state.language].get("bo_col_staff", "พนักงาน")
                th_loc = translations[st.session_state.language].get("bo_col_location_simple", "สถานที่")
                th_status = translations[st.session_state.language].get("bo_col_status", "สถานะ")
                th_acts = translations[st.session_state.language].get("bo_col_actions_full", "เอกสาร & จัดการส่งงาน")
                
                table_html = (
                    '<div style="max-height: 250px; overflow-y: auto; overflow-x: auto; border-radius: 8px; border: 1px solid #EFEAE3;">'
                    '<table class="bo-table">'
                    '<tr>'
                    f'<th>{th_type}</th>'
                    f'<th>{th_bkid}</th>'
                    f'<th>{th_plate}</th>'
                    f'<th>{th_cust}</th>'
                    f'<th>{th_sched}</th>'
                    f'<th>{th_staff}</th>'
                    f'<th>{th_loc}</th>'
                    f'<th>{th_status}</th>'
                    f'<th style="text-align:center;">{th_acts}<br/><span style="font-size:11px; font-weight:normal; color:#8C827A;">(📝 สัญญา | 🧾 ใบเสร็จ | 💳 มัดจำ | 🚚 ใบงาน | 📤 ตรวจรับส่ง | 🗑️ ลบ)</span></th>'
                    '</tr>'
                )
                
                for j in jobs_list:
                    t_bk = j["_booking_obj"]
                    j_type = j.get("job_type", "Dispatch")
                    
                    # สัญญาเช่า (ออกได้เมื่อชำระมัดจำ 5,000 บาทแล้ว)
                    if t_bk.get("deposit_paid"):
                        pdf_contract = generate_filled_pdf("rental_template_blank_v2.pdf", t_bk, st.session_state.customers_db.get(t_bk['customer']), cars_db.get(t_bk['car_id']))
                        b64_contract = base64.b64encode(pdf_contract).decode()
                        href_contract = f'<a href="data:application/pdf;base64,{b64_contract}" download="Agreement_{t_bk["booking_id"]}.pdf" class="icon-link" title="📝 สัญญาเช่า (Agreement)">📝</a>'
                    else:
                        href_contract = '<span style="color:#D1D5DB; font-size:18px; margin-right:6px; cursor:not-allowed;" title="📝 รอชำระเงินมัดจำ ฿5,000 ก่อนออกสัญญาเช่า (ชำระได้ที่ Front Office แท็บ 4. รับมัดจำ)">📝</span>'
                    
                    # ใบเสร็จรับเงิน (ออกได้เมื่อชำระค่าเช่ารถวันรับรถครบถ้วนแล้ว)
                    is_rental_paid = bool(t_bk.get("rental_paid", t_bk.get("is_fully_paid", False)))
                    net_b_amt = float(t_bk.get("net_price", 0))
                    
                    if is_rental_paid:
                        pdf_receipt = generate_receipt_bytes(f"REC{t_bk['booking_id']}", t_bk, st.session_state.customers_db.get(t_bk['customer']), cars_db.get(t_bk['car_id']), net_b_amt, t_bk.get("rental_payment_method") or t_bk.get("final_payment_method", "โอนเงิน/ชำระแล้ว"), item_desc="ค่าเช่ารถยนต์ (Vehicle Rental Fee)")
                        b64_receipt = base64.b64encode(pdf_receipt).decode()
                        href_receipt = f'<a href="data:application/pdf;base64,{b64_receipt}" download="Receipt_{t_bk["booking_id"]}.pdf" class="icon-link" title="🧾 ใบเสร็จรับเงิน (Receipt)">🧾</a>'
                    elif t_bk.get("deposit_paid"):
                        href_receipt = f'<span style="color:#D1D5DB; font-size:18px; margin-right:6px; cursor:not-allowed;" title="🧾 รอชำระค่าเช่ารถวันรับรถ ฿{net_b_amt:,.2f} จึงจะออกใบเสร็จ (ชำระได้ที่ Front Office แท็บ 4. รับมัดจำ)">🧾</span>'
                    else:
                        href_receipt = '<span style="color:#D1D5DB; font-size:18px; margin-right:6px; cursor:not-allowed;" title="🧾 ยังไม่ชำระเงินมัดจำประกันสัญญา (รอชำระมัดจำ ฿5,000 เพื่อออกสัญญาเช่า)">🧾</span>'
                    
                    # ใบเสร็จต่อสัญญาเช่า (ถ้ามี)
                    href_ext_receipts = ""
                    for ext_item in t_bk.get("extension_history", []):
                        pdf_ext = generate_receipt_bytes(ext_item.get("receipt_id", f"REC-EXT-{t_bk['booking_id']}-{ext_item.get('ext_id')}"), t_bk, st.session_state.customers_db.get(t_bk['customer']), cars_db.get(t_bk['car_id']), float(ext_item.get("amount", 0)), ext_item.get("method", "เงินสด"), item_desc=f"ค่าต่อสัญญาเช่ารถยนต์ ({ext_item.get('days_added', 1)} วัน ถึง {format_date_dmy(ext_item.get('new_end_date'))})")
                        b64_ext = base64.b64encode(pdf_ext).decode()
                        href_ext_receipts += f' <a href="data:application/pdf;base64,{b64_ext}" download="Receipt_EXT_{t_bk["booking_id"]}_{ext_item.get("ext_id", 1)}.pdf" class="icon-link" title="โหลดใบเสร็จต่อสัญญา #{ext_item.get("ext_id")} (+{ext_item.get("days_added", 1)} วัน, ฿{float(ext_item.get("amount", 0)):,.2f})">🧾+</a>'
                    
                    # ปุ่มลัดรับมัดจำ (ถ้ายังไม่ได้มัดจำ ให้มีปุ่ม 💳 คลิกไปรับมัดจำได้ทันที)
                    if not t_bk.get("deposit_paid"):
                        href_dep_btn = f'<a href="?deposit_job={t_bk["booking_id"]}&module=Front+Office" class="icon-link" title="💳 ยังไม่มัดจำ: คลิกเพื่อไปหน้าชำระมัดจำ ฿5,000">💳</a>'
                    else:
                        href_dep_btn = ''
                        
                    # ปุ่มลัดออกใบงานจัดส่ง (ถ้ายังไม่ได้มอบหมายคนขับ ให้มีปุ่ม 🚚 ออกใบงาน)
                    w_curr_disp = t_bk.get("worker_delivery")
                    if (not w_curr_disp or str(w_curr_disp).strip() in ["Wait", ""]) and j_type == "Dispatch":
                        href_assign_btn = f'<a href="?assign_job={t_bk["booking_id"]}&module=Front+Office" class="icon-link" title="🚚 คลิกเพื่อออกใบงาน & มอบหมายคนขับ">🚚</a>'
                    else:
                        href_assign_btn = ''
                    
                    if j['พนักงานปฏิบัติงาน'] == "Wait":
                        worker_display = '<span style="background-color:#FEF3C7; color:#D97706; padding:3px 9px; border-radius:12px; font-size:11px; font-weight:700;">Wait</span>'
                    else:
                        worker_display = f"<b style='color:#1F2937;'>{j['พนักงานปฏิบัติงาน']}</b>"
                    
                    # ปุ่มจัดการส่งมอบ / รับคืน
                    if j.get("is_locked"):
                        href_submit = '<span style="color:#D1D5DB; font-size:18px; margin-left:6px; cursor:not-allowed;" title="🔒 ป้องกันการเลือกผิด: ต้องตรวจส่งมอบรถ (ปิดงานส่งรถ) ให้เสร็จก่อน จึงจะทำรายการรับรถคืนได้">🔒</span>'
                    elif j['สถานะ'] == "เสร็จสิ้น":
                        href_submit = '<span style="color:#10B981; font-size:18px; margin-left:6px; cursor:default;" title="✅ งานนี้ปิดส่งงานเรียบร้อยแล้ว">✅</span>'
                    else:
                        act_tip = "📤 ตรวจส่งมอบรถ & ปิดงานจัดส่ง" if j_type == "Dispatch" else "📤 ตรวจรับรถคืน & สำรองข้อมูลปิดจ๊อบ"
                        href_submit = f'<a href="?close_job={t_bk["booking_id"]}&close_type={j_type}&module=Back+Office" target="_self" class="icon-link" title="{act_tip}">📤</a>'
                    
                    bk_id_bo = t_bk["booking_id"]
                    href_del_bo = f'<a href="?del_booking={bk_id_bo}&module=Back+Office" target="_self" class="icon-link" title="🗑️ ลบข้อมูล (Delete)" onclick="return confirm(\'⚠️ ยืนยันลบรายการจอง {bk_id_bo} ออกจากระบบ?\');">🗑️</a>' if is_admin_user else ''
                    
                    if j['สถานะ'] == "🔒 รอส่งรถก่อน":
                        status_badge = '<span style="background-color:#FEE2E2; color:#991B1B; padding:4px 10px; border-radius:12px; font-size:11px; font-weight:700; white-space:nowrap;">🔒 รอส่งรถก่อน</span>'
                    elif j['สถานะ'] == "รอชำระมัดจำ":
                        status_badge = '<span style="background-color:#FFF7ED; color:#EA580C; border:1px solid #FED7AA; padding:4px 10px; border-radius:12px; font-size:11px; font-weight:700; white-space:nowrap;">🟡 รอชำระมัดจำ</span>'
                    else:
                        status_color = "#10B981" if j['สถานะ'] == "เสร็จสิ้น" else ("#E85826" if j['สถานะ'] in ["กำลังเช่า", "เตรียมรับคืน", "เตรียมส่งมอบ"] else "#F59E0B")
                        status_badge = f'<span style="background-color:{status_color}20; color:{status_color}; padding:4px 10px; border-radius:12px; font-size:11px; font-weight:600; white-space:nowrap;">{j["สถานะ"]}</span>'
                    
                    job_type_html = f"<b style='color:#E85826;'>🚚 จัดส่งรถ (Dispatch)</b>" if j_type == "Dispatch" else f"<b style='color:#2563EB;'>📥 รับรถคืน (Return)</b>"
                    
                    c_plate = j.get('ทะเบียนรถ', '-')
                    c_car_info = cars_db.get(c_plate, {})
                    c_brand_model = f"{c_car_info.get('brand', '')} {c_car_info.get('model', '')}".strip()
                    c_sub_txt = f"<br/><span style='font-size:11px; color:#6B7280;'>{c_brand_model}</span>" if c_brand_model else ""
                    car_cell_html = f"<div style='min-width:105px; white-space:nowrap;'><b style='color:#1F2937;'>🚘 {c_plate}</b>{c_sub_txt}</div>"

                    c_cust_name = j.get('ลูกค้า', '-')
                    c_cust_info = st.session_state.customers_db.get(c_cust_name, {})
                    c_contact = c_cust_info.get("contact_no") or ""
                    c_contact_txt = f"<br/><span style='font-size:11px; color:#6B7280;'>📞 {c_contact}</span>" if c_contact and c_contact != "-" else ""
                    cust_cell_html = f"<div style='min-width:130px;'><b style='color:#1F2937;'>👤 {c_cust_name}</b>{c_contact_txt}</div>"

                    row_html = (
                        f"<tr>"
                        f"<td>{job_type_html}</td>"
                        f"<td style='color:#6B7280; font-size:12px; font-weight:600;'>{j['รหัสการจอง']}</td>"
                        f"<td>{car_cell_html}</td>"
                        f"<td>{cust_cell_html}</td>"
                        f"<td style='color:#4B5563; font-size:12px; white-space:nowrap;'>📅 {j['กำหนดวัน']}</td>"
                        f"<td>{worker_display}</td>"
                        f"<td style='color:#6B7280; font-size:12px; max-width: 150px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;' title='{j['สถานที่']}'>{j['สถานที่']}</td>"
                        f"<td>{status_badge}</td>"
                        f"<td style='text-align:center; white-space:nowrap;'>{href_contract} {href_receipt}{href_ext_receipts} {href_dep_btn} {href_assign_btn} {href_submit} {href_del_bo}</td>"
                        f"</tr>"
                    )
                    table_html += row_html
                    
                table_html += "</table></div>"
                st.markdown(table_html, unsafe_allow_html=True)
                



    elif module == "โมดูลจัดการลูกค้า":
        st.session_state.selected_module = "Front Office"
        st.session_state.workflow_tab = "2. ชำระเงินจอง & การเงิน"
        st.rerun()

    # =========================================================================
    # 7.4 DASHBOARD & FLEET MODULE
    # =========================================================================
    elif module == "Dashboard และรายงานผู้บริหาร":
        with st.container(key="executive_dashboard"):
            if hasattr(st, "html"):
                st.html(dashboard_luxury_css)
            else:
                st.markdown(dashboard_luxury_css, unsafe_allow_html=True)
            dash_hdr = translations[st.session_state.language].get("dash_title", "Fleet Performance & Financials")
            dash_sub_badge = translations[st.session_state.language].get("dash_subtitle_badge", "INTERACTIVE EXECUTIVE DASHBOARD")
            st.markdown(f"""
                <div style="margin-bottom: 20px;">
                    <h1 style="font-size: 28px; font-weight: 700; color: #1F2937; margin: 0; display:flex; align-items:center; gap:8px;">
                        <span>📊</span> {dash_hdr}
                    </h1>
                    <div style="font-size: 13px; color: #E85826; font-weight: 600; margin-top: 6px;">
                        <span style="display:inline-block; width:7px; height:7px; border-radius:50%; background:#E85826;"></span> {dash_sub_badge}
                    </div>
                </div>
            """, unsafe_allow_html=True)
        
            # =====================================================================
            # MISSION 1: ภาพรวมองค์กรรวมทุกบริษัท (Total Unified Dashboard)
            # =====================================================================
            filtered_cars = cars_db
            total_cars = len(filtered_cars)
            
            # 4 Categories: ว่างพร้อมให้บริการ (เขียว), กำลังเช่า (แดง), ติดจอง (เหลือง), ซ่อมบำรุง (ส้ม)
            available_cars = sum(1 for c in filtered_cars.values() if c.get("status") in ["ว่างพร้อมใช้งาน", "ว่าง", "พร้อมให้บริการ"])
            renting_cars = sum(1 for c in filtered_cars.values() if c.get("status") in ["กำลังเช่า", "เช่าอยู่"])
            booked_cars = sum(1 for c in filtered_cars.values() if c.get("status") in ["ติดจอง", "จอง", "เตรียมส่งมอบ", "เตรียมรับคืน", "รอส่งมอบ"])
            maintenance_cars = sum(1 for c in filtered_cars.values() if c.get("status") in ["ซ่อมบำรุง", "ส่งซ่อม", "ไม่พร้อมใช้งาน"])
            
            total_rev = sum(float(item.get("amount", 0)) for item in financial_db if item.get("type") == "รายรับ")
            total_monthly_installment_expense = sum(
                float(c.get("installment_amount", 0) or 0)
                for c in filtered_cars.values()
                if not c.get("is_debt_free", False) and float(c.get("installment_amount", 0) or 0) > 0
            )
            lbl_inst_exp = translations[st.session_state.language].get("dashboard_monthly_expense", "รายจ่ายค่างวดรถรวมต่อเดือน")

            kpi1, kpi2, kpi3, kpi4, kpi5 = st.columns(5)
            with kpi1:
                st.markdown(f"""
                    <div class="kpi-card">
                        <div class="kpi-card-header"><span>กองยานพาหนะรวม</span><div class="kpi-icon-pill">🚗</div></div>
                        <div class="kpi-card-value">{total_cars} <span style="font-size:14px; font-weight:400; color:#6B7280;">คัน</span></div>
                        <div style="margin-top:12px;"><span class="status-pill status-available">พร้อมให้บริการ {available_cars} คัน</span></div>
                    </div>
                """, unsafe_allow_html=True)
            with kpi2:
                st.markdown(f"""
                    <div class="kpi-card">
                        <div class="kpi-card-header"><span>รถกำลังเช่า / ติดจอง</span><div class="kpi-icon-pill">🔑</div></div>
                        <div class="kpi-card-value">{renting_cars + booked_cars} <span style="font-size:14px; font-weight:400; color:#6B7280;">คัน</span></div>
                        <div style="margin-top:8px; font-size:12px; color:#4B5563;">เช่าอยู่ <b>{renting_cars}</b> • ติดจอง <b>{booked_cars}</b></div>
                    </div>
                """, unsafe_allow_html=True)
            with kpi3:
                st.markdown(f"""
                    <div class="kpi-card" style="border-color:#E85826; box-shadow: 0 0 0 2px rgba(232,88,38,0.2);">
                        <div class="kpi-card-header"><span style="color:#E85826;">รายรับสะสมรวม</span><div class="kpi-icon-pill" style="background:#E8F8F0; color:#0E874D;">💳</div></div>
                        <div class="kpi-card-value"><span style="font-size:14px; font-weight:600; color:#6B7280;">THB</span> {total_rev:,.0f}</div>
                    </div>
                """, unsafe_allow_html=True)
            with kpi4:
                st.markdown(f"""
                    <div class="kpi-card" style="border-color:#F87171; box-shadow: 0 0 0 1px rgba(239,68,68,0.2);">
                        <div class="kpi-card-header"><span style="color:#DC2626;">{lbl_inst_exp}</span><div class="kpi-icon-pill" style="background:#FEE2E2; color:#DC2626;">💸</div></div>
                        <div class="kpi-card-value">฿{total_monthly_installment_expense:,.2f}</div>
                    </div>
                """, unsafe_allow_html=True)
            with kpi5:
                st.markdown(f"""
                    <div class="kpi-card">
                        <div class="kpi-card-header"><span>ซ่อมบำรุง & ตรวจเช็ค</span><div class="kpi-icon-pill" style="background:#FEE2E2; color:#991B1B;">🛠️</div></div>
                        <div class="kpi-card-value">{maintenance_cars} <span style="font-size:14px; font-weight:400; color:#6B7280;">คัน</span></div>
                    </div>
                """, unsafe_allow_html=True)

            st.markdown("<div style='height: 15px;'></div>", unsafe_allow_html=True)

            # =====================================================================
            # MISSION 2 & 3: กราฟรวมแบบ Interactive (Altair Donut & Trend Chart)
            # =====================================================================
            dash_c1, dash_c2 = st.columns([1.1, 1.9])
            
            # --- MISSION 2: สถานะกองยานพาหนะปัจจุบัน (Total Fleet Status) ---
            with dash_c1:
                with st.container(border=True):
                    st.markdown(f"""
                        <div class="donut-header">
                            <span>🍩 สถานะกองยานพาหนะปัจจุบัน (Total Fleet Status)</span>
                            <span style="font-size:12px; font-weight:700; color:#E85826;">{total_cars} คัน</span>
                        </div>
                        <div class="donut-sub">สัดส่วนสถานะรถทั้งหมดในระบบ (Interactive Donut Chart)</div>
                    """, unsafe_allow_html=True)
                    
                    st_domain = ["ว่างพร้อมให้บริการ", "กำลังเช่า", "ติดจอง", "ซ่อมบำรุง"]
                    st_range = ["#10B981", "#EF4444", "#F59E0B", "#F97316"] # เขียว, แดง, เหลือง, ส้ม
                    
                    df_status = pd.DataFrame([
                        {"status": "ว่างพร้อมให้บริการ", "count": available_cars, "pct_str": f"{(available_cars/total_cars*100):.1f}%" if total_cars > 0 else "0%"},
                        {"status": "กำลังเช่า", "count": renting_cars, "pct_str": f"{(renting_cars/total_cars*100):.1f}%" if total_cars > 0 else "0%"},
                        {"status": "ติดจอง", "count": booked_cars, "pct_str": f"{(booked_cars/total_cars*100):.1f}%" if total_cars > 0 else "0%"},
                        {"status": "ซ่อมบำรุง", "count": maintenance_cars, "pct_str": f"{(maintenance_cars/total_cars*100):.1f}%" if total_cars > 0 else "0%"}
                    ])
                    df_status_chart = df_status[df_status["count"] > 0]
                    
                    if not df_status_chart.empty:
                        status_chart = alt.Chart(df_status_chart).mark_arc(innerRadius=45, outerRadius=75, stroke='#fff', strokeWidth=2).encode(
                            theta=alt.Theta("count:Q"),
                            color=alt.Color("status:N", scale=alt.Scale(domain=st_domain, range=st_range), legend=None),
                            tooltip=[
                                alt.Tooltip("status:N", title="สถานะรถ"),
                                alt.Tooltip("count:Q", title="จำนวน (คัน)"),
                                alt.Tooltip("pct_str:N", title="สัดส่วน (%)")
                            ]
                        ).properties(height=180).configure_view(strokeWidth=0)
                        st.altair_chart(status_chart, use_container_width=True)
                    else:
                        st.info("ขณะนี้ยังไม่มีข้อมูลรถในระบบ")
                        
                    for _, row in df_status.iterrows():
                        color_map = {
                            "ว่างพร้อมให้บริการ": "#10B981",
                            "กำลังเช่า": "#EF4444",
                            "ติดจอง": "#F59E0B",
                            "ซ่อมบำรุง": "#F97316"
                        }
                        color_dot = color_map.get(row["status"], "#888")
                        st.markdown(f"""
                            <div class="donut-stat-row">
                                <span><span style="color:{color_dot}; font-size:13px;">●</span> {row['status']}</span>
                                <b>{row['count']} คัน ({row['pct_str']})</b>
                            </div>
                        """, unsafe_allow_html=True)

            # --- MISSION 3: แนวโน้มรายรับสะสมรวม (Total Revenue Trend) ---
            with dash_c2:
                with st.container(border=True):
                    c_tr_h1, c_tr_h2 = st.columns([2, 1.2])
                    with c_tr_h1:
                        st.markdown("""
                            <div class="donut-header">
                                <span>📈 แนวโน้มรายรับสะสมรวม (Total Revenue Trend)</span>
                            </div>
                            <div class="donut-sub">ยอดรายรับรวมย้อนหลังรายเดือน (Interactive Total Revenue Chart)</div>
                        """, unsafe_allow_html=True)
                    with c_tr_h2:
                        trend_chart_type = st.radio(
                            "รูปแบบกราฟ:",
                            ["📊 กราฟแท่ง (Bar)", "📈 กราฟพื้นที่ (Area)"],
                            horizontal=True,
                            label_visibility="collapsed",
                            key="unified_trend_chart_type"
                        )
                    
                    th_m_names = ["", "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."]
                    now_dt = datetime.now()
                    month_bins = []
                    for i in range(5, -1, -1):
                        m_idx = now_dt.month - i
                        y_idx = now_dt.year
                        while m_idx <= 0:
                            m_idx += 12
                            y_idx -= 1
                        m_lbl = f"{m_idx}. {th_m_names[m_idx]}"
                        month_bins.append({"label": m_lbl, "month": m_idx, "year": y_idx, "rev": 0.0, "jobs": 0})
                    
                    for item in financial_db:
                        if item.get("type") == "รายรับ":
                            amt = float(item.get("amount", 0))
                            dt_raw = item.get("created_at") or item.get("date")
                            if dt_raw:
                                d_obj = to_date(dt_raw)
                                if d_obj:
                                    for mb in month_bins:
                                        if mb["month"] == d_obj.month and mb["year"] == d_obj.year:
                                            mb["rev"] += amt
                                            mb["jobs"] += 1
                                            break
                                            
                    for c_item in st.session_state.get("completed_jobs_db", []):
                        amt = float(c_item.get("net_price", 0))
                        c_date = c_item.get("completed_date") or c_item.get("end_date")
                        if c_date:
                            d_obj = to_date(c_date)
                            if d_obj:
                                for mb in month_bins:
                                    if mb["month"] == d_obj.month and mb["year"] == d_obj.year:
                                        mb["rev"] += amt
                                        mb["jobs"] += 1
                                        break
                                        
                    df_trend_tot = pd.DataFrame([
                        {
                            "เดือน": mb["label"],
                            "รายรับรวม (THB)": mb["rev"],
                            "จำนวนงาน (งาน)": mb["jobs"]
                        }
                        for mb in month_bins
                    ])
                    
                    if trend_chart_type == "📊 กราฟแท่ง (Bar)":
                        rev_chart = alt.Chart(df_trend_tot).mark_bar(
                            cornerRadiusTopLeft=6,
                            cornerRadiusTopRight=6,
                            color="#E85826"
                        ).encode(
                            x=alt.X('เดือน:N', title="รอบเดือน", sort=None),
                            y=alt.Y('รายรับรวม (THB):Q', title="รายรับรวม (THB)"),
                            tooltip=[
                                alt.Tooltip('เดือน:N', title="รอบเดือน"),
                                alt.Tooltip('รายรับรวม (THB):Q', title="ยอดรายรับรวม (THB)", format=',.2f'),
                                alt.Tooltip('จำนวนงาน (งาน):Q', title="จำนวนงานเสร็จสิ้น")
                            ]
                        ).properties(height=230)
                    else:
                        rev_chart = alt.Chart(df_trend_tot).mark_area(
                            line={'color':'#E85826', 'size':3},
                            color=alt.Gradient(
                                gradient='linear',
                                stops=[alt.GradientStop(color='#E85826', offset=0),
                                       alt.GradientStop(color='rgba(232,88,38,0.08)', offset=1)],
                                x1=1, x2=1, y1=1, y2=0
                            ),
                            point=alt.OverlayMarkDef(color='#E85826', size=60)
                        ).encode(
                            x=alt.X('เดือน:N', title="รอบเดือน", sort=None),
                            y=alt.Y('รายรับรวม (THB):Q', title="รายรับรวม (THB)"),
                            tooltip=[
                                alt.Tooltip('เดือน:N', title="รอบเดือน"),
                                alt.Tooltip('รายรับรวม (THB):Q', title="ยอดรายรับรวม (THB)", format=',.2f'),
                                alt.Tooltip('จำนวนงาน (งาน):Q', title="จำนวนงานเสร็จสิ้น")
                            ]
                        ).interactive().properties(height=230)
                        
                    st.altair_chart(rev_chart, use_container_width=True)

            st.markdown("<div style='height: 15px;'></div>", unsafe_allow_html=True)
            
            # --- ข้อมูลทะเบียนรถและสถานะ (Fleet Status) - พับได้ตามที่ผู้ใช้ต้องการ ---
            with st.expander("🚘 ข้อมูลทะเบียนรถและสถานะ (Fleet Status) — คลิกเพื่อพับเก็บ / ขยายตาราง", expanded=True):
                st.markdown("<h3 class='dash-section-title' style='margin-top:0;'>ตารางข้อมูลทะเบียนรถและสถานะรายคัน</h3>", unsafe_allow_html=True)
                
                today_dt = date.today()
                
                # --- ตรวจสอบแจ้งเตือน พ.ร.บ. / ประกันภัย ล่วงหน้าก่อนวันหมดอายุ 30 วัน ---
                expiring_items = []
                for plate, c in cars_db.items():
                    # ตรวจสอบ พ.ร.บ.
                    d_act = to_date(c.get("act_expiry"))
                    if d_act:
                        diff_act = (d_act - today_dt).days
                        if diff_act <= 30:
                            expiring_items.append({
                                "plate": plate,
                                "model": f"{c.get('brand', '')} {c.get('model', '')}",
                                "company": c.get('company', ''),
                                "type": "พ.ร.บ.",
                                "field": "act_expiry",
                                "curr_expiry": c.get("act_expiry", "-"),
                                "days_left": diff_act
                            })
                    # ตรวจสอบ ประกันภัย
                    d_ins = to_date(c.get("ins_expiry"))
                    if d_ins:
                        diff_ins = (d_ins - today_dt).days
                        if diff_ins <= 30:
                            expiring_items.append({
                                "plate": plate,
                                "model": f"{c.get('brand', '')} {c.get('model', '')}",
                                "company": c.get('company', ''),
                                "type": "ประกันภัย",
                                "field": "ins_expiry",
                                "curr_expiry": c.get("ins_expiry", "-"),
                                "days_left": diff_ins
                            })
                
                if not expiring_items:
                    st.success("✅ ขณะนี้ไม่มีรายการ พ.ร.บ. หรือ ประกันภัย ที่ใกล้หมดอายุ")
                else:
                    st.markdown(f"""
                        <div style="background:#FFFBEB; border:1px solid #FCD34D; border-left:5px solid #F59E0B; border-radius:10px; padding:12px 16px; margin-bottom:14px;">
                            <div style="font-weight:700; color:#B45309; font-size:14px; display:flex; align-items:center; gap:8px;">
                                <span>⚠️</span> แจ้งเตือน พ.ร.บ. / ประกันภัยใกล้หมดอายุ (ภายใน 30 วัน) หรือหมดอายุแล้ว ({len(expiring_items)} รายการ)
                            </div>
                            <div style="font-size:12px; color:#92400E; margin-top:3px;">
                                ท่านสามารถกดปุ่ม <b>'อัปเดตต่ออายุ'</b> เพื่อเริ่มนับวันหมดอายุใหม่ 1 ปีนับจากวันที่กดอัปเดตได้ทันที
                            </div>
                        </div>
                    """, unsafe_allow_html=True)
                    
                    for idx, exp in enumerate(expiring_items):
                        c_exp_info, c_exp_btn = st.columns([3.3, 1.7])
                        with c_exp_info:
                            if exp["days_left"] < 0:
                                tag_html = f"<span style='background:#FEE2E2; color:#991B1B; padding:3px 9px; border-radius:12px; font-weight:700; font-size:11px;'>🔴 หมดอายุแล้ว (เกิน {abs(exp['days_left'])} วัน)</span>"
                            elif exp["days_left"] == 0:
                                tag_html = "<span style='background:#FEE2E2; color:#991B1B; padding:3px 9px; border-radius:12px; font-weight:700; font-size:11px;'>🔴 หมดอายุวันนี้</span>"
                            else:
                                tag_html = f"<span style='background:#FEF3C7; color:#D97706; padding:3px 9px; border-radius:12px; font-weight:700; font-size:11px;'>🟡 ใกล้หมดอายุ (เหลือ {exp['days_left']} วัน)</span>"
                            
                            st.markdown(f"""
                                <div style="padding:5px 0; font-size:13px; color:#1F2937;">
                                    🚘 <b>{exp['plate']}</b> ({exp['model']} - {exp['company']}) | <b>{exp['type']}</b>: หมดอายุ {exp['curr_expiry']} {tag_html}
                                </div>
                            """, unsafe_allow_html=True)
                        with c_exp_btn:
                            new_exp_date = (today_dt + timedelta(days=365)).strftime("%d/%m/%Y")
                            if st.button(f"🔄 อัปเดต {exp['type']} (+1 ปีจากวันนี้)", key=f"btn_renew_{exp['field']}_{exp['plate']}_{idx}", type="primary", use_container_width=True):
                                st.session_state.cars_db[exp['plate']][exp['field']] = new_exp_date
                                cars_db[exp['plate']][exp['field']] = new_exp_date
                                if "_GLOBAL_STORE" in globals():
                                    _GLOBAL_STORE["cars_db"] = st.session_state.cars_db
                                sb_sync_car(exp['plate'], cars_db[exp['plate']])
                                st.success(f"✅ อัปเดต {exp['type']} ทะเบียน {exp['plate']} เรียบร้อย! เริ่มนับวันหมดอายุใหม่ตั้งแต่วันนี้ ถึง {new_exp_date}")
                                time.sleep(1)
                                st.rerun()

                    # --- กล่องสถานะระบบแจ้งเตือน LINE อัตโนมัติ & ปุ่มทดสอบ ---
                    st.markdown("<div style='height:4px;'></div>", unsafe_allow_html=True)
                    c_line_stat, c_line_btn = st.columns([3.2, 1.8])
                    with c_line_stat:
                        st.markdown("""
                            <div style="background:#F0FDF4; border:1px solid #BBF7D0; border-radius:8px; padding:10px 14px; font-size:12px; color:#166534; line-height:1.5;">
                                📲 <b>ระบบแจ้งเตือน พ.ร.บ. / ประกันภัย ผ่าน LINE อัตโนมัติ (Broadcast):</b><br/>
                                • ส่งแจ้งเตือนอัตโนมัติทุกวันเวลา <b>20:00 น.</b> (ล่วงหน้า <b>30 วัน</b>, <b>7 วัน</b> และ <b>วันหมดอายุ</b>)<br/>
                                • หากไม่มีรายการครบกำหนดในวันนั้น ระบบจะไม่ส่งข้อความเพื่อประหยัดโควต้า LINE<br/>
                                • เมื่อกดปุ่ม '🔄 อัปเดต' ต่ออายุแล้ว ระบบจะบันทึกลงฐานข้อมูลและหยุดส่งแจ้งเตือนทันที
                            </div>
                        """, unsafe_allow_html=True)
                    with c_line_btn:
                        st.markdown("<div style='height:2px;'></div>", unsafe_allow_html=True)
                        if st.button("🔔 ทดสอบตรวจ & ส่งแจ้งเตือน LINE", key="btn_test_line_expiry_broadcast", use_container_width=True):
                            with st.spinner("กำลังตรวจสอบวันหมดอายุ พ.ร.บ./ประกัน..."):
                                alert_res = check_and_send_expiry_alerts(cars_dict=cars_db)
                                if alert_res.get("sent"):
                                    st.success(f"🎉 ส่งข้อความ Broadcast แจ้งเตือนเข้า LINE สำเร็จ ({alert_res.get('count')} รายการ)")
                                else:
                                    st.info(f"ℹ️ {alert_res.get('message', 'ไม่มีรายการครบกำหนดแจ้งเตือนในวันนี้')}")
                    st.markdown("<hr style='margin:10px 0 14px; border:0.5px solid #F3EDE4;'>", unsafe_allow_html=True)
                
                if filtered_cars:
                    fleet_list = []
                    for plate, c in filtered_cars.items():
                        # Format Act Expiry with indicator
                        act_raw = c.get('act_expiry', '-')
                        d_act = to_date(act_raw)
                        if d_act:
                            diff_a = (d_act - today_dt).days
                            if diff_a < 0:
                                act_disp = f"🔴 {act_raw} (หมดอายุ)"
                            elif diff_a <= 30:
                                act_disp = f"🟡 {act_raw} (เหลือ {diff_a} วัน)"
                            else:
                                act_disp = f"🟢 {act_raw}"
                        else:
                            act_disp = act_raw
                            
                        # Format Insurance Expiry with indicator
                        ins_raw = c.get('ins_expiry', '-')
                        d_ins = to_date(ins_raw)
                        if d_ins:
                            diff_i = (d_ins - today_dt).days
                            if diff_i < 0:
                                ins_disp = f"🔴 {ins_raw} (หมดอายุ)"
                            elif diff_i <= 30:
                                ins_disp = f"🟡 {ins_raw} (เหลือ {diff_i} วัน)"
                            else:
                                ins_disp = f"🟢 {ins_raw}"
                        else:
                            ins_disp = ins_raw
                            
                        fleet_list.append({
                            "ทะเบียน": plate,
                            "ยี่ห้อ": c['brand'],
                            "รุ่น": c['model'],
                            "สี": c.get('color', '-'),
                            "กรรมสิทธิ์": c['company'],
                            "วันหมดอายุ พ.ร.บ.": act_disp,
                            "วันหมดอายุประกันภัย": ins_disp,
                            "สถานะ": c['status']
                        })
                    df_fleet = pd.DataFrame(fleet_list)
                    fleet_event = st.dataframe(
                        df_fleet, 
                        use_container_width=True, 
                        hide_index=True,
                        height=250,
                        on_select="rerun",
                        selection_mode="single-row",
                        key="dash_fleet_table"
                    )
                    
                    if fleet_event and hasattr(fleet_event, "selection") and fleet_event.selection and fleet_event.selection.rows:
                        selected_idx = fleet_event.selection.rows[0]
                        selected_plate = df_fleet.iloc[selected_idx]["ทะเบียน"]
                        st.session_state.search_plate_filter = selected_plate
                        st.session_state.global_search_kw = selected_plate
                        st.session_state.selected_module = "Front Office"
                        st.session_state.workflow_tab = "1. เลือกรถยนต์"
                        st.rerun()
                    
                    st.caption("💡 ท่านสามารถคลิกเลือกแถวในตารางเพื่อข้ามไปดูรายละเอียดรถแบบเต็มในหน้า 'เลือกรถยนต์' ได้ทันที (หรือคลิกที่หัวข้อเพื่อพับเก็บตาราง)")

                else:
                    st.info("💡 ยังไม่มีข้อมูลในระบบ... คุณสามารถเพิ่มข้อมูลใหม่เพื่อเริ่มต้นใช้งานและดูสถิติได้ที่เมนูด้านซ้ายครับ")

            st.markdown("<div style='height: 15px;'></div>", unsafe_allow_html=True)
            
            # --- 📑 คลังประวัติงานเสร็จสิ้น & รีพอร์ตรายเดือน (พับได้เหมือนตารางรถ) ---
            cur_lang = st.session_state.get("language", "TH")
            tr_dash = translations.get(cur_lang, translations["TH"])
            archive_exp_title = f"{tr_dash.get('dash_archive_title', '📑 คลังประวัติงานเสร็จสิ้น & รีพอร์ตรายเดือน')} — ({len(st.session_state.completed_jobs_db)} {'รายการ' if cur_lang == 'TH' else 'Records'})"
            with st.expander(archive_exp_title, expanded=True):
                st.markdown(f"<h3 class='dash-section-title' style='margin-top:0;'>{tr_dash.get('dash_archive_title', 'คลังประวัติงานเสร็จสิ้น & รายงานสรุปรายเดือน')}</h3>", unsafe_allow_html=True)
                
                # --- 1. Monthly Filter & Controls ---
                c_m1, c_m2 = st.columns(2)
                
                thai_months = ["", "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"]
                month_options = ["ทั้งหมด (All Months)"]
                ym_map = {}
                for cj in st.session_state.completed_jobs_db:
                    c_d = cj.get("completed_date") or cj.get("end_date")
                    if isinstance(c_d, datetime):
                        c_d = c_d.date()
                    if c_d:
                        k = f"{c_d.year}-{c_d.month:02d}"
                        if k not in ym_map:
                            ym_map[k] = f"{c_d.month:02d}/{c_d.year} ({thai_months[c_d.month]} {c_d.year + 543})"
                
                sorted_ym_keys = sorted(ym_map.keys(), reverse=True)
                for k in sorted_ym_keys:
                    month_options.append(ym_map[k])
                    
                with c_m1:
                    sel_month_label = st.selectbox(tr_dash.get("dash_archive_filter_month", "📅 เลือกเดือนที่ต้องการดูรายงาน:"), month_options, index=0, key="dash_report_month")
                with c_m2:
                    all_comp_lbl = tr_dash.get("dash_archive_all_comp", "ทั้งหมด (ทุกบริษัท)")
                    sel_comp_filter = st.selectbox(tr_dash.get("dash_archive_filter_comp", "🏢 เลือกรีพอร์ตตามบริษัท:"), [all_comp_lbl, "Sawasdee Rent A Car", "P.D.P. Co., Ltd.", "Sawasdee Car Rent"], index=0, key="dash_report_company")
                
                sb_dash_kw = st.session_state.get("global_search_kw", "").strip()
                if sb_dash_kw:
                    st.info(f"🔍 กรองผลลัพธ์ตามคำค้นหาจากไซด์บาร์: **'{sb_dash_kw}'** (หากต้องการดูทั้งหมด ให้ล้างช่องค้นหาที่ไซด์บาร์ด้านซ้าย)")
                    
                # Filter completed jobs
                filtered_reports = []
                for cj in st.session_state.completed_jobs_db:
                    # Filter by month
                    if sel_month_label != "ทั้งหมด (All Months)":
                        c_d = cj.get("completed_date") or cj.get("end_date")
                        if isinstance(c_d, datetime):
                            c_d = c_d.date()
                        if not c_d:
                            continue
                        k = f"{c_d.year}-{c_d.month:02d}"
                        if ym_map.get(k) != sel_month_label:
                            continue
                            
                    # Filter by company
                    if sel_comp_filter not in [all_comp_lbl, "ทั้งหมด (ทุกบริษัท)"]:
                        if cj.get("company") != sel_comp_filter:
                            continue
                            
                    # Filter by search (ใช้ช่องค้นหารวมจากแถบด้านข้าง Sidebar)
                    if sb_dash_kw:
                        kw_str = f"{cj.get('booking_id', '')} {cj.get('car_id', '')} {cj.get('customer', '')} {cj.get('worker_delivery', '')} {cj.get('worker_return', '')} {cj.get('company', '')}".lower()
                        if sb_dash_kw.lower() not in kw_str:
                            continue
                            
                    filtered_reports.append(cj)
                    
                filtered_reports.sort(key=lambda x: str(x.get("completed_date") or x.get("end_date") or ""), reverse=True)
                
                # --- 2. Monthly Summary KPI Cards ---
                total_jobs_cnt = len(filtered_reports)
                total_rev_sum = sum(float(x.get("net_price", 0)) for x in filtered_reports)
                unique_cars_cnt = len(set(x.get("car_id") for x in filtered_reports if x.get("car_id")))
                unique_cust_cnt = len(set(x.get("customer") for x in filtered_reports if x.get("customer")))
                
                job_unit_txt = "งาน" if cur_lang == "TH" else "jobs"
                car_unit_txt = "คัน" if cur_lang == "TH" else "cars"
                cust_unit_txt = "ราย" if cur_lang == "TH" else "customers"

                kpi_c1, kpi_c2, kpi_c3, kpi_c4 = st.columns(4)
                with kpi_c1:
                    st.markdown(f"""
<div style="background:white; border:1px solid #EFEAE3; border-radius:10px; padding:12px; text-align:center; box-shadow:0 1px 3px rgba(0,0,0,0.04);">
<div style="font-size:12px; color:#6B7280; font-weight:600;">{tr_dash.get('dash_archive_kpi_jobs', '🏁 งานเสร็จสิ้นทั้งหมด')}</div>
<div style="font-size:22px; font-weight:800; color:#10B981; margin-top:4px;">{total_jobs_cnt} <span style="font-size:13px; font-weight:500;">{job_unit_txt}</span></div>
</div>
""", unsafe_allow_html=True)
                with kpi_c2:
                    st.markdown(f"""
<div style="background:white; border:1px solid #EFEAE3; border-radius:10px; padding:12px; text-align:center; box-shadow:0 1px 3px rgba(0,0,0,0.04);">
<div style="font-size:12px; color:#6B7280; font-weight:600;">{tr_dash.get('dash_archive_kpi_rev', '💰 รายรับรวมจากงานเช่า')}</div>
<div style="font-size:22px; font-weight:800; color:#E85826; margin-top:4px;">฿{total_rev_sum:,.2f}</div>
</div>
""", unsafe_allow_html=True)
                with kpi_c3:
                    st.markdown(f"""
<div style="background:white; border:1px solid #EFEAE3; border-radius:10px; padding:12px; text-align:center; box-shadow:0 1px 3px rgba(0,0,0,0.04);">
<div style="font-size:12px; color:#6B7280; font-weight:600;">{tr_dash.get('dash_archive_kpi_cars', '🚘 รถที่ให้บริการ')}</div>
<div style="font-size:22px; font-weight:800; color:#3B82F6; margin-top:4px;">{unique_cars_cnt} <span style="font-size:13px; font-weight:500;">{car_unit_txt}</span></div>
</div>
""", unsafe_allow_html=True)
                with kpi_c4:
                    st.markdown(f"""
<div style="background:white; border:1px solid #EFEAE3; border-radius:10px; padding:12px; text-align:center; box-shadow:0 1px 3px rgba(0,0,0,0.04);">
<div style="font-size:12px; color:#6B7280; font-weight:600;">{tr_dash.get('dash_archive_kpi_custs', '👥 ลูกค้าที่ใช้บริการ')}</div>
<div style="font-size:22px; font-weight:800; color:#8B5CF6; margin-top:4px;">{unique_cust_cnt} <span style="font-size:13px; font-weight:500;">{cust_unit_txt}</span></div>
</div>
""", unsafe_allow_html=True)
                    
                st.markdown("<div style='height: 15px;'></div>", unsafe_allow_html=True)
                
                # --- 3. Completed Jobs Table & PDF Documents ---
                if not filtered_reports:
                    st.info("ไม่มีข้อมูลงานที่เสร็จสิ้นตรงกับเงื่อนไขที่เลือก" if cur_lang == "TH" else "No completed jobs matching the selected criteria")
                else:
                    rpt_table_html = (
                        '<div style="max-height: 250px; overflow-y: auto; overflow-x: auto; border-radius: 8px; border: 1px solid #EFEAE3;">'
                        '<table class="bo-table">'
                        '<tr>'
                        f'<th>{tr_dash.get("dash_archive_col_bkid", "รหัสการจอง")}</th>'
                        f'<th>{tr_dash.get("dash_archive_col_date", "วันที่เสร็จสิ้น")}</th>'
                        f'<th>{tr_dash.get("dash_archive_col_plate", "ทะเบียนรถ")}</th>'
                        f'<th>{tr_dash.get("dash_archive_col_cust", "ลูกค้า")}</th>'
                        f'<th>{tr_dash.get("dash_archive_col_comp", "บริษัท")}</th>'
                        f'<th>{tr_dash.get("dash_archive_col_ctype", "ประเภทสัญญา")}</th>'
                        f'<th style="text-align:right;">{tr_dash.get("dash_archive_col_rev", "รายรับสุทธิ")}</th>'
                        f'<th>{tr_dash.get("dash_archive_col_staff", "พนักงานส่ง-รับ")}</th>'
                        f'<th>{tr_dash.get("dash_archive_col_loc", "สถานที่")}</th>'
                        f'<th>{tr_dash.get("dash_archive_col_fuel", "เกจ์น้ำมัน & สภาพรถ")}</th>'
                        f'<th>{tr_dash.get("dash_archive_col_status", "สถานะ")}</th>'
                        f'<th style="text-align:center;">{tr_dash.get("dash_archive_col_docs", "เอกสารย้อนหลัง")}<br/><span style="font-size:11px; font-weight:normal; color:#8C827A;">(📝 สัญญา | 🧾 ใบเสร็จ | 📋 ลิสต์เช็ครถ)</span></th>'
                        '</tr>'
                    )
                    for item in filtered_reports:
                        t_bk = get_booking_from_completed(item)
                        cust_obj = st.session_state.customers_db.get(item.get("customer"), {})
                        car_obj = cars_db.get(item.get("car_id"), {})
                        
                        try:
                            pdf_c = generate_filled_pdf("rental_template_blank_v2.pdf", t_bk, cust_obj, car_obj)
                            b64_c = base64.b64encode(pdf_c).decode()
                            href_c = f'<a href="data:application/pdf;base64,{b64_c}" download="Agreement_{item["booking_id"]}.pdf" class="icon-link" title="โหลดสัญญาเช่า">📝</a>'
                        except Exception:
                            href_c = '<span style="color:#ccc; font-size:18px; margin-right:8px;" title="ไม่มีไฟล์สัญญา">📝</span>'
                            
                        try:
                            pdf_r = generate_receipt_bytes(f"REC{item['booking_id']}", t_bk, cust_obj, car_obj, item.get("net_price", 0), "โอนเงิน/ชำระแล้ว")
                            b64_r = base64.b64encode(pdf_r).decode()
                            href_r = f'<a href="data:application/pdf;base64,{b64_r}" download="Receipt_{item["booking_id"]}.pdf" class="icon-link" title="โหลดใบเสร็จ">🧾</a>'
                        except Exception:
                            href_r = '<span style="color:#ccc; font-size:18px; margin-right:8px;" title="ไม่มีไฟล์ใบเสร็จ">🧾</span>'
                            
                        try:
                            pdf_j = generate_job_pdf(t_bk, cust_obj, car_obj, "Return", item.get("worker_return", "admin"), item.get("loc_return", "-"), inspection_data=item)
                            b64_j = base64.b64encode(pdf_j).decode()
                            href_j = f'<a href="data:application/pdf;base64,{b64_j}" download="Inspection_Checklist_{item["booking_id"]}.pdf" class="icon-link" title="โหลดลิสต์ตรวจเช็ครถ (Vehicle Inspection Checklist PDF)">📋</a>'
                        except Exception:
                            href_j = '<span style="color:#ccc; font-size:18px; margin-right:8px;" title="ไม่มีไฟล์ลิสต์เช็ครถ">📋</span>'
                            
                        c_date_str = format_date_dmy(item.get("completed_date") or item.get("end_date"))
                        net_str = f"฿{float(item.get('net_price', 0)):,.2f}"
                        workers_str = f"{item.get('worker_delivery', '-')} / {item.get('worker_return', '-')}"
                        loc_str = item.get("loc_return") or item.get("loc_delivery") or "-"
                        
                        f_lvl = item.get("fuel_level", "⛽ เต็มถัง (100%)")
                        i_notes = item.get("inspection_notes", "ตรวจสภาพปกติ")
                        p_list = item.get("inspection_photos", [])
                        p_badge = f"<span style='background:#E0E7FF; color:#4338CA; padding:2px 7px; border-radius:10px; font-size:11px; font-weight:700; margin-left:4px;'>📸 {len(p_list)} รูป</span>" if p_list else ""
                        fuel_cell = f"<div style='font-size:12px; white-space:nowrap;'><b>{f_lvl}</b>{p_badge}</div><div style='font-size:11px; color:#6B7280; max-width:160px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;' title='{i_notes}'>{i_notes}</div>"
                        
                        c_cust_r = item.get('customer', '-')
                        c_cust_r_obj = st.session_state.customers_db.get(c_cust_r, {})
                        c_cust_r_ph = c_cust_r_obj.get("contact_no") or ""
                        c_cust_r_ph_str = f"<br/><span style='font-size:11px; color:#6B7280;'>📞 {c_cust_r_ph}</span>" if c_cust_r_ph and c_cust_r_ph != "-" else ""
                        cust_r_cell = f"<div style='min-width:130px;'><b style='color:#1F2937;'>👤 {c_cust_r}</b>{c_cust_r_ph_str}</div>"

                        rpt_row = (
                            f"<tr>"
                            f"<td style='color:#6B7280; font-size:12px; font-weight:600;'>{item.get('booking_id')}</td>"
                            f"<td style='color:#1F2937; font-size:12px; white-space:nowrap;'>📅 {c_date_str}</td>"
                            f"<td><b style='color:#1F2937;'>🚘 {item.get('car_id')}</b></td>"
                            f"<td>{cust_r_cell}</td>"
                            f"<td style='color:#4B5563; font-size:12px;'>{item.get('company')}</td>"
                            f"<td><span style='background:#F3F4F6; color:#4B5563; padding:2px 8px; border-radius:10px; font-size:11px;'>{item.get('contract_type', 'รายวัน')}</span></td>"
                            f"<td style='text-align:right; font-weight:700; color:#E85826;'>{net_str}</td>"
                            f"<td style='font-size:12px; color:#4B5563;'>{workers_str}</td>"
                            f"<td style='color:#6B7280; font-size:12px; max-width:140px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;' title='{loc_str}'>{loc_str}</td>"
                            f"<td>{fuel_cell}</td>"
                            f"<td><span style='background-color:#10B98120; color:#10B981; padding:3px 9px; border-radius:12px; font-size:11px; font-weight:600;'>เสร็จสิ้น</span></td>"
                            f"<td style='text-align:center; white-space:nowrap;'>{href_c} {href_r} {href_j}</td>"
                            f"</tr>"
                        )
                        rpt_table_html += rpt_row

                    rpt_table_html += "</table></div>"
                    st.markdown(rpt_table_html, unsafe_allow_html=True)
                    
                    # รูปภาพสภาพรถที่อัปโหลดตอนส่งงาน
                    jobs_with_photos = [x for x in filtered_reports if x.get("inspection_photos")]
                    if jobs_with_photos:
                        st.markdown("<div style='height: 10px;'></div>", unsafe_allow_html=True)
                        total_p_cnt = sum(len(x.get('inspection_photos', [])) for x in jobs_with_photos)
                        with st.expander(f"📸 คลังรูปภาพสภาพรถ & เกจ์น้ำมันตอนส่งงานปิดจ๊อบ ({total_p_cnt} รูป) — คลิกเพื่อดูภาพหลักฐาน", expanded=False):
                            for ph_job in jobs_with_photos:
                                st.markdown(f"<div style='font-size:13px; font-weight:700; color:#1F2937; margin:8px 0 4px;'>🚘 {ph_job.get('car_id')} | รหัส: {ph_job.get('booking_id')} ({ph_job.get('customer')}) — ระดับน้ำมัน: {ph_job.get('fuel_level','-')}</div>", unsafe_allow_html=True)
                                p_cols = st.columns(min(len(ph_job["inspection_photos"]), 4))
                                for p_idx, p_obj in enumerate(ph_job["inspection_photos"]):
                                    with p_cols[p_idx % 4]:
                                        st.image(p_obj["data"], caption=f"{p_obj.get('name', 'ภาพสภาพรถ')} ({p_obj.get('size_kb', 0)} KB)", use_container_width=True)
                    
                    # --- 4. CSV Export Download Button ---
                    st.markdown("<div style='height: 12px;'></div>", unsafe_allow_html=True)
                    export_data = []
                    for x in filtered_reports:
                        export_data.append({
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
                            "สถานะ": "เสร็จสิ้น"
                        })
                    df_exp = pd.DataFrame(export_data)
                    csv_bytes = df_exp.to_csv(index=False).encode('utf-8-sig')
                    clean_file_m = sel_month_label.replace(" ", "_").replace("/", "-").replace("(", "").replace(")", "")
                    st.download_button(
                        label="📥 ดาวน์โหลดรายงานสรุปงานเสร็จสิ้น (CSV สำหรับ Excel)",
                        data=csv_bytes,
                        file_name=f"Report_Completed_Jobs_{clean_file_m}.csv",
                        mime="text/csv",
                        type="primary",
                        key="btn_csv_download_dash"
                    )