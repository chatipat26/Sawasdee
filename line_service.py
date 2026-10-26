import os
import sys
import threading
import time
import requests
from datetime import datetime, date, timedelta
from typing import Optional

LINE_BROADCAST_URL = "https://api.line.me/v2/bot/message/broadcast"
LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push"
LINE_REPLY_URL = "https://api.line.me/v2/bot/message/reply"

LINE_DEFAULT_CHANNEL_ACCESS_TOKEN = (
    "V9Sc5Zmu4av4UzX+NbGNmkNCWM21aKchTJQw8ueOsGwilCWGv9c+AEqFtrKC4OG0fVwFy7l+"
    "wa5FVw0nrBGx8mz6zAHcdBY5hn4eBJApNwQ7oXOhSfgvzKHjxh6UGkqytCrLndQQAcVxcI+FFcGxMwdB04t89/1O/w1cDnyilFU="
)
LINE_TARGET_USER_ID = "Ub7b6353ba826c0ba5c3d9fac3531ef77"

# โหมดผู้รับแจ้งเตือนวันหมดอายุ พ.ร.บ./ประกันภัย/ภาษี:
# - "admin"    = ส่งหาแอดมินเท่านั้น (ค่าเริ่มต้นปัจจุบัน)
# - "customer" = ส่งหาลูกค้าผู้เช่า/เจ้าของรถโดยตรง (สำหรับเปิดใช้งานในอนาคต)
EXPIRY_ALERT_RECIPIENT_MODE = os.environ.get("EXPIRY_ALERT_RECIPIENT_MODE", "admin")


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


def get_admin_line_id() -> str:
    """
    ดึง LINE User ID ของแอดมินหลัก (ตรวจสอบจากตาราง users ก่อน หากไม่มีใช้ LINE_TARGET_USER_ID)
    """
    _, default_admin_uid = get_line_credentials()
    try:
        from db import store
        admin_u = store.users.get("admin") or store.users.get("Admin")
        if admin_u and str(admin_u.get("line_user_id") or "").strip():
            return str(admin_u.get("line_user_id")).strip()
        for u in store.users.values():
            if str(u.get("role") or "").lower() == "admin" and str(u.get("line_user_id") or "").strip():
                return str(u.get("line_user_id")).strip()
    except Exception:
        pass
    return default_admin_uid


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


def send_line_broadcast_message(message: str, channel_access_token: str = None) -> bool:
    """
    [ปิดการใช้ Broadcast อัตโนมัติเพื่อประหยัดข้อความ]
    เปลี่ยนให้ส่งตรงหาแอดมินแทน ยกเว้นกรณีเรียกใช้งานเฉพาะกิจ
    """
    return send_line_push_message(message, to_user_id=get_admin_line_id(), channel_access_token=channel_access_token)


def send_line_push_message(message: str, to_user_id: str = None, channel_access_token: str = None) -> bool:
    """
    ส่งข้อความแบบ Direct Push (1:1) ไปยังผู้รับที่ระบุเท่านั้น (หักโควต้าเพียง 1 ข้อความ/ครั้ง)
    ห้าม Fallback ไปเป็น Broadcast เด็ดขาดเพื่อป้องกันโควต้ารั่วไหล
    """
    token, _ = get_line_credentials()
    act = channel_access_token or token
    target_uid = (to_user_id or "").strip() or get_admin_line_id()
    if not act or not target_uid:
        return False
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
        print(f"LINE Direct Push Error (to={target_uid}): HTTP {resp.status_code} - {resp.text}")
        return False
    except Exception as e:
        print(f"Error sending LINE push: {e}")
        return False


def send_line_push_async(message: str, to_user_id: str = None):
    """
    ส่งข้อความแบบ asynchronous ไปยัง to_user_id เท่านั้น (หากไม่ระบุจะส่งตรงหาแอดมิน ไม่ Broadcast)
    """
    target_uid = (to_user_id or "").strip() or get_admin_line_id()

    def _worker():
        send_line_push_message(message, to_user_id=target_uid)

    try:
        t = threading.Thread(target=_worker, daemon=True)
        t.start()
    except Exception:
        _worker()


def send_line_to_admin_async(message: str):
    """
    ส่งข้อความแจ้งเตือนตรงเข้าแอดมินเท่านั้น (เช่น เงินมัดจำ, ชำระค่าเช่า, ค่าใช้จ่าย, วันหมดอายุ)
    """
    admin_uid = get_admin_line_id()
    if not admin_uid:
        print("[LINE] No Admin LINE User ID configured.")
        return
    send_line_push_async(message, to_user_id=admin_uid)


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
    แจ้งเตือนใบงานรับรถ-ส่งรถ: ยิงตรงหา 'เจ้าของงาน (ผู้รับผิดชอบ)' เท่านั้น!
    """
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
        # ยิงตรงหาเจ้าของงานเท่านั้น!
        send_line_to_worker_async("\n".join(lines), worker_val)
    except Exception as e:
        print(f"Error notifying line work order: {e}")


def notify_line_maintenance(record: dict):
    """
    แจ้งเตือนเมื่อออกใบงานซ่อมบำรุง / ต่อทะเบียน-ประกัน:
    ยิงตรงหา 'เจ้าของงาน (assigned_worker)' เท่านั้น!
    """
    if not record:
        return
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
    แจ้งเตือนเมื่อตรวจรับรถ / ปิดงานซ่อมบำรุง และบันทึกค่าใช้จ่ายจริง:
    ยิงตรงเข้า 'แอดมิน (Admin)' เท่านั้น!
    """
    if not record:
        return
    try:
        mnt_id = record.get("id", "-")
        car_plate = record.get("car_id", "-")
        car_brand = str(record.get("car_brand", "")).strip()
        car_model = str(record.get("car_model", "")).strip()
        car_name = f"{car_brand} {car_model}".strip()
        car_display = f"{car_name} (ทะเบียน {car_plate})" if car_name else f"ทะเบียน {car_plate}"

        order_type = record.get("order_type", "ซ่อมบำรุงทั่วไป / เช็คระยะ")
        is_renewal = any(k in str(order_type) for k in ["ต่อทะเบียน", "พ.ร.บ.", "พรบ", "ประกัน", "ภาษี"])
        title = "🏁 เสร็จสิ้น: ปิดงานต่อทะเบียน/ประกัน (บันทึกค่าใช้จ่าย)" if is_renewal else "🏁 เสร็จสิ้น: ปิดงานซ่อมบำรุง (บันทึกค่าใช้จ่าย)"

        actual_cost = float(record.get("actual_cost") or record.get("cost") or 0)
        cost_str = f"{actual_cost:,.2f} บาท"
        worker = record.get("assigned_worker") or "-"
        garage = record.get("service_center") or "-"
        notes = record.get("completion_notes") or "ตรวจรับรถเรียบร้อย สภาพสมบูรณ์พร้อมใช้งาน"

        lines = [
            f"✅ {title}",
            "────────────────────",
            f"📋 เลขที่ใบงาน: {mnt_id}",
            f"🚗 ทะเบียนรถ: {car_display}",
            f"🏢 อู่/ศูนย์บริการ: {garage}",
            f"👤 ผู้รับผิดชอบ/ตรวจรับ: {worker}",
            f"💸 ค่าใช้จ่ายจริง: ฿{cost_str}",
            f"📝 ผลการตรวจรับ/ส่งงาน: {notes}"
        ]
        if record.get("new_act_expiry"):
            lines.append(f"📅 วันหมดอายุ พ.ร.บ. ใหม่: {record['new_act_expiry']}")
        if record.get("new_ins_expiry"):
            lines.append(f"📑 วันหมดอายุ ประกันภัย ใหม่: {record['new_ins_expiry']}")
        if record.get("policy_no"):
            lines.append(f"📄 เลขที่กรมธรรม์/ใบเสร็จ: {record['policy_no']}")
        lines.extend([
            "🟢 สถานะรถยนต์: ปลดกลับเป็น 'ว่างพร้อมใช้งาน'",
            "────────────────────",
            "ระบบบริหารจัดการ SawasdeeRental (แจ้งเฉพาะแอดมิน)"
        ])
        # ยิงเข้าเพียงแอดมินเท่านั้น!
        send_line_to_admin_async("\n".join(lines))
    except Exception as e:
        print(f"Error notifying LINE close maintenance: {e}")


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
    แจ้งเตือนเมื่อบันทึกรับเงินมัดจำ / ชำระค่าเช่า:
    ยิงตรงเข้า 'แอดมิน (Admin)' เท่านั้น!
    """
    if not booking_obj:
        return
    try:
        bk_id = booking_obj.get("booking_id", "-")
        car_plate = booking_obj.get("car_id", "-")
        cust_name = booking_obj.get("customer", "-")

        if is_settle_only:
            title = "💰 แจ้งเตือน: บันทึกรับชำระค่าเช่าคงเหลือ"
            amount_label = "ยอดชำระค่าเช่า"
        elif also_rent:
            title = "💳 แจ้งเตือน: บันทึกรับเงินมัดจำ & ชำระค่าเช่า"
            amount_label = "ยอดเงินมัดจำ"
        else:
            title = "💳 แจ้งเตือน: บันทึกรับเงินมัดจำประกันสัญญา"
            amount_label = "ยอดเงินมัดจำ"

        lines = [
            f"🔔 {title}",
            "────────────────────",
            f"📋 เลขที่การจอง: {bk_id}",
            f"🚗 ทะเบียนรถ: {car_plate}",
            f"👤 ลูกค้า: {cust_name}",
            f"💵 {amount_label}: ฿{float(amount):,.2f}",
            f"💳 ช่องทางชำระ: {method}"
        ]
        if ref:
            lines.append(f"🧾 เลขที่ Ref / สลิป: {ref}")
        if also_rent and not is_settle_only:
            net_p = float(booking_obj.get("net_price", 0.0))
            lines.append(f"💰 ชำระค่าเช่าสุทธิ: ฿{net_p:,.2f} (ชำระเต็มจำนวน)")
        if slip_url:
            lines.append("📎 หลักฐานการโอน: แนบรูปสลิปเรียบร้อยแล้ว")
        lines.extend([
            "────────────────────",
            "ระบบบริหารจัดการ SawasdeeRental (แจ้งเฉพาะแอดมิน)"
        ])
        # ยิงเข้าเพียงแอดมินเท่านั้น!
        send_line_to_admin_async("\n".join(lines))
    except Exception as e:
        print(f"Error notifying LINE deposit: {e}")


def notify_line_expense(expense_obj: dict):
    """
    แจ้งเตือนเมื่อบันทึกค่าใช้จ่าย (รายจ่าย):
    ยิงตรงเข้า 'แอดมิน (Admin)' เท่านั้น!
    """
    if not expense_obj:
        return
    try:
        cat = expense_obj.get("category", "ค่าใช้จ่ายทั่วไป")
        amt = float(expense_obj.get("amount", 0.0) or 0.0)
        ref = expense_obj.get("ref", "-")
        comp = expense_obj.get("company", "-")
        detail = expense_obj.get("detail", "-")
        d_str = _fmt_dmy(expense_obj.get("date"))

        lines = [
            "💸 แจ้งเตือน: บันทึกรายการค่าใช้จ่าย (Expense)",
            "────────────────────",
            f"📂 หมวดหมู่: {cat}",
            f"💰 จำนวนเงิน: ฿{amt:,.2f}",
            f"📋 อ้างอิง/ทะเบียน: {ref}",
            f"🏢 บริษัท: {comp}",
            f"📅 วันที่: {d_str}",
            f"📝 รายละเอียด: {detail}",
            "────────────────────",
            "ระบบบริหารจัดการ SawasdeeRental (แจ้งเฉพาะแอดมิน)"
        ]
        send_line_to_admin_async("\n".join(lines))
    except Exception as e:
        print(f"Error notifying LINE expense: {e}")


def check_and_send_expiry_alerts(cars_dict=None, target_days=(30, 31, 7, 0), recipient_mode: str = None):
    """
    แจ้งเตือนวันหมดอายุ พ.ร.บ. / ประกันภัย:
    - ปัจจุบัน (recipient_mode="admin"): ยิงตรงหาแอดมินเท่านั้น (ไม่ใช้ Broadcast)
    - อนาคต (recipient_mode="customer"): รองรับการยิงแยกหาลูกค้าของรถแต่ละคันโดยตรง
    """
    try:
        from check_expiry_alert import check_expiring_cars, build_alert_message
        mode = (recipient_mode or EXPIRY_ALERT_RECIPIENT_MODE or "admin").strip().lower()
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
            return {"sent": False, "count": 0, "recipient_mode": mode, "message": "ไม่มีรายการ พ.ร.บ. หรือ ประกันภัย ครบกำหนดแจ้งเตือนในวันนี้"}

        if mode == "customer":
            # โหมดอนาคต: แยกส่งหาลูกค้าของแต่ละคัน หากไม่มี LINE ID ของลูกค้าให้ส่งเข้าแอดมิน
            grouped_by_target = {}
            admin_uid = get_admin_line_id()
            for item in expiring:
                cust_uid = resolve_customer_line_id_for_car(item.get("plate")) or admin_uid
                grouped_by_target.setdefault(cust_uid, []).append(item)

            any_sent = False
            for uid, items_for_uid in grouped_by_target.items():
                sub_msg = build_alert_message(items_for_uid)
                if send_line_push_message(sub_msg, to_user_id=uid):
                    any_sent = True
            msg = build_alert_message(expiring)
            return {"sent": any_sent, "count": len(expiring), "recipient_mode": mode, "items": expiring, "message": msg}
        else:
            # โหมดปัจจุบัน: ส่งตรงหาแอดมินเท่านั้น (1 ข้อความ)
            msg = build_alert_message(expiring)
            admin_uid = get_admin_line_id()
            success = send_line_push_message(msg, to_user_id=admin_uid)
            return {"sent": success, "count": len(expiring), "recipient_mode": "admin", "items": expiring, "message": msg}
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
