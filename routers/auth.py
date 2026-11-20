"""
Authentication & Users API Router for SawasdeeRental.
"""

from datetime import datetime
from typing import Dict, Any
from fastapi import APIRouter, HTTPException

from db import store, get_db_client, hash_password, verify_password
from line_service import resolve_worker_line_id, send_line_push_message

router = APIRouter(tags=["auth"])


@router.post("/api/auth/login")
def login(payload: Dict[str, Any]):
    un = str(payload.get("username", "")).strip()
    pw = str(payload.get("password", "")).strip()

    if not un or not pw:
        raise HTTPException(status_code=400, detail="กรุณากรอกชื่อผู้ใช้งานและรหัสผ่าน")

    user_rec = None
    needs_migration = False
    db_checked_user = False

    sb = get_db_client()

    # 1. Query PostgreSQL users table directly first (authoritative source)
    if sb:
        try:
            res = sb.table("users").select("*").ilike("username", un).execute()
            if res.data:
                db_checked_user = True
                for row in res.data:
                    stored_pw = str(row.get("password", "")).strip()
                    matched, needs_mig = verify_password(pw, stored_pw)
                    if matched:
                        user_rec = dict(row)
                        needs_migration = needs_mig
                        break
        except Exception as e:
            print(f"Login DB lookup note: {e}")

    # 2. Fallback to local store only if user was not matched/found in PostgreSQL lookup
    if not user_rec and not db_checked_user:
        for k, v in store.users.items():
            if k.lower() == un.lower() or (v.get("email") and str(v.get("email")).lower() == un.lower()):
                stored_pw = str(v.get("password", "")).strip()
                matched, needs_mig = verify_password(pw, stored_pw)
                if matched:
                    user_rec = dict(v)
                    needs_migration = needs_mig
                    break

    if not user_rec:
        raise HTTPException(status_code=401, detail="ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง")

    user_status = str(user_rec.get("status", "")).strip().lower()
    is_approved = user_rec.get("is_approved")
    if user_status in ["suspended", "ระงับ", "inactive", "rejected"]:
        raise HTTPException(
            status_code=403,
            detail="บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ"
        )
    if user_status in ["pending", "รออนุมัติ", "รอดำเนินการ"] or is_approved is False:
        raise HTTPException(
            status_code=403,
            detail="บัญชีของคุณกำลังรอการอนุมัติจากแอดมิน"
        )

    canon_un = user_rec.get("username", un)
    if needs_migration:
        hashed_pw = hash_password(pw)
        user_rec["password"] = hashed_pw
        if sb:
            try:
                sb.table("users").update({"password": hashed_pw}).eq("username", canon_un).execute()
            except Exception as e:
                print(f"Password migration DB update note: {e}")
        store.async_sync_user(canon_un, user_rec)
    elif canon_un not in store.users:
        store.async_sync_user(canon_un, user_rec)
    else:
        with store.lock:
            store.users[canon_un].update(user_rec)

    return {
        "success": True,
        "is_pending": False,
        "user": {
            "username": canon_un,
            "name": user_rec.get("name") or canon_un,
            "role": user_rec.get("role", "Staff"),
            "status": user_rec.get("status", "approved"),
            "line_user_id": user_rec.get("line_user_id", "")
        }
    }


@router.post("/api/auth/register")
def register(payload: Dict[str, Any]):
    un = str(payload.get("username", "")).strip().lower()
    fn = str(payload.get("name", "")).strip()
    pw = str(payload.get("password", "")).strip()
    line_id = str(payload.get("line_user_id") or payload.get("line_id") or "").strip()
    if not un or not pw:
        raise HTTPException(status_code=400, detail="กรุณากรอกชื่อผู้ใช้งานและรหัสผ่าน")
    if not line_id:
        raise HTTPException(status_code=400, detail="กรุณากรอกไอดีไลน์ (LINE ID / LINE User ID) เพื่อใช้รับแจ้งเตือนใบงาน")
    if any(k.lower() == un for k in store.users):
        raise HTTPException(status_code=400, detail="ชื่อผู้ใช้นี้มีในระบบแล้ว")

    sb = get_db_client()
    if sb:
        try:
            existing = sb.table("users").select("username").ilike("username", un).execute()
            if existing.data:
                raise HTTPException(status_code=400, detail="ชื่อผู้ใช้นี้มีในระบบแล้ว")
        except HTTPException:
            raise
        except Exception as e:
            print(f"Register DB check note: {e}")

    new_u = {
        "username": un,
        "name": fn or un,
        "password": hash_password(pw),
        "role": "Staff",
        "status": "pending",
        "line_user_id": line_id,
        "created_at": datetime.utcnow().isoformat()
    }
    store.async_sync_user(un, new_u)
    return {"success": True, "message": "ลงทะเบียนสำเร็จ กรุณารอผู้ดูแลระบบ (Admin) อนุมัติการใช้งาน"}


@router.post("/api/auth/change-password")
def change_password(payload: Dict[str, Any]):
    un = str(payload.get("username", "")).strip()
    old_pw = str(payload.get("old_password", "")).strip()
    new_pw = str(payload.get("new_password", "")).strip()
    if not un or not old_pw or not new_pw:
        raise HTTPException(status_code=400, detail="กรุณากรอกข้อมูลให้ครบถ้วน")

    user_key = next((k for k in store.users if k.lower() == un.lower()), None)
    user = dict(store.users[user_key]) if user_key else None

    sb = get_db_client()
    if sb:
        try:
            res = sb.table("users").select("*").ilike("username", un).execute()
            if res.data:
                user = dict(res.data[0])
                user_key = user.get("username", un)
        except Exception as e:
            print(f"Change password DB lookup note: {e}")

    if not user:
        raise HTTPException(status_code=400, detail="รหัสผ่านเดิมไม่ถูกต้อง")

    matched, _ = verify_password(old_pw, str(user.get("password", "")).strip())
    if not matched:
        raise HTTPException(status_code=400, detail="รหัสผ่านเดิมไม่ถูกต้อง")

    hashed_new_pw = hash_password(new_pw)
    user["password"] = hashed_new_pw
    canon_un = user_key or un
    if sb:
        try:
            sb.table("users").update({"password": hashed_new_pw}).eq("username", canon_un).execute()
        except Exception as e:
            print(f"Change password DB update note: {e}")
    store.async_sync_user(canon_un, user)
    return {"success": True, "message": "เปลี่ยนรหัสผ่านเรียบร้อย"}


@router.get("/api/users")
def list_users():
    if not store.initial_sync_done or len(store.users) <= 1:
        store.sync_from_database(force=True)
    users_list = []
    for u in store.users.values():
        u_safe = dict(u)
        u_safe.pop("password", None)
        if not u_safe.get("status"):
            u_safe["status"] = "approved"
        users_list.append(u_safe)
    return users_list


@router.post("/api/users/{username}/approve")
def approve_user(username: str):
    if username not in store.users:
        raise HTTPException(status_code=404, detail="ไม่พบผู้ใช้นี้")
    store.users[username]["status"] = "approved"
    store.users[username]["is_approved"] = True
    store.async_sync_user(username, store.users[username])
    return {"success": True}


@router.post("/api/users/{username}/reject")
def reject_user(username: str):
    if username not in store.users:
        raise HTTPException(status_code=404, detail="ไม่พบผู้ใช้นี้")
    store.users[username]["status"] = "suspended"
    store.users[username]["is_approved"] = False
    store.async_sync_user(username, store.users[username])
    return {"success": True}


@router.delete("/api/users/{username}")
def delete_user(username: str):
    if username.lower() == "admin":
        raise HTTPException(status_code=400, detail="ไม่สามารถลบบัญชีผู้ดูแลระบบหลัก (admin) ได้")
    store.async_delete_user(username)
    return {"success": True}


@router.put("/api/users/{username}/line-id")
@router.post("/api/users/{username}/line-id")
def update_user_line_id(username: str, payload: Dict[str, Any]):
    if username not in store.users:
        raise HTTPException(status_code=404, detail="ไม่พบผู้ใช้นี้ในระบบ")
    line_uid = str(payload.get("line_user_id") or "").strip()
    store.users[username]["line_user_id"] = line_uid
    if "role" in payload and payload["role"] in ("Admin", "Staff"):
        store.users[username]["role"] = payload["role"]
    if "name" in payload and str(payload["name"]).strip():
        store.users[username]["name"] = str(payload["name"]).strip()
    store.async_sync_user(username, store.users[username])
    return {"success": True, "username": username, "line_user_id": line_uid}


@router.post("/api/users/{username}/test-line")
def test_user_line_push(username: str):
    if username not in store.users:
        raise HTTPException(status_code=404, detail="ไม่พบผู้ใช้นี้ในระบบ")
    u = store.users[username]
    line_uid = resolve_worker_line_id(username)
    if not line_uid:
        raise HTTPException(status_code=400, detail=f"ผู้ใช้ '{username}' ยังไม่ได้ผูก LINE User ID")
    msg = "\n".join([
        "✅ ทดสอบระบบแจ้งเตือนตรง (Direct Push)",
        "────────────────────",
        f"👤 ผู้ใช้งาน: {username} ({u.get('name', username)})",
        f"🏷️ บทบาท: {u.get('role', 'Staff')}",
        "📲 สถานะ: เชื่อมต่อ LINE สำเร็จ พร้อมรับแจ้งเตือนใบงานเฉพาะของคุณโดยตรง"
    ])
    ok = send_line_push_message(msg, to_user_id=line_uid)
    return {"success": ok, "to_user_id": line_uid}
