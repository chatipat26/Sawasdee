"""
API Routers package for SawasdeeRental.
"""

from .cars import router as cars_router
from .auth import router as auth_router
from .customers import router as customers_router
from .line import router as line_router
from .system import router as system_router

__all__ = [
    "cars_router",
    "auth_router",
    "customers_router",
    "line_router",
    "system_router",
]
