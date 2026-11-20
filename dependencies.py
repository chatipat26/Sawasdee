"""
Shared constants and common utility helpers for SawasdeeRental.
"""

import os
import re
from datetime import datetime, timedelta, timezone

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
