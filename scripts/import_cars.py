#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
=============================================================================
SawasdeeRental - Fast & Safe Bulk Data Migration for Vehicles (cars)
Tool: import_cars.py
Source: "ทะเบียนคุมรถยนต์ Draft.xlsx" (Sheet: "ชีต1", header=4)
Destination: PostgreSQL table `cars`
=============================================================================
Rules:
1. BULK INSERT ONLY: Uses db.bulk_insert_mappings(Car, ...) & db.bulk_update_mappings(Car, ...)
2. EXACT COLUMN MAPPING: Starts at header=4, strictly maps specified iloc indices.
3. DATA SANITIZATION: NaN, NaT, and empty strings are converted to None before DB entry.
"""

import os
import sys
import argparse
import time
from datetime import datetime, date

# Ensure UTF-8 output on Windows terminals
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
import pandas as pd
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

# Ensure workspace root is in python path
current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)
for p in [current_dir, parent_dir]:
    if p not in sys.path:
        sys.path.insert(0, p)

try:
    import models
    from models import Car, Vehicle
except Exception as e:
    # Fallback if imported from another location
    from models import Car, Vehicle

try:
    import database
    DEFAULT_DB_URL = database.DATABASE_URL
except Exception:
    DEFAULT_DB_URL = os.getenv("DATABASE_URL", "").strip()


def clean_val(v):
    """Clean string values, converting NaN, NaT, and empty strings to None."""
    if pd.isna(v) or v is None:
        return None
    s = str(v).strip()
    if s.endswith(".0"):
        try:
            f = float(s)
            if f.is_integer():
                s = str(int(f))
        except Exception:
            pass
    if not s or s.lower() in ("-", "none", "nan", "nat", "null", "n/a"):
        return None
    return s


def clean_date(v):
    """Clean date values into standardized YYYY-MM-DD string or None."""
    if pd.isna(v) or v is None:
        return None
    if isinstance(v, (datetime, date, pd.Timestamp)):
        return v.strftime("%Y-%m-%d")
    s = str(v).strip()
    if not s or s.lower() in ("-", "none", "nan", "nat", "null", "/", "n/a"):
        return None
    if " " in s:
        s = s.split(" ")[0].strip()
    return s


def load_excel_cars(excel_path="ทะเบียนคุมรถยนต์ Draft.xlsx", sheet_name="ชีต1", suffix_red_plates=False):
    """
    Read and sanitize vehicle data from Excel file according to exact column specifications.
    """
    if not os.path.exists(excel_path):
        # Also check in parent directory if executed from scripts/
        alt_path = os.path.join(parent_dir, excel_path)
        if os.path.exists(alt_path):
            excel_path = alt_path
        else:
            raise FileNotFoundError(f"ไม่พบไฟล์ Excel: '{excel_path}' กรุณาตรวจสอบตำแหน่งไฟล์")

    print(f"📖 กำลังโหลดข้อมูลจากไฟล์: {excel_path} (ชีต: '{sheet_name}', header=4)...")
    df = pd.read_excel(excel_path, sheet_name=sheet_name, header=4)
    total_raw_rows = len(df)

    # 1. กรองแถวว่าง: ลบแถวที่ไม่มีข้อมูลทั่วไปรถยนต์ (ทะเบียนรถ)
    if "ข้อมูลทั่วไปรถยนต์" not in df.columns:
        raise ValueError("ไม่พบคอลัมน์ 'ข้อมูลทั่วไปรถยนต์' ที่แถว header=4 กรุณาตรวจสอบไฟล์ Excel")

    df = df.dropna(subset=["ข้อมูลทั่วไปรถยนต์"])

    # 2. กรองเฉพาะแถวที่ข้อมูลคอลัมน์ "ข้อมูลทั่วไปรถยนต์" ไม่ใช่คำว่า "เลขทะเบียนรถยนต์"
    df = df[df["ข้อมูลทั่วไปรถยนต์"].astype(str).str.strip() != "เลขทะเบียนรถยนต์"]

    print(f"🔍 อ่านข้อมูลทั้งหมด {total_raw_rows} แถว -> กรองข้อมูลสภาพพร้อมใช้งานได้ {len(df)} แถว")

    records = []
    red_plate_counter = 1

    for idx, row in df.iterrows():
        raw_plate = clean_val(row.iloc[2])
        if not raw_plate:
            continue

        plate = raw_plate
        chassis_no = clean_val(row.iloc[7])

        # Optional handling for duplicate 'ป้ายแดง' cars to ensure unique primary key
        if suffix_red_plates and "ป้ายแดง" in plate:
            if chassis_no:
                plate = f"ป้ายแดง ({chassis_no[-6:]})"
            else:
                plate = f"ป้ายแดง-{red_plate_counter}"
                red_plate_counter += 1

        brand = clean_val(row.iloc[3])
        model = clean_val(row.iloc[4])
        color = clean_val(row.iloc[5])
        reg_year = clean_val(row.iloc[6])
        owner_name = clean_val(row.iloc[1])
        ins_company = clean_val(row.iloc[23])
        ins_expiry = clean_date(row.iloc[27])
        act_expiry = clean_date(row.iloc[29])
        tax_expiry = clean_date(row.iloc[31])

        record = {
            "plate": plate,
            "brand": brand,
            "model": model,
            "color": color,
            "registration_year": reg_year,
            "chassis_no": chassis_no,
            "owner_name": owner_name,
            "ins_company": ins_company,
            "ins_expiry": ins_expiry,
            "act_expiry": act_expiry,
            "tax_expiry": tax_expiry,
            "status": "ว่างพร้อมใช้งาน",
            # Application model aliases for maximum compatibility
            "car_status": "ว่างพร้อมใช้งาน",
            "vin": chassis_no or "-",
            "car_owner": owner_name or "-",
            "owner_company": owner_name or "Sawasdee Rent A Car",
            "insurance_company": ins_company or "-",
            "insurance_expire_date": ins_expiry or "-",
            "prb_expire_date": act_expiry or "-",
            "tax_expire_date": tax_expiry or "-"
        }
        records.append(record)

    return records


def import_cars_to_db(records, db_url=None, dry_run=False):
    """
    Perform high-performance bulk upsert to PostgreSQL table `cars`.
    Uses db.bulk_insert_mappings() and db.bulk_update_mappings() without slow row-by-row loops.
    """
    if not records:
        print("⚠️ ไม่มีข้อมูลรถยนต์สำหรับนำเข้า")
        return {"inserted": 0, "updated": 0, "total": 0}

    # Deduplicate in-memory by plate (latest record wins)
    unique_map = {}
    for r in records:
        p = r["plate"]
        unique_map[p] = r

    unique_records = list(unique_map.values())
    print(f"📊 ข้อมูลรถยนต์หลังจากคัดกรองทะเบียนซ้ำ: {len(unique_records)} คัน")

    target_db_url = db_url or DEFAULT_DB_URL
    if target_db_url.startswith("postgres://"):
        target_db_url = target_db_url.replace("postgres://", "postgresql://", 1)

    print(f"🔌 เชื่อมต่อฐานข้อมูล...")
    engine = None
    try:
        engine = create_engine(target_db_url, pool_pre_ping=True)
        Session = sessionmaker(bind=engine, autocommit=False, autoflush=False)
        db = Session()
        existing_rows = db.query(Car.plate).all()
        existing_plates = {row[0] for row in existing_rows}
        print(f"📋 พบทะเบียนรถเดิมในฐานข้อมูล: {len(existing_plates)} คัน")
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
            print(f"❌ ไม่สามารถเชื่อมต่อฐานข้อมูล: {conn_err}")
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
            print("🧪 [DRY RUN MODE] ไม่มีการบันทึกลงฐานข้อมูลจริง")
            return {"inserted": len(to_insert), "updated": len(to_update), "total": len(unique_records)}

        start_t = time.time()

        # BULK OPERATIONS (Strict constraint compliance)
        if to_insert:
            db.bulk_insert_mappings(Car, to_insert)
        if to_update:
            db.bulk_update_mappings(Car, to_update)

        db.commit()
        elapsed = time.time() - start_t
        print(f"✅ บันทึกข้อมูลสำเร็จเรียบร้อยในเวลา {elapsed:.3f} วินาที!")

        # Sync local cache / DataStore if in same runtime
        try:
            from db import store
            store.sync_from_database(force=True)
            print("🔄 ซิงค์หน่วยความจำแคช (DataStore) เรียบร้อย")
        except Exception:
            pass

        return {
            "inserted": len(to_insert),
            "updated": len(to_update),
            "total": len(unique_records),
            "elapsed_seconds": round(elapsed, 3)
        }

    except Exception as e:
        db.rollback()
        print(f"❌ เกิดข้อผิดพลาดในการนำเข้าข้อมูล: {e}")
        raise
    finally:
        db.close()


def main():
    parser = argparse.ArgumentParser(description="Bulk Import Car Data from Excel to PostgreSQL (cars)")
    parser.add_argument("--file", default="ทะเบียนคุมรถยนต์ Draft.xlsx", help="Path to Excel file (default: 'ทะเบียนคุมรถยนต์ Draft.xlsx')")
    parser.add_argument("--sheet", default="ชีต1", help="Excel sheet name (default: 'ชีต1')")
    parser.add_argument("--db-url", default=None, help="PostgreSQL connection URL override")
    parser.add_argument("--dry-run", action="store_true", help="Preview data without writing to database")
    parser.add_argument("--suffix-red-plates", action="store_true", help="Differentiate multiple 'ป้ายแดง' by chassis suffix")

    args = parser.parse_args()

    print("=" * 65)
    print("🚗 SawasdeeRental - Bulk Car Data Migration Script")
    print("=" * 65)

    try:
        records = load_excel_cars(
            excel_path=args.file,
            sheet_name=args.sheet,
            suffix_red_plates=args.suffix_red_plates
        )
        res = import_cars_to_db(
            records=records,
            db_url=args.db_url,
            dry_run=args.dry_run
        )
        print("=" * 65)
        print(f"🎉 สรุปผลการทำงาน:")
        print(f"   • รวมรายการที่ประมวลผล: {res['total']} คัน")
        print(f"   • เพิ่มข้อมูลใหม่ (INSERT): {res['inserted']} คัน")
        print(f"   • อัปเดตข้อมูลเดิม (UPDATE): {res['updated']} คัน")
        if "elapsed_seconds" in res:
            print(f"   • เวลาที่ใช้: {res['elapsed_seconds']} วินาที")
        print("=" * 65)
    except Exception as err:
        print(f"\n❌ Error: {err}")
        sys.exit(1)


if __name__ == "__main__":
    main()
