import os
import sys
import threading
import time
import requests
from datetime import datetime, date, timedelta
from typing import Optional

from database import load_env_file

load_env_file()

LINE_BROADCAST_URL = "https://api.line.me/v2/bot/message/broadcast"
LINE_MULTICAST_URL = "https://api.line.me/v2/bot/message/multicast"
LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push"
LINE_REPLY_URL = "https://api.line.me/v2/bot/message/reply"

LINE_DEFAULT_CHANNEL_ACCESS_TOKEN = os.getenv("LINE_CHANNEL_ACCESS_TOKEN", "")
LINE_TARGET_USER_ID = os.getenv("LINE_TARGET_USER_ID", "")

# โหมดผู้รับแจ้งเตือนวันหมดอายุ พ.ร.บ./ประกันภัย/ภาษี:
# - "admin"    = ส่งหาแอดมินเท่านั้น (ค่าเริ่มต้นปัจจุบัน)
# - "customer" = ส่งหาลูกค้าผู้เช่า/เจ้าของรถโดยตรง (สำหรับเปิดใช้งานในอนาคต)
EXPIRY_ALERT_RECIPIENT_MODE = os.getenv("EXPIRY_ALERT_RECIPIENT_MODE", "admin")


def get_line_credentials():
    token = str(os.getenv("LINE_CHANNEL_ACCESS_TOKEN") or "").strip()
    user_id = str(os.getenv("LINE_TARGET_USER_ID") or "").strip()
    return token, user_id


def get_admin_line_ids() -> list:
    """
    ดึงรายการ LINE IDs ของผู้รับทั้งหมด (รองรับหลาย ID คั่นด้วยจุลภาค Comma-separated)
    ตรวจสอบจากตัวแปรสภาพแวดล้อม (.env):
    - LINE_TARGET_USER_ID
    - LINE_ADMIN_ID
    - LINE_USER_ID
    - LINE_ADMIN_USER_ID
    - GROUP_ID
    และดึงจากบัญชีผู้ใช้ในตาราง users ที่มี role == 'admin'
    """
    recipients = []
    try:
        # 1. อ่านจาก Environment Variables
        env_keys = ["LINE_TARGET_USER_ID", "LINE_ADMIN_ID", "LINE_USER_ID", "LINE_ADMIN_USER_ID", "GROUP_ID"]
        for k in env_keys:
            val = os.getenv(k)
            if val:
                for item in str(val).split(","):
                    clean = item.strip().strip("'\"")
                    if clean and clean not in recipients:
                        recipients.append(clean)

        # 2. อ่านจากตาราง users สำหรับผู้ดูแลระบบ (Admin)
        try:
            from db import store
            if hasattr(store, "users") and store.users:
                admin_u = store.users.get("admin") or store.users.get("Admin")
                if admin_u and str(admin_u.get("line_user_id") or "").strip():
                    for item in str(admin_u.get("line_user_id")).split(","):
                        clean = item.strip().strip("'\"")
                        if clean and clean not in recipients:
                            recipients.append(clean)

                for u in store.users.values():
                    if str(u.get("role") or "").lower() == "admin":
                        l_uid = str(u.get("line_user_id") or "").strip()
                        if l_uid and l_uid not in ["-", "None", "null"]:
                            for item in l_uid.split(","):
                                clean = item.strip().strip("'\"")
                                if clean and clean not in recipients:
                                    recipients.append(clean)
        except Exception as e:
            print(f"Lookup admin users LINE IDs note: {e}")
    except Exception as ge:
        print(f"get_admin_line_ids general note: {ge}")

    # 3. Fallback หากไม่มีการตั้งค่าใดๆ เลย
    if not recipients:
        default_uid = str(os.getenv("LINE_TARGET_USER_ID") or "").strip()
        if default_uid:
            recipients = [default_uid]

    return recipients


def get_admin_line_id() -> str:
    """
    ดึง LINE User ID ของแอดมินหลัก (สำหรับความเข้ากันได้ย้อนหลัง คืนค่า ID แรก)
    """
    ids = get_admin_line_ids()
    return ids[0] if ids else str(os.getenv("LINE_TARGET_USER_ID") or "").strip()


def resolve_worker_line_id(worker_name: str) -> Optional[str]:
    """
    แปลงชื่อผู้รับผิดชอบงาน (เจ้าของงาน) ให้เป็น LINE User ID เฉพาะบุคคล
    - เพื่อส่งข้อความตรง (Direct Push 1:1) หาเจ้าของงานเท่านั้น ไม่ใช้ Broadcast
    """
    if not worker_name:
        return None
    raw = str(worker_name).strip()
    if not raw or raw in ["-", "Wait", "รอมอบหมาย", "รอมอบหมายพนักงาน"]:
        return None

    # หากส่งเป็น LINE User ID มาโดยตรง (ขึ้นต้นด้วย U/C/R และความยาว >= 30)
    if len(raw) >= 30 and raw[0] in ("U", "C", "R") and " " not in raw:
        return raw

    # ตัดวงเล็บต่อท้าย เช่น "chaiwat.u (ชัยวัฒน์) [Staff]" -> "chaiwat.u"
    clean_key = raw.split("(")[0].split("[")[0].strip()
    clean_lower = clean_key.lower()
    raw_lower = raw.lower()

    try:
        from db import store
        # 1. ค้นหาตรงจาก store.users
        for uname, u_obj in store.users.items():
            u_un = str(u_obj.get("username") or uname).strip()
            u_name = str(u_obj.get("name") or "").strip()
            if (
                u_un.lower() == clean_lower
                or u_un.lower() == raw_lower
                or (u_name and (u_name.lower() == clean_lower or u_name.lower() == raw_lower))
            ):
                line_uid = str(u_obj.get("line_user_id") or "").strip()
                if line_uid and line_uid not in ["-", "None", "null"]:
                    return line_uid
                # หากเจ้าของงานเป็น Admin แต่ยังไม่ได้กรอก line_user_id แยก ให้ใช้ Admin LINE ID
                if str(u_obj.get("role") or "").lower() == "admin" or u_un.lower() in ("admin", "chatipat"):
                    return get_admin_line_id()
                return None
    except Exception as e:
        print(f"resolve_worker_line_id lookup note: {e}")

    # 2. หากชื่อผู้รับผิดชอบงานคือแอดมิน
    if clean_lower in ("admin", "administrator", "ผู้ดูแลระบบ", "chatipat", "chati"):
        return get_admin_line_id()

    return None


def resolve_customer_line_id_for_car(car_plate: str) -> Optional[str]:
    """
    (รองรับอนาคต) ค้นหา LINE User ID ของลูกค้าผู้เช่าหรือเจ้าของรถจากทะเบียนรถ
    """
    if not car_plate:
        return None
    try:
        from db import store
        for b in store.bookings:
            if b.get("car_id") == car_plate and b.get("status") not in ("เสร็จสิ้น", "ยกเลิก"):
                cust_name = b.get("customer")
                cust_obj = store.customers.get(cust_name) or {}
                cust_line_id = str(cust_obj.get("line_user_id") or "").strip()
                if cust_line_id and cust_line_id not in ["-", "None"]:
                    return cust_line_id
    except Exception:
        pass
    return None


def send_line_reply_message(reply_token: str, message: str, channel_access_token: str = None) -> bool:
    """
    ตอบกลับข้อความอัตโนมัติด้วย replyToken (ฟรี 100% ไม่เสียโควต้าข้อความรายเดือนของ LINE OA)
    """
    if not reply_token or not message:
        return False
    token, _ = get_line_credentials()
    act = channel_access_token or token
    if not act:
        return False
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {act}"
    }
    payload = {
        "replyToken": reply_token,
        "messages": [{"type": "text", "text": message}]
    }
    try:
        resp = requests.post(LINE_REPLY_URL, headers=headers, json=payload, timeout=10)
        return resp.status_code == 200
    except Exception as e:
        print(f"Error sending LINE reply: {e}")
        return False


def send_line_message(message: str, to_user_ids=None, channel_access_token: str = None, delivery_mode: str = None) -> bool:
    """
    ฟังก์ชันหลักในการส่งข้อความ LINE แบบยืดหยุ่น (Broadcast / Multicast / Push):
    1. delivery_mode == 'broadcast':
       - บังคับเรียก LINE Broadcast API (https://api.line.me/v2/bot/message/broadcast)
       - ส่งหาผู้ติดตาม (Followers) ทุกคนของบัญชี LINE OA นี้ โดยไม่ต้องพึ่งพา User ID
    2. delivery_mode == 'admin_only':
       - ส่งเฉพาะรายชื่อ Admin ตาม LINE ID ในระบบ / .env โดยใช้ Multicast หรือ Direct Push
       - ข้าม Broadcast โดยเด็ดขาด
    3. หากไม่ได้ระบุ delivery_mode:
       - ตรวจสอบ LINE_BROADCAST_MODE จาก .env
    """
    try:
        token, _ = get_line_credentials()
        act = channel_access_token or token
        if not act or not message:
            return False

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {act}"
        }

        mode_str = str(delivery_mode or "").strip().lower()

        # 1. โหมด BROADCAST
        is_broadcast = False
        if mode_str == "broadcast":
            is_broadcast = True
        elif mode_str == "admin_only":
            is_broadcast = False
        else:
            is_broadcast = str(os.environ.get("LINE_BROADCAST_MODE") or "false").strip().lower() in ("true", "1", "yes")

        if is_broadcast:
            try:
                payload = {
                    "messages": [{"type": "text", "text": str(message)}]
                }
                resp = requests.post(LINE_BROADCAST_URL, headers=headers, json=payload, timeout=10)
                if resp.status_code == 200:
                    print("📢 ส่ง LINE Broadcast ถึงผู้ติดตามทุกคนสำเร็จ [HTTP 200 OK]")
                    return True
                print(f"⚠️ LINE Broadcast Error: HTTP {resp.status_code} - {resp.text}")
            except Exception as e:
                print(f"❌ Exception in LINE Broadcast: {e}")

            # หากเจาะจง delivery_mode == "broadcast" แล้วไม่สำเร็จ ให้จบการทำงานทันที (ไม่หลุดไปยิงซ้ำ)
            if mode_str == "broadcast":
                return False

        # 2. โหมด MULTICAST / DIRECT PUSH (Admin / Specific IDs)
        target_list = []
        raw_targets = to_user_ids
        if not raw_targets:
            raw_targets = os.environ.get("LINE_USER_IDS") or get_admin_line_ids()

        if isinstance(raw_targets, (list, tuple, set)):
            for u in raw_targets:
                if u:
                    for sub in str(u).split(","):
                        c = sub.strip().strip("'\"")
                        if c and c not in target_list:
                            target_list.append(c)
        else:
            for sub in str(raw_targets or "").split(","):
                c = sub.strip().strip("'\"")
                if c and c not in target_list:
                    target_list.append(c)

        if not target_list:
            print("[LINE] No recipient IDs found for Multicast/Push.")
            return False

        # แยก User IDs (U...) สำหรับ Multicast และ Group/Room IDs (C..., R...)
        user_ids = [uid for uid in target_list if str(uid).startswith("U")]
        other_ids = [uid for uid in target_list if not str(uid).startswith("U")]

        success = False

        # ก. ส่งผ่าน Multicast API สำหรับ User IDs (ส่งครั้งเดียวพร้อมกันสูงสุด 500 คน)
        if len(user_ids) > 1:
            try:
                payload = {
                    "to": user_ids[:500],
                    "messages": [{"type": "text", "text": str(message)}]
                }
                resp = requests.post(LINE_MULTICAST_URL, headers=headers, json=payload, timeout=10)
                if resp.status_code == 200:
                    print(f"✅ ส่ง LINE Multicast ถึง {len(user_ids)} ผู้ใช้สำเร็จ [HTTP 200 OK]")
                    success = True
                else:
                    print(f"⚠️ LINE Multicast Error (HTTP {resp.status_code}): {resp.text} -> กำลัง Fallback ไป Push ทีละคน")
                    other_ids = user_ids + other_ids
            except Exception as e:
                print(f"❌ Exception in LINE Multicast: {e} -> กำลัง Fallback ไป Push ทีละคน")
                other_ids = user_ids + other_ids
        elif len(user_ids) == 1:
            other_ids = user_ids + other_ids

        # ข. ส่ง Direct Push รายบุคคล/กลุ่ม สำหรับ ID ที่เหลือ พร้อม try-except รายคน
        for uid in other_ids:
            try:
                payload = {
                    "to": str(uid),
                    "messages": [{"type": "text", "text": str(message)}]
                }
                resp = requests.post(LINE_PUSH_URL, headers=headers, json=payload, timeout=10)
                if resp.status_code == 200:
                    print(f"✅ ส่ง LINE Direct Push สำเร็จ (to={uid}) [HTTP 200 OK]")
                    success = True
                else:
                    print(f"⚠️ LINE Direct Push Error (to={uid}): HTTP {resp.status_code} - {resp.text}")
            except Exception as e:
                print(f"❌ Error sending LINE push to {uid}: {e}")

        return success
    except Exception as master_e:
        print(f"❌ Fatal error inside send_line_message: {master_e}")
        return False


def send_line_broadcast_message(message: str, channel_access_token: str = None) -> bool:
    """
    ส่งข้อความ Broadcast ไปยังผู้ติดตามทุกคน
    """
    token, _ = get_line_credentials()
    act = channel_access_token or token
    if not act or not message:
        return False
    try:
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {act}"
        }
        payload = {"messages": [{"type": "text", "text": message}]}
        resp = requests.post(LINE_BROADCAST_URL, headers=headers, json=payload, timeout=10)
        return resp.status_code == 200
    except Exception as e:
        print(f"send_line_broadcast_message error: {e}")
        return False


def send_line_push_message(message: str, to_user_id=None, channel_access_token: str = None) -> bool:
    """
    Alias ของ send_line_message เพื่อความเข้ากันได้ย้อนหลัง 100%
    """
    return send_line_message(message, to_user_ids=to_user_id, channel_access_token=channel_access_token)


def send_line_push_async(message: str, to_user_id=None):
    """
    ส่งข้อความแบบ asynchronous ไปยัง to_user_id (รองรับทั้ง ID เดี่ยวและหลายคน)
    """
    targets = to_user_id or get_admin_line_ids()

    def _worker():
        send_line_push_message(message, to_user_id=targets)

    try:
        t = threading.Thread(target=_worker, daemon=True)
        t.start()
    except Exception:
        _worker()


def send_line_to_admin_async(message: str):
    """
    ส่งข้อความแจ้งเตือนตรงเข้าแอดมินทุกคน
    """
    admin_uids = get_admin_line_ids()
    if not admin_uids:
        print("[LINE] No Admin LINE User ID configured.")
        return
    send_line_push_async(message, to_user_id=admin_uids)


def send_line_to_worker_async(message: str, worker_name: str) -> bool:
    """
    ส่งข้อความใบงาน (ส่งรถ / รับรถคืน / ซ่อมบำรุง) ตรงหา 'เจ้าของงาน' เท่านั้น!
    หากเจ้าของงานยังไม่ได้ผูก LINE User ID จะไม่ Broadcast เพื่อประหยัดข้อความ
    """
    target_uid = resolve_worker_line_id(worker_name)
    if not target_uid:
        print(f"[LINE] Skipped push for '{worker_name}' (no LINE User ID linked yet)")
        return False
    send_line_push_async(message, to_user_id=target_uid)
    return True


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
    """
    Disabled per system rule: Work order LINE notifications have been retired.
    """
    return False


def notify_line_maintenance(record: dict):
    """
    Disabled per system rule: Only 1st and 16th vehicle document expiry alerts are pushed to LINE.
    """
    return False
    try:
        mnt_id = record.get("id", "-")
        car_plate = record.get("car_id", "-")
        car_brand = str(record.get("car_brand", "")).strip()
        car_model = str(record.get("car_model", "")).strip()
        car_name = f"{car_brand} {car_model}".strip()
        car_display = f"{car_name} (ทะเบียน {car_plate})" if car_name else f"ทะเบียน {car_plate}"

        order_type = record.get("order_type", "ซ่อมบำรุงทั่วไป / เช็คระยะ")
        is_renewal = any(k in str(order_type) for k in ["ต่อทะเบียน", "พ.ร.บ.", "พรบ", "ประกัน", "ภาษี"])
        title = "📄 ออกใบงานต่อทะเบียน/พรบ./ประกัน" if is_renewal else "🛠️ ออกใบงานซ่อมบำรุงรถยนต์"

        service_items = str(record.get("service_items", "-")).strip()
        garage = record.get("service_center") or "-"
        garage_phone = record.get("service_center_phone") or "-"
        if garage_phone and str(garage_phone).strip() not in ["", "-"]:
            garage_display = f"{garage} (โทร: {garage_phone})"
        else:
            garage_display = garage

        worker = record.get("assigned_worker") or "รอมอบหมาย"

        sched_d = _fmt_dmy(record.get("schedule_date"))
        sched_t = record.get("schedule_time", "09:00")
        exp_d = _fmt_dmy(record.get("expected_finish_date"))
        exp_t = record.get("expected_finish_time", "17:00")

        cost_val = float(record.get("cost", 0) or 0)
        cost_str = f"{cost_val:,.2f} บาท" if cost_val > 0 else "ประเมินตามบิลจริง"

        notes = record.get("notes", "")

        lines = [
            f"🔔 {title}",
            "────────────────────",
            f"📋 เลขที่ใบงาน: {mnt_id}",
            f"🚗 ทะเบียนรถ: {car_display}",
            f"🔧 ประเภทงาน: {order_type}",
            f"📝 รายการซ่อม: {service_items}",
            f"🏁 วันที่นัดรับคืน: {exp_d} (เวลา {exp_t} น.)",
            f"🏢 ชื่ออู่/ศูนย์บริการ: {garage_display}",
            f"👤 ผู้รับผิดชอบ: {worker}",
            f"💰 ราคาค่าซ่อม: {cost_str}",
            f"📅 วันที่ส่งซ่อม/นัดหมาย: {sched_d} (เวลา {sched_t} น.)"
        ]
        if notes and str(notes).strip() not in ["", "-"]:
            lines.append(f"📌 หมายเหตุ: {notes}")
        lines.extend([
            "────────────────────",
            "ระบบบริหารจัดการ SawasdeeRental"
        ])

        # ยิงตรงหาเจ้าของงานซ่อมบำรุงเท่านั้น!
        send_line_to_worker_async("\n".join(lines), worker)
    except Exception as e:
        print(f"Error notifying LINE maintenance: {e}")


def notify_line_close_maintenance(record: dict, car: dict = None):
    """
    Disabled per system rule: Only 1st and 16th vehicle document expiry alerts are pushed to LINE.
    """
    return False


def notify_line_deposit(
    booking_obj: dict,
    amount: float,
    method: str,
    ref: str = "",
    slip_url: str = "",
    also_rent: bool = False,
    is_settle_only: bool = False
):
    """
    Disabled per system rule: Only 1st and 16th vehicle document expiry alerts are pushed to LINE.
    """
    return False


def notify_line_expense(expense_obj: dict):
    """
    Disabled per system rule: Only 1st and 16th vehicle document expiry alerts are pushed to LINE.
    """
    return False


def check_and_send_expiry_alerts(cars_dict=None, target_days=None, recipient_mode: str = None, check_date=None, check_mode: str = "weekly", delivery_mode: str = None):
    """
    แจ้งเตือนวันหมดอายุ พ.ร.บ. / ประกันภัย / ภาษี (Broadcast ถึงผู้ติดตาม หรือ Direct Push / Multicast หาแอดมิน):
    - delivery_mode == "broadcast": บังคับส่งแบบ Broadcast ถึงทุกคนที่เป็นเพื่อนกับ LINE OA โดยไม่ต้องพึ่ง User ID
    - delivery_mode == "admin_only": ส่งเฉพาะ Admin ตาม LINE ID ในระบบ
    - check_mode == "weekly": คัดกรองเฉพาะรถที่หมดอายุภายในสัปดาห์ปัจจุบัน (จันทร์-อาทิตย์) สำหรับปุ่มกดหน้าเว็บ
    - check_mode == "cycle": คัดกรองรอบวันที่ 1 (เดือนนี้) หรือรอบวันที่ 16 (เดือนหน้า) สำหรับ CRON อัตโนมัติ 19:00 น.
    - กรณีไม่มีรายการ (count == 0): ส่ง Fallback Message ว่า "ไม่มีรถครบกำหนดต่ออายุประกัน พ.ร.บ. ภาษี ในรอบนี้"
    - ป้องกัน 500 error ด้วย try-except ครอบคลุมรอบด้าน
    """
    try:
        from check_expiry_alert import check_expiring_cars, build_alert_message, get_target_cycle_info
        mode = (recipient_mode or EXPIRY_ALERT_RECIPIENT_MODE or "admin").strip().lower()
        now_bkk = datetime.utcnow() + timedelta(hours=7)
        ref_date = check_date or now_bkk.date()
        cycle_info = get_target_cycle_info(ref_date)

        # โหลดข้อมูลรถจาก cars_dict หรือ store.cars หรือฐานข้อมูล
        if not cars_dict:
            try:
                from db import store
                if store.cars:
                    cars_dict = store.cars
            except Exception:
                pass

        cars_list = []
        if cars_dict:
            for pl, c in cars_dict.items():
                if not c or not isinstance(c, dict):
                    continue
                c_copy = dict(c)
                c_copy["plate"] = str(pl or c.get("plate") or c.get("car_id") or "-").strip()
                cars_list.append(c_copy)
        else:
            from check_expiry_alert import fetch_cars_from_database
            cars_list = fetch_cars_from_database()

        expiring = check_expiring_cars(cars_list, check_date=ref_date, check_mode=check_mode)

        # กำหนดชื่อรอบหัวข้อตาม check_mode
        if str(check_mode).lower() == "weekly":
            active_cycle_title = f"รอบสัปดาห์นี้ ({cycle_info['week_desc']})"
        else:
            active_cycle_title = cycle_info["round_name"]

        # ดึงรายชื่อผู้รับสำหรับกรณี Multicast / Direct Push
        admin_uids = get_admin_line_ids()
        effective_mode = str(delivery_mode or "broadcast").strip().lower()

        # ตรวจสอบจำนวนรถที่เข้าเกณฑ์ นอกลูปเด็ดขาด ส่งแจ้งเตือนเพียง 1 ครั้งเท่านั้น
        if not expiring or len(expiring) == 0:
            fallback_msg = build_alert_message([], cycle_info=cycle_info, header_title=active_cycle_title)
            success = send_line_message(fallback_msg, to_user_ids=admin_uids, delivery_mode=effective_mode)
            return {
                "sent": success,
                "count": 0,
                "recipient_mode": mode,
                "delivery_mode": effective_mode,
                "check_mode": check_mode,
                "cycle": active_cycle_title,
                "recipients": ["BROADCAST_ALL"] if effective_mode == "broadcast" else admin_uids,
                "items": [],
                "message": "ไม่มีรถครบกำหนดต่ออายุประกัน พ.ร.บ. ภาษี ในรอบนี้"
            }

        if mode == "customer":
            # โหมดอนาคต: แยกส่งหาลูกค้าของแต่ละคัน หากไม่มี LINE ID ของลูกค้าให้ส่งเข้าแอดมิน
            grouped_by_target = {}
            fallback_admin = admin_uids[0] if admin_uids else str(os.getenv("LINE_TARGET_USER_ID") or "").strip()
            for item in expiring:
                cust_uid = resolve_customer_line_id_for_car(item.get("plate")) or fallback_admin
                if cust_uid:
                    grouped_by_target.setdefault(cust_uid, []).append(item)

            any_sent = False
            for uid, items_for_uid in grouped_by_target.items():
                sub_msg = build_alert_message(items_for_uid, cycle_info=cycle_info, header_title=active_cycle_title)
                if send_line_message(sub_msg, to_user_ids=[uid]):
                    any_sent = True
            msg = build_alert_message(expiring, cycle_info=cycle_info, header_title=active_cycle_title)
            return {"sent": any_sent, "count": len(expiring), "recipient_mode": mode, "delivery_mode": effective_mode, "check_mode": check_mode, "cycle": active_cycle_title, "items": expiring, "message": msg}
        else:
            # โหมดปัจจุบัน: ส่งหาผู้รับทุกคนเพียง 1 ครั้ง (รองรับ Broadcast / Multicast / Push ตามการตั้งค่า)
            msg = build_alert_message(expiring, cycle_info=cycle_info, header_title=active_cycle_title)
            success = send_line_message(msg, to_user_ids=admin_uids, delivery_mode=effective_mode)
            return {
                "sent": success,
                "count": len(expiring),
                "recipient_mode": "admin",
                "delivery_mode": effective_mode,
                "check_mode": check_mode,
                "cycle": active_cycle_title,
                "recipients": ["BROADCAST_ALL"] if effective_mode == "broadcast" else admin_uids,
                "items": expiring,
                "message": msg if success else "ไม่สามารถส่งข้อความ LINE ได้ กรุณาตรวจสอบการตั้งค่า LINE ID"
            }
    except Exception as e:
        print(f"Error in check_and_send_expiry_alerts: {e}")
        return {"sent": False, "count": 0, "error": str(e), "message": f"เกิดข้อผิดพลาดในการตรวจสอบวันหมดอายุ: {str(e)}"}


_last_run_tag = None


def _has_sent_expiry_today(today_tag: str) -> bool:
    global _last_run_tag
    if _last_run_tag == today_tag:
        return True
    try:
        from db import get_db_client
        sb = get_db_client()
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
        from db import get_db_client
        sb = get_db_client()
        if sb:
            sb.table("financial_records").insert({
                "company": "SYSTEM",
                "type": "SYSTEM_LOCK",
                "category": "LINE_EXPIRY_ALERT",
                "amount": 0,
                "ref": f"EXPIRY_{today_tag}",
                "date": today_tag,
                "detail": "Automatic 19:00 LINE Expiry Alert Lock (1st & 16th Cycle)"
            }).execute()
    except Exception as e:
        print(f"Mark expiry lock error: {e}")


def init_expiry_scheduler_thread():
    """
    CRON / Background Scheduler:
    - ตรวจสอบทุกนาทีด้วยเวลาประเทศไทย (ICT: UTC+7)
    - วันที่ 1 เวลา 19:00 น. -> ส่งแจ้งเตือนอัตโนมัติรอบเดือนปัจจุบัน (check_mode="cycle")
    - วันที่ 16 เวลา 19:00 น. -> ส่งแจ้งเตือนอัตโนมัติรอบเดือนถัดไป (check_mode="cycle")
    - ป้องกันการส่งซ้ำด้วย Shared Lock ใน PostgreSQL
    """
    def _scheduler_loop():
        global _last_run_tag
        now_init = datetime.utcnow() + timedelta(hours=7)
        init_tag = now_init.strftime("%Y-%m-%d")
        if now_init.hour > 19 or (now_init.hour == 19 and now_init.minute >= 5):
            _mark_sent_expiry_today(init_tag)

        while True:
            try:
                now_bkk = datetime.utcnow() + timedelta(hours=7)
                today_tag = now_bkk.strftime("%Y-%m-%d")

                # รันอัตโนมัติเฉพาะวันที่ 1 และ 16 เวลา 19:00 น. (ICT)
                if now_bkk.day in (1, 16) and now_bkk.hour == 19 and not _has_sent_expiry_today(today_tag):
                    _mark_sent_expiry_today(today_tag)
                    round_desc = "รอบวันที่ 1 (เดือนปัจจุบัน)" if now_bkk.day == 1 else "รอบวันที่ 16 (เดือนถัดไป)"
                    print(f"⏰ [{now_bkk.strftime('%H:%M')} ICT] Running automatic {round_desc} expiry check for {today_tag}...")
                    check_and_send_expiry_alerts(check_mode="cycle")
                time.sleep(60)
            except Exception as e:
                print(f"Expiry scheduler error: {e}")
                time.sleep(60)

    t = threading.Thread(target=_scheduler_loop, daemon=True, name="ExpiryScheduler")
    t.start()
