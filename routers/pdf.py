"""
PDF & HTML Document Streaming API Router for SawasdeeRental.
"""

import os
import io
import re
import html
from typing import Optional
from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse, StreamingResponse, FileResponse

import pdf_engine
from db import store, format_date_dmy
from dependencies import static_dir, verify_booking_portal_token
from services.google_drive_service import async_upload_pdf_to_drive
from services.booking_service import _resolve_cust_and_car, compute_remaining_rental

router = APIRouter(tags=["pdf"])


# Inspection PDF route with automatic on-demand generation fallback (prevents 404 on Render restarts)
@router.get("/static/pdf/inspections/{fname}")
def serve_static_inspection_pdf(fname: str):
    insp_dir = os.path.join(static_dir, "pdf", "inspections")
    file_path = os.path.join(insp_dir, fname)
    if os.path.exists(file_path):
        return FileResponse(file_path, media_type="application/pdf", filename=fname)
    m = re.match(r"^Inspection_(Checkout|Checkin|Checklist)_(MRC\w+)\.pdf$", fname, re.IGNORECASE)
    if m:
        kind = m.group(1).lower()
        bk_id = m.group(2)
        try:
            if kind == "checklist":
                return get_job_pdf(bk_id=bk_id)
            else:
                return get_inspection_pdf(bk_id=bk_id, type=kind, download=0)
        except Exception as e:
            print(f"[PDF Engine] On-demand fallback generation error for {fname}: {e}")
    raise HTTPException(status_code=404, detail="File Not Found")


@router.get("/api/pdf/contract/{bk_id}")
def get_contract_pdf(bk_id: str, download: int = 0):
    target = next((b for b in store.bookings if b.get("booking_id") == bk_id), None)
    if not target:
        target = next((cj for cj in store.completed_jobs if cj.get("booking_id") == bk_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="ไม่พบข้อมูลการจอง")

    cust, car = _resolve_cust_and_car(target)
    try:
        pdf_bytes = pdf_engine.generate_filled_pdf(pdf_engine.CONTRACT_TEMPLATE_V4, target, cust, car)
    except Exception as e:
        print(f"PDF Error: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"PDF Error: {str(e)}")

    if not target.get("contract_pdf_url"):
        target["contract_pdf_url"] = f"/api/pdf/contract/{bk_id}"
    if not target.get("contract_issued") and target.get("deposit_paid") and target.get("rental_paid"):
        target["contract_issued"] = True
    store.async_sync_booking(target)

    # Isolated Feature: Auto-upload Contract PDF to Google Drive in background thread
    try:
        from services.google_drive_service import FOLDER_CONTRACTS
        async_upload_pdf_to_drive(
            doc_type="สัญญาเช่า",
            ref_id=bk_id,
            pdf_bytes=pdf_bytes,
            folder_id=FOLDER_CONTRACTS,
            booking_dict=target,
            db_col="contract_pdf_url"
        )
    except Exception as gdrive_err:
        print(f"[Contract PDF] Auto-upload notice: {gdrive_err}")

    ext_count = len([x for x in (target.get("extension_history") or []) if isinstance(x, dict) and x.get("type") == "extension"])
    fname = f"Agreement_{bk_id}" + (f"_ext{ext_count}" if ext_count else "") + ".pdf"
    disp = "attachment" if download else "inline"
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f"{disp}; filename={fname}"}
    )


@router.get("/api/pdf/receipt/{bk_id}")
def get_receipt_pdf(bk_id: str):
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

    # Isolated Feature: Auto-upload Receipt PDF to Google Drive in background thread
    try:
        from services.google_drive_service import FOLDER_RECEIPTS
        async_upload_pdf_to_drive(
            doc_type="ใบเสร็จ",
            ref_id=bk_id,
            pdf_bytes=pdf_bytes,
            folder_id=FOLDER_RECEIPTS,
            booking_dict=target,
            db_col="receipt_pdf_url"
        )
    except Exception as gdrive_err:
        print(f"[Receipt PDF] Auto-upload notice: {gdrive_err}")

    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f"inline; filename=Receipt_{bk_id}.pdf"}
    )


@router.get("/api/pdf/deposit-receipt/{bk_id}")
def get_deposit_receipt_pdf(bk_id: str):
    target = next((b for b in store.bookings if b.get("booking_id") == bk_id), None)
    if not target:
        target = next((cj for cj in store.completed_jobs if cj.get("booking_id") == bk_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="ไม่พบข้อมูลการจอง")

    cust, car = _resolve_cust_and_car(target)
    amt = float(target.get("deposit_amount", 5000.0))
    method = target.get("deposit_method", "เงินสด")
    ref_no = target.get("deposit_ref")
    dep_desc = (
        "เงินประกันสัญญา (ขอคืนได้) / Security Deposit (Refundable)"
        if int(target.get("pricing_version") or 1) >= 2
        else "เงินมัดจำประกันสัญญา (Security Deposit)"
    )

    pdf_bytes = pdf_engine.generate_receipt_bytes(f"DEP{bk_id}", target, cust, car, amt, method, dep_desc, ref_no=ref_no)

    # Isolated Feature: Auto-upload Deposit Receipt PDF to Google Drive in background thread
    try:
        from services.google_drive_service import FOLDER_RECEIPTS
        async_upload_pdf_to_drive(
            doc_type="ใบเสร็จมัดจำ",
            ref_id=bk_id,
            pdf_bytes=pdf_bytes,
            folder_id=FOLDER_RECEIPTS,
            booking_dict=target,
            db_col="deposit_receipt_pdf_url"
        )
    except Exception as gdrive_err:
        print(f"[Deposit Receipt PDF] Auto-upload notice: {gdrive_err}")

    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f"inline; filename=Deposit_Receipt_{bk_id}.pdf"}
    )


@router.get("/api/pdf/inspection/{bk_id}")
def get_inspection_pdf(bk_id: str, type: str = "checkout", download: int = 0):
    target = next((b for b in store.bookings if b.get("booking_id") == bk_id), None)
    if not target:
        target = next((cj for cj in store.completed_jobs if cj.get("booking_id") == bk_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="ไม่พบข้อมูลการจอง")

    cust, car = _resolve_cust_and_car(target)
    is_checkout = str(type).lower().strip() in ("checkout", "dispatch", "out")
    clean_type = "checkout" if is_checkout else "checkin"

    insp_dir = os.path.join(static_dir, "pdf", "inspections")
    fname = f"Inspection_{clean_type.capitalize()}_{bk_id}.pdf"
    file_path = os.path.join(insp_dir, fname)

    pdf_bytes = pdf_engine.generate_inspection_checklist_pdf(
        template_path="car_inspection_updated.pdf",
        booking_info=target,
        customer_info=cust,
        car_info=car,
        inspection_type=clean_type,
        payload=target
    )
    try:
        os.makedirs(insp_dir, exist_ok=True)
        with open(file_path, "wb") as f:
            f.write(pdf_bytes)
    except Exception:
        pass

    pdf_url = f"/static/pdf/inspections/{fname}"
    if is_checkout and not target.get("checkout_pdf_url"):
        target["checkout_pdf_url"] = pdf_url
        store.async_sync_booking(target)
    elif not is_checkout and not target.get("checkin_pdf_url"):
        target["checkin_pdf_url"] = pdf_url
        store.async_sync_booking(target)

    # Isolated Feature: Auto-upload Inspection PDF to Google Drive in background thread
    try:
        from services.google_drive_service import FOLDER_INSPECTIONS
        insp_col = "checkout_pdf_url" if is_checkout else "checkin_pdf_url"
        insp_label = f"ใบตรวจสภาพรถ_{clean_type.capitalize()}"
        async_upload_pdf_to_drive(
            doc_type=insp_label,
            ref_id=bk_id,
            pdf_bytes=pdf_bytes,
            folder_id=FOLDER_INSPECTIONS,
            booking_dict=target,
            db_col=insp_col
        )
    except Exception as gdrive_err:
        print(f"[Inspection PDF] Auto-upload notice: {gdrive_err}")

    disp = "attachment" if download else "inline"
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f"{disp}; filename={fname}"}
    )


@router.get("/api/pdf/job/{bk_id}")
def get_job_pdf(bk_id: str, type: Optional[str] = None):
    target = next((b for b in store.bookings if b.get("booking_id") == bk_id), None)
    if not target:
        target = next((cj for cj in store.completed_jobs if cj.get("booking_id") == bk_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="ไม่พบข้อมูลการจอง")

    cust, car = _resolve_cust_and_car(target)
    job_type = str(type).lower() if type else ("Return" if target.get("return_closed") else "Dispatch")
    worker = target.get("worker_return") if job_type == "Return" else target.get("worker_delivery")
    loc = target.get("loc_return") if job_type == "Return" else target.get("loc_delivery")
    try:
        pdf_bytes = pdf_engine.generate_job_pdf(target, cust, car, job_type, worker, loc, inspection_data=target)
    except Exception as pdf_err:
        print(f"[API] Warning: generate_job_pdf failed: {pdf_err}, using emergency fallback generator")
        pdf_bytes = pdf_engine._generate_fallback_inspection_pdf(target, cust, car, is_checkout=(job_type != "return"), payload=target)
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f"inline; filename=Inspection_Checklist_{bk_id}.pdf"}
    )


@router.get("/api/html/inspection/{bk_id}", response_class=HTMLResponse)
def get_inspection_html(bk_id: str, type: Optional[str] = None):
    target = next((b for b in store.bookings if b.get("booking_id") == bk_id), None)
    if not target:
        target = next((cj for cj in store.completed_jobs if cj.get("booking_id") == bk_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="ไม่พบข้อมูลการจอง")

    cust, car = _resolve_cust_and_car(target)
    job_type = str(type).lower() if type else ("Return" if target.get("return_closed") else "Dispatch")
    worker = target.get("worker_return") if job_type == "Return" else target.get("worker_delivery")
    loc = target.get("loc_return") if job_type == "Return" else target.get("loc_delivery")
    html_content = pdf_engine.render_inspection_html(target, cust, car, job_type, worker, loc, inspection_data=target)
    return HTMLResponse(content=html_content)


@router.get("/portal/booking/{token}", response_class=HTMLResponse)
def get_customer_booking_portal(token: str):
    """Read-only Customer Portal secured with HMAC-SHA256 signed booking token."""
    bk_id = verify_booking_portal_token(token)
    if not bk_id:
        raise HTTPException(
            status_code=403,
            detail="ลิงก์สำหรับลูกค้าไม่ถูกต้องหรือถูกแก้ไข (Invalid Portal Token)"
        )

    target = next((b for b in store.bookings if b.get("booking_id") == bk_id), None)
    if not target:
        target = next((cj for cj in store.completed_jobs if cj.get("booking_id") == bk_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="ไม่พบข้อมูลการจอง")

    cust, car = _resolve_cust_and_car(target)
    esc = html.escape

    status_txt = str(target.get("status") or "-")
    car_id = str(target.get("car_id") or "-")
    car_brand = str(car.get("brand") or target.get("car_brand") or "")
    car_model = str(car.get("model") or target.get("car_model") or "")
    cust_name = str(target.get("customer") or cust.get("full_name") or "-")
    cust_phone = str(cust.get("contact_no") or cust.get("phone_number") or target.get("customer_phone") or "-")

    s_date = format_date_dmy(target.get("start_date")) or str(target.get("start_date") or "-")
    e_date = format_date_dmy(target.get("end_date")) or str(target.get("end_date") or "-")
    s_time = str(target.get("start_time") or "10:00")
    e_time = str(target.get("end_time") or "10:00")
    loc_del = str(target.get("loc_delivery") or "-")
    loc_ret = str(target.get("loc_return") or "-")

    net_price = float(target.get("net_price") or 0.0)
    del_fee = float(target.get("delivery_fee") or 0.0)
    pic_fee = float(target.get("pickup_fee") or 0.0)
    fees_total = del_fee + pic_fee
    dep_amount = float(target.get("deposit_amount") or 5000.0)
    dep_paid = bool(target.get("deposit_paid"))
    rent_paid = bool(target.get("rental_paid") or target.get("is_fully_paid"))
    rem_rental = compute_remaining_rental(target)
    fees_note_html = (
        f'<div style="font-size:12px; color:#475569; margin-top:3px;">🚚 รวมค่ารับ-ส่งนอกสถานที่ ฿{fees_total:,.2f}</div>'
        if fees_total > 0 else ""
    )

    dep_badge = (
        '<span class="pill pill-ok">✅ ชำระมัดจำแล้ว</span>'
        if dep_paid else
        '<span class="pill pill-warn">⏳ รอชำระมัดจำ</span>'
    )
    rent_badge = (
        '<span class="pill pill-ok">✅ ชำระค่าเช่าครบแล้ว</span>'
        if rent_paid else
        f'<span class="pill pill-due">💳 คงเหลือ ฿{rem_rental:,.2f}</span>'
    )

    angles = [
        ("ด้านหน้า (Front)", target.get("checkin_img_front") or car.get("img_front")),
        ("ด้านซ้าย (Left)", target.get("checkin_img_left") or car.get("img_left")),
        ("ด้านหลัง (Rear)", target.get("checkin_img_rear") or car.get("img_rear")),
        ("ด้านขวา (Right)", target.get("checkin_img_right") or car.get("img_right")),
    ]
    photo_cards = ""
    for lbl, url in angles:
        u = str(url or "").strip()
        if u and u not in ("-", "None", "null"):
            photo_cards += (
                f'<div class="photo-card">'
                f'<a href="{esc(u)}" target="_blank">'
                f'<img src="{esc(u)}" alt="{esc(lbl)}">'
                f'</a>'
                f'<div class="photo-lbl">{esc(lbl)}</div>'
                f'</div>'
            )

    photos_section = ""
    if photo_cards:
        photos_section = (
            '<div class="card">'
            '<div class="card-h">📸 รูปถ่ายสภาพรถ 4 มุม (4-Angle Vehicle Inspection)</div>'
            f'<div class="photo-grid">{photo_cards}</div>'
            '</div>'
        )

    contract_url = f"/api/pdf/contract/{esc(bk_id)}"
    dep_receipt_url = f"/api/pdf/deposit-receipt/{esc(bk_id)}"
    receipt_url = f"/api/pdf/receipt/{esc(bk_id)}"
    checkout_url = f"/api/pdf/inspection/{esc(bk_id)}?type=checkout"
    checkin_url = f"/api/pdf/inspection/{esc(bk_id)}?type=checkin"

    portal_html = f"""<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Customer Booking Portal — {esc(bk_id)} | Sawasdee Rental</title>
  <style>
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0; padding: 16px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #F8FAFC; color: #1E293B; line-height: 1.5;
    }}
    .wrap {{ max-width: 760px; margin: 0 auto; }}
    .hero {{
      background: linear-gradient(135deg, #1E3A8A, #2563EB);
      color: #FFF; border-radius: 14px; padding: 20px; margin-bottom: 14px;
      box-shadow: 0 8px 20px rgba(30, 58, 138, 0.18);
    }}
    .hero-top {{ display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; }}
    .brand {{ font-size: 13px; opacity: 0.9; font-weight: 600; }}
    .bk-title {{ font-size: 22px; font-weight: 800; margin-top: 4px; }}
    .status-badge {{
      background: rgba(255,255,255,0.2); border: 1px solid rgba(255,255,255,0.35);
      padding: 4px 12px; border-radius: 999px; font-size: 12.5px; font-weight: 700;
    }}
    .card {{
      background: #FFF; border: 1px solid #E2E8F0; border-radius: 12px;
      padding: 16px; margin-bottom: 14px; box-shadow: 0 2px 6px rgba(15, 23, 42, 0.04);
    }}
    .card-h {{ font-size: 15px; font-weight: 800; color: #1E3A8A; margin-bottom: 10px; }}
    .kv-grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; font-size: 13.5px; }}
    .kv-box {{ background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 10px 12px; }}
    .kv-lbl {{ font-size: 11.5px; color: #64748B; font-weight: 600; }}
    .kv-val {{ font-size: 14px; font-weight: 700; color: #0F172A; margin-top: 2px; }}
    .pill {{ display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; }}
    .pill-ok {{ background: #DCFCE7; color: #166534; }}
    .pill-warn {{ background: #FEF3C7; color: #92400E; }}
    .pill-due {{ background: #FFEDD5; color: #9A3412; }}
    .doc-list {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 10px; }}
    .doc-btn {{
      display: flex; align-items: center; gap: 8px; text-decoration: none;
      background: #EFF6FF; border: 1.5px solid #BFDBFE; color: #1D4ED8;
      padding: 11px 14px; border-radius: 10px; font-weight: 700; font-size: 13px;
    }}
    .doc-btn:hover {{ background: #DBEAFE; }}
    .photo-grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }}
    .photo-card {{ border: 1px solid #E2E8F0; border-radius: 8px; overflow: hidden; background: #F8FAFC; }}
    .photo-card img {{ width: 100%; height: 120px; object-fit: cover; display: block; }}
    .photo-lbl {{ font-size: 11.5px; text-align: center; padding: 5px; font-weight: 700; color: #475569; }}
    .foot {{ text-align: center; font-size: 11.5px; color: #64748B; margin-top: 16px; }}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="hero">
      <div class="hero-top">
        <div>
          <div class="brand">SAWASDEE RENT A CAR • CUSTOMER PORTAL (READ-ONLY)</div>
          <div class="bk-title">รายการจอง #{esc(bk_id)}</div>
        </div>
        <div class="status-badge">{esc(status_txt)}</div>
      </div>
    </div>

    <div class="card">
      <div class="card-h">🚘 ข้อมูลการเช่ารถ (Booking Summary)</div>
      <div class="kv-grid">
        <div class="kv-box">
          <div class="kv-lbl">ผู้เช่า (Customer)</div>
          <div class="kv-val">{esc(cust_name)}</div>
          <div style="font-size:12px; color:#475569;">📞 {esc(cust_phone)}</div>
        </div>
        <div class="kv-box">
          <div class="kv-lbl">รถยนต์ (Vehicle)</div>
          <div class="kv-val">{esc(car_id)}</div>
          <div style="font-size:12px; color:#475569;">{esc((car_brand + ' ' + car_model).strip() or '-')}</div>
        </div>
        <div class="kv-box">
          <div class="kv-lbl">วันรับรถ (Pick-up)</div>
          <div class="kv-val">{esc(s_date)} ({esc(s_time)})</div>
          <div style="font-size:12px; color:#475569;">📍 {esc(loc_del)}</div>
        </div>
        <div class="kv-box">
          <div class="kv-lbl">วันคืนรถ (Return)</div>
          <div class="kv-val">{esc(e_date)} ({esc(e_time)})</div>
          <div style="font-size:12px; color:#475569;">📍 {esc(loc_ret)}</div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-h">💳 สรุปค่าเช่าและเงินมัดจำ (Payment &amp; Deposit)</div>
      <div class="kv-grid">
        <div class="kv-box">
          <div class="kv-lbl">ยอดค่าเช่าสุทธิ (Net Rental)</div>
          <div class="kv-val" style="color:#1E3A8A;">฿{net_price:,.2f}</div>
          {fees_note_html}
          <div style="margin-top:6px;">{rent_badge}</div>
        </div>
        <div class="kv-box">
          <div class="kv-lbl">เงินมัดจำประกันสัญญา (Security Deposit)</div>
          <div class="kv-val" style="color:#0F766E;">฿{dep_amount:,.2f}</div>
          <div style="margin-top:6px;">{dep_badge}</div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-h">📥 ดาวน์โหลดเอกสารการเช่ารถ (PDF Documents)</div>
      <div class="doc-list">
        <a class="doc-btn" href="{contract_url}" target="_blank">📝 สัญญาเช่ารถยนต์ (Contract PDF)</a>
        <a class="doc-btn" href="{dep_receipt_url}" target="_blank">🛡️ ใบเสร็จเงินมัดจำ (Deposit Receipt)</a>
        <a class="doc-btn" href="{receipt_url}" target="_blank">🧾 ใบเสร็จค่าเช่า (Rental Receipt)</a>
        <a class="doc-btn" href="{checkout_url}" target="_blank">📋 ใบตรวจสภาพขาออก (Checkout PDF)</a>
        <a class="doc-btn" href="{checkin_url}" target="_blank">🏁 ใบตรวจสภาพขาเข้า (Checkin PDF)</a>
      </div>
    </div>

    {photos_section}

    <div class="foot">
      หน้านี้เป็นข้อมูลสำหรับลูกค้าเพื่อดูรายละเอียดและดาวน์โหลดเอกสารเท่านั้น (Read-Only Signed Link)
    </div>
  </div>
</body>
</html>"""
    return HTMLResponse(content=portal_html)
