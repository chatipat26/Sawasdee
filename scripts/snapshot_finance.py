"""
Read-only financial & booking balance snapshot utility for SawasdeeRental (P3b).

บันทึก Snapshot ของรายการจองทั้งหมด (net_price, remaining_rental, pricing_version)
และยอดรวมใน financial_records ก่อนและหลังการรัน Migration / Deploy เพื่อเทียบยืนยันว่า
ข้อมูลบุ๊กกิ้งเดิม (pricing_version = 1) ไม่เปลี่ยนแปลงแม้แต่บาทเดียว

Usage:
  1. บันทึกก่อน migrate/deploy:
     python scripts/snapshot_finance.py --save snapshot_before.json
  2. เทียบหลัง migrate/deploy:
     python scripts/snapshot_finance.py --compare snapshot_before.json
"""

import argparse
import json
import os
import sys
from typing import Any, Dict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from db import store
from services.booking_service import (
    compute_fees,
    compute_remaining_rental,
    compute_rental_amount,
    pricing_version_of,
)
from services.finance_service import compute_dashboard_statistics


def build_snapshot() -> Dict[str, Any]:
    """Read current store state and return a deterministic snapshot dict (read-only)."""
    if not store.initial_sync_done:
        try:
            store.sync_from_database(force=True)
        except Exception as e:
            print(f"[Snapshot] Notice: sync_from_database skipped/failed: {e}")

    bookings_map: Dict[str, Dict[str, Any]] = {}
    total_net = 0.0
    total_rem = 0.0

    for b in store.bookings:
        bid = str(b.get("booking_id") or "").strip()
        if not bid:
            continue
        net_val = round(float(b.get("net_price") or 0.0), 2)
        rem_val = round(compute_remaining_rental(b), 2)
        dep_val = round(float(b.get("deposit_amount") or 0.0), 2)
        ver = pricing_version_of(b)
        total_net += net_val
        total_rem += rem_val
        bookings_map[bid] = {
            "pricing_version": ver,
            "status": str(b.get("status") or ""),
            "net_price": net_val,
            "rental_amount": compute_rental_amount(b),
            "fees": compute_fees(b),
            "deposit_amount": dep_val,
            "deposit_paid": bool(b.get("deposit_paid")),
            "rental_paid": bool(b.get("rental_paid") or b.get("is_fully_paid")),
            "remaining_rental": rem_val,
        }

    stats = compute_dashboard_statistics()
    return {
        "bookings_count": len(bookings_map),
        "completed_jobs_count": len(store.completed_jobs),
        "financial_records_count": len(store.financial_records),
        "sum_net_price": round(total_net, 2),
        "sum_remaining_rental": round(total_rem, 2),
        "dashboard_total_revenue": round(float(stats.get("total_revenue") or 0.0), 2),
        "bookings": bookings_map,
    }


def compare_snapshots(before: Dict[str, Any], after: Dict[str, Any]) -> int:
    """Compare v1 bookings between before and after snapshots. Return 0 if identical, 1 on drift."""
    diffs = []
    before_bks = before.get("bookings", {})
    after_bks = after.get("bookings", {})

    for bid, b_old in before_bks.items():
        if int(b_old.get("pricing_version") or 1) != 1:
            continue
        b_new = after_bks.get(bid)
        if not b_new:
            diffs.append(f"Missing booking in after snapshot: {bid}")
            continue
        for key in ("net_price", "remaining_rental", "deposit_amount", "deposit_paid", "rental_paid"):
            if b_old.get(key) != b_new.get(key):
                diffs.append(f"Booking {bid} field '{key}' changed: {b_old.get(key)} -> {b_new.get(key)}")

    if diffs:
        print(f"❌ พบความแตกต่างในบุ๊กกิ้ง v1 จำนวน {len(diffs)} จุด:")
        for d in diffs:
            print(f"  - {d}")
        return 1

    print(f"✅ บุ๊กกิ้งเดิม (v1) จำนวน {len(before_bks)} รายการ มียอดตรงกัน 100% ทุกบาท")
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description="SawasdeeRental Read-Only Financial Snapshot Tool")
    parser.add_argument("--save", help="Save current snapshot to JSON file")
    parser.add_argument("--compare", help="Compare current state against a saved JSON snapshot file")
    args = parser.parse_args()

    snap = build_snapshot()
    if args.save:
        with open(args.save, "w", encoding="utf-8") as f:
            json.dump(snap, f, ensure_ascii=False, indent=2)
        print(f"บันทึก Snapshot สำเร็จ: {args.save} (bookings={snap['bookings_count']})")
    elif args.compare:
        with open(args.compare, "r", encoding="utf-8") as f:
            old_snap = json.load(f)
        sys.exit(compare_snapshots(old_snap, snap))
    else:
        print(json.dumps({k: v for k, v in snap.items() if k != "bookings"}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
