import os
import sys
import requests
from datetime import datetime, date, timedelta

# ตั้งค่า encoding บน Windows CP874
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

LINE_BROADCAST_URL = "https://api.line.me/v2/bot/message/broadcast"
LINE_DEFAULT_CHANNEL_ACCESS_TOKEN = (
    "V9Sc5Zmu4av4UzX+NbGNmkNCWM21aKchTJQw8ueOsGwilCWGv9c+AEqFtrKC4OG0fVwFy7l+"
    "wa5FVw0nrBGx8mz6zAHcdBY5hn4eBJApNwQ7oXOhSfgvzKHjxh6UGkqytCrLndQQAcVxcI+FFcGxMwdB04t89/1O/w1cDnyilFU="
)


def get_credentials():
    return os.environ.get("LINE_CHANNEL_ACCESS_TOKEN", LINE_DEFAULT_CHANNEL_ACCESS_TOKEN)


def _get_db():
    db_url = os.environ.get("DATABASE_URL")
    if db_url:
        from pg_client import PgClient
        return PgClient(db_url)
    from db import get_db_client
    return get_db_client()


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


def fetch_cars_from_database():
    """ดึงข้อมูลรถยนต์ทั้งหมดจากฐานข้อมูล"""
    try:
        sb = _get_db()
        res = sb.table("cars").select("*").execute()
        return res.data or []
    except Exception as e:
        print(f"❌ เกิดข้อผิดพลาดในการดึงข้อมูล: {e}")
        return []


def get_target_cycle_info(ref_date=None):
    """
    ตรรกะการแจ้งเตือนเอกสารหมดอายุรอบวันที่ 1 และ 16 ของเดือน:
    1. ทุกวันที่ 1 ของเดือน (ช่วงวันที่ 1..15): แจ้งเตือนเฉพาะรายการที่จะหมดอายุภายในเดือนปัจจุบัน (Current Month)
    2. ทุกวันที่ 16 ของเดือน (ช่วงวันที่ 16..สิ้นเดือน): แจ้งเตือนเฉพาะรายการที่จะหมดอายุภายในเดือนถัดไป (Next Month)
    * ปลอดภัยจากปัญหาข้ามปี (Year-end safe: เดือน 12 -> เดือน 1 ของปีถัดไป)
    """
    ref = ref_date or date.today()
    if ref.day < 16:
        round_day = 1
        target_year = ref.year
        target_month = ref.month
        round_name = f"รอบวันที่ 1 (หมดอายุเดือนนี้ {target_month:02d}/{target_year})"
        cycle_type = "current_month"
    else:
        round_day = 16
        if ref.month == 12:
            target_year = ref.year + 1
            target_month = 1
        else:
            target_year = ref.year
            target_month = ref.month + 1
        round_name = f"รอบวันที่ 16 (หมดอายุเดือนหน้า {target_month:02d}/{target_year})"
        cycle_type = "next_month"

    return {
        "round_day": round_day,
        "cycle_type": cycle_type,
        "target_year": target_year,
        "target_month": target_month,
        "target_ym": f"{target_year}-{target_month:02d}",
        "round_name": round_name
    }


def check_expiring_cars(cars_list, target_days=None, check_date=None):
    """
    ตรวจสอบรายการรถยนต์ที่เอกสาร (ภาษี, พ.ร.บ., ประกันภัย, ผ่อนรถ) ครบกำหนดแจ้งเตือนตามรอบ 1 และ 16:
    - วันที่ 1..15: รอบวันที่ 1 (หมดอายุเดือนปัจจุบัน)
    - วันที่ 16..สิ้นเดือน: รอบวันที่ 16 (หมดอายุเดือนถัดไป)
    :param cars_list: รายชื่อรถยนต์
    :param target_days: (compatibility)
    :param check_date: วันที่ใช้อ้างอิง
    :return: รายการที่เข้าเงื่อนไข
    """
    today = check_date or date.today()
    cycle = get_target_cycle_info(today)
    t_year = cycle["target_year"]
    t_month = cycle["target_month"]

    expiring_items = []

    for car in cars_list:
        plate = car.get("plate", "-")
        brand = car.get("brand", "").strip()
        model = car.get("model", "").strip()
        model_name = f"{brand} {model}".strip() if (brand or model) else "ไม่ระบุรุ่น"
        company = car.get("company", "").strip() or car.get("owner_company", "").strip()

        # ตรวจสอบ 4 รายการ: ภาษี, พ.ร.บ., ประกันภัย, ผ่อนรถ
        checks = [
            ("ภาษีประจำปี (Tax)", car.get("tax_expire_date") or car.get("tax_expiry"), float(car.get("tax_price") or car.get("tax_amount") or 1500.0)),
            ("พ.ร.บ. คุ้มครอง (ACT)", car.get("prb_expire_date") or car.get("act_expiry"), float(car.get("prb_price") or car.get("act_price") or 645.21)),
            ("ประกันภัย (Insurance)", car.get("insurance_expire_date") or car.get("ins_expiry"), float(car.get("insurance_premium") or car.get("ins_premium") or 12000.0))
        ]

        # ผ่อนรถ (ถ้ายังมีภาระผ่อน)
        if not car.get("is_debt_free"):
            inst_raw = car.get("payment_due_date") or car.get("installment_due_date")
            if inst_raw:
                checks.append(("ค่างวดผ่อนรถ (Installment)", inst_raw, float(car.get("installment_amount") or car.get("hp_installment") or 8500.0)))

        for doc_type, expiry_raw, amount in checks:
            exp_date = parse_date(expiry_raw)
            if not exp_date:
                continue

            # ตรวจสอบว่าตรงกับปีและเดือนเป้าหมายของรอบ
            # หรือกรณีรอบวันที่ 1: รวมรายการที่เกินกำหนด (overdue) ที่ยังไม่ได้รับการชำระด้วย
            is_in_target_month = (exp_date.year == t_year and exp_date.month == t_month)
            is_overdue_in_round1 = (cycle["round_day"] == 1 and exp_date < today)

            if is_in_target_month or is_overdue_in_round1:
                diff_days = (exp_date - today).days
                if diff_days < 0:
                    status_desc = f"🔴 เกินกำหนด {abs(diff_days)} วัน"
                elif diff_days == 0:
                    status_desc = "🔴 หมดอายุวันนี้!"
                elif diff_days <= 7:
                    status_desc = f"🟠 อีก {diff_days} วัน"
                else:
                    status_desc = f"🟡 อีก {diff_days} วัน"

                expiring_items.append({
                    "plate": plate,
                    "model": model_name,
                    "company": company,
                    "doc_type": doc_type,
                    "expiry_date": exp_date.strftime("%d/%m/%Y"),
                    "due_date_iso": exp_date.isoformat(),
                    "days_left": diff_days,
                    "amount": amount,
                    "status_desc": status_desc,
                    "cycle_round": cycle["round_name"]
                })

    return expiring_items


def build_alert_message(expiring_items, round_name=None):
    """สร้างข้อความแจ้งเตือนสำหรับส่งผ่าน LINE ตามรอบวันที่ 1 หรือ 16"""
    if not expiring_items:
        return ""

    cycle_title = round_name or (expiring_items[0].get("cycle_round") if expiring_items else "รอบวันที่ 1 และ 16")
    lines = [
        f"🚨 แจ้งเตือน: เอกสารต่ออายุและค่าใช้จ่ายรถยนต์",
        f"📅 {cycle_title}",
        "────────────────────",
        f"📋 พบรายการครบกำหนดแจ้งเตือน {len(expiring_items)} รายการ:"
    ]

    for idx, item in enumerate(expiring_items, 1):
        lines.append("")
        lines.append(f"{idx}. 🚗 ทะเบียน: {item['plate']} ({item['model']})")
        if item.get("company"):
            lines.append(f"   🏢 สังกัด: {item['company']}")
        lines.append(f"   📋 รายการ: {item['doc_type']}")
        lines.append(f"   📅 วันครบกำหนด: {item['expiry_date']}")
        lines.append(f"   💰 ยอดเงิน: ฿{item['amount']:,.2f}")
        lines.append(f"   ⏰ สถานะ: {item['status_desc']}")

    lines.append("")
    lines.append("────────────────────")
    lines.append("⏰ แจ้งเตือนอัตโนมัติรอบวันที่ 1 และ 16 ของเดือน (20:00 น.)")
    lines.append("💡 เมื่อชำระต่ออายุแล้ว สามารถบันทึกในระบบ SawasdeeRental (ตารางสรุปค่าใช้จ่ายประจำเดือน)")
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


def has_already_sent_today(today_tag):
    try:
        sb = _get_db()
        res = sb.table("financial_records").select("id").eq("type", "SYSTEM_LOCK").eq("category", "LINE_EXPIRY_ALERT").eq("date", today_tag).limit(1).execute()
        return bool(res.data and len(res.data) > 0)
    except Exception as e:
        print(f"⚠️ ตรวจสอบสถานะการส่งประจำวันไม่สำเร็จ: {e}")
        return False


def mark_sent_today(today_tag):
    try:
        sb = _get_db()
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
    - ตรวจสอบ Shared Lock บนฐานข้อมูล PostgreSQL ก่อน เพื่อป้องกันการส่งซ้ำระหว่าง Render / GitHub Actions
    - ถ้าไม่มีรายการที่เข้าเงื่อนไข (30 วัน, 7 วัน, 0 วัน) -> จะไม่ส่งข้อความ (ไม่กินโควต้า LINE)
    - ถ้ามีรายการ -> ส่งข้อความ Broadcast ไปหาพนักงานทุกคนเพียง 1 ครั้งต่อวัน
    """
    token = get_credentials()
    now_bkk = datetime.utcnow() + timedelta(hours=7)
    today = now_bkk.date()
    today_tag = today.strftime("%Y-%m-%d")
    print("=" * 60)
    print(f"🔍 เริ่มการตรวจสอบวันหมดอายุ พ.ร.บ. / ประกันภัย ประจำวันที่: {today.strftime('%d/%m/%Y')}")
    print("=" * 60)

    if not force_send and has_already_sent_today(today_tag):
        print(f"ℹ️ วันนี้ ({today_tag}) ระบบได้ส่งแจ้งเตือนเวลา 20:00 น. ไปเรียบร้อยแล้ว (ป้องกันการส่งซ้ำ)")
        return {
            "status": "already_sent_today",
            "count": 0,
            "message": "ส่งแจ้งเตือนของวันนี้ไปแล้ว"
        }

    cars = fetch_cars_from_database()
    print(f"📊 โหลดข้อมูลรถยนต์จากฐานข้อมูลทั้งหมด: {len(cars)} คัน")

    target_days = (30, 31, 7, 0)
    expiring_items = check_expiring_cars(cars, target_days=target_days, check_date=today)

    if not expiring_items:
        mark_sent_today(today_tag)
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

    # บันทึก Lock ลงฐานข้อมูลทันทีก่อนส่ง เพื่อป้องกันอีกเซิร์ฟเวอร์ส่งซ้ำ
    mark_sent_today(today_tag)
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
