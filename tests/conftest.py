"""
Pytest fixtures for isolated in-memory testing without touching PostgreSQL, disk JSON caches,
LINE Messaging API, or Google Drive API.
"""

import copy
from datetime import date, timedelta
import pytest
from fastapi.testclient import TestClient

import db
import line_service
import server
import services.booking_service as booking_service
import services.finance_service as finance_service
import services.google_drive_service as google_drive_service
import services.maintenance_service as maintenance_service
import routers.auth as auth_router_mod
import routers.bookings as bookings_router_mod
import routers.cars as cars_router_mod
import routers.finance as finance_router_mod
import routers.line as line_router_mod
import routers.maintenance as maintenance_router_mod
import routers.pdf as pdf_router_mod
import routers.system as system_router_mod


@pytest.fixture(autouse=True)
def isolated_store(monkeypatch):
    """Snapshot and isolate `db.store` and external service calls for every test."""
    store = db.store
    snapshot = {
        "cars": copy.deepcopy(store.cars),
        "customers": copy.deepcopy(store.customers),
        "bookings": copy.deepcopy(store.bookings),
        "completed_jobs": copy.deepcopy(store.completed_jobs),
        "financial_records": copy.deepcopy(store.financial_records),
        "users": copy.deepcopy(store.users),
        "maintenance_records": copy.deepcopy(store.maintenance_records),
        "work_order_logs": copy.deepcopy(store.work_order_logs),
        "insurance_records": copy.deepcopy(store.insurance_records),
        "vehicle_maintenances": copy.deepcopy(store.vehicle_maintenances),
        "maintenance_logs": copy.deepcopy(store.maintenance_logs),
        "initial_sync_done": store.initial_sync_done,
        "last_sync_time": store.last_sync_time,
    }

    # Prevent any DB connection or background disk JSON write
    monkeypatch.setattr(store, "sync_from_database", lambda force=False: True)
    monkeypatch.setattr(store, "_write_json_snapshot", lambda *a, **kw: None)
    for mod in (
        db,
        auth_router_mod,
        cars_router_mod,
        bookings_router_mod,
        finance_router_mod,
        system_router_mod,
        booking_service,
        finance_service,
    ):
        if hasattr(mod, "get_db_client"):
            monkeypatch.setattr(mod, "get_db_client", lambda: None)

    # In-memory no-op persistence methods on store
    def _mock_sync_car(plate, car_data):
        store.cars[plate] = dict(car_data)

    def _mock_delete_car(plate):
        store.cars.pop(plate, None)

    def _mock_sync_customer(name, cust_data):
        store.customers[name] = dict(cust_data)

    def _mock_delete_customer(name):
        store.customers.pop(name, None)

    def _mock_sync_booking(bk):
        bid = bk.get("booking_id")
        for idx, existing in enumerate(store.bookings):
            if existing.get("booking_id") == bid:
                store.bookings[idx] = bk
                return
        store.bookings.insert(0, bk)

    def _mock_delete_booking(bk_id):
        store.bookings = [b for b in store.bookings if b.get("booking_id") != bk_id]

    def _mock_sync_user(uname, udata):
        store.users[uname] = dict(udata)

    def _mock_delete_user(uname):
        store.users.pop(uname, None)

    def _mock_sync_maintenance(rec):
        rid = rec.get("id")
        for idx, existing in enumerate(store.maintenance_records):
            if existing.get("id") == rid:
                store.maintenance_records[idx] = rec
                return
        store.maintenance_records.insert(0, rec)

    def _mock_log_work_order(**kw):
        entry = {"id": f"WO_TEST_{len(store.work_order_logs) + 1}", **kw}
        store.work_order_logs.insert(0, entry)
        return entry

    def _mock_hard_delete_work_order(clean_id, car_id=None):
        found_car = car_id
        for m in store.maintenance_records:
            if m.get("id") == clean_id and not found_car:
                found_car = m.get("car_id")
        store.maintenance_records = [m for m in store.maintenance_records if m.get("id") != clean_id]
        store.work_order_logs = [
            w for w in store.work_order_logs
            if w.get("id") != clean_id and w.get("booking_id") != clean_id
        ]
        if found_car and found_car in store.cars:
            store.cars[found_car]["status"] = "ว่างพร้อมใช้งาน"
        return found_car

    monkeypatch.setattr(store, "async_sync_car", _mock_sync_car)
    monkeypatch.setattr(store, "async_delete_car", _mock_delete_car)
    monkeypatch.setattr(store, "async_sync_customer", _mock_sync_customer)
    monkeypatch.setattr(store, "async_delete_customer", _mock_delete_customer)
    monkeypatch.setattr(store, "async_sync_booking", _mock_sync_booking)
    monkeypatch.setattr(store, "async_delete_booking", _mock_delete_booking)
    monkeypatch.setattr(store, "async_sync_user", _mock_sync_user)
    monkeypatch.setattr(store, "async_delete_user", _mock_delete_user)
    monkeypatch.setattr(store, "async_sync_maintenance", _mock_sync_maintenance)
    monkeypatch.setattr(store, "async_sync_insurance_record", lambda rec: store.insurance_records.insert(0, rec))
    monkeypatch.setattr(store, "sync_financial", lambda rec: store.financial_records.insert(0, rec))
    monkeypatch.setattr(store, "async_sync_financial", lambda rec: store.financial_records.insert(0, rec))
    monkeypatch.setattr(store, "log_work_order", _mock_log_work_order)
    monkeypatch.setattr(store, "log_maintenance", lambda **kw: store.maintenance_logs.insert(0, kw))
    monkeypatch.setattr(store, "hard_delete_work_order", _mock_hard_delete_work_order)

    # Mock direct SQLAlchemy hard delete
    for mod in (maintenance_service, maintenance_router_mod, cars_router_mod):
        monkeypatch.setattr(mod, "execute_hard_delete_work_order_db", lambda *a, **kw: None)

    # Mock Google Drive uploads
    for mod in (google_drive_service, pdf_router_mod, bookings_router_mod):
        monkeypatch.setattr(mod, "async_upload_pdf_to_drive", lambda *a, **kw: None)
    monkeypatch.setattr(
        google_drive_service,
        "upload_pdf_to_drive",
        lambda *a, **kw: {"success": True, "webViewLink": "https://drive.google.com/file/d/mockpdf/view"},
    )
    monkeypatch.setattr(
        google_drive_service,
        "upload_image_to_drive",
        lambda *a, **kw: {
            "success": True,
            "webViewLink": "https://drive.google.com/file/d/mockimg/view",
            "direct_url": "https://lh3.googleusercontent.com/d/mockimg",
        },
    )
    monkeypatch.setattr(
        cars_router_mod,
        "upload_image_to_drive",
        lambda *a, **kw: {
            "success": True,
            "webViewLink": "https://drive.google.com/file/d/mockimg/view",
            "direct_url": "https://lh3.googleusercontent.com/d/mockimg",
        },
    )

    # Mock LINE Messaging API
    for mod in (line_service, auth_router_mod, line_router_mod):
        if hasattr(mod, "send_line_push_message"):
            monkeypatch.setattr(mod, "send_line_push_message", lambda *a, **kw: True)
        if hasattr(mod, "send_line_reply_message"):
            monkeypatch.setattr(mod, "send_line_reply_message", lambda *a, **kw: True)
        if hasattr(mod, "check_and_send_expiry_alerts"):
            monkeypatch.setattr(
                mod,
                "check_and_send_expiry_alerts",
                lambda *a, **kw: {"sent": True, "count": 0, "message": "mocked"},
            )

    # Seed isolated test dataset
    today = date.today()
    tomorrow = today + timedelta(days=1)
    next_week = today + timedelta(days=7)

    store.initial_sync_done = True
    store.cars = {
        "1กข-1111": {
            "plate": "1กข-1111",
            "brand": "Toyota",
            "model": "Yaris",
            "color": "ขาว",
            "company": "Sawasdee Rent A Car",
            "owner_company": "Sawasdee Rent A Car",
            "status": "ว่างพร้อมใช้งาน",
            "car_status": "ว่างพร้อมใช้งาน",
            "daily_rate": 1000.0,
            "price_day": 1000.0,
            "mileage": "15,000",
            "tax_expire_date": (today + timedelta(days=20)).isoformat(),
            "prb_expire_date": (today + timedelta(days=60)).isoformat(),
            "insurance_expire_date": (today + timedelta(days=90)).isoformat(),
        },
        "2กข-2222": {
            "plate": "2กข-2222",
            "brand": "Honda",
            "model": "City",
            "color": "ดำ",
            "company": "Sawasdee Rent A Car",
            "owner_company": "Sawasdee Rent A Car",
            "status": "ติดจอง",
            "car_status": "ติดจอง",
            "daily_rate": 1200.0,
            "price_day": 1200.0,
            "mileage": "22,000",
        },
        "3กข-3333": {
            "plate": "3กข-3333",
            "brand": "Toyota",
            "model": "Altis",
            "color": "เทา",
            "company": "Sawasdee Rent A Car",
            "owner_company": "Sawasdee Rent A Car",
            "status": "กำลังเช่า",
            "car_status": "กำลังเช่า",
            "daily_rate": 1500.0,
            "price_day": 1500.0,
            "mileage": "30,000",
        },
        "4กข-4444": {
            "plate": "4กข-4444",
            "brand": "Isuzu",
            "model": "MU-X",
            "color": "บรอนซ์เงิน",
            "company": "Sawasdee Rent A Car",
            "owner_company": "Sawasdee Rent A Car",
            "status": "ซ่อมบำรุง",
            "car_status": "ซ่อมบำรุง",
            "daily_rate": 2000.0,
            "price_day": 2000.0,
            "mileage": "45,000",
        },
    }

    store.customers = {
        "ลูกค้าทั่วไป (Walk-in)": {
            "full_name": "ลูกค้าทั่วไป (Walk-in)",
            "phone_number": "-",
            "contact_no": "-",
            "id_card_no": "-",
            "passport_id": "-",
        },
        "สมชาย ใจดี": {
            "full_name": "สมชาย ใจดี",
            "phone_number": "0812345678",
            "contact_no": "0812345678",
            "id_card_no": "1100100100101",
            "passport_id": "1100100100101",
            "driver_license_no": "DL12345",
            "nationality": "THAI",
        },
    }

    store.bookings = [
        {
            "booking_id": "MRC2611200001",
            "car_id": "2กข-2222",
            "customer": "สมชาย ใจดี",
            "customer_name": "สมชาย ใจดี",
            "start_date": tomorrow,
            "end_date": next_week,
            "start_time": "10:00",
            "end_time": "10:00",
            "contract_type": "รายวัน",
            "base_price": 8400.0,
            "discount": 0.0,
            "net_price": 8400.0,
            "deposit_amount": 5000.0,
            "deposit_paid": True,
            "rental_paid": False,
            "remaining_rental": 3400.0,
            "contract_issued": False,
            "status": "รอส่งมอบ",
            "dispatch_closed": False,
            "return_closed": False,
            "worker_delivery": "staff01",
            "worker_return": "staff01",
            "loc_delivery": "Sukhumvit",
            "loc_return": "Sukhumvit",
            "extension_history": [],
        },
        {
            "booking_id": "MRC2611200002",
            "car_id": "3กข-3333",
            "customer": "ลูกค้าทั่วไป (Walk-in)",
            "customer_name": "ลูกค้าทั่วไป (Walk-in)",
            "start_date": today,
            "end_date": tomorrow,
            "start_time": "09:00",
            "end_time": "09:00",
            "contract_type": "รายวัน",
            "base_price": 1500.0,
            "discount": 0.0,
            "net_price": 1500.0,
            "deposit_amount": 5000.0,
            "deposit_paid": True,
            "rental_paid": True,
            "remaining_rental": 0.0,
            "contract_issued": True,
            "status": "กำลังเช่า",
            "dispatch_closed": True,
            "return_closed": False,
            "worker_delivery": "staff01",
            "worker_return": "staff01",
            "loc_delivery": "Airport",
            "loc_return": "Airport",
            "extension_history": [],
        },
    ]
    store.completed_jobs = []
    store.financial_records = []
    store.insurance_records = []
    store.vehicle_maintenances = []
    store.maintenance_logs = []
    store.work_order_logs = [
        {
            "id": "WO_TEST_0",
            "car_id": "4กข-4444",
            "booking_id": "MNT2611200001",
            "work_type": "Maintenance",
            "description": "เช็คระยะ 45,000 กม.",
            "cost": 2500.0,
            "staff_id": "staff01",
            "job_status": "Pending",
        }
    ]
    store.maintenance_records = [
        {
            "id": "MNT2611200001",
            "car_id": "4กข-4444",
            "car_brand": "Isuzu",
            "car_model": "MU-X",
            "order_type": "ซ่อมบำรุงทั่วไป / เช็คระยะ",
            "service_items": "เปลี่ยนน้ำมันเครื่อง",
            "cost": 2500.0,
            "actual_cost": 0.0,
            "status": "กำลังซ่อมบำรุง",
            "assigned_worker": "staff01",
            "schedule_date": today.isoformat(),
        }
    ]
    store.users = {
        "admin": {
            "username": "admin",
            "name": "Administrator",
            "password": db.hash_password("admin123"),
            "role": "Admin",
            "status": "approved",
            "is_approved": True,
            "line_user_id": "UADMIN001",
        },
        "staff01": {
            "username": "staff01",
            "name": "พนักงาน 01",
            "password": db.hash_password("staff123"),
            "role": "Staff",
            "status": "approved",
            "is_approved": True,
            "line_user_id": "USTAFF001",
        },
    }

    try:
        yield store
    finally:
        for k, v in snapshot.items():
            setattr(store, k, v)


@pytest.fixture()
def client():
    """FastAPI TestClient wrapping server.app without triggering external startup threads."""
    return TestClient(server.app)
