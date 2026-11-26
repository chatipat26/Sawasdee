"""
Phase 5 Batch 5A verification tests:
- P5-A1: Public Customer Booking & Inspection Portal (/portal/booking/{token}) with HMAC-SHA256 Signed Token
- P5-A2: Interactive LINE Bot Command Center via replyToken (0 Push Quota) with Approved User Gate
- P5-B1: Customer CRM Tiering (VIP / ทั่วไป / Blacklist), Historical Stats, and Watchlist Note
"""

import routers.line as line_router_mod
from dependencies import create_booking_portal_token, verify_booking_portal_token, now_th


def test_p5_a1_customer_portal_token_and_readonly_view(client, isolated_store):
    bk_id = "MRC2611200001"
    tok = create_booking_portal_token(bk_id)
    assert tok
    assert verify_booking_portal_token(tok) == bk_id
    assert verify_booking_portal_token(tok + "tampered") is None
    assert verify_booking_portal_token("invalid-no-dot") is None
    assert verify_booking_portal_token("") is None

    # Bookings list and single booking include portal_url
    bks_resp = client.get("/api/bookings")
    assert bks_resp.status_code == 200
    bk_map = {b["booking_id"]: b for b in bks_resp.json()}
    assert bk_map[bk_id]["portal_url"] == f"/portal/booking/{tok}"

    link_resp = client.get(f"/api/bookings/{bk_id}/portal-link")
    assert link_resp.status_code == 200
    link_data = link_resp.json()
    assert link_data["success"] is True
    assert link_data["token"] == tok
    assert link_data["portal_url"] == f"/portal/booking/{tok}"

    missing_resp = client.get("/api/bookings/MRC_NOT_FOUND/portal-link")
    assert missing_resp.status_code == 404

    # Attach a 4-angle photo to check inspection gallery rendering
    isolated_store.bookings[0]["checkin_img_front"] = "/static/uploads/test_front.jpg"

    # Customer opens public portal WITHOUT Authorization header
    from fastapi.testclient import TestClient
    import server
    anon_client = TestClient(server.app)

    portal_resp = anon_client.get(link_data["portal_url"])
    assert portal_resp.status_code == 200
    html_body = portal_resp.text
    assert bk_id in html_body
    assert "2กข-2222" in html_body
    assert "สมชาย ใจดี" in html_body
    assert f"/api/pdf/contract/{bk_id}" in html_body
    assert f"/api/pdf/deposit-receipt/{bk_id}" in html_body
    assert f"/api/pdf/receipt/{bk_id}" in html_body
    assert f"/api/pdf/inspection/{bk_id}?type=checkout" in html_body
    assert f"/api/pdf/inspection/{bk_id}?type=checkin" in html_body
    assert "/static/uploads/test_front.jpg" in html_body

    # Tampered token must be rejected with 403
    bad_resp = anon_client.get(f"/portal/booking/{tok}X")
    assert bad_resp.status_code == 403


def test_p5_a2_line_bot_commands_reply_and_authorization(client, isolated_store, monkeypatch):
    from datetime import date

    today_th = now_th().date()
    target_dt = date(2026, 11, 27)

    # Seed staff02 with their own jobs to verify strict per-user isolation on "งานวันนี้"
    isolated_store.users["staff02"] = {
        "username": "staff02",
        "name": "พนักงาน 02",
        "role": "Staff",
        "status": "approved",
        "is_approved": True,
        "line_user_id": "USTAFF002",
    }

    # Booking 1 belongs to staff01 today (dispatch); add a booking belonging to staff02 today
    isolated_store.bookings[1]["start_date"] = today_th
    isolated_store.bookings[1]["worker_delivery"] = "staff01"
    isolated_store.bookings.append(
        {
            "booking_id": "MRC2611269999",
            "car_id": "1กข-1111",
            "customer": "ลูกค้า พนักงานสอง",
            "start_date": today_th,
            "end_date": target_dt,
            "start_time": "13:30",
            "end_time": "15:00",
            "status": "รอส่งมอบ",
            "dispatch_closed": False,
            "return_closed": False,
            "worker_delivery": "staff02",
            "worker_return": "พนักงาน 02",  # matched by full name
            "loc_delivery": "สนามบินสุวรรณภูมิ",
            "loc_return": "สาขาสุขุมวิท",
            "delivery_mode": "offsite",
            "delivery_fee": 500.0,
        }
    )
    isolated_store.maintenance_records[0]["schedule_date"] = today_th.isoformat()
    isolated_store.maintenance_records[0]["assigned_worker"] = "staff01"

    # Seed a car with NaN/null artifacts, daily_rate, ACT/Tax/Insurance expiring on target_dt (27/11/2026 = 27/11/2569)
    isolated_store.cars["7ขช 8613"] = {
        "plate": "7ขช 8613",
        "brand": "Honda",
        "model": "HR-V",
        "color": "nan",
        "status": "ว่างพร้อมใช้งาน",
        "car_status": "ว่างพร้อมใช้งาน",
        "daily_rate": 1800.0,
        "price_day": 0.0,
        "mileage": "nan",
        "next_service_mileage": float("nan"),
        "tax_expire_date": "2026-11-27",
        "prb_expire_date": "27/11/2569",  # Buddhist Era input in DB
        "insurance_expire_date": "NaT",
        "insurance_company": "None",
    }
    isolated_store.cars["1กข-1111"]["insurance_expire_date"] = "2026-11-27"
    isolated_store.cars["1กข-1111"]["insurance_company"] = "วิริยะประกันภัย"

    replies = []
    pushes = []
    monkeypatch.setattr(
        line_router_mod,
        "send_line_reply_message",
        lambda token, msg: replies.append((token, msg)) or True,
    )
    monkeypatch.setattr(
        line_router_mod,
        "send_line_push_message",
        lambda *a, **kw: pushes.append((a, kw)) or True,
    )

    def _send_webhook(line_uid: str, text: str, reply_token: str = "RPL_TEST_1"):
        return client.post(
            "/api/line/webhook",
            json={
                "events": [
                    {
                        "type": "message",
                        "replyToken": reply_token,
                        "source": {"userId": line_uid},
                        "message": {"type": "text", "text": text},
                    }
                ]
            },
        )

    # 1. "งานวันนี้" returns ONLY each linked user's own jobs
    assert _send_webhook("USTAFF001", "งานวันนี้", "R_TODAY_S1").status_code == 200
    msg_s1 = replies[-1][1]
    assert "พนักงาน 01" in msg_s1
    assert "3กข-3333" in msg_s1 and "4กข-4444" in msg_s1
    assert "MRC2611269999" not in msg_s1  # staff02's job must NOT appear for staff01

    assert _send_webhook("USTAFF002", "งานวันนี้", "R_TODAY_S2").status_code == 200
    msg_s2 = replies[-1][1]
    assert "พนักงาน 02" in msg_s2
    assert "MRC2611269999" in msg_s2
    assert "3กข-3333" not in msg_s2 and "4กข-4444" not in msg_s2

    # 2. "คิวส่งรถ" preserved as-is
    assert _send_webhook("USTAFF001", "คิวส่งรถ", "R_QUEUE").status_code == 200
    assert "คิวรอส่งมอบรถทั้งหมด" in replies[-1][1]
    assert "MRC2611200001" in replies[-1][1]

    # 3. "รถว่าง" retired: short guidance reply without listing available cars
    assert _send_webhook("USTAFF001", "รถว่าง", "R_AVAIL_OFF").status_code == 200
    msg_avail = replies[-1][1]
    assert "ยกเลิกการแสดงรายการรถว่างทั้งหมด" in msg_avail
    assert "1กข-1111" not in msg_avail and "7ขช 8613" not in msg_avail
    assert "Toyota Yaris" not in msg_avail and "Honda HR-V" not in msg_avail

    # 4. Date command supports CE ("27/11/2026"), Buddhist Era ("27/11/2569"), and ISO ("2026-11-27")
    for idx, dt_text in enumerate(("27/11/2026", "27/11/2569", "2026-11-27")):
        assert _send_webhook("USTAFF001", dt_text, f"R_DATE_{idx}").status_code == 200
        dt_msg = replies[-1][1]
        assert "27/11/2026" in dt_msg
        assert "MRC2611269999" in dt_msg  # return job on 27/11/2026
        assert "7ขช 8613" in dt_msg and "พ.ร.บ." in dt_msg and "ภาษี" in dt_msg
        assert "1กข-1111" in dt_msg and "ประกันภัย (วิริยะประกันภัย)" in dt_msg

    # 5. License plate search: both bare ("7ขช 8613", "7ขช8613") and prefixed ("ทะเบียน 7ขช 8613", "ทะเบียน7ขช 8613")
    for idx, plate_cmd in enumerate(("7ขช 8613", "7ขช8613", "ทะเบียน 7ขช 8613", "ทะเบียน7ขช 8613")):
        assert _send_webhook("USTAFF001", plate_cmd, f"R_PLATE_{idx}").status_code == 200
        p_msg = replies[-1][1]
        assert "7ขช 8613" in p_msg
        assert "Honda HR-V (สี: -)" in p_msg
        assert "฿1,800/วัน" in p_msg
        assert "พ.ร.บ.หมดอายุ: 27/11/2026" in p_msg
        assert "ภาษีหมดอายุ: 27/11/2026" in p_msg
        assert "ประกันหมดอายุ: -" in p_msg
        assert "nan" not in p_msg.lower()
        assert "nat" not in p_msg.lower()
        assert "none" not in p_msg.lower()

    assert _send_webhook("USTAFF001", "2กข2222", "R_PLATE_ACTIVE").status_code == 200
    assert "MRC2611200001" in replies[-1][1] and "฿1,200/วัน" in replies[-1][1]

    # 6. Unlinked user binding by username still works without colliding with bare plate matching
    isolated_store.users["newstaff_bind"] = {
        "username": "newstaff_bind",
        "name": "พนักงานใหม่ ผูกบัญชี",
        "role": "Staff",
        "status": "approved",
        "is_approved": True,
        "line_user_id": "",
    }
    assert _send_webhook("U_NEW_BIND_01", "newstaff_bind", "R_BIND").status_code == 200
    assert "ผูกบัญชีสำเร็จ" in replies[-1][1]
    assert isolated_store.users["newstaff_bind"]["line_user_id"] == "U_NEW_BIND_01"

    # 7. Unlinked / Pending / Suspended users must be denied on all commands (including bare plate & date)
    for bad_cmd in ("รถว่าง", "7ขช 8613", "27/11/2569"):
        assert _send_webhook("U_STRANGER_999", bad_cmd, "R_DENY1").status_code == 200
        assert "⛔" in replies[-1][1]
        assert "Honda HR-V" not in replies[-1][1]

    isolated_store.users["pending_u"] = {
        "username": "pending_u",
        "name": "Pending User",
        "role": "Staff",
        "status": "pending",
        "is_approved": False,
        "line_user_id": "U_PENDING_01",
    }
    assert _send_webhook("U_PENDING_01", "คิวส่งรถ", "R_DENY2").status_code == 200
    assert "⛔" in replies[-1][1]
    assert "MRC2611200001" not in replies[-1][1]

    isolated_store.users["susp_u"] = {
        "username": "susp_u",
        "name": "Suspended User",
        "role": "Staff",
        "status": "suspended",
        "is_approved": False,
        "line_user_id": "U_SUSP_01",
    }
    assert _send_webhook("U_SUSP_01", "งานวันนี้", "R_DENY3").status_code == 200
    assert "⛔" in replies[-1][1]
    assert len(pushes) == 0  # Strictly 0 push quota used


def test_p5_b1_crm_tiering_rental_history_and_blacklist_alert(client, isolated_store):
    # Create a Blacklist customer via API
    res_bl = client.post(
        "/api/customers",
        json={
            "full_name": "นายเฝ้าระวัง ทดสอบ",
            "phone_number": "0899998888",
            "id_card_no": "1199988877766",
            "crm_tier": "Blacklist",
            "watchlist_note": "ค้างชำระค่าเช่าและไม่คืนรถตรงเวลา",
        },
    )
    assert res_bl.status_code == 200
    bl_data = res_bl.json()["customer"]
    assert bl_data["crm_tier"] == "Blacklist"
    assert bl_data["watchlist_note"] == "ค้างชำระค่าเช่าและไม่คืนรถตรงเวลา"

    # Create a VIP customer with case-insensitive tier input
    res_vip = client.post(
        "/api/customers",
        json={
            "full_name": "คุณวีไอพี ประจำ",
            "phone_number": "0877776666",
            "id_card_no": "1177766655544",
            "crm_tier": "vip",
            "watchlist_note": "ลูกค้าประจำจ่ายตรงเวลา",
        },
    )
    assert res_vip.status_code == 200
    assert res_vip.json()["customer"]["crm_tier"] == "VIP"

    # Add historical bookings/completed jobs (1 completed with damage, 1 cancelled ignored)
    isolated_store.completed_jobs.append(
        {
            "booking_id": "MRC_PAST_01",
            "customer": "นายเฝ้าระวัง ทดสอบ",
            "net_price": 4500.0,
            "repair_cost": 1800.0,
            "status": "เสร็จสิ้น",
        }
    )
    isolated_store.bookings.append(
        {
            "booking_id": "MRC_CANCEL_01",
            "customer": "นายเฝ้าระวัง ทดสอบ",
            "net_price": 9999.0,
            "status": "ยกเลิก",
        }
    )

    custs_resp = client.get("/api/customers")
    assert custs_resp.status_code == 200
    by_name = {c["full_name"]: c for c in custs_resp.json()}

    bl = by_name["นายเฝ้าระวัง ทดสอบ"]
    assert bl["crm_tier"] == "Blacklist"
    assert bl["total_rentals"] == 1
    assert bl["total_spent"] == 4500.0
    assert bl["damage_count"] == 1

    somchai = by_name["สมชาย ใจดี"]
    assert somchai["crm_tier"] == "ทั่วไป"
    assert somchai["total_rentals"] == 1
    assert somchai["total_spent"] == 8400.0
    assert somchai["damage_count"] == 0
