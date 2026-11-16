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


def _safe_float(val, default=0.0):
    """แปลงค่าเป็น float อย่างปลอดภัย ไม่พังเมื่อเจอ None, '', หรือข้อความ"""
    if val is None:
        return default
    try:
        s = str(val).replace(",", "").strip()
        if not s or s.lower() in ("-", "none", "null", "undefined"):
            return default
        return float(s)
    except Exception:
        return default


def parse_date(d_str):
    """แปลงข้อความวันที่เป็น datetime.date รองรับทั้ง DD/MM/YYYY และ YYYY-MM-DD แบบ Null-safe"""
    if not d_str:
        return None
    if isinstance(d_str, (datetime, date)):
        return d_str if isinstance(d_str, date) else d_str.date()

    d_clean = str(d_str).strip()
    if not d_clean or d_clean in ("-", "None", "null", "undefined"):
        return None

    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y"):
        try:
            return datetime.strptime(d_clean[:10], fmt).date()
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
    ตรรกะการแจ้งเตือนเอกสารหมดอายุรอบวันที่ 1 และ 16 ของเดือน + แจ้งเตือนรายสัปดาห์ (Weekly Warning):
    1. ทุกวันที่ 1 ของเดือน (ช่วงวันที่ 1..15): แจ้งเตือนเฉพาะรายการที่จะหมดอายุภายในเดือนปัจจุบัน (Current Month)
    2. ทุกวันที่ 16 ของเดือน (ช่วงวันที่ 16..สิ้นเดือน): แจ้งเตือนเฉพาะรายการที่จะหมดอายุภายในเดือนถัดไป (Next Month)
    3. แจ้งเตือนรายสัปดาห์ (Weekly Warning): ครอบคลุมรายการที่หมดอายุในสัปดาห์ปัจจุบัน (Monday ถึง Sunday) ของวันที่ตรวจสอบ
    * ปลอดภัยจากปัญหาข้ามปี (Year-end safe: เดือน 12 -> เดือน 1 ของปีถัดไป)
    """
    if not ref_date:
        now_bkk = datetime.utcnow() + timedelta(hours=7)
        ref = now_bkk.date()
    elif isinstance(ref_date, datetime):
        ref = ref_date.date()
    else:
        ref = ref_date

    # สัปดาห์ปัจจุบัน (Monday ถึง Sunday)
    start_of_week = ref - timedelta(days=ref.weekday())  # Monday = 0
    end_of_week = start_of_week + timedelta(days=6)      # Sunday = 6

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
        "ref_date": ref,
        "target_year": target_year,
        "target_month": target_month,
        "target_ym": f"{target_year}-{target_month:02d}",
        "round_name": round_name,
        "week_start": start_of_week,
        "week_end": end_of_week,
        "week_desc": f"{start_of_week.strftime('%d/%m/%Y')} - {end_of_week.strftime('%d/%m/%Y')}"
    }


def check_expiring_cars(cars_list, target_days=None, check_date=None, check_mode="weekly"):
    """
    ตรวจสอบรายการรถยนต์ที่เอกสาร (ภาษี, พ.ร.บ., ประกันภัย) ครบกำหนดแจ้งเตือน:
    - check_mode == "weekly": คัดกรองเฉพาะรถที่หมดอายุภายในสัปดาห์ปัจจุบัน (Monday ถึง Sunday) สำหรับปุ่มกดหน้าเว็บ
    - check_mode == "cycle": คัดกรองตามรอบวันที่ 1 (เดือนปัจจุบัน) หรือรอบวันที่ 16 (เดือนถัดไป) สำหรับ CRON Scheduler อัตโนมัติ
    - check_mode == "all": ตรวจสอบรวมทั้งสองเงื่อนไข
    :param cars_list: รายชื่อรถยนต์
    :param target_days: (compatibility)
    :param check_date: วันที่ใช้อ้างอิง (ค่าเริ่มต้นเป็นเวลาปัจจุบันประเทศไทย)
    :param check_mode: "weekly" (ค่าเริ่มต้นสำหรับปุ่มกด), "cycle" (สำหรับรอบ 1/16), หรือ "all"
    :return: รายการที่เข้าเงื่อนไข เรียงตามความเร่งด่วน
    """
    cycle = get_target_cycle_info(check_date)
    today = cycle["ref_date"]
    t_year = cycle["target_year"]
    t_month = cycle["target_month"]
    w_start = cycle["week_start"]
    w_end = cycle["week_end"]

    expiring_items = []

    def _is_paid(status, flag):
        if flag is True:
            return True
        st = str(status or "").strip().lower()
        return st in ("ชำระแล้ว", "paid", "true")

    for car in (cars_list or []):
        if not car or not isinstance(car, dict):
            continue

        plate = str(car.get("plate") or car.get("car_id") or "-").strip()
        brand = str(car.get("brand") or "").strip()
        model = str(car.get("model") or "").strip()
        model_name = f"{brand} {model}".strip() if (brand or model) else "ไม่ระบุรุ่น"
        company = str(car.get("company") or car.get("owner_company") or "").strip()

        # ตรวจสอบ 3 หมวดหลักเท่านั้น: ภาษีประจำปี, พ.ร.บ., ประกันภัย (ตามข้อกำหนดระบบ)
        checks = [
            (
                "ภาษีประจำปี (Tax)",
                car.get("tax_expire_date") or car.get("tax_expiry"),
                _safe_float(car.get("tax_price") or car.get("tax_amount"), 1500.0),
                _is_paid(car.get("tax_status"), car.get("tax_paid"))
            ),
            (
                "พ.ร.บ. คุ้มครอง (ACT)",
                car.get("prb_expire_date") or car.get("act_expiry"),
                _safe_float(car.get("prb_price") or car.get("act_price"), 645.21),
                _is_paid(car.get("act_status") or car.get("prb_status"), car.get("act_paid") or car.get("prb_paid"))
            ),
            (
                "ประกันภัย (Insurance)",
                car.get("insurance_expire_date") or car.get("ins_expiry"),
                _safe_float(car.get("insurance_premium") or car.get("ins_premium"), 12000.0),
                _is_paid(car.get("insurance_status") or car.get("ins_status"), car.get("insurance_paid") or car.get("ins_paid"))
            )
        ]

        # หมายเหตุ: ตามข้อกำหนดระบบ จำกัดเฉพาะรายการ ประกันภัย, พ.ร.บ., และภาษี เท่านั้น
        # (ค่างวดผ่อนรถ, เช็คระยะ, ค้างชำระ ให้ Comment out ปิดการแจ้งเตือนไว้)
        # if not car.get("is_debt_free"):
        #     inst_raw = car.get("payment_due_date") or car.get("installment_due_date")
        #     if inst_raw and str(inst_raw).strip() not in ("", "-", "None", "null", "undefined"):
        #         checks.append((
        #             "ค่างวดผ่อนรถ (Installment)",
        #             inst_raw,
        #             _safe_float(car.get("installment_amount") or car.get("hp_installment"), 8500.0),
        #             _is_paid(car.get("installment_status") or car.get("payment_status"), car.get("installment_paid"))
        #         ))

        for doc_type, expiry_raw, amount, paid_status in checks:
            if paid_status:
                continue  # ชำระแล้ว ข้ามไป

            # Null-check ป้องกัน None, ค่าว่าง "", "-", "None", "null"
            if not expiry_raw or str(expiry_raw).strip() in ("", "-", "None", "null", "undefined"):
                continue  # ไม่มีข้อมูลวันหมดอายุ ข้ามคันนี้/รายการนี้ไปเลย

            exp_date = parse_date(expiry_raw)
            if not exp_date:
                continue

            # ตรวจสอบเงื่อนไขตาม check_mode:
            # 1. is_in_current_week: ตกอยู่ในสัปดาห์ปัจจุบัน จันทร์-อาทิตย์ (สำหรับปุ่มกด manual)
            # 2. is_in_target_cycle: ตรงรอบเดือนเป้าหมาย (Current Month รอบ 1, Next Month รอบ 16 สำหรับ auto cron)
            # 3. is_overdue_in_round1: เกินกำหนดในรอบวันที่ 1
            is_in_current_week = (w_start <= exp_date <= w_end)
            is_in_target_cycle = (exp_date.year == t_year and exp_date.month == t_month)
            is_overdue_in_round1 = (cycle["round_day"] == 1 and exp_date < today)

            mode_lower = str(check_mode or "weekly").lower()
            if mode_lower == "weekly":
                is_matched = is_in_current_week
            elif mode_lower == "cycle":
                is_matched = (is_in_target_cycle or is_overdue_in_round1)
            else:
                is_matched = (is_in_target_cycle or is_overdue_in_round1 or is_in_current_week)

            if is_matched:
                diff_days = (exp_date - today).days
                if diff_days < 0:
                    status_desc = f"🔴 เกินกำหนด {abs(diff_days)} วัน"
                    alert_category = "overdue"
                elif is_in_current_week:
                    if diff_days == 0:
                        status_desc = "🔴 หมดอายุวันนี้!"
                    else:
                        status_desc = f"⚡ สัปดาห์นี้ (อีก {diff_days} วัน)"
                    alert_category = "weekly_warning"
                elif diff_days <= 7:
                    status_desc = f"🟠 อีก {diff_days} วัน"
                    alert_category = "near_due"
                else:
                    status_desc = f"🟡 อีก {diff_days} วัน"
                    alert_category = "cycle_due"

                cycle_label = f"รอบสัปดาห์นี้ ({cycle['week_desc']})" if mode_lower == "weekly" else cycle["round_name"]

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
                    "alert_category": alert_category,
                    "cycle_round": cycle_label
                })

    # เรียงลำดับรายการตามความเร่งด่วน (ใกล้หมดอายุหรือเกินกำหนดขึ้นก่อน)
    expiring_items.sort(key=lambda x: (x["days_left"], x["plate"]))
    return expiring_items


def build_alert_message(expiring_items, cycle_info=None, header_title=None):
    """
    สร้างข้อความแจ้งเตือนสำหรับส่งผ่าน LINE:
    - หากมีรายการ (count > 0): แสดงรายการรถ ทะเบียน เอกสาร วันหมดอายุ สั้นกระชับ
    - หากไม่มีรายการ (count == 0): ส่ง Fallback Message: "ไม่มีรถครบกำหนดต่ออายุประกัน พ.ร.บ. ภาษี ในรอบนี้"
    """
    round_name = header_title or (cycle_info.get("round_name") if cycle_info else None) or "รอบสัปดาห์นี้"

    # กรณีไม่มีรายการ (count == 0) -> ประกอบ Fallback Message ตรงตามข้อกำหนด
    if not expiring_items or len(expiring_items) == 0:
        return (
            "🚨 แจ้งเตือน: เอกสารรถยนต์ครบกำหนดต่ออายุ\n"
            f"📅 {round_name}\n"
            "────────────────────\n"
            "ไม่มีรถครบกำหนดต่ออายุประกัน พ.ร.บ. ภาษี ในรอบนี้\n"
            "────────────────────\n"
            "ระบบบริหารจัดการ SawasdeeRental"
        )

    lines = [
        "🚨 แจ้งเตือน: เอกสารรถยนต์ครบกำหนดต่ออายุ",
        f"📅 {round_name}",
        "────────────────────",
        f"📋 รายการที่ต้องต่ออายุ ({len(expiring_items)} รายการ):"
    ]

    for idx, item in enumerate(expiring_items, 1):
        lines.append("")
        lines.append(f"{idx}. 🚗 ทะเบียน: {item.get('plate', '-')} ({item.get('model', 'ไม่ระบุรุ่น')})")
        lines.append(f"   📋 รายการ: {item.get('doc_type', '-')}")
        lines.append(f"   📅 หมดอายุ: {item.get('expiry_date', '-')} ({item.get('status_desc', '-')})")

    lines.append("")
    lines.append("────────────────────")
    lines.append("💡 ตรวจสอบและบันทึกการชำระได้ที่ระบบ SawasdeeRental")

    return "\n".join(lines)


def send_line_broadcast(message, channel_access_token, to_user_id=None):
    """
    ส่งข้อความ Direct Push ตรงไปยังแอดมินหรือรายชื่อผู้รับที่ระบุ:
    - รองรับผู้รับหลายคน (Comma-separated string หรือ list)
    - มี try-except ระดับบุคคล หาก ID ใดมีปัญหาจะไม่กระทบผู้รับคนอื่น
    """
    if not message or not channel_access_token:
        return False

    raw_ids = (
        to_user_id
        or os.environ.get("LINE_TARGET_USER_ID")
        or os.environ.get("LINE_ADMIN_ID")
        or os.environ.get("LINE_USER_ID")
        or "Ub7b6353ba826c0ba5c3d9fac3531ef77"
    )

    target_list = []
    if isinstance(raw_ids, (list, tuple, set)):
        for u in raw_ids:
            if u:
                for sub in str(u).split(","):
                    c = sub.strip().strip("'\"")
                    if c and c not in target_list:
                        target_list.append(c)
    else:
        for sub in str(raw_ids).split(","):
            c = sub.strip().strip("'\"")
            if c and c not in target_list:
                target_list.append(c)

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {channel_access_token}"
    }

    success_count = 0
    for uid in target_list:
        try:
            payload = {
                "to": uid,
                "messages": [{"type": "text", "text": message}]
            }
            res = requests.post("https://api.line.me/v2/bot/message/push", headers=headers, json=payload, timeout=10)
            if res.status_code == 200:
                print(f"✅ ส่งข้อความแจ้งเตือนตรงถึง ({uid}) สำเร็จ (HTTP 200 OK)")
                success_count += 1
            else:
                print(f"⚠️ LINE Push Error (to={uid}): HTTP {res.status_code} - {res.text}")
        except Exception as e:
            print(f"❌ เกิดข้อผิดพลาดขณะส่ง LINE Push ถึง {uid}: {e}")

    return success_count > 0


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
