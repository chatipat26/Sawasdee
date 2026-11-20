"""
End-to-end API contract smoke tests across all 10 FastAPI routers using isolated store.
"""

from datetime import date


def test_system_router(client):
    assert client.get("/").status_code == 200
    st = client.get("/api/status")
    assert st.status_code == 200
    assert st.json()["status"] == "online"

    sync_resp = client.post("/api/sync")
    assert sync_resp.status_code == 200
    assert sync_resp.json()["success"] is True

    gd = client.get("/api/gdrive/status")
    assert gd.status_code == 200
    assert "folders" in gd.json()


def test_auth_and_users_router(client):
    bad_login = client.post("/api/auth/login", json={"username": "admin", "password": "wrong"})
    assert bad_login.status_code == 401

    ok_login = client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
    assert ok_login.status_code == 200
    assert ok_login.json()["user"]["username"] == "admin"

    reg = client.post(
        "/api/auth/register",
        json={"username": "newstaff", "name": "New Staff", "password": "pw123", "line_user_id": "U999"},
    )
    assert reg.status_code == 200

    users_resp = client.get("/api/users")
    assert users_resp.status_code == 200
    assert any(u["username"] == "newstaff" for u in users_resp.json())

    appr = client.post("/api/users/newstaff/approve")
    assert appr.status_code == 200

    push = client.post("/api/users/staff01/test-line")
    assert push.status_code == 200
    assert push.json()["success"] is True


def test_customers_router(client):
    r_list = client.get("/api/customers")
    assert r_list.status_code == 200
    assert len(r_list.json()) >= 2

    r_create = client.post(
        "/api/customers",
        json={
            "full_name": "วิภา สุขสันต์",
            "phone_number": "0899998888",
            "id_card_no": "1100200300405",
        },
    )
    assert r_create.status_code == 200

    # Duplicate phone number should be blocked with 400
    r_dup = client.post(
        "/api/customers",
        json={"full_name": "อีกคน เบอร์ซ้ำ", "phone_number": "0899998888"},
    )
    assert r_dup.status_code == 400

    r_del = client.delete("/api/customers/วิภา สุขสันต์")
    assert r_del.status_code == 200


def test_cars_router(client):
    assert client.get("/api/cars").status_code == 200
    assert client.get("/api/vehicles").status_code == 200
    assert client.get("/api/cars/options").status_code == 200
    assert client.get("/api/finance-companies").status_code == 200
    assert client.get("/api/hp-leasing").status_code == 200

    r_add = client.post(
        "/api/cars",
        json={
            "plate": "9กข-9999",
            "brand": "Mazda",
            "model": "2",
            "daily_rate": 1100,
            "chassis_no": "MZ1234567890",
        },
    )
    assert r_add.status_code == 200
    assert r_add.json()["success"] is True

    r_dup = client.post(
        "/api/cars",
        json={"plate": "9กข-9999", "brand": "Mazda", "model": "2"},
    )
    assert r_dup.status_code == 409

    r_check = client.get("/api/cars/check-duplicates")
    assert r_check.status_code == 200
    assert r_check.json()["is_clean"] is True

    r_del = client.delete("/api/cars/9กข-9999")
    assert r_del.status_code == 200


def test_bookings_router(client):
    r_list = client.get("/api/bookings")
    assert r_list.status_code == 200
    assert len(r_list.json()) == 2

    r_one = client.get("/api/bookings/MRC2611200001")
    assert r_one.status_code == 200
    assert r_one.json()["car_id"] == "2กข-2222"

    r_jobs = client.get("/api/backoffice/jobs")
    assert r_jobs.status_code == 200
    assert len(r_jobs.json()) >= 1

    r_del = client.delete("/api/bookings/MRC2611200001")
    assert r_del.status_code == 200


def test_maintenance_router(client):
    assert client.get("/api/maintenance").status_code == 200
    assert client.get("/api/work-order-logs").status_code == 200

    r_create = client.post(
        "/api/maintenance",
        json={
            "car_id": "1กข-1111",
            "order_type": "ซ่อมบำรุงทั่วไป / เช็คระยะ",
            "service_items": "ตรวจเช็คเบรก",
            "cost": 1800.0,
            "schedule_date": date.today().isoformat(),
        },
    )
    assert r_create.status_code == 200
    mnt_id = r_create.json()["maintenance"]["id"]

    assert client.get(f"/api/maintenance/{mnt_id}").status_code == 200
    assert client.put(f"/api/maintenance/{mnt_id}", json={"notes": "อัปเดตทดสอบ"}).status_code == 200
    assert client.delete(f"/api/maintenance/{mnt_id}").status_code == 200


def test_finance_and_reports_routers(client):
    assert client.get("/api/expenses/monthly").status_code == 200
    assert client.get("/api/expenses/cycle-expiries").status_code == 200

    rec = client.post(
        "/api/financial-records",
        json={"type": "Income", "category": "ค่าเช่ารถ", "amount": 1500.0, "ref_id": "MRC2611200002"},
    )
    assert rec.status_code == 200

    fin = client.get("/api/finance/summary")
    assert fin.status_code == 200
    assert fin.json()["success"] is True

    assert client.get("/api/reports/car-profitability").status_code == 200
    assert client.get("/api/dashboard/stats").status_code == 200
    assert client.get("/api/reports/kpis").status_code == 200
    assert client.get("/api/reports/monthly").status_code == 200

    csv_resp = client.get("/api/reports/export-csv")
    assert csv_resp.status_code == 200
    assert "text/csv" in csv_resp.headers["content-type"]


def test_pdf_and_line_routers(client):
    c_pdf = client.get("/api/pdf/contract/MRC2611200001")
    assert c_pdf.status_code == 200
    assert c_pdf.content.startswith(b"%PDF")

    r_pdf = client.get("/api/pdf/receipt/MRC2611200001")
    assert r_pdf.status_code == 200
    assert r_pdf.content.startswith(b"%PDF")

    d_pdf = client.get("/api/pdf/deposit-receipt/MRC2611200001")
    assert d_pdf.status_code == 200
    assert d_pdf.content.startswith(b"%PDF")

    html_insp = client.get("/api/html/inspection/MRC2611200001")
    assert html_insp.status_code == 200
    assert "<html" in html_insp.text.lower()

    assert client.post("/api/line/broadcast", json={"message": "test"}).status_code == 200
    assert client.post("/api/line/check-expiry", json={}).status_code == 200

    webhook = client.post(
        "/api/line/webhook",
        json={
            "events": [
                {
                    "type": "message",
                    "replyToken": "dummy_reply_token",
                    "source": {"userId": "U_NEW_LINK_123"},
                    "message": {"type": "text", "text": "staff01"},
                }
            ]
        },
    )
    assert webhook.status_code == 200
    assert webhook.json()["status"] == "ok"
