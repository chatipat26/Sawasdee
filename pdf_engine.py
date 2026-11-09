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
    font_candidates_reg = [
        "Sarabun-Regular.ttf",
        os.path.join(BASE_DIR, "Sarabun-Regular.ttf"),
        os.path.join(os.getcwd(), "Sarabun-Regular.ttf"),
        os.path.abspath("Sarabun-Regular.ttf"),
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "Sarabun-Regular.ttf")
    ]
    for r_f in font_candidates_reg:
        if os.path.exists(r_f):
            try:
                pdfmetrics.registerFont(TTFont("Sarabun", r_f))
                reg_name = "Sarabun"
                break
            except Exception as e:
                print(f"PDF Font Notice (Regular): {e}")
    font_candidates_bold = [
        "Sarabun-Bold.ttf",
        os.path.join(BASE_DIR, "Sarabun-Bold.ttf"),
        os.path.join(os.getcwd(), "Sarabun-Bold.ttf"),
        os.path.abspath("Sarabun-Bold.ttf"),
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "Sarabun-Bold.ttf")
    ]
    for b_f in font_candidates_bold:
        if os.path.exists(b_f):
            try:
                pdfmetrics.registerFont(TTFont("Sarabun-Bold", b_f))
                bold_name = "Sarabun-Bold"
                break
            except Exception as e:
                print(f"PDF Font Notice (Bold): {e}")
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
    text = str(value).strip()
    if not text or text == "-":
        return
    max_c = cfg.get("max_chars")
    if max_c and len(text) > max_c:
        text = text[:max_c]
    font_name = FONT_BOLD if cfg.get("font") == "bold" else FONT_REGULAR
    can.setFont(font_name, cfg.get("size", 9))
    color = cfg.get("color", (0.15, 0.15, 0.15))
    can.setFillColorRGB(*color)
    try:
        can.drawString(cfg["x"], cfg["y"], text)
    except UnicodeEncodeError:
        # Fallback if standard Type 1 font is active
        safe_text = text.encode("ascii", "replace").decode("ascii")
        can.drawString(cfg["x"], cfg["y"], safe_text)

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
    try:
        candidate_paths = [
            template_path,
            os.path.join(BASE_DIR, template_path or ""),
            os.path.join(os.getcwd(), template_path or ""),
            os.path.join(BASE_DIR, "rental_template_blank_v2.pdf"),
            os.path.join(os.getcwd(), "rental_template_blank_v2.pdf"),
            os.path.abspath("rental_template_blank_v2.pdf"),
            os.path.join(os.path.dirname(os.path.abspath(__file__)), "rental_template_blank_v2.pdf"),
            os.path.join(os.path.dirname(os.getcwd()), "rental_template_blank_v2.pdf"),
        ]
        resolved_path = None
        for p in candidate_paths:
            if p and os.path.exists(p) and os.path.isfile(p):
                resolved_path = os.path.abspath(p)
                break

        if not resolved_path:
            for root, _, files in os.walk(BASE_DIR):
                if "rental_template_blank_v2.pdf" in files:
                    resolved_path = os.path.join(root, "rental_template_blank_v2.pdf")
                    break

        if not resolved_path:
            err_msg = f"Base PDF template 'rental_template_blank_v2.pdf' not found in candidate paths: {candidate_paths}"
            print(f"PDF Error: {err_msg}")
            raise FileNotFoundError(err_msg)

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

        # Merge overlay with template PDF safely across library versions using PdfWriter(clone_from=...)
        overlay_pdf = PdfReader(packet)
        ovl_page = overlay_pdf.pages[0] if hasattr(overlay_pdf, "pages") else overlay_pdf.getPage(0)

        output = None
        try:
            output = PdfWriter(clone_from=resolved_path)
            output.pages[0].merge_page(ovl_page)
        except Exception as clone_err:
            print(f"Notice: clone_from fallback: {clone_err}")
            with open(resolved_path, "rb") as f_tpl:
                template_pdf = PdfReader(f_tpl)
                output = PdfWriter()

                tpl_pages = list(template_pdf.pages) if hasattr(template_pdf, "pages") else [template_pdf.getPage(i) for i in range(template_pdf.getNumPages())]

                # Attach page to writer FIRST so it is assigned to a writer!
                if hasattr(output, "add_page"):
                    base_page = output.add_page(tpl_pages[0])
                else:
                    output.addPage(tpl_pages[0])
                    base_page = output.pages[0] if hasattr(output, "pages") else tpl_pages[0]

                if hasattr(base_page, "merge_page"):
                    base_page.merge_page(ovl_page)
                elif hasattr(base_page, "mergePage"):
                    base_page.mergePage(ovl_page)

                for i in range(1, len(tpl_pages)):
                    if hasattr(output, "add_page"):
                        output.add_page(tpl_pages[i])
                    else:
                        output.addPage(tpl_pages[i])

        out_stream = io.BytesIO()
        output.write(out_stream)
        return out_stream.getvalue()
    except Exception as e:
        print(f"PDF Error: {str(e)}")
        import traceback
        traceback.print_exc()
        raise

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
    """
    Generate vehicle inspection checklist & job sheet PDF using the official
    Sawasdee Pre-Rental Inspection template with 4-view car diagram.
    """
    insp_type = "checkin" if str(job_type).lower() in ("return", "checkin", "in") else "checkout"
    payload = dict(inspection_data or {})
    if worker and not payload.get("inspector_name"):
        payload["inspector_name"] = worker
        payload["staff_name"] = worker
    if loc and not payload.get("location"):
        payload["location"] = loc

    return generate_inspection_checklist_pdf(
        template_path="Sawasdee Pre-Rental Inspection.pdf",
        booking_info=booking_info,
        customer_info=customer_info,
        car_info=car_info,
        inspection_type=insp_type,
        payload=payload
    )

def render_inspection_html(booking_info=None, customer_info=None, car_info=None, job_type="Dispatch", worker=None, loc=None, inspection_data=None):
    """
    Render official Sawasdee Pre-Rental Inspection HTML with 4-view/5-view car diagram.
    Loads templates/inspection_template.html or falls back to internal template.
    """
    booking_info = booking_info or {}
    customer_info = customer_info or {}
    car_info = car_info or {}
    data = dict(inspection_data or {})

    b_id = booking_info.get("booking_id", "-")
    plate = car_info.get("plate") or booking_info.get("car_id", "-")
    model = f"{car_info.get('brand', '')} {car_info.get('model', '')}".strip() or booking_info.get("car_brand_model", "-")
    c_name = customer_info.get("full_name") or booking_info.get("customer", "-")
    c_phone = customer_info.get("phone") or booking_info.get("phone", "-")
    w_name = worker or data.get("inspector_name") or data.get("staff_name") or booking_info.get("worker_return" if str(job_type).lower() in ("return", "checkin") else "worker_delivery") or "Staff"
    l_name = loc or data.get("location") or booking_info.get("loc_return" if str(job_type).lower() in ("return", "checkin") else "loc_delivery") or "-"

    is_chk_out = str(job_type).lower() in ("dispatch", "checkout", "out")
    is_chk_in = not is_chk_out

    th_now = now_th()
    if is_chk_out:
        dt_val = data.get("datetime_str") or f"{format_date_dmy(booking_info.get('dispatch_date') or booking_info.get('start_date') or th_now.date())} {booking_info.get('start_time') or th_now.strftime('%H:%M')}"
        mile_val = data.get("odometer") or data.get("mileage") or booking_info.get("dispatch_mileage") or car_info.get("mileage", "-")
        fuel_val = str(data.get("fuel_level") or booking_info.get("dispatch_fuel") or "เต็มถัง (100%)")
        heading = "PRE-RENTAL INSPECTION (CHECK OUT)"
    else:
        dt_val = data.get("datetime_str") or f"{format_date_dmy(booking_info.get('return_date') or booking_info.get('end_date') or th_now.date())} {booking_info.get('end_time') or th_now.strftime('%H:%M')}"
        mile_val = data.get("odometer") or data.get("mileage") or booking_info.get("return_mileage") or car_info.get("mileage", "-")
        fuel_val = str(data.get("fuel_level") or booking_info.get("return_fuel") or "เต็มถัง (100%)")
        heading = "PRE-RENTAL INSPECTION (CHECK IN)"

    # Determine fuel check
    fuel_lower = fuel_val.lower()
    is_fuel_e = any(k in fuel_lower for k in ["e", "หมด", "empty", "1/8", "low", "เกลี้ยง"])
    is_fuel_14 = any(k in fuel_lower for k in ["1/4", "25%", "2/8", "หนึ่งส่วนสี่"])
    is_fuel_12 = any(k in fuel_lower for k in ["1/2", "50%", "ครึ่ง", "4/8", "half"])
    is_fuel_34 = any(k in fuel_lower for k in ["3/4", "75%", "6/8", "7/8", "เกือบเต็ม", "สามส่วนสี่"])
    is_fuel_f = not (is_fuel_e or is_fuel_14 or is_fuel_12 or is_fuel_34)

    notes_val = data.get("inspection_notes") or data.get("notes") or data.get("damage_desc") or (booking_info.get("dispatch_notes") if is_chk_out else booking_info.get("return_notes")) or ""

    diag_url = data.get("car_diagram_image_url") or data.get("car_diagram") or data.get("diagram_base64") or ""
    if diag_url and not diag_url.startswith("http") and not diag_url.startswith("data:"):
        diag_url = f"data:image/png;base64,{diag_url}"

    staff_sig = data.get("staff_signature") or ""
    cust_sig = data.get("customer_signature") or ""

    ctx = {
        "rental_agreement_no": b_id,
        "booking_id": b_id,
        "vehicle_reg": plate,
        "car_plate": plate,
        "vehicle_model": model,
        "car_brand_model": model,
        "customer_name": c_name,
        "customer_phone": c_phone,
        "inspector_name": w_name,
        "staff_name": w_name,
        "location": l_name,
        "inspection_datetime": dt_val,
        "date_time": dt_val,
        "mileage": f"{mile_val} km" if mile_val != "-" and not str(mile_val).endswith("km") else str(mile_val),
        "odometer": mile_val,
        "fuel_level": fuel_val,
        "is_fuel_e": is_fuel_e,
        "is_fuel_14": is_fuel_14,
        "is_fuel_12": is_fuel_12,
        "is_fuel_34": is_fuel_34,
        "is_fuel_f": is_fuel_f,
        "inspection_notes": notes_val,
        "car_diagram_image_url": diag_url,
        "staff_signature": staff_sig,
        "customer_signature": cust_sig,
        "is_checkout": is_chk_out,
        "is_checkin": is_chk_in,
        "inspection_heading": heading,
    }

    tmpl_path = os.path.join(BASE_DIR, "templates", "inspection_template.html")
    if os.path.exists(tmpl_path):
        with open(tmpl_path, "r", encoding="utf-8") as f:
            template_str = f.read()
    else:
        template_str = INSPECTION_HTML_TEMPLATE

    from jinja2 import Template
    tmpl = Template(template_str)
    return tmpl.render(**ctx)


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



# =========================================================================
# SAWASDEE PRE-RENTAL INSPECTION PDF GENERATOR (CHECK-OUT & CHECK-IN)
# =========================================================================

def _draw_inspection_page(can, page_type, b_info, c_info, car_info, data, is_active=True):
    from reportlab.lib.utils import ImageReader
    import base64

    b_info = b_info or {}
    c_info = c_info or {}
    car_info = car_info or {}
    data = data or {}

    # 1. Header
    b_id = str(b_info.get("booking_id") or "-")
    plate = str(car_info.get("plate") or b_info.get("car_id") or "-")
    mva = f"{car_info.get('brand', '')} {car_info.get('model', '')}".strip() or str(b_info.get("car_brand_model") or "-")
    
    th_now = now_th()
    if page_type == "checkout":
        dt_str = data.get("datetime_str") or f"{format_date_dmy(b_info.get('dispatch_date') or b_info.get('start_date') or th_now.date())} {b_info.get('start_time') or th_now.strftime('%H:%M')}"
        km_str = str(data.get("odometer") or data.get("mileage") or b_info.get("dispatch_mileage") or car_info.get("mileage") or "-")
        staff_str = str(data.get("staff_name") or data.get("inspector_name") or b_info.get("worker_delivery") or "Staff")
    else:
        dt_str = data.get("datetime_str") or f"{format_date_dmy(b_info.get('return_date') or b_info.get('end_date') or th_now.date())} {b_info.get('end_time') or th_now.strftime('%H:%M')}"
        km_str = str(data.get("odometer") or data.get("mileage") or b_info.get("return_mileage") or car_info.get("mileage") or "-")
        staff_str = str(data.get("staff_name") or data.get("inspector_name") or b_info.get("worker_return") or "Staff")

    can.setFont(FONT_BOLD, 9.5)
    can.setFillColor(colors.HexColor('#1E293B'))

    # Agreement No, REG No, MVA
    can.drawString(160, 708.5, b_id)
    can.drawString(345, 708.5, plate)
    can.drawString(460, 708.5, mva)

    # Date/Time, Kilometer, Prepared / Inspected By
    can.drawString(135, 693.5, dt_str)
    can.drawString(275, 693.5, f"{km_str} km" if km_str != "-" and not km_str.endswith("km") else km_str)
    can.drawString(445, 693.5, staff_str)

    # 2. Fuel Gauge Selection
    fuel = str(data.get("fuel_level") or (b_info.get("dispatch_fuel") if page_type == "checkout" else b_info.get("return_fuel")) or "F").strip()
    fuel_x_map = {
        "E": 54.0,
        "1/4": 80.5,
        "1/2": 113.5,
        "3/4": 146.5,
        "F": 179.5
    }
    target_fuel_key = "F"
    fuel_lower = fuel.lower()
    if any(k in fuel_lower for k in ["e", "หมด", "empty", "1/8", "low", "เกลี้ยง"]):
        target_fuel_key = "E"
    elif any(k in fuel_lower for k in ["1/4", "25%", "2/8", "หนึ่งส่วนสี่"]):
        target_fuel_key = "1/4"
    elif any(k in fuel_lower for k in ["1/2", "50%", "ครึ่ง", "4/8", "half"]):
        target_fuel_key = "1/2"
    elif any(k in fuel_lower for k in ["3/4", "75%", "6/8", "7/8", "เกือบเต็ม", "สามส่วนสี่"]):
        target_fuel_key = "3/4"
    else:
        target_fuel_key = "F"

    can.setFont("Helvetica-Bold", 11)
    can.setFillColor(colors.HexColor('#0F172A'))
    fx = fuel_x_map.get(target_fuel_key, 179.5)
    can.drawString(fx, 638, "X")

    # 3. Checklists
    can.setFont("Helvetica-Bold", 10.5)
    can.setFillColor(colors.HexColor('#1E40AF')) # Crisp blue mark
    
    # Cleanliness
    clean_items = [576.5, 563.5, 550.5, 538.0]
    for cy in clean_items:
        can.drawString(53.5, cy, "X")

    # Tires
    tire_items = [482.0, 469.0, 456.0]
    for ty in tire_items:
        can.drawString(53.5, ty, "X")

    # Interior & Controls
    int_items = [623.5, 610.0, 597.5, 584.0, 560.5, 547.5, 534.5, 511.0, 493.5]
    for iy in int_items:
        can.drawString(224.5, iy, "X")

    # Under Hood & Ext.
    hood_items = [623.5, 600.5, 577.5, 564.0, 540.5, 527.0]
    for hy in hood_items:
        can.drawString(395.5, hy, "X")

    # 4. Remarks / Notes
    notes_val = str(data.get("notes") or data.get("inspection_notes") or data.get("damage_desc") or (b_info.get("dispatch_notes") if page_type == "checkout" else b_info.get("return_notes")) or "").strip()
    if notes_val:
        can.setFont(FONT_REGULAR, 7.5)
        can.setFillColor(colors.HexColor('#DC2626') if page_type == 'checkin' and any(k in notes_val.lower() for k in ['รอย', 'บุบ', 'ขีดข่วน', 'damage', 'dent', 'scratch']) else colors.HexColor('#1E293B'))
        # Draw notes neatly inside remark box
        words = notes_val
        line1 = words[:38]
        line2 = words[38:76]
        line3 = words[76:114]
        if line1: can.drawString(50, 205, f"Note: {line1}")
        if line2: can.drawString(50, 195, line2)
        if line3: can.drawString(50, 185, line3)

    # 5. Car Diagram with Marked Defects (Base64 Image Overlay)
    car_diag_b64 = data.get("car_diagram") or data.get("diagram_base64")
    if car_diag_b64 and is_active:
        try:
            raw_b64 = str(car_diag_b64)
            if "," in raw_b64:
                raw_b64 = raw_b64.split(",", 1)[1]
            img_bytes = base64.b64decode(raw_b64)
            img = ImageReader(io.BytesIO(img_bytes))
            # The damage car diagram box: x=186, y=175, width=363, height=263
            can.drawImage(img, 186, 175, width=363, height=263, mask='auto', preserveAspectRatio=True)
        except Exception as diag_err:
            print(f"[PDF Engine] Inspection Car Diagram overlay note: {diag_err}")

    # 6. Staff & Customer Signatures
    staff_sig = data.get("staff_signature")
    if staff_sig:
        try:
            if str(staff_sig).startswith("data:image") or len(str(staff_sig)) > 200:
                s_b64 = str(staff_sig).split(",", 1)[1] if "," in str(staff_sig) else str(staff_sig)
                s_img = ImageReader(io.BytesIO(base64.b64decode(s_b64)))
                can.drawImage(s_img, 70, 65, width=190, height=45, mask='auto', preserveAspectRatio=True)
            else:
                can.setFont(FONT_BOLD, 10)
                can.setFillColor(colors.HexColor('#1E293B'))
                can.drawCentredString(165, 93, str(staff_sig))
        except Exception as sig_err:
            print(f"[PDF Engine] Staff signature overlay note: {sig_err}")
    else:
        can.setFont(FONT_REGULAR, 9)
        can.setFillColor(colors.HexColor('#64748B'))
        can.drawCentredString(165, 93, staff_str)

    cust_sig = data.get("customer_signature")
    cust_name = str(c_info.get("full_name") or b_info.get("customer") or "Customer")
    if cust_sig:
        try:
            if str(cust_sig).startswith("data:image") or len(str(cust_sig)) > 200:
                c_b64 = str(cust_sig).split(",", 1)[1] if "," in str(cust_sig) else str(cust_sig)
                c_img = ImageReader(io.BytesIO(base64.b64decode(c_b64)))
                can.drawImage(c_img, 330, 65, width=190, height=45, mask='auto', preserveAspectRatio=True)
            else:
                can.setFont(FONT_BOLD, 10)
                can.setFillColor(colors.HexColor('#1E293B'))
                can.drawCentredString(425, 93, str(cust_sig))
        except Exception as sig_err:
            print(f"[PDF Engine] Customer signature overlay note: {sig_err}")
    else:
        can.setFont(FONT_REGULAR, 9)
        can.setFillColor(colors.HexColor('#64748B'))
        can.drawCentredString(425, 93, cust_name)



def _generate_fallback_inspection_pdf(booking_info=None, customer_info=None, car_info=None, is_checkout=True, payload=None):
    """
    Bulletproof standalone PDF generator that draws the full Sawasdee Pre-Rental
    Inspection checklist with 4-view car diagram using ReportLab Canvas.
    Guarantees an HTTP 200 PDF output even if the background PDF template is absent.
    """
    pdf_buffer = io.BytesIO()
    can = canvas.Canvas(pdf_buffer, pagesize=(594.96, 841.92))
    page_type = "checkout" if is_checkout else "checkin"

    # Outer form border
    can.setStrokeColor(colors.HexColor('#0F172A'))
    can.setLineWidth(1.2)
    can.rect(28, 28, 538.96, 785.92)

    # Header Box & Title
    can.setFont(FONT_BOLD, 15)
    can.setFillColor(colors.HexColor('#0F172A'))
    can.drawString(40, 788, "SAWASDEE CAR RENT CO., LTD.")
    can.setFont(FONT_REGULAR, 7.5)
    can.setFillColor(colors.HexColor('#64748B'))
    can.drawString(40, 776, "199/21 Sukhumvit 31 Alley (Sawasdee), Khlong Tan Nuea, Vadhana, Bangkok 10110 | +66 81 346 6888")

    can.setFont(FONT_BOLD, 10.5)
    can.setFillColor(colors.HexColor('#0F172A'))
    can.drawRightString(554, 788, "PRE-RENTAL INSPECTION (CHECK OUT)" if is_checkout else "PRE-RENTAL INSPECTION (CHECK IN)")

    # Section borders
    can.setStrokeColor(colors.HexColor('#CBD5E1'))
    can.setLineWidth(0.8)
    can.rect(36, 680, 523, 46)
    can.rect(36, 440, 160, 230)
    can.rect(202, 440, 175, 230)
    can.rect(383, 440, 176, 230)
    can.rect(36, 170, 145, 260)
    can.rect(186, 170, 373, 260)
    can.rect(36, 45, 523, 115)

    # Category Section Headings
    can.setFont(FONT_BOLD, 9)
    can.setFillColor(colors.HexColor('#0F172A'))
    can.drawString(42, 658, "Fuel Level (ระดับน้ำมัน)")
    can.drawString(42, 595, "Cleanliness (ความสะอาด)")
    can.drawString(42, 500, "Tires (สภาพยาง)")
    can.drawString(208, 658, "Interior & Controls (ระบบภายใน)")
    can.drawString(389, 658, "Under Hood & Equipment (เครื่องยนต์)")

    # Remarks Heading
    can.drawString(42, 418, "Remark / ข้อกำหนด:")
    can.setFont(FONT_REGULAR, 7)
    can.setFillColor(colors.HexColor('#475569'))
    can.drawString(42, 402, "1. TRAFFIC LAW: Renter responsible")
    can.drawString(42, 390, "2. SMOKING: 3,000 THB fine")
    can.drawString(42, 378, "3. KEY LOST: Charge actual cost")
    can.drawString(42, 366, "4. CLEAN UP: 1,000 THB improper usage")
    can.drawString(42, 354, "5. COVERAGE: Waiver ex. tires/glass")
    can.drawString(42, 342, "6. RETURN: Same condition")

    # Diagram Section Schematic Outlines
    can.setFont(FONT_BOLD, 7)
    can.setFillColor(colors.HexColor('#475569'))
    can.drawString(205, 412, "FRONT")
    can.rect(195, 360, 50, 48)
    can.drawString(205, 342, "REAR")
    can.rect(195, 290, 50, 48)
    can.drawString(300, 412, "TOP VIEW")
    can.roundRect(280, 280, 70, 128, 8)
    can.drawString(440, 412, "LEFT")
    can.rect(400, 360, 120, 48)
    can.drawString(440, 342, "RIGHT")
    can.rect(400, 290, 120, 48)

    # Legend
    can.setFont(FONT_BOLD, 8)
    can.setFillColor(colors.HexColor('#DC2626'))
    can.drawString(200, 180, "X = Dent (รอยบุบ)")
    can.setFillColor(colors.HexColor('#2563EB'))
    can.drawString(300, 180, "D = Scratch (รอยขีดข่วน)")

    # Overlay all dynamic data
    _draw_inspection_page(can, page_type, booking_info or {}, customer_info or {}, car_info or {}, payload or {}, is_active=True)

    can.save()
    pdf_buffer.seek(0)
    return pdf_buffer.getvalue()


def generate_inspection_checklist_pdf(template_path="Sawasdee Pre-Rental Inspection.pdf", booking_info=None, customer_info=None, car_info=None, inspection_type="checkout", payload=None):
    """
    Generate official Sawasdee Pre-Rental Inspection Checklist PDF by overlaying data
    onto Sawasdee Pre-Rental Inspection.pdf (Page 1 = Check Out, Page 2 = Check In).
    Supports Base64 marked car diagram, signatures, fuel level, and condition notes.
    Wrapped in bulletproof exception handling with automatic fallback to prevent 500 errors.
    """
    booking_info = booking_info or {}
    customer_info = customer_info or {}
    car_info = car_info or {}
    payload = payload or {}
    insp_type = str(inspection_type or "checkout").lower().strip()
    is_checkout = insp_type in ("checkout", "dispatch", "out")

    # Search for template dynamically
    resolved_path = None
    target_names = [template_path, "Sawasdee Pre-Rental Inspection.pdf", "sawasdee pre-rental inspection.pdf", "inspection_template.pdf"]
    search_dirs = [BASE_DIR, os.getcwd(), os.path.dirname(os.path.abspath(__file__)), "."]
    for d in search_dirs:
        if not d or not os.path.exists(d):
            continue
        for name in target_names:
            if not name:
                continue
            p = os.path.join(d, name) if not os.path.isabs(name) else name
            if os.path.exists(p) and os.path.isfile(p):
                resolved_path = os.path.abspath(p)
                break
        if resolved_path:
            break
        # Case-insensitive filename search in directory
        try:
            for f in os.listdir(d):
                fl = f.lower()
                if "sawasdee" in fl and "inspection" in fl and fl.endswith(".pdf"):
                    resolved_path = os.path.abspath(os.path.join(d, f))
                    break
        except Exception:
            pass
        if resolved_path:
            break

    if not resolved_path:
        return _generate_fallback_inspection_pdf(booking_info, customer_info, car_info, is_checkout=is_checkout, payload=payload)

    try:
        reader = PdfReader(resolved_path)
        writer = PdfWriter()

        # Determine if Page 0 (Check Out) should be populated
        page0_data = payload if is_checkout else {
            "odometer": booking_info.get("dispatch_mileage"),
            "fuel_level": booking_info.get("dispatch_fuel"),
            "notes": booking_info.get("dispatch_notes"),
            "staff_name": booking_info.get("worker_delivery"),
            "datetime_str": f"{format_date_dmy(booking_info.get('dispatch_date') or booking_info.get('start_date'))} {booking_info.get('start_time') or ''}".strip()
        }
        has_page0_data = is_checkout or bool(booking_info.get("dispatch_closed") or booking_info.get("dispatch_mileage"))

        # Determine if Page 1 (Check In) should be populated
        page1_data = payload if not is_checkout else {
            "odometer": booking_info.get("return_mileage"),
            "fuel_level": booking_info.get("return_fuel"),
            "notes": booking_info.get("return_notes"),
            "staff_name": booking_info.get("worker_return"),
            "datetime_str": f"{format_date_dmy(booking_info.get('return_date') or booking_info.get('end_date'))} {booking_info.get('end_time') or ''}".strip()
        }
        has_page1_data = (not is_checkout) or bool(booking_info.get("return_closed") or booking_info.get("return_mileage"))

        # Process Page 0 (Check Out)
        page0 = reader.pages[0]
        if has_page0_data:
            packet0 = io.BytesIO()
            can0 = canvas.Canvas(packet0, pagesize=(594.96, 841.92))
            _draw_inspection_page(can0, "checkout", booking_info, customer_info, car_info, page0_data, is_active=is_checkout)
            can0.save()
            packet0.seek(0)
            overlay0 = PdfReader(packet0)
            page0.merge_page(overlay0.pages[0])
        writer.add_page(page0)

        # Process Page 1 (Check In) if template has 2 pages
        if len(reader.pages) > 1:
            page1 = reader.pages[1]
            if has_page1_data:
                packet1 = io.BytesIO()
                can1 = canvas.Canvas(packet1, pagesize=(594.96, 841.92))
                _draw_inspection_page(can1, "checkin", booking_info, customer_info, car_info, page1_data, is_active=(not is_checkout))
                can1.save()
                packet1.seek(0)
                overlay1 = PdfReader(packet1)
                page1.merge_page(overlay1.pages[0])
            writer.add_page(page1)

        out_buf = io.BytesIO()
        writer.write(out_buf)
        return out_buf.getvalue()
    except Exception as overlay_err:
        print(f"[PDF Engine] Overlay on PDF template failed: {overlay_err}, falling back to canvas drawing")
        return _generate_fallback_inspection_pdf(booking_info, customer_info, car_info, is_checkout=is_checkout, payload=payload)
