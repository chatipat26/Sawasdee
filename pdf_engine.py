import os
import io
from datetime import datetime, date, time as d_time, timedelta, timezone
from pypdf import PdfReader, PdfWriter
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image as RLImage
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TH_TZ = timezone(timedelta(hours=7))

def now_th():
    return datetime.now(TH_TZ)

# -------------------------------------------------------------------------
# FONT REGISTRATION
# -------------------------------------------------------------------------
def load_thai_font():
    bold_name = "Helvetica-Bold"
    reg_name = "Helvetica"
    for r_f in ["Sarabun-Regular.ttf", os.path.join(BASE_DIR, "Sarabun-Regular.ttf")]:
        if os.path.exists(r_f):
            try:
                pdfmetrics.registerFont(TTFont("Sarabun", r_f))
                reg_name = "Sarabun"
                break
            except Exception:
                pass
    for b_f in ["Sarabun-Bold.ttf", os.path.join(BASE_DIR, "Sarabun-Bold.ttf")]:
        if os.path.exists(b_f):
            try:
                pdfmetrics.registerFont(TTFont("Sarabun-Bold", b_f))
                bold_name = "Sarabun-Bold"
                break
            except Exception:
                pass
    return reg_name, bold_name

FONT_REGULAR, FONT_BOLD = load_thai_font()

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

def generate_filled_pdf(template_path, booking_info, customer_info, car_info):
    """Generate filled rental agreement PDF overlaying on blank template"""
    try:
        if not os.path.isabs(template_path):
            template_path = os.path.join(BASE_DIR, template_path)
            
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
        th_now = now_th()
        s_time_pdf = booking_info.get('start_time') or th_now.strftime('%H:%M')
        e_time_pdf = booking_info.get('end_time') or th_now.strftime('%H:%M')
        s_date = f"{format_date_dmy(booking_info.get('start_date'))} ({s_time_pdf} น.)"
        e_date = f"{format_date_dmy(booking_info.get('end_date'))} ({e_time_pdf} น.)"
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
        
        # --- 0. Header (Reference No. & Date) ---
        can.setFont(FONT_BOLD, 12)
        can.setFillColorRGB(0.1, 0.1, 0.1)
        can.drawString(485, 782, b_id)
        can.setFont(FONT_REGULAR, 7.5)
        can.drawString(485, 768, f"Issued: {format_date_dmy(th_now.date())} {th_now.strftime('%H:%M')} น.")
        
        # --- 1. Section 01: VEHICLE ---
        can.setFillColorRGB(1, 1, 1)
        can.setFont(FONT_BOLD, 9.5)
        can.drawString(44, 701, car_brand_model)
        
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
            
        out_stream = io.BytesIO()
        output.write(out_stream)
        return out_stream.getvalue()
    except Exception as e:
        print(f"Error filling PDF: {e}")
        return generate_pdf_bytes(booking_info, customer_info, car_info)

def generate_pdf_bytes(booking_info=None, customer_info=None, car_info=None):
    """Fallback PDF generator when template PDF is missing"""
    pdf_buffer = io.BytesIO()
    doc = SimpleDocTemplate(pdf_buffer, pagesize=A4, rightMargin=36, leftMargin=36, topMargin=36, bottomMargin=36)
    elements = []
    styles = getSampleStyleSheet()
    
    title_style = ParagraphStyle('TitleStyle', parent=styles['Heading1'], fontSize=18, leading=22, textColor=colors.HexColor('#1F2937'), alignment=1, fontName=FONT_BOLD)
    body_style = ParagraphStyle('BodyStyle', parent=styles['Normal'], fontSize=10, leading=14, textColor=colors.HexColor('#374151'), fontName=FONT_REGULAR)
    
    elements.append(Paragraph("<b>SAWASDEE CAR RENTAL CO., LTD.</b>", title_style))
    elements.append(Paragraph("VEHICLE RENTAL AGREEMENT (สัญญาเช่ารถยนต์)", title_style))
    elements.append(Spacer(1, 15))
    
    bk = booking_info or {}
    cust = customer_info or {}
    car = car_info or {}
    
    data = [
        ["Booking ID (รหัสการจอง):", bk.get("booking_id", "-")],
        ["Customer Name (ชื่อลูกค้า):", cust.get("full_name", "-")],
        ["ID / Passport No.:", cust.get("passport_id", "-")],
        ["Phone (เบอร์โทร):", cust.get("contact_no", "-")],
        ["Vehicle (รถยนต์):", f"{car.get('brand', '')} {car.get('model', '')} ({car.get('plate', '-')})"],
        ["Rental Period (ระยะเวลา):", f"{format_date_dmy(bk.get('start_date'))} ({bk.get('start_time', '10:00')}) - {format_date_dmy(bk.get('end_date'))} ({bk.get('end_time', '10:00')})"],
        ["Net Rental Amount (ค่าเช่าสุทธิ):", f"THB {float(bk.get('net_price', 0)):,.2f}"],
        ["Deposit (เงินมัดจำประกันสัญญา):", f"THB {float(bk.get('deposit_amount', 5000)):,.2f}"]
    ]
    t = Table(data, colWidths=[180, 320])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#FFFFFF')),
        ('TEXTCOLOR', (0,0), (-1,-1), colors.HexColor('#2D2D2D')),
        ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#E0D5C7')),
        ('FONTNAME', (0,0), (-1,-1), FONT_REGULAR),
        ('FONTSIZE', (0,0), (-1,-1), 10),
        ('BOTTOMPADDING', (0,0), (-1,-1), 6),
        ('TOPPADDING', (0,0), (-1,-1), 6),
        ('FONTNAME', (0,0), (0,-1), FONT_BOLD)
    ]))
    elements.append(t)
    doc.build(elements)
    return pdf_buffer.getvalue()

def generate_receipt_bytes(receipt_no, booking_info, customer_info, car_info, amount, method, item_desc="ค่าเช่ารถยนต์ (Vehicle Rental Fee)"):
    """Generate official receipt PDF"""
    pdf_buffer = io.BytesIO()
    doc = SimpleDocTemplate(pdf_buffer, pagesize=A4, rightMargin=40, leftMargin=40, topMargin=40, bottomMargin=40)
    elements = []
    styles = getSampleStyleSheet()
    
    logo_path = os.path.join(BASE_DIR, "sawasdee-logo.png")
    if os.path.exists(logo_path):
        try:
            elements.append(RLImage(logo_path, width=120, height=45))
            elements.append(Spacer(1, 10))
        except Exception:
            pass
            
    title_style = ParagraphStyle('TitleStyle', parent=styles['Heading1'], fontSize=16, leading=20, textColor=colors.HexColor('#1F2937'), alignment=0, fontName=FONT_BOLD)
    elements.append(Paragraph("SAWASDEE CAR RENTAL CO., LTD.", title_style))
    elements.append(Paragraph("OFFICIAL RECEIPT / ใบเสร็จรับเงิน", title_style))
    elements.append(Spacer(1, 15))
    
    c_name = customer_info.get("full_name", "-") if customer_info else "-"
    car_name = f"{car_info.get('brand', '')} {car_info.get('model', '')} ({car_info.get('plate', '')})" if car_info else "-"
    
    data = [
        ["Receipt No. (เลขที่ใบเสร็จ):", receipt_no],
        ["Date (วันที่ออกใบเสร็จ):", f"{now_th().strftime('%d/%m/%Y %H:%M')} น."],
        ["Booking ID (รหัสการจอง):", booking_info.get("booking_id", "-")],
        ["Customer Name (ชื่อลูกค้า):", c_name],
        ["Vehicle (รถยนต์):", car_name],
        ["Description (รายการ):", item_desc],
        ["Payment Method (ช่องทางชำระ):", method],
        ["Amount Received (ยอดเงินที่รับชำระ):", f"THB {float(amount):,.2f}"]
    ]
    t = Table(data, colWidths=[200, 300])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#FFFFFF')),
        ('TEXTCOLOR', (0,0), (-1,-1), colors.HexColor('#2D2D2D')),
        ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#E0D5C7')),
        ('FONTNAME', (0,0), (-1,-1), FONT_REGULAR),
        ('FONTSIZE', (0,0), (-1,-1), 10),
        ('BOTTOMPADDING', (0,0), (-1,-1), 8),
        ('TOPPADDING', (0,0), (-1,-1), 8),
        ('FONTNAME', (0,0), (0,-1), FONT_BOLD)
    ]))
    elements.append(t)
    elements.append(Spacer(1, 40))
    
    sig_data = [["____________________________________"], ["Authorized Signature / ผู้รับเงิน"]]
    sig_table = Table(sig_data, colWidths=[200])
    sig_table.setStyle(TableStyle([
        ('ALIGN', (0,0), (-1,-1), 'RIGHT'),
        ('FONTNAME', (0,0), (-1,-1), FONT_REGULAR),
        ('FONTSIZE', (0,0), (-1,-1), 9)
    ]))
    elements.append(sig_table)
    
    doc.build(elements)
    return pdf_buffer.getvalue()

def generate_job_pdf(booking_info, customer_info, car_info, job_type="Dispatch", worker=None, loc=None, inspection_data=None):
    """Generate vehicle inspection checklist & job sheet PDF"""
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
    
    th_now = now_th()
    doc_title = "VEHICLE INSPECTION CHECKLIST (ใบตรวจสภาพรถยนต์ & ลิสต์เช็ครถ)"
    elements.append(Paragraph("SAWASDEE CAR RENTAL CO., LTD.", title_style))
    elements.append(Paragraph(doc_title, title_style))
    elements.append(Paragraph(f"Booking Ref: <b>{booking_info.get('booking_id', '-')}</b> | วันที่บันทึก: {th_now.strftime('%d/%m/%Y %H:%M')} น.", sub_style))
    elements.append(Spacer(1, 16))
    
    c_name = customer_info.get("full_name", "-") if customer_info else "-"
    car_name = f"{car_info.get('brand', '')} {car_info.get('model', '')} ({car_info.get('plate', '')})" if car_info else "-"
    w_val = worker if worker and worker.strip() else (booking_info.get("worker_return") or booking_info.get("worker_delivery") or "-")
    l_val = loc if loc and loc.strip() else (booking_info.get("loc_return") or booking_info.get("loc_delivery") or "-")
    
    s_t_job = booking_info.get('start_time') or th_now.strftime('%H:%M')
    e_t_job = booking_info.get('end_time') or th_now.strftime('%H:%M')
    data = [
        ["Customer Name (ลูกค้า):", c_name], ["Vehicle (รถยนต์):", car_name],
        ["Rental Period (ระยะเวลาเช่า):", f"{format_date_dmy(booking_info.get('start_date'))} ({s_t_job} น.) - {format_date_dmy(booking_info.get('end_date'))} ({e_t_job} น.)"],
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
    sig_table.setStyle(TableStyle([
        ('ALIGN', (0,0), (-1,-1), 'CENTER'),
        ('FONTNAME', (0,0), (-1,-1), FONT_REGULAR),
        ('FONTSIZE', (0,0), (-1,-1), 9)
    ]))
    elements.append(sig_table)
    
    doc.build(elements)
    return pdf_buffer.getvalue()
