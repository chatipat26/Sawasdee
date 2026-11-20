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
def get_car_profitability():
    # Computes gross revenue, expenses (repairs/maintenance), and net profit per car
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
            if f_type == "รายรับ" and f_cat == "ค่าเช่ารถ":
                if f_ref not in completed_bids:
                    rev_by_car[matched_pl] = rev_by_car.get(matched_pl, 0.0) + f_amt
            elif f_type == "รายจ่าย":
                # Do NOT count customer security deposit refunds as vehicle operating/maintenance expenses
                is_deposit_refund = (
                    ("คืนเงินมัดจำ" in f_cat)
                    or ("คืนมัดจำ" in f_cat)
                    or ("คืนเงินมัดจำ" in f_det)
                    or ("คืนมัดจำ" in f_det)
                )
                if not is_deposit_refund and f_ref not in mnt_ids:
                    exp_by_car[matched_pl] = exp_by_car.get(matched_pl, 0.0) + f_amt

    profitability = []
    for plate, car in store.cars.items():
        gross = round(rev_by_car.get(plate, 0.0), 2)
        exp = round(exp_by_car.get(plate, 0.0), 2)
        net = round(gross - exp, 2)
        r_cnt = rentals_by_car.get(plate, 0)

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
            "net_profit": net
        })

    # Sort descending: Highest net profit first, then revenue, then rentals count
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
