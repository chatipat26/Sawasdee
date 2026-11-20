"""
Customers API Router for SawasdeeRental.
"""

from typing import Dict, Any, Union
from fastapi import APIRouter, HTTPException

from db import store
from schemas import CustomerCreate

router = APIRouter(tags=["customers"])


@router.get("/api/customers")
def list_customers():
    if not store.initial_sync_done:
        store.sync_from_database(force=True)
    with store.lock:
        return [dict(c) for c in store.customers.values()]


@router.post("/api/customers")
def create_or_update_customer(payload: Union[CustomerCreate, Dict[str, Any]]):
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
    store.async_sync_customer(name, clean_payload)
    return {"success": True, "customer": clean_payload}


@router.delete("/api/customers/{name}")
def delete_customer(name: str):
    if name == "ลูกค้าทั่วไป (Walk-in)":
        raise HTTPException(status_code=400, detail="ไม่สามารถลบลูกค้ารายการเริ่มต้นของระบบได้")
    store.async_delete_customer(name)
    return {"success": True}
