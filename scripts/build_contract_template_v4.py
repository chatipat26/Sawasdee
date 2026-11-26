"""
Build rental_template_clean_v4.pdf from rental_template_clean_v3.pdf (or v2 fallback).

P4 (Q1):
1. ในตาราง CHARGES ฝั่งขวา:
   - แทรกแถว "Delivery fee" ต่อจาก "Daily rate"
   - เปลี่ยนแถว "Booking deposit" เป็น "Pickup fee" (ตาม D2 มัดจำ 5,000 เป็นเงินประกันที่ต้องคืน ไม่ใช่เครดิตหักค่าเช่า)
   - ขยับแถว Damage, Fuel, Cleaning, แถบส้ม TO BE INVOICED และบล็อกคำรับรอง + ลายเซ็น 3 เส้นด้านล่างลง 21pt
2. ในส่วน 03 RENTAL PERIOD & DELIVERY:
   - ลบเครื่องหมายขีด "—" ตัวอย่างที่ฝังอยู่ในช่อง DELIVERED TO และ COLLECTED FROM เพื่อให้วาดที่อยู่ 2 บรรทัดได้โดยไม่ต้องปะสีขาวทับ

Usage:  python scripts/build_contract_template_v4.py
Needs:  pip install pymupdf   (dev-only)
"""

import os
import sys

import pymupdf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_V3 = os.path.join(ROOT, "rental_template_clean_v3.pdf")
DST_V4 = os.path.join(ROOT, "rental_template_clean_v4.pdf")
SARABUN_REGULAR = os.path.join(ROOT, "Sarabun-Regular.ttf")
SARABUN_BOLD = os.path.join(ROOT, "Sarabun-Bold.ttf")


def build_v4() -> None:
    if not os.path.exists(SRC_V3):
        from build_contract_template_v3 import build as build_v3
        build_v3()

    src_doc = pymupdf.open(SRC_V3)
    out_doc = pymupdf.open()
    out_doc.insert_pdf(src_doc)
    page = out_doc[0]

    # 1. ลบขีด "—" ตัวอย่างในช่อง DELIVERED TO (x≈170.2, y≈361) และ COLLECTED FROM (x≈437.0, y≈361)
    # และลบตาราง CHARGES ตั้งแต่ใต้ Daily rate (y=434.5) ลงไปถึงเส้นลายเซ็น DATE (y=685)
    redact_rects = [
        pymupdf.Rect(169, 359, 182, 371),   # "—" ใน DELIVERED TO
        pymupdf.Rect(436, 359, 449, 371),   # "—" ใน COLLECTED FROM
        pymupdf.Rect(356, 434.5, 560, 685), # ตาราง CHARGES ครึ่งล่าง + ลายเซ็น
        pymupdf.Rect(356, 381.5, 560, 435), # ลบเส้นกรอบนอกเดิมของตาราง CHARGES (จะได้วาดกรอบใหม่ยาวถึง 569.6)
    ]

    # ก่อนลบส่วนบน (381.5..435) เราเก็บ snapshot ของหัวตาราง + แถว 1 + Daily rate (382.1..435.0) ไว้
    # หรือใช้วิธี: ไม่ลบ 381.5..434.5 แต่ลบเฉพาะกรอบนอกเดิมด้วย graphics=REMOVE_IF_COVERED
    page.add_redact_annot(pymupdf.Rect(169, 359, 182, 371), fill=False)
    page.add_redact_annot(pymupdf.Rect(436, 359, 449, 371), fill=False)
    page.apply_redactions(
        images=pymupdf.PDF_REDACT_IMAGE_NONE,
        graphics=pymupdf.PDF_REDACT_LINE_ART_NONE,
        text=pymupdf.PDF_REDACT_TEXT_REMOVE,
    )

    # ลบพื้นที่ x=356..560, y=434.5..685 ทั้งข้อความและเส้น
    page.add_redact_annot(pymupdf.Rect(356, 434.5, 560, 685), fill=False)
    page.apply_redactions(
        images=pymupdf.PDF_REDACT_IMAGE_NONE,
        graphics=pymupdf.PDF_REDACT_LINE_ART_REMOVE_IF_TOUCHED,
        text=pymupdf.PDF_REDACT_TEXT_REMOVE,
    )

    # 2. นำบล็อกคำรับรอง + ลายเซ็น 3 เส้น (เดิม y=552..682) จาก src_doc มาวางที่ตำแหน่งใหม่ (+21pt -> y=573..703)
    sig_src_clip = pymupdf.Rect(356, 552, 560, 682)
    sig_dst_rect = pymupdf.Rect(356, 573, 560, 703)
    page.show_pdf_page(sig_dst_rect, src_doc, 0, clip=sig_src_clip)

    # 3. นำแถบส้ม TO BE INVOICED (เดิม y=521.2..548.2) มาวางที่ตำแหน่งใหม่ (+21pt -> y=542.2..569.2)
    orange_src_clip = pymupdf.Rect(358.5, 521.2, 558.0, 548.2)
    orange_dst_rect = pymupdf.Rect(358.5, 542.2, 558.0, 569.2)
    page.show_pdf_page(orange_dst_rect, src_doc, 0, clip=orange_src_clip)

    # 4. นำแถว Damage, Fuel, Cleaning (เดิม y=435.8..498.8) มาวางที่ตำแหน่งใหม่ (+21pt -> y=456.8..519.8)
    dmg_src_clip = pymupdf.Rect(358.5, 435.8, 558.0, 498.8)
    dmg_dst_rect = pymupdf.Rect(358.5, 456.8, 558.0, 519.8)
    page.show_pdf_page(dmg_dst_rect, src_doc, 0, clip=dmg_src_clip)

    # 5. วาดเส้นคั่นแนวนอนสี #D8D5D0 (ความสูง 0.75pt) ทุกแถวให้ครบ
    divider_color = (0xD8 / 255, 0xD5 / 255, 0xD0 / 255)
    for y_top in (435.0, 456.8, 477.8, 498.8, 519.8, 541.5):
        page.draw_rect(
            pymupdf.Rect(358.5, y_top, 558.0, y_top + 0.75),
            color=None,
            fill=divider_color,
        )

    # 6. พิมพ์ป้ายชื่อแถวใหม่ "Delivery fee" (ในแถว y=435.8..456.8) และ "Pickup fee" (ในแถว y=519.8..541.5)
    # สี #6B6864 เหมือนแถว Damage / Fuel / Cleaning
    label_color = (0x6B / 255, 0x68 / 255, 0x64 / 255)
    font_file = SARABUN_REGULAR if os.path.exists(SARABUN_REGULAR) else None
    font_name = "sarabun" if font_file else "helv"
    if font_file:
        page.insert_font(fontname=font_name, fontfile=font_file)

    page.insert_text(
        pymupdf.Point(365.5, 448.5),
        "Delivery fee",
        fontname=font_name,
        fontsize=6.5,
        color=label_color,
    )
    page.insert_text(
        pymupdf.Point(365.5, 533.2),
        "Pickup fee",
        fontname=font_name,
        fontsize=6.5,
        color=label_color,
    )

    # 7. วาดเส้นกรอบนอกสีดำ #1A1A1A (width=0.75) คลุมตาราง CHARGES ทั้งหมด (358.1, 382.1 -> 558.4, 569.6)
    border_color = (0x1A / 255, 0x1A / 255, 0x1A / 255)
    page.draw_rect(
        pymupdf.Rect(358.1, 382.1, 558.4, 569.6),
        color=border_color,
        fill=None,
        width=0.75,
    )

    out_doc.save(DST_V4, garbage=3, deflate=True)
    print(f"สร้างไฟล์เทมเพลต v4 สำเร็จ: {DST_V4}")


if __name__ == "__main__":
    build_v4()
