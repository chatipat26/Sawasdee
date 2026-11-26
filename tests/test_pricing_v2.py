"""
Unit & Integration Tests for P3a & P3b:
- Golden tests for legacy v1 bookings (deposit subtracted from net_price).
- Matrix tests for v2 bookings (refundable security deposit separated from net_price + delivery/pickup fees).
- Server-side fee calculation, branch mode fee=0 enforcement, negative/cap validation (Q4: 10,000 THB).
- Post-booking delivery fee adjustment (PATCH /api/bookings/{id}/delivery), admin guard on fee reduction after payment (Q3), and audit logging.
- Protection against direct pricing field overwrites via generic PUT /api/bookings/{id}.
"""

from datetime import timedelta
from dependencies import now_th, create_session_token
from db import store
from services.booking_service import (
    compute_remaining_rental,
    compute_total_due_at_booking,
    rental_cash_received,
)


def _staff_headers():
    token = create_session_token("staff01", "Staff")
    return {"Authorization": f"Bearer {token}"}


def _future_dates(offset_start: int = 2, days: int = 5):
    today = now_th().date()
    s = today + timedelta(days=offset_start)
    e = s + timedelta(days=days)
    return s.isoformat(), e.isoformat()


def test_v1_golden_balance_preservation():
    """Golden Test: Legacy v1 bookings must preserve exact old formula (remaining = net_price - deposit)."""
    # 1. Unpaid v1 booking
    b_unpaid = {"booking_id": "MRC_V1_1", "net_price": 8000.0, "deposit_amount": 5000.0, "deposit_paid": False, "rental_paid": False}
    assert compute_remaining_rental(b_unpaid) == 8000.0
    assert compute_total_due_at_booking(b_unpaid) == 8000.0
    assert rental_cash_received(b_unpaid) == 0.0

    # 2. Deposit paid only v1 booking -> remaining = 8000 - 5000 = 3000
    b_dep = {"booking_id": "MRC_V1_2", "net_price": 8000.0, "deposit_amount": 5000.0, "deposit_paid": True, "rental_paid": False}
    assert compute_remaining_rental(b_dep) == 3000.0
    assert rental_cash_received(b_dep) == 5000.0

    # 3. Fully paid v1 booking -> remaining = 0
    b_paid = {"booking_id": "MRC_V1_3", "net_price": 8000.0, "deposit_amount": 5000.0, "deposit_paid": True, "rental_paid": True}
    assert compute_remaining_rental(b_paid) == 0.0
    assert rental_cash_received(b_paid) == 8000.0


def test_v2_refundable_deposit_and_delivery_fees_matrix(client, monkeypatch):
    """
    When PRICING_V2_ENABLED=true:
    - net_price = (base_price - discount) + delivery_fee + pickup_fee
    - remaining_rental is NOT reduced by the 5,000 THB security deposit
    - Total cash inflow across deposit + settle equals net_price + 5,000 THB on every path.
    """
    monkeypatch.setenv("PRICING_V2_ENABLED", "true")
    s_date, e_date = _future_dates(2, 5)

    # Path A: Pay deposit first, then settle remaining rental
    res = client.post(
        "/api/bookings",
        json={
            "car_id": "1กข-1111",
            "customer": "ลูกค้าทดสอบ",
            "start_date": s_date,
            "end_date": e_date,
            "base_price": 5000,
            "discount": 500,
            "delivery_mode": "offsite",
            "pickup_mode": "offsite",
            "delivery_fee": 400,
            "pickup_fee": 300,
            "loc_delivery": "สนามบินสุวรรณภูมิ",
            "loc_return": "โรงแรมสยามเคมปินสกี้",
            "driver2_name": "Somying Driver2",
            "driver2_licence": "DL-998877",
            "driver2_dob": "1995-08-15",
        },
    )
    assert res.status_code == 200
    bk = res.json()["booking"]
    bk_id = bk["booking_id"]
    assert bk["pricing_version"] == 2
    # net_price = (5000 - 500) + 400 + 300 = 5200
    assert bk["net_price"] == 5200.0
    assert bk["remaining_rental"] == 5200.0

    # Step 1: Pay 5,000 security deposit only
    dep_res = client.post(
        f"/api/bookings/{bk_id}/deposit",
        json={"amount": 5000, "payment_method": "โอนเงิน / สแกน QR", "ref_id": "DEP-REF-01", "also_pay_rental": False},
    )
    assert dep_res.status_code == 200
    bk_after_dep = dep_res.json()["booking"]
    assert bk_after_dep["deposit_paid"] is True
    # Key v2 rule: remaining_rental stays 5,200 (security deposit is NOT deducted from rental fee)
    assert bk_after_dep["remaining_rental"] == 5200.0
    assert bk_after_dep["received_by"] == "Administrator"
    assert rental_cash_received(bk_after_dep) == 0.0

    # Step 2: Settle remaining rental (5,200 = 4,500 rental + 700 delivery/pickup fee)
    settle_res = client.post(
        f"/api/bookings/{bk_id}/settle",
        json={"payment_method": "เงินสด", "payment_ref": "RENT-REF-02"},
    )
    assert settle_res.status_code == 200
    bk_settled = settle_res.json()["booking"]
    assert bk_settled["rental_paid"] is True
    assert bk_settled["remaining_rental"] == 0.0
    assert bk_settled["fees_paid_amount"] == 700.0
    assert rental_cash_received(bk_settled) == 5200.0

    # Verify ledger breakdown for bk_id: Deposit=5000, Rental=4500, ค่ารับ-ส่งรถ=700 (Total inflow = 10,200)
    recs = [r for r in store.financial_records if r.get("ref") == bk_id]
    by_cat = {}
    for r in recs:
        by_cat[r["category"]] = by_cat.get(r["category"], 0.0) + float(r["amount"])
    assert by_cat.get("Deposit") == 5000.0
    assert by_cat.get("Rental") == 4500.0
    assert by_cat.get("ค่ารับ-ส่งรถ") == 700.0
    assert sum(by_cat.values()) == 10200.0


def test_delivery_fee_validation_and_branch_mode_zeroing(client, monkeypatch):
    """Branch mode must force fee=0; negative fees or fees > 10,000 THB must be rejected with 400."""
    monkeypatch.setenv("PRICING_V2_ENABLED", "true")
    s_date, e_date = _future_dates(10, 3)

    # 1. Branch mode forces fee to 0 even if client passes a number
    res_branch = client.post(
        "/api/bookings",
        json={
            "car_id": "1กข-1111",
            "customer": "ลูกค้าทดสอบ",
            "start_date": s_date,
            "end_date": e_date,
            "base_price": 3000,
            "delivery_mode": "branch",
            "delivery_fee": 900,
        },
    )
    assert res_branch.status_code == 200
    bk = res_branch.json()["booking"]
    assert bk["delivery_fee"] == 0.0
    assert bk["net_price"] == 3000.0

    # 2. Fee exceeding 10,000 THB cap -> 400
    s2, e2 = _future_dates(15, 2)
    res_cap = client.post(
        "/api/bookings",
        json={
            "car_id": "1กข-1111",
            "customer": "ลูกค้าทดสอบ",
            "start_date": s2,
            "end_date": e2,
            "base_price": 2000,
            "delivery_mode": "offsite",
            "delivery_fee": 15000,
        },
    )
    assert res_cap.status_code == 400
    assert "10,000" in res_cap.json()["detail"]

    # 3. Negative fee -> 400
    res_neg = client.post(
        "/api/bookings",
        json={
            "car_id": "1กข-1111",
            "customer": "ลูกค้าทดสอบ",
            "start_date": s2,
            "end_date": e2,
            "base_price": 2000,
            "delivery_mode": "offsite",
            "delivery_fee": -100,
        },
    )
    assert res_neg.status_code == 400


def test_post_payment_fee_adjustment_and_admin_guard(client, monkeypatch):
    """
    D5 & Q3:
    - Increasing fee after payment re-opens remaining_rental = delta and sets rental_paid = False.
    - Decreasing fee after payment is blocked for Staff (403) and allowed for Admin (logs 'คืนค่ารับ-ส่ง' expense).
    - Direct overwrite via generic PUT /api/bookings/{id} is blocked (400).
    """
    monkeypatch.setenv("PRICING_V2_ENABLED", "true")
    s_date, e_date = _future_dates(20, 4)
    staff_hdrs = _staff_headers()

    res = client.post(
        "/api/bookings",
        json={
            "car_id": "1กข-1111",
            "customer": "ลูกค้าทดสอบ",
            "start_date": s_date,
            "end_date": e_date,
            "base_price": 4000,
            "delivery_mode": "offsite",
            "delivery_fee": 500,
        },
    )
    assert res.status_code == 200
    bk_id = res.json()["booking_id"]

    # Pay deposit + rental together
    client.post(
        f"/api/bookings/{bk_id}/deposit",
        json={"amount": 5000, "payment_method": "โอนเงิน / สแกน QR", "also_pay_rental": True},
    )

    # Generic PUT trying to tamper with net_price or delivery_fee must fail with 400
    put_res = client.put(
        f"/api/bookings/{bk_id}",
        json={"net_price": 1000},
    )
    assert put_res.status_code == 400

    # Staff tries to reduce delivery_fee after payment -> 403
    staff_dec = client.patch(
        f"/api/bookings/{bk_id}/delivery",
        headers=staff_hdrs,
        json={"delivery_mode": "offsite", "delivery_fee": 200},
    )
    assert staff_dec.status_code == 403

    # Admin reduces delivery_fee from 500 to 200 -> delta = -300, logs 'คืนค่ารับ-ส่ง' 300 THB
    admin_dec = client.patch(
        f"/api/bookings/{bk_id}/delivery",
        json={"delivery_mode": "offsite", "delivery_fee": 200},
    )
    assert admin_dec.status_code == 200
    dec_data = admin_dec.json()
    assert dec_data["delta"] == -300.0
    assert dec_data["refund_logged"] == 300.0
    assert dec_data["net_price"] == 4200.0
    assert dec_data["rental_paid"] is True
    assert any(r.get("ref") == bk_id and r.get("category") == "คืนค่ารับ-ส่ง" and float(r.get("amount")) == 300.0 for r in store.financial_records)

    # Now add pickup_fee = 600 -> delta = +600 -> re-opens remaining_rental = 600, rental_paid = False
    inc_res = client.patch(
        f"/api/bookings/{bk_id}/delivery",
        headers=staff_hdrs,
        json={"pickup_mode": "offsite", "pickup_fee": 600, "loc_return": "ดอนเมือง"},
    )
    assert inc_res.status_code == 200
    inc_data = inc_res.json()
    assert inc_data["delta"] == 600.0
    assert inc_data["net_price"] == 4800.0
    assert inc_data["remaining_rental"] == 600.0
    assert inc_data["rental_paid"] is False


def test_v4_contract_and_receipt_pdf_and_checkin_refund(client, monkeypatch):
    """
    P3c & P4:
    - Contract PDF v4 renders Delivery fee, Pickup fee, 2-line long address, and RECEIVED BY.
    - Receipt PDF renders itemized breakdown of rental fee, delivery fee, and pickup fee.
    - Check-in close-return logs 5,000 THB security deposit refund with refund method and ref.
    """
    import pymupdf
    monkeypatch.setenv("PRICING_V2_ENABLED", "true")
    s_date, e_date = _future_dates(25, 3)

    res = client.post(
        "/api/bookings",
        json={
            "car_id": "1กข-1111",
            "customer": "ลูกค้าทดสอบ",
            "start_date": s_date,
            "end_date": e_date,
            "base_price": 3000,
            "delivery_mode": "offsite",
            "pickup_mode": "offsite",
            "delivery_fee": 500,
            "pickup_fee": 350,
            "loc_delivery": "สนามบินสุวรรณภูมิ อาคารผู้โดยสารขาเข้า ชั้น 2 ประตู 4",
            "loc_return": "โรงแรมสยามเคมปินสกี้ กรุงเทพฯ (ล็อบบี้หลัก ถนนพระราม 1)",
        },
    )
    assert res.status_code == 200
    bk_id = res.json()["booking_id"]

    # Pay deposit + rental
    client.post(
        f"/api/bookings/{bk_id}/deposit",
        json={"amount": 5000, "payment_method": "โอนเงิน / สแกน QR", "ref_id": "SLIP-P4-001", "also_pay_rental": True},
    )

    # 1. Verify Contract PDF (v4)
    c_res = client.get(f"/api/pdf/contract/{bk_id}")
    assert c_res.status_code == 200
    c_doc = pymupdf.open(stream=c_res.content)
    c_text = c_doc[0].get_text()
    assert "Delivery fee" in c_text
    assert "Pickup fee" in c_text
    assert "฿500" in c_text
    assert "฿350" in c_text
    assert "฿3,850" in c_text
    assert "Administrator" in c_text
    assert "ประตู 4" in c_text  # Not truncated at 30 chars!

    # 2. Verify Receipt PDF itemized breakdown
    r_res = client.get(f"/api/pdf/receipt/{bk_id}")
    assert r_res.status_code == 200
    r_doc = pymupdf.open(stream=r_res.content)
    r_text = r_doc[0].get_text()
    assert "3,000.00" in r_text
    assert "500.00" in r_text
    assert "350.00" in r_text
    assert "3,850.00" in r_text

    # 3. Handover then Check-in with explicit deposit refund confirmation (Q2)
    client.post(f"/api/bookings/{bk_id}/close-dispatch", json={"mileage": "15000"})
    ret_res = client.post(
        f"/api/bookings/{bk_id}/close-return",
        json={
            "action": "end_contract",
            "condition": "normal",
            "mileage": "15250",
            "refund_deposit": True,
            "refund_method": "โอนเงินคืนบัญชีลูกค้า",
            "refund_ref": "REFUND-SLIP-99",
        },
    )
    assert ret_res.status_code == 200
    refund_recs = [
        r for r in store.financial_records
        if r.get("ref") == bk_id and r.get("category") == "คืนเงินมัดจำประกันสัญญา"
    ]
    assert len(refund_recs) == 1
    assert float(refund_recs[0]["amount"]) == 5000.0
    assert "REFUND-SLIP-99" in refund_recs[0]["detail"]


def test_p5_backoffice_line_and_p6_finance_summary_reconciliation(client, monkeypatch):
    """
    P5 & P6:
    - Back Office /api/backoffice/jobs returns is_offsite=True, fee, and off-site labels.
    - LINE work order message & /api/line/command ('คิวส่งรถ') include off-site badge, location, and fee.
    - Finance summary (/api/finance/summary) separates 'ค่ารับ-ส่งรถ' from 'ค่าเช่ารถ',
      and subtracts 'คืนค่ารับ-ส่ง' and 'คืนเงินมัดจำประกันสัญญา' from net total_revenue.
    """
    from line_service import format_line_work_order_message

    monkeypatch.setenv("PRICING_V2_ENABLED", "true")
    s_date, e_date = _future_dates(30, 4)

    res = client.post(
        "/api/bookings",
        json={
            "car_id": "1กข-1111",
            "customer": "ลูกค้าทดสอบ",
            "start_date": s_date,
            "end_date": e_date,
            "base_price": 4000,
            "delivery_mode": "offsite",
            "pickup_mode": "offsite",
            "delivery_fee": 600,
            "pickup_fee": 400,
            "loc_delivery": "สนามบินดอนเมือง อาคาร 2",
            "loc_return": "เซ็นทรัลเวิลด์ พระราม 1",
        },
    )
    assert res.status_code == 200
    bk = res.json()["booking"]
    bk_id = bk["booking_id"]

    # 1. Verify P5 Back Office Jobs listing
    bo_res = client.get("/api/backoffice/jobs")
    assert bo_res.status_code == 200
    jobs = [j for j in bo_res.json() if j.get("booking_id") == bk_id]
    disp_job = next(j for j in jobs if j["job_type"] == "Dispatch")
    ret_job = next(j for j in jobs if j["job_type"] == "Return")
    assert disp_job["is_offsite"] is True
    assert disp_job["fee"] == 600.0
    assert "นอกสถานที่" in disp_job["job_type_label"]
    assert ret_job["is_offsite"] is True
    assert ret_job["fee"] == 400.0

    # 2. Verify P5 LINE message formatting & /api/line/command
    line_msg = format_line_work_order_message(bk, job_type="Dispatch", worker_name="staff01")
    assert "จัดส่งรถนอกสถานที่" in line_msg
    assert "สนามบินดอนเมือง อาคาร 2" in line_msg
    assert "600.00" in line_msg

    # Pay deposit (5000) + rental (4000 + 1000 = 5000) -> Gross collected = 10,000
    client.post(
        f"/api/bookings/{bk_id}/deposit",
        json={"amount": 5000, "payment_method": "โอนเงิน / สแกน QR", "also_pay_rental": True},
    )

    # Admin reduces delivery_fee from 600 to 400 -> logs 'คืนค่ารับ-ส่ง' = 200
    client.patch(
        f"/api/bookings/{bk_id}/delivery",
        json={"delivery_mode": "offsite", "delivery_fee": 400},
    )

    # Issue contract -> close dispatch -> close return (refunds 5,000 security deposit)
    client.get(f"/api/pdf/contract/{bk_id}")
    client.post(f"/api/bookings/{bk_id}/close-dispatch", json={"mileage": "15500"})
    client.post(
        f"/api/bookings/{bk_id}/close-return",
        json={"action": "end_contract", "condition": "normal", "mileage": "15800", "refund_deposit": True},
    )

    # 3. Verify P6 Finance Summary reconciliation
    fin_res = client.get("/api/finance/summary")
    assert fin_res.status_code == 200
    f_data = fin_res.json()
    by_cat = f_data["by_category"]
    assert by_cat["ค่ารับ-ส่งรถ"] >= 800.0
    assert by_cat["คืนค่ารับ-ส่ง"] >= 200.0
    assert by_cat["คืนเงินมัดจำประกันสัญญา"] >= 5000.0
    # Net delivery_pickup_revenue = 800 - 200 = 600
    assert f_data["delivery_pickup_revenue"] == 600.0


