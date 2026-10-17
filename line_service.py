import os
import sys
import threading
import time
import requests
from datetime import datetime, date, timedelta

LINE_BROADCAST_URL = "https://api.line.me/v2/bot/message/broadcast"
LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push"

LINE_DEFAULT_CHANNEL_ACCESS_TOKEN = (
    "V9Sc5Zmu4av4UzX+NbGNmkNCWM21aKchTJQw8ueOsGwilCWGv9c+AEqFtrKC4OG0fVwFy7l+"
    "wa5FVw0nrBGx8mz6zAHcdBY5hn4eBJApNwQ7oXOhSfgvzKHjxh6UGkqytCrLndQQAcVxcI+FFcGxMwdB04t89/1O/w1cDnyilFU="
)
LINE_TARGET_USER_ID = "Ub7b6353ba826c0ba5c3d9fac3531ef77"

def get_line_credentials():
    token = os.environ.get("LINE_CHANNEL_ACCESS_TOKEN", LINE_DEFAULT_CHANNEL_ACCESS_TOKEN)
    user_id = os.environ.get("LINE_TARGET_USER_ID", LINE_TARGET_USER_ID)
    try:
        import toml
        secrets_path = os.path.join(os.path.dirname(__file__), ".streamlit", "secrets.toml")
        if os.path.exists(secrets_path):
            sec = toml.load(secrets_path)
            token = sec.get("LINE_CHANNEL_ACCESS_TOKEN", token)
            user_id = sec.get("LINE_TARGET_USER_ID", user_id)
    except Exception:
        pass
    return token, user_id

def send_line_broadcast_message(message: str, channel_access_token: str = None) -> bool:
    """
    ส่งข้อความแจ้งเตือนแบบ Broadcast ไปยังทุกคนที่เป็นเพื่อนกับบอท LINE Official Account
    """
    token, _ = get_line_credentials()
    act = channel_access_token or token
    if not act:
        return False
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {act}"
    }
    payload = {
        "messages": [{"type": "text", "text": message}]
    }
    try:
        resp = requests.post(LINE_BROADCAST_URL, headers=headers, json=payload, timeout=10)
        if resp.status_code == 200:
            return True
        print(f"LINE Broadcast Error: HTTP {resp.status_code} - {resp.text}")
        return False
    except Exception as e:
        print(f"Error sending LINE broadcast: {e}")
        return False

def send_line_push_message(message: str, to_user_id: str = None, channel_access_token: str = None) -> bool:
    token, uid = get_line_credentials()
    act = channel_access_token or token
    target_uid = to_user_id or uid
    if not target_uid:
        return send_line_broadcast_message(message, act)
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {act}"
    }
    payload = {
        "to": target_uid,
        "messages": [{"type": "text", "text": message}]
    }
    try:
        resp = requests.post(LINE_PUSH_URL, headers=headers, json=payload, timeout=10)
        if resp.status_code == 200:
            return True
        elif resp.status_code == 400:
            return send_line_broadcast_message(message, act)
        return False
    except Exception as e:
        print(f"Error sending LINE push: {e}")
        return False

def send_line_push_async(message: str, to_user_id: str = None):
    """
    ส่งข้อความแบบ asynchronous เบื้องหลัง:
    - หากไม่ระบุ to_user_id จะส่งแบบ Broadcast ไปหาทุกคนที่เป็นเพื่อนกับบอท LINE OA
    - หากระบุ to_user_id จะส่งตรงไปยัง user/group นั้น
    """
    def _worker():
        if to_user_id:
            send_line_push_message(message, to_user_id=to_user_id)
        else:
            ok = send_line_broadcast_message(message)
            if not ok:
                send_line_push_message(message)

    try:
        t = threading.Thread(target=_worker, daemon=True)
        t.start()
    except Exception:
        _worker()

def _fmt_dmy(d_val) -> str:
    if not d_val:
        return "-"
    s = str(d_val).strip()[:10]
    try:
        dt = datetime.strptime(s, "%Y-%m-%d")
        return dt.strftime("%d/%m/%Y")
    except Exception:
        return s

def notify_line_work_order(booking_obj, job_type="Dispatch", worker_name="", location="", appointment_time=""):
    if not booking_obj:
        return
    try:
        bk_id = booking_obj.get("booking_id", "-")
        car_plate = booking_obj.get("car_id", "-")
        car_brand = str(booking_obj.get("car_brand", "")).strip()
        car_model = str(booking_obj.get("car_model", "")).strip()
        car_desc = f"{car_brand} {car_model}".strip()
        car_display = f"{car_desc} (ทะเบียน {car_plate})" if car_desc else f"ทะเบียน {car_plate}"

        cust_name = booking_obj.get("customer", "-")
        cust_phone = (
            booking_obj.get("customer_phone")
            or booking_obj.get("contact_no")
            or booking_obj.get("phone")
            or "-"
        )
        if not cust_phone or str(cust_phone).strip() in ["", "-", "None"]:
            cust_phone = "ไม่ระบุเบอร์โทร"

        is_dispatch = str(job_type).lower() in ["dispatch", "delivery", "ส่งรถ", "ส่งมอบรถ"]
        if is_dispatch:
            title = "🚚 แจ้งเตือน: ออกใบงานส่งมอบรถ (Dispatch)"
            action_label = "วันที่ส่งมอบ"
            date_val = _fmt_dmy(booking_obj.get("start_date"))
            time_val = appointment_time or booking_obj.get("start_time", "10:00")
            loc_val = location or booking_obj.get("loc_delivery") or "-"
            worker_val = worker_name or booking_obj.get("worker_delivery") or "-"
        else:
            title = "🔙 แจ้งเตือน: ออกใบงานรับรถคืน (Return)"
            action_label = "วันที่รับคืน"
            date_val = _fmt_dmy(booking_obj.get("end_date"))
            time_val = appointment_time or booking_obj.get("end_time", "10:00")
            loc_val = location or booking_obj.get("loc_return") or "-"
            worker_val = worker_name or booking_obj.get("worker_return") or "-"

        if not loc_val or str(loc_val).strip() in ["", "-"]:
            loc_val = "ไม่ได้ระบุสถานที่"
        if not worker_val or str(worker_val).strip() in ["", "-", "Wait"]:
            worker_val = "รอมอบหมายพนักงาน"

        lines = [
            f"🔔 {title}",
            "────────────────────",
            f"📋 เลขที่การจอง: {bk_id}",
            f"👤 ผู้รับผิดชอบ: {worker_val}",
            f"🚗 ทะเบียนรถ: {car_display}",
            f"📅 {action_label}: {date_val} (เวลา {time_val} น.)",
            f"📍 สถานที่: {loc_val}",
            f"🙋‍♂️ ลูกค้า: {cust_name}",
            f"📞 เบอร์โทรศัพท์: {cust_phone}",
            "────────────────────",
            "ระบบบริหารจัดการ SawasdeeRental"
        ]
        send_line_push_async("\n".join(lines))
    except Exception as e:
        print(f"Error notifying line work order: {e}")

def check_and_send_expiry_alerts(cars_dict=None, target_days=(30, 31, 7, 0)):
    try:
        from check_expiry_alert import check_expiring_cars, build_alert_message
        cars_list = []
        if cars_dict:
            for pl, c in cars_dict.items():
                c_copy = dict(c)
                c_copy["plate"] = pl
                cars_list.append(c_copy)
        else:
            from check_expiry_alert import fetch_cars_from_supabase, get_credentials
            _, sb_url, sb_key = get_credentials()
            cars_list = fetch_cars_from_supabase(sb_url, sb_key)

        expiring = check_expiring_cars(cars_list, target_days=target_days)
        if not expiring:
            return {"sent": False, "count": 0, "message": "ไม่มีรายการ พ.ร.บ. หรือ ประกันภัย ครบกำหนดแจ้งเตือนในวันนี้"}

        msg = build_alert_message(expiring)
        success = send_line_broadcast_message(msg)
        return {"sent": success, "count": len(expiring), "items": expiring, "message": msg}
    except Exception as e:
        print(f"Error in check_and_send_expiry_alerts: {e}")
        return {"sent": False, "count": 0, "error": str(e)}

_last_run_tag = None

def _has_sent_expiry_today(today_tag: str) -> bool:
    global _last_run_tag
    if _last_run_tag == today_tag:
        return True
    try:
        from db import get_supabase_client
        sb = get_supabase_client()
        if sb:
            res = sb.table("financial_records").select("id").eq("type", "SYSTEM_LOCK").eq("category", "LINE_EXPIRY_ALERT").eq("date", today_tag).limit(1).execute()
            if res.data and len(res.data) > 0:
                _last_run_tag = today_tag
                return True
    except Exception as e:
        print(f"Check expiry lock error: {e}")
    return False

def _mark_sent_expiry_today(today_tag: str):
    global _last_run_tag
    _last_run_tag = today_tag
    try:
        from db import get_supabase_client
        sb = get_supabase_client()
        if sb:
            sb.table("financial_records").insert({
                "company": "SYSTEM",
                "type": "SYSTEM_LOCK",
                "category": "LINE_EXPIRY_ALERT",
                "amount": 0,
                "ref": f"EXPIRY_{today_tag}",
                "date": today_tag,
                "detail": "Daily 20:00 LINE Expiry Alert Lock"
            }).execute()
    except Exception as e:
        print(f"Mark expiry lock error: {e}")

def init_expiry_scheduler_thread():
    def _scheduler_loop():
        global _last_run_tag
        # If server boots up after 20:02 ICT, mark today as already handled so redeploys after 8 PM don't re-trigger
        now_init = datetime.utcnow() + timedelta(hours=7)
        init_tag = now_init.strftime("%Y-%m-%d")
        if now_init.hour > 20 or (now_init.hour == 20 and now_init.minute >= 2):
            _mark_sent_expiry_today(init_tag)

        while True:
            try:
                now_bkk = datetime.utcnow() + timedelta(hours=7)
                today_tag = now_bkk.strftime("%Y-%m-%d")
                if now_bkk.hour == 20 and not _has_sent_expiry_today(today_tag):
                    _mark_sent_expiry_today(today_tag)
                    print(f"⏰ [{now_bkk.strftime('%H:%M')} ICT] Running daily expiry check {today_tag}...")
                    check_and_send_expiry_alerts(target_days=(30, 31, 7, 0))
                time.sleep(60)
            except Exception as e:
                print(f"Expiry scheduler error: {e}")
                time.sleep(60)
    t = threading.Thread(target=_scheduler_loop, daemon=True, name="ExpiryScheduler")
    t.start()
