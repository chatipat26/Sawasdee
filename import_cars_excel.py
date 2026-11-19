import os
import pandas as pd
import numpy as np
from sqlalchemy import create_engine, text
from database import load_env_file

load_env_file()

DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
if not DATABASE_URL:
    print("❌ ยังไม่ได้ตั้งค่า DATABASE_URL ใน Environment / .env")
    exit(1)

print("🔗 กำลังเชื่อมต่อฐานข้อมูล PostgreSQL...")
engine = create_engine(DATABASE_URL)

# 2. ตั้งค่าชื่อไฟล์ Excel 
EXCEL_FILE = "ทะเบียนคุมรถยนต์ Draft.xlsx" 

print(f"📂 กำลังอ่านไฟล์ Excel: {EXCEL_FILE} ...")
try:
    # โหลดไฟล์โดยใช้แถวที่ 5 (index 4) เป็น Header
    df = pd.read_excel(EXCEL_FILE, sheet_name=0, header=4)
except FileNotFoundError:
    print(f"❌ ไม่พบไฟล์ '{EXCEL_FILE}' กรุณาตรวจสอบชื่อไฟล์ว่าถูกต้องและอยู่ในโฟลเดอร์เดียวกัน")
    exit(1)
except Exception as e:
    print(f"❌ เกิดข้อผิดพลาดในการอ่านไฟล์ Excel: {e}")
    exit(1)

# 3. ทำความสะอาดข้อมูล (Data Cleaning)
col_plate = df.columns[2] # คอลัมน์ "ข้อมูลทั่วไปรถยนต์" (ป้ายทะเบียน)
df = df.dropna(subset=[col_plate]) # ทิ้งแถวที่ไม่มีทะเบียน
df = df[df[col_plate].astype(str).str.strip() != "เลขทะเบียนรถยนต์"] # ทิ้งแถวที่เป็นหัวข้อซ้ำ

# แปลงค่า NaN (ว่าง) ของ Pandas ให้เป็น None เพื่อให้ Database ไม่ Error
df = df.replace({np.nan: None, pd.NaT: None})

print(f"✅ พบข้อมูลรถทั้งหมด: {len(df)} คัน กำลังเริ่มบันทึกลง Database...")

# 4. อัดข้อมูลลง Database (Upsert: อัปเดตถ้ามีอยู่แล้ว / เพิ่มใหม่ถ้ายังไม่มี)
success_count = 0
error_count = 0

with engine.begin() as conn:  # ใช้ Transaction (จะ Commit อัตโนมัติเมื่อจบ block)
    for index, row in df.iterrows():
        plate = str(row.iloc[2]).strip()
        try:
            # Map ข้อมูลตาม Index ของ Excel (อ้างอิงจากโครงสร้างไฟล์)
            brand = str(row.iloc[3]).strip() if row.iloc[3] else None
            model = str(row.iloc[4]).strip() if row.iloc[4] else None
            color = str(row.iloc[5]).strip() if row.iloc[5] else None
            registration_year = str(row.iloc[6]).strip() if row.iloc[6] else None
            chassis_no = str(row.iloc[7]).strip() if row.iloc[7] else None
            owner_name = str(row.iloc[1]).strip() if row.iloc[1] else None
            
            ins_company = str(row.iloc[23]).strip() if row.iloc[23] else None
            
            # แปลงวันที่
            ins_expiry = row.iloc[27] if pd.notnull(row.iloc[27]) else None
            act_expiry = row.iloc[29] if pd.notnull(row.iloc[29]) else None
            tax_expiry = row.iloc[31] if pd.notnull(row.iloc[31]) else None
            
            status = "ว่างพร้อมใช้งาน"

            # ตรวจสอบว่ามีทะเบียนนี้ในระบบหรือยัง
            check_sql = text("SELECT plate FROM cars WHERE plate = :plate")
            existing = conn.execute(check_sql, {"plate": plate}).fetchone()

            if existing:
                # UPDATE ข้อมูลเก่า
                update_sql = text("""
                    UPDATE cars SET 
                        brand = :brand, model = :model, color = :color, 
                        registration_year = :registration_year, chassis_no = :chassis_no, 
                        owner_name = :owner_name, ins_company = :ins_company, 
                        ins_expiry = :ins_expiry, act_expiry = :act_expiry, tax_expiry = :tax_expiry
                    WHERE plate = :plate
                """)
                conn.execute(update_sql, {
                    "brand": brand, "model": model, "color": color, 
                    "registration_year": registration_year, "chassis_no": chassis_no, 
                    "owner_name": owner_name, "ins_company": ins_company, 
                    "ins_expiry": ins_expiry, "act_expiry": act_expiry, 
                    "tax_expiry": tax_expiry, "plate": plate
                })
                print(f"🔄 อัปเดตข้อมูลเดิม: {plate}")
            else:
                # INSERT ข้อมูลใหม่
                insert_sql = text("""
                    INSERT INTO cars (
                        plate, brand, model, color, registration_year, chassis_no, 
                        owner_name, ins_company, ins_expiry, act_expiry, tax_expiry, status
                    ) VALUES (
                        :plate, :brand, :model, :color, :registration_year, :chassis_no, 
                        :owner_name, :ins_company, :ins_expiry, :act_expiry, :tax_expiry, :status
                    )
                """)
                conn.execute(insert_sql, {
                    "plate": plate, "brand": brand, "model": model, "color": color, 
                    "registration_year": registration_year, "chassis_no": chassis_no, 
                    "owner_name": owner_name, "ins_company": ins_company, 
                    "ins_expiry": ins_expiry, "act_expiry": act_expiry, 
                    "tax_expiry": tax_expiry, "status": status
                })
                print(f"➕ เพิ่มรถคันใหม่: {plate}")
            
            success_count += 1
            
        except Exception as e:
            print(f"❌ เกิดข้อผิดพลาดกับทะเบียน [{plate}]: {str(e)}")
            error_count += 1

print("-" * 40)
print(f"🎉 ทำรายการเสร็จสิ้น!")
print(f"✅ นำเข้า/อัปเดตสำเร็จ: {success_count} คัน")
if error_count > 0:
    print(f"⚠️ มีข้อผิดพลาด: {error_count} คัน (เช็ค Log ด้านบน)")