"""
Customers API Router for SawasdeeRental.
"""

from typing import Dict, Any, List, Union
from fastapi import APIRouter, Depends, HTTPException

from db import store
from dependencies import require_auth
from schemas import CustomerCreate

router = APIRouter(tags=["customers"])


def _normalize_crm_tier(raw_tier: Any) -> str:
    val = str(raw_tier or "ทั่วไป").strip().lower()
    if val == "vip":
        return "VIP"
    if val in ("blacklist", "บัญชีดำ", "blocked", "watchlist"):
        return "Blacklist"
    return "ทั่วไป"


def _enrich_customer_with_crm_stats(
    c_dict: Dict[str, Any],
    bookings_list: List[Dict[str, Any]],
    completed_list: List[Dict[str, Any]],
) -> Dict[str, Any]:
    tier = _normalize_crm_tier(c_dict.get("crm_tier") or c_dict.get("customer_tier"))
    note = str(c_dict.get("watchlist_note") or c_dict.get("blacklist_reason") or c_dict.get("notes") or "").strip()
    c_dict["crm_tier"] = tier
    c_dict["customer_tier"] = tier
    c_dict["watchlist_note"] = note
    c_dict["blacklist_reason"] = note

    c_name = str(c_dict.get("full_name") or "").strip().lower()
    seen_bids = set()
    total_rentals = 0
    total_spent = 0.0
    damage_count = 0

    for src in (bookings_list or [], completed_list or []):
        for b in src:
            if str(b.get("customer") or "").strip().lower() != c_name or not c_name:
                continue
            bid = str(b.get("booking_id") or "")
            if bid and bid in seen_bids:
                continue
            if bid:
                seen_bids.add(bid)
            if str(b.get("status") or "").strip() == "ยกเลิก":
                continue
            total_rentals += 1
            total_spent += float(b.get("net_price") or 0.0)
            has_damage = (
                float(b.get("repair_cost") or 0.0) > 0
                or float(b.get("pending_damage_cost") or 0.0) > 0
                or bool(b.get("needs_repair"))
                or float(b.get("late_fee") or 0.0) > 0
            )
            if has_damage:
                damage_count += 1

    c_dict["total_rentals"] = total_rentals
    c_dict["total_spent"] = round(total_spent, 2)
    c_dict["damage_count"] = damage_count
    return c_dict


@router.get("/api/customers")
def list_customers():
    if not store.initial_sync_done:
        store.sync_from_database(force=True)
    with store.lock:
        cust_snap = [dict(c) for c in store.customers.values()]
        bookings_snap = [dict(b) for b in store.bookings]
        completed_snap = [dict(cj) for cj in store.completed_jobs]
    return [_enrich_customer_with_crm_stats(c, bookings_snap, completed_snap) for c in cust_snap]


@router.post("/api/customers")
def create_or_update_customer(payload: Union[CustomerCreate, Dict[str, Any]], _user: Dict[str, Any] = Depends(require_auth)):
    if hasattr(payload, "model_dump"):
        payload = payload.model_dump(exclude_unset=False)
    elif hasattr(payload, "dict"):
        payload = payload.dict()
    else:
        payload = dict(payload)
    name = str(payload.get("full_name", "")).strip()
    if not name:
        raise HTTPException(status_code=400, detail="กรุณาระบุชื่อ-นามสกุลลูกค้า")

    original_name = str(payload.get("original_name") or "").strip()
    is_new = not bool(original_name)

    # 0. Block duplicate customer name if adding new customer
    if is_new and name in store.customers:
        raise HTTPException(
            status_code=400,
            detail=f"มีลูกค้ารายชื่อ '{name}' ในระบบแล้ว หากต้องการแก้ไขข้อมูล กรุณากดปุ่ม [✏️ ดู/แก้ไข]"
        )

    # 1. Block duplicate Phone Number (Contact No.)
    contact_no = str(payload.get("phone_number") or payload.get("contact_no") or payload.get("phone") or "").strip()
    if contact_no and contact_no not in ["-", "none", "None", ""]:
        clean_phone = "".join(ch for ch in contact_no if ch.isdigit())
        if len(clean_phone) >= 9:
            norm_phone = "0" + clean_phone[2:] if clean_phone.startswith("66") else clean_phone
            for c_name, c_obj in store.customers.items():
                if original_name and c_name.strip() == original_name:
                    continue  # editing existing customer is allowed
                existing_phone = str(c_obj.get("phone_number") or c_obj.get("contact_no") or c_obj.get("phone") or "").strip()
                if existing_phone and existing_phone not in ["-", "none", "None", ""]:
                    clean_exist_phone = "".join(ch for ch in existing_phone if ch.isdigit())
                    norm_exist = "0" + clean_exist_phone[2:] if clean_exist_phone.startswith("66") else clean_exist_phone
                    if norm_exist == norm_phone:
                        raise HTTPException(
                            status_code=400,
                            detail=f"เบอร์โทรศัพท์ '{contact_no}' ซ้ำกับข้อมูลของลูกค้า '{c_name}' ในระบบแล้ว"
                        )

    # 2. Block duplicate Citizen ID / Passport No.
    passport_id = str(payload.get("id_card_no") or payload.get("passport_id") or payload.get("id_card") or "").strip()
    if passport_id and passport_id not in ["-", "none", "None", ""]:
        clean_pass = passport_id.replace(" ", "").replace("-", "").lower()
        for c_name, c_obj in store.customers.items():
            if original_name and c_name.strip() == original_name:
                continue  # editing existing customer is allowed
            existing_pass = str(c_obj.get("id_card_no") or c_obj.get("passport_id") or c_obj.get("id_card") or "").strip()
            if existing_pass and existing_pass not in ["-", "none", "None", ""]:
                clean_exist = existing_pass.replace(" ", "").replace("-", "").lower()
                if clean_exist == clean_pass:
                    raise HTTPException(
                        status_code=400,
                        detail=f"หมายเลขบัตร ปชช. / Passport '{passport_id}' ซ้ำกับข้อมูลของลูกค้า '{c_name}' ในระบบแล้ว"
                    )

    # If renamed customer, delete the old customer record first
    if original_name and original_name != name and original_name in store.customers:
        store.async_delete_customer(original_name)

    clean_payload = dict(payload)
    clean_payload.pop("original_name", None)
    clean_payload["full_name"] = name
    for _k, _default in (("phone_number", "-"), ("id_card_no", "-"), ("driver_license_no", "-"),
                         ("nationality", "THAI"), ("whatsapp", "-"), ("dob", "-"),
                         ("license_expire_date", "-"), ("home_address", "-"), ("current_address", "-"),
                         ("email", "-"), ("line_user_id", "-"), ("line_id", "-")):
        if clean_payload.get(_k) is None or str(clean_payload.get(_k)).strip() == "":
            clean_payload[_k] = _default

    norm_tier = _normalize_crm_tier(clean_payload.get("crm_tier") or clean_payload.get("customer_tier"))
    clean_note = str(clean_payload.get("watchlist_note") or clean_payload.get("blacklist_reason") or clean_payload.get("notes") or "").strip()
    clean_payload["crm_tier"] = norm_tier
    clean_payload["customer_tier"] = norm_tier
    clean_payload["watchlist_note"] = clean_note
    clean_payload["blacklist_reason"] = clean_note
    clean_payload["notes"] = clean_note

    store.async_sync_customer(name, clean_payload)
    with store.lock:
        bookings_snap = [dict(b) for b in store.bookings]
        completed_snap = [dict(cj) for cj in store.completed_jobs]
    enriched = _enrich_customer_with_crm_stats(dict(clean_payload), bookings_snap, completed_snap)
    return {"success": True, "customer": enriched}


@router.delete("/api/customers/{name}")
def delete_customer(name: str, _user: Dict[str, Any] = Depends(require_auth)):
    if name == "ลูกค้าทั่วไป (Walk-in)":
        raise HTTPException(status_code=400, detail="ไม่สามารถลบลูกค้ารายการเริ่มต้นของระบบได้")
    store.async_delete_customer(name)
    return {"success": True}
