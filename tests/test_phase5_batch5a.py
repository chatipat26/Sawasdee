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
    today_th = now_th().date()
    isolated_store.bookings[1]["start_date"] = today_th
    isolated_store.maintenance_records[0]["schedule_date"] = today_th.isoformat()

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

    # 1. Approved linked user ("staff01" -> "USTAFF001") sends all 4 commands
    assert _send_webhook("USTAFF001", "งานวันนี้", "R1").status_code == 200
    assert _send_webhook("USTAFF001", "คิวส่งรถ", "R2").status_code == 200
    assert _send_webhook("USTAFF001", "รถว่าง", "R3").status_code == 200
    assert _send_webhook("USTAFF001", "ทะเบียน 1กข1111", "R4").status_code == 200
    assert _send_webhook("USTAFF001", "ทะเบียน 2กข-2222", "R5").status_code == 200

    assert len(pushes) == 0  # Strictly 0 push quota used
    assert len(replies) == 5

    assert replies[0][0] == "R1" and "งานวันนี้" in replies[0][1]
    assert "3กข-3333" in replies[0][1] or "4กข-4444" in replies[0][1]

    assert replies[1][0] == "R2" and "คิวรอส่งมอบรถ" in replies[1][1]
    assert "MRC2611200001" in replies[1][1] and "2กข-2222" in replies[1][1]

    assert replies[2][0] == "R3" and "รถว่างพร้อมใช้งาน" in replies[2][1]
    assert "1กข-1111" in replies[2][1]

    assert replies[3][0] == "R4" and "1กข-1111" in replies[3][1] and "Toyota Yaris" in replies[3][1]
    assert replies[4][0] == "R5" and "MRC2611200001" in replies[4][1]

    # 2. Unlinked user must be denied and not leak data
    assert _send_webhook("U_STRANGER_999", "รถว่าง", "R_DENY1").status_code == 200
    assert "⛔" in replies[-1][1]
    assert "1กข-1111" not in replies[-1][1]

    # 3. Pending user must be denied even if line_user_id is set
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

    # 4. Suspended user must be denied
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
    assert len(pushes) == 0


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
