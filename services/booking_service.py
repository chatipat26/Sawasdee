"""
Booking business flow guards, income recording, and entity resolution services for SawasdeeRental.
"""

import os
import re
from datetime import datetime, date
from typing import Any, Optional, Dict, Tuple
from fastapi import HTTPException

from db import store, get_db_client, to_date, format_date_dmy
from dependencies import INACTIVE_BOOKING_STATUSES, get_car_key, now_th


def is_pricing_v2_enabled() -> bool:
    """Return True only when PRICING_V2_ENABLED environment variable is explicitly set to true."""
    return str(os.getenv("PRICING_V2_ENABLED", "false")).strip().lower() in ("true", "1", "yes", "on")


def get_max_delivery_fee() -> float:
    """Return maximum allowed single delivery or pickup fee (default 10,000 THB per Q4)."""
    try:
        val = float(os.getenv("MAX_DELIVERY_FEE", "10000"))
        return val if val > 0 else 10000.0
    except Exception:
        return 10000.0


def _safe_float(val: Any, default: float = 0.0) -> float:
    if val is None or val == "" or val == "-":
        return default
    try:
        return float(str(val).replace(",", "").strip())
    except Exception:
        return default


def pricing_version_of(booking: Optional[Dict[str, Any]]) -> int:
    """Return pricing version of booking (1 = legacy deposit-as-credit, 2 = refundable security deposit)."""
    if not booking:
        return 1
    try:
        v = int(booking.get("pricing_version") or 1)
        return 2 if v >= 2 else 1
    except Exception:
        return 1


def compute_fees(booking: Optional[Dict[str, Any]]) -> float:
    """Return total off-site delivery + pickup fees for a booking."""
    if not booking:
        return 0.0
    del_mode = str(booking.get("delivery_mode") or "branch").strip().lower()
    pic_mode = str(booking.get("pickup_mode") or "branch").strip().lower()
    del_fee = 0.0 if del_mode == "branch" and "delivery_mode" in booking else max(0.0, _safe_float(booking.get("delivery_fee"), 0.0))
    pic_fee = 0.0 if pic_mode == "branch" and "pickup_mode" in booking else max(0.0, _safe_float(booking.get("pickup_fee"), 0.0))
    return round(del_fee + pic_fee, 2)


def compute_rental_amount(booking: Optional[Dict[str, Any]]) -> float:
    """Return pure rental service amount (net_price minus off-site delivery/pickup fees)."""
    if not booking:
        return 0.0
    net_val = _safe_float(booking.get("net_price"), 0.0)
    fees = compute_fees(booking)
    if net_val > 0 or booking.get("net_price") is not None:
        return round(max(0.0, net_val - fees), 2)
    base_val = _safe_float(booking.get("base_price"), 0.0)
    disc_val = _safe_float(booking.get("discount"), 0.0)
    return round(max(0.0, base_val - disc_val), 2)


def compute_remaining_rental(booking: Optional[Dict[str, Any]]) -> float:
    """
    Single source of truth for remaining rental balance across v1 (legacy) and v2 (refundable deposit).
    - If rental_paid or is_fully_paid is True -> 0.0
    - Version 2: Security deposit is NOT subtracted from net_price.
      If remaining_rental is already partially settled (< net_price and > 0), preserve it; otherwise net_price.
    - Version 1 (legacy): If deposit_paid -> max(0, net_price - deposit_amount), preserving partial top-ups.
    """
    if not booking:
        return 0.0
    if bool(booking.get("rental_paid") or booking.get("is_fully_paid")):
        return 0.0

    net_val = max(0.0, _safe_float(booking.get("net_price"), 0.0))
    ver = pricing_version_of(booking)
    raw_rem = booking.get("remaining_rental")
    has_rem = raw_rem is not None and raw_rem != ""
    cur_rem = _safe_float(raw_rem, net_val) if has_rem else net_val
    dep_paid = bool(booking.get("deposit_paid"))
    dep_waived = bool(booking.get("deposit_waived"))
    dep_val = 0.0 if dep_waived else _safe_float(booking.get("deposit_amount"), 5000.0)

    if ver >= 2:
        if has_rem and 0.0 < cur_rem < net_val:
            return round(cur_rem, 2)
        return round(net_val, 2)

    # Legacy v1 behavior (exact match with previous formula)
    if dep_paid:
        if not has_rem or (cur_rem >= net_val and net_val > 0):
            return round(max(0.0, net_val - dep_val), 2)
        return round(max(0.0, cur_rem), 2)
    return round(max(0.0, cur_rem if has_rem else net_val), 2)


def compute_total_due_at_booking(booking: Optional[Dict[str, Any]]) -> float:
    """Return total cash required on booking day (v2: net_price + security deposit; v1: net_price)."""
    if not booking:
        return 0.0
    net_val = max(0.0, _safe_float(booking.get("net_price"), 0.0))
    if pricing_version_of(booking) >= 2:
        dep_waived = bool(booking.get("deposit_waived"))
        dep_val = 0.0 if dep_waived else max(0.0, _safe_float(booking.get("deposit_amount"), 5000.0))
        return round(net_val + dep_val, 2)
    return round(net_val, 2)


def rental_cash_received(booking: Optional[Dict[str, Any]]) -> float:
    """
    Return amount to display in Contract PDF 'AMOUNT PAID'.
    - v2: Rental/service cash received (excludes security deposit which has its own Collected line).
    - v1: Legacy behavior (net_price when rental_paid, deposit_amount when only deposit_paid).
    """
    if not booking:
        return 0.0
    net_val = max(0.0, _safe_float(booking.get("net_price"), 0.0))
    rental_paid = bool(booking.get("rental_paid") or booking.get("is_fully_paid"))
    deposit_paid = bool(booking.get("deposit_paid"))
    dep_amount = max(0.0, _safe_float(booking.get("deposit_amount"), 0.0))

    if pricing_version_of(booking) >= 2:
        if rental_paid:
            return round(net_val, 2)
        rem = compute_remaining_rental(booking)
        paid_part = max(0.0, net_val - rem)
        return round(paid_part, 2)

    if rental_paid:
        return round(net_val, 2)
    if deposit_paid:
        return round(dep_amount, 2)
    return 0.0


def validate_and_normalize_delivery_fields(
    payload: Dict[str, Any],
    existing: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Validate delivery_mode, pickup_mode, delivery_fee, pickup_fee, zones, and map URLs.
    Forces fee = 0 when mode is 'branch', rejects negative fees or fees > MAX_DELIVERY_FEE (10,000 THB).
    """
    base = existing or {}
    max_fee = get_max_delivery_fee()

    raw_del_mode = payload.get("delivery_mode", base.get("delivery_mode", "branch"))
    raw_pic_mode = payload.get("pickup_mode", base.get("pickup_mode", "branch"))

    # If delivery_fee > 0 is explicitly sent without delivery_mode, infer 'offsite' unless 'branch' was explicitly passed
    if "delivery_mode" not in payload and "delivery_fee" in payload and _safe_float(payload.get("delivery_fee")) > 0:
        if str(base.get("delivery_mode") or "branch").lower() == "branch":
            raw_del_mode = "offsite"
    if "pickup_mode" not in payload and "pickup_fee" in payload and _safe_float(payload.get("pickup_fee")) > 0:
        if str(base.get("pickup_mode") or "branch").lower() == "branch":
            raw_pic_mode = "offsite"

    del_mode = str(raw_del_mode or "branch").strip().lower()
    pic_mode = str(raw_pic_mode or "branch").strip().lower()
    if del_mode not in ("branch", "offsite"):
        raise HTTPException(status_code=400, detail="รูปแบบการส่งรถ (delivery_mode) ต้องเป็น 'branch' หรือ 'offsite'")
    if pic_mode not in ("branch", "offsite"):
        raise HTTPException(status_code=400, detail="รูปแบบการรับรถคืน (pickup_mode) ต้องเป็น 'branch' หรือ 'offsite'")

    raw_del_fee = payload.get("delivery_fee", base.get("delivery_fee", 0.0))
    raw_pic_fee = payload.get("pickup_fee", base.get("pickup_fee", 0.0))
    try:
        del_fee = float(raw_del_fee or 0.0)
        pic_fee = float(raw_pic_fee or 0.0)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="ค่ารับ-ส่งรถต้องเป็นตัวเลขที่ถูกต้อง")

    if del_fee < 0 or pic_fee < 0:
        raise HTTPException(status_code=400, detail="ค่ารับ-ส่งรถต้องไม่ติดลบ")
    if del_fee > max_fee or pic_fee > max_fee:
        raise HTTPException(
            status_code=400,
            detail=f"ค่ารับ-ส่งรถต่อเที่ยวต้องไม่เกิน ฿{max_fee:,.0f} (ป้องกันการกรอกตัวเลขผิดพลาด)"
        )

    if del_mode == "branch":
        del_fee = 0.0
    if pic_mode == "branch":
        pic_fee = 0.0

    loc_del = str(payload.get("loc_delivery", base.get("loc_delivery", "Sukhumvit")) or "Sukhumvit").strip()
    loc_ret = str(payload.get("loc_return", base.get("loc_return", loc_del)) or loc_del).strip()

    return {
        "delivery_mode": del_mode,
        "pickup_mode": pic_mode,
        "delivery_fee": round(del_fee, 2),
        "pickup_fee": round(pic_fee, 2),
        "delivery_zone": str(payload.get("delivery_zone", base.get("delivery_zone") or "") or "").strip() or None,
        "pickup_zone": str(payload.get("pickup_zone", base.get("pickup_zone") or "") or "").strip() or None,
        "delivery_map_url": str(payload.get("delivery_map_url", base.get("delivery_map_url") or "") or "").strip() or None,
        "pickup_map_url": str(payload.get("pickup_map_url", base.get("pickup_map_url") or "") or "").strip() or None,
        "loc_delivery": loc_del,
        "loc_return": loc_ret,
    }


def resolve_staff_display_name(user_claims: Optional[Dict[str, Any]]) -> str:
    """Resolve human-readable staff name from auth token claims and store.users."""
    if not user_claims:
        return "admin"
    uname = str(user_claims.get("username") or "").strip()
    user_rec = store.users.get(uname)
    if user_rec is None and uname:
        for k, v in store.users.items():
            if str(k).strip().lower() == uname.lower():
                user_rec = v
                break
    if isinstance(user_rec, dict) and user_rec.get("name"):
        return str(user_rec.get("name")).strip()
    if user_claims.get("name"):
        return str(user_claims.get("name")).strip()
    return uname or "admin"


def adjust_booking_delivery_fees(
    target: Dict[str, Any],
    payload: Dict[str, Any],
    user_claims: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Adjust delivery/pickup mode, location, and fees on an existing booking (D5 & Q3).
    - Forbidden when booking status is 'เสร็จสิ้น' or 'ยกเลิก'.
    - Recalculates net_price and remaining_rental automatically.
    - If rental was already paid and delta > 0: re-opens remaining_rental = delta, rental_paid = False.
    - If rental was already paid and delta < 0: requires Admin role, logs refund expense 'คืนค่ารับ-ส่ง' to ledger.
    - Appends 'fee_adjustment' audit record to extension_history.
    """
    status = str(target.get("status") or "").strip()
    if status in INACTIVE_BOOKING_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"ไม่สามารถแก้ไขค่ารับ-ส่งรถได้ เนื่องจากรายการจองอยู่ในสถานะ '{status}'"
        )

    old_del_fee = _safe_float(target.get("delivery_fee"), 0.0)
    old_pic_fee = _safe_float(target.get("pickup_fee"), 0.0)
    old_fees = round(old_del_fee + old_pic_fee, 2)

    norm = validate_and_normalize_delivery_fields(payload, existing=target)
    new_del_fee = norm["delivery_fee"]
    new_pic_fee = norm["pickup_fee"]
    new_fees = round(new_del_fee + new_pic_fee, 2)
    delta = round(new_fees - old_fees, 2)

    was_rental_paid = bool(target.get("rental_paid") or target.get("is_fully_paid"))
    fees_paid_amt = _safe_float(target.get("fees_paid_amount"), 0.0)

    # Q3: Decreasing fee after payment requires Admin role
    if delta < 0 and (was_rental_paid or new_fees < fees_paid_amt):
        uname = str((user_claims or {}).get("username") or "").strip().lower()
        role = str((user_claims or {}).get("role") or "").strip()
        user_rec = store.users.get((user_claims or {}).get("username", ""))
        if isinstance(user_rec, dict) and user_rec.get("role"):
            role = str(user_rec.get("role")).strip()
        if role != "Admin" and uname != "admin":
            raise HTTPException(
                status_code=403,
                detail="เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่สามารถลดค่ารับ-ส่งรถหลังจากรับชำระเงินแล้วได้"
            )

    # Apply normalized delivery/pickup fields
    for k, v in norm.items():
        target[k] = v

    old_net = _safe_float(target.get("net_price"), 0.0)
    new_net = round(max(0.0, old_net + delta), 2)
    target["net_price"] = new_net

    refund_logged = 0.0
    th_now = now_th()
    today_str = th_now.date().isoformat()
    staff_name = resolve_staff_display_name(user_claims)

    if was_rental_paid:
        if delta > 0:
            target["rental_paid"] = False
            target["is_fully_paid"] = False
            target["remaining_rental"] = round(delta, 2)
        elif delta < 0:
            refund_logged = round(abs(delta), 2)
            target["remaining_rental"] = 0.0
            if fees_paid_amt > new_fees:
                target["fees_paid_amount"] = new_fees
            car_id = target.get("car_id")
            car_comp = (store.cars.get(car_id) or {}).get("company", "Sawasdee Rent A Car")
            bk_id = target.get("booking_id", "")
            detail_txt = (
                f"คืนเงินส่วนต่างค่ารับ-ส่งรถ {bk_id} ({car_id}) "
                f"จาก ฿{old_fees:,.2f} เป็น ฿{new_fees:,.2f} โดย {staff_name}"
            )
            store.sync_financial({
                "date": th_now.strftime("%Y-%m-%d %H:%M:%S"),
                "type": "รายจ่าย",
                "category": "คืนค่ารับ-ส่ง",
                "amount": refund_logged,
                "ref_id": bk_id,
                "ref": bk_id,
                "description": detail_txt,
                "detail": detail_txt,
                "company": car_comp,
            })
    else:
        cur_rem = _safe_float(target.get("remaining_rental"), old_net)
        if target.get("remaining_rental") is not None and 0.0 < cur_rem < old_net:
            target["remaining_rental"] = round(max(0.0, cur_rem + delta), 2)
        else:
            target["remaining_rental"] = None
            target["remaining_rental"] = compute_remaining_rental(target)

    # Append audit entry to extension_history
    ext_list = list(target.get("extension_history") or [])
    ext_list.append({
        "type": "fee_adjustment",
        "old_delivery_fee": old_del_fee,
        "old_pickup_fee": old_pic_fee,
        "new_delivery_fee": new_del_fee,
        "new_pickup_fee": new_pic_fee,
        "delta": delta,
        "refund_logged": refund_logged,
        "adjusted_by": staff_name,
        "adjusted_at": th_now.isoformat(),
        "date": today_str,
    })
    target["extension_history"] = ext_list
    store.async_sync_booking(target)

    return {
        "delta": delta,
        "old_fees": old_fees,
        "new_fees": new_fees,
        "net_price": target["net_price"],
        "remaining_rental": target["remaining_rental"],
        "rental_paid": target.get("rental_paid", False),
        "refund_logged": refund_logged,
    }


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

    fees_amt = compute_fees(target_bk)
    rent_only_amt = round(max(0.0, net_p - fees_amt), 2) if pricing_version_of(target_bk) >= 2 and fees_amt > 0 else round(net_p, 2)

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
        "amount": rent_only_amt,
        "ref": bid,
        "date": c_date,
        "description": desc_str,
        "detail": desc_str
    }

    f_fee_item = None
    if pricing_version_of(target_bk) >= 2 and fees_amt > 0:
        fee_desc = f"รายได้ค่ารับ-ส่งรถนอกสถานที่ รหัสการจอง [{bid}] - ทะเบียน [{plate}]"
        f_fee_item = {
            "company": comp,
            "type": "income",
            "category": "ค่ารับ-ส่งรถ",
            "amount": round(fees_amt, 2),
            "ref": bid,
            "date": c_date,
            "description": fee_desc,
            "detail": fee_desc
        }

    # Direct DB execution with transaction/error handling
    sb = get_db_client()
    if sb:
        try:
            existing_db = sb.table("financial_records").select("id, category, type").eq("ref", bid).execute()
            if existing_db and existing_db.data and len(existing_db.data) > 0:
                has_db_income = any(
                    (str(r.get("category", "")) in ("ค่าเช่ารถ", "ค่ารับ-ส่งรถ") or str(r.get("type", "")).lower() in ["income", "รายรับ"])
                    for r in existing_db.data
                )
                if has_db_income:
                    return False

            row = dict(f_item)
            sb.table("financial_records").insert(row).execute()
            if f_fee_item:
                sb.table("financial_records").insert(dict(f_fee_item)).execute()
            print(f"[Financial] Inserted completion revenue for booking {bid}: ฿{net_p:,.2f}")
        except Exception as e:
            print(f"[Financial Error] Failed to insert completion revenue to financial_records: {e}")

    with store.lock:
        if f_fee_item:
            store.financial_records.insert(0, f_fee_item)
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
