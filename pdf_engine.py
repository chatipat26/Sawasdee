import os
import io
from datetime import datetime, date, time as d_time, timedelta, timezone
from pypdf import PdfReader, PdfWriter
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

def generate_filled_pdf(template_path, booking_info, customer_info, car_info):
    """Generate filled rental agreement PDF overlaying on blank template (rental_template_blank_v2.pdf)"""
    try:
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

        loc_del = str(booking_info.get("loc_delivery") or "Sukhumvit")
        loc_ret = str(booking_info.get("loc_return") or loc_del)

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
        with open(resolved_path, "rb") as f_tpl:
            existing_pdf = PdfReader(f_tpl)
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
        print(f"Error filling PDF overlay: {e}")
        return generate_pdf_bytes(booking_info, customer_info, car_info)

def generate_pdf_bytes(booking_info=None, customer_info=None, car_info=None):
    """Generate official formal vehicle rental agreement PDF (A4 Full Formal Agreement)"""
    pdf_buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        pdf_buffer,
        pagesize=A4,
        rightMargin=36,
        leftMargin=36,
        topMargin=28,
        bottomMargin=28
    )
    elements = []
    styles = getSampleStyleSheet()

    # Typography styles
    comp_sub_style = ParagraphStyle(
        'CompSub', parent=styles['Normal'],
        fontSize=8, leading=11, textColor=colors.HexColor('#475569'),
        fontName=FONT_REGULAR, alignment=0
    )
    doc_title_style = ParagraphStyle(
        'DocTitle', parent=styles['Heading2'],
        fontSize=13, leading=16, textColor=colors.HexColor('#0F172A'),
        fontName=FONT_BOLD, alignment=1
    )
    doc_sub_style = ParagraphStyle(
        'DocSub', parent=styles['Normal'],
        fontSize=8.5, leading=12, textColor=colors.HexColor('#64748B'),
        fontName=FONT_REGULAR, alignment=1
    )
    sec_header_style = ParagraphStyle(
        'SecHeader', parent=styles['Normal'],
        fontSize=9.5, leading=13, textColor=colors.HexColor('#1E3A8A'),
        fontName=FONT_BOLD
    )
    cell_lbl_style = ParagraphStyle(
        'CellLabel', parent=styles['Normal'],
        fontSize=8, leading=11, textColor=colors.HexColor('#475569'),
        fontName=FONT_BOLD
    )
    cell_val_style = ParagraphStyle(
        'CellVal', parent=styles['Normal'],
        fontSize=8, leading=11, textColor=colors.HexColor('#0F172A'),
        fontName=FONT_REGULAR
    )
    terms_title_style = ParagraphStyle(
        'TermsTitle', parent=styles['Normal'],
        fontSize=9, leading=12, textColor=colors.HexColor('#1E3A8A'),
        fontName=FONT_BOLD
    )
    terms_body_style = ParagraphStyle(
        'TermsBody', parent=styles['Normal'],
        fontSize=7.2, leading=9.5, textColor=colors.HexColor('#334155'),
        fontName=FONT_REGULAR
    )
    sig_lbl_style = ParagraphStyle(
        'SigLabel', parent=styles['Normal'],
        fontSize=8, leading=11, textColor=colors.HexColor('#334155'),
        fontName=FONT_REGULAR, alignment=1
    )
    sig_name_style = ParagraphStyle(
        'SigName', parent=styles['Normal'],
        fontSize=8.5, leading=11, textColor=colors.HexColor('#0F172A'),
        fontName=FONT_BOLD, alignment=1
    )

    bk = booking_info or {}
    cust = customer_info or {}
    car = car_info or {}
    th_now = now_th()

    bk_id = str(bk.get("booking_id", "-"))
    cust_name = str(cust.get("full_name") or cust.get("name") or "-")
    cust_id = str(cust.get("passport_id") or cust.get("id_card") or "-")
    cust_lic = str(cust.get("licence_no") or "-")
    cust_phone = str(cust.get("contact_no") or cust.get("phone") or "-")
    cust_email = str(cust.get("email") or "-")
    cust_addr = str(cust.get("thai_address") or cust.get("home_address") or cust.get("address") or "-")

    car_brand = str(car.get("brand", ""))
    car_model = str(car.get("model", ""))
    car_full_name = f"{car_brand} {car_model}".strip() or "-"
    car_plate = str(car.get("plate", "-"))
    car_color = str(car.get("color", "-"))
    car_fuel = str(car.get("fuel_type", "เบนซิน"))
    car_year = str(car.get("reg_year") or car.get("year") or "2024")

    s_time = bk.get("start_time") or th_now.strftime("%H:%M")
    e_time = bk.get("end_time") or th_now.strftime("%H:%M")
    s_date_str = f"{format_date_dmy(bk.get('start_date'))} ({s_time} น.)"
    e_date_str = f"{format_date_dmy(bk.get('end_date'))} ({e_time} น.)"
    loc_del = str(bk.get("loc_delivery") or "สำนักงานใหญ่ (Sukhumvit)")
    loc_ret = str(bk.get("loc_return") or loc_del)

    net_price = float(bk.get("net_price", 0))
    deposit_amt = float(bk.get("deposit_amount", 5000))
    pay_method = str(bk.get("rental_payment_method") or bk.get("deposit_method") or "โอนเงิน / สแกน QR")
    created_date = format_date_dmy(bk.get("created_at") or th_now.date())

    # -------------------------------------------------------------
    # 1. HEADER (Logo + Company Address & Tax ID)
    # -------------------------------------------------------------
    logo_path = os.path.join(BASE_DIR, "sawasdee-logo.png")
    header_logo = None
    if os.path.exists(logo_path):
        try:
            header_logo = RLImage(logo_path, width=80, height=28)
        except Exception:
            header_logo = None

    comp_info_html = (
        "<b>SAWASDEE CAR RENTAL CO., LTD. (บริษัท สวัสดี เรนทัล จำกัด)</b><br/>"
        "88/1 Sukhumvit Rd., Khlong Toei, Bangkok 10110 Thailand | โทร: 02-123-4567, 081-234-5678<br/>"
        "อีเมล: contact@sawasdeerental.com | เลขประจำตัวผู้เสียภาษี: 0105565012345"
    )

    if header_logo:
        header_table = Table(
            [[header_logo, Paragraph(comp_info_html, comp_sub_style)]],
            colWidths=[90, 433]
        )
        header_table.setStyle(TableStyle([
            ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
            ('LEFTPADDING', (1,0), (1,0), 6),
            ('RIGHTPADDING', (0,0), (-1,-1), 0),
            ('TOPPADDING', (0,0), (-1,-1), 0),
            ('BOTTOMPADDING', (0,0), (-1,-1), 0),
        ]))
        elements.append(header_table)
    else:
        elements.append(Paragraph(comp_info_html, comp_sub_style))

    elements.append(Spacer(1, 6))
    elements.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor('#CBD5E1'), spaceAfter=8, spaceBefore=4))

    # Document Title & Subtitle
    elements.append(Paragraph("<b>VEHICLE RENTAL AGREEMENT (สัญญาเช่ารถยนต์)</b>", doc_title_style))
    elements.append(Paragraph(
        f"เลขที่สัญญา (Agreement No.): <b>{bk_id}</b> &nbsp;|&nbsp; วันที่ทำสัญญา (Date): <b>{created_date}</b>",
        doc_sub_style
    ))
    elements.append(Spacer(1, 8))

    # -------------------------------------------------------------
    # 2. DETAILS SECTION (Customer, Vehicle, Rental Period, Charges)
    # -------------------------------------------------------------
    details_data = [
        [
            Paragraph("<b>ข้อมูลผู้เช่า (Lessee Information)</b>", sec_header_style), "",
            Paragraph("<b>ข้อมูลรถยนต์ (Vehicle Information)</b>", sec_header_style), ""
        ],
        [
            Paragraph("ชื่อ-นามสกุล (Name):", cell_lbl_style), Paragraph(cust_name, cell_val_style),
            Paragraph("ยี่ห้อ / รุ่น (Model):", cell_lbl_style), Paragraph(f"<b>{car_full_name}</b> ({car_year})", cell_val_style)
        ],
        [
            Paragraph("บัตร ปชช./Passport:", cell_lbl_style), Paragraph(cust_id, cell_val_style),
            Paragraph("ทะเบียนรถ (Plate):", cell_lbl_style), Paragraph(f"<b>{car_plate}</b> (สี: {car_color})", cell_val_style)
        ],
        [
            Paragraph("ใบขับขี่ (Driving License):", cell_lbl_style), Paragraph(cust_lic, cell_val_style),
            Paragraph("ประเภทเชื้อเพลิง (Fuel):", cell_lbl_style), Paragraph(car_fuel, cell_val_style)
        ],
        [
            Paragraph("เบอร์โทรศัพท์ (Phone):", cell_lbl_style), Paragraph(cust_phone, cell_val_style),
            Paragraph("สถานที่รับรถ (Pick-up):", cell_lbl_style), Paragraph(loc_del[:35], cell_val_style)
        ],
        [
            Paragraph("อีเมล (Email):", cell_lbl_style), Paragraph(cust_email[:32], cell_val_style),
            Paragraph("สถานที่คืนรถ (Return):", cell_lbl_style), Paragraph(loc_ret[:35], cell_val_style)
        ],
        [
            Paragraph("ที่อยู่ (Address):", cell_lbl_style), Paragraph(cust_addr[:45], cell_val_style),
            Paragraph("ระยะเวลาเช่า (Period):", cell_lbl_style), Paragraph(f"{s_date_str}<br/>ถึง {e_date_str}", cell_val_style)
        ],
        [
            Paragraph("<b>ค่าเช่าสุทธิ (Net Rental):</b>", cell_lbl_style),
            Paragraph(f"<b>THB {net_price:,.2f}</b>", cell_val_style),
            Paragraph("<b>เงินมัดจำ (Deposit):</b>", cell_lbl_style),
            Paragraph(f"<b>THB {deposit_amt:,.2f}</b> ({pay_method})", cell_val_style)
        ]
    ]

    details_table = Table(details_data, colWidths=[105, 155, 110, 153])
    details_table.setStyle(TableStyle([
        ('SPAN', (0,0), (1,0)),
        ('SPAN', (2,0), (3,0)),
        ('BACKGROUND', (0,0), (1,0), colors.HexColor('#F1F5F9')),
        ('BACKGROUND', (2,0), (3,0), colors.HexColor('#F1F5F9')),
        ('BACKGROUND', (0,7), (-1,7), colors.HexColor('#FFF7ED')),
        ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#E2E8F0')),
        ('TOPPADDING', (0,0), (-1,-1), 3),
        ('BOTTOMPADDING', (0,0), (-1,-1), 3),
        ('LEFTPADDING', (0,0), (-1,-1), 5),
        ('RIGHTPADDING', (0,0), (-1,-1), 5),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
    ]))
    elements.append(details_table)
    elements.append(Spacer(1, 8))

    # -------------------------------------------------------------
    # 3. TERMS & CONDITIONS (ข้อตกลงและเงื่อนไขการเช่ารถยนต์)
    # -------------------------------------------------------------
    terms_header = Paragraph("<b>ข้อตกลงและเงื่อนไขการเช่ารถยนต์ (TERMS AND CONDITIONS)</b>", terms_title_style)
    elements.append(terms_header)
    elements.append(Spacer(1, 4))

    terms_data = [
        [
            Paragraph("<b>1. คุณสมบัติและการใช้งานรถ (Driver Eligibility & Vehicle Use):</b>", terms_body_style),
            Paragraph(
                "ผู้เช่าต้องมีอายุไม่ต่ำกว่า 20 ปีบริบูรณ์และมีใบอนุญาตขับขี่ที่ยังไม่หมดอายุตามกฎหมายไทย ผู้เช่าต้องเป็นผู้ขับขี่แต่เพียงผู้เดียว เว้นแต่ได้ระบุชื่อผู้ขับขี่ร่วมไว้เป็นลายลักษณ์อักษร ห้ามนำรถยนต์ไปใช้ในทางที่ผิดกฎหมาย แข่งขันความเร็ว บรรทุกน้ำหนักเกิน หรือนำออกนอกราชอาณาจักรไทยโดยเด็ดขาด",
                terms_body_style
            )
        ],
        [
            Paragraph("<b>2. การดูแลรักษาและน้ำมันเชื้อเพลิง (Maintenance & Fuel Policy):</b>", terms_body_style),
            Paragraph(
                "ผู้เช่าต้องเติมน้ำมันเชื้อเพลิงตามประเภทที่ระบุไว้ประจำรถยนต์เท่านั้น และต้องส่งมอบรถคืนในระดับน้ำมันเท่ากับระดับตอนรับรถ หากน้ำมันขาด บริษัทขอคิดค่าน้ำมันตามจริงพร้อมค่าบริการเติมน้ำมันครั้งละ 200 บาท และห้ามสูบบุหรี่ หรือนำสิ่งของกลิ่นรุนแรงเข้ามาในห้องโดยสาร (ปรับ 2,000 บาท)",
                terms_body_style
            )
        ],
        [
            Paragraph("<b>3. ประกันภัยและความรับผิดชอบต่อความเสียหาย (Insurance & Liabilities):</b>", terms_body_style),
            Paragraph(
                "รถยนต์มีประกันภัยคุ้มครองตามเงื่อนไขที่กฎหมายกำหนด กรณีเกิดอุบัติเหตุหรือความเสียหายจากความประมาทของผู้เช่า หรือไม่สามารถระบุคู่กรณีได้ ผู้เช่าต้องรับผิดชอบค่าเสียหายส่วนแรก (Deductible/Excess) ตามเงื่อนไขของกรมธรรม์ประกันภัย และต้องแจ้งให้บริษัททราบทันทีที่เกิดเหตุ",
                terms_body_style
            )
        ],
        [
            Paragraph("<b>4. การส่งคืนรถและการต่อสัญญา (Vehicle Return & Extension):</b>", terms_body_style),
            Paragraph(
                "ผู้เช่าต้องส่งมอบรถคืนตามวัน เวลา และสถานที่ที่ระบุในสัญญา หากส่งคืนล่าช้าเกิน 1 ชั่วโมงโดยไม่แจ้งล่วงหน้า บริษัทขอสงวนสิทธิ์คิดค่าปรับรายชั่วโมงในอัตรา 200 บาท/ชม. (หากเกิน 3 ชม. คิดเป็นค่าเช่าเต็ม 1 วัน) การขอต่อสัญญาต้องแจ้งและชำระค่าเช่าล่วงหน้าอย่างน้อย 24 ชั่วโมงก่อนหมดสัญญา",
                terms_body_style
            )
        ],
        [
            Paragraph("<b>5. เงินมัดจำประกันสัญญาและการคืนเงิน (Security Deposit & Refund):</b>", terms_body_style),
            Paragraph(
                "บริษัทจะทำการคืนเงินมัดจำประกันสัญญาเต็มจำนวนให้แก่ผู้เช่าหลังจากตรวจสอบสภาพรถยนต์และอุปกรณ์ประจำรถครบถ้วนสมบูรณ์ โดยไม่มีความเสียหาย ค่าปรับจราจร หรือค่าใช้จ่ายค้างชำระใดๆ ทั้งนี้ หากมีค่าปรับจราจรในระหว่างระยะเวลาเช่า ผู้เช่ายินยอมรับผิดชอบชำระค่าปรับดังกล่าวตามจริง",
                terms_body_style
            )
        ]
    ]

    terms_table = Table(terms_data, colWidths=[155, 368])
    terms_table.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('TOPPADDING', (0,0), (-1,-1), 2),
        ('BOTTOMPADDING', (0,0), (-1,-1), 2),
        ('LEFTPADDING', (0,0), (-1,-1), 3),
        ('RIGHTPADDING', (0,0), (-1,-1), 3),
        ('LINEBELOW', (0,0), (-1,-2), 0.3, colors.HexColor('#F1F5F9')),
    ]))
    elements.append(terms_table)
    elements.append(Spacer(1, 10))

    # -------------------------------------------------------------
    # 4. SIGNATURE BLOCKS (ช่องลงนามสองฝ่าย)
    # -------------------------------------------------------------
    sig_content = [
        [
            Paragraph("ข้าพเจ้าได้อ่าน เข้าใจ และยอมรับข้อตกลงและเงื่อนไขการเช่ารถยนต์ข้างต้นทุกประการ", sig_lbl_style),
            Paragraph("ในนาม บริษัท สวัสดี เรนทัล จำกัด ได้ส่งมอบรถยนต์ในสภาพสมบูรณ์เรียบร้อยแล้ว", sig_lbl_style)
        ],
        [
            Paragraph("<br/><br/>ลงชื่อ ................................................................<br/>( <b>" + cust_name + "</b> )<br/>ผู้เช่า (Lessee / Customer)<br/>วันที่: " + created_date, sig_name_style),
            Paragraph("<br/><br/>ลงชื่อ ................................................................<br/>( <b>ผู้มีอำนาจลงนาม / พนักงานส่งมอบ</b> )<br/>ผู้ให้เช่า (Lessor / Sawasdee Rental)<br/>วันที่: " + created_date, sig_name_style)
        ]
    ]

    sig_table = Table(sig_content, colWidths=[261, 262])
    sig_table.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('ALIGN', (0,0), (-1,-1), 'CENTER'),
        ('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#F8FAFC')),
        ('BOX', (0,0), (-1,-1), 0.5, colors.HexColor('#CBD5E1')),
        ('LINEBEFORE', (1,0), (1,-1), 0.5, colors.HexColor('#E2E8F0')),
        ('TOPPADDING', (0,0), (-1,-1), 6),
        ('BOTTOMPADDING', (0,0), (-1,-1), 6),
        ('LEFTPADDING', (0,0), (-1,-1), 8),
        ('RIGHTPADDING', (0,0), (-1,-1), 8),
    ]))
    elements.append(sig_table)

    doc.build(elements)
    return pdf_buffer.getvalue()

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

