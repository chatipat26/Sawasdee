# 📋 รายงานผลการ Audit ระบบและแผนการ Refactor: โครงการ Sawasdee Car (FastAPI + PostgreSQL)

**วันที่ตรวจสอบ:** 19 พฤศจิกายน 2026  
**ทีมผู้ตรวจทาน:** [System Architect] & [QA / Security Reviewer]  
**สถานะ:** รอการตรวจสอบและอนุมัติจากผู้ดูแลระบบก่อนเริ่มขั้นตอนพัฒนา (Backend Developer)

---

## 1. บทสรุปภาพรวมจาก [System Architect]

จากการสแกนและตรวจสอบ Source Code ทั้งหมดใน Repository ปัจจุบัน โครงสร้างระบบเดิมเป็นการเปลี่ยนผ่านจากระบบ In-Memory / File-based (JSON) และ Streamlit มาเป็น FastAPI แต่ยังมี **"หนี้ทางสถาปัตยกรรม (Architectural Debt)"** ตกค้างอยู่เป็นจำนวนมาก ทำให้ระบบยังไม่ได้ทำงานเป็น **FastAPI + PostgreSQL เพียวๆ (Stateless REST API)** ตามวัตถุประสงค์

### 1.1 สรุป Architecture ปัจจุบัน
1. **Entry Points กระจัดกระจาย:**
   - มีไฟล์สตาร์ตเซิร์ฟเวอร์ซ้ำซ้อนถึง 4 ไฟล์ ได้แก่ `main.py`, `server.py`, `app.py`, และ `start_web.py`
   - ใน `Procfile` และ `render.yaml` ชี้ไปที่ `uvicorn server:app` ในขณะที่ `main.py` ทำการ import `server.app` แล้วเอา `app.add_api_route` ซ้ำซ้อนลงไปอีกชั้น
2. **Monolithic Server (`server.py` มีความยาวถึง 4,822 บรรทัด):**
   - รวบรวมทุกฟังก์ชันไว้ในไฟล์เดียว ทั้ง Route Endpoints (เกือบ 100 endpoints), Business Logic, การเชื่อมต่อฐานข้อมูล, การสร้างไฟล์ PDF (ReportLab), การจัดการภาพ และระบบแจ้งเตือน LINE
   - ขาดการแบ่งแยกโมดูลด้วย `APIRouter` (มีเพียง `routers/cars.py` ซึ่งถูกเขียนแยกไว้แต่ก็มี Endpoint ชนกับ `server.py`)
3. **ปัญหา Dual-State (In-Memory + Daemon Sync vs PostgreSQL):**
   - ข้อมูลหลักไม่ได้ถูก Query จาก PostgreSQL โดยตรงในทุก Request แต่ระบบพึ่งพา `store` (`DataStore` ใน `db.py`) ซึ่งเก็บข้อมูลใน RAM (Python `dict`/`list`) ร่วมกับการบันทึกเป็น Local JSON (`data_cars.json`, `data_users.json` ฯลฯ)
   - เมื่อมีการบันทึก/แก้ไขข้อมูล ระบบจะอัปเดตใน RAM แล้วสั่ง Spawn Daemon Thread (`threading.Thread`) แยกออกไปเพื่อพยายาม Sync ลง PostgreSQL ในพื้นหลัง
   - หากเซิร์ฟเวอร์ Restart, Crash หรือรัน Uvicorn แบบ Multi-workers ข้อมูลในแต่ละ Worker จะไม่ตรงกัน (Data Drift / Inconsistency) และเสี่ยงต่อการสูญหายของข้อมูล (Data Loss) ทันทีหาก Thread เกิดข้อผิดพลาด
4. **ความซ้ำซ้อนของ Database Layer:**
   - มี 3 ระบบเชื่อมต่อฐานข้อมูลทำงานขนานกัน:
     1. `database.py`: ใช้ SQLAlchemy (`create_engine`, `SessionLocal`, `models.py`) แต่ถูกเรียกใช้เพียง `init_db()` และฟังก์ชันลบ `execute_hard_delete_work_order_db`
     2. `pg_client.py`: คลาส Custom PostgreSQL Query Builder ที่เลียนแบบไวยากรณ์ PostgREST/Supabase (`sb.table("...").select(...)`) โดยใช้ `psycopg` ตรง
     3. `db.py`: In-memory `store` ที่หุ้ม `pg_client.py` ไว้อีกชั้นหนึ่ง
5. **Config และ Environment Variables:**
   - พบการ Hardcode Database Connection String ที่มีรหัสผ่านจริงไว้ในโค้ด (`db.py` และ `database.py`) แทนที่จะบังคับอ่านจาก `.env` 100%
   - พบการ Hardcode LINE Access Token และ User ID ใน `line_service.py`, `check_expiry_alert.py`, และ `test_line_api.py`

---

## 2. บทสรุปผลการตรวจสอบความปลอดภัยและจุดเสี่ยงจาก [QA / Security Reviewer]

### 2.1 จุดเสี่ยงเรื่อง Connection Pool & Database Session
- **ไม่มี Connection Pool ใน `pg_client.py`:** ตัว `PgClient` ใช้การเชื่อมต่อแบบ Single Connection (`self._conn`) และล็อกด้วย `threading.RLock()` ข้ามทุก Thread
  - *ผลกระทบ:* เมื่อมีผู้ใช้งานเข้าใช้งานพร้อมกัน ทุก Request จะเกิดคอขวด (Bottleneck) รอคิวกันใน Lock เดียว และหากการเชื่อมต่อหลุด (Connection Dropped) การ Reconnect จะเกิด race condition ได้ง่าย
- **Async/Sync Conflict (Event Loop Blocking):**
  - ฟังก์ชัน Route ใน `server.py` ถูกประกาศเป็น `async def` เช่น `async def list_cars(...)`, `async def create_booking(...)`
  - ภายในฟังก์ชัน `async def` เหล่านี้ กลับเรียกฟังก์ชันแบบ **Synchronous I/O** โดยตรง เช่น `store.sync_from_database(force=True)`, การอ่าน/เขียนไฟล์ JSON ลง Disk, การรัน ReportLab สร้าง PDF และการเรียก `requests.post()` ของ LINE
  - *ผลกระทบ:* ใน Node.js / Python Asyncio การบล็อกเธรดใน `async def` จะหยุดการทำงานของ **Main Event Loop** ส่งผลให้ Request ของผู้ใช้งานคนอื่นทั้งหมดในระบบ "ค้าง (Freeze)" ทันที

### 2.2 จุดเสี่ยงด้าน Authentication & Security (ระดับวิกฤต)
- **Hardcoded Plaintext Passwords & Backdoor ในโค้ด:**
  - ในฟังก์ชัน `login()` ของ `server.py` มีการใส่รหัสผ่านแบบฮาร์ดโค้ดเพื่อ Bypass การล็อกอิน เช่น:
    - แอดมิน: ยอมรับรหัสผ่าน `["admin", "admin123", "sawasdee2024", "sawasdee", "A248624"]` ทันทีโดยไม่ต้องตรวจใน DB
    - บัญชี Chatipat และ chaiwat.u มีการระบุรหัสผ่าน Hardcoded ไว้ในโค้ด
- **รหัสผ่านผู้ใช้งานไม่มีการ Hashing:**
  - รหัสผ่านในตาราง `users` ถูกเปรียบเทียบแบบ Plaintext (`stored_pw == pw` หรือ `stored_pw.lower() == pw.lower()`) ไม่ได้ใช้ Algorithm มาตรฐานอย่าง `bcrypt` หรือ `argon2`
- **ไม่มีระบบ Authentication / Authorization Guard ใน API:**
  - Endpoints หลักทั้งหมด (`/api/cars`, `/api/bookings`, `/api/customers`, `/api/maintenance` ฯลฯ) **ไม่มี Dependency ตรวจสอบ Token (No JWT / Session / Depends(get_current_user))** บุคคลภายนอกสามารถยิง Request เข้ามา ดึงข้อมูล หรือลบข้อมูลรถ/ลูกค้า/สัญญาเช่าได้โดยตรง

### 2.3 การจัดการ Exception & Error Handling
- **คืนค่า HTTP 200 ทั้งที่เกิด Error:** ในหลาย Route ใช้ `except Exception as e: return {"success": False, "error": str(e)}` ทำให้ Status Code ส่งกลับเป็น `200 OK` แทนที่จะเป็น `400 Bad Request`, `404 Not Found`, หรือ `500 Internal Server Error` ทำให้ Frontend และ Client แยกแยะ Error ได้ยาก
- **Silent Exception Swallowing:** พบ `except Exception: pass` มากกว่า 30 จุดใน `pg_client.py` และ `database.py` ทำให้เวลาระบบฐานข้อมูลมีปัญหา ระบบจะปิดบัง Error ไว้เงียบๆ ทำให้ติดตามหาสาเหตุยากมาก
- **Fire-and-forget Background Sync:** การบันทึกข้อมูลจะ Return Response กลับไปให้ User ทันทีว่าสำเร็จ แต่ Background Thread ที่ส่งไป Postgres อาจพังโดยที่ User ไม่ทราบ

### 2.4 Data Validation (Pydantic)
- ใน `schemas.py` มีการเขียน Pydantic Model ไว้เป็นอย่างดี (`VehicleBase`, `VehicleCreate`, `CustomerBase`, `BookingBase`) แต่ใน `server.py` ส่วนใหญ่กลับรับค่าเป็น `payload: Dict[str, Any]`
- ทำให้ขาดการตรวจสอบ Type, ขาด Required Field Enforcement และไม่มีการ Sanitize ข้อมูลนำเข้า

---

## 3. แผนการจัดระเบียบและ Refactor (Prioritized Action Plan)

### 🔴 ระดับที่ 1: [Critical] ปัญหาและบั๊กวิกฤตที่ต้องจัดการทันที
1. **ปิดช่องโหว่ความปลอดภัย Authentication & Hardcoded Secrets:**
   - ล้าง Hardcoded Passwords และ Backdoor ออกจาก `server.py`
   - ปรับระบบรหัสผ่านให้ใช้ Password Hashing (`passlib[bcrypt]` หรือ `hashlib/bcrypt`)
   - ย้าย Credentials ที่ Hardcode ทั้งหมด (`DATABASE_URL`, `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_TARGET_USER_ID`) ออกจากซอร์สโค้ด ให้ดึงผ่าน Environment Variables (`.env`) 100%
2. **แก้ไข Async/Sync Event Loop Blocking:**
   - จุดที่มีการเรียก Synchronous Database/Disk I/O ภายใน `async def` ต้องปรับเปลี่ยนให้ไม่บล็อก Event Loop (เช่น ใช้ `anyio.to_thread.run_sync` หรือปรับเป็น Sync def สำหรับ CPU/Blocking Task เพื่อให้ FastAPI รันใน Threadpool ตาม Best Practice)
3. **แก้ไขสถาปัตยกรรม Database Connection (Single Connection Bottleneck):**
   - แก้ไข `pg_client.py` ให้รองรับ Connection Pooling (`psycopg_pool.ConnectionPool`) เพื่อป้องกันปัญหา Deadlock/Bottleneck ภายใต้ Concurrent Requests
4. **แก้ไขการจัดการ Exception & HTTP Status Codes:**
   - เลิกลักษณะการ Return `{"success": False, "error": ...}` พร้อม Status Code 200
   - ปรับให้ Raise `HTTPException(status_code=..., detail=...)` เพื่อให้สอดคล้องกับมาตรฐาน REST API

---

### 🟡 ระดับที่ 2: [Logic & Structure] การจัดระเบียบโครงสร้างสถาปัตยกรรม (Architecture & Clean Code)
1. **จัดระเบียบ Entry Point ให้ชัดเจน:**
   - กำหนดให้ `main.py` เป็น Root Entry Point หลักเพียงไฟล์เดียวสำหรับ FastAPI Application
   - เคลียร์ไฟล์สตาร์ตซ้ำซ้อน (`app.py`, `start_web.py`, และการรันเดี่ยวๆ ใน `server.py`) พร้อมอัปเดต `Procfile` และ `render.yaml` ให้ชี้ไปที่ `main:app`
2. **Modularize แตกไฟล์ `server.py` ออกเป็น Router ย่อยตามโดเมน:**
   - แตก Endpoint 4,800+ บรรทัดออกเป็น Router ย่อยภายใต้โฟลเดอร์ `routers/`:
     - `routers/auth.py`: ระบบ Login, Register, User Management
     - `routers/cars.py`: ระบบจัดการรถยนต์, สเปกรถ, อัปโหลดรูปรถ 4 มุม
     - `routers/bookings.py`: การจองรถ, สัญญาเช่า, การส่งมอบ-รับคืน (Dispatch/Return)
     - `routers/customers.py`: ข้อมูลลูกค้าและการค้นหา
     - `routers/maintenance.py`: งานซ่อมบำรุง, ประกัน, พ.ร.บ., ภาษี, Work Orders
     - `routers/finance.py`: รายรับ-รายจ่าย, การเงิน
     - `routers/reports.py`: Dashboard, KPIs, ส่งออก CSV
     - `routers/pdf.py`: การดาวน์โหลดและแสดงผลเอกสาร PDF
     - `routers/line.py`: Webhook และการแจ้งเตือนผ่าน LINE
3. **รวม Service ที่ซ้ำซ้อน:**
   - รวมไฟล์ `gdrive_service.py`, `google_drive_service.py` และ `services/google_drive_service.py` ให้เหลือเพียง `services/google_drive_service.py` จุดเดียว
   - เคลียร์สคริปต์ซ้ำซ้อนที่ Root (`import_cars.py`, `import_cars_excel.py`) ให้คงไว้เฉพาะใน `scripts/`
4. **นำ Pydantic Schema ใน `schemas.py` มาใช้ใน Request Body จริง:**
   - เปลี่ยนจาก `payload: Dict[str, Any]` มาเป็น `payload: VehicleCreate`, `payload: BookingCreate` ฯลฯ เพื่อให้ FastAPI สร้าง Swagger Docs อัตโนมัติ และ Validate Data ก่อนเข้า Logic
5. **เปลี่ยน Lifecycle Event เป็น FastAPI Lifespan Handler:**
   - เปลี่ยนจาก `@app.on_event("startup")` (Deprecated) มาใช้ `@asynccontextmanager async def lifespan(app: FastAPI)` ตามมาตรฐาน FastAPI ยุคใหม่

---

### 🟢 ระดับที่ 3: [Minor] จุดปรับปรุงเล็กน้อยเพื่อความสมบูรณ์
1. **ทำความสะอาด Logs และ Print Statements:**
   - เปลี่ยนจากการใช้ `print()` กระจัดกระจาย มาใช้โมดูล `logging` มาตรฐาน เพื่อควบคุม Log Level (DEBUG, INFO, ERROR) บน Production
2. **จัดระเบียบ Static Files & Template Paths:**
   - ตั้งค่า Path การดึง Static & Templates ให้ผ่านการ Resolve จาก `Path(__file__).resolve().parent` อย่างรัดกุม รองรับทั้ง Windows และ Linux บนคลาวด์
3. **ตรวจสอบ Query Indexes ใน PostgreSQL:**
   - ตรวจสอบให้มั่นใจว่า Columns ที่ใช้เป็น Foreign Key หรือ Search บ่อยๆ เช่น `car_id`, `booking_id`, `plate`, `status`, `start_date`, `end_date` มีการสร้าง Index รองรับ

---

## 4. แผนงานขั้นตอนถัดไป (สำหรับ Backend Developer)

เมื่อได้รับการอนุมัติจากผู้ใช้ ทีมพัฒนา (Backend Developer) จะดำเนินการตามลำดับดังนี้:
1. **Phase 1 (Security & Config Hardening):** ทำความสะอาด Hardcoded Secrets, ปรับปรุงระบบ Hash รหัสผ่าน และนำ Connection Pool เข้ามาใช้งาน
2. **Phase 2 (Decoupling & Modularization):** แยก Router ออกเป็นโมดูลย่อยใน `routers/` และทำความสะอาด Entry Points
3. **Phase 3 (Validation & Exception Standardization):** นำ Pydantic Models มาครอบ Request Payloads และปรับปรุง Error Handling
4. **Phase 4 (Testing & Verification):** รันทดสอบ Syntax, Import Check, Unit Tests และ Start Test Server ใน Terminal เพื่อยืนยันว่าระบบทำงานได้อย่างเสถียรและไม่มี Endpoint ใดพัง
