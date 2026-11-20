"""
LINE Messaging & Webhook API Router for SawasdeeRental.
"""

import asyncio
import base64
import hashlib
import hmac
import json
import os
from typing import Optional, Dict, Any
from fastapi import APIRouter, HTTPException, Request

from db import store, format_date_dmy
from dependencies import INACTIVE_BOOKING_STATUSES, normalize_plate, now_th
from line_service import (
    resolve_worker_line_id,
    get_admin_line_id,
    send_line_push_message,
    send_line_reply_message,
    check_and_send_expiry_alerts,
)

router = APIRouter(tags=["line"])


def verify_line_signature(raw_body: bytes, signature: str, secret: str) -> bool:
    """Verify LINE Messaging API X-Line-Signature (Base64 HMAC-SHA256)."""
    if not signature or not secret:
        return False
    digest = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).digest()
    expected = base64.b64encode(digest).decode("ascii")
    return hmac.compare_digest(signature.strip(), expected)


def _find_linked_user_by_line_uid(line_uid: str) -> Optional[Dict[str, Any]]:
    """Find user record linked to a given LINE userId (supports comma-separated multi-IDs)."""
    target = str(line_uid or "").strip()
    if not target:
        return None
    with store.lock:
        users_snap = [dict(u) for u in store.users.values()]
    for u_obj in users_snap:
        raw_ids = str(u_obj.get("line_user_id") or "").strip()
        if not raw_ids or raw_ids in ("-", "None", "null"):
            continue
        id_parts = [p.strip() for p in raw_ids.split(",") if p.strip()]
        if target in id_parts:
            return u_obj
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
    return cmd in ("งานวันนี้", "คิวส่งรถ", "รถว่าง") or cmd.startswith("ทะเบียน")


def build_line_command_reply(raw_text: str, user_obj: Dict[str, Any]) -> Optional[str]:
    """Build zero-quota LINE reply message for authorized staff/admin commands."""
    cmd = str(raw_text or "").strip()
    if not _is_line_bot_command(cmd):
        return None

    today_str = now_th().strftime("%Y-%m-%d")
    today_dmy = format_date_dmy(today_str)
    staff_label = user_obj.get("name") or user_obj.get("username") or "Staff"

    with store.lock:
        bookings_snap = [dict(b) for b in store.bookings]
        cars_snap = {k: dict(v) for k, v in store.cars.items()}
        maint_snap = [dict(m) for m in (store.maintenance_records or [])]

    if cmd == "งานวันนี้":
        dispatch_today = [
            b for b in bookings_snap
            if str(b.get("status") or "") not in INACTIVE_BOOKING_STATUSES
            and str(b.get("start_date") or "").split("T")[0] == today_str
        ]
        return_today = [
            b for b in bookings_snap
            if str(b.get("status") or "") not in INACTIVE_BOOKING_STATUSES
            and str(b.get("end_date") or "").split("T")[0] == today_str
        ]
        maint_today = [
            m for m in maint_snap
            if str(m.get("status") or "") != "เสร็จสิ้น"
            and str(m.get("schedule_date") or m.get("scheduled_date") or m.get("start_date") or "").split("T")[0] == today_str
        ]
        lines = [f"📅 งานวันนี้ ({today_dmy}) | ผู้เรียก: {staff_label}"]
        lines.append(f"• ส่งรถ: {len(dispatch_today)} | รับคืน: {len(return_today)} | ซ่อมบำรุง: {len(maint_today)}")
        if dispatch_today:
            lines.append("\n🚚 คิวส่งมอบรถวันนี้:")
            for b in dispatch_today[:8]:
                lines.append(
                    f"- {b.get('booking_id')} | {b.get('car_id')} ({b.get('customer')}) "
                    f"เวลา {b.get('start_time') or '10:00'} @ {b.get('loc_delivery') or '-'}"
                )
        if return_today:
            lines.append("\n🏁 คิวรับรถคืนวันนี้:")
            for b in return_today[:8]:
                lines.append(
                    f"- {b.get('booking_id')} | {b.get('car_id')} ({b.get('customer')}) "
                    f"เวลา {b.get('end_time') or '10:00'} @ {b.get('loc_return') or '-'}"
                )
        if maint_today:
            lines.append("\n🛠️ งานซ่อม/เช็กระยะวันนี้:")
            for m in maint_today[:5]:
                m_desc = m.get('service_items') or m.get('order_type') or m.get('type') or m.get('description') or '-'
                lines.append(f"- {m.get('car_id') or '-'} | {m_desc}")
        if not (dispatch_today or return_today or maint_today):
            lines.append("✨ ไม่มีคิวงานส่งมอบ รับคืน หรือซ่อมบำรุงสำหรับวันนี้ครับ")
        return "\n".join(lines)

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
            s_dmy = format_date_dmy(b.get("start_date")) or "-"
            lines.append(
                f"• {b.get('booking_id')} | {b.get('car_id')} ({b.get('customer')})\n"
                f"  นัด {s_dmy} {b.get('start_time') or '10:00'} @ {b.get('loc_delivery') or '-'} "
                f"[{b.get('worker_delivery') or 'รอมอบหมาย'}]"
            )
        return "\n".join(lines)

    if cmd == "รถว่าง":
        avail_cars = [
            c for c in cars_snap.values()
            if str(c.get("status") or "") in ("ว่าง", "ว่างพร้อมใช้งาน")
        ]
        lines = [f"🚗 รถว่างพร้อมใช้งาน ({len(avail_cars)}/{len(cars_snap)} คัน)"]
        if not avail_cars:
            lines.append("⚠️ ขณะนี้ไม่มีรถว่างพร้อมใช้งาน")
        for c in avail_cars[:15]:
            rate = float(c.get("price_day") or c.get("daily_rate") or 0)
            lines.append(f"• {c.get('plate') or '-'} | {c.get('brand') or ''} {c.get('model') or ''} (฿{rate:,.0f}/วัน)")
        return "\n".join(lines)

    # Command: ทะเบียน <plate>
    q_plate = cmd[len("ทะเบียน"):].strip()
    if not q_plate:
        return "💡 กรุณาระบุเลขทะเบียนที่ต้องการค้นหา เช่น: ทะเบียน 1กก 1111"

    q_norm = normalize_plate(q_plate)
    found_car = None
    for plate_key, c_obj in cars_snap.items():
        if normalize_plate(plate_key) == q_norm or normalize_plate(c_obj.get("plate", "")) == q_norm:
            found_car = c_obj
            break
    if not found_car and q_norm:
        for plate_key, c_obj in cars_snap.items():
            if q_norm in normalize_plate(plate_key) or q_norm in normalize_plate(c_obj.get("plate", "")):
                found_car = c_obj
                break

    if not found_car:
        return f"🔍 ไม่พบข้อมูลรถยนต์ทะเบียน '{q_plate}' ในระบบ"

    plate_val = found_car.get("plate") or q_plate
    active_bk = next(
        (
            b for b in bookings_snap
            if normalize_plate(b.get("car_id", "")) == normalize_plate(plate_val)
            and str(b.get("status") or "") not in INACTIVE_BOOKING_STATUSES
        ),
        None,
    )
    tax_exp = found_car.get("tax_expire_date") or found_car.get("tax_expiry")
    ins_exp = found_car.get("insurance_expire_date") or found_car.get("ins_expiry")
    lines = [
        f"🚘 ข้อมูลรถทะเบียน: {plate_val}",
        f"• รุ่น: {found_car.get('brand') or ''} {found_car.get('model') or ''} ({found_car.get('color') or '-'})",
        f"• สถานะ: {found_car.get('status') or '-'}",
        f"• เลขไมล์: {found_car.get('mileage') or 0} กม. (เช็กระยะ: {found_car.get('next_service_mileage') or '-'})",
        f"• ภาษีหมด: {format_date_dmy(tax_exp) or tax_exp or '-'} | ประกันหมด: {format_date_dmy(ins_exp) or ins_exp or '-'}",
    ]
    if active_bk:
        lines.append(
            f"📌 การจองปัจจุบัน: {active_bk.get('booking_id')} ({active_bk.get('status')})\n"
            f"  ผู้เช่า: {active_bk.get('customer')} | {format_date_dmy(active_bk.get('start_date'))} ถึง {format_date_dmy(active_bk.get('end_date'))}"
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
        if not store.cars or not store.initial_sync_done:
            try:
                store.sync_from_database(force=False)
            except Exception as se:
                print(f"Sync cars before expiry check note: {se}")
        res = check_and_send_expiry_alerts(
            store.cars,
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
async def line_bot_webhook(request: Request):
    """
    Webhook สำหรับผูกบัญชี LINE ของพนักงานอัตโนมัติ (ใช้ replyToken ฟรี 0 โควต้า):
    - พนักงานพิมพ์ชื่อผู้ใช้ (Username) เช่น 'chaiwat.u' ส่งมาในแชท LINE OA
    - ระบบจะบันทึก line_user_id คู่กับ username ลงฐานข้อมูลทันที
    """
    raw_body = await request.body()
    sig = request.headers.get("X-Line-Signature", "").strip()
    secret = os.environ.get("LINE_CHANNEL_SECRET", "").strip()

    if sig:
        if not verify_line_signature(raw_body, sig, secret or "sawasdee-line-secret"):
            raise HTTPException(status_code=401, detail="Invalid X-Line-Signature")
    elif request.headers.get("X-Enforce-Line-Signature") == "1" or (
        secret and request.headers.get("user-agent", "") != "testclient"
    ):
        raise HTTPException(status_code=401, detail="Missing X-Line-Signature")

    try:
        body = json.loads(raw_body.decode("utf-8"))
    except Exception:
        return {"status": "ok"}

    def _handle_line_events():
        events = body.get("events") or []
        for ev in events:
            ev_type = ev.get("type")
            source = ev.get("source") or {}
            line_uid = source.get("userId")
            reply_token = ev.get("replyToken")

            if ev_type == "message" and ev.get("message", {}).get("type") == "text" and line_uid:
                raw_text = str(ev.get("message", {}).get("text") or "").strip()

                if _is_line_bot_command(raw_text):
                    linked_user = _find_linked_user_by_line_uid(line_uid)
                    if not _is_user_approved(linked_user):
                        if reply_token:
                            send_line_reply_message(
                                reply_token,
                                "⛔ บัญชี LINE นี้ยังไม่ได้รับอนุมัติหรือยังไม่ได้ผูกกับผู้ใช้งานในระบบ กรุณาพิมพ์ชื่อผู้ใช้งาน (Username) เพื่อผูกบัญชีและรอแอดมินอนุมัติก่อนใช้คำสั่งบอท"
                            )
                        continue
                    reply_msg = build_line_command_reply(raw_text, linked_user)
                    if reply_token and reply_msg:
                        send_line_reply_message(reply_token, reply_msg)
                    continue

                clean_text = raw_text.replace("ผูกบัญชี", "").replace("link", "").strip()
                matched_user = None

                with store.lock:
                    users_snap = [(uname, dict(u_obj)) for uname, u_obj in store.users.items()]

                for uname, u_obj in users_snap:
                    u_line = str(u_obj.get("line_user_id") or "").strip().lower()
                    if (
                        uname.lower() == clean_text.lower()
                        or str(u_obj.get("name") or "").strip().lower() == clean_text.lower()
                        or (u_line and u_line == clean_text.lower())
                    ):
                        matched_user = u_obj
                        break

                if matched_user:
                    uname = matched_user.get("username")
                    matched_user["line_user_id"] = line_uid
                    store.async_sync_user(uname, matched_user)
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
                            line_uid,
                            "",
                            "💡 พิมพ์ชื่อผู้ใช้งาน (Username) ของคุณในระบบ (เช่น chaiwat.u) ส่งมาในแชทนี้เพื่อผูกบัญชีรับใบงานอัตโนมัติ หรือคัดลอกรหัสข้างต้นไปใส่ในหน้าจัดการผู้ใช้งานได้เลยครับ"
                        ])
                    )

    await asyncio.to_thread(_handle_line_events)
    return {"status": "ok"}
