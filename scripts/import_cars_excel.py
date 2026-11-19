#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
=============================================================================
SawasdeeRental - Fast & Safe Standalone Bulk Data Migration (Excel to cars)
File: scripts/import_cars_excel.py
=============================================================================
STRICT CONSTRAINTS:
1. BULK INSERT ONLY: db.bulk_insert_mappings(Car, ...) & db.bulk_update_mappings(Car, ...)
2. SAFE UPSERT MIGRATION: Checks existing plates, UPDATE if exists, INSERT if new.
3. ZERO CORE LOGIC REWRITES: Isolated standalone migration script.
4. EXACT COLUMN MAPPING: header=4 (Row 5), mapped via iloc indices.
5. DATA SANITIZATION: NaN, NaT, and empty strings are strictly converted to None.
=============================================================================
"""

import os
import sys
import argparse
import time
from datetime import datetime, date
import glob

# Ensure UTF-8 output on Windows terminals
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# Ensure project root is in python path
current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)
for p in [current_dir, parent_dir]:
    if p not in sys.path:
        sys.path.insert(0, p)

import pandas as pd
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

# Import models & database config
try:
    from models import Car, Vehicle
except Exception:
    from models import Vehicle
    Car = Vehicle

try:
    import database
    PROJECT_DB_URL = database.DATABASE_URL
except Exception:
    PROJECT_DB_URL = os.getenv("DATABASE_URL", "").strip()


def clean_val(v):
    """Convert NaN, NaT, null-like strings, and empty whitespace to None."""
    if v is None:
        return None
    if pd.isna(v):
        return None
    if isinstance(v, (datetime, date)):
        return v.strftime("%Y-%m-%d")
    s = str(v).strip()
    if s.lower() in ("nan", "nat", "none", "null", "-", ""):
        return None
    return s


def find_excel_file(specified_path=None):
    """Locate the Excel file on disk with automatic search."""
    if specified_path and os.path.isfile(specified_path):
        return specified_path

    # Check local workspace / working directory first
    candidates = [
        "ทะเบียนคุมรถยนต์ Draft.xlsx",
        "ทะเบียนคุมรถยนต์_Draft.xlsx",
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "ทะเบียนคุมรถยนต์ Draft.xlsx"),
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "ทะเบียนคุมรถยนต์ Draft.xlsx"),
    ]
    for c in candidates:
        norm = os.path.abspath(c)
        if os.path.isfile(norm):
            return norm

    # Search any xlsx in current working directory
    xlsx_files = glob.glob("*.xlsx")
    if xlsx_files:
        return os.path.abspath(xlsx_files[0])

    return None


def load_and_clean_excel(file_path, sheet_name="ชีต1", suffix_red_plates=False):
    """
    TARGET MISSION 1 & 2:
    Read Excel file with header=4 (Row 5), clean invalid rows, and map exact column indices.
    """
    print(f"📖 กำลังโหลดไฟล์ Excel: {file_path}")
    print(f"📄 Sheet: '{sheet_name}', Header row: 4 (แถวที่ 5 ของ Excel)")

    # Read sheet
    df = pd.read_excel(file_path, sheet_name=sheet_name, header=4)
    raw_total = len(df)
    print(f"🔍 จำนวนแถวทั้งหมดที่อ่านได้: {raw_total} แถว")

    # Column index 2 is 'ข้อมูลทั่วไปรถยนต์' (ทะเบียนรถ)
    col_plate_idx = 2
    col_plate_name = df.columns[col_plate_idx]

    # Filter 1: Drop empty plates
    df = df.dropna(subset=[col_plate_name]).copy()

    # Filter 2: Drop sub-headers or category headers
    df = df[df[col_plate_name].astype(str).str.strip() != "เลขทะเบียนรถยนต์"].copy()
    valid_rows = len(df)
    print(f"✅ ข้อมูลรถยนต์หลังตัดแถวว่างและหัวข้อ: {valid_rows} แถว")

    records = []
    red_plate_count = 0

    for _, row in df.iterrows():
        # EXACT COLUMN MAPPING BY INDEX
        plate = clean_val(row.iloc[2]) if len(row) > 2 else None
        if not plate:
            continue

        brand = clean_val(row.iloc[3]) if len(row) > 3 else None
        model = clean_val(row.iloc[4]) if len(row) > 4 else None
        color = clean_val(row.iloc[5]) if len(row) > 5 else None
        reg_year = clean_val(row.iloc[6]) if len(row) > 6 else None
        chassis_no = clean_val(row.iloc[7]) if len(row) > 7 else None
        owner_name = clean_val(row.iloc[1]) if len(row) > 1 else None

        ins_company = clean_val(row.iloc[23]) if len(row) > 23 else None
        ins_expiry = clean_val(row.iloc[27]) if len(row) > 27 else None
        act_expiry = clean_val(row.iloc[29]) if len(row) > 29 else None
        tax_expiry = clean_val(row.iloc[31]) if len(row) > 31 else None

        # Differentiate multiple red plates if requested
        if suffix_red_plates and "ป้ายแดง" in plate:
            red_plate_count += 1
            suffix = chassis_no[-6:] if chassis_no and len(chassis_no) >= 6 else str(red_plate_count)
            plate = f"ป้ายแดง ({suffix})"

        record = {
            "plate": plate,
            "brand": brand,
            "model": model,
            "color": color,
            "registration_year": reg_year,
            "register_year": reg_year or "-",
            "chassis_no": chassis_no,
            "vin": chassis_no or "-",
            "owner_name": owner_name,
            "car_owner": owner_name or "-",
            "owner_company": owner_name or "Sawasdee Rent A Car",
            "ins_company": ins_company,
            "insurance_company": ins_company or "-",
            "ins_expiry": ins_expiry,
            "insurance_expire_date": ins_expiry or "-",
            "act_expiry": act_expiry,
            "prb_expire_date": act_expiry or "-",
            "tax_expiry": tax_expiry,
            "tax_expire_date": tax_expiry or "-",
            "status": "ว่างพร้อมใช้งาน",
            "car_status": "ว่างพร้อมใช้งาน"
        }
        records.append(record)

    return records


def run_bulk_upsert(records, db_url=None, dry_run=False):
    """
    TARGET MISSION 3: Safe Database Execution
    Deduplicates records, queries existing plates in 1 query, and executes
    db.bulk_insert_mappings() & db.bulk_update_mappings() for sub-second execution.
    """
    if not records:
        print("⚠️ ไม่พบข้อมูลรถยนต์ที่ต้องบันทึก")
        return {"inserted": 0, "updated": 0, "total": 0}

    # In-memory deduplication by plate (merge records so no data is lost)
    unique_map = {}
    for r in records:
        p = r["plate"]
        if p not in unique_map:
            unique_map[p] = r
        else:
            # Merge fields from duplicate rows if newer value exists
            for k, val in r.items():
                if val is not None:
                    unique_map[p][k] = val

    unique_records = list(unique_map.values())
    total_unique = len(unique_records)
    print(f"📊 จำนวนรถยนต์หลังรวมทะเบียนซ้ำ: {total_unique} คัน")

    target_url = db_url or PROJECT_DB_URL
    if target_url.startswith("postgres://"):
        target_url = target_url.replace("postgres://", "postgresql://", 1)

    print(f"🔌 เชื่อมต่อฐานข้อมูล...")

    try:
        engine = create_engine(target_url, pool_pre_ping=True)
        Session = sessionmaker(bind=engine, autocommit=False, autoflush=False)
        db = Session()

        # Query existing plates in 1 single fast query
        existing_rows = db.query(Car.plate).all()
        existing_plates = {row[0] for row in existing_rows}
        print(f"📋 พบทะเบียนรถเดิมในตาราง cars: {len(existing_plates)} คัน")

    except Exception as conn_err:
        if dry_run:
            print(f"ℹ️ เชื่อมต่อ DB ปลายทางไม่ได้ ({conn_err}) -> จำลองด้วย In-Memory SQLite สำหรับ Dry Run")
            from models import Base
            engine = create_engine("sqlite:///:memory:")
            Base.metadata.create_all(engine)
            Session = sessionmaker(bind=engine, autocommit=False, autoflush=False)
            db = Session()
            existing_plates = set()
        else:
            print(f"❌ ไม่สามารถเชื่อมต่อฐานข้อมูลได้: {conn_err}")
            raise

    to_insert = []
    to_update = []

    for item in unique_records:
        if item["plate"] in existing_plates:
            to_update.append(item)
        else:
            to_insert.append(item)

    print(f"🚀 เตรียมดำเนินการ:")
    print(f"   ➕ เพิ่มข้อมูลใหม่ (INSERT): {len(to_insert)} คัน")
    print(f"   🔄 อัปเดตข้อมูลเดิม (UPDATE): {len(to_update)} คัน")

    if dry_run:
        print("🧪 [DRY RUN] ตรวจสอบโครงสร้างข้อมูลและ Mapping สำเร็จ (ไม่ได้เขียนลง Database จริง)")
        return {"inserted": len(to_insert), "updated": len(to_update), "total": total_unique}

    start_time = time.time()
    try:
        # STRICT CONSTRAINT: Bulk operations only (No slow row-by-row loops)
        if to_insert:
            db.bulk_insert_mappings(Car, to_insert)
        if to_update:
            db.bulk_update_mappings(Car, to_update)

        db.commit()
        elapsed = time.time() - start_time
        print(f"✅ บันทึกข้อมูลแบบ Bulk Upsert สำเร็จเรียบร้อย! (ใช้เวลา {elapsed:.3f} วินาที)")

        # Sync local cache DataStore if running within app server
        try:
            from db import store
            store.sync_from_database(force=True)
            print("🔄 ซิงค์หน่วยความจำแคชของระบบเรียบร้อย")
        except Exception:
            pass

        return {
            "inserted": len(to_insert),
            "updated": len(to_update),
            "total": total_unique,
            "elapsed_seconds": round(elapsed, 3)
        }

    except Exception as e:
        db.rollback()
        print(f"❌ เกิดข้อผิดพลาดขณะ Bulk Upsert: {e}")
        raise
    finally:
        db.close()


def main():
    parser = argparse.ArgumentParser(description="Bulk Import Car Data from Excel into PostgreSQL (cars table)")
    parser.add_argument("--file", default=None, help="Path to Excel file (default: auto-detect 'ทะเบียนคุมรถยนต์ Draft.xlsx')")
    parser.add_argument("--sheet", default="ชีต1", help="Sheet name (default: 'ชีต1')")
    parser.add_argument("--db-url", default=None, help="PostgreSQL connection string override")
    parser.add_argument("--dry-run", action="store_true", help="Preview mapping without committing to database")
    parser.add_argument("--suffix-red-plates", action="store_true", help="Differentiate multiple 'ป้ายแดง' by chassis suffix")

    args = parser.parse_args()

    print("=" * 65)
    print("🚗 SawasdeeRental - Bulk Car Data Migration (Excel to cars)")
    print("=" * 65)

    excel_file = find_excel_file(args.file)
    if not excel_file:
        print(f"❌ ไม่พบไฟล์ Excel ในโฟลเดอร์ กรุณาระบุผ่าน parameter: --file 'ชื่อไฟล์.xlsx'")
        sys.exit(1)

    try:
        records = load_and_clean_excel(
            file_path=excel_file,
            sheet_name=args.sheet,
            suffix_red_plates=args.suffix_red_plates
        )

        res = run_bulk_upsert(
            records=records,
            db_url=args.db_url,
            dry_run=args.dry_run
        )

        print("=" * 65)
        print("🎉 สรุปผลการประมวลผล:")
        print(f"   • รวมรายการรถยนต์ทั้งหมด: {res['total']} คัน")
        print(f"   • เพิ่มใหม่ (INSERT):      {res['inserted']} คัน")
        print(f"   • อัปเดตเดิม (UPDATE):    {res['updated']} คัน")
        if "elapsed_seconds" in res:
            print(f"   • เวลาที่ใช้:            {res['elapsed_seconds']} วินาที")
        print("=" * 65)

    except Exception as err:
        print(f"\n❌ การประมวลผลล้มเหลว: {err}")
        sys.exit(1)


if __name__ == "__main__":
    main()
