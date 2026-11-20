"""
Phase 4 Batch 4A verification tests:
- QW-1: Swap vehicle crash fix & standard `"ซ่อมบำรุง"` status
- QW-2: Car profitability excludes security deposit refunds from vehicle expenses
- QW-3: Shift closing payment split across deposit, initial rental, and contract extensions
- QW-4: File upload size (>10 MB -> 413) & extension/MIME whitelist guards (-> 400)
- HI-1: HMAC-SHA256 session tokens, backend RBAC (401/403), and LINE webhook X-Line-Signature verification
"""

import base64
import hashlib
import hmac
import json
import os
from datetime import date, timedelta
from fastapi.testclient import TestClient

import server
from dependencies import MAX_UPLOAD_BYTES, create_session_token, static_dir


TINY_PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01"
    b"\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)


def test_qw1_swap_vehicle_no_crash_and_standard_maintenance_status(client, isolated_store):
    r_swap = client.post(
        "/api/bookings/MRC2611200002/close-return",
        json={
            "action": "swap_vehicle",
            "new_car_id": "1กข-1111",
            "mileage": "30,500",
            "fuel_level": "เต็มถัง (Full - 8/8) [100%]",
            "damage_desc": "แอร์ไม่เย็นระหว่างเช่า",
            "repair_cost": 1500.0,
            "service_center": "อู่ช่างเอก",
        },
    )
    assert r_swap.status_code == 200, r_swap.text
    data = r_swap.json()
    assert data["action"] == "swap_vehicle"
    assert data["new_car_id"] == "1กข-1111"

    assert isolated_store.cars["3กข-3333"]["status"] == "ซ่อมบำรุง"
    assert isolated_store.cars["3กข-3333"]["car_status"] == "ซ่อมบำรุง"
    assert isolated_store.cars["1กข-1111"]["status"] == "กำลังเช่า"

    swapped_bk = next(b for b in isolated_store.bookings if b["booking_id"] == "MRC2611200002")
    assert swapped_bk["car_id"] == "1กข-1111"
    assert float(swapped_bk["pending_damage_cost"]) == 1500.0
    assert any(
        m.get("car_id") == "3กข-3333" and float(m.get("cost") or 0) == 1500.0
        for m in isolated_store.maintenance_records
    )


def test_qw2_car_profitability_excludes_deposit_refund(client, isolated_store):
    r_close = client.post(
        "/api/bookings/MRC2611200002/close-return",
        json={
            "action": "end_contract",
            "mileage": "30,250",
            "fuel_level": "เต็มถัง (Full - 8/8) [100%]",
            "condition": "normal",
            "late_fee": 0.0,
        },
    )
    assert r_close.status_code == 200, r_close.text

    # Confirm the 5,000 THB deposit refund expense record was logged in financial_records
    assert any(
        f.get("type") == "รายจ่าย" and "คืนเงินมัดจำ" in str(f.get("category", ""))
        for f in isolated_store.financial_records
    )

    prof_resp = client.get("/api/reports/car-profitability")
    assert prof_resp.status_code == 200
    prof_by_plate = {row["plate"]: row for row in prof_resp.json()}
    altis = prof_by_plate["3กข-3333"]
    assert altis["gross_revenue"] == 1500.0
    assert altis["total_expense"] == 0.0
    assert altis["net_profit"] == 1500.0


def test_qw3_shift_closing_splits_deposit_initial_rental_and_extension_by_payment_method(client, isolated_store):
    isolated_store.bookings = []
    isolated_store.completed_jobs = []
    isolated_store.financial_records = []

    today = date.today()
    s_date = today.isoformat()
    e_date = (today + timedelta(days=8)).isoformat()
    ext_date = (today + timedelta(days=10)).isoformat()

    r_bk = client.post(
        "/api/bookings",
        json={
            "booking_id": "MRC_QW3_0001",
            "car_id": "1กข-1111",
            "customer": "สมชาย ใจดี",
            "start_date": s_date,
            "end_date": e_date,
            "start_time": "10:00",
            "end_time": "10:00",
            "contract_type": "รายวัน",
            "discount": 0.0,
        },
    )
    assert r_bk.status_code == 200, r_bk.text

    r_dep = client.post(
        "/api/bookings/MRC_QW3_0001/deposit",
        json={"amount": 5000.0, "payment_method": "โอนเงิน / สแกน QR", "also_pay_rental": False},
    )
    assert r_dep.status_code == 200, r_dep.text

    r_settle = client.post(
        "/api/bookings/MRC_QW3_0001/settle",
        json={"payment_method": "เงินสด"},
    )
    assert r_settle.status_code == 200, r_settle.text

    # Move booking to On-Rent state to allow contract extension
    bk = next(b for b in isolated_store.bookings if b["booking_id"] == "MRC_QW3_0001")
    bk["contract_issued"] = True
    bk["status"] = "กำลังเช่า"

    r_ext = client.post(
        "/api/bookings/MRC_QW3_0001/extend",
        json={
            "new_end_date": ext_date,
            "also_pay_rental": True,
            "payment_method": "บัตรเครดิต",
            "payment_ref": "EDC-QW3",
        },
    )
    assert r_ext.status_code == 200, r_ext.text

    summary = client.get("/api/finance/summary")
    assert summary.status_code == 200
    s_data = summary.json()
    assert s_data["total_revenue"] == 15000.0
    assert s_data["by_method"]["โอนเงิน / สแกน QR"] == 5000.0
    assert s_data["by_method"]["เงินสด"] == 8000.0
    assert s_data["by_method"]["บัตรเครดิต"] == 2000.0

    # Clean up generated PDF artifact if any
    co_pdf = os.path.join(static_dir, "pdf", "inspections", "Inspection_Checkout_MRC_QW3_0001.pdf")
    if os.path.exists(co_pdf):
        os.remove(co_pdf)


def test_qw4_upload_size_and_mime_guard(client):
    r_exe = client.post(
        "/api/upload-photo",
        files={"file": ("malware.exe", b"MZ...", "application/octet-stream")},
    )
    assert r_exe.status_code == 400

    r_txt_car = client.post(
        "/api/cars/1กข-1111/images",
        files={"file": ("note.txt", b"hello", "text/plain")},
    )
    assert r_txt_car.status_code == 400

    r_pdf_car = client.post(
        "/api/cars/1กข-1111/images",
        files={"file": ("doc.pdf", b"%PDF-1.4", "application/pdf")},
    )
    assert r_pdf_car.status_code == 400

    oversized = b"A" * (MAX_UPLOAD_BYTES + 1)
    r_big_photo = client.post(
        "/api/upload-photo",
        files={"file": ("huge.png", oversized, "image/png")},
    )
    assert r_big_photo.status_code == 413

    r_big_car = client.post(
        "/api/cars/1กข-1111/images",
        files={"file": ("huge.png", oversized, "image/png")},
    )
    assert r_big_car.status_code == 413

    r_ok = client.post(
        "/api/upload-photo",
        files={"file": ("valid.png", TINY_PNG, "image/png")},
    )
    assert r_ok.status_code == 200
    assert r_ok.json()["success"] is True


def test_hi1_backend_auth_rbac_and_line_webhook_signature(monkeypatch):
    anon_client = TestClient(server.app)
    assert anon_client.post("/api/cars", json={"plate": "9ฮฮ-1234", "brand": "Test", "model": "X"}).status_code == 401
    assert anon_client.post("/api/users/staff01/approve").status_code == 401

    staff_token = create_session_token("staff01", "Staff")
    staff_client = TestClient(server.app, headers={"Authorization": f"Bearer {staff_token}"})
    assert staff_client.post("/api/users/staff01/approve").status_code == 403
    assert staff_client.delete("/api/cars/1กข-1111").status_code == 403
    assert staff_client.post("/api/admin/migrate-cars").status_code == 403
    assert (
        staff_client.post(
            "/api/customers",
            json={"full_name": "ลูกค้า สิทธิ์พนักงาน", "phone_number": "0897776655"},
        ).status_code
        == 200
    )

    monkeypatch.setenv("LINE_CHANNEL_SECRET", "test-line-channel-secret")
    payload_bytes = json.dumps(
        {
            "events": [
                {
                    "type": "message",
                    "replyToken": "dummy",
                    "source": {"userId": "U_LINE_VERIFY_01"},
                    "message": {"type": "text", "text": "staff01"},
                }
            ]
        }
    ).encode("utf-8")

    bad_sig_resp = anon_client.post(
        "/api/line/webhook",
        content=payload_bytes,
        headers={"Content-Type": "application/json", "X-Line-Signature": "invalid-sig"},
    )
    assert bad_sig_resp.status_code == 401

    missing_enforced_resp = anon_client.post(
        "/api/line/webhook",
        content=payload_bytes,
        headers={"Content-Type": "application/json", "X-Enforce-Line-Signature": "1"},
    )
    assert missing_enforced_resp.status_code == 401

    valid_sig = base64.b64encode(
        hmac.new(b"test-line-channel-secret", payload_bytes, hashlib.sha256).digest()
    ).decode("ascii")
    ok_sig_resp = anon_client.post(
        "/api/line/webhook",
        content=payload_bytes,
        headers={"Content-Type": "application/json", "X-Line-Signature": valid_sig},
    )
    assert ok_sig_resp.status_code == 200
    assert ok_sig_resp.json()["status"] == "ok"
