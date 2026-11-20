"""
Shared constants and common utility helpers for SawasdeeRental.
"""

import base64
import hashlib
import hmac
import json
import os
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional
from fastapi import Depends, HTTPException, Request

from db import store

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TH_TZ = timezone(timedelta(hours=7))

static_dir = os.path.join(BASE_DIR, "static")
os.makedirs(static_dir, exist_ok=True)
os.makedirs(os.path.join(static_dir, "css"), exist_ok=True)
os.makedirs(os.path.join(static_dir, "js"), exist_ok=True)
os.makedirs(os.path.join(static_dir, "pdf"), exist_ok=True)
os.makedirs(os.path.join(static_dir, "pdf", "inspections"), exist_ok=True)

INACTIVE_BOOKING_STATUSES = ("เสร็จสิ้น", "ยกเลิก")

MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB
ALLOWED_UPLOAD_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".pdf"}
ALLOWED_UPLOAD_MIMES = {
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/gif",
    "application/pdf",
    "application/octet-stream",
}

AUTH_SECRET_KEY = (
    os.environ.get("AUTH_SECRET_KEY")
    or os.environ.get("LINE_CHANNEL_SECRET")
    or "sawasdee-rental-hmac-secret-2026"
)


def validate_upload_bytes(
    filename: Optional[str],
    content_type: Optional[str],
    file_bytes: bytes,
    allow_pdf: bool = True,
) -> None:
    """Validate uploaded file byte size, extension whitelist, and MIME type."""
    if not file_bytes:
        raise HTTPException(status_code=400, detail="ไฟล์รูปภาพว่างเปล่า (0 bytes)")
    if len(file_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="ขนาดไฟล์เกินกำหนด (สูงสุดไม่เกิน 10 MB)")

    ext = os.path.splitext(str(filename or "").strip().lower())[1]
    allowed_exts = ALLOWED_UPLOAD_EXTENSIONS if allow_pdf else (ALLOWED_UPLOAD_EXTENSIONS - {".pdf"})
    if ext not in allowed_exts:
        raise HTTPException(status_code=400, detail=f"ไม่รองรับไฟล์นามสกุล '{ext or '-'}'")

    ctype = str(content_type or "").split(";")[0].strip().lower()
    if ctype:
        if ctype == "application/pdf" and not allow_pdf:
            raise HTTPException(status_code=400, detail=f"ไม่รองรับชนิดไฟล์ '{content_type}'")
        if ctype not in ALLOWED_UPLOAD_MIMES and not ctype.startswith("image/"):
            raise HTTPException(status_code=400, detail=f"ไม่รองรับชนิดไฟล์ '{content_type}'")


def create_session_token(username: str, role: str = "Staff", ttl_seconds: int = 21600) -> str:
    """Generate an HMAC-SHA256 signed session token containing username, role, and expiry."""
    payload = {
        "u": str(username),
        "r": str(role or "Staff"),
        "exp": int(time.time()) + int(ttl_seconds),
    }
    raw_json = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    b64_payload = base64.urlsafe_b64encode(raw_json).decode("ascii")
    sig = hmac.new(AUTH_SECRET_KEY.encode("utf-8"), b64_payload.encode("ascii"), hashlib.sha256).hexdigest()
    return f"{b64_payload}.{sig}"


def verify_session_token(token: str) -> Optional[Dict[str, Any]]:
    """Verify HMAC signature, expiration, and active user status in store.users."""
    if not token or not isinstance(token, str) or "." not in token:
        return None
    parts = token.strip().split(".")
    if len(parts) != 2:
        return None
    b64_payload, sig = parts
    expected_sig = hmac.new(
        AUTH_SECRET_KEY.encode("utf-8"),
        b64_payload.encode("ascii"),
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(sig, expected_sig):
        return None

    try:
        padded = b64_payload + "=" * (-len(b64_payload) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8"))
    except Exception:
        return None

    if not isinstance(payload, dict) or int(payload.get("exp", 0)) < int(time.time()):
        return None

    username = str(payload.get("u") or "").strip()
    if not username:
        return None
    role = str(payload.get("r") or "Staff").strip()

    user_rec = store.users.get(username)
    if user_rec is None:
        uname_low = username.lower()
        for k, v in store.users.items():
            if k.lower() == uname_low:
                user_rec = v
                break

    if user_rec is not None:
        u_status = str(user_rec.get("status", "")).strip().lower()
        if u_status in ("suspended", "ระงับ", "inactive", "rejected", "pending", "รออนุมัติ", "รอดำเนินการ") or user_rec.get("is_approved") is False:
            return None
        if user_rec.get("role"):
            role = str(user_rec.get("role")).strip()

    return {"username": username, "role": role}


def require_auth(request: Request) -> Dict[str, Any]:
    """FastAPI dependency requiring a valid Bearer or X-Auth-Token session token."""
    auth_hdr = request.headers.get("Authorization", "").strip()
    token = ""
    if auth_hdr.lower().startswith("bearer "):
        token = auth_hdr[7:].strip()
    if not token:
        token = request.headers.get("X-Auth-Token", "").strip()

    claims = verify_session_token(token)
    if not claims:
        raise HTTPException(status_code=401, detail="กรุณาเข้าสู่ระบบ (Missing or invalid session token)")
    return claims


def require_admin(claims: Dict[str, Any] = Depends(require_auth)) -> Dict[str, Any]:
    """FastAPI dependency restricting access to Admin users."""
    role = str(claims.get("role", "")).strip()
    un = str(claims.get("username", "")).strip().lower()

    user_rec = store.users.get(claims.get("username", ""))
    if user_rec is None:
        for k, v in store.users.items():
            if k.lower() == un:
                user_rec = v
                break
    if user_rec and user_rec.get("role"):
        role = str(user_rec.get("role")).strip()

    if role != "Admin" and un != "admin":
        raise HTTPException(status_code=403, detail="เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่มีสิทธิ์ดำเนินการนี้")
    return claims


def now_th() -> datetime:
    """Return current datetime in Thailand timezone (UTC+7)."""
    return datetime.now(TH_TZ)


def convert_gdrive_url(url: str) -> str:
    """Convert Google Drive share link to direct image view URL to save server storage."""
    if not url or not isinstance(url, str):
        return url
    u = url.strip()
    m = re.search(r"drive\.google\.com/file/d/([a-zA-Z0-9_-]+)", u)
    if m:
        return f"https://lh3.googleusercontent.com/d/{m.group(1)}"
    m = re.search(r"drive\.google\.com/(?:open|uc)\?(?:[^&]*&)*id=([a-zA-Z0-9_-]+)", u)
    if m:
        return f"https://lh3.googleusercontent.com/d/{m.group(1)}"
    return u


def normalize_plate(plate: str) -> str:
    """Normalize license plate text by stripping whitespace, hyphens, and dots."""
    if not plate:
        return ""
    return re.sub(r"[\s\-\.]+", "", str(plate)).lower()


def get_car_key(car_id):
    """Resolve car key from store.cars matching raw car_id, plate, or normalized string."""
    if not car_id:
        return None
    if car_id in store.cars:
        return car_id
    clean_target = re.sub(r"[\s\-_]", "", str(car_id)).strip().lower()
    for k, v in store.cars.items():
        if re.sub(r"[\s\-_]", "", str(k)).strip().lower() == clean_target:
            return k
        if re.sub(r"[\s\-_]", "", str(v.get("plate", ""))).strip().lower() == clean_target:
            return k
    return None
