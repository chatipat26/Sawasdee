"""
Bookings, Payments, Dispatch, Back-Office Jobs, and Check-in/out Inspections API Router for SawasdeeRental.
"""

import os
import re
from datetime import datetime, date
from typing import Optional, Dict, Any
from fastapi import APIRouter, HTTPException

import pdf_engine
from db import (
    store,
    get_db_client,
    format_date_dmy,
    to_date,
    calculate_rental_duration_and_days,
)
from dependencies import (
    static_dir,
    INACTIVE_BOOKING_STATUSES,
    now_th,
    convert_gdrive_url,
    get_car_key,
)
from services.google_drive_service import async_upload_pdf_to_drive
from services.booking_service import (
    find_booking_overlap,
    raise_overlap_error,
    release_car_after_booking,
    require_contract_before_rent,
    record_booking_completion_income,
    _update_car_mileage_on_return,
    _resolve_cust_and_car,
)

router = APIRouter(tags=["bookings"])


@router.get("/api/bookings")
def list_bookings():
    if not store.initial_sync_done:
        store.sync_from_database(force=True)
    with store.lock:
        bookings_snap = [dict(b) for b in store.bookings]
        cars_snap = {k: dict(v) for k, v in store.cars.items()}
        customers_snap = {k: dict(v) for k, v in store.customers.items()}
    res = []
    for b_copy in bookings_snap:
        b_copy["start_date_formatted"] = format_date_dmy(b_copy.get("start_date"))
        b_copy["end_date_formatted"] = format_date_dmy(b_copy.get("end_date"))
        c_obj = cars_snap.get(b_copy.get("car_id"), {})
        b_copy["car_brand"] = c_obj.get("brand", "")
        b_copy["car_model"] = c_obj.get("model", "")
        b_copy["car_image"] = c_obj.get("image", "")
        cust_obj = customers_snap.get(b_copy.get("customer"), {})
        b_copy["customer_phone"] = cust_obj.get("contact_no", "-")
        # Robust data mapping for complex fields (JSON list, Boolean, PDF url)
        ext_val = b_copy.get("extension_history")
        if isinstance(ext_val, str):
            try:
                import json
                parsed_ext = json.loads(ext_val)
                b_copy["extension_history"] = parsed_ext if isinstance(parsed_ext, list) else [parsed_ext]
            except Exception:
                b_copy["extension_history"] = []
        elif not isinstance(ext_val, list):
            b_copy["extension_history"] = []
        b_copy["is_fully_paid"] = bool(b_copy.get("is_fully_paid", False) or b_copy.get("rental_paid", False))
        b_copy["contract_pdf_url"] = b_copy.get("contract_pdf_url") or ""
        b_copy["checkout_pdf_url"] = b_copy.get("checkout_pdf_url") or ""
        b_copy["checkin_pdf_url"] = b_copy.get("checkin_pdf_url") or ""

        # Harmonize slips between columns and payment_meta
        for item in (b_copy.get("extension_history") or []):
            if isinstance(item, dict) and item.get("type") == "payment_meta":
                if item.get("deposit_slip") and not b_copy.get("deposit_slip"):
                    b_copy["deposit_slip"] = item["deposit_slip"]
                if item.get("rental_slip") and not b_copy.get("rental_slip"):
                    b_copy["rental_slip"] = item["rental_slip"]
                if item.get("remaining_slip_link") and not b_copy.get("remaining_slip_link"):
                    b_copy["remaining_slip_link"] = item["remaining_slip_link"]
                if item.get("payment_slip_url") and not b_copy.get("payment_slip_url"):
                    b_copy["payment_slip_url"] = item["payment_slip_url"]
        if b_copy.get("payment_slip_url") and not b_copy.get("deposit_slip"):
            b_copy["deposit_slip"] = b_copy["payment_slip_url"]
        if b_copy.get("deposit_slip") and not b_copy.get("payment_slip_url"):
            b_copy["payment_slip_url"] = b_copy["deposit_slip"]
        if b_copy.get("remaining_slip_link") and not b_copy.get("rental_slip"):
            b_copy["rental_slip"] = b_copy["remaining_slip_link"]
        if b_copy.get("rental_slip") and not b_copy.get("remaining_slip_link"):
            b_copy["remaining_slip_link"] = b_copy["rental_slip"]

        # TARGET MISSION 3: Safe balance calculation (net_price - deposit_amount)
        if b_copy.get("rental_paid"):
            b_copy["remaining_rental"] = 0.0
        elif b_copy.get("deposit_paid"):
            np_val = float(b_copy.get("net_price") or 0.0)
            dep_val = float(b_copy.get("deposit_amount") or 5000.0)
            cur_rem = float(b_copy.get("remaining_rental") or 0.0)
            if (cur_rem >= np_val and np_val > 0) or b_copy.get("remaining_rental") is None:
                b_copy["remaining_rental"] = max(0.0, np_val - dep_val)
        res.append(b_copy)
    return res


@router.get("/api/bookings/{bk_id}")
def get_booking(bk_id: str):
    target = next((b for b in store.bookings if b.get("booking_id") == bk_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="ไม่พบรายการจอง")
    b_copy = dict(target)
    b_copy["start_date_formatted"] = format_date_dmy(target.get("start_date"))
    b_copy["end_date_formatted"] = format_date_dmy(target.get("end_date"))
    c_obj = store.cars.get(target.get("car_id"), {})
    b_copy["car_brand"] = c_obj.get("brand", "")
    b_copy["car_model"] = c_obj.get("model", "")
    b_copy["car_image"] = c_obj.get("image", "")
    cust_obj = store.customers.get(target.get("customer"), {})
    b_copy["customer_phone"] = cust_obj.get("contact_no", "-")
    ext_val = b_copy.get("extension_history")
    if isinstance(ext_val, str):
        try:
            import json
            parsed_ext = json.loads(ext_val)
            b_copy["extension_history"] = parsed_ext if isinstance(parsed_ext, list) else [parsed_ext]
        except Exception:
            b_copy["extension_history"] = []
    elif not isinstance(ext_val, list):
        b_copy["extension_history"] = []
    b_copy["is_fully_paid"] = bool(b_copy.get("is_fully_paid", False) or b_copy.get("rental_paid", False))
    b_copy["contract_pdf_url"] = b_copy.get("contract_pdf_url") or ""

    # Harmonize slips between columns and payment_meta
    for item in (b_copy.get("extension_history") or []):
        if isinstance(item, dict) and item.get("type") == "payment_meta":
            if item.get("deposit_slip") and not b_copy.get("deposit_slip"):
                b_copy["deposit_slip"] = item["deposit_slip"]
            if item.get("rental_slip") and not b_copy.get("rental_slip"):
                b_copy["rental_slip"] = item["rental_slip"]
            if item.get("remaining_slip_link") and not b_copy.get("remaining_slip_link"):
                b_copy["remaining_slip_link"] = item["remaining_slip_link"]
            if item.get("payment_slip_url") and not b_copy.get("payment_slip_url"):
                b_copy["payment_slip_url"] = item["payment_slip_url"]
    if b_copy.get("payment_slip_url") and not b_copy.get("deposit_slip"):
        b_copy["deposit_slip"] = b_copy["payment_slip_url"]
    if b_copy.get("deposit_slip") and not b_copy.get("payment_slip_url"):
        b_copy["payment_slip_url"] = b_copy["deposit_slip"]
    if b_copy.get("remaining_slip_link") and not b_copy.get("rental_slip"):
        b_copy["rental_slip"] = b_copy["remaining_slip_link"]
    if b_copy.get("rental_slip") and not b_copy.get("remaining_slip_link"):
        b_copy["remaining_slip_link"] = b_copy["rental_slip"]

    # TARGET MISSION 3: Safe balance calculation (net_price - deposit_amount)
    if b_copy.get("rental_paid"):
        b_copy["remaining_rental"] = 0.0
    elif b_copy.get("deposit_paid"):
        np_val = float(b_copy.get("net_price") or 0.0)
        dep_val = float(b_copy.get("deposit_amount") or 5000.0)
        cur_rem = float(b_copy.get("remaining_rental") or 0.0)
        if (cur_rem >= np_val and np_val > 0) or b_copy.get("remaining_rental") is None:
            b_copy["remaining_rental"] = max(0.0, np_val - dep_val)
    return b_copy


@router.post("/api/bookings")
def create_booking(payload: Dict[str, Any]):
    try:
        # Generate booking ID in Thailand Time: MRC<YYMMDD><HHMMSS>
        now = now_th()
        bk_id = payload.get("booking_id") or f"MRC{now.strftime('%y%m%d%H%M%S')}"

        start_d = to_date(payload.get("start_date"))
        end_d = to_date(payload.get("end_date"))

        if not start_d or not end_d:
            raise HTTPException(
                status_code=400,
                detail="กรุณาระบุวันที่เริ่มต้นและสิ้นสุดสัญญาให้ถูกต้อง"
            )

        # Block backdated contracts (start_date must be >= today in Thailand timezone)
        th_today = now.date()
        if start_d < th_today:
            raise HTTPException(
                status_code=400,
                detail=f"ไม่อนุญาตให้ทำสัญญาหรือจองรถย้อนหลัง: วันที่เริ่มต้น ({start_d.strftime('%d/%m/%Y')}) ต้องไม่น้อยกว่าวันที่ปัจจุบัน ({th_today.strftime('%d/%m/%Y')})"
            )
        if end_d < start_d:
            raise HTTPException(
                status_code=400,
                detail=f"วันที่สิ้นสุดสัญญา ({end_d.strftime('%d/%m/%Y')}) ต้องไม่น้อยกว่าวันที่เริ่มต้น ({start_d.strftime('%d/%m/%Y')})"
            )

        # Prevent double booking: block immediately when dates overlap an existing active queue
        _conflict = find_booking_overlap(payload.get("car_id"), start_d, end_d)
        if _conflict:
            raise_overlap_error(_conflict, "จองรถ")

        default_t = now.strftime("%H:%M")
        start_t = payload.get("start_time") or default_t
        end_t = payload.get("end_time") or default_t

        billable_days, extra_hours, rem_minutes, is_over_4hr, explanation = calculate_rental_duration_and_days(
            start_d, start_t, end_d, end_t
        )

        car_id = payload.get("car_id")
        car_obj = store.cars.get(car_id, {})
        price_day = float(car_obj.get("price_day") or car_obj.get("daily_rate") or 1000)
        price_week = float(car_obj.get("price_week") or (price_day * 6))
        price_month = float(car_obj.get("price_month") or (price_day * 20))
        contract_type = payload.get("contract_type", "รายวัน")

        base_price = payload.get("base_price")
        if base_price is None:
            if contract_type == "รายสัปดาห์":
                if billable_days <= 7:
                    base_price = price_week
                else:
                    weeks = billable_days // 7
                    rem_days = billable_days % 7
                    base_price = (weeks * price_week) + (rem_days * price_day)
            elif contract_type == "รายเดือน":
                if billable_days <= 30:
                    base_price = price_month
                else:
                    months = billable_days // 30
                    rem_days = billable_days % 30
                    base_price = (months * price_month) + (rem_days * price_day)
            else:
                base_price = price_day * billable_days

        discount = float(payload.get("discount", 0))
        net_price = max(0.0, float(base_price) - discount)
        deposit_amount = 5000.0  # STRICT RULE: Fixed 5,000 THB deposit
        deposit_paid = bool(payload.get("deposit_paid", False))
        rental_paid = bool(payload.get("rental_paid", False))

        dep_slip_url = convert_gdrive_url(payload.get("deposit_slip", "") or payload.get("slip_url", "") or payload.get("payment_slip_url", ""))
        rent_slip_url = convert_gdrive_url(payload.get("rental_slip", "") or payload.get("remaining_slip_link", ""))

        booking = {
            "booking_id": bk_id,
            "car_id": car_id,
            "customer": payload.get("customer", "ลูกค้าทั่วไป (Walk-in)"),
            "start_date": start_d,
            "end_date": end_d,
            "start_time": start_t,
            "end_time": end_t,
            "contract_type": contract_type,
            "base_price": base_price,
            "discount": discount,
            "net_price": net_price,
            "deposit_amount": deposit_amount,
            "deposit_paid": deposit_paid,
            "deposit_ref": payload.get("deposit_ref", "") or payload.get("payment_ref", ""),
            "deposit_slip": dep_slip_url,
            "payment_slip_url": dep_slip_url,
            "rental_paid": rental_paid,
            "remaining_rental": 0.0 if rental_paid else (max(0.0, net_price - deposit_amount) if deposit_paid else net_price),
            "rental_ref": payload.get("rental_ref", ""),
            "rental_slip": rent_slip_url,
            "remaining_slip_link": rent_slip_url,
            "created_by": payload.get("created_by", "admin"),
            "status": "รอส่งมอบ" if deposit_paid else "รอชำระมัดจำ",
            "dispatch_closed": False,
            "return_closed": False,
            "worker_delivery": payload.get("worker_delivery", ""),
            "worker_return": payload.get("worker_return", ""),
            "loc_delivery": payload.get("loc_delivery", "Sukhumvit"),
            "loc_return": payload.get("loc_return", payload.get("loc_delivery", "Sukhumvit")),
            "extension_history": [],
            "is_fully_paid": rental_paid,
            "rental_payment_method": payload.get("rental_payment_method", "เงินสด"),
            "created_at": now.isoformat()
        }

        with store.lock:
            store.bookings.insert(0, booking)
            c_key = get_car_key(car_id)
            if c_key and c_key in store.cars:
                norm_ck = re.sub(r"[\s\-_]", "", str(c_key)).strip().lower()
                has_active_on_rent = any(
                    re.sub(r"[\s\-_]", "", str(b.get("car_id", ""))).strip().lower() == norm_ck
                    and b.get("status") in ("กำลังเช่า", "รอรับคืน")
                    for b in store.bookings
                )
                if not has_active_on_rent and store.cars[c_key].get("status") != "ซ่อมบำรุง":
                    store.cars[c_key]["status"] = "ติดจอง"
                    store.async_sync_car(c_key, store.cars[c_key])

        store.async_sync_booking(booking)
        return {"success": True, "booking_id": bk_id, "booking": booking}
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Error in create_booking: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"เกิดข้อผิดพลาดในการสร้างรายการจอง: {str(e)}"
        )


@router.put("/api/bookings/{bk_id}")
def update_booking(bk_id: str, payload: Dict[str, Any]):
    target = next((b for b in store.bookings if b.get("booking_id") == bk_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="ไม่พบรายการจอง")

    th_today = now_th().date()
    if "start_date" in payload:
        new_sd = to_date(payload["start_date"])
        if new_sd and new_sd < th_today:
            raise HTTPException(
                status_code=400,
                detail=f"ไม่อนุญาตให้แก้ไขวันที่สัญญาย้อนหลัง: วันที่เริ่มต้น ({new_sd.strftime('%d/%m/%Y')}) ต้องไม่น้อยกว่าวันที่ปัจจุบัน ({th_today.strftime('%d/%m/%Y')})"
            )

    # ---- Validate everything BEFORE mutating the booking ----
    new_status = payload.get("status")
    prev_status = target.get("status")
    chk_s = to_date(payload["start_date"]) if "start_date" in payload else to_date(target.get("start_date"))
    chk_e = to_date(payload["end_date"]) if "end_date" in payload else to_date(target.get("end_date"))
    if chk_s and chk_e and chk_e < chk_s:
        raise HTTPException(status_code=400, detail="วันที่สิ้นสุดสัญญาต้องไม่น้อยกว่าวันที่เริ่มต้น")
    if ("start_date" in payload or "end_date" in payload) and prev_status not in INACTIVE_BOOKING_STATUSES:
        _conflict = find_booking_overlap(target.get("car_id"), chk_s, chk_e, exclude_booking_id=bk_id)
        if _conflict:
            raise_overlap_error(_conflict, "บันทึกวันที่")
    if payload.get("contract_issued"):
        if not target.get("deposit_paid"):
            raise HTTPException(status_code=400, detail="⚠️ ไม่สามารถออกสัญญาได้: ยังไม่ได้ชำระเงินมัดจำ")
        if not target.get("rental_paid"):
            raise HTTPException(status_code=400, detail="⚠️ ไม่สามารถออกสัญญาได้: ยังไม่ได้ชำระค่าเช่า (ชำระด้วยเงินสด / QR / บัตรเครดิต / PayPal ก่อนออกสัญญา)")
        target["contract_issued"] = True
    if new_status == "กำลังเช่า" and prev_status != "กำลังเช่า":
        require_contract_before_rent(target)
    if new_status == "เสร็จสิ้น" and prev_status not in ("กำลังเช่า", "เตรียมรับคืน", "เสร็จสิ้น"):
        raise HTTPException(status_code=400, detail="⚠️ ไม่สามารถรับคืนรถได้: รถยังไม่ได้ส่งมอบ (สถานะต้องเป็น \"กำลังเช่า\" ก่อน)")

    for k, v in payload.items():
        if k in ["start_date", "end_date"]:
            target[k] = to_date(v)
        else:
            target[k] = v

    # When status is updated to "กำลังเช่า", update car status and dispatch_closed
    if target.get("status") == "กำลังเช่า":
        target["dispatch_closed"] = True
        car_id = target.get("car_id")
        if car_id in store.cars:
            store.cars[car_id]["status"] = "กำลังเช่า"
            store.async_sync_car(car_id, store.cars[car_id])
    elif target.get("status") == "เสร็จสิ้น":
        target["dispatch_closed"] = True
        target["return_closed"] = True
        release_car_after_booking(target.get("car_id"), bk_id)
        record_booking_completion_income(target)

    store.async_sync_booking(target)

    # Log to universal work_order_logs only if transitioning to "กำลังเช่า"
    if new_status == "กำลังเช่า" and prev_status != "กำลังเช่า":
        try:
            cid = target.get("car_id", "")
            d_mileage = payload.get("dispatch_mileage") or target.get("dispatch_mileage", "-")
            d_fuel = payload.get("dispatch_fuel") or target.get("dispatch_fuel", "-")
            d_notes = payload.get("dispatch_notes") or target.get("dispatch_notes", "")
            store.log_work_order(
                car_id=cid,
                booking_id=bk_id,
                work_type="Dispatch",
                description=f"ส่งมอบรถยนต์เรียบร้อย เลขไมล์: {d_mileage}, น้ำมัน: {d_fuel}, หมายเหตุ: {d_notes}",
                cost=0.0,
                staff_id=target.get("worker_delivery", "admin")
            )
        except Exception as e:
            print(f"Error logging dispatch work order: {e}")

    return {"success": True, "booking": target}


@router.patch("/api/bookings/{bk_id}/contract-pdf")
@router.put("/api/bookings/{bk_id}/contract-pdf")
def update_booking_contract_pdf(bk_id: str, payload: Dict[str, Any]):
    """Decoupled update for contract_pdf_url without altering core booking logic."""
    target = next((b for b in store.bookings if b.get("booking_id") == bk_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="ไม่พบรายการจอง")
    pdf_url = payload.get("contract_pdf_url") or payload.get("pdf_url") or f"/api/pdf/contract/{bk_id}"
    target["contract_pdf_url"] = str(pdf_url)
    store.async_sync_booking(target)
    return {"success": True, "booking_id": bk_id, "contract_pdf_url": target["contract_pdf_url"]}


@router.post("/api/bookings/{bk_id}/generate-inspection-pdf")
def generate_booking_inspection_pdf(bk_id: str, payload: Optional[Dict[str, Any]] = None):
    """
    Generate official vehicle inspection checklist PDF from booking data.
    Accepts inspection data (Checkout/Checkin), marked car diagram (Base64), signatures, notes.
    Stores generated PDF file to static storage and saves the URL in checkout_pdf_url / checkin_pdf_url.
    """
    payload = payload or {}
    target = next((b for b in store.bookings if b.get("booking_id") == bk_id), None)
    if not target:
        target = next((cj for cj in store.completed_jobs if cj.get("booking_id") == bk_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="ไม่พบข้อมูลการจอง")

    cust, car = _resolve_cust_and_car(target)
    insp_type = str(payload.get("inspection_type") or ("checkout" if not target.get("return_closed") else "checkin")).lower().strip()
    is_checkout = insp_type in ("checkout", "dispatch", "out")
    clean_type = "checkout" if is_checkout else "checkin"

    merged_payload = dict(payload)
    # 1. Odometer
    odo_val = (
        merged_payload.get("odometer") or
        merged_payload.get("odometer_out" if is_checkout else "odometer_in") or
        merged_payload.get("mileage") or
        target.get("odometer_out" if is_checkout else "odometer_in") or
        target.get("dispatch_mileage" if is_checkout else "return_mileage") or
        car.get("mileage")
    )
    if odo_val is not None:
        merged_payload["odometer"] = str(odo_val).strip()
        merged_payload["odometer_out" if is_checkout else "odometer_in"] = str(odo_val).strip()
        target["odometer_out" if is_checkout else "odometer_in"] = str(odo_val).strip()
        target["dispatch_mileage" if is_checkout else "return_mileage"] = str(odo_val).strip()
        # Auto-update car mileage on check-in with validation
        if not is_checkout and str(odo_val).strip() not in ("", "-"):
            disp_km = target.get("odometer_out") or target.get("dispatch_mileage")
            c_target_id = target.get("car_id") or (car.get("plate") if car else None)
            _update_car_mileage_on_return(c_target_id, odo_val, disp_km)

    # 2. Fuel Level
    fuel_val = (
        merged_payload.get("fuel_level") or
        merged_payload.get("fuel_out" if is_checkout else "fuel_in") or
        target.get("fuel_out" if is_checkout else "fuel_in") or
        target.get("dispatch_fuel" if is_checkout else "return_fuel") or
        "เต็มถัง (Full - 8/8) [100%]"
    )
    if fuel_val is not None:
        merged_payload["fuel_level"] = str(fuel_val).strip()
        merged_payload["fuel_out" if is_checkout else "fuel_in"] = str(fuel_val).strip()
        target["fuel_out" if is_checkout else "fuel_in"] = str(fuel_val).strip()
        target["dispatch_fuel" if is_checkout else "return_fuel"] = str(fuel_val).strip()

    # 3. Notes / Remarks / Damage
    notes_val = (
        merged_payload.get("remarks") or
        merged_payload.get("notes") or
        merged_payload.get("inspection_notes") or
        merged_payload.get("damage_notes") or
        merged_payload.get("damage_desc") or
        merged_payload.get("inspection_notes_out" if is_checkout else "inspection_notes_in") or
        target.get("inspection_notes_out" if is_checkout else "inspection_notes_in") or
        target.get("dispatch_notes" if is_checkout else "return_notes") or
        target.get("remarks")
    )
    if notes_val is not None:
        notes_str = str(notes_val).strip()
        merged_payload["notes"] = notes_str
        merged_payload["remarks"] = notes_str
        merged_payload["inspection_notes"] = notes_str
        merged_payload["inspection_notes_out" if is_checkout else "inspection_notes_in"] = notes_str
        target["inspection_notes_out" if is_checkout else "inspection_notes_in"] = notes_str
        target["dispatch_notes" if is_checkout else "return_notes"] = notes_str
        target["remarks"] = notes_str

    # 4. Checkbox categories
    cats_val = (
        merged_payload.get("inspection_categories") or
        merged_payload.get("inspection_categories_out" if is_checkout else "inspection_categories_in") or
        target.get("inspection_categories_out" if is_checkout else "inspection_categories_in") or
        target.get("inspection_categories")
    )
    if cats_val is not None:
        merged_payload["inspection_categories"] = cats_val
        merged_payload["inspection_categories_out" if is_checkout else "inspection_categories_in"] = cats_val
        target["inspection_categories_out" if is_checkout else "inspection_categories_in"] = cats_val
        target["inspection_categories"] = cats_val

    for img_col in ("checkin_img_front", "checkin_img_left", "checkin_img_rear", "checkin_img_right"):
        if img_col in merged_payload and merged_payload.get(img_col) is not None:
            target[img_col] = str(merged_payload.get(img_col)).strip() or None

    # 5. Diagram & Damage Marks
    diag_val = (
        merged_payload.get("car_diagram") or
        merged_payload.get("car_diagram_out" if is_checkout else "car_diagram_in") or
        merged_payload.get("diagram_base64")
    )
    if diag_val:
        merged_payload["car_diagram_out" if is_checkout else "car_diagram_in"] = diag_val
        target["car_diagram_out" if is_checkout else "car_diagram_in"] = diag_val
        if is_checkout:
            target["car_diagram"] = diag_val

    marks_val = (
        merged_payload.get("damage_marks") or
        merged_payload.get("damage_marks_out" if is_checkout else "damage_marks_in")
    )
    if marks_val:
        merged_payload["damage_marks_out" if is_checkout else "damage_marks_in"] = marks_val
        target["damage_marks_out" if is_checkout else "damage_marks_in"] = marks_val
        if is_checkout:
            target["damage_marks"] = marks_val

    if not merged_payload.get("staff_name") and not merged_payload.get("inspector_name"):
        merged_payload["staff_name"] = target.get("worker_delivery" if is_checkout else "worker_return") or "Staff"

    try:
        pdf_bytes = pdf_engine.generate_inspection_checklist_pdf(
            template_path="car_inspection_updated.pdf",
            booking_info=target,
            customer_info=cust,
            car_info=car,
            inspection_type=clean_type,
            payload=merged_payload
        )
    except Exception as e:
        print(f"[PDF Engine] Error generating inspection checklist PDF: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"PDF Generation Error: {str(e)}")

    insp_dir = os.path.join(static_dir, "pdf", "inspections")
    os.makedirs(insp_dir, exist_ok=True)
    fname = f"Inspection_{clean_type.capitalize()}_{bk_id}.pdf"
    file_path = os.path.join(insp_dir, fname)
    try:
        with open(file_path, "wb") as f:
            f.write(pdf_bytes)
    except Exception as io_err:
        print(f"[PDF Engine] Storage write note: {io_err}")

    local_pdf_url = f"/static/pdf/inspections/{fname}"
    pdf_url = local_pdf_url
    insp_col = "checkout_pdf_url" if is_checkout else "checkin_pdf_url"
    insp_label = f"ใบตรวจสภาพรถ_{clean_type.capitalize()}"

    # Google Drive Priority Upload & DB Update
    try:
        from services.google_drive_service import upload_pdf_to_drive, build_pdf_filename, FOLDER_INSPECTIONS
        gdrive_fname = build_pdf_filename(insp_label, bk_id)
        res = upload_pdf_to_drive(pdf_bytes, FOLDER_INSPECTIONS, gdrive_fname, doc_type=insp_label)
        if res.get("success") and res.get("webViewLink"):
            pdf_url = res.get("webViewLink")
            print(f"[Inspection PDF Gen] Direct Google Drive upload success: {pdf_url}")
    except Exception as gdrive_err:
        print(f"[Inspection PDF Gen] Direct Google Drive upload note: {gdrive_err}")

    target[insp_col] = pdf_url
    store.async_sync_booking(target)
    try:
        sb = get_db_client()
        if sb:
            sb.table("bookings").update({insp_col: pdf_url}).eq("booking_id", bk_id).execute()
    except Exception as dberr:
        print(f"[Inspection PDF Gen] Direct DB update notice: {dberr}")

    # Fallback background retry if direct upload failed
    if pdf_url == local_pdf_url:
        try:
            from services.google_drive_service import FOLDER_INSPECTIONS
            async_upload_pdf_to_drive(
                doc_type=insp_label,
                ref_id=bk_id,
                pdf_bytes=pdf_bytes,
                folder_id=FOLDER_INSPECTIONS,
                booking_dict=target,
                db_col=insp_col
            )
        except Exception as bg_err:
            print(f"[Inspection PDF Gen] Background retry notice: {bg_err}")

    return {
        "success": True,
        "booking_id": bk_id,
        "inspection_type": clean_type,
        "pdf_url": pdf_url,
        "checkout_pdf_url": target.get("checkout_pdf_url"),
        "checkin_pdf_url": target.get("checkin_pdf_url")
    }


@router.post("/api/bookings/{bk_id}/extend")
def extend_booking(bk_id: str, payload: Dict[str, Any]):
    """Flow 6.2: customer extends the contract -> overlap check -> new contract (PDF) -> payment."""
    target = next((b for b in store.bookings if b.get("booking_id") == bk_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="ไม่พบรายการจอง")
    if target.get("status") not in ("กำลังเช่า", "เตรียมรับคืน"):
        raise HTTPException(status_code=400, detail="⚠️ ต่อสัญญาได้เฉพาะรายการที่อยู่ในสถานะ \"กำลังเช่า\" เท่านั้น")

    old_end = to_date(target.get("end_date"))
    old_end_t = target.get("end_time") or "10:00"
    new_end = to_date(payload.get("new_end_date"))
    new_end_t = payload.get("new_end_time") or old_end_t
    if not new_end or not old_end:
        raise HTTPException(status_code=400, detail="กรุณาระบุวันที่ต่อสัญญาใหม่")
    if new_end <= old_end:
        raise HTTPException(
            status_code=400,
            detail=f"วันที่ต่อสัญญาใหม่ ({new_end.strftime('%d/%m/%Y')}) ต้องมากกว่าวันสิ้นสุดสัญญาเดิม ({old_end.strftime('%d/%m/%Y')})"
        )

    # Block immediately if another queue is booked inside the extension window
    _conflict = find_booking_overlap(target.get("car_id"), old_end, new_end, exclude_booking_id=bk_id)
    if _conflict:
        raise_overlap_error(_conflict, "ต่อสัญญา")

    extra_days, _eh, _rm, _ov, _expl = calculate_rental_duration_and_days(old_end, old_end_t, new_end, new_end_t)
    car_obj = store.cars.get(target.get("car_id"), {})
    price_day = float(car_obj.get("price_day") or car_obj.get("daily_rate") or 1000)
    extra_price = payload.get("extra_price")
    extra_price = float(extra_price) if extra_price not in (None, "") else price_day * extra_days

    also_pay_rental = bool(payload.get("also_pay_rental", False))
    pay_method = str(payload.get("payment_method") or target.get("rental_payment_method") or "โอนเงิน / สแกน QR")
    pay_ref = str(payload.get("payment_ref") or "").strip()

    ext_list = list(target.get("extension_history") or [])
    ext_no = len([x for x in ext_list if isinstance(x, dict) and x.get("type") == "extension"]) + 1
    ext_list.append({
        "type": "extension",
        "no": ext_no,
        "old_end_date": str(old_end),
        "old_end_time": old_end_t,
        "new_end_date": str(new_end),
        "new_end_time": new_end_t,
        "extra_days": extra_days,
        "extra_price": extra_price,
        "paid_at_extend": also_pay_rental,
        "created_at": now_th().isoformat()
    })

    prev_outstanding = 0.0 if target.get("rental_paid") else float(target.get("remaining_rental") or 0.0)
    total_due = prev_outstanding + extra_price
    th_today = now_th().date().isoformat()
    target["extension_history"] = ext_list
    target["end_date"] = new_end
    target["end_time"] = new_end_t
    target["base_price"] = float(target.get("base_price") or 0.0) + extra_price
    target["net_price"] = float(target.get("net_price") or 0.0) + extra_price
    if also_pay_rental:
        target["remaining_rental"] = 0.0
        target["rental_paid"] = True
        target["is_fully_paid"] = True
        target["rental_payment_date"] = th_today
        target["rental_payment_method"] = pay_method
        if pay_ref:
            target["rental_ref"] = pay_ref
        if "ชำระวันคืนรถ" in pay_method:
            target["payment_status_note"] = "รอชำระวันคืนรถ"
        car_comp = car_obj.get("company", "Sawasdee Rent A Car")
        rent_detail = f"ชำระค่าเช่าต่อสัญญา #{ext_no} รถ {target.get('car_id')} ({pay_method})"
        if pay_ref:
            rent_detail += f" [Ref/สลิป: {pay_ref}]"
        store.async_sync_financial({
            "company": car_comp,
            "type": "รายรับ",
            "category": "ค่าเช่ารถ",
            "amount": total_due,
            "ref": bk_id,
            "date": th_today,
            "detail": rent_detail
        })
    else:
        target["remaining_rental"] = total_due
        target["rental_paid"] = False
        target["is_fully_paid"] = False
    target["contract_issued"] = True
    store.async_sync_booking(target)

    return {
        "success": True,
        "booking": target,
        "extension_no": ext_no,
        "extra_days": extra_days,
        "extra_price": extra_price,
        "paid_now": also_pay_rental,
        "pdf_url": f"/api/pdf/contract/{bk_id}?download=1"
    }


@router.get("/api/bookings/{bk_id}/extend-check")
def extend_check(bk_id: str, new_end_date: str):
    """Pre-check for the Extend Contract dialog (overlap + price preview)."""
    target = next((b for b in store.bookings if b.get("booking_id") == bk_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="ไม่พบรายการจอง")
    old_end = to_date(target.get("end_date"))
    new_end = to_date(new_end_date)
    if not new_end or not old_end or new_end <= old_end:
        return {"ok": False, "message": "วันที่ต่อสัญญาใหม่ต้องมากกว่าวันสิ้นสุดสัญญาเดิม"}
    conflict = find_booking_overlap(target.get("car_id"), old_end, new_end, exclude_booking_id=bk_id)
    if conflict:
        return {
            "ok": False,
            "message": f"ติดจองคิวอื่น: {conflict.get('customer')} ({format_date_dmy(conflict.get('start_date'))} - {format_date_dmy(conflict.get('end_date'))})"
        }
    days, _a, _b, _c, _d = calculate_rental_duration_and_days(old_end, target.get("end_time") or "10:00", new_end, target.get("end_time") or "10:00")
    car_obj = store.cars.get(target.get("car_id"), {})
    price_day = float(car_obj.get("price_day") or car_obj.get("daily_rate") or 1000)
    return {"ok": True, "extra_days": days, "extra_price": price_day * days}


@router.delete("/api/bookings/{bk_id}")
def delete_booking(bk_id: str):
    target = next((b for b in store.bookings if b.get("booking_id") == bk_id), None)
    if target and target.get("car_id") in store.cars:
        release_car_after_booking(target["car_id"], bk_id)

    store.async_delete_booking(bk_id)
    return {"success": True}


# -------------------------------------------------------------------------
# DEPOSIT & PAYMENT WORKFLOW
# -------------------------------------------------------------------------
@router.post("/api/bookings/{bk_id}/deposit")
def record_deposit(bk_id: str, payload: Dict[str, Any]):
    target = next((b for b in store.bookings if b.get("booking_id") == bk_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="ไม่พบรายการจอง")

    dep_amount = float(payload.get("amount") or payload.get("deposit_amount") or 5000.0)  # STRICT RULE: Fixed 5,000 THB deposit
    dep_method = str(payload.get("payment_method", "โอนเงิน / สแกน QR"))
    dep_ref = str(payload.get("ref_id") or payload.get("payment_ref") or payload.get("deposit_ref") or "").strip()
    dep_slip = convert_gdrive_url(str(payload.get("slip_image_url") or payload.get("slip_url") or payload.get("deposit_slip") or "").strip())
    pay_type = str(payload.get("payment_type") or "").strip() or ("มัดจำและค่าเช่า" if bool(payload.get("also_pay_rental", False)) else "มัดจำประกันสัญญา")
    gdrive_link = str(payload.get("google_drive_link") or "").strip()
    also_pay_rental = bool(payload.get("also_pay_rental", False))
    net_p = float(target.get("net_price", 0.0))

    th_today = now_th().date().isoformat()
    target["deposit_paid"] = True
    target["deposit_amount"] = dep_amount
    target["deposit_date"] = th_today
    target["deposit_method"] = dep_method
    target["deposit_ref"] = dep_ref
    target["deposit_slip"] = dep_slip
    target["payment_slip_url"] = dep_slip
    target["payment_type"] = pay_type
    target["google_drive_link"] = gdrive_link
    if "ชำระวันคืนรถ" in dep_method:
        target["payment_status_note"] = "รอชำระวันคืนรถ"

    if also_pay_rental:
        target["rental_paid"] = True
        target["remaining_rental"] = 0.0
        target["is_fully_paid"] = True
        target["rental_payment_date"] = th_today
        target["rental_payment_method"] = dep_method
        target["rental_ref"] = dep_ref
        target["rental_slip"] = dep_slip
        target["remaining_slip_link"] = dep_slip
    else:
        # TARGET MISSION 3: ยอดเงินคงเหลือ = ราคาค่าเช่าที่ตกลง (net_price) - เงินมัดจำที่ชำระแล้ว (deposit_amount)
        target["remaining_rental"] = max(0.0, net_p - dep_amount)

    if target.get("status") == "รอชำระมัดจำ":
        target["status"] = "รอส่งมอบ"

    car_id = target.get("car_id")
    c_key = get_car_key(car_id)
    if c_key and c_key in store.cars:
        norm_ck = re.sub(r"[\s\-_]", "", str(c_key)).strip().lower()
        has_active_on_rent = any(
            re.sub(r"[\s\-_]", "", str(b.get("car_id", ""))).strip().lower() == norm_ck
            and b.get("booking_id") != bk_id
            and b.get("status") in ("กำลังเช่า", "รอรับคืน")
            for b in store.bookings
        )
        if not has_active_on_rent and store.cars[c_key].get("status") != "ซ่อมบำรุง":
            store.cars[c_key]["status"] = "ติดจอง"
            store.async_sync_car(c_key, store.cars[c_key])

    store.async_sync_booking(target)

    # Record financial: Deposit (Strict mapping to financial_records per Mission 2)
    car_comp = store.cars.get(car_id, {}).get("company", "Sawasdee Rent A Car")
    dep_detail = f"รับเงินมัดจำประกันสัญญาตอนจองรถ ({dep_method})"
    if dep_ref:
        dep_detail += f" [Ref/สลิป: {dep_ref}]"

    now_ts = now_th().strftime("%Y-%m-%d %H:%M:%S")
    f_dep = {
        "date": now_ts,
        "type": "Income",
        "category": "Deposit",
        "amount": dep_amount,
        "ref_id": bk_id,
        "description": dep_detail,
        # Backward-compatible & schema aliases
        "ref": bk_id,
        "detail": dep_detail,
        "company": car_comp,
        "payment_method": dep_method,
        "slip_image_url": dep_slip,
        "slip_url": dep_slip
    }
    try:
        store.sync_financial(f_dep)
    except Exception as fin_err:
        print(f"Error recording financial deposit: {fin_err}")

    if also_pay_rental:
        rent_detail = f"ชำระค่าเช่ารถพร้อมมัดจำ {car_id} ({dep_method})"
        if dep_ref:
            rent_detail += f" [Ref/สลิป: {dep_ref}]"
        f_rent = {
            "date": now_ts,
            "type": "Income",
            "category": "Rental",
            "amount": net_p,
            "ref_id": bk_id,
            "description": rent_detail,
            "ref": bk_id,
            "detail": rent_detail,
            "company": car_comp,
            "payment_method": dep_method,
            "slip_image_url": dep_slip,
            "slip_url": dep_slip
        }
        try:
            store.sync_financial(f_rent)
        except Exception as fin_rent_err:
            print(f"Error recording financial rental: {fin_rent_err}")

    # Deposit confirmation no longer sends LINE. Receipt PDF and DB save stay unchanged.
    # try:
    #     notify_line_deposit(target, dep_amount, dep_method, dep_ref, dep_slip, also_pay_rental)
    # except Exception as line_err:
    #     print(f"Error sending LINE deposit notification: {line_err}")

    return {"success": True, "booking": target}


@router.post("/api/bookings/{bk_id}/settle")
def settle_rental(bk_id: str, payload: Dict[str, Any]):
    target = next((b for b in store.bookings if b.get("booking_id") == bk_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="ไม่พบรายการจอง")

    settle_method = str(payload.get("payment_method", "โอนเงิน / สแกน QR"))
    settle_ref = str(payload.get("payment_ref") or payload.get("rental_ref") or "").strip()
    settle_slip = convert_gdrive_url(str(payload.get("slip_url") or payload.get("rental_slip") or payload.get("remaining_slip_link") or payload.get("slip_image_url") or "").strip())
    # Amount due = outstanding balance (covers extension top-ups); falls back to net_price - deposit
    rem_due = float(target.get("remaining_rental") if target.get("remaining_rental") is not None else 0.0)
    if rem_due <= 0.0 and not target.get("rental_paid"):
        net_val = float(target.get("net_price") or 0.0)
        dep_val = float(target.get("deposit_amount") or 5000.0) if target.get("deposit_paid") else 0.0
        rem_due = max(0.0, net_val - dep_val)
    net_p = rem_due

    th_today = now_th().date().isoformat()
    target["rental_paid"] = True
    target["remaining_rental"] = 0.0
    target["is_fully_paid"] = True
    target["rental_payment_date"] = th_today
    target["rental_payment_method"] = settle_method
    if settle_ref:
        target["rental_ref"] = settle_ref
    if settle_slip:
        target["rental_slip"] = settle_slip
        target["remaining_slip_link"] = settle_slip
    if "ชำระวันคืนรถ" in settle_method:
        target["payment_status_note"] = "รอชำระวันคืนรถ"

    store.async_sync_booking(target)

    car_id = target.get("car_id")
    car_comp = store.cars.get(car_id, {}).get("company", "Sawasdee Rent A Car")
    now_ts = now_th().strftime("%Y-%m-%d %H:%M:%S")
    rent_detail = f"ชำระค่าเช่ารถคงเหลือ {car_id} ({settle_method})"
    if settle_ref:
        rent_detail += f" [Ref/สลิป: {settle_ref}]"
    f_rent = {
        "date": now_ts,
        "type": "Income",
        "category": "Rental",
        "amount": net_p,
        "ref_id": bk_id,
        "description": rent_detail,
        "ref": bk_id,
        "detail": rent_detail,
        "company": car_comp,
        "payment_method": settle_method,
        "slip_image_url": settle_slip,
        "slip_url": settle_slip
    }
    try:
        store.sync_financial(f_rent)
    except Exception as fin_settle_err:
        print(f"Error recording financial settle: {fin_settle_err}")

    # LINE notification disabled for deposit/rental payments (kept only for work orders)
    # try:
    #     notify_line_deposit(target, net_p, settle_method, settle_ref, settle_slip, also_rent=True, is_settle_only=True)
    # except Exception as line_err:
    #     print(f"Error sending LINE settle notification: {line_err}")

    return {"success": True, "booking": target}


@router.post("/api/bookings/{bk_id}/payment-slip")
def update_payment_slip(bk_id: str, payload: Dict[str, Any]):
    target = next((b for b in store.bookings if b.get("booking_id") == bk_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="ไม่พบรายการจอง")

    if "payment_ref" in payload or "deposit_ref" in payload:
        ref_val = str(payload.get("payment_ref") or payload.get("deposit_ref") or "").strip()
        target["deposit_ref"] = ref_val
    if "slip_url" in payload or "deposit_slip" in payload or "payment_slip_url" in payload:
        slip_val = str(payload.get("slip_url") or payload.get("deposit_slip") or payload.get("payment_slip_url") or "").strip()
        target["deposit_slip"] = convert_gdrive_url(slip_val)
        target["payment_slip_url"] = convert_gdrive_url(slip_val)
    if "rental_ref" in payload:
        target["rental_ref"] = str(payload.get("rental_ref") or "").strip()
    if "rental_slip" in payload or "remaining_slip_link" in payload:
        rent_slip_val = str(payload.get("rental_slip") or payload.get("remaining_slip_link") or "").strip()
        target["rental_slip"] = convert_gdrive_url(rent_slip_val)
        target["remaining_slip_link"] = convert_gdrive_url(rent_slip_val)
    if "payment_type" in payload:
        target["payment_type"] = str(payload.get("payment_type") or "").strip()
    if "google_drive_link" in payload:
        target["google_drive_link"] = str(payload.get("google_drive_link") or "").strip()

    try:
        cust, car = _resolve_cust_and_car(target)
        mileage = payload.get("mileage") or target.get("odometer_out") or target.get("dispatch_mileage") or ""
        fuel = payload.get("fuel_level") or target.get("fuel_out") or target.get("dispatch_fuel") or ""
        notes = payload.get("notes") or target.get("inspection_notes_out") or target.get("dispatch_notes") or ""
        pdf_bytes = pdf_engine.generate_inspection_checklist_pdf(
            template_path="car_inspection_updated.pdf",
            booking_info=target,
            customer_info=cust,
            car_info=car,
            inspection_type="checkout",
            payload={
                "odometer": mileage,
                "fuel_level": fuel,
                "notes": notes,
                "staff_name": target.get("worker_delivery", "Staff")
            }
        )
        insp_dir = os.path.join(static_dir, "pdf", "inspections")
        os.makedirs(insp_dir, exist_ok=True)
        fname = f"Inspection_Checkout_{bk_id}.pdf"
        with open(os.path.join(insp_dir, fname), "wb") as f:
            f.write(pdf_bytes)
        target["checkout_pdf_url"] = f"/static/pdf/inspections/{fname}"
        try:
            from services.google_drive_service import FOLDER_INSPECTIONS
            async_upload_pdf_to_drive(
                doc_type="ใบตรวจสภาพรถ_Checkout",
                ref_id=bk_id,
                pdf_bytes=pdf_bytes,
                folder_id=FOLDER_INSPECTIONS,
                booking_dict=target,
                db_col="checkout_pdf_url"
            )
        except Exception as bg_gdrive_err:
            print(f"[Mileage Fuel] GDrive upload notice: {bg_gdrive_err}")
    except Exception as gen_err:
        print(f"[PDF Engine] Auto-generate checkout inspection error: {gen_err}")

    store.async_sync_booking(target)
    return {"success": True, "booking": target, "checkout_pdf_url": target.get("checkout_pdf_url")}


# -------------------------------------------------------------------------
# DISPATCH & RETURN WORK ORDERS
# -------------------------------------------------------------------------
@router.post("/api/bookings/{bk_id}/assign")
def assign_worker(bk_id: str, payload: Dict[str, Any]):
    target = next((b for b in store.bookings if b.get("booking_id") == bk_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="ไม่พบรายการจอง")

    job_type = payload.get("job_type", "Dispatch")
    worker = payload.get("worker", "")
    location = payload.get("location", "")
    time_val = payload.get("time", "10:00")
    s_date_val = payload.get("start_date")
    e_date_val = payload.get("end_date")

    action_type = payload.get("action_type", "assign")
    odometer = payload.get("odometer")
    fuel_level = payload.get("fuel_level")
    inspection_notes = payload.get("inspection_notes")
    inspection_photos = payload.get("inspection_photos")

    # ---- Validate before mutating (state machine + overlap protection) ----
    new_sd = to_date(s_date_val) if s_date_val else to_date(target.get("start_date"))
    new_ed = to_date(e_date_val) if e_date_val else to_date(target.get("end_date"))
    if new_sd and new_ed and new_ed < new_sd:
        raise HTTPException(status_code=400, detail="วันที่คืนรถต้องไม่น้อยกว่าวันที่เริ่มเช่า")
    dates_changed = (new_sd != to_date(target.get("start_date"))) or (new_ed != to_date(target.get("end_date")))
    if dates_changed and target.get("status") not in INACTIVE_BOOKING_STATUSES:
        _conflict = find_booking_overlap(target.get("car_id"), new_sd, new_ed, exclude_booking_id=bk_id)
        if _conflict:
            raise_overlap_error(_conflict, "บันทึกวันที่")
    if job_type == "Dispatch" and action_type == "handover_now":
        require_contract_before_rent(target)
    if job_type != "Dispatch" and action_type == "complete_now" and target.get("status") not in ("กำลังเช่า", "เตรียมรับคืน"):
        raise HTTPException(status_code=400, detail="⚠️ ไม่สามารถรับคืนรถได้: รถยังไม่ได้ส่งมอบ (สถานะต้องเป็น \"กำลังเช่า\" ก่อน)")

    if s_date_val:
        target["start_date"] = to_date(s_date_val)
    if e_date_val:
        target["end_date"] = to_date(e_date_val)

    if job_type == "Dispatch":
        target["worker_delivery"] = worker
        target["loc_delivery"] = location
        target["start_time"] = time_val
        if odometer is not None and str(odometer).strip() != "":
            target["odometer_out"] = str(odometer).strip()
            target["dispatch_mileage"] = str(odometer).strip()
        if fuel_level is not None and str(fuel_level).strip() != "":
            target["fuel_out"] = str(fuel_level).strip()
            target["dispatch_fuel"] = str(fuel_level).strip()
        if inspection_notes is not None:
            target["inspection_notes_out"] = str(inspection_notes).strip()
            target["dispatch_notes"] = str(inspection_notes).strip()
            target["remarks"] = str(inspection_notes).strip()
        insp_cats = payload.get("inspection_categories") or payload.get("inspection_categories_out")
        if insp_cats is not None:
            target["inspection_categories_out"] = insp_cats
            target["inspection_categories"] = insp_cats
        if inspection_photos is not None and str(inspection_photos).strip() != "":
            target["inspection_photos_out"] = str(inspection_photos).strip()
            target["dispatch_photos"] = str(inspection_photos).strip()
        if action_type == "handover_now":
            target["status"] = "กำลังเช่า"
            target["dispatch_closed"] = True
            car_id = target.get("car_id")
            if car_id in store.cars:
                store.cars[car_id]["status"] = "กำลังเช่า"
                store.async_sync_car(car_id, store.cars[car_id])
        elif target.get("status") in ["รอส่งมอบ", "รอชำระมัดจำ"]:
            target["status"] = "เตรียมส่งมอบ"
    else:
        target["worker_return"] = worker
        target["loc_return"] = location
        target["end_time"] = time_val
        if odometer is not None and str(odometer).strip() != "":
            disp_km = target.get("odometer_out") or target.get("dispatch_mileage")
            _update_car_mileage_on_return(target.get("car_id"), odometer, disp_km)
            target["odometer_in"] = str(odometer).strip()
            target["return_mileage"] = str(odometer).strip()
        if fuel_level is not None and str(fuel_level).strip() != "":
            target["fuel_in"] = str(fuel_level).strip()
            target["return_fuel"] = str(fuel_level).strip()
        if inspection_notes is not None:
            target["inspection_notes_in"] = str(inspection_notes).strip()
            target["return_notes"] = str(inspection_notes).strip()
            target["remarks"] = str(inspection_notes).strip()
        insp_cats = payload.get("inspection_categories") or payload.get("inspection_categories_in")
        if insp_cats is not None:
            target["inspection_categories_in"] = insp_cats
            target["inspection_categories"] = insp_cats
        if inspection_photos is not None and str(inspection_photos).strip() != "":
            target["inspection_photos_in"] = str(inspection_photos).strip()
            target["return_photos"] = str(inspection_photos).strip()
        for img_col in ("checkin_img_front", "checkin_img_left", "checkin_img_rear", "checkin_img_right"):
            if img_col in payload and payload.get(img_col) is not None:
                target[img_col] = str(payload.get(img_col)).strip() or None
        if action_type == "complete_now":
            target["status"] = "เสร็จสิ้น"
            target["return_closed"] = True
            release_car_after_booking(target.get("car_id"), bk_id)
        elif target.get("status") == "กำลังเช่า":
            target["status"] = "เตรียมรับคืน"

    # Auto-generate or update official inspection checklist PDF
    try:
        cust, car = _resolve_cust_and_car(target)
        is_checkout = (job_type == "Dispatch")
        clean_type = "checkout" if is_checkout else "checkin"
        current_insp_payload = {
            "odometer": target.get("odometer_out" if is_checkout else "odometer_in"),
            "odometer_out": target.get("odometer_out"),
            "odometer_in": target.get("odometer_in"),
            "fuel_level": target.get("fuel_out" if is_checkout else "fuel_in"),
            "fuel_out": target.get("fuel_out"),
            "fuel_in": target.get("fuel_in"),
            "notes": target.get("inspection_notes_out" if is_checkout else "inspection_notes_in"),
            "remarks": target.get("remarks") or target.get("inspection_notes_out" if is_checkout else "inspection_notes_in"),
            "inspection_notes": target.get("inspection_notes_out" if is_checkout else "inspection_notes_in"),
            "inspection_categories": target.get("inspection_categories_out" if is_checkout else "inspection_categories_in"),
            "staff_name": worker or target.get("worker_delivery" if is_checkout else "worker_return") or "Staff"
        }
        pdf_bytes = pdf_engine.generate_inspection_checklist_pdf(
            template_path="car_inspection_updated.pdf",
            booking_info=target,
            customer_info=cust,
            car_info=car,
            inspection_type=clean_type,
            payload=current_insp_payload
        )
        insp_dir = os.path.join(static_dir, "pdf", "inspections")
        os.makedirs(insp_dir, exist_ok=True)
        fname = f"Inspection_{clean_type.capitalize()}_{bk_id}.pdf"
        with open(os.path.join(insp_dir, fname), "wb") as f:
            f.write(pdf_bytes)
        insp_col = "checkout_pdf_url" if is_checkout else "checkin_pdf_url"
        target[insp_col] = f"/static/pdf/inspections/{fname}"
        try:
            from services.google_drive_service import FOLDER_INSPECTIONS
            insp_label = f"ใบตรวจสภาพรถ_{clean_type.capitalize()}"
            async_upload_pdf_to_drive(
                doc_type=insp_label,
                ref_id=bk_id,
                pdf_bytes=pdf_bytes,
                folder_id=FOLDER_INSPECTIONS,
                booking_dict=target,
                db_col=insp_col
            )
        except Exception as bg_gdrive_err:
            print(f"[Assign Worker] GDrive upload notice: {bg_gdrive_err}")
    except Exception as auto_pdf_err:
        print(f"[PDF Engine] Auto inspection update in assign: {auto_pdf_err}")

    store.async_sync_booking(target)

    # Decoupled Work Order Log for Dispatch / Return Assignment
    try:
        appt_date = s_date_val if job_type == "Dispatch" else e_date_val
        appt_dt = f"{appt_date} {time_val}:00" if appt_date and time_val else (str(appt_date) if appt_date else None)
        j_status = "Completed" if action_type == "complete_now" else ("In Progress" if action_type == "handover_now" else "Pending")
        store.log_work_order(
            car_id=target.get("car_id"),
            booking_id=bk_id,
            work_type=job_type,
            description=f"ใบงาน{'ส่งมอบรถ (Dispatch)' if job_type == 'Dispatch' else 'รับรถคืน (Return)'} พนักงาน: {worker} สถานที่: {location or '-'}",
            cost=0.0,
            staff_id=worker,
            appointment_datetime=appt_dt,
            location=location,
            job_status=j_status
        )
    except Exception as wo_err:
        print(f"Work order log note: {wo_err}")

    # Work order LINE notification retired per system rule

    return {"success": True, "booking": target}


# -------------------------------------------------------------------------
# BACK OFFICE WORK ORDERS & INSPECTIONS
# -------------------------------------------------------------------------
@router.get("/api/backoffice/jobs")
def list_backoffice_jobs():
    jobs = []
    archived_ids = {cj.get("booking_id") for cj in store.completed_jobs}
    for b in store.bookings:
        if b.get("status") in ["ยกเลิก", "เสร็จสิ้น"] or b.get("booking_id") in archived_ids:
            continue

        is_disp_closed = bool(b.get("dispatch_closed", False)) or (b.get("status") in ["กำลังเช่า", "เตรียมรับคืน"])
        is_ret_closed = bool(b.get("return_closed", False))

        cust_obj = store.customers.get(b.get("customer"), {})
        cust_phone = cust_obj.get("contact_no", "-")

        # 1. Dispatch Job
        if not is_disp_closed:
            s_d = b.get('start_date')
            s_d_str = s_d.strftime("%Y-%m-%d") if isinstance(s_d, (date, datetime)) else str(s_d or "")
            jobs.append({
                "job_type": "Dispatch",
                "job_type_label": "จัดส่งรถ (Dispatch)",
                "booking_id": b.get("booking_id"),
                "car_id": b.get("car_id"),
                "customer": b.get("customer"),
                "customer_phone": cust_phone,
                "schedule": f"{format_date_dmy(b.get('start_date'))} ({b.get('start_time', '10:00')})",
                "date_iso": s_d_str,
                "start_date": s_d_str,
                "start_time": b.get("start_time", "10:00"),
                "worker": b.get("worker_delivery") or "Wait",
                "location": b.get("loc_delivery") or "-",
                "status": b.get("status", "รอส่งมอบ"),
                "is_locked": False,
                "deposit_paid": b.get("deposit_paid", False),
                "rental_paid": b.get("rental_paid", False),
                "net_price": b.get("net_price", 0)
            })

        # 2. Return Job
        if not is_ret_closed:
            e_d = b.get('end_date')
            e_d_str = e_d.strftime("%Y-%m-%d") if isinstance(e_d, (date, datetime)) else str(e_d or "")
            is_ret_locked = not is_disp_closed
            ret_status = "🔒 รอส่งรถก่อน" if is_ret_locked else (b.get("status") if b.get("status") != "รอชำระมัดจำ" else "รอรับคืน")
            jobs.append({
                "job_type": "Return",
                "job_type_label": "รับรถคืน (Return)",
                "booking_id": b.get("booking_id"),
                "car_id": b.get("car_id"),
                "customer": b.get("customer"),
                "customer_phone": cust_phone,
                "schedule": f"คืน: {format_date_dmy(b.get('end_date'))} ({b.get('end_time', '10:00')})",
                "date_iso": e_d_str,
                "end_date": e_d_str,
                "end_time": b.get("end_time", "10:00"),
                "worker": b.get("worker_return") or "Wait",
                "location": b.get("loc_return") or b.get("loc_delivery") or "-",
                "status": ret_status,
                "is_locked": is_ret_locked,
                "deposit_paid": b.get("deposit_paid", False),
                "rental_paid": b.get("rental_paid", False),
                "net_price": b.get("net_price", 0)
            })

    # 3. Maintenance & Renewal Work Orders
    for m in store.maintenance_records:
        m_stat = m.get("status", "รอดำเนินการ")
        if m_stat in ["ยกเลิก", "เสร็จสิ้น"]:
            continue
        m_type = m.get("order_type", "ซ่อมบำรุงทั่วไป / เช็คระยะ")
        is_renewal = any(k in m_type for k in ["ต่อทะเบียน", "พ.ร.บ.", "พรบ", "ประกัน"])
        j_type = "Renewal" if is_renewal else "Maintenance"
        j_label = "📄 ต่อทะเบียน/พรบ./ประกัน" if is_renewal else "🛠️ ซ่อมบำรุง (Maintenance)"

        m_sd_str = str(m.get("schedule_date") or "")
        jobs.append({
            "job_type": j_type,
            "job_type_label": j_label,
            "booking_id": m.get("id"),
            "car_id": m.get("car_id"),
            "customer": f"🏢 {m.get('service_center', '-')}",
            "customer_phone": m.get("service_center_phone") or "-",
            "schedule": f"นัด: {format_date_dmy(m.get('schedule_date'))} ({m.get('schedule_time', '09:00')}) ➔ รับ: {format_date_dmy(m.get('expected_finish_date'))}",
            "date_iso": m_sd_str,
            "start_date": m_sd_str,
            "start_time": str(m.get("schedule_time") or "09:00"),
            "end_date": str(m.get("expected_finish_date") or ""),
            "worker": m.get("assigned_worker") or "Wait",
            "location": m.get("service_location") or m.get("service_center") or "-",
            "status": m_stat,
            "is_locked": False,
            "deposit_paid": True,
            "rental_paid": True,
            "net_price": float(m.get("cost", 0)),
            "service_items": m.get("service_items", "-"),
            "is_maintenance": True,
            "maintenance_id": m.get("id"),
            "order_type": m_type
        })

    jobs.sort(key=lambda x: (x["booking_id"], x["job_type"] == "Dispatch"), reverse=True)
    return jobs


@router.post("/api/bookings/{bk_id}/close-dispatch")
def close_dispatch(bk_id: str, payload: Dict[str, Any]):
    target = next((b for b in store.bookings if b.get("booking_id") == bk_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="ไม่พบรายการจอง")

    require_contract_before_rent(target)

    fuel = payload.get("fuel_level", "⛽ เต็มถัง (Full - 8/8) [100%]")
    mileage = payload.get("mileage", "")
    notes = payload.get("notes", "ตรวจสภาพรถยนต์ก่อนส่งมอบเรียบร้อยดี")
    photos = payload.get("photos", [])

    target["dispatch_closed"] = True
    target["dispatch_fuel"] = fuel
    target["dispatch_mileage"] = mileage
    target["dispatch_notes"] = notes
    target["dispatch_photos"] = photos
    target["status"] = "กำลังเช่า"

    car_diag = payload.get("car_diagram") or payload.get("car_diagram_out") or payload.get("diagram_base64")
    if car_diag:
        target["car_diagram_out"] = car_diag
        target["car_diagram"] = car_diag
    dmg_marks = payload.get("damage_marks") or payload.get("damage_marks_out")
    if dmg_marks:
        target["damage_marks_out"] = dmg_marks
        target["damage_marks"] = dmg_marks

    car_id = target.get("car_id")
    if car_id in store.cars:
        store.cars[car_id]["status"] = "กำลังเช่า"
        if mileage:
            store.cars[car_id]["mileage"] = mileage
        store.async_sync_car(car_id, store.cars[car_id])

    store.async_sync_booking(target)
    return {"success": True, "booking": target}


@router.post("/api/bookings/{bk_id}/close-return")
def close_return(bk_id: str, payload: Dict[str, Any]):
    action = payload.get("action", "end_contract")
    fuel = payload.get("fuel_level", "⛽ เต็มถัง (Full - 8/8) [100%]")
    mileage = payload.get("mileage", "")
    target_bk = next((b for b in store.bookings if b.get("booking_id") == bk_id), {})
    disp_km = target_bk.get("odometer_out") or target_bk.get("dispatch_mileage")
    if mileage:
        _update_car_mileage_on_return(target_bk.get("car_id"), mileage, disp_km)
    notes = payload.get("notes", "ตรวจสภาพรถยนต์ตอนรับคืนเรียบร้อยดี")
    photos = payload.get("photos", [])
    late_fee = float(payload.get("late_fee", 0.0))
    condition = payload.get("condition", "normal")
    damage_desc = payload.get("damage_desc", "")
    repair_cost = float(payload.get("repair_cost", 0.0))
    service_center = payload.get("service_center", "")
    img_f = payload.get("checkin_img_front")
    img_l = payload.get("checkin_img_left")
    img_re = payload.get("checkin_img_rear")
    img_ri = payload.get("checkin_img_right")
    for k_img, v_img in [("checkin_img_front", img_f), ("checkin_img_left", img_l), ("checkin_img_rear", img_re), ("checkin_img_right", img_ri)]:
        if v_img is not None:
            target_bk[k_img] = str(v_img).strip() or None

    car_diag = payload.get("car_diagram") or payload.get("car_diagram_in") or payload.get("diagram_base64")
    if car_diag:
        target_bk["car_diagram_in"] = car_diag
    dmg_marks = payload.get("damage_marks") or payload.get("damage_marks_in")
    if dmg_marks:
        target_bk["damage_marks_in"] = dmg_marks

    if action == "swap_vehicle":
        new_car_id = str(payload.get("new_car_id", "")).strip()
        if not new_car_id:
            raise HTTPException(status_code=400, detail="กรุณาเลือกรถคันใหม่สำหรับเปลี่ยนทดแทน")
        success = store.swap_booking_vehicle(
            booking_id=bk_id,
            new_car_id=new_car_id,
            fuel_level=fuel,
            inspection_notes=notes,
            inspection_photos=photos,
            mileage=mileage,
            damage_desc=damage_desc,
            repair_cost=repair_cost,
            service_center=service_center
        )
        if not success:
            raise HTTPException(status_code=404, detail="ไม่สามารถเปลี่ยนรถทดแทนได้ หรือไม่พบรหัสการจอง")

        # Log to universal work_order_logs for Swap
        try:
            target = next((b for b in store.bookings if b.get("booking_id") == bk_id), {})
            store.log_work_order(
                car_id=target.get("car_id") or new_car_id,
                booking_id=bk_id,
                work_type="Swap",
                description=f"สลับเปลี่ยนรถทดแทนเป็น {new_car_id} เนื่องจากรถเสียหาย: {damage_desc}. เลขไมล์: {mileage or '-'}, น้ำมัน: {fuel}",
                cost=repair_cost,
                staff_id="admin"
            )
        except Exception as e:
            print(f"Error logging swap work order: {e}")

        return {"success": True, "action": "swap_vehicle", "new_car_id": new_car_id}

    success = store.archive_completed_booking(
        booking_id=bk_id,
        fuel_level=fuel,
        inspection_notes=notes,
        inspection_photos=photos,
        mileage=mileage,
        late_fee=late_fee,
        condition=condition,
        damage_desc=damage_desc,
        repair_cost=repair_cost,
        service_center=service_center,
        checkin_img_front=img_f,
        checkin_img_left=img_l,
        checkin_img_rear=img_re,
        checkin_img_right=img_ri
    )
    if not success:
        raise HTTPException(status_code=404, detail="ไม่สามารถปิดงานรับคืนได้ หรือไม่พบรหัสการจอง")

    # Log to universal work_order_logs for Return
    try:
        target = next((b for b in store.bookings if b.get("booking_id") == bk_id), {})
        record_booking_completion_income(target)
        desc_text = f"ตรวจรับรถคืน ({condition})"
        if damage_desc:
            desc_text += f" ความเสียหาย: {damage_desc}"
        desc_text += f", เลขไมล์: {mileage or '-'}, น้ำมัน: {fuel}, หมายเหตุ: {notes}"
        store.log_work_order(
            car_id=target.get("car_id", ""),
            booking_id=bk_id,
            work_type="Return",
            description=desc_text,
            cost=repair_cost,
            staff_id="admin"
        )
    except Exception as e:
        print(f"Error logging return work order: {e}")

    return {"success": True, "action": "end_contract"}


@router.post("/api/inspections/checkin")
@router.post("/api/inspections/{bk_id}/checkin")
def complete_inspection_checkin_direct(bk_id: Optional[str] = None, payload: Optional[Dict[str, Any]] = None):
    """Dedicated endpoint for direct check-in inspection mileage update & PDF completion."""
    payload = payload or {}
    b_id = bk_id or payload.get("booking_id")
    if not b_id:
        raise HTTPException(status_code=400, detail="booking_id is required")
    return generate_booking_inspection_pdf(b_id, {**payload, "inspection_type": "checkin"})
