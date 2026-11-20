"""
Phase 5 Batch 5B verification tests:
- P5-B3: Full Net ROI & Break-Even Analytics (Operating Profit vs Net Fleet ROI & Fixed Costs)
- P5-C1: Smart Delta Live Sync (per-category signatures in GET /api/status)
- P5-C2: One-Click Disaster Recovery Backup (GET /api/admin/backup-snapshot with RBAC & password stripping)
"""

import json
from fastapi.testclient import TestClient

import server
from dependencies import create_session_token


def test_p5_b3_car_profitability_operating_and_net_roi_break_even(client, isolated_store):
    # Clear pre-seeded financial records / maintenance to assert exact math
    isolated_store.maintenance_records = [
        {"id": "MNT_ROI_1", "car_id": "1กข-1111", "cost": 1500.0, "actual_cost": 1500.0, "status": "เสร็จสิ้น"}
    ]
    isolated_store.financial_records = []
    isolated_store.completed_jobs = [
        {"booking_id": "MRC_ROI_1", "car_id": "1กข-1111", "customer": "สมชาย ใจดี", "net_price": 25000.0, "status": "เสร็จสิ้น"}
    ]

    # 1กข-1111: Gross=25000, Repair=1500, Installment=10000, Tax=1500, ACT=645, Ins=8000 => Fixed=20145, AllCost=21645
    isolated_store.cars["1กข-1111"].update({
        "is_debt_free": False,
        "installment_amount": 10000.0,
        "tax_price": 1500.0,
        "prb_price": 645.0,
        "insurance_premium": 8000.0,
    })

    # 2กข-2222: Active booking Gross=8400 (from conftest), Installment=12000, Ins=6000 => Fixed=18000 => Net ROI=-9600
    isolated_store.cars["2กข-2222"].update({
        "is_debt_free": False,
        "installment_amount": 12000.0,
        "tax_price": 0.0,
        "prb_price": 0.0,
        "insurance_premium": 6000.0,
    })

    # 3กข-3333: Debt-free flag overrides installment_amount -> installment_cost MUST be 0.0
    isolated_store.cars["3กข-3333"].update({
        "is_debt_free": True,
        "installment_amount": 9000.0,
        "tax_price": 500.0,
    })

    resp_op = client.get("/api/reports/car-profitability")
    assert resp_op.status_code == 200
    by_plate = {r["plate"]: r for r in resp_op.json()}

    yaris = by_plate["1กข-1111"]
    assert yaris["gross_revenue"] == 25000.0
    assert yaris["operating_expense"] == 1500.0
    assert yaris["operating_profit"] == 23500.0
    assert yaris["net_profit"] == 23500.0
    assert yaris["installment_cost"] == 10000.0
    assert yaris["annual_fixed_cost"] == 10145.0
    assert yaris["fixed_cost_total"] == 20145.0
    assert yaris["total_cost_all"] == 21645.0
    assert yaris["net_fleet_roi"] == 3355.0
    assert yaris["break_even_reached"] is True
    assert yaris["break_even_gap"] == 0.0
    assert yaris["roi_percent"] == 115.5

    city = by_plate["2กข-2222"]
    assert city["gross_revenue"] == 8400.0
    assert city["operating_profit"] == 8400.0
    assert city["fixed_cost_total"] == 18000.0
    assert city["net_fleet_roi"] == -9600.0
    assert city["break_even_reached"] is False
    assert city["break_even_gap"] == 9600.0
    assert city["roi_percent"] == 46.7

    altis = by_plate["3กข-3333"]
    assert altis["installment_cost"] == 0.0
    assert altis["annual_fixed_cost"] == 500.0
    assert altis["net_fleet_roi"] == 1000.0
    assert altis["break_even_reached"] is True

    # mode=net_roi sorts by net_fleet_roi descending (1กข-1111=+3355 > 3กข-3333=+1000 > ... > 2กข-2222=-9600)
    resp_roi = client.get("/api/reports/car-profitability?mode=net_roi")
    assert resp_roi.status_code == 200
    roi_rows = resp_roi.json()
    assert roi_rows[0]["plate"] == "1กข-1111"
    assert roi_rows[-1]["plate"] == "2กข-2222"


def test_p5_c1_smart_delta_live_sync_category_signatures(client, isolated_store):
    s1 = client.get("/api/status")
    assert s1.status_code == 200
    d1 = s1.json()
    assert "signatures" in d1
    sigs1 = d1["signatures"]
    assert set(sigs1.keys()) == {"cars", "bookings", "customers", "maintenance", "users", "finance"}

    # Mutating only a customer must change ONLY `customers` signature (and overall data_signature)
    isolated_store.customers["สมชาย ใจดี"]["crm_tier"] = "VIP"
    s2 = client.get("/api/status")
    assert s2.status_code == 200
    d2 = s2.json()
    sigs2 = d2["signatures"]
    assert sigs2["customers"] != sigs1["customers"]
    assert sigs2["cars"] == sigs1["cars"]
    assert sigs2["bookings"] == sigs1["bookings"]
    assert sigs2["maintenance"] == sigs1["maintenance"]
    assert sigs2["users"] == sigs1["users"]
    assert sigs2["finance"] == sigs1["finance"]
    assert d2["data_signature"] != d1["data_signature"]

    # Mutating only car mileage changes `cars` without changing `customers` or `bookings`
    isolated_store.cars["1กข-1111"]["mileage"] = "16,500"
    s3 = client.get("/api/status")
    sigs3 = s3.json()["signatures"]
    assert sigs3["cars"] != sigs2["cars"]
    assert sigs3["customers"] == sigs2["customers"]
    assert sigs3["bookings"] == sigs2["bookings"]


def test_p5_c2_admin_backup_snapshot_rbac_and_sanitization(client, isolated_store):
    # 1. Unauthenticated caller -> 401
    anon_client = TestClient(server.app)
    r_anon = anon_client.get("/api/admin/backup-snapshot")
    assert r_anon.status_code == 401

    # 2. Staff caller -> 403 Forbidden
    staff_token = create_session_token("staff01", "Staff")
    r_staff = anon_client.get(
        "/api/admin/backup-snapshot",
        headers={"Authorization": f"Bearer {staff_token}"},
    )
    assert r_staff.status_code == 403

    # 3. Admin caller -> 200 downloadable JSON snapshot with passwords stripped
    r_admin = client.get("/api/admin/backup-snapshot")
    assert r_admin.status_code == 200
    assert "application/json" in r_admin.headers.get("content-type", "")
    disp = r_admin.headers.get("content-disposition", "")
    assert "attachment" in disp and "sawasdee_backup_" in disp and ".json" in disp

    payload = json.loads(r_admin.content.decode("utf-8"))
    assert payload["backup_version"] == "1.0"
    assert payload["generated_by"] == "admin"
    assert set(payload["data"].keys()) == {
        "cars", "customers", "bookings", "completed_jobs",
        "maintenance_records", "financial_records", "users",
    }
    assert payload["counts"]["cars"] == len(isolated_store.cars)
    assert payload["counts"]["bookings"] == len(isolated_store.bookings)
    assert len(payload["data"]["users"]) == len(isolated_store.users)
    for u in payload["data"]["users"]:
        assert "password" not in u
        assert "password_hash" not in u
        assert "hashed_password" not in u
