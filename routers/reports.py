"""
Executive Dashboard & Reports API Router for SawasdeeRental.
"""

import io
import csv
from typing import Optional
from fastapi import APIRouter, Response
from fastapi.responses import StreamingResponse

from db import store, to_date, format_date_dmy
from services.finance_service import compute_dashboard_statistics

router = APIRouter(tags=["reports"])


@router.get("/api/reports/car-profitability")
def get_car_profitability(mode: str = "operating"):
    # Computes operating profit (revenue - repairs/ops) and full Net Fleet ROI (including fixed costs & break-even)
    rev_by_car = {}
    rentals_by_car = {}
    completed_bids = set()

    for j in store.completed_jobs:
        pl = j.get("car_id")
        if pl:
            rev_by_car[pl] = rev_by_car.get(pl, 0.0) + float(j.get("net_price", 0.0)) + float(j.get("late_fee", 0.0))
            rentals_by_car[pl] = rentals_by_car.get(pl, 0) + 1
        if j.get("booking_id"):
            completed_bids.add(j["booking_id"])

    for b in store.bookings:
        pl = b.get("car_id")
        bid = b.get("booking_id")
        if pl and bid not in completed_bids:
            if b.get("rental_paid") or b.get("status") in ["กำลังเช่า", "เตรียมรับคืน", "รอส่งมอบ", "เตรียมส่งมอบ"]:
                rev_by_car[pl] = rev_by_car.get(pl, 0.0) + float(b.get("net_price", 0.0))
                rentals_by_car[pl] = rentals_by_car.get(pl, 0) + 1

    exp_by_car = {}
    mnt_ids = set()
    for m in store.maintenance_records:
        pl = m.get("car_id")
        if pl:
            cost_val = float(m.get("actual_cost") or m.get("cost") or 0.0)
            exp_by_car[pl] = exp_by_car.get(pl, 0.0) + cost_val
        if m.get("id"):
            mnt_ids.add(m["id"])

    for ml in getattr(store, "maintenance_logs", []):
        pl = ml.get("car_id")
        if pl and ml.get("id") not in mnt_ids:
            cost_val = float(ml.get("cost") or 0.0)
            exp_by_car[pl] = exp_by_car.get(pl, 0.0) + cost_val
            mnt_ids.add(ml["id"])

    for f in store.financial_records:
        f_type = f.get("type")
        f_amt = float(f.get("amount", 0.0) or 0.0)
        f_ref = str(f.get("ref", ""))
        f_det = str(f.get("detail", ""))
        f_cat = str(f.get("category", ""))

        matched_pl = None
        for pl in store.cars.keys():
            if pl == f_ref or pl in f_det:
                matched_pl = pl
                break

        if matched_pl:
            if f_type in ("รายรับ", "Income", "income") and f_cat in ("ค่าเช่ารถ", "ค่ารับ-ส่งรถ"):
                if f_ref not in completed_bids:
                    rev_by_car[matched_pl] = rev_by_car.get(matched_pl, 0.0) + f_amt
            elif f_type in ("รายจ่าย", "Expense", "expense"):
                # Do NOT count customer security deposit refunds or delivery fee refunds as vehicle maintenance expenses
                is_non_operating_refund = (
                    ("คืนเงินมัดจำ" in f_cat)
                    or ("คืนมัดจำ" in f_cat)
                    or ("คืนค่ารับ-ส่ง" in f_cat)
                    or ("คืนเงินมัดจำ" in f_det)
                    or ("คืนมัดจำ" in f_det)
                    or ("คืนค่ารับ-ส่ง" in f_det)
                )
                if not is_non_operating_refund and f_ref not in mnt_ids:
                    exp_by_car[matched_pl] = exp_by_car.get(matched_pl, 0.0) + f_amt

    profitability = []
    for plate, car in store.cars.items():
        gross = round(rev_by_car.get(plate, 0.0), 2)
        exp = round(exp_by_car.get(plate, 0.0), 2)
        net = round(gross - exp, 2)
        r_cnt = rentals_by_car.get(plate, 0)

        installment_cost = 0.0 if car.get("is_debt_free") else round(
            float(car.get("installment_amount") or car.get("hp_installment") or 0.0), 2
        )
        tax_cost = round(float(car.get("tax_price") or car.get("tax_amount") or 0.0), 2)
        act_cost = round(float(car.get("prb_price") or car.get("act_price") or 0.0), 2)
        insurance_cost = round(float(car.get("insurance_premium") or car.get("ins_premium") or 0.0), 2)
        annual_fixed_cost = round(tax_cost + act_cost + insurance_cost, 2)
        fixed_cost_total = round(installment_cost + annual_fixed_cost, 2)
        total_cost_all = round(exp + fixed_cost_total, 2)
        net_fleet_roi = round(gross - total_cost_all, 2)
        roi_percent = (
            round((gross / total_cost_all) * 100.0, 1)
            if total_cost_all > 0
            else (100.0 if gross > 0 else 0.0)
        )
        break_even_reached = bool(gross >= total_cost_all)
        break_even_gap = round(max(0.0, total_cost_all - gross), 2)

        profitability.append({
            "plate": plate,
            "brand": car.get("brand", ""),
            "model": car.get("model", ""),
            "color": car.get("color", ""),
            "company": car.get("company", "Sawasdee Rent A Car"),
            "status": car.get("status", "ว่างพร้อมใช้งาน"),
            "price_day": float(car.get("price_day") or car.get("daily_rate") or 0),
            "total_rentals": r_cnt,
            "gross_revenue": gross,
            "total_expense": exp,
            "net_profit": net,
            "operating_expense": exp,
            "operating_profit": net,
            "installment_cost": installment_cost,
            "tax_cost": tax_cost,
            "act_cost": act_cost,
            "insurance_cost": insurance_cost,
            "annual_fixed_cost": annual_fixed_cost,
            "fixed_cost_total": fixed_cost_total,
            "total_cost_all": total_cost_all,
            "net_fleet_roi": net_fleet_roi,
            "roi_percent": roi_percent,
            "break_even_reached": break_even_reached,
            "break_even_gap": break_even_gap,
        })

    # Sort descending by selected view mode
    if str(mode).strip().lower() == "net_roi":
        profitability.sort(key=lambda x: (x["net_fleet_roi"], x["gross_revenue"], x["total_rentals"]), reverse=True)
    else:
        profitability.sort(key=lambda x: (x["net_profit"], x["gross_revenue"], x["total_rentals"]), reverse=True)
    for idx, item in enumerate(profitability, 1):
        item["rank"] = idx

    return profitability


@router.get("/api/dashboard/stats")
@router.get("/api/reports/kpis")
def get_dashboard_stats(response: Response):
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return compute_dashboard_statistics()


@router.get("/api/reports/monthly")
def get_monthly_reports(month: Optional[str] = None):
    # month format: "YYYY-MM"
    jobs = store.completed_jobs
    if month:
        filtered = []
        for j in jobs:
            c_d = j.get("completed_date") or j.get("end_date")
            d = to_date(c_d)
            if d and d.strftime("%Y-%m") == month:
                filtered.append(j)
        jobs = filtered

    total_rev = sum(float(j.get("net_price", 0)) for j in jobs)
    return {
        "total_jobs": len(jobs),
        "total_revenue": total_rev,
        "jobs": jobs
    }


@router.get("/api/reports/export-csv")
def export_csv(month: Optional[str] = None):
    jobs = store.completed_jobs
    if month:
        filtered = []
        for j in jobs:
            c_d = j.get("completed_date") or j.get("end_date")
            d = to_date(c_d)
            if d and d.strftime("%Y-%m") == month:
                filtered.append(j)
        jobs = filtered

    rows = []
    for x in jobs:
        rows.append({
            "รหัสการจอง": x.get("booking_id", ""),
            "วันที่เสร็จสิ้น": format_date_dmy(x.get("completed_date") or x.get("end_date")),
            "ทะเบียนรถ": x.get("car_id", ""),
            "ลูกค้า": x.get("customer", ""),
            "บริษัท": x.get("company", ""),
            "ประเภทสัญญา": x.get("contract_type", "รายวัน"),
            "รายรับสุทธิ (THB)": x.get("net_price", 0),
            "พนักงานส่งรถ": x.get("worker_delivery", "-"),
            "พนักงานรับรถ": x.get("worker_return", "-"),
            "สถานที่": x.get("loc_return") or x.get("loc_delivery") or "-",
            "ระดับน้ำมัน": x.get("fuel_level", "-"),
            "สถานะ": "เสร็จสิ้น"
        })
    buf = io.StringIO()
    fieldnames = [
        "รหัสการจอง", "วันที่เสร็จสิ้น", "ทะเบียนรถ", "ลูกค้า", "บริษัท",
        "ประเภทสัญญา", "รายรับสุทธิ (THB)", "พนักงานส่งรถ", "พนักงานรับรถ",
        "สถานที่", "ระดับน้ำมัน", "สถานะ"
    ]
    writer = csv.DictWriter(buf, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(rows)
    csv_bytes = buf.getvalue().encode("utf-8-sig")
    return StreamingResponse(
        io.BytesIO(csv_bytes),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=completed_jobs_{month or 'all'}.csv"}
    )
