"""
Finance & Monthly Expenses API Router for SawasdeeRental.
"""

import re
import calendar
from datetime import datetime, date, timedelta
from typing import Optional, Dict, Any
from fastapi import APIRouter, HTTPException, Response

from db import store, get_db_client, to_date
from dependencies import now_th, normalize_plate
from services.finance_service import compute_monthly_expenses, normalize_payment_channel

router = APIRouter(tags=["finance"])


@router.get("/api/expenses/cycle-expiries")
def get_cycle_expiries():
    """Returns expiring documents and expenses for the active notification cycle (1st or 16th of month) + weekly warning."""
    try:
        from check_expiry_alert import get_target_cycle_info
        cycle = get_target_cycle_info(now_th().date())
        all_expenses_resp = compute_monthly_expenses()
        items = all_expenses_resp.get("items", [])

        target_ym = cycle["target_ym"]
        w_start = cycle.get("week_start")
        w_end = cycle.get("week_end")
        matched = []
        for it in items:
            iso_d = str(it.get("due_date_iso") or "")
            is_weekly = False
            if iso_d and w_start and w_end:
                try:
                    it_date = datetime.strptime(iso_d[:10], "%Y-%m-%d").date()
                    is_weekly = (w_start <= it_date <= w_end)
                except Exception:
                    pass

            if (iso_d and iso_d.startswith(target_ym)) or (cycle["round_day"] == 1 and it.get("status_key") == "overdue") or is_weekly:
                matched.append(it)

        return {
            "success": True,
            "cycle": cycle,
            "count": len(matched),
            "items": matched
        }
    except Exception as e:
        print(f"Error in get_cycle_expiries: {e}")
        return {"success": False, "count": 0, "items": [], "error": str(e)}


@router.get("/api/expenses/monthly")
def get_monthly_expenses(response: Response):
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return compute_monthly_expenses()


@router.post("/api/expenses/pay")
def pay_monthly_expense(payload: Dict[str, Any]):
    plate = str(payload.get("plate") or payload.get("car_id") or "").strip()
    expense_type = str(payload.get("expense_type") or "").strip().lower()

    if not plate or not expense_type:
        raise HTTPException(status_code=400, detail="กรุณาระบุเลขทะเบียนรถและประเภทค่าใช้จ่าย")

    norm_p = normalize_plate(plate)
    car_key = next((k for k in store.cars.keys() if normalize_plate(k) == norm_p), None)
    if not car_key:
        raise HTTPException(status_code=404, detail=f"ไม่พบรถยนต์ทะเบียน {plate}")

    car = store.cars[car_key]
    today = now_th().date()
    pay_date = to_date(payload.get("payment_date") or payload.get("date")) or today
    new_date = None
    item_title = ""
    exp_cost = float(payload.get("amount") or 0.0)

    try:
        if expense_type in ("tax", "ภาษี"):
            item_title = "ภาษีประจำปี"
            if exp_cost <= 0:
                exp_cost = float(car.get("tax_price") or car.get("tax_amount") or 1500.0)
            curr_d = to_date(car.get("tax_expire_date") or car.get("tax_expiry")) or today
            base_d = max(curr_d, today)
            try:
                new_date = base_d.replace(year=base_d.year + 1)
            except Exception:
                new_date = base_d + timedelta(days=365)
            car["tax_expire_date"] = new_date.isoformat()
            car["tax_expiry"] = new_date.strftime("%d/%m/%Y")
            car["tax_status"] = "ชำระแล้ว"
            car["tax_paid"] = True
            car["tax_paid_date"] = pay_date.isoformat()

        elif expense_type in ("act", "prb", "พ.ร.บ.", "พรบ"):
            item_title = "พ.ร.บ. คุ้มครอง"
            if exp_cost <= 0:
                exp_cost = float(car.get("prb_price") or car.get("act_price") or 645.0)
            curr_d = to_date(car.get("prb_expire_date") or car.get("act_expiry")) or today
            base_d = max(curr_d, today)
            try:
                new_date = base_d.replace(year=base_d.year + 1)
            except Exception:
                new_date = base_d + timedelta(days=365)
            car["prb_expire_date"] = new_date.isoformat()
            car["act_expiry"] = new_date.strftime("%d/%m/%Y")
            car["prb_status"] = "ชำระแล้ว"
            car["act_status"] = "ชำระแล้ว"
            car["prb_paid"] = True
            car["act_paid"] = True
            car["prb_paid_date"] = pay_date.isoformat()

        elif expense_type in ("insurance", "ins", "ประกัน", "ประกันภัย"):
            item_title = "ประกันภัย"
            if exp_cost <= 0:
                exp_cost = float(car.get("insurance_premium") or car.get("ins_premium") or 7500.0)
            curr_d = to_date(car.get("insurance_expire_date") or car.get("ins_expiry")) or today
            base_d = max(curr_d, today)
            try:
                new_date = base_d.replace(year=base_d.year + 1)
            except Exception:
                new_date = base_d + timedelta(days=365)
            car["insurance_expire_date"] = new_date.isoformat()
            car["ins_expiry"] = new_date.strftime("%d/%m/%Y")
            car["insurance_status"] = "ชำระแล้ว"
            car["ins_status"] = "ชำระแล้ว"
            car["insurance_paid"] = True
            car["ins_paid"] = True
            car["insurance_paid_date"] = pay_date.isoformat()

        elif expense_type in ("installment", "finance", "hp", "ผ่อนรถ", "ค่างวด"):
            item_title = "ค่างวดผ่อนรถ"
            if exp_cost <= 0:
                exp_cost = float(car.get("installment_amount") or car.get("hp_installment") or 8500.0)
            curr_d = to_date(car.get("payment_due_date") or car.get("installment_due_date")) or today
            base_d = max(curr_d, today)
            m = base_d.month + 1
            y = base_d.year
            if m > 12:
                m = 1
                y += 1
            max_d = calendar.monthrange(y, m)[1]
            new_d_num = min(base_d.day, max_d)
            new_date = date(y, m, new_d_num)

            car["payment_due_date"] = new_date.strftime("%d/%m/%Y")
            car["installment_due_date"] = new_date.isoformat()
            cur_t = int(car.get("current_installment", 0) or 0) + 1
            car["current_installment"] = cur_t
            car["installment_status"] = "ชำระแล้ว"
            car["payment_status"] = "ชำระแล้ว"
            car["installment_paid"] = True
            car["installment_paid_date"] = pay_date.isoformat()

        else:
            raise HTTPException(status_code=400, detail=f"ประเภทค่าใช้จ่ายไม่ถูกต้อง: {expense_type}")

        # 1. UPDATE: Persist car in store and DB
        store.async_sync_car(car_key, car)
        sb = get_db_client()
        if sb:
            try:
                sb.table("cars").update({
                    "tax_expire_date": car.get("tax_expire_date"),
                    "tax_expiry": car.get("tax_expiry"),
                    "prb_expire_date": car.get("prb_expire_date"),
                    "act_expiry": car.get("act_expiry"),
                    "insurance_expire_date": car.get("insurance_expire_date"),
                    "ins_expiry": car.get("ins_expiry"),
                    "payment_due_date": car.get("payment_due_date"),
                    "installment_due_date": car.get("installment_due_date"),
                    "current_installment": car.get("current_installment"),
                    "tax_status": car.get("tax_status"),
                    "prb_status": car.get("prb_status"),
                    "insurance_status": car.get("insurance_status"),
                    "installment_status": car.get("installment_status")
                }).eq("plate", car_key).execute()
            except Exception as e_up:
                print(f"sb update car expense note: {e_up}")

        # 2. INSERT: Record expense in financial_records & maintenance_logs
        car_comp = car.get("owner_company") or car.get("company") or "Sawasdee Rent A Car"
        now_ts = now_th().strftime("%Y-%m-%d %H:%M:%S")
        due_note = f" (ต่ออายุรอบใหม่ถึง {new_date.strftime('%d/%m/%Y')})" if new_date else ""

        f_exp = {
            "date": now_ts,
            "type": "รายจ่าย",
            "category": item_title,
            "amount": exp_cost,
            "ref_id": car_key,
            "ref": car_key,
            "description": f"ชำระ{item_title} ทะเบียน {car_key}{due_note}",
            "detail": f"ชำระ{item_title} ทะเบียน {car_key}{due_note}",
            "company": car_comp,
            "payment_method": "โอนเงิน / สแกน QR"
        }
        try:
            store.sync_financial(f_exp)
        except Exception as e_fin:
            print(f"sync_financial error: {e_fin}")

        # TARGET MISSION 3: Strict Routing - renewal/insurance goes to insurance_records, NOT maintenance_logs
        is_renewal_exp = any(k in item_title.lower() for k in ["ต่ออายุ", "ต่อทะเบียน", "พ.ร.บ.", "พรบ", "ประกัน", "ภาษี", "act", "insurance", "tax"])
        if is_renewal_exp:
            ins_rec_id = f"INS{now_th().strftime('%y%m%d%H%M%S')}_{re.sub(r'[^a-zA-Z0-9]', '', car_key)}"
            ins_rec = {
                "id": ins_rec_id,
                "car_id": car_key,
                "ins_company": car.get("ins_company") or car.get("act_company") or "-",
                "ins_policy_no": car.get("ins_policy_no") or car.get("act_policy_no") or "-",
                "ins_class": str(car.get("ins_class") or "-"),
                "ins_category": str(car.get("ins_category") or "-"),
                "ins_type": item_title,
                "ins_coverage_amount": float(car.get("ins_coverage_amount") or 0.0),
                "ins_premium": exp_cost,
                "expiry_date": new_date.strftime("%d/%m/%Y") if new_date else "-",
                "ins_doc_url": car.get("ins_doc_url") or None,
                "notes": f"ชำระ {item_title} ทะเบียน {car_key}{due_note}",
                "created_by": "admin",
                "created_at": now_th().strftime("%Y-%m-%d %H:%M:%S")
            }
            try:
                store.async_sync_insurance_record(ins_rec)
            except Exception as e_ins:
                print(f"async_sync_insurance_record error: {e_ins}")
        else:
            try:
                store.log_maintenance(
                    car_id=car_key,
                    date=pay_date.isoformat(),
                    expense_type=item_title,
                    description=f"ชำระ {item_title} ทะเบียน {car_key}{due_note}",
                    cost=exp_cost,
                    recorded_by="admin"
                )
            except Exception as e_ml:
                print(f"log_maintenance error: {e_ml}")

        return {
            "success": True,
            "message": f"อัปเดตชำระเงิน {item_title} ทะเบียน {car_key} เรียบร้อยแล้ว",
            "plate": car_key,
            "new_due_date": new_date.strftime("%d/%m/%Y") if new_date else "-",
            "new_due_date_iso": new_date.isoformat() if new_date else "-",
            "amount": exp_cost
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error in pay_monthly_expense: {e}")
        raise HTTPException(status_code=500, detail=f"เกิดข้อผิดพลาดในการบันทึกชำระเงิน: {str(e)}")


@router.post("/api/financial-records")
@router.post("/api/finance/records")
def create_financial_record(payload: Dict[str, Any]):
    now_ts = now_th().strftime("%Y-%m-%d %H:%M:%S")
    f_rec = {
        "date": str(payload.get("date") or now_ts),
        "type": str(payload.get("type") or "Income"),
        "category": str(payload.get("category") or "Deposit"),
        "amount": float(payload.get("amount") or 0.0),
        "ref_id": str(payload.get("ref_id") or payload.get("booking_id") or payload.get("ref") or ""),
        "description": str(payload.get("description") or payload.get("detail") or payload.get("notes") or ""),
        "ref": str(payload.get("ref_id") or payload.get("booking_id") or payload.get("ref") or ""),
        "detail": str(payload.get("description") or payload.get("detail") or ""),
        "payment_method": payload.get("payment_method"),
        "slip_image_url": payload.get("slip_image_url") or payload.get("slip_url")
    }
    store.sync_financial(f_rec)
    return {"success": True, "record": f_rec}


@router.get("/api/finance/summary")
def get_finance_summary(month: Optional[str] = None, start_date: Optional[str] = None, end_date: Optional[str] = None):
    """
    Financial Dashboard & Shift Closing Summary (Read-Only)
    Aggregates income (deposit + rental + extensions) grouped by day and month,
    and broken down by the 4 payment methods.
    """
    tx_list = []
    seen_refs = set()

    for b in store.bookings:
        bid = b.get("booking_id")
        dep_amt = float(b.get("deposit_amount") or 0.0)
        dep_paid = b.get("deposit_paid") or (b.get("status") not in ["รอชำระมัดจำ", "ยกเลิก"] and dep_amt > 0)
        if dep_amt > 0 and dep_paid:
            d_date = b.get("deposit_date") or str(b.get("start_date") or "")
            d_date_clean = str(to_date(d_date) or d_date or "").strip()
            if not d_date_clean or len(d_date_clean) < 10:
                d_date_clean = now_th().date().isoformat()
            method = normalize_payment_channel(b.get("deposit_method") or "โอนเงิน / สแกน QR")
            tx_key = f"dep_{bid}"
            seen_refs.add(tx_key)
            tx_list.append({
                "id": tx_key,
                "ref": bid,
                "date": d_date_clean,
                "month": d_date_clean[:7],
                "car_id": b.get("car_id", "-"),
                "customer": b.get("customer_name", "-"),
                "category": "เงินมัดจำ",
                "payment_method": method,
                "amount": dep_amt,
                "note": f"มัดจำจองรถ {b.get('car_id', '')}"
            })

        rent_paid = b.get("rental_paid") or b.get("is_fully_paid") or b.get("status") in ["เสร็จสิ้น", "กำลังเช่า", "รอส่งมอบ", "รอรับคืน"]
        rent_amt = float(b.get("net_price") or b.get("rental_rate") or 0.0)
        if rent_amt > 0 and rent_paid:
            r_date = b.get("rental_payment_date") or str(b.get("start_date") or "")
            r_date_clean = str(to_date(r_date) or r_date or "").strip()
            if not r_date_clean or len(r_date_clean) < 10:
                r_date_clean = now_th().date().isoformat()
            r_method = normalize_payment_channel(b.get("rental_payment_method") or b.get("deposit_method") or "โอนเงิน / สแกน QR")
            tx_key = f"rent_{bid}"
            seen_refs.add(tx_key)
            tx_list.append({
                "id": tx_key,
                "ref": bid,
                "date": r_date_clean,
                "month": r_date_clean[:7],
                "car_id": b.get("car_id", "-"),
                "customer": b.get("customer_name", "-"),
                "category": "ค่าเช่ารถ",
                "payment_method": r_method,
                "amount": rent_amt,
                "note": f"ค่าเช่ารถ {b.get('car_id', '')}"
            })

        ext_list = b.get("extension_history") or []
        for idx, ext in enumerate(ext_list):
            if ext.get("paid"):
                e_amt = float(ext.get("amount") or 0.0)
                if e_amt > 0:
                    e_date = str(to_date(ext.get("extended_at") or ext.get("date") or "") or now_th().date().isoformat())
                    e_method = normalize_payment_channel(ext.get("payment_method") or "โอนเงิน / สแกน QR")
                    tx_list.append({
                        "id": f"ext_{bid}_{idx}",
                        "ref": bid,
                        "date": e_date,
                        "month": e_date[:7],
                        "car_id": b.get("car_id", "-"),
                        "customer": b.get("customer_name", "-"),
                        "category": "ค่าต่อสัญญา",
                        "payment_method": e_method,
                        "amount": e_amt,
                        "note": f"ต่อสัญญา #{ext.get('extension_no', idx+1)}"
                    })

    for cj in store.completed_jobs:
        cbid = cj.get("booking_id")
        tx_key = f"rent_{cbid}"
        if tx_key not in seen_refs:
            c_amt = float(cj.get("net_price") or cj.get("rental_rate") or 0.0)
            if c_amt > 0:
                c_date = str(to_date(cj.get("completed_date") or cj.get("end_date") or cj.get("start_date") or "") or now_th().date().isoformat())
                c_method = normalize_payment_channel(cj.get("rental_payment_method") or cj.get("deposit_method") or "โอนเงิน / สแกน QR")
                seen_refs.add(tx_key)
                tx_list.append({
                    "id": tx_key,
                    "ref": cbid,
                    "date": c_date,
                    "month": c_date[:7],
                    "car_id": cj.get("car_id", "-"),
                    "customer": cj.get("customer_name", "-"),
                    "category": "ค่าเช่ารถ",
                    "payment_method": c_method,
                    "amount": c_amt,
                    "note": f"งานเสร็จสิ้น {cj.get('car_id', '')}"
                })

    for f in store.financial_records:
        if f.get("type") in ["รายรับ", "Income", "income"]:
            f_ref = f.get("ref_id") or f.get("ref", "")
            if not f_ref or (f"rent_{f_ref}" not in seen_refs and f"dep_{f_ref}" not in seen_refs):
                f_amt = float(f.get("amount") or 0.0)
                if f_amt > 0:
                    f_date = str(to_date(f.get("date")) or f.get("date") or now_th().date().isoformat())
                    f_method = normalize_payment_channel(f.get("detail", "") or f.get("category", ""))
                    tx_list.append({
                        "id": f"fin_{len(tx_list)}",
                        "ref": f_ref or "-",
                        "date": f_date,
                        "month": f_date[:7],
                        "car_id": "-",
                        "customer": "-",
                        "category": f.get("category", "รายรับอื่นๆ"),
                        "payment_method": f_method,
                        "amount": f_amt,
                        "note": f.get("detail", "")
                    })

    if month:
        tx_list = [t for t in tx_list if t["month"] == month]
    if start_date:
        s_d = to_date(start_date)
        if s_d:
            tx_list = [t for t in tx_list if to_date(t["date"]) and to_date(t["date"]) >= s_d]
    if end_date:
        e_d = to_date(end_date)
        if e_d:
            tx_list = [t for t in tx_list if to_date(t["date"]) and to_date(t["date"]) <= e_d]

    all_methods = ["โอนเงิน / สแกน QR", "เงินสด", "บัตรเครดิต", "PayPal", "ชำระวันคืนรถ"]
    method_totals = {m: 0.0 for m in all_methods}
    total_rev = 0.0
    for t in tx_list:
        m = t["payment_method"]
        if m not in method_totals:
            m = "โอนเงิน / สแกน QR"
        amt = float(t["amount"])
        method_totals[m] += amt
        total_rev += amt

    daily_map = {}
    for t in tx_list:
        d = t["date"]
        if d not in daily_map:
            daily_map[d] = {
                "date": d,
                "month": d[:7],
                "total": 0.0,
                "by_method": {m: 0.0 for m in all_methods},
                "count": 0,
                "records": []
            }
        daily_map[d]["total"] += float(t["amount"])
        daily_map[d]["by_method"][t["payment_method"]] += float(t["amount"])
        daily_map[d]["count"] += 1
        daily_map[d]["records"].append(t)

    daily_list = list(daily_map.values())
    daily_list.sort(key=lambda x: x["date"], reverse=True)

    monthly_map = {}
    for t in tx_list:
        mo = t["month"]
        if mo not in monthly_map:
            monthly_map[mo] = {
                "month": mo,
                "total": 0.0,
                "by_method": {m: 0.0 for m in all_methods},
                "count": 0
            }
        monthly_map[mo]["total"] += float(t["amount"])
        monthly_map[mo]["by_method"][t["payment_method"]] += float(t["amount"])
        monthly_map[mo]["count"] += 1

    monthly_list = list(monthly_map.values())
    monthly_list.sort(key=lambda x: x["month"], reverse=True)

    return {
        "success": True,
        "total_revenue": round(total_rev, 2),
        "by_method": {m: round(amt, 2) for m, amt in method_totals.items()},
        "daily": daily_list,
        "monthly": monthly_list,
        "total_transactions": len(tx_list)
    }
