# Project Context & AI Agent Rules — SawasdeeRental (GEMINI.md)

## 1. การสื่อสารและการอธิบาย (Communication)
- **ภาษาที่ใช้:** ตอบคำถาม อธิบายขั้นตอน และสรุปการแก้ไขเป็น **ภาษาไทยที่กระชับ ตรงประเด็น** ไม่อ้อมค้อม
- **ชื่อตัวแปรและโค้ด:** ใช้ภาษาอังกฤษตามมาตรฐานสากล (`snake_case` สำหรับ Python, `PascalCase` สำหรับ Class/Pydantic Schema) และเขียน Comment อธิบายจุดที่ซับซ้อนให้เข้าใจง่าย
- **ก่อนลงมือแก้โค้ดใหญ่:** หากต้องแก้ไขไฟล์มากกว่า 2 ไฟล์ หรือเปลี่ยนโครงสร้างหลัก ให้สรุปแผนการแก้ไข (Plan) และจุดที่อาจกระทบให้ยืนยันก่อนลงมือทำ

---

## 2. Tech Stack & โครงสร้างสถาปัตยกรรม (Architecture)
- **Backend:** Python (FastAPI) — ยึดโครงสร้างแบบ Modular Router ตามที่ Refactor ไว้:
  - `routers/` แยกตามโมดูลฟีเจอร์ (รับ Request / ส่ง Response เท่านั้น ห้ามใส่ Business Logic ยาวๆ)
  - `services/` (Business Logic, ระบบคิวรถ, สัญญาเช่า, การแจ้งเตือน LINE OA `SawasdeeNotification`, การอัปโหลดรูปเช็กอิน/เอาต์ 4 มุมไปยัง Google Drive)
  - `schemas/` (Pydantic Models สำหรับ Validate Input/Output)
  - `db/` (Self-hosted PostgreSQL ผ่าน `psycopg` Connection Pool — **ห้ามใช้ Supabase Client หรือ ORM ที่หนักเกินจำเป็น**)
- **Frontend:** Web Frontend มาตรฐาน (HTML5, CSS3/Tailwind CSS, Vanilla JS / Jinja2 Templates) ที่เรียกข้อมูลผ่าน FastAPI REST API — **ห้ามใช้ Streamlit หรือ Gradio ในทุกกรณี**
- **Infrastructure:** Ubuntu VPS (Hostinger), Docker / Dokploy (Port 8501), GitHub

---

## 3. กฎการทำงานร่วมกับทีมบน VPS (Team & Git Workflow)
- **ห้ามแก้ไขไฟล์ระบบโดยพลการ:** ห้ามแก้ไขหรือลบค่าในไฟล์ `.env`, `docker-compose.yml`, `Dockerfile` หรือการตั้งค่า Dokploy เว้นแต่จะได้รับคำสั่งโดยตรง
- **ตรวจสอบ Git Status เสมอ:** ก่อนเริ่มแก้โค้ดหรือสร้างไฟล์ใหม่ ให้เช็ก `git branch` และ `git status` เสมอเพื่อป้องกันการเขียนโค้ดทับงานของสมาชิกคนอื่นในทีม
- **ห้าม Hardcode ข้อมูลลับ:** `DATABASE_URL`, `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_TARGET_USER_ID`, `GOOGLE_DRIVE_WEBHOOK_URL` และ Secret Keys ต่างๆ ต้องดึงผ่าน Environment Variables (`os.getenv` / Pydantic `BaseSettings`) และอัปเดตชื่อตัวแปรไว้ใน `.env.example` เสมอ

---

## 4. มาตรฐานการเขียนโค้ดและความปลอดภัย (Coding & Security Standards)
- **Python & FastAPI Performance:**
  - ใส่ Type Hints ในทุกฟังก์ชันและพารามิเตอร์
  - หากเรียกคำสั่ง Synchronous I/O หรือ Query ฐานข้อมูลที่ไม่ได้เป็น Async ต้องรันผ่าน Threadpool (`run_in_threadpool` / `asyncio.to_thread`) เพื่อไม่ให้บล็อก Event Loop ของ FastAPI
  - จัดการ Error ด้วย `HTTPException` พร้อมระบุ Status Code และข้อความแจ้งเตือนภาษาไทยที่ชัดเจน
- **ความปลอดภัย (Security):**
  - คงมาตรฐานการเข้ารหัสรหัสผ่านด้วย PBKDF2 และการตรวจสอบสิทธิ์ Multi-tenant (แยกข้อมูลแต่ละผู้เช่าระบบให้ชัดเจน ห้าม Query ข้าม Tenant เด็ดขาด)
- **Database & API Changes:**
  - หากมีการเพิ่ม/ลดคอลัมน์ในฐานข้อมูล หรือเปลี่ยนรูปแบบ JSON Response ของ API ให้แจ้งเตือนทุกครั้งว่ากระทบกับหน้าจอ Frontend, ระบบสัญญาเช่า หรือ LINE Webhook จุดไหนบ้าง
- **การแก้ไขบั๊ก (Bug Fixing):**
  - แก้เฉพาะจุดที่เป็นสาเหตุของปัญหา ห้าม Refactor หรือเปลี่ยนชื่อ Endpoint/ฟังก์ชันเดิมที่ทีมใช้อยู่โดยไม่จำเป็น

---

## 5. การตรวจสอบหลังแก้ไข (Post-Edit Verification)
- หลังแก้ไขโค้ดเสร็จ ให้ตรวจสอบ Syntax และ Import ที่ไม่ได้ใช้งาน (Unused Imports) ให้เรียบร้อย
- หากมีการเพิ่ม Library ใหม่ ให้ระบุคำสั่งติดตั้งและอัปเดตลงใน `requirements.txt` ทุกครั้ง
