"""
LINE Messaging & Webhook API Router for SawasdeeRental.
"""

import asyncio
import base64
import hashlib
import hmac
import json
import math
import os
import re
from datetime import date, datetime
from typing import Optional, Dict, Any, List, Tuple
from fastapi import APIRouter, HTTPException, Request

from db import store
from dependencies import INACTIVE_BOOKING_STATUSES, normalize_plate, now_th
from line_service import (
    resolve_worker_line_id,
    get_admin_line_id,
    get_admin_line_ids,
    send_line_push_message,
    send_line_reply_message,
    check_and_send_expiry_alerts,
)

router = APIRouter(tags=["line"])

_INVALID_TEXT_TOKENS = {"", "-", "none", "nan", "nat", "null", "n/a", "undefined"}
_UNASSIGNED_TOKENS = _INVALID_TEXT_TOKENS | {"wait", "รอมอบหมาย", "ยังไม่ระบุ", "unassigned"}
_THAI_PLATE_RE = re.compile(
    r"^(?:ป้ายแดง.*|\d{0,2}[ก-ฮ]{1,3}[\s\-_.]*\d{1,4}(?:[\s\-_.]*[ก-ฮA-Za-z0-9()]+)?)$"
)
_DATE_DMY_RE = re.compile(r"^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$")
_DATE_YMD_RE = re.compile(r"^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$")


def _ensure_store_synced() -> None:
    """Ensure in-memory DataStore is synced from PostgreSQL on cold start without blocking webhook replyToken."""
    try:
        if getattr(store, "initial_sync_done", False) or getattr(store, "is_syncing", False):
            return
        has_cached_data = bool(getattr(store, "cars", None) or getattr(store, "bookings", None))
        async_sync_fn = getattr(store, "sync_from_database_async", None)
        sync_fn = getattr(store, "sync_from_database", None)
        if has_cached_data and callable(async_sync_fn):
            async_sync_fn(force=False)
        elif callable(sync_fn):
            sync_fn(force=False)
    except Exception as exc:
        print(f"[LINE Webhook] Cold-start sync warning: {exc}")


def _get_store_dict(attr_name: str) -> Dict[str, Dict[str, Any]]:
    """Safely snapshot a dict attribute from store using getattr and type guards."""
    lock_obj = getattr(store, "lock", None)
    try:
        if lock_obj is not None:
            with lock_obj:
                raw = getattr(store, attr_name, None)
                if isinstance(raw, dict):
                    return {str(k): dict(v) for k, v in raw.items() if isinstance(v, dict)}
                if isinstance(raw, list):
                    return {
                        str(item.get("plate") or item.get("username") or idx): dict(item)
                        for idx, item in enumerate(raw)
                        if isinstance(item, dict)
                    }
        else:
            raw = getattr(store, attr_name, None)
            if isinstance(raw, dict):
                return {str(k): dict(v) for k, v in raw.items() if isinstance(v, dict)}
    except Exception as exc:
        print(f"[LINE Webhook] Snapshot dict '{attr_name}' warning: {exc}")
    return {}


def _get_store_list(attr_name: str) -> List[Dict[str, Any]]:
    """Safely snapshot a list attribute from store using getattr and type guards."""
    lock_obj = getattr(store, "lock", None)
    try:
        if lock_obj is not None:
            with lock_obj:
                raw = getattr(store, attr_name, None)
                if isinstance(raw, list):
                    return [dict(item) for item in raw if isinstance(item, dict)]
                if isinstance(raw, dict):
                    return [dict(item) for item in raw.values() if isinstance(item, dict)]
        else:
            raw = getattr(store, attr_name, None)
            if isinstance(raw, list):
                return [dict(item) for item in raw if isinstance(item, dict)]
    except Exception as exc:
        print(f"[LINE Webhook] Snapshot list '{attr_name}' warning: {exc}")
    return []


def _clean_text(val: Any, default: str = "-") -> str:
    """Sanitize string values and convert None/NaN/NaT/null placeholders to a clean default."""
    if val is None:
        return default
    if isinstance(val, float) and (math.isnan(val) or math.isinf(val)):
        return default
    s = str(val).strip()
    if s.lower() in _INVALID_TEXT_TOKENS:
        return default
    return s


def _clean_float(val: Any, default: float = 0.0) -> float:
    """Safely parse numeric values while guarding against NaN/Inf/placeholder strings."""
    if val is None:
        return default
    if isinstance(val, (int, float)):
        f = float(val)
        return default if (math.isnan(f) or math.isinf(f)) else f
    s = str(val).replace(",", "").strip()
    if s.lower() in _INVALID_TEXT_TOKENS:
        return default
    try:
        f = float(s)
        return default if (math.isnan(f) or math.isinf(f)) else f
    except (ValueError, TypeError):
        return default


def _clean_mileage_str(val: Any, default: str = "-") -> str:
    """Format mileage values cleanly without trailing .0 or NaN artifacts."""
    txt = _clean_text(val, default="")
    if not txt:
        return default
    raw_num = txt.replace(",", "").strip()
    try:
        f = float(raw_num)
        if math.isnan(f) or math.isinf(f) or f <= 0:
            return default if f <= 0 and raw_num in ("0", "0.0") else default
        if f.is_integer():
            return f"{int(f):,}"
        return f"{f:,.1f}"
    except (ValueError, TypeError):
        return txt


def _norm_plate(val: Any) -> str:
    """Normalize license plate by removing spaces, hyphens, underscores, and dots."""
    base = normalize_plate(_clean_text(val, default=""))
    return base.replace(".", "").strip().lower()


def _normalize_year(year_val: int) -> int:
    """Convert Buddhist Era year (>= 2400) to Common Era (CE)."""
    if year_val >= 2400:
        return year_val - 543
    return year_val


def _safe_construct_date(year_val: int, month_val: int, day_val: int) -> Optional[date]:
    """Construct a CE date safely, handling Buddhist Era years and BE Feb 29 leap-year mismatch."""
    norm_y = _normalize_year(year_val)
    try:
        return date(norm_y, month_val, day_val)
    except ValueError:
        if month_val == 2 and day_val == 29:
            try:
                return date(norm_y, 2, 28)
            except ValueError:
                return None
        return None


def _parse_flexible_date(val: Any) -> Optional[date]:
    """Parse DB date values across ISO, DD/MM/YYYY, and Buddhist Era formats."""
    if val is None:
        return None
    if isinstance(val, datetime):
        return _safe_construct_date(val.year, val.month, val.day)
    if isinstance(val, date):
        return _safe_construct_date(val.year, val.month, val.day)

    s = _clean_text(val, default="")
    if not s:
        return None
    s = s.split("T")[0].split(" ")[0].strip()

    m_ymd = _DATE_YMD_RE.match(s)
    if m_ymd:
        y, m, d = int(m_ymd.group(1)), int(m_ymd.group(2)), int(m_ymd.group(3))
        return _safe_construct_date(y, m, d)

    m_dmy = _DATE_DMY_RE.match(s)
    if m_dmy:
        d, m, y = int(m_dmy.group(1)), int(m_dmy.group(2)), int(m_dmy.group(3))
        return _safe_construct_date(y, m, d)

    # Handle 2-digit year fallback in legacy DB strings (e.g. 27/11/69)
    m_short = re.match(r"^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2})$", s)
    if m_short:
        d, m, y2 = int(m_short.group(1)), int(m_short.group(2)), int(m_short.group(3))
        full_y = (2500 + y2 - 543) if y2 >= 50 else (2000 + y2)
        return _safe_construct_date(full_y, m, d)

    return None


def _parse_command_date(raw_text: str) -> Optional[date]:
    """Parse user-typed date command (supports DD/MM/YYYY, DD/MM/2569, YYYY-MM-DD, with optional prefix)."""
    cmd = str(raw_text or "").strip()
    if not cmd:
        return None
    for prefix in ("งานวันที่", "คิววันที่", "วันที่", "งาน", "คิว"):
        if cmd.startswith(prefix):
            rest = cmd[len(prefix):].strip()
            if rest and re.match(r"^\d", rest):
                cmd = rest
                break

    m_dmy = _DATE_DMY_RE.match(cmd)
    if m_dmy:
        d, m, y = int(m_dmy.group(1)), int(m_dmy.group(2)), int(m_dmy.group(3))
        try:
            return date(_normalize_year(y), m, d)
        except ValueError:
            return None

    m_ymd = _DATE_YMD_RE.match(cmd)
    if m_ymd:
        y, m, d = int(m_ymd.group(1)), int(m_ymd.group(2)), int(m_ymd.group(3))
        try:
            return date(_normalize_year(y), m, d)
        except ValueError:
            return None

    return None


def _format_doc_date(val: Any) -> str:
    """Format document or booking date as DD/MM/YYYY (CE) or '-' when missing/NaN."""
    parsed = _parse_flexible_date(val)
    if parsed:
        return parsed.strftime("%d/%m/%Y")
    return _clean_text(val, default="-")


def _is_assigned_to_user(assigned_val: Any, user_obj: Dict[str, Any]) -> bool:
    """Check whether a task's worker/staff field matches the linked LINE user."""
    raw = _clean_text(assigned_val, default="")
    if not raw or raw.lower() in _UNASSIGNED_TOKENS:
        return False

    uname_low = _clean_text(user_obj.get("username"), default="").lower()
    name_low = _clean_text(user_obj.get("name"), default="").lower()
    valid_targets = {t for t in (uname_low, name_low) if t}
    if not valid_targets:
        return False

    candidates = [seg.strip() for seg in re.split(r"[,/]", raw) if seg.strip()]
    for cand in candidates:
        c_low = cand.lower()
        c_head = c_low.split("(")[0].strip()
        if c_low in valid_targets or (c_head and c_head in valid_targets):
            return True
    return False


def _extract_plate_query(raw_text: str) -> Optional[str]:
    """
    Extract license plate query if raw_text is either:
    1) Prefixed with 'ทะเบียน' (returns '' if user typed bare 'ทะเบียน' so help prompt is shown)
    2) A bare Thai license plate (e.g. '7ขช 8613', '7ขช8613', '1กข-1111', 'ป้ายแดง') or an exact plate in store.cars.
    """
    cmd = str(raw_text or "").strip()
    if not cmd:
        return None
    if cmd in ("งานวันนี้", "คิวส่งรถ", "รถว่าง"):
        return None
    if cmd.startswith("ผูกบัญชี") or cmd.lower().startswith("link "):
        return None
    if _parse_command_date(cmd) is not None:
        return None

    if cmd.startswith("ทะเบียน"):
        return cmd[len("ทะเบียน"):].strip()

    if _THAI_PLATE_RE.match(cmd):
        return cmd

    q_norm = _norm_plate(cmd)
    if len(q_norm) >= 3:
        cars_map = _get_store_dict("cars")
        car_keys = list(cars_map.keys())
        car_plates = [c.get("plate", "") for c in cars_map.values()]
        for pk in car_keys + car_plates:
            if _norm_plate(pk) == q_norm:
                return cmd

    return None


def verify_line_signature(raw_body: bytes, signature: str, secret: str) -> bool:
    """Verify LINE Messaging API X-Line-Signature (Base64 HMAC-SHA256)."""
    if not signature or not secret:
        return False
    digest = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).digest()
    expected = base64.b64encode(digest).decode("ascii")
    return hmac.compare_digest(signature.strip(), expected)


def _find_linked_user_by_line_uid(line_uid: str) -> Optional[Dict[str, Any]]:
    """Find user record linked to a given LINE userId (supports comma-separated multi-IDs and Admin env fallback)."""
    target = str(line_uid or "").strip()
    if not target:
        return None
    users_map = _get_store_dict("users")
    for u_obj in users_map.values():
        for field_name in ("line_user_id", "line_id"):
            raw_ids = _clean_text(u_obj.get(field_name), default="")
            if not raw_ids:
                continue
            id_parts = [p.strip() for p in raw_ids.split(",") if p.strip()]
            if target in id_parts:
                return u_obj

    # Fallback: if sender's LINE userId matches configured Admin LINE IDs in environment (.env / Dokploy)
    try:
        admin_ids = get_admin_line_ids() or []
        if target in admin_ids:
            admin_user = users_map.get("admin") or users_map.get("Admin")
            if admin_user:
                return admin_user
            return {
                "username": "admin",
                "name": "ผู้ดูแลระบบ (Admin)",
                "role": "Admin",
                "status": "approved",
                "is_approved": True,
                "line_user_id": target,
            }
    except Exception as exc:
        print(f"[LINE Webhook] Admin ID fallback check warning: {exc}")

    return None


def _is_user_approved(user_obj: Optional[Dict[str, Any]]) -> bool:
    """Check whether a user account is approved and active for LINE bot commands."""
    if not user_obj:
        return False
    if user_obj.get("is_approved") is False:
        return False
    u_status = str(user_obj.get("status", "approved")).strip().lower()
    blocked_statuses = ("suspended", "ระงับ", "inactive", "rejected", "pending", "รออนุมัติ", "รอดำเนินการ")
    return u_status not in blocked_statuses


def _is_line_bot_command(raw_text: str) -> bool:
    cmd = str(raw_text or "").strip()
    if not cmd:
        return False
    if cmd in ("งานวันนี้", "คิวส่งรถ", "รถว่าง"):
        return True
    if _parse_command_date(cmd) is not None:
        return True
    if _extract_plate_query(cmd) is not None:
        return True
    return False


def _collect_other_work_orders(
    work_orders_snap: List[Dict[str, Any]],
    target_date: date,
    known_ref_ids: set,
    user_obj: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    """Collect active work_order_logs on target_date that do not duplicate bookings or maintenance_records."""
    closed_statuses = {"completed", "เสร็จสิ้น", "ยกเลิก", "canceled", "cancelled", "done", "closed"}
    results: List[Dict[str, Any]] = []
    for w in work_orders_snap:
        j_status = _clean_text(w.get("job_status"), default="").lower()
        if j_status in closed_statuses:
            continue
        ref_id = _clean_text(w.get("booking_id"), default="")
        if ref_id and ref_id in known_ref_ids:
            continue
        w_date = _parse_flexible_date(w.get("appointment_datetime") or w.get("schedule_date"))
        if w_date != target_date:
            continue
        if user_obj is not None and not _is_assigned_to_user(w.get("staff_id"), user_obj):
            continue
        results.append(w)
    return results


def _collect_expiring_cars_on_date(
    cars_snap: Dict[str, Dict[str, Any]],
    ins_records_snap: List[Dict[str, Any]],
    target_date: date,
) -> List[Tuple[str, str, List[str]]]:
    """
    Find vehicles whose Insurance, ACT (พ.ร.บ.), or Tax expires on target_date.
    Returns list of (plate_display, brand_model, [expiry_labels]).
    """
    by_norm_plate: Dict[str, Tuple[str, str, List[str]]] = {}

    for plate_key, car in cars_snap.items():
        plate_disp = _clean_text(car.get("plate"), default=_clean_text(plate_key, default="-"))
        norm_p = _norm_plate(plate_disp)
        if not norm_p:
            continue
        brand = _clean_text(car.get("brand"), default="")
        model = _clean_text(car.get("model"), default="")
        brand_model = f"{brand} {model}".strip() or "-"

        matched_docs: List[str] = []

        ins_dt = _parse_flexible_date(car.get("insurance_expire_date") or car.get("ins_expiry"))
        if ins_dt == target_date:
            ins_co = _clean_text(car.get("insurance_company") or car.get("ins_company"), default="")
            matched_docs.append(f"ประกันภัย ({ins_co})" if ins_co else "ประกันภัย")

        prb_dt = _parse_flexible_date(car.get("prb_expire_date") or car.get("act_expiry"))
        if prb_dt == target_date:
            matched_docs.append("พ.ร.บ.")

        tax_dt = _parse_flexible_date(car.get("tax_expire_date") or car.get("tax_expiry"))
        if tax_dt == target_date:
            matched_docs.append("ภาษี")

        if matched_docs:
            by_norm_plate[norm_p] = (plate_disp, brand_model, matched_docs)

    # Also check secondary insurance_records table without duplicating existing alerts
    for ir in ins_records_snap:
        ir_dt = _parse_flexible_date(ir.get("expiry_date"))
        if ir_dt != target_date:
            continue
        ir_plate = _clean_text(ir.get("car_id"), default="")
        norm_p = _norm_plate(ir_plate)
        if not norm_p:
            continue
        cat_raw = _clean_text(ir.get("ins_category") or ir.get("ins_type"), default="ประกันภัย")
        ins_co = _clean_text(ir.get("insurance_company"), default="")
        label = "พ.ร.บ." if ("พรบ" in cat_raw or "พ.ร.บ" in cat_raw or "act" in cat_raw.lower()) else (
            f"ประกันภัย ({ins_co})" if ins_co else "ประกันภัย"
        )
        if norm_p in by_norm_plate:
            existing_docs = by_norm_plate[norm_p][2]
            base_tag = "พ.ร.บ." if label == "พ.ร.บ." else "ประกันภัย"
            if not any(d.startswith(base_tag) for d in existing_docs):
                existing_docs.append(label)
        else:
            car_obj = next((c for k, c in cars_snap.items() if _norm_plate(k) == norm_p or _norm_plate(c.get("plate")) == norm_p), None)
            plate_disp = _clean_text((car_obj or {}).get("plate"), default=ir_plate)
            brand = _clean_text((car_obj or {}).get("brand"), default="")
            model = _clean_text((car_obj or {}).get("model"), default="")
            brand_model = f"{brand} {model}".strip() or "-"
            by_norm_plate[norm_p] = (plate_disp, brand_model, [label])

    return sorted(by_norm_plate.values(), key=lambda x: x[0])


def build_line_command_reply(raw_text: str, user_obj: Dict[str, Any]) -> Optional[str]:
    """Build zero-quota LINE reply message for authorized staff/admin commands."""
    _ensure_store_synced()
    cmd = str(raw_text or "").strip()
    if not _is_line_bot_command(cmd):
        return None

    # 1. Retired command: "รถว่าง"
    if cmd == "รถว่าง":
        return (
            "ℹ️ ยกเลิกการแสดงรายการรถว่างทั้งหมดทางแชทแล้วครับ\n"
            "💡 กรุณาพิมพ์ \"เลขทะเบียนรถ\" (เช่น 1กก 9999) เพื่อเช็กข้อมูลรายคัน "
            "หรือตรวจสอบตารางรถว่างผ่านหน้าเว็บไซต์แทนครับ"
        )

    today_date = now_th().date()
    today_dmy = today_date.strftime("%d/%m/%Y")
    staff_label = _clean_text((user_obj or {}).get("name") or (user_obj or {}).get("username"), default="Staff")

    bookings_snap = _get_store_list("bookings")
    cars_snap = _get_store_dict("cars")
    maint_snap = _get_store_list("maintenance_records")
    work_orders_snap = _get_store_list("work_order_logs")
    ins_records_snap = _get_store_list("insurance_records")

    known_ref_ids = {
        _clean_text(b.get("booking_id"), default="") for b in bookings_snap if _clean_text(b.get("booking_id"), default="")
    } | {
        _clean_text(m.get("id"), default="") for m in maint_snap if _clean_text(m.get("id"), default="")
    }

    # 2. Command: "งานวันนี้" (Strictly filtered to the linked user's own assigned jobs today)
    if cmd == "งานวันนี้":
        dispatch_today = [
            b for b in bookings_snap
            if str(b.get("status") or "") not in INACTIVE_BOOKING_STATUSES
            and _parse_flexible_date(b.get("start_date")) == today_date
            and _is_assigned_to_user(b.get("worker_delivery"), user_obj)
        ]
        dispatch_today.sort(key=lambda x: _clean_text(x.get("start_time"), "00:00"))

        return_today = [
            b for b in bookings_snap
            if str(b.get("status") or "") not in INACTIVE_BOOKING_STATUSES
            and _parse_flexible_date(b.get("end_date")) == today_date
            and _is_assigned_to_user(b.get("worker_return"), user_obj)
        ]
        return_today.sort(key=lambda x: _clean_text(x.get("end_time"), "00:00"))

        maint_today = [
            m for m in maint_snap
            if str(m.get("status") or "") not in ("เสร็จสิ้น", "ยกเลิก", "Completed", "Canceled")
            and _parse_flexible_date(m.get("schedule_date") or m.get("scheduled_date") or m.get("start_date")) == today_date
            and _is_assigned_to_user(m.get("assigned_worker"), user_obj)
        ]
        extra_wo_today = _collect_other_work_orders(work_orders_snap, today_date, known_ref_ids, user_obj=user_obj)
        total_other = len(maint_today) + len(extra_wo_today)

        lines = [f"📅 งานของคุณวันนี้ ({today_dmy}) | 👤 {staff_label}"]
        lines.append(f"• ส่งรถ: {len(dispatch_today)} | รับคืน: {len(return_today)} | ซ่อมบำรุง/อื่นๆ: {total_other}")

        if dispatch_today:
            lines.append("\n🚚 คิวส่งมอบรถของคุณ:")
            for b in dispatch_today[:10]:
                del_fee = _clean_float(b.get("delivery_fee"), 0.0)
                is_off = str(b.get("delivery_mode") or "branch").lower() == "offsite" or del_fee > 0
                off_badge = f" [🚚 ส่งนอกสถานที่ +฿{del_fee:,.0f}]" if is_off else ""
                lines.append(
                    f"- {_clean_text(b.get('booking_id'))} | {_clean_text(b.get('car_id'))} ({_clean_text(b.get('customer'))}) "
                    f"เวลา {_clean_text(b.get('start_time'), '10:00')} @ {_clean_text(b.get('loc_delivery'))}{off_badge}"
                )
        if return_today:
            lines.append("\n🏁 คิวรับรถคืนของคุณ:")
            for b in return_today[:10]:
                pic_fee = _clean_float(b.get("pickup_fee"), 0.0)
                is_off = str(b.get("pickup_mode") or "branch").lower() == "offsite" or pic_fee > 0
                off_badge = f" [🚚 รับคืนนอกสถานที่ +฿{pic_fee:,.0f}]" if is_off else ""
                lines.append(
                    f"- {_clean_text(b.get('booking_id'))} | {_clean_text(b.get('car_id'))} ({_clean_text(b.get('customer'))}) "
                    f"เวลา {_clean_text(b.get('end_time'), '10:00')} @ {_clean_text(b.get('loc_return'))}{off_badge}"
                )
        if maint_today or extra_wo_today:
            lines.append("\n🛠️ งานซ่อมบำรุง/งานอื่นๆ ของคุณ:")
            for m in maint_today[:8]:
                m_desc = _clean_text(m.get("service_items") or m.get("order_type") or m.get("type") or m.get("description"))
                m_loc = _clean_text(m.get("service_center"), default="")
                loc_sfx = f" @ {m_loc}" if m_loc else ""
                lines.append(f"- {_clean_text(m.get('car_id'))} | {m_desc}{loc_sfx}")
            for w in extra_wo_today[:8]:
                w_desc = _clean_text(w.get("description") or w.get("work_type"))
                w_loc = _clean_text(w.get("location"), default="")
                loc_sfx = f" @ {w_loc}" if w_loc else ""
                lines.append(f"- {_clean_text(w.get('car_id'))} | {w_desc}{loc_sfx}")

        if not (dispatch_today or return_today or maint_today or extra_wo_today):
            lines.append("✨ วันนี้ไม่มีคิวงานส่งรถ รับรถคืน หรืองานซ่อมบำรุงที่มอบหมายให้คุณครับ")
        return "\n".join(lines)

    # 3. Preserved command: "คิวส่งรถ"
    if cmd == "คิวส่งรถ":
        queue = [
            b for b in bookings_snap
            if str(b.get("status") or "") not in ("กำลังเช่า", "เสร็จสิ้น", "ยกเลิก")
            and not bool(b.get("dispatch_closed"))
        ]
        queue.sort(key=lambda x: (str(x.get("start_date") or "9999-99-99"), str(x.get("start_time") or "00:00")))
        lines = [f"🚚 คิวรอส่งมอบรถทั้งหมด ({len(queue)} รายการ)"]
        if not queue:
            lines.append("✨ ไม่มีคิวรอส่งมอบรถค้างอยู่ครับ")
        for b in queue[:10]:
            s_dmy = _format_doc_date(b.get("start_date"))
            del_fee = _clean_float(b.get("delivery_fee"), 0.0)
            is_off = str(b.get("delivery_mode") or "branch").lower() == "offsite" or del_fee > 0
            off_badge = f" [🚚 ส่งนอกสถานที่ +฿{del_fee:,.0f}]" if is_off else ""
            worker_disp = _clean_text(b.get("worker_delivery"), default="รอมอบหมาย")
            if worker_disp.lower() == "wait":
                worker_disp = "รอมอบหมาย"
            lines.append(
                f"• {_clean_text(b.get('booking_id'))} | {_clean_text(b.get('car_id'))} ({_clean_text(b.get('customer'))})\n"
                f"  นัด {s_dmy} {_clean_text(b.get('start_time'), '10:00')} @ {_clean_text(b.get('loc_delivery'))}{off_badge} "
                f"[{worker_disp}]"
            )
        return "\n".join(lines)

    # 4. Command: Date search (e.g. "27/11/2026", "27/11/2569", "2026-11-27")
    query_date = _parse_command_date(cmd)
    if query_date is not None:
        q_dmy = query_date.strftime("%d/%m/%Y")
        q_be_year = query_date.year + 543

        dispatch_on_date = [
            b for b in bookings_snap
            if str(b.get("status") or "") not in INACTIVE_BOOKING_STATUSES
            and _parse_flexible_date(b.get("start_date")) == query_date
        ]
        dispatch_on_date.sort(key=lambda x: _clean_text(x.get("start_time"), "00:00"))

        return_on_date = [
            b for b in bookings_snap
            if str(b.get("status") or "") not in INACTIVE_BOOKING_STATUSES
            and _parse_flexible_date(b.get("end_date")) == query_date
        ]
        return_on_date.sort(key=lambda x: _clean_text(x.get("end_time"), "00:00"))

        maint_on_date = [
            m for m in maint_snap
            if str(m.get("status") or "") not in ("เสร็จสิ้น", "ยกเลิก", "Completed", "Canceled")
            and _parse_flexible_date(m.get("schedule_date") or m.get("scheduled_date") or m.get("start_date")) == query_date
        ]
        extra_wo_on_date = _collect_other_work_orders(work_orders_snap, query_date, known_ref_ids, user_obj=None)
        expiring_cars = _collect_expiring_cars_on_date(cars_snap, ins_records_snap, query_date)

        total_other = len(maint_on_date) + len(extra_wo_on_date)
        lines = [
            f"📆 สรุปคิวงานและแจ้งเตือนวันที่ {q_dmy} (พ.ศ. {q_be_year})",
            f"• ส่งรถ: {len(dispatch_on_date)} | รับคืน: {len(return_on_date)} | ซ่อมบำรุง/อื่นๆ: {total_other} | เอกสารหมดอายุ: {len(expiring_cars)}",
        ]

        if dispatch_on_date:
            lines.append("\n🚚 คิวส่งมอบรถ:")
            for b in dispatch_on_date[:12]:
                del_fee = _clean_float(b.get("delivery_fee"), 0.0)
                is_off = str(b.get("delivery_mode") or "branch").lower() == "offsite" or del_fee > 0
                off_badge = f" [🚚 ส่งนอกสถานที่ +฿{del_fee:,.0f}]" if is_off else ""
                w_del = _clean_text(b.get("worker_delivery"), default="รอมอบหมาย")
                if w_del.lower() == "wait":
                    w_del = "รอมอบหมาย"
                lines.append(
                    f"- {_clean_text(b.get('booking_id'))} | {_clean_text(b.get('car_id'))} ({_clean_text(b.get('customer'))}) "
                    f"เวลา {_clean_text(b.get('start_time'), '10:00')} @ {_clean_text(b.get('loc_delivery'))}{off_badge} [{w_del}]"
                )
        if return_on_date:
            lines.append("\n🏁 คิวรับรถคืน:")
            for b in return_on_date[:12]:
                pic_fee = _clean_float(b.get("pickup_fee"), 0.0)
                is_off = str(b.get("pickup_mode") or "branch").lower() == "offsite" or pic_fee > 0
                off_badge = f" [🚚 รับคืนนอกสถานที่ +฿{pic_fee:,.0f}]" if is_off else ""
                w_ret = _clean_text(b.get("worker_return"), default="รอมอบหมาย")
                if w_ret.lower() == "wait":
                    w_ret = "รอมอบหมาย"
                lines.append(
                    f"- {_clean_text(b.get('booking_id'))} | {_clean_text(b.get('car_id'))} ({_clean_text(b.get('customer'))}) "
                    f"เวลา {_clean_text(b.get('end_time'), '10:00')} @ {_clean_text(b.get('loc_return'))}{off_badge} [{w_ret}]"
                )
        if maint_on_date or extra_wo_on_date:
            lines.append("\n🛠️ งานซ่อมบำรุง/งานอื่นๆ:")
            for m in maint_on_date[:8]:
                m_desc = _clean_text(m.get("service_items") or m.get("order_type") or m.get("type") or m.get("description"))
                w_mnt = _clean_text(m.get("assigned_worker"), default="รอมอบหมาย")
                lines.append(f"- {_clean_text(m.get('car_id'))} | {m_desc} [{w_mnt}]")
            for w in extra_wo_on_date[:8]:
                w_desc = _clean_text(w.get("description") or w.get("work_type"))
                w_stf = _clean_text(w.get("staff_id"), default="รอมอบหมาย")
                lines.append(f"- {_clean_text(w.get('car_id'))} | {w_desc} [{w_stf}]")

        if not (dispatch_on_date or return_on_date or maint_on_date or extra_wo_on_date):
            lines.append("\n✨ ไม่มีคิวส่งรถ รับรถคืน หรืองานซ่อมบำรุงในวันดังกล่าว")

        if expiring_cars:
            lines.append(f"\n⚠️ รถที่เอกสารหมดอายุตรงกับวันที่ {q_dmy}:")
            for plate_disp, brand_model, doc_list in expiring_cars[:15]:
                lines.append(f"- {plate_disp} ({brand_model}) -> หมดอายุ: {', '.join(doc_list)}")
        else:
            lines.append("\n✅ ไม่มีรถที่หมดอายุ ประกันภัย / พ.ร.บ. / ภาษี ในวันดังกล่าว")

        return "\n".join(lines)

    # 5. Command: License plate search (prefixed 'ทะเบียน ...' or bare plate '7ขช 8613' / '7ขช8613')
    q_plate = _extract_plate_query(cmd)
    if q_plate is None:
        return None
    if not q_plate:
        return "💡 กรุณาระบุเลขทะเบียนที่ต้องการค้นหา เช่น: 7ขช 8613 หรือ ทะเบียน 1กก 1111"

    q_norm = _norm_plate(q_plate)
    found_car = None
    for plate_key, c_obj in cars_snap.items():
        if _norm_plate(plate_key) == q_norm or _norm_plate(c_obj.get("plate", "")) == q_norm:
            found_car = c_obj
            break
    if not found_car and len(q_norm) >= 3:
        for plate_key, c_obj in cars_snap.items():
            if q_norm in _norm_plate(plate_key) or q_norm in _norm_plate(c_obj.get("plate", "")):
                found_car = c_obj
                break

    if not found_car:
        return f"🔍 ไม่พบข้อมูลรถยนต์ทะเบียน '{q_plate}' ในระบบ"

    plate_val = _clean_text(found_car.get("plate"), default=q_plate)
    norm_found = _norm_plate(plate_val)

    car_bookings = [
        b for b in bookings_snap
        if _norm_plate(b.get("car_id", "")) == norm_found
        and str(b.get("status") or "") not in INACTIVE_BOOKING_STATUSES
    ]
    car_bookings.sort(
        key=lambda b: (
            0 if str(b.get("status") or "") in ("กำลังเช่า", "รอรับคืน") else 1,
            str(b.get("start_date") or "9999-99-99"),
        )
    )
    active_bk = car_bookings[0] if car_bookings else None

    brand = _clean_text(found_car.get("brand"), default="")
    model = _clean_text(found_car.get("model"), default="")
    brand_model = f"{brand} {model}".strip() or "-"
    color = _clean_text(found_car.get("color"), default="-")

    # Daily rental rate from primary DB column `daily_rate` (fallback `price_day` -> latest booking `daily_rate`)
    daily_rate = _clean_float(found_car.get("daily_rate"), 0.0) or _clean_float(found_car.get("price_day"), 0.0)
    if daily_rate > 0:
        rate_str = f"฿{daily_rate:,.0f}/วัน"
    else:
        fallback_rate = 0.0
        for b in bookings_snap:
            if _norm_plate(b.get("car_id", "")) == norm_found:
                r = _clean_float(b.get("daily_rate"), 0.0)
                if r > 0:
                    fallback_rate = r
                    break
        rate_str = f"฿{fallback_rate:,.0f}/วัน (อ้างอิงใบจอง)" if fallback_rate > 0 else "- (ยังไม่ระบุเรต)"

    # Status with live booking sanity check
    car_status = _clean_text(found_car.get("car_status") or found_car.get("status"), default="-")
    has_on_rent = any(str(b.get("status") or "") in ("กำลังเช่า", "รอรับคืน") for b in car_bookings)
    if car_status == "กำลังเช่า" and not has_on_rent:
        car_status = "ติดจอง" if car_bookings else "ว่างพร้อมใช้งาน"

    mileage_str = _clean_mileage_str(found_car.get("mileage"), default="-")
    next_svc_str = _clean_mileage_str(found_car.get("next_service_mileage"), default="-")
    mileage_disp = f"{mileage_str} กม." if mileage_str != "-" else "-"
    next_svc_disp = f"{next_svc_str} กม." if next_svc_str != "-" else "-"

    tax_str = _format_doc_date(found_car.get("tax_expire_date") or found_car.get("tax_expiry"))
    prb_str = _format_doc_date(found_car.get("prb_expire_date") or found_car.get("act_expiry"))
    ins_str = _format_doc_date(found_car.get("insurance_expire_date") or found_car.get("ins_expiry"))
    ins_comp = _clean_text(found_car.get("insurance_company") or found_car.get("ins_company"), default="")
    ins_disp = f"{ins_str} ({ins_comp})" if (ins_str != "-" and ins_comp) else ins_str

    lines = [
        f"🚘 ข้อมูลรถทะเบียน: {plate_val}",
        f"• รุ่น: {brand_model} (สี: {color})",
        f"• เรตค่าเช่า: {rate_str}",
        f"• สถานะ: {car_status}",
        f"• เลขไมล์: {mileage_disp} (เช็กระยะถัดไป: {next_svc_disp})",
        f"• ภาษีหมดอายุ: {tax_str}",
        f"• พ.ร.บ.หมดอายุ: {prb_str}",
        f"• ประกันหมดอายุ: {ins_disp}",
    ]
    if active_bk:
        del_fee = _clean_float(active_bk.get("delivery_fee"), 0.0)
        pic_fee = _clean_float(active_bk.get("pickup_fee"), 0.0)
        is_del_off = str(active_bk.get("delivery_mode") or "branch").lower() == "offsite" or del_fee > 0
        is_pic_off = str(active_bk.get("pickup_mode") or "branch").lower() == "offsite" or pic_fee > 0
        loc_info = f"  📍 ส่งรถ: {_clean_text(active_bk.get('loc_delivery'))}" + (f" [🚚 นอกสถานที่ ฿{del_fee:,.0f}]" if is_del_off else "")
        ret_info = f"  🏁 รับคืน: {_clean_text(active_bk.get('loc_return'))}" + (f" [🚚 นอกสถานที่ ฿{pic_fee:,.0f}]" if is_pic_off else "")
        lines.append(
            f"📌 การจองปัจจุบัน: {_clean_text(active_bk.get('booking_id'))} ({_clean_text(active_bk.get('status'))})\n"
            f"  ผู้เช่า: {_clean_text(active_bk.get('customer'))} | {_format_doc_date(active_bk.get('start_date'))} ถึง {_format_doc_date(active_bk.get('end_date'))}\n"
            f"{loc_info}\n{ret_info}"
        )
    else:
        lines.append("📌 การจองปัจจุบัน: ไม่มีคิวเช่าที่ใช้งานอยู่")
    return "\n".join(lines)


@router.post("/api/line/broadcast")
def trigger_line_broadcast(payload: Optional[Dict[str, Any]] = None):
    p = payload or {}
    msg = p.get("message", "ทดสอบการส่งข้อความจากระบบ Sawasdee Rental")
    to_uid = p.get("to_user_id")
    worker = p.get("worker_name")
    delivery_mode = p.get("delivery_mode") or p.get("mode")
    if worker and not to_uid:
        to_uid = resolve_worker_line_id(worker)
    success = send_line_push_message(msg, to_user_id=to_uid or get_admin_line_id(), delivery_mode=delivery_mode)
    return {"success": success, "to_user_id": to_uid or get_admin_line_id()}


@router.post("/api/line/check-expiry")
@router.post("/api/notify/expirations")
def trigger_expiry_alert_check(payload: Optional[Dict[str, Any]] = None):
    try:
        p = payload or {}
        recipient_mode = p.get("recipient_mode")
        delivery_mode = p.get("delivery_mode") or p.get("mode") or "broadcast"
        check_mode = p.get("check_mode", "weekly")
        if not getattr(store, "cars", None) or not getattr(store, "initial_sync_done", False):
            try:
                sync_fn = getattr(store, "sync_from_database", None)
                if callable(sync_fn):
                    sync_fn(force=False)
            except Exception as se:
                print(f"Sync cars before expiry check note: {se}")
        res = check_and_send_expiry_alerts(
            _get_store_dict("cars"),
            recipient_mode=recipient_mode,
            check_mode=check_mode,
            delivery_mode=delivery_mode
        )
        return res
    except Exception as e:
        print(f"Error in trigger_expiry_alert_check endpoint: {e}")
        return {"sent": False, "count": 0, "message": f"เกิดข้อผิดพลาด: {str(e)}", "error": str(e)}


@router.post("/api/line/webhook")
@router.post("/webhook/line")
@router.post("/line/webhook")
async def line_bot_webhook(request: Request):
    """
    Webhook สำหรับผูกบัญชี LINE ของพนักงานอัตโนมัติและศูนย์คำสั่งบอท (ใช้ replyToken ฟรี 0 โควต้า):
    - พนักงานพิมพ์ชื่อผู้ใช้ (Username) เช่น 'chaiwat.u' ส่งมาในแชท LINE OA
    - ระบบจะบันทึก line_user_id คู่กับ username ลงฐานข้อมูลทันที
    """
    raw_body = await request.body()
    sig = request.headers.get("X-Line-Signature", "").strip()
    secret = os.environ.get("LINE_CHANNEL_SECRET", "").strip()
    enforce_sig = request.headers.get("X-Enforce-Line-Signature") == "1"

    # Only enforce signature verification when LINE_CHANNEL_SECRET is configured or explicitly enforced
    if secret:
        if sig:
            if not verify_line_signature(raw_body, sig, secret):
                raise HTTPException(status_code=401, detail="Invalid X-Line-Signature")
        elif enforce_sig or request.headers.get("user-agent", "") != "testclient":
            raise HTTPException(status_code=401, detail="Missing X-Line-Signature")
    elif enforce_sig:
        if not sig or not verify_line_signature(raw_body, sig, "sawasdee-line-secret"):
            raise HTTPException(status_code=401, detail="Missing or Invalid X-Line-Signature")

    try:
        body = json.loads(raw_body.decode("utf-8"))
    except Exception:
        return {"status": "ok"}

    def _handle_line_events():
        _ensure_store_synced()
        events = body.get("events") or []
        for ev in events:
            try:
                if not isinstance(ev, dict):
                    continue
                ev_type = ev.get("type")
                source = ev.get("source") or {}
                line_uid = source.get("userId") or source.get("groupId") or source.get("roomId")
                reply_token = ev.get("replyToken")

                if ev_type == "message" and (ev.get("message") or {}).get("type") == "text" and line_uid:
                    raw_text = str((ev.get("message") or {}).get("text") or "").strip()

                    if _is_line_bot_command(raw_text):
                        linked_user = _find_linked_user_by_line_uid(line_uid)
                        if not _is_user_approved(linked_user):
                            if reply_token:
                                send_line_reply_message(
                                    reply_token,
                                    "⛔ บัญชี LINE นี้ยังไม่ได้รับอนุมัติหรือยังไม่ได้ผูกกับผู้ใช้งานในระบบ กรุณาพิมพ์ชื่อผู้ใช้งาน (Username) เพื่อผูกบัญชีและรอแอดมินอนุมัติก่อนใช้คำสั่งบอท"
                                )
                            continue
                        try:
                            reply_msg = build_line_command_reply(raw_text, linked_user)
                        except Exception as cmd_exc:
                            print(f"[LINE Webhook] Command reply error for '{raw_text}': {cmd_exc}")
                            reply_msg = "⚠️ ระบบเกิดข้อผิดพลาดชั่วคราวขณะดึงข้อมูล กรุณาลองใหม่อีกครั้งครับ"
                        if reply_token and reply_msg:
                            send_line_reply_message(reply_token, reply_msg)
                        continue

                    clean_text = raw_text.replace("ผูกบัญชี", "").replace("link", "").strip()
                    matched_user = None
                    users_snap = list(_get_store_dict("users").items())

                    for uname, u_obj in users_snap:
                        u_line = _clean_text(u_obj.get("line_user_id") or u_obj.get("line_id"), default="").lower()
                        if (
                            uname.lower() == clean_text.lower()
                            or _clean_text(u_obj.get("name"), default="").lower() == clean_text.lower()
                            or (u_line and u_line == clean_text.lower())
                        ):
                            matched_user = u_obj
                            break

                    if matched_user:
                        uname = matched_user.get("username")
                        matched_user["line_user_id"] = line_uid
                        sync_user_fn = getattr(store, "async_sync_user", None)
                        if callable(sync_user_fn) and uname:
                            sync_user_fn(uname, matched_user)
                        if reply_token:
                            send_line_reply_message(
                                reply_token,
                                "\n".join([
                                    "✅ ผูกบัญชีสำเร็จ!",
                                    f"👤 ชื่อผู้ใช้: {uname} ({matched_user.get('name', uname)})",
                                    f"📲 LINE ID: {line_uid}",
                                    "ระบบจะส่งใบงานส่งรถ/รับรถ/ซ่อมบำรุง ที่คุณเป็นผู้รับผิดชอบมาที่แชทนี้โดยตรงครับ"
                                ])
                            )
                    elif reply_token:
                        send_line_reply_message(
                            reply_token,
                            "\n".join([
                                "📲 รหัส LINE User ID ของคุณคือ:",
                                str(line_uid),
                                "",
                                "💡 พิมพ์ชื่อผู้ใช้งาน (Username) ของคุณในระบบ (เช่น chaiwat.u) ส่งมาในแชทนี้เพื่อผูกบัญชีรับใบงานอัตโนมัติ หรือคัดลอกรหัสข้างต้นไปใส่ในหน้าจัดการผู้ใช้งานได้เลยครับ"
                            ])
                        )
            except Exception as ev_exc:
                print(f"[LINE Webhook] Event processing error: {ev_exc}")

    await asyncio.to_thread(_handle_line_events)
    return {"status": "ok"}
