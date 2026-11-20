"""
Finance, monthly expenses, and dashboard statistics services for SawasdeeRental.
"""

from typing import Optional, Dict, Any, List

from db import store, get_db_client, to_date, normalize_plate_str
from dependencies import now_th


def compute_monthly_expenses() -> Dict[str, Any]:
    """Compute monthly vehicle expenses across tax, ACT/PRB, insurance, and installments."""
    if not store.initial_sync_done:
        try:
            store.sync_from_database(force=False)
        except Exception:
            pass

    today = now_th().date()
    items = []

    def classify_expense(days_left: int, db_status: Optional[str] = None):
        st_clean = str(db_status or "").strip().lower()
        if st_clean in ("ชำระแล้ว", "paid", "true", "ok"):
            return "ชำระแล้ว", "paid", False
        if st_clean in ("รอชำระ", "pending", "pending_near", "overdue"):
            if days_left < 0:
                return "เกินกำหนด", "overdue", True
            elif days_left <= 15:
                return "รอชำระ (ใกล้ครบกำหนด)", "pending_near", True
            else:
                return "รอชำระ", "pending", True

        # When no explicit status in DB, classify by days left:
        if days_left > 30:
            return "ชำระแล้ว", "paid", False
        elif days_left < 0:
            return "เกินกำหนด", "overdue", True
        elif days_left <= 15:
            return "รอชำระ (ใกล้ครบกำหนด)", "pending_near", True
        else:
            return "รอชำระ", "pending", True

    for plate, car in store.cars.items():
        brand = car.get("brand") or ""
        model = car.get("model") or ""
        car_name = f"{brand} {model}".strip() or "-"
        company = car.get("owner_company") or car.get("company") or "-"

        # 1. ภาษี (Tax)
        tax_d_raw = car.get("tax_expire_date") or car.get("tax_expiry")
        tax_d = to_date(tax_d_raw)
        if tax_d:
            days_left = (tax_d - today).days
            amount = float(car.get("tax_price") or car.get("tax_amount") or 1500.0)
            db_st = car.get("tax_status") or ("paid" if car.get("tax_paid") else None)
            status, status_key, is_pending = classify_expense(days_left, db_st)
            items.append({
                "plate": plate,
                "model": car_name,
                "company": company,
                "expense_type": "ภาษีประจำปี (Tax)",
                "expense_key": "tax",
                "due_date": tax_d.strftime("%d/%m/%Y"),
                "due_date_iso": tax_d.isoformat(),
                "days_left": days_left,
                "amount": amount,
                "status": status,
                "status_key": status_key,
                "notes": f"เหลืออีก {days_left} วัน" if days_left >= 0 else f"เกินกำหนด {abs(days_left)} วัน"
            })

        # 2. พ.ร.บ. (ACT / PRB)
        act_d_raw = car.get("prb_expire_date") or car.get("act_expiry")
        act_d = to_date(act_d_raw)
        if act_d:
            days_left = (act_d - today).days
            amount = float(car.get("prb_price") or car.get("act_price") or 645.21)
            db_st = car.get("prb_status") or car.get("act_status") or ("paid" if (car.get("act_paid") or car.get("prb_paid")) else None)
            status, status_key, is_pending = classify_expense(days_left, db_st)
            items.append({
                "plate": plate,
                "model": car_name,
                "company": company,
                "expense_type": "พ.ร.บ. คุ้มครอง (ACT)",
                "expense_key": "act",
                "due_date": act_d.strftime("%d/%m/%Y"),
                "due_date_iso": act_d.isoformat(),
                "days_left": days_left,
                "amount": amount,
                "status": status,
                "status_key": status_key,
                "notes": f"เหลืออีก {days_left} วัน" if days_left >= 0 else f"เกินกำหนด {abs(days_left)} วัน"
            })

        # 3. ประกันภัย (Insurance)
        ins_d_raw = car.get("insurance_expire_date") or car.get("ins_expiry")
        ins_d = to_date(ins_d_raw)
        if ins_d:
            days_left = (ins_d - today).days
            amount = float(car.get("insurance_premium") or car.get("ins_premium") or 12000.0)
            ins_comp = car.get("insurance_company") or car.get("ins_company") or "-"
            db_st = car.get("insurance_status") or car.get("ins_status") or ("paid" if (car.get("insurance_paid") or car.get("ins_paid")) else None)
            status, status_key, is_pending = classify_expense(days_left, db_st)
            items.append({
                "plate": plate,
                "model": car_name,
                "company": company,
                "expense_type": f"ประกันภัย ({ins_comp})",
                "expense_key": "insurance",
                "due_date": ins_d.strftime("%d/%m/%Y"),
                "due_date_iso": ins_d.isoformat(),
                "days_left": days_left,
                "amount": amount,
                "status": status,
                "status_key": status_key,
                "notes": f"เหลืออีก {days_left} วัน" if days_left >= 0 else f"เกินกำหนด {abs(days_left)} วัน"
            })

        # 4. ผ่อนรถ (Installment)
        is_debt_free = car.get("is_debt_free")
        if not is_debt_free:
            inst_d_raw = car.get("payment_due_date") or car.get("installment_due_date")
            inst_d = to_date(inst_d_raw)
            if inst_d:
                days_left = (inst_d - today).days
                amount = float(car.get("installment_amount") or car.get("hp_installment") or 8500.0)
                cur_term = car.get("current_installment", 0) or 0
                tot_term = car.get("total_installments", 0) or 0
                term_desc = f" (งวดที่ {cur_term}/{tot_term})" if tot_term else ""
                db_st = car.get("installment_status") or car.get("payment_status") or ("paid" if car.get("installment_paid") else None)
                status, status_key, is_pending = classify_expense(days_left, db_st)
                items.append({
                    "plate": plate,
                    "model": car_name,
                    "company": company,
                    "expense_type": f"ค่างวดผ่อนรถ{term_desc}",
                    "expense_key": "installment",
                    "due_date": inst_d.strftime("%d/%m/%Y"),
                    "due_date_iso": inst_d.isoformat(),
                    "days_left": days_left,
                    "amount": amount,
                    "status": status,
                    "status_key": status_key,
                    "notes": f"เหลืออีก {days_left} วัน" if days_left >= 0 else f"เกินกำหนด {abs(days_left)} วัน"
                })

    # Sort items: Overdue first (0), near-due (1), pending (2), paid (3)
    order_map = {"overdue": 0, "pending_near": 1, "pending": 2, "paid": 3}
    items.sort(key=lambda x: (order_map.get(x["status_key"], 9), x["days_left"]))

    # SINGLE SOURCE OF TRUTH: Aggregation strictly derived from items' status_key
    tax_pending = sum(1 for it in items if it["expense_key"] == "tax" and it["status_key"] != "paid")
    act_pending = sum(1 for it in items if it["expense_key"] == "act" and it["status_key"] != "paid")
    ins_pending = sum(1 for it in items if it["expense_key"] == "insurance" and it["status_key"] != "paid")
    inst_pending = sum(1 for it in items if it["expense_key"] == "installment" and it["status_key"] != "paid")
    tot_pending_amount = sum(float(it.get("amount") or 0.0) for it in items if it["status_key"] != "paid")

    summary = {
        "total_items": len(items),
        "tax_pending": tax_pending,
        "act_pending": act_pending,
        "insurance_pending": ins_pending,
        "installment_pending": inst_pending,
        "total_pending_count": tax_pending + act_pending + ins_pending + inst_pending,
        "total_pending_amount": tot_pending_amount
    }

    return {
        "success": True,
        "summary": summary,
        "expenses": items,
        "items": items
    }


def normalize_payment_channel(raw_method: str) -> str:
    """Normalize raw payment method label into standardized Thai payment channel."""
    m = str(raw_method or "").strip().lower()
    if any(k in m for k in ["คืนรถ", "return", "pay on return"]):
        return "ชำระวันคืนรถ"
    if any(k in m for k in ["โอน", "qr", "transfer", "scan", "bank"]):
        return "โอนเงิน / สแกน QR"
    if any(k in m for k in ["สด", "cash"]):
        return "เงินสด"
    if any(k in m for k in ["เครดิต", "credit", "card", "edc"]):
        return "บัตรเครดิต"
    if "paypal" in m:
        return "PayPal"
    return "โอนเงิน / สแกน QR"


def compute_dashboard_statistics() -> Dict[str, Any]:
    """Compute real-time fleet status, utilization, revenue, and monthly trend KPIs."""
    # 1. Ensure database sync has run
    if not getattr(store, "initial_sync_done", False) or not getattr(store, "cars", {}):
        try:
            store.sync_from_database(force=True)
        except Exception as e:
            print(f"Dashboard sync_from_database note: {e}")

    sb = get_db_client()
    cars_data = []
    bookings_data = []

    if sb:
        try:
            c_res = sb.table("cars").select("*").execute()
            if c_res and c_res.data:
                cars_data = c_res.data
        except Exception as e:
            print(f"Dashboard cars DB fetch note: {e}")
        try:
            b_res = sb.table("bookings").select("*").execute()
            if b_res and b_res.data:
                bookings_data = b_res.data
        except Exception as e:
            print(f"Dashboard bookings DB fetch note: {e}")

    # Fallback / merge with store in memory
    cars_dict = {}
    for c in cars_data:
        pl = c.get("plate")
        if pl:
            cars_dict[pl] = dict(c)
    for pl, c in getattr(store, "cars", {}).items():
        if pl not in cars_dict:
            cars_dict[pl] = dict(c)
        else:
            cars_dict[pl].update({k: v for k, v in c.items() if v is not None})
    fleet_cars = list(cars_dict.values()) if cars_dict else list(getattr(store, "cars", {}).values())

    bookings_dict = {}
    for b in bookings_data:
        bid = b.get("booking_id") or b.get("id")
        if bid:
            bookings_dict[bid] = dict(b)
    for b in getattr(store, "bookings", []):
        bid = b.get("booking_id") or b.get("id")
        if bid:
            bookings_dict[bid] = {**bookings_dict.get(bid, {}), **b}
    all_bookings = list(bookings_dict.values()) if bookings_dict else list(getattr(store, "bookings", []))

    today = now_th().date()
    total_fleet = len(fleet_cars)
    avail_count = 0
    on_rent_count = 0
    booked_count = 0
    maint_count = 0

    # Group cars strictly with robust status matching + fleet bookings verification
    for c in fleet_cars:
        pl = str(c.get("plate") or "").strip()
        norm_p = normalize_plate_str(pl)
        c_st = str(c.get("status") or c.get("car_status") or "").strip().lower()

        # Check bookings for this car from fleet data
        car_bks = [
            b for b in all_bookings
            if normalize_plate_str(b.get("car_id", "")) == norm_p
            and str(b.get("status") or "").strip() not in ["เสร็จสิ้น", "ยกเลิก", "Completed", "Canceled", "completed", "canceled"]
        ]
        has_real_on_rent = any(b.get("status") in ("กำลังเช่า", "รอรับคืน") for b in car_bks)
        has_queue = any(b.get("status") not in ("เสร็จสิ้น", "ยกเลิก") for b in car_bks)

        # 1. Maintenance / Workshop / Renewal
        has_active_maint = any(
            (m.get("car_id") == pl or normalize_plate_str(m.get("car_id", "")) == norm_p)
            and str(m.get("status") or "").strip() not in ["เสร็จสิ้น", "ยกเลิก", "Completed", "Canceled"]
            for m in getattr(store, "maintenance_records", [])
        )
        has_active_wo_maint = any(
            (wo.get("car_id") == pl or normalize_plate_str(wo.get("car_id", "")) == norm_p)
            and str(wo.get("job_status") or "").strip() not in ["เสร็จสิ้น", "ยกเลิก", "Completed", "Canceled"]
            and any(w_kw in str(wo.get("work_type", "")).lower() for w_kw in ["tax", "repair", "maintenance", "ซ่อม", "ภาษี", "พ.ร.บ."])
            for wo in getattr(store, "work_order_logs", [])
        )
        is_maint = has_active_maint or has_active_wo_maint

        if is_maint:
            maint_count += 1
        # 2. On Rent / Renting (checks status strings AND active rental from fleet)
        elif any(k in c_st for k in ["เช่า", "rent", "กำลังเช่า", "on_rent", "on rent", "rented", "รอรับคืน"]) or has_real_on_rent:
            on_rent_count += 1
        # 3. Booked / Reserved (checks status strings AND booking queue from fleet)
        elif any(k in c_st for k in ["จอง", "book", "reserv", "ติดจอง", "booked", "reserved", "ส่งมอบ", "queue"]) or has_queue:
            booked_count += 1
        # 4. If c_st indicates maintenance but no actual active maintenance order
        elif any(k in c_st for k in ["ซ่อม", "ไม่พร้อม", "ระงับ", "maint", "ต่อทะเบียน", "ต่อภาษี", "workshop", "renewal"]):
            # Auto-repair orphan maintenance status in memory
            target_st = "กำลังเช่า" if has_real_on_rent else ("ติดจอง" if has_queue else "ว่างพร้อมใช้งาน")
            if isinstance(c, dict):
                c["car_status"] = target_st
                c["status"] = target_st
            if has_real_on_rent:
                on_rent_count += 1
            elif has_queue:
                booked_count += 1
            else:
                avail_count += 1
        # 5. Otherwise Available (ว่างพร้อมใช้งาน)
        else:
            avail_count += 1

    # Active rentals: on_rent + booked (strictly never including available)
    active_rentals = on_rent_count + booked_count
    utilization_rate = round((active_rentals / max(1, total_fleet)) * 100, 1) if total_fleet > 0 else 0.0

    # Clean standardized status_counts dict
    status_counts = {
        "available": avail_count,
        "on_rent": on_rent_count,
        "booked": booked_count,
        "maintenance": maint_count
    }

    # Real-time revenue calculation from jobs and bookings
    total_rev = 0.0
    seen_bids = set()
    for cj in getattr(store, "completed_jobs", []):
        bid = cj.get("booking_id")
        if bid:
            seen_bids.add(bid)
        total_rev += float(cj.get("net_price") or 0.0) + float(cj.get("late_fee") or 0.0)

    for b in all_bookings:
        bid = b.get("booking_id")
        if bid and bid not in seen_bids:
            if b.get("rental_paid") or b.get("is_fully_paid") or str(b.get("status")) in ["กำลังเช่า", "รอรับคืน", "เสร็จสิ้น"]:
                total_rev += float(b.get("net_price") or b.get("rental_rate") or 0.0)
                seen_bids.add(bid)

    if total_rev == 0.0:
        for f in getattr(store, "financial_records", []):
            if f.get("type") in ["รายรับ", "income", "Income"] or str(f.get("type", "")).strip().lower() in ["รายรับ", "income"]:
                total_rev += float(f.get("amount", 0) or 0)

    # Monthly revenue trend (past 6 months)
    th_months = ["", "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."]
    monthly_trend = []
    curr_m = today.month
    curr_y = today.year
    for i in range(5, -1, -1):
        m = curr_m - i
        y = curr_y
        while m <= 0:
            m += 12
            y -= 1
        m_str = f"{y}-{m:02d}"
        m_label = f"{m}. {th_months[m]}"
        rev_m = 0.0
        for cj in getattr(store, "completed_jobs", []):
            c_d = to_date(cj.get("completed_date") or cj.get("end_date"))
            if c_d and c_d.year == y and c_d.month == m:
                rev_m += float(cj.get("net_price") or 0.0)
        for b in all_bookings:
            b_d = to_date(b.get("start_date") or b.get("created_at"))
            if b_d and b_d.year == y and b_d.month == m:
                if b.get("rental_paid") or b.get("is_fully_paid") or str(b.get("status")) in ["กำลังเช่า", "รอรับคืน"]:
                    rev_m += float(b.get("net_price") or b.get("rental_rate") or 0.0)
        for f in getattr(store, "financial_records", []):
            if f.get("type") in ["รายรับ", "income", "Income"]:
                f_d = to_date(f.get("date") or f.get("created_at"))
                if f_d and f_d.year == y and f_d.month == m:
                    f_ref = f.get("ref")
                    if not f_ref or f_ref not in seen_bids:
                        rev_m += float(f.get("amount") or 0.0)
        monthly_trend.append({
            "label": m_label,
            "month": m,
            "year": y,
            "month_key": m_str,
            "revenue": round(rev_m, 2)
        })

    company_counts = {}
    for c in fleet_cars:
        comp = c.get("company", "อื่นๆ")
        company_counts[comp] = company_counts.get(comp, 0) + 1

    return {
        "success": True,
        "total_fleet": total_fleet,
        "available": avail_count,
        "on_rent": on_rent_count,
        "booked": booked_count,
        "maintenance": maint_count,
        "status_counts": status_counts,
        "status_breakdown": status_counts,
        "fleet_status_breakdown": status_counts,
        "active_rentals": active_rentals,
        "utilization_rate": utilization_rate,
        "total_revenue": round(total_rev, 2),
        "total_cars": total_fleet,
        "available_cars": avail_count,
        "rented_cars": on_rent_count,
        "booked_cars": booked_count,
        "maintenance_cars": maint_count,
        "monthly_trend": monthly_trend,
        "company_distribution": company_counts,
        "total_bookings": len(all_bookings),
        "total_completed": len(getattr(store, "completed_jobs", [])),
        "financial_records": getattr(store, "financial_records", [])
    }
