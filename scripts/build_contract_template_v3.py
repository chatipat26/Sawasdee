"""
Build rental_template_clean_v3.pdf from rental_template_blank_v2.pdf (dev-only tool).

ลบ "รอยปะสีขาว" และข้อความตัวอย่างที่ฝังอยู่ในเทมเพลต v2 ออกจากต้นทาง
แล้ววาดกรอบช่องติ๊กที่ Bank transfer / Security deposit Collected ใหม่ให้เหมือนช่องอื่น
ไม่แก้ไฟล์ v2 (เก็บไว้เป็น fallback)

Usage:  python scripts/build_contract_template_v3.py
Needs:  pip install pymupdf   (dev-only, ไม่ต้องใส่ใน requirements.txt ของ production)
"""

import os
import sys

import pymupdf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "rental_template_blank_v2.pdf")
DST = os.path.join(ROOT, "rental_template_clean_v3.pdf")

# พิกัดทั้งหมดเป็นระบบ PyMuPDF (origin มุมบนซ้าย, Y ลงล่าง)
# ข้อความตัวอย่างที่ต้องลบ (ตรวจจาก v2)
SAMPLE_TEXT_RECTS = [
    pymupdf.Rect(364, 403, 393, 416),    # "1 month"
    pymupdf.Rect(500, 400, 553, 416),    # "฿39,000" (แถวค่าเช่า)
    pymupdf.Rect(529, 424, 553, 433),    # "฿2,600"  (Daily rate)
    pymupdf.Rect(497, 526, 553, 543),    # "฿39,000" บนแถบส้ม
    pymupdf.Rect(35, 574, 192, 586),     # บรรทัดบัญชี KBANK (D8: ซ่อนไว้เหมือนเดิม)
    pymupdf.Rect(230, 574, 263, 586),    # "฿37,050" ช่อง AMOUNT PAID
    pymupdf.Rect(140.5, 593, 165, 602),  # "฿37,050" หลังคำว่า Collected
]

# บริเวณช่องติ๊กที่มีกรอบซ้อน + เครื่องหมายทึบฝังอยู่ (Bank transfer / Collected)
CHECKBOX_CLEAN_RECTS = [
    pymupdf.Rect(67, 549, 78, 561.5),
    pymupdf.Rect(101.5, 590.5, 112, 602),
]

# กรอบช่องติ๊กมาตรฐานเดียวกับ Cash / PayPal / Waived (5.3 x 5.3, เส้น 0.75, #9C9892)
CHECKBOX_REDRAW = [
    pymupdf.Rect(70.9, 554.6, 76.2, 559.9),    # Bank transfer
    pymupdf.Rect(105.4, 595.1, 110.7, 600.4),  # Security deposit: Collected
]
BOX_STROKE = (0x9C / 255, 0x98 / 255, 0x92 / 255)

# ขอบเขตของ "รอยปะสีขาวขนาดเล็ก" ที่ต้องลบ (เฉพาะบริเวณตารางขวา + ส่วน 05)
PATCH_REGIONS = [
    pymupdf.Rect(340, 380, 560, 550),
    pymupdf.Rect(30, 565, 300, 605),
]


def _is_white(color) -> bool:
    return color is not None and all(c > 0.99 for c in color)


def collect_white_patches(page: pymupdf.Page) -> list[pymupdf.Rect]:
    """หาสี่เหลี่ยมสีขาวขนาดเล็กที่ฝังอยู่ในเทมเพลต (รอยปะเดิม)"""
    patches: list[pymupdf.Rect] = []
    for d in page.get_drawings():
        r = d["rect"]
        if not _is_white(d.get("fill")) or d.get("fill_opacity", 1) == 0:
            continue
        if r.width > 130 or r.height > 30:
            continue
        if any(region.contains(r) for region in PATCH_REGIONS):
            patches.append(r)
    return patches


def build() -> None:
    if not os.path.exists(SRC):
        sys.exit(f"ไม่พบไฟล์ต้นฉบับ: {SRC}")

    doc = pymupdf.open(SRC)
    page = doc[0]

    patches = collect_white_patches(page)
    print(f"พบรอยปะสีขาวฝังในเทมเพลต: {len(patches)} ชิ้น")

    # Pass 1: ลบรอยปะ + กรอบ/เครื่องหมายซ้อน (ลบเฉพาะ line-art ที่อยู่ในกรอบทั้งชิ้น)
    # ไม่เติมสีทับ (fill=False) -> พื้นหลังเดิม (ครีม/ส้ม/ขาว) โผล่ขึ้นมาเอง
    # ทำทีละกรอบ เพราะกรอบที่ซ้อนทับกันทำให้ PyMuPDF ลบ line-art ไม่ครบ
    for r in patches + CHECKBOX_CLEAN_RECTS:
        page.add_redact_annot(r + (-0.4, -0.4, 0.4, 0.4), fill=False)
        page.apply_redactions(
            images=pymupdf.PDF_REDACT_IMAGE_NONE,
            graphics=pymupdf.PDF_REDACT_LINE_ART_REMOVE_IF_COVERED,
            text=pymupdf.PDF_REDACT_TEXT_NONE,
        )

    # Pass 2: ลบข้อความตัวอย่างทีละคำ (เฉพาะคำที่อยู่ในกรอบ ไม่แตะคำข้างเคียง เช่น "Collected")
    words = [w for w in page.get_text("words")
             if any(pymupdf.Rect(w[:4]).get_area() > 0 and region.contains(pymupdf.Point((w[0] + w[2]) / 2, (w[1] + w[3]) / 2))
                    for region in SAMPLE_TEXT_RECTS)]
    print(f"ลบข้อความตัวอย่าง: {[w[4] for w in words]}")
    for w in words:
        page.add_redact_annot(pymupdf.Rect(w[:4]) + (0.3, 0.3, -0.3, -0.3), fill=False)
    page.apply_redactions(
        images=pymupdf.PDF_REDACT_IMAGE_NONE,
        graphics=pymupdf.PDF_REDACT_LINE_ART_NONE,
        text=pymupdf.PDF_REDACT_TEXT_REMOVE,
    )
    for box in CHECKBOX_REDRAW:
        page.draw_rect(box, color=BOX_STROKE, fill=None, width=0.75)

    doc.save(DST, garbage=3, deflate=True)
    print(f"สร้างไฟล์สำเร็จ: {DST}")


if __name__ == "__main__":
    build()

