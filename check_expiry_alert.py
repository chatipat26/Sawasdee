import os
import sys
import base64
import requests
from datetime import datetime, date, timedelta

# ตั้งค่า encoding บน Windows CP874
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# ข้อมูลการเชื่อมต่อ Supabase และ LINE
HARDCODED_SUPABASE_URL = "https://brhuafypxrqtoznsuhaa.supabase.co"
HARDCODED_SERVICE_KEY = base64.b64decode("c2Jfc2VjcmV0X05qd3JsQWl6WW4tOFdhSFE3QTRHM2dfR1VmTUFyWFI=").decode()

LINE_BROADCAST_URL = "https://api.line.me/v2/bot/message/broadcast"
LINE_DEFAULT_CHANNEL_ACCESS_TOKEN = (
    "V9Sc5Zmu4av4UzX+NbGNmkNCWM21aKchTJQw8ueOsGwilCWGv9c+AEqFtrKC4OG0fVwFy7l+"
    "wa5FVw0nrBGx8mz6zAHcdBY5hn4eBJApNwQ7oXOhSfgvzKHjxh6UGkqytCrLndQQAcVxcI+FFcGxMwdB04t89/1O/w1cDnyilFU="
)


def get_credentials():
    token = os.environ.get("LINE_CHANNEL_ACCESS_TOKEN", LINE_DEFAULT_CHANNEL_ACCESS_TOKEN)
    sb_url = os.environ.get("SUPABASE_URL", HARDCODED_SUPABASE_URL)
    sb_key = os.environ.get("SUPABASE_SERVICE_KEY", HARDCODED_SERVICE_KEY)
    
    # ลองอ่านจาก .streamlit/secrets.toml ถ้ามี
    try:
        import toml
        secrets_path = os.path.join(os.path.dirname(__file__), ".streamlit", "secrets.toml")
        if os.path.exists(secrets_path):
            sec = toml.load(secrets_path)
            sb_url = sec.get("SUPABASE_URL", sb_url)
            sb_key = sec.get("SUPABASE_SERVICE_KEY", sb_key)
            token = sec.get("LINE_CHANNEL_ACCESS_TOKEN", token)
    except Exception:
        pass

    return token, sb_url, sb_key


def parse_date(d_str):
    """แปลงข้อความวันที่เป็น datetime.date รองรับทั้ง DD/MM/YYYY และ YYYY-MM-DD"""
    if not d_str or str(d_str).strip() in ["-", "", "None"]:
        return None
    if isinstance(d_str, (datetime, date)):
        return d_str if isinstance(d_str, date) else d_str.date()
    
    d_clean = str(d_str).strip()
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y"):
        try:
            return datetime.strptime(d_clean, fmt).date()
        except ValueError:
            pass
    return None


def fetch_cars_from_supabase(sb_url, sb_key):
    """ดึงข้อมูลรถยนต์ทั้งหมดจาก Supabase"""
    try:
        from supabase import create_client
        sb = create_client(sb_url, sb_key)
        res = sb.table("cars").select("plate, brand, model, company, act_expiry, ins_expiry, status").execute()
        return res.data or []
    except Exception as e:
        print(f"❌ เกิดข้อผิดพลาดในการดึงข้อมูลจาก Supabase: {e}")
        return []


def check_expiring_cars(cars_list, target_days=(30, 31, 7, 0), check_date=None):
    """
    ตรวจสอบรายการรถยนต์ที่ พ.ร.บ. หรือ ประกันภัย ครบกำหนดแจ้งเตือน
    :param cars_list: รายชื่อรถยนต์
    :param target_days: จำนวนวันที่เหลือก่อนหมดอายุที่ต้องการแจ้งเตือน เช่น (30, 31, 7, 0)
    :param check_date: วันที่ใช้อ้างอิง (ค่าเริ่มต้นคือวันนี้)
    :return: รายการที่เข้าเงื่อนไข
    """
    today = check_date or date.today()
    expiring_items = []

    for car in cars_list:
        plate = car.get("plate", "-")
        brand = car.get("brand", "").strip()
        model = car.get("model", "").strip()
        model_name = f"{brand} {model}".strip() if (brand or model) else "ไม่ระบุรุ่น"
        company = car.get("company", "").strip()

        # ตรวจสอบทั้ง พ.ร.บ., ประกันภัย และ ภาษีรถยนต์
        act_raw = car.get("act_expiry")
        tax_raw = car.get("tax_expiry")
        checks = [
            ("พ.ร.บ.", act_raw),
            ("ประกันภัย", car.get("ins_expiry"))
        ]
        if tax_raw and str(tax_raw).strip() != str(act_raw or "").strip():
            checks.append(("ภาษีรถยนต์", tax_raw))

        for doc_type, expiry_raw in checks:
            exp_date = parse_date(expiry_raw)
            if not exp_date:
                continue

            diff_days = (exp_date - today).days

            # เงื่อนไข: ตรงกับ 30-31 วัน (1 เดือน), 7 วัน, หรือวันหมดอายุ (0 วัน)
            if diff_days in target_days:
                if diff_days in (30, 31):
                    status_desc = f"🟡 ล่วงหน้า 30 วัน (อีก {diff_days} วัน)"
                elif diff_days == 7:
                    status_desc = "🟠 ล่วงหน้า 7 วัน (อีก 1 สัปดาห์)"
                elif diff_days == 0:
                    status_desc = "🔴 หมดอายุวันนี้!"
                else:
                    status_desc = f"⚠️ อีก {diff_days} วัน"

                expiring_items.append({
                    "plate": plate,
                    "model": model_name,
                    "company": company,
                    "doc_type": doc_type,
                    "expiry_date": exp_date.strftime("%d/%m/%Y"),
                    "days_left": diff_days,
                    "status_desc": status_desc
                })

    return expiring_items


def build_alert_message(expiring_items):
    """สร้างข้อความแจ้งเตือนสำหรับส่งผ่าน LINE"""
    if not expiring_items:
        return ""

    lines = [
        "🚨 แจ้งเตือน: พ.ร.บ. / ประกันภัยรถยนต์",
        "────────────────────",
        f"📋 พบรายการครบกำหนดแจ้งเตือน {len(expiring_items)} รายการ:"
    ]

    for idx, item in enumerate(expiring_items, 1):
        lines.append("")
        lines.append(f"{idx}. 🚗 ทะเบียน: {item['plate']}")
        lines.append(f"   🚘 รุ่น: {item['model']}")
        if item['company']:
            lines.append(f"   🏢 สังกัด: {item['company']}")
        lines.append(f"   📋 รายการ: {item['doc_type']}")
        lines.append(f"   📅 วันหมดอายุ: {item['expiry_date']}")
        lines.append(f"   ⏰ สถานะ: {item['status_desc']}")

    lines.append("")
    lines.append("────────────────────")
    lines.append("⏰ แจ้งเตือนประจำวันเวลา 20:00 น.")
    lines.append("💡 หากต่ออายุแล้ว สามารถกด 'อัปเดตต่ออายุ' ได้ที่ระบบ SawasdeeRental (เมนู Fleet Status)")
    lines.append("ระบบบริหารจัดการ SawasdeeRental")

    return "\n".join(lines)


def send_line_broadcast(message, channel_access_token, to_user_id=None):
    """ส่งข้อความ Direct Push ตรงไปยังแอดมิน (หรือผู้รับที่ระบุ) เพื่อประหยัดโควต้าข้อความ LINE"""
    if not message or not channel_access_token:
        return False

    target_uid = to_user_id or os.environ.get("LINE_TARGET_USER_ID", "Ub7b6353ba826c0ba5c3d9fac3531ef77")
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {channel_access_token}"
    }

    payload = {
        "to": target_uid,
        "messages": [
            {
                "type": "text",
                "text": message
            }
        ]
    }

    try:
        res = requests.post("https://api.line.me/v2/bot/message/push", headers=headers, json=payload, timeout=10)
        if res.status_code == 200:
            print(f"✅ ส่งข้อความแจ้งเตือนตรงถึงแอดมิน ({target_uid}) สำเร็จ (HTTP 200 OK)")
            return True
        else:
            print(f"⚠️ LINE Push Error: HTTP {res.status_code} - {res.text}")
            return False
    except Exception as e:
        print(f"❌ เกิดข้อผิดพลาดขณะส่ง LINE Push: {e}")
        return False


def has_already_sent_today(sb_url, sb_key, today_tag):
    try:
        from supabase import create_client
        sb = create_client(sb_url, sb_key)
        res = sb.table("financial_records").select("id").eq("type", "SYSTEM_LOCK").eq("category", "LINE_EXPIRY_ALERT").eq("date", today_tag).limit(1).execute()
        return bool(res.data and len(res.data) > 0)
    except Exception as e:
        print(f"⚠️ ตรวจสอบสถานะการส่งประจำวันไม่สำเร็จ: {e}")
        return False


def mark_sent_today(sb_url, sb_key, today_tag):
    try:
        from supabase import create_client
        sb = create_client(sb_url, sb_key)
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
        print(f"⚠️ บันทึกสถานะการส่งประจำวันไม่สำเร็จ: {e}")


def run_daily_check(force_send=False):
    """
    ฟังก์ชันหลักในการตรวจสอบและส่งแจ้งเตือน:
    - ตรวจสอบ Shared Lock บน Supabase ก่อน เพื่อป้องกันการส่งซ้ำระหว่าง Render / GitHub Actions / Streamlit
    - ถ้าไม่มีรายการที่เข้าเงื่อนไข (30 วัน, 7 วัน, 0 วัน) -> จะไม่ส่งข้อความ (ไม่กินโควต้า LINE)
    - ถ้ามีรายการ -> ส่งข้อความ Broadcast ไปหาพนักงานทุกคนเพียง 1 ครั้งต่อวัน
    """
    token, sb_url, sb_key = get_credentials()
    now_bkk = datetime.utcnow() + timedelta(hours=7)
    today = now_bkk.date()
    today_tag = today.strftime("%Y-%m-%d")
    print("=" * 60)
    print(f"🔍 เริ่มการตรวจสอบวันหมดอายุ พ.ร.บ. / ประกันภัย ประจำวันที่: {today.strftime('%d/%m/%Y')}")
    print("=" * 60)

    if not force_send and has_already_sent_today(sb_url, sb_key, today_tag):
        print(f"ℹ️ วันนี้ ({today_tag}) ระบบได้ส่งแจ้งเตือนเวลา 20:00 น. ไปเรียบร้อยแล้ว (ป้องกันการส่งซ้ำ)")
        return {
            "status": "already_sent_today",
            "count": 0,
            "message": "ส่งแจ้งเตือนของวันนี้ไปแล้ว"
        }

    cars = fetch_cars_from_supabase(sb_url, sb_key)
    print(f"📊 โหลดข้อมูลรถยนต์จาก Supabase ทั้งหมด: {len(cars)} คัน")

    target_days = (30, 31, 7, 0)
    expiring_items = check_expiring_cars(cars, target_days=target_days, check_date=today)

    if not expiring_items:
        mark_sent_today(sb_url, sb_key, today_tag)
        print("ℹ️ ไม่มีรายการ พ.ร.บ. หรือ ประกันภัย ที่ตรงกับเงื่อนไขแจ้งเตือนในวันนี้ (ล่วงหน้า 30 วัน, 7 วัน, หรือวันหมดอายุ)")
        print("🛑 ระบบจะไม่ส่งข้อความทาง LINE (เพื่อประหยัดโควต้าข้อความ)")
        return {
            "status": "skipped",
            "count": 0,
            "message": "ไม่มีรายการครบกำหนดแจ้งเตือนในวันนี้"
        }

    print(f"🔔 พบรายการครบกำหนดแจ้งเตือนทั้งหมด: {len(expiring_items)} รายการ")
    for item in expiring_items:
        print(f"  - [{item['doc_type']}] ทะเบียน: {item['plate']} ({item['model']}) -> {item['status_desc']} (หมดอายุ {item['expiry_date']})")

    # บันทึก Lock ลง Supabase ทันทีก่อนส่ง เพื่อป้องกันอีกเซิร์ฟเวอร์ส่งซ้ำ
    mark_sent_today(sb_url, sb_key, today_tag)
    alert_msg = build_alert_message(expiring_items)
    success = send_line_broadcast(alert_msg, token)

    return {
        "status": "sent" if success else "failed",
        "count": len(expiring_items),
        "items": expiring_items,
        "message": alert_msg
    }


if __name__ == "__main__":
    result = run_daily_check()
    print("=" * 60)
    print(f"🏁 ผลการทำงาน: {result.get('status')} (จำนวน: {result.get('count')} รายการ)")
