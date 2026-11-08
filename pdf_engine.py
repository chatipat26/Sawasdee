import os
import io
from datetime import datetime, date, time as d_time, timedelta, timezone
try:
    from pypdf import PdfReader, PdfWriter
except ImportError:
    try:
        from PyPDF2 import PdfReader, PdfWriter
    except ImportError:
        import PyPDF2
        PdfReader = getattr(PyPDF2, "PdfReader", getattr(PyPDF2, "PdfFileReader", None))
        PdfWriter = getattr(PyPDF2, "PdfWriter", getattr(PyPDF2, "PdfFileWriter", None))
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image as RLImage, HRFlowable
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

# =========================================================================
# CONTRACT PDF OVERLAY COORDINATES (A4: width ~595pt, height ~842pt)
# ตัวแปรพิกัด (X, Y) สำหรับ Overlay ข้อมูลลงบนไฟล์ rental_template_blank_v2.pdf
# แอดมินสามารถปรับแก้ตัวเลขแกน X, Y และขนาดฟอนต์ได้ที่นี่โดยตรง
# =========================================================================
CONTRACT_COORDINATES = {
    # 0. Header (เลขที่สัญญา & วันที่ทำสัญญา)
    "booking_id": {"x": 485, "y": 782, "font": "bold", "size": 12, "color": (0.1, 0.1, 0.1)},
    "issue_date": {"x": 485, "y": 768, "font": "regular", "size": 7.5, "color": (0.2, 0.2, 0.2)},

    # 1. Section 01: VEHICLE (ข้อมูลรถยนต์)
    "car_brand_model": {"x": 44, "y": 701, "font": "bold", "size": 9.5, "color": (1.0, 1.0, 1.0)}, # สีขาวบนแถบสีเข้ม
    "car_plate": {"x": 250, "y": 701, "font": "regular", "size": 9.0, "color": (0.15, 0.15, 0.15)},
    "car_color": {"x": 355, "y": 701, "font": "regular", "size": 9.0, "color": (0.15, 0.15, 0.15)},

    # 2. Section 02: RENTER (ข้อมูลผู้เช่า)
    "customer_name": {"x": 37, "y": 601, "font": "regular", "size": 8.5, "color": (0.15, 0.15, 0.15)},
    "nationality": {"x": 215, "y": 601, "font": "regular", "size": 8.5, "color": (0.15, 0.15, 0.15)},
    "dob": {"x": 393, "y": 601, "font": "regular", "size": 8.5, "color": (0.15, 0.15, 0.15)},

    "licence_no": {"x": 37, "y": 573, "font": "regular", "size": 8.5, "color": (0.15, 0.15, 0.15)},
    "issue_place": {"x": 170, "y": 573, "font": "regular", "size": 8.5, "color": (0.15, 0.15, 0.15)},
    "licence_expiry": {"x": 304, "y": 573, "font": "regular", "size": 8.5, "color": (0.15, 0.15, 0.15)},
    "passport_id": {"x": 437, "y": 573, "font": "regular", "size": 8.5, "color": (0.15, 0.15, 0.15)},

    # ที่อยู่ผู้เช่า
    "home_address": {"x": 37, "y": 544, "font": "regular", "size": 8.0, "color": (0.15, 0.15, 0.15), "max_chars": 55},
    "thai_address": {"x": 304, "y": 544, "font": "regular", "size": 8.0, "color": (0.15, 0.15, 0.15), "max_chars": 55},

    # ช่องทางการติดต่อ
    "email": {"x": 37, "y": 516, "font": "regular", "size": 8.5, "color": (0.15, 0.15, 0.15)},
    "contact_no": {"x": 215, "y": 516, "font": "regular", "size": 8.5, "color": (0.15, 0.15, 0.15)},
    "whatsapp": {"x": 393, "y": 516, "font": "regular", "size": 8.5, "color": (0.15, 0.15, 0.15)},

    # 3. Section 03: RENTAL PERIOD & DELIVERY (ระยะเวลาเช่าและส่งมอบ)
    "start_datetime": {"x": 37, "y": 474, "font": "regular", "size": 8.5, "color": (0.15, 0.15, 0.15)},
    "loc_delivery": {"x": 170, "y": 474, "font": "regular", "size": 8.5, "color": (0.15, 0.15, 0.15), "max_chars": 30},
    "end_datetime": {"x": 304, "y": 474, "font": "regular", "size": 8.5, "color": (0.15, 0.15, 0.15)},
    "loc_return": {"x": 437, "y": 474, "font": "regular", "size": 8.5, "color": (0.15, 0.15, 0.15), "max_chars": 30},

    # 4. Section 04: CHARGES (กล่องขาวในแถบสีส้ม TO BE INVOICED)
    "net_price": {"x": 498, "y": 303, "font": "bold", "size": 10.0, "color": (0.9, 0.35, 0.15)},

    # 5. Section 05: PAYMENT CONFIRMATION (ยืนยันการชำระเงิน)
    "confirm_ref": {"x": 37, "y": 259, "font": "regular", "size": 8.0, "color": (0.15, 0.15, 0.15)},
    "confirm_amount": {"x": 231, "y": 259, "font": "bold", "size": 8.5, "color": (0.15, 0.15, 0.15)},
}

def draw_field(can, field_key, value):
    """Draw a text string at specified coordinates from CONTRACT_COORDINATES"""
    cfg = CONTRACT_COORDINATES.get(field_key)
    if not cfg or value is None:
        return
    text = str(value)
    if not text or text == "-":
        return
    max_c = cfg.get("max_chars")
    if max_c and len(text) > max_c:
        text = text[:max_c]
    font_name = FONT_BOLD if cfg.get("font") == "bold" else FONT_REGULAR
    can.setFont(font_name, cfg.get("size", 9))
    color = cfg.get("color", (0.15, 0.15, 0.15))
    can.setFillColorRGB(*color)
    can.drawString(cfg["x"], cfg["y"], text)

def clear_dash_box(can, x, y, width=14, height=10):
    """Clear dash character in base template before drawing overlay text"""
    can.setFillColorRGB(1, 1, 1)
    can.rect(x, y - 3, width, height, fill=1, stroke=0)

def generate_filled_pdf(template_path="rental_template_blank_v2.pdf", booking_info=None, customer_info=None, car_info=None):
    """
    Generate official vehicle rental agreement PDF by overlaying text directly onto rental_template_blank_v2.pdf.
    Uses reportlab for the transparent text canvas and pypdf / PyPDF2 for page overlay.
    Strictly NO HTML-to-PDF tables.
    """
    candidate_paths = [
        template_path,
        os.path.join(BASE_DIR, template_path or ""),
        os.path.join(os.getcwd(), template_path or ""),
        os.path.join(BASE_DIR, "rental_template_blank_v2.pdf"),
        os.path.join(os.getcwd(), "rental_template_blank_v2.pdf"),
    ]
    resolved_path = None
    for p in candidate_paths:
        if p and os.path.exists(p):
            resolved_path = p
            break

    if not resolved_path:
        raise FileNotFoundError(f"Base PDF template 'rental_template_blank_v2.pdf' not found in {candidate_paths}")

    booking_info = booking_info or {}
    customer_info = customer_info or {}
    car_info = car_info or {}

    packet = io.BytesIO()
    can = canvas.Canvas(packet, pagesize=A4)

    # 0. Header (Reference No. & Date)
    th_now = now_th()
    b_id = str(booking_info.get("booking_id", "-"))
    draw_field(can, "booking_id", b_id)
    draw_field(can, "issue_date", f"Issued: {format_date_dmy(th_now.date())} {th_now.strftime('%H:%M')} น.")

    # 1. Section 01: VEHICLE
    car_brand_model = f"{car_info.get('brand', '')} {car_info.get('model', '')}".strip() or "-"
    car_plate = str(car_info.get("plate", "-"))
    car_color = str(car_info.get("color", "-"))
    draw_field(can, "car_brand_model", car_brand_model)
    draw_field(can, "car_plate", car_plate)
    draw_field(can, "car_color", car_color)

    # 2. Section 02: RENTER
    c_name = str(customer_info.get("full_name") or customer_info.get("name") or "-")
    c_nat = str(customer_info.get("nationality", "-"))
    c_dob = format_date_dmy(customer_info.get("dob", "-"))
    c_pass = str(customer_info.get("passport_id") or customer_info.get("id_card") or "-")
    c_lic = str(customer_info.get("licence_no", "-"))
    c_lic_issue = str(customer_info.get("issue_place", "-"))
    c_lic_exp = format_date_dmy(customer_info.get("licence_expiry", "-"))
    c_home = str(customer_info.get("home_address", "-"))
    c_thai = str(customer_info.get("thai_address", "-"))
    c_email = str(customer_info.get("email", "-"))
    c_phone = str(customer_info.get("contact_no") or customer_info.get("phone") or "-")
    c_wa = str(customer_info.get("whatsapp", "-"))

    draw_field(can, "customer_name", c_name)
    draw_field(can, "nationality", c_nat)
    draw_field(can, "dob", c_dob)
    draw_field(can, "licence_no", c_lic)
    draw_field(can, "issue_place", c_lic_issue)
    draw_field(can, "licence_expiry", c_lic_exp)
    draw_field(can, "passport_id", c_pass)
    draw_field(can, "home_address", c_home)

    if c_thai and c_thai != "-":
        clear_dash_box(can, CONTRACT_COORDINATES["thai_address"]["x"], CONTRACT_COORDINATES["thai_address"]["y"])
        draw_field(can, "thai_address", c_thai)

    draw_field(can, "email", c_email)
    draw_field(can, "contact_no", c_phone)
    draw_field(can, "whatsapp", c_wa)

    # 3. Section 03: RENTAL PERIOD & DELIVERY
    s_time_pdf = booking_info.get('start_time') or th_now.strftime('%H:%M')
    e_time_pdf = booking_info.get('end_time') or th_now.strftime('%H:%M')
    s_date = f"{format_date_dmy(booking_info.get('start_date'))} ({s_time_pdf} น.)"
    e_date = f"{format_date_dmy(booking_info.get('end_date'))} ({e_time_pdf} น.)"
    loc_del = str(booking_info.get("loc_delivery") or "Sukhumvit")
    loc_ret = str(booking_info.get("loc_return") or loc_del)

    draw_field(can, "start_datetime", s_date)
    if loc_del and loc_del != "-":
        clear_dash_box(can, CONTRACT_COORDINATES["loc_delivery"]["x"], CONTRACT_COORDINATES["loc_delivery"]["y"])
        draw_field(can, "loc_delivery", loc_del)

    draw_field(can, "end_datetime", e_date)
    if loc_ret and loc_ret != "-":
        clear_dash_box(can, CONTRACT_COORDINATES["loc_return"]["x"], CONTRACT_COORDINATES["loc_return"]["y"])
        draw_field(can, "loc_return", loc_ret)

    # 4. Section 04: CHARGES
    net_price = booking_info.get('net_price', 0)
    price_val = f"{net_price:,}" if isinstance(net_price, (int, float)) else str(net_price)
    draw_field(can, "net_price", f"฿ {price_val}")

    # 5. Section 05: PAYMENT CONFIRMATION
    draw_field(can, "confirm_ref", b_id)
    draw_field(can, "confirm_amount", f"THB {price_val}")

    can.save()
    packet.seek(0)

    # Merge overlay with template PDF
    overlay_pdf = PdfReader(packet)
    with open(resolved_path, "rb") as f_tpl:
        template_pdf = PdfReader(f_tpl)
        output = PdfWriter()

        base_page = template_pdf.pages[0]
        overlay_page = overlay_pdf.pages[0]
        if hasattr(base_page, "merge_page"):
            base_page.merge_page(overlay_page)
        elif hasattr(base_page, "mergePage"):
            base_page.mergePage(overlay_page)

        if hasattr(output, "add_page"):
            output.add_page(base_page)
        elif hasattr(output, "addPage"):
            output.addPage(base_page)

        for i in range(1, len(template_pdf.pages)):
            p = template_pdf.pages[i]
            if hasattr(output, "add_page"):
                output.add_page(p)
            elif hasattr(output, "addPage"):
                output.addPage(p)

        out_stream = io.BytesIO()
        output.write(out_stream)
        return out_stream.getvalue()

def generate_pdf_bytes(booking_info=None, customer_info=None, car_info=None):
    """
    Directly delegates to generate_filled_pdf using rental_template_blank_v2.pdf.
    HTML tables for rental agreements are completely deprecated.
    """
    return generate_filled_pdf("rental_template_blank_v2.pdf", booking_info, customer_info, car_info)

def generate_receipt_bytes(receipt_no, booking_info, customer_info, car_info, amount, method, item_desc="ค่าเช่ารถยนต์ (Vehicle Rental Fee)", ref_no=None):
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
        ["Payment Method (ช่องทางชำระ):", method]
    ]
    if ref_no:
        data.append(["Slip / Ref No. (เลขอ้างอิงสลิป/รายการ):", str(ref_no)])
    data.append(["Amount Received (ยอดเงินที่รับชำระ):", f"THB {float(amount):,.2f}"])
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

def generate_maintenance_job_pdf(maintenance_record, car_info=None):
    """Generate professional fleet maintenance & service work order PDF"""
    pdf_buffer = io.BytesIO()
    doc = SimpleDocTemplate(pdf_buffer, pagesize=A4, rightMargin=36, leftMargin=36, topMargin=36, bottomMargin=36)
    elements = []
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle('MntTitleStyle', parent=styles['Heading1'], fontSize=15, leading=19, textColor=colors.HexColor('#1F2937'), alignment=1, fontName=FONT_BOLD)
    sub_style = ParagraphStyle('MntSubStyle', parent=styles['Normal'], fontSize=9, leading=13, textColor=colors.HexColor('#555555'), alignment=1, fontName=FONT_REGULAR)
    cell_style = ParagraphStyle('MntCellStyle', parent=styles['Normal'], fontSize=8.5, leading=12, textColor=colors.HexColor('#2D2D2D'), fontName=FONT_REGULAR)
    cell_bold = ParagraphStyle('MntCellBold', parent=styles['Normal'], fontSize=8.5, leading=12, textColor=colors.HexColor('#1F2937'), fontName=FONT_BOLD)

    rec = maintenance_record or {}
    car = car_info or {}
    th_now = now_th()

    order_type = str(rec.get("order_type", "ซ่อมบำรุงทั่วไป / เช็คระยะ"))
    is_renewal = any(k in order_type for k in ["ต่อทะเบียน", "พ.ร.บ.", "พรบ", "ประกัน"])
    
    if is_renewal:
        doc_title = "VEHICLE TAX & INSURANCE RENEWAL WORK ORDER"
        doc_subtitle = "(ใบสั่งงานต่อทะเบียน ภาษี พ.ร.บ. และประกันภัยรถยนต์)"
    else:
        doc_title = "FLEET MAINTENANCE & SERVICE WORK ORDER"
        doc_subtitle = "(ใบสั่งงานซ่อมบำรุงและตรวจเช็คสภาพรถยนต์)"

    elements.append(Paragraph("SAWASDEE CAR RENTAL CO., LTD. (บริษัท สวัสดี เรนทัล จำกัด)", title_style))
    elements.append(Paragraph(f"<b>{doc_title}</b>", title_style))
    elements.append(Paragraph(doc_subtitle, ParagraphStyle('MntSub2', parent=sub_style, fontSize=11, fontName=FONT_BOLD, textColor=colors.HexColor('#C2410C'))))
    elements.append(Spacer(1, 4))
    
    mnt_id = rec.get("id", "-")
    created_at = rec.get("created_at") or th_now.strftime("%d/%m/%Y %H:%M")
    created_by = rec.get("created_by") or "Admin"
    elements.append(Paragraph(f"เลขที่ใบงาน (Work Order No.): <b>{mnt_id}</b> | วันที่ออกเอกสาร: <b>{created_at} น.</b> | ผู้สั่งงาน: <b>{created_by}</b>", sub_style))
    elements.append(Spacer(1, 14))

    # 1. Car & Service Info Table
    car_plate = rec.get("car_id") or car.get("plate", "-")
    car_name = f"{car.get('brand', rec.get('car_brand', ''))} {car.get('model', rec.get('car_model', ''))}".strip() or "-"
    car_color = car.get("color", rec.get("car_color", "-"))
    mileage_val = rec.get("current_mileage") or car.get("mileage", "-")
    chassis = car.get("chassis_no", "-")
    comp = car.get("company", "บจก.สวัสดี เรนทัล (Sawasdee Rental)")

    sched_s = f"{format_date_dmy(rec.get('schedule_date'))} ({rec.get('schedule_time', '09:00')} น.)"
    sched_e = f"{format_date_dmy(rec.get('expected_finish_date'))} ({rec.get('expected_finish_time', '17:00')} น.)"

    cost_val = float(rec.get("cost", 0))
    cost_str = f"{cost_val:,.2f} บาท" if cost_val > 0 else "ตามใบแจ้งหนี้จริง"

    sec1_data = [
        [Paragraph("<b>ข้อมูลรถยนต์ (Vehicle):</b>", cell_bold), Paragraph(f"<b>{car_name}</b> (สี: {car_color})", cell_style), Paragraph("<b>ทะเบียน (Plate No.):</b>", cell_bold), Paragraph(f"<b>{car_plate}</b>", cell_bold)],
        [Paragraph("<b>เลขตัวถัง (Chassis No.):</b>", cell_bold), Paragraph(str(chassis), cell_style), Paragraph("<b>เลขไมล์ปัจจุบัน (Mileage):</b>", cell_bold), Paragraph(f"{mileage_val} กม.", cell_style)],
        [Paragraph("<b>กรรมสิทธิ์ / เจ้าของ:</b>", cell_bold), Paragraph(str(comp), cell_style), Paragraph("<b>ประเภทงาน (Job Type):</b>", cell_bold), Paragraph(f"<b>{order_type}</b>", cell_bold)],
        [Paragraph("<b>อู่ / ศูนย์บริการ (Vendor):</b>", cell_bold), Paragraph(f"<b>{rec.get('service_center', '-')}</b>", cell_bold), Paragraph("<b>เบอร์โทรอู่ / ศูนย์:</b>", cell_bold), Paragraph(str(rec.get('service_center_phone', '-')), cell_style)],
        [Paragraph("<b>สถานที่นัดหมาย / พิกัด:</b>", cell_bold), Paragraph(str(rec.get('service_location', '-')), cell_style), Paragraph("<b>พนักงานผู้รับผิดชอบ:</b>", cell_bold), Paragraph(f"<b>{rec.get('assigned_worker', '-')}</b>", cell_bold)],
        [Paragraph("<b>กำหนดวันส่งมอบ / นัดหมาย:</b>", cell_bold), Paragraph(sched_s, cell_style), Paragraph("<b>กำหนดวันแล้วเสร็จ:</b>", cell_bold), Paragraph(sched_e, cell_style)],
        [Paragraph("<b>งบประมาณ / ค่าซ่อมบำรุง:</b>", cell_bold), Paragraph(f"<b>{cost_str}</b>", cell_bold), Paragraph("<b>สถานะใบงาน (Status):</b>", cell_bold), Paragraph(f"<b>{rec.get('status', 'รอดำเนินการ')}</b>", cell_bold)],
    ]
    t1 = Table(sec1_data, colWidths=[130, 160, 115, 115])
    t1.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#FFFFFF')),
        ('BACKGROUND', (0,0), (0,-1), colors.HexColor('#FAF7F2')),
        ('BACKGROUND', (2,0), (2,-1), colors.HexColor('#FAF7F2')),
        ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#E0D5C7')),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('TOPPADDING', (0,0), (-1,-1), 4),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
        ('LEFTPADDING', (0,0), (-1,-1), 6),
        ('RIGHTPADDING', (0,0), (-1,-1), 6),
    ]))
    elements.append(t1)
    elements.append(Spacer(1, 14))

    # 2. Repair / Service Items List
    elements.append(Paragraph("<b>รายการงานซ่อมบำรุง / รายการที่ต้องดำเนินการ (REPAIR & SERVICE ITEMS):</b>", ParagraphStyle('ItemsHeader', parent=styles['Normal'], fontSize=10, fontName=FONT_BOLD, textColor=colors.HexColor('#1F2937'))))
    elements.append(Spacer(1, 5))

    raw_items = str(rec.get("service_items", "-")).replace("\r\n", "\n").replace("\r", "\n")
    item_lines = [l.strip().lstrip("-•*").strip() for l in raw_items.split("\n") if l.strip()]
    if not item_lines:
        item_lines = [raw_items]

    item_rows = [
        [Paragraph("<b>ลำดับ</b>", cell_bold), Paragraph("<b>รายการตรวจเช็ค / ซ่อมบำรุง / ต่อทะเบียน-ประกัน</b>", cell_bold), Paragraph("<b>ผลการตรวจ / ดำเนินการ</b>", cell_bold)]
    ]
    for idx, it in enumerate(item_lines, 1):
        item_rows.append([
            Paragraph(f"<center>{idx}</center>", cell_style),
            Paragraph(it, cell_style),
            Paragraph("[  ] ดำเนินการเรียบร้อย", cell_style)
        ])

    while len(item_rows) < 6:
        item_rows.append([
            Paragraph(f"<center>{len(item_rows)}</center>", cell_style),
            Paragraph("____________________________________________________________", cell_style),
            Paragraph("[  ] ดำเนินการเรียบร้อย", cell_style)
        ])

    t2 = Table(item_rows, colWidths=[35, 345, 140])
    t2.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#F3EDE4')),
        ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#E0D5C7')),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('TOPPADDING', (0,0), (-1,-1), 4),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
        ('LEFTPADDING', (0,0), (-1,-1), 6),
        ('RIGHTPADDING', (0,0), (-1,-1), 6),
    ]))
    elements.append(t2)
    elements.append(Spacer(1, 12))

    # 3. Notes & Instructions
    notes_txt = rec.get("notes") or "กรุณาตรวจสอบสภาพรถก่อนและหลังเข้ารับบริการ พร้อมขอใบกำกับภาษี/ใบเสร็จรับเงินฉบับเต็ม"
    notes_box = [
        [Paragraph(f"<b>หมายเหตุ / คำสั่งการพิเศษ:</b> {notes_txt}", cell_style)]
    ]
    t3 = Table(notes_box, colWidths=[520])
    t3.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#FFFBEB')),
        ('BOX', (0,0), (-1,-1), 0.5, colors.HexColor('#FDE68A')),
        ('TOPPADDING', (0,0), (-1,-1), 6),
        ('BOTTOMPADDING', (0,0), (-1,-1), 6),
        ('LEFTPADDING', (0,0), (-1,-1), 8),
        ('RIGHTPADDING', (0,0), (-1,-1), 8),
    ]))
    elements.append(t3)
    elements.append(Spacer(1, 24))

    # 4. Signatures
    sig_data = [
        [
            Paragraph("<center>_______________________________<br/>( <b>" + str(created_by) + "</b> )<br/>ผู้สั่งงาน / ผู้อนุมัติซ่อมบำรุง</center>", cell_style),
            Paragraph("<center>_______________________________<br/>( <b>" + str(rec.get('assigned_worker', '........................')) + "</b> )<br/>พนักงานผู้รับผิดชอบงาน</center>", cell_style),
            Paragraph("<center>_______________________________<br/>( .................................................... )<br/>ศูนย์บริการ / อู่ผู้รับงาน</center>", cell_style)
        ]
    ]
    t_sig = Table(sig_data, colWidths=[173, 173, 174])
    t_sig.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('TOPPADDING', (0,0), (-1,-1), 4),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
    ]))
    elements.append(t_sig)

    doc.build(elements)
    return pdf_buffer.getvalue()

