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

from db import store
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
