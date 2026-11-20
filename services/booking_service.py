"""
Booking business flow guards, income recording, and entity resolution services for SawasdeeRental.
"""

import re
from datetime import datetime, date
from typing import Any, Optional, Dict, Tuple
from fastapi import HTTPException

from db import store, get_db_client, to_date, format_date_dmy
from dependencies import INACTIVE_BOOKING_STATUSES, get_car_key, now_th


def find_booking_overlap(car_id, start_d, end_d, exclude_booking_id=None):
    """Return the first active booking of car_id whose date range overlaps [start_d, end_d], else None."""
    if not car_id or not start_d or not end_d:
        return None
    for b in store.bookings:
        if b.get("car_id") != car_id:
            continue
        if exclude_booking_id and b.get("booking_id") == exclude_booking_id:
            continue
        if b.get("status") in INACTIVE_BOOKING_STATUSES:
            continue
        b_s = to_date(b.get("start_date"))
        b_e = to_date(b.get("end_date"))
        if b_s and b_e and not (b_e < start_d or b_s > end_d):
            return b
    return None


def raise_overlap_error(conflict, action="จองรถ"):
    """Raise HTTP 409 conflict error when booking dates overlap an existing queue."""
    raise HTTPException(
        status_code=409,
        detail=(
            f"⚠️ ไม่สามารถ{action}ได้: วันที่ทับซ้อนกับคิวเดิมของรถคันนี้ "
            f"(รหัส {conflict.get('booking_id')} / ลูกค้า {conflict.get('customer')} / "
            f"{format_date_dmy(conflict.get('start_date'))} - {format_date_dmy(conflict.get('end_date'))})"
        )
    )


def release_car_after_booking(car_id, finished_booking_id=None):
    """Return car to Available, or back to Reserved if another active queue still exists."""
    c_key = get_car_key(car_id)
    if not c_key or c_key not in store.cars:
        return
    norm_ck = re.sub(r"[\s\-_]", "", str(c_key)).strip().lower()
    has_queue = any(
        re.sub(r"[\s\-_]", "", str(b.get("car_id", ""))).strip().lower() == norm_ck
        and b.get("booking_id") != finished_booking_id
        and b.get("status") not in INACTIVE_BOOKING_STATUSES
        for b in store.bookings
    )
    store.cars[c_key]["status"] = "ติดจอง" if has_queue else "ว่างพร้อมใช้งาน"
    store.async_sync_car(c_key, store.cars[c_key])


def require_contract_before_rent(booking):
    """On-Rent status may only be reached after the rental contract has been issued."""
    if not booking.get("contract_issued"):
        raise HTTPException(
            status_code=400,
            detail="⚠️ ไม่สามารถเปลี่ยนสถานะเป็น \"กำลังเช่า\" ได้: ต้องออกสัญญาเช่าให้เรียบร้อยก่อน (จอง ➔ มัดจำ ➔ ใบงาน ➔ ชำระค่าเช่า ➔ สัญญา)"
        )
    if not booking.get("deposit_paid"):
        raise HTTPException(status_code=400, detail="⚠️ ยังไม่ได้ชำระเงินมัดจำ ไม่สามารถส่งมอบรถได้")


def record_booking_completion_income(target_bk: dict) -> bool:
    """
    TARGET MISSION 2: Auto-log rental income into financial_records upon booking completion for dashboard analytics.
    Ensures idempotency (no duplicate entries) and safe transaction recording.
    """
    if not target_bk:
        return False
    bid = str(target_bk.get("booking_id") or "").strip()
    if not bid:
        return False

    # Prevent double-logging if already recorded in memory
    has_income = any(
        (str(f.get("ref", "")).strip() == bid and (str(f.get("category", "")).strip() == "ค่าเช่ารถ" or str(f.get("type", "")).strip().lower() in ["income", "รายรับ"]))
        or (bid in str(f.get("description", "")) and "ค่าเช่า" in str(f.get("category", "")))
        for f in getattr(store, "financial_records", [])
    )
    if has_income:
        return False

    plate = str(target_bk.get("car_id") or "-").strip()
    raw_net = target_bk.get("net_price") if target_bk.get("net_price") is not None else (target_bk.get("total_price") or target_bk.get("rental_rate") or 0.0)
    try:
        net_p = float(raw_net or 0.0)
    except Exception:
        net_p = 0.0

    ret_date = target_bk.get("return_date") or target_bk.get("end_date") or now_th().date().isoformat()
    if isinstance(ret_date, (datetime, date)):
        c_date = ret_date.strftime("%Y-%m-%d")
    else:
        c_date = str(ret_date).split("T")[0].split(" ")[0].strip() or now_th().date().isoformat()

    comp = str(target_bk.get("company") or (store.cars.get(plate) or {}).get("company") or "บจก.สวัสดี เรนทัล (Sawasdee Rental)").strip()
    desc_str = f"รายได้ค่าเช่ารถ รหัสการจอง [{bid}] - ทะเบียน [{plate}]"

    f_item = {
        "company": comp,
        "type": "income",
        "category": "ค่าเช่ารถ",
        "amount": round(net_p, 2),
        "ref": bid,
        "date": c_date,
        "description": desc_str,
        "detail": desc_str
    }

    # Direct DB execution with transaction/error handling
    sb = get_db_client()
    if sb:
        try:
            existing_db = sb.table("financial_records").select("id, category, type").eq("ref", bid).execute()
            if existing_db and existing_db.data and len(existing_db.data) > 0:
                has_db_income = any(
                    (str(r.get("category", "")) == "ค่าเช่ารถ" or str(r.get("type", "")).lower() in ["income", "รายรับ"])
                    for r in existing_db.data
                )
                if has_db_income:
                    return False

            row = dict(f_item)
            sb.table("financial_records").insert(row).execute()
            print(f"[Financial] Inserted completion revenue for booking {bid}: ฿{net_p:,.2f}")
        except Exception as e:
            print(f"[Financial Error] Failed to insert completion revenue to financial_records: {e}")

    with store.lock:
        store.financial_records.insert(0, f_item)

    return True


def _update_car_mileage_on_return(car_id: Any, return_mileage: Any, dispatch_mileage: Any = None) -> float:
    """
    Validates and automatically updates vehicle mileage upon check-in completion.
    Ensures return mileage is not less than dispatch mileage.
    Updates store.cars[car_id]['mileage'] and syncs to database.
    """
    if not return_mileage:
        return 0.0
    try:
        clean_ret = float(str(return_mileage).replace(",", "").replace("km", "").strip())
    except (ValueError, TypeError):
        return 0.0

    if dispatch_mileage:
        try:
            clean_disp = float(str(dispatch_mileage).replace(",", "").replace("km", "").strip())
            if clean_disp > 0 and clean_ret < clean_disp:
                raise HTTPException(
                    status_code=400,
                    detail=f"⚠️ เลขไมล์ตอนรับคืน ({int(clean_ret):,} km) ต้องไม่น้อยกว่าเลขไมล์ตอนส่งมอบ ({int(clean_disp):,} km)"
                )
        except HTTPException:
            raise
        except Exception:
            pass

    c_key = str(car_id or "").strip()
    if c_key and c_key in store.cars:
        car_obj = store.cars[c_key]
        fmt_km = f"{int(clean_ret):,}" if clean_ret.is_integer() else f"{clean_ret:,.1f}"
        car_obj["mileage"] = fmt_km
        if "current_mileage" in car_obj:
            car_obj["current_mileage"] = fmt_km
        store.async_sync_car(c_key, car_obj)
    return clean_ret


def _resolve_cust_and_car(target: Dict[str, Any]) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """Resolve customer and vehicle dicts from in-memory store for a given booking record."""
    cust = store.customers.get(target.get("customer"))
    if not cust and target.get("customer"):
        target_cname = str(target.get("customer")).strip().lower()
        for k, v in store.customers.items():
            if str(k).strip().lower() == target_cname:
                cust = v
                break
    if not cust:
        cust = {
            "full_name": target.get("customer", "-"),
            "contact_no": target.get("customer_phone", "-"),
            "passport_id": target.get("customer_id_card", "-")
        }

    car = store.cars.get(target.get("car_id"))
    if not car and target.get("car_id"):
        target_plate = str(target.get("car_id")).strip().lower()
        for k, v in store.cars.items():
            if str(k).strip().lower() == target_plate:
                car = v
                break
    if not car:
        car = {
            "plate": target.get("car_id", "-"),
            "brand": target.get("car_brand", ""),
            "model": target.get("car_model", "")
        }
    return cust, car
