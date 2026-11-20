"""
API Routers package for SawasdeeRental.
"""

from .cars import router as cars_router
from .auth import router as auth_router
from .customers import router as customers_router
from .line import router as line_router
from .system import router as system_router
from .finance import router as finance_router
from .reports import router as reports_router
from .maintenance import router as maintenance_router
from .pdf import router as pdf_router
from .bookings import router as bookings_router

__all__ = [
    "cars_router",
    "auth_router",
    "customers_router",
    "line_router",
    "system_router",
    "finance_router",
    "reports_router",
    "maintenance_router",
    "pdf_router",
    "bookings_router",
]
