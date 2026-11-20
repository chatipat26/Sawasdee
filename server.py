"""
SawasdeeRental Web App — FastAPI Application Entrypoint.
"""

import os
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from database import init_db
from db import store, get_db_client, start_background_cloud_sync
from line_service import init_expiry_scheduler_thread
from dependencies import static_dir

from routers import (
    cars_router,
    auth_router,
    customers_router,
    line_router,
    system_router,
    finance_router,
    reports_router,
    maintenance_router,
    pdf_router,
    bookings_router,
)

# Backward-compatibility re-exports for legacy entrypoints (e.g. main.py)
from routers.cars import list_cars, create_or_update_car  # noqa: F401
from routers.customers import list_customers, create_or_update_customer  # noqa: F401
from routers.bookings import list_bookings, create_booking  # noqa: F401

app = FastAPI(title="SawasdeeRental Web App", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_origin_regex=r"https?://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register API & PDF fallback routers BEFORE mounting /static so /static/pdf/inspections/{fname} matches first
app.include_router(cars_router)
app.include_router(auth_router)
app.include_router(customers_router)
app.include_router(line_router)
app.include_router(system_router)
app.include_router(finance_router)
app.include_router(reports_router)
app.include_router(maintenance_router)
app.include_router(pdf_router)
app.include_router(bookings_router)

app.mount("/static", StaticFiles(directory=static_dir), name="static")


# Start background sync and scheduler on startup
@app.on_event("startup")
def startup_event():
    print("🚀 Starting SawasdeeRental Web App server...")
    import threading

    def _async_startup_bootstrap():
        # Attempt direct PostgreSQL schema check/migration (non-blocking)
        try:
            init_db()
            sb = get_db_client()
            if sb and hasattr(sb, "ensure_schema"):
                sb.ensure_schema()
        except Exception as e:
            print(f"Startup schema check note: {e}")

        # Perform initial sync in background so uvicorn binds port & returns 200 immediately
        try:
            store.sync_from_database(force=True)
        except Exception as e:
            print(f"Startup sync note: {e}")

    try:
        threading.Thread(target=_async_startup_bootstrap, daemon=True).start()
    except Exception as e:
        print(f"Startup bootstrap thread note: {e}")

    try:
        start_background_cloud_sync()
    except Exception as e:
        print(f"Background cloud sync start note: {e}")

    try:
        init_expiry_scheduler_thread()
    except Exception as e:
        print(f"Expiry scheduler start note: {e}")


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8501))
    uvicorn.run("server:app", host="0.0.0.0", port=port, reload=False)
