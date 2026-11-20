"""
Fleet Maintenance & Work Orders API Router for SawasdeeRental.
"""

import io
import urllib.parse
from datetime import date
from typing import Optional, Dict, Any
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

import pdf_engine
from db import store
from dependencies import now_th
from services.maintenance_service import execute_hard_delete_work_order_db

router = APIRouter(tags=["maintenance"])


@router.post("/api/work-orders")
@router.post("/api/work-order-logs")
def create_work_order(payload: Dict[str, Any]):
    """Insert a new record into work_order_logs decoupled from booking logic."""
    bk_id = str(payload.get("booking_id") or "").strip() or None
    car_id = str(payload.get("car_id") or "").strip() or None
    if not car_id and bk_id:
        target = next((b for b in store.bookings if b.get("booking_id") == bk_id), None)
        if target:
            car_id = target.get("car_id")

    work_type = str(payload.get("work_type") or "Dispatch").strip()
    staff_id = str(payload.get("staff_id") or payload.get("worker") or "admin").strip()
    location = str(payload.get("location") or "").strip() or None
    appt_dt = payload.get("appointment_datetime")
    if not appt_dt:
        d = payload.get("date") or payload.get("start_date") or payload.get("end_date")
        t = payload.get("time") or "10:00"
        if d:
            appt_dt = f"{d} {t}:00" if len(str(t)) <= 5 else f"{d} {t}"

    desc = str(payload.get("description") or "").strip()
    if not desc:
        desc = f"ใบงาน{'ส่งมอบรถยนต์ (Dispatch)' if work_type == 'Dispatch' else 'รับรถคืน (Return)'} พนักงาน: {staff_id} สถานที่: {location or '-'}"

    cost = float(payload.get("cost") or 0.0)
    job_status = str(payload.get("job_status") or "Pending").strip()

    log_entry = store.log_work_order(
        car_id=car_id,
        booking_id=bk_id,
        work_type=work_type,
        description=desc,
        cost=cost,
        staff_id=staff_id,
        appointment_datetime=appt_dt,
        location=location,
        job_status=job_status
    )
    return {"success": True, "message": "สร้างใบงานสำเร็จ", "work_order": log_entry}


@router.get("/api/work-order-logs")
def list_work_order_logs(car_id: Optional[str] = None, booking_id: Optional[str] = None, limit: int = 100):
    logs = list(store.work_order_logs)
    if car_id:
        logs = [l for l in logs if l.get("car_id") == car_id]
    if booking_id:
        logs = [l for l in logs if l.get("booking_id") == booking_id]
    return logs[:limit]


@router.get("/api/maintenance/last-cost")
def get_last_maintenance_cost(car_id: str, type: Optional[str] = None):
    """
    Returns the latest historical cost or preset document cost for a car and order type.
    """
    clean_car = str(car_id or "").strip()
    clean_type = str(type or "").strip()
    clean_type_lower = clean_type.lower()

    if not clean_car:
        return {"success": False, "cost": 0.0, "message": "car_id required"}

    # 1. Check existing maintenance_records (newest first)
    try:
        records = sorted(
            store.maintenance_records,
            key=lambda r: str(r.get("schedule_date") or r.get("id") or ""),
            reverse=True
        )
        for m in records:
            if str(m.get("car_id", "")).strip() == clean_car:
                m_type = str(m.get("order_type") or "")
                m_type_lower = m_type.lower()
                if not clean_type or clean_type_lower in m_type_lower or m_type_lower in clean_type_lower:
                    cost = float(m.get("actual_cost") or m.get("cost") or 0.0)
                    if cost > 0:
                        return {
                            "success": True,
                            "car_id": clean_car,
                            "order_type": clean_type or m_type,
                            "cost": cost,
                            "source": "maintenance_record",
                            "record_id": m.get("id")
                        }
    except Exception:
        pass

    # 2. Check vehicle_maintenances (newest first)
    try:
        vh_maintenances = sorted(
            store.get_vehicle_maintenances(clean_car),
            key=lambda vm: str(vm.get("date") or vm.get("id") or ""),
            reverse=True
        )
        for vm in vh_maintenances:
            desc = str(vm.get("description") or vm.get("type") or "")
            desc_lower = desc.lower()
            if not clean_type or clean_type_lower in desc_lower or desc_lower in clean_type_lower:
                cost = float(vm.get("cost") or 0.0)
                if cost > 0:
                    return {
                        "success": True,
                        "car_id": clean_car,
                        "order_type": clean_type or desc,
                        "cost": cost,
                        "source": "vehicle_maintenance"
                    }
    except Exception:
        pass

    # 3. Check car document presets (tax, act/prb, insurance)
    car = store.cars.get(clean_car, {})
    if car and clean_type:
        t_low = clean_type_lower
        tax_cost = float(car.get("tax_price") or 1500.0)
        prb_cost = float(car.get("prb_price") or car.get("act_price") or 645.21)
        ins_cost = float(car.get("insurance_premium") or car.get("ins_premium") or 12000.0)

        if "ภาษี" in t_low and ("พ.ร.บ." in t_low or "พรบ" in t_low) and "ประกัน" in t_low:
            return {"success": True, "car_id": clean_car, "order_type": clean_type, "cost": round(tax_cost + prb_cost + ins_cost, 2), "source": "car_preset"}
        elif "ภาษี" in t_low and ("พ.ร.บ." in t_low or "พรบ" in t_low):
            return {"success": True, "car_id": clean_car, "order_type": clean_type, "cost": round(tax_cost + prb_cost, 2), "source": "car_preset"}
        elif "ภาษี" in t_low:
            return {"success": True, "car_id": clean_car, "order_type": clean_type, "cost": round(tax_cost, 2), "source": "car_preset"}
        elif "พ.ร.บ." in t_low or "พรบ" in t_low:
            return {"success": True, "car_id": clean_car, "order_type": clean_type, "cost": round(prb_cost, 2), "source": "car_preset"}
        elif "ประกัน" in t_low:
            return {"success": True, "car_id": clean_car, "order_type": clean_type, "cost": round(ins_cost, 2), "source": "car_preset"}

    return {"success": True, "car_id": clean_car, "order_type": clean_type, "cost": 0.0, "source": "none"}


@router.get("/api/maintenance")
def list_maintenance(
    car_id: Optional[str] = None,
    status: Optional[str] = None,
    order_type: Optional[str] = None,
    search: Optional[str] = None
):
    records = list(store.maintenance_records)
    if car_id and car_id != "ทั้งหมด":
        records = [r for r in records if r.get("car_id") == car_id]
    if status and status != "ทั้งหมด":
        records = [r for r in records if r.get("status") == status]
    if order_type and order_type != "ทั้งหมด":
        records = [r for r in records if order_type in str(r.get("order_type", ""))]
    if search:
        kw = search.lower().strip()
        records = [
            r for r in records
            if kw in str(r.get("id", "")).lower()
            or kw in str(r.get("car_id", "")).lower()
            or kw in str(r.get("car_brand", "")).lower()
            or kw in str(r.get("car_model", "")).lower()
            or kw in str(r.get("service_center", "")).lower()
            or kw in str(r.get("service_items", "")).lower()
            or kw in str(r.get("assigned_worker", "")).lower()
        ]
    return records


@router.post("/api/maintenance")
def create_maintenance(payload: Dict[str, Any]):
    car_id = str(payload.get("car_id", "")).strip()
    if not car_id:
        raise HTTPException(status_code=400, detail="กรุณาระบุทะเบียนรถ")

    car = store.cars.get(car_id, {})
    now_str = now_th().strftime("%y%m%d%H%M%S")
    mnt_id = f"MNT{now_str}"

    cost_val = 0.0
    try:
        cost_val = float(payload.get("cost", 0) or 0)
    except Exception:
        pass

    sched_d = payload.get("schedule_date") or date.today().strftime("%Y-%m-%d")
    sched_t = payload.get("schedule_time") or "09:00"
    exp_d = payload.get("expected_finish_date") or sched_d
    exp_t = payload.get("expected_finish_time") or "17:00"

    order_type = payload.get("order_type") or "ซ่อมบำรุงทั่วไป / เช็คระยะ"
    service_items = payload.get("service_items") or "-"
    service_center = payload.get("service_center") or "-"
    service_center_phone = payload.get("service_center_phone") or "-"
    service_location = payload.get("service_location") or "-"
    assigned_worker = payload.get("assigned_worker") or "admin"
    current_mileage = payload.get("current_mileage") or car.get("mileage", "-")
    notes = payload.get("notes") or ""
    update_car_status = bool(payload.get("update_car_status", True))
    created_by = payload.get("created_by") or "admin"

    is_renewal = any(k in order_type for k in ["ต่อทะเบียน", "พ.ร.บ.", "พรบ", "ประกัน", "ภาษี"])
    init_status = "กำลังต่อภาษี/ประกัน" if is_renewal else ("กำลังซ่อมบำรุง" if update_car_status else "รอดำเนินการ")

    record = {
        "id": mnt_id,
        "car_id": car_id,
        "car_brand": car.get("brand", payload.get("car_brand", "")),
        "car_model": car.get("model", payload.get("car_model", "")),
        "car_color": car.get("color", payload.get("car_color", "")),
        "order_type": order_type,
        "service_items": service_items,
        "cost": cost_val,
        "actual_cost": 0.0,
        "service_center": service_center,
        "service_center_phone": service_center_phone,
        "service_location": service_location,
        "assigned_worker": assigned_worker,
        "schedule_date": sched_d,
        "schedule_time": sched_t,
        "expected_finish_date": exp_d,
        "expected_finish_time": exp_t,
        "status": init_status,
        "current_mileage": current_mileage,
        "notes": notes,
        "completion_notes": "",
        "update_car_status": update_car_status,
        "created_by": created_by,
        "created_at": now_th().strftime("%Y-%m-%d %H:%M:%S"),
        "completed_at": None
    }

    if update_car_status and car_id in store.cars:
        store.cars[car_id]["status"] = "ต่อทะเบียน/ประกัน" if is_renewal else "ซ่อมบำรุง"
        store.async_sync_car(car_id, store.cars[car_id])

    store.async_sync_maintenance(record)

    # Notify via LINE disabled per system rule: Only 1st & 16th expiry alerts are sent
    # try:
    #     notify_line_maintenance(record)
    # except Exception as e:
    #     pass

    # Log to universal work_order_logs
    try:
        w_type = "Renew Tax" if is_renewal else "Maintenance"
        store.log_work_order(
            car_id=car_id,
            booking_id=mnt_id,
            work_type=w_type,
            description=f"[{mnt_id}] {order_type}: {service_items}. สถานที่/อู่: {service_center}. เลขไมล์: {current_mileage}",
            cost=cost_val,
            staff_id=assigned_worker
        )
    except Exception as e:
        print(f"Error logging work order for maintenance: {e}")

    return {"success": True, "maintenance": record}


@router.get("/api/maintenance/{mnt_id}")
def get_maintenance(mnt_id: str):
    target = next((m for m in store.maintenance_records if m.get("id") == mnt_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="ไม่พบข้อมูลใบงานซ่อมบำรุง")
    return target


@router.put("/api/maintenance/{mnt_id}")
def update_maintenance(mnt_id: str, payload: Dict[str, Any]):
    target = next((m for m in store.maintenance_records if m.get("id") == mnt_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="ไม่พบข้อมูลใบงานซ่อมบำรุง")

    for k, v in payload.items():
        if k not in ["id", "created_at"]:
            target[k] = v

    store.async_sync_maintenance(target)
    return {"success": True, "maintenance": target}


@router.post("/api/maintenance/{mnt_id}/close")
def close_maintenance(mnt_id: str, payload: Dict[str, Any]):
    actual_cost = payload.get("actual_cost")
    notes = payload.get("completion_notes", "")
    new_mileage = payload.get("mileage")
    recorded_by = payload.get("recorded_by", "admin")
    new_act_expiry = payload.get("new_act_expiry")
    new_ins_expiry = payload.get("new_ins_expiry")
    new_tax_expiry = payload.get("new_tax_expiry")
    insurance_company = payload.get("insurance_company")
    policy_no = payload.get("policy_no")

    closed = store.close_maintenance_record(
        mnt_id,
        actual_cost=actual_cost,
        completion_notes=notes,
        new_mileage=new_mileage,
        recorded_by=recorded_by,
        new_act_expiry=new_act_expiry,
        new_ins_expiry=new_ins_expiry,
        new_tax_expiry=new_tax_expiry,
        insurance_company=insurance_company,
        policy_no=policy_no
    )
    if not closed:
        raise HTTPException(status_code=404, detail="ไม่พบใบงานซ่อมบำรุงที่ต้องการปิดงาน")

    # Notify via LINE disabled per system rule: Only 1st & 16th expiry alerts are sent
    # try:
    #     notify_line_close_maintenance(closed, store.cars.get(closed.get("car_id")))
    # except Exception as e:
    #     pass

    # Log to universal work_order_logs
    try:
        rec = closed or {}
        is_renewal = any(k in str(rec.get("order_type", "")) for k in ["ต่อทะเบียน", "พ.ร.บ.", "พรบ", "ประกัน", "ภาษี"])
        w_type = "Renew Tax" if is_renewal else "Maintenance"
        store.log_work_order(
            car_id=rec.get("car_id", ""),
            booking_id=None,
            work_type=w_type,
            description=f"ปิดงาน {rec.get('order_type')}: {notes}. เลขไมล์เสร็จ: {new_mileage or '-'}",
            cost=float(actual_cost or rec.get("cost", 0) or 0),
            staff_id=rec.get("assigned_worker", "admin")
        )
    except Exception as e:
        print(f"Error logging close maintenance work order: {e}")

    return {"success": True, "maintenance": closed, "car": store.cars.get(closed.get("car_id"))}


@router.delete("/api/maintenance/{mnt_id}")
@router.delete("/api/work-orders/{mnt_id}")
@router.delete("/api/work-order-logs/{mnt_id}")
def delete_maintenance_or_work_order(mnt_id: str):
    """TARGET MISSION 1 & 2: Hard delete from work_order_logs and revert car status in 1 transaction."""
    clean_id = urllib.parse.unquote(mnt_id).strip()
    car_id = store.hard_delete_work_order(clean_id)
    execute_hard_delete_work_order_db(clean_id, car_id)
    return {
        "success": True,
        "message": f"ลบใบงาน {clean_id} ออกจากระบบถาวรและคืนสถานะรถเรียบร้อย",
        "car_id": car_id,
        "id": clean_id
    }


@router.get("/api/pdf/maintenance/{mnt_id}")
def get_maintenance_pdf(mnt_id: str):
    target = next((m for m in store.maintenance_records if m.get("id") == mnt_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="ไม่พบข้อมูลใบงานซ่อมบำรุง")

    car = store.cars.get(target.get("car_id"), {})
    pdf_bytes = pdf_engine.generate_maintenance_job_pdf(target, car)
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f"inline; filename=WorkOrder_{mnt_id}.pdf"}
    )
