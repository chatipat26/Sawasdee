"""
PDF & HTML Document Streaming API Router for SawasdeeRental.
"""

import os
import io
import re
from typing import Optional
from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse, StreamingResponse, FileResponse

import pdf_engine
from db import store
from dependencies import static_dir
from services.google_drive_service import async_upload_pdf_to_drive
from services.booking_service import _resolve_cust_and_car

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
        pdf_bytes = pdf_engine.generate_filled_pdf("rental_template_blank_v2.pdf", target, cust, car)
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

    pdf_bytes = pdf_engine.generate_receipt_bytes(f"DEP{bk_id}", target, cust, car, amt, method, "เงินมัดจำประกันสัญญา (Security Deposit)", ref_no=ref_no)

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
