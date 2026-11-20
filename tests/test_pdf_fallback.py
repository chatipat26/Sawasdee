"""
Verify `/static/pdf/inspections/{fname}` route order and on-demand PDF generation fallback
when the PDF file does not exist on disk (prevents 404 after Render/Dokploy container restarts).
"""

import os
from dependencies import static_dir


def test_static_inspection_pdf_on_demand_fallback(client):
    insp_dir = os.path.join(static_dir, "pdf", "inspections")
    checkout_fname = "Inspection_Checkout_MRC2611200001.pdf"
    checklist_fname = "Inspection_Checklist_MRC2611200001.pdf"
    checkout_path = os.path.join(insp_dir, checkout_fname)
    checklist_path = os.path.join(insp_dir, checklist_fname)

    for p in (checkout_path, checklist_path):
        if os.path.exists(p):
            os.remove(p)

    try:
        # Must NOT be shadowed by app.mount("/static", StaticFiles(...)) -> 200 PDF
        resp_checkout = client.get(f"/static/pdf/inspections/{checkout_fname}")
        assert resp_checkout.status_code == 200
        assert "application/pdf" in resp_checkout.headers["content-type"]
        assert resp_checkout.content.startswith(b"%PDF")

        resp_checklist = client.get(f"/static/pdf/inspections/{checklist_fname}")
        assert resp_checklist.status_code == 200
        assert "application/pdf" in resp_checklist.headers["content-type"]
        assert resp_checklist.content.startswith(b"%PDF")

        # Unknown file should return 404 properly
        resp_missing = client.get("/static/pdf/inspections/NonExistent_File.pdf")
        assert resp_missing.status_code == 404
    finally:
        for p in (checkout_path, checklist_path):
            if os.path.exists(p):
                os.remove(p)
