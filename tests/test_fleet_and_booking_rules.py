"""
Core business rule tests:
- Fleet status calculation across all 4 states (Available, Booked, On Rent, Maintenance)
- Fixed 5,000 THB security deposit & remaining rental calculation
- Double-booking date overlap protection (HTTP 409 Conflict)
- Contract-before-rent state machine guard (HTTP 400 Bad Request)
"""

from datetime import date, timedelta


def test_car_fleet_statuses_and_dashboard_counts(client):
    cars_resp = client.get("/api/cars")
    assert cars_resp.status_code == 200
    cars_by_plate = {c["plate"]: c for c in cars_resp.json()}

    assert cars_by_plate["1กข-1111"]["fleet_status_key"] == "available"
    assert cars_by_plate["1กข-1111"]["is_on_rent"] is False

    assert cars_by_plate["2กข-2222"]["fleet_status_key"] == "reserved"
    assert cars_by_plate["2กข-2222"]["is_on_rent"] is False

    assert cars_by_plate["3กข-3333"]["fleet_status_key"] == "unavailable"
    assert cars_by_plate["3กข-3333"]["is_on_rent"] is True

    assert cars_by_plate["4กข-4444"]["fleet_status_key"] == "maintenance"

    stats_resp = client.get("/api/dashboard/stats")
    assert stats_resp.status_code == 200
    stats = stats_resp.json()
    assert stats["total_fleet"] == 4
    assert stats["available"] == 1
    assert stats["booked"] == 1
    assert stats["on_rent"] == 1
    assert stats["maintenance"] == 1


def test_booking_fixed_5000_deposit_and_remaining_rental(client):
    start_d = (date.today() + timedelta(days=10)).isoformat()
    end_d = (date.today() + timedelta(days=17)).isoformat()  # 8 days @ 1000/day = 8000 THB

    create_resp = client.post(
        "/api/bookings",
        json={
            "car_id": "1กข-1111",
            "customer": "สมชาย ใจดี",
            "start_date": start_d,
            "end_date": end_d,
            "start_time": "10:00",
            "end_time": "10:00",
            "contract_type": "รายวัน",
            "base_price": 8000.0,
            "discount": 0.0,
        },
    )
    assert create_resp.status_code == 200
    bk = create_resp.json()["booking"]
    bk_id = bk["booking_id"]

    # Fixed 5,000 THB deposit rule
    assert bk["deposit_amount"] == 5000.0
    assert bk["net_price"] == 8000.0
    assert bk["deposit_paid"] is False
    assert bk["status"] == "รอชำระมัดจำ"

    # Pay deposit only (even if payload sends another amount, verify or default 5000)
    dep_resp = client.post(
        f"/api/bookings/{bk_id}/deposit",
        json={"payment_method": "โอนเงิน / สแกน QR", "also_pay_rental": False},
    )
    assert dep_resp.status_code == 200
    dep_bk = dep_resp.json()["booking"]
    assert dep_bk["deposit_paid"] is True
    assert dep_bk["deposit_amount"] == 5000.0
    assert dep_bk["status"] == "รอส่งมอบ"
    assert dep_bk["remaining_rental"] == 3000.0  # 8000 - 5000

    # Settle remaining rental balance
    settle_resp = client.post(
        f"/api/bookings/{bk_id}/settle",
        json={"payment_method": "เงินสด"},
    )
    assert settle_resp.status_code == 200
    settled_bk = settle_resp.json()["booking"]
    assert settled_bk["rental_paid"] is True
    assert settled_bk["is_fully_paid"] is True
    assert settled_bk["remaining_rental"] == 0.0


def test_booking_overlap_conflict_returns_409(client):
    s_d = (date.today() + timedelta(days=20)).isoformat()
    e_d = (date.today() + timedelta(days=23)).isoformat()

    r1 = client.post(
        "/api/bookings",
        json={
            "car_id": "1กข-1111",
            "customer": "สมชาย ใจดี",
            "start_date": s_d,
            "end_date": e_d,
        },
    )
    assert r1.status_code == 200

    # Overlapping booking on the exact same car
    r2 = client.post(
        "/api/bookings",
        json={
            "car_id": "1กข-1111",
            "customer": "ลูกค้าทั่วไป (Walk-in)",
            "start_date": (date.today() + timedelta(days=21)).isoformat(),
            "end_date": (date.today() + timedelta(days=24)).isoformat(),
        },
    )
    assert r2.status_code == 409


def test_require_contract_before_rent_guard(client):
    # Seeded booking MRC2611200001 has deposit_paid=True, rental_paid=False, contract_issued=False
    resp = client.put(
        "/api/bookings/MRC2611200001",
        json={"status": "กำลังเช่า"},
    )
    assert resp.status_code == 400
    assert "สัญญาเช่า" in resp.json()["detail"]
