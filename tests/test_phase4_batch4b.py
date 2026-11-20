"""
Phase 4 Batch 4B verification tests:
- HI-2: Smart Fleet Maintenance Alert (service_alert_status: overdue / due_soon / ok / none)
- HI-4: Shift Closing UTF-8 BOM CSV Export & Printable Daily Shift Closing Slip
- TS-2: Modern FastAPI lifespan & timezone-aware UTC (verified by 0 warnings in pytest)
"""


def test_hi2_smart_fleet_maintenance_mileage_alerts(client, isolated_store):
    isolated_store.cars["1กข-1111"]["mileage"] = "14,750"
    isolated_store.cars["1กข-1111"]["next_service_mileage"] = 15000.0

    isolated_store.cars["2กข-2222"]["mileage"] = "25,100"
    isolated_store.cars["2กข-2222"]["next_service_mileage"] = 25000.0

    isolated_store.cars["3กข-3333"]["mileage"] = "30,000"
    isolated_store.cars["3กข-3333"]["next_service_mileage"] = 40000.0

    isolated_store.cars["4กข-4444"].pop("next_service_mileage", None)
    isolated_store.cars["4กข-4444"].pop("next_engine_oil_mileage", None)

    resp = client.get("/api/cars")
    assert resp.status_code == 200
    cars_by_plate = {c["plate"]: c for c in resp.json()}

    yaris = cars_by_plate["1กข-1111"]
    assert yaris["service_alert_status"] == "due_soon"
    assert yaris["service_km_remaining"] == 250
    assert "250" in yaris["service_alert_label"]

    city = cars_by_plate["2กข-2222"]
    assert city["service_alert_status"] == "overdue"
    assert city["service_km_remaining"] == -100
    assert "100" in city["service_alert_label"]

    altis = cars_by_plate["3กข-3333"]
    assert altis["service_alert_status"] == "ok"
    assert altis["service_km_remaining"] == 10000

    mux = cars_by_plate["4กข-4444"]
    assert mux["service_alert_status"] == "none"
    assert mux["service_km_remaining"] is None


def test_hi4_shift_closing_export_csv_and_printable_slip(client):
    csv_resp = client.get("/api/finance/export-csv")
    assert csv_resp.status_code == 200
    assert "text/csv" in csv_resp.headers["content-type"]
    assert csv_resp.content.startswith(b"\xef\xbb\xbf")  # UTF-8 BOM for Excel Thai support
    csv_text = csv_resp.content.decode("utf-8-sig")
    assert "ช่องทางชำระเงิน" in csv_text
    assert "จำนวนเงิน (THB)" in csv_text
    assert "2กข-2222" in csv_text or "3กข-3333" in csv_text

    slip_resp = client.get("/api/finance/print-slip")
    assert slip_resp.status_code == 200
    assert "text/html" in slip_resp.headers["content-type"]
    slip_html = slip_resp.text
    assert "ใบสรุปส่งกะประจำวัน" in slip_html
    assert "พนักงานส่งกะ / ผู้ส่งมอบเงิน" in slip_html
    assert "ผู้รับมอบเงิน / ฝ่ายบัญชี" in slip_html
    assert "เงินสด" in slip_html
    assert "โอนเงิน / สแกน QR" in slip_html
